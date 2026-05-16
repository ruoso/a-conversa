# Moderator capture-pane one-gesture clear / override of the auto-suggested target

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_target_clear_override`.

```
task mod_target_clear_override "One-gesture clear override of auto-suggested target" {
  effort 0.5d
  allocate team
  depends !mod_target_auto_suggest
}
```

## Effort estimate

**0.5d.** Confirmed. The work is one small UI affordance + one
keyboard binding + a tiny store-shape extension + i18n + tests on top
of seams the predecessor (`mod_target_auto_suggest`, commit `21ff9ec`)
already shipped:

- `<CaptureTargetChip>` already lives at
  `apps/moderator/src/layout/CaptureTargetChip.tsx` (one component
  rendering the three states: empty / suggested / overridden). This
  task adds an interactive child — a small "×" button — to the chip's
  filled-state render branch only; it does NOT introduce a new
  component file.
- `useCaptureStore.setTargetEntityId(null)` is the pre-existing
  null-writer the predecessor already exposed
  (`apps/moderator/src/stores/captureStore.ts:53, 74`). The clear
  gesture just calls that setter; no new setter, no new slice value
  on the existing field.
- The predecessor's no-stomp guard
  (`apps/moderator/src/layout/CaptureTargetChip.tsx:107-130`) is the
  override seam this task's gesture consumes. Setting the slice to a
  value that does NOT match `lastAutoStagedRef.current` ALREADY
  blocks the auto-stage effect from re-firing on subsequent node
  selections. Clearing to `null` needs a small extension: see
  Decision §2 — a companion ref-bump that marks the next-null as
  "deliberately cleared" so the auto-stage effect does NOT immediately
  re-suggest from the still-selected node.
- `captureKeymap.ts` (commit set with `mod_classification_palette`)
  is the document-level `keydown` plumbing this task extends with a
  new optional `onClearTarget?: () => void` handler — the seam the
  module's header comment specifically anticipates ("future:
  `onExitMode?`, `onDecompose?`"; this task adds
  `onClearTarget?` alongside).
- The catalog workflow + PENDING-flag chain pattern (mt_capture_text_input,
  mod_classification_palette, mod_target_auto_suggest) is in place;
  this task adds 2 new keys × 3 locales = **6 new catalog entries**.

Concretely the deliverable is:

- **One small "×" button** added to `<CaptureTargetChip>`'s filled
  rendering branch (`apps/moderator/src/layout/CaptureTargetChip.tsx`
  lines 167-185 — the non-empty return). The button calls
  `setTargetEntityId(null)` and bumps the no-stomp ref. It carries a
  localized `aria-label` and a stable `data-testid="capture-target-chip-clear"`.
- **One keyboard binding** — `Esc` — added via `captureKeymap.ts`'s
  existing seam. The chip registers a new `onClearTarget` handler in
  the same `useEffect` pattern `<ClassificationPalette>` uses for
  `onPickKind` (Decision §3). Esc is consumed only when the
  capture-pane chip is mounted AND `targetEntityId !== null` AND the
  modifier-bail / editable-target / repeat-skip guards in
  `captureKeymap.ts` allow it.
- **A small store-state extension to support "deliberately cleared"**
  — see Decision §2. The chosen shape is a second ref inside the
  chip (`lastUserClearedAt: number | null` or a boolean flag
  `userHasClearedRef`); no new `useCaptureStore` slice is needed. The
  guard reads: "if the slice is null AND `userHasClearedRef.current`
  is true AND the most-recently-active node id is non-null, do NOT
  re-auto-stage; wait for the next deliberate selection-change
  signal."
- **Re-engagement rule** — selecting a NEW node (different from the
  previously-active id) clears the `userHasClearedRef` flag and
  re-engages the auto-stage path. The rationale is in Decision §4.
- **~6 new Vitest cases** under
  `apps/moderator/src/layout/CaptureTargetChip.test.tsx` (extending
  the existing 17-case file) plus **~3 new cases** under
  `apps/moderator/src/layout/captureKeymap.test.ts` covering the
  `onClearTarget` handler routing (modifier-bail, editable-target,
  repeat-skip — re-using the existing harness with the new handler).
- **One new `test()` block** in `tests/e2e/moderator-capture.spec.ts`
  exercising both the click gesture (×-button) and the keyboard
  gesture (Esc) under the seeded-graph path the predecessor's spec
  established at `tests/e2e/moderator-capture.spec.ts:202-270`.
- **2 new i18n catalog keys × 3 locales = 6 new catalog entries**
  (the "×" button's `aria-label` plus a tooltip / title string for
  hover discoverability). The catalog table is in Constraints below.
- **1 follow-up tech-debt task registered** in
  `tasks/35-frontend-i18n.tji` for the native-speaker review of the
  4 new pt-BR / es-419 draft entries
  (`i18n_target_clear_override_native_review`, effort 0.5d,
  `depends !i18n_target_auto_suggest_native_review`).

No new file is added; this task is a focused extension of the
predecessor's component + the existing keymap module. No `useCaptureStore`
slice shape changes; the `targetEntityId: string | null` field already
accepts `null` writes.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_capture_flow.mod_target_auto_suggest`** (done
  — 2026-05-15, commit `21ff9ec`). Shipped the `<CaptureTargetChip>`
  component, the `selectMostRecentlyActiveNodeId` selector
  (`apps/moderator/src/stores/recentlyActiveNode.ts:31`), the
  no-stomp `useEffect` + `useRef` guard at
  `CaptureTargetChip.tsx:107-130`, and the override-marker variant.
  See the Status block of `mod_target_auto_suggest.md` (lines
  1471-1499 of the refinement). The override seam this task consumes
  is the no-stomp guard's `lastAutoStagedRef`-based "is the slice an
  auto-stage or an override?" detection.
- **`moderator_ui.mod_capture_flow.mod_classification_palette`** (done
  — established `captureKeymap.ts` with `attachCaptureKeymap` +
  `CaptureKeymapHandlers` (`apps/moderator/src/layout/captureKeymap.ts:60-66`).
  The handlers interface already anticipates additional optional
  handlers (the file header comment names "future: `onExitMode?`,
  `onDecompose?`"). This task adds `onClearTarget?` alongside.
- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done —
  the textarea owns its own keystrokes via the editable-target guard
  in `captureKeymap.ts:118-122`. The Esc-to-clear binding inherits
  that guard for free: pressing Esc while the textarea has focus
  bails the keymap; the textarea's native behavior (typically
  no-op on Esc) wins).
