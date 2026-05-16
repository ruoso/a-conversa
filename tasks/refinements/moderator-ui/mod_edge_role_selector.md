# Moderator capture-pane edge-role selector for connecting to existing structure

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_edge_role_selector`.

```
task mod_edge_role_selector "Edge role selector for connecting to existing structure" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. The deliverable is component + store-slice extension +
keymap extension + i18n + tests on top of seams already in place:

- `<BottomStripCapture>` exposes an `edgeRoleSelector` render-prop slot
  keyed to the stable `bottom-strip-edge-role` `data-testid`
  (`apps/moderator/src/layout/BottomStripCapture.tsx:46-47, 80-85`).
  The slot is currently filled by `<CaptureTargetChip>` per
  `mod_target_auto_suggest`'s Decision §8; this task adds a second
  surface composed alongside the chip via the wrapper pattern that
  decision pre-authorised (see Decisions §1 below).
- `useCaptureStore` already carries `text`, `classification: StatementKind | null`,
  `targetEntityId: string | null`, `mode` slices with corresponding
  setters and a `reset()` (`apps/moderator/src/stores/captureStore.ts:41-77`).
  This task adds a fifth slice — `edgeRole: EdgeRole | null` — and a
  paired `setEdgeRole(role)` setter alongside the existing four.
- `captureKeymap.ts` exposes `CaptureKeymapHandlers` with optional
  `onPickKind` and `onClearTarget` handlers
  (`apps/moderator/src/layout/captureKeymap.ts:62-76`). The module's
  header comment already names "future: `onSubmit?`, `onExitMode?`,
  `onDecompose?`"; this task adds `onPickEdgeRole?: (role: EdgeRole) => void`
  alongside, mirroring the precedent set by `onClearTarget`'s landing
  in `mod_target_clear_override`.
- `<ClassificationPalette>` is the canonical precedent for the
  structural shape (single-select horizontal button row +
  shared-store-backed selection + `attachCaptureKeymap` wire +
  per-locale parity round-trip + Vitest case set)
  (`apps/moderator/src/layout/ClassificationPalette.tsx:1-159`). This
  task mirrors that structure for the seven edge roles.
- `methodology.edgeRole.<role>.label` already resolves the seven roles
  (`supports`, `rebuts`, `qualifies`, `bridges-from`, `bridges-to`,
  `defines`, `contradicts`) across all three v1 locales via the
  `i18n_methodology_glossary` + `i18n_methodology_role_descriptions`
  catalogs (`packages/i18n-catalogs/src/catalogs/en-US.json:37-66`;
  same shape in pt-BR.json and es-419.json). The component consumes
  `t(\`methodology.edgeRole.${role}.label\`)` directly.
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419
  drafts is established by every sibling capture-flow task
  (`mod_capture_text_input`, `mod_classification_palette`,
  `mod_target_auto_suggest`, `mod_target_clear_override`).

Concretely the deliverable is:

- **One new component** `apps/moderator/src/layout/EdgeRoleSelector.tsx`
  — horizontal button row, one button per `EdgeRole`, bound to the new
  `useCaptureStore.edgeRole` slice. Renders **only when**
  `targetEntityId !== null` (Decision §2); when `targetEntityId` is
  `null`, the component returns `null` so the slot collapses to the
  chip alone.
- **One new shared seam** — `EDGE_ROLES` literal-tuple + `EdgeRole`
  type re-export — added to `@a-conversa/i18n-catalogs`'s public
  surface so consumers (the selector, future palette help overlay,
  `mod_propose_action`) reuse one enumeration in canonical order
  (Decision §6).
- **One small wrapper** `apps/moderator/src/layout/CaptureTargetAndRole.tsx`
  composing `<CaptureTargetChip />` and `<EdgeRoleSelector />` into
  the `edgeRoleSelector` slot, per the composition path
  `mod_target_auto_suggest` Decision §8 pre-authorised. The wrapper is
  one small component that owns the two-surface layout inside the
  shared slot.
- **A small `captureStore` extension**: `edgeRole: EdgeRole | null`
  slice + `setEdgeRole(role)` setter + `reset()` updated to clear the
  new slice + initial-state extension. The new setter coexists with
  the existing four setters; no public-contract change.
- **A small `captureKeymap` extension**: one new optional
  `onPickEdgeRole?: (role: EdgeRole) => void` handler on
  `CaptureKeymapHandlers`; one new branch in `attachCaptureKeymap`'s
  `onKeyDown` for the new shortcut letters; one new `SHORTCUT_TO_EDGE_ROLE`
  reverse table materialised at module load.
