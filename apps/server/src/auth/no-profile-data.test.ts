// Vitest lock-in tests for the no-OAuth-profile-data policy.
//
// Refinement: tasks/refinements/backend/no_profile_data_policy.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.no_profile_data_policy
//
// **What this file owns.** Per-invariant negative tests that fail if a
// future PR widens the OIDC scope, reads an extra id_token claim, adds
// a profile column to the `users` table, stuffs profile data into the
// platform session JWT, or imports openid-client's `fetchUserInfo`.
//
// The audit in the refinement document confirms the existing code is
// compliant; these tests prevent regression.
//
// **Why this is a separate file from `flow.test.ts` / `routes.test.ts` /
// `session-token.test.ts`.** The lock-in tests cut across modules — they
// re-assert pieces of the policy that are individually checked elsewhere
// (`flow.test.ts` pins `scope=openid`; `session-token.test.ts` pins the
// payload shape) but in a single no-profile-data narrative. A reader of
// `no-profile-data.test.ts` doesn't have to chase across files to see
// the full surface. ADR 0022's "the probe IS the test" applies: this
// file's six cases are the empirical answer to "does the implementation
// respect the no-profile-data rule today?", pinned forever.
//
// **No `vi.mock`.** Unlike `flow.test.ts`, this file builds a real
// `openid-client` `Configuration` via `__buildStubConfiguration` and
// injects per-call stubs via `AuthRoutesOptions.beginFlowOptions` /
// `completeFlowOptions`. The injection path is what production callers
// would use to widen scope; testing through it catches the right drift.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../error-handler.js';
import { errorEnvelopeSchema } from '../openapi.js';
import { __buildStubConfiguration } from './config.js';
import { authRoutesPlugin, createFlowStateStore } from './routes.js';
import type { AuthRoutesOptions } from './routes.js';
import type { DbPool } from '../db.js';
import { signSessionToken, verifySessionToken } from './session-token.js';

const VALID_OIDC_CONFIG = {
  issuerUrl: new URL('http://authelia:9091'),
  clientId: 'aconversa-app-dev',
  clientSecret: 'aconversa-app-dev-secret',
  appBaseUrl: 'http://localhost:3000',
  redirectUri: 'http://localhost:3000/api/auth/callback',
} as const;

// Profile-data values stuffed onto the stubbed id_token. Real upstream
// providers (Google, GitHub, GitLab) commonly emit these when the
// `profile` / `email` scopes are granted. The lock-in tests assert that
// NONE of these values reach the response body, the users row, or the
// session JWT.
const PROFILE_DATA_VALUES = {
  email: 'alice@example.com',
  name: 'Alice Liddell',
  picture: 'https://example.com/avatars/alice.png',
  preferred_username: 'alice.liddell',
  given_name: 'Alice',
  family_name: 'Liddell',
  locale: 'en-GB',
} as const;

function profileValuesArray(): readonly string[] {
  return Object.values(PROFILE_DATA_VALUES);
}

// Minimal in-process `pg.Pool` shim — same shape as the one in
// `routes.test.ts`. Captures every (text, params) pair so the audit
// can assert no profile value was ever passed as a query parameter.
interface CapturedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

