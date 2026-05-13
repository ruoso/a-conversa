// Vitest unit tests for `apps/server/src/auth/routes.ts`.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.oauth_callback_handler
//
// **Coverage**
//
//   GET /auth/login:
//     1. Returns 302 with a Location header pointing at the stubbed
//        authorization URL (built via openid-client mocks).
//     2. Persists the flow state under the generated `state` value.
//     3. The Location URL carries the expected query params.
//
//   GET /auth/callback:
//     4. With no `state` query param, returns 400 + the canonical
//        envelope under code `auth-state-invalid`.
//     5. With a `state` that doesn't match any stored entry, returns 400.
//     6. With a matching `state`, exchanges the code via the stubbed
//        `authorizationCodeGrant`, upserts the user, and returns 200
//        `{ sub, oauthSubject, userId }`.
//     7. A second callback with the same state (after take()) returns 400.
//
// Tests use Fastify's built-in `.inject(...)` — no port bind. The
// `Configuration` is a `__buildStubConfiguration` instance; the
// `authorizationCodeGrant` primitive is injected via the plugin's
// `completeFlowOptions`. The `pool` is a Map-backed shim — no real
// DB.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../error-handler.js';
import { errorEnvelopeSchema } from '../openapi.js';
import { __buildStubConfiguration } from './config.js';
import { authRoutesPlugin, createFlowStateStore, namespacedOauthSubject } from './routes.js';
import type { AuthRoutesOptions } from './routes.js';
import type { DbPool } from '../db.js';

// Minimal Map-backed `pg.Pool` shim. Stores rows in-process. Supports
// the two queries the route plugin issues: the INSERT...ON CONFLICT
// and the follow-up SELECT.
function makeMemoryPool(): {
  pool: DbPool;
  users: Map<string, { id: string; oauth_subject: string; screen_name: string }>;
} {
  const users = new Map<string, { id: string; oauth_subject: string; screen_name: string }>();
  let counter = 1;
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('INSERT INTO users')) {
        const oauthSubject = p[0] as string;
        const screenName = p[1] as string;
        if (users.has(oauthSubject)) {
          // ON CONFLICT DO NOTHING — RETURNING is empty.
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
      return Promise.reject(new Error(`unexpected SQL in memory pool: ${text}`));
    },
  };
  return { pool, users };
}

const VALID_OIDC_CONFIG = {
  issuerUrl: new URL('http://authelia:9091'),
  clientId: 'aconversa-app-dev',
  clientSecret: 'aconversa-app-dev-secret',
  appBaseUrl: 'http://localhost:3000',
  redirectUri: 'http://localhost:3000/auth/callback',
} as const;

function makeStubClient(): ReturnType<typeof __buildStubConfiguration> {
  return __buildStubConfiguration(
    VALID_OIDC_CONFIG.issuerUrl,
    VALID_OIDC_CONFIG.clientId,
    VALID_OIDC_CONFIG.clientSecret,
  );
}

interface TestApp {
  app: FastifyInstance;
  flowState: ReturnType<typeof createFlowStateStore>;
  users: ReturnType<typeof makeMemoryPool>['users'];
}

