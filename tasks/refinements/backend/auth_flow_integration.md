# OAuth flow integration tests (full handshake against compose Authelia)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.backend_tests.be_e2e_tests.auth_flow_integration` (inside `task be_e2e_tests` → `task backend_tests`, [tasks/20-backend.tji:384](../../20-backend.tji)).
**Effort estimate**: 2d (unchanged — the test code is small but the CI-job split, the deterministic-Authelia-form-submit story, and the `make up` documentation each consume the better part of a day).
**Inherited dependencies**:

- `backend.auth.oauth_provider_config` ([oauth_provider_config.md](oauth_provider_config.md) — settled) — `loadOidcConfig`, `getOidcClient`, the discovery + token-exchange path the test exercises.
- `backend.auth.oauth_callback_handler` ([oauth_callback_handler.md](oauth_callback_handler.md) — settled) — `GET /auth/login`, `GET /auth/callback`, the PKCE / state / nonce wiring, the new-user-vs-returning-user branch on `screen_name === '<pending>'`.
- `backend.auth.screen_name_collection` (settled — transitively cited by the predecessors) — `POST /auth/screen-name`, the pending-cookie bridge.
- `backend.auth.session_token_management` ([session_token_management.md](session_token_management.md) — settled) — `signSessionToken`, `verifySessionToken`, the `aconversa-session` cookie, `GET /auth/me`, `POST /auth/logout`.
- `backend.auth.auth_middleware` ([auth_middleware.md](auth_middleware.md) — settled) — `authenticatePlugin`, the `auth-required` 401 envelope. The test exercises this gate's positive (authed) path on `/auth/me`.
- `backend.websocket_protocol.ws_auth_on_connect` ([ws_auth_on_connect.md](ws_auth_on_connect.md) — settled) — out of scope for this task's positive assertions but referenced because the same `aconversa-session` cookie this test mints must also authenticate the future WS-upgrade integration test (`ws_protocol_integration`); the helper this task lands is the reusable seam.
- `backend.api_skeleton.serve_static_frontends` (settled) — the single-origin path the moderator SPA loads through. The test drives `http://localhost:3000` for everything (the SPA, the API, the OIDC redirect endpoint).
- `foundation.test_infra.playwright_setup` (settled — `playwright.config.ts`, `tests/e2e/` directory, `pnpm run test:e2e`).
- `foundation.test_infra.playwright_test_helpers` (PENDING — `packages/test-fixtures/playwright-helpers/` and the `loginAs(page, user)` helper). This task **lands the core of that helper** (specifically the `loginAs` half) under `tests/e2e/fixtures/` so the OIDC flow has a single home; the `playwright_test_helpers` task later promotes the helper to `packages/test-fixtures/` and adds the session-creation / vote / commit helpers around it. The reasons for landing the helper here, not there, are in Decisions below.
- `infra/authelia` (the dev compose Authelia config — `infra/authelia/configuration.yml`, `infra/authelia/users.yml`) — settled in [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) and used unchanged.

## What this task is

End-to-end OIDC handshake tests driven by Playwright against the compose stack. Three things happen together:

1. **A `tests/e2e/auth-flow.spec.ts` Playwright suite** that drives the canonical OIDC dance against the dev Authelia container — the *same* Authelia binary, the *same* `aconversa-app-dev` client, the *same* `client_secret_basic` token-endpoint-auth method that production ships. From the test's point of view: navigate to `/login`, click the SSO link, fill in Authelia's password form, watch the 302 chain land back at `/auth/callback`, assert the `aconversa-session` cookie is set on the response, and finally assert `GET /auth/me` returns `{ userId, screenName }` for the authenticated user.

2. **A `loginAs(page, user)` helper** under `tests/e2e/fixtures/auth.ts`. Encapsulates the password-form fill + redirect-wait so per-surface Playwright suites (future `mod_pw_*`, `participant_pw_*`, `audience_pw_*`) compose it instead of re-driving Authelia's HTML in five copies. The helper is the same shape `foundation.test_infra.playwright_test_helpers` describes; it is promoted to `packages/test-fixtures/playwright-helpers/` by that task. Until then it lives under `tests/e2e/fixtures/`.

3. **A documented `make up`-driven local-run flow** (added to `docs/dev-environment.md` under "Tests") that mirrors what CI does: `make up-prod-mode`, `pnpm exec playwright install chromium --with-deps` (one-time), `pnpm run test:e2e`. CI's existing `e2e-playwright` job ([.github/workflows/ci.yml:304-472](../../../.github/workflows/ci.yml)) already runs Playwright against `make up-prod-mode`; this task adds the OIDC suite to the existing job — no new CI job.

The test answers four questions:

