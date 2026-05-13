Source: docs/security/m3-review/coverage.md G-019

# `Cache-Control: no-store` on `/auth/me` + sibling identity endpoints

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.auth_me_cache_control`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.session_token_management` (settled — produced the cookie-bearing identity surface this task hardens); `backend.auth.auth_middleware` (settled — produced the `app.authenticate` preHandler the `/auth/me` route opts into).

## What this task is

Declare `Cache-Control: no-store` on every Fastify response served by the identity / cookie-bearing routes in `apps/server/src/auth/routes.ts`:

- `GET /auth/me` (200 success body carrying `{ userId, screenName }`; 401 envelope on missing / invalid / expired cookie).
- `POST /auth/logout` (204 idempotent cookie-clear).
- `POST /auth/screen-name` (200 success body carrying `{ userId, screenName }` + two `Set-Cookie` lines).
- `GET /auth/callback` (302 returning-user redirect carrying the session `Set-Cookie`; 200 new-user body carrying `{ sub, oauthSubject, userId, needsScreenName }` + the pending `Set-Cookie`).

`GET /auth/login` is intentionally NOT marked: it 302-redirects to the issuer with a per-flow (not per-user) `state` value and carries no identity-bearing payload.

## Why it needs to be done

G-019 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md):

> `GET /auth/me` does not return cache-control headers; a CDN could cache it across users. \[...] No `Cache-Control: no-store` header is set on the response. A misconfigured CDN/proxy could cache one user's response and serve it to another. Today's deployment is same-origin without an intermediate CDN, so this is informational.

Today's deployment is same-origin without a CDN — so there is no live exploit. The fix is defense-in-depth for the moment the deployment topology grows an intermediate cache (a future CDN, a corporate proxy, an in-cluster reverse proxy with default cacheability). `Cache-Control: no-store` is the canonical HTTP/1.1 directive forbidding any cache layer from storing the response. Once stamped at the origin, every well-behaved intermediary refuses to cache it.

The discipline question — which endpoints get the directive — extends beyond `/auth/me`. The audit walked every route in `auth/routes.ts`:

