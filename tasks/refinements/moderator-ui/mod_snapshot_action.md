# Moderator snapshot trigger — sidebar button + `Cmd/Ctrl+S` shortcut that opens the snapshot label flow

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_snapshot_flow.mod_snapshot_action`.

```
task mod_snapshot_flow "F10 — Snapshot a segment" {
  depends !mod_capture_flow, root_app.root_moderator_cutover, backend.websocket_protocol.ws_snapshot_message
  task mod_snapshot_action "Snapshot action (button + shortcut)" {
    effort 0.5d
    allocate team
  }
  ...
}
```

## Effort estimate

**0.5d.** Confirmed. The deliverable is three small artefacts plus their colocated tests:

1. A module-scoped Zustand slice `useSnapshotFlowStore` with `{ isLabelInputOpen, open(), close() }` — under 30 lines, mirrors the `useCommitStore` / `useProposeErrorStore` idiom established in [`apps/moderator/src/layout/useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts).
2. A presentational `<SnapshotActionButton>` component (~40 lines) — single `<button>` that calls `useSnapshotFlowStore.open()`, reads its label and `aria-label` from i18n, ships a stable `data-testid="snapshot-action-button"`.
3. A `useSnapshotShortcut()` hook (~40 lines) — installs a `document`-level `keydown` listener that fires `useSnapshotFlowStore.open()` on `Cmd+S` (macOS) / `Ctrl+S` (others), `preventDefault()`s to swallow the browser save dialog, and detaches on unmount. Mounted once at the `OperateRoute` level so the binding is alive whenever the moderator is on `/sessions/:id/operate`.

No WebSocket dispatch in this task — the wire send happens downstream in `mod_snapshot_label_input` after the moderator types the label and submits the modal. This task only opens the trigger flag; the modal that consumes it lands next.

