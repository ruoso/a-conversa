# Moderator capture-pane statement-text input

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_capture_text_input`.

```
task mod_capture_text_input "Text input for statement wording" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. The work is component + store-wire + i18n + tests on top of
seams already in place:

- `<BottomStripCapture>` exposes a `textInput` render-prop slot keyed to the
  stable `bottom-strip-text-input` `data-testid` (per `mod_bottom_strip_capture`).
- `useCaptureStore` already carries a `text: string` slice and a
  `setText(text)` setter (per `mod_state_management`); this task is the first
  reader/writer pair on that slice.
- The cap constant `MAX_METHODOLOGY_TEXT_LENGTH = 10_000` is exported from
  `@a-conversa/shared-types` (per `backend_hardening.user_text_length_caps`);
  the client mirrors it without redeclaring the number.
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419 drafts is
  established by `i18n_methodology_role_descriptions` and `mod_create_session_form`.
- Submit-gesture wiring lives in `mod_propose_action`; this task ships the
  Cmd/Ctrl+Enter listener as an opt-in callback prop so the consumer (which is
  `<BottomStripCapture>`'s parent at integration time) can supply a no-op until
  `mod_propose_action` lands.

Concretely the deliverable is:

- One new component `apps/moderator/src/layout/CaptureTextInput.tsx`
  (controlled `<textarea>` bound to `useCaptureStore`).
- ~10–14 new Vitest cases under `apps/moderator/src/layout/CaptureTextInput.test.tsx`.
- 1 new `test()` block joining the existing
  `tests/e2e/create-session-flow.spec.ts` (the only Playwright spec that
  reaches `/sessions/<id>/operate` end-to-end today) OR a new
  `tests/e2e/moderator-capture.spec.ts` if isolation is preferred at
  implementation time — see Decision §8 below.
- 4 new i18n catalog keys under `moderator.captureTextInput.*` landed in all
  three v1 locales with the pt-BR / es-419 drafts flagged PENDING in the
  existing `*.review.json` lifecycle.
- 1 follow-up tech-debt task registered in `tasks/35-frontend-i18n.tji` for
  the native-speaker review of the 8 new pt-BR / es-419 draft entries
  (`i18n_capture_text_input_native_review`, effort 0.5d, depends
  `!i18n_layout_tidy_action_native_review`).
- One-line wire-up in `apps/moderator/src/routes/Operate.tsx`: pass
  `<CaptureTextInput onSubmit={() => {}} />` (or a deferred-submit no-op) into
  `<BottomStripCapture>`'s `textInput` slot. The `onSubmit` placeholder gets
  replaced by `mod_propose_action`'s real submit at integration time.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public
contracts):

- **`moderator_ui.mod_capture_flow`** parent block's `depends` line —
  `!mod_layout, !mod_graph_rendering, backend.websocket_protocol.ws_propose_message`
  — every leaf is done. `!mod_layout` covers `mod_bottom_strip_capture` (the
  slot scaffold) and `mod_mode_banner` (the first store reader); `!mod_graph_rendering`
  covers the operate-route canvas the input renders alongside;
  `backend.websocket_protocol.ws_propose_message` matters for `mod_propose_action`
  downstream, not this task (the text input does not emit any WS message).
- **`moderator_ui`** top-level `depends backend.backend_tests.be_e2e_tests.auth_flow_integration`
  (settled — Playwright OIDC handshake harness used by `tests/e2e/auth-flow.spec.ts`,
  `create-session-flow.spec.ts`, `moderator-graph-layout.spec.ts`,
  `moderator-hover-details.spec.ts`, `i18n-moderator-smoke.spec.ts`).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done — exposes the
  `textInput` render-prop slot with the stable `bottom-strip-text-input` testid;
  `mod_bottom_strip_capture.md` Status block lines 66–71 spell out the slot contract).
