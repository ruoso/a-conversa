// @vitest-environment node
//
// Vitest unit tests for the soft-delete WS-close helper.
//
// Refinement: tasks/refinements/backend-hardening/user_soft_delete_ws_close.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend_hardening.subscription_lifecycle.user_soft_delete_ws_close
//
// **Coverage.** The soft-delete-driven WS-revocation primitive (closes
// `docs/security/m3-review/coverage.md` G-003):
//
//   1. `closeUserConnections(userId)` closes the user's open WS with
//      the application-defined `WS_AUTH_REVOKED_CLOSE_CODE` (4401) and
//      reason `'auth-revoked'`. The connection is removed from the
//      open-connections inspector AND the subscription registry's
//      `sessionsForConnection` for that connection is empty
//      afterward. The helper returns 1.
//
//   2. The helper does NOT affect a second open WS owned by a
//      different (still-live) user — that connection's subscription
//      registry entry is untouched and no close frame arrives on its
//      socket.
//
//   3. Regression: after a soft-delete (modelled in this test layer
//      by flipping `deletedAt` on the memory pool), a NEW upgrade
//      attempt for the same user is rejected at the auth gate with
//      HTTP 401 — `authenticateRequest` already filters
//      `deleted_at IS NULL`; this test pins the regression.
//
//   4. `closeUserConnections` for a user with no open connections is
//      a no-op and returns 0.
//
//   5. `closeUserConnections` for a user with multiple open
//      connections (e.g. two browser tabs sharing one JWT) closes
//      both and returns 2.
//
// **No production caller in v1.** Per the refinement, the trigger
// surface (admin "delete user" endpoint, self-delete flow) is
// deferred. These tests exercise the helper directly to verify the
// structural primitive works in isolation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../auth/session-token.js';
import type { DbPool } from '../db.js';
import {
  closeUserConnections,
  WS_AUTH_REVOKED_CLOSE_CODE,
  WS_AUTH_REVOKED_REASON,
  __buildTestWsApp,
  __getConnectionsByUserSizeForTests,
  __getConnectionsForUserForTests,
  __getOpenConnectionsForTests,
} from './connection.js';
import {
  FIXTURE_SCREEN_NAME,
  FIXTURE_USER_ID,
  TEST_SESSION_SECRET,
  type TestUserRow,
} from './test-helpers.js';

type WsLike = {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState?: number;
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

/**
 * Open a WS via `injectWS` and pre-attach message + close listeners
 * BEFORE the handshake completes. The `closed` promise resolves with
 * the wire-side close code + reason — exactly what the
 * soft-delete-driven revocation test asserts against.
 */
async function openWsClient(
  app: FastifyInstance,
  options?: { headers?: Record<string, string> },
): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;
  let closeResolver: (value: { code: number; reason: string }) => void;
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    closeResolver = resolve;
  });
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
      (client as WsLike).on('close', (code: number, reason: Buffer) => {
        closeResolver({ code, reason: reason.toString('utf8') });
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
  return { ws, next, closed };
}

/**
 * Build a DB pool whose `deleted_at` field can be flipped mid-test.
 * The shared `makeMemoryPool` in `test-helpers.ts` accepts a frozen
 * row list; for the soft-delete regression we need to UPDATE a row
 * AFTER the helper has been wired. This pool mirrors the SQL surface
 * (one SELECT matching the `authenticateRequest` shape) but reads
 * from a live Map so a test can call `setUserDeletedAt(...)` to
 * simulate the admin UPDATE.
 */
interface MutableUserPool {
  readonly pool: DbPool;
  setUserDeletedAt(id: string, deletedAt: string | null): void;
}

function makeMutableUserPool(initial: ReadonlyArray<TestUserRow>): MutableUserPool {
  const users = new Map<string, TestUserRow>();
  for (const row of initial) {
    users.set(row.id, row);
  }
  return {
    pool: {
      query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const p = (params ?? []) as unknown[];
        if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
          const id = p[0] as string;
          const row = users.get(id);
          if (row === undefined || row.deletedAt !== null) {
            return Promise.resolve({ rows: [] as TRow[] });
          }
          return Promise.resolve({
            rows: [{ id: row.id, screen_name: row.screenName }] as unknown as TRow[],
          });
        }
        return Promise.reject(new Error(`unexpected SQL in soft-delete test pool: ${text}`));
      },
    },
    setUserDeletedAt(id: string, deletedAt: string | null): void {
      const existing = users.get(id);
      if (existing === undefined) {
        throw new Error(`mutable user pool: unknown user id ${id}`);
      }
      users.set(id, { ...existing, deletedAt });
    },
  };
}