Plus a five-key i18n addition (`moderator.snapshotAction.label`, `moderator.snapshotAction.ariaLabel`, `moderator.snapshotAction.shortcutHint`, plus pt-BR / es-419 review flags), one Vitest file per artefact, one Playwright `test()` block under `tests/e2e/moderator-snapshot.spec.ts` (new file — the snapshot-flow e2e carrier), and one tiny seam attribute (`data-snapshot-flow-open` on the `operate-layout-root`) so the Playwright spec can observe the store transition without depending on a modal that does not exist yet.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- **`backend.websocket_protocol.ws_snapshot_message`** (done — 2026-05-11). Shipped the *read-side* `snapshot` envelope (client → `snapshot` request, server → `snapshot-state` reply) per [`tasks/refinements/backend/ws_snapshot_message.md`](../backend/ws_snapshot_message.md). **Important caveat**: this read-only state-query is what `mod_snapshot_flow` lists as its only backend dependency, but it is NOT the message a labeled-snapshot creation would send. The `snapshot-created` event kind exists in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) and the projection populates `projection.snapshots()` from it ([`apps/server/src/projection/replay.ts:1065-1072`](../../../apps/server/src/projection/replay.ts)), but no methodology handler currently mints those events and no write-side WS envelope (`ws_label_snapshot_message`, or equivalent) exists. **This task does not need that write-side handler** — it only opens the trigger flag; the WS dispatch is `mod_snapshot_label_input`'s problem. That sibling refinement will register the missing backend dependency when it lands (the gap is called out in `ws_snapshot_message.md:88-93` already).
- **`moderator_ui.mod_capture_flow`** (parent — done across multiple subtasks). The bottom-strip capture pane (`<BottomStripCapture>`, `<ProposeAction>`, `<CaptureTextInput>`, etc.) is the established pattern for moderator action affordances. This task's `<SnapshotActionButton>` reuses the same Tailwind palette (`bg-slate-100` / `border-slate-200` from `<RightSidebar>`) and the same i18n discipline (`useTranslation()` against `@a-conversa/i18n-catalogs`).
- **`root_app.root_moderator_cutover`** (done). The `/sessions/:id/operate` route is reachable through the shell; mounting the shortcut hook at the `OperateRoute` level guarantees it is bound exactly when the moderator is operating a session.
- **`moderator_ui.mod_layout.mod_layout_shell`** (done — 2026-05-11). [`<OperateLayout>`](../../../apps/moderator/src/layout/OperateLayout.tsx) exposes a `rightSidebar` render-prop slot with the stable `data-testid="operate-right-sidebar"` selector. This task composes `<SnapshotActionButton>` ABOVE `<RightSidebar />` inside that slot in `OperateRoute` (Decision §2).
- **`moderator_ui.mod_layout.mod_right_sidebar`** (done — 2026-05-11). The stacked sub-pane scaffold per [`mod_right_sidebar.md`](mod_right_sidebar.md). `<RightSidebar>` has three pane slots (`pendingProposalsSlot`, `diagnosticFlagsSlot`, `changeHistorySlot`); none of them is the right home for a session-level action button. This task does NOT add a fourth slot — it composes the button as a sibling above the sidebar in `OperateRoute` (Decision §2.b) so `<RightSidebar>`'s contract stays untouched.
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11). The `WsClient.send(...)` surface and `useWsClient()` hook exist, but this task does NOT call them — the WS dispatch lives in `mod_snapshot_label_input`. Documenting the seam here so the modal task knows what it inherits.
- **`moderator_ui.mod_capture_flow.mod_classification_palette`** (done — established [`captureKeymap.ts`](../../../apps/moderator/src/layout/captureKeymap.ts)). Provides a reference idiom for `document`-level `keydown` listeners (the ref-then-listener pattern that survives strict-mode double-mount). This task does NOT extend `CaptureKeymapHandlers` — Decision §4 records why two listeners are clearer than one for orthogonal key sets.
- **`frontend_i18n.i18n_library_choice`** / **`i18n_catalog_workflow`** / **`i18n_locale_negotiation`** / **`i18n_testing`** (done — the `useTranslation()` API, the `*.review.json` PENDING-flag lifecycle, the parity round-trip pattern).
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — english-mnemonic / locale-independent shortcut policy). `Cmd/Ctrl+S` is a locale-independent chord; the keymap-help overlay (`mod_keymap_help_overlay`, downstream) will list it next to the localized label "Snapshot" / "Instantâneo" / "Instantánea".
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** — the `useTranslation()` API the new component consumes.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_snapshot_flow.mod_snapshot_label_input`** (sibling — not yet refined). Reads `useSnapshotFlowStore.isLabelInputOpen`; renders the modal when true; collects the label; dispatches the (still-to-be-defined) snapshot-creation WS envelope; calls `useSnapshotFlowStore.close()` on submit/cancel. Will need to register the missing backend write-side handler as its own dependency.
- **`moderator_ui.mod_snapshot_flow.mod_snapshot_visual_marker`** (sibling — not yet refined). Reads the projection's `snapshots[]` array (populated by `snapshot-created` events) and renders a marker on the graph canvas at the snapshot's log position. Independent of this task's trigger flag.
- **`moderator_ui.mod_keyboard_shortcuts.mod_global_keymap`** (downstream — depends on `!mod_snapshot_flow`, see [`tasks/30-moderator-ui.tji:652-657`](../../30-moderator-ui.tji)). Will consolidate the per-component keymaps into one unified dispatcher; `useSnapshotShortcut()` is intentionally a small, self-contained hook so the future refactor can lift its `Cmd/Ctrl+S` binding into the unified keymap without rewriting the action layer. Decision §4 records the split rationale.
- **`moderator_ui.mod_keyboard_shortcuts.mod_keymap_help_overlay`** (downstream). Will surface the `Cmd/Ctrl+S` → Snapshot binding in the help overlay using the catalog key `moderator.snapshotAction.shortcutHint` this task ships.
- **`frontend_i18n.i18n_snapshot_action_native_review`** (registered by this task — see Decision §6 + Acceptance criteria). The pt-BR + es-419 drafts of the three new keys land flagged PENDING; the follow-up replaces them with native-speaker-reviewed text.

## What this task is

Land the **entry point** of F10 ("Snapshot a segment") on the moderator's operate route: a small "Snapshot" button at the top of the right sidebar AND a `Cmd+S` / `Ctrl+S` global shortcut, both of which open the snapshot-label flow by flipping a module-scoped Zustand flag. The flag is the seam the next task in the chain (`mod_snapshot_label_input`) hangs the modal off; the marker task (`mod_snapshot_visual_marker`) is independent and reads from the projection.

[docs/moderator-ui.md, F10 (lines 156–162)](../../../docs/moderator-ui.md):

> At natural breaks (commercial, end of segment, end of show).
> 1. **Trigger `Snapshot`** (shortcut or sidebar button).
> 2. **Type a label** (e.g., "Segment 1 close").
> 3. **The current event-log position is named**; replay can refer to this snapshot.

This task implements step 1 only — the trigger. Step 2 is `mod_snapshot_label_input`; step 3 (the actual event creation + projection update) is implicit in the WS handler the label-input task will need.

Concretely the deliverable is:

- **One new module-scoped store slice**: `apps/moderator/src/layout/useSnapshotFlowStore.ts` — a tiny Zustand slice with `{ isLabelInputOpen: boolean, open(): void, close(): void }`. Module-scoped (not a React provider) so the button, the shortcut hook, and the future modal all observe the same single instance per app load. Mirrors the `useCommitStore` / `useProposeErrorStore` colocation idiom at [`apps/moderator/src/layout/useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts). `open()` is idempotent (calling it while already open is a no-op — the modal stays open) and `close()` is the symmetric reset the modal calls on submit / cancel.
- **One new presentational component**: `apps/moderator/src/layout/SnapshotActionButton.tsx` — a single localized `<button>` mounted above the `<RightSidebar />` stack (composed in `OperateRoute`'s `rightSidebar` slot value). Reads its label and `aria-label` from `useTranslation()`. On click, calls `useSnapshotFlowStore.getState().open()`. Carries `data-testid="snapshot-action-button"`. Disabled state is NOT in v1 scope (Decision §5) — the button is always live whenever the operate route is mounted.
- **One new shortcut hook**: `apps/moderator/src/layout/useSnapshotShortcut.ts` — `useEffect`-mounted `document.addEventListener('keydown', ...)` that calls `useSnapshotFlowStore.getState().open()` on `Cmd+S` (macOS detection via `event.metaKey`) / `Ctrl+S` (others via `event.ctrlKey`). Calls `event.preventDefault()` on match so the browser's "Save Page As…" dialog does NOT fire. Does NOT bail on editable-target focus (Decision §4.c — standard Cmd+S behaviour is to fire even while typing). Detaches on unmount. Returns nothing.
- **One composition update** in `apps/moderator/src/routes/Operate.tsx`: call `useSnapshotShortcut()` once at the top of `OperateRoute`, and replace `rightSidebar={<RightSidebar ... />}` with `rightSidebar={<><SnapshotActionButton /><RightSidebar ... /></>}` (fragment) so the button renders above the pane stack inside the existing sidebar geometry.
- **One seam attribute** on the layout root: extend `<OperateLayout>` to accept a thin `data-snapshot-flow-open` data attribute on its `operate-layout-root` div, set by `OperateRoute` from `useSnapshotFlowStore(state => state.isLabelInputOpen)`. This is the testability seam the Playwright spec asserts against in lieu of a visible modal (Decision §3). Once `mod_snapshot_label_input` lands, the spec there can switch to asserting the actual modal's presence; the seam can stay for backwards-compat or be retired in that task's commit.
- **Three new i18n keys** in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`:
  - `moderator.snapshotAction.label` — the button text ("Snapshot" / pt-BR PENDING / es-419 PENDING).
  - `moderator.snapshotAction.ariaLabel` — the button's `aria-label` ("Snapshot the current event-log position" / PENDING × 2).
  - `moderator.snapshotAction.shortcutHint` — the keyboard-shortcut hint for the help overlay ("Cmd / Ctrl + S" — locale-independent symbol composition; the surrounding "press the shortcut to snapshot" copy lives in `mod_keymap_help_overlay`'s own keys).

## Why it needs to be done

The whole F10 snapshot flow is gated on this trigger:

- `mod_snapshot_label_input` cannot mount its modal anywhere until something tells it when to render — that's `useSnapshotFlowStore.isLabelInputOpen`.
- `mod_snapshot_visual_marker` is independent of the trigger (it reads the projection's `snapshots[]` directly) but cannot be validated end-to-end until a snapshot can be created, which requires the modal, which requires the trigger.
- `mod_keyboard_shortcuts.mod_global_keymap` lists `Cmd+S` as one of the shortcuts it consolidates ([docs/moderator-ui.md:211](../../../docs/moderator-ui.md)); the global keymap task explicitly depends on `mod_snapshot_flow` per [`tasks/30-moderator-ui.tji:653`](../../30-moderator-ui.tji), so the snapshot shortcut needs to exist in *some* form (this task's local hook) before the consolidation pass refactors it.

Without this 0.5d trigger, the rest of F10 cannot land.

## Inputs / context

- [docs/moderator-ui.md — F10 Snapshot a segment, lines 156–162](../../../docs/moderator-ui.md) — the three-step UX sketch ("Trigger / Type a label / The event-log position is named"). Says explicitly "shortcut or sidebar button" — the placement is settled.
- [docs/moderator-ui.md — Keyboard shortcuts (sketch), line 211](../../../docs/moderator-ui.md) — `Cmd+S — snapshot`.
- [docs/moderator-ui.md — Modes, line 197](../../../docs/moderator-ui.md) — lists "*Snapshot label*" as one of the explicit modes the mode-banner can show. **Not relevant to this task** — the snapshot trigger does not put the capture pane into a mode; the modal is overlay-style, not a mode. (The "*Snapshot label*" entry in that list is forward-looking to a possible mode-banner integration in `mod_snapshot_label_input` and is not load-bearing for the trigger.)
- [`apps/moderator/src/layout/OperateLayout.tsx`](../../../apps/moderator/src/layout/OperateLayout.tsx) — the three-pane shell with `rightSidebar` slot. `data-testid="operate-layout-root"` is the canonical root selector; this task adds `data-snapshot-flow-open` to it.
- [`apps/moderator/src/layout/RightSidebar.tsx`](../../../apps/moderator/src/layout/RightSidebar.tsx) — the stacked sub-pane container. The button mounts as a SIBLING above it (Decision §2.b), not as a fourth slot inside.
- [`apps/moderator/src/routes/Operate.tsx:227-299`](../../../apps/moderator/src/routes/Operate.tsx) — the route composition. This task updates the `rightSidebar` prop value to a fragment containing the button + the existing `<RightSidebar />`, and adds a `useSnapshotShortcut()` call at the top of the function body.
- [`apps/moderator/src/layout/useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts) — the colocated-store-slice template. `useSnapshotFlowStore` mirrors its module-scoped Zustand idiom.
- [`apps/moderator/src/layout/captureKeymap.ts:22-46`](../../../apps/moderator/src/layout/captureKeymap.ts) — the reference `document`-level keydown listener with editable-target / repeat-skip guards. `useSnapshotShortcut` reuses the listener attach/detach idiom but inverts the modifier rule (`captureKeymap` bails on `metaKey || ctrlKey`; `useSnapshotShortcut` REQUIRES one of them).
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `snapshot-created` event kind (already defined). NOT consumed by this task; documented as context for the downstream chain.
- [`tasks/refinements/backend/ws_snapshot_message.md`](../backend/ws_snapshot_message.md) — the read-side WS handler. Lines 88–93 explicitly defer the write-side labeled-snapshot creation handler to a future task; that follow-up will need to land BEFORE `mod_snapshot_label_input` can ship.
- [`tasks/refinements/moderator-ui/mod_commit_button.md`](mod_commit_button.md) — the most-recently-landed action affordance refinement; reference for shape, depth, and test discipline. NOT a direct template — that task's hook owns a WS send; this task's hook owns only a store transition.

