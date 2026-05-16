# Moderator capture-pane target auto-suggest (most-recently-active node)

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_target_auto_suggest`.

```
task mod_target_auto_suggest "Auto-suggest most-recently-active node as target" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. The work is one small component + a derived selector
+ i18n + tests on top of seams already in place:

- `<BottomStripCapture>` does NOT today expose a dedicated "target"
  sub-slot — the existing strip slots are `modeBanner`, `textInput`,
  `classificationPalette`, `edgeRoleSelector`, `proposeAction`. Per
  Decision §3 below, the staged-target chip lands as a small affordance
  INSIDE the existing `edgeRoleSelector` sub-slot's surrounding pane
  (the edge-role selector and the target chip are the two halves of
  the "connect to existing structure" gesture per
  `docs/moderator-ui.md:45`; they share the strip's `bottom-strip-edge-role`
  slot). Until `mod_edge_role_selector` lands and owns the slot
  proper, this task ships a standalone `<CaptureTargetChip>` rendered
  into the strip's `edgeRoleSelector` slot as the slot's first child
  (the slot is empty today — the scaffold renders `[edge role]` as a
  placeholder when no child is passed; this task replaces that
  placeholder with the chip). `mod_edge_role_selector` will later
  compose its own selector alongside the chip inside the same slot.
- `useCaptureStore` already carries a `targetEntityId: string | null`
  slice and a `setTargetEntityId(id | null)` setter (per
  `mod_state_management`); this task is the first reader/writer pair
  on that slice. The pre-existing `setTargetEntityId('node-1')`
  smoke at `apps/moderator/src/stores/stores.test.tsx:58` confirms
  the setter shape.
- `useSelectionStore` already tracks the currently-selected entity via
  `selected: { kind: EntityKind; id: string } | null` (per
  `mod_selection`); the click-to-select handlers in
  `apps/moderator/src/graph/GraphCanvasPane.tsx:149-159` write to it on
  every node / edge / pane click. This task derives "most-recently-active
  node" from the same store — see Decision §1.
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419
  drafts is established by `i18n_methodology_role_descriptions`,
  `mod_create_session_form`, `mod_layout_tidy_action`,
  `mod_capture_text_input`, and `mod_classification_palette`.

Concretely the deliverable is:

- One new component `apps/moderator/src/layout/CaptureTargetChip.tsx`
  (a small chip showing the auto-suggested target id + a derived
  "is-overridden" badge when the moderator has manually cleared or
  re-selected). Reads from `useSelectionStore` AND `useCaptureStore`,
  writes only to `useCaptureStore.setTargetEntityId`.
- One new derived selector module
  `apps/moderator/src/stores/recentlyActiveNode.ts` exporting a single
  `selectMostRecentlyActiveNodeId(selectionState)` pure function. Lives
  in its own file so future capture-flow tasks (mod_decompose_flow,
  mod_capture_defeater) can reuse the same derivation.
- An auto-stage effect inside `<CaptureTargetChip>`: a `useEffect` on
  the derived "most-recently-active node id" that calls
  `setTargetEntityId(id)` IF AND ONLY IF the current
  `targetEntityId` is `null` (i.e. the moderator has not manually
  overridden). The "do not stomp an override" guard is essential for
  composition with the sibling `mod_target_clear_override` task —
  see Decisions §5.
- ~12–14 new Vitest cases under
  `apps/moderator/src/layout/CaptureTargetChip.test.tsx` plus
  ~4 cases for the pure selector in
  `apps/moderator/src/stores/recentlyActiveNode.test.ts`.
- One new `test()` block extending
  `tests/e2e/moderator-capture.spec.ts` (the sibling spec landed by
  `mod_capture_text_input`, extended by `mod_classification_palette`)
  covering: chip renders the "no target" empty state on a fresh
  operate route; selecting a node updates the chip; selecting a
  different node updates the chip; selecting an edge does NOT update
  the chip (edges aren't valid auto-suggest targets — see
  Decision §1).
- 4 new i18n catalog keys × 3 locales = **12 new catalog entries**.
  See the catalog table below.
- 1 follow-up tech-debt task registered in `tasks/35-frontend-i18n.tji`
  for the native-speaker review of the 8 new pt-BR / es-419 draft
  entries (`i18n_target_auto_suggest_native_review`, effort 0.5d,
  `depends !i18n_classification_palette_native_review`).
