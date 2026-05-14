Source: docs/security/m3-review/auth.md F-001 + F-006; docs/security/m3-review/coverage.md G-005

# Per-session JWT revocation via `jti` + denylist table

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.jwt_revocation_jti_denylist`
**Effort estimate**: 3d
**Inherited dependencies**:

- `backend.auth.session_token_management` (settled — produced the stateless HS256 JWT + cookie surface this task ratchets up).
- `backend.auth.auth_middleware` (settled — produced the shared `authenticateRequest` helper this task augments with a denylist consult).
- `backend.websocket_protocol.ws_auth_on_connect` (settled — produced the WS preValidation gate that composes `authenticateRequest`; after this task its rejects also pick up the denylist).
- `backend_hardening.subscription_lifecycle.user_soft_delete_ws_close` (settled — produced `closeUserConnections(userId, reason)` and the `WS_AUTH_REVOKED_CLOSE_CODE` (4401) the logout path now triggers to propagate revocation onto open sockets).
- `backend_hardening.protocol_test_pinning.logout_no_revocation_pin` (settled — produced the pin test that INVERTS as part of this task's deliverable).

## What this task is

Convert the platform session JWT from a 7-day stateless bearer credential into a **revocable** session token. Three concrete changes ship together:

1. **`jti` claim.** Every JWT minted by `signSessionToken` carries a fresh v4 UUID `jti`. The verifier reads `jti` off the payload-shape audit (no longer rejects unknown claim).

2. **`auth_token_denylist` table.** A new forward-only migration creates `auth_token_denylist (jti UUID PK, user_id UUID, revoked_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ)`. Logout writes one row per revoked token. The verifier consults the table on every verify; a hit returns `null` (collapses to the existing `auth-required` 401 envelope — no new error code).

3. **Logout writes a denylist row + closes open WS connections.** `POST /auth/logout` verifies the cookie's JWT to extract `(jti, user_id, exp)`, INSERTs into the denylist, and calls `closeUserConnections(userId, 'auth-revoked')` to kick any open WebSocket on that user. The 204 cookie-clear behavior is unchanged.

4. **Per-connection cache.** On the WS surface, the auth gate's verify result is cached on the `WsConnectionContext` for the connection's lifetime (the same `connection.user` already cached the `AuthUser`). The cache means a denylist DB hit fires ONCE on upgrade, not once per inbound message. Revocation propagation onto a still-open connection runs via `closeUserConnections` — when the cookie's `jti` is added to the denylist, all open connections for that user are server-closed with code 4401 / reason `auth-revoked`, so the cache CANNOT serve a stale "valid" answer past revocation. Closing the connection IS the cache invalidation.

5. **Periodic sweeper.** A 60-minute interval sweeps expired denylist rows. Rows remain until `expires_at` because the corresponding JWT remains structurally valid until that instant; earlier removal would let a still-signed token bypass the gate.

6. **Test inversion.** `logout_no_revocation_pin.md` pinned current behavior with `expect(replay.statusCode).toBe(200)`. This task inverts that assertion to `401` and renames the describe block to drop the "known trade-off" suffix.

## Why it needs to be done

[`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md):

- **F-001 [High]** — `POST /auth/logout` clears the browser cookie but never invalidates the JWT on the server. The 7-day TTL is the only bound on a stolen token's lifetime. Real users will say "I logged out"; the support team has no mitigation.
- **F-006 [Medium]** — `verifySessionToken` does not bind the JWT to anything other than the secret. The payload is exactly `{ sub, iat, exp }`; no `jti`, no IP/UA binding. The cookie is a portable bearer credential. Stolen cookie = 7 days of impersonation including every state-changing WS message in the methodology engine.

