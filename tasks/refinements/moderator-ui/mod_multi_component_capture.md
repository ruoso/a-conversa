# Moderator decompose-mode multi-component capture — N rows of (wording + kind) inside the bottom strip

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_decompose_flow.mod_multi_component_capture`.

```
task mod_multi_component_capture "Multi-component capture (wording + kind for each)" {
  effort 1d
  allocate team
  depends !mod_decompose_mode
}
```

## Effort estimate

**1d.** Confirmed. The work is store-slice + component + bottom-strip mode-aware
wiring + i18n + tests on top of seams already in place:

- `useCaptureStore` already carries the `mode: CaptureMode` slice with `'decompose'`
  as one of its valid values (`apps/moderator/src/stores/captureStore.ts:35-43`),
  the `decomposeTargetNodeId: string | null` slice (line 86), and the
  `enterDecomposeMode(nodeId)` / `exitDecomposeMode()` coordination helpers
  (lines 116-125; implementations at lines 159-175) — all landed by
  `mod_decompose_mode` (commit `83bea9b`, refinement
  [`tasks/refinements/moderator-ui/mod_decompose_mode.md`](mod_decompose_mode.md)).
  This task extends the same store with the per-component slice + the row
  add/remove/update helpers; it does **not** change the public contract of any
  existing slice or helper.
- `mod_decompose_mode`'s `enterDecomposeMode` helper already clears the F1
  slices atomically on mode entry (lines 159-170 — `text = ''`,
  `classification = null`, `targetEntityId = null`, `edgeRole = null`); this
  task extends the same `set()` call to initialize the new
  `decomposeComponents` slice to two empty rows on entry, and the
  `exitDecomposeMode` helper to clear it back to an empty array.
- `<BottomStripCapture>` exposes five stable sub-slots
  (`bottom-strip-text-input`, `bottom-strip-classification`,
  `bottom-strip-edge-role`, `bottom-strip-propose-action`, plus the
  `bottom-strip-mode-banner` row at the top) per
  `apps/moderator/src/layout/BottomStripCapture.tsx:42-95`. This task does NOT
  add a new scaffold sub-slot; the multi-component capture grid replaces what
  the route mounts inside the existing `textInput` + `classificationPalette` +
  `edgeRoleSelector` slots when `mode === 'decompose'` (see Decision §3 for the
  slot-reuse vs. new-slot trade-off).
- The classification picker pattern is established by
  `<ClassificationPalette>` (`apps/moderator/src/layout/ClassificationPalette.tsx`):
  five buttons over `METHODOLOGY_KINDS` with localized `methodology.kind.<kind>`
  labels + uppercase mnemonic chips, `aria-pressed` for selection state,
  Tailwind selected/unselected variants reaching WCAG AA contrast. The
  per-component classification picker reuses the same vocabulary as a
  smaller-footprint sub-component (Decision §4 records the
  reuse-vs-extract trade-off).
- The text-input pattern is established by `<CaptureTextInput>`
  (`apps/moderator/src/layout/CaptureTextInput.tsx`): controlled textarea
  reading from `useCaptureStore`, `maxLength={MAX_METHODOLOGY_TEXT_LENGTH}` cap
  with the defensive `slice(0, MAX)` clamp on `onChange`, helper line with
  `{used}/{max} characters`, no auto-focus on mount. The per-component
  wording textarea adopts the same shape with the additions of (a) the
  per-row index argument on the setter, (b) a more compact 1-line min-height
  appropriate to the multi-row context (Decision §5).
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419 drafts is
  established by every prior moderator-UI task; the
  `moderator.decompose.*` namespace already exists in all three v1 locales
  (`packages/i18n-catalogs/src/catalogs/en-US.json:285-293` ships the
  `exit.{ariaLabel,tooltip}` and `banner.targetWording` keys from
  `mod_decompose_mode`). This task adds a new sub-namespace
  `moderator.decompose.components.*` alongside the existing
  `moderator.decompose.{exit,banner}.*` siblings.
- ADR 0022 (no throwaway verifications) and ADR 0024 (react-i18next + ICU)
  already pin the i18n + test-discipline patterns this task consumes; no new
  ADR is required (see Decision §10).

Concretely the deliverable is:

- **One new store slice** on `useCaptureStore`:
  `decomposeComponents: ReadonlyArray<{ text: string; classification: StatementKind | null }>`.
  Slice value is `[]` on the global initial state; the `enterDecomposeMode`
  helper initializes it to two empty rows on entry; the `exitDecomposeMode`
  helper and `reset()` clear it back to `[]`. Per-row mutation rides through
  three new coordination helpers — `setDecomposeComponentText(index, text)`,
  `setDecomposeComponentClassification(index, kind)`,
  `addDecomposeComponent()`, `removeDecomposeComponent(index)` — each
  returning the post-mutation slice via a single `set()` call so subscribers
  observe one consistent transition (Decision §1 records the helper-set
  shape vs. a single generic `setDecomposeComponents(next)` setter).
- **One new component** `apps/moderator/src/layout/DecomposeComponentsGrid.tsx`
  rendering N rows of (text input + classification palette) plus an "add
  component" button below the grid and a per-row "remove component" button
  (disabled when the grid is at the minimum 2 rows). The grid mounts
  conditionally — `mode === 'decompose'` returns the grid; any other mode
  returns `null` so the slot's contents stay untouched in the non-decompose
  modes. Decision §3 records the slot-reuse pattern.
- **One small per-row sub-component** `<DecomposeComponentRow index={i}>`
  that reads its own slice (`useCaptureStore((s) => s.decomposeComponents[i])`)
  and writes through the per-index helpers. Composes the text input + the
  classification picker + the remove button as a single row.
- **One new compact classification picker**
  `apps/moderator/src/layout/DecomposeComponentClassificationPicker.tsx`
  — the same shape as `<ClassificationPalette>` but bound to a single
  per-row index rather than the global `classification` slice. Decision §4
  records the **extract-the-picker** choice over inlining or sharing the
  existing palette (the existing palette is bound to the global slice; the
  per-row picker needs to bind to per-row state — different store seam, so
  the components are siblings rather than parameterized).
- **One new compact text input**
  `apps/moderator/src/layout/DecomposeComponentTextInput.tsx`
  — controlled `<textarea>` like `<CaptureTextInput>` but bound to the
  per-row index, with `rows={1}` initial min-height (the row's natural
  density is one line per component; auto-grow logic mirrors
  `<CaptureTextInput>`'s pattern up to a smaller `MAX_HEIGHT_PX` ceiling).
  Decision §5 records the row-density choice.
- **`<BottomStripCapture>` slot-content swap** at the
  `apps/moderator/src/routes/Operate.tsx` integration site. When
  `mode === 'decompose'`, the `textInput` + `classificationPalette` +
  `edgeRoleSelector` slot props receive the multi-component grid + an
  add-component button + a hidden node (`null`); when
  `mode !== 'decompose'`, the slot props receive the existing F1 components
  unchanged. The slot-content switch is a render-time conditional at the
  route, not a scaffold change (Decision §3 — minimum-churn vs. a new
  scaffold prop).
- **Validation surface**: a `decomposeComponentsValid` derived state (a
  helper function `validateDecomposeComponents(components)` that returns
  `true` iff every row has non-empty trimmed text AND a non-null
  classification AND the array length is ≥ 2 AND ≤ 10) is **exposed from the
  store** as a derived selector. `mod_propose_decomposition` (sibling, next
  task) will read this to gate the propose-button. This task ships the
  selector + its tests; it does NOT ship the propose-button (Decision §8
  records the seam vs. premature implementation).
- **`<CaptureTextInput>`'s submit gesture** continues to fire the same
  `onSubmit` callback the consumer wires; in decompose mode the consumer
  swaps the F1 `propose()` for the future decomposition-propose handler
  (sibling-task-owned). This task does NOT wire the submit; it ships the
  per-row capture state the propose handler will read.
- **Keyboard navigation**: standard browser Tab navigation across the rows.
  No new global keymap entries — the existing `captureKeymap` already gates
  on editable-target so typing letters into the per-row textareas does NOT
  bounce the global F1 classification palette (which is hidden in decompose
  mode anyway, but the defensive guard still applies). Decision §6 records
  the no-new-keymap choice.
- **5 new i18n catalog keys** under `moderator.decompose.components.*`:
  - `moderator.decompose.components.rowLabel` — ICU `"Component {index}"`
    where `{index}` is 1-indexed.
  - `moderator.decompose.components.textPlaceholder` — "Component wording…"
  - `moderator.decompose.components.classificationLegend` — "Component kind"
  - `moderator.decompose.components.addRow` — "Add component"
  - `moderator.decompose.components.removeRowAria` — ICU
    `"Remove component {index}"`.

  5 keys × 3 locales = **15 new catalog entries.** pt-BR / es-419 drafts
  land flagged PENDING in `pt-BR.review.json` + `es-419.review.json` (10
  entries total). Native-speaker review registered as a tech-debt
  follow-up (see Acceptance criteria / Decisions).
- **1 follow-up tech-debt task** registered in `tasks/35-frontend-i18n.tji`
  for the native-speaker review of the 10 new pt-BR / es-419 draft entries
  (`i18n_multi_component_capture_native_review`, effort 0.5d,
  `depends !i18n_decompose_mode_native_review` — the current tail of the
  native-review chain per `tasks/35-frontend-i18n.tji:198-204`).
- **Vitest cases** across four touched / new test files:
  `apps/moderator/src/stores/captureStore.test.ts` (slice + helper
  semantics + the `enterDecomposeMode` two-row init + the
  `exitDecomposeMode` clear-back),
  `apps/moderator/src/layout/DecomposeComponentsGrid.test.tsx` (render
  gating, add-row, remove-row gating at minimum, per-row data flow,
  per-locale parity),
  `apps/moderator/src/layout/DecomposeComponentRow.test.tsx` (text input
  + classification picker per-row binding),
  `apps/moderator/src/layout/DecomposeComponentClassificationPicker.test.tsx`
  (the compact picker's selection + write-back semantics).
- **Playwright e2e** in `tests/e2e/moderator-capture.spec.ts` — extend with
  a new `test()` block under the existing
  `test.describe('moderator capture flow', ...)` group; reuse the
  `mod_decompose_mode` e2e template (login → create session → bridge
  lobby → seed a node → right-click → "Propose decompose") then drive the
  multi-component grid: type into component 1's textarea + click a kind,
  click "Add component" to reach 3 rows, type into component 3 + click a
  kind, click the per-row remove button on component 3 to return to 2
  rows, press Esc → assert all decompose state cleared (mode → `'idle'`,
  `decomposeComponents` → `[]`).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their
public contracts):

- **`moderator_ui.mod_decompose_flow.mod_decompose_mode`** (done — 2026-05-16
  per `mod_decompose_mode.md` Status block + commit `83bea9b`). Shipped the
  `decomposeTargetNodeId` slice, the `enterDecomposeMode` /
  `exitDecomposeMode` helpers, the node context-menu wiring on
  `buildNodeMenuItems`, the `<DecomposeModeExitButton>` exit-affordance
  with the `decompose-mode-exit` testid + the mode-aware Escape keymap
  routing, and the `moderator.decompose.{exit,banner}.*` i18n keys. This
  task extends the same store with the per-component slice + the row
  add/remove/update helpers; the **F1-coupling clear on entry pattern**
  (Decision §6 of `mod_decompose_mode.md`) is the precedent for the
  **two-empty-row init on entry pattern** this task adds.
- **`data_and_methodology.methodology_engine.decomposition_logic`** (done —
  2026-05-10 per `decomposition_logic.md`'s Status block). Pinned the
  propose-side validator for the `decompose` proposal sub-kind — rules 1
  (parent-node-exists), 2 (parent-node-visible),
  3 (no-conflicting-pending-decompose), 4 (structural-shape-via-Zod). The
  Zod schema `decomposeProposalSchema`
  (`packages/shared-types/src/events/proposals.ts:168-172`) constrains the
  payload at the API ingress: `components: z.array(proposalComponentSchema).min(2).max(10)`
  and `proposalComponentSchema.wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH)` +
  `proposalComponentSchema.classification: statementKindSchema`. **This task
  surfaces the UI side of that contract** — the per-row text + kind state
  + the array-length bounds (2..10) + the per-row validation (non-empty
  text AND non-null classification). This task does NOT call the
  validator; `mod_propose_decomposition` (sibling, next task) builds the
  propose envelope from these slices and the propose handler validates it.
- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done —
  precedent for the per-row textarea pattern). The
  `MAX_METHODOLOGY_TEXT_LENGTH` cap-mirror, the defensive `slice(0, MAX)`
  clamp, the `aria-describedby` link to a helper, the `spellCheck` /
  `autoComplete="off"` / `inputMode="text"` attributes, and the
  no-auto-focus stance all carry over.
- **`moderator_ui.mod_capture_flow.mod_classification_palette`** (done —
  precedent for the compact picker). The five-button row over
  `METHODOLOGY_KINDS`, the localized `methodology.kind.<kind>` labels, the
  uppercase mnemonic chips, the `aria-pressed` selection state, and the
  Tailwind selected/unselected variants are the vocabulary the per-row
  picker reuses. Decision §4 records the extract-vs-share trade-off.
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore`
  declared at `apps/moderator/src/stores/captureStore.ts` with the
  `Pick<CaptureState, ...>` initial-state pattern this task extends).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done — exposes
  the five stable sub-slots; this task reuses three of them via the
  route-level conditional swap. The scaffold itself is unchanged).
