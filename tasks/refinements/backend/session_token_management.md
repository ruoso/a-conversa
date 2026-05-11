# Session-token management — issue and validate platform session tokens

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.auth.session_token_management`
**Effort estimate**: 2d
**Inherited dependencies**: `backend.auth.screen_name_collection` (settled — `POST /auth/screen-name`, the pending-cookie bridge, the users-table UPDATE). Transitively: `backend.auth.oauth_callback_handler` (settled — `/auth/callback`, the users-table upsert) and `data_and_methodology.schema.users_table` (settled — `users.id`, `users.screen_name`).

## What this task is

Fourth sibling under `backend.auth`. Lands the platform-session story that turns "completed OIDC + has a screen name" into a long-lived credential the backend can recognize on every protected endpoint and the WebSocket handshake. Three surfaces ship together:

- A pure-logic signing/verifying module (`session-token.ts`) wrapping `jose`'s HS256 JWT primitive. Two exports: `signSessionToken(payload, secret)` and `verifySessionToken(token, secret)`.
- Updates to the existing OIDC callback (`/auth/callback`) and screen-name (`/auth/screen-name`) handlers so they issue the platform session cookie at the right transitions.
- Two new endpoints — `POST /auth/logout` (clears the cookie) and `GET /auth/me` (returns `{ userId, screenName }` for the bearer).

The session token is a JWT with **only** `{ sub, iat, exp }` claims — `sub` is the users-table row id, and that's it. No OAuth subject, no screen name, no scopes. The handler that needs the screen name (`/auth/me`, future `auth_middleware` consumers) looks up the users row by `sub`; the token is the credential, not the profile.

## Why it needs to be done

The screen-name task (preceding sibling) left the auth flow in a half-state: a user can complete OIDC and pick a name, but the only credential they hold is the 10-minute pending cookie that exclusively authorizes the screen-name endpoint. Nothing exists yet that proves "this caller is user X" for any other request.

Three downstream consumers wait on this:

- **`backend.auth.auth_middleware`** — the next sibling. It reads the session cookie off every protected request, validates the token via `verifySessionToken`, and exposes `userId` to the route handlers. Won't have a credential to validate without this task.
- **`backend.websocket_protocol.ws_auth_on_connect`** — the WebSocket handshake reads the same cookie off the upgrade request and authenticates the WS connection without a per-message DB lookup. Statelessness is load-bearing for the WS path; see Decisions below.
- **Every protected HTTP route** (session-management, replay endpoints, etc.) — gated by the auth middleware, indirectly waits on this task.

The frontends additionally need:
- **A way to display "you are alice"** — `GET /auth/me` returns `{ userId, screenName }` from the cookie alone, so the moderator console and the debater tablet can render a logged-in user header without a separate "who am I" plumbing layer.
- **A way to log out** — `POST /auth/logout` clears the cookie. Idempotent (no body, no token-required precondition); a stale-cookie logout still drops the cookie cleanly.

## Inputs / context

From [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md):

> The platform reads no profile data — OAuth is purely an authentication signal. The only user-supplied datum stored is a screen name collected during connect.

This shapes the token claims — the token MUST NOT carry the OAuth subject or any id_token claim. The OIDC dance is purely the "we trust Authelia" path; the platform session lives downstream of that.

From [`tasks/refinements/backend/screen_name_collection.md`](screen_name_collection.md) (the immediate predecessor):

> When `session_token_management` lands, the natural point of integration is the success path of `POST /auth/screen-name`: after the UPDATE lands, the response also Set-Cookies the platform session token AND clears the pending cookie. The pending cookie has served its only purpose by then.

That predecessor pinned the integration point for the new-user path. The returning-user path (existing users who hit `/auth/callback` with a non-`<pending>` screen name) is the symmetric question this task answers: skip the pending-cookie bridge entirely and issue the session token straight from the callback.

From [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts): the existing `SESSION_TOKEN_SECRET` resolver helper and HMAC pattern. This task reuses the env var; the pending cookie was already named so the secret could be shared with the platform session token.

From [`.env.example`](../../../.env.example):

```
SESSION_TOKEN_SECRET=dev-session-secret-change-me
```

The env var has been waiting for this task — the dev value is in place, and the variable comment already references "the application's session token (separate from Authelia's own session cookie)".

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): Vitest unit tests cover the pure-logic primitives (token sign/verify round-trip, tampered signature, expired, malformed); Cucumber+pglite scenarios cover the end-to-end callback / screen-name / `/auth/me` / `/auth/logout` flow against the real migrated schema.

## The token-shape question — two options surveyed

**Option A — JWT, signed with HS256 (chosen).** Token is `<base64url-header>.<base64url-payload>.<base64url-hmac>`. Claims: `{ sub: <users.id>, iat, exp }`. Server validates by recomputing the HMAC against the header+payload bytes; no DB lookup required. Revocation is "wait for the token to expire" by default.

**Option B — Opaque random token + DB-backed `auth_sessions` table.** Token is a 256-bit random string; the server looks up the row at every request to check validity, expiry, and revocation status. Revocation is an UPDATE on a single row.

Option A's rationale:

- **Statelessness fits the WebSocket model.** A WebSocket connection authenticates once at the handshake and then sends thousands of messages. A DB-backed token would require either a per-message DB lookup (catastrophic for latency) or a per-connection cache with its own invalidation problem. JWT short-circuits this: parse + HMAC-verify on the upgrade request, set `userId` on the connection, never touch the DB again. Future auth-middleware also gets the no-DB-lookup property on every HTTP request.
- **One less schema migration.** Option B requires a new table (`auth_sessions` or `platform_sessions`; name carefully to avoid colliding with the debate-session domain table). The platform is in active foundation construction; deferring a schema decision until we have a concrete revocation need is the conservative path.
- **The cost is revocation granularity.** With JWT we cannot invalidate a specific issued token without either rotating `SESSION_TOKEN_SECRET` (logs everyone out) or maintaining a denylist (a new DB table — back to Option B's cost). The decision recorded here: **a denylist is a deferred follow-up**. When the first concrete need for per-session revocation lands (a "log me out everywhere" UX, an admin "kick that user" surface), a small `auth_token_denylist` table with `(jti, expires_at)` rows takes minutes to add; the verification layer grows one indexed lookup. Until then, TTL-based expiry is sufficient.
- **`jose` is the de-facto pick.** Mature, audited TypeScript-native JWT library; production-grade HS256. The same library can later support HS384/HS512 or asymmetric signing if the operator wants to plug in a hosted KMS — without rewriting the call sites.

Option B was considered for the explicit revocation property and rejected on the schema-cost + WebSocket-latency grounds. The rejection is recoverable: if we discover per-session revocation is essential before MVP, adding a small `auth_sessions` table whose primary key is the token's `jti` is a focused migration.

## Constraints / requirements

- **Module shape** under `apps/server/src/auth/`:
  - `session-token.ts` — exports `signSessionToken(payload, secret): Promise<string>` and `verifySessionToken(token, secret): Promise<SessionTokenPayload | null>`. Pure cryptographic primitives; no Fastify, no I/O. Constants: `SESSION_COOKIE_NAME`, `SESSION_TOKEN_TTL_MS` (= 7 days), `SESSION_TOKEN_TTL_SECONDS`. Helpers: `buildSessionCookieHeader(token, opts)` and `buildSessionCookieClearHeader(opts)`, mirroring the pending-cookie module's surface.
  - `routes.ts` — `/auth/callback` handler updated: if the upserted users row's `screen_name` is non-`<pending>` (returning user), Set-Cookie the session token AND 302 to `APP_BASE_URL`; otherwise keep the existing pending-cookie + provisional-body path AND add a `needsScreenName: true` flag to the body. `/auth/screen-name` handler updated: on UPDATE success, Set-Cookie BOTH the session-token AND a cleared pending-cookie. New handlers: `POST /auth/logout` (Set-Cookie cleared session cookie, no body, idempotent — always 204), `GET /auth/me` (reads session cookie, validates, looks up the user row by `id`, returns `{ userId, screenName }`; 401 on no-cookie / invalid / expired).
  - `index.ts` — barrel re-exports the new surface.
- **Token claims**: EXACTLY `{ sub, iat, exp }`. `sub` is the users-table row id (UUID string). `iat` is the issue-at instant in seconds since epoch (`jose`'s default). `exp` is the expiry instant in seconds since epoch, set 7 days after `iat`. No `iss`, no `aud`, no `jti`, no `screenName`. The `no_profile_data_policy` audit greps this file and confirms no other claim is added.
- **TTL**: 7 days (`SESSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000`). Three alternatives surveyed:
  - **7 days** (chosen). Matches the typical "stay logged in for a week" UX. The TTL is short enough that a stolen cookie has a hard expiry; long enough that a casual user isn't re-doing OIDC every day.
  - **1 hour**. Rejected — re-OIDC every hour is hostile for the moderator who runs a 3-hour debate session.
  - **30 days**. Rejected — too long for an auth surface with no revocation. If a denylist table lands, this can be revisited.
- **Cookie attributes** (production):
  - Name: `aconversa-session`.
  - Value: the JWT string.
  - `HttpOnly` — JS can't read the cookie; XSS can't exfiltrate it.
  - `SameSite=Lax` — top-level navigation from another origin still carries the cookie (so a deep link to the app works after OIDC redirect); a cross-origin state-changing POST cannot replay it without CSRF further. The future write surface (WebSocket messages) is also same-origin under Lax.
  - `Path=/` — applies to the whole origin (the auth endpoints, the future WebSocket upgrade, every protected route).
  - `Max-Age=604800` (7 days, matching `exp`).
  - `Secure` when `NODE_ENV=production` — over HTTPS only. Dev (Compose `http://localhost:3000`) sets `cookieSecure: false` so the browser sends the cookie back over http.
