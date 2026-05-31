# Snapshot creation logic — stateless handler that validates a label and mints a `snapshot-created` event

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.methodology_engine.snapshot_create_logic`.

```
task snapshot_create_logic "Snapshot creation handler — validates label, mints snapshot-created event" {
  effort 0.5d
  allocate team
  note -8<-
    Source of debt: tasks/refinements/moderator-ui/mod_snapshot_label_input.md Decision §1.b
    — stateless methodology-engine handler at apps/server/src/methodology/handlers/createSnapshot.ts.
    Takes { sessionId, label, currentSequence, moderatorId, now }; validates label
    (trimmed, 1..128 chars per MAX_SNAPSHOT_LABEL_LENGTH); generates snapshot_id UUID;
    returns snapshot-created payload { snapshot_id, label, log_position: currentSequence + 1 }
    per snapshot_events.md Decisions. No interaction with agreement_state_machine —
    snapshots are not facets. Pure-logic Vitest coverage mirroring the engine handlers alongside it.
    Registered by closer (2026-05-31) while closing moderator_ui.mod_snapshot_flow.mod_snapshot_label_input.
  ->8-
}
```

## Effort estimate

**0.5d.** Confirmed by the closer. The deliverable is one small handler file (~80 lines), one colocated Vitest file (~150 lines covering the rule set), one small extension to `apps/server/src/methodology/types.ts` (one new `RejectionReason` value), and a Cucumber feature file at the pglite-backed seam (~3 scenarios, ~80 lines including step defs reuse). No projection changes, no schema changes (`snapshotCreatedPayloadSchema` already exists at [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts)), no `agreement_state_machine` registry changes.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- **`data_and_methodology.event_types.snapshot_events`** (done — 2026-05-10). `snapshotCreatedPayloadSchema` and the inferred `SnapshotCreatedPayload` type live at [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts); registered in `eventPayloadSchemas` (line 723) and `EventPayloadMap` (line 753). The payload shape is `{ snapshot_id: UUID, label: string (1..128), log_position: int > 0 }` — exactly the payload this handler returns. `log_position` semantics are settled by that refinement: "the session's `sequence` value at the time the snapshot is taken — typically the snapshot event's own sequence."
- **`data_and_methodology.methodology_engine.agreement_state_machine`** (done). Defines `ValidationResult` / `ValidValidationResult` / `RejectedValidationResult` / `RejectionReason` / `EventToAppendEnvelope<K>` at [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts). This task reuses those shapes for its return value (see Decisions §"Result shape") and extends `RejectionReason` by one value (`'invalid-label'`).
- **`backend_hardening.resource_limits_and_dos.user_text_length_caps`** (done). `MAX_SNAPSHOT_LABEL_LENGTH = 128` exported from [`packages/shared-types/src/limits.ts:66`](../../../packages/shared-types/src/limits.ts). This is the single source of truth that the schema (`snapshotCreatedPayloadSchema.label`) and this handler both consume — no re-litigation of the cap value.
- **[ADR 0021 — Event envelope schema-on-write](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)**. The handler returns an `EventToAppendEnvelope<'snapshot-created'>`; the caller (the WS layer landed by `ws_label_snapshot_message`) runs `validateEvent` on it before append. The handler does not call `validateEvent` itself.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**. Every empirical check ships as a committed Vitest / Cucumber case.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`backend.websocket_protocol.ws_label_snapshot_message`** (refined; awaits implementation — see [`tasks/20-backend.tji:363-371`](../../20-backend.tji)). The WS write-side handler that imports `createSnapshot` and calls it from the `label-snapshot` dispatch arm. Owns the subscribe-before-act, moderator-only, and `expectedSequence` gates; this engine handler owns only label-validation + envelope construction.
- **`moderator_ui.mod_snapshot_flow.mod_snapshot_label_input`** (refined; awaits both backend prerequisites). The label-input modal whose `submit(label)` ultimately reaches this handler via the WS path.

## What this task is

Land the methodology-engine handler that **mints `snapshot-created` events** for the moderator's labeled-snapshot flow (F10 of `docs/moderator-ui.md`). The handler is a stateless pure function consumed by the WS handler `ws_label_snapshot_message`: given `{ sessionId, label, currentSequence, moderatorId, now }`, it validates the label (trim + length-cap), mints a `snapshot_id` UUID and an event-envelope `id` UUID, and returns either a `Valid` result carrying one `EventToAppendEnvelope<'snapshot-created'>` with payload `{ snapshot_id, label, log_position: currentSequence + 1 }`, or a `Rejected` result with reason `'invalid-label'` and a descriptive `detail`.

The handler lives at `apps/server/src/methodology/handlers/createSnapshot.ts` — same directory as the four agreement-engine handlers (`commit.ts`, `vote.ts`, `markMetaDisagreement.ts`, `propose.ts`) for discoverability, but **NOT registered into the `validateAction` action registry** (see Decisions §"Standalone helper, not a registered ActionKind"). The WS layer calls it directly.

## Why it needs to be done

The `snapshot-created` event-kind has existed in `packages/shared-types` since 2026-05-10, and the projection reads it (`addSnapshot` / `snapshots()`). What has been missing throughout is the **mint side** — no server-side code constructs `snapshot-created` events. That gap blocks the F10 flow end-to-end: the moderator can type a label in the modal landed by `mod_snapshot_label_input`, but the WS handler in `ws_label_snapshot_message` has nothing to call to translate that label into an event-to-append. Closing this task gives the WS handler its terminal helper and unblocks the full F10 wire path (moderator types label → WS dispatches `label-snapshot` → engine validates + mints → WS appends + broadcasts `event-applied` → ack `snapshot-labeled`).

The boundary with the WS handler is precise: this handler owns **label validation + envelope construction**. The WS handler owns **wire-layer gates** (subscribe-before-act, moderator-only authority, `expectedSequence` optimistic-concurrency) and the **persistence / broadcast** side of the cycle. The WS handler also owns sequence-allocation (it reads `MAX(sequence)` under the row lock and passes `currentSequence` to this handler). The two layers are by design composable but unmixed.

## Inputs / context

- [`tasks/refinements/moderator-ui/mod_snapshot_label_input.md`](../moderator-ui/mod_snapshot_label_input.md) — the originating refinement. Decision §1.b registered this task; Decision §2 settled the wire envelope names; the Constraints section line 134 names `'invalid-label'` as the server-side rejection code this handler emits. Acceptance criteria line 188 names the input shape: `{ sessionId, label, currentSequence, moderatorId, now }`.
- [`tasks/refinements/data-and-methodology/snapshot_events.md`](snapshot_events.md) — the payload-shape refinement. "The snapshot is a regular event in `session_events`"; `log_position` is the snapshot event's own sequence; label cap is 128.
- [`tasks/refinements/data-and-methodology/commit_logic.md`](commit_logic.md) — sibling-handler template. Same directory layout (`apps/server/src/methodology/handlers/<action>.ts` + colocated `.test.ts`); same Vitest + Cucumber pattern per ADR 0022. **NOT** copied for the registry-registration step (this task explicitly does not register, see Decisions).
- [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts) — `ValidValidationResult` / `RejectedValidationResult` / `ValidationResult` / `EventToAppendEnvelope<K>` (lines 168-201) reused as-is; `RejectionReason` union (lines 213-298) extended by one value (`'invalid-label'`).
- [`apps/server/src/methodology/handlers/commit.ts`](../../../apps/server/src/methodology/handlers/commit.ts) — handler-file shape to mirror: leading prose comment naming the refinement + WBS link; export of a single handler function; envelope construction near the bottom (e.g. lines 451-473). Imports `EventToAppendEnvelope` from `../types.js`.
- [`apps/server/src/methodology/handlers/commit.test.ts`](../../../apps/server/src/methodology/handlers/commit.test.ts) — Vitest layout to mirror: shared id constants, leading prose comment naming the refinement, `describe` per rule, `it` per case. Uses `vitest` imports + `@a-conversa/shared-types` event types.
- [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts) — `snapshotCreatedPayloadSchema` and `SnapshotCreatedPayload`. The payload shape this handler returns matches the schema by construction; a Vitest case round-trips the returned payload through the schema to catch drift.
- [`packages/shared-types/src/limits.ts:66`](../../../packages/shared-types/src/limits.ts) — `MAX_SNAPSHOT_LABEL_LENGTH = 128`. The handler imports this and uses it both for the cap check and in the rejection `detail`.
- [`tasks/refinements/backend/ws_withdraw_proposal_message.md`](../backend/ws_withdraw_proposal_message.md) and `tests/behavior/methodology/commit.feature` — the Cucumber-at-the-pglite-seam pattern for methodology-engine handlers. Re-applied here for the snapshot scenario.
- [`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — envelope shape and the `validateEvent` contract. The handler returns a typed `EventToAppendEnvelope<'snapshot-created'>`; the calling WS layer runs `validateEvent` separately before append.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest for in-memory logic; Cucumber + pglite for at least one DB-driven scenario.