- **`moderator_ui.mod_layout.mod_mode_banner`** (done — first store reader on
  `useCaptureStore`; this task is the first reader/writer pair on the `text`
  slice. The two surfaces compose: typing into the input does not affect the
  mode-banner reading, and mode-switching does not clear the text — the
  in-progress draft survives a mode change so the moderator can switch context
  mid-compose. Reset on submit lives in `mod_propose_action`'s post-success
  `useCaptureStore.getState().reset()` call).
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore` defined at
  `apps/moderator/src/stores/captureStore.ts` with the `text: string` + `setText`
  pair this task wires to; the initial-state shape and `reset()` semantics are
  stable from that task).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done — the
  operate route is reachable from the browser via `/sessions/new/setup` →
  `POST /api/sessions` → `/sessions/<id>/operate`. The capture-pane text input
  is reachable from a real user flow, which is what makes the Playwright e2e
  the non-deferred default per the UI-stream e2e policy).
- **`backend_hardening.resource_limits_and_dos.user_text_length_caps`** (done —
  `MAX_METHODOLOGY_TEXT_LENGTH = 10_000` exported from
  `@a-conversa/shared-types/limits`. The textarea's `maxLength` honors the cap;
  the client-side limit mirrors the server-side limit exactly so a paste of
  10 001 chars rejects with a localized inline error before any propose round-trip).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()` from
  `react-i18next`, the catalog parity-check script, the `*.review.json`
  PENDING-flag lifecycle, and the per-locale smoke pattern are all in place;
  new keys flow through the same pipeline).
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — pinned the
  english-mnemonic policy at ADR 0024 and shipped the executable mapping at
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts`. The classification
  shortcuts `f/p/v/n/d` are the policy's primary load-bearing case; this task's
  submit shortcut `Cmd/Ctrl+Enter` is a non-methodology shortcut and stays
  locale-independent per the same policy's "non-methodology shortcuts stay
  as-is across locales" clause).
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new component consumes; ICU interpolation
  for the `{used}/{max} characters` helper text.

Pending edges (this task does NOT depend on them; this task FEEDS them):

- **`moderator_ui.mod_capture_flow.mod_classification_palette`** — sibling. Will
  read `useCaptureStore((s) => s.classification)` and write via
  `setClassification`. The text input owns the `text` slice; the palette owns
  the `classification` slice. No coupling between the two surfaces beyond
  sharing the same store.
- **`moderator_ui.mod_capture_flow.mod_edge_role_selector`** — sibling. Will
  read/write the `targetEntityId` slice (and a future `edgeRole` slice when
  the selector lands). Same no-coupling story.
- **`moderator_ui.mod_capture_flow.mod_propose_action`** — downstream. Depends
  on `!mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector`
  per the WBS. Will read the three slices, emit the multi-event proposal, and
  call `useCaptureStore.getState().reset()` on success. The submit gesture
  (Cmd/Ctrl+Enter) defined by this task fires an `onSubmit` callback the
  consumer wires to `mod_propose_action`'s submit handler at integration time;
  until `mod_propose_action` lands, the consumer (`<OperateRoute>`) passes a
  no-op `onSubmit={() => {}}` so the shortcut is observable but inert. This
  separation is the Decision §4 below.
- **`frontend_i18n.i18n_capture_text_input_native_review`** (registered by
  this task — see Acceptance criteria / Decisions). The pt-BR / es-419 drafts
  of the 4 new keys land flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text. Not a precondition for the input surfacing —
  a draft is rendered just as readily as a reviewed string.

## What this task is

Land the controlled-`<textarea>` component that fills `<BottomStripCapture>`'s
`textInput` slot. The component:

1. **Reads** `text` from `useCaptureStore` and **writes** via `setText`
   on every `change` event — a shared-store-backed controlled input, NOT
   component-local state. The downstream `mod_classification_palette` +
   `mod_edge_role_selector` + `mod_propose_action` siblings all read the
   in-progress draft from the same slice; centralising it eliminates the
   prop-drilling alternative.
2. **Caps** the input at `MAX_METHODOLOGY_TEXT_LENGTH = 10_000` via the native
   `maxLength` attribute. A paste that overflows truncates to the cap (browser
   default); a client-side defensive check in the change handler clamps any
   programmatic write that bypasses `maxLength` (some browsers allow paste >
   `maxLength` then re-fire `input` with the trimmed value; the clamp defends
   the slice's invariant either way).
3. **Renders** a `{used}/{max} characters` helper line under the textarea via
   the ICU-interpolated `moderator.captureTextInput.helper` key (mirror of the
   create-session form helper). The helper is **always** visible — not just
   on near-cap — because seeing the running count is the moderator's primary
   feedback that the system is reading their input.
4. **Surfaces** a Cmd/Ctrl+Enter submit gesture on the textarea via a
   `keydown` listener. The handler calls the consumer-supplied `onSubmit`
   callback. Plain Enter inserts a newline (default `<textarea>` behavior — see
   Decision §4 for the rejection of plain-Enter-submit). Cmd+Enter on macOS
   and Ctrl+Enter on every other platform are the deliberate two-finger
   confirmation. The platform-detection branch is `e.metaKey || e.ctrlKey`;
   the listener does not distinguish the two so a Linux moderator pressing
   Ctrl+Enter and a macOS moderator pressing Cmd+Enter get the same gesture.
5. **Auto-grows** in height up to a configurable max (~6 lines) then scrolls
   internally. The auto-grow is a `useLayoutEffect` that reads
   `textarea.scrollHeight` and writes `textarea.style.height` on every text
   change, clamped between the initial 2-line min-height and the 6-line
   max-height. Beyond the max, vertical scroll renders inside the textarea.
   See Decision §7.
6. **Exposes** the `aria-label` + visible `<label>` via i18n catalog keys.
   The visible label is `<label htmlFor="capture-text-input">` per accessibility
   conventions; the placeholder is hint text for the empty state.
7. **Does NOT** emit any WS message, does NOT validate methodology shape,
   does NOT touch any pane other than its own slot. It is a controlled-input
   widget; the propose round-trip is `mod_propose_action`'s job.

The task is the first store-reading **input** to mount into the bottom strip
(`mod_mode_banner` reads the store but writes nothing; this task is the first
two-way wire).

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_propose_action` cannot land without it.** The propose action depends
   on `!mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector`
   (line 285 of `tasks/30-moderator-ui.tji`). The three sibling tasks own the
   three pieces of the in-progress proposal the propose action emits as a
   multi-event bundle. Until all three land, propose has nothing to read.
   This task ships the first of the three.

2. **Capture is the moderator's primary live-debate operation.** Per
   `docs/moderator-ui.md` F1 step 1: *"Type the wording into the capture text
   field. Free-form text, multi-line allowed."* This is the most common
   moderator gesture in a session. The empty `[statement text]` placeholder
   currently rendered by `mod_bottom_strip_capture` is the visible "this is
   not yet a working tool" signal during demos; landing the real input closes
   that signal and makes the capture pane a working surface.

3. **The shared-store seam is established by `mod_state_management` and
   exercised only by `mod_mode_banner` today.** A second consumer (and the
   first writer) is what proves the seam holds — that two components reading
   different slices of `useCaptureStore` don't accidentally couple, that the
   `reset()` invariant works, that mode changes don't trash the in-progress
   draft. This task is that proof.

Downstream, this task is one of three tasks the propose action depends on; the
other two (`mod_classification_palette`, `mod_edge_role_selector`) plug into
the same scaffold's other sub-slots and are blocked only by sequencing, not by
shared state.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified against
the working tree):

- `apps/moderator/src/layout/BottomStripCapture.tsx:42-95` — the scaffold that
  owns the `textInput` prop and the `bottom-strip-text-input` sub-slot. The
  scaffold's placeholder `<span aria-hidden="true">[statement text]</span>`
  becomes unreachable through `<OperateRoute>` once this task wires
  `<CaptureTextInput />` into the slot; the placeholder survives only for the
  scaffold-only `BottomStripCapture.test.tsx` cases.
- `apps/moderator/src/layout/ModeBanner.tsx:1-51` — sibling component, the
  store-reading precedent this task mirrors. Same patterns: `useTranslation()`
  for catalog access, `useCaptureStore((s) => s.<slice>)` for read,
  `data-testid` + `role` on the root, slate-toned Tailwind palette.
- `apps/moderator/src/stores/captureStore.ts:41-78` — the store contract.
  `text: string`, `setText: (text: string) => void`, `reset(): void`. The
  initial-state object has `text: ''`. The `reset()` returns the slice to
  `''` and is called only by `mod_propose_action`'s post-success path (the
  text input does not call `reset()`).
- `apps/moderator/src/routes/Operate.tsx:30-61` — the integration site. Line
  56's `bottomStrip={<BottomStripCapture modeBanner={<ModeBanner />} />}`
  grows by one more prop: `textInput={<CaptureTextInput onSubmit={...} />}`.
  The `onSubmit` placeholder is a no-op until `mod_propose_action` lands and
  the consumer swaps in the real handler.
- `apps/moderator/src/routes/CreateSession.tsx:181-285` — second-level
  precedent for moderator-form controlled inputs: `useState<string>('')` →
  `value=...` / `onChange=...` / `ref=...` / `aria-invalid` / `aria-describedby` /
  `maxLength={N}` / helper-text rendering / focus-on-mount via `useEffect`.
  This task adapts the same shape with two changes: (a) the controlled value
  is sourced from `useCaptureStore`, not local `useState`; (b) the input is a
  `<textarea>` not an `<input type="text">` because the wording is multi-line
  free-form per `docs/moderator-ui.md` F1.
- `apps/moderator/src/layout/RightSidebar.tsx:115-131` — Tailwind precedent
  for moderator-console secondary surfaces (slate-on-white, slate-toned ring,
  focus-visible outline). The textarea adopts the same vocabulary so it visually
  belongs to the slot it sits in (the scaffold's white inner card on slate-100
  background).
