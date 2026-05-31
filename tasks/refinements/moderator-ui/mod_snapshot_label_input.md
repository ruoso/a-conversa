# Moderator snapshot label input modal — overlay form that collects the label, dispatches `label-snapshot`, and closes the trigger flag

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_snapshot_flow.mod_snapshot_label_input`.

```
task mod_snapshot_flow "F10 — Snapshot a segment" {
  depends !mod_capture_flow, root_app.root_moderator_cutover, backend.websocket_protocol.ws_snapshot_message
  task mod_snapshot_label_input "Snapshot label input modal" {
    effort 0.5d
    allocate team
    depends !mod_snapshot_action, backend.websocket_protocol.ws_label_snapshot_message, data_and_methodology.methodology_engine.snapshot_create_logic
  }
  ...
}
```

## Effort estimate

**0.5d.** Confirmed. The deliverable is three small frontend artefacts plus their colocated tests:

1. A `useLabelSnapshotAction()` hook (~80 lines) at `apps/moderator/src/layout/useLabelSnapshotAction.ts` — module-scoped Zustand slice `useLabelSnapshotStore` tracking `{ inFlight: boolean, lastError: WireError | undefined }`; imperative `submit(label)` callback that calls `useWsClient().send('label-snapshot', { sessionId, label })`, flips `inFlight`, catches `WsRequestError` / `WsRequestTimeoutError` and surfaces a `WireError`. Mirrors the structure of [`useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts:131-291) (single-slot variant — no per-slot keying; the modal is a singleton).
2. A `<SnapshotLabelInputModal>` overlay component (~150 lines) at `apps/moderator/src/layout/SnapshotLabelInputModal.tsx` — full-viewport overlay (`position: fixed inset-0`) with a centered dialog card; a single `<input type="text" maxLength={MAX_SNAPSHOT_LABEL_LENGTH}>`, a submit button, a cancel button, and an inline error region. Mounts conditionally from `useSnapshotFlowStore(state => state.isLabelInputOpen)`. Closes via Escape, backdrop click, cancel-button click, or successful submit; STAYS open on submit failure so the moderator reads the error and retries.
3. A `<SnapshotLabelInputMount>` wrapper (~15 lines) at `apps/moderator/src/layout/SnapshotLabelInputMount.tsx` — the always-mounted bridge that subscribes to `useSnapshotFlowStore` and conditionally renders the modal. Mounted as a sibling of `<OperateLayout>` inside `OperateRoute`'s JSX so the overlay can cover the layout from `z-50+`.

Plus a small i18n addition (eight modal-namespace keys plus pt-BR / es-419 review flags), one Vitest file per artefact, one Playwright `test()` block extending `tests/e2e/moderator-snapshot.spec.ts` (the existing carrier the action task seeded), and the existing `data-snapshot-flow-open` seam (already on `operate-layout-root` from `mod_snapshot_action`) continues to serve as a stable wiring assertion.

