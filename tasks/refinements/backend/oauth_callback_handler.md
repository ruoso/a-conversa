# OAuth callback handler — `/auth/login` + `/auth/callback`

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.auth.oauth_callback_handler`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.auth.oauth_provider_config` (settled 2026-05-10 — `loadOidcConfig`, `getOidcClient`, `Configuration` re-export, `OidcDiscoveryOptions`, `__buildStubConfiguration`). All `backend.api_skeleton` siblings are settled — Fastify bootstrap, error handler, request logging, health endpoint, OpenAPI plugin. `data_and_methodology.schema.users_table` (settled — `users` table with unique `oauth_subject TEXT NOT NULL UNIQUE`, soft-delete via `deleted_at`).

## What this task is

Second sibling under `backend.auth`. Lands the two HTTP endpoints that drive the OIDC authorization-code flow against the issuer configured by `oauth_provider_config`:

- **`GET /auth/login`** — initiates the flow. Generates a fresh PKCE `code_verifier`, derived `code_challenge` (S256), `state`, and `nonce`. Persists `{ nonce, codeVerifier, expiresAt }` keyed by `state` in an in-process map with a 5-minute TTL. Returns `302` to the issuer's `authorization_endpoint` with the standard query parameters.
- **`GET /auth/callback`** — handles the issuer's redirect back. Looks up the stored flow state by the inbound `state` query parameter; rejects with 400 on mismatch / missing / expired. Hands the inbound URL plus `{ expectedState, expectedNonce, pkceCodeVerifier }` to openid-client's `authorizationCodeGrant(...)`, which validates the id_token signature / audience / issuer / exp / nonce in one call. Extracts **only** the `sub` claim per [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md)'s "no profile data" rule. Upserts the `users` row keyed on `oauth_subject = "${provider}:${sub}"` (provider prefix is `authelia` in the dev case). Returns `200 { sub, oauthSubject, userId }`.

The task lands the OIDC handshake end-to-end **but does not mint a platform session token, does not collect a screen name, and does not enforce auth on any other route** — those handoffs are documented below.

## Why it needs to be done

- Three siblings depend on this one: `screen_name_collection` (consumes the `userId` and replaces the placeholder screen name), `session_token_management` (mints + sets the platform session cookie after this handler completes), and `no_profile_data_policy` (audits this handler + tests for non-subject claim reads).
- The dev compose stack already runs Authelia with the `aconversa-app-dev` client registered, the application's redirect URI listed (`http://localhost:3000/auth/callback`), and the OIDC env vars populated in `.env.example`. Wiring the handler now gives the rest of the platform a path-of-real-login to develop against; without it the auth chain is "you have a Configuration object, good luck."
- Two of the protocol nuances the handler owns — PKCE state correlation and id_token nonce binding — are subtle to retrofit. Landing them now means siblings that build on the auth signal (the WS auth-on-connect handshake, the session-token cookie) inherit a verified handshake.

Downstream consumers:

- `backend.auth.screen_name_collection` — receives `{ userId, oauthSubject, sub }` from the callback response (or, in the eventual cookie-based flow, reads it off the platform session). Until that task lands, freshly-inserted users get a placeholder screen name (see Decisions).
- `backend.auth.session_token_management` — replaces the callback's plain-JSON response body with a session-cookie issuance + redirect to the post-login landing route. This task's response shape (`{ sub, oauthSubject, userId }`) is provisional and documented as such in the OpenAPI surface.
- `backend.auth.no_profile_data_policy` — audits + tests confirming the handler only reads `claims.sub` off the id_token. The audit's regex / test pattern reads this file's source and confirms no other claim is referenced.
- `backend.auth.auth_middleware` — does not directly consume the callback; it validates platform session tokens minted by `session_token_management`, which depend on this handler completing.

## Inputs / context

From [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md):

> The platform reads no profile data — OAuth is purely an authentication signal. The only user-supplied datum stored is a screen name collected during connect.
>
> Authelia owns its own user/session data (file-backed in dev, database-backed in prod). The application database stores only the OIDC subject identifier and the user-supplied screen name.