- `apps/moderator/src/layout/ModeBanner.test.tsx:38-132` — Vitest precedent
  for store-reading components: per-locale parity, store-reset-in-`beforeEach`,
  `useCaptureStore.getState().setX(...)` to drive the store from a test,
  `render(<X />)` + `screen.getByTestId(...)` assertions. The new test file
  mirrors this shape with the addition of `fireEvent.change` /
  `fireEvent.keyDown` cases for the textarea's input handling.
- `apps/moderator/src/stores/stores.test.tsx:40-70` — the precedent for
  test-isolation of store mutations: `useCaptureStore.setState(captureInitial, true)`
  in `beforeEach`. The new test file imports the same captured initial state
  and resets between cases.
- `packages/shared-types/src/limits.ts:51` — `MAX_METHODOLOGY_TEXT_LENGTH = 10_000`.
  Re-exported through `packages/shared-types/src/index.ts:8` (`export * from
  './limits.js'`). The new component imports `MAX_METHODOLOGY_TEXT_LENGTH`
  from `@a-conversa/shared-types`.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — the catalog file the new
  `moderator.captureTextInput.*` namespace lands in (under the existing top-level
  `moderator` key alongside `createSession`, `rightSidebar`, `modeBanner`,
  `contextMenu`, `hoverPopover`, `graph`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the PENDING-flag
  trackers; the 8 new draft entries (4 keys × 2 non-en-US locales) get a
  `pending: true` entry per the established
  `i18n_methodology_role_descriptions` / `mod_create_session_form` /
  `mod_layout_tidy_action` pattern.
- `tests/e2e/create-session-flow.spec.ts:39-95` — the only Playwright spec
  that drives `/sessions/<id>/operate` end-to-end today. The new e2e
  scenario either joins this file (after the happy-path test asserts the
  canvas mount, drive a few keystrokes into the capture input and assert the
  store update) or lands as a new `tests/e2e/moderator-capture.spec.ts` —
  see Decision §8.
- `tests/e2e/fixtures/auth.ts` — `loginAs(page, { username: 'alice' })`.
  Unchanged by this task; the new e2e reuses it.

DESIGN.md / docs consulted:

- `DESIGN.md:43` — i18n constraint: "Participant-supplied content — statement
  wordings on nodes — is **not** translated; it stays in whatever language the
  participants spoke." Implication for this task: the textarea is locale-agnostic
  in its content; only the chrome around it (label, placeholder, helper, aria)
  is localized.
- `docs/moderator-ui.md:39-50` — F1 capture flow specification. Step 1: type
  the wording; step 2: select the kind; step 3: connect; step 4: propose.
  This task owns step 1.
- `docs/moderator-ui.md:185-204` — Keyboard shortcuts sketch. `Cmd+Enter` —
  "propose (commit the current capture as a proposal on the graph)". This is
  the canonical specification for the submit gesture the textarea fires;
  Decision §4 below cites this line.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — keyboard shortcuts stay english-mnemonic / locale-independent regardless
  of UI locale (the policy clause that lets this task use `Cmd/Ctrl+Enter`
  without per-locale keymap negotiation).
- `tasks/refinements/moderator-ui/mod_bottom_strip_capture.md` — predecessor
  scaffold; `textInput` slot contract.
- `tasks/refinements/moderator-ui/mod_mode_banner.md` — first store-reading
  consumer; the i18n pattern + store-subscription shape this task mirrors.
- `tasks/refinements/moderator-ui/mod_create_session_form.md` — most recent
  UI-with-i18n precedent; the catalog workflow + PENDING-flag lifecycle +
  per-error-key mapping + focus-on-mount idiom.
- `tasks/refinements/moderator-ui/mod_layout_tidy_action.md` — most recent
  moderator-UI refinement; the inputs-section shape, the tech-debt-registration
  for the native-review follow-up, and the Tailwind secondary-surface vocabulary.
- `tasks/refinements/moderator-ui/mod_state_management.md` — the store contract
  this task is the first writer for.
- `tasks/refinements/backend-hardening/user_text_length_caps.md` — the
  server-side cap (10 000) this task mirrors at the input boundary.
- `tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md` — the
  english-mnemonic policy + the "non-methodology shortcuts stay as-is across
  locales" clause.
- `tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md` —
  the canonical PENDING-flag + native-review pattern.

No new ADR is required (see Decisions); no new dependency lands (`zustand`,
`react-i18next`, and `@a-conversa/shared-types` are already imported in the
moderator workspace); no public type signature changes; no cross-workspace
contract changes.

## Constraints / requirements

### Component shape

- **New file** `apps/moderator/src/layout/CaptureTextInput.tsx` exporting
  `function CaptureTextInput(props: CaptureTextInputProps): ReactElement`
  (named export, no default).
- **Single root element** wrapping `<label>` + `<textarea>` + helper `<p>` so
  the consumer can drop the component directly into the scaffold's
  `bottom-strip-text-input` slot without an extra wrapping div.
- **Root testid**: `capture-text-input` (the outer block container).
- **Textarea testid**: `capture-text-input-textarea` (the focusable control).
- **Helper testid**: `capture-text-input-helper` (the `{used}/{max} characters`
  count).
- **Label testid**: `capture-text-input-label` (the visible `<label>` for the
  textarea).

### Props

```ts
export interface CaptureTextInputProps {
  /**
   * Fired when the moderator presses Cmd/Ctrl+Enter inside the textarea.
   * The consumer supplies the submit handler — `mod_propose_action`
   * wires it to the propose round-trip; integration points landing
   * before propose action pass a no-op (`() => {}`).
   * Plain Enter does NOT fire this; it inserts a newline (native
   * textarea behavior).
   */
  onSubmit?: () => void;
}
```

Exactly one prop. No `value` / `onChange` / `defaultValue` — the component
sources its value from `useCaptureStore` and writes back via `setText`. A
consumer that needs to read the current value reads `useCaptureStore.getState().text`
directly; a consumer that needs to clear the value calls
`useCaptureStore.getState().reset()`.

### Store wiring

- `const text = useCaptureStore((s) => s.text);`
- `const setText = useCaptureStore((s) => s.setText);`
- `onChange = (e) => setText(e.target.value);` — the change handler is one line;
  no debouncing, no transformation, no trim-on-keystroke. The slice holds the
  raw textarea value; trim happens at propose time (`mod_propose_action`'s
  business).
- A defensive clamp inside `onChange`: if `e.target.value.length > MAX_METHODOLOGY_TEXT_LENGTH`,
  call `setText(e.target.value.slice(0, MAX_METHODOLOGY_TEXT_LENGTH))`. This
  defends the slice's invariant against the paste-bypasses-maxLength edge case
  some browsers exhibit.

### Textarea attributes

- `id="capture-text-input"` — the `htmlFor` target on the `<label>`.
- `data-testid="capture-text-input-textarea"`.
- `value={text}` — controlled.
- `onChange={onChange}`.
- `onKeyDown={onKeyDown}` — the Cmd/Ctrl+Enter listener (see "Submit gesture"
  below).
- `maxLength={MAX_METHODOLOGY_TEXT_LENGTH}` — the hard cap at the input
  boundary. Native browser truncation on type; defensive clamp in `onChange`
  on paste.
- `aria-label={t('moderator.captureTextInput.ariaLabel')}` — verbose accessible
  name for screen-reader users (the visible label is short; the aria-label
  carries the "compose a new statement wording" context).
- `aria-describedby="capture-text-input-helper"` — points the screen reader
  at the running-count helper.
- `placeholder={t('moderator.captureTextInput.placeholder')}` — hint text
  visible when the textarea is empty.
- `rows={2}` — the initial min-height (~2 lines of slate-700 14px text).
- `inputMode="text"`.
- `spellCheck={true}` — defends a moderator typing under live-debate pressure;
  the cost is a browser-native red underline on typos, which is desired UX.
- `autoComplete="off"` — the wording is free-form prose, not a form field
  the browser should remember.

### Submit gesture

- `onKeyDown` listener:
  ```ts
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    }
  };
  ```
- `e.preventDefault()` is required: without it, the browser inserts a newline
  in addition to firing the submit (the `Enter` key default for `<textarea>`).
- `e.metaKey || e.ctrlKey` — single branch covers macOS Cmd and every other
  platform's Ctrl. The English-mnemonic `Cmd+Enter` from
  `docs/moderator-ui.md:190` maps naturally to `Ctrl+Enter` on Linux/Windows
  per the i18n_keyboard_shortcuts_policy "non-methodology shortcuts stay
  as-is" clause.
- The handler does **not** call `useCaptureStore.getState().reset()` — that
  is `mod_propose_action`'s job on propose-success. A propose that fails
  should leave the draft intact so the moderator can retry.
- The handler does **not** read `e.shiftKey` — Shift+Enter inserts a newline
  (same as plain Enter); Shift+Cmd+Enter is reserved by
  `docs/moderator-ui.md:191` for "commit currently-selected proposal", which
  is a different surface and not the textarea's concern.

### Auto-grow behavior

- `useLayoutEffect`:
  ```ts
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const desired = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${desired}px`;
  }, [text]);
  ```
- `MAX_HEIGHT_PX` is a const inside the component: ~144 px (≈ 6 lines of
  14px text + line-height 1.5 + 16px padding). Beyond this, the textarea
  scrolls internally (browser default `overflow-y: auto`).
- The reset-height-to-`auto`-then-read-`scrollHeight` dance is the canonical
  pattern for "grow as the content grows; shrink as the content shrinks"
  (without it, the textarea only grows). The pattern is well-trodden; no
  new dependency required.

### Helper text

- `<p id="capture-text-input-helper" data-testid="capture-text-input-helper">{t('moderator.captureTextInput.helper', { used: text.length, max: MAX_METHODOLOGY_TEXT_LENGTH })}</p>`
- Always rendered (not just on near-cap). ICU-interpolated.
- The count uses `text.length` (raw count, not trimmed) so the moderator sees
  the literal char count of what's in the textarea — including leading /
  trailing whitespace. This is the closer-to-the-textarea reading; a
  trim-aware count would be misleading when whitespace is intentional.

### Tailwind styling

Adopt the same secondary-surface vocabulary `<RightSidebar>` and
`<BottomStripCapture>` already use:

- Outer container: `flex flex-col gap-1 w-full`.
- Label: `text-xs font-medium text-slate-700`.
- Textarea: `w-full resize-none rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600`.
- Helper: `text-xs text-slate-500`.

`resize-none` is deliberate: the auto-grow handler owns the height; the user
cannot manually resize the textarea (preventing it from clipping the rest of
the bottom strip's geometry). The slot the textarea mounts into is the
flex-1 cell of the bottom strip's inner row — the auto-grow expands the
textarea vertically; the rest of the strip's items (classification,
edge-role, propose) sit alongside, not below.

### Accessibility

- The textarea has a programmatic label (`<label htmlFor="capture-text-input">`).
- The textarea has an `aria-label` for screen-reader users (the visible label
  is short — "Statement wording"; the aria-label is verbose — "Compose the
  wording for a new statement to propose to the debate").
- The textarea is keyboard-focusable (native).
- The textarea announces character-count updates through the `aria-describedby`
  link to the helper; screen readers re-announce on focus and on helper text
  changes (which happen on every keystroke under the controlled-input pattern).
  This may be verbose for screen-reader users; an `aria-live="off"` on the
  helper would suppress per-keystroke re-announcement while keeping the
  on-focus announcement. The helper is **not** `aria-live` — the screen
  reader reads it on focus / after navigation, not on every keystroke. The
  count is informational, not load-bearing.
- The submit gesture is keyboard-only by design (no visible "submit" button
  in this task; the visible propose button lands with `mod_propose_action`).
  A keyboard-only user can submit; a pointer-only user has to wait for
  `mod_propose_action` to land its button affordance. Documented gap;
  acceptable for v1 because `mod_propose_action` ships next.

### Focus management

- The textarea is **NOT** auto-focused on mount. The moderator may have
  switched into the operate route to look at the graph; auto-focusing the
  textarea would steal focus from any keyboard navigation they were doing.
  Focus lands on the textarea when the moderator clicks it or tabs to it —
  the native browser behavior.
- This deviates from `mod_create_session_form` (which auto-focuses the topic
  input on mount). The rationale is the use-case difference: the create-session
  form is a "you just arrived here to fill a form" surface; the capture
  textarea is "you are operating a live console and this is one of several
  things you may want to do." Decision §5 below.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.captureTextInput.label` | "Statement wording" | "Texto da declaração" | "Texto del enunciado" |
