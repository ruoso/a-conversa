# `backend_hardening.subscription_lifecycle.user_soft_delete_ws_close`

**Source**: [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-003.
**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.subscription_lifecycle.user_soft_delete_ws_close`.
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.websocket_protocol.ws_connection_handling` — settled (the
  module-scoped `openConnections: Set<WsConnectionContext>` registry,
  `WS_CLOSE_CODES` constant convention, the `socket.close(code, reason)`
  shutdown idiom).
- `backend.websocket_protocol.ws_auth_on_connect` — settled
  (`authenticateRequest` pulls double duty as the HTTP middleware and
  the WS preValidation gate; the SELECT already filters
  `WHERE id = $1 AND deleted_at IS NULL`).
- `backend.websocket_protocol.ws_subscribe_to_session` — settled
  (`WsSubscriptionRegistry.removeConnection(connectionId)` is the
  primitive the close hook already calls on disconnect, so a
  helper-initiated close runs the same cleanup path).

## What this task is

Today the WS upgrade's auth gate calls `authenticateRequest` exactly
once. The returned `AuthUser` is captured on the per-connection
`WsConnectionContext.user`; nothing on the server re-validates the user
row across the connection's lifetime. If an admin (or a future
self-delete endpoint) soft-deletes the row via
`UPDATE users SET deleted_at = NOW() WHERE id = $1`, the still-open WS
keeps proposing, voting, committing, and meta-disagreement-marking with
`actor = <deleted user id>` until the cookie's 7-day `exp` ticks past.

This task lands the **structural primitive** the future
admin-delete-user surface will trigger: a helper
`closeUserConnections(userId, reason?)` that walks every WS connection
owned by that user id and calls `socket.close(4401, reason)` on each.
The same connection-close path the disconnect handler already owns
(remove from `openConnections`, drop subscriptions, unregister sender,
clear catch-up rate state) runs synchronously when the socket
transitions to closing; any pending in-flight dispatch attempting a
later `socket.send(...)` will fail loudly via the dispatcher's existing
send-error path.

The helper needs an index — walking the whole `openConnections` set
for every soft-delete is fine at v1 volumes but is O(N_connections) per
revocation. A `connectionsByUser: Map<string, Set<WsConnectionContext>>`
sibling registry on the connection module gives O(1) lookup at the
cost of one Map.get + one Set.add per open + one Set.delete per close,
all O(1).

**Out of scope (deliberately deferred).** No admin "delete user"
endpoint exists in v1. The trigger surface — be it an HTTP route, a
CLI tool, or a future self-delete flow — is the responsibility of the
follow-up `admin_user_delete` task (not yet in the WBS). What this
task lands is the helper + the index + the tests that prove the helper
works in isolation; the wire-up to a real trigger happens later. The
Decisions section documents that scoping choice explicitly so a future
reviewer doesn't mistake the missing trigger for an oversight.

## Why it needs to be done