From [ADR 0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md): the dev OIDC client `aconversa-app-dev` lists `http://localhost:3000/auth/callback` and `http://localhost:5173/auth/callback` as registered redirect URIs and is configured with `client_secret_basic` token-endpoint auth. PKCE is allowed (`require_pkce: false` in dev — but we send the challenge anyway, which Authelia accepts).

From [`apps/server/migrations/0001_users.sql`](../../../apps/server/migrations/0001_users.sql) — the `users` schema this handler upserts into:

```sql
CREATE TABLE IF NOT EXISTS users (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    oauth_subject   TEXT            NOT NULL UNIQUE,
    screen_name     VARCHAR(64)     NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ     NULL
);
```

Per `data_and_methodology.schema.users_table`'s refinement (the comment headers in the SQL): `oauth_subject` is stored as `provider:subject` — e.g., `authelia:alice`. The handler composes the prefix from `OIDC_ISSUER_HOST` (derived from `OIDC_ISSUER_URL`'s hostname) — for the dev case the hostname is `authelia`, hence `authelia:<sub>`.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of system behavior is a committed test. This task ships Vitest unit tests covering the flow primitives (PKCE shape, state/nonce generation, completeAuthFlow validation against a stubbed Configuration, flowState TTL) and Cucumber+pglite scenarios covering the end-to-end handler (login redirect; callback against a stubbed Configuration creates a new users row + returns the user; returning user reuses the row; state mismatch → 400).

## Constraints / requirements

- **Library**: `openid-client@6.8.4`, already pinned. Use:
  - `randomState()`, `randomNonce()`, `randomPKCECodeVerifier()` for entropy generation (cryptographically strong, library-side).
  - `calculatePKCECodeChallenge(verifier)` for the S256 challenge (async — uses WebCrypto under the hood).
  - `buildAuthorizationUrl(config, params)` to construct the authorization URL.
  - `authorizationCodeGrant(config, url, checks)` to exchange code for tokens AND validate the id_token in one call. The library validates signature / audience / issuer / exp / nonce / state in this single call when `expectedNonce` + `expectedState` are supplied.
- **Module shape** under `apps/server/src/auth/`:
  - `flow.ts` — `beginAuthFlow(client, params): Promise<{ url, state, nonce, codeVerifier }>` and `completeAuthFlow(client, currentUrl, expected): Promise<{ sub }>`. Pure functions over an injected `Configuration`; no Fastify or DB dependency.
  - `flow-state.ts` — `createFlowStateStore({ ttlMs, now })` returns `{ put(state, entry), take(state) }` with a 5-minute TTL by default. Module-level singleton via `getDefaultFlowStateStore()` for the route plugin; tests construct fresh stores with injected clocks.
  - `routes.ts` — Fastify plugin registering `GET /auth/login` and `GET /auth/callback`. Reads OIDC env at registration time, calls `getOidcClient(config)` lazily on first request, and pulls the users-table upsert through `apps/server/src/db.ts`.