## Constraints / requirements

- **Stateless / pure-function.** No I/O, no `Projection` argument (the four agreement-engine handlers take a `Projection`; this one does not because snapshots are not facets and the projection state is irrelevant to mint-time validation). Same input → same output (modulo UUIDs minted internally; see Decisions §"UUID minting and test seam").
- **Handler signature.** `createSnapshot(input: CreateSnapshotInput): ValidationResult` where `CreateSnapshotInput` is a new type colocated in `createSnapshot.ts`:
  ```ts
  export interface CreateSnapshotInput {
    sessionId: string;
    moderatorId: string;
    label: string;            // raw client-provided label; handler trims + validates
    currentSequence: number;  // last applied sequence; the snapshot event takes currentSequence + 1
    now: string;              // ISO-8601, used as the event envelope's createdAt
  }
  ```
  The handler does not consume `sessionId` or `moderatorId` for any wire-layer gating (the WS layer owns moderator-only authority); both flow into the envelope (`sessionId` as the envelope's `sessionId`; `moderatorId` as `actor`).
- **Returns the standard `ValidationResult` shape.** Either `{ ok: true, events: [snapshotCreatedEnvelope] }` or `{ ok: false, reason: 'invalid-label', detail: string }`. Reusing the shape lets the WS handler call this helper with the same error-handling skeleton it uses for the four registered action handlers (uniform call sites).
- **Label-validation rules** (evaluated in order; first failure short-circuits):
  1. **Trim.** Apply `.trim()` to the input label. The trimmed value is what flows into the payload and into the length check.
  2. **Non-empty.** The trimmed length must be `>= 1`. Empty / whitespace-only labels → reject `'invalid-label'` with `detail: 'snapshot label cannot be empty'`.
  3. **Length cap.** The trimmed length must be `<= MAX_SNAPSHOT_LABEL_LENGTH` (128). Over-cap labels → reject `'invalid-label'` with `detail: 'snapshot label exceeds ${MAX_SNAPSHOT_LABEL_LENGTH} characters (got ${trimmed.length})'`.
- **Mints `snapshot_id` and event-envelope `id` as UUIDs.** Both are server-minted, both via `randomUUID()` from `node:crypto`. The two UUIDs are distinct entities and must not collide by construction. See Decisions §"UUID minting and test seam" for the divergence-from-convention rationale and the test seam.
- **`log_position`** = `currentSequence + 1` per [`snapshot_events.md`](snapshot_events.md) Decisions. This is also the sequence the envelope itself carries (the snapshot event points at "the state immediately at this snapshot event", which is the state the projection reaches after applying it).
- **Envelope shape.** Matches the `EventToAppendEnvelope<'snapshot-created'>` shape:
  ```ts
  {
    id: <newly-minted-UUID>,
    sessionId: input.sessionId,
    sequence: input.currentSequence + 1,
    kind: 'snapshot-created',
    actor: input.moderatorId,
    payload: {
      snapshot_id: <newly-minted-UUID>,
      label: <trimmed>,
      log_position: input.currentSequence + 1,
    },
    createdAt: input.now,
  }
  ```
- **Does not register through `validateAction`.** The four registered action kinds (`'propose' | 'vote' | 'commit' | 'mark-meta-disagreement'`) all flow through the agreement-state-machine dispatcher with a `Projection` argument and a participant-gate universal check. Snapshots are not facets, are not voted on, have no participant gate at this layer (the WS layer owns the moderator-only gate), and don't take a projection. Adding a fifth `ActionKind` would force snapshot dispatch through machinery whose preconditions don't apply (see Decisions §"Standalone helper, not a registered ActionKind"). The WS handler imports `createSnapshot` directly.
- **`RejectionReason` extension.** Add `'invalid-label'` to the `RejectionReason` union at `apps/server/src/methodology/types.ts` with a brief inline comment noting it is consumed by this handler. No other consumer today; future label-bearing handlers (none planned) can reuse.
- **No projection changes.** Don't touch `apps/server/src/projection/*`. The projection's `addSnapshot` / `snapshots()` already consume `snapshot-created` events; the read-side path is settled.
- **No schema changes.** `snapshotCreatedPayloadSchema` already enforces `min(1).max(MAX_SNAPSHOT_LABEL_LENGTH)`. The handler's pre-schema validation produces a typed `'invalid-label'` rejection so the WS layer surfaces a clean wire-error code instead of a generic `EventValidationError` from the API-layer schema-on-write pass.
- **Verifications per ADR 0022:**
  - Vitest at `apps/server/src/methodology/handlers/createSnapshot.test.ts` for the in-memory rule set.
  - Cucumber + pglite at `tests/behavior/methodology/snapshot-create.feature` for at least one DB-driven scenario per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md). Step defs at `tests/behavior/steps/methodology-snapshot.steps.ts`.

