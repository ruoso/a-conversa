// @vitest-environment node
//
// Vitest unit tests for the WS `subscribe` / `unsubscribe` handlers.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance built by `__buildTestWsApp`, the
// real dispatcher, and a real WS upgrade via `app.injectWS`. The
// registry-level invariants are covered separately in
// `../subscriptions.test.ts`; this file is the integration of:
//
//   1. Visibility-gated subscribe → registry populated + `subscribed`
//      ack emitted with `inResponseTo = subscribe envelope's id`.
//   2. Not-visible subscribe → log + drop (the placeholder error path
//      until `ws_error_message` lands). Asserted as: the registry stays
//      empty AND the connection receives no `subscribed` frame within a
//      bounded window AND the connection stays open.
//   3. Unsubscribe → registry entry removed + `unsubscribed` ack with
//      `inResponseTo`. Idempotent — works whether or not a matching
//      subscribe came first.
//   4. Connection close → the registry is wiped for the dropped
//      connection (the close hook in `connection.ts` calls
//      `removeConnection`; this test pins the wiring).
//
// **Memory pool composition.** `canSeeSession(pool, …)` issues a
// `SELECT 1 AS visible FROM sessions WHERE id = $1 AND <fragment>`. The
// shared `makeMemoryPool` recognises only the auth-middleware's
// `SELECT id, screen_name FROM users` query; this file extends that pool
// with a second SELECT recogniser that mirrors what
// `apps/server/src/sessions/visibility.test.ts` already validated. The
// extension is local because no other test layer touches both surfaces
// through one pool; the cucumber feature exercises the same path
// through real pglite.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';
import {
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  WS_MAX_SUBSCRIPTIONS_PER_CONNECTION_ENV,
  WsSubscriptionRegistry,
  resolveMaxSubscriptionsPerConnection,
} from '../subscriptions.js';

// Stable fixture ids.
const VISIBLE_SESSION_ID = '00000000-0000-4000-8000-0000000000c1';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-0000000000c2';
const UNKNOWN_SESSION_ID = '00000000-0000-4000-8000-0000000000c3';
const OTHER_HOST_ID = '00000000-0000-4000-8000-0000000000d1';

// RFC 4122 v4 UUID matcher — mirrors `connection.test.ts`.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// One memory pool that answers BOTH the auth-middleware SELECT (single
// users row) AND the `canSeeSession` SELECT (sessions table + visibility
// rule). The shape mirrors the memory executor in
// `sessions/visibility.test.ts`.

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: 'public' | 'private';
}