- **Database access** via `apps/server/src/db.ts` — a small singleton `pg.Pool` lazily instantiated from `DATABASE_URL`. The Pool's `connect`/`query` are the only surface; tests can override via dependency injection on the route plugin's options.
- **Users-table upsert**: parameterized SQL — `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) ON CONFLICT (oauth_subject) DO NOTHING RETURNING id, oauth_subject, screen_name, created_at`. When the INSERT conflicts (returning zero rows), follow with `SELECT id, oauth_subject, screen_name, created_at FROM users WHERE oauth_subject = $1 AND deleted_at IS NULL`. The handler returns the resulting row's `id` as `userId`. Both queries use parameterized arguments — no string concatenation. The placeholder screen name for fresh rows is `'<pending>'` (see Decisions).
- **OIDC subject prefix**: `${providerKey}:${sub}` where `providerKey` is the issuer URL's hostname (e.g., `authelia` for `http://authelia:9091` — the dev case). Production with a domain like `https://auth.example.com` gets `auth.example.com:<sub>`. Per the users-table refinement F2: the prefix avoids cross-provider collisions; the hostname is a stable, deployment-specific identifier the operator already controls.
- **No claim reads beyond `sub`**: `authorizationCodeGrant` returns a `TokenEndpointResponse` with a `claims()` helper. The handler calls `claims()` and reads ONLY `.sub`. The `no_profile_data_policy` sibling audits this — a grep for `claims()` / `.id_token` finds exactly this one call site and the assertion that only `sub` is consumed.
- **Cookie shape (for the OIDC dance only)**: this task does NOT set a session cookie — that's `session_token_management`. The PKCE / state / nonce values are held server-side in the flow-state store, keyed by `state`. The browser carries `state` in the redirect URL only; no cookie is needed for this leg of the dance. (Per ADR 0002, Authelia's own session cookie carries the Authelia-side auth; the application reads its OIDC trust signal off the id_token, not off any cookie.)
- **State mismatch / missing / expired**: 400 + canonical envelope `{ error: { code: 'auth-state-invalid', message: 'authorization state is missing, expired, or unrecognized' } }`. The handler throws `ApiError.badRequest(...)` with that code; the existing error-handler plugin serializes the envelope. The `no_profile_data_policy` audit verifies the error response also leaks no claim data.
- **Test layers per ADR 0022**:
  - **Vitest** in `apps/server/src/auth/flow.test.ts` — pure-logic tests on `beginAuthFlow` (URL shape, query params, PKCE shape), `completeAuthFlow` (state mismatch rejected, success returns `sub`), `flowState` TTL semantics (entries expire, expired entries are removed on `take`). Uses `__buildStubConfiguration` for the Configuration and mocks `openid-client`'s `authorizationCodeGrant` via `vi.mock`.
  - **Vitest** in `apps/server/src/auth/routes.test.ts` — Fastify `.inject()` tests confirming `GET /auth/login` 302-redirects to the configured issuer; `GET /auth/callback` with no `state` returns 400; tag presence in the generated OpenAPI document.
  - **Cucumber+pglite** in `tests/behavior/backend/oauth-callback.feature` — three scenarios: (1) full happy path — login redirects to issuer; callback against a stubbed Configuration + stubbed `authorizationCodeGrant` creates a new `users` row and returns the user; (2) returning user — same callback against an existing `oauth_subject` reuses the row; (3) state mismatch — callback with bad state returns 400 with the canonical envelope. The pglite world hook provides a fresh DB per scenario; the route plugin reads its `pg` pool from injected options so the real `pg.Pool` is bypassed.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new tests in `apps/server/src/auth/flow.test.ts` and `apps/server/src/auth/routes.test.ts` add coverage; total goes 653 → 670+ (final count noted in Status).
- `pnpm run test:behavior:smoke` (Cucumber) green; new `tests/behavior/backend/oauth-callback.feature` adds 3 scenarios to the existing 117, totaling 120.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- `GET /auth/login` and `GET /auth/callback` appear in the generated OpenAPI document under the `auth` tag.

## Decisions

- **Flow-state storage: in-process `Map<state, { nonce, codeVerifier, expiresAt }>` with 5-minute TTL.** Three alternatives surveyed:
  - **In-memory Map keyed by `state`** (chosen). Simplest possible; suits a single-process Node server which is what the architecture mandates. The store has no read-then-keep semantics — `take(state)` returns AND removes the entry, so a replay against the same state fails on the second hit. TTL of 5 minutes accommodates a user typing their Authelia password (Authelia's `authorize_code` lifespan is 1 minute, so the bottleneck is on Authelia's side, not ours). Garbage-collection of expired entries happens lazily on each `take` call plus a periodic sweep every 60 seconds.
  - **Signed cookie carrying state/nonce/verifier**. The browser holds the secret; the server is stateless. Considered for "scales to multi-process." Rejected because we're single-process per ADR's "single server holds the canonical event log per active debate" and a signed cookie would require a fresh signing key + key rotation story that overlaps with `session_token_management`'s. The in-memory store is simpler and reaches no further than this one task.
  - **Postgres-backed transient table**. Considered for "survives process restart." Rejected because OIDC flows are short-lived (seconds) and a process restart in the middle of one is acceptable — the user retries. Adding a DB table for a 5-minute window adds operational surface (migration, cleanup) with no real benefit.
