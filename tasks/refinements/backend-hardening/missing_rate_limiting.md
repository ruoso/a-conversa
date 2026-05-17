Source: GitHub code-scanning alerts #2–#9 (rule `js/missing-rate-limiting`)

# Register a global per-IP rate limiter on the HTTP surface

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.missing_rate_limiting`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — `createServer` factory at `apps/server/src/server.ts`); `backend.api_skeleton.error_handling` (settled — `errorHandlerPlugin` + the canonical envelope live at `apps/server/src/error-handler.ts`).

## What this task is

Register [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) globally inside `createServer` so every HTTP route handler the server exposes is rate-limited at the framework boundary. The plugin attaches an `onRequest` hook to every registered route; once a per-IP per-window bucket overflows, the plugin invokes our `errorResponseBuilder`, which throws `ApiError(429, 'rate-limited', ...)` — the existing `errorHandlerPlugin` then serialises the canonical `{ error: { code, message } }` envelope.

Two knobs drive the limit, both env-overridable so production can tune without code change:

1. **`RATE_LIMIT_MAX_PER_WINDOW`** — per-IP request ceiling per window. Default **1000**.
2. **`RATE_LIMIT_TIME_WINDOW_MS`** — rolling window length (milliseconds). Default **60_000** (1 minute).

The resolution helpers (`resolveRateLimitMax`, `resolveRateLimitTimeWindowMs`) follow the `resolveBodyLimit` / `resolveCatchUpMaxEvents` precedent — read env, `parseInt`, fall back to the default on absent / unparseable / non-positive input.

`/healthz` is allow-listed so compose / k8s liveness probes never count against the per-IP bucket. A probe storm hitting the same IP would otherwise read as a service outage to the orchestrator (the probe times out on 429 just like it would on a 5xx).

## Why it needs to be done

GitHub code scanning reported 8 open `js/missing-rate-limiting` alerts (#2–#9), each on a route handler in `apps/server/src/auth/routes.ts` or `apps/server/src/sessions/routes.ts`. The rule flags handlers that touch the database or perform authorisation but sit on a server that has no rate-limit middleware. Concrete sites:

| # | File | Line | Handler |
| - | ---- | ---- | ------- |
| 2 | `auth/routes.ts` | 514 | `GET /api/auth/login` |
| 3 | `auth/routes.ts` | 592 | `GET /api/auth/callback` |
| 4 | `auth/routes.ts` | 746 | `POST /api/auth/screen-name` |
| 5 | `auth/routes.ts` | 879 | `POST /api/auth/logout` |
| 6 | `sessions/routes.ts` | 1488 | `GET /api/sessions` |
| 7 | `sessions/routes.ts` | 1684 | `GET /api/sessions/:id` |
| 8 | `sessions/routes.ts` | 1967 | `PATCH /api/sessions/:id/privacy` |
| 9 | `sessions/routes.ts` | 2963 | `GET /api/sessions/:id/participants` |

The M3 review (`docs/security/m3-review/auth.md`) already noted the gap:

> Rate limiting / brute-force throttling on the auth endpoints (none exists — Authelia handles upstream auth rate limits via its `regulation` block, which is dev-permissive at 10 retries / 2 min).

…and `docs/security/m3-review/inputs.md` F-006 explicitly contemplated rate-limiting `/auth/login` at the deployment edge. Closing the in-process gap satisfies the CodeQL rule and adds a per-IP guardrail that survives deployments which forget to enable an edge LB / WAF policy.

The in-process layer is not a substitute for an edge-tier policy — a single attacker behind multiple IPs (or behind a CDN) routes around it — but it bounds the per-IP cost of cheap-but-DB-touching endpoints (e.g. a UUID-iteration probe against `GET /api/sessions/:id`) to a known ceiling.

## Inputs / context

From [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (pre-task — `createServer` plugin order):

```
@fastify/sensible → @fastify/cors → errorHandlerPlugin → openapiPlugin
  → healthzPlugin → authenticatePlugin → authRoutesPlugin?
  → sessionsRoutesPlugin → ws* → staticFrontendsPlugin