- **`moderator_ui.mod_mode_banner`** + **`mod_decompose_mode`** (done — the
  decompose banner is already in place; this task does NOT touch the
  banner row. The `<DecomposeModeExitButton>` is unchanged. The grid
  mounts inside the body of the bottom strip; the banner row stays the
  banner row).
- **`frontend_i18n.i18n_methodology_glossary`** (done — the per-kind
  `methodology.kind.<kind>` labels are already in all three v1 locales;
  the compact picker reads the same keys).
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — pinned the
  english-mnemonic / locale-independent policy + shipped
  `KIND_TO_SHORTCUT`. The compact picker reuses the mnemonic chips for
  visual continuity; per Decision §6 it does NOT register a global
  keyboard listener for the kind keys — the global
  `<ClassificationPalette>`'s listener is hidden behind a mode check by
  the route's conditional swap, and the per-row picker's clicks suffice
  for v1 keyboard parity).
- **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()` from
  `react-i18next`, the catalog parity-check script, the `*.review.json`
  PENDING-flag lifecycle, and the per-locale smoke pattern are all in
  place).
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** —
  the `useTranslation()` API the new components consume; ICU interpolation
  for the row-label and remove-aria substitutions.

Pending edges this task FEEDS (NOT depends on):

- **`moderator_ui.mod_decompose_flow.mod_propose_decomposition`**
  (sibling, immediate downstream — `depends !mod_multi_component_capture`
  per the WBS at `tasks/30-moderator-ui.tji:342-346`). Will read
  `useCaptureStore((s) => s.decomposeComponents)` + the
  `decomposeTargetNodeId` slice, run the `decomposeComponentsValid`
  derived selector this task ships, gate the propose button on its truth,
  build the `propose: decompose` envelope per `decomposeProposalSchema`,
  send it over the WS client, and call `exitDecomposeMode()` on
  propose-success (the post-success seam mirrors `mod_propose_action`'s
  post-F1-success `useCaptureStore.getState().reset()` call).
- **`moderator_ui.mod_decompose_flow.mod_interpretive_split_mode`**
  (sibling — `depends !mod_decompose_mode`). The interpretive-split flow
  is structurally analogous to decompose with a different proposal kind
  (per `docs/moderator-ui.md:62`: "Interpretive splits use the same flow
  with a different proposal kind."). Decision §9 of this refinement is the
  template the interpretive-split equivalent (a sibling
  `mod_multi_reading_capture` if registered later, or shared via
  parameterization) would replicate.
- **`frontend_i18n.i18n_multi_component_capture_native_review`** (registered
  by this task). The pt-BR / es-419 drafts of the 5 new keys land flagged
  PENDING; the follow-up replaces them with native-speaker-reviewed text.

## What this task is

Land the **multi-component capture grid** for the F2 decompose flow. This is
the middle leaf of `mod_decompose_flow` — the mode-entry seam shipped
(`mod_decompose_mode`); the propose-decomposition capstone is next
(`mod_propose_decomposition`); **this task fills the gap** by capturing the
N component pieces (wording + classification per row) that the eventual
propose envelope will carry.

Per `docs/moderator-ui.md:55-58` (F2 step 3): "**Capture each component** —
wording + proposed kind. Add as many as needed."

"Capturing each component" means three coordinated state slices, exposed via
five coordination helpers:

1. **`captureStore.decomposeComponents`** — a `ReadonlyArray` of
   `{ text: string; classification: StatementKind | null }` rows. The slice
   is `[]` outside decompose mode; it's seeded to two empty rows on
   `enterDecomposeMode(nodeId)` entry; it's cleared back to `[]` on
   `exitDecomposeMode()` / `reset()`.
2. **The per-row mutators** —
   `setDecomposeComponentText(index, text)`,
   `setDecomposeComponentClassification(index, kind)`,
   `addDecomposeComponent()` (appends one empty row),
   `removeDecomposeComponent(index)` (removes the indexed row, gated by
   `array.length > MINIMUM_DECOMPOSE_COMPONENTS` so the grid never goes
   below 2 rows; the bound enforces the Zod schema's `.min(2)` at the UI
   layer for early feedback).
3. **The derived validator** — `validateDecomposeComponents(components)`
   returns `true` iff every row's `text.trim().length > 0` AND every row's
   `classification !== null` AND `components.length` is in `[2, 10]`. The
   helper is exposed both as a free function (for `mod_propose_decomposition`
   to import and gate the propose button) and as a memoized selector on the
   store (for the grid itself to surface inline validation hints, though v1
   defers the inline-hint UI to a follow-up — Decision §7).

The grid also ships:

- **The visible per-row UI** — N rows of (text input + classification
  picker), each row prefixed with a localized `"Component {index}"` label.
  Per-row remove button (disabled when at the minimum 2 rows). An "Add
  component" button below the grid (disabled when at the maximum 10 rows —
  the Zod schema's `.max(10)` bound mirrored at the UI layer).
- **The classification picker per row** — the same five-button row over
  `METHODOLOGY_KINDS` as the F1 `<ClassificationPalette>` but bound to the
  per-row slice. Compact variant (Decision §4 — extract the pattern to a
  sibling component bound to per-row state, rather than parameterize the
  F1 palette which is bound to the global `classification` slice).
- **The slot-content swap at the route** — when `mode === 'decompose'`,
  the `textInput` + `classificationPalette` + `edgeRoleSelector` slots of
  `<BottomStripCapture>` collectively render the multi-component grid;
  when `mode !== 'decompose'`, the slots render the existing F1
  components (`<CaptureTextInput>`, `<ClassificationPalette>`,
  `<CaptureTargetAndRole>`). The hidden state in non-decompose mode is
  conventional: the slots have no content for the decompose flow when not
  in the mode, and no content for the F1 flow when in the mode.

**Out of scope** (sibling-task ownership):

- The propose-decomposition button + the `propose: decompose` envelope
  itself (`mod_propose_decomposition` — sibling, next task; depends on
  this task). The button reads `decomposeComponents` + the
  `decomposeComponentsValid` selector this task ships; the envelope's
  shape is constrained by `decomposeProposalSchema` (already in place).
- The submit gesture from the per-row textareas. The Cmd/Ctrl+Enter
  gesture defined by `mod_capture_text_input` on `<CaptureTextInput>`
  fires the F1 propose; the per-row textareas in this task do NOT fire
  any submit (the propose-decomposition button is the only submit path
  in decompose mode v1, per Decision §6). The per-row Enter inserts a
  newline (native textarea behaviour). Future enhancement (out of
  scope): `Cmd/Ctrl+Enter` on the last component's textarea fires the
  propose-decomposition button — a tiny follow-up that lands with or
  after `mod_propose_decomposition`.
- The interpretive-split mode's multi-reading capture
  (`mod_interpretive_split_mode` — sibling). Structurally analogous;
  Decision §9 records the template.
- Inline per-row validation hints (e.g., a small "wording required" or
  "kind required" message under each row when the row is invalid). The
  grid surfaces NO inline validation messages in v1; the propose-button's
  disabled state + the propose-button's gate-reason tooltip
  (`mod_propose_decomposition`'s scope) carry the surface. Decision §7.

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_propose_decomposition` cannot land without it.** The
   propose-decomposition task declares `depends !mod_multi_component_capture`
   in the WBS (`tasks/30-moderator-ui.tji:342-346`). Until this task ships
   the `decomposeComponents` slice + the per-row helpers + the
   `decomposeComponentsValid` selector, the propose-decomposition button
   has nothing to read for the envelope's `components` field and no signal
   to gate its disabled state.

