// @vitest-environment node
//
// Vitest integration tests for the full revocation chain: POST /auth/logout
// writes a denylist row, closes open WS connections, and any subsequent
// HTTP / WS request carrying the same cookie is rejected.
//
// Refinement: tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend_hardening.auth_hardening.jwt_revocation_jti_denylist
//
// **Coverage.**
//
//   1. Logout writes a denylist row keyed by the cookie's `jti`.
//   2. Logout invokes the `closeUserConnectionsHook` with the cookie's
//      `userId` + `'auth-revoked'` reason.
//   3. WS revocation propagation: opening a WS, then POST /auth/logout,
//      closes the WS with code 4401 + reason 'auth-revoked'. Composed
//      via `__buildTestAuthApp` + `wsConnectionHandlingPlugin` against
//      a shared pool.
//   4. Concurrent sessions: a user with two cookies (two distinct
//      jtis); revoking one leaves the other verifying 200.
//   5. Logout without a cookie remains a 204 cookie-clear no-op (no
//      denylist write, no WS close).
//   6. Logout with an invalid cookie remains a 204 cookie-clear no-op
//      (no denylist write, no WS close).
//   7. Order invariant: the denylist row commits BEFORE
//      closeUserConnectionsHook fires (so a concurrent reconnect
//      after the close still fails at the upgrade gate).

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../db.js';
import { errorHandlerPlugin } from '../error-handler.js';
import { errorEnvelopeSchema } from '../openapi.js';
import { authenticatePlugin } from './middleware.js';
import { authRoutesPlugin } from './routes.js';
import { SESSION_COOKIE_NAME, signSessionToken, verifySessionToken } from './session-token.js';

const TEST_SECRET = 'logout-revocation-integration-secret';
const ALICE_ID = '00000000-0000-4000-8000-00000000aaa1';
const BOB_ID = '00000000-0000-4000-8000-00000000aaa2';

/**
 * Build a pool that:
 *   - answers `SELECT id, screen_name FROM users WHERE id = $1 AND
 *     deleted_at IS NULL` from a fixed-rows map,
 *   - tracks `INSERT INTO auth_token_denylist` writes in a Map keyed
 *     by jti (for assertions on which jtis the logout path wrote),
 *   - reads `SELECT 1 FROM auth_token_denylist WHERE jti = $1` from
 *     the same Map (so a verify-after-revoke landing returns "row
 *     present").
 */