- **Coupled clear**: clearing the target (× button or `Esc` via
  `mod_target_clear_override`'s `handleClear`) also clears the new
  `edgeRole` slice (Decision §5). The implementation extends the
  chip's existing `handleClear` callback to also call
  `setEdgeRole(null)`.
- **Vitest cases** under
  `apps/moderator/src/layout/EdgeRoleSelector.test.tsx`,
  extensions to `apps/moderator/src/layout/captureKeymap.test.ts`,
  and an extension to `apps/moderator/src/layout/CaptureTargetChip.test.tsx`
  for the coupled-clear regression (Acceptance criteria below).
- **One new `test()` block** extending `tests/e2e/moderator-capture.spec.ts`
  under the seeded-graph path the predecessor specs established.
- **6 new i18n catalog keys × 3 locales = 18 new catalog entries**
  for the palette chrome (the seven per-role aria-labels are composed
  via the existing `methodology.edgeRole.<role>.label` glossary entry
  plus the new ICU template; the visible labels reuse the glossary
  directly). Scoped under a new `moderator.edgeRolePalette.*`
  namespace.
- **1 follow-up tech-debt task registered** in
  `tasks/35-frontend-i18n.tji` for the native-speaker review of the
  12 new pt-BR / es-419 draft entries
  (`i18n_edge_role_selector_native_review`, effort 0.5d,
  `depends !i18n_target_clear_override_native_review`).
- **One-line wire-up** in `apps/moderator/src/routes/Operate.tsx`:
  pass `<CaptureTargetAndRole />` into `<BottomStripCapture>`'s
  `edgeRoleSelector` slot, replacing the current direct
  `<CaptureTargetChip />` wire (Decision §1).

This is **the last leaf blocking `mod_propose_action`**. The propose
action's `depends !mod_capture_text_input, !mod_classification_palette,
!mod_edge_role_selector` line at `tasks/30-moderator-ui.tji:290` closes
once this task lands.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_capture_flow`** parent block's `depends` line
  (`tasks/30-moderator-ui.tji:241`) —
  `!mod_layout, !mod_graph_rendering, backend.websocket_protocol.ws_propose_message`
  — every leaf is done. `!mod_layout` covers
  `mod_bottom_strip_capture` (the slot scaffold) and `mod_mode_banner`;
  `!mod_graph_rendering` covers `mod_edge_rendering` (the canvas-side
  role rendering this task is the capture-side counterpart for);
  `ws_propose_message` matters for `mod_propose_action` downstream,
  not this task (the selector emits no WS message).
- **`moderator_ui.mod_capture_flow.mod_target_auto_suggest`** (done
  — 2026-05-15, commit `21ff9ec`). Shipped the `<CaptureTargetChip>`
  component and its mount into the `edgeRoleSelector` slot. The
  chip's Decision §8 pre-authorised the slot-sharing composition
  path this task implements via the `<CaptureTargetAndRole>` wrapper.
  The `targetEntityId !== null` guard for selector visibility reads
  the same slice the chip's auto-stage effect writes.
- **`moderator_ui.mod_capture_flow.mod_target_clear_override`** (done
  — 2026-05-15). Shipped the `× button` + `Esc` clear gesture and
  the extended `handleClear` callback in `<CaptureTargetChip>`. This
  task extends that callback's body to also clear the new
  `edgeRole` slice (Decision §5); the chip's exported handler stays
  the single clear-write seam.
- **`moderator_ui.mod_capture_flow.mod_classification_palette`** (done
  — commit `21ff9ec`'s parent). Established
  `<ClassificationPalette>` as the structural precedent and shipped
  `captureKeymap.ts` with `attachCaptureKeymap` +
  `CaptureKeymapHandlers` (`apps/moderator/src/layout/captureKeymap.ts:62-76`).
  This task adds `onPickEdgeRole?` alongside the existing
  `onPickKind?` + `onClearTarget?` handlers.
- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done
  — commit `1499ca0`'s parent). Owns the textarea + the
  editable-target guard in `captureKeymap.ts:127-132` that the new
  shortcuts inherit for free (typing role letters into the wording
  textarea does NOT flip the selector).
- **`moderator_ui.mod_state_management`** (done —
  `apps/moderator/src/stores/captureStore.ts:41-77` declares the
  store contract this task extends with one more slice).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done —
  exposes the `edgeRoleSelector` render-prop slot the new wrapper
  mounts into; `BottomStripCapture.tsx:46-47, 80-85`).
- **`moderator_ui.mod_graph_rendering.mod_edge_rendering`** (done —
  commit prior to `21ff9ec`). The canvas-side counterpart: every
  edge in the graph carries an `EdgeRole` and renders its localized
  label via `t(\`methodology.edgeRole.${role}\`)` (and now
  `.label`). This task is the capture-pane mirror — the selector
  stages the role the propose action will later emit on the
  edge-created event.
- **`frontend_i18n.i18n_methodology_glossary`** (done — 2026-05-11).
  Landed `methodology.edgeRole.{supports, rebuts, qualifies,
  bridges-from, bridges-to, defines, contradicts}` initially as
  bare-label strings, then migrated to `{label, description}` shape
  via `i18n_methodology_role_descriptions` (done — commit landed
  the 21 role-description strings + the JSON shape migration). The
  seven roles already resolve their localized labels in all three
  v1 locales; this task consumes
  `t(\`methodology.edgeRole.${role}.label\`)` directly. The
  pt-BR / es-419 entries remain PENDING in the glossary's own
  review chain.
- **`frontend_i18n.i18n_methodology_role_descriptions`** (done —
  commit `8aa3cd7`). Landed the seven `.description` entries that
  the selector could surface as button tooltips. Decision §8
  records the call to surface the description on the button's
  `title` attribute for hover discoverability, mirroring the
  hover-popover seam `mod_edge_popover_full_target_wording` opened.
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done —
  commit landed `KIND_TO_SHORTCUT` + `getShortcutForKind` +
  `KEYBOARD_SHORTCUT_POLICY = 'english-mnemonic'`). The policy is
  english-mnemonic / locale-independent; this task adds a parallel
  table for edge roles (`EDGE_ROLE_TO_SHORTCUT`) under the same
  policy. Decision §7 records the per-role mnemonic picks.
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()`, the
  parity-check script, the `*.review.json` PENDING-flag lifecycle,
  the per-locale parity round-trip test pattern are all in place;
  new keys flow through the same pipeline).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done
  — commit `05f7d67`). The operate route is reachable via
  `/sessions/new` → `POST /api/sessions` → `/sessions/<id>/operate`.
  The selector is reachable from a real user flow, which is what
  makes the Playwright e2e the non-deferred default per the
  UI-stream e2e policy.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new component consumes; the
  english-mnemonic / locale-independent shortcut policy pinned in
  the ADR's Consequences section.

Pending edges (this task does NOT depend on them; this task FEEDS them):

- **`moderator_ui.mod_capture_flow.mod_propose_action`** —
  downstream. Depends on
  `!mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector`
  per the WBS (`tasks/30-moderator-ui.tji:290`). Will read all four
  capture-store slices (`text`, `classification`, `targetEntityId`,
  `edgeRole`), validate that `targetEntityId !== null` implies
  `edgeRole !== null`, emit the multi-event bundle (`node-created` +
  `proposal: classify-node` + optional `edge-created` +
  `proposal: set-edge-substance` per `docs/moderator-ui.md:46`), and
  call `useCaptureStore.getState().reset()` on success (the reset
  this task extends clears the new slice too).
- **`moderator_ui.mod_keymap_help_overlay`** — future. Will consume
  `EDGE_ROLE_TO_SHORTCUT` (this task's new export) alongside
  `KIND_TO_SHORTCUT` to render `<KEY>: <localized label>` per role.
  This task ships the table; the overlay consumes it.
- **`moderator_ui.mod_capture_flow.mod_draw_edge_flow`** (deferred —
  not in v1 per the F4 capture flow's "Pick the edge role from a
  palette that appears on drop"). When that flow lands, it will
  reuse `<EdgeRoleSelector>` or a small variant. This task does
  NOT pre-couple to F4's drop-palette ergonomic.
- **`frontend_i18n.i18n_edge_role_selector_native_review`**
  (registered by this task — see Acceptance criteria / Decisions).
  The pt-BR / es-419 drafts of the 6 new palette-chrome keys land
  flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text.

## What this task is

Land the horizontal-button-row selector that stages the edge **role**
(the methodology argument-role label) when the moderator is connecting
a new statement to an existing target. The component:

1. **Renders seven buttons**, one per `EdgeRole` value in the canonical
   `EDGE_ROLES` order (`supports`, `rebuts`, `qualifies`,
   `bridges-from`, `bridges-to`, `defines`, `contradicts`). Each
   button shows the localized
   `methodology.edgeRole.<role>.label` text plus a small
   `<kbd>` chip showing the english-mnemonic shortcut from
   `EDGE_ROLE_TO_SHORTCUT[role]` (Decision §7 below) in uppercase.

2. **Renders only when `targetEntityId !== null`** (Decision §2). When
   the capture store's `targetEntityId` is `null`, the selector
   returns `null` and contributes no DOM. The semantic match for
   "edge role" is "role on the edge connecting to a target" — there
   is no role to pick when there's no target. The chip is the
   target's surface; the selector is the role's surface; both share
   the `bottom-strip-edge-role` slot and the role half collapses when
   irrelevant.

3. **Reads** `edgeRole` from `useCaptureStore` and **writes** via
   `setEdgeRole(role)` on click — a shared-store-backed
   single-select group, NOT component-local state. Mutually exclusive
   selection: clicking `rebuts` after `supports` was selected calls
   `setEdgeRole('rebuts')`, which overwrites the slice; only one
   role is ever picked.

4. **Toggles off on re-click**: clicking the currently-selected role
   calls `setEdgeRole(null)` so the moderator can clear the picked
   role without keyboard. Mirrors the classification palette's
   Decision §4 (click toggles off, keyboard re-press is a no-op).

5. **Wires a global `keydown` listener** via `attachCaptureKeymap`
   that fires the same `setEdgeRole(role)` when the moderator
   presses the role's mnemonic key. The listener inherits the
   palette's modifier-bail / editable-target / repeat-skip guards
   for free (the new branch sits inside the same `onKeyDown` body
   that the kind branch and the Escape branch already share). The
   listener:
   - matches on `event.key.toLowerCase()` so caps-lock + shift don't
     break the binding;
   - is **ignored** when focus is on an editable element (typing role
     letters into the wording textarea does NOT flip the selector);
   - is **ignored** when any modifier other than shift is held;
   - is **ignored** when `targetEntityId === null` (Decision §3 — the
     keyboard binding mirrors the visibility gate);
   - calls `event.preventDefault()` on a match so the keystroke is
     consumed by the selector and does not bubble further.

6. **Surfaces visual selection state** via two channels: each
   button's `aria-pressed` attribute (`true` for the selected role,
   `false` for every other), and a distinct Tailwind variant (filled
   blue background + stronger border for the selected role;
   outline-only for unselected roles). WCAG AA contrast holds in
   both states — same color tokens the classification palette uses
   (Decision §5 of `mod_classification_palette` already pinned).

7. **Exposes** the wrapper aria-label
   (`moderator.edgeRolePalette.ariaLabel`,
   "Edge role — pick how the new statement connects to the target"),
   the per-button aria-label
   (`moderator.edgeRolePalette.roleButtonAriaLabel`,
   `"{label} ({key})"` so a screen-reader user hears
   `"Supports (S)"` / `"Apoia (S)"`), the per-button title attribute
   (the localized
   `methodology.edgeRole.<role>.description` for hover discoverability
   — Decision §8), the key-chip aria-hidden text (the visible
   mnemonic glyph), the shortcut-hint helper line
   (`moderator.edgeRolePalette.shortcutHint`,
   `"Or press S / R / Q / B / G / E / X"`), and the wrapper-role
   legend — see "i18n catalog keys" below.

8. **Does NOT** emit any WS message, does NOT validate methodology
   shape, does NOT touch any pane other than its own half of the
   shared slot. It is a single-select button group; the propose
   round-trip is `mod_propose_action`'s job.

The task is the **third and last** store-reading input in the bottom
strip (`mod_capture_text_input` first, `mod_classification_palette`
second, `mod_target_auto_suggest` + `mod_target_clear_override` fill
the target half of this same slot, and `mod_propose_action` is the
consumer that reads all four slices and emits the proposal bundle).

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_propose_action` cannot land without it.** The propose
   action depends on
   `!mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector`
   (`tasks/30-moderator-ui.tji:290`). The three sibling tasks own
   the three input pieces of the in-progress proposal the propose
   action emits as a multi-event bundle. The text input and the
   classification palette have landed; this task ships the last of
   the three. Closing it unblocks `mod_propose_action`, which
   unblocks the milestone-binding propose-from-capture flow.

2. **The edge role is methodology-load-bearing.** Per `DESIGN.md:30`:
   *"Every edge carries an **argument role** (supports / rebuts /
   qualifies / bridges-from / bridges-to / defines / contradicts)
   drawn from Toulmin. The two dimensions are independent; both
   matter for surfacing where debaters talk past each other."* Per
   `docs/moderator-ui.md:45` (F1 step 3): *"Connect to existing
   structure (optional but typical): pick a target node and an edge
   role (`supports`, `rebuts`, `qualifies`, etc.)."* The propose
   action cannot emit a coherent `edge-created` +
   `proposal: set-edge-substance` bundle without the role, and the
   `edge-created` payload schema requires the role
   (`packages/shared-types/src/events/enums.ts:21-29` —
   `edgeRoleSchema = z.enum([...seven values...])`); an absent
   role is a server-side validation failure.

