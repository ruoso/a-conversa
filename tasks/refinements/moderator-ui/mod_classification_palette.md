# Moderator capture-pane classification palette + keyboard shortcuts

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_classification_palette`.

```
task mod_classification_palette "Classification palette + keyboard shortcuts" {
  effort 1d
  allocate team
  depends frontend_i18n.i18n_methodology_glossary, frontend_i18n.i18n_keyboard_shortcuts_policy
}
```

## Effort estimate

**1d.** Confirmed. The deliverable is component + store-wire + keymap +
i18n + tests on top of seams already in place:

- `<BottomStripCapture>` exposes a `classificationPalette` render-prop slot
  keyed to the stable `bottom-strip-classification` `data-testid` (per
  `mod_bottom_strip_capture`).
- `useCaptureStore` already carries a `classification: StatementKind | null`
  slice and a `setClassification(kind | null)` setter (per
  `mod_state_management`); this task is the first reader/writer pair on that
  slice (the precedent reader/writer pair for `text` is `mod_capture_text_input`,
  commit `1499ca0`'s parent).
- The english-mnemonic shortcut table
  (`{fact: 'f', predictive: 'p', value: 'v', normative: 'n', definitional: 'd'}`)
  ships from `@a-conversa/i18n-catalogs` as `KIND_TO_SHORTCUT` and
  `getShortcutForKind(kind, locale)` (per `i18n_keyboard_shortcuts_policy`).
  The palette imports the table; it does NOT redeclare the mapping.
- The localized kind labels (`methodology.kind.{fact|predictive|value|normative|definitional}`)
  already ship from the methodology glossary in all three v1 locales
  (`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json:30-36`).
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419 drafts is
  established by `i18n_methodology_role_descriptions`, `mod_create_session_form`,
  `mod_layout_tidy_action`, and `mod_capture_text_input`.

Concretely the deliverable is:

- One new component `apps/moderator/src/layout/ClassificationPalette.tsx`
  (horizontal button row, one button per `StatementKind`, bound to
  `useCaptureStore.classification`).
- One new keymap module `apps/moderator/src/layout/captureKeymap.ts` (a
  thin global `keydown` listener registered by `<ClassificationPalette>`'s
  `useEffect`; lives in its own file so future capture-flow tasks
  — `mod_propose_action`'s `Cmd+Shift+Enter`, `Esc` to exit mode, etc.
  — can join the same module rather than each task re-implementing
  document-level listeners).
- ~14–18 new Vitest cases under
  `apps/moderator/src/layout/ClassificationPalette.test.tsx`.
- One new `test()` block extending `tests/e2e/moderator-capture.spec.ts`
  (the sibling spec just landed by `mod_capture_text_input`, commit
  `1499ca0`'s parent set) covering each kind button rendering with the
  localized label, click → store update, keyboard shortcut → store
  update, mutually-exclusive selection.
- 5 new i18n catalog keys × 3 locales = **15 new catalog entries** for
  the palette chrome (the wrapper aria-label) + per-kind aria-label
  composition (the visible label is the existing
  `methodology.kind.<kind>` glossary entry). The 5 kind tooltip
  descriptions are scoped as a separate FUTURE task (see Decision §7)
  — this task does NOT migrate the `methodology.kind.<kind>` shape
  from bare-label to `{label, description}`; that lands in the
  follow-up.
- 1 follow-up tech-debt task registered in `tasks/35-frontend-i18n.tji`
  for the native-speaker review of the 10 new pt-BR / es-419 draft
  entries (`i18n_classification_palette_native_review`, effort 0.5d,
  `depends !i18n_capture_text_input_native_review`).
- One-line wire-up in `apps/moderator/src/routes/Operate.tsx`: pass
  `<ClassificationPalette />` into `<BottomStripCapture>`'s
  `classificationPalette` slot.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their
public contracts):

- **`frontend_i18n.i18n_methodology_glossary`** (done — 2026-05-11). Landed
  `methodology.kind.{fact|predictive|value|normative|definitional}` as
  bare-label string entries in all three v1 locales
  (`en-US`: Fact / Predictive / Value / Normative / Definitional;
  `pt-BR`: Fato / Preditiva / Valor / Normativa / Definicional;
  `es-419`: Hecho / Predictiva / Valor / Normativa / Definicional). The
  palette consumes these directly via
  `t(\`methodology.kind.${kind}\`)`. The pt-BR / es-419 entries remain
  PENDING in the sibling `*.review.json` trackers; that follow-up
  belongs to the glossary's own native-review chain, NOT this task.
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — 2026-05-11;
  ADR 0024 pinned the policy, `packages/i18n-catalogs/src/keyboard-shortcuts.ts`
  ships the executable mapping). The palette imports
  `KIND_TO_SHORTCUT`, `METHODOLOGY_KINDS`, and `getShortcutForKind`
  from `@a-conversa/i18n-catalogs`. Under the english-mnemonic policy
  the shortcuts (`f`/`p`/`v`/`n`/`d`) are locale-independent; the
  palette renders the same key chip in every locale next to the
  localized label.
- **`moderator_ui.mod_capture_flow`** parent block's `depends` line —
  `!mod_layout, !mod_graph_rendering, backend.websocket_protocol.ws_propose_message`
  — every leaf is done. `!mod_layout` covers `mod_bottom_strip_capture`
  (the slot scaffold) and `mod_mode_banner` (the first store reader);
  `!mod_graph_rendering` covers the operate-route canvas the palette
  renders alongside; `ws_propose_message` matters for `mod_propose_action`
  downstream, not this task (the palette does not emit any WS message).
- **`moderator_ui`** top-level
  `depends backend.backend_tests.be_e2e_tests.auth_flow_integration`
  (settled — Playwright OIDC handshake harness used by every
  `tests/e2e/*.spec.ts` that reaches `/sessions/<id>/operate`).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done — exposes
  the `classificationPalette` render-prop slot with the stable
  `bottom-strip-classification` testid;
  `mod_bottom_strip_capture.md` Status block lines 66–71 spell out the
  slot contract).
- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done —
  sibling, just landed, same pane. The text-input owns the `text`
  slice; this task owns the `classification` slice. No coupling
  between the two surfaces beyond sharing the same store — typing
  into the textarea does not affect the palette's selection, and
  clicking a kind button does not affect the in-progress draft text.
  Both reset together via `useCaptureStore.getState().reset()` which
  `mod_propose_action` will call on propose-success).
- **`moderator_ui.mod_state_management`** (done —
  `apps/moderator/src/stores/captureStore.ts:44` declares
  `classification: StatementKind | null` with `setClassification` at
  line 52 and reset-to-`null` in `initialCaptureState` at line 60;
  the `StatementKind` type re-exports from
  `@a-conversa/shared-types/events/proposals.ts:66`).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done —
  the operate route is reachable via `/sessions/new` →
  `POST /api/sessions` → `/sessions/<id>/operate`. The capture-pane
  classification palette is reachable from a real user flow, which is
  what makes the Playwright e2e the non-deferred default per the
  UI-stream e2e policy).
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
  — the `useTranslation()` API the new component consumes; the
  english-mnemonic / locale-independent shortcut policy pinned in
  the ADR's Consequences section.

Pending edges (this task does NOT depend on them; this task FEEDS them):

- **`moderator_ui.mod_capture_flow.mod_target_auto_suggest`** — sibling.
  Reads/writes the `targetEntityId` slice. No coupling.
- **`moderator_ui.mod_capture_flow.mod_target_clear_override`** —
  sibling. Same `targetEntityId` slice consumer; no palette interaction.
- **`moderator_ui.mod_capture_flow.mod_edge_role_selector`** — sibling.
  Reads/writes a future edge-role slice. No palette interaction.
- **`moderator_ui.mod_capture_flow.mod_propose_action`** — downstream.
  Depends on
  `!mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector`
  per the WBS (`tasks/30-moderator-ui.tji:287`). Will read the three
  slices, emit the multi-event proposal, and call
  `useCaptureStore.getState().reset()` on success. This task provides
  the second of the three slice writers; `mod_propose_action` validates
  that `classification` is non-null before submitting.
