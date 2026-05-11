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
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling
//
// Coverage:
//   1. A connection opens and receives the placeholder hello frame
//      `{ type: 'hello', connectionId }` as its first message.
//   2. The `connectionId` is a syntactically-valid RFC 4122 v4 UUID.
//   3. A client-initiated close drives the server's `close` handler
//      (asserted indirectly by app teardown succeeding while the
//      connection is open — the onClose hook is exercised in the
//      shutdown test below).
//   4. App close hook → an in-flight connection receives a 1001
//      going-away close from the server.
//   5. Unexpected-error path → setting the test-only force-error
//      header on the upgrade request causes the handler to throw,
//      the library's `errorHandler` callback fires, and the socket
//      receives a 1011 internal-error close.
//
// Tests use `@fastify/websocket`'s `app.injectWS(...)` to drive a
// connection against the in-process Fastify instance — no port bind,
// no race against the OS, no mocking of the WS library. The plugin
// under test is exercised end-to-end through its real upgrade path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer } from '../server.js';
import { WS_CLOSE_CODES, WS_TEST_FORCE_ERROR_HEADER } from './connection.js';

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

describe('wsConnectionHandlingPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends a placeholder hello frame on connect with a v4 connectionId', async () => {
    const { ws, next } = await openWsClient(app);
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown; connectionId?: unknown };

      expect(parsed.type).toBe('hello');
      expect(typeof parsed.connectionId).toBe('string');
      expect(parsed.connectionId).toMatch(UUID_V4_PATTERN);
    } finally {
      ws.terminate();
    }
  });

  it('lets a client cleanly close the connection', async () => {
    const { ws, next } = await openWsClient(app);
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
    const { ws, next } = await openWsClient(app);
    await next(); // consume hello

    const closed = nextClose(ws);
    await app.close();
    const { code, reason } = await closed;

    expect(code).toBe(WS_CLOSE_CODES.GOING_AWAY);
    expect(reason).toBe('server-shutting-down');

    // Rebuild for the afterEach to have something to close — the
    // beforeEach-built `app` is already torn down by this point.
    app = await createServer({ logger: false });
    await app.ready();
  });

  it('closes with 1011 when the handler throws (deterministic force-error header)', async () => {
    const { ws, next } = await openWsClient(app, {
      headers: { [WS_TEST_FORCE_ERROR_HEADER]: '1' },
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