3. **The keyboard-driven moderator ergonomic needs the role
   binding.** Per `docs/moderator-ui.md:187` (*"The moderator's
   hands need to stay on the keyboard to keep up with live debate"*)
   and the F1 capture-speed motivation in `docs/moderator-ui.md:45`
   (*"this trades a moment of latent error for capture speed during
   live debate; the override is one gesture away"*), the role-pick
   has to be single-keystroke reachable for live operation. Without
   this task, the moderator has no keyboard path to stage a role —
   capture speed degrades to mouse-click reach.

Downstream, the selector is the third of three slices the propose
action depends on; once it lands, the propose-from-capture flow is
fully wired at the read end of the proposal bundle.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- `apps/moderator/src/layout/BottomStripCapture.tsx:46-47, 80-85` —
  the scaffold exposes the `edgeRoleSelector` render-prop slot with
  the stable `bottom-strip-edge-role` testid. Unchanged by this
  task; the new `<CaptureTargetAndRole>` wrapper composes its two
  children inside the same slot.
- `apps/moderator/src/layout/CaptureTargetChip.tsx:1-259` — the
  current sole occupant of the slot. This task wraps it inside the
  new `<CaptureTargetAndRole>` composer. The chip's
  `handleClear` callback (lines 137-140) gains one additional store
  write (`setEdgeRole(null)`); the rest of the chip is unchanged.
  The chip's keymap registration via `attachCaptureKeymap` (lines
  150-158) continues to drive `onClearTarget`; the new selector
  registers its own handlers object with `onPickEdgeRole`.
- `apps/moderator/src/layout/ClassificationPalette.tsx:1-159` — the
  structural precedent. The new selector mirrors this component's
  shape (one `<button>` per role, `aria-pressed` toggle, `<kbd>`
  chip, `data-testid` per surface, `attachCaptureKeymap` for
  keyboard, ref-then-listener pattern, shortcut-hint helper).
- `apps/moderator/src/layout/captureKeymap.ts:55-165` — the
  document-level `keydown` plumbing. This task adds:
  ```ts
  export interface CaptureKeymapHandlers {
    onPickKind?: (kind: MethodologyKind) => void;
    onClearTarget?: () => void;
    onPickEdgeRole?: (role: EdgeRole) => void;  // new
    // future: onSubmit?, onExitMode?, onDecompose?
  }
  ```
  Plus a new `SHORTCUT_TO_EDGE_ROLE` reverse table materialised
  once at module load (analog of `SHORTCUT_TO_KIND` at lines
  83-89). Plus a new branch inside `onKeyDown` (after the kind
  branch, before the Escape branch) that routes the key to
  `handlers.onPickEdgeRole` when the role table has the key and
  the handler is registered. The branch is gated on
  `handlers.onPickEdgeRole !== undefined` so other consumers (the
  palette, the chip) don't observe role keys they didn't register
  for. The visibility-gate (`targetEntityId !== null`) lives
  **inside the selector's handler closure**, not in the keymap
  module — the keymap stays purely a key-dispatch layer; the
  semantic guard lives with the consumer (Decision §3).
- `apps/moderator/src/layout/captureKeymap.test.ts:1-185` — the
  existing test harness. This task extends it with new cases under
  a new `describe('captureKeymap — onPickEdgeRole handler')` block
  covering: routing every role shortcut to the handler;
  case-insensitive match; modifier-bail; editable-target bail;
  detach; the `SHORTCUT_TO_EDGE_ROLE` inverse-table totality.
- `apps/moderator/src/stores/captureStore.ts:41-77` — the store
  contract. This task adds:
  ```ts
  /** Selected edge role for the in-progress connect, or `null`. */
  edgeRole: EdgeRole | null;
  setEdgeRole: (role: EdgeRole | null) => void;
  ```
  to `CaptureState`, plus `edgeRole: null` to `initialCaptureState`,
  plus `setEdgeRole: (edgeRole) => set({ edgeRole })` to the
  store factory. The `reset()` already iterates `initialCaptureState`
  via the spread, so it automatically resets the new slice; no
  separate `reset` change is needed beyond the initial-state
  extension. The `EdgeRole` type imports from
  `@a-conversa/shared-types` (alongside the existing `StatementKind`
  import).
- `apps/moderator/src/stores/stores.test.tsx` — extended with
  a `setEdgeRole` mutation case (mirror of the existing
  `setClassification` mutation smoke).
- `apps/moderator/src/routes/Operate.tsx:62-91` — the integration
  site. The current
  `<BottomStripCapture ... edgeRoleSelector={<CaptureTargetChip />} />`
  changes to
  `<BottomStripCapture ... edgeRoleSelector={<CaptureTargetAndRole />} />`.
  The wrapper imports `<CaptureTargetChip>` and `<EdgeRoleSelector>`
  internally; the route stays one-line per slot.
- `apps/moderator/src/layout/CaptureTargetAndRole.tsx` (new) — small
  composer rendering `<CaptureTargetChip />` followed by
  `<EdgeRoleSelector />` inside a Tailwind `flex` container. Single
  responsibility: the two-surface layout inside the shared
  `bottom-strip-edge-role` slot. The wrapper's existence is the
  realisation of `mod_target_auto_suggest`'s Decision §8.
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts:1-125` — the
  shared shortcut module. This task adds an `EDGE_ROLES` literal
  tuple (the seven canonical values in canonical order),
  re-exports `EdgeRole` from `@a-conversa/shared-types`, and adds
  `EDGE_ROLE_TO_SHORTCUT: Readonly<Record<EdgeRole, string>>` plus
  `getShortcutForEdgeRole(role, locale)` (the locale parameter is
  ignored under the english-mnemonic policy, matching the existing
  `getShortcutForKind`). `buildShortcutMatrix()` extends in lockstep
  to surface both tables under a small structural change (see
  Decision §6 for whether to split into a second function or extend
  the existing one).
- `packages/i18n-catalogs/src/keyboard-shortcuts.test.ts:1-200` —
  the existing test file gains parallel cases for `EDGE_ROLES`,
  `EDGE_ROLE_TO_SHORTCUT`, and the new matrix shape.
- `packages/i18n-catalogs/src/index.ts:37-45` — public surface.
  Re-exports the new `EDGE_ROLES`, `EDGE_ROLE_TO_SHORTCUT`,
  `getShortcutForEdgeRole`, and the `EdgeRole` type.
- `packages/i18n-catalogs/src/catalogs/en-US.json:37-66` — the
  `methodology.edgeRole.<role>.{label, description}` namespace.
  Consumed unchanged; this task does NOT migrate the shape or
  re-translate the labels. The new
  `moderator.edgeRolePalette.*` namespace lands as a sibling under
  `moderator.*` next to the existing
  `moderator.classificationPalette.*` and
  `moderator.captureTargetChip.*` blocks (lines 155-169).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the
  PENDING-flag trackers; the 12 new draft entries (6 new keys × 2
  non-en-US locales) get added per the established pattern.
- `tests/e2e/moderator-capture.spec.ts:1-389` — the sibling spec.
  Extended by `mod_classification_palette`, `mod_target_auto_suggest`,
  and `mod_target_clear_override` with seeded-graph blocks reusing
  `loginAs`, `seedWsStore`, `isWsStoreReachable`. This task adds
  one new `test()` block joining the existing four. Decision §10
  records the placement choice.

DESIGN.md / docs consulted:

- `DESIGN.md:30` — *"Every edge carries an **argument role**
  (supports / rebuts / qualifies / bridges-from / bridges-to /
  defines / contradicts) drawn from Toulmin. The two dimensions
  are independent; both matter for surfacing where debaters talk
  past each other."* The seven-role enumeration this task's
  buttons surface.
- `DESIGN.md:43` — i18n constraint: *"The methodology vocabulary
  (statement kinds, edge roles, facet states, diagnostic kinds) is
  presented in the active locale; the underlying data model
  remains English-coded."* The selector renders the localized role
  label but writes the english-coded `EdgeRole` to the store.
- `docs/moderator-ui.md:33` — *"Bottom strip — capture pane: text
  input, classification palette, edge-target selector, mode
  banner."* Confirms the role surface mounts into the bottom strip
  (under the "edge-target selector" combined name — the chip + the
  selector share the slot per `mod_target_auto_suggest` Decision §8).
- `docs/moderator-ui.md:45` — F1 step 3: *"Connect to existing
  structure (optional but typical): pick a target node and an
  edge role (`supports`, `rebuts`, `qualifies`, etc.). The
  most-recently-active node is auto-suggested as the default
  target, pre-filled in the connect pane; one keystroke or click
  clears it if the suggestion is wrong."* The primary specification
  for this task — the selector is the "edge role" half of the F1
  step 3 pair.
- `docs/moderator-ui.md:46` — *"plus optionally `edge-created`,
  `entity-included`, `proposal: set-edge-substance` if connecting."*
  Confirms the role + target pair drives the optional edge half of
  the propose bundle. The propose action reads
  `targetEntityId !== null AND edgeRole !== null` as "emit the
  edge half"; `targetEntityId === null` as "skip the edge half".
- `docs/moderator-ui.md:86` — *"Pick the edge role from a palette
  that appears on drop."* The F4 draw-edge flow's reference to a
  role-palette surface; the v1 capture-pane selector is the
  surface F4 will reuse or mirror when it lands.
- `docs/moderator-ui.md:187-204` — Keyboard shortcuts sketch; the
  english-mnemonic policy + the executable mapping
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts`. This task
  extends that mapping with the seven role mnemonics.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — pinned the english-mnemonic classification-shortcut policy in
  its Consequences section; the same policy applies to edge-role
  shortcuts by extension.
- `tasks/refinements/moderator-ui/mod_target_clear_override.md` —
  most recent sibling; the coupled-clear pattern this task
  extends; the captureKeymap-extension pattern (one new optional
  handler field + one new branch) mirrored here.
- `tasks/refinements/moderator-ui/mod_target_auto_suggest.md` —
  Decision §8 pre-authorised the slot-sharing composition path
  this task realises via `<CaptureTargetAndRole>`.
- `tasks/refinements/moderator-ui/mod_classification_palette.md` —
  the canonical structural precedent; the new selector is the
  edge-role mirror of the same shape (single-select horizontal
  button row + keyboard via `captureKeymap` + per-locale parity).
- `tasks/refinements/moderator-ui/mod_capture_text_input.md` —
  pinned the editable-target guard contract this task's
  shortcuts inherit for free.
- `tasks/refinements/moderator-ui/mod_bottom_strip_capture.md` —
  the scaffold whose `edgeRoleSelector` slot the wrapper mounts
  into.
- `tasks/refinements/moderator-ui/mod_state_management.md` — the
  store contract this task extends with one more slice.
- `tasks/refinements/moderator-ui/mod_edge_rendering.md` —
  canvas-side counterpart; the seven-role enumeration this task's
  capture-side mirror covers.
- `tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`
  — established the conditional-render seam for the
  role-description keys; this task's per-button `title` attribute
  consumes the same `methodology.edgeRole.<role>.description`
  values for hover discoverability.
- `tasks/refinements/frontend-i18n/i18n_methodology_glossary.md`
  / `tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md`
  — the source of `methodology.edgeRole.<role>.{label, description}`.
- `tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md`
  — the english-mnemonic policy + the executable
  `KIND_TO_SHORTCUT` table this task extends with
  `EDGE_ROLE_TO_SHORTCUT`.

No new ADR is required (see Decisions §11); no new external
dependency lands; no public type signature changes other than the
new optional field on `CaptureKeymapHandlers`; no cross-workspace
contract changes; no data-model touch.

## Constraints / requirements

### Component shape

- **New file**
  `apps/moderator/src/layout/EdgeRoleSelector.tsx` exporting
  `function EdgeRoleSelector(): ReactElement | null` (named export,
  no default). Returns `null` when `targetEntityId === null`; renders
  the seven-button row otherwise.
- **Single root element** wrapping a labelled
  `<div role="group" aria-label=...>` containing seven
  `<button type="button">` children plus a short helper line. The
  consumer drops the component directly into the
  `<CaptureTargetAndRole>` wrapper without an extra wrapping div.
- **Stable test ids**:
  - `edge-role-selector` — outer wrapper element.
  - `edge-role-selector-button-<role>` — one per role; seven total.
    `<role>` is the literal english-coded id (`supports`, `rebuts`,
    `qualifies`, `bridges-from`, `bridges-to`, `defines`,
    `contradicts`).
  - `edge-role-selector-key-chip-<role>` — one per role; the small
    visible mnemonic glyph next to the label inside the button.
  - `edge-role-selector-shortcut-hint` — the helper line.
- **New file** `apps/moderator/src/layout/CaptureTargetAndRole.tsx`
  exporting `function CaptureTargetAndRole(): ReactElement`. Renders
  ```tsx
  <div data-testid="capture-target-and-role" className="flex items-center gap-2">
    <CaptureTargetChip />
    <EdgeRoleSelector />
  </div>
  ```
  No other logic; both children are self-contained.

### Store wiring

- The component reads + writes through:
  ```ts
  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const selected = useCaptureStore((s) => s.edgeRole);
  const setEdgeRole = useCaptureStore((s) => s.setEdgeRole);
  ```
- Click handler per button:
  ```ts
  function handleClick(role: EdgeRole): void {
    if (selected === role) {
      setEdgeRole(null);  // re-click toggles off (Decision §4)
      return;
    }
    setEdgeRole(role);
  }
  ```
- The `setEdgeRole(null)` path is honored by the store. The
  store's `reset()` returns `edgeRole` to `null` via the
  `initialCaptureState` spread; `mod_propose_action` will call
  `reset()` on propose-success.

### Coupled-clear seam (chip's `handleClear` extension)

The chip's `handleClear` callback at
`apps/moderator/src/layout/CaptureTargetChip.tsx:137-140` currently
reads:

```ts
const handleClear = useCallback(() => {
  setTargetEntityId(null);
  userHasClearedRef.current = true;
}, [setTargetEntityId]);
```

This task extends it to also clear the edge role:

```ts
const setEdgeRole = useCaptureStore((s) => s.setEdgeRole);
// ...
const handleClear = useCallback(() => {
  setTargetEntityId(null);
  setEdgeRole(null);
  userHasClearedRef.current = true;
}, [setTargetEntityId, setEdgeRole]);
```

Both the × button and the `Esc` keyboard gesture (the two affordances
`mod_target_clear_override` established) call this single handler.
The coupled-clear contract is therefore symmetric: both gestures clear
both slices in one step. Decision §5 records the rationale (a role is
only meaningful when paired with a target; clearing the target makes
the role nonsensical).

### Keymap extension

The `CaptureKeymapHandlers` interface grows one optional field:

```ts
export interface CaptureKeymapHandlers {
  onPickKind?: (kind: MethodologyKind) => void;
  onClearTarget?: () => void;
  onPickEdgeRole?: (role: EdgeRole) => void;  // new
  // future: onSubmit?, onExitMode?, onDecompose?
}
```

`attachCaptureKeymap`'s `onKeyDown` body grows one new branch
placed after the existing kind branch and before the Escape branch:

```ts
// inside onKeyDown, AFTER the kind-match branch (which always
// returns on hit), AFTER the modifier-bail / editable-target /
// repeat-skip guards:
const role = SHORTCUT_TO_EDGE_ROLE[key];
if (role !== undefined && handlers.onPickEdgeRole !== undefined) {
  event.preventDefault();
  handlers.onPickEdgeRole(role);
  return;
}
// then the existing Escape branch follows.
```

The new branch is gated on `handlers.onPickEdgeRole !== undefined` so
other consumers (the palette, the chip) don't observe role keys they
didn't register for. The kind-match branch runs first because the two
tables MUST NOT share any key (Decision §7 includes the
collision-avoidance proof).

A new `SHORTCUT_TO_EDGE_ROLE` constant is materialised once at module
load, mirroring `SHORTCUT_TO_KIND`:

```ts
export const SHORTCUT_TO_EDGE_ROLE: Readonly<Record<string, EdgeRole>> = (() => {
  const out: Record<string, EdgeRole> = {};
  for (const [role, key] of Object.entries(EDGE_ROLE_TO_SHORTCUT)) {
    out[key] = role as EdgeRole;
  }
  return out;
})();
```

### `@a-conversa/i18n-catalogs` extension

- `EDGE_ROLES` literal tuple in canonical order:
  ```ts
  export const EDGE_ROLES = [
    'supports',
    'rebuts',
    'qualifies',
    'bridges-from',
    'bridges-to',
    'defines',
    'contradicts',
  ] as const;
  export type EdgeRole = (typeof EDGE_ROLES)[number];
  ```
  The order matches `packages/shared-types/src/events/enums.ts:21-29`
  (the canonical wire-format enum). The
  `EdgeRole` type is structurally identical to
  `@a-conversa/shared-types`'s `EdgeRole`; the i18n-catalogs version
  is re-derived from the literal tuple so the package stays free of
  a shared-types dependency (mirror of `MethodologyKind` —
  Decision §6).
- `EDGE_ROLE_TO_SHORTCUT`:
  ```ts
  export const EDGE_ROLE_TO_SHORTCUT: Readonly<Record<EdgeRole, string>> = {
    supports: 's',
    rebuts: 'r',
    qualifies: 'q',
    'bridges-from': 'b',
    'bridges-to': 'g',
    defines: 'e',
    contradicts: 'x',
  };
  ```
  See Decision §7 for the per-role mnemonic rationale and
  collision-avoidance proof against `KIND_TO_SHORTCUT` and the
  Escape branch.
- `getShortcutForEdgeRole(role, locale)` — accepts the locale
  parameter for forward compatibility with a future per-locale
  policy flip; returns `EDGE_ROLE_TO_SHORTCUT[role]` under the
  current `'english-mnemonic'` policy.
- `buildShortcutMatrix()` extends to surface a third field per
  locale row: `roles: Record<EdgeRole, string>` alongside the
  existing `kinds: Record<MethodologyKind, string>` shape. The
  function's caller-visible shape change is locked in by the
  test file; the help-overlay (future) is the only intended
  consumer.

### Button surface (per role)

Per `EdgeRole` button:

```jsx
<button
  type="button"
  data-testid={`edge-role-selector-button-${role}`}
  data-role={role}
  aria-pressed={selected === role}
  aria-label={t('moderator.edgeRolePalette.roleButtonAriaLabel', {
    label: t(`methodology.edgeRole.${role}.label`),
    key: shortcutKey.toUpperCase(),
  })}
  title={t(`methodology.edgeRole.${role}.description`)}
  onClick={() => handleClick(role)}
  className={selected === role ? SELECTED_CLASSES : UNSELECTED_CLASSES}
>
  <span>{t(`methodology.edgeRole.${role}.label`)}</span>
  <kbd
    data-testid={`edge-role-selector-key-chip-${role}`}
    aria-hidden="true"
    className={KEY_CHIP_CLASSES}
  >
    {shortcutKey.toUpperCase()}
  </kbd>
</button>
```

- The visible label uses the title-case localized form from
  `methodology.edgeRole.<role>.label`
  (`Supports` / `Apoia` / `Apoya`, etc.).
- The visible key chip uses the uppercase form of the mnemonic
  (`S` / `R` / `Q` / `B` / `G` / `E` / `X`); the listener matches
  the lowercase form so the moderator presses an unshifted key.
- `title` surfaces the per-role description as a native browser
  tooltip on hover. The description text is the same one the
  hover popover renders on edges (per
  `mod_edge_popover_full_target_wording`); the selector and the
  popover are the two surfaces where the description earns its
  existence. Native-tooltip-on-button is the canonical pattern for
  this discovery surface.
- `<kbd>` is the semantic element for keyboard glyphs;
  `aria-hidden` prevents the screen reader from double-announcing
  the key (the per-button aria-label already includes `(S)`).
- `aria-pressed` is the canonical mutually-exclusive-toggle
  attribute per WAI-ARIA Practices §3.21 (toggle button);
  WCAG-compatible screen readers announce
  `"Supports, pressed"` vs. `"Supports, not pressed"`.

### Visual selection state (Tailwind)

Selected button:
```
inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700
```

Unselected button:
```
inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600
```

`<kbd>` chip (always):
```
ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80
```

These are the same Tailwind constants the classification palette
uses; the two single-select button rows are visually consistent so
the moderator reads the bottom strip as a uniform composition.
WCAG AA contrast holds in both states (selected ≈ 8.59:1;
unselected ≈ 11.96:1) per the precedent on
`mod_classification_palette.md` constraints.

### Helper / shortcut hint

`<p data-testid="edge-role-selector-shortcut-hint" class="mt-1 text-xs text-slate-500">{t('moderator.edgeRolePalette.shortcutHint')}</p>`

Always rendered (not just on near-empty selection) — mirrors the
classification palette's helper-always-rendered decision. The hint
reads `"Or press S / R / Q / B / G / E / X"` in en-US.

### Visibility gate

The component returns `null` early when
`useCaptureStore.targetEntityId === null`:

```ts
export function EdgeRoleSelector(): ReactElement | null {
  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const selected = useCaptureStore((s) => s.edgeRole);
  const setEdgeRole = useCaptureStore((s) => s.setEdgeRole);

  // ... handler refs + attachCaptureKeymap useEffect ...

  if (targetEntityId === null) {
    return null;
  }

  // ... seven-button row + helper line ...
}
```

The early-return runs AFTER the `useEffect` registration (React's
rules-of-hooks: hooks must be called unconditionally). The
`attachCaptureKeymap` effect attaches once on mount regardless of
visibility; the visibility-gate lives **inside the handler closure**
the effect registers:

```ts
useEffect(() => {
  const handlers: CaptureKeymapHandlers = {
    onPickEdgeRole: (role) => {
      // Visibility-gate: the keyboard binding mirrors the visual
      // gate. If there's no target staged, the role binding is
      // inert (Decision §3).
      if (stateRef.current.targetEntityId === null) return;
      // Re-press while the role is already selected is a no-op
      // (Decision §4 — keyboard re-press is more often an unintended
      // bounce than a deliberate undo).
      if (stateRef.current.selected === role) return;
      stateRef.current.setEdgeRole(role);
    },
  };
  const detach = attachCaptureKeymap(handlers);
  return detach;
}, []);
```

The `stateRef` carries `{ targetEntityId, selected, setEdgeRole }`;
the ref-then-listener pattern survives strict-mode double-mount.

### Accessibility

- The wrapper is
  `<div role="group" aria-label={t('moderator.edgeRolePalette.ariaLabel')}>`.
  `role="group"` is the canonical container for a set of related
  controls per WAI-ARIA 1.2; pairing it with an `aria-label` surfaces
  the group's purpose to screen readers.
- Each button has `type="button"` (defaults to `submit` inside a
  `<form>`, which would be wrong if the selector were ever wrapped
  in a form).
- `aria-pressed` on each button captures the toggle state.
- `title` surfaces the role description; the description is also
  available via screen reader through the aria-describedby pattern
  the hover-popover uses for the same content on edges. The
  description is short (one sentence per the
  `methodology.edgeRole.<role>.description` content) so the native
  tooltip surface is sufficient.
- Tab order: the seven buttons are tab-focusable in order; a
  moderator using `Tab` can reach the selector and use `Space` to
  pick. A follow-up could swap to `arrow-key` navigation inside the
  group (WAI-ARIA toggle-group pattern); this task ships the
  tab-order default for simplicity, mirroring
  `mod_classification_palette`.
- The visibility-gate means a screen reader navigating the strip
  encounters the selector only when there's a staged target; when
  the slice is null, the selector emits no DOM so the screen
  reader skips past it. This is the correct semantic — the
  selector is "the role on the edge to the target" and there is
  no role to announce without a target.

### Mutually-exclusive single-select

- One role is selected at a time (or none — `null` is a valid slice
  value).
- Clicking a different role switches the selection: the slice
  receives the new role; the prior button's `aria-pressed` flips to
  `false` on the next render; the new button's flips to `true`.
- Clicking the currently-selected role toggles it off (Decision §4):
  the slice receives `null`; every button's `aria-pressed` is `false`.
- Pressing a shortcut while a role is selected switches the
  selection the same way (`setEdgeRole(newRole)`); the toggle-off
  behavior on shortcut-press is NOT applied — pressing the
  currently-selected role's shortcut a second time is a no-op
  (same asymmetry as `mod_classification_palette` Decision §4).

### Submit gesture (not in this task)

The selector does NOT implement a submit gesture. `mod_propose_action`
will read all four capture-store slices and validate
`targetEntityId !== null => edgeRole !== null` before submitting;
until then a submit gesture with the selector empty is silently
inert. This task intentionally does not block submit on a null
role — that's `mod_propose_action`'s scope.

### i18n catalog keys

Six new keys under a new `moderator.edgeRolePalette.*` sub-area.
Naming follows the precedent (`moderator.classificationPalette.*`,
`moderator.captureTextInput.*`, `moderator.captureTargetChip.*`):
component-named sub-area.

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.edgeRolePalette.ariaLabel` | "Edge role — pick how the new statement connects to the target" | "Papel da aresta — escolha como a nova declaração se conecta ao alvo" | "Rol del enlace — elige cómo el nuevo enunciado se conecta al objetivo" |
| `moderator.edgeRolePalette.legend` | "Edge role" | "Papel da aresta" | "Rol del enlace" |
| `moderator.edgeRolePalette.roleButtonAriaLabel` | "{label} ({key})" | "{label} ({key})" | "{label} ({key})" |
| `moderator.edgeRolePalette.shortcutHint` | "Or press S / R / Q / B / G / E / X" | "Ou pressione S / R / Q / B / G / E / X" | "O presiona S / R / Q / B / G / E / X" |
| `moderator.edgeRolePalette.unsetAria` | "Clear edge role" | "Limpar papel da aresta" | "Limpiar rol del enlace" |
| `moderator.edgeRolePalette.hiddenHelp` | "Pick a target first to choose an edge role." | "Escolha primeiro um alvo para selecionar um papel de aresta." | "Elige primero un objetivo para seleccionar un rol de enlace." |

- `legend` is the optional short label that may render above the
  group (as `<span class="sr-only">`) and provide a compact name
  next to the group; landing the key now keeps the namespace shape
  predictable. Same pattern as `mod_classification_palette`'s legend.
- `roleButtonAriaLabel` is the ICU-interpolated per-button
  accessible name; the template carries `{label}` and `{key}` so
  translators can reorder for locales where the key-first form
  (`"(S) Apoia"`) reads more naturally — though all three v1
  drafts use the en-US order.
- `unsetAria` is documented for a future "clear edge role" surface
  (e.g., a small × button next to the selector, or the same
  re-click-to-toggle-off announced as a separate aria-label).
  Landed now because it's part of the same coherent namespace and
  the cost of one extra string per locale is small.
- `hiddenHelp` is a reserved key for a future placeholder render
  in the empty (no-target) state. The current v1 design returns
  `null` outright (no placeholder); landing the key now leaves the
  catalog future-proof if visual prototyping wants to add a
  placeholder later. Decision §2 records the choice to NOT render
  the placeholder in v1.

**Count: 6 keys × 3 locales = 18 catalog entries**. The pt-BR +
es-419 drafts land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json` (same pattern as the predecessors). The en-US
is authoritative.

The visible role labels are **not** added under this namespace;
they continue to resolve through
`methodology.edgeRole.<role>.label` (existing glossary). The
per-role descriptions surface as button `title` tooltips and
continue to resolve through
`methodology.edgeRole.<role>.description` (existing — landed by
`i18n_methodology_role_descriptions`).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/EdgeRoleSelector.tsx` (new — the
  selector component).
- `apps/moderator/src/layout/EdgeRoleSelector.test.tsx` (new —
  Vitest cases).
- `apps/moderator/src/layout/CaptureTargetAndRole.tsx` (new —
  the two-surface composer).
- `apps/moderator/src/layout/CaptureTargetAndRole.test.tsx` (new —
  small composer test; asserts both children mount inside the
  wrapper).
- `apps/moderator/src/layout/CaptureTargetChip.tsx` (modified —
  extend `handleClear` to also call `setEdgeRole(null)`; subscribe
  to `setEdgeRole` selector).
- `apps/moderator/src/layout/CaptureTargetChip.test.tsx` (modified
  — add ~2 cases for the coupled-clear regression: × button clears
  both slices; Esc clears both slices).
- `apps/moderator/src/layout/captureKeymap.ts` (modified — add
  `onPickEdgeRole?` to `CaptureKeymapHandlers`; add
  `SHORTCUT_TO_EDGE_ROLE` materialisation; add the role-match
  branch to `attachCaptureKeymap`'s `onKeyDown`).
- `apps/moderator/src/layout/captureKeymap.test.ts` (modified —
  add ~6 new cases under a new
  `describe('captureKeymap — onPickEdgeRole handler')` block).
- `apps/moderator/src/stores/captureStore.ts` (modified — add
  `edgeRole`, `setEdgeRole` to `CaptureState`; extend
  `initialCaptureState`; extend the store factory).
- `apps/moderator/src/stores/stores.test.tsx` (modified — add one
  case mirroring the existing `setClassification` smoke).
- `apps/moderator/src/routes/Operate.tsx` (modified — swap
  `<CaptureTargetChip />` for `<CaptureTargetAndRole />` in the
  `edgeRoleSelector` slot; update the leading Refinement comment
  to cite `mod_edge_role_selector.md` alongside the existing
  references).
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` (modified —
  add `EDGE_ROLES`, `EdgeRole`, `EDGE_ROLE_TO_SHORTCUT`,
  `getShortcutForEdgeRole`; extend `buildShortcutMatrix` to
  surface the new table).
- `packages/i18n-catalogs/src/keyboard-shortcuts.test.ts` (modified
  — add parallel cases for `EDGE_ROLES`, `EDGE_ROLE_TO_SHORTCUT`,
  the inverse-table totality + no-collision proof, and the
  collision-avoidance check against `KIND_TO_SHORTCUT`).
- `packages/i18n-catalogs/src/index.ts` (modified — re-export the
  new symbols).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add
  `moderator.edgeRolePalette.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified —
  same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified —
  same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified
  — PENDING entries for the 6 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified
  — same).
- `tests/e2e/moderator-capture.spec.ts` (modified — one new
  `test()` block joining the existing four).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_edge_role_selector`
  lands at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_edge_role_selector_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration
  policy.
- `docs/adr/` — no new ADR. ADR 0024 already pinned the i18n
  architecture and the english-mnemonic shortcut policy;
  `mod_state_management` pinned the store contract;
  `i18n_methodology_glossary` + `i18n_methodology_role_descriptions`
  pinned the role labels + descriptions;
  `i18n_keyboard_shortcuts_policy` pinned the mapping policy; this
  task is the UI binding for the existing decisions plus the
  per-role mnemonic table whose pick rationale belongs in the
  refinement (Decision §7), not a separate ADR.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — the
  scaffold's slot contract is consumed unchanged; the slot now
  hosts `<CaptureTargetAndRole>` instead of `<CaptureTargetChip>`
  directly, but the prop name and the slot testid stay the same.
- `apps/moderator/src/layout/CaptureTextInput.tsx` /
  `apps/moderator/src/layout/ClassificationPalette.tsx` /
  `apps/moderator/src/layout/ModeBanner.tsx` — sibling components,
  untouched.
- `apps/moderator/src/stores/selectionStore.ts` /
  `apps/moderator/src/stores/recentlyActiveNode.ts` — unchanged.
- `apps/moderator/src/graph/StatementEdge.tsx` /
  `apps/moderator/src/graph/HoverPopover.tsx` — the canvas-side
  edge-role surfaces; unchanged. The selector and the canvas-side
  rendering share the catalog keys but no code path.
- `packages/shared-types/src/events/enums.ts` — `EdgeRole` is
  imported via `@a-conversa/shared-types`; the enum is not edited.
- `apps/server/src/` — no server-side change.
- `docs/moderator-ui.md` — no design-doc change. The selector is
  already specified at F1 step 3; this task implements the
  documented behavior.
- `playwright.config.ts` — the new `test()` block joins the
  existing `tests/e2e/moderator-capture.spec.ts`, which is already
  picked up by the `chromium-create-session` project; no new
  project entry, no `testMatch` change.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new `EdgeRoleSelector.test.tsx` cases
  (≥ 17, mirroring the classification palette's case count plus
  the visibility-gate cases), the new
  `CaptureTargetAndRole.test.tsx` cases (≥ 2), the new
  `captureKeymap.test.ts` cases (≥ 6), the new
  `CaptureTargetChip.test.tsx` coupled-clear cases (≥ 2), and the
  new `stores.test.tsx` setter smoke (1).
- `pnpm --filter @a-conversa/i18n-catalogs run test` green —
  including the new `keyboard-shortcuts.test.ts` cases for
  `EDGE_ROLES`, `EDGE_ROLE_TO_SHORTCUT`, totality, no-collision,
  and the cross-table collision-avoidance check.
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the
  parity-check) green after the catalog edits — every
  `moderator.edgeRolePalette.*` key present in en-US is present
  in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green against a freshly brought-up
  dev compose stack; the new edge-role scenario in
  `tests/e2e/moderator-capture.spec.ts` passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_edge_role_selector` AND the
  new `i18n_edge_role_selector_native_review` task block.

### UI-stream e2e scoping

The selector is reachable from a real user flow: the moderator can
log in, create a session, land on `/sessions/<id>/operate`, seed two
nodes via `seedWsStore`, click one to auto-suggest a target, and see
the selector appear next to the chip. Per the UI-stream e2e policy
default, the Playwright spec is **scoped under Acceptance criteria,
NOT deferred**.

**Important caveat**: `mod_propose_action` has not landed, so the
selector's selected role does not yet drive a WS proposal. The e2e
therefore asserts visibility-gate + click + keyboard + coupled-clear
observables (the `aria-pressed` attribute, the slot's DOM presence,
the chip's `data-testid="capture-target-chip"` empty-state after
clear) rather than the full propose chain. The propose-chain e2e
lands with `mod_propose_action`'s own spec.

The new `test()` block covers:

1. **No-target gate** — fresh operate route → no
   `[data-testid="edge-role-selector"]` in the DOM; pressing role
   shortcut keys (e.g. `s`) is a no-op (the visibility-gate inside
   the handler closure short-circuits).
2. **Seeded-graph happy path (click)** — seed two nodes, click
   node 1 → target chip auto-suggests → selector renders → click
   the `supports` button → `aria-pressed="true"` on the
   `supports` button → other six stay `false`.
3. **Keyboard shortcut** — same seeded path → press `r` (with no
   modifier, no focus on the textarea) → the `rebuts` button's
   `aria-pressed` flips to `true`; the previously-selected
   `supports` flips to `false`.
4. **Editable-target keyboard bail** — same seeded path → focus
   the wording textarea → press `s` → the textarea's value gains
   the literal `"s"` character; the selector's selection is
   unchanged.
5. **Coupled clear** — same seeded path with both target and role
   staged → press `Esc` → the chip flips to empty-state → the
   selector returns `null` (no DOM) → the role slice reads `null`
   indirectly through the selector's absence and a re-auto-suggest
   gesture that re-selects the previously-staged role would have
   to happen explicitly (the slice does not magically restore).

If `wsStoreSeed` is unreachable at implementation time (same caveat
as the predecessors), the seeded-graph cases `test.skip` the same
way; the no-target gate case (1) still gates the visibility
contract.

## Acceptance criteria

### 1. The selector renders inside the shared slot only when a target is staged

- With `useCaptureStore.targetEntityId === null`, the selector
  returns `null`: `screen.queryByTestId('edge-role-selector')`
  resolves to `null`.
- With `useCaptureStore.targetEntityId !== null`, the selector
  renders: `screen.getByTestId('edge-role-selector')` returns a
  `<div role="group">`.
- The wrapper `<CaptureTargetAndRole>` is mounted in the
  `edgeRoleSelector` slot regardless; the slot's
  `data-testid="bottom-strip-edge-role"` continues to resolve. The
  wrapper's own `data-testid="capture-target-and-role"` resolves
  in both states.
- The group is reachable via
  `screen.getByRole('group', { name: /Edge role/ })` when a target
  is staged.

### 2. Seven role buttons render in canonical `EDGE_ROLES` order

- With a staged target, the seven buttons render in the order:
  `supports`, `rebuts`, `qualifies`, `bridges-from`,
  `bridges-to`, `defines`, `contradicts`.
- Each button has `data-testid="edge-role-selector-button-<role>"`
  and `data-role="<role>"`.
- Each button's visible label is
  `t(\`methodology.edgeRole.${role}.label\`)`.
- Each button's `<kbd>` chip is the uppercase mnemonic
  (`S` / `R` / `Q` / `B` / `G` / `E` / `X`).
- Each button's `aria-label` composes `{label} ({KEY})` (e.g.
  `"Supports (S)"`).