// Canonical fixture for a SECOND user, used by test (2) to assert
// cross-user isolation. UUID is distinct from `FIXTURE_USER_ID` so the
// memory pool keys them apart.
const SECOND_USER_ID = '00000000-0000-4000-8000-000000000bb2';
const SECOND_SCREEN_NAME = 'bob-ws';

/**
 * Build the WS test app pre-seeded with both fixture users (live).
 * Returned alongside the mutable-pool handle so a test can flip a
 * user's `deletedAt` after the upgrade has authenticated.
 */
async function buildSoftDeleteTestApp(): Promise<{
  app: FastifyInstance;
  pool: MutableUserPool;
}> {
  const pool = makeMutableUserPool([
    { id: FIXTURE_USER_ID, screenName: FIXTURE_SCREEN_NAME, deletedAt: null },
    { id: SECOND_USER_ID, screenName: SECOND_SCREEN_NAME, deletedAt: null },
  ]);
  const app = await __buildTestWsApp({
    pool: pool.pool,
    sessionTokenSecret: TEST_SESSION_SECRET,
  });
  return { app, pool };
}

async function fixtureCookieHeader(userId: string): Promise<string> {
  const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

/**
 * Drain the event loop until the predicate is true, or fail after a
 * generous timeout. Used to wait for the server-side `socket.on('close')`
 * handler to run — `socket.close(...)` queues a close frame on the
 * underlying ws duplex stream; the server-side `close` event fires
 * asynchronously after both ends have observed the handshake. The
 * wire-side close on the client may arrive a microtask BEFORE the
 * server's close handler has finished draining the per-user index.
 *
 * Polls every 5ms with a generous 1s ceiling — fast enough not to slow
 * down a passing test, slow enough not to thrash the loop. The
 * predicate observes server-internal inspector state.
 */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 1000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`waitFor: ${label} did not become true within 1000ms`);
}