[`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md):

- **G-005 [High]** — the no-revocation trade-off was pinned by `logout_no_revocation_pin` but the structural fix was deferred to this task. The pin test's leading comment names `jwt_revocation_jti_denylist` and instructs the maintainer to invert the assertion when this task lands; this refinement closes both halves of G-005.

Both F-001 and F-006 explicitly recommend the same fix: mint a `jti`, persist `(jti, user_id, expires_at)`, look up `jti` on verify, write on logout. The Suggested fix from F-006: "the WS path will pay the per-message cost, but the lookup is O(log N) on an indexed UUID and runs once per connection if you cache on the WsConnectionContext" — the cache-on-upgrade design below realizes that recommendation literally.

## Inputs / context

- [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md) F-001 + F-006 — source findings.
- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-005 — source coverage gap.
- [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) — `signSessionToken` (mints `{ sub, iat, exp }` today; this task adds `jti`) + `verifySessionToken` (HMAC + payload-shape + clock; this task adds denylist consult via a callable hook).
- [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — `authenticateRequest` composes the cookie-read + JWT-verify + user-row-lookup; this task injects the denylist consult between verify and user-row-lookup.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — `POST /auth/logout` (`routes.ts:838`); today a no-op against revocation. This task makes it parse the cookie's JWT, INSERT into the denylist, and call `closeUserConnections`.
- [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — `closeUserConnections(userId, reason)` (line 740) — the helper this task triggers from logout. Already lands `socket.close(4401, 'auth-revoked')` on every open connection for the user. The cache-invalidation invariant rides on this primitive.
- [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) — the periodic-sweeper pattern this task mirrors for the denylist (60-minute interval, `.unref()`'d Node timer, lazy default-instance construction).
- [`apps/server/migrations/`](../../../apps/server/migrations/) — forward-only migration directory per ADR 0020. New file: `0011_auth_token_denylist.sql`.
- [`tasks/refinements/backend-hardening/logout_no_revocation_pin.md`](./logout_no_revocation_pin.md) — the pin test this task INVERTS (`expect(...).toBe(200)` → `expect(...).toBe(401)`).
- [`tasks/refinements/backend-hardening/user_soft_delete_ws_close.md`](./user_soft_delete_ws_close.md) — the `closeUserConnections` primitive this task is the second consumer of (`user_soft_delete_ws_close` is the first, but its trigger wires up later via a future admin endpoint; this task is the first PRODUCTION trigger).
- [`docs/adr/0020-postgres-migration-strategy.md`](../../../docs/adr/0020-postgres-migration-strategy.md) — forward-only migration policy.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — empirical verifications must be committed tests.

## Constraints / requirements

- **Forward-only migration** (ADR 0020). New file `0011_auth_token_denylist.sql`; no down step.
- **Schema**: `(jti UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`. Index on `expires_at` for the periodic-sweeper DELETE. The `user_id` FK uses ON DELETE RESTRICT to match the soft-delete posture of the surrounding tables — a soft-deleted user's denylist rows are retained until their natural expiry.
- **`jti` is v4 UUID** (Node 20+ built-in `crypto.randomUUID()`), minted at sign time. Tests inject a deterministic generator for hermetic JWT shape assertions.
- **Verifier signature unchanged**. `verifySessionToken(token, secret, options?)` still returns the decoded payload on success / `null` on failure. The denylist consult is performed by a new helper `isJtiRevoked(jti, pool)` that the middleware calls AFTER the JWT verifies and BEFORE the user-row lookup; that ordering means an unsigned-or-expired token never burns a denylist query.
- **Cache invariant** (load-bearing). The WS path caches the upgrade-time `AuthUser` on `WsConnectionContext.user`. The denylist consult runs at upgrade time exactly like every other auth step; it does NOT run per inbound message. Revocation propagation onto an open WS connection runs via `closeUserConnections(userId, 'auth-revoked')` invoked from the logout path — the connection is closed before any cached `AuthUser` can be reused. Closing IS the cache invalidation. The cache does NOT need a TTL because the upper bound on its life is the WS connection's life, and the connection terminates on revocation. The HTTP path has no analogous cache: every protected HTTP request runs the full middleware chain, so every HTTP request consults the denylist.
- **Sweeper cadence**: 60 minutes. Faster cadence buys nothing because rows must live until `expires_at` regardless; slower cadence is fine but means a few-hour lag between expiry and physical removal. The cadence is configurable via `AUTH_DENYLIST_SWEEP_INTERVAL_MS` for hermetic tests; default is `60 * 60 * 1000`.
- **Sweeper deletes rows where `expires_at <= now()`**. Earlier removal is a security hole — the JWT remains structurally valid until `expires_at`, so a removed denylist row would let a forged-replay slip through. The DELETE uses the `expires_at` index.
- **Logout writes BOTH the denylist row AND closes WS connections.** Order matters: write the denylist row FIRST (so a concurrent WS reconnect after the close would also fail at the upgrade gate via the denylist consult), then call `closeUserConnections(userId, 'auth-revoked')`. The race is bounded: if `closeUserConnections` runs before the denylist row commits, a concurrent reconnect could slip through the upgrade gate for the brief window between the two. Writing the denylist row first eliminates that window entirely.
- **Logout-without-cookie** (no JWT to extract `jti` from) remains a 204 idempotent no-op — same as today. The cookie-clear `Set-Cookie` is the whole behavior in that path.
- **Logout-with-invalid-cookie** (signature tamper, expired, malformed) is ALSO a 204 idempotent no-op — there is no `jti` to add to the denylist if the cookie cannot be verified. The cookie-clear `Set-Cookie` is the whole behavior. Rationale: a logout endpoint that throws 401 on an invalid cookie would be a usability footgun (the user "is" logged out from their perspective; the response should reflect that). The denylist write is conditional on a successfully-verified JWT; an invalid cookie does not earn a denylist row.
- **All envelopes use existing codes.** The denylist-rejection path returns the SAME `auth-required` 401 the rest of the middleware emits. No new error code, no information leak about "revoked vs. expired vs. invalid."
- **WS close code is the existing 4401** (`WS_AUTH_REVOKED_CLOSE_CODE`) with reason `'auth-revoked'`. Reusing the constant keeps the WS-aware client's mapping single-source — same code for `user_soft_delete_ws_close`'s trigger and this task's trigger.
- **Tests verify per ADR 0022.** Vitest unit tests under `apps/server/src/auth/` and `apps/server/src/ws/`. No ad-hoc probes.

## Acceptance criteria

- `apps/server/migrations/0011_auth_token_denylist.sql`:
  - `CREATE TABLE auth_token_denylist (jti UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL);`
  - `CREATE INDEX auth_token_denylist_expires_at_idx ON auth_token_denylist (expires_at);`
  - Forward-only; no down migration; header comment names the source findings and refinement.

- `apps/server/src/auth/session-token.ts`:
  - `SessionTokenPayload` adds `readonly jti: string`.
  - `signSessionToken` accepts an optional `jti` generator (defaults to `crypto.randomUUID()`) and includes the value as a JWT payload claim.
  - `verifySessionToken` allows `jti` in the payload-shape audit (adding to `allowedKeys`); returns `jti` on the resolved payload.

- `apps/server/src/auth/token-denylist.ts` (new module):
  - `addToDenylist({ jti, userId, expiresAtMs }, pool)` — INSERTs one row.
  - `isJtiRevoked(jti, pool)` — SELECT 1 FROM auth_token_denylist WHERE jti = $1; returns boolean.
  - `sweepExpiredDenylistRows(pool, options?)` — DELETE FROM auth_token_denylist WHERE expires_at <= NOW().
  - `getDefaultDenylistSweeper(pool)` — module-singleton periodic-sweeper, mirrors `getDefaultFlowStateStore` shape.

- `apps/server/src/auth/middleware.ts`:
  - `authenticateRequest` consults `isJtiRevoked` AFTER JWT verify, BEFORE user-row lookup. A revoked `jti` returns `null` (collapses to `auth-required`).

- `apps/server/src/auth/routes.ts`:
  - `POST /auth/logout`: read cookie → verify JWT → extract `(jti, sub, exp)` → `addToDenylist({jti, userId: sub, expiresAtMs: exp * 1000}, pool)` → `closeUserConnections(sub, 'auth-revoked')` → 204 + cookie-clear. Missing/invalid cookie remains an idempotent 204 (no denylist write, no WS close).
  - Plugin options accept `closeUserConnectionsHook` so production wires the WS module's helper and tests pass a spy without static dependency.

- `apps/server/src/server.ts`:
  - Wires `closeUserConnectionsHook: closeUserConnections` from `ws/connection.ts` into `authRoutesPlugin` options.
  - Lazily starts the denylist sweeper on first authenticated route.

- Tests (Vitest, ADR 0022):
  1. `session-token.test.ts` — `signSessionToken` mints a `jti`; round-tripped payload includes the same `jti`.
  2. `session-token.test.ts` — verify-after-revoke returns null (using `isJtiRevoked` via a memory-backed pool).
  3. `token-denylist.test.ts` (new) — `addToDenylist` writes a row; `isJtiRevoked` reads it back; second `addToDenylist` of the same `jti` is rejected by the PK constraint and surfaces as an error the route handler catches (or is allowed to be a no-op via `ON CONFLICT DO NOTHING` — see Decisions).
  4. `token-denylist.test.ts` — `sweepExpiredDenylistRows` removes rows whose `expires_at <= now`; rows whose `expires_at > now` are retained.
  5. `routes.test.ts` (or `session-token.test.ts`'s logout block) — INVERSION OF `logout_no_revocation_pin`: after POST `/auth/logout` with a valid cookie, replaying the same cookie against `/auth/me` returns **401** (was 200).
  6. `user-soft-delete.test.ts` (or sibling) — open WS, POST `/auth/logout`, assert connection closes with code 4401 / reason `auth-revoked`. Reuses the existing `openWsClient` harness.
  7. `routes.test.ts` — concurrent sessions: user mints two cookies (two `jti`s). Revoking session A leaves session B's verify path returning 200.
  8. `routes.test.ts` — `/auth/logout` with no cookie remains 204 + cookie-clear (idempotent path).
  9. `routes.test.ts` — `/auth/logout` with an invalid cookie remains 204 + cookie-clear (no denylist write).

- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new Vitest cases; all pass.
- Task-completion ritual: `complete 100` on the `.tji` task, `## Status` block here, `## Status` block update on `logout_no_revocation_pin.md` noting the inversion landed, single commit.

## Decisions

- **`jti` is a v4 UUID, not a hash of the cookie value.** A UUID is the same shape as every other id in the system; PK + B-tree indexing is automatic; collisions are negligible. A cookie-hash variant would let the verifier compute `jti` from the cookie alone (no claim needed), but the cookie value already changes every sign — there is no rotational stability for the hash to anchor against. UUID is the natural shape.
- **Denylist, not allowlist.** An allowlist (per-token "active" row) requires a write on every sign; a denylist requires a write only on revocation. v1 expected revocation rate is dwarfed by sign rate, so the denylist is strictly smaller; the index trade-off favors it too (the hot read path checks "is this jti revoked?" on every verify; the answer is overwhelmingly "no" → bloom-filter-friendly).
- **Per-connection cache via the existing `WsConnectionContext.user`.** F-006's suggested fix names this explicitly: "the lookup is O(log N) on an indexed UUID and runs once per connection if you cache on the WsConnectionContext." The existing per-connection cache of `AuthUser` already realizes the optimization; the denylist consult lives in `authenticateRequest`, which the WS gate calls once at upgrade. The cache invariant: the cache is valid until the connection terminates; revocation triggers `closeUserConnections` which terminates the connection. There is no "stale cache after revoke" window because revoking AND closing are the same logical operation, sequenced denylist-write-first to close any reconnect race.
- **HTTP path pays the consult per request.** No HTTP-layer cache. Rationale: HTTP requests are infrequent compared to WS messages, and adding an HTTP-side cache would require a TTL and an invalidation strategy that doesn't exist for the WS case (closing the connection is the WS invalidation; HTTP has no connection-shaped lifetime to attach a cache to). The per-request cost is one indexed-UUID-lookup — well within a single-digit ms.
- **Sweeper cadence 60 minutes, not 60 seconds.** The flow-state sweeper runs every 60 seconds because flow-state entries are short-lived (5 minutes) and the map is in-process — a slow sweep risks unbounded growth. The denylist is on Postgres with an `expires_at` index; rows being present past their expiry has zero correctness impact (the `expires_at` check is in the periodic DELETE; the verifier doesn't care because the JWT itself is rejected by `exp` at that point — the denylist consult on an expired token never runs in practice). The slower cadence saves DB cycles. The cadence is env-tunable for tests.
- **Sweeper runs lazily, on first authenticated route.** Mirrors `getDefaultFlowStateStore`'s lazy construction. A server boot that never authenticates (rare; CI smoke tests of the bootstrap) doesn't arm the timer. The timer is `.unref()`'d so graceful shutdown isn't blocked.
- **Logout with invalid cookie is a 204 no-op (no denylist write).** A logout endpoint that rejects invalid cookies with 401 is a footgun: from the user's perspective they "are" logged out; the response should reflect that. Writing a denylist row on an unverified cookie would also be unsafe (the row's `(jti, expires_at)` would be attacker-supplied if the cookie is forged). The conditional write is "verified → write; unverified → cookie-clear only."
- **`closeUserConnections` is dependency-injected via plugin options, not statically imported.** `auth/routes.ts` already accepts a sizable options bag; passing `closeUserConnectionsHook: closeUserConnections` from `server.ts` keeps the static dependency graph simple (no `auth/ → ws/` import edge) and lets tests inject a spy. The hook signature mirrors the helper's: `(userId: string, reason?: string) => number`.
- **Denylist write uses `ON CONFLICT (jti) DO NOTHING`.** A double-logout (two POSTs with the same cookie) MUST be idempotent — the second POST sees the denylist row already exists; instead of throwing a unique-violation, the INSERT is silently skipped. The PK collision is the wrong signal for "you already logged out"; idempotency is the right surface.
- **Cache invariant documented in the verifier docblock + the WS upgrade docblock.** A maintainer landing a future change to `verifySessionToken` or to the WS gate needs the invariant in the same place they're reading the code; the refinement document alone is too easy to miss.
- **The `logout_no_revocation_pin` test is INVERTED, not deleted.** The same describe block is renamed (drop "— known trade-off"); the same `it(...)` is rewritten to expect 401 + drop the post-replay body equality assertions. The test's leading comment is updated to reflect that the trade-off is now closed. Auditors who `grep -r "G-005"` still land on the same test; the audit trail is preserved.
- **No production caller of `addToDenylist` outside `POST /auth/logout` in v1.** A future "admin force-logout user" endpoint would be a second trigger; a future "password reset" might also be one. The helper is parameterized on `(jti, userId, expiresAtMs)` so any future trigger can reuse it without re-deriving the JWT.
- **JWT payload-shape audit relaxed to allow `jti`** (added to `allowedKeys`). Other unknown claims still cause rejection — the audit's defense-in-depth against forged elevated-privilege claims is preserved.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- [`apps/server/migrations/0011_auth_token_denylist.sql`](../../../apps/server/migrations/0011_auth_token_denylist.sql) — forward-only migration creating `auth_token_denylist (jti UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)` plus the `auth_token_denylist_expires_at_idx` index for the periodic sweeper's range scan.
- [`apps/server/src/auth/token-denylist.ts`](../../../apps/server/src/auth/token-denylist.ts) — new module owning `addToDenylist`, `isJtiRevoked`, `sweepExpiredDenylistRows`, `startDenylistSweeper`, and the lazy `getDefaultDenylistSweeper` singleton. Mirrors the `flow-state.ts` sweeper shape; cadence env-tunable via `AUTH_DENYLIST_SWEEP_INTERVAL_MS` (default 60 minutes). Timer is `.unref()`'d.
- [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) — `signSessionToken` now mints a v4 UUID `jti` per sign (via `crypto.randomUUID()` by default; tests inject a deterministic generator). `verifySessionToken` requires `jti` on the payload-shape audit and returns it on the resolved payload. `SessionTokenPayload` adds `readonly jti: string`.
- [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — `authenticateRequest` consults `isJtiRevoked(payload.jti, pool)` AFTER JWT verify and BEFORE the user-row lookup. A revoked `jti` returns `null`, which the middleware collapses to the existing `auth-required` 401 envelope.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — `POST /auth/logout` now: reads the cookie → verifies the JWT (best-effort; missing/invalid cookie stays a 204 cookie-clear no-op) → writes `(jti, user_id, expires_at)` to the denylist via `addToDenylist` → calls the new optional `closeUserConnectionsHook(userId, 'auth-revoked')` to propagate revocation onto open WS connections. Order is denylist-write-first so a concurrent reconnect after the close still fails at the upgrade gate.
- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — wires `closeUserConnectionsHook: closeUserConnections` from `ws/connection.ts` into the `authRoutesPlugin` options. Arms the default denylist sweeper via `getDefaultDenylistSweeper(getDefaultPool())` (wrapped in a try/catch so a `DATABASE_URL`-less boot doesn't tear down the server). The static auth→ws import edge is acceptable at the composition root.
- [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) — barrel exports the denylist surface (`addToDenylist`, `isJtiRevoked`, `sweepExpiredDenylistRows`, `startDenylistSweeper`, `getDefaultDenylistSweeper`, the env constants, the test reset helper, and the `DenylistRow` / `DenylistSweeperHandle` types).

Test artifacts:

- [`apps/server/src/auth/token-denylist.test.ts`](../../../apps/server/src/auth/token-denylist.test.ts) (new) — 14 cases pinning `addToDenylist` / `isJtiRevoked` / `sweepExpiredDenylistRows` / `startDenylistSweeper` / `resolveDenylistSweepIntervalMs` against an in-memory pool that recognises the three SQL shapes (INSERT, SELECT 1 ... WHERE jti, DELETE ... WHERE expires_at).
- [`apps/server/src/auth/logout-revocation.test.ts`](../../../apps/server/src/auth/logout-revocation.test.ts) (new) — 8 cases pinning the full chain: denylist row keyed by the cookie's `jti`, hook invocation with `(userId, 'auth-revoked')`, concurrent sessions (revoke one, the other still verifies), no-cookie 204 no-op, invalid-cookie 204 no-op, expired-cookie 204 no-op, order invariant (denylist commits BEFORE hook fires), double-logout idempotency.
- [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) — INVERTED the `logout_no_revocation_pin` describe block: now `describe('POST /auth/logout — server-side revocation via jti + denylist (G-005)', ...)` (dropped the "— known trade-off" suffix). The `it(...)` now expects 401 on the post-logout replay and asserts the `auth-required` envelope code; the prior body equality assertions are gone (the 401 envelope has no `userId` / `screenName`). The leading block comment was rewritten to record the inversion + the source findings now closed.
- [`apps/server/src/ws/user-soft-delete.test.ts`](../../../apps/server/src/ws/user-soft-delete.test.ts) — added a `describe('jwt_revocation_jti_denylist — closeUserConnections WS-side propagation', ...)` block with one `it(...)` exercising the close-call half of the chain (open WS, call `closeUserConnections(userId, 'auth-revoked')`, observe code 4401 + reason 'auth-revoked' on the wire).
- [`apps/server/src/auth/no-profile-data.test.ts`](../../../apps/server/src/auth/no-profile-data.test.ts) — Invariant 5 updated from "exactly `{ sub, iat, exp }`" to "exactly `{ sub, iat, exp, jti }`" with the v4 UUID shape pin. The no-profile-data invariant still holds — `jti` is a cryptographic identifier, not profile data.
- All affected memory-pool fixtures in 17 other test files now recognise the `SELECT 1 FROM auth_token_denylist WHERE jti = $1` query (return empty rows by default = "no jti revoked"), so the auth middleware's denylist consult flows through unchanged in scenarios that don't exercise revocation.

`tasks/25-backend-hardening.tji`: `complete 100` set on `jwt_revocation_jti_denylist`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: `2034 → 2057` (+23 net new tests: 14 `token-denylist`, 8 `logout-revocation`, 1 `user-soft-delete` propagation, plus the inverted G-005 pin is the same `it(...)` slot). `pnpm run check` clean. `pnpm run test:smoke` green.

**Cache approach.** Per the refinement's Decisions: no HTTP-layer cache (the per-request consult is a single indexed-UUID lookup, well within single-digit ms). The WS path's per-connection `AuthUser` cache already realizes F-006's "cache on the WsConnectionContext" recommendation — the denylist consult fires ONCE at upgrade, and revocation propagation onto an open connection runs via `closeUserConnections`, which terminates the connection (closing IS the cache invalidation).

**WS propagation hook shape.** `closeUserConnectionsHook?: (userId: string, reason?: string) => number` on `AuthRoutesOptions`. Production wires `closeUserConnections` from `ws/connection.ts` at the composition root (`server.ts`); tests pass a `vi.fn()` spy to assert invocation. The hook is optional — a test scenario that exercises only the denylist write skips it.
