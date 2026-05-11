// Vitest unit tests for `apps/server/src/auth/flow.ts` and
// `apps/server/src/auth/flow-state.ts`.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.oauth_callback_handler
//
// **Coverage (the contract these modules own)**
//
//   beginAuthFlow:
//     1. Returns the expected `{ url, state, nonce, codeVerifier }` shape.
//     2. The URL includes `response_type=code`, `state`, `nonce`,
//        `code_challenge`, `code_challenge_method=S256`, and the
//        passed-in `redirect_uri`.
//     3. Defaults `scope` to `'openid'` when the caller doesn't pass one
//        (the no-profile-data rule — we never request `profile` / `email`).
//     4. Calls the openid-client primitives `randomState`, `randomNonce`,
//        `randomPKCECodeVerifier`, and `calculatePKCECodeChallenge` once
//        each per call.
//
//   completeAuthFlow:
//     5. Rejects on state mismatch (the URL's `state` differs from
//        `expected.expectedState`) with `AuthStateMismatchError`.
//     6. On state match, passes the URL + `{ expectedState,
//        expectedNonce, pkceCodeVerifier }` to `authorizationCodeGrant`.
//     7. Returns `{ sub }` taken from the token response's
//        `claims().sub`.
//     8. Throws when the token response carries no claims (the defensive
//        guard).
//
//   flow-state:
//     9. `put` then `take` round-trips an entry.
//    10. `take` removes the entry — a second `take` returns `undefined`.
//    11. Expired entries are removed on `take` and return `undefined`.
//    12. `sweep` removes only expired entries.
//
// **On mocking `openid-client`.** The Vitest layer pins the spec
// contract for our wrappers — we don't re-test openid-client's own
// behavior. Per ADR 0022, the network-touching integration is a
// committed Cucumber scenario, not a probe.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const randomStateMock = vi.hoisted(() => vi.fn(() => 'mock-state'));
const randomNonceMock = vi.hoisted(() => vi.fn(() => 'mock-nonce'));
const randomPKCECodeVerifierMock = vi.hoisted(() => vi.fn(() => 'mock-verifier'));
const calculatePKCECodeChallengeMock = vi.hoisted(() =>
  vi.fn(async () => Promise.resolve('mock-challenge')),
);
const buildAuthorizationUrlMock = vi.hoisted(() =>
  vi.fn(
    (_config: unknown, params: Record<string, string>) =>
      new URL(`https://issuer.example.test/auth?${new URLSearchParams(params).toString()}`),
  ),
);
const authorizationCodeGrantMock = vi.hoisted(() =>
  vi.fn(async () =>
    Promise.resolve({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      claims: (): { sub: string; iss: string; aud: string; iat: number; exp: number } => ({
        sub: 'alice',
        iss: 'http://authelia:9091',
        aud: 'aconversa-app-dev',
        iat: 0,
        exp: 0,
      }),
    }),
  ),
);

vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  allowInsecureRequests: vi.fn(),
  randomState: randomStateMock,
  randomNonce: randomNonceMock,
  randomPKCECodeVerifier: randomPKCECodeVerifierMock,
  calculatePKCECodeChallenge: calculatePKCECodeChallengeMock,
  buildAuthorizationUrl: buildAuthorizationUrlMock,
  authorizationCodeGrant: authorizationCodeGrantMock,
  // The plugin's import-time `Configuration` class re-export is
  // re-exported via the mock barrel below — tests don't actually
  // need a concrete class because the flow primitives accept the
  // Configuration as an opaque argument.
  Configuration: class MockConfiguration {},
}));

const { beginAuthFlow, completeAuthFlow, AuthStateMismatchError } = await import('./flow.js');
const { createFlowStateStore } = await import('./flow-state.js');

// A sentinel Configuration — the flow primitives don't inspect it
// directly; they pass it through to the openid-client mocks. Using
// `{}` cast as Configuration keeps the test free of openid-client's
// real class import.
const stubClient = {} as Parameters<typeof beginAuthFlow>[0];

