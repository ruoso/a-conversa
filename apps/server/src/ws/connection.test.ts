// @vitest-environment node
//
// The `ws` library requires Node's real `net`/`tls` stack and
// `Buffer` semantics; happy-dom (the project-wide default in
// `vitest.config.ts`) shims a subset that confuses the duplex stream
// `@fastify/websocket` uses for `injectWS`. Override per-file so this
// test runs in a real Node environment without changing the global.
//
// Tests for the WebSocket connection-lifecycle plugin.
//
// Refinement: tasks/refinements/backend/ws_connection_handling.md
//             tasks/refinements/backend/ws_auth_on_connect.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling
//
// **Coverage.** The lifecycle primitives:
//   1. A connection opens and receives the canonical hello envelope
//      `{ type: 'hello', id, payload: { connectionId } }` as its first
//      message — replacing the prior placeholder shape per
//      `ws_message_envelope`.
//   2. Both the envelope `id` and the payload `connectionId` are
//      syntactically-valid RFC 4122 v4 UUIDs.
//   3. A client-initiated close drives the server's `close` handler.
//   4. App close hook → an in-flight connection receives a 1001
//      going-away close from the server.
//   5. Unexpected-error path → setting the test-only force-error
//      header on the upgrade request causes the handler to throw,
//      the library's `errorHandler` callback fires, and the socket
//      receives a 1011 internal-error close.
//
// **Authentication seam.** Every test in this file authenticates the
// WS upgrade — `ws_auth_on_connect` made auth a precondition for any
// connection. Tests mint a session JWT for `FIXTURE_USER_ID` and pass
// it via the `Cookie` header in the upgrade `Request`. Auth-rejection
// scenarios (no cookie / bad signature / expired token / valid user
// stashed on context) live in the sibling `auth.test.ts`; this file
// is the lifecycle-after-auth surface.
//
// Tests use `@fastify/websocket`'s `app.injectWS(...)` to drive a
// connection against the in-process Fastify instance — no port bind,
// no race against the OS, no mocking of the WS library. The plugin
// under test is exercised end-to-end through its real upgrade path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../auth/session-token.js';
import { WS_CLOSE_CODES, WS_TEST_FORCE_ERROR_HEADER, __buildTestWsApp } from './connection.js';
import {
  FIXTURE_SCREEN_NAME,
  FIXTURE_USER_ID,
  TEST_SESSION_SECRET,
  makeMemoryPool,
} from './test-helpers.js';

// RFC 4122 v4 UUID matcher: 8-4-4-4-12 hex, with the 13th char fixed
// to `4` and the 17th to one of [89ab]. Exported nowhere — the
// pattern is a one-off for these tests and we don't want to imply
// a public API.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Helper: open a WS via `injectWS` and pre-attach a `message` queue
 * BEFORE the handshake completes. Server-initiated frames (like our
 * placeholder `hello`) can arrive before the client `open` event
 * resolves; pre-attaching the listener via `onInit` guarantees we
 * never miss the first frame.
 *
 * Returns the open WS plus a `next()` reader that yields queued
 * messages (or waits for the next one to arrive).
 */
type WsLike = {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
};

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

interface OpenedWs {
  ws: WsLike;
  next: () => Promise<string>;
}

async function openWsClient(
  app: FastifyInstance,
  options?: { headers?: Record<string, string> },
): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;

  const ws = await app.injectWS('/ws', options ?? {}, {
    onInit(client: unknown) {
      // Pre-attach the message handler before the handshake
      // completes so the server-initiated `hello` frame is captured
      // even if it arrives before the `open` event resolves
      // injectWS's promise.
      (client as WsLike).on('message', (data: unknown) => {
        const text = toUtf8(data);
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(text);
        } else {
          queue.push(text);
        }
      });
    },
  });

  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiter = resolve;
    });

  return { ws, next };
}

/**
 * Helper: wait for the next `close` event on a ws client and return
 * the close code + reason.
 */
function nextClose(ws: {
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
}): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on('close', (code: number, reason: Buffer) => {
      resolve({ code, reason: reason.toString('utf8') });
    });
  });
}

/**
 * Build the WS test app the lifecycle tests share. The fixture user
 * is live (`deletedAt: null`) so every cookie minted from
 * `FIXTURE_USER_ID` passes auth.
 */
async function buildLifecycleApp(): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool: makeMemoryPool([
      { id: FIXTURE_USER_ID, screenName: FIXTURE_SCREEN_NAME, deletedAt: null },
    ]),
    sessionTokenSecret: TEST_SESSION_SECRET,
  });
}

