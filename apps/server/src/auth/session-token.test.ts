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
//   `/auth/callback` integration:
//    23. Returning user (non-pending) → 302 + Set-Cookie session.
//    24. New user (pending) → 200 + Set-Cookie pending + needsScreenName.
//
//   `/auth/screen-name` integration:
//    25. Success → 200 + Set-Cookie pending-clear + Set-Cookie session.

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
  redirectUri: 'http://localhost:3000/auth/callback',
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
      url: '/auth/me',
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
    const response = await built.app.inject({ method: 'GET', url: '/auth/me' });
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
      url: '/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tampered}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the cookie carries an expired token', async () => {
    const token = await signSessionToken({ sub: userId }, TEST_SECRET, { now: () => 1_000 });
    const response = await built.app.inject({
      method: 'GET',
      url: '/auth/me',
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
      url: '/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the cookie carries a malformed string', async () => {
    const response = await built.app.inject({
      method: 'GET',
      url: '/auth/me',
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
    const response = await built.app.inject({ method: 'POST', url: '/auth/logout' });
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
      url: '/auth/logout',
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
      url: '/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage` },
    });
    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
    expect(setCookieStr).toMatch(/Max-Age=0/);
  });
});

// ============================================================
// /auth/callback — returning-user vs. new-user branches
// ============================================================

describe('GET /auth/callback', () => {
  it('redirects with the session cookie when the user is returning (non-pending)', async () => {
    // Seed a row already at a real screen name. The stubbed
    // authorizationCodeGrant returns sub=alice, so the namespaced
    // oauth_subject is `authelia:alice` — match that on the seed.
    const built = await buildApp({
      initialRows: [
        {
          id: '00000000-0000-4000-8000-000000000200',
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
        },
      ],
      authCodeGrantSub: 'alice',
    });
    try {
      await built.app.inject({ method: 'GET', url: '/auth/login' });
      const response = await built.app.inject({
        method: 'GET',
        url: '/auth/callback?code=AUTHCODE&state=state-1',
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

  it('returns 200 + pending cookie + needsScreenName flag when the user is new', async () => {
    // No seeded row — the upsert inserts fresh with `<pending>`.
    const built = await buildApp({ authCodeGrantSub: 'bob' });
    try {
      await built.app.inject({ method: 'GET', url: '/auth/login' });
      const response = await built.app.inject({
        method: 'GET',
        url: '/auth/callback?code=AUTHCODE&state=state-1',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{
        sub: string;
        oauthSubject: string;
        userId: string;
        needsScreenName: boolean;
      }>();
      expect(body.sub).toBe('bob');
      expect(body.oauthSubject).toBe('authelia:bob');
      expect(body.needsScreenName).toBe(true);
      // Set-Cookie carries the pending cookie; NO session cookie yet.
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
        url: '/auth/screen-name',
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
