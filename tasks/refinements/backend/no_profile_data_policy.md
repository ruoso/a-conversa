# No-OAuth-profile-data policy

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.auth.no_profile_data_policy`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.auth.oauth_callback_handler` (settled — `flow.ts`, `routes.ts`, `flow-state.ts`, `pending-cookie.ts`, `session-token.ts` all in place); `data_and_methodology.schema.users_table` (settled — migration at `apps/server/migrations/0001_users.sql`); `backend.auth.session_token_management` (settled — `signSessionToken`/`verifySessionToken` pin `{ sub, iat, exp }`).

## What this task is

The platform's identity policy — captured in [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) and repeated in [docs/architecture.md — identity](../../../docs/architecture.md#identity) — is:

> The platform reads no profile data — OAuth is purely an authentication signal. The only user-supplied datum stored is a screen name collected during connect.

This task **audits the existing auth code** to confirm the rule holds today and **lands lock-in tests** that fail if anyone widens the OIDC scope, reads an extra id_token claim, calls the userinfo endpoint, adds a profile column to the `users` table, or stuffs profile data into the platform session JWT.

The audit found the code already compliant — no implementation changes were needed. All the load-bearing work is in the new tests.

## Why it needs to be done

- The rule is the foundation of every user-data privacy claim the project makes. It needs a regression net, not a code comment.
- Three sibling tasks (`oauth_callback_handler`, `session_token_management`, `request_logging`) each carry a narrow piece of the rule. Without a dedicated audit, future PRs touching auth would have to re-derive "what does no-profile-data mean concretely?" from prose. The lock-in tests answer the question once.
- Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every empirical verification is a committed test. The audit answers "does the code respect the rule today?" — that answer must live in CI, not in this document's narrative.

Downstream consumers:

- Every future auth-touching PR. The lock-in tests fail if `scope` widens, if `claims.email` is ever read, if the `users` migration grows an `email` column, if the session JWT carries a `name` claim, etc.
- Future tasks adding upstream OAuth providers via Authelia YAML (`deployment.prod_compose.prod_oauth_config`). The lock-in is per-application; the providers can do what they like upstream.

## Inputs / context

From [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md):

> The platform reads no profile data — OAuth is purely an authentication signal. The only user-supplied datum stored is a screen name collected during connect.
>
> Authelia owns its own user/session data (file-backed in dev, database-backed in prod). The application database stores only the OIDC subject identifier and the user-supplied screen name.