- **Placeholder screen name `'<pending>'` for fresh users.** Three alternatives surveyed:
  - **Literal `'<pending>'`** (chosen). The angle brackets make the placeholder visually distinct from any conceivable user-chosen screen name; a regex check in `screen_name_collection` matches `^<pending>$` and prompts the user. Stays within the VARCHAR(64) bound and contains no characters Postgres would reject.
  - **NULL with a NULL-allowing schema**. Considered. Rejected because the migration declares `screen_name VARCHAR(64) NOT NULL` and changing that is a forward-only schema migration's worth of friction for a temporary state. The placeholder is also forward-compatible with eventually marking it via a separate boolean column without changing the existing column's NOT NULL.
  - **Empty string `''`**. Considered for "obviously empty." Rejected because some Postgres tools treat empty strings as a different kind of "missing" than NULL and the difference confuses downstream consumers. The literal `'<pending>'` is unambiguous.
- **OIDC subject prefix from issuer URL hostname.** Two alternatives surveyed:
  - **Hostname (e.g., `authelia`, `auth.example.com`)** (chosen). Per the users-table refinement's F2, the prefix exists to avoid cross-provider collisions. The hostname is the deployment-specific identifier the operator already controls — it's what they typed into `OIDC_ISSUER_URL`. Re-using it as the prefix means no new config surface.
  - **Hard-coded `authelia` (the upstream service)**. Rejected because in production the upstream is a federated provider behind Authelia (Google, GitHub, etc.) but from the application's view the issuer is always Authelia. Using the hostname keeps the prefix deployment-specific without conflating provider identity with the front-end issuer.
- **Per-task `apps/server/src/db.ts` introduces a singleton `pg.Pool`.** Two alternatives surveyed:
  - **Lazy singleton Pool, env-driven** (chosen). The first call reads `DATABASE_URL` and constructs `new Pool({ connectionString })`; subsequent calls return the cached pool. The route plugin accepts an optional `{ pool }` injection on its options so tests can substitute a pglite-backed pg-shim. Connection cleanup hooks register on the Fastify `onClose` lifecycle so `make down` drains cleanly.
  - **Pass the pool through `createServer` options**. Considered. Rejected because the trivial `createServer({ logger: false })` shape would gain another required field and every test would need to plumb one in even when it's not used. The singleton-with-injection-override keeps the bootstrap zero-config.
