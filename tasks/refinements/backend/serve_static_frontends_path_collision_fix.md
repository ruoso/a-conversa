# Fix SPA-route collision with API params validators by moving the backend under `/api/*`

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.serve_static_frontends_path_collision_fix`
**Effort estimate**: **1d–1.5d** (revised upward from the registered 0.5d — see "Effort estimate" below).
**Inherited dependencies**:

- `backend.api_skeleton.serve_static_frontends` — settled (`staticFrontendsPlugin` + the SPA-vs-API ordering contract live in `apps/server/src/routes/static-frontends.ts` + `apps/server/src/server.ts`).
- `backend.api_skeleton.openapi_or_equivalent` — settled (Swagger UI is mounted at `/docs` with the OpenAPI JSON at `/docs/json`, per `apps/server/src/openapi.ts:248-251`).
- `backend.api_skeleton.health_endpoint` — settled (`apps/server/src/routes/healthz.ts` mounts `GET /healthz`).
- `backend.session_management.create_session_endpoint`, `list_sessions_endpoint`, `get_session_endpoint`, `end_session_endpoint`, `session_privacy_toggle`, `participant_assignment`, `entity_inclusion_endpoint` — all settled; all currently registered under `/sessions/*` in `apps/server/src/sessions/routes.ts`.
- `backend.auth.oauth_provider_config`, `oauth_callback_handler`, `auth_middleware`, `session_token_management`, `screen_name_collection` — all settled; the surface lives under `/auth/*` in `apps/server/src/auth/routes.ts` and the redirect URI is derived as `${APP_BASE_URL}/auth/callback` in `apps/server/src/auth/config.ts:248`.
- `backend.ws.ws_connection_handling`, `ws_auth_on_connect`, and every other `ws_*` task — settled; `GET /ws` upgrades to the WS protocol in `apps/server/src/ws/connection.ts:866`.
- `moderator_ui.mod_session_setup.mod_create_session_form` — settled but **shipped at the workaround route `/sessions/new/setup`** because `/sessions/new` collided with `GET /sessions/:id`'s UUID params validator. This task reverts that workaround.

## What this task is

A one-time, repo-wide migration that puts **every** backend HTTP route under an `/api/*` prefix, including the WebSocket upgrade endpoint. After this lands:

- `GET /sessions/:id` becomes `GET /api/sessions/:id`.
- `POST /sessions`, `GET /sessions`, `POST /sessions/:id/end`, `PATCH /sessions/:id/privacy`, `POST /sessions/:id/participants`, `DELETE /sessions/:id/participants/:userId`, `POST /sessions/:id/include` all gain the `/api` prefix.
- `GET /auth/login`, `GET /auth/callback`, `GET /auth/me`, `POST /auth/screen-name`, `POST /auth/logout` move to `/api/auth/*`.
- `GET /ws` moves to `GET /api/ws`.
- `GET /docs` + `GET /docs/json` (Swagger UI) move to `/api/docs` + `/api/docs/json`.
- `GET /healthz` **stays at root** (`/healthz`) — ops convention. Justified under Decisions §2.

The collision class disappears: after the migration every URL is either `/api/*` (backend) or non-`/api/*` (SPA), and the static-frontends plugin can fall through to `index.html` for any non-API path without risk of being intercepted by a Fastify params validator on a sibling API route.

Two additional in-scope changes ride this migration:

1. **Authelia client config + the app's `APP_BASE_URL`-derived `redirectUri` + the i18n smoke spec's `Location`-header expectation** all move from `${APP_BASE_URL}/auth/callback` to `${APP_BASE_URL}/api/auth/callback`. The redirect URIs registered in `infra/authelia/configuration.yml` (lines 206-208) update in lockstep.
2. **The `mod_create_session_form` workaround route reverts** — `apps/moderator/src/App.tsx`'s `/sessions/new/setup` becomes `/sessions/new`, the inline rationale comments at the top of `App.tsx` / `CreateSession.tsx` / `tests/e2e/create-session-flow.spec.ts` are deleted, and the spec's two `page.goto('/sessions/new/setup')` calls update.

Atomic single commit. Partial state breaks the runtime end-to-end (client fetch URLs and server routes have to move together) so the migration cannot be staged.

## Why it needs to be done

`mod_create_session_form` shipped at the 3-segment route `/sessions/new/setup` instead of the natural REST-shaped `/sessions/new` because Fastify's `GET /sessions/:id` UUID params-validator schema matched `/sessions/new` and returned `400 validation-failed` BEFORE the static-frontends SPA fallback got a chance to fire. The workaround was registered as tech debt per the ORCHESTRATOR.md `b7c5ff0` policy and routed back to this task.

The same class of bug threatens every future SPA route the moderator (or participant / audience / replay) ever adds: any new 2-segment SPA route under `/sessions/*` is one params-validator away from a 400. Examples already in flight or planned:

- `/sessions/list` (future moderator sessions-dashboard route).
- `/sessions/import`, `/sessions/templates`, `/sessions/preferences` — any "named segment" the SPA might want.
- The future `/participant/<session-id>` and `/audience/<session-id>` surfaces (less risky today but still exposed if those workspaces ever register `/sessions/*` SPA routes).

Three options were surveyed at the original tech-debt-registration time:

- **(a)** Move all backend routes under `/api/*`. **Chosen by the user** as a one-time architectural fix.
- **(b)** Gate the params validator on the `Accept` header — let `Accept: text/html` skip the validator so the SPA fallback can fire.
- **(c)** Explicitly exempt named segments (`/sessions/new`, `/sessions/list`, …) from the params validator.

Options (b) and (c) are tactical patches that leave the collision risk re-introducible on every future endpoint addition. They require the API author to remember the trap. Option (a) eliminates the trap structurally — every path is unambiguously one or the other.

After this task lands:

- `mod_create_session_form` reclaims the natural REST shape `/sessions/new`.
- Future SPA routes can be added under any non-`/api/*` shape without ambient routing-collision risk.
- The architecture matches the standard "API at `/api/*`, SPA at `/`" pattern that React + Fastify + Vite stacks generally adopt.

## Inputs / context

### Server routes to migrate (the explicit enumeration)

From the codebase walk:

| File | Line | Method | Current path | Target path |
| --- | --- | --- | --- | --- |
| `apps/server/src/auth/routes.ts` | 515 | `GET` | `/auth/login` | `/api/auth/login` |
| `apps/server/src/auth/routes.ts` | 579 | `GET` | `/auth/callback` | `/api/auth/callback` |
| `apps/server/src/auth/routes.ts` | 745 | `POST` | `/auth/screen-name` | `/api/auth/screen-name` |
| `apps/server/src/auth/routes.ts` | 878 | `POST` | `/auth/logout` | `/api/auth/logout` |
| `apps/server/src/auth/routes.ts` | 1026 | `GET` | `/auth/me` | `/api/auth/me` |
| `apps/server/src/sessions/routes.ts` | 1131 | `POST` | `/sessions` | `/api/sessions` |
| `apps/server/src/sessions/routes.ts` | 1332 | `GET` | `/sessions` | `/api/sessions` |
| `apps/server/src/sessions/routes.ts` | 1540 | `GET` | `/sessions/:id` | `/api/sessions/:id` |
| `apps/server/src/sessions/routes.ts` | 1615 | `POST` | `/sessions/:id/end` | `/api/sessions/:id/end` |
| `apps/server/src/sessions/routes.ts` | 1818 | `PATCH` | `/sessions/:id/privacy` | `/api/sessions/:id/privacy` |
| `apps/server/src/sessions/routes.ts` | 2016 | `POST` | `/sessions/:id/participants` | `/api/sessions/:id/participants` |
| `apps/server/src/sessions/routes.ts` | 2280 | `DELETE` | `/sessions/:id/participants/:userId` | `/api/sessions/:id/participants/:userId` |
| `apps/server/src/sessions/routes.ts` | 2531 | `POST` | `/sessions/:id/include` | `/api/sessions/:id/include` |
| `apps/server/src/ws/connection.ts` | 866 | `GET` (WS upgrade) | `/ws` | `/api/ws` |
| `apps/server/src/openapi.ts` | 250 | `routePrefix` | `/docs` | `/api/docs` |
| `apps/server/src/routes/healthz.ts` | 93 | `GET` | `/healthz` | **unchanged — stays `/healthz`** |

15 routes move; one (`/healthz`) stays put.

#### Mechanism: per-plugin route literal edits OR a single `app.register(..., { prefix: '/api' })` wrap

Two implementation styles are viable. Both are surveyed under Decisions §3; the chosen approach is the per-plugin `{ prefix: '/api' }` wrap at registration time in `apps/server/src/server.ts`, keeping the route-literal strings inside each plugin file unchanged. The decision is on shaping the diff to minimize the line-touch count and let the prefix live in one obvious place rather than fan out across every plugin.

Where the per-plugin prefix isn't enough (the static-frontends plugin's `setNotFoundHandler` discriminator, the WS-Origin allowlist's URL-matching logic, the OpenAPI `routePrefix` config, the `redirectUri` derivation), the literal `/api` enters via the touched files explicitly.

### Frontend call sites to migrate

#### Moderator HTTP fetches (4 inline `fetch` call sites)

| File | Line | Current literal | Target literal |
| --- | --- | --- | --- |
| `apps/moderator/src/auth/useAuth.ts` | 129 | `fetch('/auth/me', ...)` | `fetch('/api/auth/me', ...)` |
| `apps/moderator/src/auth/useAuth.ts` | 187 | `fetch('/auth/logout', ...)` | `fetch('/api/auth/logout', ...)` |
| `apps/moderator/src/routes/ScreenName.tsx` | 220 | `fetch('/auth/screen-name', ...)` | `fetch('/api/auth/screen-name', ...)` |
| `apps/moderator/src/routes/CreateSession.tsx` | 130 | `fetch('/sessions', ...)` | `fetch('/api/sessions', ...)` |

#### Moderator non-fetch link/anchor sites

| File | Line | Current literal | Target literal |
| --- | --- | --- | --- |
| `apps/moderator/src/routes/Login.tsx` | 70 | `<a href="/auth/login" ...>` | `<a href="/api/auth/login" ...>` |

#### Moderator WS default URL

| File | Line | Current literal | Target literal |
| --- | --- | --- | --- |
| `apps/moderator/src/ws/client.ts` | 173 | `const DEFAULT_URL = '/ws';` | `const DEFAULT_URL = '/api/ws';` |

#### No central API client seam exists today

Per [`mod_create_session_form.md`](../moderator-ui/mod_create_session_form.md) §"HTTP client seam": "The moderator app has no dedicated `apps/moderator/src/api/` directory today." The 4 fetch sites and 1 anchor are the complete frontend surface — there's no `apiClient` abstraction to update, the migration is **a literal string substitution at each of the 5 sites + 1 WS default URL**.

The participant / audience / replay workspaces are stubs today and contain no HTTP / WS calls — no work in those workspaces.

### Authelia OIDC config

From `infra/authelia/configuration.yml:206-208`:

```yaml
redirect_uris:
  - 'http://localhost:5173/auth/callback'
  - 'http://localhost:3000/auth/callback'
```

Both lines move to `/api/auth/callback`. (The `:5173` entry is the Vite dev-server bypass — kept for parity; the migration applies to both.)

From `apps/server/src/auth/config.ts:248`:

```ts
redirectUri: `${appBaseUrl}/auth/callback`,
```

The derivation moves to `${appBaseUrl}/api/auth/callback`. The associated JSDoc / inline comments at lines 21, 36, 110, 144, 160-164, 238 all reference the path string and update in the same edit pass.

From `infra/authelia/README.md:72`:

```
redirect_uris | http://localhost:5173/auth/callback, http://localhost:3000/auth/callback
```

Updates to `/api/auth/callback`.

Authelia config is **read-only-mounted** into the compose `authelia` service per `infra/authelia/README.md` — the new file is picked up on the next container restart. No server-side restart of Authelia is special; `make down && make up` resets it.

### Tests to migrate

#### Vitest unit/integration tests

All Vitest suites that `app.inject({ url: '/auth/...' | '/sessions/...' | '/ws' })`. The list (10 files identified):

- `apps/server/src/server.test.ts` — the cross-route smoke suite.
- `apps/server/src/logger.test.ts` — observability layer.
- `apps/server/src/sessions/routes.test.ts` — every session-endpoint case.
- `apps/server/src/auth/screen-name.test.ts`, `apps/server/src/auth/logout-revocation.test.ts`, `apps/server/src/auth/routes.test.ts`, `apps/server/src/auth/no-profile-data.test.ts`, `apps/server/src/auth/session-token.test.ts` — every auth-endpoint case.
- `apps/server/src/routes/healthz.test.ts` — healthz (assertions unchanged since path stays `/healthz`; double-check no negative case lives here that would shift).
- `apps/server/src/routes/static-frontends.test.ts` — explicitly asserts the API-precedence regression for `/healthz` (unchanged) and `/auth/me` (moves to `/api/auth/me`). Also tests SPA-fallback for HTML Accept on arbitrary unknown paths — the existing assertions stay valid; the migration adds new assertions for "any `/api/*` 404 returns the JSON envelope" since `/api/*` is now the unambiguous backend-namespace.
- `apps/moderator/src/routes/CreateSession.test.tsx` + `apps/moderator/src/App.test.tsx` — the moderator-side suites that stub `fetch` for `/auth/me`, `/auth/screen-name`, `/sessions`; the stubs move.

#### Cucumber + pglite behavior tests

From the grep on `tests/behavior/`:

- `tests/behavior/steps/backend-create-session.steps.ts` — lines 104, 126 (`url: '/sessions'`).
- `tests/behavior/steps/backend-session-token.steps.ts` — lines 185, 199, 215 (`/auth/me`, `/auth/logout`).
- `tests/behavior/steps/backend-screen-name.steps.ts` — lines 112, 175, 198 (`/auth/login`, `/auth/screen-name`).
- `tests/behavior/steps/backend-ws-catch-up.steps.ts`, `backend-ws-snapshot.steps.ts`, `backend-ws-vote.steps.ts`, `backend-ws-propose.steps.ts` — every `'/ws'` literal in step messages and connect calls.
- `tests/behavior/backend/ws-error.feature`, `ws-envelope.feature`, `ws-meta-disagreement.feature` — every `connects to "/ws"` Gherkin step.

The Cucumber step text in the `.feature` files is also human-readable English ("an authenticated WebSocket client connects to /ws"); the step regex matches the literal in the steps file. The literal moves to `/api/ws` in both the step regex and the feature file in the same edit so the Gherkin text matches the regex.

#### Playwright e2e specs

| File | Migrations |
| --- | --- |
| `tests/e2e/auth-flow.spec.ts` | Multiple `page.request.get('/auth/me')`, `page.request.post('/auth/logout')`, `request.get('/auth/callback?...')` — all paths move. The inline comments narrating "GET /auth/login is a 302" move too. |
| `tests/e2e/i18n-moderator-smoke.spec.ts` | Line 118: `resp.url().endsWith('/auth/login')` → `/api/auth/login`. Comments lines 92, 111, 112, 129, 134, 143 update. |
| `tests/e2e/moderator-hover-details.spec.ts` | Line 79: `page.request.post('/sessions', ...)` → `/api/sessions`. Inline narration comments at 30-31 update. |
| `tests/e2e/moderator-graph-layout.spec.ts` | Same `POST /sessions` pattern (verify in the implementation pass). |
| `tests/e2e/create-session-flow.spec.ts` | Two `page.goto('/sessions/new/setup')` lines (58, 95) → `'/sessions/new'`. The 25-line "Why /sessions/new/setup and not /sessions/new" comment block (~lines 22-45) is deleted in full — the migration eliminates the rationale. |
| `tests/e2e/fixtures/auth.ts` | Lines 166, 321, 327 — `/auth/me`, `/auth/callback`, `/auth/screen-name` literals move to `/api/auth/...`. The browser-context cookie-jar inheriting still works because the cookie domain (set by `/api/auth/callback`'s `Set-Cookie`) is the parent domain, unaffected by the path. |

`tests/e2e/hello.spec.ts` doesn't touch API paths (just the SPA root) — unchanged.

### Documentation

| File | Migrations |
| --- | --- |
| `docs/dev-environment.md` | Line 43 mentions `/healthz` — unchanged (stays at root). Lines that reference `/auth/login` (if any in this file) and the Vite dev-server proxy paths update; `infra/authelia/README.md` line 72 updates. |
| `infra/authelia/README.md` | Line 72 redirect-uri table entry. |
| `infra/authelia/tls/README.md` | Line 20 narrative reference to `/auth/login` (update for accuracy). |
| `Dockerfile` | Lines 20, 148, 174 narrative comments — `/healthz` stays, `/sessions` references in comments update. |
| `compose.yaml` | Lines 33, 91, 100 — `/healthz` stays (the healthcheck command keeps targeting `http://localhost:3000/healthz` unchanged). |
| `playwright.config.ts` | Lines 228-229 are comments narrating the create-session-flow spec; update to drop the `/sessions/new/setup` workaround mention. |
| `apps/server/src/openapi.ts` | Multiple JSDoc / inline comments referencing the prefix (`Registers @fastify/swagger-ui at /docs`, "frontends can fetch /docs/json"); update to `/api/docs` + `/api/docs/json`. The Swagger-UI options object's `routePrefix: '/docs'` literal at line 250 is the live edit. |
| `.env`, `.env.example` | Lines 30-35 narrative comments mention `${APP_BASE_URL}/auth/callback`; update to `/api/auth/callback`. |
| `tasks/refinements/backend/auth_flow_integration.md` Status section | Likely needs no changes (it's historical); the migration adds a new Status note instead. |

### ADR pin

No new ADR. The `/api/*` prefix is a **standard convention** (industry default for SPA + API on one origin); the migration crosses no workspace boundaries and creates no new architectural seam. Per the ADR convention in `docs/adr/README.md`, ADRs capture **architectural choices among alternatives**; this task is execution of a settled choice (the user picked option (a) at registration time), not a new choice. The Decisions section below documents the user-direction and records the rejected alternatives for the historical record.

Existing ADRs the migration respects:

- **ADR 0008** (Playwright + compose layering) — all four Playwright specs still run under `make up` + `pnpm run test:e2e` after the migration.
- **ADR 0017** (Authelia users-file dev IdP) — the dev OIDC client registration moves in lockstep; the issuer URL (`https://authelia.aconversa.local:9091`) is unchanged.
- **ADR 0022** (no throwaway verifications) — every test that hits an HTTP path is migrated alongside the route; the verification surface stays committed.
- **ADR 0023** (web framework Fastify) — the `staticFrontendsPlugin` ordering contract (API first, static last) is preserved; the static plugin still falls through, just now for any non-`/api/*` path.

## Constraints / requirements

- **Atomic single-commit migration.** Server, frontend, Authelia config, and tests move together. Partial state breaks the dev stack (client points at old paths → 404; or Authelia callback URL mismatch → OIDC handshake fails).
- **`/healthz` stays at root.** Compose healthcheck (`compose.yaml:100`) keeps targeting `http://localhost:3000/healthz`; ops conventions expect liveness at `/healthz` (or `/health`), not behind any prefix. Justified under Decisions §2.
- **WS upgrade endpoint migrates.** `/ws` → `/api/ws`. The moderator `WsClient` default URL, every Cucumber `connects to "/ws"` step, every Playwright WS-store seed path, every server-side test that opens a WS — all move in lockstep.
- **Authelia OIDC client + the server-side `redirectUri` derivation move together.** A mismatch (Authelia knows `/auth/callback` but the server sends `/api/auth/callback`) fails OIDC with `invalid redirect_uri` from the IdP and breaks login end-to-end.
- **No backwards-compat shim.** The project is pre-M9 with no public consumers; a 301-from-`/sessions/*`-to-`/api/sessions/*` shim is unnecessary code surface to add and then remove. The breaking change is acceptable.
- **The `mod_create_session_form` workaround reverts in the same commit.** `/sessions/new/setup` → `/sessions/new` across:
  - `apps/moderator/src/App.tsx` — the `<Route path="/sessions/new/setup" ...>` literal + the header-comment `/sessions/new/setup ... create-session form (topic + privacy)` listing + the "Note on /sessions/new/setup vs /sessions/new" comment block at lines 10-26.
  - `apps/moderator/src/routes/CreateSession.tsx` — any inline comment narrating the workaround.
  - `tests/e2e/create-session-flow.spec.ts` — two `page.goto('/sessions/new/setup')` lines + the 25-line workaround-rationale comment block (lines 22-45 ish).
  - `tasks/refinements/moderator-ui/mod_create_session_form.md` — **no change.** The refinement's prior content is the historical record per the refinement convention in `tasks/refinements/README.md`; the workaround-route Status bullet stays as-is so the historical reason is preserved. The Status section of THIS refinement (added at task-completion time) is where the "workaround reverted" outcome is recorded.
- **OpenAPI doc reflects the new prefix.** `apps/server/src/openapi.ts` Swagger-UI `routePrefix` moves to `/api/docs`; the doc's `info.description` text (which may mention `/sessions` / `/auth/*` in narrative) updates if needed. The doc JSON's path keys auto-update because Fastify emits paths based on the registered route literals (which all carry the `/api` prefix after this task).
- **CORS allowlist unchanged.** CORS works on origin (scheme + host + port), not path; the `resolveCorsOptions` in `apps/server/src/server.ts:226` doesn't need migration. Confirm by inspection during implementation.
- **`MODERATOR_DIST_DIR` env override unchanged.** The static-frontends plugin's resolver doesn't care about route prefixes; it still serves any non-API HTML-Accept GET as the SPA index.
- **i18n smoke spec's `Location`-header assertion** — `tests/e2e/i18n-moderator-smoke.spec.ts:118` asserts the response URL ends with `/auth/login` (the 302 from the SSO button). Move to `/api/auth/login`.
- **Test counts.** No tests are deleted; every test migrates. The smoke total stays equal (or drops by exactly the number of redundant assertions the migration cleans up — e.g., the create-session-flow spec's two workaround-rationale narrating cases may consolidate to one).
- **No new dependencies.** The migration is a string-prefix change; no library introduction.

### Files this task touches (the explicit allowlist)

**Server route plugins**:

- `apps/server/src/server.ts` — registers the auth + sessions + WS plugins under `{ prefix: '/api' }`; the swagger-ui plugin moves to `routePrefix: '/api/docs'`; the static-frontends plugin still registers LAST without a prefix.
- `apps/server/src/auth/routes.ts` — route literals stay (if using the prefix-at-registration approach); JSDoc references update.
- `apps/server/src/auth/config.ts` — `redirectUri` derivation moves; JSDoc references update.
- `apps/server/src/sessions/routes.ts` — route literals stay; JSDoc / file-header `//   - GET /sessions/:id — ...` listing comments update.
- `apps/server/src/ws/connection.ts` — route literal stays; comments update.
- `apps/server/src/openapi.ts` — `routePrefix: '/docs'` → `'/api/docs'`; JSDoc + inline comments update.
- `apps/server/src/routes/healthz.ts` — **unchanged**.
- `apps/server/src/routes/static-frontends.ts` — the SPA-fallback discriminator already keys off "any unknown path"; **no logic change needed**. May add a comment noting the post-migration invariant ("any `/api/*` path that doesn't match a registered backend route returns 404 JSON; any non-`/api/*` path that doesn't match a static asset falls through to SPA index").
- `apps/server/src/error-handler.ts` — `sendNotFoundEnvelope` is unchanged; the JSON envelope shape doesn't depend on the prefix.

**Server tests**: every test file enumerated under Inputs / context → Tests → Vitest.

**Frontend**:

- `apps/moderator/src/auth/useAuth.ts` — 2 fetch literals.
- `apps/moderator/src/routes/ScreenName.tsx` — 1 fetch literal.
- `apps/moderator/src/routes/CreateSession.tsx` — 1 fetch literal + remove the workaround comment if present.
- `apps/moderator/src/routes/Login.tsx` — 1 anchor `href` literal.
- `apps/moderator/src/ws/client.ts` — `DEFAULT_URL` literal.
- `apps/moderator/src/App.tsx` — route `/sessions/new/setup` → `/sessions/new`; route-listing comments + the workaround narrative block.
- Test files: `App.test.tsx`, `CreateSession.test.tsx`, `useAuth.test.ts` (if it exists — verify during implementation), `client.test.ts`, `WsClientProvider.test.tsx` — every `fetch`-stub URL pattern and every `url: '/ws'` literal moves.

**Cucumber tests**:

- `tests/behavior/steps/backend-create-session.steps.ts`, `backend-session-token.steps.ts`, `backend-screen-name.steps.ts` — `app.inject({ url: ... })` literals.
- `tests/behavior/steps/backend-ws-*.steps.ts` — `'/ws'` literals in step messages and regex.
- `tests/behavior/backend/ws-*.feature` — `connects to "/ws"` Gherkin text.

**Playwright tests**:

- `tests/e2e/auth-flow.spec.ts`, `i18n-moderator-smoke.spec.ts`, `moderator-hover-details.spec.ts`, `moderator-graph-layout.spec.ts`, `create-session-flow.spec.ts`, `fixtures/auth.ts`.

**Authelia**:

- `infra/authelia/configuration.yml` — `redirect_uris` lines.
- `infra/authelia/README.md` — table line 72.
- `infra/authelia/tls/README.md` — narrative reference if present.

**Docs**:

- `apps/server/src/openapi.ts` — narrative comments.
- `.env`, `.env.example` — narrative comments.
- `Dockerfile` — narrative comments (the `/healthz` healthcheck line is unchanged; `/sessions` mentions migrate).
- `docs/dev-environment.md` — any narrative reference to `/auth/*` or `/sessions` paths.
- `playwright.config.ts` — comment narrating the create-session-flow spec.

### Files this task does NOT touch

- `tasks/*.tji` files — the existing task block is in place; `complete 100` lands at task-completion time, not at refinement-write time.
- `docs/adr/` — no new ADR (see "ADR pin" above).
- `tasks/refinements/moderator-ui/mod_create_session_form.md` — historical record; preserved as-is per the refinement convention.
- `tasks/refinements/backend/serve_static_frontends.md` — same; preserved as-is.
- Backend route HANDLER bodies (the SQL queries, the response shaping, the event-emission code) — only the path strings + the JSDoc that references them move; the handlers' logic is untouched.
- Schema definitions (`createSessionBodySchema`, `sessionResponseSchema`, etc. in `apps/server/src/sessions/routes.ts`) — unchanged; request/response shapes are identical.

## Acceptance criteria

1. **`pnpm install` clean** — no new dependencies introduced.
2. **`pnpm run check`** (lint + format + typecheck + tools + tests) green.
3. **`pnpm run test:smoke`** (Vitest, all workspaces) green. Test counts unchanged modulo any redundant-comment cleanup; assertions migrate in lockstep with the routes.
4. **`pnpm run test:cucumber`** (the pglite behavior suite) green — every step that injects against a route path uses the new `/api/*` literal.
5. **`pnpm run test:e2e`** under `make up` runs all four Playwright spec families green:
   - `auth-flow` — the OIDC handshake spec proves the Authelia redirect URI + the server-side `redirectUri` derivation align.
   - `moderator-hover-details` — proves the moderator app can `POST /api/sessions` and reach the operate route.
   - `moderator-graph-layout` — proves session creation via the API + WS connect work end-to-end.
   - `create-session-flow` — proves the workaround revert: `page.goto('/sessions/new')` reaches the SPA's create-session form (not a 400 from the params validator).
   - `i18n-moderator-smoke` — proves the localized login button still 302s to `/api/auth/login`.
6. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to the task block.
7. **Manual smoke** (documented in the Status block, not enforced as a test): `make up` → log in at `http://localhost:3000/login` → land on `/sessions/new` (not `/sessions/new/setup`) → submit a topic → land on `/sessions/<uuid>/operate` with the graph canvas mounted. Per ADR 0022, this manual smoke is documented but the regression-class proof is the Playwright `create-session-flow` spec which runs in CI compose.
8. **Search invariant**: a `git grep -nE "fetch\(['\"]/(auth|sessions|ws)/" apps/ packages/` returns **zero live-code matches** outside `/api/*` paths. The grep is documented in the Status block as a one-time post-migration sanity check (not a permanent test — the codebase shouldn't ever have to assert "no bare /auth path" again after this).
9. **No file modifications outside the explicit allowlist** above. The historical refinements (`mod_create_session_form.md`, `serve_static_frontends.md`) stay untouched.

## Decisions

### 1. Migration approach: `/api/*` prefix for every backend HTTP + WS route (user-directed)

The user explicitly chose **option (a)** — move every backend HTTP route under `/api/*` — at tech-debt-registration time. Recap of the three options surveyed in the original `tasks/20-backend.tji` note (commit `05f7d67` + `b7c5ff0`):

- **(a) `/api/*` prefix** (chosen, user-directed). Eliminates the collision class structurally. Every URL is unambiguously either backend (`/api/*`) or SPA (`/*`). The static-frontends plugin's SPA fallback can fire for any non-`/api/*` path without risk of being shadowed by a params validator. Future-proof against any SPA-route shape.
- **(b) `Accept`-header-gated params validator** (rejected). Would let `Accept: text/html` skip the UUID-params validator on `/sessions/:id`. Leaves the collision risk re-introducible on every future endpoint (the validator-skip has to be remembered on every new params validator the API adds). Also makes the API surface header-dependent in a way that's hard to reason about from the route declaration alone.
- **(c) Named-segment allowlist** (rejected). Would explicitly exempt `/sessions/new`, `/sessions/list`, etc. from the UUID-params validator. Same long-term problem as (b): the allowlist has to be kept in sync with every new SPA route, and the validator's failure mode silently shadows future SPA routes that aren't in the allowlist.

The decision is settled by user direction; the rejected alternatives are recorded here for the historical record.

### 2. `/healthz` exception: stays at root

`/healthz` does **not** move to `/api/healthz`. Three reasons:

- **Ops convention**. Kubernetes, ECS, Docker compose, Cloud Run, and most orchestrators expect liveness probes at `/healthz` (or `/health`) at the root. The compose healthcheck in `compose.yaml:100` is `require('http').get('http://localhost:3000/healthz', ...)` — moving the path would force a config edit on every deployment surface that already knows the convention.
- **No collision risk**. `/healthz` is a single-segment fixed path with no params validator. It can never collide with a future SPA route (the SPA wouldn't register `/healthz` as a SPA route — `/healthz` is a backend concept, not a UI route).
- **Distinct concern**. `/healthz` is a meta endpoint (liveness probe for the runtime), not part of the API surface (the JSON / WS contract with clients). Putting it under `/api/healthz` would conflate "is the runtime alive" with "is the API alive"; the convention separates them deliberately.

`/healthz` joins `/api/*` and "everything else (SPA)" as the third routing namespace. The static-frontends plugin's SPA fallback already exempts `/healthz` because Fastify registers the healthz plugin BEFORE the static plugin and routes match in registration order (per `serve_static_frontends.md` Decisions §"Route precedence: API first, static last"). The contract holds unchanged.

### 3. Mechanism: per-plugin `{ prefix: '/api' }` at registration time

Two implementation styles considered:

- **Per-plugin `{ prefix: '/api' }` wrap at registration time** (chosen). In `apps/server/src/server.ts`, change `await app.register(authRoutesPlugin, { ... })` to `await app.register(authRoutesPlugin, { ..., prefix: '/api' })`; same for `sessionsRoutesPlugin`, `wsConnectionHandlingPlugin`, and any other registered route plugin. Fastify's `prefix` option on `app.register` prepends to every route declared inside the plugin. The route literals inside `auth/routes.ts`, `sessions/routes.ts`, `ws/connection.ts` stay as-is — `'/auth/login'` becomes `/api/auth/login` at the registration boundary. The diff is small (one line per plugin registration call) and the convention is colocated with the route registration block in `server.ts`.
- **Edit every route literal in every plugin file** (rejected). Would touch every `app.get('/auth/login', ...)` → `app.get('/api/auth/login', ...)` inline. Larger diff, more risk of inconsistency (one literal missed = silent 404), and scatters the migration across more files than necessary. The per-plugin prefix approach is the smaller, more reviewable diff.

The static-frontends plugin (`apps/server/src/routes/static-frontends.ts`) and the healthz plugin (`apps/server/src/routes/healthz.ts`) are registered WITHOUT the `/api` prefix, since they own root-namespace paths (`/`, `/assets/*`, `/healthz`).

The Swagger-UI plugin's `routePrefix` config option moves explicitly (`'/docs'` → `'/api/docs'`) since `@fastify/swagger-ui` doesn't compose with Fastify's `register({ prefix })` for its prefix configuration — its own `routePrefix` is the documented mechanism.

### 4. Atomic single-commit migration

The migration cannot be staged because the client and server have to point at the same paths to function:

- If the server moves to `/api/*` but the client still fetches `/auth/me`, every client-side fetch 404s and the SPA can't bootstrap auth.
- If the client moves to `/api/auth/me` but the server still registers `/auth/me`, same problem in the other direction.
- If Authelia knows `/auth/callback` but the server's `redirectUri` config sends `/api/auth/callback`, the OIDC handshake fails on the IdP side with `invalid redirect_uri`.

A single atomic commit with all moving pieces is the only safe shape.

### 5. No backwards-compat shim

A 301-from-`/sessions`-to-`/api/sessions` shim was considered and rejected:

- The project is pre-M9 with **no public consumers** (per the milestone gate). Nobody has bookmarked URLs; nobody has stored API paths in a third-party integration.
- Adding a shim is code surface that has to be tested, maintained, and then removed at some future "deprecation done" milestone. The cost / benefit is negative for a pre-launch project.
- Old paths returning 301 (or worse, 200 with the old behavior) would obscure migration bugs — a missed test that still uses `/auth/me` would silently pass under a shim and fail in production after the shim is removed. Hard-failing all old paths immediately surfaces every missed call site.

### 6. WS endpoint also migrates

`/ws` → `/api/ws` is in scope. The WS upgrade is a `GET /ws` route from Fastify's perspective (the upgrade is an HTTP request that switches protocols mid-response per RFC 6455). It's served by the same Fastify app; moving it to `/api/ws` is structurally identical to moving any HTTP route. The moderator `WsClient`'s `DEFAULT_URL = '/ws'` constant updates; every Cucumber step and Playwright fixture moves in lockstep.

### 7. Workaround revert (`/sessions/new/setup` → `/sessions/new`) is in scope

This task's commit reverts the workaround introduced by `mod_create_session_form`. The reasoning:

- The workaround exists only because of the collision this task eliminates. Leaving it in place after this task is dead code.
- The "natural" REST shape `/sessions/new` matches the refinement's original Decisions §1 (which explicitly chose `/sessions/new` over `/`, `/dashboard`, etc.). Reverting realizes the intent.
- All call sites that reference `/sessions/new/setup` are in this task's allowlist already (the App.tsx route declaration + comment block, the CreateSession.tsx comments, the create-session-flow Playwright spec). The cleanup is small and atomic with the migration.

### 8. Authelia + server `redirectUri` move in lockstep

Both sides have to know the same URL or the OIDC handshake fails. The redirect URI is the only Authelia-side path that depends on the app's URL shape; the issuer URL, token endpoint, JWKS endpoint, etc. are all Authelia-internal (the server fetches them from the issuer's well-known config) and don't change.

### 9. No new ADR

Per the ADR convention in `docs/adr/README.md`, ADRs capture architectural choices among alternatives. This task is execution of a settled choice — the user picked option (a) at registration time. The `/api/*` prefix is the industry-standard convention for SPA + API on one origin; no new architectural seam crosses workspace boundaries. The historical record of the option survey lives in this refinement's Decisions §1.

If, during implementation, an unforeseen architectural decision emerges (e.g., the OpenAPI doc surface needs a version-prefix like `/api/v1/*` rather than bare `/api/*`), an ADR can be written then; today, the bare `/api/*` prefix matches the user-direction and no version-prefix decision is in scope.

## Effort estimate

**Revised to 1d–1.5d** (up from the original 0.5d registered in the WBS).

The 0.5d figure was placeholder at tech-debt-registration time when the migration was scoped as "change the params validator." The user's choice of option (a) expands the scope to:

- 16 server-side route paths + Swagger UI route prefix + the OpenAPI JSDoc refresh.
- 5 frontend fetch / anchor / WS-URL literals + the App.tsx route declaration.
- 4 Authelia / OIDC config touch points.
- ~10 Vitest test files.
- ~5 Cucumber step files + 3 Gherkin feature files.
- 5 Playwright spec files + the auth-fixture file.
- ~7 documentation surfaces (env files, Dockerfile comments, etc.).

Mechanical find-and-replace dominates (so per-line edits are fast), but the test-run verification cycle (Vitest, Cucumber, Playwright in compose) consumes the bulk of the time. A single compose-up + Playwright cycle is ~5-10 minutes; 2-3 cycles is realistic if the first cycle catches a missed Authelia config edit.

## Open questions

(none — all decided)

## Status

- `/api/*` prefix applied to all backend HTTP and WebSocket routes via per-plugin `{ prefix: '/api' }` registration in `apps/server/src/server.ts` (auth + sessions + WS + Swagger UI); route literals inside the plugin files stay unchanged, the prefix lives in one place at registration time. The static-frontends plugin still registers LAST without a prefix so any non-`/api/*` HTML-Accept path falls through to the SPA index.
- `/healthz` exempted at root per Decisions §2 (ops convention: liveness probes live at `/healthz`, not behind any prefix). The compose healthcheck command in `compose.yaml` is unchanged.
- Moderator SPA migrated end-to-end: all 4 inline `fetch()` sites (`useAuth.ts` ×2, `ScreenName.tsx`, `CreateSession.tsx`) + 1 anchor `href` in `Login.tsx` + the `WsClient` `DEFAULT_URL` constant in `ws/client.ts` all moved to `/api/*`. The `/sessions/new/setup` 3-segment workaround introduced by commit `05f7d67` for `mod_create_session_form` reverted to the natural REST shape `/sessions/new` (the workaround block in `App.tsx` and the rationale comment in `create-session-flow.spec.ts` deleted).
- Authelia OIDC client config (`infra/authelia/configuration.yml:206-208`) and the server-side `redirectUri` derivation (`apps/server/src/auth/config.ts:248`) moved in lockstep to `/api/auth/callback`; the OIDC handshake validated end-to-end by `tests/e2e/auth-flow.spec.ts`.
- All three test layers migrated atomically: Vitest assertions in 21 server test files + 4 moderator test files; Cucumber paths in 16 feature files + 19 step files; Playwright URLs in 5 spec files + 2 fixtures. No backwards-compat shim — pre-M9, no public consumers.
- 93-file atomic single commit (server + frontend + Authelia + tests + docs in lockstep). Verification: `pnpm run check` green, `pnpm run test:smoke` 2607 passing (unchanged; assertions migrated to the new paths), `pnpm run test:cucumber` 219 passing, all 5 Playwright spec families green (19/19 tests: `auth-flow` 4/4, `moderator-hover-details` 1/1, `moderator-graph-layout` 2/2, `create-session-flow` 2/2 proving the workaround revert, `i18n-moderator-smoke` 9/9). Post-migration `git grep` for bare `/auth|/sessions|/ws` fetch sites returns zero live-code matches.