describe('beginAuthFlow', () => {
  beforeEach(() => {
    randomStateMock.mockClear();
    randomNonceMock.mockClear();
    randomPKCECodeVerifierMock.mockClear();
    calculatePKCECodeChallengeMock.mockClear();
    buildAuthorizationUrlMock.mockClear();
  });

  it('returns { url, state, nonce, codeVerifier } sourced from openid-client primitives', async () => {
    const result = await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    expect(result.state).toBe('mock-state');
    expect(result.nonce).toBe('mock-nonce');
    expect(result.codeVerifier).toBe('mock-verifier');
    expect(result.url).toBeInstanceOf(URL);
  });

  it('passes the expected query params to buildAuthorizationUrl', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    expect(buildAuthorizationUrlMock).toHaveBeenCalledTimes(1);
    const call = buildAuthorizationUrlMock.mock.calls[0];
    expect(call).toBeDefined();
    const [, params] = call as [unknown, Record<string, string>];
    expect(params['redirect_uri']).toBe('http://localhost:3000/auth/callback');
    expect(params['response_type']).toBe('code');
    expect(params['scope']).toBe('openid');
    expect(params['state']).toBe('mock-state');
    expect(params['nonce']).toBe('mock-nonce');
    expect(params['code_challenge']).toBe('mock-challenge');
    expect(params['code_challenge_method']).toBe('S256');
  });

  it('defaults scope to "openid" (no profile/email per ADR 0002)', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    const call = buildAuthorizationUrlMock.mock.calls[0];
    const [, params] = call as [unknown, Record<string, string>];
    expect(params['scope']).toBe('openid');
    expect(params['scope']).not.toContain('profile');
    expect(params['scope']).not.toContain('email');
  });

  it('honors an explicit scope when the caller passes one', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/auth/callback',
      scope: 'openid offline_access',
    });
    const call = buildAuthorizationUrlMock.mock.calls[0];
    const [, params] = call as [unknown, Record<string, string>];
    expect(params['scope']).toBe('openid offline_access');
  });

  it('calls each random/pkce primitive exactly once per flow', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    expect(randomStateMock).toHaveBeenCalledTimes(1);
    expect(randomNonceMock).toHaveBeenCalledTimes(1);
    expect(randomPKCECodeVerifierMock).toHaveBeenCalledTimes(1);
    expect(calculatePKCECodeChallengeMock).toHaveBeenCalledTimes(1);
    // The challenge derives from the verifier.
    expect(calculatePKCECodeChallengeMock).toHaveBeenCalledWith('mock-verifier');
  });
});