- **Cookie attributes** (clear): same shape with empty value and `Max-Age=0`. Browsers delete a cookie when they see Max-Age=0 with the matching name + path + Secure.
- **Endpoint contract changes**:
  - `GET /auth/callback`:
    - **Returning user** (screen_name != `<pending>`): Set-Cookie the session token; 302 to `APP_BASE_URL`. No body. NO pending-cookie set.
    - **New user** (screen_name == `<pending>`): Set-Cookie the pending cookie (unchanged); 200 with `{ sub, oauthSubject, userId, needsScreenName: true }`. The `needsScreenName: true` flag is the new bit so the frontend doesn't have to read the screen name from the body. NO session cookie yet.
  - `POST /auth/screen-name`:
    - On UPDATE success: Set-Cookie BOTH a cleared pending cookie AND the session token; 200 with `{ userId, screenName }`.
    - 401 / 400 / 409 paths unchanged from the preceding sibling.
  - `POST /auth/logout`: Set-Cookie the cleared session cookie; 204 No Content. Idempotent — always 204, regardless of whether the inbound cookie was present, valid, or expired. The browser-side cookie cleanup is the whole point; no body, no token check.
  - `GET /auth/me`: Reads `aconversa-session` cookie off the request. Verifies the JWT. Looks up the users row by `id = sub` (and `deleted_at IS NULL`). Returns `{ userId, screenName }`. 401 on no cookie / invalid token / expired token / soft-deleted user (single envelope, no information leak).
