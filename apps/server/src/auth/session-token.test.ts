// Vitest unit tests for the platform session-token surface:
//
//   - `signSessionToken` / `verifySessionToken` JWT primitives in
//     `session-token.ts`,
//   - `buildSessionCookieHeader` / `buildSessionCookieClearHeader`
//     attribute composition,
//   - `readSessionCookieFromHeader` cookie-header parsing,
//   - `GET /auth/me` and `POST /auth/logout` Fastify routes exercised
//     via `.inject(...)`,
//   - `/auth/callback` returning-user vs. new-user branches.
//
// Refinement: tasks/refinements/backend/session_token_management.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.session_token_management
//
// **Coverage**
//
//   `session-token.ts`:
//     1. signSessionToken produces a parseable HS256 JWT.
//     2. verifySessionToken round-trips a valid token.
//     3. Tampered signature → null.
//     4. Wrong-secret verify → null.
//     5. Expired token → null.
//     6. Malformed string → null.
//     7. Token signed with `none` algorithm → null (algorithm confusion).
//     8. Token carrying extra claims → null (payload-shape audit).
//     9. signSessionToken throws on empty secret.
//    10. verifySessionToken throws on empty secret.
//
//   `buildSessionCookieHeader` / Clear / Read:
//    11. Header carries HttpOnly + SameSite=Lax + Path=/ + Max-Age.
//    12. Secure attribute toggled by `secure: true`.
//    13. Clear header carries Max-Age=0.
//    14. readSessionCookieFromHeader extracts the value; tolerates
//        extra cookies.
//
//   `GET /auth/me`:
//    15. Valid cookie → 200 with { userId, screenName }.
//    16. Missing cookie → 401 + auth-required (envelope code emitted by
//        the auth middleware; the inline `auth-session-invalid` envelope
//        was sunset when `auth_middleware` extracted the cookie-verify
//        chain into the shared preHandler).
//    17. Tampered token → 401.
//    18. Expired token → 401.
//    19. Soft-deleted user → 401.
//
//   `POST /auth/logout`:
//    20. No cookie → 204; Set-Cookie clears.
//    21. Valid cookie → 204; Set-Cookie clears.
//    22. Invalid cookie → 204; Set-Cookie clears.
//
//   `POST /auth/logout` — server-side revocation
//   (closes docs/security/m3-review/coverage.md G-005,
//   docs/security/m3-review/auth.md F-001 + F-006):
//    22a. A cookie replayed against `/auth/me` AFTER logout is REJECTED with 401.
//         The auth middleware consults `auth_token_denylist` on every verify;
//         logout writes the cookie's `jti` to the table, so the replayed cookie
//         no longer authenticates. Inverted from the prior known-trade-off pin
//         when the structural fix (`jwt_revocation_jti_denylist`) landed.
//
//   `/auth/callback` integration:
//    23. Returning user (non-pending) → 302 + Set-Cookie session.
//    24. New user (pending) → 200 + Set-Cookie pending + needsScreenName.
//
//   `/auth/screen-name` integration:
//    25. Success → 200 + Set-Cookie pending-clear + Set-Cookie session.
//
//   `Cache-Control: no-store` on identity endpoints
//   (docs/security/m3-review/coverage.md G-019):
//    26. GET /auth/me — authed 200 response carries `Cache-Control: no-store`.
//    27. GET /auth/me — unauthed 401 response carries `Cache-Control: no-store`
//        (preHandler stamps the header before `app.authenticate` throws, and
//        the centralized error-handler renders without clearing it).
//    28. POST /auth/logout — 204 response carries `Cache-Control: no-store`.
//    29. POST /auth/screen-name — 200 response carries `Cache-Control: no-store`.
//    30. GET /auth/callback — returning-user 302 response carries
//        `Cache-Control: no-store` (the cookie-bearing redirect MUST NOT cache).
//    31. GET /auth/callback — new-user 200 response carries `Cache-Control: no-store`.