- **`moderator_ui.mod_state_management`** (done —
  `apps/moderator/src/stores/captureStore.ts:47, 53, 65, 74`
  declares `targetEntityId: string | null` with
  `setTargetEntityId: (id: string | null) => void` and
  `reset(): void`. This task is the second null-writer on the
  slice; the first is `reset()` on `mod_propose_action`'s
  success path (not yet shipped).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done —
  exposes the `edgeRoleSelector` slot the chip is mounted into).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()`, the
  catalog parity-check script, the `*.review.json` PENDING-flag
  lifecycle, the per-locale parity round-trip test idiom).
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — pinned
  the english-mnemonic / non-methodology policy for chord
  shortcuts. `Esc` is a non-methodology, non-letter chord with no
  per-locale variation; the policy treats it as locale-independent,
  same as `Cmd+Enter` and other chrome chords).
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new aria-label strings resolve through.

Pending edges (this task does NOT depend on them; this task feeds
them):

- **`moderator_ui.mod_capture_flow.mod_edge_role_selector`** —
  sibling. Will share the `bottom-strip-edge-role` slot via the
  refactor pattern Decision §8 of `mod_target_auto_suggest.md`
  pinned. The clear gesture continues to surface even when the slot
  gains a second occupant: the × button stays on the chip half; the
  edge-role half is the sibling task's concern.
- **`moderator_ui.mod_capture_flow.mod_propose_action`** — downstream.
  After this task ships, the propose action reads
  `targetEntityId: null` as "no target — emit `node-created` /
  `proposal: classify-node` only, no `edge-created` / `set-edge-substance`".
  The clear gesture is the moderator's affordance to opt OUT of
  attaching to existing structure; the propose action is the
  reader of that opt-out. No coupling beyond the slice value.
- **`frontend_i18n.i18n_target_clear_override_native_review`**
  (registered by this task — see Acceptance criteria / Decisions).

## What this task is

Land the moderator's deliberate "remove the staged target" gesture.
Two redundant affordances reach the same outcome:

1. **A small "×" button** on the chip's filled-state render. Visually
   compact (it joins the chip's existing inline-flex row alongside the
   label and the override-marker dot), tabbable, click + touch + Enter
   reachable. Its `aria-label` resolves through the catalog.
2. **The `Esc` key**, routed through the existing `captureKeymap.ts`
   document-level listener. Inherits the modifier-bail /
   editable-target / repeat-skip guards already established by the
   palette's shortcut binding.

Both gestures call the same handler internally: clear the staged
target slice to `null`, mark the chip's no-stomp guard as "the
moderator deliberately cleared", and let the auto-stage effect skip
re-suggestion until a deliberate selection-change re-engages it.

The "clear" gesture is one-step (no confirm step, no undo affordance
beyond re-clicking the previously-suggested node). It's the
moderator's escape hatch when the auto-suggested target is wrong —
the F1 capture-flow design specifically calls this out
(`docs/moderator-ui.md:45`: *"one keystroke or click clears it if the
suggestion is wrong. This trades a moment of latent error for capture
speed during live debate; the override is one gesture away."*).

The task does NOT introduce a separate "manual target picker" —
selecting the right target is still a graph-canvas-click gesture,
exactly as the auto-suggest reads. The clear gesture is the
opt-out; selecting a different node is the substitution. The
combined result, per the predecessor's no-stomp contract, is the
"override active" state the chip's amber dot marker visualises.

## Why it needs to be done

Three reasons, in priority order:

1. **The F1 capture-flow design specifies the clear gesture as a
   load-bearing capture-speed ergonomic.** `docs/moderator-ui.md:45`
   says the override is *"one gesture away"*; `docs/moderator-ui.md:222`
   restates it as a settled design decision (*"auto-suggest the
   most-recently-active node as target, with a one-gesture clear
   override"*). Without this task, the moderator is locked into the
   auto-suggestion whenever it's wrong — either propose with the
   wrong target attached and reverse, or click a different node and
   live with the secondary suggestion. Both flows degrade the F1
   capture speed.
2. **`mod_propose_action` reads `targetEntityId: null` as "free-floating
   new node, no edge proposed"** (per `docs/moderator-ui.md:46` —
   the edge-creation branch is conditional on *"if connecting"*).
   Without a clear gesture, the slice transitions to `null` only via
   `reset()` (which the propose-success path calls). There is no
   pre-propose path to set the slice to `null` deliberately. This
   task gives the moderator the affordance to compose a free-floating
   statement after the auto-suggest has filled the slice with a
   target the moderator doesn't want.
3. **The auto-suggest's override-marker variant has no way to clear
   itself today.** The predecessor's chip renders the amber dot when
   the slice differs from the most-recently-active node id, but the
   only way to reach that state is via direct
   `setTargetEntityId(non-matching-id)` calls (i.e., a future
   task or a test). The clear gesture is the moderator-facing
   mechanism to engage and disengage the override.

Downstream, the clear gesture is consumed by `mod_propose_action`
(reads `targetEntityId: null` → emits non-connecting propose
bundle), by the future "manual target picker" surfaces (none in v1
— manual target = canvas-click), and by the operator's training
docs (the clear gesture is documented as the F1 escape hatch).

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- `apps/moderator/src/layout/CaptureTargetChip.tsx:93-186` — the
  predecessor's component. This task modifies lines 167-185 (the
  filled-state return) to add the × button as a child inside the
  inline-flex row. Lines 153-165 (the empty-state return) are not
  modified — there is no clear gesture to show when the slice is
  already `null`. Lines 107-130 (the auto-stage `useEffect`) gain
  one additional read: the new `userHasClearedRef` per Decision §2.
- `apps/moderator/src/layout/CaptureTargetChip.test.tsx:1-355` —
  the predecessor's 17-case test file. This task extends it with
  ~6 new cases under new `describe` blocks ("× button gesture"
  and "Esc gesture") plus 1 additional case under "override
  no-stomp contract" covering the cleared-and-re-suggested cycle.
- `apps/moderator/src/layout/captureKeymap.ts:60-66` — the
  `CaptureKeymapHandlers` interface. This task adds one optional
  field:
  ```ts
  export interface CaptureKeymapHandlers {
    onPickKind?: (kind: MethodologyKind) => void;
    onClearTarget?: () => void;  // new
    // future: onSubmit?: () => void;
    // future: onExitMode?: () => void;
    // future: onDecompose?: () => void;
  }
  ```
  And lines 102-136 (`attachCaptureKeymap`'s `onKeyDown` body) gain
  one new branch: when `event.key === 'Escape'` (case-insensitive,
  the lowercase form is `'escape'`) AND the modifier-bail /
  editable-target / repeat-skip guards have not bailed AND
  `handlers.onClearTarget !== undefined`, call
  `event.preventDefault()` and invoke the handler. The kind-match
  branch and the Escape branch are siblings inside the same
  function; the kind-match runs first (no-op for non-letter keys),
  then the Escape branch.
- `apps/moderator/src/layout/captureKeymap.test.ts:1-185` — the
  existing test harness. This task extends it with ~3 new cases
  under a new `describe('captureKeymap — onClearTarget handler')`
  block covering: a plain `Escape` keypress routes to
  `onClearTarget`; modifier-held `Cmd+Esc` bails; the editable-target
  guard bails (Esc inside textarea doesn't clear). The repeat-skip
  case is implicitly covered by the same shared listener body —
  no extra test is needed because the bail happens before any
  handler match.
- `apps/moderator/src/layout/ClassificationPalette.tsx:1-200` — the
  precedent consumer of `attachCaptureKeymap`. This task does NOT
  modify the palette; the palette continues to register its
  `onPickKind` handler. The chip registers a separate handlers
  object with `onClearTarget` set. Both handlers objects can be
  registered concurrently because `attachCaptureKeymap` attaches a
  fresh listener per call and returns a detach function; the two
  consumers don't share the handlers object.
- `apps/moderator/src/stores/captureStore.ts:53, 74` — the
  `setTargetEntityId(null)` writer this task calls.
- `apps/moderator/src/stores/recentlyActiveNode.ts:31` — the pure
  selector the predecessor's auto-stage effect reads. Unchanged by
  this task.
- `apps/moderator/src/layout/BottomStripCapture.tsx:80-85` — the
  `bottom-strip-edge-role` slot the chip is mounted into. Unchanged
  by this task.
- `apps/moderator/src/routes/Operate.tsx` — the integration site.
  Unchanged by this task; the chip is already wired into the slot.
- `packages/i18n-catalogs/src/catalogs/en-US.json:162-167` — the
  existing `moderator.captureTargetChip.*` namespace the
  predecessor landed. This task adds two new sibling keys to the
  same object (no new namespace).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the
  PENDING-flag trackers; the 4 new draft entries (2 keys × 2
  non-en-US locales) get added per the established pattern.
- `tests/e2e/moderator-capture.spec.ts:1-271` — the sibling spec
  (extended by the predecessor at lines 202-270). This task adds
  one new `test()` block joining the existing three.

DESIGN.md / docs consulted:

- `docs/moderator-ui.md:45` — F1 capture flow, step 3: *"The
  most-recently-active node is auto-suggested as the default target,
  pre-filled in the connect pane; one keystroke or click clears it
  if the suggestion is wrong. This trades a moment of latent error
  for capture speed during live debate; the override is one gesture
  away."* The load-bearing spec for this task.
- `docs/moderator-ui.md:46` — *"... plus optionally `edge-created`,
  `entity-included`, `proposal: set-edge-substance` if connecting."*
  Confirms that `targetEntityId: null` is the canonical "do not
  connect" signal the propose action reads.
- `docs/moderator-ui.md:187-190` — the keyboard-shortcut section.
  Esc as a chord is consistent with the moderator's keyboard-first
  operation mode.
- `docs/moderator-ui.md:222` — *"Default attachment behavior —
  auto-suggest the most-recently-active node as target, with a
  one-gesture clear override. Captured in F1."* The settled design
  point this task implements the "clear override" half of.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
- `tasks/refinements/moderator-ui/mod_target_auto_suggest.md` — the
  predecessor; Decision §5 (auto-stage with no-stomp ref guard) and
  the override-marker render branch are the load-bearing seams this
  task consumes. The predecessor's Status block (lines 1471-1499)
  confirms each shipped artifact.
- `tasks/refinements/moderator-ui/mod_classification_palette.md` —
  the precedent consumer of `captureKeymap.ts`'s document-level
  listener pattern. Decision §3 below mirrors its keyboard-binding
  architecture rather than re-inventing it.
- `tasks/refinements/moderator-ui/mod_capture_text_input.md` —
  pinned the editable-target guard contract this task's Esc binding
  inherits for free.
- `tasks/refinements/moderator-ui/mod_bottom_strip_capture.md` — the
  scaffold whose `bottom-strip-edge-role` slot the chip lives in;
  unchanged.
- `tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md`
  — the Esc binding is locale-independent (non-methodology chord);
  consistent with the policy's "non-methodology shortcuts stay
  as-is across locales" clause.
- `tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md`
  — the PENDING-flag + native-review chain pattern this refinement
  re-uses for the 4 new draft entries.

No new ADR is required (see Decisions §7); no new dependency lands;
no public type signature changes other than one optional field on
`CaptureKeymapHandlers`; no cross-workspace contract changes; no
data-model touch.

## Constraints / requirements

### Component shape — extending `<CaptureTargetChip>`

- The component file remains `apps/moderator/src/layout/CaptureTargetChip.tsx`.
  No new file.
- The filled-state return (lines 167-185 of the predecessor) gains
  one new child element: a small `<button>` after the override-marker
  span. The structure of the filled-state row becomes:
  ```
  <span data-testid="capture-target-chip" ...>
    <span data-testid="capture-target-chip-label">...</span>
    {overrideActive ? <span data-testid="capture-target-chip-override-marker" ... /> : null}
    <button
      data-testid="capture-target-chip-clear"
      type="button"
      aria-label={t('moderator.captureTargetChip.clearAria')}
      title={t('moderator.captureTargetChip.clearTitle')}
      onClick={handleClear}
      className={CHIP_CLEAR_BUTTON_CLASSES}
    >
      ×
    </button>
  </span>
  ```
- The empty-state return (lines 153-165) is NOT modified — there is
  no clear gesture when the slice is already null.
- A new constant
  `const CHIP_CLEAR_BUTTON_CLASSES = 'ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500';`
  joins the existing Tailwind constants in the file. The button is
  small (4×4 cell) but tabbable; the focus ring is sky-500 to match
  the moderator UI's selection-ring palette.
- The literal `×` glyph is a multiplication sign (`×`). It is
  NOT translated (per Decision §6). The button's accessible name
  comes from `aria-label`.

### Store-state extension — the `userHasClearedRef` companion ref

The predecessor's `lastAutoStagedRef` (line 107) distinguishes
"auto-staged" from "override (non-null, non-matching)". It does NOT
distinguish "deliberately cleared (null) — do not re-suggest" from
"initial empty state (null) — fine to auto-suggest." Both states are
slice = `null`; the predecessor's effect Case 1 (lines 111-115)
auto-stages whenever the slice is null AND a node is selected,
which would re-stage immediately after the moderator clears.

This task introduces a sibling ref:

```ts
// Tracks whether the moderator deliberately cleared the target.
// `true` after a clear gesture; reset to `false` when the
// most-recently-active node id changes (a deliberate
// selection-change re-engages the auto-stage path).
const userHasClearedRef = useRef<boolean>(false);
```

The auto-stage `useEffect` body extends to four cases:

```ts
useEffect(() => {
  if (recentlyActiveNodeId === null) return;

  // Case 0 (new): the moderator deliberately cleared. Wait for the
  // most-recently-active node to change before re-engaging the
  // auto-stage path. The clear handler bumps the ref; this case
  // de-bumps when the active node changes.
  if (userHasClearedRef.current) {
    if (recentlyActiveNodeId !== lastAutoStagedRef.current) {
      // The active node has changed since the clear — re-engage.
      userHasClearedRef.current = false;
      setTargetEntityId(recentlyActiveNodeId);
      lastAutoStagedRef.current = recentlyActiveNodeId;
    }
    // If the active node hasn't changed (still the same node the
    // moderator just cleared from), stay cleared.
    return;
  }

  // Case 1 (unchanged): nothing staged yet — auto-stage.
  if (stagedTargetId === null) {
    setTargetEntityId(recentlyActiveNodeId);
    lastAutoStagedRef.current = recentlyActiveNodeId;
    return;
  }

  // Case 2 (unchanged): follow-the-selection auto-update.
  if (
    stagedTargetId === lastAutoStagedRef.current &&
    stagedTargetId !== recentlyActiveNodeId
  ) {
    setTargetEntityId(recentlyActiveNodeId);
    lastAutoStagedRef.current = recentlyActiveNodeId;
    return;
  }

  // Case 3 (unchanged): override active — do not stomp.
}, [recentlyActiveNodeId, stagedTargetId, setTargetEntityId]);
```

The clear handler itself:

```ts
const handleClear = useCallback(() => {
  setTargetEntityId(null);
  userHasClearedRef.current = true;
}, [setTargetEntityId]);
```

The handler is bound to BOTH the × button's `onClick` AND the
`onClearTarget` handler the chip registers with `attachCaptureKeymap`.
Both paths call the same function.

### Keymap extension — `onClearTarget`

The `<CaptureTargetChip>` component grows a second `useEffect` that
mirrors the palette's keymap-attachment pattern:

```ts
const handlersRef = useRef<CaptureKeymapHandlers>({});
handlersRef.current = { onClearTarget: handleClear };