describe('completeAuthFlow', () => {
  beforeEach(() => {
    authorizationCodeGrantMock.mockClear();
    // Reset to a successful response shape; cases that need a
    // different shape mockReturnValueOnce.
    authorizationCodeGrantMock.mockResolvedValue({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      claims: () => ({
        sub: 'alice',
        iss: 'http://authelia:9091',
        aud: 'aconversa-app-dev',
        iat: 0,
        exp: 0,
      }),
    });
  });

  it('throws AuthStateMismatchError when the inbound state differs from expected', async () => {
    const url = new URL('http://localhost:3000/auth/callback?code=AUTHCODE&state=WRONG-STATE');
    await expect(
      completeAuthFlow(stubClient, url, {
        expectedState: 'mock-state',
        expectedNonce: 'mock-nonce',
        codeVerifier: 'mock-verifier',
      }),
    ).rejects.toBeInstanceOf(AuthStateMismatchError);
    // The library was never called — early rejection.
    expect(authorizationCodeGrantMock).not.toHaveBeenCalled();
  });

  it('on state match, passes state/nonce/verifier to authorizationCodeGrant', async () => {
    const url = new URL('http://localhost:3000/auth/callback?code=AUTHCODE&state=mock-state');
    await completeAuthFlow(stubClient, url, {
      expectedState: 'mock-state',
      expectedNonce: 'mock-nonce',
      codeVerifier: 'mock-verifier',
    });
    expect(authorizationCodeGrantMock).toHaveBeenCalledTimes(1);
    const call = authorizationCodeGrantMock.mock.calls[0] as unknown as [
      unknown,
      URL,
      { expectedState?: string; expectedNonce?: string; pkceCodeVerifier?: string },
    ];
    expect(call).toBeDefined();
    const [client, currentUrl, checks] = call;
    expect(client).toBe(stubClient);
    expect(currentUrl.toString()).toBe(url.toString());
    expect(checks.expectedState).toBe('mock-state');
    expect(checks.expectedNonce).toBe('mock-nonce');
    expect(checks.pkceCodeVerifier).toBe('mock-verifier');
  });

  it('returns { sub } from the token response claims', async () => {
    const url = new URL('http://localhost:3000/auth/callback?code=AUTHCODE&state=mock-state');
    const result = await completeAuthFlow(stubClient, url, {
      expectedState: 'mock-state',
      expectedNonce: 'mock-nonce',
      codeVerifier: 'mock-verifier',
    });
    expect(result).toEqual({ sub: 'alice' });
  });

  it('throws when the token response has no claims (defensive)', async () => {
    // The runtime contract for `claims()` is `IDToken | undefined`;
    // the strict tuple inferred from the prior happy-path return
    // value doesn't include `undefined`, so we narrow through
    // `unknown` here. Production code's defensive guard catches the
    // undefined case.
    authorizationCodeGrantMock.mockResolvedValueOnce({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      claims: () => undefined,
    } as unknown as Awaited<ReturnType<typeof authorizationCodeGrantMock>>);
    const url = new URL('http://localhost:3000/auth/callback?code=AUTHCODE&state=mock-state');
    await expect(
      completeAuthFlow(stubClient, url, {
        expectedState: 'mock-state',
        expectedNonce: 'mock-nonce',
        codeVerifier: 'mock-verifier',
      }),
    ).rejects.toThrow(/id_token claims/);
  });
});

describe('flow-state store', () => {
  it('put then take round-trips an entry', () => {
    const store = createFlowStateStore({ now: () => 1000, ttlMs: 5000 });
    store.put('state-a', { nonce: 'n', codeVerifier: 'v', expiresAt: 6000 });
    const taken = store.take('state-a');
    expect(taken).toEqual({ nonce: 'n', codeVerifier: 'v', expiresAt: 6000 });
  });

  it('take is one-shot — a second take of the same state returns undefined', () => {
    const store = createFlowStateStore({ now: () => 1000, ttlMs: 5000 });
    store.put('state-a', { nonce: 'n', codeVerifier: 'v', expiresAt: 6000 });
    expect(store.take('state-a')).not.toBeUndefined();
    expect(store.take('state-a')).toBeUndefined();
  });

  it('returns undefined and removes expired entries on take', () => {
    let clock = 1000;
    const store = createFlowStateStore({ now: () => clock, ttlMs: 1000 });
    store.put('state-a', { nonce: 'n', codeVerifier: 'v', expiresAt: 2000 });
    clock = 5000; // past expiry
    expect(store.take('state-a')).toBeUndefined();
    // And the entry is gone — sweep has nothing to clean.
    expect(store.size()).toBe(0);
  });

  it('sweep removes only expired entries', () => {
    let clock = 1000;
    const store = createFlowStateStore({ now: () => clock, ttlMs: 1000 });
    store.put('expired-a', { nonce: 'n1', codeVerifier: 'v1', expiresAt: 1500 });
    store.put('fresh-b', { nonce: 'n2', codeVerifier: 'v2', expiresAt: 10_000 });
    expect(store.size()).toBe(2);
    clock = 2000;
    store.sweep();
    expect(store.size()).toBe(1);
    expect(store.take('fresh-b')).toBeDefined();
    expect(store.take('expired-a')).toBeUndefined();
  });

  it('put overwrites a prior entry for the same state', () => {
    const store = createFlowStateStore({ now: () => 0, ttlMs: 1000 });
    store.put('state-a', { nonce: 'old', codeVerifier: 'old-v', expiresAt: 500 });
    store.put('state-a', { nonce: 'new', codeVerifier: 'new-v', expiresAt: 500 });
    const taken = store.take('state-a');
    expect(taken?.nonce).toBe('new');
  });
});
