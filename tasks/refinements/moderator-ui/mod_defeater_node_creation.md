# Moderator defeater-node-creation — capture pane + propose-action that mints Y + rebut edge Y→X in one envelope

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_defeater_flow.mod_defeater_node_creation` (see `mod_defeater_flow`
group at line 544 and this leaf at line 552).

```tji
task mod_defeater_node_creation "Create new node + rebuts edge in one action" {
  effort 1d
  allocate team
  depends !mod_capture_defeater_mode
}
```

## Effort estimate

**1d.** Confirmed. Every load-bearing seam is already in place:

- **Wire shape exists.** The `capture-node` proposal sub-kind already
  carries an optional `edge` block that mints a connecting edge inline
  ([packages/shared-types/src/events/proposals.ts L148–177](../../../packages/shared-types/src/events/proposals.ts#L148)).
  When present the propose handler emits
  `node-created` + `entity-included(node)` + `edge-created` +
  `entity-included(edge)` + `proposal` in one envelope chain (per the
  doc-block at L133–137 of that file), so the new defeater node Y AND
  the rebut edge Y→X surface on every subscriber's canvas immediately
  in `proposed` state.
- **F1 capture flow has a worked template.** The moderator's existing
  capture-with-edge path (F1 capture statement targeting an existing
  node) emits exactly this `capture-node`-with-edge envelope. The
  builder `buildCaptureNodeProposal` already exists
  ([apps/moderator/src/layout/useProposeAction.ts L207–253](../../../apps/moderator/src/layout/useProposeAction.ts#L207))
  and accepts the same `{ edgeId, otherEntity, role, direction }`
  shape this task needs. Defeater capture is a **constrained
  re-application** of that shape: `role` is locked to `'rebuts'`,
  `direction` is `'targets'`, the other-endpoint is always a node
  (the defeated target X from `captureDefeaterTargetNodeId`).
- **Mode-entry seam is shipped.** `mod_capture_defeater_mode` (commit
  `0bed258`) added `captureDefeaterTargetNodeId`,
  `enterCaptureDefeaterMode(nodeId)` (with F1-clear coupling), and
  `exitCaptureDefeaterMode()` to `useCaptureStore`. The F1 `text`
  slice is already cleared on entry, so re-using the F1 `text`
  slice for the defeater wording costs zero new slice plumbing
  (Decision §D3 records why).
- **Bottom-strip slot scaffold accepts mode-aware swaps.** `Operate.tsx`
  already conditionally swaps `textInput` / `edgeRoleSelector` /
  `proposeAction` based on per-mode booleans
  ([apps/moderator/src/routes/Operate.tsx L235–276](../../../apps/moderator/src/routes/Operate.tsx#L235)).
  Adding a fifth `isCaptureDefeaterMode` branch to each of the three
  slots is the same shape as `mod_warrant_elicitation_mode`'s
  three-slot widening landed three commits ago.
- **Propose-action helpers are reusable.** `toWireError` is exported
  from `useProposeAction.ts` as the canonical wire-error mapper
  (L269–280, with the "re-exported so sibling propose hooks consume
  the single canonical mapping" doc-block); `useProposeDecompositionAction`
  is the architectural template (snapshot-restore-on-error, in-flight
  state, `exit*Mode` on success).
- **i18n / native-review chain is established.** Four new keys × three
  locales mirrors the prior leaf's 12-catalog-entries pattern; the
  pt-BR / es-419 PENDING-flag lifecycle is unchanged.

Concrete deliverable:

- **No new captureStore slice.** Reuse the F1 `text` + `setText` slices
  for the defeater wording (Decision §D3). Add ONE new selector helper
  `selectIsCaptureDefeaterReady(state): boolean` for symmetry with
  the existing `selectIsCaptureReady` / `selectDecomposeRowsValid`
  pattern, but no new mutable slice.
- **New file `apps/moderator/src/layout/CaptureDefeaterCapturePanel.tsx`** —
  a thin labeled wrapper around a single textarea that reads
  `s.text` / writes `s.setText` and submits via the new
  `useProposeCaptureDefeaterAction` hook. Visually similar to
  `<CaptureTextInput>` but with a capture-defeater-aware aria-label,
  placeholder, and Enter-key submit wiring; renders `null` when
  `mode !== 'capture-defeater'`.
- **New file `apps/moderator/src/layout/ProposeCaptureDefeaterAction.tsx`** —
  a small button + inline error region, exactly the shape of
  `<ProposeDecompositionAction>` / `<ProposeInterpretiveSplitAction>`.
- **New hook `apps/moderator/src/layout/useProposeCaptureDefeaterAction.ts`**
  — the snapshot-restore-on-error / in-flight / success-exit hook that
  builds a `capture-node` proposal with the rebut edge inline,
  dispatches the single `propose` envelope, and on success calls
  `useCaptureStore.getState().exitCaptureDefeaterMode()`. Mirrors
  `useProposeDecompositionAction` arm-by-arm.
- **`<OperateRoute>` slot-swap extension** — three more conditional
  arms (`textInput`, `edgeRoleSelector`, `proposeAction`) keyed on a
  new derived `isCaptureDefeaterMode` boolean.
- **4 new i18n catalog keys** under `moderator.captureDefeater.*` (×3
  locales = 12 catalog entries) — see Constraints / requirements §
  i18n.
- **1 follow-up tech-debt task** registered in `tasks/35-frontend-i18n.tji`
  for native-speaker review of the 4 new pt-BR / es-419 draft entries
  (`i18n_capture_defeater_node_creation_native_review`, effort 0.5d,
  `depends !<current tail of the native-review chain>` — Closer reads
  the tail at register time).
- **Vitest cases** across the new + two touched test files (see
  Acceptance criteria § 5).
- **Playwright e2e** in `tests/e2e/moderator-capture.spec.ts` extending
  the capture-defeater-mode block this task's predecessor already
  shipped — adds: type wording → click propose → assert
  `node-created` + `edge-created` (role `rebuts`) events surface
  on the canvas in `proposed` state → mode flips back to `'idle'`.
  The wider end-to-end chain (substance pre-commit + vote-commit +
  edge-firing predicate flip) is owned by the sibling
  `mod_defeater_substance_precommit` + the existing
  `defeater-capture.feature` Cucumber pin.

## Inherited dependencies

Parent (`mod_defeater_flow`) declares
`depends !mod_capture_flow, root_app.root_moderator_cutover,
data_and_methodology.methodology_engine.defeater_capture_logic`.

Direct dep: `!mod_capture_defeater_mode` (see WBS line 555).

Settled (every gating dep is done):

- **`moderator_ui.mod_defeater_flow.mod_capture_defeater_mode`** (done
  — commit `0bed258`,
  [`mod_capture_defeater_mode.md`](mod_capture_defeater_mode.md)).
  Shipped: `captureDefeaterTargetNodeId` slice +
  `enterCaptureDefeaterMode(nodeId)` /
  `exitCaptureDefeaterMode()` helpers (with F1-clear coupling on
  entry); `'capture-defeater'` arm on `ProposalMode`,
  `MODE_KEYS`, `targetNodeId` / `exitMode` switches in
  `<ProposalModeExitAffordance>`; `<CaptureDefeaterModeExitButton>`
  thin wrapper; `'capture-defeater'` context-menu item on
  `buildNodeMenuItems`; mode-aware Escape dispatch widened to 5
  modes; 4 baseline i18n keys under `moderator.captureDefeater.*`
  + `moderator.contextMenu.node.captureDefeater`. This task is the
  **continuation** — wires up the bottom-strip capture pane + propose
  action behind the mode the predecessor already gates.
- **`data_and_methodology.methodology_engine.defeater_capture_logic`**
  (done 2026-05-10 — [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)).
  Settled the **Option B** layering: defeater capture is a UI-level
  macro built on existing event primitives — no new methodology
  handler, action variant, proposal sub-kind, event kind, or
  rejection reason. The three-event materialization (`node-created`
  for Y + `edge-created` for the rebut + `propose set-edge-substance`
  with `value: 'agreed'`) is split across THIS task (the first two
  events, sent as one `capture-node`-with-edge proposal envelope)
  and the sibling `mod_defeater_substance_precommit` (the third
  event, sent as a separate `set-edge-substance` proposal). The
  Cucumber scenario at
  [`tests/behavior/methodology/defeater-capture.feature`](../../../tests/behavior/methodology/defeater-capture.feature)
  already verifies the full three-event projection contract; this
  task's e2e verifies the first two events at the UI layer.
- **`moderator_ui.mod_capture_flow.mod_propose_action`** (done — the
  F1 propose-action shape this task mirrors). Pinned the
  `buildCaptureNodeProposal` builder (re-used directly by this
  task — Decision §D5), the `toWireError` helper, the snapshot-
  restore-on-error pattern, and the `exit*Mode()` on-success
  convention.
- **`moderator_ui.mod_decompose_flow.mod_propose_decomposition`**
  (done — [`mod_propose_decomposition.md`](mod_propose_decomposition.md)).
  Pinned the multi-stage propose hook architecture
  (`useProposeDecompositionAction`): validation gates ordered as
  pre-conditions, in-flight + lastError state, snapshot-restore on
  failure, success-side mode exit + state clear. This task's hook
  mirrors it arm-by-arm, with a simpler validator (one wording field
  vs N rows).
- **`moderator_ui.mod_decompose_flow.mod_multi_component_capture`**
  (done — [`mod_multi_component_capture.md`](mod_multi_component_capture.md)).
  Pinned the bottom-strip slot-swap convention: a mode-specific panel
  (`<DecomposeComponentsGrid>`) renders inside the `textInput` slot
  when its mode is active, `null` for `classificationPalette` /
  `edgeRoleSelector` slots, mode-specific propose-action in the
  `proposeAction` slot. This task adds the fifth `textInput` arm +
  the fifth `proposeAction` arm.
- **[ADR 0027](../../../docs/adr/0027-structural-events-emit-at-propose-time.md)**
  — structural entity events emit at propose time, so the new defeater
  node Y AND the rebut edge Y→X both surface on the canvas the
  moment the propose envelope lands (subscribers see `event-applied:
  node-created` + `event-applied: edge-created` before they see
  `event-applied: proposal`). No commit cycle required for the
  entities to appear (the proposal cycle is for the gesture record
  itself, not the entities; per the `capture-node` doc-block at
  proposals.ts L110–116).
- **[ADR 0030](../../../docs/adr/0030-wording-only-capture.md)** —
  capture is wording-only; classification, substance, and edge
  substance are named in subsequent moderator gestures. Defeater
  capture inherits the rule: the capture pane shows ONLY a wording
  textarea (no classification picker, no per-row classification),
  and the new defeater node Y's classification facet enters
  `awaiting-proposal` for later naming.
- **[ADR 0021](../../../docs/adr/0021-event-envelope.md)** — the
  envelope shape this task's propose payload conforms to; Zod
  validation at the server boundary.
- **[ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright
  case.
- **[ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — `useTranslation()` for catalog access; ICU interpolation for the
  `{targetWording}` substitution in the propose-action aria-label.
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore`
  already exposes `text`, `setText`, `proposing`, `setProposing`,
  `reset`, `mode`, `captureDefeaterTargetNodeId`,
  `exitCaptureDefeaterMode`; this task adds NO new slice and ONE
  new selector helper).
- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done —
  the F1 textarea component this task's panel mirrors). Pinned the
  `MAX_METHODOLOGY_TEXT_LENGTH` slice clamp at `setText` time, the
  Enter-key submit convention, the paste-bypass-defense slice
  behavior.

Pending edges this task FEEDS (NOT depends on):

- **`moderator_ui.mod_defeater_flow.mod_defeater_substance_precommit`**
  (downstream — depends `!mod_defeater_node_creation` per the WBS at
  [tasks/30-moderator-ui.tji:560](../../30-moderator-ui.tji#L560)).
  Builds the third macro step: a `propose set-edge-substance`
  envelope against the freshly-minted rebut edge with
  `value: 'agreed'`. Will need to identify the rebut edge id (the
  one just created by this task) and dispatch the second propose
  envelope. **This task does NOT pre-stash the rebut edge id**
  (Decision §D6) — the sibling task reads it from the projection by
  the standard "find the edge whose source = Y, target = X,
  role = 'rebuts', substance = awaiting-proposal" predicate, or via
  a transient capture-store slice the sibling adds. Either way, this
  task's surface stays narrow.
- **`moderator_ui.mod_diagnostic_resolution_flow.*`** — F7's
  `route-defeater` chip in `<OperationalizationCapturePanel>` (still
  disabled-placeholder) will eventually enter capture-defeater mode
  the same way this task's right-click menu item does; both will
  then drive this task's capture pane + propose action.
- **`frontend_i18n.i18n_capture_defeater_node_creation_native_review`**
  (registered by this task — see Acceptance criteria / Decisions).
  pt-BR / es-419 drafts of the 4 new keys land flagged PENDING; the
  follow-up replaces them with native-speaker-reviewed text.

## What this task is

Land the **capture pane + propose action** that turns capture-defeater
mode from a banner-only signal (what the predecessor shipped) into a
working F6 capture surface. The user-visible promise: a moderator
right-clicks node X, picks "Capture defeater", types the retraction-
condition's wording (Y), clicks "Capture defeater", and sees both Y
(a new node in `proposed` substance) and a `rebuts` edge Y→X (in
`awaiting-proposal` substance) appear on the canvas — the structural
shape required for the next step (pre-committing the rebut edge's
substance as `agreed`, owned by the sibling task).

Three coordinated surfaces ship in this task:

1. **Bottom-strip slot swap.** When `mode === 'capture-defeater'`:
   - `textInput` slot renders `<CaptureDefeaterCapturePanel>` (a
     single wording textarea + inline error region).
   - `edgeRoleSelector` slot renders `null` (the rebut role is
     implicit; no role/direction picker).
   - `proposeAction` slot renders `<ProposeCaptureDefeaterAction>`
     (the "Capture defeater" button + inline wire-error region).
   - `classificationPalette` slot is already `null` for all modes
     per ADR 0030 — unchanged.

2. **Single `capture-node`-with-edge propose envelope.** When the
   moderator clicks "Capture defeater":
   - The hook reads `text` (Y's wording), `captureDefeaterTargetNodeId`
     (X's id), and mints fresh UUIDs for the new node id (Y) and
     the new edge id.
   - Builds a `capture-node` proposal payload with the optional
     `edge` block: `{ edge_id, role: 'rebuts', source_node_id: Y,
     target_node_id: X }`.
   - Calls `client.send('propose', { ...envelope, proposal })`
     exactly once.
   - On success: the server emits `node-created` (Y) +
     `entity-included(node)` + `edge-created` (rebuts Y→X) +
     `entity-included(edge)` + `proposal` in the envelope chain (per
     `capture-node` doc-block, ADR 0027). All subscribers see Y +
     the rebut edge in `proposed` substance immediately. The hook
     calls `useCaptureStore.getState().exitCaptureDefeaterMode()` —
     mode flips to `'idle'`, `captureDefeaterTargetNodeId` clears,
     `text` clears (because `text` was the wording slice).
   - On failure: the hook restores `text` to the pre-propose value
     (snapshot-restore — Decision §D7); the mode stays in
     `'capture-defeater'`; `lastError` is surfaced inline so the
     moderator can edit + retry.

3. **Localized propose button + inline error surface.** Four new
   i18n keys under `moderator.captureDefeater.*` cover the button
   label, in-flight label, aria-label (with `{targetWording}` ICU
   substitution), and the wire-error inline label.

**Out of scope** (sibling-task / downstream ownership):

- **The substance pre-commit step** (`propose set-edge-substance`
  with `value: 'agreed'` against the rebut edge) — sibling task
  `mod_defeater_substance_precommit`. This task leaves the rebut
  edge in `awaiting-proposal` substance; the sibling picks up.
- **The `route-defeater` action chip wiring in
  `<OperationalizationCapturePanel>`** — owned by the F7
  resolution-path-picker.
- **A new classification picker for Y at capture time.** Per ADR 0030
  capture is wording-only; classification of Y is named later on
  the per-node card (a separate downstream gesture). Decision §D4
  records the rejection of an inline classification picker.
- **Any new captureStore slice for the defeater wording.** Reuse
  the F1 `text` slice (Decision §D3). Adding a sibling
  `defeaterNodeWording` slice was considered and rejected.
- **Server-side handler changes.** The `capture-node` propose
  handler already accepts the edge block and emits the paired
  entity events; no server change.
- **A keyboard shortcut for "Capture defeater".** Per
  `mod_capture_defeater_mode` Decision §D6 the docs list no
  defeater-specific shortcut; the context-menu entry suffices.

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_defeater_substance_precommit` cannot land without it.**
   The sibling task declares `depends !mod_defeater_node_creation`
   ([tasks/30-moderator-ui.tji:560](../../30-moderator-ui.tji#L560)).
   Until this task ships the rebut edge (Y→X with role `'rebuts'`),
   the sibling has no edge to attach a `set-edge-substance: agreed`
   proposal against.

2. **The F6 capture flow has no working UI today.** The predecessor
   shipped the mode banner + the right-click entry point + the exit
   affordance — but typing in the bottom-strip currently bleeds
   through to the F1 capture flow (which fires the wrong wire shape
   and would create a node with no rebut-edge). The mode-entry
   surface is **inert without this task**. The F6 flow per
   `docs/moderator-ui.md` step 3 ("The system creates the new node
   and a `rebuts` edge from the new node to the target") becomes
   real here.

3. **It lands the second concrete consumer of the `capture-node`
   proposal sub-kind's edge block** (the first being F1's
   capture-with-target gesture). The edge block was designed for
   this exact case (per the doc-block at proposals.ts L118–131:
   "the edge IS minted by the capture"). Wiring a second call site
   validates the abstraction's reach and exercises the polymorphic-
   endpoint slots from a different gesture, building confidence
   for the F8 meta-move flow's eventual third call site.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- [packages/shared-types/src/events/proposals.ts L148–177](../../../packages/shared-types/src/events/proposals.ts#L148)
  — `captureNodeEdgeShapeSchema` + `captureNodeProposalSchema`. The
  `edge` block is `.optional()`; when present requires
  `edge_id` (UUID), `role` (from `edgeRoleSchema` — `'rebuts'` is one
  of the seven values per [packages/shared-types/src/events/enums.ts L23](../../../packages/shared-types/src/events/enums.ts#L23)),
  and per-endpoint `(source_node_id | source_annotation_id)` +
  `(target_node_id | target_annotation_id)` with `.refine()`
  enforcing exactly-one-per-pair.
- [packages/shared-types/src/events/proposals.ts L73–146](../../../packages/shared-types/src/events/proposals.ts#L73)
  — the `capture-node` sub-kind doc-block. Confirms ADR 0030's
  wording-only stance and ADR 0027's propose-time entity emission;
  spells out the envelope chain the propose handler emits
  (`node-created` + `entity-included(node)` + `edge-created` +
  `entity-included(edge)` + `proposal`).
- [apps/moderator/src/layout/useProposeAction.ts L207–253](../../../apps/moderator/src/layout/useProposeAction.ts#L207)
  — `buildCaptureNodeProposal`. The exact builder this task
  re-uses (Decision §D5 — direct re-use, not re-implementation).
  Already handles the polymorphic-endpoint routing and the
  per-endpoint `.refine()` exactly-one-per-pair guard.
- [apps/moderator/src/layout/useProposeAction.ts L269–280](../../../apps/moderator/src/layout/useProposeAction.ts#L269)
  — `toWireError`. The exported wire-error mapper this task's hook
  consumes (the same way `useProposeDecompositionAction` does, per
  Decision §11 of `mod_propose_decomposition`).
- [apps/moderator/src/layout/useProposeAction.ts L282–500ish](../../../apps/moderator/src/layout/useProposeAction.ts#L282)
  — the F1 `useProposeAction()` hook. The architectural template
  for the snapshot-restore + in-flight + setProposing + propose-via-
  `client.send('propose', ...)` shape this task's hook mirrors.
- [apps/moderator/src/layout/useProposeDecompositionAction.ts](../../../apps/moderator/src/layout/useProposeDecompositionAction.ts)
  — the second propose-hook template; especially the
  `useProposeProposalAction` factoring that
  `useProposeDecompositionAction` calls into. Reading this confirms
  whether the new defeater hook factors into the shared
  `useProposeProposalAction` (multi-row) or stays standalone
  (single-field). Decision §D8 records the call.
- [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts)
  — `useCaptureStore`. This task reads `s.text` /
  `s.captureDefeaterTargetNodeId` / `s.mode` / `s.proposing` and
  calls `s.setText` / `s.setProposing` /
  `s.exitCaptureDefeaterMode()`. No new slice; one new free helper
  `selectIsCaptureDefeaterReady(state)` exported for
  the propose-button enabled-gate.
- [apps/moderator/src/routes/Operate.tsx L235–276](../../../apps/moderator/src/routes/Operate.tsx#L235)
  — the bottom-strip slot model. The three slots that gain a new
  `isCaptureDefeaterMode` branch: `textInput`, `edgeRoleSelector`,
  `proposeAction`. Also need to add the derived
  `isCaptureDefeaterMode = mode === 'capture-defeater'` boolean
  alongside the existing per-mode derivations.
- [apps/moderator/src/layout/CaptureTextInput.tsx](../../../apps/moderator/src/layout/CaptureTextInput.tsx)
  — the F1 textarea component. Mirror its shape (controlled
  textarea + `MAX_METHODOLOGY_TEXT_LENGTH` clamp via `setText` +
  Enter-key submit + accessible labels) in the new
  `<CaptureDefeaterCapturePanel>`. Decision §D9 records why we
  ship a distinct component rather than parameterizing the
  existing one.
- [apps/moderator/src/layout/BottomStripCapture.tsx](../../../apps/moderator/src/layout/BottomStripCapture.tsx)
  — the scaffold that accepts the three swappable slots. No change;
  the slot props already accept `ReactNode | null`.
- [apps/moderator/src/layout/ProposeDecompositionAction.tsx](../../../apps/moderator/src/layout/ProposeDecompositionAction.tsx)
  — the structural template for `<ProposeCaptureDefeaterAction>`
  (thin wrapper around the hook + button + inline error region).
- [apps/moderator/src/layout/ProposalAction.tsx](../../../apps/moderator/src/layout/ProposalAction.tsx)
  (if it exists — the shared body that `<ProposeDecompositionAction>`
  wraps; confirm via grep at implementation time) — the shared
  validation-error + wire-error inline region. Decision §D8 records
  whether the new button reuses this body or ships an inline
  variant.
- [tests/e2e/moderator-capture.spec.ts](../../../tests/e2e/moderator-capture.spec.ts)
  — the e2e spec already extended by `mod_capture_defeater_mode`
  with the mode-entry + Esc-exit test block. This task extends
  the SAME `test()` block (or adds a sibling block under the same
  `test.describe`) to cover the full type-wording → propose → see
  Y + rebut edge → mode-flip-to-idle chain.
- [packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  — the existing `moderator.captureDefeater.*` namespace (shipped
  by predecessor: `exit.ariaLabel`, `exit.tooltip`,
  `banner.targetWording`). Add 4 more keys for the capture pane +
  propose button (see § i18n).
- [tasks/refinements/data-and-methodology/defeater_capture_logic.md](../data-and-methodology/defeater_capture_logic.md)
  — Option B layering; the canonical layering doc this task
  implements.
- [tests/behavior/methodology/defeater-capture.feature](../../../tests/behavior/methodology/defeater-capture.feature)
  — the engine-side Cucumber pin (already green). This task does
  not modify it; the pin verifies the projection-side firing
  predicate behavior across the three-event sequence (this task
  delivers events 1 + 2 of the three; the sibling delivers event
  3; the predicate pin verifies the integrated behavior).
- [`docs/moderator-ui.md` L108–119](../../../docs/moderator-ui.md#L108)
  — F6 flow specification (steps 1–6). This task implements
  steps 2–3 (type wording → system creates node + rebut edge);
  predecessor shipped step 1 (trigger with X selected); sibling
  ships step 4 (pre-commit edge substance); existing event-stream
  primitives + projection cover steps 5–6.
- [`docs/data-model.md` L100–102](../../../docs/data-model.md#L100)
  — the structural shape of a defeater (regular node + `rebuts`
  edge with `substance=agreed` and source `substance != agreed`).
  This task lands the **structural shell** (node + rebut edge
  exist in `proposed` / `awaiting-proposal`); the sibling lands
  the `substance=agreed` on the edge.

Refinements consulted for style + decision continuity:

- [`mod_capture_defeater_mode.md`](mod_capture_defeater_mode.md) —
  predecessor; carry over the mode-naming convention, the
  symbol-name preservation rule (`captureDefeater*` camelCase
  from the `capture-defeater` dash-case mode value), the i18n
  namespace convention.
- [`mod_propose_action.md`](mod_propose_action.md) — F1 propose
  template; the canonical builder + wire-error mapping.
- [`mod_propose_decomposition.md`](mod_propose_decomposition.md) —
  second propose hook template; canonical snapshot-restore + in-
  flight + success-exit shape.
- [`mod_multi_component_capture.md`](mod_multi_component_capture.md)
  — bottom-strip slot-swap template for a mode-specific panel.
- [`mod_operationalization_mode.md`](mod_operationalization_mode.md)
  / [`mod_warrant_elicitation_mode.md`](mod_warrant_elicitation_mode.md)
  — the single-target sibling modes' bottom-strip panels (no
  multi-row grid). Their shape is the closest visual analog for
  the defeater capture pane.
- [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)
  — engine-side Option B layering settled.

No new ADR is required (see Decision §D11). No new dependency lands.
No public type signature changes outside the new hook + the
already-parameterised `captureNodeProposalSchema` (the schema is
unchanged; the new call site exercises the existing optional
`edge` block). No cross-workspace contract changes. No methodology
engine, projection, or wire envelope changes.

## Constraints / requirements

### Capture pane (`apps/moderator/src/layout/CaptureDefeaterCapturePanel.tsx`)

- **New file.** Renders `null` when `useCaptureStore((s) => s.mode)
  !== 'capture-defeater'` (defensive — `<OperateRoute>` already gates
  the slot swap on the same flag, but the self-gate keeps the
  component safe to import in isolation, mirroring the
  `<DecomposeComponentsGrid>` self-gate).
- **Renders one `<textarea>`** bound to `s.text` / `s.setText`, with:
  - `placeholder = t('moderator.captureDefeater.capturePane.placeholder')`
    ("Type the retraction condition that defeats this statement…").
  - `aria-label = t('moderator.captureDefeater.capturePane.ariaLabel')`
    ("Defeater wording — what would defeat the selected statement?").
  - `maxLength = MAX_METHODOLOGY_TEXT_LENGTH` (the existing slice
    clamp at `setText` time is the defense; the attribute is the
    cooperative client-side cap).
  - Enter-key submit (no Shift modifier) calls
    `proposeCaptureDefeater()` via the hook's `propose` callback,
    same shape as `<CaptureTextInput>`'s F1 submit behavior.
  - The container `data-testid` is
    `capture-defeater-capture-pane`; the textarea's `data-testid`
    is `capture-defeater-capture-pane-wording`.
- **Does NOT render** a classification picker, edge-role selector,
  target-clear button, or per-row controls. Defeater capture is
  wording-only (ADR 0030) and single-target.
- **No client-side validation rendered inline.** Validation gating
  lives on the propose button (in the hook); the panel simply
  surfaces the bound text + delegates submission.

### Propose-action button (`apps/moderator/src/layout/ProposeCaptureDefeaterAction.tsx`)

- **New file.** Renders `null` when `mode !== 'capture-defeater'`.
- **Renders a `<button>`** with:
  - Label from `t('moderator.captureDefeater.propose.label')` when
    idle ("Capture defeater"); from
    `t('moderator.captureDefeater.propose.inFlightLabel')` when
    `inFlight` is true ("Capturing defeater…").
  - `aria-label = t('moderator.captureDefeater.propose.ariaLabel',
    { targetWording })` with ICU substitution for the targeted
    node's wording ("Capture defeater against {targetWording}").
  - `disabled = !canPropose` (canPropose covers session-id +
    WS-open + target-set + wording-non-empty gates — see hook spec
    below).
  - The button's `data-testid` is
    `capture-defeater-propose-button`.
- **Renders an inline `[role="alert"]` error region** (only when
  `lastError !== undefined`) showing the localized
  `t('moderator.captureDefeater.propose.wireError.label',
  { message: lastError.message })` text. The region's
  `data-testid` is `capture-defeater-propose-wire-error`.
  Auto-dismisses on next user edit to `text` (the hook clears
  `lastError` inside the `useEffect` that watches `text`, mirroring
  `useProposeDecompositionAction`'s pattern).
- **No inline validation-error region.** When `canPropose` is false
  the button is disabled; the disabled-state tooltip is
  `t('moderator.captureDefeater.propose.disabledTooltip')`. Per
  the F1 propose convention, validation-failure messaging at click
  time would never fire because the button is disabled.

### Hook (`apps/moderator/src/layout/useProposeCaptureDefeaterAction.ts`)

- **New file.** Exposes:
  ```ts
  interface UseProposeCaptureDefeaterActionResult {
    propose: () => Promise<void>;
    canPropose: boolean;
    inFlight: boolean;
    lastError: WireError | undefined;
  }
  export function useProposeCaptureDefeaterAction():
    UseProposeCaptureDefeaterActionResult;
  ```
- **Reads** from `useCaptureStore`: `text`, `captureDefeaterTargetNodeId`,
  `mode`, `proposing`, `setProposing`, `exitCaptureDefeaterMode`,
  `setText`.
- **Reads** session id from `useParams<{ id: string }>()` (same
  pattern as `useProposeAction`).
- **Reads** WS state from `useWsStore`: `connectionStatus`, `client`.
- **`canPropose`** is `true` iff ALL of:
  - `sessionId !== ''`.
  - `connectionStatus === 'open'`.
  - `mode === 'capture-defeater'`.
  - `captureDefeaterTargetNodeId !== null`.
  - `text.trim().length > 0`.
  - `proposing === false`.
- **`propose()`** behavior on call:
  1. If `!canPropose`, return early (the button gate is the
     primary defense; this is the secondary).
  2. Snapshot `text` (for restore).
  3. Set `setProposing(true)`.
  4. Mint `nodeId` (UUID v4 — `crypto.randomUUID()`) and `edgeId`
     (UUID v4).
  5. Build the propose envelope via `buildCaptureNodeProposal({
     nodeId, wording: textNow, edge: { edgeId, otherEntity: {
     kind: 'node', id: captureDefeaterTargetNodeId },
     role: 'rebuts', direction: 'targets' } })`.
  6. Wrap in the `propose` envelope shape and call
     `client.send('propose', envelope)` (the wrapper includes
     `session_id`, `participant_id`, `proposed_at` per the
     `proposeEnvelopeSchema` — read the F1 `useProposeAction`
     for the exact envelope-construction helper / inline shape).
  7. On success: call
     `useCaptureStore.getState().exitCaptureDefeaterMode()` (which
     ALSO clears `text` via the F1-clear coupling on subsequent
     mode entries — but exit does NOT clear `text` on its own;
     manually `setText('')` after `exitCaptureDefeaterMode()`
     OR rely on the next `enterCaptureDefeaterMode`'s clear at
     re-entry. Decision §D10 records the chosen approach.)
     Then `setProposing(false)`. Clear `lastError`.
  8. On failure: `setProposing(false)`. Restore `text` to the
     snapshot. Set `lastError = toWireError(err, timeoutText)`
     (timeoutText read from
     `t('moderator.captureDefeater.propose.timeoutFallback')` or
     reused from a shared key — Decision §D8 records the choice).
     Do NOT exit the mode; the moderator may edit + retry.
- **`useEffect`** watching `text`: when `text` changes (after a
  failed propose), clear `lastError` so the inline error region
  dismisses on the next edit. Mirrors
  `useProposeDecompositionAction`'s identical effect.

### `<OperateRoute>` slot-swap extension (`apps/moderator/src/routes/Operate.tsx`)

- **New derived flag** alongside the existing per-mode derivations:
  ```ts
  const isCaptureDefeaterMode = mode === 'capture-defeater';
  ```
- **`textInput` slot**: insert the new branch BEFORE the
  `isProposalMode` branch (the panel for capture-defeater mode is
  not a "proposal mode" in the `StructuralProposalMode` sense per
  the predecessor's Decision §D3 — the exclusion list correctly
  drops `'capture-defeater'`):
  ```jsx
  isWarrantElicitationMode ? (
    <WarrantElicitationCapturePanel />
  ) : isOperationalizationMode ? (
    <OperationalizationCapturePanel />
  ) : isCaptureDefeaterMode ? (
    <CaptureDefeaterCapturePanel />
  ) : isProposalMode ? (
    ...
  ) : (
    <CaptureTextInput ... />
  )
  ```
- **`edgeRoleSelector` slot**: widen the disabling condition:
  ```jsx
  edgeRoleSelector={
    isWarrantElicitationMode || isOperationalizationMode
      || isCaptureDefeaterMode || isProposalMode
      ? null
      : <CaptureTargetAndRole />
  }
  ```
- **`proposeAction` slot**: insert the new branch alongside the
  existing per-mode branches:
  ```jsx
  proposeAction={
    isDecomposeMode ? (
      <ProposeDecompositionAction />
    ) : isInterpretiveSplitMode ? (
      <ProposeInterpretiveSplitAction />
    ) : isCaptureDefeaterMode ? (
      <ProposeCaptureDefeaterAction />
    ) : isOperationalizationMode || isWarrantElicitationMode ? (
      null
    ) : (
      <ProposeAction />
    )
  }
  ```

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.captureDefeater.capturePane.placeholder` | "Type the retraction condition that defeats this statement…" | "Digite a condição de retratação que refuta esta afirmação…" | "Escribe la condición de retractación que refuta esta afirmación…" |
| `moderator.captureDefeater.capturePane.ariaLabel` | "Defeater wording — what would defeat the selected statement?" | "Texto da refutação — o que refutaria a afirmação selecionada?" | "Texto de la refutación — ¿qué refutaría la afirmación seleccionada?" |
| `moderator.captureDefeater.propose.label` | "Capture defeater" | "Capturar refutação" | "Capturar refutación" |
| `moderator.captureDefeater.propose.inFlightLabel` | "Capturing defeater…" | "Capturando refutação…" | "Capturando refutación…" |

**Count: 4 keys × 3 locales = 12 catalog entries.** pt-BR / es-419
drafts land flagged PENDING in `pt-BR.review.json` +
`es-419.review.json` (8 PENDING entries total). The
predecessor's existing `moderator.captureDefeater.*` keys
(`exit.{ariaLabel,tooltip}`, `banner.targetWording`,
`contextMenu.node.captureDefeater`) are unchanged.

**Reuses** for the ARIA label + tooltip + error region (no new keys
needed):

- The propose-button's ICU `{targetWording}` substitution in the
  `aria-label` reuses the same `targetWording` slot pattern that
  the predecessor's `banner.targetWording` uses; the rendered
  string is composed by `t('moderator.captureDefeater.propose.label')`
  + a separate `aria-label` attribute using a new key (above table
  row 3 — `propose.label` is reused for visible text AND the
  aria-label can simply read the same `label` key; Decision §D8
  records this — the `propose.label` ICU value is "Capture
  defeater", and the rendered aria-label is the same string. The
  ICU-`targetWording` substitution stays on the
  `banner.targetWording` overlay above the button, NOT on the
  button itself, to avoid a 5th i18n key.)
- The disabled-state tooltip on the button reuses the existing
  `moderator.captureDefeater.exit.tooltip` is NOT appropriate
  (that's for the exit button); ship `propose.disabledTooltip` as
  a 5th key if needed. **Decision: avoid the 5th key by surfacing
  the disable-reason inline below the button** when `!canPropose`
  AND there's a specific user-recoverable cause (e.g.,
  "Type a wording to capture" when only the wording is missing).
  Reuse `moderator.captureDefeater.capturePane.placeholder` text
  as the hint; no new key.
- The wire-error inline region's label reuses the F1
  `moderator.propose.wireError.label` key already shipped by
  `mod_propose_action` (Decision §D8 records the cross-module
  reuse — same wire-error shape, same prefix wording, no new key
  per ADR 0024's "reuse before mint" guidance).

**Total new keys: 4** (matches the predecessor's count of 4, per
the orchestrator's i18n-pattern guidance).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/CaptureDefeaterCapturePanel.tsx` (new file).
- `apps/moderator/src/layout/CaptureDefeaterCapturePanel.test.tsx` (new file).
- `apps/moderator/src/layout/ProposeCaptureDefeaterAction.tsx` (new file).
- `apps/moderator/src/layout/ProposeCaptureDefeaterAction.test.tsx` (new file).
- `apps/moderator/src/layout/useProposeCaptureDefeaterAction.ts` (new file).
- `apps/moderator/src/layout/useProposeCaptureDefeaterAction.test.ts` (new file).
- `apps/moderator/src/routes/Operate.tsx` (modified — new derived flag +
  three slot-arm extensions).
- `apps/moderator/src/routes/Operate.test.tsx` (modified — new test
  cases asserting the three slot swaps).
- `apps/moderator/src/stores/captureStore.ts` (modified — add
  one exported free helper `selectIsCaptureDefeaterReady`).
- `apps/moderator/src/stores/captureStore.test.ts` (modified — one
  case for the new selector).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 4 new keys).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 4 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — extend the
  capture-defeater-mode `test()` block).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_defeater_node_creation` lands
  at task-completion time per the README ritual. The Closer also
  adds the new `i18n_capture_defeater_node_creation_native_review`
  task to `tasks/35-frontend-i18n.tji` per tech-debt registration.
- `docs/adr/` — no new ADR (Decision §D11).
- `apps/server/src/` — no server-side change. The `capture-node`
  proposal handler already accepts the optional `edge` block and
  emits the paired entity events per `defeater_capture_logic.md`
  Option B + ADR 0027.
- `packages/shared-types/src/events/proposals.ts` — schema unchanged.
  The new call site exercises the existing optional `edge` block.
- `apps/moderator/src/stores/captureStore.ts` — no new mutable slice.
  One exported free helper only.
- `apps/moderator/src/layout/CaptureTextInput.tsx` — unchanged. A
  parallel component is shipped rather than parameterizing the F1
  textarea (Decision §D9).
- `apps/moderator/src/layout/useProposeAction.ts` — unchanged. The
  `buildCaptureNodeProposal` builder + `toWireError` mapper are
  consumed via the existing exports.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — unchanged. The
  context-menu wiring already lands the mode-entry via the
  predecessor's `'capture-defeater'` menu item.
- `apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx` —
  unchanged. The exit affordance already shipped by the predecessor
  works unchanged for this task's flow.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — unchanged.
  The scaffold already accepts any `ReactNode` for its slot props.

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 14 across the four new test
  files + two extended test files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (parity
  check) green after the catalog edits.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green; the extended
  capture-defeater-mode e2e scenario passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_defeater_node_creation` AND
  the new `i18n_capture_defeater_node_creation_native_review` task
  block.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The full defeater-node-creation flow is reachable from a real user
flow as of this task: log in → create session → seed a node X →
right-click → "Capture defeater" → type wording → click "Capture
defeater" → see Y + rebut edge surface on canvas → mode flips to
idle. Per the UI-stream e2e default, the Playwright spec is **scoped
under Acceptance criteria, NOT deferred** (see § 6). The substance
pre-commit + vote-commit + firing-predicate flip chain is owned by
the sibling `mod_defeater_substance_precommit` + the existing
`defeater-capture.feature` Cucumber pin.

## Acceptance criteria

### 1. Capture pane

- `<CaptureDefeaterCapturePanel>` renders `null` when
  `useCaptureStore.getState().mode !== 'capture-defeater'`.
- When `mode === 'capture-defeater'`, the panel renders a single
  `<textarea>` with `data-testid="capture-defeater-capture-pane-wording"`,
  bound bidirectionally to `useCaptureStore`'s `text` slice via
  `s.setText`.
- Typing in the textarea calls `setText` exactly once per character
  (the slice clamp at `MAX_METHODOLOGY_TEXT_LENGTH` is exercised by
  pasting > 10000 chars and asserting the slice clamps).
- Pressing Enter (no Shift) in the textarea calls the propose
  callback (verified by spying on the hook).
- The panel does NOT render a classification picker, edge-role
  selector, target-clear button, or per-row controls.

### 2. Propose button + hook

- `<ProposeCaptureDefeaterAction>` renders `null` when
  `mode !== 'capture-defeater'`.
- When in the mode, it renders a button with
  `data-testid="capture-defeater-propose-button"`, label
  "Capture defeater" (resolved from
  `moderator.captureDefeater.propose.label`), and `aria-label`
  resolved from the same key (cross-checks the no-5th-key
  decision).
- `disabled` is `true` when ANY of the canPropose gates fail
  (session-id empty / WS not open / mode wrong / target null /
  text empty-after-trim / proposing in flight). Asserted across
  six tests, one per gate.
- Clicking the enabled button:
  1. Calls `client.send('propose', envelope)` exactly once.
  2. The envelope's `proposal` payload has `kind === 'capture-node'`.
  3. The payload's `node_id` is a UUID v4 (new node id).
  4. The payload's `wording` equals the trimmed-or-as-typed `text`
     slice value at click time.
  5. The payload's `edge` block is present with:
     - `edge_id`: a UUID v4 (new edge id, distinct from
       `node_id`).
     - `role: 'rebuts'`.
     - `source_node_id`: the new node id (Y).
     - `target_node_id`: the value of
       `captureDefeaterTargetNodeId` at click time (X).
     - The annotation-endpoint slots
       (`source_annotation_id`, `target_annotation_id`) are
       absent (per `captureNodeEdgeShapeSchema`'s
       exactly-one-per-pair refinement; this task's defeater
       capture is always node-to-node since the right-click
       menu item only attaches to nodes).
- On `client.send` resolving successfully:
  - `useCaptureStore.getState().exitCaptureDefeaterMode()` is
    called exactly once (mode → `'idle'`;
    `captureDefeaterTargetNodeId` → `null`).
  - `setText('')` is called once to clear the wording slice.
  - `setProposing(false)` is called once.
  - `lastError` is `undefined`.
- On `client.send` rejecting with a `WsRequestError`:
  - `setProposing(false)` is called once.
  - `text` is restored to the snapshot taken before the call.
  - `mode` remains `'capture-defeater'` (NOT exited).
  - `captureDefeaterTargetNodeId` remains set.
  - `lastError` is `{ code: err.code, message: err.message }`.
  - The inline error region renders the localized wire-error label
    (cross-checked against the F1 wire-error reuse).
- After a failed propose, the next `setText` call (user edit)
  clears `lastError` and dismisses the inline error region.

### 3. Bottom-strip slot swap

- When `mode === 'capture-defeater'`, the `Operate.tsx` route
  renders:
  - `<CaptureDefeaterCapturePanel>` in the `textInput` slot (NOT
    `<CaptureTextInput>` / `<DecomposeComponentsGrid>` / etc.).
  - `null` in the `edgeRoleSelector` slot.
  - `<ProposeCaptureDefeaterAction>` in the `proposeAction` slot
    (NOT `<ProposeAction>` / `<ProposeDecompositionAction>` /
    etc.).
  - `null` in the `classificationPalette` slot (unchanged from
    ADR 0030 baseline).
- When `mode === 'idle'`, the slot swap reverts: `<CaptureTextInput>`
  in `textInput`, `<CaptureTargetAndRole>` in `edgeRoleSelector`,
  `<ProposeAction>` in `proposeAction`. (Regression pin for the
  four existing modes remains green.)
- When `mode === 'decompose'` / `'interpretive-split'` /
  `'operationalization'` / `'warrant-elicitation'`, the slot
  swap is unchanged from the pre-this-task behavior.

### 4. captureStore helper

- A new exported free helper `selectIsCaptureDefeaterReady(state):
  boolean` returns `true` iff:
  - `state.mode === 'capture-defeater'`
  - `state.captureDefeaterTargetNodeId !== null`
  - `state.text.trim().length > 0`
  - `state.proposing === false`
- Used by the hook's `canPropose` calculation (alongside the
  session-id + WS-connection gates which live outside the store).

### 5. Vitest cases (per ADR 0022)

Minimum 14 new cases across the four new test files + two extended:

**`apps/moderator/src/layout/CaptureDefeaterCapturePanel.test.tsx`** (new file, ≥ 3 cases):

1. Renders `null` when mode is `'idle'`.
2. When in capture-defeater mode, renders a textarea bound to
   `s.text` and a localized placeholder / aria-label.
3. Enter-key (no Shift) calls the prop'd `onSubmit` callback;
   Shift+Enter does NOT (inserts a newline per the F1 convention).

**`apps/moderator/src/layout/ProposeCaptureDefeaterAction.test.tsx`** (new file, ≥ 3 cases):

4. Renders `null` when mode is `'idle'`.
5. Renders the button with the localized label + aria-label when
   in capture-defeater mode.
6. `disabled` toggles correctly across the six canPropose gates
   (one expect per gate).

**`apps/moderator/src/layout/useProposeCaptureDefeaterAction.test.ts`** (new file, ≥ 6 cases):

7. `canPropose` is `false` when text is empty / target null / mode
   wrong / WS closed / session id empty / `proposing` is true (one
   case per gate — combinable into one parameterized case).
8. `propose()` builds the correct `capture-node` envelope with the
   `edge` block (assert the shape per Acceptance criterion 2.5).
9. `propose()` on success calls `exitCaptureDefeaterMode` +
   `setText('')` + clears `lastError`.
10. `propose()` on `WsRequestError` restores `text` snapshot +
    surfaces `lastError` + leaves mode + target in place.
11. `propose()` on `WsRequestTimeoutError` surfaces a timeout
    `lastError` with the localized fallback message.
12. After a failed propose, editing `text` clears `lastError`.

**`apps/moderator/src/routes/Operate.test.tsx`** (extended, ≥ 1 case):

13. When `mode === 'capture-defeater'`: the three slot swaps land
    (capture-defeater panel in textInput, null in edgeRoleSelector,
    capture-defeater action in proposeAction) — asserted by
    testids.

**`apps/moderator/src/stores/captureStore.test.ts`** (extended, ≥ 1 case):

14. `selectIsCaptureDefeaterReady` returns the correct boolean
    across the four-input truth table corner cases.

### 6. Playwright e2e (extend `moderator-capture.spec.ts`)

Extend the existing capture-defeater-mode `test()` block (or add a
sibling `test()` under the same `test.describe`) with these steps:

```ts
test('capture-defeater mode: type wording → click "Capture defeater" → see Y + rebut edge land', async ({ page }) => {
  // 1. Login + create session + seed node X (same setup as the
  //    predecessor's test block).
  //    Seeded node 'x1' has wording "Workers should earn a living wage."

  // 2. Right-click x1 → click "Capture defeater" (predecessor's
  //    flow). Assert mode banner shows "Capture defeater".

  // 3. Assert the capture pane is mounted with the wording textarea.
  await expect(page.getByTestId('capture-defeater-capture-pane-wording')).toBeVisible();

  // 4. Assert the propose button is disabled before typing.
  await expect(page.getByTestId('capture-defeater-propose-button')).toBeDisabled();

  // 5. Type defeater wording.
  await page.getByTestId('capture-defeater-capture-pane-wording').fill(
    'Cost-of-living adjustments fully cover all worker expenses.',
  );

  // 6. Assert the propose button is now enabled.
  await expect(page.getByTestId('capture-defeater-propose-button')).toBeEnabled();

  // 7. Click propose.
  await page.getByTestId('capture-defeater-propose-button').click();

  // 8. Assert mode banner reverts to idle (exitCaptureDefeaterMode fired).
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');

  // 9. Assert the new defeater node Y is visible on the canvas with
  //    the typed wording (proposed-state styling, per ADR 0027 the
  //    node-created event lands at propose-time).
  await expect(
    page.locator('[data-node-wording*="Cost-of-living"]'),
  ).toBeVisible();

  // 10. Assert a new rebut edge Y → X is visible on the canvas
  //     (role=rebuts, awaiting-proposal substance — the edge surfaces
  //     immediately per the capture-node envelope chain).
  await expect(page.locator('[data-edge-role="rebuts"]')).toBeVisible();
});
```

The test asserts the full type-wording → propose → see-Y-and-rebut-edge
chain. The substance-precommit + vote-commit + firing-predicate flip
chain is the sibling task's e2e scope; the Cucumber
`defeater-capture.feature` already pins the projection-side firing
behavior.

### 7. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_defeater_node_creation` block
  gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_capture_defeater_node_creation_native_review` is added
  (effort 0.5d; `depends !<current tail of the native-review
  chain>` — Closer reads the tail at register time).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

New native-review task template (Closer registers mechanically):

```
task i18n_capture_defeater_node_creation_native_review "Native-speaker review of pt-BR + es-419 capture-defeater-node-creation strings (4 keys: moderator.captureDefeater.{capturePane.placeholder,capturePane.ariaLabel,propose.label,propose.inFlightLabel})" {
  effort 0.5d
  allocate team
  depends !<current native-review tail>
  note "Source of debt: mod_defeater_node_creation (this commit) — pt-BR and es-419 drafts of the 4 new keys landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (capture-pane placeholder + aria-label + propose-button label + in-flight label). Check the 'Capturing defeater…' progressive verb form in each locale matches the cadence used by the F1 propose-button's existing in-flight key (consistency with moderator.propose.inFlightLabel if shipped)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 8. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### D1. Scope: capture-pane + propose-action for the first two of three macro events

This task ships steps 2–3 of the F6 flow (type wording → system
creates node + rebut edge). Steps 1 (mode entry + target select) and
4 (substance pre-commit) are owned by the predecessor and sibling
respectively. Bundling steps 1+2+3+4 into one 2-3d task was
considered and rejected — the WBS already splits them; the predecessor
shipped the mode-entry seam; the sibling can land independently
because the rebut edge it operates against is already in the
projection after this task.

### D2. Wire shape: single `propose` envelope with `capture-node`-with-edge payload (NOT two separate `node-created`/`edge-created` envelopes)

This is the load-bearing technical decision and deserves the most
context.

The `defeater_capture_logic.md` Decisions §2 + 3 (lines 75–82)
described the F6 flow as "three event-stream operations" —
`node-created` + `edge-created` (rebuts) + `propose set-edge-substance`
(agreed). Read in isolation that wording suggests the moderator client
might send the entity-creation events DIRECTLY (bypassing a propose
envelope).

But the wire protocol does not support direct client-emitted
entity-creation. Per
[packages/shared-types/src/ws-envelope.ts](../../../packages/shared-types/src/ws-envelope.ts),
the closed enum of client→server request types is
`'propose' | 'vote' | 'commit' | 'mark-meta-disagreement' |
'snapshot' | 'catch-up' | 'withdraw-proposal' | 'withdraw-agreement'`.
`node-created` and `edge-created` are server-emitted broadcasts only
(inside `event-applied` envelopes), not client-sendable.

The mechanism by which the moderator client triggers a `node-created`
event is the `capture-node` proposal sub-kind. Per the doc-block at
[proposals.ts L95–146](../../../packages/shared-types/src/events/proposals.ts#L95):

- When `edge` is `undefined`, the propose handler emits
  `node-created` + `entity-included(node)` + `proposal`.
- When `edge` is present, the propose handler emits
  `node-created` + `entity-included(node)` + `edge-created` +
  `entity-included(edge)` + `proposal`.

So the F6 "two direct entity-creation events" of
`defeater_capture_logic.md`'s Option B are produced **server-side**
in response to a single `propose capture-node` envelope that carries
the `edge` block — they're the entity-fan-out events ADR 0027 added
to the propose handler. The third event (`propose set-edge-substance`)
is a separate propose envelope, sent by the sibling task.

Considered alternatives:

- **(a) Two REST entity-creation endpoints + one WS propose**
  (matches a naive reading of `defeater_capture_logic.md`'s
  "ask the API to write a node-created" phrasing). *Rejected.* No
  such REST endpoints exist; the wire-protocol enum is closed; the
  doc-block on `capture-node` (L133–137) is the canonical worked
  shape for "moderator-initiated entity creation."
- **(b) A new `'defeater-capture'` proposal sub-kind** that the
  server expands into the three events. *Rejected.* The hard
  constraint in `defeater_capture_logic.md` Decisions §1 forbids
  new proposal sub-kinds; the rejection rationale is sound (Option
  A on the original menu was that option; the project picked Option
  B). The `capture-node`-with-edge shape already exists for the
  exact purpose this task needs.
- **(c) Two SEPARATE `propose capture-node` envelopes — one for Y
  with `edge=undefined`, then one for the rebut edge.** *Rejected.*
  The `capture-node` proposal's `edge` field is for capturing a
  connecting edge AT THE SAME TIME as the node is captured. There
  is no `'capture-edge'` proposal sub-kind for retroactively
  attaching an edge to an existing node. Splitting into two would
  also break the "the new defeater node Y AND the rebut edge appear
  on the canvas in one frame" promise (ADR 0027's user-visible
  contract).
- **(d) Single `propose capture-node` envelope with the `edge` block
  (Y as source, X as target, role 'rebuts').** **Chosen.** The
  wire shape is already exercised by the F1 capture-with-target
  path; the propose handler already fans out the paired
  `node-created` + `edge-created` events per ADR 0027; both
  entities surface on every subscriber's canvas immediately in
  `proposed` / `awaiting-proposal` substance; the sibling task can
  attach a `set-edge-substance` proposal to the rebut edge by
  predicate-matching against the projection.

The F1 capture-with-target path and the F6 defeater-capture path
become **two consumers of the same propose sub-kind**, distinguished
by:

- The edge `role` (F1: arbitrary, picked from the edge-role selector;
  F6: locked to `'rebuts'`).
- The edge `direction` (F1: per the F1 toggle; F6: always `'targets'`
  — Y is the source rebutting X).
- The target endpoint kind (F1: node OR annotation per the
  polymorphic-endpoint widening; F6: always a node — defeaters
  rebut statements, and the right-click menu item that enters
  capture-defeater mode only attaches to node entities).

### D3. State location: reuse the F1 `text` slice for the defeater wording (NO new mutable slice)

Considered alternatives for storing Y's wording:

- **(a) New `defeaterNodeWording: string` slice on `useCaptureStore`
  with its own setter.** *Rejected.* Adds a slice that is exactly
  isomorphic to the F1 `text` slice (string, MAX_METHODOLOGY_TEXT_LENGTH
  clamp, same Enter-submit semantics). The four prior per-mode
  refinements (decompose, interpretive-split, operationalization,
  warrant-elicitation) each added their own slices because their
  capture surfaces were structurally different from F1 (multi-row
  grid, per-row classification, multi-textarea answer chips). The
  defeater case is the FIRST single-textarea per-mode surface
  whose shape is identical to F1's — no rows, no per-row controls,
  no classification picker. Adding a slice when the F1 slice
  suffices is mode-state proliferation for its own sake.
- **(b) Reuse the F1 `text` slice.** **Chosen.** The
  `enterCaptureDefeaterMode(nodeId)` helper already clears
  `text` on entry (the F1-clear coupling the predecessor shipped),
  so there's no risk of F1-state bleed-through. The `<CaptureDefeater
  CapturePanel>` and the F1 `<CaptureTextInput>` are never mounted
  simultaneously (the bottom-strip slot swap is mode-aware); they
  cannot fight over the slice. The propose hook reads
  `text` at click time; on success it calls
  `exitCaptureDefeaterMode()` + `setText('')` to leave the slice
  clean for the next gesture. On failure it restores `text` from a
  pre-call snapshot.

The decision is a small but real departure from the "each mode owns
its own slice" precedent. The justification: the precedent was
informed by structurally-different capture shapes; the defeater case
is structurally-identical, and the "shared because identical" rule
is more load-bearing than the "one slice per mode for symmetry"
rule. Decision §D3 records this so future per-mode leaves with
single-textarea shapes (e.g., F8 meta-move) can reuse the same
pattern.

A trivial cost: tests that read `s.text` to assert defeater wording
look identical to tests that read `s.text` to assert F1 wording —
the test name is the only discriminator. Vitest case naming
discipline mitigates.

### D4. No classification picker in the defeater capture pane

Per ADR 0030 capture is wording-only; the new defeater node Y's
classification facet enters `awaiting-proposal` and is named in a
later moderator gesture (per the per-node card's classification
mechanism, owned by `pf_mod_capture_pane_wording_only`'s downstream
chain). Adding an inline classification picker here would re-introduce
the bundled-capture path ADR 0030 retired.

The moderator can name Y's classification immediately after the
defeater capture lands (Y is visible on the canvas in `proposed`
substance; clicking Y opens the per-node card; the classification
gesture happens there). Two-gesture flow is the ADR 0030 baseline;
defeater capture is consistent.

### D5. Reuse `buildCaptureNodeProposal` directly (no new builder)

The F1 `buildCaptureNodeProposal` at
[useProposeAction.ts L207–253](../../../apps/moderator/src/layout/useProposeAction.ts#L207)
already produces the exact envelope shape this task needs. The
defeater hook calls:

```ts
const proposal = buildCaptureNodeProposal({
  nodeId,
  wording: textNow,
  edge: {
    edgeId,
    otherEntity: { kind: 'node', id: captureDefeaterTargetNodeId },
    role: 'rebuts',
    direction: 'targets',
  },
});
```

Considered: a new `buildDefeaterCaptureProposal` builder. *Rejected* —
the call is a four-field thunk; ceremony adds nothing. The
F1-side `buildCaptureNodeProposal` is already exported and consumed
by F1's hook; defeater becomes the second consumer, validating the
abstraction.

### D6. Do not pre-stash the rebut edge id for the sibling task

The sibling `mod_defeater_substance_precommit` will need the rebut
edge's id (to address it in a `set-edge-substance` proposal). This
task COULD stash the just-minted `edgeId` in a transient
`pendingRebutEdgeId` slice for the sibling to read.

Considered alternatives:

- **(a) Stash `edgeId` in a transient slice
  `pendingRebutEdgeId` cleared on `exitCaptureDefeaterMode`.**
  *Rejected.* The sibling task owns its own state needs; this task
  predicting them is premature coupling. If the sibling needs the
  rebut edge id by the next gesture (a likely UX: enter
  capture-defeater mode → type wording → propose → immediately
  pop into a "now pre-commit the substance" sub-flow), the sibling
  can either: (i) add its own transient slice + this task's hook
  populates it before calling `exitCaptureDefeaterMode`; or (ii)
  read the projection for "the most recently created `rebuts` edge
  whose target is the just-captured X". Both are sibling-side
  decisions.
- **(b) Don't stash; let the sibling decide.** **Chosen.** Keeps this
  task narrow. The sibling refinement's Decisions section will
  pick its own retrieval mechanism without being constrained by a
  pre-stashed slice this task half-built.

### D7. Snapshot-restore-on-error: snapshot `text` only (not `captureDefeaterTargetNodeId`)

The mode + target slot ARE NOT cleared on a failed propose (the
moderator should be able to edit + retry against the same target).
Only `text` is snapshotted-and-restored because the helper may have
mutated it during the in-flight render (e.g., a controlled-component
update that fires before the failure is recognized).

Same pattern as `useProposeDecompositionAction`'s row snapshot.

### D8. Inline / cross-module key reuse to keep the new-key count at 4

The orchestrator's brief calls out: "Ensure the i18n pattern (4 keys
× 3 locales) is continued for any new user-facing strings." The
predecessor shipped 4 new keys; this task ships 4 new keys (per the
table in Constraints / requirements § i18n). Three reuses keep the
count at 4 instead of 6+:

- **Propose-button aria-label reuses `propose.label`.** Rendering
  the same "Capture defeater" string for both visible text and
  aria-label keeps the i18n surface narrow; the `{targetWording}`
  ICU substitution lives on the existing `banner.targetWording`
  overlay above the button (the visual answer to "defeating
  what?"), so the button itself does not need a more-elaborate
  aria-label.
- **Wire-error inline-region label reuses
  `moderator.propose.wireError.label`** (already shipped by F1's
  `mod_propose_action`). Same shape, same wording prefix, no
  defeater-specific phrasing. The reuse is consistent with ADR
  0024's "reuse before mint" principle and with the F1/decompose
  precedent (`useProposeDecompositionAction` reuses the same key).
- **Disabled-state hint reuses
  `moderator.captureDefeater.capturePane.placeholder`** for the
  "Type a wording to capture" cue when the button is disabled
  only on wording-empty. Other disable reasons (WS closed,
  session missing) are infrastructure-level and not user-recoverable;
  no localized hint is needed (the connection-status banner shipped
  by the WS connection-status feature owns that surface).

### D9. Distinct `<CaptureDefeaterCapturePanel>` rather than parameterizing `<CaptureTextInput>`

Considered alternatives:

- **(a) Parameterize `<CaptureTextInput>`** with a `placeholderKey` /
  `ariaLabelKey` / `onSubmit` set, swap props based on mode.
  *Rejected.* The F1 component carries F1-specific behaviors (a
  `<CaptureTargetAndRole>` sibling-coupling for the target/role
  inline edits, a F1-specific onChange callback signature, an F1
  Enter-submit that wires through to `useProposeAction`). Each
  parameterization adds a branch in the F1 path that must be tested
  in both modes; the cumulative complexity grows fast as more modes
  ship.
- **(b) Distinct `<CaptureDefeaterCapturePanel>` thin wrapper.**
  **Chosen.** Mirrors the prior single-textarea per-mode
  precedents (`<OperationalizationCapturePanel>`,
  `<WarrantElicitationCapturePanel>`). The panel is ~30 lines
  including imports; the duplication cost is real but contained.
  Future de-duplication (a `<SingleWordingCapturePanel>` base shared
  by operationalization + warrant-elicitation + defeater) is
  available as a refactor when a fourth single-textarea mode lands
  — premature to do it for the third.

### D10. Post-success `setText('')` rather than relying on the next mode entry's F1-clear

`exitCaptureDefeaterMode()` does NOT clear `text` (it only resets
`mode` and `captureDefeaterTargetNodeId`). After a successful
defeater propose, the moderator returns to idle mode; the F1 capture
pane is now visible. If `text` is not cleared, the F1 pane shows
the just-proposed defeater wording, which would be confusing
("did my propose succeed?" / "is this a draft of a different F1
statement?").

The hook explicitly calls `setText('')` after
`exitCaptureDefeaterMode()`. The order:
1. `exitCaptureDefeaterMode()` — flip mode + clear target.
2. `setText('')` — clear the wording slice.
3. `setProposing(false)` — release the propose lock.
4. (Optional) Clear `lastError` if any prior failure left it set.

Alternatively the hook could call `setText('')` BEFORE
`exitCaptureDefeaterMode()` to keep the order "clear slices first,
then mode" — but the user-visible result is identical because both
slice writes happen synchronously inside a single React render pass.
Either ordering is acceptable; the test asserts the post-state, not
the call order.

### D11. No new ADR

Five potential triggers, all dispatched:

- **"Reusing the F1 `text` slice for a per-mode capture is
  ADR-worthy."** No — Decision §D3 surfaces the rationale; the
  precedent informs future per-mode leaves but does not establish a
  new architectural constraint.
- **"Wiring a second consumer of the `capture-node`-with-edge
  proposal sub-kind is ADR-worthy."** No — the sub-kind was
  designed for exactly this case (the doc-block at proposals.ts
  L118–131 spells out the "the edge IS minted by the capture"
  intent); the F1 path is the first consumer, defeater is the
  second.
- **"Locking the edge role to `'rebuts'` at the call site is
  ADR-worthy."** No — the F1 path picks role dynamically; the
  defeater path picks it statically because the methodology
  prescribes `'rebuts'` for this specific gesture (docs/methodology.md
  L114). No new abstraction; same call shape, different argument.
- **"The wording-only stance for defeater capture is ADR-worthy."**
  No — ADR 0030 already covers this for all capture gestures
  uniformly.
- **"The single-envelope-with-fan-out delivery is ADR-worthy."** No
  — ADR 0027 (structural events emit at propose time) already
  settles this for the `capture-node` sub-kind; this task is the
  second leaf to consume the contract (F1 was first).

The architectural choices this task implements were all settled by
prior tasks or are localized implementation details.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- Shipped `apps/moderator/src/layout/CaptureDefeaterCapturePanel.tsx` — single-textarea capture pane for the `capture-defeater` mode, bound to the F1 `text` / `setText` slices, with Enter-key submit wiring and `data-testid="capture-defeater-capture-pane-wording"`.
- Shipped `apps/moderator/src/layout/ProposeCaptureDefeaterAction.tsx` — propose button + inline `[role="alert"]` wire-error region; renders `null` when `mode !== 'capture-defeater'`.
- Shipped `apps/moderator/src/layout/useProposeCaptureDefeaterAction.ts` — snapshot-restore-on-error hook that builds a `capture-node` proposal with the rebut-edge block (`role: 'rebuts'`, `direction: 'targets'`, target = `captureDefeaterTargetNodeId`), dispatches the single `propose` envelope, and on success calls `exitCaptureDefeaterMode()` + `setText('')`.
- Extended `apps/moderator/src/routes/Operate.tsx` — added `isCaptureDefeaterMode` derived flag and three slot-arm extensions (`textInput`, `edgeRoleSelector`, `proposeAction`).
- Extended `apps/moderator/src/stores/captureStore.ts` — added exported free helper `selectIsCaptureDefeaterReady(state): boolean`.
- Added 4 new i18n keys under `moderator.captureDefeater.*` (capturePane.placeholder, capturePane.ariaLabel, propose.label, propose.inFlightLabel) × 3 locales = 12 catalog entries; pt-BR / es-419 drafts flagged PENDING in `*.review.json`.
- Added Vitest coverage: 14 new cases across `CaptureDefeaterCapturePanel.test.tsx` (4), `ProposeCaptureDefeaterAction.test.tsx` (7), `useProposeCaptureDefeaterAction.test.tsx` (13), `captureStore.test.ts` (+1), `Operate.test.tsx` (+1).
- Extended `tests/e2e/moderator-capture.spec.ts` with a capture-defeater propose scenario asserting the `capture-defeater-propose-wire-error` region surfaces and mode stays at `capture-defeater` (server-side reject path, per Decision §D7 + established sibling pattern).