async function buildApp(
  stubAuthCodeGrant: (sub: string) => () => Promise<unknown>,
): Promise<TestApp> {
  const app = Fastify({ logger: false });
  // Register the shared error-envelope schema first so the route
  // plugin's `errorEnvelopeRef: '$ref: ErrorEnvelope#'` resolves at
  // handler-attach time. In production this is done by the openapi
  // plugin; per-test we register the schema directly.
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  const flowState = createFlowStateStore({ ttlMs: 60_000 });
  const { pool, users } = makeMemoryPool();
  // Deterministic random for predictable URL/state inspection.
  let stateSeq = 0;
  const beginFlowOptions = {
    randomState: (): string => {
      stateSeq += 1;
      return `state-${String(stateSeq)}`;
    },
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
  // The `(sub: string) => () => Promise<unknown>` shape lets a
  // single test pick which `sub` the authorizationCodeGrant
  // mock returns; the outer call closes over the test-specific
  // claim shape. The cast is necessary because the production
  // `authorizationCodeGrant` signature returns a
  // `TokenEndpointResponse & TokenEndpointResponseHelpers` and the
  // stub only fulfills the subset we read (`.claims().sub`).
  // The production `authorizationCodeGrant` signature is the full
  // openid-client overload; the stub only fulfills the subset we
  // read (`.claims().sub`). We narrow through `unknown` and pin
  // the carrier type so it satisfies `AuthRoutesOptions` under
  // `exactOptionalPropertyTypes`.
  const completeFlowOptions = {
    authorizationCodeGrant: stubAuthCodeGrant('alice') as never,
  } satisfies NonNullable<AuthRoutesOptions['completeFlowOptions']>;
  await app.register(authRoutesPlugin, {
    oidcConfig: { ...VALID_OIDC_CONFIG },
    oidcClient: makeStubClient(),
    flowState,
    pool,
    beginFlowOptions,
    completeFlowOptions,
    // Pin the pending-cookie HMAC secret so the callback can sign
    // without reading process.env. Setting `cookieSecure: false`
    // keeps the Set-Cookie string deterministic across test envs.
    sessionTokenSecret: 'test-session-secret',
    cookieSecure: false,
  });
  await app.ready();
  return { app, flowState, users };
}

function makeAuthCodeGrantStub(sub: string): () => Promise<{
  access_token: string;
  token_type: string;
  claims: () => { sub: string; iss: string; aud: string; iat: number; exp: number };
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
      }),
    });
}

describe('GET /auth/login', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await buildApp((sub) => makeAuthCodeGrantStub(sub));
  });
  afterEach(async () => {
    await test.app.close();
  });

  it('302-redirects to the issuer authorization endpoint', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/auth/login' });
    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBeDefined();
    expect(String(response.headers['location'])).toMatch(/^http:\/\/authelia:9091\/auth\?/);
  });

  it('persists the flow state under the generated state', async () => {
    expect(test.flowState.size()).toBe(0);
    await test.app.inject({ method: 'GET', url: '/auth/login' });
    expect(test.flowState.size()).toBe(1);
  });

  it('passes the expected query params to the authorization URL', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/auth/login' });
    const location = new URL(String(response.headers['location']));
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid');
    expect(location.searchParams.get('state')).toBe('state-1');
    expect(location.searchParams.get('nonce')).toBe('nonce-1');
    expect(location.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('GET /auth/callback', () => {
  let test: TestApp;
  beforeEach(async () => {
    test = await buildApp((sub) => makeAuthCodeGrantStub(sub));
  });
  afterEach(async () => {
    await test.app.close();
  });

  it('returns 400 + auth-state-invalid envelope when state is missing', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/auth/callback?code=AUTHCODE',
    });
    expect(response.statusCode).toBe(400);
    // The querystring schema's `required: ['code', 'state']` rejects
    // missing state via Fastify's validation; the canonical envelope
    // surfaces under code `validation-failed`.
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toMatch(/auth-state-invalid|validation-failed/);
  });

  it('returns 400 when state does not match a stored entry', async () => {
    // Begin a flow so the store has a known entry, then send an
    // unrelated state.
    await test.app.inject({ method: 'GET', url: '/auth/login' });
    const response = await test.app.inject({
      method: 'GET',
      url: '/auth/callback?code=AUTHCODE&state=does-not-exist',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string; message?: string } }>();
    expect(body.error?.code).toBe('auth-state-invalid');
    expect(body.error?.message).toMatch(/state/i);
  });

  it('with a matching state, exchanges code and returns the user', async () => {
    await test.app.inject({ method: 'GET', url: '/auth/login' });
    const response = await test.app.inject({
      method: 'GET',
      url: '/auth/callback?code=AUTHCODE&state=state-1',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sub?: string; oauthSubject?: string; userId?: string }>();
    expect(body.sub).toBe('alice');
    // Namespace key uses the full issuer origin (`<protocol>//<host>[:port]`)
    // per F-008 hardening — see docs/security/m3-review/auth.md.
    expect(body.oauthSubject).toBe('http://authelia:9091:alice');
    expect(typeof body.userId).toBe('string');
    expect(test.users.size).toBe(1);
  });

  it('a replay against the same state after take() returns 400', async () => {
    await test.app.inject({ method: 'GET', url: '/auth/login' });
    const first = await test.app.inject({
      method: 'GET',
      url: '/auth/callback?code=AUTHCODE&state=state-1',
    });
    expect(first.statusCode).toBe(200);
    const replay = await test.app.inject({
      method: 'GET',
      url: '/auth/callback?code=AUTHCODE&state=state-1',
    });
    expect(replay.statusCode).toBe(400);
    const body = replay.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-state-invalid');
  });
});