- One-line wire-up in `apps/moderator/src/routes/Operate.tsx`: pass
  `<CaptureTargetChip />` into `<BottomStripCapture>`'s
  `edgeRoleSelector` slot. The slot is currently unfilled; the
  scaffold's `[edge role]` placeholder vanishes; when
  `mod_edge_role_selector` lands it composes its selector alongside
  the chip inside the same slot (via a small wrapper component
  introduced by that task, not this one — see Decision §6).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_capture_flow`** parent block's `depends` line —
  `!mod_layout, !mod_graph_rendering, backend.websocket_protocol.ws_propose_message`
  — every leaf is done. `!mod_layout` covers `mod_bottom_strip_capture`
  (the slot scaffold) and `mod_mode_banner` (the first store reader);
  `!mod_graph_rendering` covers `mod_selection` (the click-to-select
  store this task derives the auto-suggested target from) and
  `mod_hover_details` (which established the hover-state lives on
  the component as `useState`, NOT in a store — directly informs
  Decision §1's rejection of hover as the "active" signal);
  `ws_propose_message` matters for `mod_propose_action` downstream,
  not this task (the chip does not emit any WS message).
- **`moderator_ui`** top-level
  `depends backend.backend_tests.be_e2e_tests.auth_flow_integration`
  (settled — the Playwright OIDC harness used by every
  `tests/e2e/*.spec.ts` that reaches `/sessions/<id>/operate`).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done —
  exposes the `edgeRoleSelector` render-prop slot with the stable
  `bottom-strip-edge-role` testid; see
  `mod_bottom_strip_capture.md`'s Status block lines 66-71 and
  `apps/moderator/src/layout/BottomStripCapture.tsx:80-85`).
- **`moderator_ui.mod_layout.mod_mode_banner`** (done — first store
  reader on `useCaptureStore`).
- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done —
  sibling, same pane; pinned the `useCaptureStore`-as-shared-draft
  pattern this task extends to the `targetEntityId` slice).
- **`moderator_ui.mod_capture_flow.mod_classification_palette`** (done
  — sibling, same pane; pinned the per-locale parity round-trip
  test idiom and the tech-debt-registration native-review chain this
  task extends).
- **`moderator_ui.mod_graph_rendering.mod_selection`** (done — landed
  `useSelectionStore` with `selected: { kind, id } | null`, `select()`,
  and `clear()`. ReactFlow's `onNodeClick` / `onEdgeClick` /
  `onPaneClick` handlers in `<GraphCanvasPane>` write to the store on
  every click. This is the seam the auto-suggest derives from — see
  Decision §1).
- **`moderator_ui.mod_graph_rendering.mod_hover_details`** (done —
  established hover state lives on the entity component as
  `useState<boolean>`, NOT in a store; hover is intentionally NOT
  observable from outside the hovered component. Directly informs
  Decision §1: "hover" is not a candidate signal for "most-recently-active"
  because the moderator's UI has no global hover state to read).
- **`moderator_ui.mod_state_management`** (done —
  `apps/moderator/src/stores/captureStore.ts:47` declares
  `targetEntityId: string | null` with `setTargetEntityId` at line 53
  and reset-to-`null` in `initialCaptureState` at line 65; the
  `useSelectionStore` shape at
  `apps/moderator/src/stores/selectionStore.ts:15-26` exports
  `Selection = { kind: EntityKind; id: string }` and the `selected`
  slice this task reads).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done —
  the operate route is reachable via `/sessions/new/setup` →
  `POST /api/sessions` → `/sessions/<id>/operate`; the capture-pane
  target chip is reachable from a real user flow, which makes the
  Playwright e2e the non-deferred default per the UI-stream e2e
  policy).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()` from
  `react-i18next`, the catalog parity-check script, the
  `*.review.json` PENDING-flag lifecycle, and the per-locale smoke
  pattern are all in place; new keys flow through the same pipeline).
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new component consumes; ICU
  interpolation for the `"Target: {id}"` chip text.

Pending edges (this task does NOT depend on them; this task FEEDS them):

- **`moderator_ui.mod_capture_flow.mod_target_clear_override`** —
  sibling. The WBS records `depends !mod_target_auto_suggest`
  (`tasks/30-moderator-ui.tji:279`). This task ships the staged
  target slice; the override task adds the one-gesture clear (Esc
  or a small × button next to the chip) that writes `null` to the
  slice. The "do not stomp an override" guard in this task's
  auto-stage effect (Decision §5) is the seam that lets the
  override survive subsequent selection changes — without that
  guard, every node-click would re-suggest and undo the moderator's
  clear.
- **`moderator_ui.mod_capture_flow.mod_edge_role_selector`** —
  sibling. Will share the `bottom-strip-edge-role` slot with this
  task's chip; the selector reads `targetEntityId` from the same
  slice this task writes (the selector renders the role choices for
  the staged target, not for an unstaged one). The composition seam
  is the slot itself — both surfaces are rendered as children of the
  slot's container (a small ordering wrapper introduced by
  `mod_edge_role_selector` is the canonical way to do this; this
  task ships the chip directly into the slot and the wrapper lands
  later, as a refactor inside `mod_edge_role_selector`).
- **`moderator_ui.mod_capture_flow.mod_propose_action`** — downstream.
  The WBS records `depends !mod_capture_text_input,
  !mod_classification_palette, !mod_edge_role_selector` — i.e. the
  propose action does NOT directly depend on this task in the WBS
  tree. In practice, the proposed event will carry whatever target
  the moderator has staged at submit time, which this task writes
  to the `targetEntityId` slice. The propose action reads the slice
  and emits an `edge-created` event if non-null. The seam is the
  slice; no other coupling.
- **`frontend_i18n.i18n_target_auto_suggest_native_review`**
  (registered by this task — see Acceptance criteria / Decisions).
  The pt-BR / es-419 drafts of the 4 new keys land flagged PENDING;
  the follow-up replaces them with native-speaker-reviewed text.

## What this task is

Land the small "target chip" that surfaces — INSIDE the capture pane
— which existing node the moderator's next propose will attach to.
The chip:

1. **Derives** the most-recently-active node id from
   `useSelectionStore` via the new pure selector
   `selectMostRecentlyActiveNodeId(state)`. The derivation is:
   "if `state.selected !== null` AND `state.selected.kind === 'node'`,
   return `state.selected.id`; otherwise return `null`." See
   Decision §1 for why selection is the chosen signal vs. hover /
   last-edited / last-committed.
2. **Auto-stages** the derived id into `useCaptureStore.targetEntityId`
   via a `useEffect`: when the derived id is non-null AND the slice
   is currently `null`, the effect calls `setTargetEntityId(id)`.
   When the derived id is non-null AND the slice is already non-null
   (the moderator has previously staged a target — possibly by
   override), the effect does NOT stomp the override. When the
   derived id changes to a different node and the slice is still
   the previous suggestion (no override gesture between the two
   selections), the effect updates to the new suggestion. The
   "is this an override?" detection is via a `useRef` that tracks
   the last auto-staged id — see Decision §5.
3. **Renders** a small chip showing `"Target: {labelOrShortId}"` when
   the slice is non-null; when the slice is null, the chip renders
   the localized "no target yet" empty state. The chip's visible
   text comes from the i18n catalog and is reactive to slice
   changes.
4. **Subscribes** to graph state via `useSelectionStore`, so the
   chip updates LIVE as the moderator clicks around the canvas —
   the moderator clicks node A, the chip reads "Target: A"; clicks
   node B, the chip flips to "Target: B"; clicks the empty pane,
   the selection clears, the chip stays at "Target: B" (the
   clear-target gesture is a SIBLING task — pane-click clears
   selection but does NOT clear the staged target). The "stays at
   B" behavior is intentional: pane-click is a hugely common
   incidental gesture (the moderator's pointer crosses empty
   canvas all the time); using it to clear the staged target would
   break the auto-suggest. The sibling `mod_target_clear_override`
   adds the deliberate clear gesture (Esc / × button).
5. **Resolves** the target node's display label via the existing
   `<HoverPopover>`-style wording lookup — but in a stripped-down
   form. The chip is small (one strip slot); it shows a short
   identifier, not the full wording. Decision §4 below settles on:
   "first 32 characters of the node's wording, with `…` suffix if
   truncated; fallback to the raw node id when the wording is
   unavailable (e.g. the node was deleted from the projection between
   the click and the chip render)". The lookup walks the WS store's
   events array via a new tiny selector (or reuses the
   `wordingByNodeId` map idiom `mod_hover_details` introduced — see
   Decision §4).
6. **Does NOT** clear / override the staged target — that's the
   sibling `mod_target_clear_override` task. The chip is read-only
   for now (renders the staged target, derives suggestions, never
   un-stages). A future override gesture writes `null` to the slice
   from outside (Esc handler, × button); this chip then renders the
   empty-state localized text and the auto-stage effect respects
   the override (does not re-suggest until the moderator deliberately
   selects a different node again).
7. **Does NOT** emit any WS message, does NOT validate target
   reachability, does NOT touch any pane other than its own slot.
   It is a read-write seam on `useCaptureStore.targetEntityId`
   driven by `useSelectionStore.selected`; the propose round-trip
   is `mod_propose_action`'s job.

The task is the **third** capture-flow input to mount into the
bottom strip (`mod_capture_text_input` was the first, owning the
`textInput` slot; `mod_classification_palette` was the second,
owning the `classificationPalette` slot; this task occupies the
`edgeRoleSelector` slot temporarily until `mod_edge_role_selector`
lands and composes alongside it).

## Why it needs to be done

Three reasons, in priority order:

1. **F1 specifies the auto-suggest as a load-bearing capture-speed
   ergonomic.** Per `docs/moderator-ui.md:45`: *"The most-recently-active
   node is **auto-suggested as the default target**, pre-filled in
   the connect pane; one keystroke or click clears it if the suggestion
   is wrong. This trades a moment of latent error for capture speed
   during live debate; the override is one gesture away."* The
   auto-suggest is part of the capture flow's design contract —
   without it, the moderator has to click the target on every propose,
   which is friction the F1 design explicitly absorbs.

2. **`mod_target_clear_override` depends on this task** (per
   `tasks/30-moderator-ui.tji:279`). The override is the second half
   of the auto-suggest gesture pair; it cannot ship until there's
   something to override. Landing the auto-suggest first is the
   prerequisite for the override sibling.

3. **The `targetEntityId` slice is the third of four
   in-progress-proposal slices** the propose action reads when it
   emits its multi-event bundle. The other three slices are: `text`
   (filled by `mod_capture_text_input`, done), `classification`
   (filled by `mod_classification_palette`, done), and the
   yet-unwritten edge-role slice (`mod_edge_role_selector`). Per
   `docs/moderator-ui.md:46`, the propose bundles `node-created`
   + `proposal: classify-node` + optionally `edge-created` +
   `proposal: set-edge-substance` *"if connecting"*. The "if
   connecting" branch reads `targetEntityId !== null`. Until this
   task lands, no propose flow can ever emit the connecting branch
   from the auto-suggest path — every propose is a free-floating
   new node.

Downstream, the staged-target slice is one of two writers the
override task reads (the other is the override gesture itself), one
of two readers the edge-role selector consumes (the other is the
edge-role catalog), and the seam the propose action's "if
connecting" branch tests.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- `apps/moderator/src/layout/BottomStripCapture.tsx:42-95` — the
  scaffold that owns the `edgeRoleSelector` prop and the
  `bottom-strip-edge-role` sub-slot. The scaffold's placeholder
  `<span aria-hidden="true">[edge role]</span>` becomes unreachable
  through `<OperateRoute>` once this task wires
  `<CaptureTargetChip />` into the slot; the placeholder survives
  only for the scaffold-only `BottomStripCapture.test.tsx` cases.
- `apps/moderator/src/layout/CaptureTextInput.tsx:1-156` — sibling
  in the same pane (now landed). Patterns this task mirrors:
  `useTranslation()` for catalog access,
  `useCaptureStore((s) => s.<slice>)` for read + write,
  `data-testid` per surface, slate-toned Tailwind palette, the
  `'@a-conversa/...'` import alias style, the per-locale parity
  test pattern.
- `apps/moderator/src/layout/ClassificationPalette.tsx:1-200` —
  sibling, same pane, the most-recent precedent for a small
  store-reading widget mounted into a strip sub-slot. Lines 74-75
  pin the read+write pair pattern:
  ```ts
  const selected = useCaptureStore((state) => state.classification);
  const setClassification = useCaptureStore((state) => state.setClassification);
  ```
  This task does the analogous pair for `targetEntityId` /
  `setTargetEntityId`.
- `apps/moderator/src/layout/ModeBanner.tsx:1-51` — first
  store-reading component; established the per-locale parity
  round-trip pattern this task reuses.
- `apps/moderator/src/stores/captureStore.ts:47, 53, 65, 74` — the
  store contract for the target slice. `targetEntityId: string | null`,
  `setTargetEntityId: (id: string | null) => void`. The
  initial-state object at line 65 has `targetEntityId: null`. The
  `reset()` at line 76 returns the slice to `null` and is called
  only by `mod_propose_action`'s post-success path (the chip does
  not call `reset()`).
- `apps/moderator/src/stores/selectionStore.ts:15-26` — the
  selection store this task derives from. `selected: Selection | null`,
  where `Selection = { kind: EntityKind; id: string }`. The
  `select()` setter is written by the click handlers in
  `<GraphCanvasPane>`; the chip only READS via a Zustand selector.
- `apps/moderator/src/stores/stores.test.tsx:40-60` — the precedent
  for store-mutation testing: `useCaptureStore.setState(captureInitial, true)`
  in `beforeEach`. The chip's tests reset BOTH stores between
  cases (capture + selection) so neither leaks across tests.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:149-159` — the
  click handlers that write `select({ kind: 'node', id })` /
  `select({ kind: 'edge', id })` / `clear()` on every canvas
  click. Module-scope functions, exported for direct testing per
  `mod_selection`'s precedent. This task does NOT modify the
  handlers; it reads what they write.
- `apps/moderator/src/graph/HoverPopover.tsx:1-100` — the
  precedent reader of `methodology.kind.*` and the model for a
  small reactive popover-style chip. The target chip is a sibling
  surface in spirit: a small reactive display that updates from a
  store. The two share Tailwind vocabulary (rounded, slate-toned
  border, small text).
- `apps/moderator/src/graph/selectors.ts:62-89` — the existing
  `selectEdgesForSession` includes a `wordingByNodeId` map (built
  during `mod_hover_details` for the edge popover's source / target
  wording resolution). This task introduces a parallel tiny
  selector `selectNodeWordingById(events, nodeId)` that walks the
  same events array for a single id; the chip uses it to render
  the localized "Target: <first-32-chars>…" string. Decision §4
  records the choice not to reuse `wordingByNodeId` directly (the
  hover-popover map is constructed inside `selectEdgesForSession`
  and is not exported; extracting the construction is an
  unnecessary refactor for one consumer).
- `apps/moderator/src/routes/Operate.tsx:46-85` — the integration
  site. The existing block grows by one prop:
  ```jsx
  <BottomStripCapture
    modeBanner={<ModeBanner />}
    textInput={<CaptureTextInput onSubmit={noopSubmit} />}
    classificationPalette={<ClassificationPalette />}
    edgeRoleSelector={<CaptureTargetChip />}
  />
  ```
  Update the leading Refinement comment to cite
  `mod_target_auto_suggest.md` alongside the existing references.
- `packages/i18n-catalogs/src/catalogs/en-US.json:149-200` — the
  existing `moderator.captureTextInput.*` /
  `moderator.classificationPalette.*` namespaces. The new
  `moderator.captureTargetChip.*` namespace lands as a sibling.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the
  PENDING-flag trackers; the 8 new draft entries (4 keys × 2
  non-en-US locales) get added per the established pattern.
- `tests/e2e/moderator-capture.spec.ts:1-188` — the sibling spec.
  The new chip scenario extends this file with a new `test()`
  block reusing the same login + create-session + navigate setup.
  Decision §7 records the placement choice.

DESIGN.md / docs consulted:

- `DESIGN.md:20` — *"The moderator is the sole operator of the
  tool; participants propose verbally and the moderator commits the
  change once everyone agrees."* The auto-suggest ergonomic is in
  service of moderator speed during live debate; the moderator's
  hands stay on the keyboard / pointer.
- `DESIGN.md:30` — *"Every node carries a statement kind ... Every
  edge carries an argument role ... drawn from Toulmin. The two
  dimensions are independent."* The target chip is the node-end of
  the edge attachment; the edge-role selector (sibling task) is
  the role-end. Both feed the same `edge-created` proposal.
- `docs/moderator-ui.md:33` — *"Bottom strip — capture pane: text
  input, classification palette, edge-target selector, mode banner."*
  Confirms the target is part of the bottom strip; this task fills
  the target half of the (currently single-slot) edge-target +
  edge-role surface. Decision §3 records the slot-sharing choice.
- `docs/moderator-ui.md:43-46` — F1 capture flow. Step 3
  (*"Connect to existing structure"*) names the auto-suggest
  explicitly: *"The most-recently-active node is auto-suggested as
  the default target, pre-filled in the connect pane; one keystroke
  or click clears it if the suggestion is wrong."* The primary
  specification this task implements.
- `docs/moderator-ui.md:50` — *"The wording, classification, and
  edge are *separate proposals* under the data model — and debaters
  vote on each facet individually."* Implication: the target +
  edge-role together produce ONE proposal (`edge-created` +
  optionally `proposal: set-edge-substance`), not multiple. The
  staged-target slice is one input to that one proposal.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — `useTranslation()` resolves every chip string from the catalog.
- `tasks/refinements/moderator-ui/mod_classification_palette.md` —
  most recent sibling in the same pane; the catalog + PENDING-flag
  + tech-debt-registration pattern this refinement mirrors. Also
  pinned the per-locale parity round-trip test idiom.
- `tasks/refinements/moderator-ui/mod_capture_text_input.md` —
  prior sibling; the first writer on `useCaptureStore` (text slice);
  this task is the third writer (target slice; classification was
  the second).
- `tasks/refinements/moderator-ui/mod_bottom_strip_capture.md` —
  the scaffold whose `edgeRoleSelector` slot this task fills (until
  `mod_edge_role_selector` lands and composes alongside).
- `tasks/refinements/moderator-ui/mod_selection.md` — pinned the
  `useSelectionStore` shape and the click-handler contract this
  task derives the "most-recently-active node" from.
- `tasks/refinements/moderator-ui/mod_hover_details.md` — pinned
  hover state as component-local `useState`, NOT a store; directly
  informs Decision §1's rejection of hover as the auto-suggest
  signal.
- `tasks/refinements/moderator-ui/mod_state_management.md` — the
  store contracts (`useCaptureStore.targetEntityId` +
  `useSelectionStore.selected`) this task reads and writes.
- `tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md`
  — the canonical PENDING-flag + native-review pattern.

No new ADR is required (see Decisions §10); no new dependency lands
(`zustand`, `react-i18next`, `@a-conversa/shared-types`, and
`@a-conversa/i18n-catalogs` are already imported in the moderator
workspace); no public type signature changes; no cross-workspace
contract changes; the only data-model touch is the existing
`targetEntityId` slice which was pre-declared by `mod_state_management`.

## Constraints / requirements

### Component shape

- **New file** `apps/moderator/src/layout/CaptureTargetChip.tsx`
  exporting `function CaptureTargetChip(): ReactElement` (named
  export, no default). No props — the component sources its read
  from `useSelectionStore` + `useCaptureStore` + `useWsStore` (for
  the wording lookup) directly.
- **Single root element** wrapping a chip + (optionally) a small
  override-marker dot. The consumer drops the component directly
  into the scaffold's `bottom-strip-edge-role` slot without an
  extra wrapping div.
- **Stable test ids**:
  - `capture-target-chip` — outer wrapper element.
  - `capture-target-chip-label` — the visible label text
    ("Target: <id>" / "no target yet").
  - `capture-target-chip-override-marker` — a small visible
    indicator (rendered only when the moderator has overridden
    the auto-suggest; the indicator is invisible when the staged
    target IS the auto-suggested one, or when the slice is null).

### Pure selector module (`recentlyActiveNode.ts`)

A separate `apps/moderator/src/stores/recentlyActiveNode.ts`
exporting:

```ts
import type { SelectionState } from './selectionStore.js';

/**
 * Most-recently-active node id, derived from the selection store.
 *
 * Returns the id of the currently-selected node, or `null` if
 * nothing is selected OR the selection is an edge / annotation
 * (only node selections count as "active" for auto-suggest
 * purposes — see refinement Decision §1).
 *
 * Pure: depends only on the input state; no side effects.
 */
