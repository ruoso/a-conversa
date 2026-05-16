# Moderator capture-pane propose action — the multi-event submit

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_propose_action`.

```
task mod_propose_action "Propose action — emits multiple events at once" {
  effort 2d
  allocate team
  depends !mod_capture_text_input, !mod_classification_palette, !mod_edge_role_selector
}
```

## Effort estimate

**2d.** Confirmed. This is the **capstone of `mod_capture_flow`**: it
binds together the four prior leaves (`mod_capture_text_input`,
`mod_classification_palette`, `mod_target_auto_suggest` +
`mod_target_clear_override`, `mod_edge_role_selector`) into a single
moderator gesture that emits the bundle of events the propose action
specification requires. The work is component + WS round-trip + store
reset + i18n + tests on top of seams already in place:

- `<CaptureTextInput>` exposes a consumer-supplied `onSubmit` callback
  already wired to the Cmd/Ctrl+Enter gesture
  (`apps/moderator/src/layout/CaptureTextInput.tsx:58-115`); the route
  currently passes a `noopSubmit` stub
  (`apps/moderator/src/routes/Operate.tsx:57-62, 84`). This task
  replaces the stub with the real propose handler.
- `useCaptureStore` already carries the four read slices the propose
  handler reads (`text`, `classification`, `targetEntityId`,
  `edgeRole`) plus the `reset()` writer the success path calls
  (`apps/moderator/src/stores/captureStore.ts:43-91`). The store
  shape is stable; this task is the first reader of all four slices
  together.
- The propose WS message wire shape is settled: `ProposePayload =
  { sessionId, expectedSequence, proposal: ProposalPayload }`
  (`packages/shared-types/src/ws-envelope.ts:341-351`). The bundle
  this task emits is **a sequence of `propose` envelopes**, NOT a
  single envelope (see Decision §1 — the wire shape is one envelope
  per proposal sub-kind; the server's propose handler emits the
  paired `node-created` / `edge-created` / `entity-included` events
  alongside each proposal).
- The WS client surface is in place — `WsClient.send('propose',
  payload)` returns a Promise that resolves on the `proposed` ack or
  rejects with `WsRequestError` / `WsRequestTimeoutError`
  (`apps/moderator/src/ws/client.ts:419-465`).
- `useWsStore` tracks `sessionState[sessionId].lastAppliedSequence`
  per session (`apps/moderator/src/ws/wsStore.ts:47-48, 161-168`) —
  the source for the `expectedSequence` token on every propose call.
- The catalog workflow + PENDING-flag lifecycle for pt-BR / es-419
  drafts is established by every sibling capture-flow task.

Concretely the deliverable is:

- **One new component** `apps/moderator/src/layout/ProposeAction.tsx`
  — a small button + inline-error region that mounts into
  `<BottomStripCapture>`'s `proposeAction` slot. The button is
  pointer-affordance; the keyboard path (Cmd/Ctrl+Enter on the
  textarea) remains the existing gesture from `mod_capture_text_input`.
  Both paths funnel through the same handler.
- **One new hook** `apps/moderator/src/layout/useProposeAction.ts`
  — colocated with the layout components rather than inside
  `apps/moderator/src/ws/`. It reads the four capture-store slices,
  reads the current `sessionId` (from `useParams<{ id }>`) and the
  current `lastAppliedSequence` (from `useWsStore`), reads
  `useWsClient()`, and exposes `{ propose, canPropose,
  validationError, inFlight, lastError }` for the component to
  render + the wire-up site to call from `<CaptureTextInput>`'s
  `onSubmit`.
- **Provider integration**: `WsClientProvider` is currently NOT
  mounted in `apps/moderator/src/App.tsx` (the routes render
  directly under `<RequireAuth>` with no WS wrapper). This task
  introduces the mount — wrapping `<OperateRoute>` (the only route
  that drives WS today) in `<WsClientProvider>` so `useWsClient()`
  resolves. The session-id tracking
  (`client.trackSession(sessionId)`) is paired with the route mount.
  Decision §3 records the placement rationale.
- **Store-shape extension** (small): a new `proposing: boolean`
  slice + `setProposing(value)` setter on `useCaptureStore` so the
  in-flight indicator is observable from sibling components (the
  textarea may want to disable itself; this task does NOT disable
  it — Decision §5 — but the slice carries the signal for future
  consumers). The slice is reset by `reset()` automatically via
  the spread of `initialCaptureState`.
- **Coupled-reset semantics**: on propose success, the success
  branch calls `useCaptureStore.getState().reset()` — the existing
  `reset()` already returns `text` / `classification` /
  `targetEntityId` / `edgeRole` / `mode` to initial state via the
  spread of `initialCaptureState`; this task is the first caller
  of `reset()` from a non-test site (the other call sites are the
  store's own test file). The `userHasClearedRef` and
  `lastAutoStagedRef` refs inside `<CaptureTargetChip>` are NOT
  touched by `reset()` (they're component-local); the next active-node
  signal re-engages the auto-stage cleanly.
- **Validation gate** at submit time. The propose handler refuses
  to fire when the inputs are not coherent (see Decision §2 for the
  six gate rules and the inline-error surfacing strategy).
- **Vitest cases** under
  `apps/moderator/src/layout/ProposeAction.test.tsx` and
  `apps/moderator/src/layout/useProposeAction.test.tsx` (the hook
  is testable in isolation with `renderHook` against a mocked
  `useWsClient` + a real `useCaptureStore` + a real `useWsStore`).
- **One new `test()` block** extending
  `tests/e2e/moderator-capture.spec.ts` — Decision §10 locks the
  scoping: drive the full chain through the dev compose stack
  (login → create session → seed two nodes → type wording → pick
  kind → pick target+role → Cmd+Enter → assert the propose envelope
  hit the server and the resulting `event-applied` broadcast lands
  in the moderator's `useWsStore.sessionState[id].events`).
- **6 new i18n catalog keys × 3 locales = 18 new catalog entries**
  for the button chrome + inline-error strings + six validation
  prompts. Scoped under a new `moderator.proposeAction.*` namespace.
- **1 follow-up tech-debt task registered** in
  `tasks/35-frontend-i18n.tji` for the native-speaker review of the
  12 new pt-BR / es-419 draft entries
  (`i18n_propose_action_native_review`, effort 0.5d,
  `depends !i18n_edge_role_selector_native_review`).
- **One-line wire-up replacement** in
  `apps/moderator/src/routes/Operate.tsx`: replace
  `<CaptureTextInput onSubmit={noopSubmit} />` with the propose-bound
  callback (the hook's `propose` function) AND pass
  `<ProposeAction />` into `<BottomStripCapture>`'s `proposeAction`
  slot (currently empty → renders the scaffold's `[propose]`
  placeholder).
- **`WsClientProvider` mount** around the operate route (the only
  consumer in v1; Decision §3).

This task closes `mod_capture_flow` — the parent block's
`depends !mod_layout, !mod_graph_rendering,
backend.websocket_protocol.ws_propose_message` is already
satisfied; once this leaf lands, `mod_capture_flow` is complete and
the F1 capture flow is operational end-to-end for the first time.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_capture_flow.mod_capture_text_input`** (done —
  2026-05-15, commit `1499ca0`'s predecessor). Shipped the controlled
  `<textarea>` + the Cmd/Ctrl+Enter `onSubmit` callback. This task
  replaces the consumer-supplied no-op with the real propose handler.
  The textarea continues to own its keystrokes; the keymap module's
  editable-target guard already prevents collision with the
  classification / edge-role keyboard shortcuts.
- **`moderator_ui.mod_capture_flow.mod_classification_palette`** (done).
  Shipped `<ClassificationPalette>` + the `classification` slice +
  the `f` / `p` / `v` / `n` / `d` shortcuts via `captureKeymap.ts`.
  This task is the first reader of `useCaptureStore.classification`
  outside the palette itself; the slice's `StatementKind | null`
  type carries through to the bundled `classify-node` proposal
  payload's `classification` field
  (`packages/shared-types/src/events/proposals.ts:73-77`).
- **`moderator_ui.mod_capture_flow.mod_target_auto_suggest`** (done
  — 2026-05-15). Shipped `<CaptureTargetChip>` and the auto-stage
  effect against `useCaptureStore.targetEntityId`. This task reads
  the slice to decide whether to emit the edge half of the bundle;
  a `null` slice means "free-floating new node — emit `node-created`
  + `proposal: classify-node` only". A non-null slice means "emit
  the connecting bundle — add `edge-created` + `proposal:
  set-edge-substance`".
- **`moderator_ui.mod_capture_flow.mod_target_clear_override`** (done
  — 2026-05-15). Shipped the × button + `Esc` gesture and the
  coupled-clear contract (clearing target also clears edge role).
  This task inherits the coupled-clear: at submit time the slice
  state is already coherent (no role-without-target intermediate is
  possible from the UI).
- **`moderator_ui.mod_capture_flow.mod_edge_role_selector`** (done —
  2026-05-15). Shipped `<EdgeRoleSelector>` + the `edgeRole` slice
  + the seven english-mnemonic role shortcuts. This task reads
  `useCaptureStore.edgeRole` to populate the bundled `edge-created`
  payload's `role` field
  (`packages/shared-types/src/events.ts:269-278`); the role's
  english-coded id (`'supports'` / `'rebuts'` / …) writes verbatim.
- **`moderator_ui.mod_state_management`** (done —
  `apps/moderator/src/stores/captureStore.ts:43-91` declares the
  store contract this task is the first composite reader of plus
  the `reset()` writer it calls on success).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done —
  exposes the `proposeAction` render-prop slot the new button
  mounts into; `BottomStripCapture.tsx:48-49, 86-91`).
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11).
  Shipped `createWsClient` + `WsClient.send('propose', ...)` +
  `WsClientProvider` + `useWsClient()` + `useWsStore`. This task
  is the first call site of `client.send('propose', ...)` from the
  moderator UI surface; everything earlier was test-only. The
  `trackSession(sessionId)` resume seam is the integration point
  for the per-route session subscription.
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done
  — commit `05f7d67`). The operate route is reachable from a real
  user flow; the propose action is reachable from the same chain,
  which makes the Playwright e2e the non-deferred default per the
  UI-stream e2e policy.