2. **The methodology cycle stops at mode-entry without this task.** The
   server-side propose-side validator for `decompose` landed two weeks ago
   (`decomposition_logic`, 2026-05-10); the moderator-UI mode-entry seam
   landed yesterday (`mod_decompose_mode`, 2026-05-16); but the operator
   currently enters decompose mode, sees the "Decomposing {wording}"
   overlay, and stares at the F1 capture pane with no way to capture
   component pieces — the F1 textarea / palette is hidden by the route's
   conditional swap (per Decision §3 of `mod_decompose_mode.md`'s Status
   block: the multi-component capture UI has not yet shipped). This task
   closes the gap: a moderator can right-click a node, click "Propose
   decompose", type two component wordings + pick a kind for each, click
   add-row to add more, and the per-row state is staged on the store
   ready for the next sibling task's propose action.

3. **It is the template for `mod_interpretive_split_mode`** (analogous
   flow). Per `docs/moderator-ui.md:62`: "Interpretive splits use the
   same flow with a different proposal kind." The interpretive-split
   mode will mirror this task's exact shape: a parallel
   `interpretiveSplitReadings` slice on `useCaptureStore` with the same
   `2..10` bounds (the Zod
   `interpretiveSplitProposalSchema.readings: z.array(proposalComponentSchema).min(2).max(10)`
   at `packages/shared-types/src/events/proposals.ts:182-185` is
   structurally identical to `decomposeProposalSchema.components`),
   parallel per-row helpers, a parallel grid component. Settling the
   pattern here once means the interpretive-split capture lands as a
   replicate-with-rename rather than a re-design.

Downstream, the propose-decomposition button is the only consumer of the
per-row state; the sibling interpretive-split task will mirror the
patterns; no other task depends on this leaf.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- `apps/moderator/src/stores/captureStore.ts:33-43` — the `CaptureMode`
  enum (`'decompose'` is one of the eight valid values; no enum change
  needed).
- `apps/moderator/src/stores/captureStore.ts:45-128` — the
  `CaptureState` interface + initial-state object. The new slice
  `decomposeComponents: ReadonlyArray<DecomposeComponent>` joins
  alongside the existing six slice fields (`text`, `classification`,
  `targetEntityId`, `edgeRole`, `mode`, `proposing`,
  `decomposeTargetNodeId`). The `initialCaptureState` Pick literal grows
  by one field; the `reset()` invariant (the spread of
  `initialCaptureState`) clears the new slice automatically.
- `apps/moderator/src/stores/captureStore.ts:149-178` — the store
  factory closure where the four new coordination helpers
  (`setDecomposeComponentText`, `setDecomposeComponentClassification`,
  `addDecomposeComponent`, `removeDecomposeComponent`) land alongside
  the existing setters + the existing `enterDecomposeMode` /
  `exitDecomposeMode` helpers. The `enterDecomposeMode` helper grows by
  one field in its single-`set()` call (initializing
  `decomposeComponents` to two empty rows); the `exitDecomposeMode`
  helper grows by one field (clearing it back to `[]`). Both edits are
  inside the existing `set({ ... })` calls — no new `set()` round trips.
- `apps/moderator/src/layout/CaptureTextInput.tsx:1-155` — the F1
  textarea precedent. The per-row text input mirrors the controlled
  pattern, the `MAX_METHODOLOGY_TEXT_LENGTH` cap mirror, the defensive
  clamp on `onChange`, and the no-auto-focus stance. Differences (per
  Decision §5): the per-row variant uses `rows={1}` initial min-height
  + a smaller `MAX_HEIGHT_PX` ceiling (`~72px` ≈ 3 lines) appropriate
  to the multi-row density, takes the row index as a prop, and reads
  its slice via `useCaptureStore((s) => s.decomposeComponents[index].text)`
  rather than the global `text` slice.
- `apps/moderator/src/layout/ClassificationPalette.tsx:1-158` — the F1
  classification picker precedent. The per-row picker mirrors the
  five-button-over-METHODOLOGY_KINDS shape, the `methodology.kind.<kind>`
  label keys, the mnemonic-chip `<kbd>` decoration, the
  `aria-pressed` selection signaling, the Tailwind selected/unselected
  Tailwind variants. Differences: the per-row picker takes the row
  index as a prop, reads its slice via
  `useCaptureStore((s) => s.decomposeComponents[index].classification)`,
  writes through `setDecomposeComponentClassification(index, kind)`,
  and does NOT install a `captureKeymap` listener (Decision §6 — the
  per-row pickers are click-only in v1).
- `apps/moderator/src/layout/BottomStripCapture.tsx:38-95` — the
  scaffold the route mounts into. **Unchanged by this task.** The five
  sub-slots stay as they are; the route's conditional swap is what
  switches the slot's content between F1 and the decompose grid.
- `apps/moderator/src/layout/DecomposeModeExitButton.tsx:72-120` — the
  exit affordance, unchanged. The grid renders below the banner row;
  the exit button stays in the banner row alongside `<ModeBanner>`.
- `apps/moderator/src/routes/Operate.tsx:128-151` — the route's
  `<BottomStripCapture>` mount. The integration site grows three
  conditional ternaries:
  `textInput={mode === 'decompose' ? <DecomposeComponentsGrid /> : <CaptureTextInput onSubmit={...} />}`,
  `classificationPalette={mode === 'decompose' ? null : <ClassificationPalette />}`,
  `edgeRoleSelector={mode === 'decompose' ? null : <CaptureTargetAndRole />}`.
  Reading `mode` requires a `useCaptureStore((s) => s.mode)` selector
  at the route. The propose-action slot stays the same in v1; the
  propose-decomposition button will land in the same slot via
  `mod_propose_decomposition` (sibling) with its own conditional swap
  on `mode`. Decision §3 records why the grid occupies the `textInput`
  slot and the other two slots render `null` rather than minting a new
  scaffold slot.
- `apps/moderator/src/layout/captureKeymap.ts:69-108` — the keymap
  `CaptureKeymapHandlers` interface. **Unchanged by this task.** The
  per-row pickers do NOT register a global keyboard listener (Decision
  §6). The existing global `<ClassificationPalette>`'s listener is
  unmounted via the route's conditional swap (when the F1 palette is
  not rendered, its `useEffect` does not run, so the listener is not
  attached). The editable-target guard at `captureKeymap.ts:177-182`
  also defends typing into the per-row textareas: even if a stray
  global listener were attached, typing `f` into a per-row textarea
  would NOT bounce the global `classification` slice (which is
  irrelevant in decompose mode anyway).
- `packages/shared-types/src/events/proposals.ts:155-172` — the Zod
  schemas the slice shape mirrors. `proposalComponentSchema = z.object({
  wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
  classification: statementKindSchema })` and
  `decomposeProposalSchema.components: z.array(proposalComponentSchema).min(2).max(10)`.
  The slice's per-row text field is the eventual `wording` field on the
  envelope; the slice's per-row `classification` is the eventual
  `classification` field. The 2..10 bounds are mirrored as
  `MINIMUM_DECOMPOSE_COMPONENTS = 2` and `MAXIMUM_DECOMPOSE_COMPONENTS = 10`
  module-local constants in the new components grid (sourced from a
  single named constant; not duplicated). Decision §2 records the
  decision to mirror server bounds at the UI rather than read them
  back via a schema-introspection helper.
- `packages/shared-types/src/limits.ts:51` —
  `MAX_METHODOLOGY_TEXT_LENGTH = 10_000`. Re-used by the per-row text
  input via the same import path as `<CaptureTextInput>`.
- `packages/i18n-catalogs/src/catalogs/en-US.json:285-293` — the existing
  `moderator.decompose.*` namespace this task extends. The new
  sub-namespace `moderator.decompose.components.*` lands at the same
  nesting level as the existing `exit` and `banner` sub-namespaces.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the
  PENDING-flag trackers; 10 new draft entries (5 keys × 2 non-en-US
  locales) get a `pending: true` entry per the established lifecycle.
- `tests/e2e/moderator-capture.spec.ts:1660-1770` — the `mod_decompose_mode`
  e2e (the decompose-mode-entry test block). The new test block joins
  the same file, immediately after this one; reuses the same
  `loginAs` + `seedWsStore` + right-click-the-node template; extends it
  by driving the per-row textareas + clicking the per-row pickers +
  the add-row / remove-row buttons.
- `tests/e2e/fixtures/auth.ts` — `loginAs(page, { username: 'alice' })`.
  Unchanged; reused.
- `playwright.config.ts:247` — the `chromium-create-session` Playwright
  project's `testMatch` already includes
  `tests/e2e/moderator-capture.spec.ts`; no config change is needed.

DESIGN.md / docs consulted:

- `DESIGN.md:37` — design-doc link to `docs/moderator-ui.md` for the F2
  decompose flow specification.
- `docs/moderator-ui.md:52-62` — F2 flow specification. Step 3:
  "**Capture each component** — wording + proposed kind. Add as many as
  needed." This task owns step 3. Step 4 ("Propose the decomposition")
  is `mod_propose_decomposition`'s scope.
- `docs/moderator-ui.md:14` — design intent: "Proposes decompositions
  and interpretive splits." This task is half of decompose's UI.
- `docs/methodology.md:136-155` (cited by `decomposition_logic.md`) —
  "Decomposition is a first-class methodological move, not a fallback."
  The methodology requires at least 2 components for a meaningful
  decomposition; the UI's `MINIMUM_DECOMPOSE_COMPONENTS = 2` bound
  mirrors this.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — `useTranslation()` + ICU interpolation for `{index}` substitution
  in the row-label and remove-aria keys.
- [`mod_decompose_mode.md`](mod_decompose_mode.md) — predecessor; the
  mode-entry seam + the `decomposeTargetNodeId` slice + the
  F1-coupling-clear-on-entry pattern this task extends to also init
  the two empty rows.
- [`mod_capture_text_input.md`](mod_capture_text_input.md) — text-input
  precedent; the controlled-textarea + cap-mirror + defensive-clamp +
  no-auto-focus shape the per-row textarea adopts.
- [`mod_classification_palette.md`](mod_classification_palette.md) —
  classification-picker precedent; the five-button-over-METHODOLOGY_KINDS
  shape + the mnemonic chip + the `aria-pressed` signaling + the
  Tailwind selected/unselected variants the per-row picker adopts.
- [`mod_propose_action.md`](mod_propose_action.md) — propose-flow
  capstone pattern (F1). The validation-error reason union, the
  `canPropose` derived boolean, the `inFlight` post-submit signaling
  are the template the sibling `mod_propose_decomposition` task will
  follow. This task ships **the slice + the validator** it will read;
  this task does NOT ship the button or the round-trip.
- [`mod_state_management.md`](mod_state_management.md) — `useCaptureStore`
  contract.
- [`mod_bottom_strip_capture.md`](mod_bottom_strip_capture.md) — the
  scaffold's slot contract this task consumes unchanged.
- [`decomposition_logic.md`](../data-and-methodology/decomposition_logic.md)
  — the methodology validator for `propose: decompose`. The four
  rules (parent-exists, parent-visible, no-conflict, structural-shape)
  are the contract `mod_propose_decomposition` will validate against;
  **this task is on the UI side of the same contract**, capturing the
  structural-shape inputs the validator's rule 4 (the Zod layer) will
  parse.

