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
const {
  createFlowStateStore,
  createPostgresFlowStateStore,
  FlowStateCapacityError,
  FLOW_STATE_MAX_ENTRIES_ENV,
  MAX_FLOW_STATE_ENTRIES,
  resolveFlowStateMaxEntries,
} = await import('./flow-state.js');

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
      redirectUri: 'http://localhost:3000/api/auth/callback',
    });
    expect(result.state).toBe('mock-state');
    expect(result.nonce).toBe('mock-nonce');
    expect(result.codeVerifier).toBe('mock-verifier');
    expect(result.url).toBeInstanceOf(URL);
  });

  it('passes the expected query params to buildAuthorizationUrl', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/api/auth/callback',
    });
    expect(buildAuthorizationUrlMock).toHaveBeenCalledTimes(1);
    const call = buildAuthorizationUrlMock.mock.calls[0];
    expect(call).toBeDefined();
    const [, params] = call as [unknown, Record<string, string>];
    expect(params['redirect_uri']).toBe('http://localhost:3000/api/auth/callback');
    expect(params['response_type']).toBe('code');
    expect(params['scope']).toBe('openid');
    expect(params['state']).toBe('mock-state');
    expect(params['nonce']).toBe('mock-nonce');
    expect(params['code_challenge']).toBe('mock-challenge');
    expect(params['code_challenge_method']).toBe('S256');
  });

  it('defaults scope to "openid" (no profile/email per ADR 0002)', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/api/auth/callback',
    });
    const call = buildAuthorizationUrlMock.mock.calls[0];
    const [, params] = call as [unknown, Record<string, string>];
    expect(params['scope']).toBe('openid');
    expect(params['scope']).not.toContain('profile');
    expect(params['scope']).not.toContain('email');
  });

  it('honors an explicit scope when the caller passes one', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/api/auth/callback',
      scope: 'openid offline_access',
    });
    const call = buildAuthorizationUrlMock.mock.calls[0];
    const [, params] = call as [unknown, Record<string, string>];
    expect(params['scope']).toBe('openid offline_access');
  });

  it('calls each random/pkce primitive exactly once per flow', async () => {
    await beginAuthFlow(stubClient, {
      redirectUri: 'http://localhost:3000/api/auth/callback',
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
    const url = new URL('http://localhost:3000/api/auth/callback?code=AUTHCODE&state=WRONG-STATE');
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
    const url = new URL('http://localhost:3000/api/auth/callback?code=AUTHCODE&state=mock-state');
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
    const url = new URL('http://localhost:3000/api/auth/callback?code=AUTHCODE&state=mock-state');
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
    const url = new URL('http://localhost:3000/api/auth/callback?code=AUTHCODE&state=mock-state');
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

describe('flow-state capacity cap (M3-review inputs.md F-006)', () => {
  // Per ADR 0022, the cap behaviors are pinned by committed Vitest
  // cases — these tests ARE the verification of the cap shape, not a
  // throwaway probe.

  it('exports MAX_FLOW_STATE_ENTRIES = 1000 (the production default)', () => {
    expect(MAX_FLOW_STATE_ENTRIES).toBe(1000);
  });

  it('exports FLOW_STATE_MAX_ENTRIES_ENV = "FLOW_STATE_MAX_ENTRIES"', () => {
    expect(FLOW_STATE_MAX_ENTRIES_ENV).toBe('FLOW_STATE_MAX_ENTRIES');
  });

  it('accepts entries up to the cap (cap=3 → first three puts succeed)', () => {
    const store = createFlowStateStore({ now: () => 1000, maxEntries: 3 });
    store.put('a', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('b', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('c', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    expect(store.size()).toBe(3);
  });

  it('throws FlowStateCapacityError when at the cap and no entries are expired', () => {
    const store = createFlowStateStore({ now: () => 1000, maxEntries: 3 });
    store.put('a', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('b', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('c', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    expect(() => store.put('d', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 })).toThrow(
      FlowStateCapacityError,
    );
    // The store is unchanged on rejection — `d` was never inserted
    // and the existing entries are intact.
    expect(store.size()).toBe(3);
  });

  it('the thrown error message does NOT leak the cap value or the current size', () => {
    const store = createFlowStateStore({ now: () => 1000, maxEntries: 3 });
    store.put('a', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('b', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('c', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    try {
      store.put('d', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
      throw new Error('expected FlowStateCapacityError');
    } catch (err) {
      expect(err).toBeInstanceOf(FlowStateCapacityError);
      const message = (err as Error).message;
      // Neither the cap value nor the current size should appear.
      expect(message).not.toMatch(/\b3\b/);
      // And a future `JSON.stringify(err)` should not carry a cap.
      // Exclude `stack` — it inherently contains line numbers from the
      // throwing frame and is not attacker-useful state; the check is
      // for custom data fields (e.g., `err.cap = 3`).
      const serialized = JSON.stringify(
        err,
        Object.getOwnPropertyNames(err).filter((p) => p !== 'stack'),
      );
      expect(serialized).not.toMatch(/\b3\b/);
    }
  });

  it('eager-sweeps expired entries at the cap boundary, then accepts the new entry', () => {
    let clock = 1000;
    const store = createFlowStateStore({ now: () => clock, maxEntries: 3 });
    // Two of these three expire at 2000; the third lives to 999_999.
    store.put('expired-1', { nonce: 'n', codeVerifier: 'v', expiresAt: 2000 });
    store.put('fresh-1', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('expired-2', { nonce: 'n', codeVerifier: 'v', expiresAt: 2000 });
    expect(store.size()).toBe(3);
    // Advance past the expired entries' TTL but stay within the
    // 60-second background sweep window — the eager sweep on `put`
    // should clear them.
    clock = 5000;
    // The new put should succeed: at-cap → eager sweep clears 2 →
    // size drops to 1 → insert lands → size goes back to 2.
    store.put('new-1', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    expect(store.size()).toBe(2);
    expect(store.take('fresh-1')).toBeDefined();
    expect(store.take('new-1')).toBeDefined();
  });

  it('does NOT eager-sweep below the cap (cheap path stays cheap)', () => {
    // Below the cap, `put` must not walk the map. We verify this by
    // observing that an unexpired entry's `take` still succeeds even
    // when the clock has advanced past *another* (unrelated, still
    // unexpired) entry would notionally be swept — i.e. nothing is
    // touched.
    let clock = 1000;
    const store = createFlowStateStore({ now: () => clock, maxEntries: 10 });
    store.put('a', { nonce: 'n', codeVerifier: 'v', expiresAt: 1500 });
    expect(store.size()).toBe(1);
    clock = 2000;
    // Adding a second entry. `a` is now expired but we expect it to
    // remain in the map because the cap (10) was not reached and the
    // cheap path takes no sweep.
    store.put('b', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    expect(store.size()).toBe(2); // both entries still present.
    // `take('a')` lazily removes the expired entry — that's the
    // documented per-entry GC path, separate from the cap-driven
    // sweep.
    expect(store.take('a')).toBeUndefined();
    expect(store.size()).toBe(1);
  });

  it('overwriting an existing state never trips the cap', () => {
    const store = createFlowStateStore({ now: () => 1000, maxEntries: 3 });
    store.put('a', { nonce: 'old', codeVerifier: 'old', expiresAt: 999_999 });
    store.put('b', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    store.put('c', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
    expect(store.size()).toBe(3);
    // At the cap. Overwriting 'a' (an existing state) must still
    // succeed — the cap check is gated on `!map.has(state)`, so this
    // path doesn't grow the map.
    store.put('a', { nonce: 'new', codeVerifier: 'new', expiresAt: 999_999 });
    expect(store.size()).toBe(3);
    expect(store.take('a')?.nonce).toBe('new');
  });
});

describe('resolveFlowStateMaxEntries', () => {
  it('returns MAX_FLOW_STATE_ENTRIES (1000) when FLOW_STATE_MAX_ENTRIES is unset', () => {
    expect(resolveFlowStateMaxEntries({})).toBe(MAX_FLOW_STATE_ENTRIES);
  });

  it('returns the default when FLOW_STATE_MAX_ENTRIES is empty', () => {
    expect(resolveFlowStateMaxEntries({ FLOW_STATE_MAX_ENTRIES: '' })).toBe(MAX_FLOW_STATE_ENTRIES);
  });

  it('returns the default when FLOW_STATE_MAX_ENTRIES is not a number', () => {
    expect(resolveFlowStateMaxEntries({ FLOW_STATE_MAX_ENTRIES: 'not-a-number' })).toBe(
      MAX_FLOW_STATE_ENTRIES,
    );
  });

  it('returns the default when FLOW_STATE_MAX_ENTRIES is zero', () => {
    expect(resolveFlowStateMaxEntries({ FLOW_STATE_MAX_ENTRIES: '0' })).toBe(
      MAX_FLOW_STATE_ENTRIES,
    );
  });

  it('returns the default when FLOW_STATE_MAX_ENTRIES is negative', () => {
    expect(resolveFlowStateMaxEntries({ FLOW_STATE_MAX_ENTRIES: '-5' })).toBe(
      MAX_FLOW_STATE_ENTRIES,
    );
  });

  it('returns the parsed value when FLOW_STATE_MAX_ENTRIES is a positive integer', () => {
    expect(resolveFlowStateMaxEntries({ FLOW_STATE_MAX_ENTRIES: '500' })).toBe(500);
  });

  it('is wired by createFlowStateStore via process.env when no maxEntries option is passed', () => {
    const prior = process.env['FLOW_STATE_MAX_ENTRIES'];
    process.env['FLOW_STATE_MAX_ENTRIES'] = '5';
    try {
      const store = createFlowStateStore({ now: () => 1000 });
      for (let i = 0; i < 5; i++) {
        store.put(`k-${String(i)}`, { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 });
      }
      expect(store.size()).toBe(5);
      expect(() =>
        store.put('overflow', { nonce: 'n', codeVerifier: 'v', expiresAt: 999_999 }),
      ).toThrow(FlowStateCapacityError);
    } finally {
      if (prior === undefined) {
        delete process.env['FLOW_STATE_MAX_ENTRIES'];
      } else {
        process.env['FLOW_STATE_MAX_ENTRIES'] = prior;
      }
    }
  });
});

describe('Postgres flow-state store (ADR 0035 / M3-review auth.md F-005)', () => {
  interface StoredRow {
    nonce: string;
    codeVerifier: string;
    expiresAt: number;
  }

  function makeSharedPool(now: () => number): {
    readonly rows: Map<string, StoredRow>;
    readonly sql: string[];
    query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }>;
  } {
    const rows = new Map<string, StoredRow>();
    const sql: string[] = [];
    return {
      rows,
      sql,
      query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<{ rows: TRow[] }> {
        sql.push(text);
        const result: Array<Record<string, unknown>> = [];
        if (text.includes('INSERT INTO auth_flow_state')) {
          for (const [state, entry] of rows) {
            if (entry.expiresAt <= now()) rows.delete(state);
          }
          const [state, nonce, codeVerifier, expiresAt, , maxEntries] = params as [
            string,
            string,
            string,
            number,
            number,
            number,
          ];
          if (rows.has(state) || rows.size < maxEntries) {
            rows.set(state, { nonce, codeVerifier, expiresAt });
            result.push({ state });
          }
        } else if (text.includes('RETURNING nonce, code_verifier')) {
          const state = String(params[0]);
          const entry = rows.get(state);
          rows.delete(state);
          if (entry !== undefined) {
            result.push({
              nonce: entry.nonce,
              code_verifier: entry.codeVerifier,
              expires_at_ms: entry.expiresAt,
            });
          }
        } else if (text.includes('COUNT(*)::int AS count')) {
          result.push({ count: rows.size });
        } else if (text.includes('DELETE FROM auth_flow_state WHERE expires_at <= NOW()')) {
          for (const [state, entry] of rows) {
            if (entry.expiresAt <= now()) rows.delete(state);
          }
        }
        return Promise.resolve({ rows: result as TRow[] });
      },
    };
  }

  it('shares state across instances and consumes it exactly once', async () => {
    const pool = makeSharedPool(() => 1000);
    const instanceA = createPostgresFlowStateStore(pool, { now: () => 1000 });
    const instanceB = createPostgresFlowStateStore(pool, { now: () => 1000 });
    await instanceA.put('shared-state', { nonce: 'n', codeVerifier: 'v', expiresAt: 6000 });
    await expect(instanceB.take('shared-state')).resolves.toEqual({
      nonce: 'n',
      codeVerifier: 'v',
      expiresAt: 6000,
    });
    await expect(instanceA.take('shared-state')).resolves.toBeUndefined();
  });

  it('rejects an expired destructive read and sweeps abandoned expired rows', async () => {
    let clock = 1000;
    const pool = makeSharedPool(() => clock);
    const store = createPostgresFlowStateStore(pool, { now: () => clock });
    await store.put('expired-on-take', { nonce: 'n', codeVerifier: 'v', expiresAt: 1500 });
    clock = 2000;
    await expect(store.take('expired-on-take')).resolves.toBeUndefined();
    await store.put('abandoned', { nonce: 'n', codeVerifier: 'v', expiresAt: 2500 });
    clock = 3000;
    await store.sweep();
    await expect(store.size()).resolves.toBe(0);
  });

  it('serializes cap-boundary inserts and preserves the typed capacity error', async () => {
    const pool = makeSharedPool(() => 1000);
    const store = createPostgresFlowStateStore(pool, { maxEntries: 1 });
    await store.put('first', { nonce: 'n', codeVerifier: 'v', expiresAt: 6000 });
    await expect(
      store.put('overflow', { nonce: 'n', codeVerifier: 'v', expiresAt: 6000 }),
    ).rejects.toBeInstanceOf(FlowStateCapacityError);
    expect(pool.sql[0]).toContain('pg_advisory_xact_lock');
    await expect(store.size()).resolves.toBe(1);
  });
});