- **`backend.websocket_protocol.ws_propose_message`** (done —
  2026-05-11). Shipped the server-side `propose` handler with the
  subscribe-before-act gate, the visibility re-check, the engine
  `validateAction` call, the `appendSessionEvent` write, the
  post-commit `proposed` ack + `event-applied` broadcast, and the
  `rejectedToApiError`-mapped error path. This task drives that
  handler from the moderator side; the wire contract is settled.
- **`backend.websocket_protocol.ws_message_envelope`** (done —
  `ProposePayload` + `ProposedPayload` types exported from
  `@a-conversa/shared-types`).
- **`backend.websocket_protocol.ws_event_broadcast`** (done — the
  `event-applied` broadcast is what the moderator's own
  `useWsStore.applyEvent` consumes after success; the proposer
  receives the broadcast alongside non-proposer subscribers per the
  dual-signal contract).
- **`data_and_methodology.event_types.proposal_events`** (done —
  the `ProposalPayload` discriminated union + the
  `classify-node` / `set-edge-substance` sub-kind schemas the
  bundle wraps).
- **`data_and_methodology.event_types.entity_creation_events`** (done
  — the `node-created` / `edge-created` schemas the propose
  handler's server-side emits alongside the proposal events; this
  task does NOT construct these payloads itself, only the
  `ProposalPayload` carrying the `node_id` / `edge_id` references).
- **`backend_hardening.resource_limits_and_dos.user_text_length_caps`**
  (done — `MAX_METHODOLOGY_TEXT_LENGTH = 10_000` exported from
  `@a-conversa/shared-types/limits`; the textarea already enforces
  the cap, and this task does NOT re-validate length client-side).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()`, the
  parity-check script, the `*.review.json` PENDING-flag lifecycle,
  the per-locale parity round-trip test pattern are all in place;
  new keys flow through the same pipeline).
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — the
  `Cmd/Ctrl+Enter` submit gesture is locale-independent per the
  policy's "non-methodology shortcuts stay as-is across locales"
  clause).
- **[ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)**
  — the schema-on-write boundary the moderator's send-path crosses
  via `serializeWsEnvelope`.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new component consumes.

Pending edges (this task does NOT depend on them; this task FEEDS them):

- **`moderator_ui.mod_pending_proposals_pane.*`** — downstream
  consumer. Reads `useWsStore.sessionState[sessionId].pendingProposals`
  (populated by the same `event-applied` broadcast this task drives).
  The pending pane's surfacing of the new proposal is what closes the
  visible feedback loop after a successful propose; that pane is its
  own subgroup of tasks (`mod_proposal_list`, `mod_per_facet_breakdown`,
  `mod_vote_indicators_in_sidebar`, `mod_commit_button`,
  `mod_proposal_filter_search`) and is NOT in scope here. This task
  simply emits the bundle; the pane reads what lands.
- **`moderator_ui.mod_capture_flow.mod_propose_action_pending_toast`**
  (future tech-debt — see Decision §5). A short-lived "Proposed at
  HH:MM:SS" toast is named here as a future follow-up; v1 ships
  optimistic clear with no toast. If the visual signal turns out
  to be load-bearing during demos, the toast lands later as a
  small follow-up task.
- **`moderator_ui.mod_capture_flow.mod_propose_action_error_toast`**
  (future tech-debt — see Decision §6). The failed-propose
  recovery animation / persistent error banner is named here as a
  future follow-up; v1 ships an inline-error region inside the
  capture pane that surfaces the wire error code + a localized
  message.
- **`moderator_ui.mod_diagnostic_flow.*`** — downstream. Diagnostic
  events emitted by the methodology engine in response to a propose
  (e.g., contradiction detection firing because the new node
  conflicts with an existing one) are surfaced by the diagnostic
  flow tasks. This task does NOT consume diagnostic frames; it
  just unblocks the engine to emit them.
- **`frontend_i18n.i18n_propose_action_native_review`** (registered
  by this task — see Acceptance criteria / Decisions). The pt-BR
  + es-419 drafts of the 6 new keys land flagged PENDING; the
  follow-up replaces them with native-speaker-reviewed text.

## What this task is

Land the moderator's deliberate "submit this in-progress capture as
a proposal on the graph" gesture. Two redundant affordances reach
the same internal handler:

1. **Cmd/Ctrl+Enter inside the capture textarea**. The gesture is
   already wired — the textarea calls a consumer-supplied
   `onSubmit` prop on the chord. This task replaces the
   `noopSubmit` stub that `<OperateRoute>` currently passes
   (`apps/moderator/src/routes/Operate.tsx:60-62, 84`) with the
   real propose handler from `useProposeAction()`.
2. **A "Propose" button** in the bottom-strip's `proposeAction`
   slot. Tabbable, click + touch + Enter reachable. Carries a
   localized label + aria-label + a visible `Cmd+Enter` chord hint
   (the same `<kbd>` chip pattern the classification palette and
   edge-role selector use for shortcut discovery).

Both gestures call the same `propose()` function returned by the
hook. The hook:

1. **Reads** the four capture-store slices (`text`, `classification`,
   `targetEntityId`, `edgeRole`), the URL session id (via
   `useParams<{ id: string }>`), the current
   `sessionState[sessionId].lastAppliedSequence` from
   `useWsStore`, and the `WsClient` instance from
   `useWsClient()`.

2. **Validates** the in-progress draft against the six gate rules
   (Decision §2). On failure, sets `validationError` to the
   localized message key + the offending field tag and returns
   without firing the WS round-trip. The inline-error region in
   `<ProposeAction>` renders the message.

3. **Generates** the client-side `node_id` UUID v4 (and, when
   connecting, the `edge_id` UUID v4) so the in-progress
   proposal can reference its own newly-created entities. The
   server's append path treats client-generated ids as the
   canonical primary keys for the `nodes` / `edges` rows the
   paired `node-created` / `edge-created` events create.

4. **Constructs** the propose bundle — one `propose` envelope per
   proposal sub-kind. The free-floating case emits one envelope
   (`classify-node`); the connecting case emits two envelopes in
   sequence (`classify-node` then `set-edge-substance`). The
   wire-shape rationale is in Decision §1.

5. **Optimistically clears** the capture store via
   `useCaptureStore.getState().reset()` BEFORE the first WS round-trip
   resolves (Decision §4). The moderator's next keystroke
   immediately begins a new in-progress draft; the prior propose
   is in flight against the server.

6. **Sends** each envelope through `client.send('propose', payload)`
   sequentially (awaiting the `proposed` ack between sends so the
   server-side `expectedSequence` token advances coherently —
   Decision §1). Each ack updates the local `lastAppliedSequence`
   via the same `event-applied` broadcast subscriber the WS client
   already runs against `useWsStore`; the second envelope's
   `expectedSequence` reads the post-first-broadcast value.

7. **Handles errors** per Decision §6: on `WsRequestError` /
   `WsRequestTimeoutError` the hook restores the capture-store
   slices from the in-memory snapshot it took before the
   optimistic clear, surfaces a localized error message inline,
   and logs the error code. The moderator can edit the restored
   draft and retry. The error region uses the wire-code error
   message from the server when available.

8. **Does NOT** emit any non-propose events directly. The propose
   handler is the only WS write surface this task drives; the
   server-side propose handler emits the paired `node-created`,
   `entity-included`, and (optionally) `edge-created` events
   inline (per `docs/moderator-ui.md:46` F1 step 4 — the
   "several events at once" specification means several events
   land on the server, not several envelopes on the wire).
   See Decision §1 for the cross-check.

The task is the **first WS write surface** the moderator UI drives.
Every prior moderator-UI task either reads server state (via
`useWsStore`) or stages local form state (via `useCaptureStore`);
this task is the bridge from local form state to server-side
event log.

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_capture_flow` cannot close without it.** The parent task
   `mod_capture_flow` is open while any leaf is incomplete
   (`tasks/30-moderator-ui.tji:258-294`). The other five leaves
   are done (`complete 100` on each); this is the last one. Closing
   it closes the F1 capture flow, which is the headline
   user-facing flow the M4 milestone (`m_moderator_mvp`) gates on.
2. **The propose gesture is the F1 capture flow's payoff.** Per
   `docs/moderator-ui.md:39-50`: F1 step 1 is type-wording, step 2
   is pick-classification, step 3 is pick-target+role, step 4 is
   *"Propose. A capture proposal lands several events at once:
   `node-created` (global), `entity-included` (in session),
   `proposal: classify-node`, plus optionally `edge-created`,
   `entity-included`, `proposal: set-edge-substance` if
   connecting. The graph shows the new node and edge in
   `proposed` state. The pending-proposals pane fills in."* The
   five prior leaves staged the inputs; this task fires the
   action. Without this task, the moderator's keystrokes never
   reach the server — the capture pane is a write-only sketchpad
   that talks to no one.