export function selectMostRecentlyActiveNodeId(
  state: SelectionState,
): string | null {
  if (state.selected === null) return null;
  if (state.selected.kind !== 'node') return null;
  return state.selected.id;
}
```

The selector lives in its own file because future tasks
(`mod_decompose_flow`, `mod_capture_defeater`,
`mod_axiom_mark_flow`) need the same derivation — pinning it as
one named function lets future consumers reuse the rule rather
than each task re-implementing "what counts as active?". A reverse
test (`apps/moderator/src/stores/recentlyActiveNode.test.ts`) pins
the rule with 4 cases (no selection → null; node selection → id;
edge selection → null; annotation selection → null).

### Store wiring

Inside `<CaptureTargetChip>`:

```ts
const stagedTargetId = useCaptureStore((s) => s.targetEntityId);
const setTargetEntityId = useCaptureStore((s) => s.setTargetEntityId);
const recentlyActiveNodeId = useSelectionStore(
  selectMostRecentlyActiveNodeId,
);

// Auto-stage effect — see Decision §5 for the no-stomp rule.
const lastAutoStagedRef = useRef<string | null>(null);
useEffect(() => {
  if (recentlyActiveNodeId === null) return;
  // Case 1: nothing staged yet — auto-stage.
  if (stagedTargetId === null) {
    setTargetEntityId(recentlyActiveNodeId);
    lastAutoStagedRef.current = recentlyActiveNodeId;
    return;
  }
  // Case 2: the staged target IS the previously auto-staged one
  // AND the most-recently-active node has changed — re-auto-stage
  // to the new active node (the moderator never overrode; they just
  // moved selection).
  if (
    stagedTargetId === lastAutoStagedRef.current &&
    stagedTargetId !== recentlyActiveNodeId
  ) {
    setTargetEntityId(recentlyActiveNodeId);
    lastAutoStagedRef.current = recentlyActiveNodeId;
    return;
  }
  // Case 3: the staged target is NOT the previously auto-staged one
  // — the moderator has overridden. Do not stomp.
}, [recentlyActiveNodeId, stagedTargetId, setTargetEntityId]);
```

The ref-tracked `lastAutoStagedRef` is the seam that distinguishes
"auto-suggestion the moderator hasn't touched" from "moderator's
deliberate override". Without it, every selection change would
re-stage and overwrite the override; with it, the override
survives subsequent selections.

The `targetEntityId` slice is the load-bearing source of truth;
the chip RENDERS from `stagedTargetId`, NOT from
`recentlyActiveNodeId` directly. The two coincide most of the time
(auto-suggest is on by default) but diverge after an override —
and the chip must render whatever the propose action will read.

### Visible label / display rule

The chip renders one of three states:

1. **Slice is `null`** (no target staged; happens at session start
   before any node is clicked, or after `mod_target_clear_override`
   clears the slice):
   - Visible: `t('moderator.captureTargetChip.empty')` —
     localized "no target yet" (en-US literal).
   - `data-testid="capture-target-chip-label"`.
   - No override marker.
   - The chip is dimmed (`text-slate-400`) so the empty state
     reads as latent / waiting.

2. **Slice is non-null AND matches the auto-suggested id**
   (default state after a click):
   - Visible: `t('moderator.captureTargetChip.suggested', { label })`
     — localized template
     (`"Target: {label}"` in en-US; pt-BR / es-419 surfaces below).
   - `{label}` is the truncated wording per Decision §4.
   - No override marker.

3. **Slice is non-null AND does NOT match the auto-suggested id**
   (override active — i.e., the moderator has previously cleared
   and re-selected, or a future task wrote a manual target):
   - Visible: same `suggested` template.
   - Override marker visible (small dot, `data-testid="capture-target-chip-override-marker"`).
   - The override marker's `aria-label` is
     `t('moderator.captureTargetChip.overrideMarkerAria')` —
     "Override (manually staged target)".

### Tailwind styling

Adopt the same secondary-surface vocabulary `<RightSidebar>` and
`<BottomStripCapture>` already use:

- Outer chip:
  `inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700`.
- Empty-state chip override class:
  `text-slate-400` (replacing `text-slate-700`).
- Override marker dot:
  `inline-block h-1.5 w-1.5 rounded-full bg-amber-500`.

Both states pass WCAG AA contrast: `text-slate-700` on white ≈
11.96:1; `text-slate-400` on white ≈ 4.83:1 (passes AA for the
14px text size with margin to spare).

### Wording lookup (target label resolution)

The chip shows the first 32 characters of the target node's
wording, with `…` suffix if truncated, falling back to the raw
node id if the wording is unavailable.

A new tiny selector lives at
`apps/moderator/src/graph/selectors.ts` (or a thin sibling module
if `selectors.ts` becomes crowded — implementer's call):

```ts
/**
 * Resolve the current wording for a single node by id from the
 * session's event log. Returns `null` if no `node-created` event
 * for the id exists (e.g., the node was projected from a snapshot
 * that hasn't loaded yet).
 *
 * The implementation walks the events array linearly; the cost is
 * one O(N) scan per call. The chip calls this once per render
 * when the staged target is non-null. For sessions with thousands
 * of events the cost is still trivial compared to the React render
 * the chip already pays.
 */