- **`moderator_ui.mod_keymap_help_overlay`** — future. Will consume
  `buildShortcutMatrix()` from `@a-conversa/i18n-catalogs` and render
  `<KEY>: <localized label>` per kind. This task does NOT ship the
  help overlay; it ships the keymap binding the overlay will document.
- **`frontend_i18n.i18n_classification_palette_native_review`**
  (registered by this task). The pt-BR / es-419 drafts of the 5 new
  palette-chrome keys land flagged PENDING; the follow-up replaces
  them with native-speaker-reviewed text.
- **(Optional future)
  `frontend_i18n.i18n_methodology_kind_descriptions`** — would migrate
  `methodology.kind.<kind>` from a bare-label string to a
  `{label, description}` object (mirroring the
  `methodology.edgeRole.<role>` migration from
  `i18n_methodology_role_descriptions`) and surface a one-sentence
  per-kind tooltip on palette-button hover. NOT in scope for this
  task — see Decision §7.

## What this task is

Land the horizontal-button-row component that fills
`<BottomStripCapture>`'s `classificationPalette` slot. The component:

1. **Renders five buttons**, one per `StatementKind` value (`fact`,
   `predictive`, `value`, `normative`, `definitional`) in the canonical
   order from `METHODOLOGY_KINDS`
   (`packages/i18n-catalogs/src/keyboard-shortcuts.ts:44-50`). Each
   button shows the localized label from
   `methodology.kind.<kind>` plus a small key-chip showing the
   english-mnemonic shortcut from `KIND_TO_SHORTCUT[kind]` (e.g.,
   `F` / `P` / `V` / `N` / `D`).
2. **Reads** `classification` from `useCaptureStore` and **writes**
   via `setClassification(kind)` on click — a shared-store-backed
   single-select group, NOT component-local state. Mutually exclusive
   selection: clicking `value` after `fact` was selected calls
   `setClassification('value')`, which overwrites the slice; only one
   kind is ever picked.
3. **Toggles off on re-click**: clicking the currently-selected kind
   calls `setClassification(null)` so the moderator can clear the
   picked kind without keyboard. (Decision §4 below.)
4. **Wires a global `keydown` listener** that fires the same
   `setClassification(kind)` when the moderator presses the kind's
   english-mnemonic key (`f`/`p`/`v`/`n`/`d`). The listener:
   - matches on `event.key.toLowerCase()` so caps-lock + shift don't
     break the binding;
   - **ignores the event** if the active focus is on an editable
     element (`<textarea>`, `<input>`, `[contenteditable]`) so typing
     "f" into the capture-pane wording textarea does not flip the
     palette; this is the canonical multi-focus shortcut pattern;
   - **ignores the event** if any modifier other than shift is held
     (`metaKey`, `ctrlKey`, `altKey`) so the `Cmd+Enter`-style
     gestures from `mod_capture_text_input` / `mod_propose_action`
     do not collide with palette keys;
   - calls `event.preventDefault()` on a match so the keystroke is
     consumed by the palette and does not bubble further.
5. **Surfaces visual selection state** via two channels: the button's
   `aria-pressed` attribute (`true` for the selected kind, `false` for
   every other), and a distinct Tailwind variant (filled background +
   stronger border for the selected kind; outline-only for the unselected
   kinds). WCAG AA contrast holds in both states (Decision §5).
6. **Exposes** the wrapper aria-label
   (`moderator.classificationPalette.ariaLabel`,
   "Statement classification — pick a kind for the new statement"),
   the per-button aria-label
   (`moderator.classificationPalette.kindButtonAriaLabel`,
   `"{label} ({key})"` so a screen-reader user hears
   `"Fact (F)"` / `"Hecho (F)"`), the key-chip aria-hidden text (the
   visible mnemonic glyph), the shortcut-hint helper line
   (`moderator.classificationPalette.shortcutHint`,
   `"Or press F / P / V / N / D"`), and the wrapper-role label
   surface — see "i18n catalog keys" below.
7. **Does NOT** emit any WS message, does NOT validate methodology
   shape, does NOT touch any pane other than its own slot. It is a
   single-select button group; the propose round-trip is
   `mod_propose_action`'s job.