- **`authorizationCodeGrant` with `expectedState` + `expectedNonce` + `pkceCodeVerifier`.** The library validates all four in one call: state match against the inbound query, nonce match against the id_token claim, PKCE verifier round-trip against the authorization-endpoint challenge, AND id_token signature / audience / issuer / exp. Manual id_token validation was considered and rejected — re-implementing JWT verification atop `jose` would re-test what openid-client already does.
- **Provisional response shape: `{ sub, oauthSubject, userId }` JSON.** The eventual `session_token_management` sibling replaces this with a cookie-issuance + redirect to the post-login landing route. Documenting the provisional shape in the OpenAPI surface (with a `description` noting the deferral) means the API doc tracks the planned evolution without dead-fielding the surface.
- **No screen-name UI in this task.** A freshly inserted user has `screen_name = '<pending>'`. The sibling `screen_name_collection` adds the UI flow that prompts the user, replaces the placeholder, and updates the row. Until that task lands, the placeholder is what `GET /users/:id` (when it lands) returns. Documented in the handler's source comment and in the OpenAPI description.
- **State mismatch error code `auth-state-invalid`.** Per the canonical-envelope convention (kebab-case codes), one code covers three failure modes: missing state, expired state, mismatched state. The error message is "authorization state is missing, expired, or unrecognized" — distinguishing further would leak whether a particular state was ever known to the server (a tiny side channel that a polite spec follows). The `no_profile_data_policy` audit confirms the error message contains no claim values.
- **OIDC tag in OpenAPI.** Both routes land under the existing `auth` tag (declared in `apps/server/src/openapi.ts`'s `OPENAPI_TAGS`). The `GET /auth/login` route is documented as `302` with a `Location` header; `GET /auth/callback` documents the provisional `200 { sub, oauthSubject, userId }` response plus the canonical 4xx error envelope.

## Open questions

- **Refresh-token handling.** The dev Authelia client lists `offline_access` in its `scopes` and `refresh_token` in `grant_types`. This task does not exercise refresh; `session_token_management` does. The flow primitives in `flow.ts` are deliberately ignorant of refresh-token concerns — they're a callback-only API.
- **Login-on-arrival ergonomics.** A logged-out user hitting a protected route should land on `/auth/login` automatically. That redirect logic belongs to `auth_middleware`, not here.
- **Token-endpoint auth method.** The dev Authelia client is `client_secret_basic`; openid-client's default for the `Configuration` constructor is `ClientSecretPost`. In practice the dev round-trip succeeds because openid-client respects the discovery document's `token_endpoint_auth_methods_supported`. If a future production Authelia config drops `client_secret_basic`, this task may need to pass an explicit `clientAuthentication: ClientSecretBasic(secret)` when calling `discovery` — tracked as an `oauth_provider_config` follow-up.
- **Logout endpoint.** Not in this task's scope. `session_token_management` may own `POST /auth/logout`; the OIDC-side end-session URL (per openid-client's `buildEndSessionUrl`) is a sibling concern.

## Status

**Done** — 2026-05-10. Landed as:

- Flow primitives: [`apps/server/src/auth/flow.ts`](../../../apps/server/src/auth/flow.ts) — exports `beginAuthFlow`, `completeAuthFlow`, `AuthStateMismatchError`.
- Flow-state store: [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) — exports `createFlowStateStore`, `getDefaultFlowStateStore`, `computeExpiresAt`, `DEFAULT_FLOW_STATE_TTL_MS`.
- Route plugin: [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — exports `authRoutesPlugin`, `namespacedOauthSubject`, `upsertUserByOauthSubject`, `PLACEHOLDER_SCREEN_NAME`, `__buildTestAuthApp`.
- DB pool singleton: [`apps/server/src/db.ts`](../../../apps/server/src/db.ts) — exports `getDefaultPool`, `DbPool`, `__resetDefaultPool`.
- Server bootstrap update: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — registers `authRoutesPlugin` when OIDC env vars are set; logs a warning and skips otherwise so OIDC-less Vitest smokes still work.
- Auth barrel update: [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) — re-exports the new surface.
- Vitest unit tests: [`apps/server/src/auth/flow.test.ts`](../../../apps/server/src/auth/flow.test.ts) (+14 cases) and [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts) (+7 cases) — flow primitives, flow-state TTL semantics, route 302/200/400 shapes, replay-after-take semantics.
- Cucumber+pglite scenarios: [`tests/behavior/backend/oauth-callback.feature`](../../../tests/behavior/backend/oauth-callback.feature) (+3 scenarios) with step defs at [`tests/behavior/steps/backend-oauth-callback.steps.ts`](../../../tests/behavior/steps/backend-oauth-callback.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 653 → 674 (+21); Cucumber 117 → 120 (+3).
- **OpenAPI**: both routes already attach `tags: ['auth']` (the tag is declared in `OPENAPI_TAGS` from `openapi_or_equivalent`). The `GET /auth/login` route documents `302` + `errorEnvelopeRef`; `GET /auth/callback` documents the provisional `200 { sub, oauthSubject, userId }` response with a description noting the deferral to `session_token_management`.