export function selectNodeWordingById(
  events: readonly Event[],
  nodeId: string,
): string | null;
```

The 32-character cap is the chip's display contract (one strip
slot, one short chip — not a popover). Decision §4 records the
choice.

The chip composes the lookup via:

```ts
const events = useWsStore((s) => s.sessions[sessionId]?.events ?? EMPTY_EVENTS);
const targetWording = stagedTargetId === null
  ? null
  : selectNodeWordingById(events, stagedTargetId);
const targetLabel = targetWording === null
  ? stagedTargetId ?? ''
  : truncate(targetWording, 32);
```

where `truncate(text, max)` returns `text.length <= max ? text :
`${text.slice(0, max)}…``. The `truncate` helper lives in the
chip's own file (10-line utility; no new module).

### `sessionId` plumbing

The chip needs `sessionId` to read the right events slice from
`useWsStore`. Two options:

- **Option A**: read `sessionId` from `useParams()` (the operate
  route's `:id` param). Pro: zero prop drilling; the chip is
  fully self-contained. Con: the chip is now coupled to the
  router; harder to test in isolation.
- **Option B**: accept `sessionId` as a prop from `<OperateRoute>`.
  Pro: testable in isolation; pure component. Con: one more prop
  on a component that wants to be "drop in the slot, no wiring."

Decision §6 settles on **Option A** (`useParams()`) — the
component is route-bound either way (it only renders inside
`<OperateRoute>`'s bottom strip), and the testing-in-isolation
ergonomic is recovered by wrapping the test render in
`<MemoryRouter initialEntries={['/sessions/test-session/operate']}>`,
mirroring the `App.test.tsx` precedent for route-bound components.

### Accessibility

- The chip's visible text is the accessible name (no separate
  aria-label needed — the chip is informational, not interactive).
- The override marker has `role="img"` and an explicit `aria-label`
  via `t('moderator.captureTargetChip.overrideMarkerAria')`. The
  marker is visually small (1.5 × 1.5 cell) but conveys
  load-bearing information (the staged target is overridden, not
  auto-suggested); the aria-label surfaces this to screen readers.
- The chip does NOT have any interactive children in this task
  (no buttons, no clicks). Future override gestures land on
  `mod_target_clear_override`. A future "click chip to clear" or
  "click chip to pop a target picker" would need this task's
  successor to add an interactive surface; this task's chip is
  pure display.

### Reactivity

The chip subscribes to:

- `useSelectionStore((s) => s.selected)` (via the pure selector) —
  re-renders on every selection change.
- `useCaptureStore((s) => s.targetEntityId)` — re-renders on
  every slice change.
- `useWsStore((s) => s.sessions[sessionId]?.events ?? EMPTY_EVENTS)`
  — re-renders when the events array reference changes. The
  events reference is stable per session per fresh-event tick (the
  WS store pushes a new events array on every event arrival); the
  chip re-derives the target label on every events change. For
  sessions with no inbound events between renders, the events
  reference is the same `===`, and React's diff short-circuits.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.captureTargetChip.empty` | "No target yet" | "Sem alvo ainda" | "Sin objetivo todavía" |
