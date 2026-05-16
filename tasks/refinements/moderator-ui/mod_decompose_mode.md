# Moderator decompose-mode entry — flip the capture pane into `decompose` for a selected node

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_decompose_flow.mod_decompose_mode`.

```
task mod_decompose_mode "Enter decomposition mode for selected node" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. The work is store-slice + context-menu wire + banner extension +
i18n + tests on top of seams already in place:

- `useCaptureStore` already carries the `mode: CaptureMode` slice with `'decompose'`
  as one of its eight valid values (`apps/moderator/src/stores/captureStore.ts:33-41,60,78`);
  the `setMode(mode)` setter is the same shape `ModeBanner` already reads.
- `<ModeBanner>` already reads `mode` and resolves `moderator.modeBanner.<mode>.{label,description}`
  per locale (`apps/moderator/src/layout/ModeBanner.tsx:28-51`); the
  `moderator.modeBanner.decompose.{label,description}` keys already shipped with
  `mod_mode_banner`'s 16 keys × 3 locales (per its Status block). Verifying the
  decompose-mode banner copy renders is a small Vitest case; this task does
  **not** mint any new modeBanner keys.
- The node context menu's `propose-decompose` stub is at
  `apps/moderator/src/graph/GraphCanvasPane.tsx:227-231` ready to be swapped from
  `actionStub('propose-decompose', target)` to the real mode-enter handler.
  Direct precedent: `mod_axiom_mark_action` swapped the analogous `axiom-mark`
  stub at lines 242-246 via an optional `onOpenAxiomMarkSubmenu?: () => void`
  parameter on `buildNodeMenuItems`; this task uses the same factory-extension
  shape.
- `mod_axiom_mark_action` already established the "context-menu item flips a
  canvas-local UI flag" pattern; the decompose-mode entry is structurally
  simpler (no submenu — the only argument is the target node id, which is in
  hand from the right-click context).
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419 drafts is
  established by every prior moderator-UI task (most recently
  `mod_axiom_mark_action`'s 6 keys × 3 locales = 18 entries).

Concretely the deliverable is:

- **One new store slice** on `useCaptureStore`:
  `decomposeTargetNodeId: string | null` + `setDecomposeTargetNodeId(id)`;
  the existing `reset()` clears it via the spread of `initialCaptureState`.
  Decision §3 below records the slice-on-existing-store choice vs. a new module.
- **Two new store-coordination helpers** factored next to the existing setters:
  `enterDecomposeMode(nodeId)` — sets `mode = 'decompose'`, sets
  `decomposeTargetNodeId = nodeId`, AND clears the F1 capture-flow slices
  (`text = ''`, `classification = null`, `targetEntityId = null`,
  `edgeRole = null`) so a stale F1 draft does not bleed into the decompose
  flow. `exitDecomposeMode()` — sets `mode = 'idle'`,
  `decomposeTargetNodeId = null`; the F1 slices are NOT re-populated (a
  cancelled decompose loses no F1 state because entering decompose already
  cleared them). Decision §6 records the coupling rationale.
- **`buildNodeMenuItems` extension** in `apps/moderator/src/graph/GraphCanvasPane.tsx`
  — add an optional `onEnterDecomposeMode?: (nodeId: string) => void`
  parameter (mirrors the `onOpenAxiomMarkSubmenu?` parameter at line 219).
  When supplied, the `propose-decompose` item's `onSelect` calls
  `onEnterDecomposeMode(target.id)` instead of `actionStub('propose-decompose',
  target)`. When omitted (direct unit-test invocations), the legacy stub is
  retained so existing factory-shape tests do not churn. Decision §2 records
  the placement.
- **`<GraphCanvasPaneInner>` wire-up** — the canvas threads
  `(nodeId) => useCaptureStore.getState().enterDecomposeMode(nodeId)` as the
  `onEnterDecomposeMode` argument when building the node menu items at
  `GraphCanvasPane.tsx:920`. No new canvas-local state (unlike axiom-mark,
  the decompose flow does NOT need a sibling submenu — the only piece of
  follow-up UI lives in the capture pane via `mod_multi_component_capture`).
- **`<BottomStripCapture>` banner-area extension** for the exit affordance —
  a small `×` button + the "Decomposing {{nodeWording}}" target wording.
  Decision §4 settles where this lives: the banner's existing slot already
  hosts `<ModeBanner>`; the exit-button lives in a new sibling render to the
  banner, gated on `mode === 'decompose'` and only inside the
  bottom-strip-mode-banner row. This task ships the exit button as a sibling
  to `<ModeBanner>` inside `<OperateRoute>`'s `modeBanner` prop —
  `<ModeBanner />` + `<DecomposeModeExitButton />` together fill the slot.
- **One new component** `apps/moderator/src/layout/DecomposeModeExitButton.tsx`
  — reads `mode` and `decomposeTargetNodeId` from `useCaptureStore`; reads
  the target node's wording from the events log via
  `useDecomposeTargetWording(nodeId, events)` (a small local helper that
  walks `events` for the matching `node-created` event). Renders nothing
  when `mode !== 'decompose'`. When mode is decompose, renders a small
  inline `<button data-testid="decompose-mode-exit">` carrying the
  localized aria-label "Exit decompose mode" and a `×` glyph; click fires
  `useCaptureStore.getState().exitDecomposeMode()`. The "Decomposing
  {{nodeWording}}" copy lives in the modeBanner description (already shipped
  by `mod_mode_banner` — the description for the `decompose` mode is the
  natural place for the operator-facing wording). Decision §7 records the
  wording-resolution and ICU choice.
- **`captureKeymap` extension** — a new optional handler
  `onExitMode?: () => void` on `CaptureKeymapHandlers`. The keymap's
  existing `Escape` handler (which today routes to `onClearTarget`)
  dispatches `onExitMode` first if mode is `'decompose'`, otherwise falls
  through to `onClearTarget`. Decision §5 records the priority order. The
  `<DecomposeModeExitButton>` component wires `onExitMode` to
  `exitDecomposeMode` via `attachCaptureKeymap` on mount; cleans up on
  unmount.