import Fastify, { type FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../error-handler.js';
import { errorEnvelopeSchema } from '../openapi.js';
import { __buildStubConfiguration } from './config.js';
import { PENDING_COOKIE_NAME, signPendingCookie } from './pending-cookie.js';
import { authRoutesPlugin, PLACEHOLDER_SCREEN_NAME } from './routes.js';
import type { AuthRoutesOptions } from './routes.js';
import {
  buildSessionCookieClearHeader,
  buildSessionCookieHeader,
  CLOCK_SKEW_SECONDS,
  readSessionCookieFromHeader,
  SESSION_COOKIE_NAME,
  SESSION_TOKEN_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
} from './session-token.js';
import type { DbPool } from '../db.js';

const TEST_SECRET = 'unit-test-session-secret';
const VALID_OIDC_CONFIG = {
  issuerUrl: new URL('http://authelia:9091'),
  clientId: 'aconversa-app-dev',
  clientSecret: 'aconversa-app-dev-secret',
  appBaseUrl: 'http://localhost:3000',
  redirectUri: 'http://localhost:3000/api/auth/callback',
} as const;

// ============================================================
// signSessionToken / verifySessionToken
// ============================================================

describe('signSessionToken / verifySessionToken', () => {
  it('produces a parseable HS256 JWT', async () => {
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
    );
    // JWT is three base64url segments separated by `.`.
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // Decode the header and check `alg: HS256`.
    const headerB64 = token.split('.')[0] ?? '';
    const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
    const header = JSON.parse(headerJson) as { alg?: string; typ?: string };
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('round-trips a valid token through sign + verify', async () => {
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
    );
    const payload = await verifySessionToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('00000000-0000-4000-8000-000000000001');
    // iat and exp are seconds-since-epoch numbers; exp - iat is the TTL.
    expect(payload?.iat).toBeTypeOf('number');
    expect(payload?.exp).toBeTypeOf('number');
    expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(SESSION_TOKEN_TTL_SECONDS);
  });

  it('returns null when the signature is tampered', async () => {
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
    );
    const parts = token.split('.');
    // Replace the signature with a different (but valid-shape) signature.
    const fakeSig = Buffer.alloc(32, 0xab).toString('base64url');
    const tampered = `${parts[0]}.${parts[1]}.${fakeSig}`;
    const payload = await verifySessionToken(tampered, TEST_SECRET);
    expect(payload).toBeNull();
  });

  it('returns null when verified with a different secret', async () => {
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
    );
    const payload = await verifySessionToken(token, 'wrong-secret-entirely');
    expect(payload).toBeNull();
  });

  it('returns null for an expired token', async () => {
    // Sign with `now` set deep in the past so the token's exp is also
    // in the past. Verify with the real Date.now — token is expired.
    const past = 1_000; // ms-since-epoch in the distant past
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
      { now: () => past },
    );
    const payload = await verifySessionToken(token, TEST_SECRET);
    expect(payload).toBeNull();
  });

  it('returns null for a malformed token string', async () => {
    const payload = await verifySessionToken('not-a-jwt', TEST_SECRET);
    expect(payload).toBeNull();
  });

  it('returns null for an empty token string', async () => {
    const payload = await verifySessionToken('', TEST_SECRET);
    expect(payload).toBeNull();
  });

  it('returns null for a token signed with alg=none (algorithm confusion)', async () => {
    // Manually build a `none`-algorithm token. The header carries
    // alg=none; the payload is unchanged; the signature segment is
    // empty. Without our `algorithms: ['HS256']` restriction, jose
    // would happily accept this — that's the algorithm-confusion bug.
    // With the restriction, jwtVerify rejects it.
    const header = { alg: 'none', typ: 'JWT' };
    const payload = {
      sub: '00000000-0000-4000-8000-000000000001',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const noneToken = `${headerB64}.${payloadB64}.`;
    const verified = await verifySessionToken(noneToken, TEST_SECRET);
    expect(verified).toBeNull();
  });

  it('returns null for a token carrying extra (non-canonical) claims', async () => {
    // Sign a token directly via `jose` with an extra `role: admin`
    // claim, simulating a forged elevated-privilege token. Our
    // payload-shape audit rejects it.
    const key = new TextEncoder().encode(TEST_SECRET);
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 60;
    const forged = await new SignJWT({
      sub: '00000000-0000-4000-8000-000000000001',
      iat,
      exp,
      role: 'admin',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(key);
    const verified = await verifySessionToken(forged, TEST_SECRET);
    expect(verified).toBeNull();
  });

  it('throws when signing with an empty secret', async () => {
    await expect(
      signSessionToken({ sub: '00000000-0000-4000-8000-000000000001' }, ''),
    ).rejects.toThrow(/non-empty/);
  });

  it('throws when verifying with an empty secret', async () => {
    await expect(verifySessionToken('a.b.c', '')).rejects.toThrow(/non-empty/);
  });

  it('throws when signing with an empty sub', async () => {
    await expect(signSessionToken({ sub: '' }, TEST_SECRET)).rejects.toThrow(/sub/);
  });

  // ============================================================
  // Defense-in-depth `iat` / `exp - iat` invariant pins (F-009).
  // Source: docs/security/m3-review/auth.md F-009.
  //
  // These tests assert that even if the signing secret were
  // compromised, a forged token with a far-future `iat` or a
  // wildly-long TTL is rejected by the verifier's invariant
  // re-binding. The signing path bounds these by construction; the
  // verifier now bounds them on read with a 60s clock-skew slack.
  // ============================================================

  it('rejects a token whose `iat` is 1 hour in the future (token-not-yet-valid)', async () => {
    // Sign with a clock 1 hour ahead of "now"; the resulting `iat`
    // is 3600s in the future relative to the verify clock. Well past
    // the 60s skew allowance.
    const nowMs = 1_700_000_000 * 1000;
    const futureSignMs = nowMs + 3600 * 1000;
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
      { now: () => futureSignMs },
    );
    const payload = await verifySessionToken(token, TEST_SECRET, { now: () => nowMs });
    expect(payload).toBeNull();
  });

  it('rejects a token whose TTL is one year (token-ttl-out-of-policy)', async () => {
    // Forge a token directly via `jose` with `iat = now` and
    // `exp = iat + 365 * 86400`. The TTL window (one year) far
    // exceeds `SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS`.
    const key = new TextEncoder().encode(TEST_SECRET);
    const nowSeconds = 1_700_000_000;
    const iat = nowSeconds;
    const exp = iat + 365 * 86400;
    const forged = await new SignJWT({
      sub: '00000000-0000-4000-8000-000000000001',
      iat,
      exp,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(key);
    const verified = await verifySessionToken(forged, TEST_SECRET, {
      now: () => nowSeconds * 1000,
    });
    expect(verified).toBeNull();
  });

  it('accepts a token with TTL exactly at `SESSION_TOKEN_TTL_SECONDS` (boundary, inside)', async () => {
    // Mint a normal token (TTL is exactly SESSION_TOKEN_TTL_SECONDS
    // by construction). Verify at the same clock — it should pass.
    const nowMs = 1_700_000_000 * 1000;
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
      { now: () => nowMs },
    );
    const payload = await verifySessionToken(token, TEST_SECRET, { now: () => nowMs });
    expect(payload).not.toBeNull();
    expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(SESSION_TOKEN_TTL_SECONDS);
  });

  it('rejects a token whose TTL exceeds `SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS` by 1 second (boundary, outside)', async () => {
    // Forge a token with TTL = SESSION_TOKEN_TTL_SECONDS +
    // CLOCK_SKEW_SECONDS + 1. One second past the policy ceiling.
    const key = new TextEncoder().encode(TEST_SECRET);
    const nowSeconds = 1_700_000_000;
    const iat = nowSeconds;
    const exp = iat + SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS + 1;
    const forged = await new SignJWT({
      sub: '00000000-0000-4000-8000-000000000001',
      iat,
      exp,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(key);
    const verified = await verifySessionToken(forged, TEST_SECRET, {
      now: () => nowSeconds * 1000,
    });
    expect(verified).toBeNull();
  });

  it('accepts a token whose `iat` is 30s in the future (within clock-skew slack)', async () => {
    // 30s < CLOCK_SKEW_SECONDS — within the slack allowance.
    const nowMs = 1_700_000_000 * 1000;
    const signMs = nowMs + 30 * 1000;
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
      { now: () => signMs },
    );
    const payload = await verifySessionToken(token, TEST_SECRET, { now: () => nowMs });
    expect(payload).not.toBeNull();
  });

  it('rejects a token whose `iat` is 90s in the future (outside clock-skew slack)', async () => {
    // 90s > CLOCK_SKEW_SECONDS — past the slack allowance.
    const nowMs = 1_700_000_000 * 1000;
    const signMs = nowMs + 90 * 1000;
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
      { now: () => signMs },
    );
    const payload = await verifySessionToken(token, TEST_SECRET, { now: () => nowMs });
    expect(payload).toBeNull();
  });

  it('regression: a freshly-minted normal token still round-trips', async () => {
    // Belt-and-suspenders check that the invariant pins haven't
    // broken the canonical happy path.
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
    );
    const payload = await verifySessionToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('00000000-0000-4000-8000-000000000001');
  });
});