- **Cookie reading** — small `readSessionCookieFromHeader(cookieHeader)` helper mirrors `readPendingCookieFromHeader` from `pending-cookie.ts`. The two cookies coexist briefly during the screen-name set's response (one Set-Cookie clears the pending cookie; another Set-Cookie sets the session cookie); the helpers don't share state.
- **Test layers per ADR 0022**:
  - **Vitest** in `apps/server/src/auth/session-token.test.ts` — pure-logic tests on `signSessionToken` / `verifySessionToken` (round-trip; tampered signature → null; expired → null; malformed → null; wrong-secret → null; missing-sub → null), plus Fastify `.inject()` tests on `GET /auth/me` (200 returning user, 401 missing/invalid/expired/soft-deleted), `POST /auth/logout` (204 regardless of cookie presence, clears the cookie), `/auth/callback` returning-user path (Set-Cookie session; 302), `/auth/callback` new-user path (Set-Cookie pending; 200 with needsScreenName), `/auth/screen-name` (sets both Set-Cookies on success), and the cookie-header helpers (attributes, Secure toggle).
  - **Cucumber+pglite** in `tests/behavior/backend/session-token.feature` — four scenarios: (1) returning-user callback → session cookie set + 302 to APP_BASE_URL; (2) new-user callback → pending cookie set, no session cookie; (3) screen-name set on new user → session cookie set + pending cookie cleared; (4) `/auth/me` round-trip → returns user; `/auth/logout` clears; subsequent `/auth/me` → 401. Step defs in `tests/behavior/steps/backend-session-token.steps.ts`.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new file `apps/server/src/auth/session-token.test.ts` adds cases.