[`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md)
G-003 documents the gap:

> The WS auth gate runs ONCE at upgrade; `connection.user` is captured
> for the connection's lifetime. There is NO post-auth refresh, NO
> per-message user-still-exists check, and NO test for the path "user
> soft-deleted via `users.deleted_at` while their WS connection is
> open." The dispatcher handlers all use `connection.user.id` for
> `actor` / `requester` on propose/vote/commit/meta-disagreement
> without re-validating the user row.

The damage is two-fold:

1. **Authority survival.** A user who has just been removed from the
   system (e.g. a moderator deleting an abusive participant)
   keeps writing to the event log under their pre-delete identity for
   up to seven days. The data-model invariants on `actor` /
   `requester` columns assume the referenced user is live; a
   soft-deleted ghost violates that contract from the auditor's
   point of view.
2. **No closure signal.** Other participants observing the session
   have no way to learn that the misbehaving user has been removed —
   they keep seeing the user's proposals and votes until the next
   reconnect cycle.

The structural fix is to revoke the WS at the same moment the row is
soft-deleted. A pull-based per-message recheck (Option B in the brief)
adds one DB round-trip per envelope and reads the same row that the
upgrade-time gate already verified; the rate scales with the inbound
message rate, which is the wrong dimension. The push-based fix
(Option A) costs one O(1) registry write per connection open / close
and zero per inbound message — the dimension that matches the actual
event rate (a user is soft-deleted once, ever).

## Inputs / context

From `apps/server/src/ws/connection.ts`:

```ts
// Module-scoped — populated by buildConnectionHandler on open,
// drained by the `close` socket event and the `preClose` shutdown hook.
const openConnections = new Set<WsConnectionContext>();
```

```ts
export const WS_CLOSE_CODES = {
  GOING_AWAY: 1001,
  INTERNAL_ERROR: 1011,
} as const;
```

From `apps/server/src/auth/middleware.ts`:

```ts
const result = await pool.query<UsersAuthRow>(
  `SELECT id, screen_name
   FROM users
   WHERE id = $1 AND deleted_at IS NULL`,
  [payload.sub],
);
```

So the upgrade-time gate is already correct: a cookie minted before
soft-delete will fail `authenticateRequest` on the NEXT upgrade attempt
(the SELECT returns zero rows; `authUser === null` → 401). The gap is
purely the lifetime of the connection that was opened BEFORE the
soft-delete.

From `apps/server/src/ws/subscriptions.ts` — the registry has
`removeConnection(connectionId)` already, called from the socket's
`close` handler. A helper-initiated close runs the same path because
the `close` event fires once the socket transitions to closing.

## Constraints / requirements

- **Per-user index lives in `connection.ts`**, alongside the existing
  `openConnections` set. Reason: `closeUserConnections` needs to call
  `socket.close(...)` on the underlying WS, which is on the
  `WsConnectionContext`; the connection module is the natural home for
  the index. Putting it on `WsSubscriptionRegistry` would conflate two
  concerns (subscriptions vs. authentication-state) AND would
  require a back-reference from connectionId to the socket that the
  registry doesn't carry today.
- **Index shape**: `Map<userId, Set<WsConnectionContext>>`. The
  `WsConnectionContext` already carries `connectionId`, `socket`, and
  `user`; the Map values are the contexts (not just ids) so the
  helper can iterate sockets directly without a second lookup. Empty
  Sets are pruned (`Map.delete` when the set becomes empty) so the
  Map size matches the count of distinct user ids with at least one
  open connection.
- **Helper signature**:
  ```ts
  export function closeUserConnections(
    userId: string,
    reason?: string,
  ): number;
  ```
  Returns the count of connections closed (0 when nothing matches).
  Counted via the snapshot taken before the close loop iterates, so
  the return is stable regardless of mid-iteration mutations from
  re-entrant close handlers.
- **Close code = 4401 (auth-revoked)**. The IANA WebSocket close-code
  registry reserves the 4000–4999 range for application use. The
  number 4401 mirrors the HTTP 401 the upgrade gate would emit on a
  fresh upgrade attempt — a client reading the close code can map it
  directly to "your session is no longer valid; re-authenticate".
  This is a deliberate departure from the connection-module comment
  that says inventing a custom 4xxx close code at upgrade-time is
  unjustified: at upgrade-time the HTTP 401 envelope is the right
  surface; AFTER upgrade, no HTTP response surface exists, so a
  structured 4xxx is the only signal the client can read. The
  4xxx-codes-for-auth-revocation convention is the de-facto industry
  default (e.g. RFC 6455 doesn't define one, but the major WS-aware
  clients — wscat, browser dev-tools, Postman — display the numeric
  close code prominently).
- **Reason string**: `'auth-revoked'` is the default; callers may
  override (e.g. a future "you have been banned" surface might pass
  `'banned'`). Limited to ASCII and ≤ 123 bytes (the WS close-frame
  reason limit per RFC 6455 §5.5.1). The helper truncates to 123
  bytes defensively rather than throwing, so a misconfigured caller
  doesn't crash the server.
- **Per-connection error isolation in the close loop.** Each
  `socket.close(...)` call is wrapped in a try/catch — one
  already-torn-down socket throwing must not prevent the helper from
  closing the other connections that share the same userId. Mirrors
  the `wsShutdownPreClose` pattern.
- **The index is maintained at open + close.** The open path's
  `openConnections.add(ctx)` grows by an `addToConnectionsByUser(ctx)`
  call; the close path's `openConnections.delete(ctx)` grows by a
  `removeFromConnectionsByUser(ctx)` call. Both helpers are
  module-private; the public surface is `closeUserConnections` only.
- **`preClose` shutdown clears the per-user index too**, so a process
  restart leaves the registry empty. Mirrors
  `openConnections.clear()` in `wsShutdownPreClose`.
- **No DB query on the helper call.** The helper trusts its caller
  (the future admin-delete-user surface) to have already performed
  the `UPDATE users SET deleted_at = NOW()`. The helper's job is
  purely to revoke the WS surface; consulting the DB again would
  duplicate the trigger surface's authority and add a race window
  ("user gets re-undeleted between the trigger and the WS close").
- **Logging.** Each close emits an info-level line carrying
  `userId`, `connectionId`, `reason`. Same logging surface as the
  open / close lifecycle lines so an operator can grep the same key.
  The helper's outer call emits one info-level summary line carrying
  `userId` + `closed` count.
- **Per ADR 0022**: every helper-behavior assertion lands as a
  committed Vitest test. No throwaway probes.

## Acceptance criteria

- `WS_AUTH_REVOKED_CLOSE_CODE = 4401` exported from
  `apps/server/src/ws/connection.ts` (alongside `WS_CLOSE_CODES`).
- `WS_AUTH_REVOKED_REASON = 'auth-revoked'` exported alongside.
- `closeUserConnections(userId: string, reason?: string): number`
  exported from the same module; re-exported through
  `apps/server/src/ws/index.ts` so cross-module callers reach for one
  path.
- A module-private `connectionsByUser: Map<string, Set<WsConnectionContext>>`
  index lives alongside `openConnections`. The open / close paths
  maintain it; `wsShutdownPreClose` clears it.
- Calling `closeUserConnections(userId)` closes every open WS owned
  by that user with code 4401 and reason `'auth-revoked'`; returns
  the count closed.
- The wire-side close on the affected client carries code 4401 and
  reason `'auth-revoked'`.
- The connection's `close` handler runs (subscriptions dropped,
  catch-up rate state cleared, sender unregistered, `openConnections`
  emptied for that context, `connectionsByUser` set pruned).
- Other users' open connections are untouched.
- A fresh WS upgrade attempt for the same (now-soft-deleted) user is
  still rejected at the auth gate with HTTP 401 (regression — the
  upgrade-time SELECT's `deleted_at IS NULL` clause was already
  correct).
- New Vitest tests in `apps/server/src/ws/user-soft-delete.test.ts`:
  1. Helper closes the open WS with code 4401 + reason
     `'auth-revoked'`; the subscription registry is empty for that
     connection afterward; the `openConnections` inspector reports
     the connection gone.
  2. Helper-initiated close does NOT affect a second open WS for a
     different (still-live) user.
  3. New upgrade for the soft-deleted user is rejected with HTTP 401
     by the auth gate (regression pin).
  4. Helper called for a user with no open connections is a no-op,
     returns 0.
  5. Helper closes multiple connections owned by the same user
     (e.g. two browser tabs) — both are closed.
- `pnpm run check` and `pnpm run test:smoke` pass.
- `complete 100` added to the `user_soft_delete_ws_close` task entry
  in `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1 |
  grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **Push (Option A), not pull (Option B).** Per-message DB rechecks
  scale with the inbound rate; the helper scales with the
  revocation rate. The latter is the right dimension — a user is
  soft-deleted at most a handful of times per system-lifetime; a
  busy session emits hundreds of envelopes per minute.
- **Per-user index on the connection module, not on
  `WsSubscriptionRegistry`.** The helper needs to call
  `socket.close(...)`; the connection module owns the socket; the
  subscription registry tracks `connectionId` strings only (no
  back-reference to the context). Putting the index on the
  connection module keeps the two concerns separate.
- **Close code 4401 (application-defined "auth revoked").** The
  WebSocket spec reserves 4000–4999 for application use; 4401
  numerically echoes the HTTP 401 equivalent so a client can map
  the close code to "your session is invalid; sign in again" without
  needing a custom vocabulary. The connection.ts comment that
  rejects custom 4xxx codes at upgrade-time does NOT apply here:
  AFTER upgrade, no HTTP surface is reachable, so a numeric close
  code is the only signal.
- **Reason string `'auth-revoked'`, not `'user-deleted'`.** The
  close-code carries the "what" (auth state revoked); the reason
  carries the "why category." `'auth-revoked'` is the broader
  semantic that future surfaces (e.g. session-token rotation, ban,
  password reset) can reuse without a wire-shape change. The
  caller can override the reason if a more specific phrasing is
  needed.
- **No DB query inside the helper.** The trigger surface (the
  caller) is authoritative about whether the user should be
  revoked. Re-querying inside the helper would add latency, fork
  the source of truth, and open a race window. The helper is a
  pure socket-state operation.
- **The trigger surface (admin-delete-user) is OUT OF SCOPE.** This
  task lands the structural primitive; the future
  `admin_user_delete` task (or a self-delete endpoint) will wire it.
  Documented explicitly so a reviewer reading the M3-review batch
  doesn't mistake the missing HTTP route for an oversight.
- **The helper closes the socket; it does NOT mutate per-handler
  state.** Pending in-flight dispatches (a `propose` mid-DB-write,
  for example) are NOT proactively aborted. The DB transaction
  completes; the dispatcher's send path discovers the closed socket
  on the next `socket.send(...)` attempt and logs the failure via
  its existing send-error seam. This matches the broader project
  invariant that the WS layer is a transport, not a transaction
  manager — the methodology engine + DB transactions own their own
  atomicity.
- **`socket.close()` PLUS `socket.terminate()`.** The naïve call to
  `socket.close(code, reason)` writes the close frame on the wire
  (the client receives `4401 / 'auth-revoked'`) but the underlying
  `ws` library then waits up to `closeTimeout` (30s default) for the
  client's close echo before firing the server-side `close` event.
  A misbehaving (or slow-to-echo) attacker's client must not leave a
  stale entry in `connectionsByUser` / `openConnections` for 30
  seconds, AND a revocation must not depend on the attacker
  cooperating with the close handshake. Calling `socket.terminate()`
  immediately after `socket.close(code, reason)` forces the
  server-side close event to fire synchronously — the close frame
  has already been queued on the wire so the client still observes
  the 4401 code; only the close-handshake echo path is bypassed.
  Pattern is closely analogous to `wsShutdownPreClose`'s eagerness
  about flushing `openConnections.clear()` regardless of whether the
  per-connection `close` event has been observed.
- **Counted return value.** A caller (e.g. an admin UI) needs to
  display "closed N sessions" feedback; the count is cheap to
  compute (length of the snapshot array) and informative. The
  alternative (`void` return) would force callers to consult the
  log or the inspector to know whether the call did anything.
- **Reason byte-cap is enforced via truncation, not rejection.** A
  caller that passes a longer string still gets the desired
  semantic (the connections are closed); the WS frame's reason field
  carries the first 123 bytes. Throwing for too-long inputs would
  let a misconfigured caller block a security-critical operation,
  which is the wrong failure mode.
- **Tests live in a new file, `user-soft-delete.test.ts`.** The
  surface is distinct from the auth-gate tests (which exercise the
  upgrade-time gate) and from the lifecycle tests (which exercise
  generic open / close paths). A dedicated file keeps the helper's
  contract visible to future readers and to a future
  `admin_user_delete` task that may extend the suite. Mirrors the
  per-task test-file convention used elsewhere (e.g.
  `origin-allowlist.test.ts`, `protocol-docs.test.ts`).

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — added the
    `WS_AUTH_REVOKED_CLOSE_CODE = 4401` and `WS_AUTH_REVOKED_REASON =
    'auth-revoked'` constants, the module-scoped
    `connectionsByUser: Map<string, Set<WsConnectionContext>>` index,
    the `addToConnectionsByUser` / `removeFromConnectionsByUser`
    private helpers, the public
    `closeUserConnections(userId, reason?): number` helper, and the
    `__getConnectionsByUserSizeForTests()` inspector. The connection
    open + close paths now maintain the per-user index alongside the
    existing `openConnections` set; the shutdown `preClose` hook
    clears both. The reason string is truncated to 123 bytes
    (RFC 6455 §5.5.1) before reaching `socket.close(...)`.
  - [`apps/server/src/ws/index.ts`](../../../apps/server/src/ws/index.ts) — re-exports
    `closeUserConnections`, `WS_AUTH_REVOKED_CLOSE_CODE`, and
    `WS_AUTH_REVOKED_REASON` alongside the existing
    `WS_CLOSE_CODES` export so the future admin-delete-user surface
    reaches for one path.

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/ws/user-soft-delete.test.ts`](../../../apps/server/src/ws/user-soft-delete.test.ts) — new file, 6 cases:
    1. The constants `WS_AUTH_REVOKED_CLOSE_CODE` (= 4401) and
       `WS_AUTH_REVOKED_REASON` (= `'auth-revoked'`) export the
       application-defined values for the soft-delete close.
    2. `closeUserConnections` closes the open WS with the typed
       4401 close code + `'auth-revoked'` reason; the connection is
       gone from `openConnections`; the subscription registry is
       empty for that connection; the helper returns 1.
    3. Helper-initiated close does NOT affect a second open WS for a
       different (still-live) user (the second connection's
       subscriptions stay live, no close frame).
    4. After a soft-delete (via direct DB UPDATE pre-task), a new WS
       upgrade attempt for the same user is rejected at the auth gate
       with HTTP 401 (regression pin — `authenticateRequest` already
       filters `deleted_at IS NULL`).
    5. Helper called for a user with no open connections is a no-op;
       returns 0.
    6. Helper closes multiple connections owned by the same user
       (two distinct WS clients, same JWT) — both are closed; the
       helper returns 2.

- `tasks/25-backend-hardening.tji` — `complete 100` added to the
  `user_soft_delete_ws_close` task entry under
  `subscription_lifecycle`. `tj3 project.tjp 2>&1 |
  grep -iE "error|fatal"` silent.

Test count delta: **+6 Vitest cases** (`user-soft-delete.test.ts`:
+6). `pnpm run check` and `pnpm run test:smoke` both green (1754
tests across 88 files; the existing 1748 tests across 87 files all
stay green — the new helper + per-user index are purely additive).

**Scoping reminder (load-bearing).** v1 ships the helper +
infrastructure only. No trigger surface (admin-delete-user endpoint,
self-delete flow) is wired in this commit; the helper currently has
no production caller. The future `admin_user_delete` task will wire
the trigger; this task's tests exercise the helper directly to
verify the structural primitive works in isolation.