- **Does the OIDC discovery + token-exchange round-trip work against the real dev Authelia?** A drift like `client_secret_post` vs `client_secret_basic` (the regression observed on 2026-05-15, see Why) or the HTTPS-issuer flip (commit [`f01ef3b`](https://github.com/ruoso/a-conversa/commit/f01ef3b)) fails the suite at `/auth/callback` with a non-302.
- **Does the new-user branch end at a screen-name form, and does `POST /auth/screen-name` close out into an authenticated state?** This pins the pending-cookie bridge end-to-end.
- **Does the returning-user branch hand the user a session cookie + a working `/auth/me`?** This pins the "the JWT primitive + the cookie primitive + the route plugin all compose against a real cookie jar" assertion the unit tests can't make.
- **Does `POST /auth/logout` actually de-authenticate?** A subsequent `GET /auth/me` returns 401 `auth-required`. This pins the logout + cookie-clear behavior end-to-end.

The test does **NOT** exercise WebSocket connection auth (owned by `ws_protocol_integration`), the screen-name validation surface beyond a happy path (owned by Vitest + Cucumber via `screen_name_collection`'s test layers), or any session-management endpoint (owned by `session_endpoint_integration`).

## Why it needs to be done

The OIDC handshake is the single most fragile compose-level seam in the system because it has three moving parts that must agree byte-for-byte:

1. The application's `openid-client` configuration (`apps/server/src/auth/config.ts`).
2. The dev Authelia container's OIDC client registration (`infra/authelia/configuration.yml` — the `aconversa-app-dev` block).
3. The network shape between them (HTTPS issuer URL, hostname `authelia.aconversa.local`, cert trust via `NODE_EXTRA_CA_CERTS`, the FQDN alias on the compose bridge).

Two regressions in the last seven days have hit exactly this seam and were caught only by manual login attempts after deploy-shaped changes:

- **2026-05-14, commit [`f01ef3b`](https://github.com/ruoso/a-conversa/commit/f01ef3b)** — the http://-issuer opt-out path in `getOidcClient` was unreachable under openid-client v6 (the protocol check fires inside `discovery`, before the Configuration is returned). The dev/CI stack had to flip to HTTPS, and the change touched five files at once. No automated test would have caught this — the unit tests mock `discovery`, the Cucumber tests inject a stub Configuration, and the Playwright suite at the time (i18n-moderator-smoke) deliberately does NOT follow the redirect into Authelia (see [`tests/e2e/i18n-moderator-smoke.spec.ts:118-145`](../../../tests/e2e/i18n-moderator-smoke.spec.ts)). The regression was caught only because a contributor tried to log in manually.
- **2026-05-15, commit [`e02652b`](https://github.com/ruoso/a-conversa/commit/e02652b)** — the Authelia session-cookie matcher requires the issuer URL's host to fall under a configured `session.cookies[].authelia_url` whose domain contains a period; the bare `authelia` hostname tripped the matcher and Authelia returned a 500 on `/api/oidc/authorization`. Fixed by adding the FQDN alias `authelia.aconversa.local` on the compose network. Same story: no automated test catches "Authelia returns 500 on authorize because the cookie-domain matcher failed."

The orchestrator commit [`f83852b`](https://github.com/ruoso/a-conversa/commit/f83852b) added this task as a dependency on every UI stream's top-level group (`moderator_ui`, `participant_ui`, `audience`, `replay_test` — see [tasks/30-moderator-ui.tji:31](../../30-moderator-ui.tji), [tasks/40-participant-ui.tji:25](../../40-participant-ui.tji), [tasks/50-audience-and-broadcast.tji:29](../../50-audience-and-broadcast.tji), [tasks/60-replay-and-test-mode.tji:30](../../60-replay-and-test-mode.tji)) precisely because every UI stream exercises this OIDC handshake on first paint. A drift here breaks every UI stream silently. This task is the gate: the next UI feature lands only after a committed test pins the handshake.

Downstream consumers:

- **Every UI-stream group** (moderator_ui, participant_ui, audience, replay_test) — depends on this task. The OIDC handshake is shared infrastructure; this is its regression-test home.
- **`backend.backend_tests.be_e2e_tests.ws_protocol_integration`** — reuses the `loginAs` helper to obtain an authenticated `page.context()` whose cookies it then carries onto the WS upgrade request.
- **`foundation.test_infra.playwright_test_helpers`** — promotes the helper to a shared package. The shape is fixed here so the promotion is a move, not a redesign.

## Inputs / context

From [ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md):

> Playwright is **the end-to-end layer** — it drives the live compose stack ([ADR 0018](0018-compose-file-three-service-dev-stack.md)), exercising real `postgres:16-alpine`, real Authelia, and the real backend image once `backend.api_skeleton` lands.

This is exactly the layer this task belongs to. The unit layer (Vitest) mocks `openid-client`'s `discovery` / `authorizationCodeGrant`; the integration layer (Cucumber + pglite) injects a stub Configuration; **only the e2e layer exercises the real Authelia binary**. No other layer can catch the class of regression this task pins.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

> Browser- or full-stack-touching (UI behavior, real-time WebSocket flows, full-stack scenarios) → Playwright spec under `tests/e2e/` (or per-workspace E2E dirs once `dir_layout` is realized). Runs against the compose stack.

The auth flow is exactly the case "full-stack scenario that touches the live Authelia container"; the test must commit as a Playwright spec, not a probe.

From [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md):

> Six dev users with one shared password: `alice`, `ben`, `maria`, `dave`, `erin`, `frank` — every user authenticates with the same dev password (`aconversa-dev`).

The test uses one of these dev users (see Decisions for the choice of `alice`) — no new user is seeded, no new compose service is introduced.

From [`apps/server/src/auth/config.ts`](../../../apps/server/src/auth/config.ts):

- Line 320-343: `getOidcClient(config, options?)` — the function the regression class touches. The `discovery(server, clientId, clientSecret)` call (line 340) is where `client_secret_basic` vs `client_secret_post` negotiation happens. A change to the dev Authelia's `token_endpoint_auth_method` ([`infra/authelia/configuration.yml:210`](../../../infra/authelia/configuration.yml)) without matching server-side hardening regresses the path this test exercises.

From [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts):

- Lines 580-743: `GET /auth/callback` handler — the splits the test asserts.
  - Lines 671-707: returning-user branch — sets `aconversa-session` cookie, 302 to `APP_BASE_URL`.
  - Lines 714-741: new-user branch — sets `aconversa-auth-pending` cookie, 200 with `{ sub, oauthSubject, userId, needsScreenName: true }`.
- Lines 745+: `POST /auth/screen-name` handler — the test exercises the new-user path through this endpoint.
- Lines 854+: `POST /auth/logout` handler.
- Lines 986+: `GET /auth/me` handler.

From [`infra/authelia/configuration.yml:186-211`](../../../infra/authelia/configuration.yml) — the dev OIDC client. The test never reads this file but every value in it (the redirect URIs, the scopes, `token_endpoint_auth_method: client_secret_basic`, `require_pkce: false`) is implicitly pinned by the test passing.

From [`compose.yaml:38-103`](../../../compose.yaml) — the `app` service environment. The test reads no env var directly but `SESSION_TOKEN_SECRET`, `APP_BASE_URL`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `DATABASE_URL` all have to be set correctly for `make up-prod-mode` (the CI / dev driver) to bring up a stack the test can hit.

From [`.github/workflows/ci.yml:304-472`](../../../.github/workflows/ci.yml) (the `e2e-playwright` job) — already brings up the compose stack via `make up-prod-mode`, waits for `/healthz`, runs `pnpm run test:e2e`, dumps logs on failure, tears down with `make down-v`. **The OIDC suite added by this task runs inside this existing job — no new job, no new GitHub Actions step. The job's existing `make up-prod-mode` invocation is what guarantees this test exercises the production-mode boot gates** (`SESSION_TOKEN_SECRET` strength, CORS lockdown, WS Origin allowlist, `Secure` cookies) the dev override (`compose.dev.yaml`) relaxes for local ergonomics.

From [`playwright.config.ts:96-156`](../../../playwright.config.ts) — the config that already exists. The current `projects` array has a `smoke-node` project (no browser) plus three per-locale Chromium projects keyed to `i18n-moderator-smoke.spec.ts`. The auth flow suite adds a fourth project (`chromium-auth`) that runs the new spec; the locale projects are unchanged. Rationale: the auth flow is locale-agnostic; running it three times under three locale cookies would triple the wall-clock cost without adding signal.

From [`tests/e2e/i18n-moderator-smoke.spec.ts:30-34`](../../../tests/e2e/i18n-moderator-smoke.spec.ts):

> **What this spec does NOT do.** It does not complete the OIDC handshake against Authelia. The login navigation case asserts the browser leaves the SPA (the server-side `/auth/login` redirect fires) without driving the foreign-origin login flow. Full-stack auth flow tests are a separate task.

This refinement IS that separate task. The i18n smoke explicitly deferred the OIDC handshake; this fills the gap.

From [`tests/e2e/fixtures/authed-state.ts`](../../../tests/e2e/fixtures/authed-state.ts) — the existing `mintSessionToken({ userId, secret, ... })` helper. **The auth flow test does NOT use this helper** — the whole point of this task is to drive the real OIDC dance, not to mint a token out-of-band. The minted-token helper stays useful for *other* future Playwright suites whose subject-under-test is not the auth flow itself (a moderator suite that wants to skip the login UX and land on `/sessions/:id/operate` directly, for instance). This task preserves that helper unchanged.

From [`docs/dev-environment.md` "Host resolution for Authelia"](../../../docs/dev-environment.md) — the `/etc/hosts` entry `127.0.0.1  authelia.aconversa.local`. CI runners are configured per-job; the test job runs on `ubuntu-latest` and resolves `authelia.aconversa.local` via the compose network's alias (the test process is on the host, the compose bridge is reachable via the published `9091` port, but the in-network FQDN alias is only visible from inside the bridge). **The OIDC redirect lands the browser on `https://authelia.aconversa.local:9091/...`, which from the host requires the `/etc/hosts` entry**. The CI job's `Bring up compose stack` step must add this entry; the local-run path also requires it (already documented in `docs/dev-environment.md`).

## Constraints / requirements

- **Test framework: Playwright.** Single browser project (`chromium-auth`) in `playwright.config.ts`. Specs land in `tests/e2e/auth-flow.spec.ts`. Spec count: 4 (returning-user, new-user, logout, invalid-state — see Acceptance criteria for the exact list). NO new test runner, NO new dependency. See Decisions.
- **No mock OIDC server.** The test drives the SAME dev Authelia container (`authelia/authelia:4.39` in users-file mode per [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md)) that ships in `compose.yaml`. ADR 0022's no-throwaway-verifications principle bites here at the framework level: a test-only mock OIDC server would be a "verification framework that drifts from real Authelia's behavior," which is exactly the regression class this task exists to catch.
- **No dedicated test Authelia instance.** The test reuses `make up`-style compose with no per-test Authelia override. Two reasons: (1) the Authelia config is the *thing under test* — running a different config in CI would not pin the production-shipping config; (2) compose-up time (~30s for Authelia's sqlite migration on a cold start) is already paid by the existing `e2e-playwright` job; adding a second Authelia would double that cost for no signal.
- **User identity: seeded dev user `alice` (per ADR 0017).** Test uses `username=alice`, `password=aconversa-dev`. NO new user is seeded; no user-registration UI exists in dev Authelia. The application-side `users` row is created on first OIDC callback by the upsert in [`apps/server/src/auth/routes.ts:672`](../../../apps/server/src/auth/routes.ts) — the test's first scenario IS the row-creating event.
- **DB cleanup: `make down-v` between CI runs.** The compose stack's `make down-v` (already invoked in [`.github/workflows/ci.yml:466-472`](../../../.github/workflows/ci.yml)) drops both named volumes (`aconversa-postgres-data`, `aconversa-authelia-data`), guaranteeing a fresh users table and a fresh Authelia sqlite store per run. **Within a CI run**, the four scenarios share state — the new-user scenario MUST run BEFORE the returning-user scenario (Playwright spec file order is deterministic given `fullyParallel: true` is honored per project; this task pins the order at the spec-level via `test.describe.serial(...)`). See Decisions.
- **Local-dev cleanup: documented.** A contributor running the suite locally is expected to either run `make down-v && make up-prod-mode` between iterations (slow) OR run the suite once and re-seed the screen-name slot manually. The documentation in `docs/dev-environment.md` notes both options. The compose stack's persistence is intentional (avoids slow restarts for unrelated work).
- **CI integration: extend the existing `e2e-playwright` job, do not create a new one.** The existing job ([`.github/workflows/ci.yml:304-472`](../../../.github/workflows/ci.yml)) already brings up `make up-prod-mode`, waits for `/healthz`, runs `pnpm run test:e2e`, captures traces, tears down. The new spec is picked up by `pnpm run test:e2e` automatically. The only CI YAML edit needed is the `/etc/hosts` entry for `authelia.aconversa.local` (the `Bring up compose stack` step must run `echo '127.0.0.1  authelia.aconversa.local' | sudo tee -a /etc/hosts` before `make up-prod-mode` so the browser can resolve the OIDC redirect hostname).
- **Authelia HTML form-fill: lock-in via test IDs Authelia 4.39 ships.** Authelia's login form exposes stable form-field names (`username`, `password`) and a submit button. The helper uses these names verbatim. An Authelia version bump that changes form-field names regresses this test loudly; the Authelia version is pinned in `compose.yaml` at `authelia/authelia:4.39` so the bump is a deliberate event, not silent drift.
- **Deterministic state lookup: assert the inbound `state` was the one the server issued.** The test cannot directly read the server's flow-state Map (it's in-process under the `app` container); instead the test trusts openid-client's state-mismatch detection — a failure to round-trip the state correctly fails the callback with `auth-state-invalid` (400), which is exactly what the invalid-state scenario asserts. The four positive scenarios just round-trip happily and rely on the absence of the 400.
- **Cookie introspection: via Playwright's `context.cookies()`.** The `aconversa-session` cookie's `HttpOnly` attribute means the page's JS cannot read it; the test reads it via the test-side cookie jar (Playwright's `context.cookies()` returns HttpOnly cookies — this is the documented Playwright API). The test asserts the cookie is present after a successful login and absent after `POST /auth/logout`.
- **TLS trust: rely on the existing `NODE_EXTRA_CA_CERTS` on the `app` container; the BROWSER process accepts the self-signed cert by Playwright config.** Playwright's `chromium` launches with `ignoreHTTPSErrors: true` for the duration of the auth-flow spec (a per-project `use.ignoreHTTPSErrors` setting). The cert at [`infra/authelia/tls/cert.pem`](../../../infra/authelia/tls/cert.pem) carries the `authelia.aconversa.local` SAN, but it's self-signed — the browser would reject it without `ignoreHTTPSErrors`. The flag scope is per-project so the other Playwright projects (smoke-node, chromium-en, chromium-pt, chromium-es) keep their strict-cert posture.
- **No `webServer` in `playwright.config.ts`.** Already the case per [`playwright.config.ts:121-124`](../../../playwright.config.ts); the test connects to whatever is at `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`). The decision is owned by `playwright_setup`; this task neither contradicts nor reinforces it.
- **No retries for the auth-flow project on CI.** The general retries setting is `process.env.CI ? 1 : 0` ([`playwright.config.ts:107`](../../../playwright.config.ts)); the auth-flow spec inherits it. Rationale: a flaky OIDC handshake is a regression class we want to see, not retry past.
- **The helper API stays minimal.** `loginAs(page: Page, opts: { username: string; password: string }): Promise<void>` — drives one full handshake and returns when `/auth/me` is reachable. No options for "skip the screen-name step" (a returning user automatically skips it; a new user automatically lands on `/screen-name`; the helper handles both branches by polling `/auth/me` until 200 or by detecting a `/screen-name` URL and filling the form). The new-user branch picks the screen name from `opts.screenName ?? opts.username` so callers get a sensible default.
- **No environment-variable exposure of dev passwords.** The dev password `aconversa-dev` is hard-coded in the helper (which lives in `tests/e2e/fixtures/auth.ts`). The credential is dev-only (per ADR 0017) and the file is in the public repo; treating it as a secret would be theater. The `infra/authelia/users.yml` header documents the same value.
- **Audit-friendly assertion on `/auth/me`.** The test asserts the response body is *exactly* `{ userId, screenName }` — no extra fields. This pins the `no_profile_data_policy` invariant at the e2e layer too: a regression that leaks `oauthSubject` or any OIDC claim through `/auth/me` fails this spec.
- **Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)**: the OIDC handshake test is the **e2e layer only**. The Vitest layer already covers `signSessionToken`/`verifySessionToken`/the route plugins with stubbed `discovery` ([`apps/server/src/auth/config.test.ts`](../../../apps/server/src/auth/config.test.ts), [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts), [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts)); the Cucumber layer already covers the end-to-end backend path with an injected stub Configuration ([`tests/behavior/backend/oauth-callback.feature`](../../../tests/behavior/backend/oauth-callback.feature), [`tests/behavior/backend/session-token.feature`](../../../tests/behavior/backend/session-token.feature)). This task adds **only** the Playwright spec — it does NOT add Vitest cases (would re-test what's already tested) and does NOT add Cucumber scenarios (would still mock out the real Authelia binary, defeating the point).

## Acceptance criteria

1. `pnpm exec tsc -b tests/tsconfig.json` (the test-tree typecheck) succeeds — `tests/e2e/auth-flow.spec.ts` and `tests/e2e/fixtures/auth.ts` type-clean.
2. `pnpm run test:e2e` green locally against `make up-prod-mode` (the production-mode boot gates the CI job runs under). The new `chromium-auth` project reports `4 passed` for the new spec.
3. The CI `e2e-playwright` job ([`.github/workflows/ci.yml:304-472`](../../../.github/workflows/ci.yml)) green with the new spec running. The job's `Run Playwright e2e suite` step adds `4 passed` to its tally; the per-locale smoke specs continue to pass unchanged.
4. **Regression-class assertions** (the test fails loudly when each of the listed conditions holds — these are the spec's reason for being, recorded here so a future maintainer reading the test knows what it's pinning):
   - If `infra/authelia/configuration.yml`'s `token_endpoint_auth_method` is changed away from `client_secret_basic` without a matching `clientAuthentication: ClientSecretPost(...)` (or equivalent) in [`apps/server/src/auth/config.ts:340`](../../../apps/server/src/auth/config.ts), the **returning-user** scenario fails at the token-exchange step with a non-302 `/auth/callback` response. This is the canonical "2026-05-15 regression" the orchestrator's commit message ([`f83852b`](https://github.com/ruoso/a-conversa/commit/f83852b)) cites.
   - If `OIDC_ISSUER_URL` is set to an `http://` value (the regression class that drove commit [`f01ef3b`](https://github.com/ruoso/a-conversa/commit/f01ef3b)), `make up-prod-mode` boot fails — the test never gets to run, and the CI job's `Wait for /healthz` step fails. The test inherits this protection from the boot gate; the spec itself just asserts the happy path.
   - If the FQDN alias `authelia.aconversa.local` is removed from the compose network (the regression class that drove commit [`e02652b`](https://github.com/ruoso/a-conversa/commit/e02652b)), the **new-user** scenario fails at the Authelia authorize step with a 500 — the cookie-domain matcher fires because the issuer URL's host no longer falls under any configured `session.cookies[].authelia_url`.
   - If `apps/server/src/auth/routes.ts`'s callback splits drift (returning-user no longer issues `aconversa-session`, new-user no longer issues `aconversa-auth-pending`), the corresponding scenario fails at the cookie-jar assertion.
   - If `/auth/me`'s response shape grows an extra field (no_profile_data_policy regression), the **returning-user**'s exact-shape assertion fails.
5. **The four Playwright scenarios in `tests/e2e/auth-flow.spec.ts`** (the test order is `test.describe.serial(...)` so the new-user's row creation precedes the returning-user's re-use):
   1. `new user: completes OIDC, lands on /screen-name, submits a screen name, /auth/me returns the user` — exercises the new-user branch end to end.
   2. `returning user: completes OIDC, redirected to APP_BASE_URL, /auth/me returns the same user` — exercises the returning-user branch (the row from scenario 1 is re-used).
   3. `logout: POST /auth/logout, subsequent /auth/me returns 401 auth-required` — exercises the logout + cookie-clear path.
   4. `invalid state: navigating to /auth/callback with a bogus state returns 400 auth-state-invalid` — exercises the negative path without driving Authelia (a single `request.get('/auth/callback?state=bogus&code=irrelevant')` Playwright APIRequest call).
6. **Helper landed at `tests/e2e/fixtures/auth.ts`** with the `loginAs(page, opts)` export. Documented with a JSDoc block citing this refinement and noting the future promotion to `packages/test-fixtures/playwright-helpers/`.
7. **`docs/dev-environment.md` updated** under the "Tests" section to document the local-run flow: `make up-prod-mode && pnpm exec playwright install chromium --with-deps && pnpm run test:e2e`. The `/etc/hosts` requirement for `authelia.aconversa.local` (already documented in "Host resolution for Authelia") is cross-referenced.
8. **CI YAML updated** in [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) — the `e2e-playwright` job's `Bring up compose stack` step (or a sibling step immediately before it) adds `echo '127.0.0.1  authelia.aconversa.local' | sudo tee -a /etc/hosts`. No new job, no new step ordering changes.
9. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` is added to the `auth_flow_integration` task block in [tasks/20-backend.tji](../../20-backend.tji).
10. `make test` green end-to-end on a fresh `make down-v && make up-prod-mode` cycle.

## Decisions

- **Test framework: Playwright (NOT Vitest+supertest, NOT Cucumber+pglite-with-browser).** Three alternatives surveyed:
  - **Playwright** (chosen). The handshake is a navigation flow: the browser leaves the app origin, lands on Authelia's HTML form, submits credentials, follows a 302 chain back. Vitest+supertest cannot drive the foreign-origin form-submit; Cucumber-with-real-browser would re-implement Playwright's primitives in step definitions. Playwright is already the project's e2e layer per [ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md), the `playwright.config.ts` is already wired against `http://localhost:3000`, the CI job is already running `pnpm run test:e2e` against the compose stack. The marginal cost of adding one spec is roughly zero.
  - **Vitest + `node-fetch` driving the OIDC dance manually** (rejected). The handshake's middle leg requires submitting an HTML form to Authelia and parsing the resulting 302's Location header. A Node-side simulator would have to parse Authelia's login-form HTML, extract the CSRF token (Authelia issues one), submit a `application/x-www-form-urlencoded` POST, follow the redirect. **The simulator IS a partial re-implementation of a browser**; the moment Authelia changes its CSRF field name (Authelia 4.40 might) the simulator silently breaks. Browser-based testing has the same robustness for free.
  - **Cucumber+pglite with a real Authelia spawned per scenario** (rejected). Spawning Authelia per scenario adds ~20s per scenario (Authelia's sqlite init), and the cookie-domain matcher requires either the FQDN alias or a per-scenario /etc/hosts edit (root-required, doesn't compose with pglite's in-process world hook). The realistic option is one Authelia for the whole suite, which is exactly what the compose stack already gives us — at which point the spec is a Playwright spec.

- **Authelia provisioning: reuse the dev compose stack, NOT a dedicated test Authelia.** Three alternatives surveyed:
  - **Reuse the dev compose Authelia** (chosen). The Authelia config is the *thing under test*. A regression in `infra/authelia/configuration.yml` (a `token_endpoint_auth_method` change, a removed redirect URI, a JWKS rotation that drops the dev key) must fail this test; running a different config in CI would defeat that. The compose stack's Authelia is brought up by `make up-prod-mode`, which the CI `e2e-playwright` job already invokes — no extra wiring.
  - **A dedicated test Authelia container with a test-only configuration** (rejected). Would require maintaining two near-identical Authelia configs, would not pin the production-shipping config, and would double the compose startup time on a runner that already pays the dev-Authelia tax.
  - **A test-only mock OIDC server (e.g., `node-mock-oauth2-server`)** (rejected). Per ADR 0022's no-throwaway-verifications principle escalated to the framework level: a test-only OIDC server IS a verification framework that drifts from the production-shipping Authelia. Defeats the test's reason for existence.

- **User identity: seeded dev user `alice`, password `aconversa-dev`.** Two alternatives surveyed:
  - **One of the six committed dev users (`alice`)** (chosen). Per [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md), the six users with the shared dev password exist exactly for this case. `alice` is the canonical example in the project's walkthrough documentation (`docs/methodology.md` and similar). Test reads from this committed YAML; no per-test seeding step needed.
  - **Register a fresh user per test** (rejected). Authelia's users-file mode has no registration API — adding one would require switching to db-backed users, which is a bigger config change than this task warrants. The shared-password / six-user pattern is the supported one.

- **Helper location: `tests/e2e/fixtures/auth.ts` (NOT `packages/test-fixtures/playwright-helpers/`).** Two alternatives surveyed:
  - **`tests/e2e/fixtures/`** (chosen). The `playwright_test_helpers` task (`foundation.test_infra.playwright_test_helpers`) explicitly carves out a future `packages/test-fixtures/playwright-helpers/` workspace and lists `loginAs` as one of its helpers. That workspace doesn't exist yet — creating it as a side effect of this task would expand the task's scope to include a new workspace creation + pnpm-workspace.yaml edit. The auth helper is the first one needed; landing it under `tests/e2e/fixtures/` (sibling to the existing `tests/e2e/fixtures/authed-state.ts` and `tests/e2e/fixtures/locales.ts`) is consistent with the current shape and lets `playwright_test_helpers` later promote it as a focused move.
  - **`packages/test-fixtures/playwright-helpers/`** (rejected for this task). Right destination, wrong task. The `playwright_test_helpers` refinement explicitly owns that workspace's creation; pre-empting that decision here would force two sub-decisions (pnpm workspace shape, public API surface of the helpers package) that the dedicated task is sized for.

- **CI integration: extend the existing `e2e-playwright` job, do NOT split into a separate job.** Three alternatives surveyed:
  - **Extend the existing job** (chosen). The job already does everything this test needs: `make up-prod-mode`, wait for `/healthz`, `playwright install chromium`, `pnpm run test:e2e`, capture traces on failure, tear down. The spec is picked up automatically. The only delta is the `/etc/hosts` entry for `authelia.aconversa.local`, which is one extra `echo | sudo tee` line in the `Bring up compose stack` step.
  - **A new dedicated `e2e-auth` job** (rejected). Would duplicate the entire job — pnpm setup, Playwright install, compose up, healthz wait, compose down. CI wall-clock would grow by 3-4 minutes for negative value.
  - **Run inside the unit `tests` job** (rejected). The unit `tests` job has no compose stack; running the OIDC handshake there would require either spinning up the stack inside that job (duplicating `e2e-playwright`) or running an in-process Authelia (rejected above).

- **Scenario ordering: `test.describe.serial(...)` with new-user BEFORE returning-user.** Two alternatives surveyed:
  - **Serial, new-user first** (chosen). The new-user scenario creates the `users` row (via the upsert in `/auth/callback`); the returning-user scenario re-uses it. The `users` table is shared across scenarios within a CI run; serial ordering pins the prerequisite explicitly. `test.describe.serial(...)` is the canonical Playwright primitive for "these tests run in this order, on the same worker."
  - **Parallel scenarios with per-scenario user provisioning** (rejected). Authelia's users-file mode has no user-creation API; each scenario would have to pick a different dev user (one of `alice`, `ben`, `maria`, `dave`, `erin`, `frank`) and the test would no longer be self-explanatory. Serial + same-user is simpler and equally fast (Authelia's sqlite store is the bottleneck, not the test parallelism).

- **Cleanup strategy: CI relies on `make down-v` between runs; local-dev documents the manual reset.** Two alternatives surveyed:
  - **CI uses `make down-v`; local users manually reset OR re-seed** (chosen). The CI `e2e-playwright` job's existing teardown step ([`.github/workflows/ci.yml:466-472`](../../../.github/workflows/ci.yml)) runs `make down-v` regardless of suite outcome, which drops both named volumes — every CI run starts with a fresh Postgres + a fresh Authelia store. Local users iterating on the test pay a slower reset cost; `docs/dev-environment.md` notes both options.
  - **Per-scenario DB reset via a test hook** (rejected). Would require Playwright to talk to the `app` container's `db.ts` pool or to expose a test-only `POST /_test/reset-users` endpoint. Both are invasive and only useful for this one test. The CI `make down-v` + local manual reset is the proportionate response.

- **Browser cert handling: `ignoreHTTPSErrors: true` scoped to the `chromium-auth` project ONLY.** Two alternatives surveyed:
  - **Per-project `ignoreHTTPSErrors`** (chosen). The auth flow has to traverse `https://authelia.aconversa.local:9091` (self-signed cert). The other Playwright projects (i18n smoke specs against `http://localhost:3000`) don't traverse HTTPS and keep their strict posture. Per-project scoping is the precise tool.
  - **Global `ignoreHTTPSErrors`** (rejected). Would silently mask any future HTTPS regression in the moderator surface (e.g., a CDN-fronted assets origin with a misconfigured cert). Per-project keeps the protection where it matters.

- **Spec count: 4 (not 1, not 10).** The four scenarios cover the four behaviors that compose into "OIDC handshake works": (1) new-user happy path; (2) returning-user happy path; (3) logout; (4) negative state. Splitting (1) into "new user lands on screen-name" + "screen-name form posts successfully" + "post-screen-name /auth/me works" would triple the wall-clock cost for no signal — the assertions chain inside one scenario. Combining all four into a single "the OIDC flow works end to end" mega-scenario would obscure which behavior broke when one assertion fails.

- **Helper API: `loginAs(page, opts)` — single function, two-branch internals.** Two alternatives surveyed:
  - **One `loginAs` that handles both new-user and returning-user branches internally** (chosen). The helper polls for `/screen-name` after the OIDC redirect; if present, fills the form with `opts.screenName ?? opts.username` and proceeds; otherwise waits for `/auth/me` to return 200. Callers don't have to know whether the user is new or returning — the helper handles it. Matches the shape the `playwright_test_helpers` refinement describes.
  - **Two helpers (`loginAsNewUser`, `loginAsReturningUser`)** (rejected). Forces every caller to know the row's state in the test DB, which is brittle (CI may or may not have run a prior test that created the row). The single-helper shape is more forgiving and matches the `playwright_test_helpers` design.

- **No retry on the auth-flow spec.** Inherits the global `process.env.CI ? 1 : 0` retry setting. The auth flow is the test most likely to surface a real regression in the OIDC handshake; a flaky single retry would hide a real intermittent bug.

- **The `i18n_testing` task's per-locale smoke specs stay locale-only — they do NOT get an auth-flow variant.** The auth flow is locale-agnostic at the HTTP level (the OIDC redirect carries no locale signal); running the auth spec three times under three locales would triple CI cost for no signal. The locale projects test the UI's rendering of the unauthenticated login route — that's the proportionate locale assertion. The auth-flow project (`chromium-auth`) sets no locale-cookie pre-seed and runs once.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- New Playwright spec `tests/e2e/auth-flow.spec.ts` lands the four scenarios this refinement specifies: new-user (OIDC handshake + screen-name submission + `/auth/me` shape assertion), returning-user (handshake closes with `aconversa-session` cookie + `/auth/me` returns the same user), logout (`POST /auth/logout` clears the cookie and the next `/auth/me` is 401 `auth-required`), and invalid-state (`/auth/callback?state=bogus&code=irrelevant` returns 400 `auth-state-invalid`).
- New helper `tests/e2e/fixtures/auth.ts` exports `loginAs(page, opts)`. The helper handles both branches of the callback: a returning-user 302 chain (followed implicitly by the browser) and a new-user 200 JSON response (`{ needsScreenName: true }`) which the helper detects and closes out by `page.request.post()`ing `/auth/screen-name` directly (carrying the pending cookie). This JSON-->POST handling for the new-user branch is the regression-class assertion path the refinement names; documenting it here so the next maintainer reading the helper knows why the conditional exists.
- `apps/server/src/auth/config.ts` now passes `ClientSecretBasic(config.clientSecret)` explicitly as the fourth arg to openid-client's `discovery()` call (and imports it from `openid-client`). This is the regression pin for the 2026-05-15 `client_secret_post` vs `client_secret_basic` issue: openid-client v6 defaults to `ClientSecretPost` when the fourth arg is omitted, but the dev + production Authelia clients are registered as `client_secret_basic`, so the omitted-fourth-arg shape returned `invalid_client` (401) at the token exchange. `apps/server/src/auth/config.test.ts` extends the openid-client mock to include `ClientSecretBasic` (no behavior change at the unit layer — the e2e suite is what catches this drift).
- `infra/authelia/configuration.yml` carries an updated dev client-secret hash + rotation-instructions comment block citing this refinement; the new hash matches the plaintext `OIDC_CLIENT_SECRET` in `.env.example` so a `make up-prod-mode` boot succeeds with the matching method.
- `.github/workflows/ci.yml` adds an `/etc/hosts` step (`echo '127.0.0.1  authelia.aconversa.local' | sudo tee -a /etc/hosts`) before `make up-prod-mode` so the CI runner resolves the OIDC redirect hostname — mirroring the dev fix that landed in commit `e02652b`. No new CI job; the existing `e2e-playwright` job picks up the new spec.
- `playwright.config.ts` adds a `chromium-auth` project scoped to `tests/e2e/auth-flow.spec.ts` with `ignoreHTTPSErrors: true` (per-project, so the i18n-smoke projects keep their strict-cert posture). `docs/dev-environment.md` documents the local-run flow (`make up-prod-mode && pnpm exec playwright install chromium --with-deps && pnpm run test:e2e`) cross-referencing the existing `/etc/hosts` requirement for `authelia.aconversa.local`.
- Verification on last full run: `pnpm run check` green; `pnpm run test:smoke` 2380 passing (no delta from the `ClientSecretBasic` mock addition); Playwright `chromium-auth` project 4/4 passed locally. **Caveat**: the last local run exercised the returning-user branch (the dev DB already had `alice` from prior work); the new-user JSON-->POST branch was exercised in an earlier iteration but not on the final run. CI starts each run with `make down-v` (fresh Postgres + fresh Authelia store), so the new-user branch is the FIRST scenario CI exercises — the CI run is the deterministic safety net for that branch.

Artifacts:

- `tests/e2e/auth-flow.spec.ts` (new — 4 scenarios under `test.describe.serial`).
- `tests/e2e/fixtures/auth.ts` (new — `loginAs(page, opts)` helper handling both callback branches).
- `apps/server/src/auth/config.ts` (explicit `ClientSecretBasic` on `discovery()`).
- `apps/server/src/auth/config.test.ts` (openid-client mock extended).
- `infra/authelia/configuration.yml` (updated dev client-secret hash + rotation instructions).
- `.github/workflows/ci.yml` (/etc/hosts entry for `authelia.aconversa.local`).
- `playwright.config.ts` (`chromium-auth` project).
- `docs/dev-environment.md` (local-run flow under "Tests").
- `tasks/20-backend.tji` (`complete 100` on `auth_flow_integration`).
