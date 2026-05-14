// Vitest unit tests for `apps/server/src/auth/config.ts`.
//
// Refinement: tasks/refinements/backend/oauth_provider_config.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.oauth_provider_config
//
// **Coverage (the contract this module owns)**
//
//   1. `loadOidcConfig` accepts a well-formed env block and produces
//      the expected `OidcConfig` shape, including the derived
//      `redirectUri`.
//   2. `loadOidcConfig` throws `OidcConfigError` for each malformed
//      / missing field — non-URL issuer, missing client id, missing
//      secret, non-URL APP_BASE_URL.
//   3. `loadOidcConfig` defaults `APP_BASE_URL` to
//      `http://localhost:3000` when it's absent.
//   4. `loadOidcConfig` strips a trailing slash on `APP_BASE_URL`
//      before deriving `redirectUri` (so the Authelia string-match
//      against the registered list passes regardless of whether the
//      env value carries a trailing slash).
//   5. `getOidcClient` memoizes — the first call invokes the
//      openid-client `discovery(...)` helper; the second call against
//      the same config does not.
//   6. `getOidcClient` calls `discovery(...)` with the expected
//      arguments (issuer URL, client id, client secret). The dev /
//      CI / production issuer URL is always https — openid-client@6
//      enforces TLS at the protocol check and we deliberately do not
//      bypass that gate; the dev Authelia stack ships a self-signed
//      cert (`infra/authelia/tls/`) and the app container trusts it
//      via `NODE_EXTRA_CA_CERTS`.
//
// **On mocking `openid-client`.** ADR 0022 forbids throwaway probes
// of the system under test, not test doubles for upstream libraries.
// The contract this module owns is "the env shape we validate, the
// args we pass to `discovery`, and the memoization wrapper around it"
// — the openid-client library has its own test suite and is not the
// system under test here. The dev Authelia round-trip is exercised
// end-to-end by the Cucumber sibling at
// `tests/behavior/backend/oauth-config.feature` (which speaks to the
// compose stack's authelia service). Mocking here pins the spec
// contract; the Cucumber scenario pins the integration.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist the mocks so the import below resolves to the mocked module.
const discoveryMock = vi.hoisted(() =>
  vi.fn(async () => {
    return Promise.resolve({ __mocked: true });
  }),
);

vi.mock('openid-client', () => ({
  discovery: discoveryMock,
}));

// Import AFTER the mock so the module sees the mocked helpers.
const { loadOidcConfig, getOidcClient, OidcConfigError, __isOidcClientCached } =
  await import('./config.js');

// Reusable valid env block — the test cases override individual
// fields to exercise specific failure paths. The dev/CI Authelia
// issuer is `https://authelia.aconversa.local:9091` (Authelia serves TLS with a
// committed self-signed cert; the compose `app` service trusts it via
// `NODE_EXTRA_CA_CERTS`) — matching the production HTTPS-only shape
// `openid-client@6` enforces.
const validEnv = {
  OIDC_ISSUER_URL: 'https://authelia.aconversa.local:9091',
  OIDC_CLIENT_ID: 'aconversa-app-dev',
  OIDC_CLIENT_SECRET: 'aconversa-app-dev-secret',
  APP_BASE_URL: 'http://localhost:3000',
};