- `pnpm run test:behavior:smoke` (Cucumber) green; new `tests/behavior/backend/session-token.feature` adds 4 scenarios.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- `POST /auth/logout` and `GET /auth/me` appear in the generated OpenAPI document under the `auth` tag.
- `/auth/callback` and `/auth/screen-name` OpenAPI summaries updated to reflect the new cookie issuance.

## Decisions

- **JWT (HS256) over DB-backed opaque token.** Rationale in the "two options" section above. The WebSocket latency property is load-bearing; the revocation cost is acceptable for MVP. If a per-session revocation need lands, a small `auth_token_denylist` table is a focused follow-up.
- **`jose` (v6.x) for the JWT primitive.** Mature, audited, TypeScript-native. Pinned at `^6.1.0` (current 6.x stable line; matches the `apps/server` deps' convention of `<major>.<minor>.<patch>` ranges). Two alternatives surveyed:
  - **`jsonwebtoken`** — older, less actively maintained; CommonJS-only by default; the API has historical sharp edges around algorithm confusion (RS256 token verified as HS256 with the public key as the HMAC key). `jose` doesn't have this class of bug. Rejected.
  - **Hand-rolled HMAC over a JSON payload** (like `pending-cookie.ts` does). Rejected because JWT is the de-facto interop format for "give the WebSocket layer a token to read" — future auth-middleware and ws-auth-on-connect both benefit from speaking the standard format rather than a project-specific shape.
- **Cookie name `aconversa-session`.** Application-namespaced prefix to avoid collisions with any other cookie a future deployment might run alongside us, parallel to `aconversa-auth-pending`. The `session` suffix is the canonical name for "the long-lived auth credential" (vs. `aconversa-auth-pending`'s "auth-bridge"). Distinct names — neither cookie name collides with `authelia_session` (Authelia's own cookie) — so both can coexist on the same origin if needed.
- **TTL 7 days.** Rationale in Constraints above.
- **Claims `{ sub, iat, exp }` only.** Two alternatives surveyed:
  - **`{ sub, iat, exp }` only** (chosen). Minimal claim surface; aligns with ADR 0002's no-profile-data rule; the verify path returns `null` on any extra-claim shape so future drift is caught.
  - **`{ sub, iat, exp, screenName }`** — would save one DB lookup on `/auth/me`. Rejected because:
    1. screen names can change (eventually — rename surface is out of scope today but the dependency direction matters); a token-cached screen name would go stale.
    2. The `/auth/me` endpoint is hit at most once per page load on the frontends; the DB lookup is cheap and a non-negotiable source of truth.
    3. The token must NOT carry any profile data per ADR 0002; even though screen name is platform-supplied (not OAuth-supplied), keeping the token a pure "credential" object preserves the audit story.
- **`SESSION_TOKEN_SECRET` env var (shared with the pending-cookie).** Reuses the existing secret; one rotation point. The pending cookie's HMAC and the session JWT's HMAC are computed over different inputs (custom payload vs. JWT header+payload), so a leaked-pending-cookie can't be replayed as a session token even though both use the same secret.
- **`POST /auth/logout` is idempotent — always 204.** Three alternatives surveyed:
  - **204 always** (chosen). Logout is a "make the cookie go away" operation. Whether the cookie was valid, expired, or absent doesn't change the desired outcome: the client should not have the cookie after this call. Returning 401 on a stale-cookie logout would surprise frontends and complicate error UI for no benefit.
  - **401 when no/invalid cookie**. Rejected as above — logout shouldn't gatekeep.
  - **204 only when a valid cookie was present, 200 otherwise**. Rejected as needless protocol surface.
- **`GET /auth/me` returns `{ userId, screenName }`; 401 on every failure path.** Single envelope code `auth-session-invalid` for all four cookie-failure modes (missing, malformed, expired, signature-invalid, soft-deleted-user). Mirrors the pending-cookie's leak-resistant pattern. The internal `verifySessionToken` returns `null` (not a discriminated reason) — the route handler doesn't need to know why the token failed; the operator-side log can carry the reason.
- **The OIDC callback splits into two branches by `screen_name`.** Three alternatives surveyed:
  - **Split on `screen_name === '<pending>'`** (chosen). The placeholder is the unambiguous discriminator; the existing `PLACEHOLDER_SCREEN_NAME` constant is the single source of truth. A returning user whose screen name was set during a prior session has `screen_name != '<pending>'`; the callback issues a session token and redirects. A brand-new user has `screen_name == '<pending>'`; the callback issues the pending cookie and the body carries `needsScreenName: true`.
  - **Split on the upsert's "did we insert or did we conflict" result**. Rejected because a returning user whose row was soft-deleted and re-inserted (corner case the upsert helper already guards against) would land in the "new" branch incorrectly. The screen-name discriminator is the right signal.
  - **Always go through pending → screen-name even for returning users**. Rejected because it forces the frontend to render a "type your name" dialog every single login, defeating the screen-name-set semantics.
- **Returning-user callback redirects to `APP_BASE_URL`, not a configurable `?return_to=` target.** Simplifies the surface; a `?return_to=` parameter has a known security trap (open-redirect) that needs an allowlist. Deferred — a future task can land `?return_to=` with allowlist validation. The frontend's deep-link story works around this today by reading the post-login URL from sessionStorage or similar.
- **The new-user callback returns 200 with a JSON body (not a redirect).** Symmetric reasoning: the frontend needs to render a "pick your screen name" form, so it needs a JSON payload to act on. After the screen name is set, the screen-name endpoint returns 200 with the user's info AND sets the session cookie; the frontend then navigates to the app shell. Two redirects (callback → screen-name UI → app) would be twice the round-trip for the same flow.
- **`/auth/me` reads `screen_name` even if it's `<pending>`.** The endpoint returns whatever's in the row. A frontend rendering "you are <pending>" would be a bug — but the screen-name handler ensures the cookie is only issued AFTER the screen name is set (the returning-user callback skips the cookie for `<pending>` rows; the screen-name handler clears the placeholder before issuing the cookie). So `<pending>` should never appear in a `/auth/me` response in practice. Defensive: the test suite exercises this invariant.
- **`verifySessionToken` returns `null` on every failure** (vs. throwing or returning a discriminated union). Three alternatives surveyed:
  - **Return `null`** (chosen). Maps to a single 401 envelope in the route handler; the operator log captures the reason via `jose`'s thrown errors which we catch and log at debug level. Avoids the route handler caring about `instanceof JWTExpired` vs. `JWTInvalid` etc.
  - **Throw a typed error per failure mode**. Rejected as needless surface — the route handler's response is the same envelope regardless of failure mode.
  - **Return a discriminated union `{ ok: true, payload } | { ok: false, reason }`**. Considered for symmetry with `verifyPendingCookie`. Rejected for divergence with `jose`'s `jwtVerify` API surface and because the route handler doesn't need the reason.

## Open questions

- **Denylist follow-up.** When (if) a per-session revocation surface lands, a small `auth_token_denylist (jti TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL)` migration plus a `jti` claim on issuance plus one indexed lookup at verify-time covers it. Not in scope here; tracked as a future task if/when the UX demands it.
- **Cookie attribute audit before production.** Same as `screen_name_collection`: before the first non-dev deployment, double-check `NODE_ENV=production` is set so the Secure attribute lands on both cookies. Tracked under `deployment.prod_container`.
- **Cross-domain frontend.** Today the moderator-console / debater-tablet frontends are served from the same origin as the API (or, via Vite dev server, from `http://localhost:5173` — see the dev redirect-URI registration). If a future deployment runs the frontends on a separate apex domain, `SameSite=Lax` will block the cookie on cross-origin XHR; the deployment task may need to switch to `SameSite=None; Secure` and require explicit `credentials: 'include'` on the frontend's fetch calls. Deferred — today's compose stack is same-origin.
- **WebSocket auth wiring.** The handshake reads the session cookie off the upgrade request. The actual upgrade-time read happens in `backend.websocket_protocol.ws_auth_on_connect`; this task only ensures the cookie is set and the verification helper exists. The verify path that `ws_auth_on_connect` will use is the same `verifySessionToken` exported here.
- **`return_to` parameter.** Deferred. The Decisions above explain why; a future task can add it with an allowlist of allowed redirect destinations (e.g., paths under `APP_BASE_URL` only, no scheme/host override).

## Status

**Done** — 2026-05-10. Landed as:

- Session-token primitives: [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) — exports `signSessionToken`, `verifySessionToken`, `buildSessionCookieHeader`, `buildSessionCookieClearHeader`, `readSessionCookieFromHeader`, plus `SESSION_COOKIE_NAME`, `SESSION_TOKEN_TTL_MS`, `SESSION_TOKEN_TTL_SECONDS` constants and the `SessionTokenPayload` type. HS256 via `jose` (pinned at `6.1.0` in `apps/server/package.json`).
- Route plugin updates: [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — `/auth/callback` now splits on `screen_name === '<pending>'`: returning users get a 302 + session cookie, new users get the existing pending cookie + 200 with `needsScreenName: true`. `/auth/screen-name` issues BOTH the pending-clear AND the session cookie on success. New handlers: `POST /auth/logout` (204, idempotent), `GET /auth/me` (200 with `{ userId, screenName }` or 401 `auth-session-invalid`).
- Auth barrel update: [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) — re-exports the new surface.
- Existing OpenAPI tag taxonomy in [`apps/server/src/openapi.ts`](../../../apps/server/src/openapi.ts) already covers `auth`; no openapi.ts code change needed — the new endpoints attach `tags: ['auth']` and appear in the generated document at `/docs/json` automatically.
- Vitest unit tests: [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) (+33 cases) — JWT sign/verify (10 cases including algorithm-confusion and extra-claim rejection), cookie-header composition + parsing (10 cases), `GET /auth/me` (6 cases), `POST /auth/logout` (3 cases), `/auth/callback` returning-user + new-user branches (2 cases), `/auth/screen-name` session-cookie issuance (1 case). One pre-existing scenario in [`tests/behavior/backend/oauth-callback.feature`](../../../tests/behavior/backend/oauth-callback.feature) — the "returning user reuses the row" — was updated from `200 + body asserts` to `302 + Location asserts` to match the new returning-user redirect behavior.
- Cucumber+pglite scenarios: [`tests/behavior/backend/session-token.feature`](../../../tests/behavior/backend/session-token.feature) (+4 scenarios) with step defs at [`tests/behavior/steps/backend-session-token.steps.ts`](../../../tests/behavior/steps/backend-session-token.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 694 → 727 (+33); Cucumber 123 → 127 (+4).
- **OpenAPI**: `POST /auth/logout` and `GET /auth/me` attach `tags: ['auth']`; documented at `/docs/json` under the `auth` tag, with the canonical `ErrorEnvelope` reference on 4xx/5xx.
- **New dependency**: `jose@6.1.0` added to `apps/server/package.json` for HS256 JWT signing/verification.