No new ADR is required (see Decision §10). No new dependency lands. No
public type signature changes outside `useCaptureStore` (the new slice
+ helpers are additive to `CaptureState`). No cross-workspace contract
changes.

## Constraints / requirements

### Store extension (`apps/moderator/src/stores/captureStore.ts`)

- **New type**: `DecomposeComponent = { text: string; classification: StatementKind | null }`.
  Exported alongside `CaptureMode` for downstream consumers
  (`mod_propose_decomposition` imports it to type the envelope-build
  function).
- **New constants**: `MINIMUM_DECOMPOSE_COMPONENTS = 2` and
  `MAXIMUM_DECOMPOSE_COMPONENTS = 10`. Module-local; not exported (the
  UI consumer reads them via `import` for the disable-add and
  disable-remove gates). The bounds mirror
  `decomposeProposalSchema.components.min(2).max(10)`; Decision §2
  records the mirror-vs-schema-introspect choice.
- **New slice**: `decomposeComponents: ReadonlyArray<DecomposeComponent>`
  added to `CaptureState` immediately after the existing
  `decomposeTargetNodeId: string | null` field. Initial value: `[]`
  (in the `initialCaptureState` literal).
- **Four new setters** on `CaptureState`:
  ```ts
  setDecomposeComponentText: (index: number, text: string) => void;
  setDecomposeComponentClassification: (index: number, classification: StatementKind | null) => void;
  addDecomposeComponent: () => void;
  removeDecomposeComponent: (index: number) => void;
  ```
  Conventional shape. Each helper performs a single `set()` so
  subscribers observe one transition. The setters return `void` (the
  store reads the post-mutation state through its own selector
  subscribers; helpers do not return the new state).
- **`enterDecomposeMode` extension**: the existing helper's single
  `set()` grows by one field: `decomposeComponents: createEmptyDecomposeComponents()`
  where `createEmptyDecomposeComponents()` returns
  `[{ text: '', classification: null }, { text: '', classification: null }]`
  (two empty rows). The helper is a tiny module-local factory; defined
  once, called at every `enterDecomposeMode` entry.
- **`exitDecomposeMode` extension**: the existing helper's single
  `set()` grows by one field: `decomposeComponents: []`.
- **`reset()` invariant** rides for free via the spread of
  `initialCaptureState`; the new field's initial value (`[]`) is
  included in the spread.
- **Pick literal change**: `initialCaptureState`'s `Pick<...>` type
  union grows by one key: `'decomposeComponents'`. The literal value
  gains `decomposeComponents: []`.

### Setter implementations (immutability discipline)

- All four mutators produce a **new array** via `Array.prototype.map`
  (text/classification setters) or `Array.prototype.concat` (add) or
  `Array.prototype.filter` (remove). The slice is typed as
  `ReadonlyArray` so accidental in-place mutation is a TS error.
- `setDecomposeComponentText(index, text)`:
  ```ts
  set((state) => ({
    decomposeComponents: state.decomposeComponents.map((c, i) =>
      i === index
        ? { ...c, text: text.length > MAX_METHODOLOGY_TEXT_LENGTH
            ? text.slice(0, MAX_METHODOLOGY_TEXT_LENGTH)
            : text }
        : c,
    ),
  }));
  ```
  Defensive clamp mirrors the F1 textarea's behaviour.
- `setDecomposeComponentClassification(index, classification)`:
  same map pattern, replaces `classification` only.
- `addDecomposeComponent()`:
  ```ts
  set((state) =>
    state.decomposeComponents.length >= MAXIMUM_DECOMPOSE_COMPONENTS
      ? state
      : {
          decomposeComponents: [
            ...state.decomposeComponents,
            { text: '', classification: null },
          ],
        },
  );
  ```
  No-op when at the maximum (the consumer disables the button, but the
  store defends the invariant against direct calls).
- `removeDecomposeComponent(index)`:
  ```ts
  set((state) =>
    state.decomposeComponents.length <= MINIMUM_DECOMPOSE_COMPONENTS
      ? state
      : {
          decomposeComponents: state.decomposeComponents.filter((_, i) => i !== index),
        },
  );
  ```
  No-op when at the minimum (the consumer disables the per-row remove
  buttons, but the store defends the invariant).

### Validator export (`apps/moderator/src/stores/captureStore.ts`)

- **New free function** `validateDecomposeComponents(components: ReadonlyArray<DecomposeComponent>): boolean`:
  ```ts
  export function validateDecomposeComponents(
    components: ReadonlyArray<DecomposeComponent>,
  ): boolean {
    if (components.length < MINIMUM_DECOMPOSE_COMPONENTS) return false;
    if (components.length > MAXIMUM_DECOMPOSE_COMPONENTS) return false;
    return components.every(
      (c) => c.text.trim().length > 0 && c.classification !== null,
    );
  }
  ```
  Exported from the captureStore module. `mod_propose_decomposition`
  (sibling) imports it to gate the propose button. The store does NOT
  expose a memoized selector wrapper; consumers call the function on
  the slice they read. Memoization is a follow-up if Devtools profiling
  reveals re-render churn (Decision §7).

### `<DecomposeComponentsGrid>` component (`apps/moderator/src/layout/DecomposeComponentsGrid.tsx`)

- **New file** exporting `function DecomposeComponentsGrid(): ReactElement | null`
  (named export, no default).
- **Store reads** (selectors only, not the full store):
  - `const mode = useCaptureStore((s) => s.mode);`
  - `const componentsLength = useCaptureStore((s) => s.decomposeComponents.length);`
  - `const addDecomposeComponent = useCaptureStore((s) => s.addDecomposeComponent);`
  - `const removeDecomposeComponent = useCaptureStore((s) => s.removeDecomposeComponent);`
  Per-row reads happen inside `<DecomposeComponentRow>`.
- **Visibility gate**: return `null` when `mode !== 'decompose'`. The
  grid mounts only in decompose mode.
- **Render shape**:
  ```tsx
  <div
    data-testid="decompose-components-grid"
    role="group"
    aria-label={t('moderator.decompose.components.classificationLegend')}
    className="flex w-full flex-col gap-2"
  >
    {Array.from({ length: componentsLength }, (_, index) => (
      <DecomposeComponentRow
        key={index}
        index={index}
        canRemove={componentsLength > MINIMUM_DECOMPOSE_COMPONENTS}
        onRemove={() => removeDecomposeComponent(index)}
      />
    ))}
    <button
      type="button"
      data-testid="decompose-components-add-row"
      onClick={addDecomposeComponent}
      disabled={componentsLength >= MAXIMUM_DECOMPOSE_COMPONENTS}
      className="self-start inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      + {t('moderator.decompose.components.addRow')}
    </button>
  </div>
  ```
- **The `key={index}` choice** matches the slice's stable per-index
  identity (the rows are not reorderable in v1); a row-id-based key
  would buy nothing and force an id-mint at add-row time. If row
  reordering lands in a follow-up, the key strategy migrates with it.

### `<DecomposeComponentRow>` component (`apps/moderator/src/layout/DecomposeComponentRow.tsx`)

- **New file** exporting `function DecomposeComponentRow(props: DecomposeComponentRowProps): ReactElement`
  (named export). `props` shape:
  ```ts
  export interface DecomposeComponentRowProps {
    index: number;
    canRemove: boolean;
    onRemove: () => void;
  }
  ```
- **Render shape**:
  ```tsx
  <div
    data-testid={`decompose-component-row-${index}`}
    className="flex w-full items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1"
  >
    <span
      data-testid={`decompose-component-row-label-${index}`}
      className="mt-1 inline-flex h-5 min-w-[5rem] items-center text-xs font-medium text-slate-700"
    >
      {t('moderator.decompose.components.rowLabel', { index: index + 1 })}
    </span>
    <div className="flex flex-1 flex-col gap-1">
      <DecomposeComponentTextInput index={index} />
      <DecomposeComponentClassificationPicker index={index} />
    </div>
    <button
      type="button"
      data-testid={`decompose-component-row-remove-${index}`}
      onClick={onRemove}
      disabled={!canRemove}
      aria-label={t('moderator.decompose.components.removeRowAria', { index: index + 1 })}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      ×
    </button>
  </div>
  ```
- The row is **presentation-only**: it composes the text input + the
  picker + the remove button. The text input and the picker read /
  write the per-row slice through their own per-index selectors; the
  remove button calls the supplied `onRemove`. No store reads at this
  level beyond the row's own composition.

### `<DecomposeComponentTextInput>` component (`apps/moderator/src/layout/DecomposeComponentTextInput.tsx`)

- **New file** exporting
  `function DecomposeComponentTextInput(props: DecomposeComponentTextInputProps): ReactElement`.
  `props`: `{ index: number }`.
- **Store reads/writes**:
  - `const text = useCaptureStore((s) => s.decomposeComponents[props.index]?.text ?? '');`
    The `?? ''` guard defends against the (transient) out-of-bounds
    read between a row-removal `set()` and the consumer's re-render
    pass.
  - `const setDecomposeComponentText = useCaptureStore((s) => s.setDecomposeComponentText);`
- **Textarea shape** mirrors `<CaptureTextInput>` with these variations:
  - `rows={1}` (compact baseline);
  - `MAX_HEIGHT_PX = 72` (≈ 3 lines) module-local;
  - `id={\`decompose-component-text-\${index}\`}` for `htmlFor`
    targeting (no visible `<label>` — the row's
    `decompose-component-row-label-${index}` carries the visible label;
    the textarea's `aria-label` carries the full screen-reader
    description, see below);
  - `data-testid={\`decompose-component-text-${index}\`}`;
  - `value={text}`, `onChange={(e) => setDecomposeComponentText(index, e.target.value)}`;
  - `onKeyDown` handler is **NOT** installed (per Decision §6, the
    per-row textareas do not fire any submit gesture in v1; plain
    Enter and Cmd/Ctrl+Enter both insert newlines natively);
  - `maxLength={MAX_METHODOLOGY_TEXT_LENGTH}`;
  - `aria-label={t('moderator.decompose.components.rowLabel', { index: index + 1 })}` —
    the row-label key doubles as the textarea's accessible name (the
    visible row-label span is also `aria-hidden`-friendly because the
    aria-label carries the same string; this avoids redundant
    announcement of the row label);
  - `placeholder={t('moderator.decompose.components.textPlaceholder')}`;
  - `spellCheck`, `autoComplete="off"`, `inputMode="text"` same as F1.
- **Auto-grow**: same `useLayoutEffect` pattern as `<CaptureTextInput>`,
  clamped at the smaller `MAX_HEIGHT_PX`.