| `moderator.captureTargetChip.suggested` | "Target: {label}" | "Alvo: {label}" | "Objetivo: {label}" |
| `moderator.captureTargetChip.overrideMarkerAria` | "Override (manually staged target)" | "Substituição (alvo definido manualmente)" | "Anulación (objetivo definido manualmente)" |
| `moderator.captureTargetChip.ariaLabel` | "Edge target — auto-suggested from the most recently selected node" | "Alvo da aresta — sugerido automaticamente a partir do nó selecionado mais recentemente" | "Objetivo del borde — sugerido automáticamente desde el nodo seleccionado más recientemente" |

**Count: 4 keys × 3 locales = 12 catalog entries**. The pt-BR +
es-419 drafts land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json` (same pattern as
`i18n_methodology_role_descriptions`, `mod_create_session_form`,
`mod_layout_tidy_action`, `mod_capture_text_input`,
`mod_classification_palette`). The en-US is authoritative.

The new keys live under a new `moderator.captureTargetChip.*`
sub-area, named after the component (consistent with
`moderator.captureTextInput.*` and
`moderator.classificationPalette.*`).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/CaptureTargetChip.tsx` (new).
- `apps/moderator/src/layout/CaptureTargetChip.test.tsx` (new —
  Vitest cases).
- `apps/moderator/src/stores/recentlyActiveNode.ts` (new — pure
  derivation selector).
- `apps/moderator/src/stores/recentlyActiveNode.test.ts` (new —
  Vitest cases for the pure selector).
- `apps/moderator/src/graph/selectors.ts` (modified — add
  `selectNodeWordingById`; export alongside existing selectors).
- `apps/moderator/src/graph/selectors.test.ts` (modified — add
  cases for `selectNodeWordingById`).
- `apps/moderator/src/routes/Operate.tsx` (modified — pass
  `<CaptureTargetChip />` into `<BottomStripCapture>`'s
  `edgeRoleSelector` slot; update the leading Refinement comment).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add
  `moderator.captureTargetChip.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified
  — PENDING entries for the 4 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified
  — same).
- `tests/e2e/moderator-capture.spec.ts` (modified — one new
  `test()` block joining the existing ones).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_target_auto_suggest`
  lands at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_target_auto_suggest_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration
  policy.
- `docs/adr/` — no new ADR. ADR 0024 already pinned the i18n
  architecture; `mod_state_management`'s refinement pinned the
  store contracts; `mod_selection`'s refinement pinned the
  click-handler contract; this task is the UI binding for the
  existing decisions.
- `apps/moderator/src/stores/captureStore.ts` /
  `apps/moderator/src/stores/selectionStore.ts` — the stores are
  consumed transitively; no edit to the slices or the setters.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — the
  scaffold's slot contract is consumed unchanged.
- `apps/moderator/src/layout/CaptureTextInput.tsx` /
  `apps/moderator/src/layout/ClassificationPalette.tsx` /
  `apps/moderator/src/layout/ModeBanner.tsx` — sibling components,
  untouched.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — the click
  handlers stay unchanged; this task only READS what they write.
- `apps/server/src/` — no server-side change.
- `playwright.config.ts` — the new `test()` block joins the
  existing `tests/e2e/moderator-capture.spec.ts`, which is already
  picked up by the `chromium-create-session` project; no new
  project entry, no testMatch change.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the number of new
  `CaptureTargetChip.test.tsx` + `recentlyActiveNode.test.ts`
  cases (≥ 16), plus the `selectors.test.ts` extension cases (≥ 3).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity
  check) green after the catalog edits — every
  `moderator.captureTargetChip.*` key present in en-US is present
  in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds (no bundle change
  of note; one new small component + one tiny selector module).
- `pnpm exec playwright test` green against a freshly brought-up
  dev compose stack; the new auto-suggest scenario in
  `tests/e2e/moderator-capture.spec.ts` passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_target_auto_suggest` AND the
  new `i18n_target_auto_suggest_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The target chip is reachable from a real user flow as of
`mod_create_session_form` (commit `05f7d67`) + the other landed
capture-flow siblings: the moderator can log in, navigate to
`/sessions/new/setup`, create a session, land on
`/sessions/<id>/operate`, see the bottom strip with the textarea,
palette, AND the new chip filling the three left-most sub-slots.
Per the UI-stream e2e policy default, the Playwright spec is
**scoped under Acceptance criteria, NOT deferred**.

