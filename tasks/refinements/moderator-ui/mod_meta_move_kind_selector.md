# Moderator meta-move kind selector — reframe / scope-change / stance picker

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_meta_move_flow.mod_meta_move_kind_selector`.

```
task mod_meta_move_kind_selector "Kind selector — reframe / scope-change / stance" {
  effort 0.5d
  allocate team
  depends !mod_meta_move_action
}
```

## Effort estimate

**0.5d.** Confirmed. This is the second-leaf of `mod_meta_move_flow`, sitting on
top of the action spine that
[`mod_meta_move_action`](./mod_meta_move_action.md) already landed (2026-05-31).
The work is small and pattern-bound:

- The slice + setter (`metaMoveKind: MetaMoveKind | null`, `setMetaMoveKind`)
  already exist in `useCaptureStore`
  ([apps/moderator/src/stores/captureStore.ts L583–591](../../../apps/moderator/src/stores/captureStore.ts#L583)).
  The selector consumes the existing slice; **no store change**.
- The placeholder seam is already in place
  ([apps/moderator/src/layout/MetaMoveCapturePanel.tsx L42–54](../../../apps/moderator/src/layout/MetaMoveCapturePanel.tsx#L42)
  — `data-testid="meta-move-kind-selector-placeholder"`); this task replaces
  the `<div>` placeholder with the new `<MetaMoveKindSelector>` component.
- The horizontal-button-row prior art
  ([apps/moderator/src/layout/EdgeRoleSelector.tsx](../../../apps/moderator/src/layout/EdgeRoleSelector.tsx),
  [apps/moderator/src/layout/ClassificationPalette.tsx](../../../apps/moderator/src/layout/ClassificationPalette.tsx))
  carries the styling constants, the toggle-on-click idiom, and the
  `attachCaptureKeymap` + `useRef` ref-then-listener wiring — copy-and-adapt,
  no new abstraction.
- The localized kind labels already live under
  `methodology.annotationKind.{reframe, scope-change, stance}`
  ([packages/i18n-catalogs/src/catalogs/en-US.json L92–97](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L92))
  and ship across all three locales — **no new label keys**, only chrome
  (legend, ariaLabel, shortcutHint, per-button aria-label template).
- The propose validator + `kindMissing` reason key already exist
  ([apps/moderator/src/layout/useMetaMoveAction.ts](../../../apps/moderator/src/layout/useMetaMoveAction.ts),
  [packages/i18n-catalogs/src/catalogs/en-US.json L551](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L551)
  — `kindMissing`) — toggle-off-to-null is already a validated state.

Concretely the deliverable is:

- **One new component**
  `apps/moderator/src/layout/MetaMoveKindSelector.tsx` — three `<button>`
  children in the canonical `META_MOVE_KINDS` order, sharing the
  `SELECTED_CLASSES` / `UNSELECTED_CLASSES` / `KEY_CHIP_CLASSES` constants
  with `<EdgeRoleSelector>` so the bottom-strip reads as a uniform composition.
- **Slot swap** in `MetaMoveCapturePanel.tsx` (lines 42–54) — replace the
  placeholder `<div data-testid="meta-move-kind-selector-placeholder">` with
  `<MetaMoveKindSelector />`.
- **`captureKeymap` extension** — add
  `onPickMetaMoveKind?: (kind: MetaMoveKind) => void` to
  `CaptureKeymapHandlers`; insert the route between the edge-role match (line 234)
  and the F8 match (line 252) of `attachCaptureKeymap`.
- **`packages/i18n-catalogs/src/keyboard-shortcuts.ts` extension** —
  `META_MOVE_KINDS` tuple, `META_MOVE_KIND_TO_SHORTCUT` map (Decision §1
  pins the three letters), `SHORTCUT_TO_META_MOVE_KIND` inverse,
  `getShortcutForMetaMoveKind(kind, locale)` for parity with
  `getShortcutForKind` / `getShortcutForEdgeRole`. The `ShortcutMatrixRow`
  shape gains a `metaMoveKinds` field so the eventual help overlay can
  iterate all three single-select surfaces from one source.
- **New i18n catalog keys** under `moderator.metaMoveKindSelector.*` —
  `legend`, `ariaLabel`, `kindButtonAriaLabel` (ICU template with `{label}` /
  `{key}`), `shortcutHint`. Four chrome keys × three locales = 12 catalog
  entries. Drafts for pt-BR / es-419 land flagged PENDING in the existing
  `*.review.json` trackers (`MetaMoveKindSelector.tsx` reuses
  `methodology.annotationKind.<kind>` labels, so no new label keys).
- **One follow-up native-review task registered** in
  `tasks/35-frontend-i18n.tji` — `i18n_meta_move_kind_selector_native_review`
  (effort 0.5d, depends on the tail of the existing native-review chain).
- **Vitest coverage** under
  `apps/moderator/src/layout/MetaMoveKindSelector.test.tsx` — render, store
  wire (click writes through `setMetaMoveKind`), toggle-off-to-null on
  re-click, keyboard binding (press shortcut → slice updates; re-press
  no-op; modifier-bail / editable-target / repeat-skip inherited from
  `attachCaptureKeymap`), aria-pressed surfacing.
- **Keymap regression** in
  `apps/moderator/src/layout/captureKeymap.test.ts` (or the existing
  `apps/moderator/src/layout/keyboard-shortcuts.test.ts`) — collision-free
  invariant: the meta-move letters are disjoint from `KIND_TO_SHORTCUT`
  AND `EDGE_ROLE_TO_SHORTCUT`. The invariant test mirrors the existing
  kind-vs-role disjointness check.
- **Playwright e2e** — one new short `test()` block in
  `tests/e2e/moderator-capture.spec.ts` (alongside the action task's F8
  block at lines 2509–2625) that drives F8 → press the `c` shortcut →
  assert the `scope-change` button shows `aria-pressed="true"` → propose
  → assert the proposal event carries `meta_kind: 'scope-change'` (not
  the `'reframe'` default).

## Inherited dependencies

Settled:

- **`moderator_ui.mod_meta_move_flow.mod_meta_move_action`** (done —
  2026-05-31). The action task shipped:
  - The `metaMoveKind: MetaMoveKind | null` slice with default `'reframe'`,
    the `setMetaMoveKind(kind)` setter, and the `enterMetaMoveMode()` +
    `exitMetaMoveMode()` actions
    ([captureStore.ts L583–617](../../../apps/moderator/src/stores/captureStore.ts#L583)).
  - The `useMetaMoveAction()` hook whose `canPropose` already gates on
    `metaMoveKind !== null` and whose `validationError` maps to the
    localized `reason.kindMissing` message
    ([packages/i18n-catalogs/src/catalogs/en-US.json L551](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L551)).
  - The `<MetaMoveCapturePanel>` with the
    `data-testid="meta-move-kind-selector-placeholder"` slot
    ([MetaMoveCapturePanel.tsx L42–54](../../../apps/moderator/src/layout/MetaMoveCapturePanel.tsx#L42))
    waiting for this task to fill.
  - The F8 mode-entry binding + `captureKeymap` plumbing
    ([captureKeymap.ts L116–129, L252–256](../../../apps/moderator/src/layout/captureKeymap.ts#L116))
    that this task extends with one more optional handler.
  - The e2e F8 block in `moderator-capture.spec.ts` (lines 2509–2625)
    covering the default-kind path, which this task extends with a
    kind-change cover.
  - Decision §3 of the action refinement (lines 431–455 of
    [mod_meta_move_action.md](./mod_meta_move_action.md)) — defaults to
    `'reframe'` so the propose path is functional ahead of this sibling.
    This task adds the visible UI that lets the moderator pick another
    kind.

- **`tasks/refinements/moderator-ui/mod_edge_role_selector.md`** — the
  closest pattern precedent. Horizontal button row over a small enum,
  shared styling constants, `attachCaptureKeymap` + `useRef` wiring,
  re-click-toggles-off / re-press-no-op asymmetry, English-mnemonic
  shortcuts under ADR 0024. The one deliberate divergence (Decision §2):
  this selector does **not** gate visibility on `targetEntityId` —
  meta-move always carries a kind (default `'reframe'`), and the moderator
  may want to pick the kind before staging the target.

- **`tasks/refinements/moderator-ui/mod_classification_palette.md`** —
  parallel precedent. Five-button row over `MethodologyKind`; the
  shortcut-chip + `aria-pressed` + WCAG-contrast pair this task reuses.

- **`tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md`**
  — the English-mnemonic policy this task follows. The
  `META_MOVE_KIND_TO_SHORTCUT` map lives in
  [`packages/i18n-catalogs/src/keyboard-shortcuts.ts`](../../../packages/i18n-catalogs/src/keyboard-shortcuts.ts)
  alongside the existing kind / role tables.

- **`packages/shared-types/src/events/proposals.ts`**
  ([metaMoveProposalSchema L412–419](../../../packages/shared-types/src/events/proposals.ts#L412))
  — wire payload's `meta_kind: 'reframe' | 'scope-change' | 'stance'` is
  final.

Pending (none — every cross-team contract this task depends on is closed).

## What this task is

The visible kind picker for F8 meta-move capture: a horizontal three-button
row inside the meta-move capture pane that lets the moderator pick
**reframe** / **scope-change** / **stance** with a click or a single
keystroke, writes the choice through `setMetaMoveKind` on the existing
`useCaptureStore`, surfaces selection via `aria-pressed` + a Tailwind
filled-blue / outline variant pair, and renders an English-mnemonic
shortcut chip on each button (`M` / `C` / `T` per Decision §1). The
component is presentation-only beyond the store write: it does NOT emit
any WS message, does NOT validate the meta-move shape, and does NOT touch
the propose round-trip — that's `useMetaMoveAction()`'s job.

## Why it needs to be done

`mod_meta_move_action` shipped the F8 spine with `metaMoveKind` defaulting
to `'reframe'` (Decision §3 of the action refinement). Without this task,
the moderator can propose a meta-move but cannot change its kind — every
meta-move that lands on the wire carries `meta_kind: 'reframe'`. That
collapses the methodology distinction the F8 flow exists to capture:
**reframes** (the question is the operational form of the deeper dispute),
**scope-changes** (defend the typical case, not the edge case), and
**stances** (refuse to press a point on principle) are three distinct
methodological moves per
[docs/methodology.md](../../../docs/methodology.md). Until this task lands,
two of three are unreachable from the UI.

Landing this task closes the gap and lights up F8's full surface; the
remaining `mod_meta_move_flow` sibling
(`mod_meta_move_disputed_visibility`) handles the **commit-time** visibility
of contested meta-moves and is independent of kind-selection.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- [apps/moderator/src/layout/MetaMoveCapturePanel.tsx L42–54](../../../apps/moderator/src/layout/MetaMoveCapturePanel.tsx#L42)
  — the placeholder `<div data-testid="meta-move-kind-selector-placeholder">`
  this task replaces with `<MetaMoveKindSelector />`. The slot sits inside
  the flex row alongside `<CaptureTargetChip>`; mounting the selector here
  preserves the action task's layout commitment.
- [apps/moderator/src/stores/captureStore.ts L583–591](../../../apps/moderator/src/stores/captureStore.ts#L583)
  — `metaMoveKind: MetaMoveKind | null` slice + `setMetaMoveKind(kind)`
  setter the selector reads / writes.
- [apps/moderator/src/stores/captureStore.ts L189](../../../apps/moderator/src/stores/captureStore.ts#L189)
  — `MetaMoveKind = 'reframe' | 'scope-change' | 'stance'` type; the
  canonical enum the selector iterates.
- [apps/moderator/src/layout/EdgeRoleSelector.tsx](../../../apps/moderator/src/layout/EdgeRoleSelector.tsx)
  — closest prior art. Mirror its shape: shared
  `SELECTED_CLASSES` / `UNSELECTED_CLASSES` / `KEY_CHIP_CLASSES` constants,
  re-click-toggles-off / re-press-no-op asymmetry, `useRef` +
  `attachCaptureKeymap` pattern. The deliberate divergence (Decision §2):
  drop the `targetEntityId !== null` gate.
- [apps/moderator/src/layout/ClassificationPalette.tsx](../../../apps/moderator/src/layout/ClassificationPalette.tsx)
  — parallel prior art. Unconditional render, same `aria-pressed` +
  `<kbd>` shortcut-chip composition.
- [apps/moderator/src/layout/captureKeymap.ts L69–129](../../../apps/moderator/src/layout/captureKeymap.ts#L69)
  — `CaptureKeymapHandlers` interface this task extends with
  `onPickMetaMoveKind?`. Routing logic at lines 183–287 — insert the
  meta-move match after the edge-role match (line 234) and before the F8
  match (line 252) so the existing precedence (kind → role → F8 → Escape)
  reads top-to-bottom.
- [packages/i18n-catalogs/src/keyboard-shortcuts.ts L40–200](../../../packages/i18n-catalogs/src/keyboard-shortcuts.ts#L40)
  — shortcut-table conventions. `META_MOVE_KIND_TO_SHORTCUT` lands
  alongside `KIND_TO_SHORTCUT` (lines 70–76) and `EDGE_ROLE_TO_SHORTCUT`
  (lines 156–164); the matrix-row gains a `metaMoveKinds` field for the
  help overlay.
- [packages/i18n-catalogs/src/catalogs/en-US.json L92–97](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L92)
  — `methodology.annotationKind.{reframe, scope-change, stance}` —
  the localized button labels the selector reuses (no new label keys).
- [packages/i18n-catalogs/src/catalogs/en-US.json L537–552](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L537)
  — `moderator.metaMoveAction.reason.kindMissing` — already wired
  validation message that surfaces when `metaMoveKind === null`.
- [tests/e2e/moderator-capture.spec.ts L2509–2625](../../../tests/e2e/moderator-capture.spec.ts#L2509)
  — the action task's F8 e2e block. This task adds one short companion
  block (or extends a kind-press into the existing block — see Decision
  §5) that asserts kind-change reaches the wire envelope.
- [tasks/refinements/moderator-ui/mod_meta_move_action.md](./mod_meta_move_action.md)
  — Decision §3 (defaults to `'reframe'`, sibling adds picker), Decision
  §5 (text slice reuse — irrelevant here; this task does not touch
  `text`), Decision §6 (WireError handling — also irrelevant here; this
  task does not propose).
- [tasks/refinements/moderator-ui/mod_edge_role_selector.md](./mod_edge_role_selector.md)
  — Decision §4 (re-click toggle-off vs re-press no-op) and Decision §7
  (collision-avoidance proof) are the patterns this task mirrors.
- [docs/methodology.md](../../../docs/methodology.md) — the three
  meta-move kinds and what each means; informs button copy decisions.
- [docs/moderator-ui.md L132–141](../../../docs/moderator-ui.md#L132)
  — the F8 narrative this task completes.
- [docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md)
  — drives the Vitest + Playwright layering of acceptance.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — i18n catalog + English-mnemonic shortcut policy.

## Constraints / requirements

- **Wire envelope is unchanged.** This task adds no new message types and
  no new validator rules; it only writes through an existing slice. The
  propose round-trip is `useMetaMoveAction()`'s job.
- **Renders only when `mode === 'meta-move'`** — the slot the selector
  mounts into (`<MetaMoveCapturePanel>`) already self-gates on the mode;
  the selector itself does NOT re-check, mirroring how `<CaptureTextInput>`
  / `<CaptureTargetChip>` work within the panel.
- **No `targetEntityId !== null` visibility gate** (Decision §2 — divergence
  from `<EdgeRoleSelector>`). Meta-move always carries a kind; the picker
  must be reachable before a target is staged, because the moderator
  might pick the kind first and the target second.
- **Click-toggle / press-no-op asymmetry** matches `mod_edge_role_selector`
  Decision §4 / `mod_classification_palette` Decision §4: re-click of the
  currently-selected kind sets the slice to `null` (deliberate undo);
  re-press of the keyboard shortcut for the currently-selected kind is a
  no-op (unintended-bounce protection).
- **Toggle-off to `null` is well-defined.** When `metaMoveKind === null`,
  `useMetaMoveAction.canPropose` is false and the propose button disables
  with the localized `kindMissing` reason. No additional validator work
  required.
- **English-mnemonic shortcut policy** (ADR 0024 +
  `i18n_keyboard_shortcuts_policy`). The three letters
  `M` / `C` / `T` (Decision §1) are locale-independent and surface on each
  button as a `<kbd>` chip alongside the localized label.
- **Editable-target / modifier-bail / repeat-skip discipline** is inherited
  from `attachCaptureKeymap`. The new `onPickMetaMoveKind` route does
  not re-implement the guards.
- **Shortcut collision invariant.** The
  `META_MOVE_KIND_TO_SHORTCUT` letters must be disjoint from both
  `KIND_TO_SHORTCUT` (`f`/`p`/`v`/`n`/`d`) and `EDGE_ROLE_TO_SHORTCUT`
  (`s`/`r`/`q`/`b`/`g`/`e`/`x`). A regression test pins the invariant
  (Acceptance §7).
- **Reuse existing label catalog.** Button labels read
  `methodology.annotationKind.<kind>`
  ([en-US.json L92–97](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L92))
  — no new `metaMoveKind.<kind>.label` keys minted. Only chrome keys
  (legend, ariaLabel, shortcutHint, kindButtonAriaLabel) land under
  `moderator.metaMoveKindSelector.*`.
- **i18n catalog parity** must remain green after the four new chrome keys
  land. Drafts for pt-BR / es-419 ride flagged PENDING in `*.review.json`;
  en-US is authoritative. One native-review follow-up task registered
  (Acceptance §8).
- **No store-shape change.** The `metaMoveKind` slice and its setter
  already exist (action task). This task wires existing surface.
- **No regressions** to the action task's F8 e2e block; the kind-change
  block sits alongside it.

## Acceptance criteria

(Reference [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)
— each layer below pins durable behavior; no throwaway scripts.)

1. **`<MetaMoveKindSelector>` component** lives at
   `apps/moderator/src/layout/MetaMoveKindSelector.tsx`. Renders three
   `<button>` children in `META_MOVE_KINDS` order (`reframe`,
   `scope-change`, `stance`). Each button:
   - Carries a stable `data-testid` of the form
     `meta-move-kind-selector-button-<kind>` and a `data-kind="<kind>"`
     attribute (mirrors `<EdgeRoleSelector>` testids).
   - Shows the localized `methodology.annotationKind.<kind>` label.
   - Shows a `<kbd>` chip with the uppercase shortcut letter from
     `META_MOVE_KIND_TO_SHORTCUT`.
   - Surfaces selection via `aria-pressed` AND a Tailwind variant pair
     (filled blue when selected, outline when not), reusing
     `SELECTED_CLASSES` / `UNSELECTED_CLASSES` / `KEY_CHIP_CLASSES` from
     the existing selector files OR a shared constants module.
   - Renders `role="group"` with `aria-label` from
     `moderator.metaMoveKindSelector.ariaLabel`.
   - Renders an `sr-only` legend from
     `moderator.metaMoveKindSelector.legend` and a `text-xs text-slate-500`
     shortcut-hint paragraph from
     `moderator.metaMoveKindSelector.shortcutHint`.
   Vitest pins render, store-wire (click writes through
   `setMetaMoveKind`), toggle-off-to-null on re-click of the selected
   kind, and selection rendering across all three kinds.

2. **No visibility gate.** The component renders even when
   `targetEntityId === null`. Vitest pins the unconditional render
   (deliberate divergence from `<EdgeRoleSelector>` — Decision §2).

3. **`MetaMoveCapturePanel` slot swap.** The placeholder `<div>` at
   `apps/moderator/src/layout/MetaMoveCapturePanel.tsx` lines 42–54 is
   replaced with `<MetaMoveKindSelector />`. The
   `data-testid="meta-move-kind-selector-placeholder"` is removed; the
   selector's own testids take over. Vitest extends
   `MetaMoveCapturePanel.test.tsx` to assert the selector mounts inside
   the panel when `mode === 'meta-move'`.

4. **`captureKeymap` extension.** `CaptureKeymapHandlers` gains
   `onPickMetaMoveKind?: (kind: MetaMoveKind) => void`. The new route
   sits between the edge-role match (line 234) and the F8 match (line
   252) of `attachCaptureKeymap`. It dispatches via a new
   `SHORTCUT_TO_META_MOVE_KIND` inverse-table lookup, calls
   `event.preventDefault()` on match, and inherits the modifier-bail /
   repeat-skip / editable-target guards already applied above.
   `captureKeymap.test.ts` pins: a meta-move-kind keystroke dispatches
   through `onPickMetaMoveKind`; editable-target / modifier-bail /
   repeat-skip cases bail (NO dispatch); a shortcut with no registered
   handler is a no-op.

5. **Selector wires the keymap.** `<MetaMoveKindSelector>` registers an
   `onPickMetaMoveKind` handler via `attachCaptureKeymap` in a
   `useEffect`, holding the latest `selected` + `setMetaMoveKind` in a
   `useRef` (mirrors `<EdgeRoleSelector>` lines 86–110). The handler
   no-ops when the pressed kind is already selected (re-press skip
   asymmetry — Decision §3). Vitest pins success-path dispatch + re-press
   no-op + strict-mode double-mount survival.

6. **Shortcut table lands.**
   `packages/i18n-catalogs/src/keyboard-shortcuts.ts` gains:
   - `META_MOVE_KINDS = ['reframe', 'scope-change', 'stance'] as const`
     tuple + `MetaMoveKind` type (re-exported to match the existing
     pattern; the runtime literal is the source of truth, the
     `captureStore.MetaMoveKind` type stays the consumer alias).
   - `META_MOVE_KIND_TO_SHORTCUT: Readonly<Record<MetaMoveKind, string>>`
     with `reframe: 'm'`, `scope-change: 'c'`, `stance: 't'` (Decision §1).
   - `SHORTCUT_TO_META_MOVE_KIND` inverse map materialised at module
     load.
   - `getShortcutForMetaMoveKind(kind, locale)` for parity with
     `getShortcutForKind` / `getShortcutForEdgeRole`.
   - `ShortcutMatrixRow` gains a `metaMoveKinds` field so the eventual
     help overlay can iterate all three single-select surfaces from one
     source.
   `keyboard-shortcuts.test.ts` pins the totality (3-kind × 3-locale
   coverage) and pins the cross-table disjointness invariant: the
   meta-move letters are disjoint from BOTH `KIND_TO_SHORTCUT` and
   `EDGE_ROLE_TO_SHORTCUT`.

7. **Shortcut-collision regression.** A test in
   `keyboard-shortcuts.test.ts` (or `captureKeymap.test.ts`) asserts that
   the union of the three shortcut tables forms an injection — every
   single-letter key resolves to at most one (kind | role | meta-move-kind).
   A future edit that introduces a collision fails the suite.

8. **i18n catalog keys land** under `moderator.metaMoveKindSelector.*`:
   `legend`, `ariaLabel`, `kindButtonAriaLabel` (ICU template
   `'{label} (shortcut: {key})'`), `shortcutHint`. Four keys × three
   locales = 12 catalog entries. The pt-BR / es-419 entries land flagged
   PENDING in `*.review.json`; the catalog-parity Vitest stays green.

9. **Native-review follow-up registered.**
   `tasks/35-frontend-i18n.tji` carries a new
   `i18n_meta_move_kind_selector_native_review` task (effort 0.5d, depends
   on the tail of the existing native-review chain — currently
   `!i18n_meta_move_action_native_review`). Closer registers in the WBS
   under the i18n-translation milestone.

10. **Playwright e2e — kind-change cover.** A new short `test()` block
    in `tests/e2e/moderator-capture.spec.ts` (sibling to the action
    task's F8 block at lines 2509–2625) drives the kind-change path:
    login → create session → seed node → F8 → press the `c` shortcut →
    assert `getByTestId('meta-move-kind-selector-button-scope-change')`
    reports `aria-pressed="true"` → type content → press Cmd/Ctrl+Enter
    → assert one `proposal` event with `kind: 'meta-move'` AND
    `meta_kind: 'scope-change'` (not the `'reframe'` default) reaches
    `useWsStore.sessionState[sessionId].events` via `expect.poll`.
    Skips gracefully if `window.__aConversaWsStore` is unreachable,
    matching the existing block's discipline. **E2e is in scope, NOT
    deferred** — the F8 mode and the kind picker are user-reachable
    via the keyboard binding; UI-stream "default — e2e is in scope"
    policy applies.

11. **No regressions to the action task's F8 block.** The existing
    block at lines 2509–2625 of `moderator-capture.spec.ts` (which
    proposes with the default `'reframe'` kind) remains untouched and
    green.

12. **Build + test green.** `make build && make test` clean; the
    catalog-parity, Vitest, and Playwright suites all pass.

13. **Refinement `## Status`** block appended on landing, per the
    task-completion ritual ([tasks/refinements/README.md L32–42](../README.md#L32)).

## Decisions

### §1 — Shortcut letters: `reframe`→`m`, `scope-change`→`c`, `stance`→`t`

Picks under the English-mnemonic policy (ADR 0024 +
`i18n_keyboard_shortcuts_policy`), verified non-colliding against
`KIND_TO_SHORTCUT` (`f`/`p`/`v`/`n`/`d`) AND
`EDGE_ROLE_TO_SHORTCUT` (`s`/`r`/`q`/`b`/`g`/`e`/`x`):

- **`reframe` → `m`** — `r`, `e`, `f` are all taken (rebuts / defines /
  fact). `m` for "re**m**ap" / "re**m**odel"; the mnemonic is one step
  removed from "reframe" but the letter is free and visually distinct.
  Same kind of second-best-letter pick as `defines → e` in
  `EDGE_ROLE_TO_SHORTCUT` (`d` was taken by `definitional`).
- **`scope-change` → `c`** — `s` is taken (supports). `c` is the first
  letter of "**c**hange", the action verb the moderator is selecting.
  First-letter mnemonic of the rightmost word.
- **`stance` → `t`** — `s` is taken. `t` is the second letter of
  "s**t**ance"; same fallback pattern as `defines → e` / `bridges-to →
  g`. The `t` chip on the button reads naturally to operators trained
  on the existing edge-role second-letter convention.

**Rationale.** The letters must be (a) collision-free across both
existing tables, (b) recognisable when the operator sees `<KEY>:
<localized label>` in the help overlay, and (c) reachable on every
QWERTY keyboard without modifiers. `m` / `c` / `t` satisfy all three.

**Alternative rejected.** `reframe → i` (for "**i**nterpretation
shift"). Loses the "re-" prefix that ties the letter to the meta-move
mental model; `m` keeps a "re-X" connection ("re**m**ap").

**Alternative rejected.** `stance → a` (for "**a**ttitude"). Conflates
the methodological meaning (a refusal) with a psychological one; the
second-letter pick is more honest to the term.

**Alternative rejected.** Number keys (`1`/`2`/`3`). Easier to pick
collision-free but breaks the English-mnemonic policy uniformly applied
to `KIND_TO_SHORTCUT` and `EDGE_ROLE_TO_SHORTCUT`. The bottom-strip
single-select surfaces should read as one composition; a number-keyed
selector would jar.

### §2 — No `targetEntityId !== null` visibility gate (divergence from EdgeRoleSelector)

`<MetaMoveKindSelector>` renders unconditionally inside
`<MetaMoveCapturePanel>` regardless of whether a target node is staged.
This is a deliberate divergence from `<EdgeRoleSelector>` (which early-returns
`null` when no target is staged — see
[EdgeRoleSelector.tsx L121–127](../../../apps/moderator/src/layout/EdgeRoleSelector.tsx#L121)).

**Rationale.** The edge-role semantics ("role on the edge connecting to
a target") have no meaning without a target — there is no role to pick.
Meta-move kind semantics are independent of the target: a reframe is a
reframe whether the moderator has staged the target node yet or not.
Hiding the kind picker until a target is staged would force a sequencing
the methodology does not require (target-first); operators may want to
pick the kind first while their attention is still on the methodology
choice. The action task's `metaMoveKind` default
([action refinement Decision §3](./mod_meta_move_action.md)) already
treats kind as orthogonal to target — preserving that orthogonality in
the picker is the consistent move.

**Alternative rejected.** Mirror `<EdgeRoleSelector>`'s gate exactly
for stylistic uniformity. Optimises for sibling-symmetry over operator
ergonomics; the bottom-strip is the moderator's tool, not a code
museum.

### §3 — Re-click toggles to `null`; re-press is no-op (asymmetry mirrors prior art)

A click on the currently-selected kind sets the slice to `null` (the
"undo" gesture, surfaces the `kindMissing` validation reason and
disables propose). A keyboard re-press of the currently-selected kind's
shortcut is a no-op (the unintended-bounce protection).

**Rationale.** The asymmetry is settled prior art in
[`mod_classification_palette.md`](./mod_classification_palette.md)
Decision §4 and
[`mod_edge_role_selector.md`](./mod_edge_role_selector.md) Decision §4:
re-press is more often an unintended hold/bounce than a deliberate undo;
re-click is a deliberate gesture. The moderator's muscle memory for the
F1 surfaces carries over to F8 with no friction. Diverging here would
fragment the operator model across the three single-select surfaces
that share the bottom strip.

**Alternative rejected.** Lock the slice — never let it go null
because the action task ships with `'reframe'` as the default. Breaks
the validation surface: the `kindMissing` reason key already exists,
suggesting null is a supported state. More importantly, the moderator
who wants to opt OUT of meta-moving (e.g. exits via Esc, returns later)
shouldn't have to step through an unwanted kind.

### §4 — Reuse `methodology.annotationKind.<kind>` labels — no new label keys

Button labels come from the existing
`methodology.annotationKind.{reframe, scope-change, stance}` entries
([en-US.json L92–97](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L92))
rather than minting new `moderator.metaMoveKindSelector.kindLabel.<kind>`
keys.

**Rationale.** The three meta-move kinds ARE annotation kinds — when a
meta-move commits, the engine produces an annotation of the matching
kind on the target entity. The label is "Reframe" / "Scope change" /
"Stance" in both surfaces (the picker and the rendered annotation chip);
minting a parallel key for the picker risks the two surfaces drifting
out of sync (one localizer updates "Reframe" in one place and not the
other). Sharing the key keeps the methodology vocabulary single-sourced.

**Alternative rejected.** Mint `moderator.metaMoveKindSelector.kindLabel.<kind>`
for surface isolation. Pure duplication; the label is intentionally the
same word.

### §5 — Add one new short `test()` block; do NOT mutate the action task's block

The Playwright kind-change e2e lands as a **new** `test()` block sibling
to the action task's F8 block (lines 2509–2625) in
`tests/e2e/moderator-capture.spec.ts`, NOT as a mutation of the existing
block.

**Rationale.** The action task's block pins the default-`'reframe'`
path; mutating it to test a different kind weakens the default-kind
regression. Two blocks is the right shape: one pins the action-task
guarantee (propose-with-default-kind reaches the wire), the other pins
this task's guarantee (kind-shortcut updates the slice and the chosen
kind reaches the wire). The two blocks share the login / create-session
/ seed-node setup via the existing `seedWsStore` helper; no duplication
of substantive boilerplate.

**Alternative rejected.** Parameterize a single block over a `kind`
list. Hides the regression intent of each block behind a loop and makes
test-output diffs harder to read; the precedent across
`moderator-capture.spec.ts` is one `test()` per discrete user journey.

### §6 — No `<MetaMoveKindSelector>` participant-list extension

Like `<EdgeRoleSelector>` and `<ClassificationPalette>`, this selector
does NOT consult the participants store; it has no per-participant gate.

**Rationale.** The meta-move propose path
(per [`meta_move_logic`](../data-and-methodology/meta_move_logic.md))
has only target-exists and target-visible rules — no participant scope.
Mirrors Decision §8 of the action refinement.

### §7 — Place new keymap route between edge-role and F8 (not at the top, not at the bottom)

The new `onPickMetaMoveKind` route in `attachCaptureKeymap` sits **after**
the edge-role match and **before** the F8 match in the dispatch order.

**Rationale.** Routing precedence follows the cost / specificity
ordering already in place: cheapest matches first (kind / role single
letters via O(1) inverse-table lookup), then specific function keys
(F8), then Escape (the most context-dependent branch). Inserting the
meta-move kind route here keeps the file readable top-to-bottom — all
single-letter shortcut matches in one contiguous region, then the
non-letter routes below. No alternative would be cleaner; this is the
mechanical default.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- Created `apps/moderator/src/layout/MetaMoveKindSelector.tsx` — three-button row (reframe `M` / scope-change `C` / stance `T`) rendering unconditionally inside `<MetaMoveCapturePanel>` with click-toggle / re-press-no-op asymmetry and `aria-pressed` + Tailwind variant pair.
- Created `apps/moderator/src/layout/MetaMoveKindSelector.test.tsx` — Vitest covering render structure, store wire (click → `setMetaMoveKind`), toggle-off-to-null on re-click, keyboard binding, listener lifecycle, i18n parity.
- Extended `apps/moderator/src/layout/MetaMoveCapturePanel.tsx` — replaced `data-testid="meta-move-kind-selector-placeholder"` `<div>` with `<MetaMoveKindSelector />`.
- Extended `apps/moderator/src/layout/MetaMoveCapturePanel.test.tsx` — testid swap asserting selector mounts inside panel.
- Extended `apps/moderator/src/layout/captureKeymap.ts` — `onPickMetaMoveKind` handler + `SHORTCUT_TO_META_MOVE_KIND` inverse table + route between edge-role and F8 matches.
- Extended `apps/moderator/src/layout/captureKeymap.test.ts` — inverse-table, handler dispatch, three-way coexistence, modifier-bail / repeat-skip / editable-target cases.
- Extended `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — `META_MOVE_KINDS` tuple, `META_MOVE_KIND_TO_SHORTCUT`, `SHORTCUT_TO_META_MOVE_KIND`, `getShortcutForMetaMoveKind`, `ShortcutMatrixRow.metaMoveKinds` field.
- Extended `packages/i18n-catalogs/src/keyboard-shortcuts.test.ts` — 3-kind × 3-locale totality, cross-table disjointness, 3-way injection invariant.
- Extended `packages/i18n-catalogs/src/index.ts` — barrel re-exports for new symbols.
- Added 4 chrome keys under `moderator.metaMoveKindSelector.*` to `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; pt-BR / es-419 entries flagged PENDING in `*.review.json` trackers.
- Added Playwright e2e block to `tests/e2e/moderator-capture.spec.ts` — F8 → press `c` → `aria-pressed="true"` on scope-change button → propose → `meta_kind: 'scope-change'` on wire.