function makeMemoryPool(): {
  pool: DbPool;
  users: Map<string, { id: string; oauth_subject: string; screen_name: string }>;
  queries: CapturedQuery[];
} {
  const users = new Map<string, { id: string; oauth_subject: string; screen_name: string }>();
  const queries: CapturedQuery[] = [];
  let counter = 1;
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      queries.push({ text, params: p });
      if (text.includes('INSERT INTO users')) {
        const oauthSubject = p[0] as string;
        const screenName = p[1] as string;
        if (users.has(oauthSubject)) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const id = `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
        const row = { id, oauth_subject: oauthSubject, screen_name: screenName };
        users.set(oauthSubject, row);
        return Promise.resolve({ rows: [row] as unknown as TRow[] });
      }
      if (text.includes('SELECT id, oauth_subject, screen_name')) {
        const oauthSubject = p[0] as string;
        const row = users.get(oauthSubject);
        return Promise.resolve({ rows: (row ? [row] : []) as unknown as TRow[] });
      }
      // `auth_token_denylist` surface (post-`jwt_revocation_jti_denylist`).
      // The no-profile-data audit tracks queries to prove no profile
      // data leaks; the denylist surface carries only `(jti, user_id,
      // expires_at)`, none of which is profile data. Default-noop.
      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      if (text.includes('INSERT INTO auth_token_denylist')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in memory pool: ${text}`));
    },
  };
  return { pool, users, queries };
}

// Build a stubbed `authorizationCodeGrant` whose returned id_token
// carries the `sub` claim PLUS the full set of profile claims listed
// above. Production code reads only `.sub`; the lock-in tests confirm
// none of the other claim values leak.
function makeStubAuthCodeGrantWithProfileClaims(sub: string): () => Promise<{
  access_token: string;
  token_type: string;
  claims: () => {
    sub: string;
    iss: string;
    aud: string;
    iat: number;
    exp: number;
    email: string;
    name: string;
    picture: string;
    preferred_username: string;
    given_name: string;
    family_name: string;
    locale: string;
  };
}> {
  return () =>
    Promise.resolve({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      claims: () => ({
        sub,
        iss: 'http://authelia:9091',
        aud: 'aconversa-app-dev',
        iat: 0,
        exp: 0,
        // Profile claims — must NOT appear in any downstream artifact.
        email: PROFILE_DATA_VALUES.email,
        name: PROFILE_DATA_VALUES.name,
        picture: PROFILE_DATA_VALUES.picture,
        preferred_username: PROFILE_DATA_VALUES.preferred_username,
        given_name: PROFILE_DATA_VALUES.given_name,
        family_name: PROFILE_DATA_VALUES.family_name,
        locale: PROFILE_DATA_VALUES.locale,
      }),
    });
}

interface TestApp {
  app: FastifyInstance;
  flowState: ReturnType<typeof createFlowStateStore>;
  users: ReturnType<typeof makeMemoryPool>['users'];
  queries: CapturedQuery[];
  capturedAuthUrlParams: Record<string, string> | undefined;
}

/**
 * Build a Fastify auth-app stack with the profile-claim-bearing token
 * exchange stub. `capturedAuthUrlParams` is mutated as a side effect of
 * `beginAuthFlow` so the test can read back the exact params passed to
 * `buildAuthorizationUrl`.
 */
async function buildAuthApp(): Promise<TestApp> {
  const app = Fastify({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  const flowState = createFlowStateStore({ ttlMs: 60_000 });
  const { pool, users, queries } = makeMemoryPool();

  let capturedAuthUrlParams: Record<string, string> | undefined;
  const beginFlowOptions = {
    randomState: (): string => 'state-1',
    randomNonce: (): string => 'nonce-1',
    randomPKCECodeVerifier: (): string => 'verifier-1',
    calculatePKCECodeChallenge: (_v: string): Promise<string> => Promise.resolve('challenge-1'),
    buildAuthorizationUrl: (
      _cfg: unknown,
      params: URLSearchParams | Record<string, string>,
    ): URL => {
      const obj =
        params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : { ...params };
      capturedAuthUrlParams = obj;
      const sp = new URLSearchParams(obj);
      return new URL(`http://authelia:9091/auth?${sp.toString()}`);
    },
  } satisfies AuthRoutesOptions['beginFlowOptions'];

  const completeFlowOptions = {
    authorizationCodeGrant: makeStubAuthCodeGrantWithProfileClaims('alice') as never,
  } satisfies NonNullable<AuthRoutesOptions['completeFlowOptions']>;

  await app.register(authRoutesPlugin, {
    oidcConfig: { ...VALID_OIDC_CONFIG },
    oidcClient: __buildStubConfiguration(
      VALID_OIDC_CONFIG.issuerUrl,
      VALID_OIDC_CONFIG.clientId,
      VALID_OIDC_CONFIG.clientSecret,
    ),
    flowState,
    pool,
    beginFlowOptions,
    completeFlowOptions,
    sessionTokenSecret: 'test-session-secret',
    cookieSecure: false,
  });
  await app.ready();
  const result: TestApp = {
    app,
    flowState,
    users,
    queries,
    capturedAuthUrlParams,
  };
  // The `capturedAuthUrlParams` field is overwritten lazily by the
  // login handler; we return the bag holding a live reference via a
  // getter so reads after `inject('/auth/login')` see the latest value.
  Object.defineProperty(result, 'capturedAuthUrlParams', {
    get: () => capturedAuthUrlParams,
    enumerable: true,
  });
  return result;
}

// ============================================================
// Invariant 1 — OIDC scope is exactly `openid`
// ============================================================

describe('Invariant 1: OIDC scope is exactly "openid"', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await buildAuthApp();
  });
  afterEach(async () => {
    await test.app.close();
  });

  it('GET /auth/login builds an authorization URL with scope=openid (no profile/email)', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(response.statusCode).toBe(302);
    const params = test.capturedAuthUrlParams;
    expect(params).toBeDefined();
    // The scope MUST be exactly the literal string `openid`. Any
    // widening (`openid profile`, `openid email`, etc.) trips this
    // assertion. The negative checks below are belt-and-suspenders.
    expect(params?.['scope']).toBe('openid');
    expect(params?.['scope']).not.toContain('profile');
    expect(params?.['scope']).not.toContain('email');
    expect(params?.['scope']).not.toContain('offline_access');
    expect(params?.['scope']).not.toContain('address');
    expect(params?.['scope']).not.toContain('phone');
  });
});