**Important caveat**: the operate route starts with an empty graph
(the bootstrap session has zero nodes). The chip's auto-suggest
behavior is exercised only AFTER at least one node exists on the
canvas — and there's no UI gesture yet that creates a node
(`mod_propose_action` hasn't landed). The e2e therefore exercises
the chip via two paths:

1. **Empty-graph path** (deterministic from the existing setup):
   chip renders the "No target yet" empty state on a freshly
   created session; no nodes exist; no auto-suggest happens.
   This is the load-bearing regression check for the empty-state
   render.
2. **Seeded-graph path** (via the `wsStoreSeed` helper introduced
   by `mod_hover_details` at
   `tests/e2e/fixtures/wsStoreSeed.ts`): inject a synthetic
   `node-created` event into the moderator's WS store via
   `page.evaluate` + `window.__aConversaWsStore`. The injected
   node renders on the canvas; the test clicks the node; the
   chip flips from "No target yet" to "Target: <wording-prefix>".
   Click a different injected node; the chip updates to the new
   wording. Pane-click clears selection; the chip stays at the
   last suggested target (no clear-on-pane-click).

The seeded-graph path follows the `mod_hover_details` precedent of
"reachable via `wsStoreSeed` even without a live propose chain."
If the seed helper proves blocked at implementation time (the
window-exposed WS store accessor isn't reachable from
`page.evaluate` for some bundling reason), the spec falls back to
the empty-state path only, and registers the deferred-seeded
coverage under a small follow-up task naming
`playwright_session_seed_capture_target` — but the precedent from
`mod_hover_details`'s Status section indicates the seed helper
works in practice, so the fallback should not be needed.

The full chain-completing e2e (auto-suggest → propose → event
lands → graph updates the new edge) is scoped to
`mod_propose_action`'s refinement, not this one.

## Acceptance criteria

### 1. The component renders inside the bottom-strip slot

- `<CaptureTargetChip>` component under
  `apps/moderator/src/layout/CaptureTargetChip.tsx` renders a
  single chip element with the three `data-testid` IDs (wrapper,
  label, override-marker; the override marker is conditionally
  rendered).
- The chip is reachable via
  `screen.getByTestId('capture-target-chip')` and announces its
  accessible name via the visible label text (no separate
  aria-label on the wrapper — the label is the name).
- `<OperateRoute>` (`apps/moderator/src/routes/Operate.tsx`)
  passes `<CaptureTargetChip />` into `<BottomStripCapture>`'s
  `edgeRoleSelector` prop. The scaffold's `[edge role]`
  placeholder is no longer rendered through the route; the
  scaffold-only `BottomStripCapture.test.tsx` cases continue to
  assert the placeholder for the empty-scaffold render path.

### 2. Empty state

- On mount with `useSelectionStore.selected === null` AND
  `useCaptureStore.targetEntityId === null`, the chip renders
  the localized empty-state text from
  `t('moderator.captureTargetChip.empty')`.
- The chip carries the `text-slate-400` dimmed class in this
  state.
- The override marker is NOT rendered.

### 3. Auto-suggest from node selection

- Programmatically setting
  `useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } })`
  with a `node-created` event for `n-1` present in `useWsStore`'s
  events array causes:
  - `useCaptureStore.getState().targetEntityId === 'n-1'` after
    the React effect runs;
  - the chip renders the localized
    `t('moderator.captureTargetChip.suggested', { label: <truncated-wording> })`;
  - no override marker.
- Changing the selection to a different node
  (`{ kind: 'node', id: 'n-2' }`) updates the slice to `'n-2'`
  and the chip text accordingly.
- Setting `selected` to `null` (pane-click) does NOT clear the
  staged target — `targetEntityId` stays at the last auto-suggested
  id; the chip text stays at the last suggested wording.

### 4. Edge selection does NOT auto-stage

- Programmatically setting
  `useSelectionStore.setState({ selected: { kind: 'edge', id: 'e-1' } })`:
  - `useCaptureStore.getState().targetEntityId` stays at whatever
    it was before (`null` if no prior staging; the prior node id
    if a prior auto-suggest happened);
  - the chip's render does NOT change in response to the edge
    selection — only node selections influence the auto-suggest.

### 5. Override survives subsequent selections

- Start state: `targetEntityId === 'n-1'` (auto-suggested via
  a prior `n-1` selection); `lastAutoStagedRef.current === 'n-1'`.
- Programmatically write `setTargetEntityId('n-other')`
  (simulating the override gesture that
  `mod_target_clear_override` will eventually ship).
- Now select node `n-2` via
  `useSelectionStore.setState({ selected: { kind: 'node', id: 'n-2' } })`.
- The auto-stage effect runs but DOES NOT stomp — it sees
  `stagedTargetId === 'n-other'` and
  `lastAutoStagedRef.current === 'n-1'`, which differ, so it skips.
- `useCaptureStore.getState().targetEntityId` stays at
  `'n-other'`.
- The chip renders with the override marker visible (the staged
  target `'n-other'` !== the auto-suggested `'n-2'`).

### 6. Reset clears the chip

- Start state: `targetEntityId === 'n-1'` (auto-suggested).
- Call `useCaptureStore.getState().reset()`.
- After re-render: the chip renders the empty state ("No target
  yet"); `lastAutoStagedRef.current` is implicitly reset (the
  component will re-derive on the next selection-driven render).

### 7. Wording-based label

- With `useWsStore` containing a `node-created` event for
  `n-1` with `wording: "The proposed minimum wage would raise prices for everyone."`,
  selecting `n-1` produces a chip label
  `"Target: The proposed minimum wage would rai…"` (first 32
  chars + `…` suffix).
- With a node whose wording is ≤ 32 chars, the chip label is
  `"Target: <full-wording>"` (no truncation, no suffix).
- With `useWsStore` containing NO `node-created` event for the
  staged target (the lookup returns `null`), the chip falls back
  to `"Target: <node-id>"` (the raw id).

### 8. Localization parity round-trip

For each locale in `['en-US', 'pt-BR', 'es-419']`:

- the empty-state text resolves to a non-key string for that
  locale;
- the suggested-state text resolves to a non-key string with the
  `{label}` substitution honored;
- the override marker's aria-label resolves to a non-key string;
- no `[t-missing]` token nor raw catalog-key string is visible in
  the component's DOM.

### 9. Vitest cases (in `apps/moderator/src/layout/CaptureTargetChip.test.tsx`)

Minimum 12 new cases, all per ADR 0022 (committed regression-class
proofs):

1. **Renders the wrapper testid** — `capture-target-chip`.
2. **Empty state when both stores empty** — `selected === null`,
   `targetEntityId === null` → label reads the en-US empty-state
   string.
3. **Empty-state styling** — chip has the `text-slate-400` dimmed
   class.
4. **Auto-suggest on node selection** — set
   `useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } })`;
   assert `useCaptureStore.getState().targetEntityId === 'n-1'`
   AND the chip label reads `Target: <wording-prefix>`.
5. **Update on selection change** — set selection to `n-1`,
   then to `n-2`; assert the chip flips.
6. **No auto-stage on edge selection** —
   `selected: { kind: 'edge', id: 'e-1' }`; assert
   `targetEntityId` stays unchanged.
7. **No auto-stage on annotation selection** —
   `selected: { kind: 'annotation', id: 'a-1' }`; same.
8. **Pane-click does NOT clear the chip** — auto-suggest to
   `n-1`, then `useSelectionStore.getState().clear()`; assert the
   chip still reads `Target: <n-1 wording>` (the staged target
   slice unchanged).
9. **Override is preserved across selection changes** — the
   Decision §5 scenario above as a single test.
10. **Override marker visible only when staged !== suggested** —
    three sub-cases: empty (no marker), auto-suggested (no
    marker), overridden (marker visible).
11. **Reset clears the chip** — `useCaptureStore.getState().reset()`
    flips the chip back to the empty state.
12. **Wording truncation** — 80-char wording renders truncated at
    32 chars + `…`.
13. **Wording fallback to id** — staged target has no
    `node-created` event; chip falls back to `Target: <id>`.
14. **Per-locale parity round-trip** — for each of the three v1
    locales, render with that locale and assert no `[t-missing]`
    token nor raw catalog-key string appears anywhere in the
    chip's DOM.

Plus the pure selector module's own cases (in
`apps/moderator/src/stores/recentlyActiveNode.test.ts`):

1. **No selection returns `null`** — `state.selected === null`.
2. **Node selection returns the id** — `kind: 'node', id: 'n-1'`.
3. **Edge selection returns `null`** — `kind: 'edge'`.
4. **Annotation selection returns `null`** — `kind: 'annotation'`.

Plus extension cases in
`apps/moderator/src/graph/selectors.test.ts`:

1. **`selectNodeWordingById` returns the wording for a matching
   `node-created` event**.
2. **Returns `null` when no matching `node-created` event
   exists**.
3. **Returns the latest wording when multiple events for the same
   id exist** (defensive — duplicate `node-created` would be a
   protocol violation, but the selector is deterministic on
   "last one wins" mirroring the rest of the projection rules).

### 10. Playwright e2e (per Decision §7)

One new `test()` block lands in
`tests/e2e/moderator-capture.spec.ts` (joining the existing
text-input + classification-palette tests), covering:

```ts
test('alice: capture target chip auto-suggests from the most-recently-selected node', async ({ page }) => {
  // 1. Login + create session + navigate to operate — mirrors
  //    the capture-text-input / classification-palette setup in
  //    this same file.
  await loginAs(page, { username: 'alice' });
  await page.goto('/sessions/new/setup');
  await page.getByTestId('create-session-topic-input').fill(
    'Capture target chip regression check.',
  );
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
    timeout: 10_000,
  });

  // 2. Empty-graph path: chip is mounted with the empty state.
  await expect(page.getByTestId('capture-target-chip')).toBeVisible();
  await expect(page.getByTestId('capture-target-chip-label')).toContainText(
    'No target yet',
  );
  await expect(
    page.getByTestId('capture-target-chip-override-marker'),
  ).toHaveCount(0);

  // 3. Seeded-graph path: inject two synthetic node-created events
  //    via the wsStoreSeed helper from mod_hover_details.
  await page.evaluate(() => {
    const seed = (window as unknown as {
      __aConversaWsStore?: { dispatchEvents: (e: unknown[]) => void };
    }).__aConversaWsStore;
    if (seed === undefined) throw new Error('wsStoreSeed not available');
    seed.dispatchEvents([
      {
        kind: 'node-created',
        payload: {
          node_id: 'n-test-1',
          wording: 'First seeded statement under test.',
        },
        // ... envelope fields per the wsStoreSeed contract
      },
      {
        kind: 'node-created',
        payload: {
          node_id: 'n-test-2',
          wording: 'Second seeded statement under test.',
        },
      },
    ]);
  });

  // 4. Click node 1 → chip flips to the first wording prefix.
  await page.getByTestId('statement-node-n-test-1').click();
  await expect(page.getByTestId('capture-target-chip-label')).toContainText(
    'Target: First seeded statement',
  );

  // 5. Click node 2 → chip flips to the second wording prefix.
  await page.getByTestId('statement-node-n-test-2').click();
  await expect(page.getByTestId('capture-target-chip-label')).toContainText(
    'Target: Second seeded statement',
  );

  // 6. Pane-click → selection clears, but the chip stays.
  await page.mouse.click(50, 50); // empty pane area
  await expect(page.getByTestId('capture-target-chip-label')).toContainText(
    'Target: Second seeded statement',
  );

  // 7. The chip does NOT show the override marker (every change
  //    above was an auto-suggest).
  await expect(
    page.getByTestId('capture-target-chip-override-marker'),
  ).toHaveCount(0);
});
```