3. **The first WS write surface unblocks every downstream
   write-driving flow.** `mod_pending_proposals_pane.mod_commit_button`
   needs the propose-bundle to land first (you commit something
   that's been proposed); `mod_meta_move_flow`, `mod_diagnostic_flow`,
   and `mod_axiom_mark_decoration` all depend on the propose
   action being the canonical write-path pattern they mirror.
   Landing the WS-write skeleton here means each future write
   task adds one envelope type rather than re-inventing the
   gate + reset + error-handling shape.

Downstream, every flow that mutates the graph (commit, vote,
mark-meta-disagreement, decompose, axiom-mark, defeater) follows
the same skeleton: read slices, validate, generate client-side
ids if needed, build the envelope, send via `client.send(...)`,
handle ack + error. This task pins the skeleton.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- `apps/moderator/src/layout/CaptureTextInput.tsx:58-115` — the
  `onSubmit` callback this task wires into. The textarea calls
  `onSubmit?.()` on Cmd/Ctrl+Enter; no other gesture fires it.
  Unchanged by this task.
- `apps/moderator/src/routes/Operate.tsx:30-93` — the integration
  site. The current `<CaptureTextInput onSubmit={noopSubmit} />`
  changes to `<CaptureTextInput onSubmit={handleSubmit} />`
  where `handleSubmit` is the hook's `propose` function. The
  current `<BottomStripCapture ... />` (without `proposeAction`)
  changes to add `proposeAction={<ProposeAction />}`. The route
  wraps in `<WsClientProvider auth={auth}>` so `useWsClient()`
  resolves — see Decision §3.
- `apps/moderator/src/stores/captureStore.ts:43-91` — the store
  contract. This task adds two fields:
  ```ts
  /** True while a propose round-trip is in flight; observable from
   *  sibling components so they can de-emphasize the inputs
   *  during the round-trip. v1 does NOT disable the inputs
   *  (Decision §5); the slice carries the signal for future
   *  consumers (toast surface, retry banner). */
  proposing: boolean;
  setProposing: (value: boolean) => void;
  ```
  to `CaptureState`, plus `proposing: false` to
  `initialCaptureState`, plus `setProposing: (proposing) => set({
  proposing })` to the store factory. The `reset()` already spreads
  `initialCaptureState`, so it returns `proposing` to `false`
  automatically.
- `apps/moderator/src/layout/BottomStripCapture.tsx:48-49, 86-91` —
  the scaffold exposes the `proposeAction` render-prop slot with
  the stable `bottom-strip-propose-action` testid. Unchanged by
  this task; the new `<ProposeAction>` mounts into the slot.
- `apps/moderator/src/layout/captureKeymap.ts:67-92` — the
  document-level `keydown` plumbing. This task does NOT add a new
  `onSubmit?: () => void` field to `CaptureKeymapHandlers` —
  Cmd/Ctrl+Enter is handled directly by the textarea (where focus
  almost always is during capture; see Decision §7 for the
  rationale against a document-level submit binding).
- `apps/moderator/src/ws/client.ts:419-465` — the typed
  `WsClient.send('propose', payload)` surface. Returns a Promise
  that resolves with the `proposed` ack envelope or rejects with
  `WsRequestError(ErrorPayload)` / `WsRequestTimeoutError(type, id)`.
- `apps/moderator/src/ws/wsStore.ts:78-185` — the
  `sessionState[sessionId].lastAppliedSequence` field this task
  reads for the `expectedSequence` token. The store is the
  canonical source-of-truth; the WS client's `applyEvent`
  reducer enforces the dedupe-by-sequence rule.
- `apps/moderator/src/ws/WsClientProvider.tsx:37-85` — the provider
  this task mounts. The provider accepts `auth: { status }` from
  the consumer; the operate route already has `useAuth()`
  accessible via `<RequireAuth>` higher up — Decision §3 records
  the placement: mount the provider INSIDE `<OperateRoute>` after
  the `<RequireAuth mode="authenticated-only">` gate so the
  `auth.status === 'authenticated'` precondition is guaranteed
  by the surrounding route guard.
- `apps/moderator/src/auth/useAuth.ts:64-70` — the `UseAuthResult`
  shape the provider consumes.
- `packages/shared-types/src/ws-envelope.ts:341-370` — the
  `propose` / `proposed` payload schemas this task constructs and
  consumes.
- `packages/shared-types/src/events/proposals.ts:68-79` — the
  `classifyNodeProposalSchema` this task constructs for the
  classification half of the bundle. Wire shape:
  `{ kind: 'classify-node', node_id: UUID, classification: StatementKind }`.
- `packages/shared-types/src/events/proposals.ts:93-104` — the
  `setEdgeSubstanceProposalSchema` this task constructs for the
  edge-substance half when connecting. Wire shape:
  `{ kind: 'set-edge-substance', edge_id: UUID, value: 'agreed' | 'disputed' }`.
- `packages/shared-types/src/events.ts:255-278` — the
  `nodeCreatedPayloadSchema` and `edgeCreatedPayloadSchema` the
  server's propose handler emits inline; this task does NOT
  construct these payloads (the wire flows `propose` envelopes
  whose `proposal` payload references the client-generated
  `node_id` / `edge_id`; the server's append path constructs the
  paired creation events from those references).
- `tests/e2e/moderator-capture.spec.ts:1-550` — the sibling spec
  the new propose-action e2e block joins. Extended by every prior
  capture-flow task; the file is the canonical regression home
  for the capture flow.
- `tests/e2e/fixtures/wsStoreSeed.ts:77-167` — the seeded-graph
  helper (`seedWsStore`) the new e2e block reuses for the
  connecting-bundle scenario (seed two nodes, click one to
  auto-suggest, type + classify + role + Cmd+Enter, assert the
  bundle landed).
- `tests/e2e/fixtures/auth.ts` — `loginAs(page, { username })`.
  Unchanged by this task; the new e2e reuses it.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — the catalog
  file the new `moderator.proposeAction.*` namespace lands in,
  sibling to the existing `moderator.captureTextInput.*`,
  `moderator.classificationPalette.*`,
  `moderator.captureTargetChip.*`, `moderator.edgeRolePalette.*`
  blocks.

DESIGN.md / docs consulted:

- `DESIGN.md:16-20` — *"One moderator, who is the sole operator
  of the structuring tool."* / *"All participants — both
  debaters and the moderator — must agree on every change to the
  graph before it lands."* The propose action is the moderator's
  channel for initiating that agreement loop.
- `DESIGN.md:43` — i18n constraint: *"Participant-supplied
  content — statement wordings on nodes — is **not** translated;
  it stays in whatever language the participants spoke."* The
  propose action sends the wording verbatim; only the button
  chrome (label, aria-label, error messages) is localized.
- `docs/moderator-ui.md:39-50` — F1 capture-flow specification.
  Step 4 names the event bundle this task's server-side
  counterpart emits.
- `docs/moderator-ui.md:185-204` — Keyboard shortcuts sketch.
  `Cmd+Enter` — *"propose (commit the current capture as a
  proposal on the graph)"*. The canonical shortcut spec.
- `docs/moderator-ui.md:222` — *"Default attachment behavior —
  auto-suggest the most-recently-active node as target, with a
  one-gesture clear override. Captured in F1."* — confirms the
  capture flow's settled design points.
- `docs/ws-protocol.md` — canonical wire spec; covers the
  envelope shape, the `propose` / `proposed` correlation, the
  dual-signal contract, the error vocabulary, the reconnection
  / catch-up flow.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
- `tasks/refinements/moderator-ui/mod_capture_text_input.md` —
  Decision §4 (Cmd/Ctrl+Enter submit gesture) and the
  consumer-supplied `onSubmit` callback this task replaces.
- `tasks/refinements/moderator-ui/mod_classification_palette.md` —
  the `classification` slice this task reads.
- `tasks/refinements/moderator-ui/mod_target_auto_suggest.md` /
  `tasks/refinements/moderator-ui/mod_target_clear_override.md` —
  the `targetEntityId` slice + the coupled-clear contract.
- `tasks/refinements/moderator-ui/mod_edge_role_selector.md` —
  the `edgeRole` slice + the coupled-clear contract.
- `tasks/refinements/moderator-ui/mod_state_management.md` — the
  store contract this task is the first composite reader of.
- `tasks/refinements/moderator-ui/mod_ws_client.md` — the WS client
  surface this task is the first non-test consumer of.
- `tasks/refinements/backend/ws_propose_message.md` — the
  server-side propose handler this task drives.
- `tasks/refinements/backend/ws_message_envelope.md` — the
  closed-union envelope shape.
- `tasks/refinements/data-and-methodology/proposal_events.md` —
  the proposal sub-kind discriminated union.
- `tasks/refinements/data-and-methodology/entity_creation_events.md`
  — the paired `node-created` / `edge-created` events the server
  emits alongside each propose envelope.
- `tasks/refinements/data-and-methodology/event_base_envelope.md`
  — the persisted-event envelope shape.
- `tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md`
  — the english-mnemonic / locale-independent shortcut policy
  the `Cmd/Ctrl+Enter` submit gesture inherits.

No new ADR is required (see Decisions §11); no new external
runtime dependency lands; the public type signatures the task
touches are limited to the two new fields on `CaptureState`
(`proposing`, `setProposing`) and the new `<ProposeAction>`
component's prop interface (no props in v1; the component reads
everything from hooks). No cross-workspace contract changes; no
data-model touch (the propose envelope and its proposal-payload
shape are already settled by the four upstream tasks).

## Constraints / requirements

### Component shape — `<ProposeAction>`

- **New file** `apps/moderator/src/layout/ProposeAction.tsx`
  exporting `function ProposeAction(): ReactElement` (named
  export, no default).
- **Single root element** wrapping a `<div role="group" ...>`
  with the button + inline error region inside. The consumer
  drops the component directly into `<BottomStripCapture>`'s
  `proposeAction` slot.
- **Stable test ids**:
  - `propose-action` — outer wrapper element.
  - `propose-action-button` — the click-to-submit button.
  - `propose-action-key-chip` — the `<kbd>` chip next to the
    button label showing `Cmd+Enter` (or `Ctrl+Enter` on
    non-darwin; see Decision §8).
  - `propose-action-validation-error` — inline error region for
    validation-failed messages (visible only when
    `validationError !== null`).
  - `propose-action-wire-error` — inline error region for
    server-side wire errors after a round-trip (visible only when
    `lastError !== undefined`).
- **No props.** The component reads everything from hooks
  (`useProposeAction()`).

### Hook shape — `useProposeAction()`

- **New file** `apps/moderator/src/layout/useProposeAction.ts`
  exporting `function useProposeAction(): UseProposeActionResult`.
- **Return shape**:
  ```ts
  export interface UseProposeActionResult {
    /** Trigger the propose round-trip. Idempotent during the in-flight window. */
    propose: () => Promise<void>;
    /** True when all six gates pass and the button should be enabled. */
    canPropose: boolean;
    /** The localized message-key + field-tag of the failing gate, or null. */
    validationError: ValidationErrorReason | null;
    /** True while a propose round-trip is in flight. */
    inFlight: boolean;
    /** The wire error code + localized message from the last failed propose, or undefined. */
    lastError: WireError | undefined;
  }
  export type ValidationErrorReason =
    | 'text-empty'
    | 'classification-missing'
    | 'role-without-target'
    | 'target-without-role'
    | 'session-missing'
    | 'not-connected';
  export interface WireError {
    /** Engine rejection code or transport error code. */
    code: string;
    /** Localized message from the wire (when the server provided one) or a
     *  fallback for transport errors. */
    message: string;
  }
  ```