describe('closeUserConnections — soft-delete WS revocation (coverage.md G-003)', () => {
  let app: FastifyInstance;
  let pool: MutableUserPool;

  beforeEach(async () => {
    ({ app, pool } = await buildSoftDeleteTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('exports the application-defined close-code constants', () => {
    // The auth-revoked close code lives in the 4xxx application-use
    // range per RFC 6455 §7.4 and numerically mirrors HTTP 401 so a
    // WS-aware client can map the close code to "your session is no
    // longer valid".
    expect(WS_AUTH_REVOKED_CLOSE_CODE).toBe(4401);
    expect(WS_AUTH_REVOKED_REASON).toBe('auth-revoked');
  });

  it('closes the user’s open WS with code 4401 and reason ‘auth-revoked’', async () => {
    const cookie = await fixtureCookieHeader(FIXTURE_USER_ID);
    const { ws, next, closed } = await openWsClient(app, { headers: { cookie } });
    try {
      // Drain the hello so the open-connections inspector is populated
      // (the registry adds the context synchronously in the handler
      // before `socket.send(...)`, but draining is the test's signal
      // that the handler has run).
      await next();

      // Pre-condition: exactly one open connection for FIXTURE_USER_ID.
      const before = __getConnectionsForUserForTests(FIXTURE_USER_ID);
      expect(before).toHaveLength(1);
      const ctx = before[0];
      expect(ctx?.user?.id).toBe(FIXTURE_USER_ID);

      // Simulate the admin path that this task DOES NOT yet wire: a
      // direct UPDATE of `users.deleted_at`. The pool's
      // `setUserDeletedAt` mirrors the SQL effect.
      pool.setUserDeletedAt(FIXTURE_USER_ID, new Date().toISOString());

      // Helper call — the surface the future admin-delete-user task
      // will trigger.
      const count = closeUserConnections(FIXTURE_USER_ID);
      expect(count).toBe(1);

      // Wire-side close: the client observes code 4401 + reason
      // 'auth-revoked'.
      const { code, reason } = await closed;
      expect(code).toBe(WS_AUTH_REVOKED_CLOSE_CODE);
      expect(reason).toBe(WS_AUTH_REVOKED_REASON);

      // Wait for the server-side `socket.on('close')` handler to drain
      // the per-user index (the wire-side close on the client may
      // fire a microtask before the server-side handler completes).
      await waitFor(() => __getConnectionsByUserSizeForTests() === 0, 'connectionsByUser drained');

      // Post-condition: the per-user index is pruned (the user's Set
      // was the only one in the Map; `connectionsByUser.size` drops to
      // 0 because the SECOND user has no open connection in this
      // test).
      expect(__getConnectionsByUserSizeForTests()).toBe(0);
      expect(__getConnectionsForUserForTests(FIXTURE_USER_ID)).toHaveLength(0);

      // Open-connections set is also drained for this context.
      const opens = __getOpenConnectionsForTests();
      expect(opens.find((c) => c.user?.id === FIXTURE_USER_ID)).toBeUndefined();

      // The subscription registry is empty for the closed connection
      // (the `close` handler ran `removeConnection(connectionId)`).
      // The context is the one we captured in `before`.
      const connectionId = ctx?.connectionId;
      expect(connectionId).toBeDefined();
      if (connectionId !== undefined) {
        expect(app.wsSubscriptions.sessionsForConnection(connectionId)).toHaveLength(0);
      }
    } finally {
      ws.terminate();
    }
  });

  it('does NOT affect a second WS owned by a different (still-live) user', async () => {
    const cookie1 = await fixtureCookieHeader(FIXTURE_USER_ID);
    const cookie2 = await fixtureCookieHeader(SECOND_USER_ID);
    const conn1 = await openWsClient(app, { headers: { cookie: cookie1 } });
    const conn2 = await openWsClient(app, { headers: { cookie: cookie2 } });

    // Track whether conn2 sees a close frame within the test window.
    // We don't await `conn2.closed` (it would hang on a passing test);
    // instead we race it against a microtask-tick to confirm no close
    // fired synchronously during the helper call. (The
    // server-initiated close runs synchronously inside `injectWS`'s
    // duplex stream — if conn2's socket were closed by the helper, the
    // close event would have fired before this assertion runs.)
    let conn2Closed = false;
    void conn2.closed.then(() => {
      conn2Closed = true;
    });

    try {
      await conn1.next();
      await conn2.next();

      // Soft-delete user 1 only; user 2 stays live.
      pool.setUserDeletedAt(FIXTURE_USER_ID, new Date().toISOString());

      const count = closeUserConnections(FIXTURE_USER_ID);
      expect(count).toBe(1);

      // conn1 closed with 4401.
      const { code: code1 } = await conn1.closed;
      expect(code1).toBe(WS_AUTH_REVOKED_CLOSE_CODE);

      // Wait for the server-side `close` handler on conn1 to drain
      // its index entry, then re-check that conn2 is still tracked.
      await waitFor(
        () => __getConnectionsForUserForTests(FIXTURE_USER_ID).length === 0,
        'conn1 drained from connectionsByUser',
      );

      // Microtask drain — give any synchronous close handler on conn2
      // a chance to fire. The helper closes only the targeted user's
      // sockets; conn2 should still be open.
      await Promise.resolve();
      await Promise.resolve();
      expect(conn2Closed).toBe(false);

      // conn2's per-user index entry survives; its subscription
      // registry entry is untouched.
      const stillOpen = __getConnectionsForUserForTests(SECOND_USER_ID);
      expect(stillOpen).toHaveLength(1);
      expect(stillOpen[0]?.user?.id).toBe(SECOND_USER_ID);

      // Open-connections set: only conn2 remains.
      const opens = __getOpenConnectionsForTests();
      expect(opens.map((c) => c.user?.id).sort()).toEqual([SECOND_USER_ID]);
    } finally {
      conn1.ws.terminate();
      conn2.ws.terminate();
    }
  });

  it('rejects a NEW WS upgrade attempt for a soft-deleted user (auth-gate regression pin)', async () => {
    // Sign the cookie BEFORE the soft-delete (the JWT itself is
    // structurally valid; the rejection comes from the
    // `WHERE deleted_at IS NULL` clause in `authenticateRequest`).
    const cookie = await fixtureCookieHeader(FIXTURE_USER_ID);
    pool.setUserDeletedAt(FIXTURE_USER_ID, new Date().toISOString());

    // `injectWS` rejects with "Unexpected server response: 401" when
    // the upgrade gate emits a 401 envelope (per ws_auth_on_connect).
    await expect(openWsClient(app, { headers: { cookie } })).rejects.toThrow(
      /Unexpected server response: 401/,
    );
    // No connection landed in either inspector.
    expect(__getConnectionsForUserForTests(FIXTURE_USER_ID)).toHaveLength(0);
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });

  it('returns 0 when the user has no open connections (no-op path)', () => {
    // The fixture user is live AND has no open WS (`beforeEach` did
    // not open one). The helper's lookup misses; it returns 0.
    expect(__getConnectionsForUserForTests(FIXTURE_USER_ID)).toHaveLength(0);
    expect(closeUserConnections(FIXTURE_USER_ID)).toBe(0);
    // Calling with a completely-unknown user id is also a no-op.
    expect(closeUserConnections('00000000-0000-4000-8000-000000000ffe')).toBe(0);
  });

  it('closes every connection owned by the same user (two-tabs case)', async () => {
    const cookie = await fixtureCookieHeader(FIXTURE_USER_ID);
    const tab1 = await openWsClient(app, { headers: { cookie } });
    const tab2 = await openWsClient(app, { headers: { cookie } });

    try {
      await tab1.next();
      await tab2.next();

      // Both tabs share the same user id; the per-user index Set has
      // two entries.
      expect(__getConnectionsForUserForTests(FIXTURE_USER_ID)).toHaveLength(2);

      pool.setUserDeletedAt(FIXTURE_USER_ID, new Date().toISOString());
      const count = closeUserConnections(FIXTURE_USER_ID);
      expect(count).toBe(2);

      // Both wire-side closes carry 4401.
      const { code: code1 } = await tab1.closed;
      const { code: code2 } = await tab2.closed;
      expect(code1).toBe(WS_AUTH_REVOKED_CLOSE_CODE);
      expect(code2).toBe(WS_AUTH_REVOKED_CLOSE_CODE);

      // Wait for both server-side `close` handlers to drain.
      await waitFor(
        () => __getConnectionsForUserForTests(FIXTURE_USER_ID).length === 0,
        'both tabs drained from connectionsByUser',
      );

      // Per-user index pruned to zero.
      expect(__getConnectionsForUserForTests(FIXTURE_USER_ID)).toHaveLength(0);
      expect(__getConnectionsByUserSizeForTests()).toBe(0);
    } finally {
      tab1.ws.terminate();
      tab2.ws.terminate();
    }
  });
});