If the `wsStoreSeed` accessor is unavailable at implementation
time (the `window.__aConversaWsStore` setup from
`mod_hover_details` is bundler-conditional), the spec degrades
to the empty-state portion only (steps 1-2) and the seeded path
is scoped to the Vitest suite. The Implementer attempts the
seeded path first per the precedent that mod_hover_details has
made the seed-helper viable; the fallback is documented but not
preferred.

### 11. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.captureTargetChip.{empty, suggested, overrideMarkerAria, ariaLabel}`
  keys with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` gains the same
  4 keys with the pt-BR draft strings.
- `packages/i18n-catalogs/src/catalogs/es-419.json` gains the
  same 4 keys with the es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` gain
  `pending: true` entries for each of the 4 keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after
  the edits.

### 12. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_target_auto_suggest` block
  gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_target_auto_suggest_native_review` is added with the
  template below (effort 0.5d;
  `depends !i18n_classification_palette_native_review`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_target_auto_suggest_native_review "Native-speaker review of pt-BR + es-419 capture-target-chip strings" {
  effort 0.5d
  allocate team
  depends !i18n_classification_palette_native_review
  note "Source of debt: mod_target_auto_suggest (this commit) — pt-BR and es-419 drafts of the 4 keys under moderator.captureTargetChip.* landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### 13. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Definition of "most-recently-active": last-selected node (NOT hover, NOT last-edited, NOT last-committed)

Four candidate definitions surveyed:

- **Last-selected node via `useSelectionStore`** (chosen). The
  selection store is the canonical "what is the moderator pointing
  at?" surface — pinned by `mod_selection`, written by the
  ReactFlow click handlers in `<GraphCanvasPane>`, already read by
  the per-card / per-edge selection ring. The store is global,
  observable from any component, and its semantics are crisp: one
  selection at a time, set by an explicit click. The "most
  recent" derives trivially because the store holds exactly one
  value — whatever the moderator clicked last is what's in the
  store. **Chosen.**
- **Last-hovered node** — rejected. Hover state lives on the
  hovered component as `useState<boolean>` (per `mod_hover_details`
  Decision §6: "Hover state lives on the entity component, not
  on a Zustand store"); there is no global hover state to read.
  Furthermore, hover is incidental — the moderator's pointer
  crosses many nodes en route to the one they actually want;
  every cross-over would re-suggest. Selection requires a
  deliberate click — a stronger signal of intent.
- **Last-edited node** (e.g., the most recent node the moderator
  committed an edit-wording proposal on) — rejected. Edit history
  is not the same as selection focus; the moderator might have
  edited n-1 ten minutes ago and be working on n-7 now. Using
  edit-recency would suggest n-1 when the moderator's focus is
  obviously elsewhere.
- **Last-committed node** (e.g., the node whose `classify-node` or
  `edit-wording` proposal most recently transitioned to `agreed`)
  — rejected for the same reason; commit is a methodology
  transition, not a focus signal. The moderator's pointer attention
  diverges from commit timing routinely.

The chosen rule has a clean inverse: edges and annotations do NOT
count. The selector
`selectMostRecentlyActiveNodeId(state)` returns `null` when
`state.selected.kind !== 'node'`. Rationale: the auto-suggest
target is "where will the next edge attach FROM?" — only nodes
are valid edge targets in the methodology (`edge-created.target_node_id`
is `node-scoped` per `packages/shared-types/src/events/`). Edges
and annotations aren't.

Per `docs/moderator-ui.md:45` the spec language is
"most-recently-active node" — node-only by definition; this task
matches the doc.

### 2. State location: derive from `useSelectionStore`, write to `useCaptureStore.targetEntityId`

Two alternatives surveyed:

- **Derive from `useSelectionStore`, write to a separate slice on
  `useCaptureStore`** (chosen). The `targetEntityId` slice is
  pre-declared on `useCaptureStore` (per `mod_state_management`)
  exactly for this purpose. Reading from
  `useSelectionStore` and writing to `useCaptureStore` is the
  load-bearing two-store interaction — the chip subscribes to
  selection (for the auto-suggest) and the staged target (for
  the render). Both stores are global, both are shaped by their
  respective refinements, both have stable contracts.
- **Track "most-recently-active" as a separate slice on
  `useSelectionStore`** — rejected. Would duplicate state: the
  derivation IS the rule, and storing the derived value would
  require keeping it in sync with `selected` (which is what
  selectors are for). The pure selector
  `selectMostRecentlyActiveNodeId` keeps the rule one place and
  expresses the dependency clearly.

The pure selector is the seam future capture-flow tasks reuse
(decompose, defeater capture, axiom-mark — each needs "what is
the moderator pointing at right now?" derived from the same
store).

### 3. Visual indicator: a chip in the capture pane (NOT a graph-side ring)

Three alternatives surveyed:

- **A small chip in the capture pane near the (future)
  edge-role selector** (chosen). The chip lives at the surface
  the moderator is composing on — the bottom strip — which is
  the same surface they're typing the wording into. Putting the
  target indicator next to the wording draft means the moderator
  sees the staged-target context in their peripheral vision
  while typing; they don't have to glance at the canvas to
  confirm "yes, this proposal will attach to n-1." The chip is
  small (one strip cell), reactive (updates live as the
  selection changes), and reads in the same vocabulary the
  classification palette reads in.
- **A graph-side highlight ring on the auto-suggested node** —
  rejected as the SOLE indicator. The selection ring (sky-500)
  pinned by `mod_selection` already does this: the
  most-recently-clicked node carries a ring; "the selection
  ring IS the auto-suggest visual" is the moderator's natural
  reading. Adding a second ring (e.g., amber for "auto-suggested
  target") would compete with the selection ring on the same
  card and add visual noise. The chip in the pane is the
  primary affordance; the canvas's existing selection ring is
  the secondary cue (the moderator sees "n-1 is the staged
  target" both via the chip AND via the fact that n-1 carries
  the sky selection ring on the canvas).
- **Both a chip AND a separate canvas ring** — rejected on the
  same noise-budget grounds. The selection ring is the canvas-side
  signal already; no second ring needed.

### 4. Label resolution: first-32-character truncation of the target's wording; fallback to raw node id

Three alternatives surveyed:

- **First 32 chars + `…` suffix, fallback to id** (chosen). The
  chip is small (one strip cell, ~10-12 chars of horizontal
  budget at the default font size before the row starts to push
  the other strip slots around). 32 chars is enough to convey
  the gist of a typical statement opening ("The proposed minimum
  wage…") and small enough to fit in the chip without forcing a
  horizontal-scroll inside the strip. Truncation with `…` is the
  canonical "there's more" affordance. The full wording is one
  hover away via the existing `<HoverPopover>` on the canvas
  node — the chip doesn't have to be self-contained.
- **Show the raw node id only** — rejected. Node ids are UUIDs
  (or similar opaque identifiers); reading "Target:
  f47ac10b-58cc-4372-a567" gives the moderator nothing. They
  need a recognizable handle.
- **Show the full wording** — rejected. Wordings can be 200+
  chars (the methodology cap is 10 000 per
  `MAX_METHODOLOGY_TEXT_LENGTH`); even a single-sentence wording
  exceeds the strip cell. Wrapping the chip to multi-line breaks
  the strip's geometry contract.

The 32-char cap is a chip-display contract, NOT a methodology
rule. Translatable strings ("Target: " prefix) are localized;
the wording itself is participant-supplied and NOT translated
per `DESIGN.md:43`.

### 5. Auto-stage effect with no-stomp ref guard

Surveyed:

- **`useEffect` + `useRef` to track the last auto-staged id**
  (chosen). The ref distinguishes "the staged target is whatever
  the auto-suggest last wrote" from "the staged target is the
  moderator's deliberate override." Without the ref, the chip
  would re-stage on every selection change and overwrite any
  override the user made via `mod_target_clear_override`. With
  the ref, the chip's auto-stage effect only writes when (a) the
  slice is null (initial empty state), or (b) the slice equals
  the last auto-staged id AND the most-recently-active node has
  changed (a "follow the selection" auto-update with no override
  in between).
- **Always write the derived id to the slice** — rejected.
  Breaks the override sibling task. Every selection change would
  wipe a clear-override.
- **Never auto-stage; let the moderator click-to-stage via a
  separate gesture** — rejected. Defeats the F1 ergonomic per
  `docs/moderator-ui.md:45`: the auto-suggest is the
  capture-speed affordance the design specifically calls for.

The no-stomp rule has one subtle property: if the moderator
overrides to a custom target, then later RE-SELECTS the
auto-suggested node deliberately (e.g., clicks on it again),
the chip stays at the override — the ref-tracked last-auto-staged
doesn't match, so the effect skips. This is intentional: a
deliberate re-selection of an auto-suggested node is still
distinguishable from "the auto-suggest is happening transparently"
because the moderator went through an explicit override. The
override sibling task ships the gesture to undo the override
(restore auto-suggest); without using that gesture, the
override persists.

### 6. `sessionId` plumbing: `useParams()` (NOT a prop)

Surveyed:

- **`useParams()` inside the chip** (chosen — see
  "sessionId plumbing" above for rationale).
- **`sessionId` as a prop on `<CaptureTargetChip>`** — rejected
  for the prop-drilling cost; the chip is route-bound either way
  and the testing-in-isolation ergonomic is recovered via
  `<MemoryRouter>`.

### 7. Playwright e2e placement: extend the existing capture spec

Surveyed:

- **Extend `tests/e2e/moderator-capture.spec.ts`** (chosen). The
  spec file is already the capture-flow's regression home (text
  input + classification palette tests live here). The
  auto-suggest test joins the same file as a third `test()`
  block; setup overlap is total; future capture-flow tasks
  (`mod_target_clear_override`, `mod_edge_role_selector`,
  `mod_propose_action`) join the same file naturally. The file's
  value compounds across the capture-flow siblings rather than
  diluting into per-task files.
- **A new file `tests/e2e/moderator-capture-target.spec.ts`** —
  rejected. The setup duplication (login + create-session +
  navigate) is wasteful; the file would be a 30-line test plus
  100 lines of setup boilerplate. Joining the existing spec is
  the right scope.

### 8. Slot sharing with the future edge-role selector

The `bottom-strip-edge-role` slot is the home of two surfaces
that don't exist yet as separate tasks: the target chip (this
task) and the edge-role selector
(`mod_edge_role_selector` — pending). Per
`docs/moderator-ui.md:33` the strip carries "edge-target
selector" as a single named slot — i.e., the methodology pairs
"which entity?" with "what role?" as one connect-pane question.

Two alternatives surveyed:

- **This task ships the chip directly into the
  `edgeRoleSelector` slot;
  `mod_edge_role_selector` later refactors the slot to render a
  small composition wrapper containing both the chip and the
  selector** (chosen). The wrapper is one line of JSX (`<>
  <CaptureTargetChip /><EdgeRoleSelector /></>` or a small
  `<EdgeAttachmentControls>` component). The refactor lives in
  the selector's task because it's the second of the two
  surfaces; the first surface (this task) doesn't need to
  pre-design the composition.
- **This task introduces a new `<EdgeAttachmentControls>`
  wrapper component preemptively** — rejected. YAGNI: the
  wrapper has nothing to wrap yet, and the second surface might
  reasonably want different geometry than the wrapper this task
  guesses. The selector's refinement gets to decide.
- **Rename the scaffold's `edgeRoleSelector` slot to something
  like `edgeAttachment` to reflect the dual-content reality** —
  rejected. Renaming the slot is a scaffold change; it would
  ripple into `BottomStripCapture.test.tsx` and any downstream
  reader of the prop name. The current name is acceptable as a
  starting point; if a future task wants a clearer name, it can
  rename then.

The slot's `data-testid="bottom-strip-edge-role"` stays
unchanged; this task lands the chip as the slot's first (and
only) child for now. When `mod_edge_role_selector` lands and
composes alongside, the testid still resolves to the same
container.

### 9. Native-review follow-up registered, not bundled into this task

Same rationale as `mod_create_session_form` Decisions §6,
`mod_layout_tidy_action` Decisions §6, `mod_capture_text_input`
Decisions §9, `mod_classification_palette` Decisions §9: native
review is a different skill from the wiring; the chip is
functional without the review (a pt-BR moderator viewing the
draft "Sem alvo ainda" empty-state text sees a comprehensible
label); the native-speaker review chain stays serializable
through `depends !i18n_classification_palette_native_review`.

### 10. No new ADR

Four potential ADR triggers, all dispatched:

- **"A new auto-suggest policy is ADR-worthy."** No — the policy
  is spelled out in `docs/moderator-ui.md:45` already (the F1
  spec). This task is the UI binding for the design-doc spec.
- **"A new derivation pattern is ADR-worthy."** No — the
  cross-store derivation (`useSelectionStore` →
  `useCaptureStore`) is the same pattern `mod_classification_palette`
  established for cross-module reads (catalog ↔ store); the
  pure-selector idiom is established by
  `apps/moderator/src/graph/selectors.ts`.
- **"A new global-state-coupling pattern is ADR-worthy."** No —
  the state architecture (one store per concern, components
  cross-read via Zustand selectors) is pinned by
  `mod_state_management` and unchanged by this task.
- **"A wording-truncation rule for chip displays is ADR-worthy."**
  No — the rule is a chip-display contract, not a methodology
  decision; it lives in one component's source file.

`mod_state_management`, `mod_selection`, ADR 0022, ADR 0024, and
the F1 design doc spec already pinned every architectural choice
this task implements; this refinement is the task-scope pin for
the UI binding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- New `<CaptureTargetChip>` component at
  `apps/moderator/src/layout/CaptureTargetChip.tsx` with sibling test
  at `apps/moderator/src/layout/CaptureTargetChip.test.tsx`; wired into
  `apps/moderator/src/routes/Operate.tsx` in the `edgeRoleSelector`
  slot. Renders the auto-suggested target label (wording-truncated
  per chip-display contract) with empty-state and override-marker
  variants.
- New shared seam — `selectMostRecentlyActiveNodeId` selector +
  `targetEntityId` slice with no-stomp guard — is the contract
  `mod_target_clear_override` will consume as its override seam. The
  selector lives in
  `apps/moderator/src/stores/recentlyActiveNode.ts` (with
  `recentlyActiveNode.test.ts`); auto-stages from
  `useSelectionStore` into `useCaptureStore.targetEntityId` only when
  the user has not already chosen a target.
- New `selectNodeWordingById` selector added to
  `apps/moderator/src/graph/selectors.ts` (+3 cases in
  `selectors.test.ts`); used by the chip to look up the truncated
  label for the currently-staged target node.
- i18n: 4 new keys under `moderator.captureTargetChip.*` landed in
  `packages/i18n-catalogs/src/catalogs/en-US.json`; pt-BR + es-419
  drafts flagged PENDING in their `.review.json` trackers.
- Playwright cover: one new `test()` block in
  `tests/e2e/moderator-capture.spec.ts` exercising the seeded-graph
  auto-suggest path; `chromium-create-session` project 3/3 green.
- Vitest test-count delta: 2716 → 2753 (+37 cases).
- Tech-debt follow-up: `i18n_target_auto_suggest_native_review`
  registered in `tasks/35-frontend-i18n.tji` (pt-BR + es-419
  native-speaker review for the 4 capture-target-chip strings).