- **3 new i18n catalog keys** under `moderator.decompose.*`:
  - `moderator.decompose.exit.ariaLabel` — "Exit decompose mode" /
    pt-BR draft / es-419 draft.
  - `moderator.decompose.exit.tooltip` — "Cancel decomposition (Esc)" /
    pt-BR / es-419 drafts.
  - `moderator.decompose.banner.targetWording` — ICU "Decomposing
    {nodeWording}" / pt-BR / es-419 drafts. Note: this is the
    operator-facing target-wording string that decorates the existing
    `moderator.modeBanner.decompose.description` ("Capture the
    components that replace the parent."). The two keys compose: the
    `<ModeBanner>` renders the mode-generic description; the
    `<DecomposeModeExitButton>` (rendered alongside) carries the
    target-specific wording via this new key.

  3 keys × 3 locales = 9 catalog entries. No new modeBanner keys are minted —
  the existing `moderator.modeBanner.decompose.{label,description}` keys
  cover the always-on label + description; this task's 3 new keys cover the
  decompose-specific exit affordance + the target-node-wording overlay.
- **1 follow-up tech-debt task** registered in `tasks/35-frontend-i18n.tji`
  for the native-speaker review of the 6 new pt-BR / es-419 draft entries
  (`i18n_decompose_mode_native_review`, effort 0.5d,
  `depends !i18n_axiom_mark_pending_render_native_review` — the current tail
  of the native-review chain per `tasks/35-frontend-i18n.tji:190-196`).
- **Vitest cases** under `apps/moderator/src/stores/captureStore.test.ts`
  (the `enterDecomposeMode` / `exitDecomposeMode` semantics + the
  `decomposeTargetNodeId` slice + the F1-coupling clear),
  `apps/moderator/src/layout/DecomposeModeExitButton.test.tsx` (the render
  gating, the click handler, the Esc keymap, the localized aria-label per
  locale), and an extension to
  `apps/moderator/src/graph/GraphCanvasPane.test.tsx` for the `onEnterDecomposeMode`
  parameter on `buildNodeMenuItems` + the canvas-wired click → store-mode
  flip.
- **Playwright e2e** in `tests/e2e/moderator-capture.spec.ts` — extend with a
  new `test()` block under the existing `test.describe('moderator capture
  flow', ...)` group; seed a node into the WS store via the existing
  `__aConversaWsStore` seam (same template as the axiom-mark e2e at lines
  700-842), right-click → click "Propose decompose" → assert mode banner
  reads "Decompose" + the exit-button is visible → press Escape → assert
  mode banner reverts to "Idle" + exit-button is gone.

## Inherited dependencies

Parent (`mod_decompose_flow`) declares `depends !mod_capture_flow,
data_and_methodology.methodology_engine.decomposition_logic`:

Settled (every gating dep is done):

- **`moderator_ui.mod_capture_flow`** (parent dep — done via the chain of
  five leaf tasks: `mod_capture_text_input`, `mod_classification_palette`,
  `mod_target_auto_suggest`, `mod_target_clear_override`,
  `mod_edge_role_selector`, `mod_propose_action`). The F1 capture-flow's
  state shape, the captureStore slice naming, the `captureKeymap`
  attach-on-mount / cleanup-on-unmount pattern (`apps/moderator/src/layout/captureKeymap.ts`
  + the consumers `CaptureTargetChip.tsx` line 73, `EdgeRoleSelector.tsx`
  line 35), the i18n catalog workflow, and the mode-aware Escape dispatch
  pattern are all in place. **The F1 slice clearing on decompose-mode-entry
  is the coupling this task documents (Decision §6).**
- **`data_and_methodology.methodology_engine.decomposition_logic`**
  (done — 2026-05-10 per `decomposition_logic.md`'s Status block). The
  propose-side validator for the `decompose` proposal sub-kind enforces
  the four methodology rules (parent-node-exists, parent-node-visible,
  no-conflicting-pending-decompose, structural-shape-via-Zod). **This task
  is the mode-entry UI seam; it does NOT emit a `propose` envelope** (that
  is `mod_propose_decomposition`'s scope). The methodology validator only
  matters for this task to the extent that it pins the eventual wire
  shape that `mod_multi_component_capture` + `mod_propose_decomposition`
  will write to.

Inherited from the `mod_capture_flow` parent chain (additional settled deps
this task transitively relies on):

- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done —
  `<BottomStripCapture>` exposes the `modeBanner` render-prop slot with the
  stable `bottom-strip-mode-banner` `data-testid`; the exit button mounts
  inside this slot alongside `<ModeBanner>` — see Decision §4).
- **`moderator_ui.mod_layout.mod_mode_banner`** (done — banner reads
  `useCaptureStore((s) => s.mode)` and renders the localized
  `moderator.modeBanner.<mode>.{label,description}`; the `decompose` mode's
  16 keys already shipped per its Status block).
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore` declared
  at `apps/moderator/src/stores/captureStore.ts` with `mode` + `setMode` +
  `reset` already in place; this task adds **one** new slice
  + **two** coordination helpers on the same store, mirroring the existing
  setter-naming convention).
- **`moderator_ui.mod_graph_rendering.mod_context_menus`** (done — shipped
  `<GraphContextMenu>` + the node menu's `propose-decompose` stub at
  `GraphCanvasPane.tsx:227-231` and the `buildNodeMenuItems` factory at
  lines 217-248. This task swaps the `propose-decompose` item's stub via
  the same optional-parameter shape `mod_axiom_mark_action` introduced).
- **`moderator_ui.mod_axiom_mark_action`** (done — 2026-05-16, immediate
  precedent for the "context-menu item flips a canvas-local mode-entry
  flag" pattern; this task adopts the same `onOpenXxx?: () => void`
  parameter shape on the menu-item factory).
- **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_testing`** (done — the catalog workflow,
  `*.review.json` PENDING tracker lifecycle, `useTranslation()` + ICU
  interpolation, and per-locale parity assertions are all in place).
- **[ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — `useTranslation()` for catalog access; ICU interpolation for the
  `{nodeWording}` substitution in the decompose banner target string.

Pending edges this task FEEDS (NOT depends on):

- **`moderator_ui.mod_decompose_flow.mod_multi_component_capture`**
  (sibling — depends `!mod_decompose_mode` per the WBS). Will read
  `useCaptureStore((s) => s.decomposeTargetNodeId)` to know which parent
  is being decomposed; will read `mode === 'decompose'` as the visibility
  gate for the multi-component capture UI. The slice + the helper this
  task ships are exactly the seams that sibling task consumes.
- **`moderator_ui.mod_decompose_flow.mod_propose_decomposition`**
  (downstream — depends `!mod_multi_component_capture`). Will read both
  slices + the captured components, build the `propose: decompose`
  envelope per `decompositionProposalSchema`, and call `exitDecomposeMode()`
  on propose-success (same shape as `mod_propose_action`'s post-success
  `useCaptureStore.getState().reset()` for the F1 flow). The `exitDecomposeMode`
  helper this task ships is the propose-action's post-success seam.
- **`moderator_ui.mod_decompose_flow.mod_interpretive_split_mode`**
  (sibling — depends `!mod_decompose_mode`). Will mirror this task's shape
  for `mode === 'interpretive-split'`: a new `interpretiveSplitTargetNodeId`
  slice on the same store, `enterInterpretiveSplitMode(nodeId)` /
  `exitInterpretiveSplitMode()` helpers, an `onEnterInterpretiveSplitMode?`
  parameter on `buildNodeMenuItems`. Decision §1 of this refinement is the
  template the interpretive-split task will replicate; **no new pattern
  needs to be invented** when that sibling task starts.
- **`frontend_i18n.i18n_decompose_mode_native_review`** (registered by this
  task — see Acceptance criteria / Decisions). The pt-BR / es-419 drafts
  of the 3 new keys land flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text.

## What this task is

Land the **mode-entry seam** for the F2 decompose flow. This task is the
foundation of `mod_decompose_flow` — sibling tasks `mod_multi_component_capture`
and `mod_interpretive_split_mode` both depend on it.

"Entering decomposition mode" means three coordinated state changes:

1. **`captureStore.mode` flips from `'idle'` to `'decompose'`.** The existing
   `<ModeBanner>` (mounted in the `bottom-strip-mode-banner` slot) re-renders
   the localized label + description for the new mode; the operator sees the
   visible chrome change.
2. **`captureStore.decomposeTargetNodeId` is set to the right-clicked
   node's id.** This is the new slice this task adds. The sibling
   `mod_multi_component_capture` reads it to know which parent the captured
   components are replacing; the sibling `mod_propose_decomposition` reads it
   to populate `proposal.parent_node_id` when building the propose envelope.
3. **The F1 capture-flow slices clear.** `text = ''`, `classification = null`,
   `targetEntityId = null`, `edgeRole = null`. A stale in-progress F1 draft
   must not bleed into the decompose flow (Decision §6 — coupling
   documentation).

The task also ships:

- The **exit affordance** — a small `×` button next to the mode banner +
  an `Escape` keypress (mode-aware: when `mode === 'decompose'`, Escape
  exits the mode rather than clearing the staged target). Click or
  Escape calls `exitDecomposeMode()`: `mode → 'idle'`,
  `decomposeTargetNodeId → null`. No F1 slice re-population — a cancelled
  decompose loses no F1 state because entering decompose already cleared
  them.
- The **localized target-wording overlay** — "Decomposing {{nodeWording}}"
  appears alongside the existing mode-banner description, so the moderator
  sees at a glance which node is being decomposed. The wording is resolved
  by walking the events log for the matching `node-created` event (the
  same shape `<StatementNode>` uses).
- The **node context-menu wiring** — the existing `propose-decompose`
  stub on the node context menu becomes the real mode-enter action. Per
  the moderator-ui.md F2 specification: "Enter decomposition mode
  (shortcut or node context menu). The capture pane changes to
  multi-component capture." This task wires the **context-menu** entry
  point; the keyboard-shortcut entry point (`Cmd+D` per
  `docs/moderator-ui.md:192`) is out of scope (Decision §8 — there is no
  WBS task for it yet, and adding shortcuts is the
  `i18n_keyboard_shortcuts_policy` task's scope).

**This task is JUST the mode entry + visual signal + exit affordance.**
Out of scope (sibling-task ownership):

- The component-capture UI itself (`mod_multi_component_capture`).
- The propose-decomposition wire envelope (`mod_propose_decomposition`).
- The interpretive-split variant (`mod_interpretive_split_mode` — structurally
  analogous, will reuse the patterns this task lays down).
- The `Cmd+D` keyboard shortcut entry point (not WBS-scoped; the
  `i18n_keyboard_shortcuts_policy` task already shipped the
  english-mnemonic policy + the executable shortcut mapping at
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts` but no
  decompose-shortcut entry exists there yet — that addition would
  belong to a `mod_decompose_shortcut` follow-up if one is registered).

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_multi_component_capture` and `mod_interpretive_split_mode` cannot
   land without it.** Both sibling tasks declare `depends !mod_decompose_mode`
   in the WBS (`tasks/30-moderator-ui.tji:339,349`). Until this task ships
   the `mode === 'decompose'` flag and the `decomposeTargetNodeId` slice,
   the multi-component capture UI has no visibility gate and no parent-id
   to operate on.

2. **The methodology depends on decomposition as a first-class move.**
   Per `decomposition_logic.md`'s "Why it needs to be done" (lines 21-22,
   quoting `docs/methodology.md` lines 136-155): *"Decomposition is a
   first-class methodological move, not a fallback. Anyone in the debate
   (the moderator or either debater) may call out that a statement is
   saying too much and propose breaking it down."* The server-side
   validator landed two weeks ago and currently has no UI path to receive
   `propose decompose` envelopes from the moderator console — the
   `propose-decompose` stub at `GraphCanvasPane.tsx:227-231` is the
   visible "this is wired but unimplemented" signal. This task closes the
   first half of that gap (mode entry); the two sibling tasks close the
   second half (capture + propose).

3. **It is the template for `mod_interpretive_split_mode`.** Per
   `docs/moderator-ui.md:62`: *"Interpretive splits use the same flow with
   a different proposal kind."* The interpretive-split mode-entry task
   will mirror this task's exact shape: new slice on
   `useCaptureStore`, new factory parameter on `buildNodeMenuItems`, new
   coordination helpers, new mode-aware Escape dispatch. Settling the
   pattern here once means the interpretive-split task lands as a
   replicate-with-rename rather than a re-design.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- `apps/moderator/src/stores/captureStore.ts:33-41` — the `CaptureMode`
  enum already includes `'decompose'` as one of the eight valid values.
  No enum change needed; this task adds a slice + helpers.
- `apps/moderator/src/stores/captureStore.ts:43-94` — the `CaptureState`
  interface + initial-state object. The new slice
  `decomposeTargetNodeId: string | null` joins alongside the existing
  five slice fields (`text`, `classification`, `targetEntityId`,
  `edgeRole`, `mode`, `proposing`). The `initialCaptureState` Pick
  literal grows by one field; the `reset()` invariant (the spread of
  `initialCaptureState`) clears the new slice automatically.
- `apps/moderator/src/stores/captureStore.ts:96-107` — the store factory
  closure where the two new coordination helpers
  (`enterDecomposeMode(nodeId)` / `exitDecomposeMode()`) land. The
  existing `setMode`, `setText`, `setClassification`, `setTargetEntityId`,
  `setEdgeRole`, `reset` setters are the naming precedent; the two
  helpers compose existing setters rather than minting new ones (Decision
  §3 records why the helpers are part of the store API rather than free
  functions on a separate module).
- `apps/moderator/src/graph/GraphCanvasPane.tsx:217-248` — the
  `buildNodeMenuItems` factory. The `propose-decompose` item at lines
  227-231 currently fires `actionStub('propose-decompose', target)`;
  this task adds an optional `onEnterDecomposeMode?: (nodeId: string)
  => void` parameter (mirrors the existing
  `onOpenAxiomMarkSubmenu?: () => void` parameter at line 219) and the
  item's `onSelect` becomes
  `onEnterDecomposeMode ? () => onEnterDecomposeMode(target.id) : () =>
  actionStub('propose-decompose', target)`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:906-940` — the canvas's
  menu-items builder (the same block that wires
  `onOpenAxiomMarkSubmenu` for the axiom-mark item at line 920). The
  wire-up adds one line:
  `menuItems = buildNodeMenuItems(contextMenu.target, openAxiomMarkSubmenu,
  enterDecomposeMode)` where `enterDecomposeMode` is a stable callback
  `useCallback((nodeId) => useCaptureStore.getState().enterDecomposeMode(nodeId), [])`.
  No new canvas-local state (no submenu to manage — the mode-entry is
  fire-and-store-write).
- `apps/moderator/src/layout/BottomStripCapture.tsx:60-66` — the
  `bottom-strip-mode-banner` slot. The existing `modeBanner` prop is
  unchanged; the route now passes
  `<><ModeBanner /><DecomposeModeExitButton /></>` (a fragment with two
  children) into the slot. Decision §4 settles the placement.
- `apps/moderator/src/layout/ModeBanner.tsx:1-51` — the predecessor
  pattern. The new `<DecomposeModeExitButton>` sits alongside it inside
  the same slot, reading the same `useCaptureStore` slice for
  visibility gating.
- `apps/moderator/src/layout/captureKeymap.ts:67-92` — the
  `CaptureKeymapHandlers` interface. The future-flagged
  `onExitMode?: () => void` at line 90 (`// future: onExitMode?: () =>
  void;`) is exactly this task's deliverable; the comment becomes the
  real declaration.
- `apps/moderator/src/layout/captureKeymap.ts:155-220` — the dispatch
  body. The `Escape` branch (currently invokes `onClearTarget?.()`)
  becomes mode-aware: when `useCaptureStore.getState().mode === 'decompose'`,
  it invokes `onExitMode?.()` and skips `onClearTarget` (decompose-mode
  exit takes priority over target-clear; Decision §5).
- `apps/moderator/src/routes/Operate.tsx:30-61` — the integration site
  (the same one `mod_mode_banner`, `mod_capture_text_input`,
  `mod_classification_palette`, and every other capture-flow task plugs
  into). The `modeBanner` prop's value grows from `<ModeBanner />` to
  `<><ModeBanner /><DecomposeModeExitButton /></>`.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — the catalog gains
  three new keys under a new `moderator.decompose.*` namespace
  (`exit.ariaLabel`, `exit.tooltip`, `banner.targetWording`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.json` — same three keys
  with the pt-BR / es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` — three new `pending: true` entries per locale
  (per the established `*.review.json` lifecycle).
- `tests/e2e/moderator-capture.spec.ts` — the e2e spec that grows by
  one `test()` block under the existing `test.describe('moderator
  capture flow', ...)` group (mirrors the `mod_axiom_mark_action`
  extension at the same file's lines 700-842).
- `tests/e2e/fixtures/auth.ts` — `loginAs(page, { username: 'alice' })`.
  Unchanged; reused.

Refinements consulted for style + decision continuity:

- [`tasks/refinements/data-and-methodology/decomposition_logic.md`](../data-and-methodology/decomposition_logic.md)
  — the canonical methodology: decompose operation removes parent,
  creates components in proposed state. The propose-side validator
  (rules 1-4) is the wire contract the eventual `mod_propose_decomposition`
  task will satisfy; this task surfaces the **mode entry** that primes
  the operator for that propose action.
- [`tasks/refinements/moderator-ui/mod_capture_text_input.md`](mod_capture_text_input.md)
  — F1 capture pattern, the mode-flip + capture-pane parallel. The
  decompose-mode entry mirrors F1's "the bottom strip changes its
  surface" shape; the difference is the decompose flow's surface
  (capturing multiple components) is the sibling task's scope.
- [`tasks/refinements/moderator-ui/mod_classification_palette.md`](mod_classification_palette.md)
  — the `captureKeymap` consumer pattern + the
  attach-on-mount/cleanup-on-unmount discipline; the
  `<DecomposeModeExitButton>` adopts the same shape for its `Escape`
  handler.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_action.md`](mod_axiom_mark_action.md)
  — the precedent for "context menu → action + new mode". This task
  adopts the same `optional-parameter-on-buildNodeMenuItems` shape, the
  same data-testid naming convention (`decompose-mode-exit` mirrors
  `axiom-mark-submenu-*`), and the same i18n catalog namespace shape
  (`moderator.decompose.*` mirrors `moderator.axiomMarkAction.*`).
- [`tasks/refinements/moderator-ui/mod_context_menus.md`](mod_context_menus.md)
  — the menu shell + the `propose-decompose` stub. The stub's
  `actionStub` call is exactly the thing this task replaces.
- [`tasks/refinements/moderator-ui/mod_mode_banner.md`](mod_mode_banner.md)
  — the `<ModeBanner>` precedent + the per-mode catalog shape
  (`moderator.modeBanner.<mode>.{label,description}`). The
  `decompose.{label,description}` keys already shipped per its Status
  block; this task does NOT re-mint them.
- [`tasks/refinements/moderator-ui/mod_bottom_strip_capture.md`](mod_bottom_strip_capture.md)
  — the slot scaffold + the `bottom-strip-mode-banner` testid the
  exit-button mounts inside.
- [`tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md`](../frontend-i18n/i18n_methodology_role_descriptions.md)
  — the canonical PENDING-flag + native-review chain pattern.
- [DESIGN.md:37](../../../DESIGN.md) — design-doc link to
  `docs/moderator-ui.md` for the F2 decompose flow specification.
- [`docs/moderator-ui.md:52-62`](../../../docs/moderator-ui.md) — F2
  flow specification. Step 2: "Enter decomposition mode (shortcut or
  node context menu). The capture pane changes to multi-component
  capture." This task owns the **node context menu** entry path; the
  shortcut path is out of scope (Decision §8).

No new ADR is required (see Decisions §10). No new dependency lands. No
public type signature changes outside `useCaptureStore` (the new slice +
helpers are additive to `CaptureState`). No cross-workspace contract
changes.

## Constraints / requirements

### Store extension (`apps/moderator/src/stores/captureStore.ts`)

- **New slice**: `decomposeTargetNodeId: string | null` added to
  `CaptureState` immediately after the existing `proposing: boolean`
  field. Initial value: `null` (in the `initialCaptureState` literal).
  The slice's reset semantics ride for free via the existing `reset()`
  spread of `initialCaptureState`.
- **New setter**: `setDecomposeTargetNodeId: (id: string | null) => void`
  on `CaptureState`. Conventional one-line setter mirroring the existing
  five setters. **Direct callers should prefer the helpers below; the
  setter exists for symmetry with the other slices and for test seams
  that need to set/clear the slice without invoking the coupled mode
  transition.**
- **New helper**: `enterDecomposeMode: (nodeId: string) => void`. Atomic
  multi-field update inside a single `set()` call:
  ```ts
  enterDecomposeMode: (nodeId) =>
    set({
      mode: 'decompose',
      decomposeTargetNodeId: nodeId,
      // F1-coupling clear (Decision §6):
      text: '',
      classification: null,
      targetEntityId: null,
      edgeRole: null,
    }),
  ```
  Single `set()` ensures subscribers see one consistent transition,
  not seven intermediate render passes.
- **New helper**: `exitDecomposeMode: () => void`. Atomic update:
  ```ts
  exitDecomposeMode: () =>
    set({
      mode: 'idle',
      decomposeTargetNodeId: null,
    }),
  ```
  Does NOT re-populate F1 slices (entering decompose already cleared
  them; cancelling decompose returns the operator to an empty idle —
  there is no prior F1 draft to restore).
- **Pick literal change**: `initialCaptureState`'s `Pick<...>` type
  union grows by one key: `'decomposeTargetNodeId'`. The literal value
  gains `decomposeTargetNodeId: null`. This keeps the
  `reset()`-clears-everything invariant true for the new slice.

### Context-menu factory extension (`apps/moderator/src/graph/GraphCanvasPane.tsx`)

- **`buildNodeMenuItems` signature** grows by one optional parameter:
  ```ts
  export function buildNodeMenuItems(
    target: ContextMenuState['target'],
    onOpenAxiomMarkSubmenu?: () => void,
    onEnterDecomposeMode?: (nodeId: string) => void,  // new
  ): readonly MenuItem[];
  ```
  Positional, after `onOpenAxiomMarkSubmenu`. Adding a third positional
  parameter is the minimum-churn extension; the existing factory-shape
  tests at `GraphCanvasPane.test.tsx` continue to pass without changes
  because the new parameter is optional and defaults to the legacy
  stub.
- **`propose-decompose` item's `onSelect`** becomes:
  ```ts
  onSelect: target.kind === 'node' && onEnterDecomposeMode
    ? () => onEnterDecomposeMode(target.id)
    : () => actionStub('propose-decompose', target),
  ```
  The `target.kind === 'node'` narrow is redundant (node menu items
  always carry node targets) but keeps the type narrowing clean for
  TypeScript readers.
- **Comment update** in the `buildNodeMenuItems` doc-block: add a
  paragraph documenting the `onEnterDecomposeMode` seam parallel to the
  existing `onOpenAxiomMarkSubmenu` paragraph.

### Canvas wire-up (`apps/moderator/src/graph/GraphCanvasPane.tsx`)

- **New callback** inside `GraphCanvasPaneInner`:
  ```ts
  const enterDecomposeMode = useCallback(
    (nodeId: string) => useCaptureStore.getState().enterDecomposeMode(nodeId),
    [],
  );
  ```
  Placed alongside the existing `closeAxiomMarkSubmenu` / `closeContextMenu`
  callbacks (around line 632).
- **Menu-items builder line update** at line 920:
  ```ts
  menuItems = buildNodeMenuItems(contextMenu.target, () => {
    // existing axiom-mark submenu opener
  }, enterDecomposeMode);
  ```
- **No new canvas-local state.** Decompose-mode is global state (it lives
  on `useCaptureStore`); there is no per-canvas transient flag to manage
  (unlike axiom-mark, which needed a canvas-local `axiomMarkSubmenu`
  position state).

### `<DecomposeModeExitButton>` component (`apps/moderator/src/layout/DecomposeModeExitButton.tsx`)

- **New file** exporting `function DecomposeModeExitButton(): ReactElement | null`
  (named export, no default).
- **Store reads**:
  - `const mode = useCaptureStore((s) => s.mode);`
  - `const decomposeTargetNodeId = useCaptureStore((s) => s.decomposeTargetNodeId);`
  - `const exitDecomposeMode = useCaptureStore((s) => s.exitDecomposeMode);`
- **Wording resolution**: read the WS-store's events log for the
  session and find the `node-created` event with the matching node id;
  return its `payload.wording`. The session id comes from the
  `<Operate>` route's URL — the component reads it via the same
  selector pattern other layout components use (or via a small
  `useWordingForNode(nodeId)` hook that lives next to the component
  and encapsulates the events-log walk). Decision §7 records the
  shape choice.
- **Visibility gate**: return `null` when `mode !== 'decompose'`.
  When `mode === 'decompose'` and `decomposeTargetNodeId === null`
  (a transient inconsistency that should never happen given the
  `enterDecomposeMode` atomic update, but defended): render the button
  without the target-wording overlay (just the bare `×` + aria-label).
- **Render shape**:
  ```tsx
  <span data-testid="decompose-mode-exit-container" className="flex items-center gap-2">
    <span data-testid="decompose-mode-target-wording" className="text-xs text-slate-600">
      {t('moderator.decompose.banner.targetWording', { nodeWording })}
    </span>
    <button
      type="button"
      data-testid="decompose-mode-exit"
      aria-label={t('moderator.decompose.exit.ariaLabel')}
      title={t('moderator.decompose.exit.tooltip')}
      onClick={exitDecomposeMode}
      className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      ×
    </button>
  </span>
  ```
- **Escape-key handler** via `attachCaptureKeymap`:
  ```ts
  useEffect(() => {
    if (mode !== 'decompose') return undefined;
    return attachCaptureKeymap({ onExitMode: exitDecomposeMode });
  }, [mode, exitDecomposeMode]);
  ```
  Attaches the keymap only while `mode === 'decompose'`; cleans up on
  unmount or on a mode flip away from decompose. The `onExitMode`
  handler is the new optional handler on `CaptureKeymapHandlers`
  (added by this task — see captureKeymap extension below).

### `captureKeymap` extension (`apps/moderator/src/layout/captureKeymap.ts`)

- **New optional handler** on `CaptureKeymapHandlers`:
  ```ts
  /**
   * Exit the current capture-pane mode (decompose / interpretive-split /
   * other future modes that own their own Escape semantics). Triggered
   * by `Escape` under the same modifier-bail / editable-target /
   * repeat-skip guards as `onClearTarget`. When `mode === 'decompose'`
   * (and future modes), this handler takes priority over `onClearTarget`.
   *
   * Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
   */
  onExitMode?: () => void;
  ```
  Replaces the existing `// future: onExitMode?: () => void;` comment
  at line 90.
- **Dispatch update** in the listener body's `Escape` branch: read
  `useCaptureStore.getState().mode`; if `mode === 'decompose'` (and
  `onExitMode` is supplied), invoke `onExitMode()` and return.
  Otherwise fall through to the existing `onClearTarget` invocation.
  The reverse-priority order (target-clear first, mode-exit second)
  was considered and rejected per Decision §5.
- **Important non-regression**: the existing `onClearTarget` test
  suite at `captureKeymap.test.ts` lines 218-303 must continue to
  pass unchanged when `mode === 'idle'` (the default in the tests'
  store state). The new mode-aware dispatch only activates when
  `mode === 'decompose'`; the test-suite resets the store between
  cases per the established pattern.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.decompose.exit.ariaLabel` | "Exit decompose mode" | "Sair do modo de decomposição" | "Salir del modo de descomposición" |
| `moderator.decompose.exit.tooltip` | "Cancel decomposition (Esc)" | "Cancelar decomposição (Esc)" | "Cancelar descomposición (Esc)" |
| `moderator.decompose.banner.targetWording` | "Decomposing {nodeWording}" | "Decompondo {nodeWording}" | "Descomponiendo {nodeWording}" |

**Count: 3 keys × 3 locales = 9 catalog entries.** pt-BR / es-419 drafts
land flagged PENDING in `pt-BR.review.json` + `es-419.review.json` (6
entries total). Native-speaker review registered as a tech-debt
follow-up (see Acceptance criteria / Decisions).

The new keys live under a new `moderator.decompose.*` top-level
namespace within `moderator.*`. Following the precedent set by
`moderator.axiomMarkAction.*`, `moderator.modeBanner.*`,
`moderator.captureTextInput.*`, etc., the per-feature namespace keeps
the catalog hierarchically browsable.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/stores/captureStore.ts` (modified — new slice +
  helpers).
- `apps/moderator/src/stores/captureStore.test.ts` (modified — new
  cases for the helpers + the slice + the reset invariant).
- `apps/moderator/src/graph/GraphCanvasPane.tsx` (modified —
  `buildNodeMenuItems` parameter + canvas-wired callback).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (modified — new
  cases for the `onEnterDecomposeMode` parameter + the canvas-wired
  click → store flip).
- `apps/moderator/src/layout/DecomposeModeExitButton.tsx` (new).
- `apps/moderator/src/layout/DecomposeModeExitButton.test.tsx` (new).
- `apps/moderator/src/layout/captureKeymap.ts` (modified —
  `onExitMode` handler + mode-aware Escape dispatch).
- `apps/moderator/src/layout/captureKeymap.test.ts` (modified — new
  cases for the mode-aware dispatch).
- `apps/moderator/src/routes/Operate.tsx` (modified — pass
  `<><ModeBanner /><DecomposeModeExitButton /></>` into the
  `modeBanner` prop; update the leading Refinement comment to
  reference `mod_decompose_mode.md` alongside the existing
  refinements).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 3 new
  keys under `moderator.decompose.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 3 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — new `test()`
  block under the existing `test.describe('moderator capture flow',
  ...)` group).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_decompose_mode` lands at
  task-completion time per the README ritual, not at refinement-write
  time. The Closer also adds the new
  `i18n_decompose_mode_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration policy.
- `docs/adr/` — no new ADR (Decision §10).
- `apps/server/src/` — no server-side change. The propose-side
  validator (`decomposition_logic`'s arm in `propose.ts`) is already
  in place and is exercised by `mod_propose_decomposition` (sibling
  task), not this one.
- `apps/moderator/src/layout/ModeBanner.tsx` — unchanged. The
  decompose-mode label + description keys already shipped with
  `mod_mode_banner`'s 16 keys × 3 locales.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — unchanged. The
  scaffold's `modeBanner` slot already accepts any `ReactNode`; a
  fragment of two children is a valid `ReactNode`.
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — no new shortcut
  entry (the `Cmd+D` decompose shortcut is out of scope; Decision §8).
- `playwright.config.ts` — the spec extension joins the existing
  `tests/e2e/moderator-capture.spec.ts` which already runs under the
  `chromium-create-session` project (per
  `mod_axiom_mark_action`'s Status note about the file's project
  membership).

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 18 across the four touched test
  files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity
  check) green after the catalog edits.
- `pnpm -F @a-conversa/moderator build` succeeds (one new small
  component; one extended store; bundle impact negligible).
- `pnpm exec playwright test` green against a freshly brought-up dev
  compose stack; the new decompose-mode e2e scenario passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_decompose_mode` AND the new
  `i18n_decompose_mode_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The decompose-mode entry is reachable from a real user flow as of this
task: the moderator can log in, navigate to `/sessions/new/setup`,
create a session, land on `/sessions/<id>/operate`, seed a node into
the WS store via the existing `__aConversaWsStore` seam (same template
as the axiom-mark and propose-action e2es), right-click it, and click
"Propose decompose" to see the mode banner flip to "Decompose" + the
exit button appear. Per the UI-stream e2e policy default, the
Playwright spec is **scoped under Acceptance criteria, NOT deferred**.

**Important caveat**: `mod_multi_component_capture` and
`mod_propose_decomposition` have not landed, so the decompose-mode
entry leads to a multi-component capture UI that has not yet shipped.
The e2e therefore cannot assert "type N components and propose
decomposition" — it asserts only the **mode-entry + mode-exit chain**
(the load-bearing regression-class property for this task). The
full chain-completing e2e (right-click → capture components →
propose → event lands → graph updates) is scoped to
`mod_propose_decomposition`'s refinement, not this one.

## Acceptance criteria

### 1. Store slice + helpers

- `useCaptureStore`'s `CaptureState` interface carries
  `decomposeTargetNodeId: string | null` +
  `setDecomposeTargetNodeId: (id: string | null) => void` +
  `enterDecomposeMode: (nodeId: string) => void` +
  `exitDecomposeMode: () => void`.
- `initialCaptureState`'s value carries `decomposeTargetNodeId: null`;
  the `Pick<CaptureState, ...>` type union includes
  `'decomposeTargetNodeId'`.
- `useCaptureStore.getState().enterDecomposeMode('<nodeId>')` results
  in `state.mode === 'decompose'`,
  `state.decomposeTargetNodeId === '<nodeId>'`, `state.text === ''`,
  `state.classification === null`, `state.targetEntityId === null`,
  `state.edgeRole === null`. The call uses a single `set()` so
  subscribers observe one transition.
- `useCaptureStore.getState().exitDecomposeMode()` results in
  `state.mode === 'idle'`, `state.decomposeTargetNodeId === null`.
  F1 slices are NOT re-populated (they remain whatever the entry-time
  state left them: empty).
- `useCaptureStore.getState().reset()` clears `decomposeTargetNodeId`
  to `null` alongside the other slices.

### 2. Context-menu factory + canvas wire-up

- `buildNodeMenuItems` accepts an optional third positional parameter
  `onEnterDecomposeMode?: (nodeId: string) => void`. When supplied,
  the `propose-decompose` item's `onSelect` calls
  `onEnterDecomposeMode(target.id)` once per invocation. When
  omitted, the item's `onSelect` calls the legacy `actionStub` (so
  existing factory-shape tests do not need to thread a parameter).
- `<GraphCanvasPaneInner>` builds node menu items with a stable
  `enterDecomposeMode` callback that dispatches to
  `useCaptureStore.getState().enterDecomposeMode(nodeId)`.
- Right-clicking a node and clicking "Propose decompose" in the
  resulting menu transitions `useCaptureStore.getState().mode` from
  `'idle'` to `'decompose'` and sets `decomposeTargetNodeId` to
  the right-clicked node's id.

### 3. Exit-button render gating

- `<DecomposeModeExitButton>` renders `null` when
  `useCaptureStore((s) => s.mode) !== 'decompose'`. The DOM contains
  no `decompose-mode-exit` element in this state.
- `<DecomposeModeExitButton>` renders the button with the
  `decompose-mode-exit` `data-testid`, the localized aria-label, the
  localized tooltip, and the localized target-wording overlay when
  `mode === 'decompose'`.
- Clicking the button calls
  `useCaptureStore.getState().exitDecomposeMode()` once; mode
  reverts to `'idle'`; `decomposeTargetNodeId` reverts to `null`.
- The target-wording overlay reads
  `t('moderator.decompose.banner.targetWording', { nodeWording: '<the
  wording of the targeted node>' })`. When the targeted node's
  wording cannot be resolved (events log doesn't yet contain the
  matching `node-created` event), the overlay renders an empty
  string (component does not throw).

### 4. Escape-key exit (mode-aware)

- `attachCaptureKeymap({ onExitMode: handler })` calls `handler` once
  per `Escape` keypress while `useCaptureStore.getState().mode ===
  'decompose'` (under the same modifier-bail / editable-target /
  repeat-skip guards as `onClearTarget`).
- When `mode === 'idle'`, `Escape` does NOT call `onExitMode` (the
  existing `onClearTarget` dispatch is unchanged).
- When both `onExitMode` and `onClearTarget` are supplied AND
  `mode === 'decompose'`, only `onExitMode` is invoked (decompose-exit
  takes priority — see Decision §5).
- The `<DecomposeModeExitButton>` mount installs an
  `attachCaptureKeymap({ onExitMode: exitDecomposeMode })` listener
  while mounted AND `mode === 'decompose'`; the cleanup function
  removes the listener on unmount OR on a mode flip away from
  decompose.

### 5. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains
  `moderator.decompose.{exit.ariaLabel, exit.tooltip, banner.targetWording}`
  with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` gain the same 3 keys with the drafts.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` gain `pending: true` entries for each of the 3
  keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after the
  edits.

### 6. Vitest cases (per ADR 0022)

Minimum 18 new cases across four files:

**`apps/moderator/src/stores/captureStore.test.ts`** (≥ 6 new cases):

1. `decomposeTargetNodeId` is `null` in the initial state.
2. `enterDecomposeMode('n1')` sets `mode === 'decompose'` and
   `decomposeTargetNodeId === 'n1'`.
3. `enterDecomposeMode('n1')` clears F1 slices (`text`, `classification`,
   `targetEntityId`, `edgeRole`) — set them all to non-default values
   first, then call the helper, then assert all four are at their
   initial-state values.
4. `enterDecomposeMode` uses a single `set()` — subscribe to the
   store, count subscriber notifications, assert exactly one
   transition per call.
5. `exitDecomposeMode()` reverts mode to `'idle'` and clears
   `decomposeTargetNodeId`; F1 slices unchanged from whatever the
   pre-exit state held.
6. `reset()` clears `decomposeTargetNodeId` to `null`.

**`apps/moderator/src/graph/GraphCanvasPane.test.tsx`** (≥ 3 new
cases):

7. `buildNodeMenuItems(target)` (no extra args) renders a
   `propose-decompose` item whose `onSelect` calls the legacy
   `actionStub` (existing behavior, regression-pinned).
8. `buildNodeMenuItems(target, undefined, onEnter)` renders a
   `propose-decompose` item whose `onSelect` calls
   `onEnter(target.id)` exactly once per activation.
9. Right-clicking a rendered node and clicking the
   "Propose decompose" menu item transitions
   `useCaptureStore.getState().mode` to `'decompose'` and sets
   `decomposeTargetNodeId` to the node's id.

**`apps/moderator/src/layout/DecomposeModeExitButton.test.tsx`** (≥ 7
new cases):

10. Renders `null` when `mode === 'idle'`.
11. Renders the button + the target-wording overlay when
    `mode === 'decompose'` AND `decomposeTargetNodeId` is set AND the
    events log contains a matching `node-created` event.
12. Renders the button without an overlay (empty target-wording span)
    when `mode === 'decompose'` AND `decomposeTargetNodeId` is set
    AND the events log does NOT contain a matching `node-created`
    event.
13. Click on the button calls
    `useCaptureStore.getState().exitDecomposeMode()` once; mode
    reverts to `'idle'`; the button unmounts (renders `null`) on the
    next render pass.
14. The aria-label resolves to the catalog-correct string for en-US.
15. Per-locale parity round-trip — render the component with each
    of the three v1 locales; assert the aria-label, tooltip, and
    target-wording overlay each resolve to a non-key string (not
    the literal `'moderator.decompose.exit.ariaLabel'` etc.) and
    that the non-en-US values differ from en-US.
16. `Escape` keypress fires `exitDecomposeMode` (attaches
    `attachCaptureKeymap` on mount; the keymap routes `Escape` to
    `onExitMode` when `mode === 'decompose'`).

**`apps/moderator/src/layout/captureKeymap.test.ts`** (≥ 2 new
cases):

17. `attachCaptureKeymap({ onExitMode: handler })` calls `handler`
    on `Escape` once `useCaptureStore.setState({ mode: 'decompose'
    })` flips the mode; does NOT call `handler` while the store's
    mode is `'idle'`.
18. When `mode === 'decompose'` AND both `onExitMode` and
    `onClearTarget` are supplied, `Escape` calls `onExitMode` once
    AND does NOT call `onClearTarget` (priority order pinned per
    Decision §5).

### 7. Playwright e2e (new `test()` block in `moderator-capture.spec.ts`)

Extending the existing `test.describe('moderator capture flow', ...)`
group:

```ts
test('decompose mode: right-click → mode banner reads "Decompose" → Esc returns to idle', async ({ page }) => {
  // 1. Login + POST /api/sessions + goto /sessions/<id>/operate
  //    (same setup as the existing capture-flow tests).
  await loginAs(page, { username: 'alice' });
  // ... POST /api/sessions ... goto /sessions/<id>/operate ...

  // 2. Seed a node into the WS store via the existing
  //    __aConversaWsStore seam (same template as the axiom-mark e2e
  //    at lines 700-842 of this file).
  // ... seed node 'n1' with wording "Workers should earn a living wage."

  // 3. Right-click the seeded node → assert the context menu opens.
  await page.locator('[data-testid="node-n1"]').click({ button: 'right' });
  await expect(page.getByTestId('graph-context-menu')).toBeVisible();

  // 4. Click "Propose decompose" in the menu.
  await page.getByTestId('graph-context-menu-item-propose-decompose').click();

  // 5. Assert the mode banner now reads the decompose label.
  await expect(page.getByTestId('mode-banner-label')).toHaveText('Decompose');
  // 5a. Assert the mode banner's data-mode attribute is now 'decompose'.
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'decompose');
  // 5b. Assert the exit-button is now visible.
  await expect(page.getByTestId('decompose-mode-exit')).toBeVisible();
  // 5c. Assert the target-wording overlay shows the seeded node's
  //     wording.
  await expect(page.getByTestId('decompose-mode-target-wording')).toContainText(
    'Workers should earn a living wage.',
  );

  // 6. Press Esc → assert the mode banner reverts to the idle label.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');
  // 6a. Assert the exit-button is no longer in the DOM.
  await expect(page.getByTestId('decompose-mode-exit')).toHaveCount(0);
});
```

The test asserts the mode-entry + mode-exit chain only — per the
"Constraints / requirements → UI-stream e2e scoping" caveat, the
multi-component capture UI is not yet shipped, so the test does NOT
attempt to capture components or propose a decomposition. The
sibling tasks' refinements own those assertions.

### 8. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_decompose_mode` block gets
  `complete 100` after the `allocate team` line plus a `note
  "Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_decompose_mode_native_review` is added with the template
  below (effort 0.5d; `depends !i18n_axiom_mark_pending_render_native_review`
  — the current tail of the native-review chain).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_decompose_mode_native_review "Native-speaker review of pt-BR + es-419 decompose-mode strings (3 keys under moderator.decompose.*)" {
  effort 0.5d
  allocate team
  depends !i18n_axiom_mark_pending_render_native_review
  note "Source of debt: mod_decompose_mode (this commit) — pt-BR and es-419 drafts of the 3 new keys under moderator.decompose.* (exit.ariaLabel, exit.tooltip, banner.targetWording) landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review). The banner.targetWording string carries the ICU {nodeWording} substitution — review the localized form's grammatical fit when the substituted wording is a complete sentence with terminal punctuation."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 9. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Scope: mode-entry seam + visual signal + exit affordance ONLY

This task is the foundation of `mod_decompose_flow`. Per the WBS
(`tasks/30-moderator-ui.tji:330-351`), the parent block has four
children:

- `mod_decompose_mode` (this task)
- `mod_multi_component_capture` (depends on this — captures N
  components)
- `mod_propose_decomposition` (depends on multi-component capture —
  emits the `propose` envelope)
- `mod_interpretive_split_mode` (depends on this — analogous flow with
  a different proposal sub-kind)

Considered: bundling the mode-entry + multi-component capture into one
task (1.5d total). *Rejected* — the WBS already splits them (two
separate 1d tasks) and the split is intentional: the multi-component
capture UI is substantial enough (N rows of wording-and-kind inputs,
add/remove row affordances, per-row validation, ordering controls) to
deserve its own refinement. Bundling would push this task to 2d+ and
delay the interpretive-split sibling (which depends on this task,
not on multi-component capture). The split also lets
`mod_interpretive_split_mode` land **in parallel** with
`mod_multi_component_capture` once this task ships.

### 2. Entry-point: node context menu (option a)

The user request enumerated three options:
- (a) Node context menu has `propose-decompose` stub → click enters
  decompose mode.
- (b) Capture pane has a "decompose" mode toggle.
- (c) Both.

**Chosen: (a) — node context menu.** Three reasons:

- **Direct precedent.** `mod_axiom_mark_action` shipped the same
  shape (node context-menu stub → flips capture pane to a new
  mode). The pattern is two weeks old and well-trodden.
- **`docs/moderator-ui.md:57` calls out the node context menu as one of
  two entry points** ("shortcut or node context menu"). The keyboard
  shortcut path is out of scope for this task (Decision §8); the menu
  path is in scope.
- **The capture-pane toggle (option b)** is the wrong shape for
  decompose-mode entry: decompose is **per-node** (you decompose a
  specific parent into components, not "the decompose flow in
  general"). A mode toggle in the capture pane would lack the target
  node id — the operator would have to click the toggle THEN
  separately select a node, which adds a step and a race condition.
  The context menu has the target node id in hand (it just got
  right-clicked); the flow is one gesture.

The `propose-decompose` item is already in `buildNodeMenuItems`
(`GraphCanvasPane.tsx:227-231`) as a labelled stub waiting to be
wired. This task wires it.

### 3. State location: extend `useCaptureStore` with a new slice + helpers (not a separate store)

Considered alternatives:

- **(a) New module-scoped `useDecomposeStore`** at
  `apps/moderator/src/stores/decomposeStore.ts`. *Rejected* — the
  decompose flow is part of the broader capture-flow family
  (decompose-mode replaces F1 capture-mode as the active mode on the
  bottom strip; both feed into "what is the operator composing right
  now?"). A separate store would force two-store coordination on
  every mode-banner read and on every `reset()`. The two-helper
  coupling (`enterDecomposeMode` clears F1 slices) is exactly the
  kind of thing a single store handles atomically.
- **(b) Per-mode slices on `useCaptureStore`** — extend the existing
  store with `decomposeTargetNodeId`, later
  `interpretiveSplitTargetNodeId`, later
  `operationalizationTargetNodeId`, etc. *Chosen* — the store
  already carries `mode: CaptureMode` (the eight-mode enum) and the
  F1 slices. Adding per-mode target-tracking slices is the same
  shape; the store grows additively as each mode's per-target seam
  lands.
- **(c) One generic `currentTargetNodeId: string | null` slice**
  that every mode shares. *Rejected* — different modes need
  different target shapes (decompose targets a node;
  operationalization could target a node or an edge; meta-move
  targets multiple nodes per `docs/moderator-ui.md:129`). A
  per-mode slice keeps the type narrow.

The slice naming convention is `<mode>TargetNodeId` (or
`<mode>TargetEntityId` if a future mode targets edges too). The
helpers naming convention is `enter<Mode>Mode` / `exit<Mode>Mode`.

### 4. Exit-button placement: sibling render inside the `bottom-strip-mode-banner` slot

Considered alternatives:

- **(a) Inline inside `<ModeBanner>`** — extend `<ModeBanner>` to
  read `decomposeTargetNodeId` + render the exit button when mode is
  decompose. *Rejected* — `<ModeBanner>` is the mode-generic
  display surface; making it decompose-aware couples the generic
  component to one specific mode. The next mode-aware task
  (interpretive-split) would have to extend it again; the next
  after that (meta-move) again. A separate component per
  mode-specific affordance scales linearly without polluting the
  generic banner.
- **(b) Sibling render alongside `<ModeBanner>` inside the
  `bottom-strip-mode-banner` slot** — `<OperateRoute>` passes a
  fragment `<><ModeBanner /><DecomposeModeExitButton /></>` into
  the `modeBanner` prop. *Chosen* — minimal coupling; each
  mode-specific affordance is its own component with its own
  visibility gate. The `<BottomStripCapture>` scaffold's slot
  accepts any `ReactNode`, and fragments are valid `ReactNode`s; no
  scaffold change required.
- **(c) Separate slot on `<BottomStripCapture>`** for mode-specific
  affordances. *Rejected for v1* — the scaffold already has five
  slots; adding a sixth for one task is over-scope. If multiple
  mode-specific affordances eventually need to coexist with
  conflicting positioning, the scaffold can grow a slot later. For
  now the existing slot accommodates the addition cleanly.

The Tailwind class string on `<DecomposeModeExitButton>`'s root
matches the slot's existing palette (`text-slate-600` for the
target-wording overlay, slate-toned focus ring on the button) so
the visual integration is seamless.

### 5. Mode-aware Escape priority: decompose-exit takes precedence over target-clear

When BOTH `onExitMode` and `onClearTarget` are supplied AND
`mode === 'decompose'`, Escape invokes `onExitMode` only.

Considered alternatives:

- **(a) Decompose-exit takes priority.** *Chosen.* When the operator
  is in decompose mode, Escape's most natural meaning is "cancel
  this mode-entry I just made" — the operator's mental model is
  "I'm in a mode; Escape leaves the mode." A staged target chip
  (the F1 target-clear surface) is below the operator's current
  attention.
- **(b) Target-clear takes priority.** *Rejected.* If a staged
  target chip is showing AND the operator enters decompose mode,
  the chip is cleared by `enterDecomposeMode`'s atomic update (F1
  slice clearing). So while in decompose mode, there is no staged
  target to clear; the priority question only arises if a future
  mode allows F1 slice survival. For now the answer is settled
  trivially; preserving the priority order documents the intent
  for future modes.
- **(c) Both handlers fire.** *Rejected.* Composing two
  semantically-overlapping Escape handlers is fragile; one of
  them should win.

The priority is implemented as an early-return in the keymap's
`Escape` branch:
```ts
if (event.key === 'Escape') {
  // ... existing modifier-bail / editable-target / repeat-skip guards ...
  const mode = useCaptureStore.getState().mode;
  if (mode === 'decompose' && handlers.onExitMode) {
    event.preventDefault();
    handlers.onExitMode();
    return;
  }
  if (handlers.onClearTarget) {
    event.preventDefault();
    handlers.onClearTarget();
    return;
  }
}
```

The future-mode generalisation (interpretive-split, meta-move) will
extend the mode check: `if ((mode === 'decompose' || mode ===
'interpretive-split') && handlers.onExitMode)`. The `onExitMode`
handler is single — modes that need different exit behavior would
register their own handler at attach time; the keymap doesn't need
to know about every mode.

### 6. F1 slice clearing on decompose-mode entry (the coupling this task documents)

`enterDecomposeMode(nodeId)` clears `text`, `classification`,
`targetEntityId`, `edgeRole` atomically with the mode flip.

The rationale:

- **Avoid bleed-through.** A moderator who has been composing a new
  statement in F1 (text typed, classification picked, target chip
  staged) and then right-clicks a different node to decompose it
  should not accidentally fire a propose action with the F1 draft
  carrying through. The decompose flow's eventual propose envelope
  (`mod_propose_decomposition`) reads a different shape of state
  (components, parent_node_id) — there is no path by which the F1
  draft could be intentionally consumed by the decompose flow.
- **Match the moderator's mental model.** "Enter decompose mode"
  signals "I'm switching tasks." The F1 draft was for a different
  task; clearing it matches the switching-tasks semantics. The
  alternative (preserve the F1 draft, restore it on
  `exitDecomposeMode`) was considered and rejected as too clever —
  it would require an explicit "snapshot before, restore after"
  dance and an "are we sure?" prompt on `enterDecomposeMode` when a
  non-empty F1 draft exists.
- **Document the coupling.** The store's two new helpers are NOT
  pure-add functions; they have side effects on other slices. The
  refinement records the coupling so future readers (interpretive-split
  task author, meta-move task author) know to mirror the pattern
  rather than re-design it. The slice-level setters
  (`setDecomposeTargetNodeId`, `setMode`) remain free of side
  effects; the coupled multi-slice update lives in the helpers.

A test asserts the coupling: case 3 in the captureStore.test.ts
addition (Acceptance criterion 6.3) seeds the F1 slices with
non-default values, calls `enterDecomposeMode`, and asserts all four
F1 slices are at their initial values.

### 7. Target-wording resolution shape

Considered:

- **(a) Read from a snapshot stored on the store** — extend
  `enterDecomposeMode` to also stash the wording string on a new
  `decomposeTargetWording: string` slice. *Rejected* — duplicates
  data that's already authoritative in the events log; if the node
  gets a wording-edit event between mode-entry and the next render,
  the cached wording goes stale.
- **(b) Read live from the events log** via a small
  `useDecomposeTargetWording(nodeId, events)` hook that walks the
  events for the matching `node-created` event. *Chosen* — the
  events log is the source of truth; the lookup is O(N events) per
  render, which is fast for typical session sizes (≤ 1000 events).
  The same pattern is used by `<StatementNode>` and by the
  `<AxiomMarkSubmenu>`'s `derivePartipantScreenNames` helper.
- **(c) Read from the layout-engine's projected nodes** — pull the
  wording from the `Node<StatementNodeData>[]` array. *Rejected* —
  introduces a coupling between the `<DecomposeModeExitButton>` (a
  bottom-strip component) and the canvas's projection state, which
  is owned by `<GraphCanvasPane>`. A direct events-log walk is
  decoupled.

The ICU template `"Decomposing {nodeWording}"` is the natural shape
for operator-readable target identification. The `nodeWording`
substitution is the node's `payload.wording` string (verbatim from
the `node-created` event); since participant-supplied content is
not translated (per `DESIGN.md:43`), the substituted value stays
in whatever language the participants spoke.

### 8. Out of scope: the `Cmd+D` keyboard shortcut

`docs/moderator-ui.md:192` lists `Cmd+D — decompose selected node` as
one of the keyboard shortcuts. This task does NOT wire that shortcut.

Reasons:

- **No WBS task for it.** The `tasks/30-moderator-ui.tji` decompose
  flow has four children (mode-entry, multi-component capture, propose,
  interpretive-split); none is a "keyboard shortcut" task. Adding the
  shortcut here would over-scope.
- **Shortcuts policy.** `i18n_keyboard_shortcuts_policy` (complete
  100) pinned the english-mnemonic approach and shipped the executable
  shortcut mapping at
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts`. Adding new
  shortcuts is the policy's scope, not this task's; a new task
  (`mod_decompose_shortcut`, effort 0.5d) would register the new
  shortcut entry + the keymap dispatch + the i18n catalog entry. If
  this task tried to add the shortcut, it would touch the shortcuts
  mapping module which is out of allowlist.
- **Selected-node target ambiguity.** The shortcut variant says
  "decompose **selected** node" — but selection is a separate
  surface (`useSelectionStore`) from right-click. The context-menu
  variant has the right-clicked node id in hand; the shortcut
  variant needs to read `useSelectionStore` and bail when nothing is
  selected. The bail-when-nothing-selected dance is a separate
  decision worth its own refinement when the shortcut task is
  scoped.

The context-menu entry point is sufficient for v1; the keyboard
shortcut can land later without changing this task's shape.

### 9. Out of scope: the interpretive-split variant + the multi-component capture UI + the propose action

The sibling tasks own these:

- **`mod_multi_component_capture`** owns the N-row component capture
  UI inside the bottom strip's text-input slot (or a new slot the
  scaffold can grow if needed). Will read
  `decomposeTargetNodeId` to know which parent is being decomposed
  and `mode === 'decompose'` as the visibility gate. The
  multi-component capture form's shape, the per-row validation, the
  add/remove affordances, and the propose-button positioning are all
  that task's scope.
- **`mod_propose_decomposition`** owns the propose envelope: builds
  `{ kind: 'decompose', parent_node_id: <decomposeTargetNodeId>,
  components: [...] }`, calls `client.send('propose', payload)`,
  handles WireError mapping, and calls `exitDecomposeMode()` on
  propose-success (the post-success seam this task ships).
- **`mod_interpretive_split_mode`** owns the analogous mode-entry
  for the `interpretive-split` proposal sub-kind. Will mirror this
  task's shape: new `interpretiveSplitTargetNodeId` slice, new
  `enterInterpretiveSplitMode` / `exitInterpretiveSplitMode`
  helpers, new `onEnterInterpretiveSplitMode?` parameter on
  `buildNodeMenuItems`. The wire envelope's `interpretive-split`
  sub-kind has its own propose handler (sibling task
  `interpretive_split_logic` in the data-and-methodology
  work-stream — already done per the
  `axiom_mark_logic`-era propose handler factoring); the moderator
  UI just needs the mode-entry seam.

### 10. No new ADR

Three potential triggers, all dispatched:

- **"Adding a new store slice with coupled multi-field updates is
  ADR-worthy."** No — the captureStore already has multi-field
  updates (`reset()` clears every slice atomically; the existing
  pattern is several `set({...spread})` calls). The new helpers
  follow the same pattern.
- **"Adding a new mode-entry-and-exit semantic to the
  capture pane is ADR-worthy."** No — the mode-aware semantics live
  in `useCaptureStore` already (the `mode: CaptureMode` slice +
  the eight values). The pattern is two-week-old precedent from
  `mod_mode_banner`; adding a per-mode entry/exit seam is a routine
  extension.
- **"Adding mode-aware Escape dispatch to `captureKeymap` is
  ADR-worthy."** No — the existing keymap's editable-target /
  modifier-bail / repeat-skip discipline already mediates multiple
  consumers (`onPickKind`, `onClearTarget`, `onPickEdgeRole`).
  Adding a fourth consumer with mode-aware priority is a routine
  extension; the priority rule is documented in this refinement
  (Decision §5) and in the keymap module's doc-block.

The architectural choices this task implements were all settled by
prior tasks (`mod_state_management`, `mod_mode_banner`,
`mod_capture_flow.*`, `mod_axiom_mark_action`, `mod_context_menus`,
ADR 0022, ADR 0024); this refinement is the task-scope pin for the
specific mode-entry seam.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Foundation seam of `mod_decompose_flow` shipped: the four-leaf branch's
  entry point is now in place. Closing this leaf unblocks
  `mod_multi_component_capture` and `mod_interpretive_split_mode`
  (both carried `depends !mod_decompose_mode`); `mod_propose_decomposition`
  remains blocked behind `mod_multi_component_capture`.
- New atomic store helpers `enterDecomposeMode` /
  `exitDecomposeMode` landed in
  `apps/moderator/src/stores/captureStore.ts` (with the new
  `decomposeTargetNodeId` slice + `setDecomposeTargetNodeId` setter,
  F1-slice clearing on entry). These are the shared mode-helper
  seam — `mod_interpretive_split_mode` will pattern-match the same
  shape for its own `enterInterpretiveSplitMode` /
  `exitInterpretiveSplitMode` pair. Test coverage:
  `apps/moderator/src/stores/captureStore.test.ts`.
- New `<DecomposeModeExitButton>` mounts as a sibling of
  `<ModeBanner>` in the bottom-strip-mode-banner slot
  (`apps/moderator/src/routes/Operate.tsx` now renders
  `<><ModeBanner /><DecomposeModeExitButton /></>`). Component +
  unit coverage: `apps/moderator/src/layout/DecomposeModeExitButton.tsx`,
  `apps/moderator/src/layout/DecomposeModeExitButton.test.tsx`.
- Mode-aware Escape dispatch added to
  `apps/moderator/src/layout/captureKeymap.ts` via a new
  `onExitMode` handler — decompose-mode exit takes priority over
  target-clear when both are in scope. Keymap test coverage:
  `apps/moderator/src/layout/captureKeymap.test.ts`.
- Node-context-menu entry wired in
  `apps/moderator/src/graph/GraphCanvasPane.tsx`:
  `buildNodeMenuItems` gained an optional
  `onEnterDecomposeMode` parameter; the canvas threads
  `useCaptureStore.getState().enterDecomposeMode` via a stable
  callback. Three new GraphCanvasPane test cases cover both factory
  branches plus the end-to-end wire-up
  (`apps/moderator/src/graph/GraphCanvasPane.test.tsx`).
- i18n: 3 new keys under `moderator.decompose.*` per locale
  (en-US / pt-BR / es-419) = 9 entries in
  `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`;
  pt-BR + es-419 each carry 3 PENDING tracker entries in the
  matching `*.review.json`. Native-speaker review tracked under
  the newly-registered `i18n_decompose_mode_native_review` task
  (see `tasks/35-frontend-i18n.tji`).
- E2E coverage: new Playwright test in
  `tests/e2e/moderator-capture.spec.ts` exercises decompose-mode
  entry plus the Esc-exit chain; the `chromium-create-session`
  project ran 21/21 green (the new case alone at 4.4s). Vitest
  count: 3236 -> 3267 (+31).
- Implementer correctly honored the `.tji` rule — no `.tji` files
  were modified by the implementer, breaking the prior bad streak
  (Closer registers the `complete 100` + tech-debt edits in this
  commit per the task-completion ritual).