## Acceptance criteria

- New `apps/server/src/methodology/handlers/createSnapshot.ts`:
  - Leading prose comment: refinement back-link, WBS back-link, brief statement that this handler is **NOT** registered through `validateAction` and why.
  - Exports `CreateSnapshotInput` (interface) and `createSnapshot(input: CreateSnapshotInput): ValidationResult` (named export, not default — mirrors `commitHandler`'s named-export style).
  - Imports `randomUUID` from `node:crypto`, `MAX_SNAPSHOT_LABEL_LENGTH` from `@a-conversa/shared-types`, and the result types from `../types.js`.
  - Implements the three label-validation rules in order; on success constructs the `EventToAppendEnvelope<'snapshot-created'>` per the shape above.
- New `apps/server/src/methodology/handlers/index.ts` re-export: append `export { createSnapshot, type CreateSnapshotInput } from './createSnapshot.js';` so consumers (the WS handler, tests) import from the existing handlers-barrel.
- Extend `apps/server/src/methodology/types.ts` `RejectionReason` union by appending `'invalid-label'` to the appropriate section (the existing layout already groups reasons by owner — add a one-line block noting "Snapshot-label specific — owned by `snapshot_create_logic`" and the new value beneath).
- New `apps/server/src/methodology/handlers/createSnapshot.test.ts` covers:
  - **(a) valid label** — `createSnapshot({ sessionId: S, moderatorId: M, label: 'Segment 1 close', currentSequence: 7, now: T })` returns `{ ok: true, events: [env] }`; `env.kind === 'snapshot-created'`; `env.sessionId === S`; `env.sequence === 8`; `env.actor === M`; `env.createdAt === T`; `env.payload.snapshot_id` matches the UUID-v4 shape regex; `env.payload.label === 'Segment 1 close'`; `env.payload.log_position === 8`; `env.id !== env.payload.snapshot_id` (the two minted UUIDs are distinct).
  - **(b) round-trip through schema** — the returned `events[0].payload` passes `snapshotCreatedPayloadSchema.safeParse` and the returned envelope passes `validateEvent` (read from `@a-conversa/shared-types`). Pins the handler's output to the schema-on-write contract.
  - **(c) trim** — input label `'  Segment 1 close  '` produces payload `label: 'Segment 1 close'` (whitespace stripped both ends; interior preserved). Two cases: leading/trailing spaces and leading/trailing tabs/newlines (`'\t\nFoo\n\t'` → `'Foo'`).
  - **(d) empty label rejected** — `label: ''` returns `{ ok: false, reason: 'invalid-label', detail: ... }`; the detail contains the substring `'cannot be empty'`.
  - **(e) whitespace-only label rejected** — `label: '   '` (three spaces) returns the same rejection (the trim reduces it to empty before the length check).
  - **(f) over-cap label rejected** — `label: 'x'.repeat(129)` returns `{ ok: false, reason: 'invalid-label', detail: ... }`; the detail contains the substring `'exceeds 128 characters'` and includes the actual length (`got 129`).
  - **(g) exactly at-cap label accepted** — `label: 'x'.repeat(128)` returns `{ ok: true }` with the payload's `label.length === 128`.
  - **(h) trim then length check** — `label: '  ' + 'x'.repeat(128) + '  '` is accepted (the trim brings it back to exactly 128); `label: 'x'.repeat(128) + 'y'` is rejected (129 chars; no spaces to trim).
  - **(i) distinct UUIDs per call** — two consecutive `createSnapshot(...)` calls produce envelopes whose `id` values differ AND whose `payload.snapshot_id` values differ AND `id !== snapshot_id` per envelope. (Smoke test against accidental shared-constant usage; non-deterministic — relies on `randomUUID()` being a real source.)
  - **(j) `currentSequence` zero accepted** — first snapshot in a fresh session: `currentSequence: 0` yields `sequence: 1` and `log_position: 1`. The schema requires `log_position >= 1`, so `0` would fail the schema; the handler must not accept negative or `-1` here. (Negative `currentSequence` is a WS-layer invariant violation; the handler tests pin the typical-input boundary.)
- New `tests/behavior/methodology/snapshot-create.feature` covers:
  1. **Successful snapshot creation** — Given a session with sequence at N; when the engine helper is called with a valid label and `currentSequence = N`; then the result is `Valid` with one `snapshot-created` event whose `payload.log_position === N + 1` and `payload.label` matches the trimmed input.
  2. **Empty label rejected** — Given a session; when `createSnapshot` is called with `label: ''`; then the result is `Rejected` with reason `'invalid-label'`.
  3. **Over-cap label rejected** — Given a session; when `createSnapshot` is called with a 129-character label; then the result is `Rejected` with reason `'invalid-label'`.
- Step defs at `tests/behavior/steps/methodology-snapshot.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` for session/projection seeding (read-only — the scenarios do NOT need to append the snapshot event; the handler is pure and the assertion is on the returned `ValidationResult` shape).
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `snapshot_create_logic` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. (Closer does this step.)
- `pnpm run test:smoke` green (+10 from the new Vitest cases); `pnpm run test:behavior:smoke` green (+3 from the new scenarios); `make test` end-to-end green.

## Decisions

1. **Standalone helper, not a registered `ActionKind`.** `validateAction`'s registry dispatches the four agreement-engine action kinds (`propose`, `vote`, `commit`, `mark-meta-disagreement`); each requires a `Projection` argument and runs a universal participant gate before dispatch. Snapshots have none of those preconditions — there is no facet, no proposal, no agreement walk, no participant gate at the engine layer (the WS layer owns the moderator-only gate). Registering a fifth `ActionKind` for snapshots would force snapshot dispatch through machinery whose preconditions don't apply: a synthetic `SnapshotCreateAction` envelope inheriting `ActionEnvelopeBase` would carry a `requester` that the universal participant gate would check against `projection.participants`, which is a coherent check for the four agreement actions but irrelevant for snapshots (the moderator-only gate is upstream of `requireParticipant`). The WS handler `ws_label_snapshot_message` imports `createSnapshot` directly and calls it from its dispatch arm — same pattern as any other server-side helper. The handler lives in `apps/server/src/methodology/handlers/` for discoverability with the four registered handlers, but is exported and consumed as a plain function. *Alternative rejected — register as a fifth `ActionKind`*: forces `Projection` and `ActionEnvelopeBase` shapes on a helper that needs neither, complicates the dispatcher's per-kind handler-type lookup (the `ActionHandlerFor<K>` mapped type), and adds a never-triggered universal-gate evaluation cost to every snapshot mint. The gain (uniform dispatch) is illusory because the WS handler still has to package the input differently than a `MethodologyAction` (it needs the `currentSequence` it just read under the row lock; it doesn't need to construct the universal envelope fields the engine then re-extracts).