describe('loadOidcConfig', () => {
  it('accepts a well-formed env block and derives the redirect URI', () => {
    const config = loadOidcConfig(validEnv);
    expect(config.issuerUrl.toString()).toBe('https://authelia.aconversa.local:9091/');
    expect(config.clientId).toBe('aconversa-app-dev');
    expect(config.clientSecret).toBe('aconversa-app-dev-secret');
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.redirectUri).toBe('http://localhost:3000/auth/callback');
  });

  it('defaults APP_BASE_URL to http://localhost:3000 when absent', () => {
    const env = { ...validEnv };
    // Delete the optional field — Zod's `.default()` should kick in.
    delete (env as Partial<typeof env>).APP_BASE_URL;
    const config = loadOidcConfig(env);
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.redirectUri).toBe('http://localhost:3000/auth/callback');
  });

  it('strips trailing slash on APP_BASE_URL before composing redirectUri', () => {
    const config = loadOidcConfig({ ...validEnv, APP_BASE_URL: 'http://localhost:3000/' });
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.redirectUri).toBe('http://localhost:3000/auth/callback');
  });

  it('throws OidcConfigError on malformed issuer URL', () => {
    expect(() => loadOidcConfig({ ...validEnv, OIDC_ISSUER_URL: 'not-a-url' })).toThrow(
      OidcConfigError,
    );
  });

  it('throws OidcConfigError on missing issuer URL', () => {
    const env = { ...validEnv };
    delete (env as Partial<typeof env>).OIDC_ISSUER_URL;
    expect(() => loadOidcConfig(env)).toThrow(OidcConfigError);
  });

  it('throws OidcConfigError on empty client id', () => {
    expect(() => loadOidcConfig({ ...validEnv, OIDC_CLIENT_ID: '' })).toThrow(OidcConfigError);
  });

  it('throws OidcConfigError on missing client secret', () => {
    const env = { ...validEnv };
    delete (env as Partial<typeof env>).OIDC_CLIENT_SECRET;
    expect(() => loadOidcConfig(env)).toThrow(OidcConfigError);
  });

  it('throws OidcConfigError on malformed APP_BASE_URL', () => {
    expect(() => loadOidcConfig({ ...validEnv, APP_BASE_URL: 'not-a-url-either' })).toThrow(
      OidcConfigError,
    );
  });

  it('OidcConfigError carries per-field issue diagnostics without leaking values', () => {
    try {
      loadOidcConfig({ ...validEnv, OIDC_ISSUER_URL: 'oops', OIDC_CLIENT_SECRET: '' });
      // The line above must throw — guard against silent passing.
      expect.fail('expected OidcConfigError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OidcConfigError);
      const cfgErr = err as InstanceType<typeof OidcConfigError>;
      const paths = cfgErr.issues.map((i: { path: string; message: string }) => i.path);
      expect(paths).toContain('OIDC_ISSUER_URL');
      expect(paths).toContain('OIDC_CLIENT_SECRET');
      // The error message references field names, never values —
      // 'oops' must not appear anywhere in the surfaced text.
      expect(cfgErr.message).not.toContain('oops');
    }
  });
});

describe('getOidcClient', () => {
  beforeEach(() => {
    discoveryMock.mockClear();
  });

  it('invokes openid-client discovery with issuer URL, client id, and client secret', async () => {
    const config = loadOidcConfig(validEnv);
    await getOidcClient(config);
    expect(discoveryMock).toHaveBeenCalledTimes(1);
    const args = discoveryMock.mock.calls[0];
    expect(args).toBeDefined();
    // mock.calls[i] is typed as a tuple matching the mocked fn's
    // signature; the hoisted no-arg mock makes that `[]` here, so
    // we narrow through `unknown` to the discovery(...) signature
    // this module actually invokes.
    const [server, clientId, secret] = args as unknown as [URL, string, string];
    expect(server).toBeInstanceOf(URL);
    expect(server.toString()).toBe('https://authelia.aconversa.local:9091/');
    expect(clientId).toBe('aconversa-app-dev');
    expect(secret).toBe('aconversa-app-dev-secret');
  });

  it('memoizes discovery per config reference (first call discovers; second uses the cache)', async () => {
    const config = loadOidcConfig(validEnv);
    expect(__isOidcClientCached(config)).toBe(false);

    const first = await getOidcClient(config);
    expect(__isOidcClientCached(config)).toBe(true);
    expect(discoveryMock).toHaveBeenCalledTimes(1);

    const second = await getOidcClient(config);
    expect(discoveryMock).toHaveBeenCalledTimes(1);
    // Same Configuration instance returned both times.
    expect(second).toBe(first);
  });

  it('re-discovers when given a fresh config reference (cache is per reference, not per URL)', async () => {
    const a = loadOidcConfig(validEnv);
    const b = loadOidcConfig(validEnv);
    expect(a).not.toBe(b);

    await getOidcClient(a);
    await getOidcClient(b);
    expect(discoveryMock).toHaveBeenCalledTimes(2);
  });

  it('concurrent first-callers share a single discovery round-trip', async () => {
    const config = loadOidcConfig(validEnv);
    // Two parallel calls hit the cache check before either resolves;
    // the second must see the in-flight promise rather than starting
    // a fresh discovery.
    const [a, b] = await Promise.all([getOidcClient(config), getOidcClient(config)]);
    expect(discoveryMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});
