// One-time auth bootstrap shared by every Playwright project that
// reaches the moderator console as `alice`.
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
// The setup spec drives one full OIDC handshake per project that needs
// auth and writes the resulting cookie jar to `tests/e2e/.auth/alice.json`.
// The per-project `storageState` in `playwright.config.ts` loads that
// file so each test starts already authenticated; `loginAs` short-
// circuits on a `/api/auth/me === 200` probe and the OIDC dance never
// runs again within the suite.

import { test as setup } from '@playwright/test';

import { loginAs } from './fixtures/auth';
import { AUTH_STORAGE_STATE_PATH } from './fixtures/auth-storage-path';

const TEST_USERNAME = 'alice';

setup(`authenticate ${TEST_USERNAME} and persist storage state`, async ({ page }) => {
  // The project's `storageState` already seeds the `aconversa_locale`
  // cookie (en-US in every consuming project), so the OIDC dance
  // inherits a locale-aware page from the first request. `loginAs`
  // mutates the page's context cookies in place; saving via
  // `context.storageState({ path })` captures every cookie set during
  // the dance (`authelia_session`, `aconversa-session`) alongside the
  // pre-seeded locale cookie. Subsequent worker startups load the
  // file as their initial state.
  await loginAs(page, { username: TEST_USERNAME });
  await page.context().storageState({ path: AUTH_STORAGE_STATE_PATH });
});