- **Store reads** (each as a separate `useCaptureStore(selector)`
  subscription so React re-renders the consumer only when the
  relevant slice changes):
  ```ts
  const text = useCaptureStore((s) => s.text);
  const classification = useCaptureStore((s) => s.classification);
  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const edgeRole = useCaptureStore((s) => s.edgeRole);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);
  const resetCapture = useCaptureStore((s) => s.reset);
  ```
- **Other reads**:
  ```ts
  const { id: sessionId = '' } = useParams<{ id: string }>();
  const lastAppliedSequence = useWsStore(
    (s) => s.sessionState[sessionId]?.lastAppliedSequence ?? 0,
  );
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const client = useWsClient();
  ```

### Validation gate (six rules, in order)

Decision §2 records the rationale; the rule body lives in the
hook:

```ts
function validate(): ValidationErrorReason | null {
  if (sessionId === '') return 'session-missing';
  if (connectionStatus !== 'open') return 'not-connected';
  if (text.trim().length === 0) return 'text-empty';
  if (classification === null) return 'classification-missing';
  if (targetEntityId !== null && edgeRole === null) return 'target-without-role';
  if (edgeRole !== null && targetEntityId === null) return 'role-without-target';
  return null;
}
```

- `session-missing` — the URL didn't provide a session id (the
  router has not mounted yet or the route is wrong). Defensive;
  unreachable in normal flow.
- `not-connected` — the WS client is not in the `'open'`
  status. The propose button is disabled in this state and the
  inline error reads `"Cannot propose — WebSocket disconnected.
  Reconnecting…"`. The gate prevents a `send()` that would
  reject with `"cannot send propose: socket not open"`
  (`client.ts:430`).
- `text-empty` — the trimmed wording is empty. The button is
  disabled when this fires.
- `classification-missing` — no kind has been picked. The
  button is disabled when this fires.
- `target-without-role` / `role-without-target` — the
  coupled-clear contract from `mod_target_clear_override` and
  `mod_edge_role_selector` makes the second branch unreachable
  in normal flow (clearing target clears role); the first
  branch is reachable when the moderator stages a target via
  auto-suggest then never picks a role. The gate forces an
  explicit role pick before the connecting bundle goes out.
- Methodology validation (is the wording a coherent statement?
  is the proposed classification right for the wording? is the
  target node still visible in the projection?) is the engine's
  responsibility, NOT this task's. The server returns
  `RejectedValidationResult` on engine rejection; the hook
  surfaces the wire-code error in `lastError`.

### Client-side id generation

UUIDs are minted client-side via `crypto.randomUUID()` (already in
use by `ws/client.ts:220`). The hook generates:

- **`node_id`** for the new statement node. Used in the
  `classify-node` proposal payload's `node_id` field
  (`packages/shared-types/src/events/proposals.ts:73-77`). The
  server's propose handler creates the paired `node-created`
  event with the same `node_id` so the canonical `nodes` row's
  primary key matches the proposal's reference.
- **`edge_id`** when `targetEntityId !== null`. Used in the
  `set-edge-substance` proposal payload's `edge_id` field
  (`packages/shared-types/src/events/proposals.ts:98-104`). The
  server's propose handler creates the paired `edge-created`
  event with the same `edge_id`.