From [docs/architecture.md — identity](../../../docs/architecture.md#identity):

> Federated identity via OAuth. Do not read identity profile data. Ask each user a screen name. The screen name is the only piece of user-supplied info the platform stores.

The audit checks five concrete invariants:

1. The OIDC `scope` requested is **exactly `openid`** (not `profile`, not `email`, not `openid email`, etc.).
2. The id_token claims object is read for **only `.sub`**. No `.email`, `.name`, `.picture`, `.preferred_username`, etc.
3. The OIDC userinfo endpoint is **never called**. (openid-client's `fetchUserInfo` is never imported.)
4. The `users` table schema carries **no profile columns** — only `id`, `oauth_subject`, `screen_name`, `created_at`, `deleted_at`.
5. The platform session JWT carries **only `{ sub, iat, exp }`** — no `email`, `name`, `picture`, no operator-defined fields.

## Constraints / requirements

- **No implementation changes unless an audit gap is found.** The existing code is the source of truth; if it complies, only tests land.
- **Audit findings cite files + line numbers.** The lock-in tests reference the same files so a future drift fails both layers.
- **Two test layers per ADR 0022**:
  - **Vitest** in `apps/server/src/auth/no-profile-data.test.ts` — pure-logic assertions over `beginAuthFlow`, `completeAuthFlow`, the session-token shape, the migration file contents, and the auth source files. Uses `__buildStubConfiguration` for the Configuration and an inline stubbed `authorizationCodeGrant` carrying synthetic profile claims (`email`, `name`, `picture`, `preferred_username`) — none of which may reach the response.
  - **Cucumber+pglite** in `tests/behavior/backend/no-profile-data.feature` — end-to-end scenarios with a stubbed id_token carrying profile claims; assertions that the resulting `users` row, the `/auth/me` response, and the broader response surface carry none of them.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds (no implementation changes were necessary; the audit confirms compliance).
- `pnpm run test:smoke` (Vitest) green; new `apps/server/src/auth/no-profile-data.test.ts` adds 7 cases; total 727 → 734.
- `pnpm run test:behavior:smoke` (Cucumber) green; new `tests/behavior/backend/no-profile-data.feature` adds 3 scenarios; total 127 → 130.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Pragmatic minimum, all value in the tests.** No new file under `apps/server/src/auth/` houses "audit metadata" — the policy is enforced by the tests, not by a runtime gate. Two alternatives surveyed:
  - **Tests only** (chosen). The Vitest cases read the source files as strings and grep for the forbidden patterns; the Cucumber scenarios drive the real handler with a profile-claim-bearing id_token and assert nothing leaks. No new production code.
  - **Runtime audit module** (`apps/server/src/auth/profile-data-audit.ts`). Considered. Rejected because there's nothing it could check at runtime that the tests don't check at build time. A no-op module would be dead weight; a runtime claim-filter on `claims()` would duplicate `flow.ts`'s already-narrow `.sub` read.
- **Synthetic id_token carries `email`, `name`, `picture`, `preferred_username`.** Four claims that real upstream providers (Google, GitHub, GitLab) commonly include when `profile`/`email` scopes are granted. The test stubs them onto the validated id_token and asserts they appear in zero downstream artifacts.
- **`users` migration check is a string read, not a column-introspection query.** The migration source file is the source of truth for what columns exist. A `regex.test(migrationText)` assertion that none of `/email|given_name|family_name|picture|locale|preferred_username/i` appears in `0001_users.sql` is sufficient — the regex is the canonical "what columns are forbidden" list.
- **Session-token shape re-asserted here in a no-profile-data framing.** `session-token.test.ts` already pins `{ sub, iat, exp }` and rejects forged extras (the `role: admin` case). The new test re-uses the same primitives in a no-profile-data narrative so the lock-in surface is self-contained: a reader of `no-profile-data.test.ts` doesn't have to chase across files to know the session token also complies.

## Audit findings (2026-05-10)

Per-file compliance against the five invariants.

### Invariant 1 — OIDC scope is exactly `openid`

**[`apps/server/src/auth/flow.ts:157`](../../../apps/server/src/auth/flow.ts)** — `beginAuthFlow` defaults `scope` to `'openid'`. The function accepts a caller-supplied `scope` override (`BeginAuthFlowParams.scope`), but every production caller passes nothing.

**[`apps/server/src/auth/routes.ts:559-563`](../../../apps/server/src/auth/routes.ts)** — `/auth/login` calls `beginAuthFlow(client, { redirectUri: oidcConfig.redirectUri }, ...)` — no `scope` argument. The flow default applies; the URL carries `scope=openid`.

Compliant. Lock-in test: `defaults scope to openid (no profile/email/etc.)`.

### Invariant 2 — id_token claims are read for only `.sub`

**[`apps/server/src/auth/flow.ts:294-303`](../../../apps/server/src/auth/flow.ts)** — `completeAuthFlow` calls `tokens.claims()` exactly once, reads `claims.sub` exactly once, returns `{ sub }` exactly once. No other property access on `claims`.

**[`apps/server/src/auth/routes.ts:642-665`](../../../apps/server/src/auth/routes.ts)** — `/auth/callback` consumes `result.sub` from `completeAuthFlow` and never touches `claims` directly.

A grep for `claims().` and `.email|.name|.picture|.preferred_username|.locale|.given_name|.family_name` across `apps/server/src/auth/` returns zero matches outside comment / test-stub contexts (the comment-level mentions in `flow.ts` document the policy, not violations).

Compliant. Lock-in test: `completeAuthFlow returns only { sub } even when the stubbed id_token carries email/name/picture`.

### Invariant 3 — the userinfo endpoint is never called

`openid-client`'s userinfo helper is `fetchUserInfo`. A grep for `fetchUserInfo|userinfo|UserInfo` across `apps/server/src/auth/` returns zero matches in production code.

Compliant. Lock-in test: the auth source files (read as strings) contain no `fetchUserInfo` substring.

### Invariant 4 — `users` table schema has no profile columns

**[`apps/server/migrations/0001_users.sql`](../../../apps/server/migrations/0001_users.sql)** — columns are `id`, `oauth_subject`, `screen_name`, `created_at`, `deleted_at`. No `email`, `name`, `given_name`, `family_name`, `picture`, `locale`, `preferred_username`.

Compliant. Lock-in test: `users migration contains no profile-data column names`.

### Invariant 5 — session JWT carries only `{ sub, iat, exp }`

**[`apps/server/src/auth/session-token.ts:139-163`](../../../apps/server/src/auth/session-token.ts)** — `signSessionToken({ sub }, secret)` builds the JWT with exactly `{ sub, iat, exp }` claims and no other fields.

**[`apps/server/src/auth/session-token.ts:190-259`](../../../apps/server/src/auth/session-token.ts)** — `verifySessionToken` rejects any token whose payload carries fields beyond `sub`/`iat`/`exp` (the existing `it('returns null for a token carrying extra (non-canonical) claims', ...)` test in `session-token.test.ts` already pins this).

Compliant. Lock-in test: `signSessionToken's payload carries exactly { sub, iat, exp } and rejects extras` (cross-references the existing `session-token.test.ts` case under the no-profile-data narrative).

### Adjacent surfaces (log lines, response bodies)

**[`apps/server/src/logger.ts:29-42`](../../../apps/server/src/logger.ts)** — comment block documents that request bodies, Authorization / Cookie / Set-Cookie headers are intentionally dropped from logs. This is verified by `request_logging`'s existing Cucumber scenarios; the no-profile-data Cucumber scenario re-asserts it in this narrative by running a full handshake with a profile-claim-bearing id_token and confirming no log emission carries those values.

**[`apps/server/src/auth/routes.ts:704-709, 894-908`](../../../apps/server/src/auth/routes.ts)** — the `/auth/callback` response body shape is `{ sub, oauthSubject, userId, needsScreenName }` (new-user branch) or a 302 with no body (returning-user branch). The `/auth/me` response body is `{ userId, screenName }`. Neither carries profile claims by construction.

Compliant. Lock-in test: Cucumber scenarios assert the response body shape and the absence of profile-claim values in any inspectable surface.

## Checklist for future PRs touching auth

When a PR touches anything under `apps/server/src/auth/` OR `apps/server/migrations/0001_users.sql`, the reviewer confirms:

- [ ] OIDC `scope` is still `'openid'` only. If `profile`/`email`/`offline_access`/etc. are being requested, the PR must amend [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) and this refinement.
- [ ] The id_token's `.claims()` result is read for `.sub` only. If a new claim read lands, the PR amends this refinement's "Invariant 2" section AND the no-profile-data Vitest case is updated to expect the new (justified) claim.
- [ ] `fetchUserInfo`/`userinfo` is not imported. The userinfo endpoint stays uncalled.
- [ ] The `users` migration adds no profile-data column. New columns covering operational metadata (e.g., `last_seen_at`) are fine; new columns covering identity data require an ADR amendment.
- [ ] The platform session JWT still carries `{ sub, iat, exp }` only. Future claims (e.g., a `jti` for revocation) require an ADR amendment and a parallel update to the lock-in test.
- [ ] No log line, no error envelope, no response body echoes id_token claim values. New routes that expose user info MUST expose only `screen_name` + `userId`.

If all six checks pass, the PR is rule-compliant; the existing CI runs are sufficient to catch any drift.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10. The audit confirmed the existing implementation is fully compliant; no implementation changes were necessary. Lock-in tests landed as:

- Vitest unit tests: [`apps/server/src/auth/no-profile-data.test.ts`](../../../apps/server/src/auth/no-profile-data.test.ts) — 7 cases covering scope minimalism, claim-narrowness on a synthetic profile-claim-bearing id_token (response body + DB query params), the absence of `fetchUserInfo` in auth source files, the `users` migration string check, the session JWT shape (exactly `{ sub, iat, exp }`), and the wider response-surface audit (headers + Location).
- Cucumber+pglite scenarios: [`tests/behavior/backend/no-profile-data.feature`](../../../tests/behavior/backend/no-profile-data.feature) — 3 scenarios covering the end-to-end handshake with a profile-claim-bearing id_token, `/auth/me` response shape, and `users` row column shape after callback.
- Step defs: [`tests/behavior/steps/backend-no-profile-data.steps.ts`](../../../tests/behavior/steps/backend-no-profile-data.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 727 → 734 (+7); Cucumber 127 → 130 (+3).
