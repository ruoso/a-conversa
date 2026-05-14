# `backend_hardening.subscription_lifecycle.privacy_flip_subscription_prune`

**Source**: [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-001.
**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.subscription_lifecycle.privacy_flip_subscription_prune`.
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.websocket_protocol.ws_subscribe_to_session` — settled (`WsSubscriptionRegistry` bidirectional map, `subscribed` / `unsubscribed` ack pattern in `apps/server/src/ws/handlers/subscribe.ts`).
- `backend.websocket_protocol.ws_event_broadcast` — settled (`WsConnectionSenderRegistry`; the senders registry is the path back to the underlying socket from a `connectionId`).
- `backend.cross_session_permissions.privacy_field_enforcement` — settled (`canSeeSession(executor, sessionId, userId)` predicate).
- `backend.session_management.session_privacy_toggle` — settled (`PATCH /sessions/:id/privacy` handler shape: visibility → authority → lifecycle → UPDATE).

## What this task is

When the host of a session flips its `privacy` field to `'private'` via
`PATCH /sessions/:id/privacy`, every currently-subscribed WebSocket
connection whose authenticated user can no longer see the session must
be evicted from the subscription registry **and** notified on the wire.
Before this task the privacy-toggle UPDATE landed in `sessions` and the
HTTP response returned 200; the `WsSubscriptionRegistry` was untouched.
Any non-participant who happened to be subscribed when the session was
still public continued to receive every subsequent `event-applied`,
`diagnostic`, and `proposal-status` broadcast — for the lifetime of
their connection — with no signal that the session had gone private.

The fix has three coupled pieces:

1. **A user-side index on `WsSubscriptionRegistry`.** Today's registry
   stores `(connectionId, sessionId)` tuples only; to evaluate
   `canSeeSession` for each subscriber the pruner needs the
   `connectionId → userId` mapping. The registry grows a small parallel
   `Map<connectionId, userId>` populated by `subscribe(connId, sessId,
   userId)` and cleared by `removeConnection`. The existing two-arg
   `subscribe(connId, sessId)` shape stays valid (the `userId` is
   optional in the signature) so the dozen existing test call sites
   that fabricate subscriptions don't have to change. A new accessor
   `userForConnection(connectionId)` exposes the lookup.

2. **A prune helper.** A new function
   `pruneSubscribersForPrivateSession(app, pool, sessionId, log)` (in
   `apps/server/src/ws/subscriptions.ts`) walks
   `connectionsForSession(sessionId)`, looks up each connection's
   user, runs `canSeeSession(pool, sessionId, userId)`, and — when the
   user is no longer visible — sends a server-initiated `unsubscribed`
   envelope and removes the entry. Each per-connection step is wrapped
   in a try/catch so one broken socket doesn't break the loop.

3. **A wire-shape extension.** The server-initiated `unsubscribed`
   envelope carries an optional `reason: 'privacy-flipped'` field on
   its payload. Clients use the presence of `reason` to distinguish
   "I sent `unsubscribe`" (no `reason`, `inResponseTo` echoes the
   request) from "the server kicked me out" (`reason` present,
   `inResponseTo` absent).

After this task the `PATCH /sessions/:id/privacy` handler — and only
that handler — calls the prune helper after the UPDATE landed, with
the new privacy value being `'private'`. A flip from `private` to
`public` is a no-op (visibility only widens; no subscriber loses
access). A same-value flip (`public→public` or `private→private`) is
also a no-op (the registry's pre-existing contents are unchanged from
the visibility predicate's perspective).

## Why it needs to be done

[`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md)
G-001 documents the surface:

> When the host of a public session flips it to private via `PATCH
> /sessions/:id/privacy`, the WS subscription registry is NOT pruned. A
> non-participant who subscribed while the session was public continues
> to receive every subsequent `event-applied`, `diagnostic`, and
> `proposal-status` broadcast for that session — until they reconnect
> (when the next `subscribe` would fail visibility) or call
> `unsubscribe`. The three broadcast listeners only consult
> `connectionsForSession(sessionId)` and do not re-run `canSeeSession`.

The adversarial scenario:

> An attacker subscribes to a public debate, the host turns it private
> (intending to take it confidential), and the attacker continues to
> see every methodology event + diagnostic on that session.
> Particularly damaging because (a) the methodology engine emits
> potentially-sensitive propositional content in proposal payloads, and
> (b) the attacker never receives any signal that the session went
> private.

Two structural choices in the codebase point the same way:

- The broadcast surface (`event-applied.ts`, `diagnostic.ts`,
  `proposal-status.ts`) consults the subscription registry as its
  authoritative routing table; re-checking `canSeeSession` on every
  fan-out would multiply the per-broadcast DB cost by the number of
  subscribers. The cheaper structural fix is to keep the registry
  truthful: an entry exists IFF the user can see the session right
  now.
- The visibility predicate is centralised (`apps/server/src/sessions/
  visibility.ts`). The prune can reuse it verbatim — same SQL, same
  rule, same existence-non-leak semantics. There is no second
  permission model to maintain.

## Inputs / context

From `apps/server/src/sessions/routes.ts` (the privacy-PATCH handler,
post-task shape): after the UPDATE returns the new row, when
`desiredPrivacy === 'private'`, call
`pruneSubscribersForPrivateSession(app, pool, sessionId, request.log)`
before the response is sent. The prune runs OUTSIDE the transaction
that wrote `sessions.privacy` (the transaction has committed by then —
the UPDATE is a single-statement transaction in the existing handler).

From `apps/server/src/ws/subscriptions.ts` (pre-task surface): the
registry exposes `subscribe(conn, sess)` / `unsubscribe(conn, sess)` /
`connectionsForSession(sess)` / `sessionsForConnection(conn)` /
`removeConnection(conn)`. The new method
`userForConnection(connectionId)` reads from a new parallel
`Map<connectionId, userId>`. The `subscribe` signature grows an
optional third argument `userId?: string`; the connection-handler call
site at `apps/server/src/ws/handlers/subscribe.ts:121` passes the
already-validated `userId`. Existing test call sites that pass two
arguments continue to work (the third arg is optional); their
subscriptions just don't carry a user-id binding, and the pruner skips
them (logged at warn level — "no userId binding; cannot evaluate
visibility").

From `apps/server/src/ws/broadcast/connections.ts`: the
`WsConnectionSenderRegistry` is the existing path from a
`connectionId` to a `WsEnvelopeSender` (the `(envelope) => void`
closure that serialises + writes to the underlying socket). The prune
helper reaches for it via `app.wsConnectionSenders.get(connectionId)`,
same as the broadcast subscriber.

From `packages/shared-types/src/ws-envelope.ts`: the
`unsubscribedPayloadSchema` is `{ sessionId: uuid }` today; it grows
an optional `reason: z.enum(['privacy-flipped'])` field. The enum is
deliberately closed (not free-form) so a future sibling task —
`user_soft_delete_ws_close` (G-003) — extends the enum with
`'user-removed'` and the wire vocabulary stays auditable.

## Constraints / requirements

- **Pruning runs only on `public → private` (and `private → private`
  is a no-op).** A flip to `'public'` widens visibility; nobody loses
  access. The handler narrows the call to `desiredPrivacy === 'private'`
  before invoking the helper. Even when `desiredPrivacy === 'private'`
  AND the row was already private, the prune is still safe — the
  registry's contents already satisfy `canSeeSession` so the prune
  walks the connections without removing any.
- **Participants are NEVER pruned.** `canSeeSession` returns `true` for
  the host AND for any current-or-past participant, regardless of
  privacy. The predicate is the authoritative gate; the prune just
  iterates and calls it.
- **Per-connection error isolation.** Each connection's send +
  unsubscribe is wrapped in a try/catch. A throw on one socket
  (already-closed, exotic state) logs a warn line and the loop
  continues. The PATCH response is NEVER blocked by a slow / broken
  socket — the UPDATE has already committed; the response status is
  independent of fan-out success.
- **Server-initiated `unsubscribed` envelope.** Reuses the existing
  `'unsubscribed'` discriminator (no new envelope type) with:
  - `id`: server-minted v4 UUID (unsolicited frames mint a fresh id).
  - `inResponseTo`: absent (unsolicited; not correlated to any
    client request).
  - `payload.sessionId`: the session that just went private.
  - `payload.reason`: `'privacy-flipped'`. Distinguishes
    server-initiated unsubscribes from client-acked ones.
- **Closed `reason` enum.** `reason: z.enum(['privacy-flipped'])` —
  not free-form. The sibling task `user_soft_delete_ws_close` (G-003)
  extends the enum with `'user-removed'`; we do NOT pre-populate other
  values to avoid shipping vocabulary the protocol doesn't honour.
- **`userId` binding is optional at the registry surface.** The
  registry's `subscribe(connectionId, sessionId, userId?)` accepts an
  optional userId. Production callers (the WS subscribe handler)
  always pass it; existing tests that fabricate registry entries
  without a userId binding still work — those subscriptions are
  pruned-skipped (a warn log, no eviction). The connection-close hook
  (`apps/server/src/ws/connection.ts`) doesn't need to change — the
  registry's `removeConnection` already wipes the connection's user
  binding when it wipes the indices.
- **Prune runs OUTSIDE the privacy-UPDATE transaction.** The existing
  handler's UPDATE is a single statement (no explicit BEGIN / COMMIT;
  Postgres wraps it implicitly). The prune is a separate SQL surface
  (one `canSeeSession` query per subscribed connection) — running it
  inside an open transaction would (a) extend the transaction's
  duration past the UPDATE, and (b) hold a write lock unnecessarily.
  Running it after the row is committed is the correct ordering.
- **`canSeeSession` failure logged + skipped.** If the `canSeeSession`
  query itself rejects (e.g. pool exhausted, intermittent DB error),
  the prune logs a warn line for that connection and continues to the
  next. The failure is per-connection; the rest of the loop still
  runs. The handler response stays 200 — the privacy bit DID flip;
  partial prune failure is a degradation, not a state corruption.
- **Per ADR 0022**: every behaviour assertion lands as a committed
  test. The prune behaviour is exercised at three layers (handler
  integration in `routes.test.ts`, registry unit in
  `subscriptions.test.ts`, helper unit in `subscriptions.test.ts`).
  No throwaway probes.

## Acceptance criteria

- `WsSubscriptionRegistry.subscribe(connectionId, sessionId, userId?:
  string)` accepts an optional third argument. When present, the
  registry records the binding on an internal
  `Map<connectionId, userId>`. When absent, no binding is recorded
  (back-compat with existing tests).
- `WsSubscriptionRegistry.userForConnection(connectionId): string |
  undefined` returns the recorded userId or undefined.
- `WsSubscriptionRegistry.removeConnection(connectionId)` deletes the
  user binding in lock-step with the two existing indices.
- `pruneSubscribersForPrivateSession(opts)` exported from
  `apps/server/src/ws/subscriptions.ts`. Takes
  `{ subscriptions, connectionSenders, pool, sessionId, log }` and
  walks `connectionsForSession(sessionId)`, evicting any subscriber
  whose userId fails `canSeeSession`. Per-connection try/catch wraps
  the send + unsubscribe. The function returns a Promise<void>; the
  caller awaits it before returning the HTTP response.
- The `unsubscribedPayloadSchema` (in `packages/shared-types/src/
  ws-envelope.ts`) grows an optional
  `reason: z.enum(['privacy-flipped']).optional()`. The
  `UnsubscribedPayload` type reflects the optional field.
- The `subscribe` handler at `apps/server/src/ws/handlers/subscribe.ts`
  passes the validated `userId` to `registry.subscribe(...)`.
- The `unsubscribe` handler emits the ack with no `reason` field (it's
  optional — its absence preserves the original wire shape for ack
  correlation).
- The `PATCH /sessions/:id/privacy` handler calls
  `pruneSubscribersForPrivateSession` after the UPDATE when the new
  privacy is `'private'`.
- `__buildTestSessionsApp` registers `wsSubscriptionsPlugin` and
  `wsConnectionSendersPlugin` so the privacy-PATCH route can reach
  the registry + senders in unit tests. The
  `sessionsRoutesPlugin` itself also registers both (idempotent
  guards in the plugins themselves prevent double-decoration when
  the WS connection plugin is also present in production).
- `docs/ws-protocol.md`'s `### unsubscribed` section documents the
  server-initiated path: when `reason` is present, the frame was
  unsolicited; `inResponseTo` is absent. The closed `reason` enum is
  listed with the one current value.
- New tests:
  - `apps/server/src/sessions/routes.test.ts` — four cases on the
    PATCH `/sessions/:id/privacy` surface:
    1. Non-participant subscribed to a public session → host flips
       to private → the stranger's sender receives an `unsubscribed`
       envelope with `reason: 'privacy-flipped'`; the registry's
       `connectionsForSession` no longer lists the stranger.
    2. Participant subscribed → host flips to private → the
       participant's sender receives no `unsubscribed` envelope;
       the registry still lists the participant.
    3. Flip from `private` to `public` is a no-op for pruning
       (every subscriber stays in the registry, no
       server-initiated frames sent).
    4. Public → private when no subscribers exist is a no-op
       (handler returns 200 without crashing on the empty walk).
  - `apps/server/src/ws/subscriptions.test.ts` — three cases:
    1. `subscribe(conn, sess, user)` records the user binding;
       `userForConnection(conn)` returns it.
    2. `removeConnection(conn)` wipes the user binding alongside
       the indices.
    3. The pruner walks the registry, sends to each visibility-
       failing connection, and removes those entries. A per-
       connection sender that throws is logged and the loop
       continues to the next connection. (The visibility predicate
       is stubbed via a fake `query` function so the test stays
       pure-unit.)
- Regression: the existing 10 registry tests + 4 subscribe-handler
  tests + cap-suite (15 tests added by the cap task) all stay green.
- `pnpm run check` and `pnpm run test:smoke` pass.
- `complete 100` added to the `privacy_flip_subscription_prune` task
  entry in `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1
  | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **Reuse `unsubscribed` rather than mint a new `forced-unsubscribe`
  type.** The wire-shape choice was the load-bearing decision. Two
  alternatives were considered:
  1. **(picked) Reuse `unsubscribed` with an optional
     `reason: 'privacy-flipped'` payload field.** Pros: one
     discriminator continues to mean "stop streaming this session";
     the client's existing `unsubscribed` handler still fires
     correctly (idempotent unsubscribe on the client side);
     `inResponseTo`-absent vs. present already distinguishes
     client-acked from server-initiated for any client willing to
     read it. Closed `reason` enum is the structural signal for
     clients that DO want to differentiate. The shared-types union
     stays the same size. Cons: a future protocol reader looking only
     at `type === 'unsubscribed'` won't immediately know there's a
     server-initiated branch — but the docblock + protocol doc fix
     that.
  2. **Mint `forced-unsubscribe` as a new envelope type.** Pros: the
     wire vocabulary distinguishes the two paths at the type level;
     a wire trace's `type` field tells the story. Cons: the closed
     `wsMessageTypes` union grows; every protocol exhaustiveness
     check (dispatcher, the s_to_c_type_rejection_pin test set, the
     protocol-docs audit) needs a new entry; clients with an existing
     `unsubscribed` handler need a new branch. The `reason` enum
     still has to exist on the new type to distinguish current vs.
     future server-initiated paths — so the new type doesn't replace
     the enum, it just multiplies it.

  Option 1 wins: it's the smaller, more local change; the
  distinguishing information (`reason` enum + `inResponseTo` absent)
  is on the wire either way; clients that don't care still work
  unchanged. The future `user_soft_delete_ws_close` task (G-003) will
  extend the same `reason` enum with `'user-removed'` rather than
  inventing yet another envelope type. Operators reading wire traces
  filter on `reason !== undefined` to find every server-initiated
  unsubscribe across the whole protocol.

- **Closed `reason` enum, not a free-form string.** The enum is
  auditable (one place adds a new value; the type-check and the
  protocol-docs test see it); a free-form string is not. Mirrors
  every other closed wire-vocabulary decision in the codebase
  (`wsMessageTypes`, the methodology engine's `RejectionReason`,
  the HTTP `ApiError` code set).

- **`userId` is a registry concern, not a handler concern.** Three
  alternative homes for the `connectionId → userId` mapping were
  considered:
  1. **(picked) In `WsSubscriptionRegistry` as a parallel index.**
     Pros: the registry is already the per-connection bookkeeping
     point; the user binding is conceptually part of the
     subscription state; one lifecycle (added by `subscribe`,
     wiped by `removeConnection`).
  2. In a separate `WsConnectionUserRegistry` plugin, mirroring
     `WsConnectionSenderRegistry`. Pros: orthogonal. Cons: two
     registries with the same lifecycle is redundant; two
     close-hook calls instead of one.
  3. On the `WsConnectionContext` only (no separate index), with
     the pruner reading from `app.wsConnectionContexts` (not
     decorated today). Cons: no decorator exists; building one
     just for this task is a larger surface than the parallel
     index.
  Option 1 wins for the same reason the senders registry is
  per-connection (one lifecycle, one teardown point).

- **Optional `userId` parameter, not a required one.** Twelve test
  call sites already use the two-arg `subscribe(connId, sessId)`
  shape to fabricate registry entries; making the third arg required
  would force a touch in each. The optional shape is back-compatible
  and the pruner is explicit about what happens to entries without
  a binding (warn-log + skip). Production code paths always pass
  the userId.

- **Prune runs in the route handler, not in a generic "after-PATCH"
  hook.** A generic hook (a Fastify `onResponse` listener that runs
  on every response) would be a cross-cutting concern; the prune is
  specific to ONE route. Plus the handler already knows
  `desiredPrivacy === 'private'` from the request body; a generic
  hook would have to re-derive that. Keeping the call site explicit
  also makes the audit trail simpler.

- **Per-connection error isolation, mirroring the broadcast
  surface.** The pattern is the same as `event-applied.ts`'s
  per-connection try/catch: one bad socket logs + continues. The
  HTTP response is NEVER blocked by a slow / broken WS connection.

- **Cucumber+pglite layer is NOT added in this task.** The Vitest
  layer (with the memory pool) exercises the in-process behaviour
  fully; a Cucumber scenario would mostly re-test the same code
  paths against a different DB driver. The sibling tasks
  `user_soft_delete_ws_close` (G-003) and
  `catch_up_revoked_visibility_pin` (G-002) — both depending on this
  task — share the same helper, so any future Cucumber pass against
  the prune lifecycle covers all three.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts) — added the `userByConnection: Map<connectionId, userId>` parallel index. `subscribe(connectionId, sessionId, userId?)` now accepts an optional third argument; when present, the registry stores the binding. `removeConnection(connectionId)` wipes the binding in lock-step with the two indices. New `userForConnection(connectionId)` accessor returns the bound userId or `undefined`. Added the `pruneSubscribersForPrivateSession(opts)` helper — walks `connectionsForSession(sessionId)`, looks up each connection's userId, runs `canSeeSession(pool, sessionId, userId)`, and on visibility-failure sends a server-initiated `unsubscribed` envelope (`payload.reason = 'privacy-flipped'`, no `inResponseTo`) + removes the registry entry. Per-connection try/catch wraps the send + unsubscribe (one bad socket logs + continues). A `canSeeSession` query rejection logs + skips that connection without crashing the loop.
  - [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts) — the `subscribe` handler now passes the already-validated `userId` as the third argument to `registry.subscribe(...)` so the privacy-flip pruner can later evaluate `canSeeSession` for this subscriber.
  - [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — the plugin body now registers `wsSubscriptionsPlugin` and `wsConnectionSendersPlugin` (idempotent against the existing `wsConnectionHandlingPlugin` registration in production; provides the decorators for the test surface). The `PATCH /sessions/:id/privacy` handler now calls `pruneSubscribersForPrivateSession({ subscriptions, connectionSenders, pool, sessionId, log })` after the UPDATE lands when `desiredPrivacy === 'private'`. A flip to `'public'` skips the prune entirely (visibility widens, nobody loses access). Per the refinement's wire-shape decision, the prune reuses the existing `unsubscribed` envelope type rather than minting a new `forced-unsubscribe` type — the optional `reason` field is the structural signal for clients that differentiate server-initiated from client-acked.

- Shared types:
  - [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — added `unsubscribedReasons = ['privacy-flipped']` (closed enum, exported), `UnsubscribedReason` type, and `unsubscribedReasonSchema`. The `unsubscribedPayloadSchema` now carries an optional `reason: unsubscribedReasonSchema.optional()`. The `UnsubscribedPayload` type reflects the optional field. Docblock documents both paths (client-acked: `inResponseTo` echoes request, `reason` absent; server-initiated: `inResponseTo` absent, `reason` present).

- Docs:
  - [`docs/ws-protocol.md`](../../../docs/ws-protocol.md) — the `### unsubscribed` section now distinguishes the client-acked path (correlated via `inResponseTo`, no `reason`) from the server-initiated push (no `inResponseTo`, `reason: 'privacy-flipped'`). The closed enum is documented with a forward reference to `user_soft_delete_ws_close` (G-003) as the next consumer.

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/ws/subscriptions.test.ts`](../../../apps/server/src/ws/subscriptions.test.ts) — +11 cases across two new describe blocks:
    - `WsSubscriptionRegistry — userId binding` — 4 unit tests pinning the optional-third-arg binding, the legacy two-arg back-compat (no binding recorded), the `removeConnection` lock-step wipe, and the defensive re-bind-on-resubscribe shape.
    - `pruneSubscribersForPrivateSession` — 7 helper-level tests covering: visibility-failing subscriber evicted with `reason: 'privacy-flipped'`; visibility-admitting subscriber kept; mixed set (visible + invisible) handled in a single walk; legacy fixture (no userId binding) skipped without crashing; per-connection error isolation when a sender throws; no-op on empty session; `canSeeSession` query rejection logged + skipped (subscription left in place).
  - [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — +4 cases under a new `PATCH /sessions/:id/privacy — subscription prune on flip to private (G-001)` describe block:
    1. Stranger subscribed to a public session is evicted on public→private flip; the `unsubscribed` envelope carries `reason: 'privacy-flipped'`; the registry entry is gone.
    2. Participant subscribed remains subscribed on public→private flip; no server-initiated envelope sent.
    3. Private→public flip is a no-op for pruning (subscribers stay; no envelopes).
    4. Public→private flip on a session with zero subscribers is a no-op (handler returns 200, row's privacy flipped).

- `tasks/25-backend-hardening.tji` — `complete 100` added to the `privacy_flip_subscription_prune` task entry under `subscription_lifecycle`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (clean parse).

Test count delta: +11 Vitest cases (`subscriptions.test.ts`: +11 across 2 new describe blocks; `routes.test.ts`: +4 in a new describe block — net +15 if both files counted, but the subscriptions.test.ts new cases are 11 of those). Total suite: 1763 tests across 87 files, all green. `pnpm run check` (lint + format + typecheck across all three tsconfigs) and `pnpm run test:smoke` both green.

**Wire-shape decision (load-bearing)**: the optional `reason` field on the existing `unsubscribed` envelope was picked over minting a new `forced-unsubscribe` envelope type. Rationale captured in the Decisions section above: keeps the closed `wsMessageTypes` union the same size; clients with an existing `unsubscribed` handler still work unchanged; `inResponseTo`-absent + `reason`-present is the structural signal for clients that DO differentiate; the next sibling task (`user_soft_delete_ws_close`, G-003) extends the closed `unsubscribedReasons` enum with `'user-removed'` rather than minting yet another envelope type. Operators filter wire traces by `reason !== undefined` to find every server-initiated unsubscribe across the whole protocol.