The hook holds these ids in scope through the round-trip so the
second envelope (set-edge-substance) references the first
envelope's `edge_id`. The ids are NOT held in the capture store
(they're per-propose-call; a fresh propose mints fresh ids). They
ARE durable across the optimistic-clear boundary (Decision §4).

### Wire-shape — sequential envelopes, NOT a single bundle envelope

Per Decision §1, this task emits **one `propose` envelope per
proposal sub-kind**:

- **Free-floating case** (no target staged): one envelope.
  ```json
  {
    "type": "propose",
    "id": "<client-uuid>",
    "payload": {
      "sessionId": "<URL session id>",
      "expectedSequence": <lastAppliedSequence-at-call-time>,
      "proposal": {
        "kind": "classify-node",
        "node_id": "<client-minted-node-uuid>",
        "classification": "<StatementKind>"
      }
    }
  }
  ```
  The server's propose handler emits four events on success:
  `node-created` (the new node row), `entity-included` (link to
  this session), `proposal` (the `classify-node` proposal),
  and an implicit `entity-included` for the proposal itself (per
  the propose handler's existing implementation — this task does
  NOT verify the server's emission order; that's pinned by
  `ws_propose_message`'s Vitest + Cucumber suites).

- **Connecting case** (target + role staged): two envelopes,
  sequential. After the first ack updates the local
  `lastAppliedSequence`, the second envelope reads the new
  high-water mark for its `expectedSequence`:
  ```json
  // Envelope 1 — same as the free-floating case above.
  // Envelope 2 — fired after Envelope 1's `proposed` ack arrives.
  {
    "type": "propose",
    "id": "<client-uuid>",
    "payload": {
      "sessionId": "<URL session id>",
      "expectedSequence": <lastAppliedSequence after first ack>,
      "proposal": {
        "kind": "set-edge-substance",
        "edge_id": "<client-minted-edge-uuid>",
        "value": "agreed"
      }
    }
  }
  ```
  The server's second propose handler call emits
  `edge-created` (the new edge row, referencing `targetEntityId`
  as the target and the client-minted `node_id` as the source)
  + `entity-included` + `proposal: set-edge-substance` (the
  edge-substance proposal). The role field on the
  `edge-created` payload is populated from the client's
  `edgeRole` slice via the server's propose handler's existing
  edge-creation path (per `ws_propose_message`'s implementation
  reading the action's referenced edge_id and constructing the
  paired creation event with the staged role).

The "several events at once" phrasing in
`docs/moderator-ui.md:46` refers to the **server-side event
emission** (multiple persisted events per propose handler call);
the wire vocabulary remains one `propose` envelope per proposal
sub-kind. Decision §1 records the alternatives surveyed and
rejected.

### Optimistic clear semantics (Decision §4)

The hook captures a snapshot of the four capture-store slices
BEFORE clearing. On any error path, the snapshot is restored:

```ts
const snapshot = {
  text,
  classification,
  targetEntityId,
  edgeRole,
};
setProposing(true);
resetCapture();
try {
  await sendBundle();
  setProposing(false);
} catch (err) {
  // Restore the snapshot — the moderator can fix and retry.
  useCaptureStore.setState({
    text: snapshot.text,
    classification: snapshot.classification,
    targetEntityId: snapshot.targetEntityId,
    edgeRole: snapshot.edgeRole,
    proposing: false,
  });
  // Surface the error.
  setLastError(toWireError(err));
}
```

The snapshot is the in-memory `snapshot` const above; it does NOT
persist across page reloads (the moderator can retry within the
same page-load but not across a hard refresh — Decision §4
records the rationale: a hard refresh during a failed propose is
already a non-recoverable scenario because the WS connection
itself is gone).

### Error handling (Decision §6)

The hook surfaces wire errors as inline messages, NOT as toasts
or modals:

- `WsRequestError(payload)` — the server returned a typed
  `error` envelope correlated to the propose request. The hook
  reads `payload.code` (the engine's `RejectionReason` or the
  transport-layer code like `'forbidden'`) + `payload.message`
  (the server's localized-or-not message) and writes them to
  `lastError`. The inline region renders
  `t('moderator.proposeAction.wireError', { code, message })` —
  the localized template wraps the wire message verbatim
  (Decision §6 records: do NOT re-localize the message; the
  server's message is authoritative because some engine
  rejections carry per-rejection detail that cannot be looked up
  from a fixed key catalog).
- `WsRequestTimeoutError(type, id)` — the request timed out
  (default 10s; see `client.ts:174`). The hook surfaces the
  localized message
  `t('moderator.proposeAction.timeoutError')` reading
  `"The propose request timed out. Check your connection and try again."`.
- Any other `Error` — surfaces as
  `t('moderator.proposeAction.unknownError', { message: err.message })`.

The error region is dismissed on the next successful propose OR
on the next user-modification of the capture inputs (typing into
the textarea, picking a classification, etc.). Decision §6
records the dismissal rule.

### In-flight state surfacing (Decision §5)

The hook's `inFlight` boolean drives:

- **The button's `disabled` attribute** — disabled during the
  round-trip so a double-click does not fire a duplicate.
- **The button's visible label** — switches from
  `t('moderator.proposeAction.label')` ("Propose") to
  `t('moderator.proposeAction.inFlightLabel')` ("Proposing…")
  with a small spinner glyph.
- **The textarea is NOT disabled**. The moderator may already
  be typing the next statement; disabling the textarea would
  steal focus and break the chain. Decision §5 records the
  trade-off — v1 ships optimistic clear with no input disable;
  the `inFlight` slice is the signal future surfaces (toast,
  retry banner) consume.

### Provider mount (Decision §3)

The `WsClientProvider` mounts INSIDE `<OperateRoute>` (the only
WS-driving route in v1), AFTER the `<RequireAuth
mode="authenticated-only">` gate higher up in
`App.tsx`. The route grows from:

```tsx
export function OperateRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  return (
    <main data-testid="route-operate">
      ...
    </main>
  );
}
```

to:

```tsx
export function OperateRoute(): ReactElement {
  const auth = useAuth();
  const { id = '' } = useParams<{ id: string }>();
  return (
    <WsClientProvider auth={auth}>
      <OperateRouteInner sessionId={id} />
    </WsClientProvider>
  );
}

function OperateRouteInner(props: { sessionId: string }): ReactElement {
  const client = useWsClient();
  useEffect(() => {
    if (props.sessionId === '') return;
    void client.trackSession(props.sessionId);
    return () => {
      void client.untrackSession(props.sessionId);
    };
  }, [client, props.sessionId]);
  // ... existing layout composition ...
}
```

The provider's lifecycle (`useEffect` opens the socket on
`auth.status === 'authenticated'`) is the integration seam; the
`trackSession` paired call inside `OperateRouteInner` subscribes
to the current session so the server's `event-applied` broadcast
post-propose lands in `useWsStore.sessionState[sessionId]`. The
unsubscribe on unmount keeps the server's subscription registry
clean.

### Tailwind styling

Adopt the same secondary-surface vocabulary the other capture
components use. The button is the primary action — slightly more
prominent than the classification / edge-role buttons:

```
inline-flex items-center gap-1 rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 hover:border-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50
```

Inline error regions:

```
mt-1 text-xs text-red-700
```

`<kbd>` chip (the `Cmd+Enter` hint):

```
ml-0.5 rounded border border-current bg-white/20 px-1 text-[0.65rem] font-semibold leading-none opacity-90
```

WCAG AA contrast: white-on-blue-700 ≈ 9.85:1; red-700 on white
(error region) ≈ 8.24:1; both pass.

### Accessibility

- The button is a native `<button type="button">` with a
  programmatic label (via the visible text + aria-label).
- `aria-disabled` is set when the button is disabled (mirrors
  the native `disabled` attribute; some screen readers prefer
  one over the other — both for portability).
- The inline error region has `role="alert"` so screen readers
  announce wire-error messages when they first appear. The
  validation-error region has `role="status"` (less urgent —
  it's informational about what's blocking submit, not a
  failure-after-action).
- The `<kbd>` chip is `aria-hidden="true"` so screen readers
  don't read the literal `Cmd+Enter` glyph; the keyboard
  shortcut is also available in the help-overlay (future task).
- Focus management: when the wire-error region appears, focus
  does NOT move to it (the moderator was just at the
  textarea/button; focus stealing would disrupt the recovery
  flow). The screen reader's `role="alert"` announcement is the
  surfacing mechanism.

### i18n catalog keys

Six new keys under a new `moderator.proposeAction.*` sub-area.
Naming follows the precedent (`moderator.classificationPalette.*`,
`moderator.captureTextInput.*`, `moderator.captureTargetChip.*`,
`moderator.edgeRolePalette.*`): component-named sub-area.

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.proposeAction.label` | "Propose" | "Propor" | "Proponer" |
| `moderator.proposeAction.inFlightLabel` | "Proposing…" | "Propondo…" | "Proponiendo…" |
| `moderator.proposeAction.ariaLabel` | "Propose the in-progress capture as a proposal on the graph" | "Propor a captura em andamento como uma proposta no grafo" | "Proponer la captura en curso como propuesta en el grafo" |
| `moderator.proposeAction.validationError` | "Cannot propose: {reason}" | "Não foi possível propor: {reason}" | "No se puede proponer: {reason}" |
| `moderator.proposeAction.wireError` | "Propose failed: {message} ({code})" | "Falha ao propor: {message} ({code})" | "Falló la propuesta: {message} ({code})" |
| `moderator.proposeAction.timeoutError` | "The propose request timed out. Check your connection and try again." | "A solicitação de proposta expirou. Verifique sua conexão e tente novamente." | "La solicitud de propuesta expiró. Verifica tu conexión y vuelve a intentarlo." |

Per-reason localized strings for the `{reason}` ICU interpolation:

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.proposeAction.reason.textEmpty` | "type the wording first" | "digite o texto primeiro" | "escribe el enunciado primero" |
| `moderator.proposeAction.reason.classificationMissing` | "pick a classification (F / P / V / N / D)" | "escolha uma classificação (F / P / V / N / D)" | "elige una clasificación (F / P / V / N / D)" |
| `moderator.proposeAction.reason.targetWithoutRole` | "pick an edge role (S / R / Q / B / G / E / X) for the staged target — or press Esc to drop the target" | "escolha um papel de aresta (S / R / Q / B / G / E / X) para o alvo selecionado — ou pressione Esc para remover o alvo" | "elige un rol de enlace (S / R / Q / B / G / E / X) para el objetivo seleccionado — o presiona Esc para quitar el objetivo" |
| `moderator.proposeAction.reason.roleWithoutTarget` | "an edge role is selected but no target — click a node or press Esc to clear the role" | "um papel de aresta está selecionado mas não há alvo — clique em um nó ou pressione Esc para limpar o papel" | "hay un rol de enlace seleccionado pero no hay objetivo — haz clic en un nodo o presiona Esc para limpiar el rol" |
| `moderator.proposeAction.reason.notConnected` | "the session is not connected — reconnecting…" | "a sessão não está conectada — reconectando…" | "la sesión no está conectada — reconectando…" |
| `moderator.proposeAction.reason.sessionMissing` | "no session is loaded" | "nenhuma sessão carregada" | "no hay sesión cargada" |

**Total count: 6 chrome keys + 6 reason keys = 12 keys × 3
locales = 36 catalog entries**. The pt-BR + es-419 drafts (24
entries) land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json` (same pattern as the predecessors). The
en-US is authoritative.

The shortcut chord glyph (`Cmd+Enter` / `Ctrl+Enter`) on the
`<kbd>` chip is **not localized** (per
`i18n_keyboard_shortcuts_policy`'s "non-methodology shortcuts
stay as-is across locales" clause). The component renders the
glyph via a platform-detection branch (`process.platform` is
not available in the browser — the component uses
`navigator.platform` or the
`navigator.userAgentData?.platform` modern equivalent; see
Decision §8).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/ProposeAction.tsx` (new — the
  button + error-region component).
- `apps/moderator/src/layout/ProposeAction.test.tsx` (new —
  Vitest cases).
- `apps/moderator/src/layout/useProposeAction.ts` (new — the
  hook).
- `apps/moderator/src/layout/useProposeAction.test.tsx` (new —
  Vitest cases for the hook in isolation).
- `apps/moderator/src/stores/captureStore.ts` (modified — add
  `proposing: boolean` slice + `setProposing(value)` setter +
  initial state extension).
- `apps/moderator/src/stores/stores.test.tsx` (modified — add
  a `setProposing` mutation smoke case).
- `apps/moderator/src/routes/Operate.tsx` (modified — replace
  the `noopSubmit` stub with the hook-bound propose callback;
  add `<ProposeAction />` to the `proposeAction` slot; wrap
  the route in `<WsClientProvider auth={useAuth()}>`; add the
  inner-component split with the `trackSession` /
  `untrackSession` lifecycle).
- `apps/moderator/src/routes/Operate.test.tsx` (modified —
  update the existing route test to wire the WS provider with
  a stub `client` so the route renders under the provider
  without spinning up a real socket; OR add a new test file
  for the propose-action integration that mounts the inner
  component directly).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified —
  add `moderator.proposeAction.{label, inFlightLabel,
  ariaLabel, validationError, wireError, timeoutError,
  reason.*}`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified
  — PENDING entries for the 12 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified
  — same).
- `tests/e2e/moderator-capture.spec.ts` (modified — add one
  new `test()` block joining the existing four).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_propose_action` lands
  at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_propose_action_native_review` task to
  `tasks/35-frontend-i18n.tji` per the tech-debt registration
  policy. The parent `mod_capture_flow` block does NOT need
  `complete 100` itself — TaskJuggler infers parent completion
  from all-children-complete, per the README's parent-vs-leaf
  convention. (M4 milestone propagation is per-milestone, not
  per-parent.)
- `docs/adr/` — no new ADR. ADR 0021 already pinned the
  envelope-on-write boundary; ADR 0022 the test discipline; ADR
  0024 the i18n architecture; `mod_state_management` the store
  contract; `ws_propose_message` the wire shape;
  `i18n_keyboard_shortcuts_policy` the locale-independent
  shortcut policy. This task is the UI binding for the existing
  decisions.
- `apps/moderator/src/ws/client.ts` — the `WsClient` surface
  is consumed unchanged; `send('propose', payload)` is already
  the typed call.
- `apps/moderator/src/ws/wsStore.ts` — `lastAppliedSequence`
  is read; the store is not extended.
- `apps/moderator/src/layout/CaptureTextInput.tsx` — the
  `onSubmit` callback is consumed unchanged; this task replaces
  the consumer-supplied no-op without touching the component.
- `apps/moderator/src/layout/captureKeymap.ts` — the keymap
  is NOT extended with `onSubmit` (Decision §7 — the textarea
  owns the gesture; document-level binding would conflict with
  text-editor focus semantics).
- `apps/moderator/src/layout/CaptureTargetChip.tsx` /
  `EdgeRoleSelector.tsx` / `ClassificationPalette.tsx` — store
  reads are unchanged; the propose handler reads the same
  slices and resets them via the existing `reset()` call.
- `apps/server/src/` — no server-side change. The propose
  handler is shipped by `ws_propose_message`.
- `packages/shared-types/` — no schema change; the propose
  payload and proposal-payload discriminated union are settled
  by `ws_propose_message` and `proposal_events`.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test
  count rises by the new `ProposeAction.test.tsx`,
  `useProposeAction.test.tsx`, and `stores.test.tsx` cases
  (≥ 14 new).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the
  parity-check) green after the catalog edits.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green against a freshly
  brought-up dev compose stack; the new propose-action scenario
  in `tests/e2e/moderator-capture.spec.ts` passes against the
  real server.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  the Closer adds `complete 100` on `mod_propose_action` AND
  the new `i18n_propose_action_native_review` task block.

### UI-stream e2e scoping

The propose action is reachable from a real user flow as of
the entire predecessor chain (`mod_create_session_form` →
`/sessions/<id>/operate` → all five capture-pane leaves
shipped). The Playwright e2e is **scoped under Acceptance
criteria, NOT deferred**, per the UI-stream e2e policy default.

**Decision §10 picks option (b)** — drive the real dev compose
stack rather than mocking the WS boundary. The compose stack
is already up for the predecessor specs (login + create-session
chain works against the real server today); extending it with
the propose round-trip is the natural next step. The Playwright
spec asserts the full chain: type → classify → target+role →
Cmd+Enter → propose envelope hits server → `event-applied`
broadcast lands in `useWsStore.sessionState[id].events` → the
capture pane clears. The pending-proposal pane is not in this
task's surface (it's the future `mod_pending_proposals_pane`
subgroup); the e2e reads the WsStore directly as the
realistic-but-bounded server-side-event landed proof.

## Acceptance criteria

### 1. The `<ProposeAction>` component renders inside the bottom-strip slot