function makeWsHandlerPool(): DbPool {
  // FIXTURE_USER_ID hosts a public session (visible); OTHER_HOST_ID hosts
  // a private session our fixture user is NOT a participant of (hidden).
  const sessions: SessionRow[] = [
    { id: VISIBLE_SESSION_ID, host_user_id: FIXTURE_USER_ID, privacy: 'public' },
    { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private' },
  ];

  return {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];

      // Auth middleware's lookup. Same recogniser as `makeMemoryPool`
      // in `test-helpers.ts`.
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        if (id === FIXTURE_USER_ID) {
          return Promise.resolve({
            rows: [{ id: FIXTURE_USER_ID, screen_name: FIXTURE_SCREEN_NAME }] as unknown as TRow[],
          });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      // `canSeeSession`'s lookup. Same recogniser logic as in
      // `sessions/visibility.test.ts`'s memory executor — the SQL is
      // built by `visibilityWhereFragment(2)` which embeds `$1` and
      // `$2` references, public-privacy literal, and the participants
      // EXISTS subquery.
      if (
        text.trim().startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'") &&
        text.includes('host_user_id = $2') &&
        text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const session = sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        // No participants table — the fixture user is never a
        // participant of the hidden session. Sufficient for the
        // visibility gate's not-visible branch.
        if (isPublic || isHost) {
          return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      return Promise.reject(new Error(`unexpected SQL in WS handler test pool: ${text}`));
    },
  };
}

// ---- Permissive pool for cap-boundary tests ----
//
// The cap tests need to subscribe to many distinct session ids without
// constructing a memory backing for each. This variant answers the
// visibility predicate as "visible" for ANY session id — sufficient
// for the cap-boundary integration tests (the cap is a pre-write
// gate; visibility passes for every candidate id so the test focuses
// on the cap surface). The auth-row lookup mirrors the standard pool.
function makeAlwaysVisibleWsHandlerPool(): DbPool {
  return {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        if (id === FIXTURE_USER_ID) {
          return Promise.resolve({
            rows: [{ id: FIXTURE_USER_ID, screen_name: FIXTURE_SCREEN_NAME }] as unknown as TRow[],
          });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }
      if (
        text.trim().startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1')
      ) {
        return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in WS handler cap test pool: ${text}`));
    },
  };
}

// Build N distinct valid UUID v4 strings deterministically. Used by
// the cap tests to subscribe to N distinct sessions in sequence.
function capSessionId(i: number): string {
  const hex = i.toString(16).padStart(2, '0');
  return `00000000-0000-4000-8000-0000000000${hex}`;
}

// ---- WS client plumbing --------------------------------------------
//
// Same shape as `auth.test.ts` / `connection.test.ts`: pre-attach a
// `message` listener via `onInit` so the server-initiated frames don't
// arrive before we're ready for them.

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
  closed: Promise<{ code: number; reason: string }>;
}

async function openWsClient(app: FastifyInstance, cookie: string): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;
  let closeResolve: ((evt: { code: number; reason: string }) => void) | null = null;
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    closeResolve = resolve;
  });

  const ws = await app.injectWS(
    '/ws',
    { headers: { cookie } },
    {
      onInit(client: unknown) {
        const wsClient = client as WsLike;
        wsClient.on('message', (data: unknown) => {
          const text = toUtf8(data);
          if (waiter) {
            const w = waiter;
            waiter = null;
            w(text);
          } else {
            queue.push(text);
          }
        });
        wsClient.on('close', (code: number, reason: Buffer) => {
          if (closeResolve) {
            const fn = closeResolve;
            closeResolve = null;
            fn({ code, reason: reason.toString('utf8') });
          }
        });
      },
    },
  );

  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiter = resolve;
    });

  return { ws, next, closed };
}

async function buildHandlerApp(): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool: makeWsHandlerPool(),
    sessionTokenSecret: TEST_SESSION_SECRET,
  });
}

async function fixtureCookieHeader(): Promise<string> {
  const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

// Build a `subscribe` envelope of the canonical shape. The handler
// reads `envelope.payload.sessionId` and echoes `envelope.id` via
// `inResponseTo` in the ack.
function subscribeEnvelope(messageId: string, sessionId: string): string {
  return JSON.stringify({
    type: 'subscribe',
    id: messageId,
    payload: { sessionId },
  });
}

function unsubscribeEnvelope(messageId: string, sessionId: string): string {
  return JSON.stringify({
    type: 'unsubscribe',
    id: messageId,
    payload: { sessionId },
  });
}

// Sample v4 UUIDs for the test envelopes' `id` field.
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111111';
const UNSUB_MSG_ID = '22222222-2222-4222-8222-222222222222';

describe('ws_subscribe_to_session — handler integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildHandlerApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('subscribes to a visible session and emits a `subscribed` ack with inResponseTo', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      // Drain the hello envelope so the next() reader is positioned on
      // the subscribe ack.
      const helloRaw = await next();
      const hello = JSON.parse(helloRaw) as { type?: unknown };
      expect(hello.type).toBe('hello');

      // Send the subscribe request. VISIBLE_SESSION_ID is public + hosted
      // by FIXTURE_USER_ID; the visibility predicate returns true.
      ws.send(subscribeEnvelope(SUB_MSG_ID, VISIBLE_SESSION_ID));

      const ackRaw = await next();
      const ack = JSON.parse(ackRaw) as {
        type?: unknown;
        id?: unknown;
        inResponseTo?: unknown;
        payload?: { sessionId?: unknown };
      };
      expect(ack.type).toBe('subscribed');
      // The ack carries its own freshly-minted UUID v4 id.
      expect(ack.id).toMatch(UUID_V4_PATTERN);
      // inResponseTo correlates back to the originating subscribe envelope.
      expect(ack.inResponseTo).toBe(SUB_MSG_ID);
      // Payload echoes the session id (the wire's human-readable channel).
      expect(ack.payload?.sessionId).toBe(VISIBLE_SESSION_ID);

      // The registry was populated. Reach for it via the same
      // app-decoration the handler used. The decoration is part of
      // the `wsSubscriptionsPlugin` contract — see refinement.
      const conns = app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID);
      expect(conns).toHaveLength(1);
      // The single entry's a v4 UUID (the per-connection id the
      // connection handler minted on open).
      expect(conns[0]).toMatch(UUID_V4_PATTERN);
    } finally {
      ws.terminate();
    }
  });

  it('emits an `error` envelope with `code: "not-found"` for a non-visible session, connection stays open', async () => {
    // Per `ws_error_message`, the placeholder log-and-drop is replaced
    // by a wire `error` envelope. `code: 'not-found'` (NOT `forbidden`)
    // inherits the existence-non-leak rule from `canSeeSession` — the
    // visibility predicate collapses "doesn't exist" and "exists but
    // not visible" (the 404-not-403 rule from `get_session_endpoint`).
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      // Drain hello.
      await next();

      // HIDDEN_SESSION_ID is private and hosted by OTHER_HOST_ID; the
      // fixture user is not a participant. canSeeSession returns false;
      // the handler sends the `error` envelope.
      ws.send(subscribeEnvelope(SUB_MSG_ID, HIDDEN_SESSION_ID));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(SUB_MSG_ID);
      expect(err.payload?.code).toBe('not-found');
      expect(typeof err.payload?.message).toBe('string');

      // Registry stays empty for the not-visible session.
      expect(app.wsSubscriptions.connectionsForSession(HIDDEN_SESSION_ID)).toEqual([]);

      // Same negative result for a fully-unknown session id — the
      // visibility predicate collapses "doesn't exist" and "exists
      // but not visible". The handler's branch is the same.
      ws.send(subscribeEnvelope(SUB_MSG_ID, UNKNOWN_SESSION_ID));
      const err2Raw = await next();
      const err2 = JSON.parse(err2Raw) as {
        type?: unknown;
        payload?: { code?: unknown };
      };
      expect(err2.type).toBe('error');
      expect(err2.payload?.code).toBe('not-found');
      expect(app.wsSubscriptions.connectionsForSession(UNKNOWN_SESSION_ID)).toEqual([]);

      // The connection is still open — readyState 1 (OPEN) per the
      // `ws` library's enum.
      expect(ws.readyState).toBe(1);
    } finally {
      ws.terminate();
    }
  });

  it('unsubscribes and emits an `unsubscribed` ack; the registry entry is removed', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // First subscribe so there's something to remove.
      ws.send(subscribeEnvelope(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');
      expect(app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID)).toHaveLength(1);

      // Now unsubscribe.
      ws.send(unsubscribeEnvelope(UNSUB_MSG_ID, VISIBLE_SESSION_ID));
      const unsubAck = JSON.parse(await next()) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { sessionId?: unknown };
      };
      expect(unsubAck.type).toBe('unsubscribed');
      expect(unsubAck.inResponseTo).toBe(UNSUB_MSG_ID);
      expect(unsubAck.payload?.sessionId).toBe(VISIBLE_SESSION_ID);

      // Registry entry is gone — the snapshot is empty.
      expect(app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID)).toEqual([]);
    } finally {
      ws.terminate();
    }
  });

  it('wipes subscriptions for a connection when its socket closes', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next, closed } = await openWsClient(app, cookie);
    await next(); // hello

    // Subscribe so there's a registry entry to clean up.
    ws.send(subscribeEnvelope(SUB_MSG_ID, VISIBLE_SESSION_ID));
    const subAck = JSON.parse(await next()) as { type?: unknown };
    expect(subAck.type).toBe('subscribed');
    expect(app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID)).toHaveLength(1);

    // Close from the client side. The server's close hook calls
    // `app.wsSubscriptions.removeConnection(connectionId)` — exactly the
    // wiring under test. `terminate()` is the forceful tear-down path
    // (the `auth.test.ts` lifecycle uses the same primitive); it
    // guarantees the server-side socket close event fires on the next
    // tick rather than waiting for a graceful close handshake.
    ws.terminate();
    // The client-side close event still fires after terminate; await
    // it so we observe a synchronous-enough server-side teardown.
    await closed;

    // Poll briefly for the server-side close hook to run. The client's
    // close event fires when the WS close handshake completes on the
    // client end; the server's matching `socket.on('close', …)` runs
    // on the next event-loop tick on the server side of the in-memory
    // duplex stream. We bound the poll at ~500ms so a regression
    // (e.g. the hook was removed) fails fast rather than hanging.
    const deadline = Date.now() + 500;
    while (
      app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID).length > 0 &&
      Date.now() < deadline
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    expect(app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID)).toEqual([]);
  });
});

// ---- Per-connection subscription cap (M3-review inputs.md F-001) ----
//
// Closes `docs/security/m3-review/inputs.md` F-001. The cap lives in
// `subscriptions.ts` (`MAX_SUBSCRIPTIONS_PER_CONNECTION` = 32, env
// override `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`); the subscribe
// handler catches `SubscriptionCapacityError` and emits a wire
// `error` envelope with `code: 'too-many-subscriptions'`.

describe('ws_subscribe_to_session — per-connection subscription cap (inputs.md F-001)', () => {
  let capApp: FastifyInstance | undefined;

  afterEach(async () => {
    if (capApp !== undefined) {
      await capApp.close();
      capApp = undefined;
    }
  });

  async function buildCappedApp(cap: number): Promise<FastifyInstance> {
    capApp = await __buildTestWsApp({
      pool: makeAlwaysVisibleWsHandlerPool(),
      sessionTokenSecret: TEST_SESSION_SECRET,
      maxSubscriptionsPerConnection: cap,
    });
    return capApp;
  }

  it('exports the documented default + env-name constants', () => {
    // Pins the cap value documented in the refinement + ws-protocol.md.
    // A future retune of the default must update both the constant and
    // the documentation in lock-step; this test fails if they drift.
    expect(MAX_SUBSCRIPTIONS_PER_CONNECTION).toBe(32);
    expect(WS_MAX_SUBSCRIPTIONS_PER_CONNECTION_ENV).toBe('WS_MAX_SUBSCRIPTIONS_PER_CONNECTION');
  });

  it('with cap=3, three distinct subscribes succeed', async () => {
    const app = await buildCappedApp(3);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // drain hello

      for (let i = 1; i <= 3; i++) {
        const sessionId = capSessionId(i);
        const messageId = `11111111-1111-4111-8111-${i.toString(16).padStart(12, '0')}`;
        ws.send(subscribeEnvelope(messageId, sessionId));
        const ackRaw = await next();
        const ack = JSON.parse(ackRaw) as {
          type?: unknown;
          inResponseTo?: unknown;
          payload?: { sessionId?: unknown };
        };
        expect(ack.type).toBe('subscribed');
        expect(ack.inResponseTo).toBe(messageId);
        expect(ack.payload?.sessionId).toBe(sessionId);
      }

      const sessions = [
        ...app.wsSubscriptions.sessionsForConnection(
          app.wsSubscriptions.connectionsForSession(capSessionId(1))[0]!,
        ),
      ].sort();
      expect(sessions).toHaveLength(3);
    } finally {
      ws.terminate();
    }
  });

  it('with cap=3, a 4th distinct subscribe is rejected with too-many-subscriptions', async () => {
    const app = await buildCappedApp(3);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Fill the cap with 3 distinct subscribes.
      for (let i = 1; i <= 3; i++) {
        ws.send(
          subscribeEnvelope(
            `11111111-1111-4111-8111-${i.toString(16).padStart(12, '0')}`,
            capSessionId(i),
          ),
        );
        const ack = JSON.parse(await next()) as { type?: unknown };
        expect(ack.type).toBe('subscribed');
      }

      // 4th distinct → rejected with the canonical error envelope.
      const overflowMessageId = '11111111-1111-4111-8111-0000000000ff';
      const overflowSessionId = capSessionId(4);
      ws.send(subscribeEnvelope(overflowMessageId, overflowSessionId));
      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(overflowMessageId);
      expect(err.payload?.code).toBe('too-many-subscriptions');
      expect(typeof err.payload?.message).toBe('string');
      // No-leak invariant: the wire message MUST NOT include the cap
      // value (or any integer) — otherwise an attacker can calibrate
      // their fan-out against the leaked value. Same pattern as the
      // `flow_state_map_bound` sibling task.
      expect(err.payload?.message as string).not.toMatch(/\b\d+\b/);

      // The 4th session is NOT in the registry; the first three are.
      expect(app.wsSubscriptions.connectionsForSession(overflowSessionId)).toEqual([]);
      expect(app.wsSubscriptions.connectionsForSession(capSessionId(1))).toHaveLength(1);

      // The connection stays open — per-frame failures are recoverable
      // (the protocol's general invariant).
      expect(ws.readyState).toBe(1);
    } finally {
      ws.terminate();
    }
  });

  it('with cap=3 at capacity, re-subscribing to an existing session is idempotent (no error, ack received)', async () => {
    const app = await buildCappedApp(3);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Fill the cap.
      for (let i = 1; i <= 3; i++) {
        ws.send(
          subscribeEnvelope(
            `11111111-1111-4111-8111-${i.toString(16).padStart(12, '0')}`,
            capSessionId(i),
          ),
        );
        const ack = JSON.parse(await next()) as { type?: unknown };
        expect(ack.type).toBe('subscribed');
      }

      // Re-subscribe to one of the existing 3. Must NOT be rejected by
      // the cap (it's not adding a new session) — produces a normal
      // `subscribed` ack.
      const idempotentMessageId = '22222222-2222-4222-8222-000000000001';
      ws.send(subscribeEnvelope(idempotentMessageId, capSessionId(2)));
      const ack = JSON.parse(await next()) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { sessionId?: unknown };
      };
      expect(ack.type).toBe('subscribed');
      expect(ack.inResponseTo).toBe(idempotentMessageId);
      expect(ack.payload?.sessionId).toBe(capSessionId(2));

      // Still 3 sessions for the connection — re-subscribing does not
      // double-count.
      const connId = app.wsSubscriptions.connectionsForSession(capSessionId(1))[0]!;
      expect(app.wsSubscriptions.sessionsForConnection(connId)).toHaveLength(3);
    } finally {
      ws.terminate();
    }
  });

  it('with cap=3, unsubscribing then subscribing to a NEW session succeeds', async () => {
    const app = await buildCappedApp(3);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Fill the cap.
      for (let i = 1; i <= 3; i++) {
        ws.send(
          subscribeEnvelope(
            `11111111-1111-4111-8111-${i.toString(16).padStart(12, '0')}`,
            capSessionId(i),
          ),
        );
        const ack = JSON.parse(await next()) as { type?: unknown };
        expect(ack.type).toBe('subscribed');
      }

      // Unsubscribe from one — frees a slot.
      ws.send(unsubscribeEnvelope('22222222-2222-4222-8222-000000000010', capSessionId(2)));
      const unsubAck = JSON.parse(await next()) as { type?: unknown };
      expect(unsubAck.type).toBe('unsubscribed');

      // Subscribe to a 4th, distinct, NEW session — must succeed
      // because the connection is now back at 2 sessions.
      const newMessageId = '22222222-2222-4222-8222-000000000020';
      const newSessionId = capSessionId(99);
      ws.send(subscribeEnvelope(newMessageId, newSessionId));
      const ack = JSON.parse(await next()) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { sessionId?: unknown };
      };
      expect(ack.type).toBe('subscribed');
      expect(ack.inResponseTo).toBe(newMessageId);
      expect(ack.payload?.sessionId).toBe(newSessionId);
    } finally {
      ws.terminate();
    }
  });

  it('with cap=5 (env-tunable), 5 succeed and the 6th distinct is rejected', async () => {
    // Pins the env-tunability contract: an operator can lift the cap
    // via `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`. Tests inject the
    // value directly (avoiding `process.env` mutation), but the wiring
    // — option → plugin → registry constructor — is the same path the
    // resolver follows.
    const app = await buildCappedApp(5);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      for (let i = 1; i <= 5; i++) {
        ws.send(
          subscribeEnvelope(
            `33333333-3333-4333-8333-${i.toString(16).padStart(12, '0')}`,
            capSessionId(i),
          ),
        );
        const ack = JSON.parse(await next()) as { type?: unknown };
        expect(ack.type).toBe('subscribed');
      }

      // 6th distinct is rejected.
      const overflowMessageId = '33333333-3333-4333-8333-0000000000ff';
      ws.send(subscribeEnvelope(overflowMessageId, capSessionId(6)));
      const err = JSON.parse(await next()) as {
        type?: unknown;
        payload?: { code?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.payload?.code).toBe('too-many-subscriptions');
    } finally {
      ws.terminate();
    }
  });
});

// ---- resolveMaxSubscriptionsPerConnection (env resolver) ----
//
// Pure-logic tests for the env-resolution helper. Mirrors the
// `resolveCatchUpMaxEvents` / `resolveBodyLimit` test discipline.

describe('resolveMaxSubscriptionsPerConnection', () => {
  it('returns the default 32 when the env var is absent', () => {
    expect(resolveMaxSubscriptionsPerConnection({})).toBe(MAX_SUBSCRIPTIONS_PER_CONNECTION);
  });

  it('returns the default when the env var is the empty string', () => {
    expect(resolveMaxSubscriptionsPerConnection({ WS_MAX_SUBSCRIPTIONS_PER_CONNECTION: '' })).toBe(
      MAX_SUBSCRIPTIONS_PER_CONNECTION,
    );
  });

  it('returns the default when the env var is non-numeric', () => {
    expect(
      resolveMaxSubscriptionsPerConnection({ WS_MAX_SUBSCRIPTIONS_PER_CONNECTION: 'banana' }),
    ).toBe(MAX_SUBSCRIPTIONS_PER_CONNECTION);
  });

  it('returns the default when the env var is zero or negative', () => {
    expect(resolveMaxSubscriptionsPerConnection({ WS_MAX_SUBSCRIPTIONS_PER_CONNECTION: '0' })).toBe(
      MAX_SUBSCRIPTIONS_PER_CONNECTION,
    );
    expect(
      resolveMaxSubscriptionsPerConnection({ WS_MAX_SUBSCRIPTIONS_PER_CONNECTION: '-5' }),
    ).toBe(MAX_SUBSCRIPTIONS_PER_CONNECTION);
  });

  it('returns the parsed integer when positive', () => {
    expect(
      resolveMaxSubscriptionsPerConnection({ WS_MAX_SUBSCRIPTIONS_PER_CONNECTION: '128' }),
    ).toBe(128);
    expect(resolveMaxSubscriptionsPerConnection({ WS_MAX_SUBSCRIPTIONS_PER_CONNECTION: '5' })).toBe(
      5,
    );
  });
});

// ---- WsSubscriptionRegistry — direct unit coverage of the cap ----
//
// These tests exercise the cap surface directly on the registry, with
// no Fastify / WS plumbing involved. They're a peer to the existing
// `../subscriptions.test.ts` registry tests and pin the public
// contract of the cap (idempotent re-subscribe at cap, throw on new
// at cap, constructor option threading).

describe('WsSubscriptionRegistry — subscription cap (unit)', () => {
  const CONN = '00000000-0000-4000-8000-000000000001';

  it('throws SubscriptionCapacityError when a new sessionId is added at cap', () => {
    const reg = new WsSubscriptionRegistry({ maxSubscriptionsPerConnection: 2 });
    reg.subscribe(CONN, capSessionId(1));
    reg.subscribe(CONN, capSessionId(2));
    expect(() => reg.subscribe(CONN, capSessionId(3))).toThrow(/cap reached/i);
    // The registry stays consistent — the rejected session is NOT
    // recorded on either index.
    expect(reg.sessionsForConnection(CONN)).toHaveLength(2);
    expect(reg.connectionsForSession(capSessionId(3))).toEqual([]);
  });

  it('does NOT throw when re-subscribing at cap to an existing sessionId (idempotent)', () => {
    const reg = new WsSubscriptionRegistry({ maxSubscriptionsPerConnection: 2 });
    reg.subscribe(CONN, capSessionId(1));
    reg.subscribe(CONN, capSessionId(2));
    // Re-subscribe to one of the existing two — must not throw and
    // must not double-count.
    expect(() => reg.subscribe(CONN, capSessionId(1))).not.toThrow();
    expect(reg.sessionsForConnection(CONN)).toHaveLength(2);
  });

  it('defaults to MAX_SUBSCRIPTIONS_PER_CONNECTION when constructed without options', () => {
    const reg = new WsSubscriptionRegistry();
    // Add MAX_SUBSCRIPTIONS_PER_CONNECTION + 1 sessions; the last
    // one must throw. Smoke check that the constructor default is in
    // play (env-resolution happens at plugin-registration time, not
    // here).
    for (let i = 1; i <= MAX_SUBSCRIPTIONS_PER_CONNECTION; i++) {
      reg.subscribe(CONN, capSessionId(i));
    }
    expect(() => reg.subscribe(CONN, capSessionId(MAX_SUBSCRIPTIONS_PER_CONNECTION + 1))).toThrow(
      /cap reached/i,
    );
  });

  it('SubscriptionCapacityError message contains no integers (no cap leak)', () => {
    const reg = new WsSubscriptionRegistry({ maxSubscriptionsPerConnection: 1 });
    reg.subscribe(CONN, capSessionId(1));
    try {
      reg.subscribe(CONN, capSessionId(2));
      throw new Error('expected SubscriptionCapacityError');
    } catch (err) {
      // The error message MUST NOT include the cap value or the
      // current occupancy — otherwise serialising the error (e.g.
      // in a server log scrape leaking back to a client) would
      // reveal the cap to a calibrating attacker.
      const message = (err as Error).message;
      expect(message).not.toMatch(/\b\d+\b/);
    }
  });
});
