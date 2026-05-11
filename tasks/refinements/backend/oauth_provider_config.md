# Configure OAuth providers (generic OIDC client + wiring)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.auth.oauth_provider_config`
**Effort estimate**: 2d
**Inherited dependencies**: `backend.api_skeleton` (settled — Fastify bootstrap, error handling, request logging, health endpoint, and OpenAPI plugin all shipped 2026-05-10), `foundation.stack_decisions.auth_lib_decision` (settled by ADR 0002 — generic OIDC, Authelia upstream), `foundation.dev_env.env_var_template` (settled — `.env.example` lands the `OIDC_*` env vars), `foundation.dev_env.compose_file` (settled by ADR 0018 — `authelia` service mounts `infra/authelia/configuration.yml`).

## What this task is

The first of six siblings under `backend.auth`. Lands the OIDC client library (`openid-client`) and the config plumbing the rest of the auth chain consumes: env-var validation, the typed `OidcConfig`, the memoized discovery wrapper, and the redirect-URI convention.

Per [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) the backend is a **generic OIDC client**. It speaks standard OIDC to one issuer URL and never directly talks to Google / GitHub / GitLab — the upstream-provider zoo lives in Authelia's YAML, not in application code. Per [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) the dev OIDC provider is the same Authelia binary that ships in production, running in users-file mode with six committed dev users; the protocol surface the backend sees is identical in dev and prod.

This task lands **only** the client + config layer. The downstream siblings own the request handlers, the screen-name collection, the session-token issuance, the no-profile-data audit, and the auth middleware.

## Why it needs to be done

- Five sibling tasks depend on this one (the dependency edge in `tasks/20-backend.tji` is `oauth_provider_config → oauth_callback_handler → screen_name_collection → session_token_management → auth_middleware`, plus `no_profile_data_policy` off the callback). Without a typed `OidcConfig` and a `Configuration` factory, every sibling re-derives the same plumbing.
- The dev compose stack already runs Authelia and ships `.env.example` with the OIDC vars set. Wiring the client now means the very next sibling (`oauth_callback_handler`) is a route + a handful of `openid-client` function calls against an already-discovered Configuration, not a fresh discovery story.
- The redirect URI convention has to land somewhere — Authelia's registered list and the application's derived URL must agree string-for-string. Landing it under config means both halves draw from one source (`APP_BASE_URL` + `/auth/callback`).

Downstream consumers:

- `backend.auth.oauth_callback_handler` — calls `getOidcClient(config)` to build the authorization URL and to exchange the code for tokens via `openid-client`'s `authorizationCodeGrant`.
- `backend.auth.session_token_management` — reads the validated id_token / claims off the `TokenEndpointResponse` returned from the callback flow.
- `backend.auth.auth_middleware` — does not directly consume the OIDC client (it validates platform session tokens, not OIDC tokens), but inherits the env-validation conventions established here.
- `deployment.prod_compose.prod_oauth_config` — populates Authelia's YAML with real upstream providers; the application's env-var contract is unchanged across dev and prod, so this task's `loadOidcConfig` works for both.

## Inputs / context

From [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md):

> The backend is a generic OIDC client. It speaks standard OIDC to Authelia and never directly talks to Google, GitHub, or any other upstream provider. Upstream identity providers are configured inside Authelia's YAML, not in application code.

From [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) (Amendments, 2026-05-10):

> `.env.example` landed at [`.env.example`](../../../.env.example) under `foundation.dev_env.env_var_template` with `OIDC_ISSUER_URL=http://authelia:9091`, `OIDC_CLIENT_ID=aconversa-app-dev`, and `OIDC_CLIENT_SECRET=aconversa-app-dev-secret`.

From [`infra/authelia/configuration.yml`](../../../infra/authelia/configuration.yml) — the dev client registration:

```yaml
clients:
  - client_id: aconversa-app-dev
    client_secret: '$pbkdf2-sha512$...'   # plaintext: aconversa-app-dev-secret
    redirect_uris:
      - 'http://localhost:5173/auth/callback'   # Vite dev server
      - 'http://localhost:3000/auth/callback'   # compose-published app
    scopes: [openid, profile, email, offline_access]
    response_types: [code]
    grant_types: [authorization_code, refresh_token]
    token_endpoint_auth_method: client_secret_basic
```

From [`infra/authelia/README.md`](../../../infra/authelia/README.md), Issuer URL convention:

| Caller                              | Issuer URL                          |
| ----------------------------------- | ----------------------------------- |
| Backend service inside Compose      | `http://authelia:9091`              |
| Browser / host shell                | `http://localhost:9091`             |