- `<ProposeAction>` component under
  `apps/moderator/src/layout/ProposeAction.tsx` renders a
  `<div role="group" data-testid="propose-action">` containing a
  `<button data-testid="propose-action-button">` with a
  `<kbd data-testid="propose-action-key-chip">` chord chip.
- The button is reachable via
  `screen.getByRole('button', { name: /Propose/ })`.
- `OperateRoute` passes `<ProposeAction />` into
  `<BottomStripCapture>`'s `proposeAction` prop. The scaffold's
  `[propose]` placeholder is no longer rendered through the
  route; the scaffold-only `BottomStripCapture.test.tsx` cases
  continue to assert the placeholder for the empty-scaffold render
  path.

### 2. The `<CaptureTextInput>` `onSubmit` callback fires the propose hook

- `OperateRoute` passes the hook's `propose` function (NOT
  `noopSubmit`) to `<CaptureTextInput>`'s `onSubmit` prop.
- Driving Cmd+Enter inside the textarea invokes the hook's
  `propose()` (asserted via spy in the route test).
- The same `propose()` is invoked by clicking the
  `propose-action-button`.

### 3. Validation gate (six rules)

- With empty text, the button has `disabled` attribute set;
  `aria-disabled="true"`; the validation-error region renders
  the localized `text-empty` reason.
- With non-empty text but no classification, the button is
  disabled and the validation-error region reads the
  `classification-missing` reason.
- With text + classification but `targetEntityId !== null` and
  `edgeRole === null`, the button is disabled and the
  validation-error region reads the `target-without-role` reason.
- With text + classification + `targetEntityId === null` and
  `edgeRole === null`, the button is enabled (free-floating case)
  and no validation-error region renders.
- With text + classification + both target and role set, the
  button is enabled (connecting case) and no validation-error
  region renders.
- With `connectionStatus !== 'open'`, the button is disabled and
  the validation-error region reads the `not-connected` reason.

### 4. Free-floating propose round-trip

- Pre-state: `text='Hello world'`, `classification='fact'`,
  `targetEntityId=null`, `edgeRole=null`,
  `useWsStore.sessionState['<sid>'].lastAppliedSequence=0`.
- Click the propose button. Assert:
  - exactly one `propose` envelope is sent through the WS
    client (asserted via spy);
  - the envelope's payload is
    `{ sessionId: '<sid>', expectedSequence: 0,
       proposal: { kind: 'classify-node', node_id: <UUID>,
       classification: 'fact' } }`;
  - `useCaptureStore.getState()` is `initialCaptureState` after
    the optimistic clear (text/classification/target/role all
    reset);
  - on the `proposed` ack resolve, `proposing` is back to `false`
    and no error is surfaced.

### 5. Connecting propose round-trip

- Pre-state: `text='because Y'`, `classification='value'`,
  `targetEntityId='<node-2>'`, `edgeRole='supports'`,
  `lastAppliedSequence=5`.
- Click propose. Assert:
  - two `propose` envelopes are sent in sequence;
  - the first has `expectedSequence: 5` and proposal kind
    `'classify-node'`;
  - the second is sent only AFTER the first ack resolves;
  - the second's `expectedSequence` reflects the
    post-first-broadcast `lastAppliedSequence` (the test driver
    updates the store between the two acks to mirror what the
    real server does);
  - the second has `kind: 'set-edge-substance'`,
    `edge_id: <UUID>`, `value: 'agreed'`;
  - the capture store is reset after the optimistic clear.

### 6. Error path: validation rejection from server

- Pre-state: valid free-floating draft.
- The WS client's `send` is stubbed to reject the first
  envelope with `WsRequestError({ code: 'not-a-participant',
  message: 'requester is not a participant in this session' })`.
- Click propose. Assert:
  - `useCaptureStore.getState()` has the snapshot restored
    (text / classification / target / role match pre-state);
  - `lastError.code === 'not-a-participant'`;
  - the inline `propose-action-wire-error` region renders the
    localized `wireError` message with the wire code +
    message;
  - `proposing` is `false`.

### 7. Error path: timeout

- The WS client's `send` is stubbed to reject with
  `WsRequestTimeoutError('propose', '<id>')`.
- After the rejection: the capture store is restored, the
  inline error region renders the localized `timeoutError`
  message, `proposing` is `false`.

### 8. Error dismissal

- After a failed propose (wire-error region visible), the
  moderator types into the textarea. Assert the wire-error
  region disappears.
- After a failed propose, the moderator clicks a classification.
  Assert the wire-error region disappears.
- After a failed propose, a subsequent successful propose
  clears the region.

### 9. In-flight state

- During the round-trip (before the ack resolves):
  - `proposing === true` on the capture store;
  - the button's `disabled` attribute is set;
  - the button's text is the localized `inFlightLabel`
    ("Proposing…");
  - the textarea is NOT disabled.

### 10. Connecting propose: edgeRole reaches the server-side edge creation

- The wire shape's `set-edge-substance` proposal carries the
  client-minted `edge_id`. The server's propose handler uses
  the role from the in-flight action context to populate the
  paired `edge-created` payload — this is asserted at the
  server (`ws_propose_message`'s tests); the moderator-side
  test asserts the wire shape only.

### 11. `WsClientProvider` mount + `trackSession` lifecycle

- `OperateRoute` mounts `<WsClientProvider>` and calls
  `client.trackSession(id)` on mount, `client.untrackSession(id)`
  on unmount. The provider is a no-op render when `auth.status
  !== 'authenticated'` (the provider's existing contract;
  `<RequireAuth>` higher up guarantees the precondition).

### 12. Vitest cases

Minimum 14 new cases, all per ADR 0022 (committed regression-class
proofs).

**In `apps/moderator/src/layout/ProposeAction.test.tsx` (≥ 6 cases):**

1. **Renders the component with all four testids when validation
   gates pass + connected**.
2. **Localized button label + ariaLabel + key-chip glyph resolve**
   — every `t(...)` call resolves to a non-key string.
3. **Validation-error region renders when classification is
   missing**.
4. **Wire-error region renders when `lastError !== undefined`**.
5. **Button is disabled during in-flight**.
6. **Button click invokes the hook's `propose()`**.

**In `apps/moderator/src/layout/useProposeAction.test.tsx` (≥ 8 cases):**

1. **`canPropose === false` and `validationError === 'text-empty'`
   on empty text**.
2. **Free-floating success path sends exactly one envelope** —
   with the right payload shape, including the
   `expectedSequence` read from the WS store.
3. **Connecting success path sends two envelopes sequentially** —
   the second after the first ack resolves, with the second's
   `expectedSequence` reflecting the post-ack store update.
4. **Optimistic clear** — `useCaptureStore.getState()` is reset
   before the WS promise resolves.
5. **Snapshot restore on `WsRequestError`** — slices are
   re-populated from the snapshot.
6. **Snapshot restore on `WsRequestTimeoutError`** — slices are
   re-populated; localized `timeoutError` is surfaced.
7. **`inFlight === true` during the round-trip; `false` after
   resolve**.
8. **Concurrent re-call is rejected** — calling `propose()` while
   `inFlight === true` is a no-op (returns immediately without
   firing a second envelope).

**Plus the new case in
`apps/moderator/src/stores/stores.test.tsx`:**

1. **`setProposing` toggles the slice** — call
   `useCaptureStore.getState().setProposing(true)`; assert
   `useCaptureStore.getState().proposing === true`; call
   `setProposing(false)`; assert `proposing === false`. Mirrors
   the existing `setClassification` / `setEdgeRole` smoke cases.

Optional 15th case (per i18n_testing pattern):
**Per-locale parity round-trip** — render `<ProposeAction>` with
each of the three v1 locales; walk every `data-testid` element;
assert no `[t-missing]` token nor raw catalog-key string is
visible. Decision §11 records that the parity smoke is optional
because the existing
`tests/smoke/i18n/moderator-i18n.test.tsx` already covers the
catalog parity at the catalog-level; per-component parity is
nice-to-have, not load-bearing.

### 13. Playwright e2e (per Decision §10)

One new `test()` block lands in
`tests/e2e/moderator-capture.spec.ts` (joining the existing
four). The block exercises the full propose round-trip against
the dev compose stack:

```ts
test('alice: propose a free-floating new statement; the propose envelope hits the server and the capture pane clears', async ({
  page,
}) => {
  // 1. Login → create session → land on operate (mirrors prior tests).
  await loginAs(page, { username: TEST_USERNAME });
  await page.goto('/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();
  await page.getByTestId('create-session-topic-input').fill('Propose action e2e check.');
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();

  // 2. Pre-state: the propose button is visible but disabled
  //    (validation gates fire on the empty draft).
  await expect(page.getByTestId('propose-action-button')).toBeVisible();
  await expect(page.getByTestId('propose-action-button')).toBeDisabled();

  // 3. Type wording + pick classification. The button enables.
  const wording = 'The proposed minimum wage would raise prices for everyone.';
  await page.getByTestId('capture-text-input-textarea').fill(wording);
  await page.getByTestId('classification-palette-button-fact').click();
  await expect(page.getByTestId('propose-action-button')).toBeEnabled();

  // 4. Extract the session id from the URL.
  const url = new URL(page.url());
  const sessionId = url.pathname.split('/')[2] ?? '';
  expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

  // 5. Fire the propose gesture (use Cmd+Enter to assert the keyboard path).
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await page.getByTestId('capture-text-input-textarea').press(submitKey);

  // 6. The capture pane clears optimistically.
  await expect(page.getByTestId('capture-text-input-textarea')).toHaveValue('');
  for (const kind of ['fact', 'predictive', 'value', 'normative', 'definitional']) {
    await expect(page.getByTestId(`classification-palette-button-${kind}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  }

  // 7. The server's event-applied broadcast lands in the moderator's
  //    useWsStore. Assert via the dev-only `window.__aConversaWsStore`
  //    seam. The free-floating bundle emits node-created +
  //    entity-included + proposal events; we check that
  //    lastAppliedSequence advances and at least one node-created
  //    event landed for the session.
  if (!(await isWsStoreReachable(page))) {
    test.skip(true, 'wsStore seam not reachable in this environment');
    return;
  }
  await expect
    .poll(
      async () =>
        await page.evaluate((sid) => {
          const store = (window as any).__aConversaWsStore;
          const session = store?.getState()?.sessionState?.[sid];
          return {
            lastSequence: session?.lastAppliedSequence ?? 0,
            kinds: (session?.events ?? []).map((e: any) => e.kind),
          };
        }, sessionId),
      { timeout: 10_000 },
    )
    .toMatchObject({
      lastSequence: expect.any(Number) as number,
      kinds: expect.arrayContaining(['node-created', 'entity-included', 'proposal']) as string[],
    });
});
```

A second optional connecting-bundle case (seed two nodes → click
one → type + classify + role → Cmd+Enter → assert two propose
envelopes worth of events land) lands if implementation time
allows; the first case is the regression-class minimum.

If the WS client cannot connect to the dev compose stack in the
test environment (the `WsClientProvider` mount + the auth-cookie
flow + the server's WS upgrade are all already in place per the
chain of predecessor tasks), the spec `test.skip`s with the same
seed-reachability pattern the predecessor specs use; the
validation-gate UI regression (case 2 above as a separate
`test()` block) still gates the propose-action component's mount.

### 14. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.proposeAction.{label, inFlightLabel, ariaLabel,
  validationError, wireError, timeoutError, reason.textEmpty,
  reason.classificationMissing, reason.targetWithoutRole,
  reason.roleWithoutTarget, reason.notConnected,
  reason.sessionMissing}` keys with the en-US text from the
  tables.