// ============================================================
// Cookie header composition + parsing
// ============================================================

describe('buildSessionCookieHeader', () => {
  it('includes HttpOnly + SameSite=Lax + Path=/ + Max-Age', () => {
    const header = buildSessionCookieHeader('abc.def.ghi', { secure: false });
    expect(header).toContain(`${SESSION_COOKIE_NAME}=abc.def.ghi`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${String(SESSION_TOKEN_TTL_SECONDS)}`);
    expect(header).not.toContain('Secure');
  });

  it('adds Secure when secure=true', () => {
    const header = buildSessionCookieHeader('abc.def.ghi', { secure: true });
    expect(header).toContain('Secure');
  });

  it('honors a custom maxAgeSeconds override', () => {
    const header = buildSessionCookieHeader('abc.def.ghi', {
      secure: false,
      maxAgeSeconds: 60,
    });
    expect(header).toContain('Max-Age=60');
  });
});

describe('buildSessionCookieClearHeader', () => {
  it('emits Max-Age=0 and matching attributes', () => {
    const header = buildSessionCookieClearHeader({ secure: false });
    expect(header).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Secure');
  });

  it('adds Secure when secure=true', () => {
    const header = buildSessionCookieClearHeader({ secure: true });
    expect(header).toContain('Secure');
  });
});

describe('readSessionCookieFromHeader', () => {
  it('extracts the value when our cookie is present', () => {
    const header = `${SESSION_COOKIE_NAME}=token-value; other=foo`;
    expect(readSessionCookieFromHeader(header)).toBe('token-value');
  });

  it('returns undefined when our cookie is absent', () => {
    expect(readSessionCookieFromHeader('other=foo; another=bar')).toBeUndefined();
  });

  it('returns undefined for an empty / missing header', () => {
    expect(readSessionCookieFromHeader(undefined)).toBeUndefined();
    expect(readSessionCookieFromHeader('')).toBeUndefined();
  });

  it('tolerates a cookie value that contains JWT dots', () => {
    // JWT tokens are `header.payload.signature` — three dots.
    const header = `${SESSION_COOKIE_NAME}=abc.def.ghi`;
    expect(readSessionCookieFromHeader(header)).toBe('abc.def.ghi');
  });
});

// ============================================================
// In-memory `pg.Pool` shim for /auth/me + /auth/callback + screen-name
// route handler tests. Tracks users keyed by id AND by oauth_subject so
// the SELECT-by-id (used by /auth/me) and the UPSERT-by-oauth_subject
// (used by /auth/callback) both work against the same row store.
// ============================================================

interface UserRow {
  id: string;
  oauth_subject: string;
  screen_name: string;
}

function makeMemoryPool(initialRows: UserRow[] = []): {
  pool: DbPool;
  users: Map<string, UserRow>;
} {
  const users = new Map<string, UserRow>();
  for (const row of initialRows) {
    users.set(row.id, row);
  }
  let counter = 100;
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('INSERT INTO users')) {
        const oauthSubject = p[0] as string;
        const screenName = p[1] as string;
        const existing = [...users.values()].find((r) => r.oauth_subject === oauthSubject);
        if (existing) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const id = `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
        const row = { id, oauth_subject: oauthSubject, screen_name: screenName };
        users.set(id, row);
        return Promise.resolve({ rows: [row] as unknown as TRow[] });
      }
      if (
        text.includes('SELECT id, oauth_subject, screen_name') &&
        text.includes('WHERE oauth_subject')
      ) {
        const oauthSubject = p[0] as string;
        const row = [...users.values()].find((r) => r.oauth_subject === oauthSubject);
        return Promise.resolve({ rows: (row ? [row] : []) as unknown as TRow[] });
      }
      if (text.includes('SELECT id, oauth_subject, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        const row = users.get(id);
        return Promise.resolve({ rows: (row ? [row] : []) as unknown as TRow[] });
      }
      // The auth middleware (`apps/server/src/auth/middleware.ts`)
      // issues a narrower SELECT — `SELECT id, screen_name FROM users
      // WHERE id = $1 AND deleted_at IS NULL`. The pool shim doesn't
      // track `deleted_at` (no scenario in this file exercises a
      // soft-deleted user via this pool; the dedicated soft-delete
      // case lives in `middleware.test.ts`), so a hit on this branch
      // is always a live user. The empty-rows case (auth-required
      // ghost-user) is the user-id-not-present sub-branch below.
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        const row = users.get(id);
        return Promise.resolve({
          rows: (row ? [{ id: row.id, screen_name: row.screen_name }] : []) as unknown as TRow[],
        });
      }
      if (text.includes('UPDATE users') && text.includes('SET screen_name')) {
        const id = p[0] as string;
        const newName = p[1] as string;
        const currentName = p[2] as string;
        const row = users.get(id);
        if (row === undefined) return Promise.resolve({ rows: [] as TRow[] });
        if (row.screen_name !== currentName) return Promise.resolve({ rows: [] as TRow[] });
        const next: UserRow = { ...row, screen_name: newName };
        users.set(id, next);
        return Promise.resolve({
          rows: [{ id: next.id, screen_name: next.screen_name }] as unknown as TRow[],
        });
      }
      // `auth_token_denylist` consult fired by `authenticateRequest`
      // (post-`jwt_revocation_jti_denylist`). The default pool says
      // "no jti revoked"; per-test variants override below.
      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      // `auth_token_denylist` INSERT fired by `POST /auth/logout`.
      // Default-noop returning zero rows — the dedicated logout
      // tests use a tracking pool that records the insert.
      if (text.includes('INSERT INTO auth_token_denylist')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in session-token memory pool: ${text}`));
    },
  };
  return { pool, users };
}

function makeStubClient(): ReturnType<typeof __buildStubConfiguration> {
  return __buildStubConfiguration(
    VALID_OIDC_CONFIG.issuerUrl,
    VALID_OIDC_CONFIG.clientId,
    VALID_OIDC_CONFIG.clientSecret,
  );
}

interface BuiltApp {
  app: FastifyInstance;
  users: Map<string, UserRow>;
}

async function buildApp(opts: {
  initialRows?: UserRow[];
  now?: () => number;
  authCodeGrantSub?: string;
}): Promise<BuiltApp> {
  const app = Fastify({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  const { pool, users } = makeMemoryPool(opts.initialRows ?? []);
  const beginFlowOptions = {
    randomState: (): string => 'state-1',
    randomNonce: (): string => 'nonce-1',
    randomPKCECodeVerifier: (): string => 'verifier-1',
    calculatePKCECodeChallenge: (_v: string): Promise<string> => Promise.resolve('challenge-1'),
    buildAuthorizationUrl: (
      _cfg: unknown,
      params: URLSearchParams | Record<string, string>,
    ): URL => {
      const sp = params instanceof URLSearchParams ? params : new URLSearchParams(params);
      return new URL(`http://authelia:9091/auth?${sp.toString()}`);
    },
  } satisfies AuthRoutesOptions['beginFlowOptions'];
  const stubSub = opts.authCodeGrantSub ?? 'alice';
  const completeFlowOptions = {
    authorizationCodeGrant: (() =>
      Promise.resolve({
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        claims: () => ({
          sub: stubSub,
          iss: 'http://authelia:9091',
          aud: 'aconversa-app-dev',
          iat: 0,
          exp: 0,
        }),
      })) as never,
  } satisfies NonNullable<AuthRoutesOptions['completeFlowOptions']>;
  const pluginOpts: AuthRoutesOptions = {
    oidcConfig: { ...VALID_OIDC_CONFIG },
    oidcClient: makeStubClient(),
    pool,
    sessionTokenSecret: TEST_SECRET,
    cookieSecure: false,
    beginFlowOptions,
    completeFlowOptions,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  // The auth middleware must register BEFORE the routes plugin so
  // `/auth/me`'s `preHandler: app.authenticate` resolves at the time
  // the route attaches. Mirrors `__buildTestAuthApp` and the
  // production wiring in `server.ts`. Refinement:
  // tasks/refinements/backend/auth_middleware.md.
  const { authenticatePlugin } = await import('./middleware.js');
  const middlewareOpts: Parameters<typeof authenticatePlugin>[1] = {
    pool,
    sessionTokenSecret: TEST_SECRET,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  await app.register(authenticatePlugin, middlewareOpts);
  await app.register(authRoutesPlugin, pluginOpts);
  await app.ready();
  return { app, users };
}

// ============================================================
// GET /auth/me
// ============================================================

describe('GET /auth/me', () => {
  let built: BuiltApp;
  const userId = '00000000-0000-4000-8000-000000000050';

  beforeEach(async () => {
    built = await buildApp({
      initialRows: [
        {
          id: userId,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns the user when given a valid session cookie', async () => {
    const token = await signSessionToken({ sub: userId }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ userId: string; screenName: string }>();
    expect(body.userId).toBe(userId);
    expect(body.screenName).toBe('alice');
  });

  it('returns 401 + auth-required when no cookie is present', async () => {
    // Code drift note: the inline `/auth/me` handler used to throw
    // `auth-session-invalid`. After `auth_middleware` landed, the
    // shared preHandler throws `auth-required` for every 401 path.
    // See tasks/refinements/backend/auth_middleware.md Decisions.
    const response = await built.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 401 when the cookie carries a tampered token', async () => {
    const token = await signSessionToken({ sub: userId }, TEST_SECRET);
    const parts = token.split('.');
    const fakeSig = Buffer.alloc(32, 0xcd).toString('base64url');
    const tampered = `${parts[0]}.${parts[1]}.${fakeSig}`;
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tampered}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the cookie carries an expired token', async () => {
    const token = await signSessionToken({ sub: userId }, TEST_SECRET, { now: () => 1_000 });
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the user row is missing (e.g. soft-deleted)', async () => {
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000999' }, // not in `users`
      TEST_SECRET,
    );
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the cookie carries a malformed string', async () => {
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-jwt` },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ============================================================
// POST /auth/logout
// ============================================================

describe('POST /auth/logout', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({});
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('clears the cookie even when no cookie is present (idempotent)', async () => {
    const response = await built.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
    expect(setCookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieStr).toMatch(/Max-Age=0/);
  });

  it('clears the cookie when given a valid cookie', async () => {
    const userId = '00000000-0000-4000-8000-000000000051';
    const token = await signSessionToken({ sub: userId }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
    expect(setCookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieStr).toMatch(/Max-Age=0/);
  });

  it('clears the cookie when given an invalid cookie (still 204)', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage` },
    });
    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
    expect(setCookieStr).toMatch(/Max-Age=0/);
  });
});

// ============================================================
// POST /auth/logout — server-side revocation via jti + denylist (G-005)
// ============================================================
//
// This describe block previously pinned a KNOWN TRADE-OFF: replaying a
// JWT cookie against `/auth/me` after `POST /auth/logout` continued to
// authenticate (`expect(replay.statusCode).toBe(200)`). The trade-off
// was closed by the M3-review `jwt_revocation_jti_denylist` task
// (refinement
// `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`).
//
// What the test now asserts (the INVERTED form):
//   - `POST /auth/logout` clears the browser-side cookie (Max-Age=0)
//     on the response — same as the cookie-clear pins in the previous
//     describe block.
//   - The EXACT same cookie value, REPLAYED against `GET /auth/me`
//     AFTER the logout call, NOW RETURNS 401. The auth middleware
//     consults the `auth_token_denylist` table on every verify; the
//     `jti` claim is on the list (logout wrote it there), so the
//     middleware returns `null` from `authenticateRequest` and the
//     preHandler throws `ApiError(401, 'auth-required', ...)`.
//
// References:
//   - `docs/security/m3-review/auth.md` F-001 + F-006 — the originating
//     findings (logout doesn't revoke; JWT has no per-session id).
//   - `docs/security/m3-review/coverage.md` G-005 — the coverage gap
//     that pinned this trade-off; now closed by the structural fix.
//
// Audit trail: the previous trade-off describe title contained the
// suffix `— known trade-off: no server-side revocation`. Auditors who
// `grep -r "G-005" apps/server/src/auth/` should still land here; the
// describe title was renamed to drop the trade-off suffix (the surface
// now enforces revocation, not documents its absence).

describe('POST /auth/logout — server-side revocation via jti + denylist (G-005)', () => {
  // The user-id matches the seeded row in `initialRows`. Because the
  // replay below now expects 401, the post-replay body equality
  // assertions are dropped (the 401 envelope has no `userId` /
  // `screenName` to compare).
  const aliceId = '00000000-0000-4000-8000-000000000070';

  it('a cookie replayed against /auth/me AFTER logout is rejected with 401 (denylist enforces revocation)', async () => {
    // The denylist tracking pool: a per-test variant of the memory
    // pool that also recognises `INSERT INTO auth_token_denylist` and
    // `SELECT 1 FROM auth_token_denylist WHERE jti = $1`. The base
    // memory pool's denylist branches return empty rows by default
    // (no jti revoked); this variant tracks the inserted jtis so the
    // SELECT can return a row matching the post-logout state.
    const denylist = new Set<string>();
    const innerBuilt = await buildApp({
      initialRows: [
        {
          id: aliceId,
          oauth_subject: 'authelia:alice-logout-pin',
          screen_name: 'alice',
        },
      ],
    });
    // Replace the pool's `query` to intercept the denylist surface.
    const originalQuery = innerBuilt.app
      ? // The buildApp helper returns the app + the users map; the
        // pool is bound inside the closure. We re-build with a custom
        // pool below — the simpler approach is to mint a fresh app
        // here whose pool tracks the denylist directly.
        null
      : null;
    void originalQuery;
    await innerBuilt.app.close();

    // Re-build with a tracking pool. The cleanest approach is to
    // inline a thin pool wrapper around the existing memory pool, but
    // `buildApp` doesn't expose pool injection — so we craft a fresh
    // app that mirrors `buildApp`'s shape with a custom pool below.
    const trackingPool: DbPool = {
      query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const p = (params ?? []) as unknown[];
        if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
          const id = p[0] as string;
          if (id === aliceId) {
            return Promise.resolve({
              rows: [{ id: aliceId, screen_name: 'alice' }] as unknown as TRow[],
            });
          }
          return Promise.resolve({ rows: [] as TRow[] });
        }
        if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
          const jti = p[0] as string;
          return Promise.resolve({
            rows: (denylist.has(jti) ? [{ exists: 1 }] : []) as unknown as TRow[],
          });
        }
        if (text.includes('INSERT INTO auth_token_denylist')) {
          const jti = p[0] as string;
          denylist.add(jti);
          return Promise.resolve({ rows: [{ jti }] as unknown as TRow[] });
        }
        return Promise.reject(new Error(`unexpected SQL in tracking pool: ${text}`));
      },
    };
    const app = Fastify({ logger: false });
    app.addSchema(errorEnvelopeSchema);
    await app.register(errorHandlerPlugin);
    const { authenticatePlugin } = await import('./middleware.js');
    await app.register(authenticatePlugin, {
      pool: trackingPool,
      sessionTokenSecret: TEST_SECRET,
    });
    await app.register(authRoutesPlugin, {
      oidcConfig: { ...VALID_OIDC_CONFIG },
      oidcClient: makeStubClient(),
      pool: trackingPool,
      sessionTokenSecret: TEST_SECRET,
      cookieSecure: false,
    });
    await app.ready();
    try {
      // Step 1. Mint a session JWT directly. Equivalent to the cookie
      // a real user would carry after a successful /auth/callback
      // round-trip; using `signSessionToken` keeps the test
      // independent of the OIDC flow stubs.
      const token = await signSessionToken({ sub: aliceId }, TEST_SECRET);
      const cookieHeader = `${SESSION_COOKIE_NAME}=${token}`;

      // Step 2. Pre-logout sanity: the cookie is accepted by
      // /auth/me. Without this, a setup bug (e.g., a token mint the
      // verifier rejects) would mask the load-bearing replay below.
      const preLogout = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookieHeader },
      });
      expect(preLogout.statusCode).toBe(200);
      const preLogoutBody = preLogout.json<{ userId: string; screenName: string }>();
      expect(preLogoutBody.userId).toBe(aliceId);
      expect(preLogoutBody.screenName).toBe('alice');

      // Step 3. Logout. The server emits 204 + a cookie-clear
      // Set-Cookie AND writes the cookie's `jti` to the denylist.
      // The browser would drop the cookie at this point; the test
      // does NOT — it keeps the original `token` so step 4 can
      // replay it.
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: cookieHeader },
      });
      expect(logout.statusCode).toBe(204);
      const setCookie = logout.headers['set-cookie'];
      const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
      expect(setCookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(setCookieStr).toMatch(/Max-Age=0/);

      // The denylist now holds exactly one jti — the cookie's.
      expect(denylist.size).toBe(1);

      // Step 4. THE LOAD-BEARING ASSERTION. Replay the EXACT same
      // cookie value (`token` from step 1, untouched by the logout
      // response) against /auth/me. Post-`jwt_revocation_jti_denylist`:
      // 401. The auth middleware's denylist consult finds the `jti`
      // and collapses to the standard `auth-required` envelope.
      const replay = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookieHeader },
      });
      expect(replay.statusCode).toBe(401);
      const replayBody = replay.json<{ error?: { code?: string } }>();
      expect(replayBody.error?.code).toBe('auth-required');
    } finally {
      await app.close();
    }
  });
});