useEffect(() => {
  const detach = attachCaptureKeymap({
    onClearTarget: () => handlersRef.current.onClearTarget?.(),
  });
  return detach;
}, []);
```

The handler-ref-then-closure pattern is the same one
`<ClassificationPalette>` uses — it survives strict-mode double-mount
and avoids re-attaching the document listener on every render.

`attachCaptureKeymap` itself grows an `Escape` branch:

```ts
// inside onKeyDown, AFTER the modifier-bail / repeat-skip / editable-target
// guards and AFTER the kind-match branch:
if (key === 'escape' && handlers.onClearTarget !== undefined) {
  event.preventDefault();
  handlers.onClearTarget();
  return;
}
```

The Escape branch sits after the kind-match branch because the
shortcut table only contains letter keys; the early-return on a
matched letter never collides with Escape. The branch is gated on
`handlers.onClearTarget !== undefined` so other consumers
(the palette) don't accidentally observe Escape calls they didn't
register for.

### Re-engagement semantics

After a clear, the chip re-engages the auto-stage path only when the
most-recently-active node id CHANGES. Specifically:

- The clear sets `userHasClearedRef.current = true` and writes
  `null` to the slice.
- The auto-stage effect runs (the slice changed, triggering the
  effect). Case 0 fires: `userHasClearedRef.current` is true,
  `recentlyActiveNodeId === lastAutoStagedRef.current` (the active
  node hasn't changed yet — the moderator just cleared the
  suggestion from the same node), so the case returns without
  re-staging.
- The moderator clicks a different node. The selection store
  updates; `recentlyActiveNodeId` changes; the effect runs again.
  Case 0 fires: `userHasClearedRef.current` is still true, but
  `recentlyActiveNodeId !== lastAutoStagedRef.current` (different
  node), so re-engagement triggers: clear the ref, stage the new
  active node, update `lastAutoStagedRef`.

The rule is "a deliberate selection-change re-engages the
auto-stage path." Pane-click does NOT count (pane-click sets
`selected = null`, which makes `recentlyActiveNodeId === null`, which
the effect's leading guard short-circuits on; the ref stays true).
Edge selection does NOT count (the selector returns null for edges).
Only a NEW node selection re-engages — which is the moderator's
deliberate signal of intent toward a different target.

### Visual indication post-clear

After a clear, the chip renders the same empty-state UI it renders
on initial mount: the localized "No target yet" text in the dimmed
`text-slate-400` color, no override marker, no × button. There is
NO visible distinction between "the slice was always null" and "the
moderator cleared." The difference is invisible state (the
`userHasClearedRef`) that the auto-stage effect reads; the UI surface
stays minimal. Decision §5 records the rationale.

### Tailwind styling — the × button

The button joins the chip's existing inline-flex row at the right
edge. Layout:

- `ml-0.5` — small left margin to separate from the override marker
  (or directly from the label when no marker is present).
- `inline-flex h-4 w-4 items-center justify-center` — 16×16 cell,
  the glyph centered.
- `rounded` — soft corner consistent with the chip's rounded outer.
- `text-slate-500` — slightly dimmer than the label's
  `text-slate-700` so the button reads as secondary affordance, not
  primary content.
- `hover:bg-slate-100 hover:text-slate-700` — explicit hover state
  so the moderator gets visual feedback the × is clickable.
- `focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500`
  — sky-500 ring for keyboard focus, matching the moderator UI's
  selection-ring palette.

Contrast: `text-slate-500` on white ≈ 7.36:1; on `bg-slate-100` ≈
6.85:1. Both pass WCAG AA for the 16-px glyph size.

### Accessibility

- The × button is a native `<button type="button">` element —
  inherits keyboard focus, Enter/Space activation, screen-reader
  announce-as-button behavior.
- The button's accessible name comes from
  `aria-label={t('moderator.captureTargetChip.clearAria')}` so
  the visual glyph (`×`) does not have to be the announce text. The
  `title` attribute mirrors the same intent for mouse-hover tooltips.
- The Esc binding does NOT have a separate ARIA announcement
  (keyboard shortcuts don't announce by default). The
  `mod_keymap_help_overlay` task (future) is the place where Esc
  surfaces in a help-overlay; until then, the × button's tooltip is
  the discoverability path.
- The chip's wrapper `aria-label` (`moderator.captureTargetChip.ariaLabel`,
  predecessor's key) is unchanged; the wrapper is still a `<span>`
  and remains the labelled non-interactive region containing the
  interactive × button.

### Reactivity

The chip subscribes to:

- `useSelectionStore` (via the existing pure selector). Unchanged.
- `useCaptureStore((s) => s.targetEntityId)`. Unchanged.
- `useCaptureStore((s) => s.setTargetEntityId)`. Unchanged.
- `useWsStore` events for the wording lookup. Unchanged.

The new state is per-instance refs; no new store subscription.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.captureTargetChip.clearAria` | "Clear target" | "Limpar alvo" | "Borrar objetivo" |
| `moderator.captureTargetChip.clearTitle` | "Clear staged target (Esc)" | "Limpar alvo selecionado (Esc)" | "Borrar objetivo seleccionado (Esc)" |