This task **does NOT** include the backend write-side: see Decision §1 for the two new backend tasks (`backend.websocket_protocol.ws_label_snapshot_message` and `data_and_methodology.methodology_engine.snapshot_create_logic`) this refinement registers; the closer wires them into the modal task's `depends` list. The modal cannot ship end-to-end until those land.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- **`moderator_ui.mod_snapshot_flow.mod_snapshot_action`** (done — 2026-05-31). Shipped the trigger flag (`useSnapshotFlowStore.isLabelInputOpen`), the sidebar button (`<SnapshotActionButton>`), the `Cmd/Ctrl+S` shortcut (`useSnapshotShortcut`), and the `data-snapshot-flow-open` testability seam on `operate-layout-root` per [`tasks/refinements/moderator-ui/mod_snapshot_action.md`](mod_snapshot_action.md). This task is the consumer of `isLabelInputOpen` — mounts when true, calls `close()` on submit success / cancel / Escape / backdrop click.
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11). `useWsClient()` returns a `WsClient` whose `send(kind, payload)` method returns a `Promise` that resolves on ack and rejects with `WsRequestError` / `WsRequestTimeoutError`. Reused verbatim — same pattern `useCommitAction` and `useEditWordingAction` use.
- **`moderator_ui.mod_layout.mod_layout_shell`** (done — 2026-05-11). [`<OperateLayout>`](../../../apps/moderator/src/layout/OperateLayout.tsx) renders the `operate-layout-root` div. The modal mounts as a SIBLING of `<OperateLayout>` (NOT a child) inside `OperateRoute`'s JSX so the fixed-position overlay covers the layout without participating in its CSS Grid (Decision §3).
- **`backend.websocket_protocol.ws_snapshot_message`** (done — 2026-05-11) — the READ-side `snapshot` state-query. **NOT what this modal dispatches.** Documented for context.
- **`backend.websocket_protocol.ws_label_snapshot_message`** (done — 2026-05-31, commit `48101a71`) — the WS write-side envelope (C→S `label-snapshot`, S→C `snapshot-labeled`) that mints the `snapshot-created` event. Registered by this refinement's Decision §1.a; landed by the orchestrator's backend stream before this leaf re-queued. See [`tasks/refinements/backend/ws_label_snapshot_message.md`](../backend/ws_label_snapshot_message.md).
- **`data_and_methodology.event_types.snapshot_events`** (done — 2026-05-10). The `snapshot-created` event kind + `snapshotCreatedPayloadSchema` (`{ snapshot_id, label, log_position }`) exist in [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts); the projection's `addSnapshot` / `snapshots()` consume them.
- **`data_and_methodology.methodology_engine.snapshot_create_logic`** (done — 2026-05-31, commit `55238da1`) — the methodology-engine handler that validates the label + mints the `snapshot-created` payload `{ snapshot_id, label, log_position }`. Registered by this refinement's Decision §1.b; landed concurrently with the WS handler. See [`tasks/refinements/data-and-methodology/snapshot_create_logic.md`](../data-and-methodology/snapshot_create_logic.md).
- **`backend_hardening.resource_limits_and_dos.user_text_length_caps`** (done). `MAX_SNAPSHOT_LABEL_LENGTH = 128` exported from [`packages/shared-types/src/limits.ts:66`](../../../packages/shared-types/src/limits.ts). The modal's `<input>` carries `maxLength={128}` + a defensive `.slice(0, 128)` clamp; the helper text shows `{used}/{max}`.
- **`frontend_i18n.i18n_library_choice`** / **`i18n_catalog_workflow`** / **`i18n_locale_negotiation`** / **`i18n_testing`** (done — `useTranslation()` API, `*.review.json` PENDING-flag lifecycle, parity round-trip pattern).
- **[ADR 0021 — Event envelope schema-on-write](../../../docs/adr/0021-event-envelope.md)** — the backend handler this task registers performs schema validation on the `snapshot-created` payload before append.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** — every empirical check ships as a committed Vitest / Cucumber / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** — `useTranslation()` API the new modal consumes.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_snapshot_flow.mod_snapshot_visual_marker`** (sibling — not yet refined). Reads the projection's `snapshots[]` array (populated by `snapshot-created` events) and renders a marker on the graph canvas. Independent of the modal; will inherit the "labeled-snapshot event arrives → marker renders" Playwright scenario from THIS task's e2e once both this and the marker task ship.
- **`moderator_ui.mod_keyboard_shortcuts.mod_global_keymap`** (downstream — depends on `!mod_snapshot_flow`). Will consolidate the per-component keymaps; the modal's own Escape-handling stays local (no global keymap entry) — Decision §5.

No remaining BLOCKING edges as of 2026-05-31 — the two backend prereqs registered by Decision §1 have both landed (see Settled list).

## What this task is

Land the **modal** of F10 ("Snapshot a segment") on the moderator's operate route: a centered overlay dialog that opens whenever `useSnapshotFlowStore.isLabelInputOpen === true`, collects a short text label (≤128 chars), dispatches `label-snapshot` over the WS, and on success closes via `useSnapshotFlowStore.getState().close()`. On failure (engine rejection, timeout, transport error) the modal stays open, surfaces a localized inline error, and the moderator can retry or cancel.

[docs/moderator-ui.md, F10 (lines 156–162)](../../../docs/moderator-ui.md):

> 1. **Trigger `Snapshot`** (shortcut or sidebar button).
> 2. **Type a label** (e.g., "Segment 1 close").
> 3. **The current event-log position is named**; replay can refer to this snapshot.

This task implements step 2 and the wire dispatch that produces step 3 (the `snapshot-created` event). Step 1 is already done by `mod_snapshot_action`; the marker render (consumes the `snapshot-created` event from the projection) is `mod_snapshot_visual_marker`.

Concretely the deliverable is:

- **One new hook**: `apps/moderator/src/layout/useLabelSnapshotAction.ts` — module-scoped `useLabelSnapshotStore` Zustand slice with `{ inFlight: boolean, lastError: WireError | undefined, setInFlight, setError }` + a `resetLabelSnapshotStore()` test seam. Exports `useLabelSnapshotAction()` which returns `{ submit: (label: string) => Promise<void>, inFlight, lastError }`. `submit()`:
  - Reads `sessionId` from `useParams` (mirrors `useCommitAction`).
  - Reads `expectedSequence` from `useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0`.
  - Guard: if already in flight, no-op.
  - Sets `inFlight=true`, clears `lastError`.
  - Calls `await client.send('label-snapshot', { sessionId, expectedSequence, label })`.
  - On success: clears `inFlight`, calls `useSnapshotFlowStore.getState().close()` (the modal unmounts via the parent subscription), the store error stays cleared.
  - On failure: clears `inFlight`, maps the thrown error via `toWireError(err, timeoutText)` (the same shape `useCommitAction` uses), sets `lastError`. **Does NOT close the modal.**
- **One new component**: `apps/moderator/src/layout/SnapshotLabelInputModal.tsx` — full-viewport overlay (`<div data-testid="snapshot-label-input-modal" role="dialog" aria-modal="true" aria-labelledby="snapshot-label-input-title">`) at `position: fixed inset-0 z-50` with a translucent backdrop (`bg-slate-900/40`) and a centered white card (`rounded-md border border-slate-200 bg-white p-4 shadow-md w-[28rem] max-w-[90vw]`). Contents:
  - Title `<h2 id="snapshot-label-input-title">` reading `moderator.snapshotLabelInput.title`.
  - `<label htmlFor="snapshot-label-input-field">` reading `moderator.snapshotLabelInput.fieldLabel`.
  - `<input id="snapshot-label-input-field" data-testid="snapshot-label-input-field" type="text" maxLength={MAX_SNAPSHOT_LABEL_LENGTH} aria-describedby="snapshot-label-input-helper snapshot-label-input-error" aria-invalid={hasError}>` — controlled `useState<string>('')`, focused via `useRef` + one-shot mount `useEffect` (per the `CaptureTextInput` pattern, no `autoFocus` attribute).
  - Helper text `<p id="snapshot-label-input-helper">` showing `{used}/{max}` via ICU plural-aware formatting (`moderator.snapshotLabelInput.helper`).
  - Submit button `<button data-testid="snapshot-label-input-submit" data-snapshot-label-state="idle|in-flight">` — disabled when `inFlight || trimmed.length === 0 || trimmed.length > MAX_SNAPSHOT_LABEL_LENGTH`; label flips to `inFlightLabel` while in flight.
  - Cancel button `<button data-testid="snapshot-label-input-cancel">` — disabled while `inFlight`; on click calls `useSnapshotFlowStore.getState().close()` + clears the in-hook error via `useLabelSnapshotStore.getState().setError(undefined)`.
  - Inline error region `<div data-testid="snapshot-label-input-error" role="alert" data-error-code={lastError.code}>` rendered only when `lastError !== undefined`, with messages keyed by code (`'moderator-only'`, `'sequence-mismatch'`, `'timeout'`, `'unknown'` fallback) — mirrors `resolveEditWordingErrorMessage` shape from [`EditWordingSubmenu.tsx:52-69`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx).
  - Close-paths: Escape key (window-level `keydown` listener); backdrop click (`onMouseDown` on the backdrop wrapper, NOT the card — `event.target === backdropRef.current` check); cancel button. Submit success closes via the hook's `useSnapshotFlowStore.close()` call. All close-paths are no-ops while `inFlight` (the moderator can't accidentally cancel a request mid-flight).
- **One new mount component**: `apps/moderator/src/layout/SnapshotLabelInputMount.tsx` — `function SnapshotLabelInputMount() { const open = useSnapshotFlowStore(s => s.isLabelInputOpen); return open ? <SnapshotLabelInputModal /> : null; }`. The wrapper exists so `OperateRoute` doesn't need its own subscription to `isLabelInputOpen` (the existing `dataSnapshotFlowOpen` prop already reads it; we keep the React tree minimal by isolating the mount/unmount in a dedicated component).
- **One composition update** in `apps/moderator/src/routes/Operate.tsx`: add `<SnapshotLabelInputMount />` as a sibling of `<OperateLayout>` inside the route's returned JSX. The mount sits OUTSIDE the layout so the fixed-position overlay isn't subject to the layout's CSS Grid overflow rules.
- **Eight new i18n keys** in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` under `moderator.snapshotLabelInput`:
  - `title` — modal title ("Snapshot the current position").
  - `fieldLabel` — input label ("Snapshot label").
  - `placeholder` — input placeholder ("e.g., Segment 1 close").
  - `helper` — count helper ICU pattern (`"{used, number}/{max, number} characters"`).
  - `submitLabel` — submit-button label ("Save snapshot").
  - `inFlightLabel` — submit-button label while in flight ("Saving…").
  - `cancelLabel` — cancel-button label ("Cancel").
  - `errors.moderatorOnly` / `errors.sequenceMismatch` / `errors.timeout` / `errors.unknown` — four error-code-keyed messages (nested under `errors`).