- Each button's `title` attribute is the localized
  `methodology.edgeRole.<role>.description`.

### 3. Store wiring (click)

- On every button click:
  - `setEdgeRole(role)` is called with the matching role when the
    button was previously unselected;
  - `setEdgeRole(null)` is called when the button was the
    currently-selected one (toggle-off);
  - the matching button's `aria-pressed` becomes `"true"`; every
    other button's `aria-pressed` becomes `"false"`.
- On a programmatic store mutation
  (`useCaptureStore.getState().setEdgeRole('rebuts')`), the
  matching button re-renders with `aria-pressed="true"`.
- On a `useCaptureStore.getState().reset()` call, every button's
  `aria-pressed` is `"false"` and the slice is `null`.

### 4. Store wiring (keyboard shortcut)

- With a staged target, pressing
  `s` / `r` / `q` / `b` / `g` / `e` / `x` (no modifier other than
  shift) anywhere on the page calls `setEdgeRole(<role>)` with the
  matching role.
- Pressing the same key a second time while that role is selected
  is a no-op (shortcut re-press does NOT toggle off).
- Pressing a different role's key switches the selection.
- Pressing any role key while focus is on the capture-pane
  textarea (`<textarea data-testid="capture-text-input-textarea">`)
  does NOT trigger the selector; the textarea's `value` gains the
  literal character and the slice is unchanged.
