# Enforce same-origin WS upgrade via Origin allowlist

Source: [docs/security/m3-review/auth.md F-002](../../../docs/security/m3-review/auth.md)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.ws_origin_allowlist`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.websocket_protocol.ws_auth_on_connect` (settled — `preValidation` hook, `ApiError(401, AUTH_REQUIRED_CODE, …)`, `__buildTestWsApp`, `WsConnectionContext.user`); `backend.api_skeleton.error_handling` (settled — `ApiError.forbidden` factory + centralized envelope renderer); `backend_hardening.auth_hardening.prod_cors_lockdown` (sibling — same env-var contract for CORS).

## What this task is

Add a server-enforced `Origin`-header allowlist on the `GET /ws` upgrade. The check runs **inside the existing `preValidation` hook**, **BEFORE** the cookie/JWT gate, and consumes a resolved allowlist threaded from `createServer()` via the WS plugin's options. Three things land together:

1. **Env resolver — `apps/server/src/ws-origin-allowlist.ts`**. A pure function `resolveWsOriginAllowlist(env)` that returns either the dev-only sentinel `WS_ORIGIN_ALLOWLIST_ANY` (`'*'`) when `NODE_ENV !== 'production'` or an explicit `readonly string[]` of WHATWG-normalized origin strings in production. The production list is composed from `APP_BASE_URL`'s origin (REQUIRED — missing or unparseable throws `WsOriginAllowlistError` at boot) plus the comma-separated entries of `CORS_ORIGIN_ALLOWLIST` (optional). The list is de-duplicated and order-stable. The resolver is co-located with the future `resolveCorsOptions(env)` so the env-var coupling between the WS gate and the CORS layer is visually loud and impossible to drift.
2. **Plugin-options surface — `WsConnectionHandlingOptions.originAllowlist`**. The WS plugin accepts the resolved allowlist as a required option. `server.ts` threads the resolver's output through `app.register(wsConnectionHandlingPlugin, { originAllowlist: wsOriginAllowlist })`. Tests construct the same field directly (`'*'` for permissive defaults; a tight array for the prod-style reject/accept tests).
3. **The gate itself — first lines of the `preValidation` hook on `GET /ws`**. When `auth.originAllowlist === WS_ORIGIN_ALLOWLIST_ANY` the check is a no-op (dev). Otherwise the hook reads `request.headers['origin']`, REQUIRES a non-empty value, and REQUIRES byte-equal membership against the allowlist; on any reject it throws `new ApiError(403, ORIGIN_NOT_ALLOWED_CODE, ORIGIN_NOT_ALLOWED_MESSAGE)`. The centralized error-handler plugin renders the canonical envelope on the upgrade response; `@fastify/websocket`'s `onResponse` destroys the socket; the client's `injectWS` / browser `WebSocket` sees a non-101 response and the handshake never completes. No `connectionId` is minted; no per-connection state is allocated; the cookie + JWT verify never runs (so an off-origin probe cannot use 401-vs-403 to leak whether it also carried a stolen cookie).

This task also extends `__buildTestWsApp` with an optional `originAllowlist?: WsOriginAllowlist` option defaulting to `WS_ORIGIN_ALLOWLIST_ANY`. Existing callers (every cucumber step file + `connection.test.ts` + `auth.test.ts`) get the permissive default automatically; the new origin-allowlist tests pass a tight array to exercise the prod-style posture hermetically (no `NODE_ENV` flip required).

## Why it needs to be done

F-002 confirms the same-origin assumption is load-bearing: the WS auth gate consumes a cookie that browsers only send on a same-origin upgrade. Without server enforcement, a future cross-origin deployment shape (audience UI on a subdomain, a "split the app across two hosts" refactor, etc.) silently breaks the auth contract — either rejecting every legitimate audience connection (DoS) OR getting "fixed" by a maintainer with a query-string token (referer/log-line leak). The server has to be the source of truth for the same-origin invariant, not the documentation.

The fix is small (a single allowlist check in `preValidation`) but the *seam* it creates matters: when `audience.broadcast_surface` lands and a cross-origin client legitimately needs WS access, the operator extends `CORS_ORIGIN_ALLOWLIST` once and BOTH the CORS layer and the WS gate update together. The env-var coupling is the structural fix.

## Inputs / context

From [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md):