## Constraints / requirements

- **Single source of truth for the trigger flag.** Exactly one `useSnapshotFlowStore` module-scoped instance. Both the button and the shortcut call `getState().open()`; both observe `isLabelInputOpen` through the standard Zustand subscription. No prop-drilling, no React Context, no per-render closure.
- **`Cmd+S` (macOS) / `Ctrl+S` (Windows / Linux) with `preventDefault()`.** Detect modifier per platform: `event.metaKey` for macOS, `event.ctrlKey` for others. The shortcut MUST call `event.preventDefault()` on match so the browser's "Save Page As…" dialog does NOT fire — this is the entire reason the user-agent-controlled chord is being repurposed. Test the prevent-default explicitly (Vitest can spy on the event).
- **Single binding at `OperateRoute` scope.** The shortcut hook mounts exactly once per route activation. Strict-mode double-mount safe (the listener attach/detach pairs cleanly). When `OperateRoute` unmounts (moderator leaves the operate page), the listener detaches so `Cmd+S` returns to its default browser behaviour elsewhere in the shell.
- **No bail on editable-target.** Standard `Cmd+S` semantics fire regardless of focus — typing in a textarea and pressing `Cmd+S` still snapshots. This DIFFERS from `captureKeymap.ts`'s `f`/`p`/`v`/`n`/`d` single-letter shortcuts, which bail on editable-target focus. Decision §4.c records why.
- **Bail on `event.repeat`.** Auto-repeat must NOT bounce the modal open repeatedly. Single keydown → single `open()`. (Open is idempotent, so a repeat would not visibly bounce, but the spec MUST hold the `open()` call count to one per physical press for predictable behaviour when modal-open transitions get side effects in the next task.)
- **`open()` is idempotent.** Calling `open()` while `isLabelInputOpen === true` is a no-op. The modal stays open; no spurious state churn.
- **Button always live on the operate route.** No disabled state in v1 (Decision §5 — the labeled-snapshot creation is moderator-authority territory enforced server-side; the client does not gate the button on local authority signals).
- **Button visible above the pane stack.** The `<SnapshotActionButton>` renders ABOVE `<RightSidebar />` inside the `rightSidebar` slot of `<OperateLayout>`. It is the first visible element when scanning the sidebar top-down. Visually delimited from the pane stack by a bottom border (`border-b border-slate-200`) so the panes' own headers retain their stacked-card geometry.
- **Stable selectors.**
  - Button: `data-testid="snapshot-action-button"`.
  - Layout-root seam: `data-snapshot-flow-open="true|false"` on `operate-layout-root` (always present, not conditional — so the spec can flip-assert on the value rather than wait for the attribute to appear).
