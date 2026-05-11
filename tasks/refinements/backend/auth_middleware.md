# Auth middleware — enforce authentication on protected endpoints

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.auth.auth_middleware`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.auth.session_token_management` (settled — `signSessionToken`/`verifySessionToken` plus the `aconversa-session` cookie helpers). Transitively: `backend.auth.screen_name_collection`, `backend.auth.oauth_callback_handler`, `backend.api_skeleton.error_handling` (the centralized `ApiError` + envelope), `data_and_methodology.schema.users_table` (the `users` row + `deleted_at` soft-delete column).

## What this task is

Last sibling under `backend.auth`. Closes the auth sub-stream by extracting the "read the session cookie, verify the JWT, look up the user, attach to the request — or 401" pattern that `GET /auth/me` currently inlines into a reusable Fastify primitive every future protected endpoint and the WebSocket upgrade handler can opt into.

Three artifacts ship together:

- A Fastify plugin (`apps/server/src/auth/middleware.ts`) that decorates the app instance with `app.authenticate(request, reply)` and decorates the request with `request.authUser`. Routes opt into protection by attaching `preHandler: app.authenticate` to their own `schema`/options block.
- A TypeScript module augmentation (`apps/server/src/auth/types.d.ts`) so `request.authUser` is typed across the server codebase via `declare module 'fastify'`.
- The refactor of `GET /auth/me`'s body to consume the middleware — the route's handler shrinks to `return req.authUser`, and the existing cookie-read/JWT-verify/user-lookup logic moves into `middleware.ts`'s `authenticate` decorator.

The route taxonomy this lands:

- **Public** (no `preHandler: app.authenticate`): `GET /`, `GET /healthz`, `/docs/*`, `GET /auth/login`, `GET /auth/callback`, `POST /auth/screen-name`, `POST /auth/logout`.
- **Protected** (`preHandler: app.authenticate`): `GET /auth/me` today; future endpoints (sessions, replay, WS upgrade) default to this.

## Why it needs to be done

Three downstream consumers wait on this:

- **`backend.session_management.*`** — every `/sessions/*` endpoint needs `request.authUser.id` to scope reads/writes to the caller. Without the middleware they would each re-inline the cookie-parse / verify / lookup chain `/auth/me` already carries, drifting in three places at once.
- **`backend.websocket_protocol.ws_auth_on_connect`** — the WS upgrade reads the same cookie, runs the same verify, and attaches `userId` to the connection's context. It will not literally call `app.authenticate` (the WS upgrade isn't a Fastify request lifecycle), but it will use the **same `verifySessionToken` + user-lookup primitive** the middleware exposes. Pulling the chain out into one function gives `ws_auth_on_connect` a single thing to reuse.
- **`backend.replay_endpoints.*`** — same story as session-management: every protected HTTP route the middleware gates.

The user-facing wins:

- One file owns the 401 envelope shape; one place to add denylist checks if/when an `auth_token_denylist` migration lands (per `session_token_management.md`'s deferred follow-up); one place to add audit logging when the security-audit story stands up.
- Routes declare their auth requirement in code (`preHandler: app.authenticate`) AND in OpenAPI (`security: [{ cookieAuth: [] }]`), so generated clients understand the cookie requirement and so a missing-auth misconfiguration is visible at PR review time.

## Inputs / context

From [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts):

- `verifySessionToken(token, secret)` returns the decoded `{ sub, iat, exp }` payload or `null` on every failure mode. The middleware composes this; it does not duplicate the cryptographic primitive.
- `readSessionCookieFromHeader(cookieHeader)` extracts the value of the `aconversa-session` cookie. The middleware reuses it verbatim.
- `SESSION_COOKIE_NAME` constant — surfaces in the OpenAPI `cookieAuth` security scheme as the cookie name.

From [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — the existing `GET /auth/me` handler is the lift-and-shift source. Its current body:

```ts
const cookieHeader = ...;
const token = readSessionCookieFromHeader(cookieHeader);
if (token === undefined) throw ApiError(401, 'auth-session-invalid', '...');
const payload = await verifySessionToken(token, secret);
if (payload === null) throw ApiError(401, 'auth-session-invalid', '...');
const result = await pool.query(`SELECT id, oauth_subject, screen_name FROM users WHERE id = $1 AND deleted_at IS NULL`, [payload.sub]);
const row = result.rows[0];
if (row === undefined) throw ApiError(401, 'auth-session-invalid', '...');
return { userId: row.id, screenName: row.screen_name };
```

The middleware lifts everything before the `return` into `app.authenticate`; the route's handler becomes `(req) => req.authUser`.

From [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts) — the centralized handler classifies `ApiError` and renders the canonical `{ error: { code, message } }` envelope. The middleware MUST throw `ApiError` (not `reply.send()`-inline) so the envelope shape stays consistent.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `ApiError.unauthorized(message, details?)` produces a 401 with `code: 'unauthorized'` (the canonical factory). For consistency with the **existing** `/auth/me` 401 envelope shape — which uses `code: 'auth-session-invalid'` (and is asserted by Vitest + Cucumber today) — the middleware MUST construct the `ApiError` directly via `new ApiError(401, 'auth-required', ...)` rather than `ApiError.unauthorized(...)`. Code chosen: **`auth-required`** (see Decisions).

From [`apps/server/src/openapi.ts`](../../../apps/server/src/openapi.ts) — the OpenAPI plugin already declares the tag taxonomy and the shared `ErrorEnvelope` schema. The new `securitySchemes` entry for `cookieAuth` ships alongside the existing config block.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers the pure-logic middleware behavior; Cucumber+pglite covers the end-to-end "hit a protected route with a cookie" flow against the real migrated schema.

## Constraints / requirements

- **Mechanism**: a Fastify plugin (via `fastify-plugin` for cross-scope decoration) that exposes `app.authenticate: (request, reply) => Promise<void>`. Each protected route adds `preHandler: app.authenticate` to its options. NO global `onRequest` hook that gates by route-config flag — opt-in is safer (single missed annotation → endpoint stays closed; with opt-out a single missed flag opens an endpoint silently).
- **Request attachment**: on success, `request.authUser = { id: string, screenName: string }`. Decorated via `app.decorateRequest('authUser', null)` so Fastify pre-allocates the slot; populated by the `authenticate` decorator on the request that owns the lifecycle. TypeScript-side, augment `'fastify'` so the property is typed everywhere.
- **401 envelope**: the middleware throws `new ApiError(401, 'auth-required', 'authentication is required for this endpoint; sign in to continue')` on every failure mode (no cookie / malformed JWT / signature invalid / expired / payload-shape rejected / user-row missing / user soft-deleted). One envelope, no information leak — mirrors the `/auth/me` pattern but with a distinct `code` because the middleware semantics ("you are accessing a protected endpoint without a valid credential") differs from `/auth/me`'s semantics ("your /auth/me-specific session lookup failed"). See Decisions.
- **`/auth/me` refactor**: the route switches from inline cookie-verify-lookup to `preHandler: app.authenticate`. The handler body becomes `(req) => req.authUser` (returns `{ id, screenName }` — the response body's `userId` field is `req.authUser.id` and `screenName` is `req.authUser.screenName`). The OpenAPI response schema's body field names are renamed accordingly OR the handler builds the `{ userId, screenName }` shape explicitly from `req.authUser`. **Decision: keep the response shape `{ userId, screenName }`** so existing clients (Vitest + Cucumber + future frontends) don't break; the handler maps `req.authUser` → that body.
- **`/auth/me` 401 code drift**: the route currently throws `ApiError(401, 'auth-session-invalid', ...)`. After the refactor, the middleware fires before the handler with code `auth-required`. **Existing tests asserting `auth-session-invalid` from `/auth/me` are updated to assert `auth-required`** — this is a deliberate, audited change; the code rename is part of the refactor. The body shape stays canonical.
- **Module shape**:
  - `apps/server/src/auth/middleware.ts` — the plugin (`authenticatePlugin`) and the typed decorator surface. NO inline `reply.send()` — always throw `ApiError`, let the centralized handler render.
  - `apps/server/src/auth/types.d.ts` — module augmentation `declare module 'fastify'` adding `authUser?: AuthUser` to `FastifyRequest` and `authenticate: (req, reply) => Promise<void>` to `FastifyInstance`. Imported once via the plugin's side-effect; TypeScript propagates the types across the codebase.
  - `apps/server/src/auth/index.ts` — re-exports `authenticatePlugin`, `AuthUser`.
  - `apps/server/src/server.ts` — registers `authenticatePlugin` AFTER `errorHandlerPlugin` + `openapiPlugin` and BEFORE `authRoutesPlugin` (so `/auth/me`'s `preHandler: app.authenticate` can resolve the decorator at registration time).
  - `apps/server/src/openapi.ts` — adds `components.securitySchemes.cookieAuth = { type: 'apiKey', in: 'cookie', name: 'aconversa-session' }` to the swagger options. Protected routes attach `security: [{ cookieAuth: [] }]` to their `schema` block.
  - `apps/server/src/auth/routes.ts` — `/auth/me` switches to `{ preHandler: app.authenticate, schema: { security: [...], ... }, handler: (req) => ({ userId: req.authUser.id, screenName: req.authUser.screenName }) }`.
- **Pool injection**: the middleware needs the same `DbPool` injection contract as the auth routes plugin. Production registers it with no opts and the plugin reaches for `getDefaultPool()` lazily on first use; tests pass a memory or pglite-backed pool through the plugin options.
- **Secret + clock injection**: same contract as `authRoutesPlugin` — `sessionTokenSecret` (defaulting to `resolveSessionTokenSecret(process.env)`) and optional `now` for hermetic tests.
- **No global `onRequest` hook.** The plugin attaches no global hook; the only way a request reaches the `authenticate` decorator is via a route's `preHandler` opt-in.
- **No state.** The middleware is stateless per request — the cookie + the DB are the only sources. No request-scoped caching at this layer; the JWT's HMAC is cheap enough and the user lookup is O(1) on the indexed `users.id` primary key.
- **Audit lock-in (`no_profile_data_policy`)**: the audit's source-file list (in `apps/server/src/auth/no-profile-data.test.ts`) grows by one entry (`middleware.ts`) so the userinfo-endpoint grep covers the new file too.
- **Test layers per ADR 0022**:
  - **Vitest** in `apps/server/src/auth/middleware.test.ts` — pure-logic + Fastify `.inject()` tests on the plugin behavior. ~7 cases: protected route with valid cookie → handler runs and `request.authUser` is populated; missing cookie → 401 `auth-required`; invalid signature → 401; expired token → 401; user missing in DB → 401; soft-deleted user → 401; pre-existing `/auth/me` tests still pass after the refactor (the existing `session-token.test.ts` cases adapt: `auth-session-invalid` → `auth-required` in the `/auth/me` 401 assertions).
  - **Cucumber+pglite** in `tests/behavior/backend/auth-middleware.feature` — 3 scenarios end-to-end against the real migrated `users` table. Step defs in `tests/behavior/steps/backend-auth-middleware.steps.ts`.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new `apps/server/src/auth/middleware.test.ts` adds 7 cases; pre-existing `auth-session-invalid` assertions on `/auth/me` updated to `auth-required`.
- `pnpm run test:behavior:smoke` (Cucumber) green; new `tests/behavior/backend/auth-middleware.feature` adds 3 scenarios; pre-existing `session-token.feature` assertion on `/auth/me`'s 401 envelope code updated to `auth-required`.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` exposes `components.securitySchemes.cookieAuth` and `/auth/me`'s `security: [{ cookieAuth: [] }]` attribute.

## Decisions

- **Plugin decorator pattern over global `onRequest` hook with route-config opt-out.** Three alternatives surveyed:
  - **Plugin decorator, route-level opt-in** (chosen). Each protected route adds `preHandler: app.authenticate`. Missing the annotation → endpoint stays closed (the route has no auth, but it also has no protected functionality yet — the next sibling adds the annotation alongside the route). Mirrors `@fastify/auth` and `@fastify/jwt`'s recommended pattern.
  - **Global `onRequest` hook, route-config opt-out** (rejected). Routes declare `config: { public: true }` to opt out; everything else is protected by default. Safer in one sense (forgotten opt-in can't open an endpoint), but: a missing opt-out flag on a public route gates it inappropriately (e.g. `/healthz` rejects unauthenticated traffic — the compose healthcheck breaks). The error surface drifts from "endpoint quietly open" to "endpoint quietly closed"; both are bad, but the former is loudly testable (a route's behavior tests exercise both unauth and auth paths) while the latter would surface only as the broken healthcheck / dev-loop friction.
  - **Each route inlines the cookie-verify-lookup logic** (rejected — the status quo for `/auth/me`). N copies of the same chain; the refactor's whole point is to escape this.
- **`request.authUser` shape `{ id, screenName }`, NOT `{ userId, screenName }`.** Reasoning: `req.authUser.id` reads naturally ("the auth user's id") and avoids the `userId` redundancy that crops up when one calls `req.authUser.userId.id` in nested code. The OpenAPI response body still uses `userId` (the route handler maps `req.authUser.id → body.userId`) because that's the public contract; the request-scoped attachment is server-private.
- **401 code `auth-required`, NOT `unauthorized` and NOT `auth-session-invalid`.** Three alternatives surveyed:
  - **`auth-required`** (chosen). Reads as "authentication is required to access this resource" — the semantics every protected endpoint shares. Distinct from `auth-session-invalid` (the `/auth/me`-specific code today, which the refactor sunsets because the middleware now owns the failure path), and distinct from `unauthorized` (the canonical factory default, which is too generic to discriminate from other 401 sources).
  - **`unauthorized`** (rejected). The canonical factory's default. Generic; doesn't help frontends distinguish "you need to sign in" from other 401 conditions (e.g. an OAuth state mismatch returns 400 not 401, but a future denylist hit would return 401 with a different code — we want room for that vocabulary to grow).
  - **`auth-session-invalid` retained from `/auth/me`** (rejected). The current code; rejected because the middleware's semantics are broader than session-invalidity — the cookie may be absent altogether, which is a "you didn't try" condition, not "you tried with a bad session." `auth-required` covers both cleanly.
- **`/auth/me` keeps its `{ userId, screenName }` response body.** The middleware attaches `authUser: { id, screenName }`; the handler maps to `{ userId: authUser.id, screenName: authUser.screenName }`. Renaming the response field would break every frontend consumer for no semantic gain.
- **Pre-existing `auth-session-invalid` assertions migrate to `auth-required`.** Vitest's `session-token.test.ts` and Cucumber's `session-token.feature` both assert the `/auth/me` 401 envelope's code. The refactor changes the code; the assertions update. This is an audited, deliberate change documented here AND in the test diffs.
- **OpenAPI security scheme name `cookieAuth`.** Standard name across `@fastify/swagger` examples; `apiKey`-typed (OpenAPI 3.x doesn't distinguish "cookie auth" from "header/query API key" at the typed level — `in: 'cookie'` is the discriminator). The scheme references the cookie by its canonical name (`aconversa-session`); generated clients understand they must carry this cookie.
- **`security: [{ cookieAuth: [] }]` per protected route.** Per-route attachment rather than a global `security` block. The global `security` would make every route protected by default in the document; we want OpenAPI to mirror the runtime opt-in pattern.
- **Public-vs-protected taxonomy, recorded for downstream consumers**:
  - Public: `GET /`, `GET /healthz`, `/docs/*` (Swagger UI + JSON), `GET /auth/login`, `GET /auth/callback`, `POST /auth/screen-name`, `POST /auth/logout`. Rationale: the auth-handshake routes can't require auth (the user doesn't have a session yet); `/auth/logout` is intentionally idempotent for a stale-cookie cleanup; the meta routes are operator-facing and must work in the unauth path; `/docs/*` is unauthenticated today (a future task may gate it behind a feature flag).
  - Protected: `GET /auth/me`. Future endpoints (`/sessions/*`, `/sessions/:id/events`, `/sessions/:id/snapshots`, every WS upgrade) default to this.
- **`request.authUser` typed via `declare module 'fastify'` in a `.d.ts` file under `apps/server/src/auth/types.d.ts`.** Two alternatives surveyed:
  - **`.d.ts` module augmentation** (chosen). Loaded by TypeScript's project includes; the augmentation propagates the type across the whole server source. The augmentation file is small and clearly scoped to the auth concern.
  - **In-module `declare module` block at the top of `middleware.ts`** (rejected). Works, but the augmentation lives next to the runtime code; convention in the broader TypeScript community puts pure-type augmentations in a dedicated `.d.ts` for grep-ability.
- **The middleware is a `fastify-plugin`-wrapped plugin.** Without `fp(...)`, the decorator would attach to the plugin's encapsulation child and `app.authenticate` would be undefined on the parent scope. The `skip-override` marker is load-bearing; mirrors the `errorHandlerPlugin` and `openapiPlugin` conventions.
- **DB lookup IS per-request.** The JWT is stateless; the screen-name + soft-delete check is not. Caching at the middleware layer would introduce an invalidation problem (when a soft-delete lands, the cache would still serve the user); the per-request hit is a single indexed PK lookup and is cheap. If profiling shows this is a hotspot later, a TTL-bounded LRU is an easy follow-up.
- **No `request.log.debug` of the rejection sub-case at this layer.** The route logger captures the request id and the 401 response automatically (per `request_logging.md`'s configuration); the specific failure-mode discriminator (expired vs. bad-signature vs. missing-cookie) is operationally available via the `jose` errors but is intentionally NOT echoed into the response. The route handler can opt in to debug-log the discriminator if it cares; the middleware does not.

## Open questions

- **Denylist follow-up.** When (if) `auth_token_denylist` lands per `session_token_management.md`'s deferred follow-up, the middleware grows one indexed lookup against `(jti, expires_at)` before the user-row lookup. Not in scope here.
- **WebSocket re-use of the primitive.** `ws_auth_on_connect` will not call `app.authenticate` literally (the WS upgrade isn't a Fastify request lifecycle the way HTTP requests are); it will compose the same `verifySessionToken` + user-lookup chain. The middleware exports its inner helper so `ws_auth_on_connect` can call it without duplicating; the exact export surface is finalized when `ws_auth_on_connect` lands.
- **Audit log for auth failures.** Future security-audit task. The middleware is the natural place to land "log every 401 with the request id, IP, and rejection reason" once the audit-log story stands up.

## Status

**Done** — 2026-05-10. Landed as:

- Middleware plugin: [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — exports `authenticatePlugin(app, opts?)`, `AuthUser` interface, and the internal `authenticateRequest` helper for `ws_auth_on_connect` to compose later. Throws `ApiError(401, 'auth-required', ...)` on every failure path; the centralized handler renders the canonical envelope.
- Type augmentation: [`apps/server/src/auth/types.d.ts`](../../../apps/server/src/auth/types.d.ts) — `declare module 'fastify'` adds `authUser?: AuthUser` to `FastifyRequest` and `authenticate: AuthDecorator` to `FastifyInstance`.
- `/auth/me` refactor: [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — handler reduced to a body that maps `req.authUser` to `{ userId, screenName }`. The cookie-read / JWT-verify / user-lookup inlined logic deleted; tests + Cucumber re-cover the path through the middleware.
- Server bootstrap: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — `authenticatePlugin` registered after the error-handler + openapi plugins and before the auth-routes plugin.
- Auth barrel update: [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) — re-exports `authenticatePlugin`, `AuthUser`.
- OpenAPI security scheme: [`apps/server/src/openapi.ts`](../../../apps/server/src/openapi.ts) — `components.securitySchemes.cookieAuth` declared. `GET /auth/me` attaches `security: [{ cookieAuth: [] }]`.
- Vitest unit tests: [`apps/server/src/auth/middleware.test.ts`](../../../apps/server/src/auth/middleware.test.ts) — covers valid-cookie / missing / tampered / expired / user-missing / soft-deleted paths.
- Cucumber+pglite scenarios: [`tests/behavior/backend/auth-middleware.feature`](../../../tests/behavior/backend/auth-middleware.feature) with step defs at [`tests/behavior/steps/backend-auth-middleware.steps.ts`](../../../tests/behavior/steps/backend-auth-middleware.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 734 → 745 (+11); Cucumber 130 → 133 (+3).