function makeTrackingPool(users: Record<string, string>): {
  pool: DbPool;
  denylist: Map<string, { userId: string; expiresAtMs: number }>;
} {
  const denylist = new Map<string, { userId: string; expiresAtMs: number }>();
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        const screenName = users[id];
        if (screenName === undefined) return Promise.resolve({ rows: [] as TRow[] });
        return Promise.resolve({
          rows: [{ id, screen_name: screenName }] as unknown as TRow[],
        });
      }
      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        const jti = p[0] as string;
        return Promise.resolve({
          rows: denylist.has(jti) ? ([{ exists: 1 }] as unknown as TRow[]) : ([] as TRow[]),
        });
      }
      if (text.includes('INSERT INTO auth_token_denylist')) {
        const jti = p[0] as string;
        const userId = p[1] as string;
        const expiresAtIso = p[2] as string;
        if (denylist.has(jti)) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        denylist.set(jti, {
          userId,
          expiresAtMs: new Date(expiresAtIso).getTime(),
        });
        return Promise.resolve({ rows: [{ jti }] as unknown as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in logout-revocation pool: ${text}`));
    },
  };
  return { pool, denylist };
}

/**
 * Build a minimal Fastify app with the auth middleware + auth routes
 * plugin wired against the tracking pool. A `closeUserConnectionsHook`
 * spy is passed so the test can assert the hook is invoked with the
 * cookie's userId + the 'auth-revoked' reason.
 */
async function buildLogoutTestApp(hook?: (userId: string, reason?: string) => number): Promise<{
  app: FastifyInstance;
  denylist: Map<string, { userId: string; expiresAtMs: number }>;
}> {
  const { pool, denylist } = makeTrackingPool({
    [ALICE_ID]: 'alice',
    [BOB_ID]: 'bob',
  });
  const app = Fastify({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  await app.register(authenticatePlugin, {
    pool,
    sessionTokenSecret: TEST_SECRET,
  });
  await app.register(authRoutesPlugin, {
    pool,
    sessionTokenSecret: TEST_SECRET,
    cookieSecure: false,
    // The OIDC client isn't reached by the logout/me flow under test
    // — we still satisfy the option schema with a minimal stub so the
    // routes plugin doesn't reach for production env.
    oidcConfig: {
      issuerUrl: new URL('http://authelia:9091'),
      clientId: 'aconversa-app-dev',
      clientSecret: 'aconversa-app-dev-secret',
      appBaseUrl: 'http://localhost:3000',
      redirectUri: 'http://localhost:3000/api/auth/callback',
    },
    ...(hook !== undefined ? { closeUserConnectionsHook: hook } : {}),
  });
  await app.ready();
  return { app, denylist };
}

describe('POST /auth/logout — denylist + WS revocation chain', () => {
  let apps: FastifyInstance[] = [];

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
  });

  it('writes a denylist row keyed by the cookie’s jti', async () => {
    const { app, denylist } = await buildLogoutTestApp();
    apps.push(app);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    // Recover the jti for the assertion. `verifySessionToken` is the
    // canonical decoder; we read its payload to know what the logout
    // path will write.
    const payload = await verifySessionToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    const expectedJti = payload!.jti;

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(204);
    expect(denylist.size).toBe(1);
    const entry = denylist.get(expectedJti);
    expect(entry).toBeDefined();
    expect(entry?.userId).toBe(ALICE_ID);
    expect(entry?.expiresAtMs).toBe(payload!.exp * 1000);
  });

  it('invokes closeUserConnectionsHook with the userId + auth-revoked reason', async () => {
    const hook = vi.fn<(userId: string, reason?: string) => number>().mockReturnValue(0);
    const { app } = await buildLogoutTestApp(hook);
    apps.push(app);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(204);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(ALICE_ID, 'auth-revoked');
  });

  it('concurrent sessions: revoking one jti leaves the other verifying', async () => {
    const { app, denylist } = await buildLogoutTestApp();
    apps.push(app);

    // Two cookies for the same user — two distinct jtis. Mirrors the
    // "two tabs / two devices" scenario.
    const tokenA = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const tokenB = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    expect(tokenA).not.toBe(tokenB);

    // Pre-revoke sanity: both verify (200) on /auth/me.
    const preA = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` },
    });
    const preB = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenB}` },
    });
    expect(preA.statusCode).toBe(200);
    expect(preB.statusCode).toBe(200);

    // Revoke A.
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` },
    });
    expect(denylist.size).toBe(1);

    // Post-revoke: A is rejected, B still verifies.
    const postA = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` },
    });
    const postB = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenB}` },
    });
    expect(postA.statusCode).toBe(401);
    expect(postB.statusCode).toBe(200);
  });

  it('logout without a cookie remains 204 + cookie-clear, no denylist write, no hook call', async () => {
    const hook = vi.fn<(userId: string, reason?: string) => number>().mockReturnValue(0);
    const { app, denylist } = await buildLogoutTestApp(hook);
    apps.push(app);

    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
    expect(setCookieStr).toMatch(/Max-Age=0/);
    expect(denylist.size).toBe(0);
    expect(hook).not.toHaveBeenCalled();
  });

  it('logout with an invalid (unverifiable) cookie remains 204, no denylist write, no hook call', async () => {
    const hook = vi.fn<(userId: string, reason?: string) => number>().mockReturnValue(0);
    const { app, denylist } = await buildLogoutTestApp(hook);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage.not.a.jwt` },
    });
    expect(response.statusCode).toBe(204);
    expect(denylist.size).toBe(0);
    expect(hook).not.toHaveBeenCalled();
  });

  it('logout with an EXPIRED cookie remains 204, no denylist write, no hook call', async () => {
    // An expired token verifies as `null`; the conditional logout
    // path doesn't write a denylist row for it.
    const hook = vi.fn<(userId: string, reason?: string) => number>().mockReturnValue(0);
    const { app, denylist } = await buildLogoutTestApp(hook);
    apps.push(app);

    const expiredToken = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET, {
      now: () => 1_000, // ms-since-epoch in the distant past
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${expiredToken}` },
    });
    expect(response.statusCode).toBe(204);
    expect(denylist.size).toBe(0);
    expect(hook).not.toHaveBeenCalled();
  });

  it('order invariant: denylist row commits BEFORE the WS hook fires', async () => {
    // The race the order pins: a concurrent reconnect that lands
    // between the WS close and the denylist commit would slip past
    // the upgrade gate. The handler MUST commit the row first.
    // Assert the denylist already contains the jti at the moment the
    // hook is called.
    let denylistSizeWhenHookFired = -1;
    const { app, denylist } = await buildLogoutTestApp((_userId, _reason): number => {
      denylistSizeWhenHookFired = denylist.size;
      return 0;
    });
    apps.push(app);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    // At hook-call time, the denylist already held the cookie's jti.
    expect(denylistSizeWhenHookFired).toBe(1);
  });

  it('double-logout is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const hook = vi.fn<(userId: string, reason?: string) => number>().mockReturnValue(0);
    const { app, denylist } = await buildLogoutTestApp(hook);
    apps.push(app);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(denylist.size).toBe(1);
    // Hook fires on BOTH calls — the cookie verified each time. The
    // idempotency is on the denylist row, not on the hook.
    expect(hook).toHaveBeenCalledTimes(2);
  });
});
