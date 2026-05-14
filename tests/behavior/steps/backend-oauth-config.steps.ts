// Step definitions for tests/behavior/backend/oauth-config.feature.
//
// Refinement: tasks/refinements/backend/oauth_provider_config.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.oauth_provider_config
//
// **Why this scenario lives at the Cucumber layer.** Per ADR 0022,
// every empirical verification of behavior is a committed test in
// the layer that fits. The env-to-Configuration wiring crosses two
// modules (`loadOidcConfig` reads env shape; `getOidcClient` builds
// the `Configuration`) and exercises real openid-client
// instantiation (via the `Configuration` constructor) without going
// over the network. That's between "pure logic" (Vitest, covered)
// and "live network round-trip to Authelia" (Playwright E2E, owned
// by `foundation.test_infra.playwright_test_helpers`). The Cucumber
// layer fits: integration of two modules in the same process, no
// network.
//
// **Discovery is stubbed.** `getOidcClient` accepts an injectable
// `discovery` function (production passes the real openid-client
// one). The step below passes a stub that constructs a real
// `Configuration` via its public constructor with a minimal
// `ServerMetadata` (`{ issuer: ... }`); the returned object is the
// real Configuration instance with the real `.clientMetadata()`
// accessor, so the assertion against `client_id` exercises the same
// shape production would. The Authelia round-trip itself is owned
// by `foundation.test_infra.playwright_test_helpers` (which drives
// the actual login flow against the running compose stack).
//
// **Pglite is not used in this scenario.** The world-level Before
// hook still spins up a pglite handle (cheap, ~ms); the steps below
// don't touch it. Splitting the World to skip pglite for non-DB
// scenarios would mean two World variants; the savings are not
// worth the structural complexity — the refinement records this as
// a deliberate choice.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import {
  loadOidcConfig,
  getOidcClient,
  __buildStubConfiguration,
  type Configuration,
  type OidcConfig,
} from '../../../apps/server/src/auth/index.js';
import type { AConversaWorld } from '../support/world.js';

// Per-scenario scratch shape — kept structurally on `world.scratch`
// rather than as a new World field so the World type doesn't grow
// per-feature appendages.
interface OidcScratch {
  oidcEnv?: Record<string, string>;
  oidcConfig?: OidcConfig;
  oidcClient?: Configuration;
  oidcClientSecond?: Configuration;
}

function scratch(world: AConversaWorld): OidcScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as OidcScratch;
}

// Stub `discovery` implementation: returns a real `Configuration`
// instance built by `__buildStubConfiguration` (which lives in the
// auth module so the `openid-client` import stays at the workspace
// boundary; the test tsconfig doesn't resolve `openid-client`
// directly). Production `discovery(...)` fetches the issuer's
// `/.well-known/openid-configuration` and feeds the full document
// into the Configuration constructor; the stub feeds in a one-field
// `{ issuer }` and otherwise produces the same real Configuration
// shape. The resulting `.clientMetadata().client_id` accessor
// behaves identically to the production path.
function stubDiscovery(
  server: URL,
  clientId: string,
  clientSecret: string,
): Promise<Configuration> {
  return Promise.resolve(__buildStubConfiguration(server, clientId, clientSecret));
}

Given('the dev OIDC environment is set', function (this: AConversaWorld) {
  // Values mirror `.env.example` — same client id, same dev secret,
  // same issuer URL pattern. The step uses an explicit Record rather
  // than mutating `process.env` so the scenario is hermetic — no
  // cross-scenario env leakage. The redirect URI relies on the
  // APP_BASE_URL default (`http://localhost:3000`) when not set
  // explicitly; this scenario passes the value explicitly to pin it
  // in the assertion.
  scratch(this).oidcEnv = {
    OIDC_ISSUER_URL: 'http://authelia:9091',
    OIDC_CLIENT_ID: 'aconversa-app-dev',
    OIDC_CLIENT_SECRET: 'aconversa-app-dev-secret',
    APP_BASE_URL: 'http://localhost:3000',
  };
});

When('the OIDC config is loaded', function (this: AConversaWorld) {
  const s = scratch(this);
  assert.ok(s.oidcEnv, 'oidcEnv not initialized — Given step missing');
  s.oidcConfig = loadOidcConfig(s.oidcEnv);
});

Then('the loaded redirect URI is {string}', function (this: AConversaWorld, expected: string) {
  const s = scratch(this);
  assert.ok(s.oidcConfig, 'oidcConfig not loaded — When step missing');
  assert.equal(s.oidcConfig.redirectUri, expected);
});

Then('the loaded client id is {string}', function (this: AConversaWorld, expected: string) {
  const s = scratch(this);
  assert.ok(s.oidcConfig, 'oidcConfig not loaded — When step missing');
  assert.equal(s.oidcConfig.clientId, expected);
});

When('the OIDC client is obtained', async function (this: AConversaWorld) {
  const s = scratch(this);
  assert.ok(s.oidcConfig, 'oidcConfig not loaded — When step missing');
  s.oidcClient = await getOidcClient(s.oidcConfig, {
    discovery: stubDiscovery,
  });
});

Then(
  "the obtained client's metadata client_id is {string}",
  function (this: AConversaWorld, expected: string) {
    const s = scratch(this);
    assert.ok(s.oidcClient, 'oidcClient not obtained — When step missing');
    const metadata = s.oidcClient.clientMetadata();
    assert.equal(metadata.client_id, expected);
  },
);

Then(
  'obtaining the OIDC client again returns the same Configuration instance',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    assert.ok(s.oidcConfig, 'oidcConfig not loaded — Given step missing');
    assert.ok(s.oidcClient, 'oidcClient not obtained — When step missing');
    // Second call against the same config — memoization should
    // return the cached promise's resolved value. We pass the same
    // stubs so a cache miss (which the assertion below catches)
    // wouldn't accidentally succeed by re-stubbing.
    s.oidcClientSecond = await getOidcClient(s.oidcConfig, {
      discovery: stubDiscovery,
    });
    assert.equal(
      s.oidcClientSecond,
      s.oidcClient,
      'expected the cached Configuration instance on the second call',
    );
  },
);
