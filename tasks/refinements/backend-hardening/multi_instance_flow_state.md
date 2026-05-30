# `backend_hardening.auth_hardening.multi_instance_flow_state`

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.multi_instance_flow_state`.

**Effort**: 2d.

**Inherited dependencies**: `backend.auth.oauth_callback_handler` (settled — introduced the server-side one-shot OIDC state seam in `apps/server/src/auth/flow-state.ts` and its route wiring in `apps/server/src/auth/routes.ts`); `backend_hardening.resource_limits_and_dos.flow_state_map_bound` (settled — established `MAX_FLOW_STATE_ENTRIES`, `FLOW_STATE_MAX_ENTRIES`, eager expiry cleanup at the capacity boundary, and the typed `FlowStateCapacityError` → HTTP 503 contract); ADR 0020 (settled — forward-only SQL migrations via `node-pg-migrate`); ADR 0035 (settled by this refinement — production transient OIDC flow state is Postgres-backed, while the in-memory store remains an injected test double).

## What this task is

Replace the production default process-local OIDC flow-state store with a Postgres-backed implementation. Preserve the existing `FlowStateStore` seam so route tests can continue injecting the deterministic in-memory store, but make the production path durable across app restarts and shared across horizontally-scaled app instances.

## Why it needs to be done

The M3 security review identified that a login started on one app instance fails with `auth-state-invalid` if the callback reaches another instance, and that a process restart discards every in-flight login. The state record cannot move into a signed browser cookie: it contains the nonce and PKCE verifier and must stay confidential server-side. A Postgres table reuses the service dependency already present for user and session data while retaining one-shot callback consumption.

## Inputs / context

- [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md#L43-L47) — F-005 describes the multi-instance/restart failure and rejects a signed-cookie workaround.
- [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts#L95-L124) — existing injectable `FlowStateStore` seam.
- [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts#L255-L297) — current map implementation and cap-boundary eager sweep semantics.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts#L435-L438) — production-default store selection.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts#L523-L548) — login `put(...)` and typed capacity-error mapping.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts#L617-L624) — callback one-shot `take(...)` rejection path.
- [`apps/server/src/db.ts`](../../../apps/server/src/db.ts#L48-L57) — existing injectable `DbPool` query seam.
- [`docs/adr/0020-migrations-node-pg-migrate-forward-only.md`](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md) — migration convention.
- [`docs/adr/0035-postgres-backed-oidc-flow-state.md`](../../../docs/adr/0035-postgres-backed-oidc-flow-state.md) — architectural decision for the backing store.

## Constraints / requirements

- Keep nonce and PKCE verifier server-side; do not introduce client-side flow-state cookies.
- Add a forward-only migration for an `auth_flow_state` table keyed by `state`, with nonce, verifier, and expiry fields plus an expiry index.
- Add a Postgres-backed `FlowStateStore`; the production default uses it through the existing lazy `DbPool` path.
- Preserve the injected in-memory `createFlowStateStore(...)` test double and its synchronous ergonomics.
- Allow asynchronous store methods so Postgres I/O can be awaited by `/api/auth/login` and `/api/auth/callback` without weakening injected tests.
- Preserve one-shot consumption atomically across instances with `DELETE ... RETURNING`.
- Preserve the hard-cap behavior and generic `FlowStateCapacityError`; serialize capacity-edge writes across instances and never echo the configured cap on the wire.
- Keep periodic expiry cleanup non-fatal and `.unref()` its timer.

## Acceptance criteria

Per ADR 0022, land durable Vitest coverage rather than a throwaway verification:

1. A new migration creates `auth_flow_state` with a primary-key `state`, confidential nonce/verifier fields, expiry timestamp, and expiry index.
2. A Postgres-backed store inserts records, atomically consumes a record once, rejects expired consumed records, reports size, and sweeps expired records.
3. Two separately-created Postgres-backed store objects sharing one DB seam demonstrate the multi-instance flow: store A writes state, store B consumes it, and the second consume misses.
4. The Postgres-backed capacity path preserves `FlowStateCapacityError`, performs expiry cleanup at the insert boundary, and uses a cross-instance serialization primitive.
5. Route login and callback handlers await store I/O while existing injected in-memory route coverage remains green.
6. `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, and `make test:e2e:compose` pass.

## Decisions

- **Use Postgres, not Redis or a signed cookie.** Postgres is already mandatory production infrastructure and already has migrations. Redis would add an operational dependency solely for short-lived records. A signed cookie would keep integrity but expose nonce and PKCE verifier material to the browser, violating the server-side confidentiality boundary called out by F-005. ADR 0035 records this security-relevant architectural choice.
- **Keep the map implementation as the test double, but switch only the production default.** Existing route tests benefit from controllable clocks and synchronous assertions. Replacing the test double would add DB-fixture cost without improving production behavior.
- **Make the store interface awaitable instead of forcing every implementation async.** Route handlers can `await` both plain values and promises. The Postgres implementation performs real I/O; the injected map remains lightweight and source-compatible with existing tests.
- **Consume with atomic `DELETE ... RETURNING`.** A SELECT followed by DELETE introduces a replay race between instances. A single destructive read guarantees only one callback receives a record.
- **Serialize capacity-edge inserts with a Postgres advisory transaction lock in the insert statement.** An unlocked COUNT + INSERT can exceed the global cap when instances race. The advisory lock is scoped to the statement transaction and avoids a separate transaction-client abstraction.
- **Keep expiry cleanup lazy plus periodic.** Callback consumption rejects expired records even before the sweeper runs. The periodic sweep controls abandoned-row growth, while capacity-edge insertion eagerly clears expired rows before rejecting a fresh login.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-30.

- Added [`docs/adr/0035-postgres-backed-oidc-flow-state.md`](../../../docs/adr/0035-postgres-backed-oidc-flow-state.md), recording the Postgres-backed production-store decision and rejection of a client-side signed-cookie workaround.
- Added [`apps/server/migrations/0015_auth_flow_state.sql`](../../../apps/server/migrations/0015_auth_flow_state.sql), creating the shared transient `auth_flow_state` table and expiry index.
- Extended [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) with a Postgres-backed `FlowStateStore`: atomic `DELETE ... RETURNING` consumption, advisory-lock-serialized capacity enforcement, eager/periodic expiry cleanup, lazy default-pool binding, and the retained deterministic in-memory test double.
- Updated [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) so login and callback await flow-state I/O; production uses the Postgres singleton while injected-pool tests retain an isolated in-memory default unless they explicitly inject another store.
- Re-exported the new store surface through [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts).
- Added durable Vitest coverage in [`apps/server/src/auth/flow.test.ts`](../../../apps/server/src/auth/flow.test.ts) for cross-instance write/consume, one-shot replay rejection, expired-row hygiene, advisory-lock SQL, and the typed capacity error.