| `moderator.captureTextInput.placeholder` | "Type the statement wording here…" | "Digite o texto da declaração aqui…" | "Escribe el texto del enunciado aquí…" |
| `moderator.captureTextInput.ariaLabel` | "Compose the wording for a new statement to propose to the debate" | "Componha o texto de uma nova declaração para propor ao debate" | "Redacta el texto de un nuevo enunciado para proponerlo al debate" |
| `moderator.captureTextInput.helper` | "{used}/{max} characters" | "{used}/{max} caracteres" | "{used}/{max} caracteres" |

**Count: 4 keys × 3 locales = 12 catalog entries**. The pt-BR + es-419 drafts
land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json` (same pattern as `i18n_methodology_role_descriptions`,
`mod_create_session_form`, `mod_layout_tidy_action`). The en-US is authoritative.

The new keys live under the existing `moderator.*` top-level namespace, in a
new sub-area `captureTextInput`. The sub-area is named after the component
(consistent with `moderator.modeBanner.*` named after `<ModeBanner>` and
`moderator.createSession.*` named after the create-session route).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/CaptureTextInput.tsx` (new).
- `apps/moderator/src/layout/CaptureTextInput.test.tsx` (new — Vitest cases).
- `apps/moderator/src/routes/Operate.tsx` (modified — pass `<CaptureTextInput onSubmit={...} />`
  into `<BottomStripCapture>`'s `textInput` slot; add the `onSubmit` no-op
  pending `mod_propose_action`; update the import block and the leading
  Refinement comment to reference `mod_capture_text_input.md`).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add
  `moderator.captureTextInput.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified — PENDING
  entries for the 4 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified — same).
- `tests/e2e/moderator-capture.spec.ts` (NEW, OR an additional `test()` block
  in `tests/e2e/create-session-flow.spec.ts` — see Decision §8 below; the
  Implementer picks one at the moment of writing the spec).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_capture_text_input` lands at
  task-completion time per the README ritual, not at refinement-write time.
  The Closer also adds the new `i18n_capture_text_input_native_review` task
  to `tasks/35-frontend-i18n.tji` per the tech-debt registration policy.
