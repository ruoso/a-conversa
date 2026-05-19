// One-time auth bootstrap shared by every Playwright project that
// reaches a dev user's authed page.
//
// Refinement: tasks/refinements/backend/auth_flow_integration.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//
// **Why this exists.** Before this setup landed, every test that needed
// an authed page ran the full OIDC dance against the dev Authelia
// container — ~30 round-trips per worker against `POST /api/oidc/token`.
// Authelia's per-IP rate limiter (`infra/authelia/configuration.yml`'s
// `regulation` block) starts rejecting requests once the bucket
// overflows; the rejected request surfaces as `OAUTH_RESPONSE_IS_NOT_CONFORM`
// inside `apps/server/src/auth/flow.ts:163`, the callback returns 500,
// and the test fails partway through `loginAs` with the misleading
// `auth-pending-cookie-invalid` envelope.
//
// **Why ALL 12 dev users get jars.** The original setup only dance-d
// alice because all "single-user" tests use alice. Cross-context tests
// (e.g. `participant-lobby.spec.ts` two-debater live update,
// `cross-surface-lobby-start.spec.ts` three-context lobby) need fresh
// contexts for OTHER users — ben + maria + dave + etc. — and were
// running per-test `loginAs` against fresh empty cookie jars. Under
// parallel workers those per-test dances are exactly what trips the
// rate limiter. Pre-seeding one jar per dev user converts each
// consumer to "load cookies and go" and confines all OIDC dances to
// this setup spec — which runs ONCE per suite, sequentially over the
// 12 users (sequenced via `test.describe.configure({ mode: 'serial' })`
// so even within this spec the rate limiter cannot trip).
//
// The dev user pool is the 12-user roster from
// `part_e2e_user_pool_expansion` (`DEV_USER_POOL` exported by
// `tests/e2e/fixtures/auth.ts`). Any future expansion to that roster
// reaches here automatically — no per-user setup boilerplate.

import { test as setup } from '@playwright/test';

import { DEV_USER_POOL, loginAs } from './fixtures/auth';
import { authStorageStatePath } from './fixtures/auth-storage-path';

// Serialize the 12 dances. Even though they all run in this single
// setup spec, Playwright's `fullyParallel: true` would otherwise let
// them race onto the same worker pool concurrently. Sequential
// execution keeps the OIDC token requests ordered and makes the
// setup deterministic. The Authelia rate-limit on `/api/oidc/token`
// is relaxed in dev via `infra/authelia/configuration.yml`'s
// `server.endpoints.rate_limits.session_elevation_finish` block (and
// the generic OAuth endpoint overrides) — see that file's `rate_limits`
// stanza for the absorption rationale.
setup.describe.configure({ mode: 'serial' });

for (const username of DEV_USER_POOL) {
  setup(`authenticate ${username} and persist storage state`, async ({ page }) => {
    // The project's `storageState` already seeds the `aconversa_locale`
    // cookie (en-US in every consuming project), so the OIDC dance
    // inherits a locale-aware page from the first request. `loginAs`
    // mutates the page's context cookies in place; saving via
    // `context.storageState({ path })` captures every cookie set during
    // the dance (`authelia_session`, `aconversa-session`) alongside the
    // pre-seeded locale cookie. Subsequent worker startups load the
    // file as their initial state.
    await loginAs(page, { username });
    await page.context().storageState({ path: authStorageStatePath(username) });
  });
}