- Pressing `Cmd+S` / `Ctrl+S` does NOT trigger the selector
  (browser save passes through; modifier-bail).
- Pressing `Alt+S` does NOT trigger the selector; same clause.
- Pressing `Shift+S` DOES trigger the selector (shift is the one
  allowed modifier; the lowercase match still resolves).
- **Visibility-gate**: with `targetEntityId === null`, pressing
  any role key is a no-op. The handler short-circuits inside the
  closure (Decision §3).

### 5. Coupled clear

- Start state: `targetEntityId === 'n-1'` AND `edgeRole === 'supports'`.
- Click the chip's × button (the
  `capture-target-chip-clear` data-testid).
- After the React effect runs:
  - `useCaptureStore.getState().targetEntityId === null`;
  - `useCaptureStore.getState().edgeRole === null`;
  - the chip renders the empty state;
  - the selector returns `null` (no DOM).
- Same outcome when the clear is invoked via the `Esc` keyboard
  gesture (the chip's `handleClear` is the single sink for both
  affordances).

### 6. Listener cleanup on unmount

- Unmounting `<EdgeRoleSelector>` detaches the document-level
  keydown listener; a subsequent role-letter keypress after
  unmount does NOT call any setter and does NOT throw.
- Re-mounting the component re-attaches the listener.
- Strict-mode double-mount in tests does NOT double-fire the
  setter (the ref-then-listener pattern handles the double-mount;
  the effect's cleanup runs between the two mounts).

### 7. Localization parity round-trip

- For each locale in `['en-US', 'pt-BR', 'es-419']`:
  - the wrapper aria-label resolves to a non-key string;
  - the legend / shortcut-hint / unsetAria / hiddenHelp resolve
    to non-key strings;
  - each per-role button label resolves to the
    `methodology.edgeRole.<role>.label` glossary value for that
    locale;
  - each per-role aria-label resolves to
    `"{glossary label} (S|R|Q|B|G|E|X)"` for that locale;
  - each per-role `title` resolves to the
    `methodology.edgeRole.<role>.description` glossary value;
  - no `[t-missing]` token nor raw catalog-key string is visible
    anywhere in the component's DOM.
- The shortcut KEY (the uppercase `S`/`R`/`Q`/`B`/`G`/`E`/`X` in
  the chip and the aria-label) is IDENTICAL across all three
  locales — the policy is english-mnemonic per ADR 0024 +
  `i18n_keyboard_shortcuts_policy`.

### 8. `EDGE_ROLE_TO_SHORTCUT` does not collide with `KIND_TO_SHORTCUT`

- The intersection
  `Set(values(EDGE_ROLE_TO_SHORTCUT)) ∩ Set(values(KIND_TO_SHORTCUT))`
  is empty. A dedicated Vitest case in
  `packages/i18n-catalogs/src/keyboard-shortcuts.test.ts` asserts
  this property so a future edit can't introduce a collision
  silently. The Escape branch is also non-letter and therefore
  collision-free.

### 9. Vitest cases (in `apps/moderator/src/layout/EdgeRoleSelector.test.tsx`)

Minimum 17 new cases per ADR 0022 (committed regression-class
proofs):

1. **Returns null when no target is staged** —
   `queryByTestId('edge-role-selector')` is null on fresh mount.
2. **Renders the seven buttons when a target is staged** — set
   `useCaptureStore.setState({ targetEntityId: 'n-1' })`; assert
   seven `getByTestId('edge-role-selector-button-<role>')` resolve.
3. **All seven buttons render in the canonical `EDGE_ROLES`
   order** — `supports` first, `contradicts` last.
4. **Each button's visible label is the localized
   `methodology.edgeRole.<role>.label`** — assert against the
   en-US glossary string per role.
5. **Each button's visible key chip is the uppercase mnemonic** —
   `S`, `R`, `Q`, `B`, `G`, `E`, `X`.
6. **Each button's aria-label composes `{label} (KEY)`**.
7. **Each button's `title` is the localized
   `methodology.edgeRole.<role>.description`**.
8. **`aria-pressed` reflects the store** — set `edgeRole: 'rebuts'`
   programmatically; assert the `rebuts` button has
   `aria-pressed="true"` and every other has `aria-pressed="false"`.
9. **Click a button writes to the store** — fire click on
   `supports`; assert
   `useCaptureStore.getState().edgeRole === 'supports'`.
10. **Click the selected button toggles off** — set
    `edgeRole: 'qualifies'` programmatically; click the
    `qualifies` button; assert
    `useCaptureStore.getState().edgeRole === null`.
11. **Click a different button switches the selection**.
12. **`reset()` clears the selector** — set
    `edgeRole: 'defines'`; call
    `useCaptureStore.getState().reset()`; assert every
    `aria-pressed` is `"false"` and the slice is `null`.
13. **Keyboard shortcut `s` writes to the store** — fire `keydown`
    with `key: 's'` on `document`; assert
    `useCaptureStore.getState().edgeRole === 'supports'`.
14. **Keyboard shortcut visibility-gate** — with
    `targetEntityId: null`, fire `keydown` with `key: 's'`;
    assert the slice is unchanged.
15. **Keyboard shortcut ignored when focus is on a textarea** —
    render with a `<textarea>` mounted alongside; focus it; fire
    `keydown`; assert the slice is unchanged.
16. **Keyboard shortcut ignored when `Cmd/Ctrl/Alt` is held**.
17. **Per-locale parity round-trip** — for each of the three v1
    locales, assert no `[t-missing]` token nor raw catalog-key
    string appears anywhere in the selector's DOM; assert the
    role labels match the glossary's per-locale values.

Plus extensions to `apps/moderator/src/layout/captureKeymap.test.ts`
(minimum 6 new cases):

1. **Routes each role shortcut to `onPickEdgeRole`** — for every
   role in `EDGE_ROLES`, dispatch the shortcut key; assert the
   spy was called with the matching role.
2. **`SHORTCUT_TO_EDGE_ROLE` is the inverse of
   `EDGE_ROLE_TO_SHORTCUT`** — for every role,
   `SHORTCUT_TO_EDGE_ROLE[EDGE_ROLE_TO_SHORTCUT[role]] === role`.
3. **Case-insensitive match** — uppercase `S` → `supports`.
4. **Modifier-bail clause** — `Cmd+S`, `Ctrl+S`, `Alt+S` all
   skip.
5. **Editable-target bail** — focused textarea suppresses the
   role keys.
6. **Detach removes the listener** — after detach, role keys are
   no-ops.

Plus extensions to `apps/moderator/src/layout/CaptureTargetChip.test.tsx`
(minimum 2 new cases, regression-locking the coupled clear):

1. **× button clears both `targetEntityId` and `edgeRole`** —
   set both slices; click the chip's × button; assert both are
   `null`.
2. **Esc clears both slices** — set both slices; dispatch
   `Escape` keydown; assert both are `null`.

Plus the `CaptureTargetAndRole.test.tsx` smoke cases (minimum 2):

1. **Mounts both children** — render; assert
   `screen.getByTestId('capture-target-chip')` AND
   `screen.queryByTestId('edge-role-selector')` (the second
   resolves to null in the no-target state per Acceptance §1).
2. **Slot composition stays inside the wrapper** — both children
   are children of `getByTestId('capture-target-and-role')`.

Plus the `keyboard-shortcuts.test.ts` extensions (minimum 5):

1. **`EDGE_ROLES` length equals the schema's seven values**.
2. **`EDGE_ROLE_TO_SHORTCUT` covers every role**.
3. **No within-table collisions in
   `EDGE_ROLE_TO_SHORTCUT`** — seven distinct keys.
4. **No cross-table collisions with `KIND_TO_SHORTCUT`** — the
   intersection is empty (Acceptance §8).
5. **`buildShortcutMatrix()` exposes both tables**;
   `getShortcutForEdgeRole(role, locale)` resolves to the same
   value for every supported locale.

### 10. Playwright e2e (per UI-stream policy)

One new `test()` block lands in
`tests/e2e/moderator-capture.spec.ts` (joining the existing four),
covering the 5 sub-scenarios listed under "UI-stream e2e scoping"
above. The block reuses `loginAs`, `seedWsStore`, and
`isWsStoreReachable` from the sibling specs.

### 11. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.edgeRolePalette.{ariaLabel, legend,
  roleButtonAriaLabel, shortcutHint, unsetAria, hiddenHelp}`
  keys with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` gains the same
  6 keys with pt-BR draft strings.