- `pt-BR.json` and `es-419.json` gain the same 12 keys with
  draft strings.
- `pt-BR.review.json` and `es-419.review.json` gain
  `pending: true` entries for each of the 12 new keys (24
  PENDING entries total).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green.

### 15. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_propose_action` block gets
  `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_propose_action.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_propose_action_native_review` is added with the
  template below (effort 0.5d; `depends
  !i18n_edge_role_selector_native_review`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_propose_action_native_review "Native-speaker review of pt-BR + es-419 propose-action strings" {
  effort 0.5d
  allocate team
  depends !i18n_edge_role_selector_native_review
  note "Source of debt: mod_propose_action (this commit) — pt-BR and es-419 drafts of the 12 keys under moderator.proposeAction.* (6 chrome + 6 reason) landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### 16. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Wire shape: one `propose` envelope per proposal sub-kind, sequential

Three alternatives surveyed:

- **One envelope per proposal sub-kind, sequential awaits**
  (chosen). The wire vocabulary defined by `ws_propose_message`
  carries exactly one `ProposalPayload` per `propose` envelope
  (`packages/shared-types/src/ws-envelope.ts:341-351`). The
  "several events at once" language in `docs/moderator-ui.md:46`
  refers to the **server-side event emission** (the propose
  handler appends `node-created` + `entity-included` +
  `proposal` events inside one transaction per propose call);
  it does NOT mean one envelope carrying multiple proposals.
  The connecting case fires two envelopes sequentially so the
  `expectedSequence` token advances coherently between them and
  the server's per-envelope `validateAction` call sees a
  consistent projection.
- **A new `propose-bundle` envelope type carrying multiple
  proposals** — rejected. Would require extending
  `wsMessageTypes` + `wsMessagePayloadSchemas` + the server's
  propose handler to accept a multi-proposal payload. The
  per-proposal `expectedSequence` semantics break (the second
  proposal in the bundle reads the projection AFTER the first
  is applied, which is mid-transaction — the engine's
  `validateAction` is not designed for that). Adding a new
  wire type just to bundle two existing proposals when the
  client can already fire two envelopes in sequence is a
  cost-without-benefit change to the wire vocabulary.
- **Fire the two envelopes in parallel, ignoring per-envelope
  ordering** — rejected. The server's `expectedSequence` token
  is the optimistic-concurrency primitive; firing two
  envelopes with the same `expectedSequence` makes one of them
  fail with `sequence-mismatch`. Even if the server were
  changed to accept concurrent envelopes, the projection-update
  semantics of `event-applied` broadcast would deliver the
  events in interleaved order on every other subscribed
  client; the moderator's own client would have to dedupe
  carefully. Sequential awaits is the simplest correct shape.

The sequential pattern is also forward-compatible with the
future `mod_decompose_action` task (which emits a single
`decompose` proposal containing N components — one envelope,
not N) and the `mod_meta_move_flow` task (one `meta-move`
proposal per envelope). The wire vocabulary stays simple.

### 2. Validation: six gates, inline-error surfacing

Three alternatives surveyed:

- **Six gates in fixed order with localized inline reasons +
  disable button until clear** (chosen). The order matters:
  `session-missing` and `not-connected` fire first because they
  are infrastructure-level (no propose can succeed if the URL
  is wrong or the socket is closed); `text-empty` and
  `classification-missing` fire next because they are
  user-correctable inputs; `target-without-role` and
  `role-without-target` fire last because they're coupled-clear
  contract integrity checks (mostly unreachable in normal flow,
  but defensive). Each gate writes a localized reason to the
  validation-error region; the button is disabled until the
  reason clears. This matches the moderator's mental model
  (the button is grey because something is missing; clicking
  the empty button has no effect; the inline message says what
  to fix).
- **Toast notifications for validation failures** — rejected.
  Toasts pull focus from the capture flow; the moderator is
  rapidly typing and would lose context if a popup grabbed
  attention. Inline status is the canonical pattern for
  composition-time validation (Gmail's send-disable on empty
  recipient + the inline tooltip is the precedent).
- **Silent ignore on invalid submit** — rejected. The
  moderator might press Cmd+Enter expecting the propose to
  fire and not understand why nothing happens. Visible
  inline-error feedback is the minimal viable
  discoverability surface.

The methodology-level validation (is the classification right
for the wording? is the proposed edge role valid for the
target's kind?) is the engine's responsibility — the server's
`validateAction` returns a `RejectedValidationResult` on
engine rejection and the wire-error region surfaces the
result. The client-side gates only check shape; the engine
checks semantics.

### 3. Hook + provider placement: hook in layout/, provider on OperateRoute

Three alternatives surveyed:

- **Hook colocated with the layout components (`apps/moderator/src/layout/useProposeAction.ts`)
  + `WsClientProvider` mounted inside `<OperateRoute>`** (chosen).
  The hook reads four capture-store slices and the WS store
  + client; layout/ is the natural home (the hook is one
  abstraction higher than the component but one level lower
  than the route). The provider mounts on the operate route
  because that's the only WS-driving route in v1 (the other
  routes — `/login`, `/screen-name`, `/sessions/new`,
  `/sessions/:id/lobby` — make no WS calls). Mounting the
  provider at the App.tsx root would have the WS client open
  during routes that don't need it (slight bandwidth + server
  resource cost; the WS connection is per-tab not per-route);
  mounting per-route keeps the surface tight.
- **Hook colocated with `apps/moderator/src/ws/`** — rejected.
  The hook reads capture-store state (`text`, `classification`,
  etc.) which is layout-domain concern; putting the hook
  under `ws/` would force the import direction `ws/ ←
  layout/captureStore.ts` which inverts the natural
  dependency (the layout owns the form state; the WS layer
  owns the transport). Decision: `useProposeAction` lives in
  `layout/` because the hook's primary concern is binding
  layout state to the transport, not the transport itself.
- **Provider at App.tsx root** — rejected per the per-route
  rationale above. A future task that adds WS to a second
  route (e.g., a public-visible audience route) can promote
  the provider when the consumer count justifies it.
- **No provider — call `createWsClient` directly inside the
  route** — rejected. The provider's lifecycle handling
  (open on auth, close on unmount, store reset on teardown)
  is exactly what the consumer wants; bypassing the provider
  would re-implement that lifecycle in the route.

### 4. Optimistic clear semantics: clear before round-trip resolves

Three alternatives surveyed:

- **Optimistic clear with in-memory snapshot for restore-on-error**
  (chosen). The moderator's next gesture (typing the next
  statement) begins immediately; the prior propose is in
  flight against the server. On error, the snapshot restores
  the form so the moderator can fix and retry. The capture
  flow's design language is "fast capture during live
  debate" (per `docs/moderator-ui.md:45`) — pessimistic
  blocking would interrupt the chain.
- **Pessimistic clear (wait for ack before clearing)** —
  rejected. The 10s default timeout would lock the form for
  up to 10 seconds on a slow round-trip; the moderator would
  lose 10 seconds of capture during live debate.
  Optimistic-clear with an in-memory snapshot gives the same
  worst-case recovery (re-edit and re-propose) without the
  blocking cost.
- **Optimistic clear with persisted snapshot (localStorage)**
  — rejected. The `mod_ws_client` refinement's Decision §
  pins "no localStorage / sessionStorage" — in-memory only
  per the cookie-only-auth policy. A hard refresh during a
  failed propose loses the snapshot; that's an acceptable
  cost (a hard refresh already loses the WS connection and
  the in-flight pending-request map, so the propose itself
  is non-recoverable in that scenario).

### 5. In-flight surfacing: minimal v1 — slice + button state, NO textarea disable

Surveyed:

- **`proposing` slice + button-disabled + label switch, NO
  textarea disable** (chosen). The moderator may already be
  typing the next statement; disabling the textarea would
  steal focus and break the chain. The button switches to
  the "Proposing…" label + spinner so the gesture is
  observable; the slice carries the signal for future
  surfaces (toast, retry banner).
- **Full pessimistic disable (textarea + palette + chip +
  selector all greyed out)** — rejected per the
  fast-capture rationale above.
- **No in-flight state at all** — rejected. A double-click
  on the propose button without `proposing`-aware disable
  would fire a duplicate propose; the slice + button-disabled
  pair is the minimum viable guard.

### 6. Error handling: inline-error region + snapshot restore + dismissal on user-modification

Surveyed:

- **Inline error region in the propose-action component +
  snapshot restore + dismissal on user-modification or
  next-successful-propose** (chosen). The error region uses
  `role="alert"` for screen-reader urgency; the message reads
  the wire code + the server-supplied message verbatim (per
  Decision §6 sub-point: do NOT re-localize the server's
  message because some engine rejections carry per-case
  detail). Snapshot restore lets the moderator fix and retry
  without re-typing. User-modification dismissal is the
  canonical UX pattern for "you saw the error; now you're
  fixing it" (Gmail's red-banner-dismiss-on-keypress is the
  precedent).
