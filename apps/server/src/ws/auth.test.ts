// @vitest-environment node
//
// Vitest unit tests for the WebSocket auth gate (`ws_auth_on_connect`).
//
// Refinement: tasks/refinements/backend/ws_auth_on_connect.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_auth_on_connect
//
// **Coverage.** The auth-rejection + auth-success surface:
//
//   1. No cookie on the upgrade request → the `preValidation` hook
//      throws `ApiError(401, 'auth-required')`; `@fastify/websocket`'s
//      pipeline sends the 401 response on the raw upgrade socket and
//      destroys it; `injectWS` rejects with "Unexpected server
//      response: 401". No WS handshake completes.
//   2. Cookie present but the JWT signature is tampered → 401, same
//      rejection path.
//   3. Cookie present but the JWT is expired → 401, same path.
//   4. Cookie present and valid → the upgrade succeeds and the hello
//      frame arrives. (Lifecycle regression-pin — proves the auth
//      gate is purely additive and doesn't break the foundation
//      `ws_connection_handling` laid.)
//   5. Cookie present and valid → the per-connection context exposes
//      the expected `user.id` + `user.screenName`. Asserted via the
//      module-scoped `__getOpenConnectionsForTests()` inspector
//      (deliberately a server-private surface today; `ws_event_broadcast`
//      will eventually surface this as a sender id on the wire).
//
// All tests use `app.injectWS(...)` against an in-process Fastify
// instance built by `__buildTestWsApp` (the shared WS test app
// builder). No mocks of the auth primitive — the same
// `authenticateRequest` helper the HTTP middleware composes is the
// one under test through this surface.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../auth/session-token.js';
import { __buildTestWsApp, __getOpenConnectionsForTests } from './connection.js';
import {
  FIXTURE_SCREEN_NAME,
  FIXTURE_USER_ID,
  TEST_SESSION_SECRET,
  makeMemoryPool,
} from './test-helpers.js';

// RFC 4122 v4 UUID matcher — mirrors `connection.test.ts`.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * Build the WS test app with the canonical fixture user pre-seeded.
 * `opts.now` is forwarded so the expired-token test can pin the
 * verify clock.
 */
async function buildAuthTestApp(opts?: { now?: () => number }): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool: makeMemoryPool([
      { id: FIXTURE_USER_ID, screenName: FIXTURE_SCREEN_NAME, deletedAt: null },
    ]),
    sessionTokenSecret: TEST_SESSION_SECRET,
    ...(opts?.now !== undefined ? { now: opts.now } : {}),
  });
}

describe('ws_auth_on_connect — rejection paths', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildAuthTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an upgrade with no cookie (HTTP 401 before the WS handshake)', async () => {
    // `injectWS` rejects when the server emits a non-101 response —
    // exactly the surface a real browser sees when the WS handshake
    // fails. The error message carries the HTTP status the server
    // sent (`Unexpected server response: 401`).
    await expect(openWsClient(app)).rejects.toThrow(/Unexpected server response: 401/);
    // No connection was registered — the gate fired BEFORE the route
    // handler had a chance to mint the connection-id.
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });

  it('rejects an upgrade with a tampered JWT signature (HTTP 401)', async () => {
    const validToken = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const parts = validToken.split('.');
    // Forge a same-shape but mathematically-invalid signature segment.
    const fakeSig = Buffer.alloc(32, 0xab).toString('base64url');
    const tampered = `${parts[0]}.${parts[1]}.${fakeSig}`;
    await expect(
      openWsClient(app, { headers: { cookie: `${SESSION_COOKIE_NAME}=${tampered}` } }),
    ).rejects.toThrow(/Unexpected server response: 401/);
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });

  it('rejects an upgrade with an expired JWT (HTTP 401)', async () => {
    // Sign with `now` pinned to 1970 so the token's `exp` is far in
    // the past relative to the verify clock (default `Date.now`).
    // Even without the secret-pinned verify clock, the token would
    // be rejected; this case verifies the verify path's expired-token
    // branch runs.
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET, {
      now: () => 1_000,
    });
    await expect(
      openWsClient(app, { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } }),
    ).rejects.toThrow(/Unexpected server response: 401/);
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });
});

describe('ws_auth_on_connect — success path', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildAuthTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a valid cookie and the hello frame arrives (upgrade completes)', async () => {
    // The auth gate's success path: the upgrade transitions to a live
    // WS connection and the server emits its first frame. The frame's
    // wire shape (placeholder `{type,connectionId}` vs. canonical
    // envelope `{type,id,payload:{connectionId}}`) is owned by
    // `ws_connection_handling` / `ws_message_envelope`, not by this
    // task — we only assert: the frame arrives, parses as JSON, and
    // carries a `type` discriminator of `'hello'`. The connection-id
    // assertion lives in the per-connection-context test below, where
    // we read it server-side via the inspector (which is shape-stable
    // across envelope versions).
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const { ws, next } = await openWsClient(app, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown };
      expect(parsed.type).toBe('hello');
    } finally {
      ws.terminate();
    }
  });

  it('attaches { id, screenName } to the per-connection context for authenticated upgrades', async () => {
    // Sanity-pin the inspector starts at zero.
    expect(__getOpenConnectionsForTests()).toHaveLength(0);

    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const { ws, next } = await openWsClient(app, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    try {
      // Drain the hello frame so we know the handler has run; the
      // open-connections set is populated synchronously inside the
      // handler before `socket.send(...)`, so by the time the hello
      // arrives the inspector is ready.
      await next();

      const open = __getOpenConnectionsForTests();
      // Exactly one open connection — the one this test just opened.
      // The lifecycle tests in `connection.test.ts` use a separate
      // app instance per test, so there's no cross-test bleed
      // (the module-scoped set is per-process, but each describe
      // block tears the app down in `afterEach`, which fires the
      // close handler and clears the entry).
      expect(open).toHaveLength(1);
      const ctx = open[0];
      expect(ctx?.connectionId).toMatch(UUID_V4_PATTERN);
      expect(ctx?.user).toEqual({
        id: FIXTURE_USER_ID,
        screenName: FIXTURE_SCREEN_NAME,
      });
    } finally {
      ws.terminate();
    }
  });
});