**Count: 2 keys × 3 locales = 6 catalog entries**. The pt-BR + es-419
drafts land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json` (same pattern as the predecessor).

The new keys land under the existing
`moderator.captureTargetChip.*` namespace (predecessor's namespace,
already present in all three locales at lines 162-167 of en-US.json).
No new namespace.

The `clearTitle` string deliberately includes the literal `(Esc)`
suffix. The Esc binding is locale-independent per
`i18n_keyboard_shortcuts_policy` (non-methodology chord); embedding
the literal in the tooltip is the canonical discoverability surface
until `mod_keymap_help_overlay` ships.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/CaptureTargetChip.tsx` (modified — add
  the × button, the clear handler, the new ref, the new
  `useEffect` for `attachCaptureKeymap`, and the extended case-0
  branch in the auto-stage effect).
- `apps/moderator/src/layout/CaptureTargetChip.test.tsx` (modified —
  add ~6 new cases under new `describe` blocks for the × button +
  Esc binding + re-engagement semantics; reuse the existing seeding
  helpers).
- `apps/moderator/src/layout/captureKeymap.ts` (modified — add
  `onClearTarget?: () => void` to `CaptureKeymapHandlers`; add the
  `key === 'escape'` branch to `attachCaptureKeymap`'s `onKeyDown`).
- `apps/moderator/src/layout/captureKeymap.test.ts` (modified — add
  ~3 new cases under a new `describe('captureKeymap — onClearTarget handler')`
  block).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add
  `clearAria`, `clearTitle` under `moderator.captureTargetChip`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified
  — PENDING entries for the 2 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified
  — same).