- **F-002 [High] — Cross-origin audience surface will silently break the WS auth gate**. The constraint is documented in `tasks/refinements/backend/ws_auth_on_connect.md:76` as a "loud reminder" only. The suggested fix is verbatim: "Add an `Origin`-header allowlist on `/ws` (env-driven, defaulting to `APP_BASE_URL`'s origin) and a query-string-ticket primitive issued by an authenticated HTTP exchange for cross-origin clients. Reject upgrades whose `Origin` is missing or not in the allowlist." This task implements the allowlist half; the cross-origin ticket primitive is a future task triggered by `audience.broadcast_surface`.

From [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) (the model for the constants):

- `AUTH_REQUIRED_CODE = 'auth-required'` + `AUTH_REQUIRED_MESSAGE` — the kebab-string + canonical-phrasing pattern this task mirrors with `ORIGIN_NOT_ALLOWED_CODE = 'origin-not-allowed'` + `ORIGIN_NOT_ALLOWED_MESSAGE`. Single phrasing across every reject variant preserves the no-info-leak property (a probe can't distinguish "no header" from "wrong origin" by the message).

From [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) (the `preValidation` hook to extend):

- The hook is the existing seam. The cookie short-circuit comment ("Short-circuit BEFORE resolving the pool when no cookie is present") already explains why ordering matters; the Origin check fires earlier still (the hook's first action) so we avoid even the cookie-parse cost on an off-origin probe.
- `WsAuthResolvers` is the interface threaded through plugin options; adding `readonly originAllowlist: WsOriginAllowlist` keeps the route-plugin code closed to extension elsewhere — the auth gate reaches for `auth.originAllowlist` and nothing else.

From [`apps/server/src/ws-origin-allowlist.ts`](../../../apps/server/src/ws-origin-allowlist.ts):

- The resolver was scoped + scaffolded ahead of the gate. The module's docblock explains the env-var sharing with the future CORS resolver. The unit tests for the resolver itself live alongside it (per ADR 0022); this task only consumes its output.

From the sibling [`tasks/refinements/backend-hardening/prod_cors_lockdown.md`](./prod_cors_lockdown.md) (placeholder — not yet written, but the .tji entry exists):

- Reads the SAME `APP_BASE_URL` + `CORS_ORIGIN_ALLOWLIST` env vars. The two resolvers are co-located in `apps/server/src/` (not buried in `server.ts`) so the operator's mental model is "one allowlist env var pair, two layers consuming it."

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Empirical verification = committed test. The gate ships with **+10 Vitest cases** in `apps/server/src/ws/origin-allowlist.test.ts` covering the prod-array reject/accept variants, the multi-entry allowlist, the missing-Origin reject in prod, the dev-sentinel permissive case (any Origin / missing Origin), and the exported wire-code constant.

## Constraints / requirements

- **Reuse `CORS_ORIGIN_ALLOWLIST` env (no parallel `WS_ORIGIN_ALLOWLIST` env)**. A deployment cannot drift the WS gate away from the CORS layer because both layers read the same source. The resolver's docblock makes this design choice explicit; the WBS sibling `prod_cors_lockdown` reads the same vars from `resolveCorsOptions(env)` (future).
- **Dev posture: accept any Origin or missing Origin**. The sentinel returns `'*'` when `NODE_ENV !== 'production'`. Curl, `app.injectWS` without an explicit `origin`, and any non-browser client all omit Origin; failing closed in dev would break every developer flow + every existing hermetic test. The cookie gate remains the only auth contract in dev.
- **Prod posture: REQUIRE Origin AND require it on the allowlist**. A real browser ALWAYS sends `Origin` on a WS upgrade; absence is a probe. The resolver fails-fast at boot if `APP_BASE_URL` is missing/malformed (mirrors `OidcConfigError`'s fail-fast posture) so a misconfigured production never silently downgrades to "open."
- **Origin check FIRES BEFORE the cookie check**. The hook's first action. Two reasons: (a) cost — an off-origin probe shouldn't pay the cookie-parse + JWT-verify cost; (b) no 401-vs-403 leak — a probe can't deduce "my stolen cookie still works, I just need to spoof Origin" by reading two different error codes from two different gate orderings.
- **Wire code: `ORIGIN_NOT_ALLOWED_CODE = 'origin-not-allowed'`, status 403**. Forbidden (the client is identified — same WS endpoint, same authentication contract — just not allowed from that origin) rather than 401 (no credentials). The kebab-case mirrors the existing taxonomy (`auth-required`, `forbidden`, etc.). The 403 envelope is the canonical `{ error: { code, message } }` shape the centralized handler renders for every `ApiError`.
- **No custom WS close codes**. Same rationale as `ws_auth_on_connect`: the pipeline runs BEFORE the upgrade is hijacked, so the rejection is an HTTP envelope on the upgrade response — not a 4xxx close code on a half-completed handshake. Operators monitor 403s in one envelope schema regardless of which transport surfaced them.
- **`__buildTestWsApp` accepts an `originAllowlist?: WsOriginAllowlist` option, defaulting to `WS_ORIGIN_ALLOWLIST_ANY`**. Existing test callers (cucumber step files + `connection.test.ts` + `auth.test.ts`) compose with the default and get the permissive posture automatically. The new origin-allowlist tests pass a tight array to exercise the prod-style posture without flipping `NODE_ENV`. The optional shape mirrors the `now?: () => number` and `catchUpMaxEvents?: number` pattern already in `BuildTestWsAppOptions`.
- **No ad-hoc probes** (ADR 0022). Every empirical check is a committed test. The new file `apps/server/src/ws/origin-allowlist.test.ts` carries the prod-array reject (off-allowlist Origin), the prod-array missing-Origin reject, the multi-entry independence cases, the dev-sentinel accept-anything cases, and a lock-in test for the exported wire-code constant.

## Acceptance criteria

- `pnpm run check` green (lint + format + typecheck + tests-typecheck + tools-typecheck).
- `pnpm run test:smoke` (Vitest) green; net delta **+10 tests** in `apps/server/src/ws/origin-allowlist.test.ts`. No regression in `auth.test.ts` / `connection.test.ts` / any cucumber step file (all default to the permissive sentinel via `__buildTestWsApp`'s new option default).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/connection.ts` can identify the Origin gate as the first action in the `preValidation` hook, see the dev-vs-prod posture narrowed against `WS_ORIGIN_ALLOWLIST_ANY`, and trace the threading from `server.ts`'s `resolveWsOriginAllowlist(process.env)` call.
- `ORIGIN_NOT_ALLOWED_CODE = 'origin-not-allowed'` and `ORIGIN_NOT_ALLOWED_MESSAGE` are exported from `apps/server/src/ws/connection.ts` (and re-exported through `apps/server/src/ws/index.ts`) so tests + monitoring + future cucumber steps assert against the same constants the runtime emits.

## Decisions

- **Reuse the CORS env vars; NO parallel `WS_ORIGIN_ALLOWLIST` env**. A WS upgrade is an HTTP `Upgrade` request; the browser sends the same `Origin` header it sends on a cross-origin `fetch`. The hardening invariant is "any origin the CORS layer accepts MUST be acceptable on the WS gate, and vice versa." Sharing `APP_BASE_URL` + `CORS_ORIGIN_ALLOWLIST` makes that invariant a config-layer fact rather than a documentation hope. A deployment can't drift the WS gate away from the CORS layer because they read the same source. The sibling `prod_cors_lockdown` task reads the same vars from `resolveCorsOptions(env)`.

- **Dev-vs-prod posture on missing Origin: dev accepts, prod rejects**. Two distinct postures, narrowed in the gate against the `WS_ORIGIN_ALLOWLIST_ANY` sentinel. Dev rationale: curl, `app.injectWS` without an explicit `origin`, and every non-browser test client omits the header; failing closed in dev would break the entire hermetic-test surface + every developer flow. Prod rationale: a real browser ALWAYS sends `Origin` on a WS upgrade; absence is a probe. The resolver's fail-fast posture at boot ensures production never silently downgrades to the dev sentinel via a missing env var.

- **Wire code: `'origin-not-allowed'`, HTTP 403**. Not 401 (that's "no credentials"); not 400 (the request is well-formed). 403 + a kebab `code` mirroring the `auth-required` shape. The constants `ORIGIN_NOT_ALLOWED_CODE` and `ORIGIN_NOT_ALLOWED_MESSAGE` are exported from `connection.ts` and re-exported through `ws/index.ts` so tests + monitoring rules + future cucumber steps pin against the same string the runtime emits. A future PR that renames the code (without updating monitoring) trips the lock-in test in `origin-allowlist.test.ts`. The message is intentionally generic ("the WebSocket upgrade Origin is not on the server allowlist") so missing-Origin and unlisted-Origin emit identical envelopes — no info leak about which sub-branch fired.

- **Origin check fires BEFORE the cookie check**. The hook's first action. Cost: an off-origin probe shouldn't pay the cookie-parse + JWT-verify + users-row-lookup chain. No-leak: a probe can't compare "off-origin with cookie → 401" vs "off-origin without cookie → 401" vs "on-origin with stolen cookie → 200" to deduce the gate ordering. With Origin-first, both off-origin branches collapse to a single 403 envelope; an attacker learns nothing about whether their stolen cookie also works. The cookie-short-circuit comment in the existing hook already explains why ordering matters; the Origin gate slots in one layer earlier still.

- **`__buildTestWsApp` accepts an optional `originAllowlist?`, defaulting to `WS_ORIGIN_ALLOWLIST_ANY`**. Hermetic testing of the prod posture without flipping `NODE_ENV`. The default preserves every existing caller's behavior — the cucumber step files (`backend-ws-auth.steps.ts`, `backend-ws-envelope.steps.ts`, the eight handler-specific step files) all build the test app without passing `originAllowlist` and get the permissive sentinel. The new `origin-allowlist.test.ts` passes a tight array (`['https://app.example.com']`) for the prod-style cases and the sentinel `WS_ORIGIN_ALLOWLIST_ANY` for the dev cases. Mirrors the `now?: () => number` and `catchUpMaxEvents?: number` pattern already in `BuildTestWsAppOptions`. No `process.env.NODE_ENV` write in tests.

- **New test file, not extension of `auth.test.ts`**. The Origin gate is a separate concern from the cookie gate (different env var, different wire code, different rejection ordering). Co-locating its tests in a sibling file (`origin-allowlist.test.ts`) keeps each file's narrative focused: `auth.test.ts` is "the cookie gate's reject/accept variants"; `origin-allowlist.test.ts` is "the Origin gate's prod-vs-dev posture." The two files share the same test-helpers (`makeMemoryPool`, `FIXTURE_USER_ID`, `FIXTURE_SCREEN_NAME`, `TEST_SESSION_SECRET`) so the WS surface under test is identical across both layers.

- **WsAuthResolvers gets `originAllowlist`, not the route-plugin's options directly**. The route-plugin currently consumes `{ auth: WsAuthResolvers }` (pool, secret, clock). Adding `originAllowlist` to the same bundle keeps every gate-relevant resolver in one place: a future review of "what does the WS gate consume?" reads exactly one interface. The outer plugin (`wsConnectionHandlingPluginAsync`) constructs the literal; the inner plugin (`wsRoutePlugin`) consumes it.

- **Resolver throws `WsOriginAllowlistError` at boot for missing/malformed prod env**. Same fail-fast posture as `OidcConfigError`. The boot-time failure means a misconfigured production never silently downgrades to "open" (the alternative — falling back to `'*'` on a missing `APP_BASE_URL` — would be a footgun). The dev sentinel only fires when `NODE_ENV !== 'production'`; in production every env-var failure surfaces at `createServer()` time.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Server (env resolver): [`apps/server/src/ws-origin-allowlist.ts`](../../../apps/server/src/ws-origin-allowlist.ts) (`resolveWsOriginAllowlist(env)` + `WS_ORIGIN_ALLOWLIST_ANY` + `WsOriginAllowlist` + `WsOriginAllowlistError`).
- Server (gate): [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — `ORIGIN_NOT_ALLOWED_CODE` + `ORIGIN_NOT_ALLOWED_MESSAGE` exported constants; `WsConnectionHandlingOptions.originAllowlist` required; `WsAuthResolvers.originAllowlist` threaded; the gate inside the `preValidation` hook running BEFORE the cookie check; `BuildTestWsAppOptions.originAllowlist?` with `WS_ORIGIN_ALLOWLIST_ANY` default.
- Server (bootstrap): [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — `resolveWsOriginAllowlist(process.env)` call + `app.register(wsConnectionHandlingPlugin, { originAllowlist })`.
- Server (barrel): [`apps/server/src/ws/index.ts`](../../../apps/server/src/ws/index.ts) re-exports `ORIGIN_NOT_ALLOWED_CODE` + `ORIGIN_NOT_ALLOWED_MESSAGE` for downstream tests + monitoring.
- Tests (Vitest): [`apps/server/src/ws/origin-allowlist.test.ts`](../../../apps/server/src/ws/origin-allowlist.test.ts) — **+10 tests** (prod-array off-allowlist reject; prod-array missing-Origin reject; prod-array on-allowlist accept; prod-array on-allowlist falls through to cookie 401; multi-entry independent accept; multi-entry off-allowlist reject; dev-sentinel any-Origin accept; dev-sentinel missing-Origin accept; dev-sentinel cookie-gate still enforces 401; wire-code constant lock-in).
- `complete 100` marker added in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