The backend reads `OIDC_ISSUER_URL` (Compose-internal) for OIDC discovery and the token round-trip. The browser-side authorization redirect uses the host-published URL; that derivation lives with the callback-handler sibling.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of system behavior is a committed test. The config module ships with Vitest unit tests (mocking `openid-client`'s `discovery` to pin the spec contract) and one Cucumber+pglite scenario (exercising the env-to-Configuration wiring through a real `Configuration` constructor without network).

## Constraints / requirements

- **Library**: `openid-client@6.8.4` (panva). The mature, fully-spec-compliant OIDC client for Node — handles discovery, PKCE, id_token validation, JWKS, the auth-code grant. Alternatives surveyed and rejected (see Decisions).
- **Module shape** under `apps/server/src/auth/`:
  - `config.ts` — exports `loadOidcConfig(env): OidcConfig` (Zod-validated), `getOidcClient(config, options?): Promise<Configuration>` (memoized discovery), `oidcEnvSchema`, `OidcConfigError`, the `Configuration` type re-export, the `__buildStubConfiguration` test helper, and the `__isOidcClientCached` test introspection helper.
  - `index.ts` — barrel re-exporting the above so sibling tasks import from `apps/server/src/auth/index.js`.
- **Env-var schema** (Zod):
  - `OIDC_ISSUER_URL` — `z.string().url()`. The dev value is `http://authelia:9091`; production is `https://auth.<domain>`. Stored on `OidcConfig.issuerUrl` as a parsed `URL` instance so the rest of the code path doesn't repeat the parse.
  - `OIDC_CLIENT_ID` — `z.string().min(1)`. Free-form (not UUID-shaped; Authelia accepts any non-empty identifier). Dev value: `aconversa-app-dev`.
  - `OIDC_CLIENT_SECRET` — `z.string().min(1)`. The plaintext secret the backend sends to the token endpoint. Never logged, never echoed in error messages, never included in the OpenAPI schema.
  - `APP_BASE_URL` — `z.string().url().default('http://localhost:3000')`. The public-facing base URL; used to derive `redirectUri`. A trailing slash is stripped before composition.
- **Redirect URI convention**: `${APP_BASE_URL}/auth/callback`. The dev Authelia client `aconversa-app-dev` already lists both `http://localhost:3000/auth/callback` (compose-published app) and `http://localhost:5173/auth/callback` (Vite dev server) — no Authelia config reconciliation needed; the convention chosen here is already covered.
- **Memoization**: `WeakMap<OidcConfig, Promise<Configuration>>`. Keying on the `OidcConfig` reference (not the issuer URL string) means tests can build fresh configs and get fresh discovery without process-global state to reset. Storing the promise (not the resolved value) means concurrent first-callers share one network round-trip. WeakMap-keyed cache cleans up automatically when callers drop their config reference.
- **Insecure-issuer toggle**: openid-client v6 rejects http:// issuers by default. The dev Authelia stack issues over plain http inside the compose network, so `getOidcClient` calls `allowInsecureRequests(...)` for any `http:` issuer URL. Production issuers are https and the helper is a no-op there. The toggle is per-Configuration, not global.
- **Injectable discovery for tests**: `getOidcClient(config, options?)` accepts an optional `OidcDiscoveryOptions` with `{ discovery, allowInsecureRequests }` overrides. Production callers pass nothing and the function reaches for the real `openid-client` exports. The Vitest layer uses `vi.mock('openid-client', ...)` (module-level hoisting); the Cucumber layer uses the explicit options object (no global state).
- **No secret logging**: the client secret passes through `loadOidcConfig → getOidcClient → openid-client` and never reaches a log line. Zod error messages reference field names only, never values, so a parse failure can be logged without redacting.
- **No OpenAPI exposure**: the OIDC env vars are not part of the API surface; the `/auth/*` routes (sibling task) will be tagged `auth` in the OpenAPI taxonomy but the client secret never appears in any schema.
- **Test layers per ADR 0022**:
  - Pure logic (env validation, redirect-URI derivation, memoization, insecure-issuer toggle) → Vitest `apps/server/src/auth/config.test.ts` (15 cases). Mocks `openid-client`'s `discovery` and `allowInsecureRequests` to pin the spec contract.
  - Integration (env-to-`Configuration` wiring across two modules, real `Configuration` instance from the public constructor) → Cucumber `tests/behavior/backend/oauth-config.feature` (1 scenario). Uses the injectable `discovery` option with a stub that builds a real `Configuration` via `__buildStubConfiguration` (no network).
  - E2E (live Authelia discovery, real `/.well-known/openid-configuration` round-trip, full login flow) → owned by `foundation.test_infra.playwright_test_helpers`, not this task.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; the new `apps/server/src/auth/config.test.ts` adds 15 cases to the existing 638, totaling 653.
- `pnpm run test:behavior:smoke` (Cucumber) green; the new `tests/behavior/backend/oauth-config.feature` adds 1 scenario to the existing 116, totaling 117.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Library: `openid-client@6.8.4` (panva).** Three alternatives surveyed:
  - **`openid-client`** (chosen). The most popular, mature, fully-spec-compliant OIDC client for TypeScript. Supports discovery, authorization-code-flow with PKCE, JWT validation, JWKS caching, refresh-token grant, end-session URLs, and userinfo endpoints. v6 is the current stable line as of 2026-05-10. The library has its own substantial test suite; we own the env-validation and memoization layer on top of it.
  - **`fastify-oauth2`**. Simpler, but OAuth2-centric — doesn't deeply support OIDC discovery / id_token validation. Rejected because the spec dictates we validate id_tokens (no-profile-data sibling depends on knowing which id_token claims the upstream issuer signs); rolling that on top of an OAuth2-only lib means re-implementing what `openid-client` already does.
  - **Hand-rolled**. Possible but error-prone for OIDC's many edge cases (discovery-document caching, JWKS rotation, id_token signature validation, response-type negotiation, PKCE). Rejected because every one of those edge cases would be re-tested at the application layer with no upstream-maintained baseline to fall back on.

- **Discovery caching: `WeakMap<OidcConfig, Promise<Configuration>>`, keyed by reference.** Three alternatives surveyed:
  - **WeakMap keyed by `OidcConfig` reference** (chosen). Tests build fresh configs and get fresh discovery; production constructs one config at startup and reuses it process-lifetime. The cache is automatically GC'd when callers drop their config reference; no manual invalidation API needed. Storing the promise (not the resolved value) means concurrent first-callers share one network round-trip.
  - **Module-level `let cached: Configuration | undefined`**. Simpler but introduces process-global state; tests would have to reset the cache between scenarios. Rejected because Vitest's `vi.mock`-based unit tests already have a clean isolation story without it, and Cucumber's per-scenario hook makes per-scenario freshness the default.
  - **Cache keyed by issuer URL string**. Considered for "two configs pointing at the same issuer share a discovery." Rejected because that's only an optimization for credential rotation (two configs, same URL); the real production deployment has one config and rotation is a process restart. Keying on the config reference is simpler and sufficient.

- **Redirect URI: `${APP_BASE_URL}/auth/callback`, default `APP_BASE_URL=http://localhost:3000`.** Two alternatives surveyed:
  - **Derive from `APP_BASE_URL`** (chosen). One source of truth for the public-facing base URL; the redirect URI is a function of it. The Authelia client registration in `configuration.yml` already lists both compose-app (`http://localhost:3000/auth/callback`) and Vite-dev (`http://localhost:5173/auth/callback`) variants, so the dev story is covered with no Authelia reconciliation needed.
  - **Separate `OIDC_REDIRECT_URI` env var**. Considered for "deploy where the redirect doesn't follow the base URL" (e.g., a CDN-in-front-of-API split). Rejected for v1 — adds an env var with no current use case, and the moment such a deployment exists the env-var schema can grow a third field. Today's shape: one base URL, one derived redirect.

- **APP_BASE_URL default: `http://localhost:3000`.** Two alternatives surveyed:
  - **Default to `http://localhost:3000`** (chosen). The compose-published app port; matches `APP_PORT=3000`'s default. A bare `pnpm dev` from the repo root works without setting any env var; the value is what `make up` produces too.
  - **No default; require explicit env var**. Considered as "fail loud if APP_BASE_URL is missing." Rejected because the dev story should not require ceremony; an explicit value in `.env.example` is documentation, an explicit default in code is "what happens if .env disappears." Both should agree.

- **APP_BASE_URL trailing-slash stripping.** Two alternatives surveyed:
  - **Strip trailing slash before composing redirect URI** (chosen). `http://localhost:3000/` and `http://localhost:3000` are URL-equivalent per the spec, but Authelia's redirect-URI check does string compare against its registered list — `http://localhost:3000//auth/callback` (double slash) would be rejected. Stripping at config-load time means the rest of the code path never has to think about it.
  - **Reject trailing slashes in the Zod schema**. Considered for "fail loud on a malformed input." Rejected because the input is well-formed by spec; the issue is downstream string compare. Strip-and-normalize is the more forgiving choice.

- **Insecure-issuer toggle: `allowInsecureRequests` per-Configuration.** openid-client v6 rejects http:// issuers by default, which is correct for production. The dev Authelia stack uses http inside the compose network (no TLS; never leaves the host). The function detects `issuerUrl.protocol === 'http:'` and calls `allowInsecureRequests(config)` lazily for the dev case; production issuers are https and the helper is a no-op. A blanket disable was considered and rejected — explicit per-Configuration opt-in keeps the protection on by default for any future config that doesn't fit the dev shape.

- **Injectable discovery for tests via `OidcDiscoveryOptions`.** Two alternatives surveyed:
  - **Optional options bag on `getOidcClient`** (chosen). Production callers pass nothing; tests pass `{ discovery, allowInsecureRequests }` overrides. The Vitest layer uses `vi.mock('openid-client', ...)` (module-level hoisting); the Cucumber layer uses the explicit options (no global mock — Cucumber + tsx doesn't have a hoisted-mock equivalent). One module API, two layered test strategies.
  - **Module-level `setDiscoveryForTests(fn)` function**. Considered for "single override surface." Rejected because it introduces module-level mutable state that tests must reset; the options-bag form keeps each test's setup explicit and isolated.

- **`__buildStubConfiguration` test helper exported from the auth module.** Builds a real `Configuration` via the public constructor with stub `ServerMetadata` (only `issuer` required); used by the Cucumber stub `discovery` to produce a real Configuration whose `.clientMetadata().client_id` accessor matches production. Exposed from the auth module rather than constructed in the test file so the `openid-client` import stays at the workspace boundary (`apps/server` ships the dep; `tests/behavior/` does not resolve it from its tsconfig). The `__` prefix signals "test-only" — production callers should not depend on it.

- **Cucumber scenario doesn't skip pglite.** The world-level Before hook spins up a fresh pglite per scenario (cheap, ~ms). This scenario doesn't touch pglite, but splitting the World to skip it for non-DB scenarios would mean two World variants and a per-feature opt-in. The structural cost outweighs the few-ms savings; the refinement records this as a deliberate choice. If many future non-DB scenarios accumulate, the trade-off can be revisited.

- **No `OPENAPI_PUBLIC` gate today.** The OpenAPI plugin doesn't (yet) hide its schema behind an env flag; the OIDC config is not part of the API surface anyway. Both deferrals settle once auth middleware lands and the auth surface is the natural gating point.

## Open questions

- **Token-endpoint auth method.** The dev Authelia client is `client_secret_basic`. openid-client v6's `discovery` returns a `Configuration` whose default auth method is `ClientSecretPost`. For the auth-code-grant request the library negotiates based on the discovery document and the client metadata; in practice the dev flow has worked with the default. The sibling `oauth_callback_handler` may need to set `clientAuthentication: ClientSecretBasic(secret)` explicitly if Authelia rejects POST-auth. Tracked under that sibling's refinement.
- **Refresh-token handling.** The dev Authelia client lists `offline_access` in its `scopes` and `refresh_token` in `grant_types`. This task does not exercise refresh; `session_token_management` does, and the refresh-token flow may either re-discover or re-use the cached `Configuration`. The memoization shape here supports either choice.
- **Production issuer URL.** Production Authelia runs over https with a real DNS name; the env-var contract is unchanged but the value differs. `deployment.prod_compose.prod_oauth_config` writes the production `.env` template.
- **Multiple OIDC providers.** Today the backend speaks one OIDC to one issuer (Authelia). If a future deployment wants the backend itself to multiplex between two issuers (bypassing Authelia), the schema would need to grow per-provider config arrays. Not planned; tracked here so the constraint is explicit.

## Status

**Done** — 2026-05-10. Landed as:

- Config module: [`apps/server/src/auth/config.ts`](../../../apps/server/src/auth/config.ts) — exports `loadOidcConfig`, `getOidcClient`, `oidcEnvSchema`, `OidcConfigError`, `Configuration` re-export, `OidcDiscoveryOptions`, `__buildStubConfiguration`, `__isOidcClientCached`.
- Barrel: [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts).
- Vitest unit tests: [`apps/server/src/auth/config.test.ts`](../../../apps/server/src/auth/config.test.ts) (+15 tests: env validation, redirect URI derivation, default `APP_BASE_URL`, trailing-slash stripping, malformed inputs, missing fields, OidcConfigError diagnostics, discovery arg passing, memoization, per-reference caching, allow-insecure toggle for http issuers, no-toggle for https issuers, concurrent first-caller deduplication).
- Cucumber scenario: [`tests/behavior/backend/oauth-config.feature`](../../../tests/behavior/backend/oauth-config.feature) (+1 scenario) with step defs at [`tests/behavior/steps/backend-oauth-config.steps.ts`](../../../tests/behavior/steps/backend-oauth-config.steps.ts).
- Dependency pin: `openid-client@6.8.4` added to [`apps/server/package.json`](../../../apps/server/package.json).
- `.env.example` update: [`.env.example`](../../../.env.example) gains `APP_BASE_URL` (default `http://localhost:3000`) with a comment cross-referencing `infra/authelia/configuration.yml`'s registered redirect URIs.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 638 → 653 (+15); Cucumber 116 → 117 (+1).