The task is the **second** store-reading input to mount into the bottom
strip (`mod_capture_text_input` was the first; `mod_target_auto_suggest`
+ `mod_target_clear_override` + `mod_edge_role_selector` are the
remaining capture-flow inputs; `mod_propose_action` is the consumer
that reads all four slices).

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_propose_action` cannot land without it.** The propose action
   depends on
   `!mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector`
   (`tasks/30-moderator-ui.tji:287`). The three sibling tasks own the
   three pieces of the in-progress proposal the propose action emits as
   a multi-event bundle (`node-created` + `proposal: classify-node` +
   optional `edge-created` + `proposal: set-edge-substance` per
   `docs/moderator-ui.md:46`). Until all three land, propose has
   nothing to read. The text-input has landed (commit `1499ca0`'s
   parent); this task ships the second of the three.

2. **Classification is methodology-load-bearing.** Per `DESIGN.md:9-19`:
   *"The platform aims to slow debate down and force clarity to build
   slowly, by classifying every statement..."* and
   *"`Real-time classification: the moderator labels each statement as
   it is made.`"* The five-kind classification is the foundation of the
   methodology — every node in the graph carries a kind facet, and
   `mod_propose_action` cannot emit the `classify-node` proposal
   without one. Per
   `packages/shared-types/src/events/proposals.ts:73-77`, the
   `classify-node` proposal schema requires the `kind` field; an
   absent kind is a server-side validation failure.

3. **The keyboard-shortcuts policy is now load-bearing.** Per
   `docs/moderator-ui.md:187` (*"The moderator's hands need to stay on
   the keyboard to keep up with live debate"*) and
   `docs/moderator-ui.md:189` (*"`f` / `p` / `v` / `n` / `d` — propose
   classification"*), single-key classification is a primary design
   constraint. `i18n_keyboard_shortcuts_policy` pinned the
   english-mnemonic / locale-independent policy and shipped the
   executable mapping; this task is the first consumer of the mapping
   and the first place a moderator can actually press `f` to pick
   `fact`. Without it, the shortcuts module is unconsumed code.

Downstream, the palette is one of three slices the propose action
depends on; the other two (`mod_capture_text_input` done,
`mod_edge_role_selector` pending) plug into the same scaffold's other
sub-slots and are blocked only by sequencing, not by shared state.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- `apps/moderator/src/layout/BottomStripCapture.tsx:42-95` — the
  scaffold that owns the `classificationPalette` prop and the
  `bottom-strip-classification` sub-slot. The scaffold's placeholder
  `<span aria-hidden="true">[classification]</span>` becomes
  unreachable through `<OperateRoute>` once this task wires
  `<ClassificationPalette />` into the slot; the placeholder survives
  only for the scaffold-only `BottomStripCapture.test.tsx` cases.
- `apps/moderator/src/layout/CaptureTextInput.tsx:1-156` — most recent
  sibling, same pane, just landed. Patterns this task mirrors:
  `useTranslation()` for catalog access,
  `useCaptureStore((s) => s.<slice>)` for read + write,
  `data-testid` per surface, slate-toned Tailwind palette, the
  `'@a-conversa/...'` import alias style.
- `apps/moderator/src/layout/ModeBanner.tsx:1-51` — first store-reading
  component; established the per-locale parity round-trip pattern
  this task reuses.
- `apps/moderator/src/stores/captureStore.ts:44-77` — the store
  contract. `classification: StatementKind | null`,
  `setClassification: (classification: StatementKind | null) => void`,
  `reset(): void` (which resets `classification` to `null`). The
  initial-state object at line 60 has `classification: null`. The
  `reset()` is called only by `mod_propose_action`'s post-success path
  (the palette does not call `reset()`).
- `apps/moderator/src/routes/Operate.tsx:53-80` — the integration site.
  The existing
  `<BottomStripCapture modeBanner={<ModeBanner />} textInput={<CaptureTextInput onSubmit={noopSubmit} />} />`
  block grows by one prop:
  `classificationPalette={<ClassificationPalette />}`. No `onSubmit`
  or similar callback prop on the palette — the slice write is direct.
- `apps/moderator/src/stores/stores.test.tsx:49-60` — the precedent
  case the palette extends:
  `useCaptureStore.getState().setClassification('fact')` already
  exists as a store-mutation smoke; this task is the first UI surface
  driving the same setter.
- `apps/moderator/src/graph/HoverPopover.tsx:141` — the canonical
  reader of `methodology.kind.<kind>`:
  `const kindLabel = kind === null ? '—' : t(\`methodology.kind.${kind}\`);`
  The palette adopts the same key-shape lookup; if the future
  `methodology.kind.<kind>` shape migration lands (Decision §7), both
  consumers migrate together.
- `packages/shared-types/src/events/proposals.ts:58-66` —
  `statementKindSchema` and `StatementKind`:
  ```ts
  export const statementKindSchema = z.enum([
    'fact', 'predictive', 'value', 'normative', 'definitional',
  ]);
  export type StatementKind = z.infer<typeof statementKindSchema>;
  ```
  The palette imports `StatementKind` for its prop / handler types;
  the iteration order is sourced from
  `@a-conversa/i18n-catalogs`'s
  `METHODOLOGY_KINDS` literal-tuple (same five values, same order).
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts:44-100` — the
  shortcut table and lookup function. The palette imports
  `METHODOLOGY_KINDS`, `KIND_TO_SHORTCUT`, `getShortcutForKind`, and
  the `MethodologyKind` type.
- `packages/i18n-catalogs/src/catalogs/en-US.json:29-36` —
  `methodology.kind.{fact|predictive|value|normative|definitional}`
  with the canonical en-US labels. Mirrored in `pt-BR.json:29-36` and
  `es-419.json:29-36`.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the
  PENDING-flag trackers; the 10 new draft entries (5 new keys × 2
  non-en-US locales) get added to the `pending` list per the
  established `i18n_methodology_role_descriptions` /
  `mod_create_session_form` / `mod_layout_tidy_action` /
  `mod_capture_text_input` pattern.
- `tests/e2e/moderator-capture.spec.ts:1-101` — the sibling spec, just
  landed. The new palette scenario extends this file with a new
  `test()` block reusing the same login + create-session + navigate
  setup. Decision §8 records the placement choice.

DESIGN.md / docs consulted:

- `DESIGN.md:9` — *"The platform aims to slow debate down and force
  clarity to build slowly, by classifying every statement and only
  proceeding when both sides agree on the classification."* The
  palette is the moderator's per-statement classification surface.
- `DESIGN.md:17` — *"Real-time classification: the moderator labels
  each statement as it is made."* The palette is the load-bearing UI
  for that labeling step.
- `DESIGN.md:28-30` — *"Every node carries a statement kind (fact /
  predictive / value / normative / definitional). Every edge carries
  an argument role ... The two dimensions are independent."* The
  palette covers the node-kind half; `mod_edge_role_selector` will
  cover the edge-role half.
- `DESIGN.md:43` — i18n constraint: *"The methodology vocabulary
  (statement kinds, edge roles, facet states, diagnostic kinds) is
  presented in the active locale; the underlying data model remains
  English-coded."* The palette renders the localized label but emits
  the english-coded `StatementKind` to the store.
- `docs/moderator-ui.md:33` — *"Bottom strip — capture pane: text
  input, classification palette, edge-target selector, mode banner."*
  Confirms the palette mounts into the bottom strip; this task fills
  the second of the four named sub-slots.
- `docs/moderator-ui.md:44` — F1 step 2: *"Select the kind from the
  classification palette (`fact` / `predictive` / `value` / `normative` /
  `definitional`). Single-key shortcut per kind speeds this."* The
  primary specification for the palette.
- `docs/moderator-ui.md:50` — *"The wording, classification, and edge
  are separate proposals under the data model — and debaters vote on
  each facet individually."* Implication for the palette: it owns the
  classification facet's IN-PROGRESS proposal state, not its
  post-commit projection state (that lands via the graph's kind glyph
  on the node, which is rendered by `mod_node_rendering`).
- `docs/moderator-ui.md:189-204` — Keyboard shortcuts sketch, including
  the explicit english-mnemonic note that cites
  `i18n_keyboard_shortcuts_policy`.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — pinned the english-mnemonic classification-shortcut policy in its
  Consequences section.
- `tasks/refinements/moderator-ui/mod_capture_text_input.md` — most
  recent sibling; the catalog + PENDING-flag + tech-debt-registration
  pattern this refinement mirrors. Also pinned the
  `e.metaKey || e.ctrlKey` non-methodology-shortcut convention this
  refinement defers to (the palette's `f`/`p`/`v`/`n`/`d` are
  methodology shortcuts, no modifiers).
- `tasks/refinements/moderator-ui/mod_bottom_strip_capture.md` — the
  scaffold whose `classificationPalette` slot this task fills.
- `tasks/refinements/moderator-ui/mod_mode_banner.md` — first
  store-reading consumer; the i18n + per-locale parity pattern.
- `tasks/refinements/moderator-ui/mod_state_management.md` — the
  store contract this task is the second writer for (after
  `mod_capture_text_input`).
- `tasks/refinements/frontend-i18n/i18n_methodology_glossary.md` — the
  source of `methodology.kind.<kind>` labels.
- `tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md`
  — the english-mnemonic policy + the executable
  `KIND_TO_SHORTCUT` table.
- `tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md`
  — the precedent shape migration (`<role>` bare-string →
  `<role>.{label, description}`); referenced for Decision §7's
  rejection of the parallel kind-descriptions migration in this task.

No new ADR is required (see Decisions §10); no new dependency lands
(`zustand`, `react-i18next`, `@a-conversa/shared-types`, and
`@a-conversa/i18n-catalogs` are already imported in the moderator
workspace); no public type signature changes; no cross-workspace
contract changes.

## Constraints / requirements

### Component shape

- **New file**
  `apps/moderator/src/layout/ClassificationPalette.tsx` exporting
  `function ClassificationPalette(): ReactElement` (named export, no
  default). No props — the component sources its read AND write from
  `useCaptureStore` and `@a-conversa/i18n-catalogs` directly.
- **Single root element** wrapping a labelled
  `<div role="group" aria-label=...>` containing five
  `<button type="button">` children plus a short helper line
  (the shortcut-hint). The consumer drops the component directly into
  the scaffold's `bottom-strip-classification` slot without an extra
  wrapping div.
- **Stable test ids**:
  - `classification-palette` — outer wrapper element.
  - `classification-palette-button-<kind>` — one per kind, where
    `<kind>` is the literal english-coded id (`fact`, `predictive`,
    `value`, `normative`, `definitional`). Five total.
  - `classification-palette-key-chip-<kind>` — one per kind, the
    small visible mnemonic glyph next to the label inside the button.
  - `classification-palette-shortcut-hint` — the helper line.

### Store wiring

- `const selected = useCaptureStore((s) => s.classification);`
- `const setClassification = useCaptureStore((s) => s.setClassification);`
- Click handler per button:
  ```ts
  function handleClick(kind: MethodologyKind): void {
    if (selected === kind) {
      // Re-click toggles off — see Decision §4.
      setClassification(null);
      return;
    }
    setClassification(kind);
  }
  ```
- The setter's `null` argument is honored by the store
  (`captureStore.ts:52`: setter accepts `StatementKind | null`).
- The store's `reset()` returns `classification` to `null` and is
  called only by `mod_propose_action`'s post-success path. The
  palette does not call `reset()`.

### Keymap module (`captureKeymap.ts`)

A separate `apps/moderator/src/layout/captureKeymap.ts` exporting:

```ts
export interface CaptureKeymapHandlers {
  onPickKind: (kind: MethodologyKind) => void;
  // future: onSubmit, onExit, onDecompose, ...
}

export function attachCaptureKeymap(
  handlers: CaptureKeymapHandlers,
): () => void;  // returns a detach function
```

The palette calls `attachCaptureKeymap` from a `useEffect` on mount
and runs the returned detach function on unmount. The listener:

- Registers on `document` (not `window`) so it survives iframe edge
  cases and matches the React event-system bubble target.
- Reads `event.key.toLowerCase()` — case-insensitive matching.
- **Bails** if any of these is true:
  - `event.metaKey || event.ctrlKey || event.altKey` (modifier held);
  - `event.repeat` (key auto-repeat — palette picks are deliberate,
    not held);
  - the active element matches the editable-target selector
    `'input, textarea, select, [contenteditable="true"]'`. The check is
    `document.activeElement?.matches(...)`; if true, the keystroke
    belongs to the editing surface and the palette stays out of it.
    This is the canonical multi-focus shortcut pattern (Slack,
    GitHub PR comment box, Discord, Gmail compose).
- On a match (`key` is one of `f`/`p`/`v`/`n`/`d`), looks up the
  corresponding `MethodologyKind` via a constant reverse table
  (`SHORTCUT_TO_KIND`) materialised once at module load from
  `KIND_TO_SHORTCUT`, calls `handlers.onPickKind(kind)`, and calls
  `event.preventDefault()` so the keystroke is consumed.

The handlers object is held in a `useRef` inside the palette and the
listener reads `handlersRef.current` so the effect can register once
on mount and never re-register on every `selected` change — the
ref-then-listener pattern that survives strict-mode double-mount and
avoids the re-attach storm during fast typing.

The `captureKeymap.ts` file is a separate module because future
capture-flow tasks (`mod_propose_action` will need
`Cmd/Ctrl+Shift+Enter` for commit; `Esc` to exit a mode; `Cmd+D` for
decompose per `docs/moderator-ui.md:192`) will extend the same
`CaptureKeymapHandlers` interface rather than each ship their own
`document.addEventListener` glue. Decision §6 below.

### Button surface (per kind)

Per `MethodologyKind` button:

```jsx
<button
  type="button"
  data-testid={`classification-palette-button-${kind}`}
  data-kind={kind}
  aria-pressed={selected === kind}
  aria-label={t('moderator.classificationPalette.kindButtonAriaLabel', {
    label: t(`methodology.kind.${kind}`),
    key: shortcutKey.toUpperCase(),
  })}
  onClick={() => handleClick(kind)}
  className={selected === kind ? selectedCls : unselectedCls}
>
  <span>{t(`methodology.kind.${kind}`)}</span>
  <kbd
    data-testid={`classification-palette-key-chip-${kind}`}
    aria-hidden="true"
  >
    {shortcutKey.toUpperCase()}
  </kbd>
</button>
```

- The visible label uses the title-case localized form from the
  glossary (`Fact` / `Hecho` / `Fato`).
- The visible key chip uses the uppercase form of the mnemonic
  (`F` / `P` / `V` / `N` / `D`); the listener matches the lowercase
  form so the moderator presses an unshifted key.
- `<kbd>` is the semantic element for keyboard glyphs; `aria-hidden`
  prevents the screen reader from double-announcing the key (the
  per-button aria-label already includes `(F)`).
- `aria-pressed` is the canonical mutually-exclusive-toggle attribute
  per WAI-ARIA Practices §3.21 (toggle button); WCAG-compatible
  screen readers announce `"Fact, pressed"` vs. `"Fact, not pressed"`.

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

Both selected and unselected variants pass WCAG AA contrast at the
14px font size:
- selected: white-on-`bg-blue-600` ≈ 8.59:1 (well above the 4.5:1 AA
  threshold for small text);
- unselected: `text-slate-700` on white ≈ 11.96:1.

### Helper / shortcut hint

`<p data-testid="classification-palette-shortcut-hint" class="mt-1 text-xs text-slate-500">{t('moderator.classificationPalette.shortcutHint')}</p>`

Always rendered (not just on near-empty selection) — mirrors the
`mod_capture_text_input` helper-always-rendered decision (§6 of that
refinement). The hint reads
`"Or press F / P / V / N / D"` in en-US.

### Accessibility

- The wrapper is `<div role="group" aria-label={t('moderator.classificationPalette.ariaLabel')}>`.
  `role="group"` is the canonical container for a set of related
  controls per WAI-ARIA 1.2; pairing it with an `aria-label` surfaces
  the group's purpose to screen readers.
- Each button has `type="button"` (defaults to `submit` inside a
  `<form>`, which would be wrong if the palette were ever wrapped in
  a form by a future task).
- `aria-pressed` on each button captures the toggle state.
- The keymap listener is global; a moderator using a screen reader who
  navigates to the palette and presses `Space` or `Enter` triggers the
  native button activation (no extra handler needed) — the same
  `handleClick` runs.
- Focus management: clicking a button does NOT auto-blur the textarea
  (the wording draft survives the pick); pressing a mnemonic key
  with focus on the textarea is suppressed (the editable-target
  guard) so the moderator types freely. This is symmetric with the
  text-input's no-auto-focus decision (`mod_capture_text_input` §5).
- Tab order: the five buttons are tab-focusable in order; a moderator
  using `Tab` can reach the palette and use `Space` to pick. A
  follow-up could swap to `arrow-key` navigation inside the group
  (WAI-ARIA toggle-group pattern); this task ships the tab-order
  default for simplicity.

### Mutually-exclusive single-select

- One kind is selected at a time (or none — `null` is a valid slice
  value).
- Clicking a different kind switches the selection: the slice
  receives the new `kind`; the prior button's `aria-pressed` flips to
  `false` on the next render; the new button's flips to `true`.
- Clicking the currently-selected kind toggles it off (Decision §4):
  the slice receives `null`; every button's `aria-pressed` is `false`.
- Pressing a shortcut while a kind is selected switches the
  selection the same way (`setClassification(newKind)`); the toggle-off
  behavior on shortcut-press is NOT applied — pressing the
  currently-selected kind's shortcut a second time is a no-op. The
  rationale: a mouse re-click on a button is a deliberate "undo" gesture
  (the cursor is already on the button); a keyboard re-press is more
  often an unintended bounce. Decision §4 covers this asymmetry.

### Submit gesture (not in this task)

The palette does NOT implement a submit gesture. `Cmd/Ctrl+Enter`
fires the `onSubmit` callback wired by `<CaptureTextInput>`
(`apps/moderator/src/layout/CaptureTextInput.tsx:107-115`); the
listener lives on the textarea, not on the palette. When
`mod_propose_action` lands, its handler reads the palette's
selected kind from the store and validates non-`null` before
submitting; until then the no-op `onSubmit` in
`apps/moderator/src/routes/Operate.tsx:49-51` means a submit
gesture with the palette empty is silently inert. This task
intentionally does not block submit on a null kind — that's
`mod_propose_action`'s scope.

### i18n catalog keys

Five new keys under a new `moderator.classificationPalette.*`
sub-area. Per the precedent set by `moderator.modeBanner.*` (named
after the component) and `moderator.captureTextInput.*` (named after
the just-landed sibling), the sub-area is named after the component
(`classificationPalette`).

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.classificationPalette.ariaLabel` | "Statement classification — pick a kind for the new statement" | "Classificação da declaração — escolha um tipo para a nova declaração" | "Clasificación del enunciado — elige un tipo para el nuevo enunciado" |
| `moderator.classificationPalette.legend` | "Statement kind" | "Tipo de declaração" | "Tipo de enunciado" |
| `moderator.classificationPalette.kindButtonAriaLabel` | "{label} ({key})" | "{label} ({key})" | "{label} ({key})" |
| `moderator.classificationPalette.shortcutHint` | "Or press F / P / V / N / D" | "Ou pressione F / P / V / N / D" | "O presiona F / P / V / N / D" |
| `moderator.classificationPalette.unsetAria` | "Clear classification" | "Limpar classificação" | "Limpiar clasificación" |

- `legend` is the optional short label that may render above the
  group (next to the mode-banner) in a future styling pass; landing
  the key now keeps the namespace shape predictable. The current
  implementation may render it inline (`<span class="sr-only">`) or
  omit the visual rendering and rely solely on `ariaLabel`; the
  catalog entry exists either way.
- `kindButtonAriaLabel` is the ICU-interpolated per-button accessible
  name (`"Fact (F)"`); the template carries `{label}` and `{key}` so
  translators can reorder them for locales where the key first
  (`"(F) Hecho"`) reads more naturally — though all three v1 drafts
  use the en-US order.
- `unsetAria` is documented for the future "clear classification"
  surface (e.g., a small × button next to the palette, or the
  same re-click-to-toggle-off announced as a separate aria-label).
  Landed now because it's part of the same coherent namespace and
  the cost of one extra string per locale is small.

**Count: 5 keys × 3 locales = 15 catalog entries**. The pt-BR +
es-419 drafts land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json` (same pattern as `i18n_methodology_role_descriptions`,
`mod_create_session_form`, `mod_layout_tidy_action`,
`mod_capture_text_input`). The en-US is authoritative.

This task does **NOT** add any new `methodology.kind.<kind>` keys
or migrate the existing bare-label shape. Per Decision §7, a future
`i18n_methodology_kind_descriptions` task (parallel to
`i18n_methodology_role_descriptions`) would land per-kind tooltip
descriptions and migrate the catalog shape; this task consumes the
existing bare-label keys via `t(\`methodology.kind.${kind}\`)` and
defers the tooltip enhancement.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/ClassificationPalette.tsx` (new).
- `apps/moderator/src/layout/ClassificationPalette.test.tsx` (new —
  Vitest cases).
- `apps/moderator/src/layout/captureKeymap.ts` (new — the
  document-level keydown plumbing, separated for future reuse).
- `apps/moderator/src/layout/captureKeymap.test.ts` (new — Vitest
  cases for the keymap plumbing in isolation).
- `apps/moderator/src/routes/Operate.tsx` (modified — pass
  `<ClassificationPalette />` into `<BottomStripCapture>`'s
  `classificationPalette` slot; update the leading Refinement comment
  to cite `mod_classification_palette.md` alongside the existing
  references).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add
  `moderator.classificationPalette.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified —
  PENDING entries for the 5 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified —
  same).
- `tests/e2e/moderator-capture.spec.ts` (modified — one new `test()`
  block joining the existing one per Decision §8).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_classification_palette`
  lands at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_classification_palette_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration policy.
- `docs/adr/` — no new ADR. ADR 0024 already pinned the i18n
  architecture and the english-mnemonic shortcut policy;
  `mod_state_management`'s refinement pinned the store contract;
  `i18n_methodology_glossary` pinned the kind labels;
  `i18n_keyboard_shortcuts_policy` pinned the mapping table; this
  task is the UI binding for the existing decisions.
- `apps/moderator/src/stores/captureStore.ts` — the store is consumed
  transitively; no edit to the slice or the setter.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — the scaffold's
  slot contract is consumed unchanged.
- `apps/moderator/src/layout/CaptureTextInput.tsx` /
  `apps/moderator/src/layout/ModeBanner.tsx` — sibling components,
  untouched.
- `apps/moderator/src/graph/HoverPopover.tsx` — the existing reader of
  `methodology.kind.<kind>` stays unchanged (no shape migration in
  this task; Decision §7).
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — consumed
  read-only; no edit.
- `packages/shared-types/src/events/proposals.ts` — `StatementKind` is
  imported; no edit.
- `apps/server/src/` — no server-side change.
- `playwright.config.ts` — the new `test()` block joins the existing
  `tests/e2e/moderator-capture.spec.ts`, which is already picked up by
  the `chromium-create-session` project; no new project entry, no
  testMatch change.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the number of new
  `ClassificationPalette.test.tsx` + `captureKeymap.test.ts` cases
  (≥ 16).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the
  parity-check) green after the catalog edits — every
  `moderator.classificationPalette.*` key present in en-US is present
  in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds (no bundle change of
  note; one new small component + one tiny keymap module).
- `pnpm exec playwright test` green against a freshly brought-up dev
  compose stack; the new capture-palette scenario in
  `tests/e2e/moderator-capture.spec.ts` passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_classification_palette` AND the
  new `i18n_classification_palette_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The classification palette is reachable from a real user flow as of
`mod_create_session_form` (commit `05f7d67`) + `mod_capture_text_input`
(commit prior to `1499ca0`): the moderator can log in, navigate to
`/sessions/new`, create a session, land on `/sessions/<id>/operate`,
see the bottom strip with the textarea AND the new palette filling the
two left-most sub-slots. Per the UI-stream e2e policy default, the
Playwright spec is **scoped under Acceptance criteria, NOT deferred**.

**Important caveat**: `mod_propose_action` has not landed, so the
palette's selected kind does not yet drive a WS proposal. The e2e
therefore cannot assert "pick kind, submit, classify-node event
arrives"; instead it asserts "click a kind button → the button's
`aria-pressed` flips to true → the other buttons stay
`aria-pressed=false`", "press the shortcut → same observable", and
"the shared store reflects the pick" (read indirectly via the
button's `aria-pressed` state, which is the same wire). The
full chain (pick → propose → event lands → graph updates) is scoped
to `mod_propose_action`'s refinement, not this one.

## Acceptance criteria

### 1. The component renders inside the bottom-strip slot

- `<ClassificationPalette>` component at
  `apps/moderator/src/layout/ClassificationPalette.tsx` renders a
  labelled `<div role="group">` wrapping five `<button>` children
  plus a helper line. All four classes of `data-testid` (wrapper,
  per-kind button × 5, per-kind key-chip × 5, shortcut hint) resolve.
- The group is reachable via
  `screen.getByRole('group', { name: /Statement classification/ })`.
- Each button is reachable via
  `screen.getByRole('button', { name: /Fact \(F\)/ })` (and the
  parallel four other kinds).
- `<OperateRoute>` (`apps/moderator/src/routes/Operate.tsx`) passes
  `<ClassificationPalette />` into `<BottomStripCapture>`'s
  `classificationPalette` prop. The scaffold's
  `[classification]` placeholder is no longer rendered through the
  route; the scaffold-only `BottomStripCapture.test.tsx` cases
  continue to assert the placeholder for the empty-scaffold render
  path.

### 2. Store wiring (click)

- On every button click:
  - `setClassification(kind)` is called with the matching kind
    when the button was previously unselected;
  - `setClassification(null)` is called when the button was the
    currently-selected one (toggle-off, Decision §4);
  - the matching button's `aria-pressed` becomes `"true"`; every
    other button's `aria-pressed` becomes `"false"`.
- On a programmatic store mutation
  (`useCaptureStore.getState().setClassification('value')`), the
  matching button re-renders with `aria-pressed="true"` and the
  Tailwind selected-variant classes.
- On a `useCaptureStore.getState().reset()` call, every button
  re-renders with `aria-pressed="false"`.

### 3. Store wiring (keyboard shortcut)

- Pressing `f` / `p` / `v` / `n` / `d` (with no modifier other than
  shift) anywhere on the page calls
  `setClassification(<kind>)` with the matching kind.
- Pressing the same key a second time while that kind is selected
  is a no-op (shortcut re-press does NOT toggle off — Decision §4
  records the asymmetry vs. click).
- Pressing a different kind's key switches the selection.
- Pressing `f` (or any palette key) while focus is on the
  capture-pane textarea (`<textarea data-testid="capture-text-input-textarea">`)
  does NOT trigger the palette; the textarea's `value` gains the
  literal `"f"` character and the store's `classification` slice is
  unchanged.
- Pressing `Cmd+F` / `Ctrl+F` does NOT trigger the palette (browser
  find still works); the modifier-bail clause is exercised.
- Pressing `Alt+F` does NOT trigger the palette; same clause.
- Pressing `Shift+F` DOES trigger the palette (shift is the one
  allowed modifier — caps-lock-equivalent only, and the lowercase
  match still resolves).

### 4. Listener cleanup on unmount

- Unmounting the component detaches the document-level keydown
  listener; a subsequent `f` keypress after unmount does NOT call
  any setter and does NOT throw.
- Re-mounting the component re-attaches the listener.
- Strict-mode double-mount in tests does NOT double-fire the setter
  (the ref-then-listener pattern handles the double-mount; the
  effect's cleanup runs between the two mounts).

### 5. Localization parity round-trip

- For each locale in `['en-US', 'pt-BR', 'es-419']`:
  - the wrapper aria-label resolves to a non-key string;
  - the legend / shortcut-hint / unsetAria resolve to non-key strings;
  - each per-kind button label resolves to the
    `methodology.kind.<kind>` glossary value for that locale
    (`Fact` / `Fato` / `Hecho` for `fact`, etc.);
  - each per-kind aria-label resolves to
    `"{glossary label} (F|P|V|N|D)"` for that locale;
  - no `[t-missing]` token nor raw catalog-key string is visible
    anywhere in the component's DOM.
- The shortcut KEY (the uppercase `F`/`P`/`V`/`N`/`D` in the chip and
  the aria-label) is IDENTICAL across all three locales — the policy
  is english-mnemonic per ADR 0024 + `i18n_keyboard_shortcuts_policy`.

### 6. Vitest cases (in `apps/moderator/src/layout/ClassificationPalette.test.tsx`)

Minimum 14 new cases, all per ADR 0022 (committed regression-class
proofs):

1. **Renders the component with all wrapper + per-kind testids** —
   wrapper, 5 buttons, 5 key chips, shortcut-hint helper.
2. **All five buttons render in the canonical
   `METHODOLOGY_KINDS` order** — `fact` first, `definitional` last.
3. **Each button's visible label is the localized
   `methodology.kind.<kind>` value** — assert against the en-US
   glossary string per kind.
4. **Each button's visible key chip is the uppercase mnemonic** —
   `F`, `P`, `V`, `N`, `D`.
5. **Each button's aria-label composes `{label} (KEY)`** — assert
   against `getByRole('button', { name: /Fact \(F\)/ })` etc.
6. **`aria-pressed` reflects the store** — render with
   `useCaptureStore.setState({ classification: 'value' })`; assert
   the `value` button has `aria-pressed="true"` and every other has
   `aria-pressed="false"`.
7. **Click a button writes to the store** — fire click on `predictive`;
   assert `useCaptureStore.getState().classification === 'predictive'`.
8. **Click the selected button toggles off** — set classification to
   `fact` programmatically; click the `fact` button; assert
   `useCaptureStore.getState().classification === null`.
9. **Click a different button switches the selection** — set
   classification to `fact`; click `value`; assert the slice is now
   `value` and not `fact`.
10. **`reset()` clears the palette** — set classification to `value`;
    call `useCaptureStore.getState().reset()`; assert every
    `aria-pressed` is `"false"`.
11. **Keyboard shortcut `f` writes to the store** — fire `keydown`
    with `key: 'f'` on `document`; assert
    `useCaptureStore.getState().classification === 'fact'`.
12. **Keyboard shortcut is case-insensitive** — fire `keydown` with
    `key: 'F'` (shift held); assert the slice receives `fact`.
13. **Keyboard shortcut ignored when focus is on a textarea** —
    render with a `<textarea>` mounted alongside the palette; focus
    the textarea; fire `keydown` with `key: 'f'`; assert the slice
    is unchanged.
14. **Keyboard shortcut ignored when `Cmd/Ctrl/Alt` is held** —
    fire `keydown` with `key: 'f', metaKey: true`; assert the slice
    is unchanged. Repeat for `ctrlKey` and `altKey`.
15. **Keyboard shortcut re-press is a no-op** — set classification
    to `fact`; fire `keydown` with `key: 'f'` again; assert the
    slice is still `fact` (NOT `null`).
16. **Unmount detaches the listener** — render, unmount, fire
    `keydown` with `key: 'f'`; assert the slice is unchanged.
17. **Per-locale parity round-trip** — for each of the three v1
    locales, render with that locale and assert no `[t-missing]`
    token nor raw catalog-key string appears anywhere in the
    palette's DOM. Assert the kind labels match the glossary's
    per-locale values.

Plus the keymap module's own cases (in
`apps/moderator/src/layout/captureKeymap.test.ts`):

1. **`SHORTCUT_TO_KIND` is the inverse of `KIND_TO_SHORTCUT`** — for
   every `kind`, `SHORTCUT_TO_KIND[KIND_TO_SHORTCUT[kind]] === kind`.
2. **`attachCaptureKeymap` returns a working detach function** —
   attach, dispatch a `keydown`, assert the handler ran; detach,
   dispatch again, assert the handler did NOT run.
3. **Modifier-bail clause** — every combination of `metaKey`,
   `ctrlKey`, `altKey` causes the listener to skip.
4. **Editable-target guard** — when `document.activeElement` is a
   `<textarea>` / `<input>` / `[contenteditable]`, the listener
   skips.
5. **`event.repeat` skips** — auto-repeat fires are deliberately
   ignored.

### 7. Playwright e2e (per Decision §8 — extends the existing capture spec)

One new `test()` block lands in `tests/e2e/moderator-capture.spec.ts`
(joining the existing `test()` from `mod_capture_text_input`),
covering:

```ts
test('alice picks a classification by click and by keyboard shortcut; selection is mutually exclusive', async ({ page }) => {
  // 1. Login + create session + navigate to operate — mirrors the
  //    capture-text-input setup in this same file.
  await loginAs(page, { username: 'alice' });
  await page.goto('/sessions/new');
  await page.getByTestId('create-session-topic-input').fill(
    'Classification palette regression check.',
  );
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
    timeout: 10_000,
  });

  // 2. The palette is mounted with five buttons in canonical order.
  const palette = page.getByTestId('classification-palette');
  await expect(palette).toBeVisible();
  for (const kind of ['fact', 'predictive', 'value', 'normative', 'definitional']) {
    await expect(
      page.getByTestId(`classification-palette-button-${kind}`),
    ).toHaveAttribute('aria-pressed', 'false');
  }

  // 3. Click `fact` → its aria-pressed flips true; others stay false.
  await page.getByTestId('classification-palette-button-fact').click();
  await expect(
    page.getByTestId('classification-palette-button-fact'),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const kind of ['predictive', 'value', 'normative', 'definitional']) {
    await expect(
      page.getByTestId(`classification-palette-button-${kind}`),
    ).toHaveAttribute('aria-pressed', 'false');
  }

  // 4. Press `v` → palette switches to `value`.
  await page.keyboard.press('v');
  await expect(
    page.getByTestId('classification-palette-button-value'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByTestId('classification-palette-button-fact'),
  ).toHaveAttribute('aria-pressed', 'false');

  // 5. Focus the capture textarea, type `f` → the textarea's value
  //    gains `"f"`; the palette stays on `value` (the editable-target
  //    guard suppresses the shortcut).
  const textarea = page.getByTestId('capture-text-input-textarea');
  await textarea.focus();
  await page.keyboard.press('f');
  await expect(textarea).toHaveValue('f');
  await expect(
    page.getByTestId('classification-palette-button-value'),
  ).toHaveAttribute('aria-pressed', 'true');

  // 6. Re-click the selected button → toggles off.
  await page.getByTestId('classification-palette-button-value').click();
  for (const kind of ['fact', 'predictive', 'value', 'normative', 'definitional']) {
    await expect(
      page.getByTestId(`classification-palette-button-${kind}`),
    ).toHaveAttribute('aria-pressed', 'false');
  }
});
```

Per the constraint above (`mod_propose_action` not landed), the
spec asserts behavior reachable via the palette + store +
text-input wiring, not behavior reachable only after the propose
round-trip. The full chain (pick → propose → classify-node event
lands) is the load-bearing regression for `mod_propose_action`'s
refinement.

### 8. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.classificationPalette.{ariaLabel, legend, kindButtonAriaLabel, shortcutHint, unsetAria}`
  keys with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` gains the same 5
  keys with the pt-BR draft strings.
- `packages/i18n-catalogs/src/catalogs/es-419.json` gains the same 5
  keys with the es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` gain
  `pending` entries for each of the 5 keys (per the established
  `*.review.json` lifecycle).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after the
  edits.

