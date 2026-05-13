# `backend_hardening.resource_limits_and_dos.subscription_cap_per_connection`

**Source**: [`docs/security/m3-review/inputs.md`](../../../docs/security/m3-review/inputs.md) F-001.
**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.subscription_cap_per_connection`.
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `backend.websocket_protocol.ws_subscribe_to_session` — settled (`WsSubscriptionRegistry` bidirectional map, `subscribe` handler with visibility gate, `error` envelope wiring via `sendWsError`).
- `backend.websocket_protocol.ws_error_message` — settled (`error` envelope shape + `WS_*_CODE` constant convention).
- Sibling `fastify_body_limit` / `user_text_length_caps` — settled (per-frame + per-field caps that close other DoS vectors; this task closes the per-connection fan-out vector).

## What this task is

Cap how many sessions a single authenticated WS connection can hold
in its subscription set. Before this task, the `subscribe` handler
called `WsSubscriptionRegistry.subscribe(...)` unconditionally after
the visibility gate cleared; a logged-in client could subscribe to
every public session in the database and force per-event broadcasts
to fan out to all of them.

The fix is a hard ceiling on `byConnection.get(connectionId).size`:

1. `MAX_SUBSCRIPTIONS_PER_CONNECTION = 32` is the default cap, exported
   from `apps/server/src/ws/subscriptions.ts`. Env override via
   `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`.
2. A `resolveMaxSubscriptionsPerConnection(env)` helper mirrors
   `resolveBodyLimit` / `resolveCatchUpMaxEvents` / `resolveFlowStateMaxEntries`
   — env-driven on the production path, option-injected on the test
   path (no `process.env` mutation in tests).
3. `WsSubscriptionRegistry`'s constructor accepts an optional
   `{ maxSubscriptionsPerConnection }` override; the
   `wsSubscriptionsPlugin` resolves the env value and threads it
   through (production), or accepts a plugin option that the
   connection-handling plugin threads through (tests).
4. `subscribe(connectionId, sessionId)` checks
   `byConnection.get(connectionId).size >= cap` BEFORE recording the
   new tuple:
   - At cap AND `sessionId` already in the set: idempotent no-op
     (re-subscribing must NOT be artificially blocked by the cap).
   - At cap AND `sessionId` is new: throws a typed
     `SubscriptionCapacityError`.
5. The `subscribe` handler catches `SubscriptionCapacityError` and
   emits the canonical `error` envelope with
   `code: 'too-many-subscriptions'` (new constant
   `WS_TOO_MANY_SUBSCRIPTIONS_CODE` exported from
   `error-envelope.ts`). The connection stays open — per-frame
   failures are recoverable.

## Why it needs to be done

[`docs/security/m3-review/inputs.md`](../../../docs/security/m3-review/inputs.md)
F-001 documents the surface:

> `subscribe` only checks visibility (`canSeeSession`) and then
> unconditionally `registry.subscribe(connectionId, sessionId)`. There
> is no per-connection ceiling on the size of
> `byConnection.get(connectionId)`. A logged-in client can subscribe to
> every public session in the database; each subscribe issues exactly
> one parameterized `SELECT 1 FROM sessions ...` round-trip but the
> connection's memory + the per-event broadcast fan-out cost both scale
> linearly with that set.

The impact is a credible bandwidth-amplification + memory-pressure
DoS surface: a single authenticated client subscribed to thousands of
sessions receives a copy of every `event-applied` / `diagnostic` /
`proposal-status` envelope for every public session. Combined with no
max-connections-per-user cap (a separate task), an attacker holding
50 connections each subscribed to thousands of sessions can amplify
any high-frequency session into per-attacker bandwidth.

The structural fix is the cap. The chosen value (32) is generous on
purpose: a senior moderator legitimately watching 4-8 parallel
breakout debates is well below 32; no UX flow known to the project
needs hundreds of subscriptions per connection. Operators with
unforeseen legitimate use cases can lift the cap via the env var
without a code change.

## Inputs / context

From `apps/server/src/ws/subscriptions.ts` (pre-task):

```ts
subscribe(connectionId: string, sessionId: string): void {
  // No cap check — unconditionally adds to both indices.
  let conns = this.bySession.get(sessionId);
  if (conns === undefined) {
    conns = new Set();
    this.bySession.set(sessionId, conns);
  }
  conns.add(connectionId);
  let sessions = this.byConnection.get(connectionId);
  if (sessions === undefined) {
    sessions = new Set();
    this.byConnection.set(connectionId, sessions);
  }
  sessions.add(sessionId);
}
```

From `apps/server/src/ws/error-envelope.ts`: `sendWsError` accepts a
sender closure + `{ code, message, inResponseTo? }`. The
`WS_UNKNOWN_MESSAGE_TYPE_CODE` and `WS_MALFORMED_ENVELOPE_CODE`
constants are the existing WS-specific transport-level discriminators;
`too-many-subscriptions` joins them as a third.

From `apps/server/src/auth/flow-state.ts` (sibling task
`flow_state_map_bound`): the analogous shape for an in-process
ceiling — typed `FlowStateCapacityError`, env-resolver helper,
constructor-option override, route-layer mapping to the canonical
wire error. This task mirrors the convention.

## Constraints / requirements

- **Cap default = 32.** Exported as `MAX_SUBSCRIPTIONS_PER_CONNECTION`
  from `subscriptions.ts`.
- **Env override** via `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`. Constant
  exported as `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION_ENV` so tests and
  the resolver share one name.
- **Resolver helper** `resolveMaxSubscriptionsPerConnection(env)`
  returns the default on absent / empty / `NaN` / `<= 0`; positive
  parsed integer otherwise. Mirrors `resolveBodyLimit` /
  `resolveCatchUpMaxEvents`.
- **Constructor option** `WsSubscriptionRegistry({ maxSubscriptionsPerConnection })`
  for hermetic tests that don't want to mutate `process.env`. When
  absent, defaults to `MAX_SUBSCRIPTIONS_PER_CONNECTION` (the resolver
  is invoked at plugin-registration time, not in the constructor —
  the constructor is a low-level primitive).
- **Plugin wiring** `wsSubscriptionsPlugin({ maxSubscriptionsPerConnection? })`
  resolves env when option absent; `wsConnectionHandlingPlugin` and
  `__buildTestWsApp` thread the option through so tests can build a
  small-cap app without `process.env` mutation.
- **Typed error** `SubscriptionCapacityError` (plain `Error` subclass,
  NOT an `ApiError` — the store layer doesn't know about HTTP / WS
  wire shape). Mirrors `FlowStateCapacityError`.
- **No cap value in the wire message.** The error envelope's `message`
  field contains no integers — otherwise an attacker can calibrate
  their fan-out against the leaked value. Same no-leak pattern as
  `flow_state_map_bound`. Pinned by an
  `expect(message).not.toMatch(/\b\d+\b/)` assertion.
- **Idempotent re-subscribe at cap.** A client at the cap that
  re-subscribes to a session it already holds gets a normal
  `subscribed` ack — the cap is a NEW-session gate, not a NEW-call
  gate. Pinned by a test.
- **Per-connection, NOT per-user.** Two open tabs from the same user
  are two WS connections; each gets its own 32-slot budget. A user
  with three tabs can hold 96 subscriptions in aggregate. This is
  deliberate:
  1. The threat F-001 describes is one connection subscribing to
     thousands; a per-connection cap closes that path directly.
  2. A per-user cap is a separate threat model (collusion /
     many-tab abuse) that requires a global connection registry the
     project doesn't have yet — it's owned by a future task
     (`max_connections_per_user`, not in this M3-review batch).
  3. Conflating the two would either drop the per-connection cap to
     an unusably tight value (e.g. 8) to leave room for multiple
     tabs, OR leave the per-user surface open. Keeping them
     separate lets each cap target its own threat at its own
     level.
- **Docs updated.** The new `too-many-subscriptions` code lands in
  `docs/ws-protocol.md`'s WS-specific error table; the
  `protocol-docs.test.ts` coverage test's `WS_SPECIFIC_CODES` set is
  extended in lock-step. The `### subscribe` section's error list is
  extended to mention the cap.