// ============================================================
// /auth/callback — returning-user vs. new-user branches
// ============================================================

describe('GET /auth/callback', () => {
  it('redirects with the session cookie when the user is returning (non-pending)', async () => {
    // Seed a row already at a real screen name. The stubbed
    // authorizationCodeGrant returns sub=alice, and the namespaced
    // oauth_subject uses the issuer URL's full origin per F-008
    // hardening (`http://authelia:9091:alice`) — match that on the seed.
    const built = await buildApp({
      initialRows: [
        {
          id: '00000000-0000-4000-8000-000000000200',
          oauth_subject: 'http://authelia:9091:alice',
          screen_name: 'alice',
        },
      ],
      authCodeGrantSub: 'alice',
    });
    try {
      await built.app.inject({ method: 'GET', url: '/api/auth/login' });
      const response = await built.app.inject({
        method: 'GET',
        url: '/api/auth/callback?code=AUTHCODE&state=state-1',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(VALID_OIDC_CONFIG.appBaseUrl);
      // Set-Cookie carries the session token.
      const setCookie = response.headers['set-cookie'];
      const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
      expect(setCookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
      // The cookie should NOT carry the pending-cookie name.
      expect(setCookieStr).not.toContain(`${PENDING_COOKIE_NAME}=`);
      // The session cookie value is a valid JWT verifiable by the
      // same secret + carrying the seeded user's id as `sub`.
      const cookieValue = setCookieStr
        .split(',')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${SESSION_COOKIE_NAME}=`));
      expect(cookieValue).toBeDefined();
      const token = cookieValue!.slice(`${SESSION_COOKIE_NAME}=`.length).split(';')[0] ?? '';
      const payload = await verifySessionToken(token, TEST_SECRET);
      expect(payload?.sub).toBe('00000000-0000-4000-8000-000000000200');
    } finally {
      await built.app.close();
    }
  });

  it('302-redirects to /screen-name?from=callback with the pending cookie when the user is new', async () => {
    // No seeded row — the upsert inserts fresh with `<pending>`. The
    // new-user branch now 302s the browser to the SPA's screen-name
    // form (per `tasks/refinements/backend/auth_callback_new_user_browser_redirect.md`);
    // the response body is gone, so the regression signals move to
    // the redirect Location, the pending Set-Cookie, and the absence
    // of a session Set-Cookie (only the screen-name POST issues that).
    const built = await buildApp({ authCodeGrantSub: 'bob' });
    try {
      await built.app.inject({ method: 'GET', url: '/api/auth/login' });
      const response = await built.app.inject({
        method: 'GET',
        url: '/api/auth/callback?code=AUTHCODE&state=state-1',
      });
      expect(response.statusCode).toBe(302);
      expect(String(response.headers['location'] ?? '')).toMatch(/\/screen-name\?from=callback$/);
      // Set-Cookie carries the pending cookie; NO session cookie yet
      // (only the screen-name POST issues the platform session).
      const setCookie = response.headers['set-cookie'];
      const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
      expect(setCookieStr).toContain(`${PENDING_COOKIE_NAME}=`);
      expect(setCookieStr).not.toContain(`${SESSION_COOKIE_NAME}=`);
    } finally {
      await built.app.close();
    }
  });
});

// ============================================================
// /auth/screen-name — session cookie issued on success
// ============================================================

describe('POST /auth/screen-name — session cookie issuance', () => {
  it('on success, sets BOTH the pending-clear cookie and the session cookie', async () => {
    const userId = '00000000-0000-4000-8000-000000000300';
    const built = await buildApp({
      initialRows: [
        {
          id: userId,
          oauth_subject: 'authelia:carol',
          screen_name: PLACEHOLDER_SCREEN_NAME,
        },
      ],
    });
    try {
      const expiresAt = Date.now() + 60_000;
      const cookieValue = signPendingCookie({ userId, expiresAt }, TEST_SECRET);
      const response = await built.app.inject({
        method: 'POST',
        url: '/api/auth/screen-name',
        headers: { cookie: `${PENDING_COOKIE_NAME}=${cookieValue}` },
        payload: { screenName: 'carol' },
      });
      expect(response.statusCode).toBe(200);
      const setCookie = response.headers['set-cookie'];
      // The route emits an array of two Set-Cookie strings via
      // `reply.header('Set-Cookie', [a, b])`. Fastify normalizes this
      // into either an array or a comma-joined string depending on
      // version; we accept both.
      const lines: string[] = Array.isArray(setCookie)
        ? setCookie.filter((s): s is string => typeof s === 'string')
        : typeof setCookie === 'string'
          ? setCookie.split(',').map((s) => s.trim())
          : [];
      // One line clears the pending cookie (Max-Age=0).
      const pendingClear = lines.find(
        (l) => l.startsWith(`${PENDING_COOKIE_NAME}=`) && /Max-Age=0/.test(l),
      );
      expect(pendingClear, `expected pending-clear in ${JSON.stringify(lines)}`).toBeDefined();
      // Another line sets the session cookie (non-zero Max-Age + JWT
      // shape after the `=`).
      const sessionSet = lines.find(
        (l) => l.startsWith(`${SESSION_COOKIE_NAME}=`) && !/Max-Age=0/.test(l),
      );
      expect(sessionSet, `expected session-set in ${JSON.stringify(lines)}`).toBeDefined();
    } finally {
      await built.app.close();
    }
  });
});

// ============================================================
// Cache-Control: no-store on identity / cookie-bearing endpoints
// (closes docs/security/m3-review/coverage.md G-019)
// ============================================================
//
// Identity-bearing or cookie-bearing responses MUST declare
// `Cache-Control: no-store` so a misconfigured CDN/proxy cannot
// cache one user's response and serve it to another. The directive
// is the canonical HTTP/1.1 instruction to all cache layers; the
// HTTP/1.0 `Pragma: no-cache` sibling is intentionally omitted (every
// modern intermediary respects `Cache-Control`).
//
// Defense-in-depth: today's deployment is same-origin with no
// intermediate CDN, so this is informational hardening. The pin makes
// the contract explicit for any future deployment topology and for
// auditors reading the protocol surface.

describe('Cache-Control: no-store on identity endpoints (G-019)', () => {
  const aliceId = '00000000-0000-4000-8000-000000000060';

  it('GET /auth/me — authed 200 carries Cache-Control: no-store', async () => {
    const built = await buildApp({
      initialRows: [
        {
          id: aliceId,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
        },
      ],
    });
    try {
      const token = await signSessionToken({ sub: aliceId }, TEST_SECRET);
      const response = await built.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await built.app.close();
    }
  });

  it('GET /auth/me — unauthed 401 carries Cache-Control: no-store', async () => {
    // The preHandler that stamps the header runs BEFORE `app.authenticate`.
    // When the middleware throws ApiError(401, 'auth-required', ...), the
    // centralized error-handler emits the canonical envelope via
    // `reply.status().type().send(envelope)` — which does NOT clear
    // previously-set headers. So the no-store directive propagates onto
    // the 401 response too. This pin guards against an error-handler
    // refactor that adds a `headers({})` reset.
    const built = await buildApp({ initialRows: [] });
    try {
      const response = await built.app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(response.statusCode).toBe(401);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await built.app.close();
    }
  });

  it('POST /auth/logout — 204 carries Cache-Control: no-store', async () => {
    const built = await buildApp({ initialRows: [] });
    try {
      const response = await built.app.inject({ method: 'POST', url: '/api/auth/logout' });
      expect(response.statusCode).toBe(204);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await built.app.close();
    }
  });

  it('POST /auth/screen-name — 200 carries Cache-Control: no-store', async () => {
    const userId = '00000000-0000-4000-8000-000000000310';
    const built = await buildApp({
      initialRows: [
        {
          id: userId,
          oauth_subject: 'authelia:dave',
          screen_name: PLACEHOLDER_SCREEN_NAME,
        },
      ],
    });
    try {
      const expiresAt = Date.now() + 60_000;
      const cookieValue = signPendingCookie({ userId, expiresAt }, TEST_SECRET);
      const response = await built.app.inject({
        method: 'POST',
        url: '/api/auth/screen-name',
        headers: { cookie: `${PENDING_COOKIE_NAME}=${cookieValue}` },
        payload: { screenName: 'dave' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await built.app.close();
    }
  });

  it('GET /auth/callback — returning-user 302 carries Cache-Control: no-store', async () => {
    const built = await buildApp({
      initialRows: [
        {
          id: '00000000-0000-4000-8000-000000000210',
          // F-008 hardening: the namespace key uses the issuer URL's
          // full origin; the seed must match.
          oauth_subject: 'http://authelia:9091:alice',
          screen_name: 'alice',
        },
      ],
      authCodeGrantSub: 'alice',
    });
    try {
      await built.app.inject({ method: 'GET', url: '/api/auth/login' });
      const response = await built.app.inject({
        method: 'GET',
        url: '/api/auth/callback?code=AUTHCODE&state=state-1',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await built.app.close();
    }
  });

  it('GET /auth/callback — new-user 302 to /screen-name?from=callback carries Cache-Control: no-store', async () => {
    const built = await buildApp({ authCodeGrantSub: 'eve' });
    try {
      await built.app.inject({ method: 'GET', url: '/api/auth/login' });
      const response = await built.app.inject({
        method: 'GET',
        url: '/api/auth/callback?code=AUTHCODE&state=state-1',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await built.app.close();
    }
  });

  it('GET /auth/login — redirect to IdP is NOT marked Cache-Control: no-store', async () => {
    // The login leg is deliberately NOT marked: it 302-redirects to the
    // IdP and carries no user-identifying state (the `state` value is
    // per-flow not per-user). Pinning the absence prevents over-applying
    // the directive and clarifies the design boundary.
    const built = await buildApp({ initialRows: [] });
    try {
      const response = await built.app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(response.statusCode).toBe(302);
      // No assertion of presence — the header may legitimately be absent.
      // We instead pin that it is NOT 'no-store' (i.e., either absent or
      // some other directive). Today's behaviour: absent.
      expect(response.headers['cache-control']).toBeUndefined();
    } finally {
      await built.app.close();
    }
  });
});