/**
 * Helper: mint a valid session-cookie value (just the JWT, no
 * `Set-Cookie` attributes) for the fixture user. Returned as the raw
 * `name=value` cookie pair so a test can pass it as the `Cookie`
 * header on the upgrade `Request`.
 */
async function fixtureCookieHeader(): Promise<string> {
  const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe('wsConnectionHandlingPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildLifecycleApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends a canonical hello envelope on connect with v4 ids', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, { headers: { cookie } });
    try {
      const raw = await next();
      // Canonical envelope shape per `ws_message_envelope` —
      // `{ type: 'hello', id, payload: { connectionId } }`. Both ids
      // are RFC 4122 v4 UUIDs: the envelope `id` is freshly minted
      // per message; `connectionId` is stable for the connection's
      // lifetime.
      const parsed = JSON.parse(raw) as {
        type?: unknown;
        id?: unknown;
        payload?: { connectionId?: unknown };
      };
      expect(parsed.type).toBe('hello');
      expect(typeof parsed.id).toBe('string');
      expect(parsed.id).toMatch(UUID_V4_PATTERN);
      expect(typeof parsed.payload?.connectionId).toBe('string');
      expect(parsed.payload?.connectionId).toMatch(UUID_V4_PATTERN);
    } finally {
      ws.terminate();
    }
  });

  it('lets a client cleanly close the connection', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, { headers: { cookie } });
    // Consume the hello frame so the message-buffer pointer advances
    // past it; the test asserts that close() resolves without
    // throwing, which is what proves the server-side close handler
    // ran (a hung handler would prevent app.close() in afterEach).
    await next();

    const closed = nextClose(ws);
    ws.close(1000, 'client-done');
    const { code } = await closed;
    // Normal closure: the server echoes the close frame back per
    // the WS spec. The exact code on the client side is the client's
    // own emitted code (1000), confirming the close handshake
    // completed.
    expect(code).toBe(1000);
  });

  it('closes in-flight connections with 1001 on app shutdown', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, { headers: { cookie } });
    await next(); // consume hello

    const closed = nextClose(ws);
    await app.close();
    const { code, reason } = await closed;

    expect(code).toBe(WS_CLOSE_CODES.GOING_AWAY);
    expect(reason).toBe('server-shutting-down');

    // Rebuild for the afterEach to have something to close — the
    // beforeEach-built `app` is already torn down by this point.
    app = await buildLifecycleApp();
    await app.ready();
  });

  it('replies with a `malformed-envelope` error envelope and keeps the connection open', async () => {
    // Per `ws_error_message`, a frame that fails `parseWsEnvelopeJson`
    // produces a canonical `error` envelope on the wire (`code:
    // 'malformed-envelope'`, no `inResponseTo` because the inbound
    // frame had no parseable id) and the connection STAYS OPEN — a
    // per-frame parse failure is a client bug recoverable by
    // re-sending, not a connection-state problem.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, { headers: { cookie } });
    try {
      // Drain hello.
      const helloRaw = await next();
      const hello = JSON.parse(helloRaw) as { type?: unknown };
      expect(hello.type).toBe('hello');

      // Send a frame that JSON.parse can't handle.
      ws.send('{ this is not valid json');

      const errRaw = await next();
      const parsed = JSON.parse(errRaw) as {
        type?: unknown;
        id?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(parsed.type).toBe('error');
      // No `inResponseTo` — the inbound frame had no readable id.
      expect(parsed.inResponseTo).toBeUndefined();
      expect(parsed.payload?.code).toBe('malformed-envelope');
      expect(typeof parsed.payload?.message).toBe('string');

      // Connection still OPEN. The `ws` library's readyState enum:
      // 0 = CONNECTING, 1 = OPEN.
      expect(ws.readyState).toBe(1);
    } finally {
      ws.terminate();
    }
  });

  it('closes with 1011 when the handler throws (deterministic force-error header)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, {
      headers: { cookie, [WS_TEST_FORCE_ERROR_HEADER]: '1' },
    });
    // The hello frame is sent BEFORE the handler throws (the throw
    // is the last statement in the open path), so we still receive
    // it; draining the message keeps event ordering deterministic.
    await next();

    const closed = nextClose(ws);
    const { code, reason } = await closed;

    expect(code).toBe(WS_CLOSE_CODES.INTERNAL_ERROR);
    expect(reason).toBe('internal-error');
  });
});
