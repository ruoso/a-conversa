// Shared filesystem paths for the per-user auth-state JSONs written by
// `tests/e2e/global-auth.setup.ts` and consumed by every project that
// needs an authed page for one of the 12 dev users
// (`alice`/`ben`/`maria`/`dave`/`erin`/`frank`/`grace`/`henry`/
// `ivan`/`julia`/`kate`/`leo`).
//
// Lives in a one-line module so the setup spec, the Playwright config,
// and the cross-context test fixtures import it from the same canonical
// location without depending on each other.
//
// **Why per-user jars matter.** The default project-level
// `storageState` in `playwright.config.ts` loads alice's jar (the
// historical single-user bootstrap). Cross-context tests that need a
// second or third real user (e.g. ben + maria appearing in alice's
// lobby) cannot share alice's cookies — but they also cannot afford
// the per-test OIDC dance, which trips Authelia's per-IP rate limiter
// once enough parallel workers stack OIDC token requests on the same
// IP. Pre-seeding one jar per user converts each consumer from "do
// an OIDC dance under load" to "load this user's cookies and go" —
// the setup-time dances are serialized in `global-auth.setup.ts` so
// the rate limiter never trips during the warm-up window either.

import { resolve } from 'node:path';

/**
 * Filesystem path where `global-auth.setup.ts` writes the storage-state
 * JSON for one dev user. The setup spec persists the jar AFTER one
 * `loginAs(page, { username })` so the file contains the full cookie
 * set (authelia_session + aconversa-session + pre-seeded locale).
 *
 * Tests that need a specific user's authed context construct the jar
 * path via this helper and pass it as `storageState` to
 * `browser.newContext()`.
 */
export function authStorageStatePath(username: string): string {
  return resolve(process.cwd(), `tests/e2e/.auth/${username}.storage-state.json`);
}

/**
 * Backwards-compatible alias for alice's jar — kept so the Playwright
 * config's per-project `storageState: AUTH_STORAGE_STATE_PATH` lines
 * (which all load alice's jar) don't need to be touched. New code
 * should prefer `authStorageStatePath('alice')` for symmetry with the
 * other 11 users.
 */
export const AUTH_STORAGE_STATE_PATH = authStorageStatePath('alice');