- **i18n discipline.** All three new keys ship in en-US (drafts), pt-BR (`*.review.json` PENDING), es-419 (`*.review.json` PENDING). The parity round-trip test from `mod_right_sidebar.md`'s pattern applies — each key resolves to a non-empty string in each locale.
- **Tailwind only.** No new stylesheets; the button uses utility classes consistent with `<RightSidebar>`'s `bg-slate-100` / `border-slate-200` palette plus a hover state (`hover:bg-slate-200`) matching the pane headers.
- **No WS send from this task.** `WsClient.send(...)` is NOT called from the snapshot-action layer. The wire dispatch is the modal's responsibility in `mod_snapshot_label_input`.
- **No projection read from this task.** The button does not read `wsStore` / `projection.snapshots()`. It only reads (transitively, via i18n) the catalog and writes the trigger flag.
- **No `keyboardShortcutHandlers` extension.** The shortcut lives in its own module (`useSnapshotShortcut.ts`), NOT inside `captureKeymap.ts`'s `CaptureKeymapHandlers` interface (Decision §4.a).

## Acceptance criteria

- New `apps/moderator/src/layout/useSnapshotFlowStore.ts` ships the `{ isLabelInputOpen, open(), close() }` Zustand slice and is imported by both the button and the shortcut hook.
- New `apps/moderator/src/layout/SnapshotActionButton.tsx` renders a localized `<button>` with `data-testid="snapshot-action-button"`; clicking calls `useSnapshotFlowStore.getState().open()`.
- New `apps/moderator/src/layout/useSnapshotShortcut.ts` mounts a `document`-level `keydown` listener that fires `open()` on `Cmd+S` / `Ctrl+S`, calls `preventDefault()`, bails on `event.repeat`, and detaches on unmount.
- `apps/moderator/src/routes/Operate.tsx` calls `useSnapshotShortcut()` at the top of `OperateRoute` and composes `<SnapshotActionButton />` as a sibling above `<RightSidebar />` inside the `rightSidebar` slot of `<OperateLayout>`.
- `apps/moderator/src/layout/OperateLayout.tsx` accepts an optional `dataSnapshotFlowOpen?: boolean` prop and renders `data-snapshot-flow-open` on `operate-layout-root` with the string `"true"` / `"false"`. `OperateRoute` wires it from `useSnapshotFlowStore(state => state.isLabelInputOpen)`.
- Committed Vitest cases (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)):
  - `apps/moderator/src/layout/useSnapshotFlowStore.test.ts` — `(a)` initial state has `isLabelInputOpen === false`; `(b)` `open()` flips it true; `(c)` `close()` flips it back; `(d)` `open()` is idempotent (calling twice in a row leaves it true with no extra state churn); `(e)` `close()` is idempotent when already closed.
  - `apps/moderator/src/layout/SnapshotActionButton.test.tsx` — `(a)` renders with `data-testid="snapshot-action-button"`; `(b)` carries the localized `aria-label`; `(c)` click calls `useSnapshotFlowStore.getState().open()`; `(d)` per-locale label round-trip (en-US / pt-BR / es-419) resolves to non-empty distinct strings.
  - `apps/moderator/src/layout/useSnapshotShortcut.test.ts` — `(a)` `Cmd+S` on a macOS-shaped event calls `open()`; `(b)` `Ctrl+S` on a non-macOS-shaped event calls `open()`; `(c)` bare `s` (no modifier) does NOT call `open()`; `(d)` `Cmd+Shift+S` (with shift) STILL calls `open()` (shift is allowed); `(e)` `event.preventDefault()` is invoked on match; `(f)` `event.repeat === true` is ignored; `(g)` the listener detaches on unmount (a `Cmd+S` after unmount does NOT call `open()`); `(h)` editable-target focus does NOT bail (`open()` fires even when an `<input>` is `document.activeElement`).
  - Update to `apps/moderator/src/routes/Operate.test.tsx` (or a new colocated test) — `(a)` the snapshot button renders in the right sidebar above the pane stack; `(b)` `data-snapshot-flow-open` reflects the store value; `(c)` clicking the button flips the attribute to `"true"`.