2. **Result shape mirrors `ValidationResult`.** The handler returns `{ ok: true, events: [env] }` or `{ ok: false, reason, detail }` — the same discriminated-union shape the four agreement-engine handlers return. The WS layer's dispatch arm for `label-snapshot` then uses the same `if (!result.ok) return rejection;` branch shape it uses for `commit` / `vote` / `mark-meta-disagreement`. *Alternative rejected — bespoke result type*: forces the WS layer to learn a second result shape and a second error-mapping helper. The agreement-engine result shape is general enough (a discriminated union over success-with-events and rejection-with-reason); reusing it costs nothing and saves the WS layer from learning a second shape.

3. **UUID minting and test seam.** The handler calls `randomUUID()` twice per invocation (once for the envelope `id`, once for the payload `snapshot_id`). This is a deliberate divergence from the four agreement-engine handlers' convention ("the handler does not mint timestamps or ids; the API layer mints `eventId`, `createdAt`"). The divergence is justified because (a) the snapshot-create call is not flowing through `validateAction`, so the "API layer mints envelope fields" division doesn't apply (the WS handler is the API layer here and the engine layer simultaneously); (b) the `snapshot_id` is a payload-level identity distinct from the envelope `id`, and the WS handler would otherwise mint two UUIDs and pass them through `CreateSnapshotInput`, which adds boilerplate without adding test coverage; (c) the test seam for UUID-minted output is conventional in Node — Vitest cases assert UUID-v4 shape via regex rather than equality, and the "two consecutive calls produce different UUIDs" smoke test (case (i)) catches accidental shared-constant usage. *Alternative rejected — inject a `mintUuid: () => string` factory*: adds an optional input field that production never supplies and that tests would mostly stub to a deterministic counter (the value to test is the SHAPE, not a specific UUID); the optionality also makes the handler less of a pure function in spirit. *Alternative rejected — pass both UUIDs in via `CreateSnapshotInput`*: shifts the minting to the WS layer, which then has to know to mint two distinct UUIDs (a forgotten one collapses payload-id and envelope-id and would only surface in a careful test); the handler is the right place for the domain-level invariant "envelope-id and snapshot-id are distinct UUIDs."