```

There is no rate-limit plugin in the stack. The bodyLimit + `ws` `maxPayload` knobs (per `fastify_body_limit.md`) cap payload size but say nothing about request rate.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `ApiError` carries `statusCode + code + message + details`; throwing one from anywhere in the request lifecycle reaches the centralised handler in `error-handler.ts` and renders the canonical envelope.

`@fastify/rate-limit` v10's `errorResponseBuilder` runs INSIDE the request lifecycle — throwing from it triggers `setErrorHandler`, so the 429 wire shape matches every other 4xx the server emits. The plugin still sets its informative response headers (`retry-after`, `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`) — those layer on top of the envelope without colliding with the body shape.

From the M3-review `inputs.md` F-006 finding:

> Suggested fix: Cap `map.size` in `createFlowStateStore`'s `put(...)` (e.g. 10_000); reject excess or evict oldest. Combined with rate-limiting `/auth/login` on the deployment edge.

The flow-state cap landed (`flow_state_map_bound.md`); the rate-limit half is what this task closes — at the framework boundary rather than the deployment edge, because we want a guarantee that survives a misconfigured ingress.

## Constraints / requirements

- **Plugin pin**: `@fastify/rate-limit@10.3.0` (matches the project's `fastify@5.8.5` major and the existing `@fastify/*` version posture — every neighbour is a current major).
- **Defaults**: `DEFAULT_RATE_LIMIT_MAX = 1000`, `DEFAULT_RATE_LIMIT_TIME_WINDOW_MS = 60_000`. Generous enough that a SPA single-user session (page navigations triggering `@fastify/static` asset fetches + JSON API calls) never bumps it; tight enough that a sustained flood gets a 429 before reaching any DB or OIDC code path.
- **Env vars**: `RATE_LIMIT_MAX_PER_WINDOW`, `RATE_LIMIT_TIME_WINDOW_MS`. Matches the project's `_MS` / `_BYTES` / unitless suffix convention.
- **Helpers exported** from `apps/server/src/server.ts`:
  - `DEFAULT_RATE_LIMIT_MAX`, `DEFAULT_RATE_LIMIT_TIME_WINDOW_MS` constants.
  - `RATE_LIMIT_MAX_ENV`, `RATE_LIMIT_TIME_WINDOW_ENV` env-var-name constants.
  - `RateLimitEnv` interface.
  - `resolveRateLimitMax(env)`, `resolveRateLimitTimeWindowMs(env)` resolvers.
- **Registration ordering**: AFTER `errorHandlerPlugin` (so `errorResponseBuilder`'s throw reaches our `setErrorHandler`), BEFORE every route plugin (so the plugin's `onRequest` hook is on the root scope and applies to every subsequently-registered route by default).
- **`/healthz` allow-list**: pass `allowList: (req) => req.url === '/healthz'`. The array form of `allowList` compares against the **key** (default `request.ip`), not the URL — path allow-listing needs the predicate form.
- **Wire shape on 429**: canonical envelope, with `body.error.code === 'rate-limited'` and a `body.error.message` that includes the `retry-after` seconds.
- **Per ADR 0022**: every empirical verification is a committed test. Both resolver helpers + the integration behaviour (429 envelope, `/healthz` allow-list, under-threshold regression) live as Vitest cases in `apps/server/src/server.test.ts`.

## Acceptance criteria

- `@fastify/rate-limit@10.3.0` added to `apps/server/package.json` dependencies.
- `createServer()` registers `rateLimit` on the root scope between `errorHandlerPlugin` and the route plugins.
- `resolveRateLimitMax` / `resolveRateLimitTimeWindowMs` unit tests cover default on absent / empty / NaN / negative / zero, parsed value on a valid positive integer, and the exported env-var-name constants.
- A flood that exceeds the per-IP ceiling returns **429** under the canonical envelope, with `error.code === 'rate-limited'`.
- A flood against `/healthz` is NOT rate-limited (probes stay free).
- An under-threshold request reaches its route handler unchanged (regression).
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new tests; all green.
- `complete 100` added to the `missing_rate_limiting` task entry in `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.
- GitHub code-scanning alerts #2–#9 (`js/missing-rate-limiting`) auto-close on the next scan of the merged branch.

## Decisions

- **Global registration (not per-route opt-in).** CodeQL's `js/missing-rate-limiting` rule recognises a rate-limit middleware that is applied across the server's route surface. A global registration satisfies the rule for every current AND future handler — including ones not flagged today — without per-route boilerplate. Per-route tighter limits (e.g. an extra-strict cap on `POST /api/auth/login`) can land later as additive overrides without touching this baseline.
- **1000 req / 60 s default.** A SPA single-user session can fire dozens of asset requests per navigation through `@fastify/static`. 1000 / minute = ~16 / second per IP, well above any realistic single-user steady-state, but tight enough that a sustained flood from one IP gets throttled before the database / OIDC / projection paths take the load. Production can tune up or down via env without code change.
- **60 s rolling window.** Mirrors operators' per-minute mental model and matches Authelia's regulation block cadence (10 retries / 2 min → comparable order of magnitude). Window in milliseconds (not seconds) so a deployment that wants finer granularity (per-second buckets) can set `RATE_LIMIT_TIME_WINDOW_MS=1000`.
- **`errorResponseBuilder` throws `ApiError` rather than returning a body.** The plugin's default `errorResponseBuilder` returns a JSON body directly, which would bypass `setErrorHandler` and emit a non-canonical envelope. Throwing keeps the wire shape uniform with every other 4xx the server emits.
- **`/healthz` allow-listed via the predicate form.** The array form of `allowList` compares against the resolved KEY (default `request.ip`), not the URL — path allow-listing needs `(req, key) => boolean`. Probe traffic (compose `app` service healthcheck, k8s liveness/readiness) hitting the same per-IP bucket would erode the budget available to real requests.
- **Defaults baked into exported constants** (`DEFAULT_RATE_LIMIT_MAX`, `DEFAULT_RATE_LIMIT_TIME_WINDOW_MS`) so tests can assert against the constant rather than a magic number; matches the `DEFAULT_BODY_LIMIT_BYTES` / `DEFAULT_WS_MAX_PAYLOAD_BYTES` / `DEFAULT_WS_CATCHUP_MAX_EVENTS` precedent.
- **No throwaway-option on `createServer`.** Env resolution happens at factory time; tests that need a tight ceiling set the env via the existing `withEnv` helper. Matches the resolution posture of every other M3-review hardening task.
- **In-memory store (plugin default).** The plugin's default per-process LRU is appropriate for a single-instance deployment — the bucket lives in the same process as the route. A future multi-instance deployment needs a shared store (Redis); deferred until the `multi_instance_flow_state` parallel task picks a backing store and a sibling task wires the same store here.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-16.**

Artifacts:

- Implementation:
  - [`apps/server/package.json`](../../../apps/server/package.json) — added `@fastify/rate-limit@10.3.0` to `dependencies`.
  - [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — added `DEFAULT_RATE_LIMIT_MAX = 1000`, `DEFAULT_RATE_LIMIT_TIME_WINDOW_MS = 60_000`, `RATE_LIMIT_MAX_ENV = 'RATE_LIMIT_MAX_PER_WINDOW'`, `RATE_LIMIT_TIME_WINDOW_ENV = 'RATE_LIMIT_TIME_WINDOW_MS'`, `RateLimitEnv`, `resolveRateLimitMax(env)`, and `resolveRateLimitTimeWindowMs(env)`. Wired `app.register(rateLimit, { max, timeWindow, allowList: (req) => req.url === '/healthz', errorResponseBuilder })` between `errorHandlerPlugin` and the route plugins. The `errorResponseBuilder` throws `ApiError(429, 'rate-limited', ...)` so the wire shape follows the canonical envelope.

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/server.test.ts`](../../../apps/server/src/server.test.ts) — +13 tests (38 total in the file). Three new describe blocks:
    - `resolveRateLimitMax` — 6 tests pinning default-on-absent / empty / NaN / zero / negative, parsed-on-positive, and the `RATE_LIMIT_MAX_ENV` constant.
    - `resolveRateLimitTimeWindowMs` — 4 tests pinning default-on-absent / empty+unparseable+non-positive, parsed-on-positive, and the `RATE_LIMIT_TIME_WINDOW_ENV` constant.
    - `createServer — rate-limit lockdown (CodeQL js/missing-rate-limiting)` — 3 integration tests: flood past a tight ceiling (`max=2`) → 429 with `error.code: 'rate-limited'`; `/healthz` repeated past the same ceiling → 200 (allow-list works); default ceiling + single request → NOT 429 (regression).

- `tasks/25-backend-hardening.tji` — `task missing_rate_limiting` added under `resource_limits_and_dos`, sourced to the GitHub code-scanning alerts; `complete 100`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: +13 Vitest cases (server.test.ts: 25 → 38). `pnpm run check` and `pnpm run test:smoke` both green (3474 tests across 157 files).

**Test-routing note (load-bearing finding)**: `@fastify/rate-limit`'s global `onRequest` hook attaches to *registered* routes only. An unregistered path falls into the not-found handler without ever decrementing the bucket — so the integration test drives against `GET /` (the root SPA route registered by `staticFrontendsPlugin`) rather than `/api/auth/me` (which is registered only when the OIDC env vars are set, and our test harness leaves them unset). This means the rate-limit closes the CodeQL alerts as long as the flagged routes are actually registered when traffic arrives; the auth-routes plugin's silent-skip path (`OidcConfigError → app.log.warn(...)`) would leave the auth routes unrouted AND therefore unlimited, but production builds always have OIDC env vars set (the boot would warn otherwise).