- **Defensive clamp**: per-row store helper already enforces the cap
  (`setDecomposeComponentText`'s implementation slices to `MAX`); the
  textarea's `onChange` simply calls `setDecomposeComponentText(index,
  e.target.value)` without re-implementing the clamp. The store is the
  invariant-holder.
- **No helper line** (`{used}/{max} characters`) — the per-row context
  is too dense; the cap surfaces only via the native `maxLength`
  truncation. Decision §5 records the no-helper choice.

### `<DecomposeComponentClassificationPicker>` component (`apps/moderator/src/layout/DecomposeComponentClassificationPicker.tsx`)

- **New file** exporting
  `function DecomposeComponentClassificationPicker(props: DecomposeComponentClassificationPickerProps): ReactElement`.
  `props`: `{ index: number }`.
- **Store reads/writes**:
  - `const classification = useCaptureStore((s) => s.decomposeComponents[props.index]?.classification ?? null);`
  - `const setDecomposeComponentClassification = useCaptureStore((s) => s.setDecomposeComponentClassification);`
- **Render shape** mirrors `<ClassificationPalette>` minus the
  `attachCaptureKeymap` `useEffect` (no keyboard listener; per Decision
  §6) and minus the shortcut-hint helper line (the row context is
  dense; the chips on each button suffice):
  ```tsx
  <div
    role="group"
    aria-label={t('moderator.decompose.components.classificationLegend')}
    data-testid={`decompose-component-classification-${index}`}
    className="flex flex-wrap items-center gap-1"
  >
    {METHODOLOGY_KINDS.map((kind) => {
      const isSelected = classification === kind;
      const shortcutKeyUpper = KIND_TO_SHORTCUT[kind].toUpperCase();
      const label = t(`methodology.kind.${kind}`);
      return (
        <button
          key={kind}
          type="button"
          data-testid={`decompose-component-classification-${index}-button-${kind}`}
          data-kind={kind}
          aria-pressed={isSelected}
          onClick={() =>
            setDecomposeComponentClassification(
              index,
              isSelected ? null : kind,
            )
          }
          className={isSelected ? SELECTED_CLASSES : UNSELECTED_CLASSES}
        >
          <span>{label}</span>
          <kbd aria-hidden="true" className={KEY_CHIP_CLASSES}>
            {shortcutKeyUpper}
          </kbd>
        </button>
      );
    })}
  </div>
  ```
- Re-click on the currently-selected kind toggles off (calls
  `setDecomposeComponentClassification(index, null)`) — same idiom as
  the F1 palette's Decision §4.
- The selected / unselected / key-chip Tailwind class constants are
  **duplicated module-locally** rather than shared via an extracted
  module. Decision §4 records why: the F1 palette's classes are tightly
  coupled to its component layout (the `inline-flex items-center gap-1`
  + the chip placement); extracting them into a shared module would
  add an indirection without a third caller. If the interpretive-split
  picker becomes the third caller, the extraction lands then.

### Route-level conditional swap (`apps/moderator/src/routes/Operate.tsx`)

- **Add a store read** inside `<OperateRouteInner>`:
  ```ts
  const mode = useCaptureStore((s) => s.mode);
  ```
- **Conditional slot props** on `<BottomStripCapture>`:
  ```tsx
  <BottomStripCapture
    modeBanner={
      <>
        <ModeBanner />
        <DecomposeModeExitButton />
      </>
    }
    textInput={
      mode === 'decompose' ? (
        <DecomposeComponentsGrid />
      ) : (
        <CaptureTextInput onSubmit={() => { void propose(); }} />
      )
    }
    classificationPalette={mode === 'decompose' ? null : <ClassificationPalette />}
    edgeRoleSelector={mode === 'decompose' ? null : <CaptureTargetAndRole />}
    proposeAction={<ProposeAction />}
  />
  ```
  When `mode === 'decompose'`, the grid occupies the `textInput` slot
  and the other two body slots collapse to `null` (the scaffold's
  placeholder `<span aria-hidden="true">[classification]</span>` /
  `[edge role]` would only render when the slot is `undefined`; the
  explicit `null` keeps the slots empty without falling through to the
  placeholder). The `proposeAction` slot is unchanged in this task; the
  sibling `mod_propose_decomposition` will install its own conditional
  swap to show the decomposition-propose button in decompose mode.
- **Why the grid occupies the `textInput` slot and not its own slot**:
  the bottom strip's flex-1 cell for the text input is the visually
  dominant region of the strip — the natural home for an N-row grid.
  The classification and edge-role slots are smaller fixed-width cells
  that would awkwardly compete with a wide grid; collapsing them to
  `null` lets the grid stretch across the strip's body width. Decision
  §3 documents the trade-off vs. a new scaffold slot.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.decompose.components.rowLabel` | "Component {index}" | "Componente {index}" | "Componente {index}" |
| `moderator.decompose.components.textPlaceholder` | "Component wording…" | "Texto do componente…" | "Texto del componente…" |
| `moderator.decompose.components.classificationLegend` | "Component kind" | "Tipo do componente" | "Tipo del componente" |
| `moderator.decompose.components.addRow` | "Add component" | "Adicionar componente" | "Añadir componente" |
| `moderator.decompose.components.removeRowAria` | "Remove component {index}" | "Remover componente {index}" | "Eliminar componente {index}" |

**Count: 5 keys × 3 locales = 15 catalog entries.** pt-BR / es-419
drafts land flagged PENDING in `pt-BR.review.json` + `es-419.review.json`
(10 entries total). Native-speaker review registered as a tech-debt
follow-up (see Acceptance criteria / Decisions).