- **Per ADR 0022**: every cap-behavior assertion lands as a committed
  Vitest case. No throwaway probes.

## Acceptance criteria

- `MAX_SUBSCRIPTIONS_PER_CONNECTION = 32` exported from
  `apps/server/src/ws/subscriptions.ts`.
- `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION_ENV = 'WS_MAX_SUBSCRIPTIONS_PER_CONNECTION'`
  exported.
- `resolveMaxSubscriptionsPerConnection(env)` exported; returns the
  default on absent / empty / `NaN` / `<= 0`, parsed integer
  otherwise.
- `SubscriptionCapacityError` exported as a `class extends Error` with
  no internal state fields. The default message contains no integer.
- `WsSubscriptionRegistry`'s constructor accepts
  `{ maxSubscriptionsPerConnection? }`; when absent defaults to the
  exported constant.
- `WS_TOO_MANY_SUBSCRIPTIONS_CODE = 'too-many-subscriptions'` exported
  from `apps/server/src/ws/error-envelope.ts`.
- The subscribe handler catches `SubscriptionCapacityError`, logs a
  warn line (no cap value in the log payload either), and emits an
  `error` envelope with `code: 'too-many-subscriptions'` and
  `inResponseTo: <subscribe.id>`. The connection stays open.
- `docs/ws-protocol.md`'s WS-specific error table lists the new code;
  the `### subscribe` section mentions the cap and links back to this
  refinement.