// ============================================================
// Invariant 2 — id_token claims are read for only `.sub`
// ============================================================

describe('Invariant 2: id_token claims are read for only .sub', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await buildAuthApp();
  });
  afterEach(async () => {
    await test.app.close();
  });

  it('the callback response body contains none of the profile claim values', async () => {
    // Drive a complete flow: login captures state; callback exchanges
    // the (stubbed) code for a token whose id_token carries every
    // profile claim listed in PROFILE_DATA_VALUES.
    await test.app.inject({ method: 'GET', url: '/api/auth/login' });
    const response = await test.app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=AUTHCODE&state=state-1',
    });
    expect(response.statusCode).toBe(200);

    // The raw response body string must contain NONE of the profile
    // values. A substring search is the right granularity — any
    // accidental claim echo (e.g., into an error message) trips this.
    const bodyText = response.body;
    for (const value of profileValuesArray()) {
      expect(bodyText).not.toContain(value);
    }

    // The structured body must be exactly the documented shape:
    // `{ sub, oauthSubject, userId, needsScreenName }`. Any extra
    // field forwarded from the claims is a violation.
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['needsScreenName', 'oauthSubject', 'sub', 'userId'].sort(),
    );
    expect(parsed['sub']).toBe('alice');
    // Namespace key uses the issuer's full origin per F-008 hardening
    // (docs/security/m3-review/auth.md).
    expect(parsed['oauthSubject']).toBe('http://authelia:9091:alice');
    expect(parsed['needsScreenName']).toBe(true);
  });

  it('no profile claim value is passed as a parameter to any DB query', async () => {
    await test.app.inject({ method: 'GET', url: '/api/auth/login' });
    const response = await test.app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=AUTHCODE&state=state-1',
    });
    expect(response.statusCode).toBe(200);
    // The INSERT carries (oauth_subject, screen_name); neither value
    // is sourced from a profile claim. The follow-up SELECT (if it
    // fires on the ON CONFLICT branch) carries (oauth_subject). Audit:
    // every captured parameter is checked against the profile-value
    // blocklist.
    for (const { params } of test.queries) {
      for (const p of params) {
        if (typeof p === 'string') {
          for (const forbidden of profileValuesArray()) {
            expect(p).not.toContain(forbidden);
          }
        }
      }
    }
    // And the inserted users row: oauth_subject is the full-origin
    // namespaced key (F-008 hardening); screen_name is the placeholder.
    // Neither carries any profile data.
    const row = Array.from(test.users.values())[0];
    expect(row).toBeDefined();
    expect(row?.oauth_subject).toBe('http://authelia:9091:alice');
    expect(row?.screen_name).toBe('<pending>');
    for (const value of profileValuesArray()) {
      expect(row?.oauth_subject).not.toContain(value);
      expect(row?.screen_name).not.toContain(value);
    }
  });
});

// ============================================================
// Invariant 3 — the userinfo endpoint is never called
// ============================================================

describe('Invariant 3: the OIDC userinfo endpoint is never called', () => {
  it('no auth source file imports or references openid-client fetchUserInfo', async () => {
    // The audit is a string check over the auth source files. The
    // userinfo helper in openid-client v6 is `fetchUserInfo`; a grep
    // for the symbol catches both `import { fetchUserInfo }` and any
    // dynamic reference. We also widen to `userinfo_endpoint`-style
    // strings just in case a future change reaches for the metadata
    // field directly.
    const here = fileURLToPath(import.meta.url);
    const authDir = resolve(here, '..');
    const sources = [
      'config.ts',
      'flow.ts',
      'flow-state.ts',
      'index.ts',
      'middleware.ts',
      'pending-cookie.ts',
      'routes.ts',
      'session-token.ts',
    ];
    for (const filename of sources) {
      const path = resolve(authDir, filename);
      const text = await readFile(path, 'utf8');
      // The "userinfo" string appears nowhere in the production
      // source. (Tests/comments mentioning the policy live in
      // separate files and are excluded from this audit.)
      expect(text, `${filename} must not reference fetchUserInfo`).not.toContain('fetchUserInfo');
      expect(text, `${filename} must not reference an OIDC userinfo endpoint`).not.toMatch(
        /userinfo_endpoint|userInfo|UserInfo/,
      );
    }
  });
});

// ============================================================
// Invariant 4 — `users` table schema has no profile columns
// ============================================================