- Identity-bearing response bodies (`/auth/me`, `/auth/screen-name`, `/auth/callback` new-user branch) — MUST NOT be cached, because the body is per-user state.
- Cookie-bearing responses (`/auth/screen-name`, `/auth/callback` both branches, `/auth/logout`) — MUST NOT be cached, because a cached `Set-Cookie` replays one user's credential to whoever the cache serves next. Logout's "cookie-clear" Set-Cookie is also per-user state (a cached clear would log out unrelated users).
- Pure redirects with no per-user state (`/auth/login` → issuer authorization URL) — the `state` value is per-flow, not per-user; the redirect itself carries no identity. Marking it would be defensive but unnecessary; leaving it unmarked preserves the design boundary "no-store is for identity-bearing responses, not every Fastify response."

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-019 — source finding (Informational).
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — the routes plugin. `GET /auth/me` opts into the auth middleware via `preHandler: app.authenticate`; the handler returns `{ userId, screenName }` from `request.authUser`. `POST /auth/logout` is a synchronous 204 emitter. `POST /auth/screen-name` emits the two-cookie `Set-Cookie` array. `GET /auth/callback` splits on the upserted users row's screen name — returning-user gets a 302 + session cookie; new-user gets a 200 + pending cookie.
- [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — registers `app.authenticate` as a decorator that throws `ApiError(401, 'auth-required', ...)` on every failure mode. Critically, throwing from the middleware lands the request at the centralized error-handler plugin's `reply.status().type().send(envelope)` — which does NOT clear previously-set response headers. So a `Cache-Control: no-store` set in a preHandler that runs BEFORE `app.authenticate` propagates onto the 401 envelope too.
- [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts) line 165 — `reply.status(statusCode).type('application/json').send(envelope)`. Confirms no header reset.
- [RFC 9111 §5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111#name-no-store) — `no-store` is the HTTP-cache directive that forbids both shared and private caches from storing the response.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the cache-control behavior is HTTP-response shape; lands as Vitest unit tests against Fastify's `.inject(...)`.

## Constraints / requirements

- **One directive, one canonical name.** `Cache-Control: no-store` only. The HTTP/1.0 sibling `Pragma: no-cache` is intentionally omitted: every modern intermediary respects `Cache-Control`; the legacy directive adds bytes without closing any additional gap on a same-origin Fastify deployment. A future intermediary that ONLY speaks HTTP/1.0 is not on the deployment roadmap.
- **Defense-in-depth at the origin.** The directive lands in the Fastify route handler / preHandler, not at a CDN config or an Nginx layer. The origin is the only common ancestor for every future deployment topology.
- **The `/auth/me` 401 path MUST also carry the header.** Authed-200 trivially carries it (the handler sets it). The unauthed-401 case is the load-bearing one: `app.authenticate` throws BEFORE the handler runs, so a handler-only `reply.header(...)` would leave the 401 envelope unmarked. The fix: stamp the header in a preHandler that runs BEFORE `app.authenticate`. The error-handler's `reply.status().type().send()` preserves previously-set headers, so the no-store directive propagates onto the canonical envelope.
- **The preHandler MUST tolerate the screen-name unit-test wiring topology.** The screen-name unit-test app (`apps/server/src/auth/screen-name.test.ts`) registers `authRoutesPlugin` WITHOUT first registering `authenticatePlugin` — it never hits `/auth/me`, so the missing middleware is intentional. Pre-this-task, the route used `preHandler: app.authenticate` (single function); when `app.authenticate` was undefined, Fastify accepted the undefined preHandler as a no-op. The new combined preHandler must replicate that tolerance: the function-typeof check skips the `app.authenticate` call when the decorator is absent.
- **`/auth/login` is NOT marked.** The redirect to the IdP carries a per-flow `state` (not per-user) and no identity-bearing payload. Marking it would be defensive but unnecessary, and the negative-test pin documents the design boundary.
- **`GET /healthz` is NOT marked.** The negative pin in `apps/server/src/routes/healthz.test.ts` documents that the directive is identity-endpoint-scoped, not a global Fastify default.
- **No throwaway probes (ADR 0022).** Every behavior pinned lands as a Vitest case. The header presence is tested via `response.headers['cache-control']` against `.inject(...)` returns; the negative pins (for `/auth/login` and `/healthz`) also live as Vitest cases.

## Acceptance criteria

- `apps/server/src/auth/routes.ts`:
  - `GET /auth/me` declares `preHandler: authMePreHandler` where `authMePreHandler` stamps `Cache-Control: no-store` and then calls `app.authenticate` (when defined).
  - `POST /auth/logout` calls `reply.header('Cache-Control', 'no-store')` before `reply.code(204).send()`.
  - `POST /auth/screen-name` calls `reply.header('Cache-Control', 'no-store')` before returning the body.
  - `GET /auth/callback` calls `reply.header('Cache-Control', 'no-store')` on BOTH branches (the returning-user 302 + the new-user 200).
  - `GET /auth/login` is unchanged (no `Cache-Control` header set).
- Vitest cases in `apps/server/src/auth/session-token.test.ts`:
  - `GET /auth/me` authed 200 → `expect(response.headers['cache-control']).toBe('no-store')`.
  - `GET /auth/me` unauthed 401 → same.
  - `POST /auth/logout` 204 → same.
  - `POST /auth/screen-name` 200 → same.
  - `GET /auth/callback` returning-user 302 → same.
  - `GET /auth/callback` new-user 200 → same.
  - `GET /auth/login` 302 → header is undefined (negative pin).
- Vitest case in `apps/server/src/routes/healthz.test.ts`:
  - `GET /healthz` 200 → header is undefined (negative pin for a non-identity endpoint).
- `pnpm run check` succeeds.
- `pnpm run test:smoke` green.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **Directive: `Cache-Control: no-store` only.** The canonical HTTP/1.1 directive forbidding any cache from storing the response. `Pragma: no-cache` (HTTP/1.0) is omitted: every modern intermediary respects `Cache-Control` and the legacy directive adds bytes without closing any additional gap on the same-origin Fastify deployment. A future operator running through an HTTP/1.0-only intermediary can layer `Pragma` on at the proxy.
- **Scope: identity / cookie-bearing routes.** Marked: `/auth/me`, `/auth/logout`, `/auth/screen-name`, `/auth/callback` (both branches). Unmarked: `/auth/login` (per-flow state only, no identity). The `/healthz` negative pin documents the boundary for future readers.
- **`/auth/me` uses a preHandler-stamped header, not handler-stamped.** The 401 path throws from `app.authenticate` before the handler runs; stamping the header in the handler would leave the 401 envelope unmarked. The preHandler runs first, sets the header, then delegates to `app.authenticate` — the error-handler's `reply.send(envelope)` preserves the header so the 401 carries it.
- **The preHandler tolerates the missing-middleware wiring topology.** `app.authenticate` is a decorator from the sibling `authenticatePlugin`; the screen-name unit-test app does not register that plugin (it never hits `/auth/me`). The preHandler's `typeof app.authenticate === 'function'` guard skips the auth call in that topology — replicating the prior behavior where `preHandler: app.authenticate` (single value) was a no-op when undefined. Production registers both plugins; the production preHandler delegates fully.
- **Other identity routes stamp the header in-handler.** `/auth/logout`, `/auth/screen-name`, `/auth/callback` all set the header via `reply.header(...)` inline. They have no 401 throw-before-handler path (the 401s from these surfaces originate inside the handler itself, where the header set has already run), so a preHandler is unnecessary.
- **The login leg is intentionally unmarked.** A 302 to the IdP with a per-flow `state` carries no per-user identity; the redirect is identical for any caller. Marking it would be defensive but adds noise to the directive's "this is identity" signal. The negative-test pin guards against future over-application.
- **`/healthz` negative pin.** A separate test in `healthz.test.ts` asserts the directive is NOT present on the liveness probe. Without this pin, a future refactor that wires a global `onSend` hook setting `no-store` would silently break public-probe cacheability without surfacing a test failure. The pin makes the directive's identity-only scope load-bearing.
- **No new module, no new export.** The directive is a per-route concern; centralising it into a shared helper would invite over-application. Each identity route states the directive inline, which keeps the per-route decision visible at the call site.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

Artifacts:

- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — `Cache-Control: no-store` stamped on the four identity-route response paths: `GET /auth/me` (via a combined `authMePreHandler` that runs before `app.authenticate`), `POST /auth/logout` (inline before `reply.code(204).send()`), `POST /auth/screen-name` (inline before returning), `GET /auth/callback` (both branches: returning-user 302 + new-user 200). `GET /auth/login` deliberately unchanged.
- [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) — new `describe('Cache-Control: no-store on identity endpoints (G-019)')` block with seven `it(...)` cases: `/auth/me` authed 200, `/auth/me` unauthed 401, `/auth/logout` 204, `/auth/screen-name` 200, `/auth/callback` returning-user 302, `/auth/callback` new-user 200, `/auth/login` 302 (negative pin).
- [`apps/server/src/routes/healthz.test.ts`](../../../apps/server/src/routes/healthz.test.ts) — one new `it(...)` case pinning `/healthz` does NOT carry `Cache-Control: no-store` (negative pin documenting the identity-endpoint scope).
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to `auth_me_cache_control`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: +7 in `session-token.test.ts` (40 → 47), +1 in `healthz.test.ts` (4 → 5). Total +8 across the suite. `pnpm run check` and `pnpm run test:smoke` both pass (1168 tests green).
