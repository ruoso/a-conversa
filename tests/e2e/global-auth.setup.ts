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

import { existsSync, statSync, unlinkSync } from 'node:fs';

import { request as playwrightRequest, test as setup } from '@playwright/test';

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

// Reuse a stored auth jar if it is still fresh. The
// `aconversa-session` JWT carries a 7-day lifetime
// (`auth.flow.SessionTokenPayload` in `apps/server/src/auth`), so a
// 6-hour reuse window is well inside the expiry while being long
// enough to cover any reasonable repeat-run cadence
// (`scripts/e2e-loop.sh` chains dozens of suite invocations against
// the same compose stack; each invocation re-runs `setup-auth`,
// which without this short-circuit re-fires the full 12-user OIDC
// dance and eventually trips Authelia's per-IP regulation bucket —
// observed at loop iter-013 after ~150 dances, where henry's dance
// hung waiting for the Authelia login form to render).
const STORAGE_REUSE_WINDOW_MS = 6 * 60 * 60 * 1_000;

/**
 * Validate that an on-disk jar's cookies still resolve to a real
 * authenticated user under the CURRENT app stack. The age short-circuit
 * above only checks the file's mtime; it cannot tell whether the DB +
 * Authelia sqlite were wiped between runs (which is what `make down-v`
 * does — and which leaves the jar's `aconversa-session` JWT pointing
 * at a now-deleted user row). A jar that survives `make down-v` looks
 * "fresh" to mtime but is functionally dead: the session cookie's
 * `sub` claim references a `users.user_id` that no longer exists, so
 * the SPA's first `/api/auth/me` probe returns 401 and the test stalls
 * on the auth-pending redirect.
 *
 * The probe loads the jar's cookies into a fresh request context,
 * hits `GET /api/auth/me`, and accepts the jar ONLY if the response
 * is 200 AND the body's `screenName` matches the username (per
 * `loginAs` step 5, the default screen name is the username unless
 * overridden — `global-auth.setup.ts` calls `loginAs(page, { username })`
 * without `screenName`, so the saved jar's user has `screenName ===
 * username` by construction).
 *
 * On any failure (non-200, screenName mismatch, network error), the
 * jar file is deleted and the caller falls through to the full OIDC
 * dance. Deleting (rather than just returning false) means a future
 * mtime-fresh-but-DB-stale jar cannot keep tripping this branch on
 * every retry within the same suite — once invalidated, the next
 * attempt starts from a clean slate.
 */
async function jarBacksLiveUser(path: string, username: string): Promise<boolean> {
  let probeContext: Awaited<ReturnType<typeof playwrightRequest.newContext>> | undefined;
  try {
    probeContext = await playwrightRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
      storageState: path,
      ignoreHTTPSErrors: true,
    });
    const response = await probeContext.get('/api/auth/me');
    if (response.status() !== 200) {
      return false;
    }
    const body = (await response.json()) as { userId?: string; screenName?: string };
    return body.screenName === username;
  } catch {
    return false;
  } finally {
    if (probeContext) {
      await probeContext.dispose();
    }
  }
}

for (const username of DEV_USER_POOL) {
  setup(`authenticate ${username} and persist storage state`, async ({ page }) => {
    const path = authStorageStatePath(username);
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < STORAGE_REUSE_WINDOW_MS) {
      // Mtime-fresh — but `make down-v` (or any DB/Authelia-sqlite
      // wipe) survives the jar on disk while invalidating its cookies'
      // server-side backing. Probe `/api/auth/me` before short-circuiting;
      // skip the dance only when the cookie still resolves to a real
      // user whose screenName matches the username.
      if (await jarBacksLiveUser(path, username)) {
        return;
      }
      // Stale jar — delete it so the next attempt within this suite
      // starts from a known-clean baseline, then fall through to the
      // full OIDC dance.
      try {
        unlinkSync(path);
      } catch {
        // Best effort — the dance below will overwrite the file via
        // `context.storageState({ path })` regardless.
      }
    }
    // The project's `storageState` already seeds the `aconversa_locale`
    // cookie (en-US in every consuming project), so the OIDC dance
    // inherits a locale-aware page from the first request. `loginAs`
    // mutates the page's context cookies in place; saving via
    // `context.storageState({ path })` captures every cookie set during
    // the dance (`authelia_session`, `aconversa-session`) alongside the
    // pre-seeded locale cookie. Subsequent worker startups load the
    // file as their initial state.
    await loginAs(page, { username });
    await page.context().storageState({ path });
  });
}