The new keys live under the existing `moderator.decompose.*`
top-level namespace within `moderator.*`, alongside the existing
`exit.*` and `banner.*` sub-namespaces shipped by `mod_decompose_mode`.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/stores/captureStore.ts` (modified — new
  `DecomposeComponent` type, new slice, two new constants, four new
  helpers, extension of `enterDecomposeMode` + `exitDecomposeMode`,
  new exported `validateDecomposeComponents` function).
- `apps/moderator/src/stores/captureStore.test.ts` (modified — new
  cases for the slice + the helpers + the two-row init on entry + the
  clear-back on exit + the reset invariant + the validator's truth
  table).
- `apps/moderator/src/layout/DecomposeComponentsGrid.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentsGrid.test.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentRow.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentRow.test.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentTextInput.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentTextInput.test.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentClassificationPicker.tsx` (new).
- `apps/moderator/src/layout/DecomposeComponentClassificationPicker.test.tsx` (new).
- `apps/moderator/src/routes/Operate.tsx` (modified — add `mode`
  read, three conditional ternaries on the slot props; update the
  leading Refinement comment to reference `mod_multi_component_capture.md`
  alongside the existing refinements).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 5 new
  keys under `moderator.decompose.components.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 5 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — new `test()` block
  under the existing `test.describe('moderator capture flow', ...)`
  group, immediately after the `mod_decompose_mode` block).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_multi_component_capture` lands
  at task-completion time per the README ritual, not at refinement-write
  time. The Closer also adds the new
  `i18n_multi_component_capture_native_review` task to
  `tasks/35-frontend-i18n.tji`.
- `docs/adr/` — no new ADR (Decision §10).
- `apps/server/src/` — no server-side change. The propose-side
  validator (`decomposition_logic`'s arm in `propose.ts`) is already
  in place and is exercised by `mod_propose_decomposition` (sibling
  task), not this one.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — the scaffold's
  slot contract is unchanged. The route-level conditional swap is what
  changes the slot's content.
- `apps/moderator/src/layout/CaptureTextInput.tsx` — F1 textarea
  unchanged; its `onSubmit` callback is unchanged. Mounted only when
  `mode !== 'decompose'` per the route's conditional.
- `apps/moderator/src/layout/ClassificationPalette.tsx` — F1 palette
  unchanged. Mounted only when `mode !== 'decompose'`; when unmounted,
  its `attachCaptureKeymap` `useEffect` cleanup runs and the global
  letter-key listener is detached (so typing `f` into a per-row
  decompose textarea cannot accidentally bounce a hidden F1 slice).
- `apps/moderator/src/layout/captureKeymap.ts` — the keymap is
  unchanged. The per-row pickers are click-only in v1 (Decision §6).
- `apps/moderator/src/layout/DecomposeModeExitButton.tsx` — the exit
  affordance is unchanged. The Escape keymap routing (mode-aware:
  decompose mode prioritizes `onExitMode`) is unchanged.
- `apps/moderator/src/layout/ProposeAction.tsx` — unchanged. The
  decomposition-propose button is `mod_propose_decomposition`'s scope
  and will install its own conditional swap on `mode` at the route.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — unchanged. The
  node context-menu wiring (the `propose-decompose` item) is
  unchanged.
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — no new shortcut
  entry (per Decision §6, the per-row pickers do not register
  shortcuts).
- `playwright.config.ts` — the spec extension joins the existing
  `tests/e2e/moderator-capture.spec.ts` which already runs under the
  `chromium-create-session` project.

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 24 across the five touched / new
  test files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity
  check) green after the catalog edits — every
  `moderator.decompose.components.*` key present in en-US is present
  in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds (four new small
  components; one extended store; bundle impact small).
- `pnpm exec playwright test` green against a freshly brought-up dev
  compose stack; the new multi-component capture e2e scenario passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_multi_component_capture` AND the
  new `i18n_multi_component_capture_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The multi-component capture grid is reachable from a real user flow as
of this task: the moderator can log in, navigate to
`/sessions/new`, create a session, bridge the lobby gate, land on
`/sessions/<id>/operate`, seed a node into the WS store via the
existing `__aConversaWsStore` seam (same template as the
`mod_decompose_mode` e2e at lines 1660-1770 of
`tests/e2e/moderator-capture.spec.ts`), right-click the seeded node,
click "Propose decompose" to enter mode, and then see the
multi-component grid mount inside the bottom-strip text-input slot
with two empty rows. Per the UI-stream e2e policy default, the
Playwright spec is **scoped under Acceptance criteria, NOT deferred**.

**Important caveat**: `mod_propose_decomposition` has not landed, so the
captured components cannot yet be submitted as a `propose: decompose`
envelope. The e2e therefore asserts only the **capture-state chain**:
two empty rows initialize on entry; the moderator can type into the
per-row textareas + click the per-row pickers + click add-row /
remove-row; Esc clears the state. The chain-completing e2e (capture →
propose → event lands → graph updates) is scoped to
`mod_propose_decomposition`'s refinement, not this one.

## Acceptance criteria

### 1. Store slice + helpers

- `useCaptureStore`'s `CaptureState` interface carries
  `decomposeComponents: ReadonlyArray<DecomposeComponent>` plus the
  four new setters:
  `setDecomposeComponentText`, `setDecomposeComponentClassification`,
  `addDecomposeComponent`, `removeDecomposeComponent`.
- `initialCaptureState`'s value carries `decomposeComponents: []`; the
  `Pick<CaptureState, ...>` type union includes `'decomposeComponents'`.
- `useCaptureStore.getState().enterDecomposeMode('<nodeId>')` results
  in `state.decomposeComponents.length === 2` AND
  `state.decomposeComponents[0]` and `state.decomposeComponents[1]`
  each deep-equal `{ text: '', classification: null }`. The single
  `set()` invariant from `mod_decompose_mode` is preserved.
- `useCaptureStore.getState().exitDecomposeMode()` results in
  `state.decomposeComponents.length === 0`.
- `useCaptureStore.getState().reset()` results in
  `state.decomposeComponents.length === 0`.
- `setDecomposeComponentText(0, 'hello')` results in
  `state.decomposeComponents[0].text === 'hello'`; the other rows are
  unchanged (the helper returns a new array via `map`; the in-memory
  reference of `state.decomposeComponents[1]` deep-equals its
  prior value).
- `setDecomposeComponentText(0, 'x'.repeat(10_001))` results in
  `state.decomposeComponents[0].text.length === 10_000` (defensive
  clamp).
- `setDecomposeComponentClassification(1, 'fact')` results in
  `state.decomposeComponents[1].classification === 'fact'`.
- `addDecomposeComponent()` starting from `length === 2` results in
  `length === 3` with the new row at index 2 deep-equal to
  `{ text: '', classification: null }`.
- `addDecomposeComponent()` starting from `length === 10` results in
  `length === 10` (no-op; the consumer disables the button but the
  store defends the invariant).
- `removeDecomposeComponent(1)` starting from `length === 3` results
  in `length === 2`; the row at index 1 is now what was at index 2
  before the call.
- `removeDecomposeComponent(0)` starting from `length === 2` results
  in `length === 2` (no-op; the minimum bound).

### 2. Validator export

- `validateDecomposeComponents([])` → `false`.
- `validateDecomposeComponents([{ text: 'a', classification: 'fact' }])` →
  `false` (below minimum).
- `validateDecomposeComponents([{ text: 'a', classification: 'fact' }, { text: 'b', classification: 'value' }])` →
  `true`.
- `validateDecomposeComponents` with an 11-element array → `false`
  (above maximum).
- `validateDecomposeComponents` with one row whose `text === '   '`
  (only whitespace) → `false` (trim check).
- `validateDecomposeComponents` with one row whose `classification === null` →
  `false`.

### 3. Grid render gating

- `<DecomposeComponentsGrid>` renders `null` when
  `useCaptureStore((s) => s.mode) !== 'decompose'`. The DOM contains
  no `decompose-components-grid` element in this state.
- `<DecomposeComponentsGrid>` renders the grid with the
  `decompose-components-grid` `data-testid` when
  `mode === 'decompose'`. Initial mount (after `enterDecomposeMode`)
  renders exactly two `<DecomposeComponentRow>` children with indices
  0 and 1.
- The grid renders an "Add component" button with the
  `decompose-components-add-row` testid below the rows.
- Clicking "Add component" appends one row (the grid renders a third
  child with `index === 2`).
- Clicking "Add component" 9 times starting from 2 rows results in 10
  rows and the button is `disabled`.
- Each row's remove button has the testid
  `decompose-component-row-remove-${index}`; rows in a 2-row grid
  have their remove buttons disabled; in a 3+ row grid, all remove
  buttons are enabled.
- Clicking a per-row remove button on row index 1 of a 3-row grid
  results in 2 rows; the row formerly at index 2 is now at index 1.

### 4. Per-row text input

- `<DecomposeComponentTextInput index={0}>` renders a `<textarea>` with
  `data-testid="decompose-component-text-0"`.
- Initial `value` is `''` (per the slice's empty-row initial state).
- Typing 'foo' into the textarea calls `setDecomposeComponentText(0, 'foo')`
  and the textarea re-renders with `value === 'foo'`.
- A programmatic `setDecomposeComponentText(0, 'bar')` re-renders the
  textarea with `value === 'bar'`.
- The textarea's `maxLength` attribute equals
  `MAX_METHODOLOGY_TEXT_LENGTH` (10_000).
- The textarea's `placeholder` resolves to the catalog-correct string
  for en-US (`"Component wording…"`).
- The textarea's `aria-label` resolves to
  `"Component 1"` for `index === 0` and `"Component 2"` for
  `index === 1` (1-indexed surface; 0-indexed slice).
- Plain Enter inserts a newline; Cmd/Ctrl+Enter inserts a newline
  (NOT a submit gesture — Decision §6).

### 5. Per-row classification picker

- `<DecomposeComponentClassificationPicker index={0}>` renders five
  buttons, one per `METHODOLOGY_KINDS` value, each with the testid
  `decompose-component-classification-0-button-<kind>`.
- Initial `aria-pressed` is `false` on every button (the slice's
  initial `classification === null`).
- Clicking the `fact` button calls
  `setDecomposeComponentClassification(0, 'fact')`; the button's
  `aria-pressed` becomes `true`; the other four buttons stay
  `aria-pressed="false"`.
- Re-clicking the same `fact` button calls
  `setDecomposeComponentClassification(0, null)` (toggle-off idiom from
  the F1 palette).
- Clicking a different button after `fact` is selected calls
  `setDecomposeComponentClassification(0, '<other-kind>')`; the
  previously-selected button's `aria-pressed` flips to `false`; the
  new button's flips to `true` (single-select).
- The visible localized label on each button matches
  `methodology.kind.<kind>` per the active locale.

### 6. Per-row binding isolation

- `setDecomposeComponentText(0, 'first')` followed by
  `setDecomposeComponentText(1, 'second')` results in
  `state.decomposeComponents[0].text === 'first'` AND
  `state.decomposeComponents[1].text === 'second'`. The two rows do
  not bleed into each other.
- Mounting two `<DecomposeComponentRow>` instances (indices 0 and 1)
  and typing into row-0's textarea does NOT update row-1's textarea's
  rendered `value`.

### 7. Route-level conditional swap

- `<OperateRouteInner>` reads `useCaptureStore((s) => s.mode)`.
- When `mode === 'idle'`, the bottom strip's `textInput` slot renders
  `<CaptureTextInput>`, the `classificationPalette` slot renders
  `<ClassificationPalette>`, the `edgeRoleSelector` slot renders
  `<CaptureTargetAndRole>` (the existing F1 components).
- When `mode === 'decompose'`, the bottom strip's `textInput` slot
  renders `<DecomposeComponentsGrid>`, the `classificationPalette`
  slot is empty (`null`), the `edgeRoleSelector` slot is empty
  (`null`). The F1 components are unmounted; their `useEffect`
  cleanups run (in particular, `<ClassificationPalette>`'s
  `attachCaptureKeymap` cleanup detaches the global letter-key
  listener so typing `f` into a per-row textarea cannot bounce a
  hidden F1 slice).
- The `proposeAction` slot stays mounted in both modes (unchanged in
  this task; `mod_propose_decomposition` will install its own
  conditional swap).

### 8. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains
  `moderator.decompose.components.{rowLabel, textPlaceholder, classificationLegend, addRow, removeRowAria}`
  with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` gain the same 5 keys with the drafts.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` gain `pending: true` entries for each of the 5
  keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after the
  edits.

### 9. Vitest cases (per ADR 0022)

Minimum **24 new cases** across five files (the exact distribution
below is the floor; the implementer may add cases as the implementation
suggests them):

**`apps/moderator/src/stores/captureStore.test.ts`** (≥ 12 new cases):

1. `decomposeComponents` is `[]` in the initial state.
2. `enterDecomposeMode('n1')` seeds `decomposeComponents` to two
   empty rows.
3. `enterDecomposeMode('n1')` uses a single `set()` — subscribe to
   the store, count subscriber notifications, assert exactly one
   transition per call.
4. `exitDecomposeMode()` clears `decomposeComponents` to `[]`.
5. `reset()` clears `decomposeComponents` to `[]`.
6. `setDecomposeComponentText(0, 'hello')` writes to row 0; row 1
   unchanged.
7. `setDecomposeComponentText(0, 'x'.repeat(10_001))` clamps to
   `length === 10_000`.
8. `setDecomposeComponentClassification(1, 'fact')` writes to row 1.
9. `addDecomposeComponent()` appends one empty row; result is `[…, {
   text: '', classification: null }]`.
10. `addDecomposeComponent()` at `length === 10` is a no-op.
11. `removeDecomposeComponent(1)` from a 3-row grid removes the
    indexed row; the row formerly at index 2 is now at index 1.
12. `removeDecomposeComponent(0)` from a 2-row grid is a no-op.
13. `validateDecomposeComponents` truth table — covers the 6 cases in
    Acceptance §2.

**`apps/moderator/src/layout/DecomposeComponentsGrid.test.tsx`** (≥ 5
new cases):

14. Renders `null` when `mode === 'idle'`.
15. Renders 2 rows on initial mount in decompose mode (after
    `enterDecomposeMode`).
16. Clicking "Add component" adds a row.
17. "Add component" button is disabled at 10 rows.
18. Per-row remove buttons are disabled at 2 rows; enabled at 3+
    rows.

**`apps/moderator/src/layout/DecomposeComponentRow.test.tsx`** (≥ 3 new
cases):

19. Renders the row label resolved to `"Component 1"` for `index ===
    0` in en-US.
20. Renders the text input + the picker + the remove button as
    children.
21. Clicking the remove button calls the supplied `onRemove` prop.

**`apps/moderator/src/layout/DecomposeComponentTextInput.test.tsx`**
(≥ 2 new cases):

22. Typing into the textarea calls `setDecomposeComponentText(index,
    value)`.
23. The textarea's `maxLength` is `MAX_METHODOLOGY_TEXT_LENGTH`.

**`apps/moderator/src/layout/DecomposeComponentClassificationPicker.test.tsx`**
(≥ 2 new cases):

24. Clicking a kind button calls
    `setDecomposeComponentClassification(index, kind)`.
25. Re-clicking the selected kind calls
    `setDecomposeComponentClassification(index, null)` (toggle-off).

Optional 26th: **per-locale parity round-trip** — render the grid
with each of the three v1 locales; assert each `data-testid` element
resolves to a non-key string.

### 10. Playwright e2e (new `test()` block in `moderator-capture.spec.ts`)

Extending the existing `test.describe('moderator capture flow', ...)`
group immediately after the `mod_decompose_mode` block:

```ts
test('alice: enter decompose mode → multi-component grid captures 2 rows → add row → remove row → Esc clears state', async ({
  page,
}) => {
  await loginAs(page, { username: TEST_USERNAME });
  await page.goto('/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();

  await page
    .getByTestId('create-session-topic-input')
    .fill('Multi-component capture e2e regression check.');
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
  await seedInviteParticipantsForGate(page);
  await page.getByTestId('invite-enter-session').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();

  if (!(await isWsStoreReachable(page))) {
    test.skip(
      true,
      'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire.',
    );
    return;
  }

  const url = new URL(page.url());
  const sessionId = url.pathname.split('/')[2] ?? '';

  // Seed a parent node.
  const SEED_NODE_ID = '88888888-8888-4888-8888-888888888899';
  const SEED_WORDING = 'Workers should earn a living wage with fair benefits.';
  await seedWsStore(page, {
    sessionId,
    nodes: [{ nodeId: SEED_NODE_ID, wording: SEED_WORDING }],
  });

  const nodeCard = page.getByTestId(`statement-node-${SEED_NODE_ID}`);
  await expect(nodeCard).toBeVisible({ timeout: 10_000 });

  // Enter decompose mode via the context menu.
  await nodeCard.click({ button: 'right' });
  await page.getByTestId('graph-context-menu-item-propose-decompose').click();
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'decompose');

  // The grid is mounted with two empty rows.
  await expect(page.getByTestId('decompose-components-grid')).toBeVisible();
  await expect(page.getByTestId('decompose-component-row-0')).toBeVisible();
  await expect(page.getByTestId('decompose-component-row-1')).toBeVisible();
  await expect(page.getByTestId('decompose-component-row-2')).toHaveCount(0);

  // The F1 palette + edge-role slots are empty (collapsed to null by
  // the route's conditional swap).
  await expect(page.getByTestId('classification-palette')).toHaveCount(0);

  // Per-row remove buttons are disabled at the minimum 2 rows.
  await expect(page.getByTestId('decompose-component-row-remove-0')).toBeDisabled();
  await expect(page.getByTestId('decompose-component-row-remove-1')).toBeDisabled();

  // Type into component 1 + pick its kind.
  await page.getByTestId('decompose-component-text-0').fill('Workers should earn a living wage.');
  await page.getByTestId('decompose-component-classification-0-button-value').click();
  await expect(page.getByTestId('decompose-component-classification-0-button-value'))
    .toHaveAttribute('aria-pressed', 'true');

  // Add a third row.
  await page.getByTestId('decompose-components-add-row').click();
  await expect(page.getByTestId('decompose-component-row-2')).toBeVisible();

  // Now the per-row remove buttons are enabled.
  await expect(page.getByTestId('decompose-component-row-remove-0')).toBeEnabled();
  await expect(page.getByTestId('decompose-component-row-remove-2')).toBeEnabled();

  // Type into component 2 + pick its kind.
  await page.getByTestId('decompose-component-text-1').fill('Workers should receive fair benefits.');
  await page.getByTestId('decompose-component-classification-1-button-normative').click();

  // Remove the empty third row.
  await page.getByTestId('decompose-component-row-remove-2').click();
  await expect(page.getByTestId('decompose-component-row-2')).toHaveCount(0);

  // Press Escape — the mode-aware keymap clears all decompose state.
  await page.locator('body').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');
  await expect(page.getByTestId('decompose-components-grid')).toHaveCount(0);

  // The F1 capture surface is back.
  await expect(page.getByTestId('capture-text-input-textarea')).toBeVisible();
});
```

The test asserts the **capture-state chain** only — per the
"Constraints / requirements → UI-stream e2e scoping" caveat, the
propose-decomposition envelope has not landed yet, so the test does
NOT attempt to submit the captured components. The sibling task's
refinement owns that assertion.

### 11. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_multi_component_capture` block
  gets `complete 100` after the `allocate team` line plus a `note
  "Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_multi_component_capture_native_review` is added with the
  template below (effort 0.5d;
  `depends !i18n_decompose_mode_native_review` — the current tail of
  the native-review chain).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_multi_component_capture_native_review "Native-speaker review of pt-BR + es-419 multi-component-capture strings (5 keys under moderator.decompose.components.*)" {
  effort 0.5d
  allocate team
  depends !i18n_decompose_mode_native_review
  note "Source of debt: mod_multi_component_capture (this commit) — pt-BR and es-419 drafts of the 5 new keys under moderator.decompose.components.* (rowLabel, textPlaceholder, classificationLegend, addRow, removeRowAria) landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs native-speaker review). The rowLabel and removeRowAria strings carry the ICU {index} substitution — review the localized form's grammatical fit when the substituted index is a numeral."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 12. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Per-row mutator-set vs. one generic `setDecomposeComponents(next)` setter

Two alternatives surveyed:

- **Four per-row helpers**
  (`setDecomposeComponentText`, `setDecomposeComponentClassification`,
  `addDecomposeComponent`, `removeDecomposeComponent`) — *chosen*. Each
  helper is a one-line mutation closed over the row index; the consumer
  cannot accidentally clobber unrelated rows; the store enforces the
  array bounds (no-op above max-add, no-op below min-remove). The
  signature reads at the call site as a domain operation
  (`addDecomposeComponent()`) rather than a wholesale-replace
  (`setDecomposeComponents([...prev, { text: '', classification: null }])`).
- **One generic `setDecomposeComponents(next: ReadonlyArray<DecomposeComponent>)`** —
  *rejected*. Forces every consumer to compute the next array from the
  previous, re-implementing the per-row map / append / filter. Loses
  the store-side bounds enforcement (the consumer can pass any array
  shape; the propose-time validator would catch the violation but the
  invariant slips through the UI layer). The per-row helpers compose
  better with React's selector pattern: a row component subscribes to
  one slice index and one setter, not to the whole array.

The four-helper shape is the same idiom `useCaptureStore` already uses
for the F1 slices (one setter per slice); extending it per-row keeps
the store's API discoverable.

### 2. Mirror Zod bounds at the UI vs. read them via schema introspection

Surveyed:

- **Module-local constants `MINIMUM_DECOMPOSE_COMPONENTS = 2` and
  `MAXIMUM_DECOMPOSE_COMPONENTS = 10`** — *chosen*. The constants are
  the same numbers as
  `decomposeProposalSchema.components.min(2).max(10)` at
  `packages/shared-types/src/events/proposals.ts:171`. The mirror
  duplicates the literal but eliminates a runtime dependency on Zod
  introspection (which would require importing `_def.minLength` /
  `_def.maxLength` internals; Zod's introspection API is not part of
  its stable contract).
- **Read via schema introspection** — *rejected*. Zod's internal
  `_def` access is undocumented and may change between Zod versions
  without a SemVer signal. The bounds are stable methodology numbers
  (R27 — 2..10); the duplication cost is negligible.
- **Re-export from `@a-conversa/shared-types`** — *considered*. Could
  add `MIN_DECOMPOSE_COMPONENTS = 2` and `MAX_DECOMPOSE_COMPONENTS = 10`
  as named exports alongside `MAX_METHODOLOGY_TEXT_LENGTH` in
  `packages/shared-types/src/limits.ts`, then have the Zod schema use
  them and the UI import them. *Deferred*; the right time to introduce
  the shared constant is when the interpretive-split task lands its
  own 2..10 bounds (`interpretiveSplitProposalSchema.readings.min(2).max(10)`
  at line 185). When that task lands, the constants graduate to
  `@a-conversa/shared-types` and both Zod + both UI layers import the
  same name; for this task, the module-local constants are the
  minimum-churn shape.

### 3. Slot reuse vs. new scaffold slot

Three alternatives surveyed:

- **Reuse the existing `textInput` slot for the grid; collapse the
  `classificationPalette` and `edgeRoleSelector` slots to `null` in
  decompose mode** — *chosen*. The bottom strip's flex-1 cell for the
  text input is the visually dominant region; a multi-row grid wants
  width. Collapsing the smaller fixed-width cells lets the grid
  stretch. The scaffold's slot contract is unchanged. The conditional
  swap lives at the route (one site), not at the scaffold (which
  stays mode-unaware per its design comment at
  `BottomStripCapture.tsx:1-95`).
- **New scaffold slot `decomposeComponents`** — *rejected*. Adding a
  slot per mode-flow would proliferate the scaffold's surface for
  every future mode (interpretive-split, defeater capture,
  operationalization). The slot vocabulary stays minimal; the mode
  flips swap content inside existing slots.
- **Inline the grid + the F1 components in a parent wrapper component
  that does the mode-gating** — *rejected*. The wrapper would have
  no name beyond "container that picks F1 vs. decompose"; the route
  is the natural site for the conditional (it already reads the
  store, mounts the providers, and threads the session id; one more
  selector + three ternaries is in line with its existing role).

The chosen pattern matches the mode-aware split-rendering precedent
the `<DecomposeModeExitButton>` already established (visibility gated
on `mode === 'decompose'`, returns `null` otherwise); this task
extends the pattern from "one extra widget alongside the banner" to
"one widget replaces three widgets in the body."

### 4. Per-row classification picker: extract a new component vs. share `<ClassificationPalette>` vs. inline the markup

Three alternatives surveyed:

- **New sibling component
  `<DecomposeComponentClassificationPicker index={i}>` that mirrors
  `<ClassificationPalette>`'s shape but binds to a per-row slice** —
  *chosen*. The existing palette is bound to the global
  `classification` slice through `useCaptureStore((s) => s.classification)`
  and writes through `setClassification`; the per-row picker needs to
  bind to `s.decomposeComponents[index].classification` and write
  through `setDecomposeComponentClassification(index, kind)`. The
  binding is the load-bearing axis of variation; parameterizing the
  existing palette to take per-index store-access functions would
  push complexity into the F1 component to serve the decompose
  use-case. Extracting a sibling component is the cleaner factoring:
  each component has one clear binding.
- **Parameterize `<ClassificationPalette>` with a generic store-read +
  store-write function pair** — *rejected*. Adds a prop surface to the
  F1 component to serve a sibling use-case; complicates the F1 tests
  with shapes the F1 use-case never exercises. The two components
  share visual vocabulary but not behaviour; the right de-duplication
  scope is the Tailwind class constants (which are duplicated
  module-locally for now per the next bullet).
- **Inline the buttons inside `<DecomposeComponentRow>`** — *rejected*.
  The picker is visually a coherent unit; extracting it makes the row
  composition readable (`<DecomposeComponentRow>` reads as "label +
  text input + picker + remove button" rather than as a 40-line
  flat-render).

**Tailwind class constants stay duplicated module-locally** (the
`SELECTED_CLASSES`, `UNSELECTED_CLASSES`, `KEY_CHIP_CLASSES` constants
appear in both `ClassificationPalette.tsx` and
`DecomposeComponentClassificationPicker.tsx`). Reason: the class
strings are tightly coupled to the component's own layout (the
`inline-flex items-center gap-1` is right for both but the rest of
each component's flex parent differs). Extracting them into a shared
module is a YAGNI extraction until a third caller appears (likely the
interpretive-split picker — see Decision §9).

### 5. Per-row textarea density: `rows={1}` + smaller `MAX_HEIGHT_PX`, no helper line

Surveyed:

- **`rows={1}` initial + `MAX_HEIGHT_PX = 72` (~3 lines) + no helper
  line** — *chosen*. The multi-row grid is dense; each row carries a
  label + text input + picker + remove button. A 2-line min-height per
  row (the F1 default) would push the grid past the bottom-strip's
  natural height. The 3-line cap accommodates a wrapped 2-3 line
  component wording (the methodology's "wording" is short by intent —
  decomposition pulls out the individual atomic claims; a multi-page
  wording would itself want decomposing). The helper line
  (`{used}/{max} characters`) carries little signal at the per-row
  scale; removing it tightens the row and the `maxLength`-native
  truncation surfaces the cap when reached.
- **`rows={2}` initial** — *rejected*. Pushes the grid past the
  available strip height when 4+ rows are present; the operator would
  need to scroll the strip vertically to see the lower rows.
- **`rows={1}` + helper line per row** — *rejected*. The helper line
  adds vertical density per row (each row would be ~3 lines of chrome
  + content); the dense grid already surfaces the cap via the native
  truncation.

A future inline-validation hint per row (e.g., "wording required" when
empty) is deferred per Decision §7; if it lands, it occupies the
helper-line slot space without re-arguing the row density.

### 6. No new keyboard listeners; per-row pickers are click-only in v1

Surveyed:

- **No `captureKeymap` extension; the per-row pickers and textareas
  are click-only / tab-only** — *chosen*. The F1
  `<ClassificationPalette>` registers a document-level `keydown`
  listener that listens for `f`/`p`/`v`/`n`/`d` and writes to the
  global `classification` slice. The listener is gated on
  editable-target (so typing into the F1 textarea doesn't bounce the
  palette) and on no-modifiers-other-than-shift (so Cmd/Ctrl+Enter
  doesn't fire it). In decompose mode, the F1 palette is unmounted
  (per the route's conditional swap), so its listener detaches; the
  per-row pickers do NOT install their own listeners. **A multi-row
  keyboard binding** ("press `f` to set the focused row's kind to
  fact") would need a sense of "currently focused row" that the
  global keymap doesn't currently know about — and the operator who
  has tabbed to a per-row textarea is already in an editable-target,
  so the global guard would skip the keystroke anyway. The right
  shape for per-row keyboard kind-picking is a per-row inline picker
  that captures focus (a select element or a popover), which is more
  surface than v1 needs. **Click + tab navigation is the v1 model**.
- **Per-row keymap registration** — *rejected*. Each picker would
  need to know whether it owns the focus to decide whether to listen;
  the editable-target guard would interfere with the per-row textarea
  use-case; the keystroke disambiguation between "I'm in row 2's
  textarea typing 'f' as part of the wording" vs. "I want to set
  row 2's kind to fact" has no obvious user-pleasing answer. The
  follow-up exploration would land with the per-row inline picker
  experiment if it lands.
- **Cmd/Ctrl+Enter on the last row's textarea fires
  propose-decomposition** — *deferred*. Lands with or after
  `mod_propose_decomposition` (sibling, next task). For now the
  per-row textarea's keydown handler is absent; plain Enter inserts a
  newline; Cmd/Ctrl+Enter inserts a newline (native behaviour). The
  propose-decomposition button is the only submit path in v1.

The F1 keyboard shortcut (`f`/`p`/`v`/`n`/`d` for kind) is therefore
**not available in decompose mode** v1. The operator clicks the per-row
chips. This is consistent with the design's keyboard-shortcuts ranking
in `docs/moderator-ui.md:185-204`: the F1 shortcuts are the primary
load-bearing case; per-row shortcuts in a sub-mode are a tighter
optimization that doesn't pay for itself in v1.

### 7. No inline per-row validation hints; deferred to follow-up

Surveyed:

- **No inline hints in v1 — disabled propose button + tooltip carry
  the surface** — *chosen*. The propose-decomposition button (sibling
  task `mod_propose_decomposition`) will be disabled when
  `validateDecomposeComponents(decomposeComponents) === false` and
  surface a gate-reason tooltip ("at least 2 components with wording
  and kind" or similar) on hover. The grid itself surfaces no
  validation messages per row in v1. The operator's mental model:
  "I see the propose button is disabled; I scan the grid for what's
  missing." For 2-row mostly-filled cases, the scan is trivial.
- **Per-row red rings + per-row error messages** — *rejected for v1*.
  Adds visual noise during the natural "mid-composition" state where
  several rows are partially filled; would surface "your wording is
  empty" the moment the operator clicks "Add component" and the new
  row appears (every new row would render with a red ring until the
  operator types into it). The disabled-button + tooltip is the
  quieter UX. If a usability study reveals operators struggling to
  see why the button is disabled, the per-row hints become the
  next iteration.

The `validateDecomposeComponents` helper is exposed for
`mod_propose_decomposition` to consume; if v2 needs per-row hints, the
helper splits into a per-row-validity predicate + the same array-wise
fold, and the grid renders the per-row state.

### 8. Validator + selector lives in the captureStore module, not in a sibling

Surveyed:

- **Free function exported from `captureStore.ts`** — *chosen*. Keeps
  the slice + its validator co-located; no new module to wire. The
  validator is a one-screen function that reads the slice's shape; it
  belongs next to the type definition. The sibling
  `mod_propose_decomposition` imports the function alongside the
  slice and uses it to gate the button.
- **New module `apps/moderator/src/stores/decomposeValidation.ts`** —
  *rejected for now*. Single-callsite-anticipated factoring; one
  function isn't enough for a module. If multiple validators land
  (per-row, array-wise, derived from an event-stream snapshot), the
  extraction follows.
- **Memoized selector hook**
  (`useDecomposeComponentsValid()` returning a memoized boolean) —
  *deferred*. Premature optimization until Devtools profiling reveals
  re-render churn from `mod_propose_decomposition`'s gate-button
  subscription. The shipped shape is a free function the consumer
  calls on the slice it already subscribed to.

### 9. Template for `mod_interpretive_split_mode`'s sibling capture

The interpretive-split mode (sibling task in the F2 family) will mirror
this task's exact shape:

- A parallel slice
  `interpretiveSplitReadings: ReadonlyArray<{ text: string; classification: StatementKind | null }>`
  on `useCaptureStore` (the Zod
  `interpretiveSplitProposalSchema.readings` field at
  `packages/shared-types/src/events/proposals.ts:185` is structurally
  identical: `z.array(proposalComponentSchema).min(2).max(10)`).
- Parallel coordination helpers (`setInterpretiveSplitReadingText`,
  `setInterpretiveSplitReadingClassification`,
  `addInterpretiveSplitReading`, `removeInterpretiveSplitReading`).
- Parallel grid component
  `<InterpretiveSplitReadingsGrid>` mounted in the same slot when
  `mode === 'interpretive-split'`.
- Parallel per-row text input + picker components OR — once the third
  caller appears — a single parameterized component family that takes
  a row-binding adapter as a prop. The right factoring becomes clear
  with the third caller present.
- Parallel `moderator.interpretive-split.readings.*` i18n sub-namespace
  with the same 5-key shape.

The patterns settle here once; the interpretive-split task lands as a
replicate-with-rename. The shared abstraction (if any) lands when the
third caller forces it.

### 10. No new ADR

Three potential ADR triggers, all dispatched:

- **"Adding a new state-shape pattern is ADR-worthy."** This task adds
  NO new pattern — the `ReadonlyArray<Row>` shape inside a Zustand
  store is the conventional shape for multi-row form state and is
  used widely in the React ecosystem; no architectural lever is
  pulled.
- **"A new keyboard-shortcut policy is ADR-worthy."** This task adds
  NO new shortcut entries and NO new policy clause — it consumes
  the existing english-mnemonic / locale-independent policy from ADR
  0024 and operationalized in `i18n_keyboard_shortcuts_policy` by
  *not* registering per-row shortcuts.
- **"A new validation-surface shape is ADR-worthy."** This task adds
  NO new validation shape — `validateDecomposeComponents` returns a
  plain `boolean`, mirroring the F1 propose-action's reason-union
  approach (which itself is task-scoped, not ADR-scoped, per its own
  refinement).

`mod_decompose_mode`, `mod_capture_text_input`,
`mod_classification_palette`, `mod_state_management`, ADR 0022, ADR
0024, and `decomposition_logic` already pinned every architectural
choice this task implements; this refinement is the task-scope pin
for the UI binding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- New `decomposeComponents` slice in `apps/moderator/src/stores/captureStore.ts` — `DecomposeComponent` type, 2 constants, 4 mutators (add / update / remove / reset), and the free `validateDecomposeComponents` function. This pair is the shared seam that `mod_propose_decomposition` will consume: the propose-decomposition action reads the slice + the validator's boolean to gate event emission, without re-implementing row-level validation.
- Route-level slot swap in `apps/moderator/src/routes/Operate.tsx` — when the capture store's `mode === 'decompose'`, the bottom-strip's textInput slot is swapped from the F1 `CaptureTextInput` to the F2 `DecomposeComponentsGrid`. The other bottom-strip slots (mode banner, target chip, classification palette) remain untouched. This mode-aware slot pattern is the reusable hook for future capture modes (interpretive-split, capture-defeater) that need their own per-mode row UI.
- Four compact components under `apps/moderator/src/layout/`: `DecomposeComponentsGrid.tsx` (the row container + Add-row affordance), `DecomposeComponentRow.tsx` (one row's layout), `DecomposeComponentTextInput.tsx` (per-row wording field), and `DecomposeComponentClassificationPicker.tsx` (per-row kind picker). Each ships with a co-located `.test.tsx` (vitest test-count delta 3267 to 3305, +38).
- Captured-state lifecycle: `enterDecomposeMode` seeds an empty row, `exitDecomposeMode` (and Esc) resets the slice, matching the F2 flow's "scratchpad cleared on exit" contract from the refinement's Decisions section.
- i18n: 15 entries landed across `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` (5 keys x 3 locales); 10 pt-BR + es-419 entries flagged PENDING in the matching `*.review.json` trackers, registered as the new `i18n_multi_component_capture_native_review` tech-debt task in `tasks/35-frontend-i18n.tji`.
- Playwright coverage: new test block in `tests/e2e/moderator-capture.spec.ts` exercises grid mount, add-row, fill, remove-row, and Esc cleanup. `chromium-create-session` project green (16/16; new test 4.7s).