- `tests/e2e/moderator-capture.spec.ts` (modified — one new
  `test()` block joining the existing three).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_target_clear_override`
  lands at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_target_clear_override_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration
  policy.
- `docs/adr/` — no new ADR. ADR 0024 already pinned the i18n
  architecture; `i18n_keyboard_shortcuts_policy` already pinned the
  non-methodology chord policy; this task implements those decisions.
- `apps/moderator/src/stores/captureStore.ts` — the slice and the
  setter are consumed unchanged. No new slice; `userHasClearedRef`
  is component-local state per Decision §2.
- `apps/moderator/src/stores/selectionStore.ts` /
  `apps/moderator/src/stores/recentlyActiveNode.ts` — unchanged.
- `apps/moderator/src/layout/BottomStripCapture.tsx` /
  `apps/moderator/src/routes/Operate.tsx` — unchanged; the chip's
  mount point is already wired.
- `apps/moderator/src/layout/ClassificationPalette.tsx` — the
  palette continues to register its own `onPickKind` handler
  independently; this task does not co-register handlers with the
  palette.
- `apps/server/src/` — no server-side change.
- `docs/moderator-ui.md` — no design-doc change. The clear gesture
  is already documented at lines 45 and 222; this task implements
  the documented behavior.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new `CaptureTargetChip.test.tsx` cases (≥ 6) plus
  the new `captureKeymap.test.ts` cases (≥ 3).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity
  check) green after the catalog edits — every new
  `moderator.captureTargetChip.{clearAria, clearTitle}` key is
  present in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green against a freshly brought-up
  dev compose stack; the new clear-gesture scenario in
  `tests/e2e/moderator-capture.spec.ts` passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_target_clear_override` AND the
  new `i18n_target_clear_override_native_review` task block.

### UI-stream e2e scoping

The clear gesture is reachable from a real user flow as of the
predecessor's spec at `tests/e2e/moderator-capture.spec.ts:202-270`
(login → create session → land on operate → seed two nodes via
`seedWsStore` → click to auto-suggest). The Playwright e2e is
**scoped under Acceptance criteria, NOT deferred**, per the
UI-stream e2e policy default.

The new `test()` block covers both gestures:

1. **Empty-graph regression check** — the × button is NOT rendered
   in the empty state (no slice value → no button); pressing Esc on
   the empty operate route is a no-op (the keymap handler is
   registered but `targetEntityId === null` already, so the clear is
   idempotent — pressing Esc does nothing visible).
2. **Seeded-graph happy path (× button)** — seed two nodes, click
   node 1 → chip auto-suggests → × button is visible → click ×
   → chip flips to empty state.
3. **Re-engagement after clear** — after a clear, click node 2 →
   chip auto-suggests node 2 (the re-engagement rule fires because
   the active node id changed).
