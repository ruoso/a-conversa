# `backend_hardening.protocol_test_pinning.s_to_c_type_rejection_pin`

Source: docs/security/m3-review/coverage.md G-008 (with cross-reference to docs/security/m3-review/inputs.md F-010)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.s_to_c_type_rejection_pin`.
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — `WsDispatcher` + the `onUnknownType` seam live in `apps/server/src/ws/dispatcher.ts`); `backend.websocket_protocol.ws_error_message` (settled — `sendWsError` + the canonical `error` envelope shape live in `apps/server/src/ws/error-envelope.ts`); `backend_hardening.data_hygiene.wire_error_no_echo` (settled — the existing dispatcher test already pins the no-echo regex for the unknown-type seam).

## What this task is

Closes coverage gap **G-008** from the M3 coverage review (also touches the protocol-level observation **F-010** from the inputs review). The closed `WsMessageType` enum in `packages/shared-types/src/ws-envelope.ts` carries both client→server vocabulary (Group B: `subscribe`, `unsubscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`) AND server→client vocabulary (Group A: `hello`, `event-applied`, `error`, `diagnostic`, `proposal-status`; Group C: `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`) in a single discriminator. Nothing in the Zod parser prevents a client from sending a frame whose `type` is a Group A / Group C value — but the dispatcher rejects every such frame with `unknown-message-type` because no handler is registered for those types (only the seven C→S types in Group B have handlers).

The rejection is therefore implicit: a property of "which handlers got registered," not an asserted invariant. A future task that accidentally registers a handler for an S→C type (e.g. when reusing a generic builder, or auto-wiring from the enum) would slip past code review with no test failure to flag the regression.

This task adds a parameterized Vitest case to `apps/server/src/ws/dispatcher.test.ts` that drives every S→C-only `WsMessageType` (Groups A + C — 13 values total) through `dispatcher.dispatch(...)` as if it arrived from a client and asserts the dispatcher's `onUnknownType` seam fires with `code: 'unknown-message-type'`. The asserted invariant becomes pinned — "the server NEVER accepts an inbound frame typed as an ack/result/broadcast" — and any future drift breaks the test.

The artefacts:

- `apps/server/src/ws/dispatcher.test.ts` — adds one parameterized `it.each(...)` case enumerating the 13 S→C-only types (Group A: `hello`, `event-applied`, `error`, `diagnostic`, `proposal-status`; Group C: `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`). Test count delta: +13 cases (each parameter row is a Vitest case).

This is TEST-ONLY. Production behaviour is unchanged — the rejection is already implicit; the test pins the invariant.

## Why it needs to be done

- **The invariant is real but unpinned.** The protocol design intends Group A and Group C types to be server-emitted only; this directionality is encoded only in convention (the three-group structure of `wsMessageTypes`) and in the handler-registration sites (`apps/server/src/ws/handlers/index.ts` only registers Group B types). No test asserts the property "every S→C-only type is rejected when sent C→S." A future refactor that auto-wires the dispatcher from the enum, or a handler-registration mistake (typo'ing `'committed'` for `'commit'`), would silently break the invariant.
- **Cheap, defensive, exhaustive.** A parameterized test that walks every S→C-only type is ~25 lines and runs in microseconds. The benefit is structural: the test enumerates the closed set of types the server-side handler registration must NEVER include, so adding a new S→C type to the enum (a Group A or Group C addition) requires updating this test in the same commit — the closed-list pin becomes a code-review checkpoint.
- **No production change.** ADR 0022 disallows throwaway probes; this work converts an unpinned implicit behaviour into a pinned committed test. The dispatcher's `unknown-message-type` seam is already covered for synthetic types; this task closes the gap for the realistic threat shape (a client sending an actual ack type vs. an arbitrary garbage string).
- **F-010 cross-reference.** The inputs review's F-010 (Informational) noted the same input-asymmetry: the parser validates the (larger) ack payload schemas as a no-op even when the dispatcher rejects the frame. F-010's suggested structural fix (partition the enum into directional subsets and reject at parse time) is NOT in scope for this task — that's an architectural decision that should land separately if/when it lands. This task pins TODAY's behaviour so a future architectural change has a regression baseline to compare against.

## Inputs / context

From [docs/security/m3-review/coverage.md](../../../docs/security/m3-review/coverage.md) G-008:

> **Surface**: WS dispatcher (`apps/server/src/ws/dispatcher.ts`)
>
> **Existing coverage**: `dispatcher.test.ts:121` covers an unknown type (synthetic). No test sends a real S→C-only type (e.g., `subscribed`, `event-applied`, `error`, `proposal-status`, `diagnostic`, `caught-up`) AS a client.
>
> **Gap**: The Zod envelope schema (`wsMessageTypes`) is a single closed list containing both C→S and S→C types; nothing in the schema prevents a client from sending `type: 'event-applied'`. The dispatcher rejects it with `unknown-message-type` (no handler registered), but this is implicit and not pinned.
>
> **Adversarial scenario**: A future task registers a handler for an S→C type by mistake (e.g., when reusing a builder) — there's no test guarding "the server NEVER accepts an inbound frame typed as an ack/result/broadcast."
>
> **Suggested test**: Vitest case "every S→C-only `wsMessageType` is rejected with `unknown-message-type` when sent C→S," parameterised over `['subscribed', 'unsubscribed', 'proposed', 'voted', 'committed', 'meta-disagreement-marked', 'snapshot-state', 'caught-up', 'event-applied', 'error', 'diagnostic', 'proposal-status', 'hello']`.

From [docs/security/m3-review/inputs.md](../../../docs/security/m3-review/inputs.md) F-010 (cross-reference; structural fix out of scope):

> The closed `WsMessageType` enum contains both C→S types (`subscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`) and S→C types (`hello`, `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`, `event-applied`, `error`, `diagnostic`, `proposal-status`). [...] A client sending a `subscribed` ack envelope to the server therefore falls into the `onUnknownType` branch — handled, but the dispatcher still pays for full envelope+payload validation against the `subscribedPayloadSchema`, and the parse path then sends an `error` envelope back. Functionally safe; the asymmetry is that a malicious client can force the server to validate the larger ack payload shapes (UUIDs, ints) as a no-op DoS amplifier.

Inventory of S→C-only types from [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) (the three-group layout documented at lines 81-138):

- **Group A** (server-emitted unsolicited frames): `hello`, `event-applied`, `error`, `diagnostic`, `proposal-status`.
- **Group C** (server-emitted ack/result frames correlated via `inResponseTo`): `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`.

Total: 13 types. Group B (C→S requests — `subscribe`, `unsubscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`) is excluded from this test because those types HAVE registered handlers in production and are exercised by their own handler-level tests.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Pure-logic test (the dispatcher does no I/O). Lands as Vitest in `dispatcher.test.ts`. No cucumber scenario required — the full receive-parse-dispatch path through `app.injectWS` is already covered by `tests/behavior/backend/ws-envelope.feature` for the unknown-type seam; this task's surface is specifically the dispatcher's handler-registry shape, which is best asserted at the unit boundary.

## Constraints / requirements

- **TEST-ONLY.** No production code changes. The rejection behaviour is already implicit; the test pins the invariant. Per ADR 0022, the pin IS the deliverable.
- **Parameterized via `it.each(...)`** over the 13-element S→C-only list. Each parameter row exercises one type. The list is declared as a const tuple literal so a Group A / Group C addition to `wsMessageTypes` that's NOT also added to this test array is a code-review prompt (the test won't auto-update; a contributor must consciously include or exclude the new type).
- **Per-type assertions identical to the existing unknown-type test.** Each case sends a synthetic envelope `{ type, id, payload }` (with a stub payload — the dispatcher doesn't introspect the payload on the unknown-type path) and asserts:
  - The wire-format error envelope was sent with `type: 'error'`, `inResponseTo: envelope.id`, `payload.code: 'unknown-message-type'`.
  - The structured warn log fired with `messageType: type`.
  - No registered handler was invoked (no production handler exists for these types in the test's dispatcher instance, which uses the default empty registry).
- **No throwaway probes (ADR 0022).** Every assertion lands in the committed test. No ad-hoc dispatcher invocations or `node -e` probes.
- **Test layer per ADR 0022.** Pure logic → Vitest. The dispatcher is per-instance and synthesizable; no DB / no network / no compose stack involvement.
- **No regression to the existing 17 dispatcher tests.** This task adds cases; it does not modify any prior test.

## Acceptance criteria

- `pnpm run check` succeeds (lint + format + typecheck + tools + tests typecheck).
- `pnpm run test:smoke` (Vitest) green; net positive test delta of +13 cases from `dispatcher.test.ts` (one per S→C-only `WsMessageType`).
- The 13 enumerated types from the source finding are each covered by a row in `it.each(...)`: `hello`, `event-applied`, `error`, `proposal-status`, `diagnostic`, `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`.
- Per-row assertion: `wire.type === 'error'` AND `wire.payload.code === 'unknown-message-type'` AND `wire.inResponseTo === envelope.id`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Pin via a static array literal, not via a runtime filter over `wsMessageTypes`.** The source finding suggests parameterising over the closed list; an attractive shortcut would be `wsMessageTypes.filter((t) => !['subscribe', ...].includes(t))` to compute the S→C-only subset at test time. This task rejects that shortcut: a static literal makes the test's intent reviewable (a reviewer reads the array and sees exactly the 13 types being asserted as S→C-only), and it forces a contributor adding a new type to consciously categorise it (Group A / B / C) rather than passively inheriting the test coverage. The closed-list pin is the audit trail.
- **No partitioning of `wsMessageTypes` into directional subsets in this task.** F-010's structural fix — splitting the enum into `clientToServerTypes` and `serverToClientTypes` and rejecting cross-direction at parse time — is a separate, architectural decision that affects every consumer of `WsMessageType` (the discriminated union in shared-types, the handler registry, the broadcast emitters, the cucumber test fixtures). It would need its own ADR-shaped discussion of forward-compat implications (what does parse-time rejection do for a moderator-UI that mocks a server frame in a unit test?). This task pins TODAY's behaviour so the architectural change has a regression baseline.
- **Use `it.each(...)` rather than `describe.each(...)`.** The 13 cases share setup/teardown with the existing dispatcher tests (the `beforeEach` rebuilds the dispatcher; the `afterEach` clears mocks). `it.each` keeps them in the existing `describe('WsDispatcher', ...)` block alongside the synthetic-unknown-type test, so a reviewer reading the file sees the unknown-type behaviour pinned in one place. `describe.each` would create 13 separate sub-suites with their own `beforeEach`, which is unnecessary nesting.
- **Stub payload, not a real per-type payload.** The dispatcher's unknown-type seam does NOT introspect the payload (it only reads `envelope.type` and `envelope.id`); a constant stub payload `{ stub: true }` (cast through `as unknown as ...`) is sufficient and avoids constructing 13 different per-type payload shapes. The cast is the same documented narrow-cast pattern the existing F-009 tests use (`envelopeWithRawType`).
- **Defensive cast pattern.** The static `WsMessageType` union narrows `envelope.type` at the call site; sending a `'subscribed'`-typed envelope through `dispatch` is statically valid (because `'subscribed'` IS a member of the union). The cast is needed only for the payload shape (which differs per type) — the existing test's `envelopeWithRawType` helper provides the template.
- **Assert wire + log + no-handler-call, mirroring the existing synthetic unknown-type test.** Pinning three observable consequences (wire frame, structured log, handler not called) makes regressions visible from three angles. The cheapest regression — someone registers a handler for `'committed'` and forgets to think about it — trips at least the wire-frame assertion (the handler-success path doesn't send an `error` envelope) and the handler-call assertion (the registered mock fires).
- **No cucumber scenario.** The integration path (parse → dispatch → wire response) is already covered by `tests/behavior/backend/ws-envelope.feature`'s unknown-type scenarios. Adding 13 cucumber rows would duplicate the dispatcher-level pin without exercising additional integration surface. The unit-level pin is sufficient per ADR 0022's layer-routing rule (pure logic → Vitest).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Parameterized test: [`apps/server/src/ws/dispatcher.test.ts`](../../../apps/server/src/ws/dispatcher.test.ts) — adds an `it.each(...)` block enumerating the 13 S→C-only `WsMessageType` values (Groups A + C). Each parameter row sends a frame with that type and asserts the dispatcher emits the canonical `unknown-message-type` error envelope on the connection's socket. Test count: 17 → 30 (+13 cases).
- WBS: `complete 100` marker added to `s_to_c_type_rejection_pin` in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- No production code changes (this is a test-only pin per ADR 0022 — the rejection behaviour is already implicit in the dispatcher's empty handler registry for these types).