- New Playwright spec `apps/moderator/tests/e2e/moderator-snapshot.spec.ts` (deferred-e2e debt from this task's parent `mod_snapshot_flow` will land additional scenarios in the modal + marker tasks):
  - **Test 1**: navigate to operate route; assert `[data-testid="snapshot-action-button"]` is visible; assert `[data-testid="operate-layout-root"][data-snapshot-flow-open="false"]` baseline; click the button; assert the attribute flips to `"true"`.
  - **Test 2**: navigate to operate route; assert baseline `data-snapshot-flow-open="false"`; dispatch a `Cmd+S` (`Meta+S` via Playwright `keyboard.press`) or `Ctrl+S` (per the test browser's platform); assert the attribute flips to `"true"`. The browser save dialog must NOT appear (the spec relies on `page.on('dialog', ...)` to fail if it does, or alternatively asserts the page is still on the operate URL with no navigation).
- New i18n keys (`moderator.snapshotAction.label`, `moderator.snapshotAction.ariaLabel`, `moderator.snapshotAction.shortcutHint`) ship in en-US (drafts), pt-BR (`*.review.json` PENDING), es-419 (`*.review.json` PENDING). `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes.
- **Deferred-e2e debt registered** with `mod_snapshot_label_input` (it inherits the "trigger-flag-to-modal" scenario) and `mod_snapshot_visual_marker` (it inherits the "snapshot-created event to graph-marker render" scenario). The deferral is policy-compliant because the surface for those scenarios — the modal and the marker — does not yet exist; this task scopes a Playwright spec for the part that IS reachable (button + shortcut → trigger flag).
- **Native-speaker translation review** for the three new keys is human-only work; surfaced to the parking lot, not registered as a WBS task. (See "Tech-debt registration" note in the closer summary.)
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

1. **Trigger model: module-scoped Zustand slice with `isLabelInputOpen` boolean.**
   - **Why.** Three independent call sites (button click, shortcut press, modal lifecycle) need to read and write the same single bit. A module-scoped Zustand slice is the idiom this codebase has settled on for exactly this pattern (`useCaptureStore`, `useCommitStore`, `useProposeErrorStore`). Provider-based React Context would add provider wiring with no payoff (the slice is app-singleton). Prop-drilling would not survive the shortcut hook, which has no React parent.
   - **Alternative rejected — boolean inside `useUiStore`**: the existing `useUiStore` carries `activeSidebarPane` + similar UI navigation state. Adding `isLabelInputOpen` there would couple snapshot-flow lifecycle to general UI state. The snapshot trigger is feature-scoped, not global UI; keeping its slice next to its consumers (`apps/moderator/src/layout/useSnapshotFlowStore.ts`) matches the colocation discipline established in `useCommitAction.ts`.
   - **Alternative rejected — single open/close event channel** (e.g., an `EventTarget`): would force every consumer to manage subscription lifecycle manually. The Zustand subscription is already lifecycle-managed by React.

2. **Button placement: sibling above `<RightSidebar />` inside the existing `rightSidebar` slot.**
   - **Why.** docs/moderator-ui.md F10 says explicitly "sidebar button". `<OperateLayout>` has no toolbar slot. `<RightSidebar>` has three pane slots — none is the right home for a session-level action. Composing the button as a sibling above the pane stack inside the layout's `rightSidebar` slot keeps `<RightSidebar>`'s contract untouched and matches the doc's "sidebar button" framing.
   - **a — Alternative rejected: add a `headerSlot` prop to `<RightSidebar>`.** Would change a recently-shipped component's contract for a single one-off consumer. The composition-in-`OperateRoute` approach achieves the same visual placement without modifying the scaffold.
   - **b — Alternative rejected: add a `sessionActionsBar` slot to `<OperateLayout>`.** Would introduce a new top-level layout region for one button. If a future "Session controls" group emerges (commit-all, end session, settings), THAT future task can split the region out cleanly; for now, the sidebar slot is sufficient.
   - **c — Alternative rejected: mount in `<BottomStripCapture>`'s `modeBanner` area.** The bottom strip is mode-scoped (capture-statement / decompose / capture-defeater / …). A snapshot button there would be miscategorised as a mode affordance; the doc explicitly calls it a sidebar button.
   - **d — Alternative rejected: add a fourth pane to `<RightSidebar>`.** A "Session controls" pane with one button is over-structured. Panes have headers and expand/collapse; a button does not need either.

3. **Testability seam: `data-snapshot-flow-open` attribute on the layout root.**
   - **Why.** Playwright cannot observe Zustand store transitions directly. The Vitest tests already cover the store + button + shortcut in isolation; the e2e need only confirm the wiring fires end-to-end. Reflecting `isLabelInputOpen` as a DOM attribute on the always-present `operate-layout-root` element gives the spec a stable assertion target without depending on a modal that does not exist yet. The attribute is cheap (one boolean reflected as a string), survives the modal task (which may keep it for backwards-compat or replace assertions with the modal's own selector), and avoids the brittle alternative of poking React state via dev-tool internals.
   - **Alternative rejected — invisible "modal placeholder" element rendered conditionally**: would couple the spec to a render artefact that exists solely for testing. The data-attribute is a thin, declarative reflection of state and reads more naturally as a debugging aid in dev tools too.
   - **Alternative rejected — defer the e2e entirely until `mod_snapshot_label_input` lands**: the button and shortcut ARE reachable; per the UI-stream e2e policy ("If the component IS rendered, even in a disabled / inert state, a thin Playwright spec that asserts component-presence + affordance-state-from-route is better than full deferral"), full deferral would be policy-non-compliant.

4. **Two listeners coexist on `document`: `useSnapshotShortcut` AND `captureKeymap`.**
   - **a.** The snapshot shortcut does NOT extend `CaptureKeymapHandlers`. The two listeners handle orthogonal key sets (snapshot requires a modifier; captureKeymap bails on modifiers) under DIFFERENT activation scopes (snapshot is alive whenever `OperateRoute` is mounted; captureKeymap is alive only when the bottom-strip capture pane is mounted, which is route-scoped today but conceptually capture-scoped). Combining them into one handler interface would mean inverting the modifier-bail rule conditionally on which key fired — strictly worse than two small focused listeners.
   - **b.** Two listeners on `document` do not conflict — each inspects `event.key` and returns early on no-match. No `stopPropagation()` needed (the listeners do not share keys).
   - **c — No editable-target bail for the snapshot shortcut.** `Cmd+S` is the universal "save" chord; users expect it to fire while typing. `captureKeymap` bails on editable-target because its single-letter shortcuts (`f`/`p`/`v`/`n`/`d`) would otherwise corrupt textarea input — a different problem. Tested explicitly in case (h) of the shortcut Vitest spec.
   - **d — Forward-compatibility with `mod_global_keymap`.** That task will lift the snapshot binding into a unified dispatcher. The `useSnapshotShortcut` hook is intentionally a thin attach/detach + dispatch shim so the future refactor can rewrite the listener wiring without touching the store or the button. The `useSnapshotFlowStore.getState().open()` call site is the stable API the unified keymap will preserve.

5. **No disabled state on the button in v1.**
   - **Why.** Snapshot creation is moderator-authority work; the server enforces the moderator-only gate on the wire side (the same way `commit` is gated server-side per `ws_commit_message.md`). The client-side button does not gate on local authority signals — gating would require a "current user is a moderator?" predicate the moderator UI does not currently expose, and the server's rejection path is the safety net. The label-input task's WS dispatch will propagate the server's `not-a-moderator` error inline if it ever fires (the moderator UI is moderator-only by route gate today, so the path is unreachable in practice).
   - **Alternative rejected — disable when session is ended.** A snapshot of an ended session has no meaning, BUT (a) the session-ended state is not currently surfaced as a client-side predicate in a uniform way, (b) the server-side reject path will catch a snapshot attempt against an ended session, and (c) the v1 UX assumes the moderator stops issuing snapshots when they stop moderating. The complexity does not earn its keep in v1; a future task can add the gate against a stable session-state selector.

6. **i18n: three keys, pt-BR / es-419 drafts flagged PENDING.**
   - **Why.** Established pattern from `mod_commit_button.md` Decision §8 and similar — drafts ship in `*.review.json` flagged PENDING, native-speaker review happens out-of-band (parking-lot item, not a WBS task per the "no human-only WBS task" rule). en-US is authored inline by the implementer.
   - The three keys are: `moderator.snapshotAction.label` (button text), `moderator.snapshotAction.ariaLabel` (aria), `moderator.snapshotAction.shortcutHint` (overlay copy). Three is the minimum that doesn't require post-hoc additions when the overlay and the button both consume the same key namespace.

7. **`open()` is idempotent; `close()` is idempotent.**
   - **Why.** Defensive against double-press (the `event.repeat` bail handles physical key-repeat, but a moderator could legitimately click the button + press the shortcut in rapid succession). Idempotence means the modal-open transition has at-most-once semantics from the store's perspective; the modal task can subscribe to `isLabelInputOpen` transitions without defending against "open → open" spurious calls.

8. **The shortcut hook mounts at `OperateRoute` scope, not at `<SnapshotActionButton>` scope.**
   - **Why.** The shortcut must work even if the button is somehow not visible (e.g., scrolled off-screen in a narrow viewport — though the sidebar geometry today does not permit this). Mounting the hook at the route level decouples shortcut availability from button visibility. The button is a redundant affordance for mouse users; the shortcut is the primary affordance per the moderator-on-keyboard discipline.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- Module-scoped Zustand slice `useSnapshotFlowStore` landed at `apps/moderator/src/layout/useSnapshotFlowStore.ts` with `{ isLabelInputOpen, open(), close() }` — mirrors the `useCommitStore` idiom; `open()` and `close()` are both idempotent.
- Presentational `<SnapshotActionButton>` at `apps/moderator/src/layout/SnapshotActionButton.tsx` — localized `<button>` with `data-testid="snapshot-action-button"`, mounted above `<RightSidebar />` inside the `rightSidebar` slot of `<OperateLayout>`.
- `useSnapshotShortcut()` hook at `apps/moderator/src/layout/useSnapshotShortcut.ts` — `document`-level `keydown` listener for `Cmd+S` / `Ctrl+S`; calls `preventDefault()`, bails on `event.repeat`, detaches on unmount, does NOT bail on editable-target focus.
- `apps/moderator/src/routes/Operate.tsx` updated: calls `useSnapshotShortcut()` at route top, composes `<><SnapshotActionButton /><RightSidebar /></>` fragment in `rightSidebar` prop.
- `apps/moderator/src/layout/OperateLayout.tsx` extended: accepts `dataSnapshotFlowOpen?: boolean` prop and reflects it as `data-snapshot-flow-open="true|false"` on `operate-layout-root`; `OperateLayout.test.tsx` updated with three new cases.
- Three i18n keys (`moderator.snapshotAction.label`, `moderator.snapshotAction.ariaLabel`, `moderator.snapshotAction.shortcutHint`) added to `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` (en-US authored; pt-BR + es-419 PENDING in `*.review.json`). Fixer corrected `⌘/Ctrl+S` → `Cmd/Ctrl+S` per the V1 locale codepoint constraint.
- New Vitest specs: `useSnapshotFlowStore.test.ts` (6 cases), `SnapshotActionButton.test.tsx` (16 cases), `useSnapshotShortcut.test.tsx` (15 cases); `Operate.test.tsx` updated with 3 F10 trigger-wiring cases; `OperateLayout.test.tsx` updated with 3 `data-snapshot-flow-open` cases.
- New Playwright carrier spec at `tests/e2e/moderator-snapshot.spec.ts` (2 tests — sidebar button + `Cmd/Ctrl+S` shortcut both flip `data-snapshot-flow-open` to `"true"`).
- `playwright.config.ts` updated to include the new spec.
- Native-speaker translation review for the three new pt-BR / es-419 keys is human-only work — covered by the standing parking-lot entry (2026-05-30); no WBS task registered.