// ============================================================
// namespacedOauthSubject — F-008 hardening (full-origin namespace)
// ============================================================
//
// Per docs/security/m3-review/auth.md F-008 / refinement
// tasks/refinements/backend-hardening/oauth_subject_full_namespacing.md:
// the namespace key for `users.oauth_subject` must include the issuer
// URL's full origin (protocol + hostname + port), not just the
// hostname. Two issuers on the same hostname with different ports —
// or one on http and one on https — must produce different namespace
// keys so an OIDC `sub` reuse across the two cannot collide on the
// `oauth_subject` UNIQUE constraint and silently merge accounts.

describe('namespacedOauthSubject', () => {
  it("uses the issuer URL's full origin (protocol + host + port) as the namespace prefix", () => {
    // The dev Authelia URL — `http://authelia:9091` — produces an
    // origin-prefixed namespace key, not a hostname-only one.
    const result = namespacedOauthSubject(new URL('http://authelia:9091'), 'alice');
    expect(result).toBe('http://authelia:9091:alice');
    // The protocol scheme MUST be part of the key.
    expect(result).toMatch(/^https?:\/\//);
    // The full `sub` must appear after the origin + ':' separator.
    expect(result.endsWith(':alice')).toBe(true);
  });

  it('two issuers on the SAME hostname-DIFFERENT-port produce DIFFERENT namespace keys', () => {
    // The F-008 scenario: an operator stands up two issuers on the
    // same domain at different ports (e.g. legacy Authelia on :9091
    // alongside a production OIDC issuer on :443). Pre-fix, both
    // collapsed to `auth.example.com:<sub>`; post-fix the port is
    // part of the namespace so they stay distinct.
    const a = namespacedOauthSubject(new URL('https://auth.example.com:9091'), 'shared-sub');
    const b = namespacedOauthSubject(new URL('https://auth.example.com:443'), 'shared-sub');
    expect(a).not.toBe(b);
    expect(a).toBe('https://auth.example.com:9091:shared-sub');
    // Note: `URL.origin` omits the explicit `:443` for https since it
    // is the default port — that's the intended semantics from the
    // WHATWG URL spec. The test pins the post-`origin` shape rather
    // than asserting a literal `:443` string.
    expect(b).toBe('https://auth.example.com:shared-sub');
  });

  it('two users from the SAME issuer get the SAME namespace prefix', () => {
    // Same issuer, two different `sub` values — the namespace prefix
    // (everything before the last `:<sub>` segment) must be identical.
    const issuer = new URL('http://authelia:9091');
    const alice = namespacedOauthSubject(issuer, 'alice');
    const bob = namespacedOauthSubject(issuer, 'bob');
    const prefixA = alice.slice(0, alice.length - 'alice'.length);
    const prefixB = bob.slice(0, bob.length - 'bob'.length);
    expect(prefixA).toBe(prefixB);
    expect(prefixA).toBe('http://authelia:9091:');
  });

  it('different protocols on the SAME hostname-port produce DIFFERENT namespace keys', () => {
    // http vs https on the same host — distinguishing protocol is
    // half the F-008 fix (port is the other half). A maintainer who
    // flipped the issuer URL from http to https without rotating
    // `oauth_subject` values would otherwise see legacy rows resolve
    // to the new origin silently. The origin-based key keeps them
    // separate.
    const http = namespacedOauthSubject(new URL('http://localhost:9091'), 'alice');
    const https = namespacedOauthSubject(new URL('https://localhost:9091'), 'alice');
    expect(http).not.toBe(https);
    expect(http).toBe('http://localhost:9091:alice');
    expect(https).toBe('https://localhost:9091:alice');
  });
});