### 9. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_classification_palette` block gets
  `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_classification_palette.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_classification_palette_native_review` is added with the
  template below (effort 0.5d;
  `depends !i18n_capture_text_input_native_review`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_classification_palette_native_review "Native-speaker review of pt-BR + es-419 classification-palette strings" {
  effort 0.5d
  allocate team
  depends !i18n_capture_text_input_native_review
  note "Source of debt: mod_classification_palette (this commit) — pt-BR and es-419 drafts of the 5 keys under moderator.classificationPalette.* landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### 10. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Horizontal button row (not dropdown, not vertical stack)

Three layouts surveyed:

- **Horizontal button row, one button per kind, all five visible**
  (chosen). Five kinds is small enough to display every option as
  always-visible buttons; the moderator picks in one click or one
  keystroke without first opening a menu. Matches the
  `docs/moderator-ui.md:44` framing (*"select the kind from the
  classification palette ... single-key shortcut per kind speeds
  this"*) — "palette" connotes a visible array of options, not a
  collapsed selector. Fits the bottom strip's geometry: each button
  is small (label + key chip ≈ 80–100 px), five buttons in a row are
  ≈ 450 px total, well under the strip's flex-row width budget.
- **Vertical stack** — rejected. Wastes vertical real estate in a
  bottom strip whose height is constrained (the strip shares the
  viewport with the graph above and is intentionally shallow).
  Vertical layouts work better in sidebars; the palette lives in the
  bottom strip.
- **Dropdown / `<select>`** — rejected. Hides the options behind a
  click and breaks the single-keystroke shortcut model (a `<select>`
  consumes `f`/`p`/`v`/`n`/`d` as type-ahead navigation, not as
  "pick the corresponding option"). The "single-key shortcut per kind
  speeds this" framing in the design doc presumes the options are
  always visible.

The horizontal row also reads as "palette" semantically: every
option is on-screen, the moderator's eye scans across them once
during training and then mostly picks by keyboard.

### 2. Single-select via shared store, NOT a controlled `selectedKind` prop

Two state-locations surveyed:

- **Shared `useCaptureStore.classification` slice** (chosen). The
  downstream consumers (`mod_propose_action` reads `classification`
  alongside `text` and `targetEntityId`; the future `mod_decompose_flow`
  reuses the slice for per-component classification) all live in the
  same store already. The slice (`classification: StatementKind | null`)
  is pre-declared at `apps/moderator/src/stores/captureStore.ts:44`
  with its `setClassification` setter at line 52, exactly because
  this is the seam the multi-component capture workflow uses. The
  `mod_capture_text_input` precedent established the same pattern
  for the `text` slice (`mod_capture_text_input.md` Decision §2);
  this task mirrors it for the `classification` slice.
- **Component-local `useState<StatementKind | null>`** — rejected.
  Would force a parent-side shared-state layer (lifting state up to
  `<Operate>` or `<BottomStripCapture>`) for `mod_propose_action` to
  read — i.e., re-invent the shared store at one level higher. The
  shared store already exists and already has the slice; using it
  is the obvious choice and `mod_capture_text_input` set the
  precedent.

### 3. Iteration order from `METHODOLOGY_KINDS`, NOT a fresh literal

Two options surveyed:

- **Import `METHODOLOGY_KINDS` from `@a-conversa/i18n-catalogs`**
  (chosen). The order is canonical (`fact`, `predictive`, `value`,
  `normative`, `definitional`) and pinned in the shortcuts-policy
  module so both this task's palette and the future
  `mod_keymap_help_overlay` render the kinds in the same order. The
  shortcuts policy also exports `MethodologyKind` and
  `KIND_TO_SHORTCUT` from the same module; using one import for all
  three keeps the component's dependency surface small.
- **Inline literal tuple in the palette** — rejected. Duplicates the
  pinned order; a future reorder (e.g., grouping factual vs.
  normative) would require editing two files in lockstep and risk
  drift. The shortcuts-policy module is the single source of truth.

### 4. Re-click toggles off; re-keypress is a no-op (asymmetric)

The mutually-exclusive single-select pattern has three possible
re-action behaviors when the moderator re-selects the already-picked
kind: (a) no-op, (b) toggle off (slice → `null`), (c) re-fire the
same event. Surveyed:

- **Re-click toggles off; re-keypress is a no-op** (chosen). The
  asymmetry matches user-intent priors:
  - A mouse re-click on a button is a deliberate, focused gesture
    (the cursor is already on the button) and a common "undo my
    last pick" idiom in toggle-button UIs (Slack reaction buttons,
    Discord role pills, Twitter sentiment ratings).
  - A keyboard re-press is more often an unintended bounce (the
    moderator's hands stay on the keyboard for many minutes;
    accidentally hitting `f` twice during a fast classification
    burst should not silently un-classify the kind the moderator
    just picked). A re-keypress as a no-op matches the
    Spacebar-on-already-pressed-toggle-button browser default for
    `aria-pressed` toggles.
  - The asymmetry has a precedent in the same area: the textarea's
    `Cmd/Ctrl+Enter` submit is idempotent (firing it twice
    quickly does not double-submit because `mod_propose_action`'s
    handler will short-circuit during the in-flight propose), but
    a click on the propose button (when it lands) would also be
    idempotent in the same way. The pattern is "click is a
    deliberate confirmation; key-repeat is an accidental noise
    source." The palette imports the same intuition.

- **Re-click and re-keypress both toggle off** — rejected for the
  accidental-bounce reason above.
- **Re-click and re-keypress are both no-ops** — rejected because
  it removes the mouse "undo" idiom and pushes the moderator to
  click a different kind (or use a separate clear button) to
  unselect — a click that the mouse is already perfectly positioned
  to make.

A future "explicit clear button" surface would render the
`unsetAria` key already scoped in the catalog; that's NOT in this
task's scope but the key is landed so the future button doesn't have
to add a new catalog entry. The re-click toggle-off is the
implicit-clear gesture for now.

### 5. Visual selection via filled background AND aria-pressed (both channels)

Three visual-state strategies surveyed:

- **Filled background + aria-pressed** (chosen). Two independent
  channels: sighted users see the high-contrast filled button; screen
  reader users hear `aria-pressed="true"`. WCAG AA contrast holds
  in both states (selected: 8.59:1 white-on-blue-600; unselected:
  11.96:1 slate-700-on-white). The
  `aria-pressed` attribute is the canonical mutually-exclusive-toggle
  surface per WAI-ARIA Practices §3.21 and is read by every
  current-generation screen reader. The filled variant is what mouse
  / touch users see; the attribute is what assistive tech reads.
- **Outline-only selected variant** — rejected. A 2px outline on a
  small button is harder to spot at a glance than a filled background;
  the moderator's eye scans the strip during live debate and needs
  high-contrast feedback that the pick took.
- **aria-pressed only, no visual change** — rejected. Sighted users
  with no screen reader would have no feedback that their click took.
  Both channels matter.

The blue-600 fill also matches the focus-ring color already used by
`<CaptureTextInput>` and the create-session form's submit button —
consistent moderator-console accent.

### 6. Document-level keymap, in its own module (`captureKeymap.ts`)

Three keymap strategies surveyed:

- **Document-level `keydown` listener, attached from a
  `useEffect` in `<ClassificationPalette>`, in a separate
  `captureKeymap.ts` module** (chosen). Rationale:
  - The shortcuts must fire regardless of where focus is (modulo the
    editable-target guard) — a moderator scanning the graph with
    keyboard focus on the canvas still expects `f` to pick `fact`.
    A button-level `onKeyDown` only fires when the button has focus,
    which is the wrong model for a tool-wide chord.
  - Future capture-flow tasks
    (`mod_propose_action`'s `Cmd/Ctrl+Shift+Enter` commit,
    `Esc` to exit a mode, `Cmd+D` decompose per
    `docs/moderator-ui.md:192`, `Cmd+O` operationalization,
    `Cmd+W` warrant elicitation, `Cmd+S` snapshot) will need
    document-level handlers too. Co-locating the dispatch table
    in `captureKeymap.ts` avoids re-implementing the
    document-listener + editable-target-guard + modifier-bail
    boilerplate in every future task. Each new task extends the
    `CaptureKeymapHandlers` interface with one more callback;
    the listener already-does-the-right-thing.
  - The module is testable in isolation (unit-test the
    modifier-bail clause + editable-target guard without rendering
    a component).
- **Inline `useEffect` inside the palette without a separate
  module** — rejected. Works for one component but creates the
  re-implementation tax for every future task. The cost of one
  extra small module is ≈ 40 lines of code; the savings compound
  across the four+ future capture-flow tasks.
- **React Hotkeys library (`react-hotkeys-hook` /
  `react-hotkeys`)** — rejected. Adds a runtime dependency for
  what is ≈ 40 lines of vanilla code. The "no new dependency
  without ADR" rule applies (ADR convention); a hotkey library
  would need its own ADR, and the existing
  `keyboard-shortcuts.ts` module + a small document-listener does
  the job at zero dependency cost. The library route is reasonable
  if the keymap grows past ≈ 20 chords with sequence support, but
  v1 has ≈ 8 chords total.

### 7. Per-kind tooltip descriptions deferred — NOT in scope for this task

Three scopes surveyed:

- **Land descriptions in a separate future task**
  (`i18n_methodology_kind_descriptions`, parallel to
  `i18n_methodology_role_descriptions`) **(chosen)**. Rationale:
  - The kind-descriptions task is genuinely separate work: it
    requires authoring 5 sentence-length glosses per locale × 3
    locales = 15 description strings, all of which must be
    methodology-accurate per `docs/methodology.md`; plus a JSON
    shape migration from `methodology.kind.<kind>: "<label>"` to
    `methodology.kind.<kind>: {label, description}` mirroring the
    edge-role migration; plus the four consumer call-sites that
    read `t(\`methodology.kind.${kind}\`)` migrate to
    `t(\`methodology.kind.${kind}.label\`)`
    (`HoverPopover.tsx:141`, `StatementNode.test.tsx` references,
    and the new palette).
  - That's ≈ 0.5–1d of effort, none of which is on this task's
    critical path. The palette is functional WITHOUT tooltip
    descriptions — the visible label + key chip + the
    accessibility surface (per-button aria-label, group
    aria-label, shortcut-hint helper) communicate the option
    plenty for a trained moderator.
  - Per the precedent (`i18n_methodology_role_descriptions` was
    extracted from `mod_edge_popover_full_target_wording` as its
    own task in commit `8aa3cd7`), this is the established split:
    UI surface ships first; methodology-vocabulary descriptions
    are landed by a separate i18n task that touches multiple
    consumers in one shape-migration atomic. Bundling them here
    would mix two unrelated work products.
  - The future `i18n_methodology_kind_descriptions` task is NOT
    pre-registered in `tasks/35-frontend-i18n.tji` by this
    refinement — it is OUT-OF-SCOPE for the palette and IS NOT a
    blocker for any downstream task in the moderator stream. It
    enters the WBS when an explicit refinement asks for it (e.g.,
    a `mod_classification_palette_tooltips` task, or a separate
    `i18n_methodology_kind_descriptions` task surfaced from a
    diagnostic-message context where the kind description is
    methodology-load-bearing). This refinement only documents
    the deferral so a future reader doesn't re-litigate "should
    we add tooltips here?"

- **Bundle descriptions into this task** — rejected. Doubles the
  effort estimate and mixes "build the palette" with "translate
  five new methodology sentences," which is content-translation
  work with its own review chain. The 1d effort estimate would not
  hold.
- **Use the existing edge-role descriptions as placeholders** —
  rejected as nonsensical. Kinds and roles are different vocabulary.

### 8. Playwright e2e: extend the existing
`tests/e2e/moderator-capture.spec.ts` (NOT a new file)

Two placements considered:

- **Extend `tests/e2e/moderator-capture.spec.ts` with a new
  `test()` block** (chosen). The capture-flow spec is the natural
  home for capture-flow tests; the just-landed
  `mod_capture_text_input` Decision §8 recommended this file as
  the future home for sibling tasks
  (`mod_classification_palette`, `mod_edge_role_selector`,
  `mod_propose_action`). The setup (loginAs + create-session +
  navigate) is the same as the textarea test; sharing the file
  amortises the boilerplate. The file's value compounds across
  the four sibling tasks.
- **New file `tests/e2e/moderator-classification.spec.ts`** —
  rejected. Duplicates the setup; fragments the capture-flow
  regression home. The `mod_capture_text_input` refinement
  explicitly recommended the same-file extension for this
  successor task.

### 9. Native-review follow-up registered, not bundled into this task

Same rationale as `mod_capture_text_input` Decision §9 and
`mod_create_session_form` Decisions §6 and
`mod_layout_tidy_action` Decisions §6: native review is a different
skill from the wiring; the palette is functional without the
review (a pt-BR moderator viewing the draft
"Classificação da declaração — escolha um tipo..." aria-label
hears a comprehensible string); the native-speaker review chain
stays serializable through
`depends !i18n_capture_text_input_native_review` (the prior link
the just-landed sibling task added).

### 10. No new ADR

Three potential ADR triggers, all dispatched:

- **"A new keymap dispatch pattern is ADR-worthy."** Rejected. The
  document-level `keydown` listener + editable-target guard +
  modifier-bail is the canonical multi-focus-shortcut pattern
  (Slack, GitHub, Discord, Gmail compose all do roughly the same).
  ADR-worthy if the project later picked `react-hotkeys-hook` or
  similar; this task does not.
- **"A new keyboard-shortcut policy is ADR-worthy."** Rejected.
  This task adds NO new policy — it consumes the existing
  english-mnemonic / locale-independent policy pinned in ADR 0024
  and operationalised in
  `i18n_keyboard_shortcuts_policy` (which already shipped
  `KIND_TO_SHORTCUT` and `getShortcutForKind`). The palette is the
  first consumer; the policy doesn't change.
- **"A new state-location pattern is ADR-worthy."** Rejected.
  `useCaptureStore` and the shared-slice approach were pinned by
  `mod_state_management`; the just-landed `mod_capture_text_input`
  was the first writer/reader on the `text` slice; this task is
  the first writer/reader on the `classification` slice. Same
  pattern, second use.

ADR 0022, ADR 0024, `i18n_methodology_glossary`,
`i18n_keyboard_shortcuts_policy`, `mod_state_management`,
`mod_bottom_strip_capture`, and `mod_capture_text_input` already
pinned every architectural choice this task implements; this
refinement is the task-scope pin for the UI binding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- New component `apps/moderator/src/layout/ClassificationPalette.tsx`
  renders a horizontal-button-row palette wired into
  `<BottomStripCapture>`'s `classificationPalette` slot
  (`apps/moderator/src/routes/Operate.tsx`). Single-select bound to
  `useCaptureStore.classification` with re-click toggle-off; aria
  labels and visible button text drawn from new
  `moderator.classificationPalette.*` i18n keys (en-US authoritative).
- New shared module `apps/moderator/src/layout/captureKeymap.ts`
  extracts the document-level `f / p / v / n / d` keymap dispatcher
  with modifier-bail, editable-target guard, and repeat-skip checks.
  This is a deliberate seam: sibling capture-pane shortcut consumers
  (mod_target_clear_override, mod_propose_action, and the eventual
  global `mod_global_keymap`) extend the same module rather than
  re-implementing keymap dispatch — palette keys cleanly stand down
  while focus is on `<CaptureTextInput>` because of the shared
  editable-target guard.
- Unit coverage added: 65 new vitest cases across
  `apps/moderator/src/layout/captureKeymap.test.ts` and
  `apps/moderator/src/layout/ClassificationPalette.test.tsx`
  (suite total 2651 → 2716).
- E2E coverage: new `test()` block in
  `tests/e2e/moderator-capture.spec.ts` exercising the
  classification palette. `chromium-create-session` Playwright
  project: 4/4 passing.
- i18n: +5 keys under `moderator.classificationPalette.*` in
  `packages/i18n-catalogs/src/catalogs/en-US.json`; +5 draft keys
  each in `pt-BR.json` and `es-419.json`; +5 PENDING entries each
  in `pt-BR.review.json` and `es-419.review.json`. Catalog stays at
  175 keys present in all three locales.
- Tech-debt follow-up registered:
  `i18n_classification_palette_native_review` in
  `tasks/35-frontend-i18n.tji`, chained after
  `i18n_capture_text_input_native_review` per the serialized
  native-review queue convention.
- `complete 100` added to the `mod_classification_palette` block in
  `tasks/30-moderator-ui.tji`. Closing this task does not close
  `mod_capture_flow` (siblings `mod_target_auto_suggest`,
  `mod_target_clear_override`, `mod_edge_role_selector`,
  `mod_propose_action` remain open) and does not close M4.
- Verification: `pnpm run check` clean; moderator build 395 modules
  in 810 ms; `tj3 project.tjp` parses silent.