4. **`'invalid-label'` is a new `RejectionReason` value.** The existing union has no good fit (`'illegal-state-transition'` is for methodology-flow violations; `'inapplicable-to-facet'` is facet-specific; none of the entity/participant/proposal reasons apply). The name matches the wire-rejection code the label-input modal expects per [`mod_snapshot_label_input.md:134`](../moderator-ui/mod_snapshot_label_input.md). Adding it as a new union value follows the documented pattern in `types.ts` ("siblings may add to this union as their refinements settle additional cases"). *Alternative rejected — reuse `'illegal-state-transition'`*: misnames the failure (the snapshot IS legal; the LABEL is invalid). Surfacing `illegal-state-transition` on an over-cap label would confuse the wire client and force the UI to inspect the `detail` string to disambiguate.

5. **Trim before length check, in that order.** The trim is the canonical normalization step (consistent with the client-side `.trim()` and the disabled-when-whitespace-only submit button in the label-input modal — `mod_snapshot_label_input.md` Constraints, line 133). After trim, the non-empty and length-cap checks both run against the trimmed string, which is also the value stored in the payload. *Alternative rejected — length check on raw input, store the raw value*: lets `'abc    '` (3-char content + 4-char trailing) consume 7 chars of the cap, which is wasteful and surprising; the persisted label would then carry the trailing whitespace, which makes display alignment and equality comparisons brittle.