- `docs/adr/` — no new ADR. ADR 0024 already pinned the i18n architecture
  and the english-mnemonic shortcut policy; `backend_hardening.user_text_length_caps`
  pinned the cap value; `mod_state_management`'s refinement pinned the store
  contract; this task is the UI binding for the existing decisions.
- `apps/moderator/src/stores/captureStore.ts` — the store is consumed
  transitively; no edit to the slice or the setter.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — the scaffold's slot
  contract is consumed unchanged.
- `apps/moderator/src/layout/ModeBanner.tsx` — sibling component, untouched.
- `apps/server/src/` — no server-side change.
- `playwright.config.ts` — the new e2e (if it lands as a new file) joins the
  default `chromium-create-session` Playwright project (the file the e2e
  joins runs under it today); no new project entry.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test count rises by
  the number of new `CaptureTextInput.test.tsx` cases (≥ 10).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity-check) green
  after the catalog edits — every `moderator.captureTextInput.*` key present
  in en-US is present in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds (no bundle change of note;
  one new small component).
- `pnpm exec playwright test` green against a freshly brought-up dev compose
  stack; the new capture-input scenario (in whichever spec file it lands)
  passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the Closer
  adds `complete 100` on `mod_capture_text_input` AND the new
  `i18n_capture_text_input_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The capture text input is reachable from a real user flow as of
`mod_create_session_form` (commit `05f7d67`): the moderator can log in,
navigate to `/sessions/new/setup`, create a session, land on
`/sessions/<id>/operate`, and see the bottom strip with the new textarea
filling the text-input sub-slot. Per the UI-stream e2e policy default, the
Playwright spec is **scoped under Acceptance criteria, NOT deferred**.

**Important caveat**: `mod_propose_action` has not landed, so the
Cmd/Ctrl+Enter gesture does not yet fire a WS proposal. The e2e therefore
cannot assert "submit gesture fires a propose event"; instead it asserts
"submit gesture invokes the onSubmit callback the consumer passed" and
"the in-progress draft is readable from the shared store" — the latter is
the load-bearing regression-class property for this task. The full
chain-completing e2e (type → propose → event lands → graph updates) is
scoped to `mod_propose_action`'s refinement, not this one.

## Acceptance criteria

### 1. The component renders inside the bottom-strip slot

- `<CaptureTextInput>` component under
  `apps/moderator/src/layout/CaptureTextInput.tsx` renders a `<label>` + a
  `<textarea>` + a helper `<p>` with the four `data-testid` IDs above.
- The textarea is reachable via `screen.getByRole('textbox', { name: /Statement wording/ })`
  (the visible label is the accessible name; the verbose aria-label is the
  secondary name, also reachable via `name: /Compose the wording/`).
- `OperateRoute` (`apps/moderator/src/routes/Operate.tsx`) passes
  `<CaptureTextInput onSubmit={() => {}} />` (or a deferred-submit no-op) into
  `<BottomStripCapture>`'s `textInput` prop. The scaffold's `[statement text]`
  placeholder is no longer rendered through the route; the scaffold-only
  `BottomStripCapture.test.tsx` cases continue to assert the placeholder for
  the empty-scaffold render path.

### 2. Store wiring

On every textarea `change` event:

- `setText` is called with `e.target.value` (or its `slice(0, MAX_METHODOLOGY_TEXT_LENGTH)`
  if it exceeds the cap).
- The textarea's `value` attribute reflects the post-update store slice.
- The helper's text reflects `{text.length}/{MAX_METHODOLOGY_TEXT_LENGTH} characters`.

On a programmatic store mutation (`useCaptureStore.getState().setText('hi')`),
the textarea re-renders with the new value.

On a `useCaptureStore.getState().reset()` call, the textarea re-renders empty
and the helper reads `0/10000 characters`.

### 3. Submit gesture

- Cmd+Enter (`metaKey: true`) inside the textarea calls `onSubmit` exactly
  once per press AND calls `e.preventDefault()` so no newline is inserted.
- Ctrl+Enter (`ctrlKey: true`) inside the textarea has the same behavior.
- Plain Enter inside the textarea does NOT call `onSubmit`; the native
  newline behavior fires (textarea's `value` gains a `\n`).
- Shift+Enter does NOT call `onSubmit`; native newline.
- Cmd+Enter does NOT call `useCaptureStore.getState().reset()` — the draft
  survives the gesture.
- The `onSubmit` callback is optional; calling Cmd+Enter when `onSubmit` is
  undefined is a no-op (`onSubmit?.()`).

### 4. Auto-grow

- On mount with empty text, the textarea has the 2-line min-height.
- After programmatically driving `setText` with a 100-char string (which
  wraps inside the slot), the textarea's height grows past 2 lines.
- After programmatically driving `setText` with a 10 000-char string (which
  wraps to many lines), the textarea's height clamps at `MAX_HEIGHT_PX` and
  the textarea's internal scrollbar engages (asserted via
  `textarea.scrollHeight > textarea.clientHeight`).
- After clearing the text (`setText('')`), the textarea's height returns to
  the 2-line min.

### 5. Cap behavior

- `maxLength={10_000}` is set on the textarea element.
- A programmatic `change` event with `e.target.value` of length 10 001 results
  in `setText` being called with the value truncated to length 10 000 (the
  defensive clamp).
- The helper reads `10000/10000 characters` after a 10 000-char fill.
- A typical 50-char fill reads `50/10000 characters`.
- An empty textarea reads `0/10000 characters`.

### 6. Vitest cases (in `apps/moderator/src/layout/CaptureTextInput.test.tsx`)

Minimum 10 new cases, all per ADR 0022 (committed regression-class proofs):

1. **Renders the component with all four testids** — `capture-text-input`,
   `capture-text-input-label`, `capture-text-input-textarea`,
   `capture-text-input-helper`.
2. **Localized label + aria-label + placeholder + helper resolve** —
   every `t(...)` call resolves to a non-key string (not the literal
   `'moderator.captureTextInput.label'` etc.).
3. **Textarea value reads from the store on mount** — call
   `useCaptureStore.setState({ text: 'pre-existing draft' })` before render;
   the textarea's `value` is `'pre-existing draft'`.
4. **`onChange` writes to the store** — type into the textarea; assert
   `useCaptureStore.getState().text` reflects the typed value.
5. **`reset()` clears the textarea** — type into the textarea; call
   `useCaptureStore.getState().reset()`; assert the textarea's value is `''`.
6. **`maxLength` cap is the cap-constant** — assert the textarea's
   `maxLength` attribute equals `MAX_METHODOLOGY_TEXT_LENGTH` (10 000).
7. **Defensive clamp on paste** — fire a `change` event whose `target.value`
   has length 10 001; assert `setText` was called with a 10 000-char value
   (the clamped one).
8. **Cmd+Enter calls `onSubmit`** — render with an `onSubmit` spy; fire
   `keyDown` with `key: 'Enter', metaKey: true`; assert the spy was called
   once.
9. **Ctrl+Enter calls `onSubmit`** — same as above with `ctrlKey: true`.
10. **Plain Enter does NOT call `onSubmit`** — fire `keyDown` with
    `key: 'Enter', metaKey: false, ctrlKey: false`; assert the spy was NOT
    called.
11. **Cmd+Enter calls `e.preventDefault`** — capture the event; assert
    `defaultPrevented` is true.
12. **Cmd+Enter does NOT reset the store** — set the text, fire the gesture,
    assert `useCaptureStore.getState().text` still holds the typed value.
13. **Helper count reflects the store** — set text to `'hello'`; assert the
    helper reads `5/10000 characters`. Set to a 10 000-char string; assert
    `10000/10000`.
14. **No auto-focus on mount** — render the component; assert
    `document.activeElement` is NOT the textarea.

Optional 15th case (per i18n_testing pattern):
**Per-locale parity round-trip** — render with each of the three v1 locales;
walk every `data-testid` element; assert no `[t-missing]` token nor raw
catalog-key string is visible.

### 7. Playwright e2e (per Decision §8 below)

Either a new file `tests/e2e/moderator-capture.spec.ts` OR a new `test()`
block in `tests/e2e/create-session-flow.spec.ts` covering:

```ts
test('capture text input: typing populates the shared draft and Cmd/Ctrl+Enter fires the consumer callback', async ({ page }) => {
  // 1. Login + POST /api/sessions + goto /sessions/<id>/operate (mirrors
  //    the existing create-session-flow happy-path test).
  await loginAs(page, { username: 'alice' });
  // ... POST /api/sessions ... goto /sessions/<id>/operate ...

  // 2. The bottom-strip capture pane is mounted with the new textarea.
  await expect(page.getByTestId('capture-text-input-textarea')).toBeVisible();

  // 3. Type a wording into the textarea.
  const wording = 'The proposed minimum wage would raise prices for everyone.';
  await page.getByTestId('capture-text-input-textarea').fill(wording);

  // 4. Assert the helper count reflects the typed length.
  await expect(page.getByTestId('capture-text-input-helper')).toContainText(
    `${wording.length}/10000`,
  );

  // 5. Assert the shared store reflects the typed value. The store is
  //    not exposed on `window` by default; the assertion reads back via
  //    the textarea's `value` attribute, which is the same wire.
  await expect(page.getByTestId('capture-text-input-textarea')).toHaveValue(
    wording,
  );

  // 6. Fire Cmd+Enter. With `onSubmit` wired to a no-op in this task,
  //    the gesture is observable only via "no newline got inserted"
  //    (the textarea's value did NOT gain a trailing `\n`).
  await page.getByTestId('capture-text-input-textarea').press(
    process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
  );
  await expect(page.getByTestId('capture-text-input-textarea')).toHaveValue(
    wording, // unchanged
  );

  // 7. Fire plain Enter. The textarea's value GAINS a trailing `\n`.
  await page.getByTestId('capture-text-input-textarea').press('End');
  await page.getByTestId('capture-text-input-textarea').press('Enter');
  await expect(page.getByTestId('capture-text-input-textarea')).toHaveValue(
    `${wording}\n`,
  );
});
```

Per the constraint above ("mod_propose_action hasn't landed"), the spec
asserts behavior reachable through the consumer-supplied no-op submit, not
behavior reachable only after the propose round-trip. The submit-fires-a-WS-event
chain is the load-bearing regression for `mod_propose_action`'s refinement,
not this one.

### 8. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.captureTextInput.{label, placeholder, ariaLabel, helper}` keys
  with the en-US text from the table.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` gains the same 4 keys with
  the pt-BR draft strings.
- `packages/i18n-catalogs/src/catalogs/es-419.json` gains the same 4 keys
  with the es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` gain
  `pending: true` entries for each of the 4 keys (per the established
  `*.review.json` lifecycle).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after the edits.

