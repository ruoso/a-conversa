# Moderator capture-defeater-mode entry — flip the capture pane into `capture-defeater` for a selected target node

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_defeater_flow.mod_capture_defeater_mode` (see `mod_defeater_flow`
group at line 544 and this leaf at line 546).

```tji
task mod_capture_defeater_mode "Capture-defeater mode with target selected" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. Every seam this task needs is already in place; the
deliverable is the same shape as `mod_decompose_mode` /
`mod_interpretive_split_mode` / `mod_operationalization_mode` /
`mod_warrant_elicitation_mode` — a fifth mode-entry tile on a pattern that
has already been generalised four times:

- `useCaptureStore`'s `CaptureMode` enum already carries `'capture-defeater'`
  as one of its nine valid values
  ([apps/moderator/src/stores/captureStore.ts:132–141](../../../apps/moderator/src/stores/captureStore.ts#L132)).
  No enum change needed; this task adds a slice + helpers.
- The mode-banner copy
  `moderator.modeBanner.capture-defeater.{label,description}` is already
  pinned in en-US / pt-BR / es-419 (shipped with `mod_mode_banner`'s 18
  keys; en-US copy: "Capture defeater" / "Record a rebuttal against the
  selected statement." per
  [packages/i18n-catalogs/src/catalogs/en-US.json:513–516](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L513)).
  **This task does NOT mint banner keys.**
- The shared `<ProposalModeExitAffordance mode={...}>` body at
  [apps/moderator/src/layout/ProposalModeExitAffordance.tsx](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx)
  already handles four modes via a 4-arm switch over `MODE_KEYS`, the
  `targetNodeId` selector, and the `exitMode` selector. Widening to a
  5-arm switch is the same shape as `mod_warrant_elicitation_mode`'s
  4→4 widening (which extended from operationalization's 3→4); each
  prior leaf documented this as a one-line type-union edit plus three
  one-line switch arms plus a new `MODE_KEYS` entry plus a thin
  per-mode wrapper.
- The mode-aware Escape dispatch in
  [apps/moderator/src/layout/captureKeymap.ts:232–236](../../../apps/moderator/src/layout/captureKeymap.ts#L232)
  already gates `onExitMode` on a 4-mode `||` list; widening to 5 is
  one more disjunct.
- The `<OperateRoute>` route at
  [apps/moderator/src/routes/Operate.tsx:227–230](../../../apps/moderator/src/routes/Operate.tsx#L227)
  already mounts four sibling exit-button components unconditionally
  inside the `modeBanner` slot's children fragment, each self-gating on
  its matching mode. Mounting the fifth is one additional `<...
  />` line.
- The context-menu factory `buildNodeMenuItems` at
  [apps/moderator/src/graph/GraphCanvasPane.tsx:329–340](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L329)
  already accepts six optional handler parameters (one per existing
  mode-entry seam + the submenu openers). Adding a seventh optional
  `onEnterCaptureDefeaterMode?: (nodeId: string) => void` parameter is
  the same additive shape; the canvas call site at
  [GraphCanvasPane.tsx:~1544](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1544)
  threads one more `useCallback`.
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419
  drafts is established by every prior moderator-UI task. This task
  follows the same pattern.

Concretely the deliverable is:

- **One new slice** on `useCaptureStore`:
  `captureDefeaterTargetNodeId: string | null` (+ `setCaptureDefeaterTargetNodeId(id)`
  setter for symmetry / test seams). The existing `reset()` clears it
  via the spread of `initialCaptureState`.
- **Two new store-coordination helpers**
  `enterCaptureDefeaterMode(nodeId)` / `exitCaptureDefeaterMode()` that
  mirror `enterOperationalizationMode` / `exitOperationalizationMode`
  verbatim — atomic single-`set()`, F1-coupling clear on entry, no
  per-row seed (defeater capture is single-target; the new defeater
  node's wording lives in the sibling task's capture-pane surface, not
  in this leaf's store slice).
- **`buildNodeMenuItems` extension** in
  `apps/moderator/src/graph/GraphCanvasPane.tsx`: add a new
  `'capture-defeater'` menu item with `labelKey:
  'moderator.contextMenu.node.captureDefeater'`, plus an optional
  `onEnterCaptureDefeaterMode?: (nodeId: string) => void` parameter
  (mirrors `onEnterOperationalizationMode?` etc.). Decision §D2 records
  the item's placement.
- **`<GraphCanvasPaneInner>` wire-up** — thread
  `(nodeId) => useCaptureStore.getState().enterCaptureDefeaterMode(nodeId)`
  as the new handler argument at the menu-items builder call site
  (around [GraphCanvasPane.tsx:1544](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1544)).
  No new canvas-local state.
- **`<ProposalModeExitAffordance>` generalisation** — widen the
  `ProposalMode` union from 4 to 5 to include `'capture-defeater'`;
  extend `MODE_KEYS` with a fifth entry; extend the `targetNodeId` and
  `exitMode` switch statements with a fifth arm. Per
  `mod_warrant_elicitation_mode`'s Decision §D2 precedent, the
  symbol-name `<ProposalModeExitAffordance>` is preserved (no rename)
  even though "proposal mode" is increasingly a misnomer — source
  stability for the four existing thin-wrapper call sites outweighs the
  language nit. Decision §D3 records this.
- **One new thin wrapper component**
  `apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx` — a
  one-liner over `<ProposalModeExitAffordance mode="capture-defeater" />`,
  exactly the shape of `<OperationalizationModeExitButton>` and
  `<WarrantElicitationModeExitButton>`.
- **`captureKeymap` extension** — widen the existing 4-mode `||` check
  in the `Escape` branch to 5 modes by adding `mode === 'capture-defeater'`.
  The mode-aware dispatch contract from `mod_decompose_mode` Decision
  §5 is unchanged; this is purely additive.
- **`<OperateRoute>` integration** — mount
  `<CaptureDefeaterModeExitButton />` as the fifth sibling inside the
  `modeBanner` slot's children fragment. The bottom-strip's textInput
  / classificationPalette / edgeRoleSelector slot-swap is NOT extended
  in this leaf (the sibling task `mod_defeater_node_creation` owns the
  capture-pane surface for the new defeater node's wording; until that
  task lands, capture-defeater mode shows the empty F1 capture pane
  behind the mode banner — Decision §D5 records the gap-handling
  rationale).
- **8 new i18n catalog keys** under `moderator.captureDefeater.*`
  and `moderator.contextMenu.node.captureDefeater`:
  - `moderator.contextMenu.node.captureDefeater` — the node
    right-click menu label.
  - `moderator.captureDefeater.exit.ariaLabel` — exit-button aria-label.
  - `moderator.captureDefeater.exit.tooltip` — exit-button tooltip.
  - `moderator.captureDefeater.banner.targetWording` — ICU
    "Defeating {nodeWording}" target-wording overlay.

  4 keys × 3 locales = **12 catalog entries**. pt-BR / es-419 drafts
  land flagged PENDING in the `*.review.json` trackers.
- **1 follow-up tech-debt task** registered in
  `tasks/35-frontend-i18n.tji` for native-speaker review of the 8 new
  pt-BR / es-419 draft entries
  (`i18n_capture_defeater_mode_native_review`, effort 0.5d, `depends
  !<current tail of the native-review chain>` — the Closer reads the
  current tail at register time).
- **Vitest cases** across the four touched test files plus the new
  thin-wrapper test:
  - `apps/moderator/src/stores/captureStore.test.ts` — the new
    `enterCaptureDefeaterMode` / `exitCaptureDefeaterMode` semantics +
    `captureDefeaterTargetNodeId` slice + `reset()` clearing + F1-clear
    coupling.
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — the new
    `onEnterCaptureDefeaterMode` parameter on `buildNodeMenuItems` +
    the canvas-wired click → store-mode flip.
  - `apps/moderator/src/layout/ProposalModeExitAffordance.test.tsx` —
    the 5th mode branch (testid prefix, key-resolution, exit-click,
    mode-gating return-null).
  - `apps/moderator/src/layout/CaptureDefeaterModeExitButton.test.tsx`
    — new file, mirror of `OperationalizationModeExitButton.test.tsx`
    (the thin-wrapper render-test pattern).
  - `apps/moderator/src/layout/captureKeymap.test.ts` — extension
    for the new mode in the 5-mode `||` check.
- **Playwright e2e** in `tests/e2e/moderator-capture.spec.ts` — new
  `test()` block under the existing `test.describe('moderator capture
  flow', ...)` group, mirroring the `mod_decompose_mode` template
  (lines covering the right-click → mode-flip → Esc-exit chain). The
  mode is reachable from a real user flow as of this task (login →
  create session → right-click node → "Capture defeater"), so the e2e
  is **in scope, not deferred** — see Acceptance criteria § 7.

## Inherited dependencies

Parent (`mod_defeater_flow`) declares
`depends !mod_capture_flow, root_app.root_moderator_cutover,
data_and_methodology.methodology_engine.defeater_capture_logic`.

Settled (every gating dep is done):

- **`moderator_ui.mod_capture_flow`** (parent dep — done via the chain
  of F1 leaves: `mod_capture_text_input`, `mod_classification_palette`,
  `mod_target_auto_suggest`, `mod_target_clear_override`,
  `mod_edge_role_selector`, `mod_propose_action`). The F1 capture-flow's
  state shape, the `captureStore` slice naming convention, the
  `captureKeymap` attach-on-mount / cleanup-on-unmount discipline, the
  i18n catalog workflow, and the mode-aware Escape dispatch pattern are
  all in place. The F1-clear coupling on mode entry is the same
  invariant `enterDecomposeMode` etc. pinned (Decision §D4 — carried
  over).
- **`data_and_methodology.methodology_engine.defeater_capture_logic`**
  (done — 2026-05-10 per
  [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)'s
  Status block). Settled the **Option B** layering: defeater capture is
  a UI-level macro built on three existing primitives (`node-created`
  + `edge-created` (`role: 'rebuts'`) + `propose set-edge-substance`
  (`value: 'agreed'`)). **No new methodology-engine handler, action
  variant, proposal sub-kind, event kind, or rejection reason exists**.
  The "Capture defeater" mode banner is **a UI affordance, not a
  methodology variant** (verbatim from that refinement's Decisions
  §2). This task is the v1 of the UI-side macro — specifically the
  mode-entry seam (step 1 of the F6 flow: "Trigger Capture defeater
  with X (the target) selected"). The remaining two macro steps —
  create node Y + create rebuts edge Y → X, then pre-commit the edge
  substance — are the two sibling tasks
  (`mod_defeater_node_creation`, `mod_defeater_substance_precommit`).
- **`root_app.root_moderator_cutover`** (parent dep — done).
- **`moderator_ui.mod_decompose_flow.mod_decompose_mode`** (done —
  commit `83bea9b`, [`mod_decompose_mode.md`](mod_decompose_mode.md)).
  Pinned the **mode-entry pattern** this task mirrors: atomic
  `enterXxxMode(nodeId)` store helper, `xxxTargetNodeId` slice,
  F1-coupling clear, context-menu seam via optional
  `onEnterXxxMode?: (nodeId: string) => void` parameter on
  `buildNodeMenuItems`, sibling exit-affordance mount inside the
  `modeBanner` slot.
- **`moderator_ui.mod_decompose_flow.mod_interpretive_split_mode`** (done).
  Generalised the exit-affordance body into the parameterised
  `<ProposalModeExitAffordance mode={...}>` shape this task widens
  from 4 to 5 modes ([`mod_interpretive_split_mode.md`](mod_interpretive_split_mode.md)
  Decision §2).
- **`moderator_ui.mod_diagnostic_flow.mod_operationalization_mode`** (done).
  Widened the affordance from 2 to 3 modes; pinned the "single-target,
  no per-row seed" variant of the mode-entry helper (no
  `xxxComponents` / `xxxReadings` array — just the target node id and
  the F1-clear). Defeater capture mirrors this single-target shape.
- **`moderator_ui.mod_diagnostic_flow.mod_warrant_elicitation_mode`** (done).
  Widened the affordance from 3 to 4 modes; pinned the 4-arm
  `MODE_KEYS` + `targetNodeId` / `exitMode` switch convention this
  task extends to 5 arms. Defeater capture is the second purely
  single-target single-text variant (no answer-route placeholder
  chips, unlike operationalization / warrant-elicitation which embed
  five route chips per
  [`mod_operationalization_mode.md`](mod_operationalization_mode.md)
  Decision §D7).
- **`moderator_ui.mod_mode_banner`** (done — banner reads
  `useCaptureStore((s) => s.mode)` and renders the localized
  `moderator.modeBanner.<mode>.{label,description}`; the
  `capture-defeater` mode's `{label,description}` keys are shipped per
  its Status block).
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore`
  declared at `apps/moderator/src/stores/captureStore.ts` with `mode`
  + `setMode` + `reset` already in place plus four prior per-mode
  target slices; this task adds **one** more slice + **two** more
  coordination helpers on the same store, mirroring the existing
  setter / helper naming convention).
- **`moderator_ui.mod_graph_rendering.mod_context_menus`** (done — the
  node-card right-click menu pipeline, the `<GraphContextMenu>`
  surface, `buildNodeMenuItems`, the `actionStub` placeholder convention,
  the `disabled: boolean` field on `MenuItem`, and the
  `onSelect`-ternary shape are all in place).
- **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_testing`** (done — the catalog workflow,
  `*.review.json` PENDING tracker lifecycle, `useTranslation()` + ICU
  interpolation, and per-locale parity assertions are all in place).
- **[ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — `useTranslation()` for catalog access; ICU interpolation for the
  `{nodeWording}` substitution in the banner target-wording overlay.

Pending edges this task FEEDS (NOT depends on):

- **`moderator_ui.mod_defeater_flow.mod_defeater_node_creation`** (sibling
  — depends `!mod_capture_defeater_mode` per the WBS at
  [tasks/30-moderator-ui.tji:553](../../30-moderator-ui.tji#L553)). Will
  read `useCaptureStore((s) => s.captureDefeaterTargetNodeId)` to know
  which node X is being defeated; will read `mode === 'capture-defeater'`
  as the visibility gate for the capture-pane surface. Owns the
  defeater node Y's wording capture (single textarea) AND the
  client-side macro that emits the paired
  `node-created` (for Y) + `edge-created` (`role: 'rebuts'`,
  Y → X) events per Option B of
  [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md).
- **`moderator_ui.mod_defeater_flow.mod_defeater_substance_precommit`**
  (downstream — depends `!mod_defeater_node_creation` per the WBS).
  Builds the third macro step: a `propose set-edge-substance` envelope
  against the rebut edge with `value: 'agreed'`, the
  pre-committed-substance step from F6 step 4 (`docs/moderator-ui.md`
  L114–115). Will call `exitCaptureDefeaterMode()` on propose-success
  (post-success seam this task ships).
- **`moderator_ui.mod_diagnostic_flow.mod_diagnostic_resolution_flow.*`**
  — the F7 resolution-path-picker. The
  `route-defeater` placeholder action chip in
  `<OperationalizationCapturePanel>`
  ([apps/moderator/src/layout/OperationalizationCapturePanel.tsx:40](../../../apps/moderator/src/layout/OperationalizationCapturePanel.tsx#L40))
  is the second eventual entry point into capture-defeater mode (the
  first being this task's right-click menu item). When the F7 owner
  flips the chip from disabled-placeholder to a real handler, the
  handler will call
  `useCaptureStore.getState().enterCaptureDefeaterMode(nodeId)` —
  using the exact seam this task ships.
- **`frontend_i18n.i18n_capture_defeater_mode_native_review`** (registered
  by this task — see Acceptance criteria / Decisions). The pt-BR /
  es-419 drafts of the 4 new keys land flagged PENDING; the follow-up
  replaces them with native-speaker-reviewed text.

## What this task is

Land the **mode-entry seam** for the F6 defeater-capture flow. This task
is the foundation of `mod_defeater_flow` — both sibling tasks
(`mod_defeater_node_creation` and the further-downstream
`mod_defeater_substance_precommit`) depend on it (directly and
transitively).

"Entering capture-defeater mode" means three coordinated state changes:

1. **`captureStore.mode` flips from `'idle'` to `'capture-defeater'`.**
   The existing `<ModeBanner>` (mounted in the `bottom-strip-mode-banner`
   slot) re-renders the localized label + description for the new mode;
   the operator sees the visible chrome change ("Capture defeater" /
   "Record a rebuttal against the selected statement.").
2. **`captureStore.captureDefeaterTargetNodeId` is set to the
   right-clicked node's id (X).** This is the new slice this task
   adds. The sibling `mod_defeater_node_creation` reads it to know
   which node X the new defeater node Y will rebut (i.e. which node
   becomes the destination of the rebut edge Y → X);
   `mod_defeater_substance_precommit` transitively relies on the same
   slice for the propose-set-edge-substance step.
3. **The F1 capture-flow slices clear.** `text = ''`,
   `classification = null`, `targetEntityId = null`,
   `targetEntityKind = 'node'`, `edgeRole = null`, `edgeDirection =
   'targets'`. A stale in-progress F1 draft must not bleed into the
   defeater-capture flow (Decision §D4 — F1-clear coupling carried
   over from `mod_decompose_mode` Decision §6).

The task also ships:

- The **exit affordance** — a small `×` button next to the mode banner
  + an `Escape` keypress (mode-aware: when `mode === 'capture-defeater'`,
  Escape exits the mode rather than clearing the F1 staged target).
  Click or Escape calls `exitCaptureDefeaterMode()`: `mode → 'idle'`,
  `captureDefeaterTargetNodeId → null`. The F1 slices are NOT
  re-populated (entering capture-defeater already cleared them).
- The **localized target-wording overlay** — "Defeating {{nodeWording}}"
  appears alongside the existing mode-banner description (rendered by
  the shared `<ProposalModeExitAffordance>` body), so the moderator
  sees at a glance which node X is being rebutted. The wording is
  resolved by the same mode-neutral `resolveProposalTargetWording(events,
  captureDefeaterTargetNodeId)` helper the four prior mode wrappers
  already use.
- The **node context-menu wiring** — a new `'capture-defeater'` item on
  the node right-click menu, between `'run-warrant-elicitation-test'`
  and `'propose-meta-disagreement'` (Decision §D2 records the
  placement). Clicking the item enters the mode for the right-clicked
  node.

**This task is JUST the mode entry + visual signal + exit affordance +
node context-menu entry point.** Out of scope (sibling-task ownership):

- The defeater node Y's wording-capture surface (the bottom-strip's
  textInput-slot swap) and the client-side
  `node-created` + `edge-created` (rebuts) macro — those are
  `mod_defeater_node_creation`'s scope.
- The `propose set-edge-substance` (`value: 'agreed'`) envelope and
  its propose-vote-commit handling — those are
  `mod_defeater_substance_precommit`'s scope.
- Wiring the `route-defeater` action chip in
  `<OperationalizationCapturePanel>` from disabled-placeholder to a
  real handler — that's the F7 resolution-path-picker's scope (it
  inherits this task's seam).
- A `Capture defeater` keyboard shortcut. `docs/moderator-ui.md`
  L201–212 lists shortcuts including `Cmd+D` (decompose), `Cmd+W`
  (warrant), `Cmd+O` (operationalization), and `Cmd+S` (snapshot),
  but **no defeater-specific shortcut**. No WBS task exists for a
  defeater shortcut; the `i18n_keyboard_shortcuts_policy` task pinned
  the english-mnemonic approach and shipped the executable mapping at
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — adding a new
  shortcut belongs to a separate refinement when scoped. Out of scope
  here. Decision §D6 records this.

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_defeater_node_creation` and (transitively)
   `mod_defeater_substance_precommit` cannot land without it.** Both
   sibling tasks declare `depends !mod_capture_defeater_mode` (directly
   for `mod_defeater_node_creation` per
   [tasks/30-moderator-ui.tji:553](../../30-moderator-ui.tji#L553);
   transitively for `mod_defeater_substance_precommit` per line 558).
   Until this task ships the `mode === 'capture-defeater'` flag and
   the `captureDefeaterTargetNodeId` slice, the node-creation macro
   has no visibility gate and no target-id (X) to attach the
   rebut edge to.

2. **The methodology has no UI path to capture defeaters until this
   ships.** Per [`docs/methodology.md` L114](../../../docs/methodology.md#L114):
   *"If the participant names **specific retraction conditions** ('I'd
   retract this if X were the case'), capture each X as a regular node
   and add a `rebuts` edge from X to the target."* The methodology
   engine has already settled (per
   [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md))
   that the operation maps onto three existing event-stream operations
   — but the **mode banner / entry path that signals "I am now
   capturing a defeater"** does not exist anywhere in the app. The F6
   diagnostic flow has the same gap between "the methodology calls
   for a defeater here" and "the moderator runs the capture-defeater
   operation" that operationalization had before
   `mod_operationalization_mode` shipped.

3. **It is the second entry point for `<OperationalizationCapturePanel>`'s
   `route-defeater` chip.** Per
   [`mod_operationalization_mode.md`](mod_operationalization_mode.md)
   Decision §D7 the chip is currently disabled-placeholder; when the
   F7 owner wires it, the chip's handler will call
   `useCaptureStore.getState().enterCaptureDefeaterMode(operationalizationTargetNodeId)`
   (the operationalization target IS the same node X the defeater
   will rebut — the moderator just heard the participant name a
   retraction condition for X). Settling the seam here once means
   that F7 wiring lands as a one-line `disabled={false}` +
   `onClick={...}` flip rather than a re-design.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- [apps/moderator/src/stores/captureStore.ts L132–141](../../../apps/moderator/src/stores/captureStore.ts#L132)
  — the `CaptureMode` discriminated union already includes
  `'capture-defeater'` (line 137). No enum change needed; this task
  adds a slice + helpers.
- [apps/moderator/src/stores/captureStore.ts L510–541](../../../apps/moderator/src/stores/captureStore.ts#L510)
  — `initialCaptureState` constant. Add `captureDefeaterTargetNodeId:
  null` to the literal AND to the `Pick<CaptureState, ...>` type union
  so `reset()` clears the new slice via the existing spread.
- [apps/moderator/src/stores/captureStore.ts L689–710](../../../apps/moderator/src/stores/captureStore.ts#L689)
  — `enterOperationalizationMode` / `exitOperationalizationMode`
  implementation. The capture-defeater entry / exit helpers mirror
  these atomic `set()` calls verbatim (no per-row array seed;
  defeater capture is single-target, like operationalization).
- [apps/moderator/src/stores/captureStore.ts L711–732](../../../apps/moderator/src/stores/captureStore.ts#L711)
  — `enterWarrantElicitationMode` / `exitWarrantElicitationMode`. Same
  mirror — four mode-entry/exit pairs become five after this task.
- [apps/moderator/src/graph/GraphCanvasPane.tsx L329–340](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L329)
  — the `buildNodeMenuItems` factory signature. Already carries six
  optional handler parameters + two submenu openers; this task adds a
  seventh handler `onEnterCaptureDefeaterMode?: (nodeId: string) =>
  void`, inserted positionally after `disabledRunWarrantElicitationTest?`
  to keep the prior six call-site positions stable.
- [apps/moderator/src/graph/GraphCanvasPane.tsx L341–409](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L341)
  — the menu-items list. The new `'capture-defeater'` item is inserted
  **between `'run-warrant-elicitation-test'` (L385–392) and
  `'propose-meta-disagreement'` (L393–397)** — placement rationale in
  Decision §D2 (defeater capture is the methodology's reactive
  response to "I'd retract if X" answers from the diagnostic tests,
  so it follows the two diagnostic-test items in the menu's
  top-to-bottom escalation).
- [apps/moderator/src/graph/GraphCanvasPane.tsx ~L1544](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1544)
  — the canvas's `buildNodeMenuItems` call site (the same block that
  threads `enterDecomposeMode`, `enterInterpretiveSplitMode`,
  `enterOperationalizationMode`, `enterWarrantElicitationMode`). Thread
  `(nodeId) => useCaptureStore.getState().enterCaptureDefeaterMode(nodeId)`
  as the new positional argument; the canvas's existing `useCallback`
  pattern is the precedent.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L29–33](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L29)
  — `ProposalMode = 'decompose' | 'interpretive-split' |
  'operationalization' | 'warrant-elicitation'`. Widen to a 5-arm
  union by appending `| 'capture-defeater'`. (The `StructuralProposalMode`
  alias's exclusion list also widens — see Decision §D3.)
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L93–114](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L93)
  — `MODE_KEYS` per-mode key bundle. Add the `'capture-defeater'`
  entry pointing at the new `moderator.captureDefeater.exit.*` and
  `moderator.captureDefeater.banner.targetWording` keys.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L129–152](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L129)
  — the `targetNodeId` / `exitMode` 4-arm switches. Each gains a fifth
  arm reading `s.captureDefeaterTargetNodeId` / `s.exitCaptureDefeaterMode`.
- [apps/moderator/src/layout/captureKeymap.ts L232–236](../../../apps/moderator/src/layout/captureKeymap.ts#L232)
  — the mode-aware Escape dispatch. The 4-arm `||` chain widens to
  5-arm by adding `mode === 'capture-defeater'`. The keymap's contract
  (Decision §5 of `mod_decompose_mode`) is unchanged.
- [apps/moderator/src/routes/Operate.tsx L74–80](../../../apps/moderator/src/routes/Operate.tsx#L74)
  — the per-mode exit-button imports. Add the new
  `import { CaptureDefeaterModeExitButton } from
  '../layout/CaptureDefeaterModeExitButton';` line.
- [apps/moderator/src/routes/Operate.tsx L227–230](../../../apps/moderator/src/routes/Operate.tsx#L227)
  — the `modeBanner` slot's children fragment. Append
  `<CaptureDefeaterModeExitButton />` as the fifth sibling alongside
  the existing four exit buttons. **No `isCaptureDefeaterMode` gate
  is needed in the `textInput` / `classificationPalette` /
  `edgeRoleSelector` slot-swap** — Decision §D5 records that those
  slots stay in their F1 default during the gap before
  `mod_defeater_node_creation` lands; that sibling task owns the
  slot-swap extension.
- [apps/moderator/src/layout/DecomposeModeExitButton.tsx](../../../apps/moderator/src/layout/DecomposeModeExitButton.tsx)
  / [apps/moderator/src/layout/OperationalizationModeExitButton.tsx](../../../apps/moderator/src/layout/OperationalizationModeExitButton.tsx)
  — thin wrapper templates. Mirror as
  `apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx`.
- [packages/i18n-catalogs/src/catalogs/en-US.json L513–516](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L513)
  — confirms `moderator.modeBanner.capture-defeater.{label,description}`
  is already present in all three locales (this task does NOT re-mint).
- [packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  — gains 4 new keys under `moderator.captureDefeater.*` +
  `moderator.contextMenu.node.captureDefeater`. Mirrored in
  `pt-BR.json` and `es-419.json` with PENDING drafts; mirrored in the
  matching `*.review.json` trackers per the established lifecycle.
- [tests/e2e/moderator-capture.spec.ts](../../../tests/e2e/moderator-capture.spec.ts)
  — the e2e spec grows by one `test()` block under the existing
  `test.describe('moderator capture flow', ...)` group (mirrors the
  `mod_decompose_mode` extension shape).

Refinements consulted for style + decision continuity:

- [`tasks/refinements/data-and-methodology/defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)
  — the engine-side Option B layering: defeater capture is a UI-level
  macro built on three existing primitives. The "Capture defeater"
  mode banner is a UI affordance, not a methodology variant. This
  task implements the v1 of that UI-level macro's entry path.
- [`tasks/refinements/moderator-ui/mod_decompose_mode.md`](mod_decompose_mode.md)
  — the foundational mode-entry pattern. Decisions §2 / §6 / §7 carry
  over verbatim (entry-point: node context menu;
  F1-clear-on-mode-entry coupling; live target-wording resolution via
  the mode-neutral helper).
- [`tasks/refinements/moderator-ui/mod_interpretive_split_mode.md`](mod_interpretive_split_mode.md)
  — generalisation of the exit affordance into the parameterised
  `<ProposalModeExitAffordance>` body this task widens.
- [`tasks/refinements/moderator-ui/mod_operationalization_mode.md`](mod_operationalization_mode.md)
  — the first single-target (no per-row seed) mode-entry leaf;
  pinned the 3-arm `MODE_KEYS` shape and the symbol-name-preservation
  decision (§D2). Defeater capture is single-target.
- [`tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md`](mod_warrant_elicitation_mode.md)
  — the second single-target leaf; widened the affordance to 4 modes
  with the 4-arm switch and the `StructuralProposalMode` exclusion-list
  pattern this task extends. Defeater capture is the **third**
  single-target leaf and the **fifth** mode total.
- [`tasks/refinements/moderator-ui/mod_mode_banner.md`](mod_mode_banner.md)
  — the per-mode `moderator.modeBanner.<mode>.{label,description}`
  catalog discipline (already includes capture-defeater).
- [`tasks/refinements/moderator-ui/mod_context_menus.md`](mod_context_menus.md)
  — the menu shell + the `MenuItem` shape + the `disabled` field.
- [`tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md`](../frontend-i18n/i18n_methodology_role_descriptions.md)
  — the canonical PENDING-flag + native-review chain pattern.
- [DESIGN.md L37](../../../DESIGN.md#L37) — design-doc link to
  `docs/moderator-ui.md` for the F6 capture-defeater flow.
- [`docs/moderator-ui.md` L108–119](../../../docs/moderator-ui.md#L108)
  — F6 flow specification.
- [`docs/moderator-ui.md` L193](../../../docs/moderator-ui.md#L193) —
  "Capture defeater" in the canonical mode-banner mode list.
- [`docs/data-model.md` L100–102](../../../docs/data-model.md#L100) —
  the structural pattern: regular node Y + `rebuts` edge Y → X with
  edge.substance=agreed and Y.substance=proposed. Confirms the
  defeater is not a special event shape; it's a graph pattern.

No new ADR is required (see Decision §D7). No new dependency lands. No
public type signature changes outside `useCaptureStore` and the
already-parameterised `<ProposalModeExitAffordance>` (both extensions
are additive). No cross-workspace contract changes. No methodology
engine, projection, or wire envelope changes.

## Constraints / requirements

### Store extension (`apps/moderator/src/stores/captureStore.ts`)

- **New slice** `captureDefeaterTargetNodeId: string | null` added to
  `CaptureState`, placed alongside the existing four per-mode target
  slices (`decomposeTargetNodeId`, `interpretiveSplitTargetNodeId`,
  `operationalizationTargetNodeId`, `warrantElicitationTargetNodeId`).
  Initial value: `null` in `initialCaptureState`. The slice's reset
  semantics ride for free via the existing `reset()` spread.
- **New setter** `setCaptureDefeaterTargetNodeId: (id: string | null)
  => void` on `CaptureState`. Conventional one-line setter mirroring
  the existing four per-mode setters. **Direct callers should prefer
  the helpers below; the setter exists for symmetry and for test seams
  that need to set/clear the slice without invoking the coupled mode
  transition.**
- **New helper** `enterCaptureDefeaterMode: (nodeId: string) => void`.
  Atomic multi-field update inside a single `set()` call:
  ```ts
  enterCaptureDefeaterMode: (nodeId) =>
    set({
      mode: 'capture-defeater',
      captureDefeaterTargetNodeId: nodeId,
      // F1-coupling clear (mirrors enterDecomposeMode /
      // enterInterpretiveSplitMode / enterOperationalizationMode /
      // enterWarrantElicitationMode — Decision §D4 of this refinement,
      // carried over from mod_decompose_mode Decision §6).
      text: '',
      classification: null,
      targetEntityId: null,
      targetEntityKind: 'node',
      edgeRole: null,
      edgeDirection: 'targets',
    }),
  ```
  Single `set()` ensures subscribers see one consistent transition,
  not seven intermediate render passes.
- **New helper** `exitCaptureDefeaterMode: () => void`. Atomic update:
  ```ts
  exitCaptureDefeaterMode: () =>
    set({
      mode: 'idle',
      captureDefeaterTargetNodeId: null,
    }),
  ```
  Does NOT re-populate F1 slices (entering capture-defeater already
  cleared them).
- **Pick literal change**: `initialCaptureState`'s `Pick<...>` type
  union grows by one key: `'captureDefeaterTargetNodeId'`. The literal
  value gains `captureDefeaterTargetNodeId: null`.
- **No cross-mode clearing.** `enterCaptureDefeaterMode` does NOT
  clear the four prior per-mode target slices; the mutual exclusion is
  enforced via the `mode` discriminator (only one mode is ever
  `mode === '<thatMode>'` at a time, so the other per-mode slices
  remain dormant). Same convention as
  `mod_interpretive_split_mode` Decision §5 / `mod_warrant_elicitation_mode`
  Decision §5.

### Context-menu factory extension (`apps/moderator/src/graph/GraphCanvasPane.tsx`)

- **`buildNodeMenuItems` signature** grows by one optional parameter:
  ```ts
  export function buildNodeMenuItems(
    target: ContextMenuState['target'],
    onOpenAxiomMarkSubmenu?: () => void,
    onEnterDecomposeMode?: (nodeId: string) => void,
    onEnterInterpretiveSplitMode?: (nodeId: string) => void,
    onEnterOperationalizationMode?: (nodeId: string) => void,
    disabledRunOperationalizationTest?: boolean,
    onEnterWarrantElicitationMode?: (nodeId: string) => void,
    disabledRunWarrantElicitationTest?: boolean,
    onEnterCaptureDefeaterMode?: (nodeId: string) => void,  // new
    onOpenAnnotateSubmenu?: () => void,
    onOpenEditWordingSubmenu?: () => void,
  ): readonly MenuItem[];
  ```
  Positional, **inserted before the two submenu openers** so the
  prior six positions stay stable. The existing factory-shape tests
  at `GraphCanvasPane.test.tsx` continue to pass without changes
  because the new parameter is optional and defaults to the legacy
  stub.

  **Important non-regression** — the two submenu opener parameters
  (`onOpenAnnotateSubmenu`, `onOpenEditWordingSubmenu`) shift one
  position. All call sites must be audited; the canvas call site at
  `GraphCanvasPane.tsx:~1544` is the only consumer that supplies the
  submenu openers. Decision §D8 records why this shift is safer than
  appending to the tail.
- **New menu item** inserted at the position described above:
  ```ts
  {
    id: 'capture-defeater',
    labelKey: 'moderator.contextMenu.node.captureDefeater',
    onSelect:
      target.kind === 'node' && target.id !== null && onEnterCaptureDefeaterMode
        ? () => onEnterCaptureDefeaterMode(target.id as string)
        : () => actionStub('capture-defeater', target),
  },
  ```
  Mirrors the existing `'propose-decompose'` /
  `'run-operationalization-test'` items' `onSelect`-ternary shape.
  **No `disabled` gate** (Decision §D9 — defeater capture is
  unconditionally available; the F6 flow does not require any
  methodology-state precondition on X; the docs' L113 trigger says
  "with X (the target) selected", with no claim/disputed/etc.
  filter).
- **Doc-block update** in the `buildNodeMenuItems` JSDoc: add a
  paragraph documenting the `onEnterCaptureDefeaterMode` seam parallel
  to the existing `onEnterDecomposeMode` /
  `onEnterOperationalizationMode` paragraphs (L288–327).

### Canvas wire-up (`apps/moderator/src/graph/GraphCanvasPane.tsx`)

- **New callback** inside `GraphCanvasPaneInner`:
  ```ts
  const enterCaptureDefeaterMode = useCallback(
    (nodeId: string) =>
      useCaptureStore.getState().enterCaptureDefeaterMode(nodeId),
    [],
  );
  ```
  Placed alongside the existing per-mode `enter*Mode` callbacks.
- **Menu-items builder line update** at the call site
  (~[GraphCanvasPane.tsx:1544](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1544)):
  thread `enterCaptureDefeaterMode` as the new positional argument
  before the two submenu openers.
- **No new canvas-local state.** Capture-defeater mode is global state
  (it lives on `useCaptureStore`); there is no per-canvas transient
  flag to manage.

### `<ProposalModeExitAffordance>` generalisation (`apps/moderator/src/layout/ProposalModeExitAffordance.tsx`)

- **Widen `ProposalMode`** from a 4-arm union to a 5-arm union:
  ```ts
  export type ProposalMode =
    | 'decompose'
    | 'interpretive-split'
    | 'operationalization'
    | 'warrant-elicitation'
    | 'capture-defeater';
  ```
  Per Decision §D3 the symbol name is **preserved** (no rename),
  consistent with `mod_warrant_elicitation_mode` Decision §D2.
- **`StructuralProposalMode` exclusion list widens** to also drop
  `'capture-defeater'` so the alias's "structural-restructure modes
  only" semantics survive (defeater capture is a single-target single-
  text mode, not a multi-row grid):
  ```ts
  export type StructuralProposalMode = Exclude<
    ProposalMode,
    'operationalization' | 'warrant-elicitation' | 'capture-defeater'
  >;
  ```
  This preserves `StructuralProposalMode = 'decompose' |
  'interpretive-split'` (unchanged effective value), matching the
  intent that the `<DecomposeComponentsGrid>` / `<ProposeAction>` /
  `useProposeProposalAction` consumers continue to switch over only the
  two multi-row modes.
- **Extend `MODE_KEYS`** with the fifth entry:
  ```ts
  'capture-defeater': {
    ariaLabel: 'moderator.captureDefeater.exit.ariaLabel',
    tooltip: 'moderator.captureDefeater.exit.tooltip',
    targetWording: 'moderator.captureDefeater.banner.targetWording',
  },
  ```
- **Extend the `targetNodeId` selector**'s switch with a fifth arm:
  ```ts
  case 'capture-defeater':
    return s.captureDefeaterTargetNodeId;
  ```
- **Extend the `exitMode` selector**'s switch with a fifth arm:
  ```ts
  case 'capture-defeater':
    return s.exitCaptureDefeaterMode;
  ```
- **No keymap change required at the body level** — the body's
  `attachCaptureKeymap({ onExitMode: exitMode })` already gates
  internally on `mode === targetMode` (line 163) which works for any
  new mode value once `targetMode` is in the widened union.

### `<CaptureDefeaterModeExitButton>` (new file)

- **New file**
  `apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx`.
- **Body**: thin wrapper, exact mirror of
  `<OperationalizationModeExitButton>` /
  `<WarrantElicitationModeExitButton>`:
  ```tsx
  import { type ReactElement } from 'react';
  import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

  export function CaptureDefeaterModeExitButton(): ReactElement | null {
    return <ProposalModeExitAffordance mode="capture-defeater" />;
  }
  ```

### `captureKeymap` extension (`apps/moderator/src/layout/captureKeymap.ts`)

- **Extend the 4-arm `||` chain** in the `Escape` branch at lines
  232–236 to add a fifth disjunct:
  ```ts
  (mode === 'decompose' ||
    mode === 'interpretive-split' ||
    mode === 'operationalization' ||
    mode === 'warrant-elicitation' ||
    mode === 'capture-defeater') &&
  handlers.onExitMode !== undefined
  ```
  The mode-aware Escape priority (Decision §5 of
  `mod_decompose_mode`) is preserved — `onExitMode` takes precedence
  over `onClearTarget` whenever the active mode is one of the five
  exit-owning modes.
- **Doc-block update** in the `CaptureKeymapHandlers.onExitMode`
  JSDoc to list `'capture-defeater'` alongside the four prior modes.

### `<OperateRoute>` integration (`apps/moderator/src/routes/Operate.tsx`)

- **New import line**:
  ```ts
  import { CaptureDefeaterModeExitButton } from
    '../layout/CaptureDefeaterModeExitButton';
  ```
- **`modeBanner` slot children**: append
  `<CaptureDefeaterModeExitButton />` as the fifth sibling at lines
  227–230. The component self-gates on `mode === 'capture-defeater'` so
  the mount is purely additive.
- **`textInput` / `classificationPalette` / `edgeRoleSelector` slot
  swap**: **NOT extended** in this leaf. The F1 capture pane shows
  through during capture-defeater mode until the sibling
  `mod_defeater_node_creation` task lands and adds the bottom-strip
  surface for capturing Y's wording. Decision §D5 records why.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.contextMenu.node.captureDefeater` | "Capture defeater" | "Capturar refutação" | "Capturar refutación" |
| `moderator.captureDefeater.exit.ariaLabel` | "Exit capture-defeater mode" | "Sair do modo de captura de refutação" | "Salir del modo de captura de refutación" |
| `moderator.captureDefeater.exit.tooltip` | "Exit capture-defeater mode (Esc)" | "Sair do modo de captura de refutação (Esc)" | "Salir del modo de captura de refutación (Esc)" |
| `moderator.captureDefeater.banner.targetWording` | "Defeating {nodeWording}" | "Refutando {nodeWording}" | "Refutando {nodeWording}" |

**Count: 4 keys × 3 locales = 12 catalog entries.** pt-BR / es-419
drafts land flagged PENDING in `pt-BR.review.json` +
`es-419.review.json` (8 PENDING entries total). Native-speaker review
registered as a tech-debt follow-up (see Acceptance criteria /
Decisions).

The new keys live under a new `moderator.captureDefeater.*` top-level
namespace within `moderator.*`, mirroring the precedent set by
`moderator.decompose.*`, `moderator.interpretiveSplit.*`,
`moderator.operationalization.*`, `moderator.warrantElicitation.*`,
`moderator.axiomMarkAction.*`, etc.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/stores/captureStore.ts` (modified — new slice +
  helpers).
- `apps/moderator/src/stores/captureStore.test.ts` (modified — new
  cases for the helpers + the slice + the reset invariant + the
  F1-clear coupling).
- `apps/moderator/src/graph/GraphCanvasPane.tsx` (modified —
  `buildNodeMenuItems` parameter + menu-item insertion + canvas-wired
  callback).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (modified — new
  cases for the `onEnterCaptureDefeaterMode` parameter + the
  canvas-wired click → store flip).
- `apps/moderator/src/layout/ProposalModeExitAffordance.tsx` (modified
  — union widening, MODE_KEYS extension, switch-arm extensions).
- `apps/moderator/src/layout/ProposalModeExitAffordance.test.tsx`
  (modified — new test cases covering the 5th mode branch).
- `apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx` (new
  file — one-line thin wrapper).
- `apps/moderator/src/layout/CaptureDefeaterModeExitButton.test.tsx`
  (new file — mirror of `OperationalizationModeExitButton.test.tsx`).
- `apps/moderator/src/layout/captureKeymap.ts` (modified — widen the
  5-arm `||` check + doc-block).
- `apps/moderator/src/layout/captureKeymap.test.ts` (modified — new
  cases for the new mode in the mode-aware dispatch).
- `apps/moderator/src/routes/Operate.tsx` (modified — import + mount).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 4 new
  keys).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 4 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — new `test()`
  block).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_capture_defeater_mode` lands
  at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_capture_defeater_mode_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration policy.
- `docs/adr/` — no new ADR (Decision §D7).
- `apps/server/src/` — no server-side change. The methodology engine
  is untouched per
  [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)
  (Option B: defeater capture is a UI macro on existing event
  primitives; no engine-side defeater-specific code exists, and this
  task does not introduce any).
- `apps/moderator/src/layout/ModeBanner.tsx` — unchanged. The
  `capture-defeater` mode's `{label,description}` keys already shipped.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — unchanged. The
  scaffold's `modeBanner` slot already accepts any `ReactNode`; the
  fifth child is purely additive.
- `apps/moderator/src/layout/OperationalizationCapturePanel.tsx` /
  `.test.tsx` — unchanged. The `route-defeater` placeholder chip stays
  in its disabled-placeholder state; wiring it is the F7 picker's
  scope (see "Pending edges this task FEEDS").
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — no new shortcut
  entry (Decision §D6 — defeater has no `Cmd+`-style shortcut in
  `docs/moderator-ui.md` L201–212; the context-menu entry suffices).
- `apps/moderator/src/layout/IsOughtPrompt.tsx` — unchanged. The
  is-ought prompt is gated on `mode === 'operationalization' || mode
  === 'warrant-elicitation'`; it does NOT mount in capture-defeater
  mode (Decision §D10 — defeater is a structural-capture mode, not a
  diagnostic-test mode, and does not need the is-ought reactive
  prompt).

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck) — the
  `StructuralProposalMode` exclusion-list widening keeps the type
  identical so downstream consumers (`<DecomposeComponentsGrid>`,
  `useProposeProposalAction`, etc.) need no change.
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 16 across the five touched test
  files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (parity check)
  green after the catalog edits.
- `pnpm -F @a-conversa/moderator build` succeeds (one new small
  component; one extended store + one extended exit affordance + one
  extended menu factory; bundle impact negligible).
- `pnpm exec playwright test` green against a freshly brought-up dev
  compose stack; the new capture-defeater-mode e2e scenario passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_capture_defeater_mode` AND the
  new `i18n_capture_defeater_mode_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The capture-defeater-mode entry is reachable from a real user flow as
of this task: the moderator can log in, navigate to
`/sessions/new/setup`, create a session, land on
`/sessions/<id>/operate`, seed a node into the WS store via the
existing `__aConversaWsStore` seam (same template as the
decompose-mode e2e), right-click it, and click "Capture defeater" to
see the mode banner flip to "Capture defeater" + the exit button
appear + the target-wording overlay populate. Per the UI-stream e2e
policy default, the Playwright spec is **scoped under Acceptance
criteria, NOT deferred** (see § 7).

**Important caveat**: `mod_defeater_node_creation` and
`mod_defeater_substance_precommit` have not landed, so the
capture-defeater-mode entry leads to an F1 capture pane (not yet
swapped to a defeater-specific surface) and no propose action is yet
available. The e2e therefore cannot assert "type the defeater
wording → see the rebut edge land" — it asserts only the
**mode-entry + mode-exit chain** (the load-bearing regression-class
property for this task). The full chain-completing e2e (right-click
→ capture wording → see Y + rebut edge → vote-commit substance →
projection edge-firing predicate flips correctly) is scoped to the
sibling refinements + the future `mod_pw_capture_defeater_flow` (or
the existing `mod_pw_*` catch-all — the Closer picks the right home
when those sibling tasks land).

## Acceptance criteria

### 1. Store slice + helpers

- `useCaptureStore`'s `CaptureState` interface carries
  `captureDefeaterTargetNodeId: string | null` +
  `setCaptureDefeaterTargetNodeId: (id: string | null) => void` +
  `enterCaptureDefeaterMode: (nodeId: string) => void` +
  `exitCaptureDefeaterMode: () => void`.
- `initialCaptureState`'s value carries
  `captureDefeaterTargetNodeId: null`; the `Pick<CaptureState, ...>`
  type union includes `'captureDefeaterTargetNodeId'`.
- `useCaptureStore.getState().enterCaptureDefeaterMode('<nodeId>')`
  results in `state.mode === 'capture-defeater'`,
  `state.captureDefeaterTargetNodeId === '<nodeId>'`,
  `state.text === ''`, `state.classification === null`,
  `state.targetEntityId === null`,
  `state.targetEntityKind === 'node'`, `state.edgeRole === null`,
  `state.edgeDirection === 'targets'`. The call uses a single `set()`
  so subscribers observe one transition.
- `useCaptureStore.getState().exitCaptureDefeaterMode()` results in
  `state.mode === 'idle'`,
  `state.captureDefeaterTargetNodeId === null`. F1 slices are NOT
  re-populated.
- `useCaptureStore.getState().reset()` clears
  `captureDefeaterTargetNodeId` to `null` alongside the other slices.
- `useCaptureStore.getState().setCaptureDefeaterTargetNodeId('foo')`
  sets the slice WITHOUT flipping `mode` (the symmetric setter is
  decoupled from the mode transition, mirroring the four prior
  per-mode setters).

### 2. Context-menu factory + canvas wire-up

- `buildNodeMenuItems` accepts an optional ninth positional parameter
  `onEnterCaptureDefeaterMode?: (nodeId: string) => void`, inserted
  after `disabledRunWarrantElicitationTest?` and before the two
  submenu openers. When supplied, the new `'capture-defeater'` menu
  item's `onSelect` calls `onEnterCaptureDefeaterMode(target.id)` once
  per invocation. When omitted, the item's `onSelect` calls the legacy
  `actionStub('capture-defeater', target)`.
- The new `'capture-defeater'` menu item is rendered between
  `'run-warrant-elicitation-test'` and `'propose-meta-disagreement'`
  in the items array.
- `<GraphCanvasPaneInner>` builds node menu items with a stable
  `enterCaptureDefeaterMode` callback that dispatches to
  `useCaptureStore.getState().enterCaptureDefeaterMode(nodeId)`.
- Right-clicking a node and clicking "Capture defeater" in the
  resulting menu transitions `useCaptureStore.getState().mode` from
  `'idle'` to `'capture-defeater'` and sets
  `captureDefeaterTargetNodeId` to the right-clicked node's id.

### 3. Exit-affordance render gating

- `<CaptureDefeaterModeExitButton>` renders `null` when
  `useCaptureStore((s) => s.mode) !== 'capture-defeater'`. The DOM
  contains no `capture-defeater-mode-exit` element in this state.
- `<CaptureDefeaterModeExitButton>` renders the button with the
  `capture-defeater-mode-exit` `data-testid`, the localized aria-label,
  the localized tooltip, and the localized target-wording overlay when
  `mode === 'capture-defeater'`.
- Clicking the button calls
  `useCaptureStore.getState().exitCaptureDefeaterMode()` once; mode
  reverts to `'idle'`; `captureDefeaterTargetNodeId` reverts to `null`.
- The target-wording overlay reads
  `t('moderator.captureDefeater.banner.targetWording', { nodeWording:
  '<the wording of the targeted node X>' })`. When the targeted node's
  wording cannot be resolved (events log doesn't yet contain the
  matching `node-created` event), the overlay renders an empty string
  (component does not throw).
- The container `data-testid` is `capture-defeater-mode-exit-container`
  and the target-wording span's `data-testid` is
  `capture-defeater-mode-target-wording` — exact mirrors of the four
  prior per-mode testid prefixes.

### 4. Escape-key exit (mode-aware)

- `attachCaptureKeymap({ onExitMode: handler })` calls `handler` once
  per `Escape` keypress while `useCaptureStore.getState().mode ===
  'capture-defeater'` (under the same modifier-bail / editable-target
  / repeat-skip guards as `onClearTarget`).
- When `mode === 'idle'`, `Escape` does NOT call `onExitMode` (the
  existing `onClearTarget` dispatch is unchanged).
- When both `onExitMode` and `onClearTarget` are supplied AND
  `mode === 'capture-defeater'`, only `onExitMode` is invoked
  (decompose-mode-style priority — see
  `mod_decompose_mode` Decision §5).
- The 4-arm priority check in the Escape dispatch widens to a 5-arm
  check; the existing four modes continue to take priority correctly
  (regression-pinned by the existing keymap tests).
- The `<CaptureDefeaterModeExitButton>` mount installs an
  `attachCaptureKeymap({ onExitMode: exitCaptureDefeaterMode })`
  listener while mounted AND `mode === 'capture-defeater'`; the cleanup
  function removes the listener on unmount OR on a mode flip away from
  capture-defeater.

### 5. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains
  `moderator.contextMenu.node.captureDefeater` AND
  `moderator.captureDefeater.{exit.ariaLabel, exit.tooltip,
  banner.targetWording}` with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` gain the same 4 keys with the drafts.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` gain `pending: true` entries for each of the 4
  keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after the
  edits.

### 6. Vitest cases (per ADR 0022)

Minimum 16 new cases across five files:

**`apps/moderator/src/stores/captureStore.test.ts`** (≥ 6 new cases):

1. `captureDefeaterTargetNodeId` is `null` in the initial state.
2. `enterCaptureDefeaterMode('n1')` sets `mode === 'capture-defeater'`
   and `captureDefeaterTargetNodeId === 'n1'`.
3. `enterCaptureDefeaterMode('n1')` clears F1 slices (`text`,
   `classification`, `targetEntityId`, `targetEntityKind`, `edgeRole`,
   `edgeDirection`) — set them all to non-default values first, then
   call the helper, then assert all six are at their initial-state
   values.
4. `enterCaptureDefeaterMode` uses a single `set()` — subscribe to
   the store, count subscriber notifications, assert exactly one
   transition per call.
5. `exitCaptureDefeaterMode()` reverts mode to `'idle'` and clears
   `captureDefeaterTargetNodeId`; F1 slices unchanged from whatever
   the pre-exit state held.
6. `reset()` clears `captureDefeaterTargetNodeId` to `null`.

**`apps/moderator/src/graph/GraphCanvasPane.test.tsx`** (≥ 3 new
cases):

7. `buildNodeMenuItems(target)` (no extra args) renders a
   `capture-defeater` item whose `onSelect` calls the legacy
   `actionStub` (regression-pinned for the new factory shape).
8. `buildNodeMenuItems(target, ..., onEnterCaptureDefeaterMode)`
   renders a `capture-defeater` item whose `onSelect` calls
   `onEnterCaptureDefeaterMode(target.id)` exactly once per
   activation.
9. Right-clicking a rendered node and clicking the "Capture
   defeater" menu item transitions
   `useCaptureStore.getState().mode` to `'capture-defeater'` and sets
   `captureDefeaterTargetNodeId` to the node's id.

**`apps/moderator/src/layout/ProposalModeExitAffordance.test.tsx`**
(≥ 4 new cases):

10. `<ProposalModeExitAffordance mode="capture-defeater" />` renders
    `null` when `useCaptureStore.getState().mode !== 'capture-defeater'`.
11. `<ProposalModeExitAffordance mode="capture-defeater" />` renders
    the testid-prefixed `capture-defeater-mode-exit` button + the
    `capture-defeater-mode-target-wording` overlay when mode is
    `'capture-defeater'` AND `captureDefeaterTargetNodeId` is set AND
    the events log contains the matching `node-created` event for X.
12. The aria-label / tooltip / target-wording overlay each resolve
    to the catalog-correct string from the
    `moderator.captureDefeater.*` namespace.
13. Click on the exit button calls
    `useCaptureStore.getState().exitCaptureDefeaterMode()` once; mode
    reverts to `'idle'`; the component unmounts (renders `null`) on
    the next render pass.

**`apps/moderator/src/layout/CaptureDefeaterModeExitButton.test.tsx`**
(≥ 2 new cases — thin wrapper):

14. The wrapper renders `<ProposalModeExitAffordance
    mode="capture-defeater" />` (verified by asserting the
    container's testid is `capture-defeater-mode-exit-container`
    when in the right mode).
15. Per-locale parity round-trip — render the wrapper with each of
    the three v1 locales; assert the aria-label, tooltip, and
    target-wording overlay each resolve to a non-key string (not
    the literal `'moderator.captureDefeater.exit.ariaLabel'` etc.)
    and that the non-en-US values differ from en-US.

**`apps/moderator/src/layout/captureKeymap.test.ts`** (≥ 1 new case):

16. `attachCaptureKeymap({ onExitMode: handler })` calls `handler`
    on `Escape` once `useCaptureStore.setState({ mode:
    'capture-defeater' })` flips the mode; does NOT call `handler`
    while the store's mode is `'idle'`. When both `onExitMode` and
    `onClearTarget` are supplied AND mode is `'capture-defeater'`,
    `Escape` calls `onExitMode` once AND does NOT call
    `onClearTarget` (priority order regression-pinned).

### 7. Playwright e2e (new `test()` block in `moderator-capture.spec.ts`)

Extending the existing `test.describe('moderator capture flow', ...)`
group:

```ts
test('capture-defeater mode: right-click → mode banner reads "Capture defeater" → Esc returns to idle', async ({ page }) => {
  // 1. Login + POST /api/sessions + goto /sessions/<id>/operate
  //    (same setup as the existing capture-flow tests).
  await loginAs(page, { username: 'alice' });
  // ... POST /api/sessions ... goto /sessions/<id>/operate ...

  // 2. Seed a node X into the WS store via the existing
  //    __aConversaWsStore seam (same template as the decompose-mode
  //    e2e — seed node 'x1' with wording "Workers should earn a
  //    living wage.").

  // 3. Right-click the seeded node → assert the context menu opens.
  await page.locator('[data-testid="node-x1"]').click({ button: 'right' });
  await expect(page.getByTestId('graph-context-menu')).toBeVisible();

  // 4. Click "Capture defeater" in the menu.
  await page.getByTestId('graph-context-menu-item-capture-defeater').click();

  // 5. Assert the mode banner now reads the capture-defeater label.
  await expect(page.getByTestId('mode-banner-label')).toHaveText('Capture defeater');
  // 5a. Assert the mode banner's data-mode attribute is now 'capture-defeater'.
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'capture-defeater');
  // 5b. Assert the exit-button is now visible.
  await expect(page.getByTestId('capture-defeater-mode-exit')).toBeVisible();
  // 5c. Assert the target-wording overlay shows the seeded node's
  //     wording (which X is being defeated).
  await expect(page.getByTestId('capture-defeater-mode-target-wording')).toContainText(
    'Workers should earn a living wage.',
  );

  // 6. Press Esc → assert the mode banner reverts to the idle label.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');
  // 6a. Assert the exit-button is no longer in the DOM.
  await expect(page.getByTestId('capture-defeater-mode-exit')).toHaveCount(0);
});
```

The test asserts the mode-entry + mode-exit chain only — per the
UI-stream e2e scoping caveat, the defeater node creation + rebut edge
emission + propose-substance-agreed cycle is not yet wired, so the
test does NOT attempt to type the defeater wording or propose
anything. The sibling tasks' refinements own those assertions.

### 8. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_capture_defeater_mode` block gets
  `complete 100` after the `allocate team` line plus a `note
  "Refinement: tasks/refinements/moderator-ui/mod_capture_defeater_mode.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_capture_defeater_mode_native_review` is added (effort 0.5d;
  `depends !<current tail of the native-review chain>` — the Closer
  reads the current tail at register time).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_capture_defeater_mode_native_review "Native-speaker review of pt-BR + es-419 capture-defeater-mode strings (4 keys: moderator.contextMenu.node.captureDefeater + moderator.captureDefeater.*)" {
  effort 0.5d
  allocate team
  depends !<current native-review tail>
  note "Source of debt: mod_capture_defeater_mode (this commit) — pt-BR and es-419 drafts of the 4 new keys (moderator.contextMenu.node.captureDefeater, moderator.captureDefeater.exit.ariaLabel, moderator.captureDefeater.exit.tooltip, moderator.captureDefeater.banner.targetWording) landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review). The banner.targetWording string carries the ICU {nodeWording} substitution — review the localized form's grammatical fit when the substituted wording is a complete sentence with terminal punctuation (the same review note as the four prior mode-entry native-review follow-ups)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 9. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### D1. Scope: mode-entry seam + visual signal + exit affordance + node-context-menu entry point ONLY

This task is the foundation of `mod_defeater_flow`. The parent block
has three children:

- `mod_capture_defeater_mode` (this task) — mode entry + target
  selected.
- `mod_defeater_node_creation` (depends on this) — create the
  defeater node Y + the rebut edge Y → X in one action.
- `mod_defeater_substance_precommit` (depends on
  `mod_defeater_node_creation`) — pre-commit the rebut edge's
  substance as `agreed` via `propose set-edge-substance`.

Considered: bundling node-creation into this task (2d total).
*Rejected* — the WBS already splits them (two separate 1d tasks) and
the split is intentional: the node-creation step requires the
moderator to type Y's wording, classify it, sequence two
entity-creation events client-side (`node-created` + `edge-created`),
handle their failure modes, and update the bottom-strip surface — non-
trivially more work than a single mode-entry helper. Bundling would
push this task to 2d+ and delay the substance pre-commit sibling.

### D2. Entry-point placement: between `'run-warrant-elicitation-test'` and `'propose-meta-disagreement'`

Considered alternatives for the new menu item's placement:

- **(a) Top of the menu (before `'propose-vote'`)** — *Rejected*.
  Vote / decompose / interpretive-split are the high-frequency moves
  that should stay at the top.
- **(b) After `'propose-interpretive-split'` (next to the other
  proposal-style items)** — *Rejected*. Defeater capture is a
  reactive move (the moderator captures a defeater **in response** to
  a participant's retraction-condition statement during an
  operationalization test), not a proactive restructuring proposal.
  It groups better with the diagnostic-test items.
- **(c) Between `'run-warrant-elicitation-test'` and
  `'propose-meta-disagreement'`** — **Chosen.** Reading top-to-bottom,
  the menu now follows the methodology's escalating-commitment order:
  propose-vote (low) → propose-restructure (decompose / interpretive-
  split / edit-wording) → run-diagnostic (operationalization /
  warrant-elicitation) → **capture-defeater** (the structural
  response to a successful retraction-condition diagnostic) →
  propose-meta-disagreement → annotate → axiom-mark (highest, deepest
  commitment). The placement reinforces the methodology's reading.
- **(d) After `'axiom-mark'` (at the menu's tail)** — *Rejected*.
  Axiom-mark is the "highest commitment" item that should remain
  last; appending defeater after it would weaken that signal.

### D3. State location: extend `useCaptureStore` with a new slice + helpers

This task follows the established convention from `mod_decompose_mode`
Decision §3, `mod_operationalization_mode` Decision §D4, and
`mod_warrant_elicitation_mode` Decision §D4: per-mode target-tracking
slices live on `useCaptureStore` alongside the existing four. The
two-helper coupling (atomic `set()` + F1-clear) is the same pattern,
applied to a new mode value. No new module or separate store. The
slice-naming convention (`<mode>TargetNodeId`) and the helper-naming
convention (`enter<Mode>Mode` / `exit<Mode>Mode`) extend cleanly to
the camelCased `capture-defeater` → `captureDefeater`.

Considered: a generic `currentTargetNodeId` slice shared across
modes. *Rejected* — already settled against in
`mod_decompose_mode` Decision §3 (different modes may eventually need
different target shapes; per-mode slices keep the type narrow).

### D4. F1 slice clearing on capture-defeater mode entry

`enterCaptureDefeaterMode(nodeId)` clears `text`, `classification`,
`targetEntityId`, `targetEntityKind`, `edgeRole`, `edgeDirection`
atomically with the mode flip.

The rationale is identical to `mod_decompose_mode` Decision §6 (the
canonical write-up) — avoid F1-draft bleed-through, match the
"switching tasks" mental model, document the coupling for future
reviewers. Same convention applied by
`mod_interpretive_split_mode`, `mod_operationalization_mode`, and
`mod_warrant_elicitation_mode`. The defeater case has the same
shape: a moderator who has been composing a new statement in F1 and
then right-clicks a node to defeat it should not accidentally fire a
stale F1 propose with the carried-through text.

A test asserts the coupling (case 3 in the
`captureStore.test.ts` addition — Acceptance criterion 6.3).

### D5. Bottom-strip surface during capture-defeater mode: F1 capture pane shows through

This task does NOT add a `<CaptureDefeaterCapturePanel>` or swap the
bottom-strip's textInput / classificationPalette / edgeRoleSelector
slots when `mode === 'capture-defeater'`. The sibling task
`mod_defeater_node_creation` owns the bottom-strip surface for
capturing Y's wording.

Considered alternatives:

- **(a) Ship a placeholder `<CaptureDefeaterCapturePanel>` in this
  leaf** (mirroring `mod_operationalization_mode`'s approach where it
  shipped `<OperationalizationCapturePanel>` as part of the mode-entry
  leaf). *Rejected.* Operationalization needed the placeholder panel
  because the operationalization flow has no separate "input UI"
  sibling task — the answer-route chips ARE the panel's payload, and
  there is no F5/F6/F7 task that owns the answer textarea + chip
  layout. Defeater capture is different: the sibling
  `mod_defeater_node_creation` explicitly owns the Y-wording capture
  + the node-creation macro. Shipping a placeholder panel here would
  duplicate that sibling's scope.
- **(b) Leave the F1 pane showing through during capture-defeater
  mode** — **Chosen**. Same approach `mod_decompose_mode` took before
  `mod_multi_component_capture` landed: the mode-entry task ships the
  mode banner + exit affordance only, and the bottom-strip surface
  catches up in the sibling task. The F1 pane is empty after the
  F1-clear coupling on entry (no stale text), so the moderator sees
  an idle-looking capture pane with the mode-banner saying "Capture
  defeater" — visually clear that the mode is active but no input is
  yet wired. The next sibling task closes the gap.
- **(c) Render a "Coming soon — wiring lands in
  mod_defeater_node_creation" disabled stub** — *Rejected*. Adds
  scaffolding that gets ripped out in the next commit; misleading
  ergonomic for the moderator.

### D6. Out of scope: keyboard shortcut

`docs/moderator-ui.md` L201–212 lists shortcuts including `Cmd+D`
(decompose), `Cmd+W` (warrant elicitation), `Cmd+O` (operationalization),
and `Cmd+S` (snapshot), but **no defeater-specific shortcut**. The
methodology surface lists "Capture defeater" only as a mode banner
entry (L193), not in the shortcuts list. The
`i18n_keyboard_shortcuts_policy` task pinned the english-mnemonic
approach and shipped the executable mapping at
`packages/i18n-catalogs/src/keyboard-shortcuts.ts`; adding a new
shortcut belongs to a separate refinement when scoped.

The context-menu entry plus the future F7-driven `route-defeater` chip
in `<OperationalizationCapturePanel>` together cover the realistic
entry paths for v1. If shortcut demand emerges, a future
`mod_capture_defeater_shortcut` task (effort 0.5d) can land it
without changing this task's shape.

### D7. No new ADR

Five potential triggers, all dispatched:

- **"Adding a new store slice with coupled multi-field updates is
  ADR-worthy."** No — `mod_decompose_mode` Decision §10 already
  settled this question. The pattern is now five-times-precedent.
- **"Adding a new mode value (5th) to the capture pane is
  ADR-worthy."** No — `'capture-defeater'` is already in the
  `CaptureMode` enum; this task does NOT add an enum value, only the
  per-mode slice + helpers + UI plumbing the enum implies.
- **"Widening `ProposalMode` from 4 to 5 is ADR-worthy."** No —
  `mod_warrant_elicitation_mode` Decision §D2 already settled the
  symbol-name-preservation convention. This task extends one more arm
  in a 4-arm switch; no new architectural question arises.
- **"Adding mode-aware Escape dispatch for a 5th mode is
  ADR-worthy."** No — `mod_decompose_mode` Decision §5 settled the
  priority rule; subsequent modes just append disjuncts.
- **"Defeater capture in the UI is ADR-worthy."** No —
  [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)
  settled the engine-side layering (Option B: defeater capture is a
  UI macro on existing event primitives). This refinement implements
  the UI side of that already-settled architecture; no new decision.

The architectural choices this task implements were all settled by
prior tasks; this refinement is the task-scope pin for the specific
mode-entry seam.

### D8. Insert the new `onEnterCaptureDefeaterMode?` parameter before the two submenu openers, not at the tail

Considered alternatives for the new optional parameter's position:

- **(a) Append at the tail** (after `onOpenEditWordingSubmenu?`).
  *Rejected.* While appending is the lowest-immediate-churn shape, it
  groups all the mode-entry handlers together (positions 3–8) and
  splits them with submenu openers (positions 9–10) — the resulting
  signature reads as a list with mixed semantics. Future mode-entry
  additions would either continue the pattern (and the mode-entry
  cluster keeps growing in the middle of two submenu openers) OR
  break the pattern and create more drift.
- **(b) Insert between `disabledRunWarrantElicitationTest?` and
  `onOpenAnnotateSubmenu?`** — **Chosen**. Keeps all mode-entry
  handler parameters contiguous in positions 3–9, with the submenu
  openers at positions 10–11. The submenu-opener consumers (the
  canvas's `<GraphCanvasPaneInner>` call site at ~L1544) shift two
  positions — the only call site that supplies those openers — and
  the shift is a one-line edit. The factory-shape tests at
  `GraphCanvasPane.test.tsx` that invoke `buildNodeMenuItems` with
  only `target` (no extra args) continue to pass without changes
  because every parameter remains optional.

### D9. No `disabled` gate on the `'capture-defeater'` menu item

`docs/moderator-ui.md` F6 step 1 ("Trigger Capture defeater with X
(the target) selected") imposes no methodology-state precondition on
X. Defeater capture is the moderator's reactive response to a
participant naming a retraction condition — the moderator can
plausibly want to capture a defeater against any node (committed-data,
disputed-claim, even a still-`awaiting-proposal` node that the
participant is foreshadowing a retraction-condition argument against).
The methodology engine's `defeater_capture_logic` confirms there is
no defeater-specific validation rule.

Contrast with `'run-operationalization-test'` and
`'run-warrant-elicitation-test'`, which DO carry a
`disputationOutcome(node.facetStatuses.substance) !== 'claim'` gate
per [`mod_disputation_test_display.md`](mod_disputation_test_display.md)
+ `docs/methodology.md` L130–133 ("a node is a claim warranting
operationalization iff its substance facet is disputed /
meta-disagreement"). The diagnostic tests are gated on disputation
state; structural responses (decompose, capture-defeater) are not.

### D10. The is-ought prompt does NOT mount in capture-defeater mode

`<IsOughtPrompt>` is gated on `mode === 'operationalization' || mode
=== 'warrant-elicitation'`
([apps/moderator/src/layout/IsOughtPrompt.tsx:15](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L15)).
This task does NOT extend that gate to include capture-defeater. The
is-ought prompt is a diagnostic-test reactive cue ("the participant is
about to answer a normative-flavored question; does the question
itself carry an ought-claim?"); it is not relevant to
defeater-capture flow (where the participant is naming concrete
empirical retraction conditions, not making normative claims).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- New store slice `captureDefeaterTargetNodeId: string | null` + setter `setCaptureDefeaterTargetNodeId` + helpers `enterCaptureDefeaterMode` / `exitCaptureDefeaterMode` added to `apps/moderator/src/stores/captureStore.ts`; F1-coupling clear on entry confirmed by Vitest case.
- `buildNodeMenuItems` in `apps/moderator/src/graph/GraphCanvasPane.tsx` extended with optional 9th parameter `onEnterCaptureDefeaterMode?` and new `'capture-defeater'` menu item inserted between `'run-warrant-elicitation-test'` and `'propose-meta-disagreement'`; canvas call site wired with stable `useCallback`.
- `ProposalMode` union widened from 4 → 5 arms (`'capture-defeater'` added), `MODE_KEYS` + `targetNodeId`/`exitMode` switches extended in `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`.
- New thin-wrapper component `apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx` (mirrors `OperationalizationModeExitButton`), mounted as 5th sibling in `modeBanner` slot in `apps/moderator/src/routes/Operate.tsx`.
- `captureKeymap.ts` Escape branch widened from 4 → 5 mode disjuncts (`'capture-defeater'` added).
- 4 new i18n keys × 3 locales = 12 catalog entries in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; 8 PENDING entries in `{pt-BR,es-419}.review.json`.
- 1 new Playwright `test()` block in `tests/e2e/moderator-capture.spec.ts` covering right-click → mode-banner flip → Esc-exit chain.
- Vitest additions: 8 captureStore cases, 2 captureKeymap cases, 5 GraphCanvasPane factory/wire-up cases + 1 render check, 16 CaptureDefeaterModeExitButton cases (new file `apps/moderator/src/layout/CaptureDefeaterModeExitButton.test.tsx`).
- Tech-debt: native-speaker review of pt-BR + es-419 drafts for the 4 new keys parked in `tasks/parking-lot.md` (human-only work, not a WBS task per ritual rules).
