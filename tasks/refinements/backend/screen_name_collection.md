# Screen-name collection — `POST /auth/screen-name`

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.auth.screen_name_collection`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.auth.oauth_callback_handler` (settled — `/auth/login`, `/auth/callback`, `PLACEHOLDER_SCREEN_NAME`, the users-table upsert, the `flow-state` store). Transitively: `data_and_methodology.schema.users_table` (settled — `users.screen_name VARCHAR(64) NOT NULL`).

## What this task is

Third sibling under `backend.auth`. Lands the surface that replaces the `<pending>` placeholder a freshly-created user carries after `/auth/callback` finishes:

- **`POST /auth/screen-name`** — accepts `{ "screenName": "<value>" }`. Authorized by a short-lived signed cookie (`aconversa-auth-pending`) set by `/auth/callback`. Validates the screen name (≤ 64 chars, non-empty after trim, UTF-8), UPDATEs the users row via a parameterized SQL with a guard on `screen_name = '<pending>'`, clears the pending cookie, returns `{ userId, screenName }`.

The task lands the screen-name collection end-to-end **but does not mint a platform session token, does not allow renaming an already-set screen name, and does not gate any other route** — those handoffs are documented below.

## Why it needs to be done

The OIDC callback writes `screen_name = '<pending>'` for freshly inserted users because the OIDC dance and the screen-name pick happen at different moments in the UX. Without this task, every freshly authenticated user is stuck at the placeholder; every downstream consumer that renders a screen name (session participant lists, vote ledgers, the moderator console's participant roster) sees the literal `<pending>`. Lifting the placeholder is the bridge between "you have a backing OIDC identity" and "you can participate in a debate as a named user."

Three siblings depend on this one being landed before they can land cleanly:

- **`backend.auth.session_token_management`** — the next sibling. It will mint the full platform session cookie after the screen name is set, replacing this task's pending-cookie bridge with the production-grade session cookie. The Decisions below detail the explicit handoff: the response of `POST /auth/screen-name` is the natural place to ALSO Set-Cookie the platform session token when `session_token_management` lands.
- **`backend.auth.auth_middleware`** — gates every protected endpoint behind the platform session token. Won't see this task's pending cookie at all; the pending cookie is scoped to the screen-name endpoint only.
- **Every UI that renders a participant's display name** — moderator console, debater tablet, audience broadcast. They all read `users.screen_name`; without this task they'd render `<pending>` everywhere.

## Inputs / context

From [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md):

> The platform reads no profile data — OAuth is purely an authentication signal. **The only user-supplied datum stored is a screen name collected during connect.**

The screen name is the single piece of user-supplied information the platform stores. Every other field is either derived (`oauth_subject` = `${issuer-hostname}:${sub}` from the id_token claim) or system-managed (`created_at`, `deleted_at`, `id`).

From [`tasks/refinements/data-and-methodology/users_table.md`](../data-and-methodology/users_table.md):

> `screen_name` — `VARCHAR(64)` UTF-8. Not unique (duplicates allowed; identity is the OAuth subject).

VARCHAR(64) bounds the storage; the application-layer validator enforces the same bound BEFORE the SQL runs so a 65-character input is rejected with a typed 400 rather than a Postgres-side error.

From [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) (the prior task's deliverable):

```ts
export const PLACEHOLDER_SCREEN_NAME = '<pending>';

export async function upsertUserByOauthSubject(pool, oauthSubject) {
  // INSERT ... ON CONFLICT DO NOTHING; falls back to SELECT.
  // Fresh rows get screen_name = PLACEHOLDER_SCREEN_NAME.
}
```

The `<pending>` literal is unambiguous — angle brackets are not valid screen-name characters under any conceivable UX (the frontend's screen-name input strips them; even if a user got around the strip, the literal `<pending>` is 9 characters and would be parseable but trivially distinguishable from a name a user would type). The UPDATE's WHERE clause uses this literal as the discriminator for "is this a first-write or a rename attempt."

From [`apps/server/src/db.ts`](../../../apps/server/src/db.ts): the shared `DbPool` interface. The screen-name UPDATE uses the same `pool.query(text, params)` shape the callback's upsert uses.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): Vitest unit tests cover the pure-logic primitives (cookie sign/verify round-trip, validation rules); Cucumber+pglite scenarios cover the end-to-end `/auth/callback` → `/auth/screen-name` flow against the real migrated schema.

## The authorization question — three options surveyed

Real platform-session tokens (the cookie/JWT that gates every protected endpoint) come from the next sibling `session_token_management`. So *how does the screen-name endpoint know which user is calling it*? The task description surveyed three options:

- **Option A — Trust a `userId` field in the body.** The callback returns `{ userId, oauthSubject, sub }`; the client posts `{ userId, screenName }` back. The server validates the user exists, has `<pending>` screen name, and… that's it. No cryptographic proof the request is from the user who just authenticated. **Rejected** — any client who learned a `userId` could rename anyone whose screen name is still `<pending>`.

- **Option B — Extend `/auth/callback` to accept an optional `?screen_name=...`.** Keeps the endpoint count low; tightly couples the callback URL to the UX. **Rejected** — the callback is a GET from the issuer's redirect, not a place the UX gets to inject a name. Bouncing the user through "type your name, then submit, then re-do /auth/callback" complicates a flow that's already complex.

- **Option C — Short-lived signed pending cookie.** The callback sets an HttpOnly, SameSite=Lax `aconversa-auth-pending` cookie carrying `{ userId, exp }`, signed with `SESSION_TOKEN_SECRET`. `/auth/screen-name` reads + verifies the cookie, applies the UPDATE, clears the cookie. **Chosen.**

Option C's rationale:

- **Cryptographic binding.** The cookie's signature ties the userId to the OIDC handshake that just completed. Without the secret, an attacker can't fabricate a cookie that names another user.
- **HttpOnly + SameSite=Lax.** XSS can't read the cookie; CSRF from another origin can't replay it for a state-changing POST without the user already being on our origin.
- **Bounded surface.** The cookie is only consumed by ONE endpoint (`POST /auth/screen-name`). Even if it somehow leaks (developer browser extension, leaked logs), the worst-case attack is "name an account that's still at `<pending>` once" — the cookie is cleared on success and rejected if the row is already non-`<pending>`.
- **Clean handoff to `session_token_management`.** When that task lands, the pending cookie is replaced by the full platform session cookie. The bridging shape exists for ~10 minutes per first-auth and never longer; long-term auth state lives in the platform session cookie.

## Constraints / requirements

- **Module shape** under `apps/server/src/auth/`:
  - `pending-cookie.ts` — exports `signPendingCookie`, `verifyPendingCookie`, `buildPendingCookieHeader`, `buildPendingCookieClearHeader`, `readPendingCookieFromHeader`, `resolveSessionTokenSecret`, the `PENDING_COOKIE_NAME` and `PENDING_COOKIE_TTL_MS` constants, and the `PendingCookiePayload` / `VerifyResult` types. Pure cryptographic / parsing primitives — no I/O, no Fastify.
  - `routes.ts` — extended to (a) set the pending cookie at the end of the `/auth/callback` handler, (b) register `POST /auth/screen-name` with its body schema, response schema, and handler. Reuses the existing options bag, with two new fields: `sessionTokenSecret?` (string) and `cookieSecure?` (boolean).
  - `index.ts` — barrel updated to re-export the new surface (`PENDING_COOKIE_NAME`, the cookie helpers, the `updatePendingScreenName` SQL helper).
- **Cookie shape**:
  - Name: `aconversa-auth-pending`.
  - Value format: `<base64url(payload)>.<base64url(hmac)>` where payload is JSON `{ "userId": "<uuid>", "exp": <ms-epoch> }` and HMAC is SHA-256 keyed on `SESSION_TOKEN_SECRET`.
  - TTL: 10 minutes (`PENDING_COOKIE_TTL_MS = 10 * 60 * 1000`).
  - Attributes (callback `Set-Cookie`): `HttpOnly`, `Path=/`, `SameSite=Lax`, `Max-Age=600`, plus `Secure` when `NODE_ENV=production`.
  - Attributes (clear `Set-Cookie`): same shape with `Max-Age=0` and an empty value.
- **Screen-name validation** (matches `users.screen_name VARCHAR(64) NOT NULL` from the users-table refinement):
  - Required, non-empty string.
  - Trim leading/trailing whitespace before length check and persist.
  - Reject pure-whitespace input (after trim, length 0).
  - Reject post-trim length > 64 characters (UTF-16 code units; matches Postgres's character count for almost all real screen names).
  - JSON-validated body shape via Fastify's request schema; schema-level `maxLength: 256` is a defensive cap before the application validator runs.
- **UPDATE SQL**: parameterized — `UPDATE users SET screen_name = $2 WHERE id = $1 AND screen_name = $3 AND deleted_at IS NULL RETURNING id, screen_name`. The WHERE `screen_name = '<pending>'` guard is what makes the call idempotent-on-empty-update: zero matched rows means the user's screen name is already set (or the user was soft-deleted), which the handler maps to 409.
- **Status codes**:
  - 200 — success. Body `{ userId, screenName }`. Clears the pending cookie.
  - 400 — body-shape failure (Fastify schema, code `validation-failed`) OR application-validator failure (code `screen-name-invalid`).
  - 401 — pending cookie missing / malformed / expired / signature-invalid. All four cases map to one envelope (`auth-pending-cookie-invalid`) so the response leaks no information about which case fired.
  - 409 — UPDATE matched zero rows (already-set or soft-deleted user). Code `screen-name-already-set`.
- **Idempotency choice**: the second submission against an already-set user is **409, not 200**. Rationale: a 200 idempotent would imply the operation is safe to retry — but our handler is designed for one specific first-write moment, and a "rename" surface is deliberately out of scope. A 409 is honest about the conflict and tells the client to render an appropriate error rather than silently noop. (If a future task adds rename support, a separate endpoint owns it; this one stays first-write-only.)
- **No platform session token.** This task does NOT issue a session cookie that gates other endpoints — that's `session_token_management`. The pending cookie is bridge-only and scoped to one endpoint.
- **No reading OAuth profile data.** Audited by `no_profile_data_policy`. This handler reads the users-table row (already populated from the OIDC `sub` claim by the callback) — no claim from the id_token is read here.
- **Test layers per ADR 0022**:
  - **Vitest** in `apps/server/src/auth/screen-name.test.ts` — pure-logic tests on `signPendingCookie` / `verifyPendingCookie` (round-trip, tampered payload, tampered signature, expired, malformed, payload-invalid), Fastify `.inject()` tests on `POST /auth/screen-name` (200 success, 401 missing-cookie / tampered / expired, 400 whitespace / too-long / missing-screenName, 409 already-set, Set-Cookie clears the cookie), `buildPendingCookieHeader` (attributes, Secure toggle).
  - **Cucumber+pglite** in `tests/behavior/backend/screen-name.feature` — three scenarios: (1) first-auth flow — callback + POST → users row updated + cookie cleared; (2) missing cookie → 401; (3) second submission on already-set row → 409. Step defs in `tests/behavior/steps/backend-screen-name.steps.ts`.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new file `apps/server/src/auth/screen-name.test.ts` adds 20 cases; total goes 674 → 694.
- `pnpm run test:behavior:smoke` (Cucumber) green; new `tests/behavior/backend/screen-name.feature` adds 3 scenarios to the existing 120, totaling 123.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- `POST /auth/screen-name` appears in the generated OpenAPI document under the `auth` tag.

## Decisions

- **Chose Option C (short-lived signed pending cookie) over A/B.** Rationale in the "three options" section above. The cookie's HMAC ties the request to the OIDC handshake that just completed; no other approach gives that binding without the platform session token (which this task doesn't issue).
- **Pending cookie name `aconversa-auth-pending`.** Two alternatives surveyed:
  - **`aconversa-auth-pending`** (chosen). Application-namespaced prefix (`aconversa-`) avoids collisions with any other cookie a future deployment might run alongside us. The `auth-pending` suffix tells operators "this is for the auth completion bridge."
  - **`pending-auth`** or similar short name. Rejected because in a multi-app cookie jar (browser holding cookies for several origins) the namespaced prefix avoids accidental cookie crosstalk after a config change.
- **TTL: 10 minutes.** Three alternatives surveyed:
  - **10 minutes** (chosen). Generous enough that the UX can ask the user "type your name" and tolerate a minute of pause + a clumsy keypress, short enough that an abandoned flow doesn't leave a long-lived auth-bridge sitting on a shared device. The flow-state store's 5-minute TTL is shorter because that one bounds the OIDC dance window (Authelia's authorization-code lifespan is 1 minute); the pending cookie covers a different window (user-side typing) so a longer TTL is appropriate.
  - **5 minutes**. Rejected because a slow typist on a fresh-OAuth-from-mobile is plausibly slower than 5 minutes; we'd rather not force them to redo the OIDC dance.
  - **30 minutes**. Rejected because abandoned flows hold the bridge longer. The next sibling will replace this with a real session token whose TTL can be longer — the pending cookie is the bridge, not the persistent state.
- **HMAC-SHA256 over `SESSION_TOKEN_SECRET`.** Three alternatives surveyed:
  - **HMAC-SHA256** (chosen). Symmetric authentication is the right primitive for a server-only cookie (no public key needed because the server is both signer and verifier). SHA-256 is what every modern crypto API supports natively; Node's `node:crypto.createHmac('sha256', key)` is one line.
  - **JWT (HS256)**. Rejected as overkill. JWT brings claim conventions (iss, aud, sub, iat, etc.) we don't need; we just need `{ userId, exp }` and a signature. The custom shape is shorter to encode and easier to audit.
  - **Asymmetric (RS256)**. Rejected for being mismatched to the use case — there's no public key to publish, no third party verifying. Asymmetric is for cross-party trust; we're the only party.
- **`SESSION_TOKEN_SECRET` env var (shared with `session_token_management`).** Two alternatives surveyed:
  - **Reuse `SESSION_TOKEN_SECRET`** (chosen). The env var already exists in `.env.example` (foundation.dev_env.env_var_template) explicitly for session-token-style signing. Reusing it means: (1) one secret to rotate, not two; (2) `session_token_management` and this task can share the same operational pattern. Per ADR-0002 the platform has minimal secrets surface — adding a second one for a 10-minute bridge would be operational debt.
  - **`PENDING_COOKIE_SECRET`** (separate env var). Rejected. The pending cookie and the session token serve adjacent purposes (both sign user-bound transient state); separate secrets would suggest different threat models for the same problem.
- **Cookie attribute set**: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=600`, plus `Secure` in production.
  - `HttpOnly` — JS can't read the cookie; XSS can't exfiltrate it.
  - `SameSite=Lax` — cross-origin top-level navigation (the OIDC redirect FROM Authelia BACK to our origin) still carries the cookie, but a malicious third-party POST can't.
  - `Path=/` — the cookie applies to the whole origin. The endpoint that consumes it is `/auth/screen-name`; a more restrictive `Path=/auth` would also work but the wider path is the simpler default.
  - `Max-Age=600` — 10 minutes. Browsers honor this; the server-side `expiresAt` field in the cookie payload is the authoritative expiry (the verification reads it, independent of the browser's clock).
  - `Secure` in production — over HTTPS only. In dev (Compose `http://localhost:3000`), Secure would prevent the browser from sending the cookie back; we set `cookieSecure: false` in dev so the bridge works. The toggle reads `NODE_ENV === 'production'`.
- **First-write-only — 409 on second submission, no rename.** Three alternatives surveyed:
  - **409 on second submission** (chosen). The endpoint is honest about the conflict: the user's row is already named; this surface doesn't rename. A future "edit profile" endpoint can land separately when the UX needs it; this task's scope is "the first time the user authenticates."
  - **200 idempotent (return the existing screen name unchanged).** Rejected because idempotency implies "safe to retry"; renaming an already-named user is a different operation and clients should know they took a different path than expected.
  - **Allow rename.** Rejected as scope creep. The users-table refinement doesn't promise a rename surface; the security model for rename (do you need re-auth? does it create a history entry?) is out of scope here. Future work.
- **401 leak-resistant — one envelope for all cookie-invalid reasons.** Three failure modes (missing cookie, malformed cookie, expired cookie, signature-invalid) all map to the same `auth-pending-cookie-invalid` envelope. The verify-internals discriminate the reason (for structured logging in production), but the response body never tells the client which subcase fired. This matches the `auth-state-invalid` precedent set by `oauth_callback_handler` — never tell an unauthenticated caller which step of the verification failed.
- **Handoff to `session_token_management`.** When that sibling lands, the natural point of integration is the success path of `POST /auth/screen-name`: after the UPDATE lands, the response also Set-Cookies the platform session token AND clears the pending cookie. The pending cookie has served its only purpose by then. Until that sibling lands, the success response is just `{ userId, screenName }` with no platform session — the user is "authenticated to Authelia + has a screen name" but no protected endpoints exist yet to gate them out of.
- **Validation rules pinned in `validateScreenName` (private to `routes.ts`).** A future "rename" endpoint would re-use the same rules. Lifting the validator to `pending-cookie.ts` was considered and rejected because it would mis-namespace the surface (the cookie module is cryptographic; the validator is text-shape). Kept private to the route plugin; if a sibling needs it, the export is one line.

## Open questions

- **Edge case: user races their own first submission.** Two browser tabs both call `/auth/callback` (Authelia replays the redirect twice) and then both call `POST /auth/screen-name` simultaneously. The UPDATE's WHERE clause serializes: the first commit wins (returns the user row); the second sees `screen_name <> '<pending>'` and returns the 409. The user sees the 409 in one tab but the other tab succeeded. Acceptable.
- **Future work — rename.** Out of scope here. A future task may land `PATCH /users/me/screen-name` gated by the full platform session cookie. This task's `screen-name-already-set` envelope explicitly states "rename is not supported in this surface" so the contract leaves room for that surface to land elsewhere.
- **Pending cookie sweeper.** Unlike the flow-state store, there's no server-side state to sweep — the cookie is browser-side and HMAC-checked on every read. Expired cookies simply fail verification; no background work needed.
- **Cookie attribute audit before production.** Before the first non-dev deployment, double-check the production-side `Secure` toggle: the deployment task should set `NODE_ENV=production` so the Secure attribute lands. Tracked under `deployment.prod_container`.

## Status

**Done** — 2026-05-10. Landed as:

- Pending-cookie primitives: [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts) — exports `signPendingCookie`, `verifyPendingCookie`, `buildPendingCookieHeader`, `buildPendingCookieClearHeader`, `readPendingCookieFromHeader`, `resolveSessionTokenSecret`, plus `PENDING_COOKIE_NAME` and `PENDING_COOKIE_TTL_MS` constants.
- Route plugin update: [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — `/auth/callback` now sets the `aconversa-auth-pending` cookie after the upsert; new `POST /auth/screen-name` handler registered. New `AuthRoutesOptions` fields `sessionTokenSecret?` and `cookieSecure?` for test injection. New SQL helper `updatePendingScreenName`.
- Auth barrel update: [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) — re-exports the new surface.
- Vitest unit tests: [`apps/server/src/auth/screen-name.test.ts`](../../../apps/server/src/auth/screen-name.test.ts) (+20 cases) — cookie sign/verify, route handler 200 / 400 / 401 / 409 paths, cookie attribute composition.
- Cucumber+pglite scenarios: [`tests/behavior/backend/screen-name.feature`](../../../tests/behavior/backend/screen-name.feature) (+3 scenarios) with step defs at [`tests/behavior/steps/backend-screen-name.steps.ts`](../../../tests/behavior/steps/backend-screen-name.steps.ts).
- Step-file + Vitest update for the prior task: [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts) and [`tests/behavior/steps/backend-oauth-callback.steps.ts`](../../../tests/behavior/steps/backend-oauth-callback.steps.ts) both pass `sessionTokenSecret: 'test-session-secret'` + `cookieSecure: false` so the callback's new Set-Cookie path doesn't require `SESSION_TOKEN_SECRET` from process.env in tests.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 674 → 694 (+20); Cucumber 120 → 123 (+3).
- **OpenAPI**: `POST /auth/screen-name` attaches `tags: ['auth']`; the body schema (`screenNameBodySchema`) and 200 response schema (`screenNameResponseSchema`) are picked up by `@fastify/swagger` and documented at `/docs/json`.