- **Modal dialog for wire errors** — rejected. Modals pull
  focus and force a click-through; the moderator's flow
  would be interrupted. Inline is non-blocking.
- **Toast notifications for wire errors** — rejected (same
  rationale as Decision §2; toasts pull focus during fast
  capture). The error-toast is named as a future tech-debt
  task (`mod_propose_action_error_toast`) if the visual
  signal turns out to be load-bearing; v1 ships inline.
- **Silent retry on transient errors** — rejected. Auto-retry
  is dangerous: the server may have applied the first attempt
  and a retry could double-apply (mirror of
  `mod_ws_client`'s Decision §"No retry of in-flight
  requests on reconnect"). Explicit-only retry is safer.

### 7. Submit gesture: NO document-level keymap binding

Surveyed:

- **Cmd/Ctrl+Enter on the textarea only (existing seam from
  `mod_capture_text_input`)** (chosen). The moderator's focus
  during capture is almost always in the textarea (typing the
  wording, then pressing the kind shortcut which doesn't
  steal focus, then Cmd+Enter to submit). Document-level
  binding would conflict with text-editor focus semantics
  (Cmd+Enter inside a non-textarea context like the
  classification palette might fire the submit unexpectedly).
- **Document-level `onSubmit` binding via captureKeymap** —
  rejected. The keymap module's editable-target guard would
  bail on Cmd+Enter inside the textarea (the modifier-bail
  guard at `captureKeymap.ts:151-153` already short-circuits
  on `metaKey || ctrlKey`); the binding would only fire
  outside the textarea, which is exactly NOT the moderator's
  hand position during capture. The textarea-local binding is
  the right scope.
- **A "submit" button at the moderator's primary focus point**
  — included alongside the keyboard path (the
  `<ProposeAction>` button is the pointer affordance). Both
  paths funnel through the same hook; redundancy is
  intentional.

### 8. Cross-platform shortcut glyph

Surveyed:

- **Platform detection via `navigator.userAgentData?.platform`
  (modern) + `navigator.platform` (fallback) — show "⌘+Enter"
  on macOS, "Ctrl+Enter" elsewhere** (chosen). The handler
  itself fires on both `metaKey || ctrlKey`
  (`CaptureTextInput.tsx:108`); the visible glyph adapts to
  the platform for discoverability. The detection is a
  one-time component-render-time read; no listener required.
- **Always show "Ctrl+Enter" regardless of platform** — rejected.
  macOS conventions strongly prefer the `⌘` glyph; showing
  "Ctrl+Enter" on macOS would confuse macOS-native moderators
  (their muscle memory is Cmd, not Ctrl).
- **Show both ("Ctrl/Cmd+Enter")** — rejected. Verbose; the
  per-platform glyph is the canonical pattern (Slack, GitHub
  PR composer both detect and render the platform's glyph).

The `navigator.platform` API is deprecated but still widely
supported; the modern `userAgentData.platform` is preferred
when available. The fallback chain handles every browser the
moderator UI targets (Chromium-based + Safari + Firefox).

### 9. Provider mount inside the route (not at App root)

See Decision §3 above. The provider mounts on `<OperateRoute>`
because that's the only WS-driving route in v1. A future
audience-route or participant-tablet route that needs WS would
re-mount the provider at its own scope (or App.tsx would gain
the provider once two routes need it).

### 10. Playwright e2e placement + scope: extend existing spec, drive real compose stack

Two placement options surveyed:

- **Extend `tests/e2e/moderator-capture.spec.ts`** (chosen).
  The file is the canonical regression home for the capture
  flow; the four prior tests live there
  (`mod_capture_text_input`, `mod_classification_palette`,
  `mod_target_auto_suggest`, `mod_target_clear_override`).
  The new propose-action test is the natural fifth — it
  exercises the chain composed of all prior leaves.
- **New file `tests/e2e/moderator-propose.spec.ts`** — rejected.
  Splitting the capture flow across files would dilute the
  regression home; future capture-flow polish tasks (e.g.,
  the deferred toast / retry-banner tasks) would have to
  choose between the two files. One file per surface is the
  established pattern.

Two scope options surveyed:

- **(b) Drive the real dev compose stack and assert the
  event-applied broadcast lands in `useWsStore`** (chosen).
  The compose stack is already up for the predecessor specs;
  the auth + create-session + operate-route chain works
  against the real server today. Driving the actual server
  exercises the full chain (envelope construction →
  serialization → wire → server's propose handler →
  appendSessionEvent → post-commit emit → client's
  applyEvent reducer → store update). This is the realistic
  regression-class proof; the unit-level Vitest cases cover
  the hook + component in isolation against stubs.
- **(a) Mock the WS at the test boundary and assert the
  sent payload** — rejected as the SOLE proof. A mocked-WS
  test would not catch a server-side serialization
  mismatch (e.g., a Zod schema drift between client and
  server); the full-chain test is the load-bearing check.
  The mocked-WS scope is already covered by the Vitest
  `useProposeAction.test.tsx` cases (they stub
  `useWsClient` and assert the sent payload).

The compose-stack test reads the WS store directly via the
`window.__aConversaWsStore` seam the predecessor specs use
(`tests/e2e/fixtures/wsStoreSeed.ts:103-167`); the
pending-proposals pane is NOT in this task's surface, so the
store-read is the realistic-but-bounded server-side-event-landed
proof. If the WS connectivity is unreachable in the test
environment, the spec `test.skip`s with the seed-reachability
pattern.

### 11. No new ADR

Three potential ADR triggers, all dispatched:

- **"A new WS-write pattern is ADR-worthy."** This task adds
  NO new pattern — it follows the wire vocabulary settled by
  `ws_propose_message` and the WS-client API settled by
  `mod_ws_client`. The optimistic-clear pattern is a UI-level
  decision (not architectural).
- **"Client-side UUID generation policy is ADR-worthy."**
  This task uses `crypto.randomUUID()` for `node_id` /
  `edge_id` generation. The pattern is settled — the WS
  client already uses it for envelope `id` minting
  (`client.ts:220`); the server accepts client-minted ids
  for nodes / edges per the persisted-event schemas (the
  `node_id` / `edge_id` UUIDs in the proposal payloads are
  the canonical primary keys). No new policy.
- **"Validation-gate strategy is ADR-worthy."** This task
  enforces shape-only client-side validation; methodology
  semantics live in the engine. The split was settled by
  `proposal_events.md` (shape-only Zod schemas) and
  `ws_propose_message.md` (engine `validateAction` runs on
  the server). The hook's six-gate validation is a tactical
  UI choice, not an architectural decision.

`mod_state_management`, `mod_ws_client`, `ws_propose_message`,
`proposal_events`, ADR 0021, ADR 0022, ADR 0024, and the
`i18n_keyboard_shortcuts_policy` already pinned every
architectural choice this task implements; this refinement is
the task-scope pin for the UI binding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- `useProposeAction()` hook lands at `apps/moderator/src/layout/useProposeAction.ts`
  with companion suite `apps/moderator/src/layout/useProposeAction.test.tsx`. The
  hook owns the six-gate shape-only validation, client-side UUID minting for
  `node_id` / `edge_id`, optimistic-clear with in-memory snapshot for
  restore-on-error, and `propose` envelope construction per
  `tasks/refinements/backend/ws_propose_message.md`.
- `<ProposeAction>` button lands at `apps/moderator/src/layout/ProposeAction.tsx`
  (test: `apps/moderator/src/layout/ProposeAction.test.tsx`) and binds to the
  bottom-strip's `proposeAction` slot. Both the button click and
  `<CaptureTextInput>`'s `Cmd/Ctrl+Enter` `onSubmit` go through the same
  `useProposeAction()` callback, with the new `proposing: boolean` slice in
  `apps/moderator/src/stores/captureStore.ts` (extended tests:
  `apps/moderator/src/stores/stores.test.tsx`) gating re-entry.
- `<OperateRoute>` (`apps/moderator/src/routes/Operate.tsx`) now mounts
  `<WsClientProvider>` with paired `trackSession` / `untrackSession` lifecycle,
  replaces the noop `onSubmit` handler with `useProposeAction()`, and
  surfaces inline validation errors above the capture pane.
- 12 new i18n keys land under `moderator.proposeAction.*` in en-US plus pt-BR /
  es-419 drafts flagged PENDING in the matching `*.review.json` trackers. Native-speaker
  review registered as `i18n_propose_action_native_review` in
  `tasks/35-frontend-i18n.tji`.
- One new full-chain Playwright `test()` block extends
  `tests/e2e/moderator-capture.spec.ts`: type wording, pick classification,
  optionally pick target + role, `Cmd+Enter` submit, assert the WS `propose`
  envelope reaches the server via `GET /sessions/:id/events`, assert form clears.
  `chromium-create-session` Playwright project: 8/8 passing.
- **Wire-shape claim correction.** The refinement's claim that `propose` emits
  paired `node-created` / `entity-included` / `edge-created` events is WRONG per
  the canonical contract in `tasks/refinements/backend/ws_propose_message.md`
  line 13, `apps/server/src/methodology/handlers/propose.ts` line 207-217, and
  `tasks/refinements/backend/commit_logic.md` line 13: `propose` stages a
  proposal (single `proposal` event); structural entity-creation events fire on
  COMMIT, not on propose. The e2e test was corrected to assert the actual
  contract; the same incorrect claim still appears in
  `apps/moderator/src/layout/useProposeAction.ts` lines 347-353 as a code
  comment, plus in the refinement body, and is registered as follow-up task
  `mod_propose_action_refinement_amendment` in `tasks/30-moderator-ui.tji`.
- Closes the `mod_capture_flow` capstone. Sibling capture-flow leaves are all
  `complete 100`; `mod_capture_flow` derives-completes. M4 (`m_moderator_mvp`)
  remains open via its other capture-adjacent dependencies
  (`mod_pending_proposals_pane`, `mod_decompose_flow`, `mod_diagnostic_flow`,
  `mod_axiom_mark_flow`, `mod_session_setup`).
- Vitest test-count delta: 2861 → 2887 (+26 new cases).