- `protocol-docs.test.ts`'s `WS_SPECIFIC_CODES` set includes
  `'too-many-subscriptions'`.
- New tests in `apps/server/src/ws/handlers/subscribe.test.ts`:
  - With cap=3, 3 distinct subscribes succeed.
  - With cap=3, the 4th distinct is rejected with the wire error.
  - At cap=3, re-subscribing to an existing session is an idempotent
    ack (no error).
  - With cap=3, unsubscribing then subscribing to a NEW session
    succeeds.
  - With cap=5, 5 succeed and the 6th distinct is rejected (env-
    tunability contract).
  - The wire error message contains no integers (cap no-leak).
  - Registry-level cap unit tests pin the typed error + idempotent
    re-subscribe-at-cap + default-cap behavior.
  - `resolveMaxSubscriptionsPerConnection` unit tests pin
    default / parsed / non-positive / non-numeric cases.
- Regression: the existing 10 registry tests in
  `apps/server/src/ws/subscriptions.test.ts` + the existing 4 handler
  tests in `apps/server/src/ws/handlers/subscribe.test.ts` all stay
  green (the new constructor is backwards-compatible with
  `new WsSubscriptionRegistry()`).
- `pnpm run check` and `pnpm run test:smoke` pass.
- `complete 100` added to the `subscription_cap_per_connection` task
  entry in `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1 |
  grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **Cap default of 32.** F-001's suggested fix mentions 32 explicitly
  ("Cap `byConnection[connectionId].size` at a small constant
  (e.g. 32)"). The number is roughly an order of magnitude over the
  largest plausible legitimate per-connection working set (a senior
  moderator watching 4-8 concurrent debates). Tighter values (e.g. 8
  or 16) would risk legitimate UX regressions; looser values (e.g.
  128 or 256) would leave more amplification surface than needed.
  Operators with unforeseen legitimate cases can override via env
  without a code change.
- **Per-connection, NOT per-user.** Documented above in Constraints.
  The per-user aggregate cap is a different threat (collusion /
  many-tab), a different mitigation (global connection registry
  keyed by user-id), and a different task. Conflating them would
  force a single cap to serve two threats poorly.
- **Idempotent re-subscribe at cap is allowed.** The cap is a
  NEW-session gate. Blocking re-subscribes at cap would make the
  invariant context-dependent (the client would have to know its own
  occupancy to know whether re-subscribe is safe) — worse for
  client implementers than the simpler "re-subscribe is always
  idempotent" contract. The registry can identify a re-subscribe
  in O(1) via `byConnection.get(conn).has(sess)`, so the check is
  free.
- **Typed error class (NOT an `ApiError`).** The registry is a
  low-level primitive; it doesn't know about WS wire shape or HTTP
  status codes. Mirrors `FlowStateCapacityError` (auth/flow-state)
  and `AuthStateMismatchError` (auth/flow). The wire-shape mapping
  lives at the handler layer.
- **`too-many-subscriptions` joins the WS-specific table, not HTTP
  `ApiError` codes.** The condition is unique to the WS surface (the
  HTTP API has no subscription concept); a generic
  `unprocessable-entity` or `forbidden` would mislead clients about
  what to do (retry-after-state-change semantics ≠ retry-after-
  unsubscribe semantics). The new code lives alongside
  `unknown-message-type` and `malformed-envelope`.
- **No cap value in the wire message.** Mirrors the
  `flow_state_map_bound` no-leak invariant. An attacker who knows
  the cap can calibrate their fan-out at `cap × (1 − ε)`;
  withholding the value forces trial-and-error. The OpenAPI doc /
  refinement record the value for operators; the wire does not.
- **Connection stays open on cap rejection.** Per-frame failures are
  recoverable (the general WS protocol invariant — the connection
  closes only on auth, origin, or framing-layer failures). A client
  that gets `too-many-subscriptions` can unsubscribe from something
  else and retry; tearing down the socket would force a full
  reconnect.
- **Tests live in `handlers/subscribe.test.ts`, not in a new file.**
  The cap is a property of the subscribe surface; the existing test
  file is the right home. Some pure-registry-level cases (the typed
  error, the constructor default) also land here rather than
  splitting across `subscriptions.test.ts` — keeps the cap audit in
  one place for future readers. The existing 9
  `subscriptions.test.ts` registry tests stay untouched (regression
  guarantee).

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts) — added `MAX_SUBSCRIPTIONS_PER_CONNECTION = 32`, `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION_ENV`, the `MaxSubscriptionsPerConnectionEnv` env-shape interface, the `resolveMaxSubscriptionsPerConnection(env)` helper, the `SubscriptionCapacityError` class, and the `WsSubscriptionRegistryOptions` constructor-option shape. The constructor now takes the cap as an option (default `MAX_SUBSCRIPTIONS_PER_CONNECTION`); the `subscribe(...)` body now checks the cap and throws `SubscriptionCapacityError` when a NEW session would exceed it. Re-subscribing to an already-subscribed session at cap is allowed (idempotent). The `wsSubscriptionsPlugin` accepts a `maxSubscriptionsPerConnection` option (env-resolved default).
  - [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts) — wraps the `registry.subscribe(...)` call in a try/catch that maps `SubscriptionCapacityError` to a wire `error` envelope with `code: 'too-many-subscriptions'` and `inResponseTo: <subscribe.id>`. The connection stays open (per-frame failures are recoverable).
  - [`apps/server/src/ws/error-envelope.ts`](../../../apps/server/src/ws/error-envelope.ts) — added `WS_TOO_MANY_SUBSCRIPTIONS_CODE = 'too-many-subscriptions'` alongside the existing `WS_UNKNOWN_MESSAGE_TYPE_CODE` / `WS_MALFORMED_ENVELOPE_CODE` constants.
  - [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — extended `WsConnectionHandlingOptions` and `BuildTestWsAppOptions` with an optional `maxSubscriptionsPerConnection` that threads through to `wsSubscriptionsPlugin`. Hermetic tests now inject a small cap without `process.env` mutation.

- Docs:
  - [`docs/ws-protocol.md`](../../../docs/ws-protocol.md) — the WS-specific error table grew from two rows to three (added `too-many-subscriptions`); the `### subscribe` section now lists the cap as part of the error vocabulary and links back to this refinement.

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/ws/handlers/subscribe.test.ts`](../../../apps/server/src/ws/handlers/subscribe.test.ts) — +15 cases across three new describe blocks:
    - `ws_subscribe_to_session — per-connection subscription cap (inputs.md F-001)` — 6 integration tests pinning the exported constants, the cap-3 fill-and-overflow path (wire error with `code: 'too-many-subscriptions'` + the cap no-leak invariant `expect(message).not.toMatch(/\b\d+\b/)`), the idempotent re-subscribe-at-cap path, the unsubscribe-then-subscribe-new path, and the env-tunability contract (`cap=5`).
    - `resolveMaxSubscriptionsPerConnection` — 5 unit tests pinning default-on-absent / empty / non-numeric / zero / negative / positive-integer.
    - `WsSubscriptionRegistry — subscription cap (unit)` — 4 registry-level tests pinning the typed error throw, the idempotent re-subscribe-at-cap no-op, the constructor default (no-options → `MAX_SUBSCRIPTIONS_PER_CONNECTION`), and the no-integer-in-error-message invariant.
  - [`apps/server/src/ws/protocol-docs.test.ts`](../../../apps/server/src/ws/protocol-docs.test.ts) — extended `WS_SPECIFIC_CODES` to include `'too-many-subscriptions'` so the doc-coverage audit accepts the new entry.

- `tasks/25-backend-hardening.tji` — `complete 100` added to the `subscription_cap_per_connection` task entry under `resource_limits_and_dos`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (clean parse).

Test count delta: +15 Vitest cases (`subscribe.test.ts`: +15). `pnpm run check` and `pnpm run test:smoke` both green (1337 tests across 74 files; the existing 10 `subscriptions.test.ts` registry tests + the existing 4 `subscribe.test.ts` handler tests are unchanged and still pass — the new cap surface is purely additive).

**Cap-leak invariant (load-bearing)**: the public-facing wire message (`'subscription cap reached for this connection'`) contains no digits, so a future operator changing the cap value via `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION` does not need to coordinate a wire-message change. The invariant is pinned by `expect(message).not.toMatch(/\b\d+\b/)` assertions in two layers (the wire-error integration test + the registry-level unit test).