describe('Invariant 4: users migration carries no profile-data columns', () => {
  it('apps/server/migrations/0001_users.sql contains none of the forbidden column names', async () => {
    const here = fileURLToPath(import.meta.url);
    // The auth source lives at apps/server/src/auth; the migration at
    // apps/server/migrations. Resolve relative.
    const migrationPath = resolve(here, '..', '..', '..', 'migrations', '0001_users.sql');
    const sql = await readFile(migrationPath, 'utf8');

    // Two-tier check:
    //   1. The known-good columns ARE present (a guard against a
    //      future PR that nukes the migration; we wouldn't catch the
    //      removal otherwise).
    //   2. None of the forbidden profile columns appear.
    expect(sql).toMatch(/\bid\b/);
    expect(sql).toMatch(/\boauth_subject\b/);
    expect(sql).toMatch(/\bscreen_name\b/);
    expect(sql).toMatch(/\bcreated_at\b/);
    expect(sql).toMatch(/\bdeleted_at\b/);

    // Forbidden column-name patterns. The regex is word-bounded on
    // each side so an inline comment mentioning the rule doesn't
    // trip the audit; only an actual column declaration would.
    const forbidden = [
      /\bemail\b/i,
      /\bgiven_name\b/i,
      /\bfamily_name\b/i,
      /\bpicture\b/i,
      /\blocale\b/i,
      /\bpreferred_username\b/i,
      /\bfull_name\b/i,
      /\bavatar(_url)?\b/i,
    ];
    for (const pattern of forbidden) {
      expect(sql, `users migration must not contain ${pattern.source}`).not.toMatch(pattern);
    }
  });
});

// ============================================================
// Invariant 5 — session JWT carries only { sub, iat, exp, jti }
// ============================================================
//
// After the M3-review `jwt_revocation_jti_denylist` task landed, the
// JWT payload carries a fourth claim: `jti`, a v4 UUID minted by the
// signer and consulted against `auth_token_denylist` on every verify.
// `jti` is a CRYPTOGRAPHIC IDENTIFIER, NOT profile data — it carries
// no OIDC claim value, no screen name, no email. The no-profile-data
// invariant still holds: the JWT payload remains profile-free.

describe('Invariant 5: session JWT payload is exactly { sub, iat, exp, jti }', () => {
  const TEST_SECRET = 'test-session-secret-for-jwt-shape-audit';

  it('signSessionToken produces a JWT whose payload has exactly four claim keys (sub, iat, exp, jti)', async () => {
    const token = await signSessionToken(
      { sub: '00000000-0000-4000-8000-000000000001' },
      TEST_SECRET,
    );
    // The token is the compact `header.payload.signature` form.
    // Decode the middle segment and inspect the keys directly.
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const payloadJson = Buffer.from(parts[1] as string, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    // Exactly four keys, sorted. Any extra key (a `screen_name`, a
    // `role`, an `email`) fails this assertion immediately. `jti` is
    // an internal cryptographic identifier — its presence does NOT
    // weaken the no-profile-data invariant.
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'jti', 'sub']);
    expect(typeof payload['sub']).toBe('string');
    expect(typeof payload['iat']).toBe('number');
    expect(typeof payload['exp']).toBe('number');
    expect(typeof payload['jti']).toBe('string');
    // The `jti` is a v4 UUID: 8-4-4-4-12 hex with the version-4
    // digit. Pin the shape so an accidental swap to a profile-derived
    // value (e.g. the screen name) is caught here.
    expect(payload['jti']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Cross-reference: verifySessionToken on the same token returns
    // the same shape (the existing session-token.test.ts pins this
    // independently; we re-assert in the no-profile-data narrative).
    const verified = await verifySessionToken(token, TEST_SECRET);
    expect(verified).not.toBeNull();
    expect(Object.keys(verified ?? {}).sort()).toEqual(['exp', 'iat', 'jti', 'sub']);
  });
});

// ============================================================
// Invariant 6 (adjacent) — response body / surface audit
// ============================================================

describe('Invariant 6 (adjacent): no profile claim value appears in any inspectable response surface', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await buildAuthApp();
  });
  afterEach(async () => {
    await test.app.close();
  });

  it('login redirect, callback response, and response headers carry no profile-claim values', async () => {
    const loginRes = await test.app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(loginRes.statusCode).toBe(302);
    // The login redirect's Location header carries the authorization
    // URL — built from state/nonce/PKCE only. None of the profile
    // values can possibly appear here (they live on the id_token
    // returned by the future token-exchange), but assert defensively.
    const loc = String(loginRes.headers['location']);
    for (const value of profileValuesArray()) {
      expect(loc).not.toContain(value);
    }

    const cbRes = await test.app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=AUTHCODE&state=state-1',
    });
    expect(cbRes.statusCode).toBe(200);

    // Body audit (already covered above; re-asserted here in the
    // surface-wide context).
    for (const value of profileValuesArray()) {
      expect(cbRes.body).not.toContain(value);
    }

    // Header audit: Set-Cookie, content-type, etc. None of these
    // should carry profile data either. Stringify the headers object
    // and scan.
    const headerText = JSON.stringify(cbRes.headers);
    for (const value of profileValuesArray()) {
      expect(headerText).not.toContain(value);
    }
  });
});