### 9. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_capture_text_input` block gets
  `complete 100` after the `allocate team` line plus a `note "Refinement:
  tasks/refinements/moderator-ui/mod_capture_text_input.md"` line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_capture_text_input_native_review` is added with the template below
  (effort 0.5d; `depends !i18n_layout_tidy_action_native_review`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this mechanically):

```
task i18n_capture_text_input_native_review "Native-speaker review of pt-BR + es-419 capture-text-input strings" {
  effort 0.5d
  allocate team
  depends !i18n_layout_tidy_action_native_review
  note "Source of debt: mod_capture_text_input (this commit) — pt-BR and es-419 drafts of the 4 keys under moderator.captureTextInput.* landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### 10. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Controlled `<textarea>` (not contenteditable, not CodeMirror)

Three alternatives surveyed:

- **Controlled `<textarea>` bound to the shared store** (chosen). Native HTML
  control; native keyboard handling; native browser undo/redo; native paste
  semantics; native a11y (programmatic label, aria-describedby); no new
  dependency. The wording is plain text — no rich formatting, no inline
  code, no syntax highlighting needed. `<textarea>` is the canonical control
  for multi-line plain text per HTML5.
- **`<div contenteditable>`** — rejected. Buys nothing this task needs;
  loses native input-mode semantics (browser keyboard hints), native
  validation hooks, native `maxLength`, and screen-reader-friendly
  programmatic labelling. Adds complexity around sanitizing pasted HTML
  (a `contenteditable` div accepts arbitrary HTML on paste; the wording
  must stay plain text). The few wins (rich formatting, inline decorations)
  are not needed for plain-text wordings.
- **CodeMirror / Monaco / Slate** — rejected. New runtime dependency;
  bundle bloat (~100 KB+); steep API surface; intended for code or rich-text
  authoring, not plain prose. The "no new dependencies without ADR" rule
  applies (ADR convention); the editor library would need its own ADR. The
  textarea covers the requirement at zero dependency cost.

The chosen control composes naturally with every browser's spell-check,
copy/paste, and undo/redo. The native `maxLength` attribute provides the
hard cap; the auto-grow handler is ~10 lines of `useLayoutEffect`.

### 2. State location: shared `useCaptureStore`, not component-local `useState`

Two alternatives surveyed:

- **Shared `useCaptureStore` slice** (chosen). The downstream consumers
  (`mod_classification_palette` writes to `classification`,
  `mod_edge_role_selector` writes to `targetEntityId`, `mod_propose_action`
  reads all three slices + calls `reset()`) all live in the same store
  already. The text slice (`text: string`) is pre-declared at
  `apps/moderator/src/stores/captureStore.ts:42` with its `setText` setter
  at line 51, exactly because this is the seam the multi-component capture
  workflow uses. The mode-banner precedent at `mod_mode_banner` reads a
  different slice (`mode`) from the same store — the two readers compose
  without coupling. The store's `reset()` clears every slice in one call,
  which is exactly what propose-success needs.
- **Component-local `useState`** — rejected. Would force a parent-side
  shared-state layer (lifting state up to `<Operate>` or `<BottomStripCapture>`)
  for `mod_propose_action` to read — i.e., re-invent the shared store at
  one level higher. Or it would force a prop-drilling chain to surface the
  text to `mod_propose_action` (text → parent → propose-button-prop). Both
  alternatives are worse than the shared store already exists. Component-local
  state also breaks the `reset()` contract: each component would have to
  expose its own reset, and propose-success would have to know about every
  reset.

Per the `mod_state_management` refinement's own framing: "Holds the
in-progress proposal the moderator is composing." The text slice exists
exactly for this task to write to.

### 3. Validation: maxLength + defensive clamp; no trim policy on the slice

Surveyed decisions:

- **Hard cap at `MAX_METHODOLOGY_TEXT_LENGTH = 10_000`** (chosen — mirroring
  the server-side cap from `user_text_length_caps`). The client mirror is
  defensive: the server REJECTS over-cap with a `validation-failed` error,
  but surfacing the rejection only at propose time is bad UX — the moderator
  loses their work mid-paste. The client cap is the same number to keep the
  validation surface single-rule.
- **No minimum length on the slice** (chosen). The slice holds the
  in-progress draft; the moderator is mid-compose; an empty slice is a
  legal in-flight state. The minimum-length check (the slice cannot be
  empty on propose) lands at `mod_propose_action`, which guards the
  submit, not the input.
- **No trim on keystroke** (chosen). Leading / trailing whitespace might be
  intentional (e.g., the moderator is mid-typing a leading space they will
  fill in). Trim-on-keystroke would interfere. The trim happens at propose
  time (`mod_propose_action`'s business), where `text.trim()` produces the
  submitted wording.
- **Defensive clamp in `onChange`** (chosen). The `maxLength` HTML attribute
  is honored by most browsers on type but is inconsistent on paste — some
  browsers truncate the pasted value to `maxLength`, others fire the `input`
  event with the full pasted value and rely on the receiving JS to enforce
  the cap. The `setText(e.target.value.slice(0, MAX))` clamp defends the
  store invariant regardless of which behavior the user's browser exhibits.

The validation here is purely shape (length ≤ 10 000); methodology validation
(is this a coherent statement? is it disputable? does it belong to the
selected kind?) is the engine's responsibility, not this task's.

### 4. Submit gesture: Cmd/Ctrl+Enter, NOT plain Enter

Three alternatives surveyed:

- **Cmd/Ctrl+Enter inside the textarea, no in-textarea button** (chosen).
  Plain Enter inserts a newline — the moderator's wording may span multiple
  paragraphs (per `docs/moderator-ui.md:43` "Free-form text, multi-line
  allowed"); making Enter the submit key would force every multi-paragraph
  wording to be composed elsewhere and pasted in. Cmd/Ctrl+Enter is the
  canonical "deliberate confirmation" gesture for multi-line inputs across
  modern UIs (Slack, GitHub PR descriptions, Discord, GitLab issue editor)
  and matches the `docs/moderator-ui.md:190` keyboard-shortcut spec
  ("`Cmd+Enter` — propose"). Per the i18n_keyboard_shortcuts_policy's
  "non-methodology shortcuts stay as-is across locales" clause, the gesture
  is locale-independent.
- **Plain Enter to submit** — rejected. Conflicts with multi-line wording
  composition (forces paste-from-elsewhere). Too easy to fire accidentally
  during a fast-typing live-debate session. The propose action emits
  multiple events at once (per the WBS `mod_propose_action` description:
  "Propose action — emits multiple events at once") — accidental fires are
  expensive to undo.
- **Dedicated submit button only** — rejected for v1. Keyboard-first
  operation is a primary design constraint per `docs/moderator-ui.md:187`
  ("The moderator's hands need to stay on the keyboard to keep up with live
  debate"). The propose button lands with `mod_propose_action`; this task
  exposes the keyboard gesture so the moderator can submit without leaving
  the textarea. Both surfaces coexist: pointer users use the propose button,
  keyboard users use Cmd/Ctrl+Enter.

The `metaKey || ctrlKey` branch handles macOS and non-macOS platforms with
one rule. The handler does NOT distinguish the two — a Linux moderator
pressing Cmd+Enter (if their keyboard surfaces a meta key as `metaKey`,
e.g. the Super key on some setups) gets the same behavior as a macOS
moderator. The alternative (`isMac ? metaKey : ctrlKey`) requires UA
sniffing or platform detection inside the component; the `||` branch
avoids that.

### 5. No auto-focus on mount

Surveyed:

- **No auto-focus on mount** (chosen). The moderator may have arrived at
  `/sessions/<id>/operate` to look at the graph; auto-focusing the textarea
  would steal focus from any pre-existing keyboard activity (e.g., scrolling
  the graph). The moderator clicks or tabs to the textarea when they want
  to compose.
- **Auto-focus on mount** — rejected. Conflicts with the operate route's
  multi-pane nature (graph + sidebar + bottom strip are all reachable;
  forcing focus to one of them is over-prescriptive). Conflicts with the
  React StrictMode double-mount pattern (which the `mod_create_session_form`
  Decisions block flagged for `autoFocus`).

This deviates from `mod_create_session_form` (which auto-focuses the topic
input on mount). The deviation is intentional: the create-session form is a
form-page where the user has just navigated to fill in fields — auto-focus
is right. The capture textarea is one widget among many on a live console
— auto-focus is wrong. The two precedents coexist; the difference is
"single-purpose form page" vs. "multi-widget live console."

### 6. Helper always rendered (not just on near-cap)

Surveyed:

- **Always rendered** (chosen). Matches the `mod_create_session_form` precedent
  (the create-session helper is also always rendered). The moderator sees a
  running count and knows the system is reading their input; the count is a
  feedback channel, not a warning.
- **Render only when within 10% of the cap** — rejected. Would make the helper
  appear suddenly at ~9 000 chars, which is an interruption. A continuously-visible
  helper is less disruptive than a popping-in helper. The cost (one extra
  small line of text under the textarea) is small.

### 7. Auto-grow with a max-height clamp, internal scroll past max

Surveyed:

- **Auto-grow up to ~6 lines (`MAX_HEIGHT_PX`), then internal scroll**
  (chosen). The bottom strip is a fixed-geometry slot; an unbounded
  auto-grow would push the rest of the strip's geometry off the viewport.
  6 lines is enough that a one-paragraph wording (the common case) fits
  without scrolling; longer wordings (occasional) scroll internally,
  preserving the strip's geometry.
- **Fixed height (no auto-grow)** — rejected. A 2-line fixed height makes
  wordings longer than 2 lines hard to review (the moderator can't see what
  they typed without scrolling); a 6-line fixed height wastes vertical
  space for the common short-wording case. Auto-grow with a clamp is the
  best of both.
- **Unbounded auto-grow** — rejected for the strip-geometry reason above.

The `useLayoutEffect`-driven height-`auto`-then-`scrollHeight` pattern is the
canonical web pattern for this; no new dependency required.

### 8. Playwright e2e placement: extend or new file (Implementer's choice)

The new e2e covers two things the existing specs don't:
(a) the textarea is reachable and accepts input on `/sessions/<id>/operate`,
(b) Cmd/Ctrl+Enter inside the textarea is observable.

Two placement options:

- **Extend `tests/e2e/create-session-flow.spec.ts`**. Pro: total setup
  overlap (loginAs → POST /api/sessions → goto operate is the same chain);
  no new file boilerplate; the chain "create session → land on operate →
  type wording" reads as a natural continuation of the existing test.
  Con: bloats the create-session file's responsibility beyond its name.
- **New file `tests/e2e/moderator-capture.spec.ts`**. Pro: file-name
  matches the surface under test; future capture-flow tasks
  (`mod_classification_palette`, `mod_edge_role_selector`,
  `mod_propose_action`) join the same file naturally — the file is the
  capture-flow's regression home. Con: duplicates the setup boilerplate;
  one more file to maintain.

The Implementer picks at the moment of writing the spec. The recommendation
(non-load-bearing) is the **new file** route: the capture flow is its own
identifiable surface, and the four sibling tasks will join the file in
sequence — the file's value compounds across the four tasks rather than
diluting the create-session file's focus. But both options pass acceptance;
the Implementer's call.

### 9. Native-review follow-up registered, not bundled into this task

Same rationale as `mod_create_session_form` Decisions §6 and
`mod_layout_tidy_action` Decisions §6: native review is a different skill
from the wiring; the textarea is functional without the review (a pt-BR
moderator viewing the draft "Texto da declaração" label sees a
comprehensible label); the native-speaker review chain stays serializable
through `depends !i18n_layout_tidy_action_native_review` (the prior link).

### 10. No new ADR

Three potential ADR triggers, all dispatched:

- **"Adding a new editor dependency is ADR-worthy."** This task adds NO new
  editor dependency — the native HTML `<textarea>` is the chosen control.
- **"A new keyboard-shortcut policy is ADR-worthy."** This task adds NO new
  policy — it consumes the existing english-mnemonic / locale-independent
  policy pinned in ADR 0024 and operationalized in
  `i18n_keyboard_shortcuts_policy`. The Cmd/Ctrl+Enter submit gesture is the
  canonical non-methodology shortcut pattern.
- **"A new state-location pattern is ADR-worthy."** This task adds NO new
  pattern — `useCaptureStore` and the shared-slice approach were pinned by
  `mod_state_management`; this task is the first writer/reader on the
  pre-declared `text` slice.

`mod_state_management`, `user_text_length_caps`, ADR 0022, ADR 0024, and
`i18n_keyboard_shortcuts_policy` already pinned every architectural choice
this task implements; this refinement is the task-scope pin for the UI
binding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- Controlled `<textarea>` capture-pane input landed at
  `apps/moderator/src/layout/CaptureTextInput.tsx`. It reads
  `useCaptureStore((s) => s.text)` and writes through `setText` on every
  change event, with a defensive `slice(0, MAX_METHODOLOGY_TEXT_LENGTH)`
  clamp inside the change handler so a paste that bypasses the native
  `maxLength` cannot exceed 10 000 chars in the slice.
- Submit gesture (`Cmd/Ctrl+Enter`) fires a consumer-supplied
  `onSubmit?: () => void` and `preventDefault()`s the newline; plain
  Enter and Shift+Enter retain native newline behavior. `OperateRoute`
  (`apps/moderator/src/routes/Operate.tsx`) passes a `() => {}` no-op
  pending `mod_propose_action` (the gesture is wired but inert, as
  scoped under "Constraints / requirements → UI-stream e2e scoping").
- Auto-grow `useLayoutEffect` clamps the textarea height to ~6 lines
  before engaging the internal scrollbar; helper paragraph is always
  rendered and surfaces the ICU-interpolated
  `{used}/{max} characters` count via
  `moderator.captureTextInput.helper`.
- 4 i18n keys × 3 locales = 12 catalog entries under
  `moderator.captureTextInput.*` landed in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`,
  with 4 PENDING entries each in the pt-BR and es-419 `*.review.json`
  trackers (8 entries total). Native-speaker review registered as a
  tech-debt follow-up — see WBS update below.
- Vitest coverage in `apps/moderator/src/layout/CaptureTextInput.test.tsx`
  pushes the suite from 2617 → 2651 (+34 cases), covering store-wiring,
  cap behavior, submit gesture (Cmd/Ctrl/plain/Shift), auto-grow,
  helper count, no-auto-focus, and per-locale parity.
- Playwright e2e landed in `tests/e2e/moderator-capture.spec.ts`
  (new file per Decision §8 recommendation). 3/3 tests pass under the
  `chromium-create-session` project. `playwright.config.ts` testMatch
  for the `chromium-create-session` project was extended to also
  match `moderator-capture.spec.ts` — slight deviation from the
  refinement's "no new project entry" stance (which is preserved: no
  new project was added), but the existing project's `testMatch` array
  picked up one additional file. Minimal join; no new browser launch,
  no new fixture file.
- Tech-debt follow-up `i18n_capture_text_input_native_review` (effort
  0.5d, `depends !i18n_layout_tidy_action_native_review`) registered
  in `tasks/35-frontend-i18n.tji` per the established native-review
  chain pattern.
- `complete 100` set on `mod_capture_text_input` in
  `tasks/30-moderator-ui.tji`. `mod_capture_flow` remains open
  (siblings `mod_classification_palette`, `mod_target_auto_suggest`,
  `mod_target_clear_override`, `mod_edge_role_selector`,
  `mod_propose_action` are not yet done); M4
  (`m_moderator_mvp`) is unaffected.