4. **Esc keyboard gesture** — seed → click node 1 → chip
   auto-suggests → press Esc (with no input focus) → chip flips to
   empty state.
5. **Editable-target Esc no-op** — seed → click node 1 → chip
   auto-suggests → focus the capture textarea → press Esc → chip
   stays at "Target: ..." (the editable-target guard in
   `captureKeymap.ts` consumes the Esc; the chip's handler does not
   fire). This regression-locks the editable-target guard for the
   clear gesture.

If the `wsStoreSeed` accessor is unreachable at implementation time
(same caveat as the predecessor's spec), the seeded-graph cases are
`test.skip`'d the same way the predecessor's spec at line 228 does;
the empty-state regression (case 1 above) still gates the chip's
no-button-when-empty contract.

## Acceptance criteria

### 1. The × button renders in the filled state, not the empty state

- With `useCaptureStore.targetEntityId !== null`, the chip renders
  a button reachable as
  `screen.getByTestId('capture-target-chip-clear')`.
- With `useCaptureStore.targetEntityId === null`, the same query
  returns `null` (the button is not rendered).
- The button is a native `<button type="button">` element with a
  localized `aria-label` and `title`.

### 2. Click on the × button clears the slice

- Start state: `targetEntityId === 'n-1'` (auto-suggested via prior
  `n-1` selection).
- Click the × button via `fireEvent.click(screen.getByTestId('capture-target-chip-clear'))`.
- After the React effect runs:
  - `useCaptureStore.getState().targetEntityId === null`;
  - the chip renders the localized empty state ("No target yet");
  - the × button is no longer rendered.

### 3. Esc keyboard gesture clears the slice

- Start state: `targetEntityId === 'n-1'`; no element has focus
  (or the focus is on a non-editable element).
- Dispatch a `KeyboardEvent('keydown', { key: 'Escape' })` to
  `document`.
- After the effect runs: same outcome as case 2 (slice cleared,
  chip in empty state).

### 4. Esc bails when an editable target has focus

- Start state: `targetEntityId === 'n-1'`; a `<textarea>` inside
  the test render is `document.activeElement`.
- Dispatch the same Esc keydown.
- `useCaptureStore.getState().targetEntityId === 'n-1'` (unchanged).
- The chip continues to render "Target: ...".

### 5. Re-engagement: a new node selection after clear re-suggests

- Start state: `targetEntityId === 'n-1'`; clear via × button →
  slice is null, `userHasClearedRef === true`.
- The same node remains selected. The auto-stage effect runs (the
  slice changed); Case 0 fires; the active node id equals
  `lastAutoStagedRef.current` (n-1), so re-engagement does NOT
  trigger; the slice stays null.
- Now select node `n-2` via
  `useSelectionStore.setState({ selected: { kind: 'node', id: 'n-2' } })`.
- The auto-stage effect runs; Case 0 fires; the active node id
  (`n-2`) differs from `lastAutoStagedRef.current` (`n-1`); re-engagement
  triggers: the slice flips to `n-2`, `userHasClearedRef` resets to
  false, `lastAutoStagedRef` updates to `n-2`.
- The chip renders "Target: <n-2 wording>".

### 6. Subsequent selections of the SAME node do not re-suggest

- Start state: same as case 5 (just cleared, `userHasClearedRef === true`,
  n-1 still selected).
- Re-dispatch the same `n-1` selection (no-op selection write — a
  paranoid case for the no-op effect path).
- The active node id stays `n-1`, equal to
  `lastAutoStagedRef.current`. Case 0 fires and returns; slice stays
  null.

### 7. Pane-click does not re-suggest after clear

- Start state: same as case 5 (cleared, `userHasClearedRef === true`,
  n-1 still selected).
- Call `useSelectionStore.getState().clear()` (pane-click). The
  active node id becomes null. The auto-stage effect's leading
  guard (`if (recentlyActiveNodeId === null) return`) short-circuits;
  nothing changes; slice stays null.

### 8. Clear during override produces a clean empty state

- Start state: `targetEntityId === 'n-other'` (override active,
  `lastAutoStagedRef.current === 'n-1'`, the override marker is
  visible).
- Click the × button.
- After the effect: slice is null; the override marker is no longer
  rendered (the chip is in the empty state, which has no marker);
  the × button is no longer rendered; `userHasClearedRef === true`.

### 9. Vitest cases (extending `CaptureTargetChip.test.tsx`)

Minimum 6 new cases per ADR 0022 (committed regression-class proofs):

1. **× button rendered in the filled state** — auto-suggest to
   `n-1`; assert `getByTestId('capture-target-chip-clear')` returns
   a `<button>` element with the localized aria-label.
2. **× button NOT rendered in the empty state** — fresh mount;
   assert `queryByTestId('capture-target-chip-clear')` is null.
3. **Click on × clears the slice and flips the chip to empty state**
   — case 2 above as a single test.
4. **Esc keydown clears the slice when no editable target has
   focus** — case 3 above; dispatch the keyboard event via
   `act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))`.
5. **Esc keydown bails when a textarea has focus** — case 4 above;
   render a sibling `<textarea>` inside the test wrapper and call
   `.focus()` on it before dispatching Esc.
6. **Re-engagement: new node selection after clear re-suggests** —
   case 5 above as a single test.

Plus the new cases in `captureKeymap.test.ts`:

1. **Routes a plain `Escape` keypress to `onClearTarget`** — register
   handlers with `onClearTarget` as a `vi.fn()`; dispatch Esc;
   assert the spy was called once.
2. **Bails when `Cmd+Esc` is held** — register handlers; dispatch
   `Escape` with `metaKey: true`; assert the spy was NOT called.
3. **Bails when a textarea is the active element** — set up a focused
   `<textarea>` as `document.activeElement`; dispatch Esc; assert
   the spy was NOT called.

### 10. Playwright e2e (per UI-stream policy)

One new `test()` block lands in
`tests/e2e/moderator-capture.spec.ts` (joining the existing three),
covering the 5 sub-scenarios listed under "UI-stream e2e scoping"
above. The block reuses `loginAs`, `seedWsStore`, and
`isWsStoreReachable` from the predecessor's spec; structure mirrors
lines 202-270 of the file.

### 11. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.captureTargetChip.{clearAria, clearTitle}` keys with
  the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` gains the same
  2 keys with pt-BR draft strings.
- `packages/i18n-catalogs/src/catalogs/es-419.json` gains the same
  2 keys with es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` gain
  `pending: true` entries for each of the 2 new keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green.

### 12. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_target_clear_override` block
  gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_target_clear_override.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_target_clear_override_native_review` is added with the
  template below (effort 0.5d;
  `depends !i18n_target_auto_suggest_native_review`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_target_clear_override_native_review "Native-speaker review of pt-BR + es-419 clear-target gesture strings" {
  effort 0.5d
  allocate team
  depends !i18n_target_auto_suggest_native_review
  note "Source of debt: mod_target_clear_override (this commit) — pt-BR and es-419 drafts of the 2 keys under moderator.captureTargetChip.{clearAria, clearTitle} landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### 13. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Two-affordance gesture: × button (primary) + `Esc` (keyboard fallback)

Three candidate gesture shapes surveyed:

- **A small × button on the chip itself + an Esc keyboard binding**
  (chosen). The button is the discoverable affordance — visible,
  tabbable, mouse/touch reachable; it carries an aria-label and a
  title-tooltip; it's exactly the "one gesture" the task name calls
  for at the surface where the moderator is already looking. The
  Esc binding is the keyboard-power-user fallback: zero hand
  movement off the keyboard during live capture; consistent with
  the moderator UI's keyboard-first ergonomic (per
  `docs/moderator-ui.md:187`). The two affordances reach the same
  internal handler; redundancy is intentional.
- **A keyboard-only binding (Esc or Cmd/Ctrl+.)** — rejected as the
  SOLE affordance. The F1 spec at `docs/moderator-ui.md:45` says
  *"one keystroke OR click clears it"* — both gesture types are
  named in the design doc. A keyboard-only solution leaves
  mouse/touch users without a path. The × button satisfies the
  "click" half of the design clause.
- **Click-on-chip-toggle** (clicking the chip clears the target;
  clicking it again with a node selected re-stages) — rejected.
  The chip is informational; chip-click as a toggle is non-obvious
  and would conflict with a future "click chip to open target node
  detail" affordance the right-sidebar may want. Reserving
  chip-body click for some future "show details" use is
  forward-compatible; using it for clear is a path-of-least-resistance
  that paints over a more useful interaction. The × button
  signals "this is the dismiss affordance" unambiguously.

Both chosen affordances inherit the editable-target guard for free
(Esc via `captureKeymap.ts`'s built-in guard; × button via the fact
that buttons don't fire on incidental focus). No new bail rules are
introduced.

### 2. Override semantics: state-extension via component-local ref, NOT a new store slice

Surveyed:

- **A second component-local `useRef` (`userHasClearedRef`)**
  (chosen). The "did the moderator deliberately clear?" signal is
  ephemeral per-mount UI state, exactly like the predecessor's
  `lastAutoStagedRef`. Both refs live on the chip component because
  the auto-stage effect that reads them is also on the chip. The
  ref is reset on a deliberate selection-change (Case 0
  re-engagement) and on chip unmount; the store stays clean.
- **A new boolean slice on `useCaptureStore`**
  (e.g., `targetEntityIdUserOverridden: boolean`) — rejected.
  Promoting per-instance UI state to the store muddies the store's
  semantics ("server-state-and-form-state" becomes "server-state-and-form-state-and-UI-mode"),
  and the slice would have to be reset on every `reset()` /
  navigation / instance re-mount. The ref handles all those cases
  by virtue of living on the component.
- **Sentinel slice value** (e.g., a special `"__cleared__"` string
  in `targetEntityId`) — rejected. Stringly-typed sentinels break
  the slice's `string | null` contract; downstream readers
  (`mod_propose_action`) would have to filter the sentinel out.
  Refs are type-clean.

The ref's invariants are clear:

- Set to `true` only by the clear handler.
- Reset to `false` by Case 0 of the auto-stage effect when the
  most-recently-active node id changes.
- Reset to `false` implicitly on chip unmount (the ref is
  garbage-collected with the component).

### 3. Esc binding: extend `captureKeymap.ts`'s existing handlers interface

Surveyed:

- **Add `onClearTarget?: () => void` to `CaptureKeymapHandlers`,
  register from the chip via `attachCaptureKeymap`** (chosen). The
  keymap module's header comment (`captureKeymap.ts:60-66`) names
  this exact extension path: optional handlers grow the interface
  one at a time; the listener body grows one branch per handler.
  The chip registers its own handlers object with `onClearTarget`
  set (the palette's handlers object with `onPickKind` set runs
  alongside; both listeners attach independently). The
  ref-then-closure pattern (handlers held in a `useRef`, attached
  once via `useEffect`) survives strict-mode double-mount —
  precisely the pattern the palette already uses.
- **A second standalone keymap module** (e.g.,
  `targetClearKeymap.ts`) — rejected. The capture-pane keymap is a
  single document-level listener concern; one module per gesture
  would fracture the editable-target guard and the modifier-bail
  rule across multiple files. Future capture-flow tasks
  (`mod_propose_action`'s `Cmd+Enter`, exit-mode chords) will join
  the same module.
- **The chip attaches a direct `document.addEventListener('keydown', ...)`
  bypassing `captureKeymap.ts`** — rejected. Duplicates the
  modifier-bail / editable-target / repeat-skip guard the keymap
  module already enforces; would also duplicate the strict-mode
  double-mount handling.

### 4. Re-engagement rule: a NEW node selection re-engages; pane-click and edge-click do NOT

Surveyed:

- **A deliberate selection of a DIFFERENT node** (chosen). The rule
  reads: re-engage when the moderator's deliberate signal of
  intent — clicking a different node on the graph — indicates they
  want to attach to something. The semantics match the F1 spec's
  framing of selection as "where the moderator's focus is."
- **A separate "Reset to suggested" affordance** — rejected. Two
  affordances for "engage auto-suggest" (the implicit "click a
  node" path AND an explicit button) is redundant; the moderator
  has to learn two paths to the same outcome. The implicit path
  flows naturally from the existing canvas-click ergonomic.
- **Re-engage on the SAME node re-selection** (the moderator
  clicks the just-cleared node again to revert) — rejected. The
  most-recently-active node id is unchanged after a clear (no new
  click yet), so a "re-click on the same node" would not fire any
  selection-store update; there's nothing to react to without
  additional plumbing. The clearer rule is "select a different
  node = re-engage", which uses the existing selection-store
  mechanics unchanged.
- **Re-engage on pane-click** — rejected. Pane-click is a hugely
  common incidental gesture (per the predecessor's Decision §5
  trace); using it to re-engage would re-stage every time the
  moderator's pointer crossed empty canvas. Pane-click stays inert
  with respect to the auto-stage path, matching the predecessor's
  pane-click contract.

### 5. Post-clear UI: same empty-state rendering, no "I was cleared" indicator

Surveyed:

- **Same empty-state rendering as initial mount** (chosen). The
  chip in the empty state reads "No target yet" in dimmed text; that
  text is accurate after a clear (no target IS staged yet). Adding
  a visible "I was cleared" indicator (e.g., a "(cleared)"
  suffix or a different empty-state color) would pollute the chip's
  small surface with state that the moderator already knows (they
  just clicked × or pressed Esc themselves). The minimal-UI
  principle wins.
- **A muted "I was cleared (Esc to undo)" indicator** — rejected.
  There is no undo affordance (per the task scope — the override
  semantics are explicit; undo would be a different task). An
  indicator pointing at a non-existent affordance is misleading.
- **A different empty-state palette (e.g., amber instead of
  slate-400)** — rejected. Color-coding "cleared" vs. "initial
  empty" requires the moderator to remember which color means
  what; the chip's surface is too small for a legend. The
  invisible-state approach is simpler and reads correctly: the
  chip says "no target yet"; the moderator's next deliberate
  selection re-engages.

The invisible state lives in the ref; the auto-stage effect reads it.
That's the entire mechanism. The chip surface stays minimal.

### 6. Glyph choice: the `×` multiplication-sign character, not a localized "close" word

Surveyed:

- **The `×` glyph (`×`)** (chosen). Universally read as
  "close / dismiss" across web and native UI conventions; it
  predates the discipline of localization. No translation needed.
  The aria-label and the title supply the localized accessible
  name; the visual is locale-independent.
- **A localized "Limpar" / "Borrar" word button** — rejected.
  Word-based buttons grow with locale (Portuguese "Limpar" is
  longer than English "Clear"; Spanish "Borrar" is a different
  length again); the chip's horizontal budget is tight. A glyph
  is the canonical compact-button affordance.
- **An SVG close-icon** — rejected as over-engineering for one
  button. A unicode glyph at the chip's font-size renders
  identically across platforms; no asset pipeline needed.

The `aria-label` is the load-bearing accessibility surface; the
glyph is purely visual. Same idiom as the override-marker dot
(the predecessor's Decision §1 trace).

### 7. No new ADR

Three potential ADR triggers, all dispatched:

- **"A new keyboard gesture for capture is ADR-worthy."** No — the
  keyboard-shortcut policy is pinned by ADR 0024 and
  `i18n_keyboard_shortcuts_policy.md`. The Esc binding is a
  non-methodology chord and inherits the existing policy; no new
  decision.
- **"The ref-based state-extension pattern is ADR-worthy."** No —
  the predecessor's `lastAutoStagedRef` already established
  component-local ref-as-UI-mode-flag as the idiom for capture-flow
  state that doesn't belong in the store. This task's
  `userHasClearedRef` is the second instance of the same pattern;
  it's an idiom now, not a new decision.
- **"The two-affordance redundancy (button + keyboard) is
  ADR-worthy."** No — the F1 design doc at
  `docs/moderator-ui.md:45` literally says "one keystroke OR click";
  the design intent is for both paths to coexist. This task
  implements the design as-spec'd.

### 8. Native-review follow-up registered, not bundled into this task

Same rationale as the predecessor's Decision §9, the precedent for
every capture-flow sibling: native review is a different skill from
the wiring; the chip is functional without the review (a pt-BR
moderator viewing the draft "Limpar alvo" aria-label hears a
comprehensible label); the native-speaker review chain stays
serializable through `depends !i18n_target_auto_suggest_native_review`.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- × button affordance + `Esc` keyboard gesture both land as the
  two-affordance clear of the staged capture target. Both paths
  call the same `handleClear` handler in
  `apps/moderator/src/layout/CaptureTargetChip.tsx`, which writes
  `null` to `useCaptureStore.targetEntityId` and bumps a new
  per-component `userHasClearedRef` sentinel.
- The auto-stage `useEffect` in `CaptureTargetChip.tsx` grows the
  Case-0 branch the refinement spec'd (checked BEFORE the existing
  no-stomp ref): when `userHasClearedRef.current === true`, the
  effect short-circuits unless the most-recently-active node id
  has changed since the clear (deliberate re-engagement signal),
  per Decision §4.
- `captureKeymap.ts` grows a new `onClearTarget?: () => void`
  field on `CaptureKeymapHandlers` and a sibling `Escape` branch
  in `attachCaptureKeymap`'s `onKeyDown`, gated on the handler
  being registered. The chip consumes the seam via the same
  handler-ref-then-attach `useEffect` pattern
  `<ClassificationPalette>` uses for `onPickKind`. The seam is
  ready for future capture-pane tasks (`mod_propose_action`'s
  `Cmd+Enter`, exit-mode chords) to extend without re-architecting.
- 6 new i18n entries land under the existing
  `moderator.captureTargetChip.*` namespace: `clearAria` and
  `clearTitle` across en-US + pt-BR + es-419
  (`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`),
  with the two non-en-US drafts flagged PENDING in the
  `*.review.json` trackers per the established pattern.
- Vitest case-count delta in
  `apps/moderator/src/layout/CaptureTargetChip.test.tsx` +
  `apps/moderator/src/layout/captureKeymap.test.ts` combined:
  50 → 74 (+24 cases) covering × button render gating, click
  clear, Esc keyboard clear, editable-target Esc bail, modifier
  bail, re-engagement after clear (different node), no
  re-engagement on same-node re-select / pane-click / cleared
  state, override-state clear, plus 2 new keys × 3 locales in
  the parity round-trip loop.
- One new `test()` block in `tests/e2e/moderator-capture.spec.ts`
  exercises the × button click + re-engagement + Esc keyboard
  clear + editable-target Esc bail under the seeded-graph path
  the predecessor's spec established. The
  `chromium-create-session` Playwright project ran 4/4 green.
- Follow-up tech-debt task
  `i18n_target_clear_override_native_review` registered in
  `tasks/35-frontend-i18n.tji` (depends on
  `i18n_target_auto_suggest_native_review` — chain continuation
  for the native-review serialisation).