- `packages/i18n-catalogs/src/catalogs/es-419.json` gains the same
  6 keys with es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` gain
  `pending: true` entries for each of the 6 new keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green.

### 12. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_edge_role_selector` block
  gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_edge_role_selector_native_review` is added with the
  template below (effort 0.5d;
  `depends !i18n_target_clear_override_native_review`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_edge_role_selector_native_review "Native-speaker review of pt-BR + es-419 edge-role-selector palette strings" {
  effort 0.5d
  allocate team
  depends !i18n_target_clear_override_native_review
  note "Source of debt: mod_edge_role_selector (this commit) — pt-BR and es-419 drafts of the 6 keys under moderator.edgeRolePalette.* landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### 13. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Slot sharing via a `<CaptureTargetAndRole>` wrapper, not a slot-level rewire

`mod_target_auto_suggest`'s Decision §8 pre-authorised the
composition pattern: this task realises it via a small wrapper
component rather than changing the scaffold's slot name or adding a
second slot. Three candidates surveyed:

- **A `<CaptureTargetAndRole>` wrapper that renders both children
  inside the shared `edgeRoleSelector` slot** (chosen). The wrapper
  is ~10 lines of JSX; it owns the two-surface layout (Tailwind
  `flex items-center gap-2`); the route passes it as the slot's
  single child; the scaffold's prop name and testid stay unchanged.
  The composition is explicit and locally readable.
- **Rename the scaffold's `edgeRoleSelector` slot to
  `edgeAttachment`** — rejected (same reasoning as
  `mod_target_auto_suggest`'s Decision §8: a scaffold rename
  ripples into `BottomStripCapture.test.tsx` and every reader of
  the prop name for a cosmetic improvement).
- **Pass two children to the same slot via React fragments** —
  e.g. `edgeRoleSelector={<><CaptureTargetChip /><EdgeRoleSelector /></>}`.
  Rejected: the route-level wiring grows hard to read across
  capture-flow tasks; a dedicated wrapper component is the clearer
  composition seam and the right place for the Tailwind layout
  classes.

The wrapper is named after what it contains
(`<CaptureTargetAndRole>`); the file lives next to its two
children in `apps/moderator/src/layout/`. Future capture-flow tasks
(F4 draw-edge, F5 axiom-mark capture variants) may compose
differently; this wrapper does not pre-commit to those.

### 2. Visibility — render only when a target is staged

Three candidates surveyed:

- **Always visible** — rejected. Clutters the pane when there's no
  target; gives the moderator seven role buttons to ignore. The
  selector's semantic match is "role on the edge to the target";
  with no target, there is no edge and no role.
- **Visible only when `targetEntityId !== null`** (chosen). Reads
  the load-bearing F1 step-3 framing in
  `docs/moderator-ui.md:45`: *"Connect to existing structure
  (optional but typical): pick a target node AND an edge role"* —
  the two surfaces are paired in the design. The selector's
  visibility tracks the target's presence; the moderator sees the
  role question only when the answer matters.
- **Visible always, but disabled when `targetEntityId === null`** —
  rejected. A disabled seven-button row is louder visual chrome
  than the null-return-collapsed slot. The moderator's attention
  budget during live capture is the load-bearing optimisation;
  removing irrelevant chrome wins over surfacing disabled chrome.

The early-return MUST run AFTER the `useEffect` registration
(rules-of-hooks); the visibility gate lives in two places: the JSX
return-early branch (controls the DOM), and the handler closure
inside the `useEffect` (controls the keyboard binding — Decision §3).

A future visual prototyping pass may add a placeholder text in the
empty state ("Pick a target first to choose an edge role") through
the reserved `moderator.edgeRolePalette.hiddenHelp` key; v1 ships
the null-return for minimal chrome.

### 3. Visibility-gate inside the handler closure, not the keymap module

Three candidates surveyed:

- **Gate inside the handler closure** (chosen). The
  `attachCaptureKeymap` listener attaches once on mount; the
  visibility-gate (`targetEntityId === null` → no-op) lives in the
  handler closure the selector registers. The keymap module stays
  a pure key-dispatch layer (modifier-bail, repeat-skip,
  editable-target — generic concerns); the semantic gate
  (target-must-be-staged) lives with the consumer. This matches
  the pattern: the kind handler has no visibility-gate (the
  palette is always visible); the clear handler has no
  visibility-gate (Esc fires whenever the chip is mounted); the
  role handler has a target-must-be-staged gate. Each handler
  owns its semantic constraints.
- **Gate inside `attachCaptureKeymap`** — rejected. The keymap
  module would have to read `useCaptureStore` directly, breaking
  its current pure-listener purity. The module would also need a
  hook-like subscription to the store, which a non-React function
  module shouldn't have.
- **Conditionally attach / detach the listener based on
  `targetEntityId`** — rejected. The effect's dependency array
  would include `targetEntityId`, causing re-attach storms on every
  selection change; the ref-then-listener pattern is specifically
  designed to avoid these. The gate-inside-closure path reads the
  ref and short-circuits without re-attaching.

### 4. Re-click toggles off; re-press is a no-op

Mirrors `mod_classification_palette` Decision §4 exactly. A mouse
re-click on the same button is a deliberate "undo" gesture (the
cursor is already on the button); a keyboard re-press is more
often an unintended bounce. Therefore:

- Click on selected role → `setEdgeRole(null)`.
- Keyboard shortcut for selected role → no-op (handler closure
  early-returns when `stateRef.current.selected === role`).

The asymmetry is intentional and consistent across the two
single-select surfaces in the capture pane.

### 5. Coupled clear — clearing target also clears role

Three candidates surveyed:

- **Clear target → also clear role** (chosen). A role without a
  target is methodologically nonsensical (per `DESIGN.md:30`: the
  role is "on the edge", and an edge requires two endpoints; with
  no target staged, there is no edge to attach a role to). The
  coupled clear keeps the capture-store state in a coherent shape;
  the propose action's invariant
  (`targetEntityId !== null AND edgeRole !== null` → emit edge half)
  reads cleaner without an `edgeRole !== null AND targetEntityId === null`
  intermediate state. Implementation: extend the chip's
  `handleClear` callback to call `setEdgeRole(null)` alongside the
  existing `setTargetEntityId(null)`. Both clear gestures (the ×
  button, the `Esc` key) reach the same handler.
- **Leave the role independent of the target clear** — rejected.
  Leaves a moderator-confusing intermediate state where the
  selector is invisible (no target) but the slice still holds a
  role. If the moderator then re-stages a target, the role
  pre-populates from the prior pick — but the prior pick was for a
  different target's edge. The state surface is harder to reason
  about than the coupled-clear contract.
- **Clear target via two separate gestures (target alone, then
  role alone) with no coupling** — rejected. Requires a separate
  "clear role" affordance, which would land its own × button and
  Esc binding. The pane's gesture budget is tight; the coupled
  clear gets two-for-one with no new affordances.

### 6. `EDGE_ROLES` constant lives in `@a-conversa/i18n-catalogs`, not in `shared-types`

The shared-types package defines the canonical wire-format enum
(`edgeRoleSchema = z.enum([...])`). The i18n-catalogs package gets
its own `EDGE_ROLES` literal tuple in the same canonical order so
the shortcuts module + the selector + the help overlay have a
local tuple to iterate without taking a shared-types dependency.

This mirrors the existing `METHODOLOGY_KINDS` precedent:

> `apps/moderator/src/layout/EdgeRoleSelector.tsx` imports
> `EDGE_ROLES`, `EdgeRole`, and `EDGE_ROLE_TO_SHORTCUT` from
> `@a-conversa/i18n-catalogs` (one import for the iteration order,
> the type, and the shortcut table — same shape as the palette's
> `KIND_TO_SHORTCUT` / `METHODOLOGY_KINDS` imports).

A test case asserts the i18n-catalogs `EDGE_ROLES` tuple equals
the shared-types `edgeRoleSchema.options` array element-by-element,
so drift between the two surfaces is regression-locked. Same
pattern the `methodology.test.ts:53-59` round-trip pins for kinds.

The shared-types `EdgeRole` and the i18n-catalogs `EdgeRole` are
structurally identical strings; consumers can use whichever import
path is shorter at their call site. The selector uses
`@a-conversa/i18n-catalogs`'s re-export for the consistency of the
single import.

### 7. Per-role english-mnemonic shortcuts: `s`/`r`/`q`/`b`/`g`/`e`/`x`

Same policy as `mod_classification_palette` (english-mnemonic,
locale-independent per ADR 0024 + `i18n_keyboard_shortcuts_policy`).
The picks per role:

| Role | Shortcut | Rationale |
| --- | --- | --- |
| `supports` | `s` | first-letter mnemonic; widely used in argumentation tooling |
| `rebuts` | `r` | first-letter mnemonic |
| `qualifies` | `q` | first-letter mnemonic |
| `bridges-from` | `b` | first-letter; `b` for the "bridge" mnemonic |
| `bridges-to` | `g` | second of the two bridge roles; `g` for "to" via "goes-to" (mnemonic; the actual prose is "bridges-to" but the surface label "Bridges to" has no obvious second letter that doesn't collide; `g` is unambiguous and adjacent on the QWERTY layout) |
| `defines` | `e` | "establishes definition" — the role names a definitional move; `d` is already taken by `definitional` kind; `e` is the next-most-mnemonic letter (and it's the second letter of "defines") |
| `contradicts` | `x` | "X" is the canonical "crossed-out" / contradiction glyph in mathematical / logic notation; `c` is too easily confused with other future shortcuts (`Cmd+C` etc.); `x` is also adjacent on the QWERTY layout |

**Collision-avoidance proof against `KIND_TO_SHORTCUT`**:

| Kind | Shortcut | Role | Shortcut | Collision? |
| --- | --- | --- | --- | --- |
| `fact` | `f` | (none uses `f`) | — | none |
| `predictive` | `p` | (none uses `p`) | — | none |
| `value` | `v` | (none uses `v`) | — | none |
| `normative` | `n` | (none uses `n`) | — | none |
| `definitional` | `d` | (none uses `d` — `defines` uses `e`) | — | **avoided** by picking `e` for `defines` |

The full union of the two tables is
`{f, p, v, n, d, s, r, q, b, g, e, x}` — twelve distinct
lowercase ASCII letters across the two single-select surfaces.
No overlap with `Escape` (a named key, not a letter). No overlap
with the future `Cmd+Enter` / `Cmd+Shift+Enter` / `Cmd+D` /
`Cmd+W` / `Cmd+O` / `Cmd+S` chrome chords from
`docs/moderator-ui.md:190-195` (those carry the `Cmd`/`Ctrl`
modifier and the modifier-bail clause filters them before any
letter match runs). The acceptance test in §8 asserts the
intersection is empty.

The shortcut hint string surfaces the mnemonics in the visual
order: `"Or press S / R / Q / B / G / E / X"`. The order tracks
the canonical `EDGE_ROLES` tuple so the hint and the button row
read top-to-bottom in the same sequence.

Three rejected alternatives:

- **Use `1`/`2`/`3`/`4`/`5`/`6`/`7` numeric shortcuts** — rejected.
  Numeric keys are easier to type but break the english-mnemonic
  policy; future locale-flexibility paths are simpler when each
  shortcut carries semantic association in at least one language.
- **Use the first letter of each role for `defines` (i.e., `d`)
  and shift the kind shortcut for `definitional`** — rejected. The
  kind shortcut `d` is established (palette already shipped); the
  edge-role surface adapts to the existing palette, not the other
  way round.
- **Use `c` for `contradicts`** — rejected. `c` collides with the
  reserved `Cmd+C` browser-copy chord enough that even though the
  modifier-bail clause filters `Cmd+C` cleanly, the unshifted `c`
  has a high collision probability with future chord-letters
  (decompose, capture-defeater, etc., per `docs/moderator-ui.md:192-194`).
  `x` is unambiguous.

### 8. Per-button `title` tooltip surfaces `methodology.edgeRole.<role>.description`

Three candidates surveyed:

- **Use the `title` attribute** (chosen). Native browser tooltip
  on hover; zero new component surface; the description text is
  the same one the hover popover renders on edges (per
  `mod_edge_popover_full_target_wording`). The selector and the
  popover are the two surfaces where the description earns its
  existence as a discovery affordance. The `title` attribute is
  also surfaced by screen readers as supplementary information,
  so the accessibility win is free.
- **Render the description below each button as visible help
  text** — rejected. The seven descriptions are one-sentence each;
  rendering them inline would balloon the selector's footprint
  (seven extra `text-xs` lines) for a discovery affordance the
  experienced moderator doesn't need.
- **Render the description in a custom hover popover** — rejected
  as over-engineering. The popover would require a new component
  + positioning + accessibility wiring for parity with the
  hover-popover. The native `title` attribute reaches 90% of the
  benefit with zero new code.

### 9. New keys scoped under `moderator.edgeRolePalette.*` namespace

Naming mirrors the precedent (`moderator.classificationPalette.*`,
`moderator.captureTextInput.*`, `moderator.captureTargetChip.*`):
sub-area named after the component, six keys total. The reserved
`hiddenHelp` key is landed alongside the active five so a future
visual-prototyping pass can light up the placeholder without
re-opening the catalog.

### 10. e2e block extends the existing capture spec, not a new file

Same rationale as `mod_target_auto_suggest` Decision §7 and
`mod_classification_palette` Decision §8: the setup
(login + create-session + navigate + seed) is identical to the
predecessor blocks; co-locating new capture-flow tests in
`tests/e2e/moderator-capture.spec.ts` keeps the setup duplication
under control. The file is already the canonical capture-pane e2e
home; this task joins it as the fifth `test()` block (text-input,
classification palette, target auto-suggest, target clear
override, and now edge role selector).

### 11. Native-review follow-up registered, not bundled

Same rationale as every capture-flow predecessor: native review
is a different skill from the wiring; the selector is functional
without the review (a pt-BR moderator sees the draft
"Papel da aresta — escolha como..." aria-label and reads a
comprehensible label); the native-speaker review chain stays
serializable through `depends !i18n_target_clear_override_native_review`.

### 12. No new ADR

Four potential ADR triggers, all dispatched:

- **"A new shortcut table is ADR-worthy."** No — the
  english-mnemonic policy is pinned by ADR 0024 and
  `i18n_keyboard_shortcuts_policy.md`. The `EDGE_ROLE_TO_SHORTCUT`
  table is a data extension under the existing policy; the
  per-role mnemonic picks are recorded in this refinement's
  Decision §7 (the right home for task-scope picks).
- **"Slot composition is ADR-worthy."** No — `<CaptureTargetAndRole>`
  is a small task-local wrapper, not a new architectural pattern.
  The composition path was pre-authorised by
  `mod_target_auto_suggest` Decision §8.
- **"A new store slice is ADR-worthy."** No — `mod_state_management`
  pinned the store contract as "form-shaped state, lightweight";
  `edgeRole` is the fourth slice (alongside `text`,
  `classification`, `targetEntityId`) under the same shape.
- **"Coupled clear is ADR-worthy."** No — the coupling is one
  task-local handler extension (`handleClear`'s body); the
  rationale is methodology (the role-without-target state is
  nonsensical), recorded here as Decision §5.

`mod_state_management`, `mod_classification_palette`,
`mod_target_auto_suggest`, `mod_target_clear_override`,
`i18n_methodology_glossary`, `i18n_methodology_role_descriptions`,
`i18n_keyboard_shortcuts_policy`, ADR 0022, ADR 0024, and the
F1 design doc spec already pinned every architectural choice this
task implements; this refinement is the task-scope pin for the
UI binding + the per-role mnemonic table.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- New `<EdgeRoleSelector>` component lands at
  `apps/moderator/src/layout/EdgeRoleSelector.tsx` as a horizontal
  button row of seven buttons (supports / rebuts / qualifies /
  bridges-from / bridges-to / defines / contradicts), bound to
  the new `useCaptureStore.edgeRole` slice with re-click toggle-off.
  Gated render: returns `null` when `targetEntityId === null`, so
  the slot collapses to the chip alone (Decision §2). Vitest
  cases at `apps/moderator/src/layout/EdgeRoleSelector.test.tsx`.
- New `<CaptureTargetAndRole>` wrapper at
  `apps/moderator/src/layout/CaptureTargetAndRole.tsx` composes
  `<CaptureTargetChip>` and `<EdgeRoleSelector>` into the
  `edgeRoleSelector` slot per the composition path
  `mod_target_auto_suggest` Decision §8 pre-authorised. Mounted
  via `apps/moderator/src/routes/Operate.tsx`, replacing the
  direct `<CaptureTargetChip>` slot binding. Vitest cases at
  `apps/moderator/src/layout/CaptureTargetAndRole.test.tsx`.
- `useCaptureStore` gains the fifth slice
  (`edgeRole: EdgeRole | null` + `setEdgeRole(role)` setter +
  initial-state extension + `reset()` clear) in
  `apps/moderator/src/stores/captureStore.ts`; extended setter +
  reset coverage in `apps/moderator/src/stores/stores.test.tsx`.
- `captureKeymap.ts` gains an `onPickEdgeRole?: (role: EdgeRole) => void`
  optional handler on `CaptureKeymapHandlers`, a new
  `SHORTCUT_TO_EDGE_ROLE` reverse table materialised at module load
  (s/r/q/b/g/e/x), and a new branch in `attachCaptureKeymap`'s
  `onKeyDown` for the role mnemonics. The existing modifier-bail /
  editable-target / repeat-skip guards apply to the new bindings
  for free. New `captureKeymap.test.ts` blocks cover the inverse-table
  shape + the new handler.
- Coupled clear lands per Decision §5: clearing the target (× button
  or `Esc` via `mod_target_clear_override`'s `handleClear`) also
  nulls `edgeRole`. `apps/moderator/src/layout/CaptureTargetChip.tsx`
  subscribes to `setEdgeRole` and bumps it inside `handleClear`;
  two coupled-clear regression cases land in
  `apps/moderator/src/layout/CaptureTargetChip.test.tsx`.
- Shared seam grows in `@a-conversa/i18n-catalogs`:
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts` now exports
  `EDGE_ROLES` literal tuple, `EdgeRole` type,
  `EDGE_ROLE_TO_SHORTCUT` table, `getShortcutForEdgeRole(role)`
  helper, and `buildShortcutMatrix()` returning
  `{ kinds, roles }: ShortcutMatrixRow` rows; index.ts re-exports
  the new symbols. New test block in
  `packages/i18n-catalogs/src/keyboard-shortcuts.test.ts` covers
  the inverse table + cross-table no-collision invariant.
- 6 new catalog keys × 3 locales = 18 entries land under a new
  `moderator.edgeRolePalette.*` namespace in
  `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`,
  with pt-BR and es-419 drafts flagged PENDING in the matching
  `*.review.json` trackers. Native-speaker review registered as
  `i18n_edge_role_selector_native_review` in
  `tasks/35-frontend-i18n.tji` per Decision §11.
- One new `test()` block extends
  `tests/e2e/moderator-capture.spec.ts`: gated render, click +
  keyboard selection, editable-target bail, coupled-clear via the
  × button. `chromium-create-session` Playwright project: 7/7
  passing in 8.9s.
- Closes the last leaf-blocker for `mod_propose_action` (the
  `mod_capture_flow` capstone). Sibling capture-flow leaves
  `mod_capture_text_input`, `mod_classification_palette`,
  `mod_target_auto_suggest`, `mod_target_clear_override`, and
  `mod_edge_role_selector` are now all `complete 100`;
  `mod_propose_action` is eligible to start. `mod_capture_flow`
  itself remains open until that capstone lands; M4 stays open.
- Vitest test-count delta: 2777 → 2861 (+84 new cases).
