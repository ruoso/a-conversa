// Helpers for cross-context Playwright tests that need to drive
// multiple browsers as different dev users without paying the per-test
// OIDC cost.
//
// Refinement: tasks/refinements/backend/auth_flow_integration.md
//
// **What this exists for.** Tests like the two-debater lobby live-
// update scenario and the cross-surface lobby + start-debate gesture
// open 2-3 real `browser.newContext()` instances so each user has
// their own cookie jar. The historical pattern was
// `freshContext(browser)` (an empty cookie jar) + `loginAs(page, ...)`
// — which forced the OIDC dance for every user on every test run.
// Under parallel workers that fans 10+ concurrent
// `POST /api/oidc/token` requests at Authelia from the same app-server
// IP and trips Authelia's per-IP rate limiter (the limiter response
// surfaces inside `openid-client` as `OAUTH_RESPONSE_IS_NOT_CONFORM`
// → 500 on `/api/auth/callback`).
//
// The pre-seeded jars written by `global-auth.setup.ts` already hold
// a valid `authelia_session` + `aconversa-session` cookie pair for
// every dev user. Loading the jar into a fresh context produces a
// browser that is **already authenticated** as the target user — no
// OIDC dance at test runtime, no rate-limit risk.

import type { Browser, BrowserContext } from '@playwright/test';

import { authStorageStatePath } from './auth-storage-path';

/**
 * Open a fresh browser context already authenticated as the given dev
 * user by loading their pre-seeded cookie jar.
 *
 * **Trade-offs vs `freshContext(browser)` + `loginAs(page, ...)`:**
 *
 *   - **No OIDC dance at test runtime** — load completes in ~10ms vs
 *     ~3-5s for a full Authelia handshake. The headline reliability
 *     win is the rate-limit avoidance (see module header).
 *   - **State that the OIDC dance would have created server-side is
 *     already present** because `global-auth.setup.ts` did the dance
 *     once during setup. Tests that depend on first-login side effects
 *     (e.g. user-record creation flow under test) must still drive
 *     `loginAs` explicitly.
 *
 * The `ignoreHTTPSErrors: true` matches the consuming project's
 * profile (every cross-context test today crosses the Authelia self-
 * signed cert on `https://authelia.aconversa.local:9091`).
 */
export async function authedContext(browser: Browser, username: string): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: authStorageStatePath(username),
  });
}