## Why it needs to be done

This is the unit of work that actually CREATES a snapshot. Without the modal:

- The `Cmd/Ctrl+S` shortcut and sidebar button flip a flag that nothing reads end-to-end (the testability seam was put there exactly because the modal was not yet implemented — see [`mod_snapshot_action.md:71`](mod_snapshot_action.md)).
- The `snapshot-created` event kind exists in the schema and the projection reads it, but no path in the system MINTS one. The data layer is provisioned for a feature that has no producer.
- `mod_snapshot_visual_marker` can render a marker for `snapshot-created` events in the projection, but those events never appear, so the marker is untestable end-to-end.
- F10 in [docs/moderator-ui.md](../../../docs/moderator-ui.md) ships only step 1 of three.

Once this task lands (with its registered backend prerequisites), F10 is end-to-end: trigger → label → snapshot event → projection update → marker render (when `mod_snapshot_visual_marker` ships).

## Inputs / context

- [docs/moderator-ui.md — F10 Snapshot a segment, lines 156–162](../../../docs/moderator-ui.md) — the three-step UX. Step 2 ("Type a label, e.g., 'Segment 1 close'") is this task.
- [docs/moderator-ui.md — Modes, line 197](../../../docs/moderator-ui.md) — lists "*Snapshot label*" as a possible mode. **Not adopted here**: the modal is overlay-style, not a mode (Decision §3).
- [`apps/moderator/src/layout/useSnapshotFlowStore.ts`](../../../apps/moderator/src/layout/useSnapshotFlowStore.ts) — the trigger slice this modal subscribes to. `open()` / `close()` are both idempotent; `close()` is called on submit success / Escape / backdrop / cancel.
- [`apps/moderator/src/layout/OperateLayout.tsx`](../../../apps/moderator/src/layout/OperateLayout.tsx) — the grid scaffold; carries `data-snapshot-flow-open` on `operate-layout-root` (from `mod_snapshot_action`). The modal is mounted as a sibling, not a child.
- [`apps/moderator/src/routes/Operate.tsx:227-299`](../../../apps/moderator/src/routes/Operate.tsx) — route composition. Adds `<SnapshotLabelInputMount />` as a sibling of `<OperateLayout>`.
- [`apps/moderator/src/layout/useCommitAction.ts:131-291`](../../../apps/moderator/src/layout/useCommitAction.ts) — reference for the WS-dispatch hook shape (store slice + `submit()` callback + `WireError` mapping + in-flight guard + `expectedSequence` read from `useWsStore`).
- [`apps/moderator/src/layout/EditWordingSubmenu.tsx:113-256`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx) — reference for the form pattern (`useEffect`-mounted Escape/click-outside close-paths, error region with `role="alert"` + `data-error-code` + code-keyed message resolver, in-flight `disabled` semantics, close-only-on-success submit wiring that reads the LIVE store error rather than the closed-over hook result).
- [`apps/moderator/src/layout/CaptureTextInput.tsx`](../../../apps/moderator/src/layout/CaptureTextInput.tsx) — reference for the controlled-input pattern with `useRef` + one-shot mount focus (avoiding `autoFocus` because it interferes with Playwright's keyboard-driven focus assertions).
- [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts) — `snapshotCreatedPayloadSchema` (`{ snapshot_id: uuid, label: string (1..128), log_position: int positive }`). The new engine handler will emit this shape.
- [`packages/shared-types/src/limits.ts:66`](../../../packages/shared-types/src/limits.ts) — `MAX_SNAPSHOT_LABEL_LENGTH = 128`.
- [`tasks/refinements/backend/ws_snapshot_message.md:84-93`](../backend/ws_snapshot_message.md) — the deferred-future-task note this refinement honors by registering `ws_label_snapshot_message`.
- [`tasks/refinements/data-and-methodology/snapshot_events.md`](../data-and-methodology/snapshot_events.md) — the event-kind refinement; "the snapshot is a regular event" and the label-cap rationale are settled there.
- [`packages/i18n-catalogs/src/catalogs/en-US.json:291-295`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the `moderator.snapshotAction` namespace landed by `mod_snapshot_action`. The new modal keys live in the sibling `moderator.snapshotLabelInput` namespace to keep the trigger-affordance and the modal-overlay namespaces disjoint.

## Constraints / requirements

- **Single modal instance, mounted at route scope.** Exactly one `<SnapshotLabelInputModal>` may be live at any time. The `<SnapshotLabelInputMount>` wrapper guarantees this via its boolean subscription — the modal is either rendered or unmounted; there is no second-modal stack.
- **Modal lifecycle is store-driven, not prop-driven.** The modal observes `useSnapshotFlowStore.isLabelInputOpen`; the trigger affordances (button, shortcut) and the modal's own close-paths all converge on `useSnapshotFlowStore.getState().open()` / `.close()`. No `props.onClose` on the modal — the close action goes through the store.
- **WS dispatch shape.** Client → server envelope: `label-snapshot` with payload `{ sessionId: string, expectedSequence: number, label: string (trimmed, 1..MAX_SNAPSHOT_LABEL_LENGTH) }`. Server → client ack: `snapshot-labeled` with payload `{ snapshotId: string }`. The hook does not consume the ack payload other than to detect success (the projection update arrives via the parallel `event-applied` broadcast).
- **`expectedSequence`.** Read from `useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0` at `submit()` time. Same optimistic-concurrency contract the four write handlers use; a stale sequence surfaces as a `'sequence-mismatch'` rejection that the modal renders inline.
- **Label validation (client side).**
  - Trimmed length must be ≥1.
  - Length must be ≤`MAX_SNAPSHOT_LABEL_LENGTH` (128). The `<input>` has `maxLength={128}` plus a defensive `.slice(0, 128)` in the change handler (Decision §6).
  - Empty / whitespace-only labels: submit is disabled (button greyed); pressing Enter is a no-op while disabled.
- **Label validation (server side).** Enforced by the methodology-engine handler — schema rejects empty / over-cap labels with `'invalid-label'`. The modal renders the wire message verbatim if it surfaces (fallback path for any client/server disagreement).
- **Moderator-only authority.** Enforced by the WS handler (the new `ws_label_snapshot_message`). The modal does NOT gate on a client-side "is moderator?" predicate (mirrors `mod_snapshot_action` Decision §5 — the moderator route is moderator-only by route gate today; the server's rejection path is the safety net). If the server returns `'moderator-only'` (e.g., the route gate is bypassed somehow), the modal renders it inline.
- **Close-on-success only.** On submit success, the hook calls `useSnapshotFlowStore.getState().close()` and the modal unmounts via the parent subscription. On submit failure, the modal stays open, the error is shown, the moderator can retry. Mirrors `EditWordingSubmenu` Decision §6.
- **Close-paths are no-ops while in-flight.** Escape, backdrop click, and cancel-button click are all gated on `!inFlight`. The moderator cannot accidentally drop a request mid-flight; the request either resolves (closes modal) or fails (allows close).
- **Submit triggers.** Click on the submit button; pressing Enter while the input is focused (`onKeyDown` on the input — `event.key === 'Enter' && !event.shiftKey && canSubmit`). Pressing Enter while the cancel button is focused does NOT submit (only the input field is wired).
- **Accessibility.**
  - `role="dialog"` + `aria-modal="true"` + `aria-labelledby="snapshot-label-input-title"` on the card.
  - `aria-describedby="snapshot-label-input-helper snapshot-label-input-error"` on the input.
  - `aria-invalid={hasError}` on the input.
  - Focus moves to the input on open (`useRef` + one-shot mount `useEffect`).
  - Focus restoration on close: NOT implemented in v1 (Decision §7) — the trigger affordances are global (sidebar button + shortcut) and a moderator's focus context on Cmd+S is unpredictable. Future task can revisit if usability demands it.
- **No focus trap.** Decision §7 — the dialog has no other interactive elements competing for focus (input, two buttons, three Tab stops total); a Tab cycle through the three elements is sufficient. Implementing a focus trap is not worth the dependency / complexity in v1.
- **Tailwind only.** No new stylesheets; the modal uses utility classes consistent with the moderator's slate-palette idiom (`bg-white`, `border-slate-200`, `text-slate-900`, `rounded-md`, `shadow-md`).
- **Stable selectors.**
  - Modal root: `data-testid="snapshot-label-input-modal"`.
  - Input: `data-testid="snapshot-label-input-field"`.
  - Submit: `data-testid="snapshot-label-input-submit"` + `data-snapshot-label-state="idle|in-flight"`.
  - Cancel: `data-testid="snapshot-label-input-cancel"`.
  - Error: `data-testid="snapshot-label-input-error"` + `data-error-code={code}`.
- **i18n discipline.** All eight new keys ship in en-US (drafts authored by the implementer), pt-BR (`*.review.json` PENDING), es-419 (`*.review.json` PENDING). Parity round-trip test from the existing pattern applies. Native-speaker review for pt-BR / es-419 is the standing parking-lot item (2026-05-30); no WBS task is registered for it.
- **Reuses existing `data-snapshot-flow-open` seam.** `mod_snapshot_action` already reflects `isLabelInputOpen` as an attribute on `operate-layout-root`; the new Playwright spec asserts both the attribute AND the modal's presence. The attribute is retained (not retired) — it remains a useful debugging aid in dev tools and a deterministic non-React-poking signal for cross-cutting tests.

## Acceptance criteria

- New `apps/moderator/src/layout/useLabelSnapshotAction.ts` exports `useLabelSnapshotAction()` (returning `{ submit, inFlight, lastError }`), `useLabelSnapshotStore`, `resetLabelSnapshotStore`, and `WireError`. `submit(label)` dispatches `label-snapshot` and on success calls `useSnapshotFlowStore.getState().close()`.
- New `apps/moderator/src/layout/SnapshotLabelInputModal.tsx` renders the centered dialog with the input, submit/cancel buttons, and inline error region. Escape / backdrop click / cancel click all call `useSnapshotFlowStore.getState().close()` when not in-flight.
- New `apps/moderator/src/layout/SnapshotLabelInputMount.tsx` subscribes to `useSnapshotFlowStore.isLabelInputOpen` and conditionally renders the modal.
- `apps/moderator/src/routes/Operate.tsx` mounts `<SnapshotLabelInputMount />` as a sibling of `<OperateLayout>` inside `OperateRoute`'s returned JSX.
- `packages/shared-types/src/ws-envelope.ts` extends `wsMessageTypes` with `'label-snapshot'` (Group-B tail) and `'snapshot-labeled'` (Group-C tail); matching payload schemas + `WsMessagePayloadMap` entries; vocabulary pin in `ws-envelope.test.ts` widens by one entry per group. **(Lands in `ws_label_snapshot_message` — this task references the prereq; the closer wires the dependency.)**
- Committed Vitest cases (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)):
  - `apps/moderator/src/layout/useLabelSnapshotAction.test.ts` — `(a)` initial `inFlight=false, lastError=undefined`; `(b)` `submit('label')` flips `inFlight` true, calls `client.send('label-snapshot', { sessionId, expectedSequence, label: 'label' })`; `(c)` on ack: `inFlight=false`, `lastError=undefined`, `useSnapshotFlowStore.isLabelInputOpen=false`; `(d)` on `WsRequestError`: `inFlight=false`, `lastError={code,message}`, `isLabelInputOpen=true` (modal stays open); `(e)` on `WsRequestTimeoutError`: `lastError.code='timeout'`; `(f)` `submit()` while already in flight is a no-op (`client.send` called exactly once); `(g)` `submit('  ')` (whitespace-only) is rejected client-side (no `client.send` call); `(h)` label is trimmed before send (`submit('  hello  ')` sends `label: 'hello'`); `(i)` `expectedSequence` is read from `useWsStore.getState().sessionState[sessionId].lastAppliedSequence` at submit-time.
  - `apps/moderator/src/layout/SnapshotLabelInputModal.test.tsx` — `(a)` renders with `data-testid="snapshot-label-input-modal"` and `role="dialog"`, `aria-modal="true"`; `(b)` input is focused on mount; `(c)` typing into the input updates the controlled state and the helper count; `(d)` submit button is disabled when input is empty / whitespace-only; `(e)` submit button is disabled while `inFlight`; `(f)` Enter in the input triggers submit when enabled; `(g)` Escape calls `useSnapshotFlowStore.close()` when not in-flight; `(h)` Escape is a no-op when `inFlight`; `(i)` backdrop click calls `close()` when not in-flight, does NOT close when clicking inside the card; `(j)` backdrop click is a no-op when `inFlight`; `(k)` cancel button calls `close()` when not in-flight; `(l)` cancel button is disabled when `inFlight`; `(m)` error region renders when `lastError !== undefined` with `role="alert"` and `data-error-code` reflecting the wire code; `(n)` error message is localized per code (`moderator-only` / `sequence-conflict` / `timeout` / `unknown`); `(o)` per-locale label round-trip (en-US / pt-BR / es-419) resolves to non-empty strings for the eight modal keys; `(p)` input enforces `maxLength=128`.
  - `apps/moderator/src/layout/SnapshotLabelInputMount.test.tsx` — `(a)` renders nothing when `isLabelInputOpen=false`; `(b)` renders the modal when `isLabelInputOpen=true`; `(c)` unmounts the modal when the flag flips back to false.
  - Update to `apps/moderator/src/routes/Operate.test.tsx` — `(a)` `<SnapshotLabelInputMount />` is in the route tree; `(b)` opening the flag via `useSnapshotFlowStore.getState().open()` makes the modal appear; `(c)` the modal's submit success closes the modal.
- Extends new Playwright spec `apps/moderator/tests/e2e/moderator-snapshot.spec.ts` (already created by `mod_snapshot_action`):
  - **Test 3**: navigate to operate route; click sidebar button → modal appears (assert `[data-testid="snapshot-label-input-modal"]` is visible); type "Segment 1 close"; click submit; modal disappears AND `data-snapshot-flow-open` flips back to `"false"`; a snapshot is visible in the projection's `snapshots[]` (assertable via a server-side check or by observing a `snapshot-created` event broadcast — the spec uses the simpler "modal closes after ack" assertion plus a post-condition that re-opens the modal and confirms a follow-up snapshot succeeds against the new `lastAppliedSequence`).
  - **Test 4**: open the modal; press Escape → modal disappears AND `data-snapshot-flow-open` flips to `"false"`.
  - **Test 5**: open the modal; press Cmd/Ctrl+S → no-op (modal stays open, `open()` is idempotent — confirms the shortcut does not bounce the modal open repeatedly or close it).
  - **Test 6**: open the modal; click outside the card (on the backdrop) → modal disappears.
- New i18n keys (`moderator.snapshotLabelInput.{title,fieldLabel,placeholder,helper,submitLabel,inFlightLabel,cancelLabel,errors.{moderatorOnly,sequenceMismatch,timeout,unknown}}`) ship in en-US (drafts), pt-BR (`*.review.json` PENDING), es-419 (`*.review.json` PENDING). `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes.
- **New backend WBS tasks registered** (closer-mechanically — Decision §1):
  - `backend.websocket_protocol.ws_label_snapshot_message` (0.5d) — WS write-side handler.
  - `data_and_methodology.methodology_engine.snapshot_create_logic` (0.5d) — engine handler that mints the `snapshot-created` event.
  - Both added to this task's `depends` list; both inherit the milestone of the parent `mod_snapshot_flow` task.
- **Deferred-e2e debt registered** with `mod_snapshot_visual_marker` (it inherits the "labeled-snapshot event arrives → marker renders" scenario). Policy-compliant: the marker is not yet rendered. The marker task's refinement will add a Playwright scenario that issues a snapshot via this modal then asserts a marker appears at the snapshot's `log_position`.
- **Native-speaker translation review** for the eight new pt-BR / es-419 keys is human-only work; surfaced to the parking lot (covered by the standing 2026-05-30 entry); not registered as a WBS task.
- `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

1. **Register two new backend tasks; depend on both; do not write the backend in this 0.5d.** *(Both prereqs landed 2026-05-31 — see Inherited dependencies. Decision retained as the historical record of why this leaf was reshaped.)*
   - **Why.** The `snapshot-created` event kind exists in `packages/shared-types/src/events.ts` and the projection reads it, but no engine handler mints those events and no WS write-side envelope dispatches the action ([`ws_snapshot_message.md:84-93`](../backend/ws_snapshot_message.md) explicitly deferred this as a future sibling). The modal cannot end-to-end-function without both. Building the backend in-line with the modal would couple two streams of work into one 0.5d task that is actually 1.5d-2d real work; the WBS prefers smaller, independently-shippable units.
   - **a — `backend.websocket_protocol.ws_label_snapshot_message` (0.5d) — DONE 2026-05-31 (commit `48101a71`).** Mirrors the `ws_commit_message` / `ws_meta_disagreement_message` skeleton. Subscribe-before-act gate; moderator-only authority gate (rejection code `'moderator-only'` matches `ws_commit_message`'s); `expectedSequence` optimistic-concurrency gate (rejection `'sequence-mismatch'`); call-through to the new methodology-engine handler; append the returned `snapshot-created` event; broadcast `event-applied`; ack with `snapshot-labeled` payload `{ snapshotId }`. Envelope name is `label-snapshot` (action) → `snapshot-labeled` (ack), pre-reserved by `ws_snapshot_message.md` decision §"snapshot-state is the response envelope name".
   - **b — `data_and_methodology.methodology_engine.snapshot_create_logic` (0.5d) — DONE 2026-05-31 (commit `55238da1`).** Stateless handler in `apps/server/src/methodology/handlers/createSnapshot.ts`. Takes `{ sessionId, label, currentSequence, moderatorId, now }`; validates the label (trimmed, 1..128); generates a `snapshot_id` UUID; returns the `snapshot-created` payload `{ snapshot_id, label, log_position: currentSequence + 1 }` (the snapshot's `log_position` is the sequence of the snapshot event itself, per [`snapshot_events.md`](../data-and-methodology/snapshot_events.md) Decisions). Pure-logic Vitest coverage (mirrors the engine handlers next to it). No interaction with `agreement_state_machine` — snapshots are not facets.
   - **Implementer reads.** Before writing the hook, re-read the implementer-shipped handlers to lock in the exact wire shape and error codes: [`tasks/refinements/backend/ws_label_snapshot_message.md`](../backend/ws_label_snapshot_message.md), [`tasks/refinements/data-and-methodology/snapshot_create_logic.md`](../data-and-methodology/snapshot_create_logic.md), and the typed `WsClient.send('label-snapshot', ...)` signature now exported from `packages/shared-types/src/ws-envelope.ts`. Any deviation between the assumed shape in this refinement's "Constraints / requirements" and the shipped backend (e.g. exact ack payload field names, exact rejection codes) is resolved IN FAVOUR of the shipped backend; the implementer updates this refinement's wire-shape lines in the same commit if drift is found.
   - **Alternative rejected — bundle the backend into this task and stretch the estimate.** Sets a precedent for moderator-UI refinements absorbing backend work; obscures the WBS's per-stream effort accounting; and the closer can't register or re-balance the backend work cleanly if it lives inside a moderator-UI refinement.
   - **Alternative rejected — register the backend tasks but NOT depend on them; ship the modal as a no-op submitter.** A modal whose submit-button does nothing is a UX trap; landing the modal without its wire-side means a moderator could press Cmd+S → type a label → click Save → nothing happens. The orchestrator's pick-task pass would also not naturally prioritize the backend follow-ups if they aren't this task's deps. Hard dependency forces correct ordering.

2. **WS envelope shape: `label-snapshot` (C→S) + `snapshot-labeled` (S→C).**
   - **Why.** The read-side already owns `'snapshot'` (request) + `'snapshot-state'` (response). The write-side needs distinct names to avoid namespace collisions. `ws_snapshot_message.md` Decision §"snapshot-state is the response envelope name" pre-reserved `'snapshot-labeled'` for exactly this purpose. The verb-noun shape `label-snapshot` mirrors `mark-meta-disagreement` (verb-noun) on the action side.
   - **Alternative rejected — reuse `snapshot` with a discriminator field.** Overloads a single envelope across read and write semantics; the gate stacks differ (write has moderator-only + expectedSequence; read does not); the dispatcher's per-kind handler shape doesn't fit. The `WsMessageType` union is closed and short — adding two new entries is the path of least resistance.
   - **Alternative rejected — `create-snapshot` / `snapshot-created`.** The event-kind is `snapshot-created`; using the same name for the wire-ack collides with how readers reason about the projection (`snapshot-created` is the EVENT, not an ACK). `snapshot-labeled` (the past-participle form for the wire) keeps the namespaces disjoint.

3. **Modal placement: full-viewport fixed-position overlay, mounted as a sibling of `<OperateLayout>` in `OperateRoute`.**
   - **Why.** The dialog is overlay-style (covers the whole UI, takes focus, blocks other affordances until dismissed). docs/moderator-ui.md F10 says "Type a label" without specifying placement; the established sibling-submenus (`EditWordingSubmenu`, `AxiomMarkSubmenu`) are cursor-anchored small menus — the wrong pattern for a "type and submit" dialog. A full-viewport overlay is the standard pattern for a single-input dialog at this scale.
   - **Alternative rejected — render as a `<RightSidebar>` slot / pane.** Would force the moderator to look away from the graph; an overlay over the graph keeps the visual context.
   - **Alternative rejected — render inside `<BottomStripCapture>`'s mode banner area.** The bottom-strip is mode-scoped for the capture pane (per `mod_snapshot_action.md` Decision §2.c); a snapshot label-input there would be miscategorised. The doc's "*Snapshot label*" mode-banner entry (line 197 of moderator-ui.md) is not load-bearing — it was forward-looking and the overlay shape is the natural fit.
   - **Alternative rejected — inline near the trigger button.** The trigger has two affordances (sidebar button + global shortcut); a tooltip-style popover anchored to the button is wrong for the shortcut-triggered flow (where the button may be off-screen or never visually fixated on). A centered overlay is the consistent surface for both trigger paths.

4. **Hook shape: single-slot (no per-slot keying); local Zustand slice `useLabelSnapshotStore`.**
   - **Why.** Unlike `useCommitAction` (which has many concurrent rows competing for an in-flight slot per `proposal_id` / `(entity_kind, entity_id, facet)`), the snapshot modal is a singleton — there is at most one live modal, at most one in-flight `label-snapshot` request. A single boolean `inFlight` + a single `lastError` is sufficient. No `slotKey`, no `Set<string>` / `Map<string, WireError>`.
   - **Alternative rejected — fold the in-flight + error state into `useSnapshotFlowStore`.** Mixes lifecycle concerns (open/closed) with request concerns (in-flight, error). The trigger affordances do NOT need to read in-flight state; the modal does NOT need to know about the trigger affordances' lifecycle other than `close()`. Keeping the slices disjoint matches the colocation-of-state-near-its-consumer discipline.
   - **Alternative rejected — synchronous local React state in the modal.** Loses the cross-render persistence the modal needs for the in-flight window (if the modal unmounts mid-flight — it cannot, because close-paths are gated on in-flight, but defensively the store survives any render churn).

5. **Modal Escape handler is local, not part of `mod_global_keymap`'s consolidation target.**
   - **Why.** Escape's semantics inside a dialog are universal ("close the dialog"). A global keymap that intercepts Escape would have to know about every open dialog's lifecycle — an explicit anti-pattern. The local `window.addEventListener('keydown', ...)` lives in the modal's `useEffect` and detaches on unmount; the global keymap can safely ignore Escape entirely.
   - **a.** The local Escape listener bails on `inFlight` (close-paths are gated on no-request-in-flight per the constraints). It does NOT bail on `event.target` editable-target focus — the moderator is intentionally typing in the modal's input; Escape there means "abandon and close" (when not in flight).
   - **b.** Mirror of `EditWordingSubmenu.tsx:123-132` pattern, including the `window.addEventListener('mousedown', ...)` for backdrop click detection.

6. **Defensive `.slice(0, MAX_SNAPSHOT_LABEL_LENGTH)` in the change handler in addition to the `maxLength={128}` HTML attribute.**
   - **Why.** `maxLength` is enforced by the browser for keyboard input but is bypassed by paste in some edge cases (e.g., paste from a clipboard whose content is exactly at the cap on some legacy browsers; programmatic input value sets in test harnesses). A defensive clamp in the JS handler closes the gap; mirrors the `MAX_METHODOLOGY_TEXT_LENGTH` clamp in `CaptureTextInput`'s text-area handler. Tests case `(p)` of the modal Vitest pins this.

7. **No focus trap; no focus restoration on close.**
   - **Why focus trap is omitted.** The dialog has three Tab stops (input, submit, cancel). A user tabbing past cancel returns to the input via the browser's natural focus cycle; the modal is small enough that a non-trap experience is acceptable. Implementing a proper focus trap (focusable-element discovery, Tab/Shift-Tab interception, sentinel elements) adds ~40 lines of accessibility plumbing for marginal benefit at this scale; defer to a future task if usability testing surfaces a real complaint.
   - **Why focus restoration is omitted.** The trigger paths are heterogeneous (sidebar button → focus restores naturally to the button; global Cmd+S → no meaningful prior focus to restore to). A correct implementation would have to discover which trigger fired and stash the prior `document.activeElement`; the value is marginal. The `<input>` gets focus on open (case `(b)` of the modal Vitest spec); after close, focus falls to `document.body` per browser default, which is the same behaviour Cmd+S typically produces in any other web app.
   - **Alternative rejected — adopt `react-focus-lock` or similar.** New dependency for a tiny modal; v1 doesn't pay for it.

8. **i18n: nested `errors` sub-namespace under `moderator.snapshotLabelInput`.**
   - **Why.** Four error-code-keyed messages (`moderatorOnly`, `sequenceMismatch`, `timeout`, `unknown`). Nesting under `errors` keeps the modal's namespace top level concise (seven flat keys + one nested namespace) and matches the pattern from `moderator.commitButton` / `moderator.editWordingAction` which already nest error variants.
   - The four codes match the codes the new `ws_label_snapshot_message` handler will emit. `'moderator-only'` mirrors the gate-rejection code from `ws_commit_message`; `'sequence-mismatch'` mirrors the optimistic-concurrency code; `'timeout'` is the transport-layer code from `WsRequestTimeoutError`; `'unknown'` is the catchall for unexpected errors. The wire `error.message` is rendered verbatim when no code-mapped key exists (mirrors `resolveEditWordingErrorMessage`).
   - en-US authored inline by the implementer; pt-BR + es-419 ship as `*.review.json` PENDING — established pattern.

9. **Reuse `data-snapshot-flow-open` seam; do not retire it.**
   - **Why.** `mod_snapshot_action` Decision §3 anticipated this question. The attribute remains a useful debugging aid AND a stable, non-React-poking signal for cross-cutting tests that don't want to render-assert the full modal markup. The new Playwright spec asserts BOTH the attribute and the modal's presence — redundant on purpose; either signal failing flags a regression in the wiring.
   - **Alternative rejected — retire `data-snapshot-flow-open` and assert only the modal's `data-testid`.** Removes a working seam that costs nothing to keep; the attribute is one line in `OperateLayout`.

10. **The hook calls `useSnapshotFlowStore.close()` on success; the modal does NOT.**
    - **Why.** The success-close is a CONSEQUENCE of the wire ack, not a user action. Centralising the success-close in the hook keeps the modal component purely presentational with respect to the success path (the modal only handles its own close-on-cancel / close-on-Escape / close-on-backdrop). Mirrors how `EditWordingSubmenu` reads the live store error and decides to `onClose()` from inside the submit promise (`EditWordingSubmenu.tsx:226-237`). Avoids a race where the modal's local state and the store state disagree mid-await.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- New hook `apps/moderator/src/layout/useLabelSnapshotAction.ts` — module-scoped `useLabelSnapshotStore` Zustand slice (`inFlight`, `lastError`), `submit(label)` dispatches `label-snapshot` WS message with `expectedSequence`, closes modal on ack, surfaces `WireError` on failure.
- New component `apps/moderator/src/layout/SnapshotLabelInputModal.tsx` — centered full-viewport overlay (`position: fixed inset-0 z-50`), controlled text input with `maxLength=128`, submit/cancel buttons, inline `role="alert"` error region mapping four error codes (`moderator-only`, `sequence-mismatch`, `timeout`, `unknown`), close-paths gated on `!inFlight`.
- New mount wrapper `apps/moderator/src/layout/SnapshotLabelInputMount.tsx` — subscribes to `useSnapshotFlowStore.isLabelInputOpen`, conditionally renders the modal.
- `apps/moderator/src/routes/Operate.tsx` — mounts `<SnapshotLabelInputMount />` as a sibling of `<OperateLayout>`.
- Eight new i18n keys under `moderator.snapshotLabelInput` in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; pt-BR and es-419 flagged PENDING in `*.review.json`.
- Vitest: 9 hook cases (`useLabelSnapshotAction.test.tsx`), 16-case modal suite (`SnapshotLabelInputModal.test.tsx`), 4-case mount suite (`SnapshotLabelInputMount.test.tsx`), 2 route wiring cases added to `Operate.test.tsx`.
- Playwright: Tests 3–6 added to `tests/e2e/moderator-snapshot.spec.ts` (button→submit→close, Escape→close, Cmd/Ctrl+S idempotent, backdrop→close).
- Drift resolution: `sequence-conflict` → `sequence-mismatch`, `sequenceConflict` → `sequenceMismatch` aligned to shipped backend codes.
- All four verification suites passed (`pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, `make test:e2e:compose`).