6. **Cucumber feature for the at-DB seam.** ADR 0022 requires at least one DB-driven scenario for handlers crossing the protocol or replay boundary. Snapshot creation does not itself cross the projection boundary (the projection's `addSnapshot` is exercised when the WS layer appends the event, which is the WS task's responsibility, not this one's). But this handler IS consumed by a wire-side dispatch arm and its output flows into `session_events` — a Cucumber scenario at the pglite-backed seed-the-session-then-call-the-helper layer is the right pin. The wire-side gates (moderator-only, subscribe-before-act, sequence-conflict) are NOT exercised here — those belong to the WS task's Cucumber feature. The three scenarios this task ships pin label-validation behavior at the handler boundary against a real (pglite-backed) projection. *Alternative rejected — skip Cucumber, rely on the WS task's Cucumber for downstream coverage*: would leave the engine handler unverified at the DB seam, repeating the gap ADR 0022 was written to close. The marginal cost of three scenarios (~80 lines of feature + step defs) is small relative to the policy clarity it preserves.

7. **No e2e (Playwright) scope.** This is a backend task with no UI surface of its own; the wire-path e2e is owned by `mod_snapshot_label_input` and the marker-render e2e is owned by `mod_snapshot_visual_marker`. The UI-stream e2e policy applies to UI tasks; backend tasks satisfy the no-throwaway-verifications standard via Vitest + Cucumber. No deferred-e2e debt to register here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- New stateless handler `apps/server/src/methodology/handlers/createSnapshot.ts`: trims label, validates non-empty + 128-char cap, mints two distinct UUIDs (envelope `id` + payload `snapshot_id`), returns `EventToAppendEnvelope<'snapshot-created'>` or `{ ok: false, reason: 'invalid-label' }`.
- New `apps/server/src/methodology/handlers/createSnapshot.test.ts`: 13 Vitest cases covering valid label, schema round-trip, trim, empty, whitespace-only, over-cap, at-cap, trim-then-cap, distinct UUIDs per call, `currentSequence=0`.
- Extended `apps/server/src/methodology/handlers/index.ts`: re-exports `createSnapshot` and `CreateSnapshotInput`.
- Extended `apps/server/src/methodology/index.ts`: top-level barrel re-export.
- Extended `apps/server/src/methodology/types.ts`: added `'invalid-label'` to `RejectionReason` union.
- Extended `apps/server/src/errors.ts`: mapped `'invalid-label'` → HTTP 400.
- Extended `apps/server/src/errors.test.ts`: exhaustive map + parametrized table coverage for new reason.
- Extended `apps/server/src/ws/protocol-docs.test.ts`: added `'invalid-label'` to `REJECTION_REASON_MAP`.
- New `tests/behavior/methodology/snapshot-create.feature`: 3 Cucumber scenarios (successful snapshot at `log_position N+1`, empty label rejected, over-cap label rejected).
- New `tests/behavior/steps/methodology-snapshot.steps.ts`: step definitions for the feature, seeding sessions via `tests/behavior/support/event-rows.ts`.
