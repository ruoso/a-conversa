# Moderator F2 propose-decomposition action — the capstone of the decompose main path

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_decompose_flow.mod_propose_decomposition`.

```
task mod_propose_decomposition "Propose decomposition action" {
  effort 1d
  allocate team
  depends !mod_multi_component_capture
}
```

## Effort estimate

**1d.** Confirmed. This is the **capstone of `mod_decompose_flow`'s main
path**: it binds the multi-component grid (`mod_multi_component_capture` —
just landed at commit `216aa34`, refinement
[`mod_multi_component_capture.md`](mod_multi_component_capture.md)) +
the mode-entry seam (`mod_decompose_mode` — refinement
[`mod_decompose_mode.md`](mod_decompose_mode.md)) into a single
moderator gesture that emits the `propose: decompose` envelope the
server-side validator (`decomposition_logic`,
[`decomposition_logic.md`](../data-and-methodology/decomposition_logic.md))
has been waiting for since 2026-05-10. The work is hook + button + a
mode-aware slot swap at the route + i18n + tests on top of seams
already in place:

- `useCaptureStore` already carries every slice this hook reads:
  `decomposeTargetNodeId: string | null`
  (`apps/moderator/src/stores/captureStore.ts:154` — the parent node id
  the propose envelope's `parent_node_id` field references),
  `decomposeComponents: ReadonlyArray<DecomposeComponent>`
  (`apps/moderator/src/stores/captureStore.ts:172` — the per-row
  `{text, classification}` array the envelope's `components` field is
  built from), `proposing: boolean`
  (`apps/moderator/src/stores/captureStore.ts:142` — the in-flight
  slice already extended by `mod_propose_action`), and the
  `exitDecomposeMode()` helper
  (`apps/moderator/src/stores/captureStore.ts:299-307` — the atomic
  multi-field clear this hook calls on propose-success to flip the
  mode back to `'idle'` and clear the per-row state). The
  `validateDecomposeComponents(components)` free function is also
  already exported
  (`apps/moderator/src/stores/captureStore.ts:86-92`) — this task is
  its first non-test consumer. No new slice, no new helper, no shape
  change.
- `useProposeAction()` and `<ProposeAction>` (the F1 capstone shipped
  by `mod_propose_action`, refinement
  [`mod_propose_action.md`](mod_propose_action.md), commit landing
  2026-05-16) pin every load-bearing pattern this task mirrors:
  the hook structure (read slices → validate → optimistic clear →
  send → snapshot-restore-on-error), the in-flight guard against
  concurrent re-entry, the wire-error inline-region surface
  (`role="alert"` + dismissal on user-modification), the
  `useProposeErrorStore` module-scoped Zustand slice for shared
  error surfacing across button + keyboard paths (`useProposeAction.ts:120-128`),
  the `toWireError` mapping helper (`useProposeAction.ts:195-206`),
  and the `crypto.randomUUID()` fallback (`useProposeAction.ts:144-156`).
  This task is the second non-F1 consumer of those patterns
  (the future `mod_interpretive_split_mode` will be the third).
- The WS-write surface is in place — `WsClient.send('propose',
  payload)` is the typed call (`apps/moderator/src/ws/client.ts`
  per `mod_propose_action.md` line 479-482); the wire envelope for a
  `propose` message is already settled
  (`packages/shared-types/src/ws-envelope.ts` `ProposePayload` per
  `ws_propose_message.md`), and the `decomposeProposalSchema`
  discriminated-union arm is already settled
  (`packages/shared-types/src/events/proposals.ts:168-172` —
  `{kind: 'decompose', parent_node_id: UUID, components: [{wording,
  classification}, ...]}`).
- The server-side handler is in place — `validateDecomposeProposal`
  in `apps/server/src/methodology/handlers/propose.ts:312-356`
  enforces rules 1 (parent-exists → `'target-entity-not-found'`),
  2 (parent-visible → `'illegal-state-transition'`), 3 (no
  conflicting decompose / interpretive-split / edit-wording /
  amend-node pending against the same parent —
  `CONFLICTING_PARENT_KINDS` at lines 278-280 — →
  `'illegal-state-transition'`). The propose handler appends one
  `proposal` event per envelope (per
  `ws_propose_message.md:13` and
  `apps/server/src/methodology/handlers/propose.ts` per the
  `decomposition_logic.md` Status block: "On `Valid` the handler
  emits exactly one `EventToAppend` of kind `proposal` whose
  payload is `{ proposal: action.proposal }`"). This task does NOT
  change the server.
- The route already mounts `<WsClientProvider>` and pairs
  `trackSession` / `untrackSession` lifecycle
  (`apps/moderator/src/routes/Operate.tsx:77-122`) — shipped by
  `mod_propose_action`. This task reuses both.
- `<BottomStripCapture>`'s `proposeAction` slot exposes a stable
  render-prop seam
  (`apps/moderator/src/layout/BottomStripCapture.tsx:48-49, 86-91`,
  testid `bottom-strip-propose-action`); the F1 `<ProposeAction />`
  already mounts there
  (`apps/moderator/src/routes/Operate.tsx:160`). This task swaps
  the slot's content in decompose mode the same way
  `mod_multi_component_capture` swaps the `textInput` slot.
- The catalog workflow + the `*.review.json` PENDING-flag lifecycle
  + `pnpm --filter @a-conversa/i18n-catalogs run check` are in place;
  the `moderator.decompose.*` top-level namespace already exists
  with sub-namespaces `exit.*` / `banner.*` / `components.*` from
  the predecessors. This task adds a new sub-namespace
  `moderator.decompose.propose.*` alongside.
- ADRs 0021 (schema-on-write), 0022 (no throwaway verifications),
  0024 (react-i18next + ICU) pin the test discipline + i18n
  architecture this task consumes; no new ADR (Decision §10).

Concretely the deliverable is:

- **One new hook** `apps/moderator/src/layout/useProposeDecompositionAction.ts`
  — mirrors the shape of `useProposeAction` (the F1 sibling at
  `apps/moderator/src/layout/useProposeAction.ts:208-407`). Reads
  `useCaptureStore`'s `decomposeTargetNodeId`, `decomposeComponents`,
  `proposing`, `setProposing`, `exitDecomposeMode`. Reads the URL
  session id via `useParams<{ id: string }>()`, the
  `connectionStatus` + `sessionState[sessionId].lastAppliedSequence`
  from `useWsStore`, and the `WsClient` instance from
  `useWsClient()`. Exposes `{ propose, canPropose, validationError,
  inFlight, lastError }` (same shape as
  `UseProposeActionResult` with a decompose-specific
  `DecomposeValidationErrorReason` union). On success calls
  `exitDecomposeMode()` (the existing atomic helper that flips
  `mode = 'idle'` + clears `decomposeTargetNodeId` + clears
  `decomposeComponents` in a single `set()` per
  `captureStore.ts:299-307`). On error restores the prior state via
  a snapshot the hook captured before the optimistic clear.
- **One new component** `apps/moderator/src/layout/ProposeDecompositionAction.tsx`
  — a button + inline-error region with the same visual vocabulary
  as `<ProposeAction>` (the F1 button at
  `apps/moderator/src/layout/ProposeAction.tsx:102-171`). Different
  localized label key (`moderator.decompose.propose.label` /
  `inFlightLabel` instead of `moderator.proposeAction.label` /
  `inFlightLabel`); same Tailwind palette (blue-700 primary action,
  WCAG AA contrast); same `<kbd>` chord chip (renders the same
  `⌘+Enter` / `Ctrl+Enter` glyph with the same platform-detection
  read; the glyph is informational only in v1 per Decision §8 — the
  per-row textareas in decompose mode don't fire the chord — but
  surfacing the same glyph keeps the button's affordance signal
  consistent across modes; future enhancement lands a real keybind
  per Decision §8); same testid namespace
  (`propose-decomposition-action` / `propose-decomposition-action-button` /
  `propose-decomposition-action-key-chip` /
  `propose-decomposition-action-validation-error` /
  `propose-decomposition-action-wire-error`). No props.
- **`<BottomStripCapture>` `proposeAction` slot swap** at the
  route's integration site
  (`apps/moderator/src/routes/Operate.tsx:160`). When
  `mode === 'decompose'`, the slot receives
  `<ProposeDecompositionAction />`; otherwise the existing F1
  `<ProposeAction />`. The swap mirrors the three existing
  conditional ternaries on `textInput` / `classificationPalette` /
  `edgeRoleSelector` shipped by `mod_multi_component_capture`
  (`apps/moderator/src/routes/Operate.tsx:147-159`). Decision §3
  records the slot-reuse-vs-side-by-side trade-off.
- **In-flight slice reuse**: the existing `proposing: boolean` slice
  (shared with F1) carries the in-flight signal. A propose
  round-trip in either flow blocks a concurrent propose in the
  other (decompose mode + an in-flight F1 propose is structurally
  impossible because entering decompose clears the F1 slices —
  Decision §5 records the rationale for extending the existing
  slice over minting a separate `decomposeProposing` slice).
- **Wire envelope shape**: one `propose` envelope per
  `useProposeDecompositionAction.propose()` call carrying the
  `decompose` proposal sub-kind:
  ```json
  {
    "type": "propose",
    "id": "<client-uuid>",
    "payload": {
      "sessionId": "<URL session id>",
      "expectedSequence": <lastAppliedSequence-at-call-time>,
      "proposal": {
        "kind": "decompose",
        "parent_node_id": "<decomposeTargetNodeId>",
        "components": [
          { "wording": "<row[0].text>", "classification": "<row[0].classification>" },
          { "wording": "<row[1].text>", "classification": "<row[1].classification>" },
          // ... N rows, 2 ≤ N ≤ 10
        ]
      }
    }
  }
  ```
  Decision §2 records the wire-shape derivation
  (`proposalComponentSchema`'s field is `wording`, not `text`; the
  hook does the map at envelope-build time so the store can keep
  the more natural per-row `text` field name).
- **Validation gate (four rules in evaluation order)**:
  1. `session-missing` — URL session id is `''`. Defensive;
     unreachable in normal flow.
  2. `not-connected` — `connectionStatus !== 'open'`. The button
     is disabled in this state; the inline error reads
     `"Cannot propose — WebSocket disconnected. Reconnecting…"`.
  3. `target-missing` — `decomposeTargetNodeId === null`. Defensive;
     unreachable in normal flow because the route only mounts the
     decompose UI in `mode === 'decompose'`, and entering decompose
     always sets `decomposeTargetNodeId` atomically
     (`captureStore.ts:282-298`). The gate exists for type-narrowing
     + defense.
  4. `components-invalid` — `validateDecomposeComponents(decomposeComponents) === false`.
     The free function exported from `captureStore.ts:86-92` carries
     the truth: returns `true` iff every row has non-empty trimmed
     text AND non-null classification AND the array length is in
     `[2, 10]`. The gate is the only user-correctable rule;
     localized inline message + a disabled button surface it. The
     gate matches the upstream Zod schema bounds and the methodology
     validator's rule 4 layer — by the time the propose envelope
     leaves the client, the structural shape is guaranteed; the
     server's methodology validator runs rules 1-3 only (parent
     existence + visibility + no conflicting pending). Decision §4
     records the gate-reason atomization (one boolean vs.
     per-violation enumeration).
- **Optimistic cleanup**: on success the hook calls
  `useCaptureStore.getState().exitDecomposeMode()` (the existing
  atomic multi-field helper) — this flips `mode` to `'idle'` (so
  the route's conditional swap re-mounts the F1 slots), clears
  `decomposeTargetNodeId` to `null`, and clears
  `decomposeComponents` to `[]`. Crucially this happens BEFORE the
  WS `propose` round-trip resolves (mirror of F1 Decision §4 —
  optimistic clear with snapshot restore on error). The moderator's
  next gesture immediately begins (typing into the now-mounted F1
  capture textarea); the prior propose-decomposition is in flight.
- **Snapshot restore on error**: the hook captures the prior state
  (`decomposeTargetNodeId`, `decomposeComponents`) in an in-memory
  snapshot BEFORE the optimistic exit. On any error path the
  snapshot restores via `useCaptureStore.setState({ ... })` plus a
  programmatic `useCaptureStore.getState().enterDecomposeMode(snapshot.decomposeTargetNodeId)`
  call followed by a per-row replay of the snapshot's
  `decomposeComponents` via the existing setter helpers. Decision
  §6 records the restore-shape trade-off (one `setState` write
  vs. one `enterDecomposeMode` + N per-row setter calls).
- **Wire-error inline-region** mirrors the F1 surface: `role="alert"`,
  reads `lastError.code` + `lastError.message` verbatim (for
  `WsRequestError`), localized fallback for `WsRequestTimeoutError`
  / generic `Error`. Auto-dismiss on user-modification of the
  per-row capture inputs (typing into a row's textarea, picking a
  classification, adding / removing a row). The user-modification
  detection adapts the F1 hook's snapshot-baseline pattern
  (`useProposeAction.ts:257-290`) to the decompose state shape (the
  baseline captures the per-row array reference; any reference
  inequality after the error landed dismisses the region).
  Decision §7 records the dismissal rule.
- **Module-scoped error store reuse**: a new
  `useProposeDecompositionErrorStore` Zustand slice mirrors the F1
  hook's `useProposeErrorStore` shape
  (`useProposeAction.ts:120-128`) — a tiny module-local
  `lastError`-carrying store outside React so consumers across
  paths observe the same error. Decision §11 records why this is a
  separate store, not the same one: in-flight propose-decomposition
  errors and in-flight F1 propose errors target different inline
  regions and shouldn't bleed across modes when the mode flips.
- **Vitest cases** under
  `apps/moderator/src/layout/ProposeDecompositionAction.test.tsx`
  (button + region rendering, validation-gate surface, in-flight
  visual state, wire-error surface) and
  `apps/moderator/src/layout/useProposeDecompositionAction.test.tsx`
  (the hook in isolation — `renderHook` against a mocked
  `useWsClient`, real `useCaptureStore`, real `useWsStore`).
- **One new `test()` block** extending
  `tests/e2e/moderator-capture.spec.ts` — the canonical regression
  home for the moderator capture flow. The block: log in → create
  session → bridge lobby gate → operate → seed a node via
  `seedWsStore` → right-click → "Propose decompose" → fill two
  component rows (text + classification) → click the
  propose-decomposition button → assert the WS envelope reaches
  the server (via the dev-only `window.__aConversaWsStore` seam,
  same pattern as the F1 propose e2e) → assert the mode flips back
  to `'idle'` (the decompose grid unmounts, the F1 capture text
  input re-mounts). Decision §9 records the full-chain compose-stack
  scope.
- **5 new i18n catalog keys** under a new
  `moderator.decompose.propose.*` sub-namespace × 3 locales = **15
  new catalog entries**. pt-BR + es-419 drafts (10 entries) land
  flagged PENDING in `pt-BR.review.json` + `es-419.review.json`
  (10 entries total). Native-speaker review registered as a
  tech-debt follow-up.
- **1 follow-up tech-debt task registered** in
  `tasks/35-frontend-i18n.tji` for the native-speaker review of the
  10 new pt-BR / es-419 draft entries
  (`i18n_propose_decomposition_native_review`, effort 0.5d,
  `depends !i18n_multi_component_capture_native_review` — the
  current tail of the native-review chain per
  `tasks/35-frontend-i18n.tji:206-212`).

This task closes the F2 decompose main path: a moderator can
right-click a node → "Propose decompose" → enter mode → fill the
multi-component grid → click "Propose decomposition" → the envelope
lands on the server → the mode flips back to `'idle'`. The
end-to-end flow is operational for the first time. The sibling
`mod_interpretive_split_mode` (`mod_decompose_flow`'s fourth leaf)
is an independent flow that mirrors this task's shape with a
different proposal sub-kind; landing this task pins the template.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_decompose_flow.mod_multi_component_capture`**
  (done — 2026-05-16 per `mod_multi_component_capture.md`'s Status
  block + commit `216aa34`). Shipped the `decomposeComponents` slice
  + the four per-row coordination helpers + the seed-two-rows
  invariant in `enterDecomposeMode` + the clear-to-`[]` invariant
  in `exitDecomposeMode` + the `validateDecomposeComponents` free
  function + the grid + per-row components + the slot swap in
  `textInput` / `classificationPalette` / `edgeRoleSelector`.
  **This task reads the slice + the validator + calls
  `exitDecomposeMode` on success.** No public-contract change.
- **`moderator_ui.mod_decompose_flow.mod_decompose_mode`** (done —
  2026-05-16 per `mod_decompose_mode.md`'s Status block). Shipped
  the `decomposeTargetNodeId` slice + the `enterDecomposeMode` /
  `exitDecomposeMode` helpers + the context-menu wiring + the
  mode-aware Escape keymap routing. **This task reads
  `decomposeTargetNodeId` for the envelope's `parent_node_id`
  field; calls `exitDecomposeMode` on success via the same helper
  the Esc gesture calls.** No public-contract change.
- **`moderator_ui.mod_capture_flow.mod_propose_action`** (done —
  2026-05-16 per `mod_propose_action.md`'s Status block). Shipped
  `useProposeAction` + `<ProposeAction>` + the
  `useProposeErrorStore` module-scoped slice + the `toWireError`
  mapping + the optimistic-clear-with-snapshot-restore contract +
  the user-modification-dismiss surface + the
  `WsClientProvider` mount + the `trackSession` / `untrackSession`
  lifecycle + the `proposing` slice + the F1 i18n namespace.
  **This task mirrors the same patterns with decompose-specific
  variations.** No public-contract change to the F1 hook /
  component — this task adds a sibling hook + a sibling component.
- **`data_and_methodology.methodology_engine.decomposition_logic`**
  (done — 2026-05-10). Shipped the server-side propose-side
  validator for `propose: decompose` — rules 1
  (parent-node-exists → `'target-entity-not-found'`), 2
  (parent-node-visible → `'illegal-state-transition'`), 3
  (no-conflicting-decompose → `'illegal-state-transition'`), and
  rule 4 (structural shape via Zod). The rule-3 set has since
  widened to `CONFLICTING_PARENT_KINDS` (`decompose`,
  `interpretive-split`, `edit-wording`, `amend-node` — per
  `apps/server/src/methodology/handlers/propose.ts:278-280`); the
  wire shape this task constructs is unchanged. **This task drives
  the validator from the moderator side; the wire contract is
  settled. Rejections surface as `WsRequestError(payload)` with
  `payload.code` set to one of `'target-entity-not-found'` /
  `'illegal-state-transition'` (plus the engine universals
  `'not-a-participant'` / `'sequence-mismatch'` etc. that any
  propose action may trip).**
- **`data_and_methodology.event_types.proposal_events`** (done —
  2026-05-10). Pinned the `decomposeProposalSchema` shape
  (`packages/shared-types/src/events/proposals.ts:168-172`) and the
  shared `proposalComponentSchema`
  (`packages/shared-types/src/events/proposals.ts:155-160` — fields
  `wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH)` and
  `classification: statementKindSchema`). **This task constructs
  payloads conforming to the schema; the API layer's structural
  validator parses them at ingress per ADR 0021.**
- **`backend.websocket_protocol.ws_propose_message`** (done —
  2026-05-11). Shipped the server-side `propose` handler with the
  subscribe-before-act gate, the visibility re-check, the engine
  `validateAction` call, `appendSessionEvent`, the post-commit
  `proposed` ack + `event-applied` broadcast, and the
  `rejectedToApiError`-mapped error path. **This task drives the
  same handler with a `decompose` proposal payload; the wire
  contract is settled — exactly one `proposal` event is appended
  per envelope per `ws_propose_message.md:13`.**
- **`backend.websocket_protocol.ws_message_envelope`** (done —
  `ProposePayload` + `ProposedPayload` types exported from
  `@a-conversa/shared-types`).
- **`backend.websocket_protocol.ws_event_broadcast`** (done — the
  `event-applied` broadcast is what the moderator's own
  `useWsStore.applyEvent` consumes after success; the proposer
  receives it alongside non-proposer subscribers per the
  dual-signal contract).
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore`
  contract).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done —
  exposes the `proposeAction` render-prop slot the new button
  mounts into via the route's conditional swap).
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11).
  Shipped `createWsClient` + `WsClient.send('propose', ...)` +
  `WsClientProvider` + `useWsClient()` + `useWsStore`. The
  provider mount + the `trackSession` lifecycle are reused
  unchanged from `mod_propose_action`'s integration on
  `<OperateRoute>`.
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done
  — commit `05f7d67`). The operate route is reachable from a real
  user flow; this task's propose-decomposition gesture is
  reachable from the same chain extended with the seeded-node +
  the context-menu propose-decompose entry shipped by
  `mod_decompose_mode`.
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()`, the
  parity-check script, the `*.review.json` PENDING-flag lifecycle,
  the per-locale parity round-trip test pattern are all in place;
  new keys flow through the same pipeline).
- **[ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)**
  — the schema-on-write boundary the moderator's send-path crosses.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new component consumes; ICU
  interpolation for the wire-error message template.

Pending edges (this task does NOT depend on them; this task FEEDS
them or is independent of them):

- **`moderator_ui.mod_decompose_flow.mod_interpretive_split_mode`**
  (sibling — `depends !mod_decompose_mode`, NOT this task). The
  interpretive-split flow is structurally analogous to decompose
  with a different proposal kind (per `docs/moderator-ui.md`:
  "Interpretive splits use the same flow with a different proposal
  kind"). Decision §12 records the template parts this task ships
  that interpretive-split will mirror.
- **`moderator_ui.mod_pending_proposals_pane.*`** — downstream
  consumer. The decompose proposal landed by this task's envelope
  surfaces in the pending-proposals pane the same way an F1
  classify-node proposal does (the pane reads
  `useWsStore.sessionState[sessionId].pendingProposals` and renders
  per-kind; the decompose entry will eventually have its own
  per-kind tile + commit affordance — out of scope here).
- **`moderator_ui.mod_decompose_flow.mod_commit_decomposition`**
  (NOT registered in the WBS as a separate task — commit-side
  decomposition flow is gated by the open question flagged in
  `decomposition_logic.md`'s Open Questions section: the
  commit-time multi-event fan-out for decompose has not yet been
  resolved, so a landed decompose proposal cannot currently be
  committed. **This task does NOT lift that block** — it only
  ships the propose-side UI. The pending decompose proposal will
  sit in the pane awaiting the future commit-logic extension).
- **`frontend_i18n.i18n_propose_decomposition_native_review`**
  (registered by this task). The pt-BR + es-419 drafts of the 5
  new keys land flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text.

## What this task is

Land the **propose-decomposition action** — the moderator's deliberate
"submit the captured multi-component decomposition as a `propose:
decompose` envelope" gesture. One affordance reaches the handler:

1. **A "Propose decomposition" button** in the bottom-strip's
   `proposeAction` slot (mode-aware swap from the F1 `<ProposeAction>`).
   Tabbable, click + touch + Enter reachable. Carries a localized
   label + aria-label + a visible `Cmd+Enter` chord hint (the same
   `<kbd>` chip pattern the F1 button uses for shortcut discovery;
   the chord is **informational only in v1** per Decision §8 — the
   per-row textareas in decompose mode do not fire any submit
   gesture; the chip surfaces what the future enhancement will
   land. Decision §8 records the alternative considered).

The button calls `propose()` from the new
`useProposeDecompositionAction()` hook. The hook:

1. **Reads** the four state inputs (`decomposeTargetNodeId`,
   `decomposeComponents`, `proposing`, the URL session id), the WS
   state (`connectionStatus`, `sessionState[sessionId].lastAppliedSequence`),
   and the `WsClient` instance.

2. **Validates** the in-progress decomposition against the four
   gate rules (see Constraints / requirements). On failure, sets
   `validationError` to the localized message key + the offending
   field tag and returns without firing the WS round-trip. The
   inline-error region in `<ProposeDecompositionAction>` renders
   the message.

3. **Constructs** the `propose` envelope per the wire shape
   sketched above. The components array is built by mapping each
   `DecomposeComponent` row to `{ wording: row.text, classification:
   row.classification }` — the store's per-row field is `text` for
   continuity with the F1 textarea's slice name, while the wire
   schema's field is `wording`; the hook does the rename at
   envelope-build time so the store keeps the more natural name
   and the wire stays canonical (Decision §2 records the
   alternative considered — renaming the store slice).

4. **Optimistically clears** the decompose state via
   `useCaptureStore.getState().exitDecomposeMode()` BEFORE the WS
   round-trip resolves (Decision §5). The mode flips to `'idle'`;
   the route's conditional swap re-mounts the F1 slots; the
   moderator's next gesture begins a new F1 capture; the prior
   propose-decomposition is in flight against the server.

5. **Sends** the envelope via `client.send('propose', payload)`.
   One envelope per propose-decomposition (the connecting case
   from F1 is not applicable — a decompose proposal references the
   parent via `parent_node_id` and does not need a paired
   set-edge-substance envelope).

6. **Handles errors** (Decision §7): on `WsRequestError(payload)`
   the hook restores the snapshot of the decompose state from the
   in-memory record it took before the optimistic clear, surfaces
   the wire code + message inline, and logs the error code. The
   moderator can edit the restored decomposition and retry. On
   `WsRequestTimeoutError` the hook surfaces the localized
   timeout-message + restores the snapshot. The error region is
   dismissed on the next successful propose OR on the next
   user-modification of the per-row capture inputs (typing into a
   per-row textarea, picking a classification, adding / removing a
   row).

7. **Does NOT** emit any non-`propose` envelopes. The server-side
   `propose` handler appends exactly one `proposal` event per
   envelope per `ws_propose_message.md:13`. Structural
   entity-creation events (`node-created` for each component +
   `entity-included` per component) are commit-time effects per
   the open question in `decomposition_logic.md`'s Open Questions
   section; they do NOT fire on propose. This task does NOT
   construct or wait for any of those events.

The keyboard path (Cmd/Ctrl+Enter) is **not wired in v1** per
Decision §8 — the per-row textareas in decompose mode don't fire
any submit gesture by the predecessor's design (`mod_multi_component_capture`
Decision §6: "the per-row textarea's keydown handler is absent;
plain Enter inserts a newline; Cmd/Ctrl+Enter inserts a newline").
The `<kbd>` chip on the button shows the chord that the future
enhancement will land; the button click is the only submit path
in v1.

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_decompose_flow` (the parent block) cannot close without
   it.** The parent task `mod_decompose_flow` is open while any
   leaf is incomplete. Of its four leaves, two are done
   (`mod_decompose_mode` + `mod_multi_component_capture` — both
   2026-05-16), one is independent
   (`mod_interpretive_split_mode` — depends on
   `mod_decompose_mode` only, structurally analogous), and this
   is the last main-path leaf. Closing it closes the F2 decompose
   main path; the parent block stays open only until
   `mod_interpretive_split_mode` follows the template.

2. **The F2 flow stops at capture without this task.** The
   moderator-UI mode-entry seam landed 2026-05-16; the
   multi-component capture grid landed 2026-05-16; but the
   operator currently enters decompose mode, fills the rows, and
   stares at the F1 `<ProposeAction>` button which is bound to the
   F1 capture-store slices (`text`, `classification`,
   `targetEntityId`, `edgeRole`) — all of which were cleared on
   decompose-mode entry (per `mod_decompose_mode` Decision §6 and
   `captureStore.ts:282-298`). The F1 button's validation gate
   immediately fires `text-empty` and the button is disabled; the
   operator has no path to submit the captured decomposition. This
   task closes the gap: in decompose mode, the slot swaps to the
   decomposition-aware button, the validation gate reads
   `decomposeComponents` instead of the F1 slices, and the
   `propose: decompose` envelope can finally leave the client.

3. **The server-side validator has been waiting for two weeks.**
   `decomposition_logic` (the server-side validator) landed
   2026-05-10 and has had no real moderator-UI client driving it —
   only the Vitest + Cucumber suites in the server workspace
   exercise it today. Landing this task gives the validator its
   first real UI consumer and exercises the full chain — envelope
   construction → serialization → wire → server's `propose`
   handler → `appendSessionEvent` → post-commit emit → client's
   `applyEvent` reducer → store update → optimistic-clear
   completion. The integration is the load-bearing proof that the
   propose-side decompose pipeline is complete end-to-end.

Downstream, the future `mod_interpretive_split_mode` task mirrors
this task's exact shape with a different proposal sub-kind
(`interpretive-split` instead of `decompose`); the
`mod_pending_proposals_pane.*` subgroup reads the
`pendingProposals` slice that this task's envelope feeds. The
eventual commit-time decompose extension (currently flagged as the
open question in `decomposition_logic.md`'s Open Questions) is
gated on this task in the sense that it cannot exercise a
committed decompose without an existing pending decompose to act
on; this task is the upstream feed.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- `apps/moderator/src/stores/captureStore.ts:154` — the
  `decomposeTargetNodeId: string | null` slice the hook reads for
  the envelope's `parent_node_id` field.
- `apps/moderator/src/stores/captureStore.ts:172` — the
  `decomposeComponents: ReadonlyArray<DecomposeComponent>` slice
  the hook reads + maps to the envelope's `components` field
  (with the per-row `text → wording` rename per Decision §2).
- `apps/moderator/src/stores/captureStore.ts:86-92` — the
  `validateDecomposeComponents(components)` free function the hook
  calls as the only user-correctable validation gate. The function
  returns `true` iff every row has non-empty trimmed text AND
  non-null classification AND the array length is in `[2, 10]`.
- `apps/moderator/src/stores/captureStore.ts:142` — the
  `proposing: boolean` slice the hook flips during the round-trip.
  Already extended by `mod_propose_action`; this task reuses the
  same slice (Decision §5 records the rationale for
  reuse-over-mint).
- `apps/moderator/src/stores/captureStore.ts:299-307` — the
  `exitDecomposeMode(): void` atomic helper. Sets
  `mode = 'idle'`, `decomposeTargetNodeId = null`,
  `decomposeComponents = []` in a single `set()`. The hook calls
  this on success (optimistic) and on rejection-of-rejection-restore.
- `apps/moderator/src/stores/captureStore.ts:282-298` — the
  `enterDecomposeMode(nodeId)` atomic helper. Called by the
  snapshot-restore path on error to re-mount decompose mode with
  the restored target node id (per Decision §6 the restore
  strategy is `enterDecomposeMode` + per-row setter replay rather
  than a raw `setState` that would bypass the helper's seed-rows
  invariant).
- `apps/moderator/src/layout/useProposeAction.ts:120-128` — the
  `useProposeErrorStore` module-scoped Zustand slice. This task
  mints a parallel `useProposeDecompositionErrorStore` of the
  same shape (Decision §11).
- `apps/moderator/src/layout/useProposeAction.ts:144-156` — the
  `randomUuid()` helper. **NOT consumed by this task** — the
  decompose proposal payload carries no client-minted ids; the
  `parent_node_id` is the existing parent's id (from
  `decomposeTargetNodeId`); the component nodes' ids are minted
  server-side at commit time per the open question in
  `decomposition_logic.md`. The hook does not call
  `crypto.randomUUID()` at all.
- `apps/moderator/src/layout/useProposeAction.ts:195-206` — the
  `toWireError(err, timeoutText)` mapping helper. Re-exported from
  `useProposeAction.ts` and consumed by the new hook (Decision §11
  records the helper-reuse-vs-duplication choice).
- `apps/moderator/src/layout/useProposeAction.ts:208-407` — the
  F1 hook structure: read slices → validate → in-flight guard →
  optimistic clear → snapshot → send → success path / error path
  → snapshot restore. The new hook mirrors this exact shape with
  the four substitutions: (a) the four F1 slices become the two
  decompose slices, (b) the F1 validation gates become the four
  decompose gates, (c) the F1 `reset()` call becomes
  `exitDecomposeMode()`, (d) the F1 sequential-two-envelope wire
  shape collapses to one envelope.
- `apps/moderator/src/layout/ProposeAction.tsx:102-171` — the F1
  button component structure: outer group + button + key-chip +
  validation-error region + wire-error region. The new component
  mirrors this exact shape with a different localized label, a
  different testid namespace, and a different hook.
- `apps/moderator/src/routes/Operate.tsx:160` — the F1
  `<ProposeAction />` mount in the `proposeAction` slot. The
  swap-on-mode change lands at this exact line:
  `proposeAction={isDecomposeMode ? <ProposeDecompositionAction /> : <ProposeAction />}`.
- `apps/moderator/src/routes/Operate.tsx:113-114` — the `mode` /
  `isDecomposeMode` reads already in place from
  `mod_multi_component_capture`. Reused unchanged.
- `apps/moderator/src/ws/client.ts` — `WsClient.send('propose',
  payload)`. The typed call (the F1 hook uses it; this hook uses
  the same surface). Returns a Promise that resolves with the
  `proposed` ack envelope or rejects with `WsRequestError` /
  `WsRequestTimeoutError`.
- `apps/moderator/src/ws/wsStore.ts` — the
  `sessionState[sessionId].lastAppliedSequence` field the hook
  reads for the `expectedSequence` token. Same surface F1 reads.
- `apps/moderator/src/ws/WsClientProvider.tsx` — the
  `useWsClient()` hook. Already mounted on `<OperateRoute>` by
  `mod_propose_action`; unchanged by this task.
- `packages/shared-types/src/ws-envelope.ts` — `ProposePayload` +
  `ProposedPayload` (the wire types).
- `packages/shared-types/src/events/proposals.ts:155-160` — the
  shared `proposalComponentSchema = z.object({ wording:
  z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH), classification:
  statementKindSchema })`. The hook's per-row map produces objects
  conforming to this shape.
- `packages/shared-types/src/events/proposals.ts:168-172` — the
  `decomposeProposalSchema = z.object({ kind: z.literal('decompose'),
  parent_node_id: z.string().uuid(), components:
  z.array(proposalComponentSchema).min(2).max(10) })`. The hook's
  envelope construction produces an object conforming to this
  schema.
- `apps/server/src/methodology/handlers/propose.ts:278-280` — the
  `CONFLICTING_PARENT_KINDS` set the server-side validator's
  rule-3 walker uses. Documents the rejection-shape clients should
  surface (`'illegal-state-transition'` with a detail naming the
  conflicting proposal).
- `apps/server/src/methodology/handlers/propose.ts:312-356` — the
  `validateDecomposeProposal` server-side validator. Documents the
  three rules + the rejection codes that will surface as
  `WsRequestError.code` on the wire.
- `apps/moderator/src/layout/BottomStripCapture.tsx:48-49, 86-91` —
  the `proposeAction` slot the swap targets. Unchanged.
- `apps/moderator/src/layout/DecomposeComponentsGrid.tsx:46-91` —
  the predecessor's grid component. Unchanged. The hook does not
  interact with the grid directly; the grid writes the slice the
  hook reads.
- `tests/e2e/moderator-capture.spec.ts` — the canonical regression
  home for the moderator capture flow. The new e2e test joins
  the existing blocks (the F1 propose test from
  `mod_propose_action`, the multi-component capture test from
  `mod_multi_component_capture`, the mode-entry test from
  `mod_decompose_mode`); Decision §9 records the spec extension
  + the full-chain compose-stack scope.
- `tests/e2e/fixtures/wsStoreSeed.ts` — `seedWsStore({ sessionId,
  nodes: [...] })` and the `__aConversaWsStore` reachability
  helper. Reused unchanged from the predecessor e2e blocks.
- `tests/e2e/fixtures/auth.ts` — `loginAs(page, { username })`.
  Reused unchanged.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — the catalog
  file the new `moderator.decompose.propose.*` namespace lands in,
  sibling to the existing `moderator.decompose.{exit, banner,
  components}.*` blocks shipped by the predecessors.

DESIGN.md / docs consulted:

- `DESIGN.md` (F2 decompose flow section) — the design intent for
  the propose-decomposition step.
- `docs/moderator-ui.md` (F2 decompose flow) — step 4: "**Propose
  the decomposition**" follows step 3 ("Capture each component").
  This task owns step 4.
- `docs/methodology.md` (decomposition section) — "Decomposition is
  a first-class methodological move, not a fallback." The propose
  is the methodology's primary tool for resolving classification
  disputes; landing this task gives the methodology its first live
  UI surface for the decompose move.
- `docs/data-model.md` (visible-graph derivation + proposal
  lifecycle) — the propose envelope writes a `proposal` event;
  the parent's visibility flips on commit, not propose.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
  — the schema-on-write boundary the moderator's send-path crosses.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — `useTranslation()` + ICU interpolation for the wire-error
  message template.
- [`mod_multi_component_capture.md`](mod_multi_component_capture.md)
  — the predecessor; the slice shape + the validator + the
  per-row `text` field name this task maps to `wording` at
  envelope-build time.
- [`mod_decompose_mode.md`](mod_decompose_mode.md) — the
  mode-entry seam + the `decomposeTargetNodeId` slice + the
  `enterDecomposeMode` / `exitDecomposeMode` atomic helpers this
  task calls on success / restore.
- [`mod_propose_action.md`](mod_propose_action.md) — the F1
  propose-action capstone pattern; this task mirrors the hook +
  component + error-store + snapshot-restore + dismissal +
  in-flight-slice patterns.
- [`mod_state_management.md`](mod_state_management.md) —
  `useCaptureStore` contract.
- [`mod_bottom_strip_capture.md`](mod_bottom_strip_capture.md) —
  the scaffold's `proposeAction` slot.
- [`mod_ws_client.md`](mod_ws_client.md) — the WS client surface +
  the `WsClientProvider` mount pattern.
- [`ws_propose_message.md`](../backend/ws_propose_message.md) —
  the server-side propose handler this task drives + the
  one-event-per-envelope contract on line 13.
- [`proposal_events.md`](../data-and-methodology/proposal_events.md)
  — the proposal sub-kind discriminated union; the
  `decompose` arm's wire shape.
- [`decomposition_logic.md`](../data-and-methodology/decomposition_logic.md)
  — the server-side methodology validator + the open question
  about commit-time fan-out (this task does NOT lift the commit
  block).

No new ADR is required (see Decision §10). No new external runtime
dependency lands. No public type signatures change on the store or
the WS client. The only new public surfaces are the new hook +
component exports and the 5 new i18n catalog keys.

## Constraints / requirements

### Hook shape — `useProposeDecompositionAction()`

- **New file** `apps/moderator/src/layout/useProposeDecompositionAction.ts`
  exporting `function useProposeDecompositionAction(): UseProposeDecompositionActionResult`.
- **Return shape**:
  ```ts
  export interface UseProposeDecompositionActionResult {
    /** Trigger the propose round-trip. Idempotent during the in-flight window. */
    propose: () => Promise<void>;
    /** True when all four gates pass and no propose is in flight. */
    canPropose: boolean;
    /** The localized message-key + field-tag of the failing gate, or null. */
    validationError: DecomposeValidationErrorReason | null;
    /** True while a propose round-trip is in flight. */
    inFlight: boolean;
    /** The wire-error code + localized message from the last failed propose, or undefined. */
    lastError: WireError | undefined;
  }

  export type DecomposeValidationErrorReason =
    | 'session-missing'
    | 'not-connected'
    | 'target-missing'
    | 'components-invalid';

  // `WireError` re-exported from `useProposeAction.ts` (Decision §11).
  ```
- **Store reads** (each as a separate `useCaptureStore(selector)`
  subscription so React re-renders only when the relevant slice
  changes):
  ```ts
  const decomposeTargetNodeId = useCaptureStore((s) => s.decomposeTargetNodeId);
  const decomposeComponents = useCaptureStore((s) => s.decomposeComponents);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);
  ```
- **Other reads**:
  ```ts
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();
  ```
- **Error-slice reads** (the module-scoped store the hook owns):
  ```ts
  const lastError = useProposeDecompositionErrorStore((s) => s.lastError);
  const setLastError = useProposeDecompositionErrorStore((s) => s.setLastError);
  ```

### Validation gate (four rules, in order)

Decision §4 records the rationale; the rule body lives in the hook:

```ts
function validate(): DecomposeValidationErrorReason | null {
  if (sessionId === '') return 'session-missing';
  if (connectionStatus !== 'open') return 'not-connected';
  if (decomposeTargetNodeId === null) return 'target-missing';
  if (!validateDecomposeComponents(decomposeComponents)) return 'components-invalid';
  return null;
}
```

- `session-missing` — defensive; the URL didn't provide a session id.
  Unreachable in normal flow.
- `not-connected` — the WS client is not in `'open'` status. The
  button is disabled in this state; the inline error reads
  `"Cannot propose decomposition — WebSocket disconnected.
  Reconnecting…"`.
- `target-missing` — defensive; the route mounts the
  decomposition button only in `mode === 'decompose'`, and entering
  decompose always sets `decomposeTargetNodeId` atomically. The
  gate exists for type-narrowing + defense against direct mode
  manipulation (e.g., a test that calls `setMode('decompose')`
  without going through `enterDecomposeMode`).
- `components-invalid` — the only user-correctable gate. The
  upstream `validateDecomposeComponents` free function carries the
  truth: returns `true` iff every row has non-empty trimmed text
  AND non-null classification AND the array length is in `[2, 10]`.
  When this gate fires the inline error reads
  `"Cannot propose decomposition — every component needs wording
  and a classification (2-10 rows)."` — Decision §4 records the
  decision to surface a single message for the whole gate rather
  than enumerating which row violates which sub-rule.

Methodology validation (does the parent still exist + is it still
visible + is no other decompose / interpretive-split / edit-wording /
amend-node pending) is the engine's responsibility, NOT this
task's. The server returns `RejectedValidationResult` on engine
rejection; the hook surfaces the wire-code error in `lastError`
(`'target-entity-not-found'` / `'illegal-state-transition'` /
the engine universals).

### Wire-shape — exactly one `propose` envelope per call

Per Decision §1, this task emits **one `propose` envelope per
`propose()` call**:

```json
{
  "type": "propose",
  "id": "<client-uuid>",
  "payload": {
    "sessionId": "<URL session id>",
    "expectedSequence": <lastAppliedSequence-at-call-time>,
    "proposal": {
      "kind": "decompose",
      "parent_node_id": "<decomposeTargetNodeId>",
      "components": [
        { "wording": "<row[0].text>", "classification": "<row[0].classification>" },
        { "wording": "<row[1].text>", "classification": "<row[1].classification>" },
        // ...N rows, 2 ≤ N ≤ 10
      ]
    }
  }
}
```

The server's `propose` handler appends exactly one event on success
— the `proposal` event itself per `ws_propose_message.md:13`.
Structural entity-creation events (`node-created` per component +
`entity-included` per component) are commit-time effects; they do
NOT fire on propose, and per the open question in
`decomposition_logic.md`'s Open Questions section, decompose
commits are currently blocked by `commit_logic`'s structural
sub-kind rejection. The decompose proposal lands in the
session's event log + the pending-proposals projection but cannot
be committed until the commit-side extension lands. This task
does NOT verify the server's emission shape; that's pinned by
`ws_propose_message`'s + `decomposition_logic`'s test suites.

### Component build-time `text → wording` rename

The store's per-row field is named `text` for continuity with the
F1 `<CaptureTextInput>`'s slice (`captureStore.ts:44-47:
`DecomposeComponent { text: string; classification: StatementKind | null }`).
The wire schema's per-component field is `wording`
(`proposalComponentSchema.wording` at
`packages/shared-types/src/events/proposals.ts:158`). The hook
does the rename at envelope-build time:

```ts
const components = decomposeComponents.map((row) => ({
  wording: row.text,
  classification: row.classification!, // narrowed by validateDecomposeComponents
}));
```

Decision §2 records the alternative considered (renaming the store
slice's `text` field to `wording` to match the wire) and why the
rename-at-build-time is the cheaper choice.

### Optimistic clear semantics (Decision §5)

The hook captures a snapshot of the decompose state BEFORE
clearing. On any error path, the snapshot is restored:

```ts
const snapshot = {
  decomposeTargetNodeId: decomposeTargetNodeIdNow,
  decomposeComponents: decomposeComponentsNow,
};
setProposing(true);
useCaptureStore.getState().exitDecomposeMode();
try {
  await sendEnvelope();
  setProposing(false);
  setLastError(undefined);
} catch (err) {
  // Restore: re-enter decompose mode (seeds two empty rows + sets
  // target), then per-row replay the snapshot's components. The
  // per-row replay uses `setDecomposeComponentText` and
  // `setDecomposeComponentClassification` + `addDecomposeComponent`
  // as needed to reach the snapshot's row count.
  if (snapshot.decomposeTargetNodeId !== null) {
    useCaptureStore.getState().enterDecomposeMode(snapshot.decomposeTargetNodeId);
    const targetLength = snapshot.decomposeComponents.length;
    // enterDecomposeMode seeds 2 empty rows; add more to reach the
    // snapshot length.
    for (let i = 2; i < targetLength; i += 1) {
      useCaptureStore.getState().addDecomposeComponent();
    }
    // Write per-row text + classification.
    snapshot.decomposeComponents.forEach((row, index) => {
      useCaptureStore.getState().setDecomposeComponentText(index, row.text);
      useCaptureStore.getState().setDecomposeComponentClassification(
        index,
        row.classification,
      );
    });
  }
  useCaptureStore.getState().setProposing(false);
  const timeoutText = t('moderator.decompose.propose.timeoutError');
  setLastError(toWireError(err, timeoutText));
}
```

The snapshot is the in-memory `snapshot` const above; it does NOT
persist across page reloads (the moderator can retry within the
same page-load but not across a hard refresh — same trade-off as
the F1 hook).

Decision §6 records the alternatives surveyed for the
restore-shape choice (one raw `setState` write vs. one
`enterDecomposeMode` + N per-row setter calls — chosen the
helper-driven path because it preserves the
`enterDecomposeMode`'s atomic invariants and avoids reaching past
the store's public API).

### Error handling (Decision §7)

The hook surfaces wire errors as inline messages, NOT as toasts or
modals (same Decision §6 rationale as F1):

- `WsRequestError(payload)` — the server returned a typed `error`
  envelope correlated to the propose request. The hook reads
  `payload.code` + `payload.message` and writes them to
  `lastError`. The inline region renders
  `t('moderator.decompose.propose.wireError', { code, message })`.
  Notable expected codes for this surface: `'target-entity-not-found'`
  (the parent no longer exists), `'illegal-state-transition'`
  (the parent is no longer visible OR another decompose /
  interpretive-split / edit-wording / amend-node is pending),
  `'not-a-participant'` (the engine universal — shouldn't happen in
  normal flow since only participants reach the moderator route),
  `'sequence-mismatch'` (the engine universal — the local sequence
  drifted from the server's).
- `WsRequestTimeoutError(type, id)` — the request timed out
  (default 10s per the WS client). The hook surfaces the localized
  `t('moderator.decompose.propose.timeoutError')` message.
- Any other `Error` — surfaces as
  `t('moderator.decompose.propose.unknownError', { message: err.message })`.

The error region is dismissed on the next successful propose OR
on the next user-modification of the per-row capture inputs
(typing into a per-row textarea via `setDecomposeComponentText`,
picking a classification via `setDecomposeComponentClassification`,
adding a row via `addDecomposeComponent`, removing a row via
`removeDecomposeComponent`). Decision §7 records the dismissal
detection: the hook captures a snapshot baseline of
`decomposeComponents` (by reference) at the moment `lastError`
was set; subsequent renders where `decomposeComponents` is a
different reference (the per-row mutators all `map`/`concat`/`filter`
into a new array per `mod_multi_component_capture` Constraints —
"All four mutators produce a new array") dismiss the region.

### In-flight state surfacing (Decision §5)

The shared `proposing: boolean` slice carries the in-flight
signal. The hook's `inFlight` boolean drives:

- **The button's `disabled` attribute** — disabled during the
  round-trip so a double-click does not fire a duplicate.
- **The button's visible label** — switches from
  `t('moderator.decompose.propose.label')` ("Propose decomposition")
  to `t('moderator.decompose.propose.inFlightLabel')`
  ("Proposing decomposition…") with no spinner glyph (the F1
  button shipped without a spinner per its Constraints; this task
  matches).
- **The per-row inputs are NOT disabled**. The moderator may be
  refining a row's wording mid-flight; disabling the inputs would
  steal focus and break the chain. The `inFlight` slice is the
  signal future surfaces (toast, retry banner) consume; v1 ships
  optimistic clear with no input disable.

### Button placement (Decision §3)

The button mounts into the existing `bottom-strip-propose-action`
slot via a route-level conditional swap on `mode`:

```tsx
proposeAction={isDecomposeMode ? <ProposeDecompositionAction /> : <ProposeAction />}
```

The swap mirrors the three existing conditional ternaries on
`textInput` / `classificationPalette` / `edgeRoleSelector` shipped
by `mod_multi_component_capture` (`Operate.tsx:147-159`). The F1
`<ProposeAction />` is unmounted in decompose mode; its
`useProposeAction()` subscriptions disconnect; the F1
`useProposeErrorStore`'s `lastError` is preserved across the
unmount but the surface is gone — the next time the moderator
exits decompose mode and an F1 wire error is still stale, the
inline region re-mounts with the error visible (Decision §11
records this as acceptable — the error is for the prior F1
propose, not a current action, and the moderator's next gesture
in F1 dismisses it).

### Component shape — `<ProposeDecompositionAction>`

- **New file** `apps/moderator/src/layout/ProposeDecompositionAction.tsx`
  exporting `function ProposeDecompositionAction(): ReactElement`
  (named export, no default).
- **Single root element** wrapping a `<div role="group" ...>` with
  the button + inline error regions inside. The consumer drops
  the component directly into `<BottomStripCapture>`'s
  `proposeAction` slot.
- **Stable test ids**:
  - `propose-decomposition-action` — outer wrapper element.
  - `propose-decomposition-action-button` — the click-to-submit
    button.
  - `propose-decomposition-action-key-chip` — the informational
    `<kbd>` chip showing `⌘+Enter` / `Ctrl+Enter` (Decision §8 —
    informational only in v1; the chord doesn't fire from
    decompose mode by the predecessor's design).
  - `propose-decomposition-action-validation-error` — inline error
    region for validation-failed messages (visible only when
    `validationError !== null`); `role="status"`.
  - `propose-decomposition-action-wire-error` — inline error region
    for server-side wire errors after a round-trip (visible only
    when `lastError !== undefined`); `role="alert"`.
- **No props.** The component reads everything from hooks
  (`useProposeDecompositionAction()`).
- **Tailwind styling** matches the F1 button (blue-700 primary
  action + white-on-blue chip + red-700 error region). WCAG AA:
  same contrast ratios as F1.

### i18n catalog keys

Five new keys under a new `moderator.decompose.propose.*`
sub-namespace. Naming follows the precedent
(`moderator.decompose.{exit, banner, components}.*` for sub-namespace
within `moderator.decompose.*`; `moderator.proposeAction.*` for
the F1 button's analogous keys).

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.decompose.propose.label` | "Propose decomposition" | "Propor decomposição" | "Proponer descomposición" |
| `moderator.decompose.propose.inFlightLabel` | "Proposing decomposition…" | "Propondo decomposição…" | "Proponiendo descomposición…" |
| `moderator.decompose.propose.ariaLabel` | "Propose the captured decomposition as a proposal on the graph" | "Propor a decomposição capturada como uma proposta no grafo" | "Proponer la descomposición capturada como propuesta en el grafo" |
| `moderator.decompose.propose.validationError` | "Cannot propose decomposition: {reason}" | "Não foi possível propor a decomposição: {reason}" | "No se puede proponer la descomposición: {reason}" |
| `moderator.decompose.propose.wireError` | "Propose decomposition failed: {message} ({code})" | "Falha ao propor decomposição: {message} ({code})" | "Falló al proponer descomposición: {message} ({code})" |

Plus five reason-keys for the `{reason}` ICU interpolation:

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.decompose.propose.reason.sessionMissing` | "no session is loaded" | "nenhuma sessão carregada" | "no hay sesión cargada" |
| `moderator.decompose.propose.reason.notConnected` | "the session is not connected — reconnecting…" | "a sessão não está conectada — reconectando…" | "la sesión no está conectada — reconectando…" |
| `moderator.decompose.propose.reason.targetMissing` | "no parent node selected for decomposition" | "nenhum nó pai selecionado para decomposição" | "no hay nodo padre seleccionado para la descomposición" |
| `moderator.decompose.propose.reason.componentsInvalid` | "every component needs wording and a classification (2–10 rows)" | "cada componente precisa de texto e classificação (2–10 linhas)" | "cada componente necesita texto y clasificación (2–10 filas)" |
| `moderator.decompose.propose.timeoutError` | "The propose decomposition request timed out. Check your connection and try again." | "A solicitação de proposta de decomposição expirou. Verifique sua conexão e tente novamente." | "La solicitud de proponer descomposición expiró. Verifica tu conexión y vuelve a intentarlo." |

**Total count: 5 chrome keys + 5 reason/aux keys = 10 keys × 3
locales = 30 catalog entries**. The pt-BR + es-419 drafts (20
entries) land flagged PENDING in `pt-BR.review.json` +
`es-419.review.json` (20 PENDING entries). en-US is authoritative.

The shortcut chord glyph (`Cmd+Enter` / `Ctrl+Enter`) on the
`<kbd>` chip is **not localized** per
`i18n_keyboard_shortcuts_policy`'s "non-methodology shortcuts stay
as-is across locales" clause. The component renders the glyph via
the same platform-detection branch the F1 button uses
(`ProposeAction.tsx:87-100`).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/layout/useProposeDecompositionAction.ts` (new
  — the hook + the module-scoped error store + a small
  `resetProposeDecompositionError()` test seam).
- `apps/moderator/src/layout/useProposeDecompositionAction.test.tsx`
  (new — Vitest cases for the hook in isolation).
- `apps/moderator/src/layout/ProposeDecompositionAction.tsx` (new —
  the button + error-region component).
- `apps/moderator/src/layout/ProposeDecompositionAction.test.tsx`
  (new — Vitest cases for the component).
- `apps/moderator/src/routes/Operate.tsx` (modified — one
  conditional ternary on the `proposeAction` slot; update the
  leading Refinement comment to reference
  `mod_propose_decomposition.md`).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 10
  new keys under `moderator.decompose.propose.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 10 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — new `test()`
  block under the existing `test.describe('moderator capture flow', ...)`
  group, immediately after the `mod_multi_component_capture`
  block).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_propose_decomposition`
  lands at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_propose_decomposition_native_review` task to
  `tasks/35-frontend-i18n.tji`.
- `docs/adr/` — no new ADR (Decision §10).
- `apps/moderator/src/stores/captureStore.ts` — the store contract
  is already complete for this task's needs (the
  `decomposeTargetNodeId` slice, the `decomposeComponents` slice,
  the `proposing` slice, the `validateDecomposeComponents`
  function, the `enterDecomposeMode` / `exitDecomposeMode` helpers
  are all in place). No store change.
- `apps/moderator/src/layout/useProposeAction.ts` — the F1 hook is
  consumed unchanged. The `toWireError` helper + the `WireError`
  type are re-exported from `useProposeAction.ts` for this hook's
  consumption (Decision §11); the helper file itself stays as the
  canonical home.
- `apps/moderator/src/layout/ProposeAction.tsx` — the F1 button is
  unchanged; the route's conditional swap drops it from the slot
  in decompose mode.
- `apps/moderator/src/layout/DecomposeComponentsGrid.tsx` — the
  grid is unchanged; the hook reads the slice the grid writes.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — the
  scaffold's `proposeAction` slot is unchanged; the route's
  conditional swap is what changes the slot's content.
- `apps/moderator/src/ws/client.ts` — the `WsClient.send` surface
  is consumed unchanged.
- `apps/moderator/src/ws/wsStore.ts` — `lastAppliedSequence` is
  read; the store is not extended.
- `apps/moderator/src/ws/WsClientProvider.tsx` — already mounted
  on `<OperateRoute>` by `mod_propose_action`; unchanged.
- `apps/server/src/` — no server-side change. The propose handler
  + the `validateDecomposeProposal` validator are shipped by
  `ws_propose_message` + `decomposition_logic`.
- `packages/shared-types/` — no schema change. The propose
  envelope + the proposal-payload discriminated union (including
  the `decompose` arm) are already settled.

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 14 new across the two new test
  files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after
  the catalog edits — every `moderator.decompose.propose.*` key
  present in en-US is present in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green against a freshly brought-up
  dev compose stack; the new propose-decomposition scenario in
  `tests/e2e/moderator-capture.spec.ts` passes against the real
  server.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_propose_decomposition` AND
  the new `i18n_propose_decomposition_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The propose-decomposition gesture is reachable from a real user
flow as of this task: the moderator can log in → create session →
bridge lobby → operate → seed a node via `__aConversaWsStore` →
right-click → "Propose decompose" → fill the multi-component grid
→ click the propose-decomposition button. Per the UI-stream e2e
policy default, the Playwright e2e is **scoped under Acceptance
criteria, NOT deferred**.

**Decision §9 picks option (b)** — drive the real dev compose stack
rather than mocking the WS boundary. The compose stack is already
up for the predecessor specs; extending it with the
propose-decomposition round-trip is the natural next step. The
Playwright spec asserts the full chain: enter decompose mode →
fill 2 rows → click propose → propose envelope hits server →
`event-applied` broadcast lands in `useWsStore.sessionState[id].events`
(checked by reading the dev-only `window.__aConversaWsStore` seam
the predecessor specs use, the same pattern as the F1 propose e2e
in `mod_propose_action.md`'s Acceptance §13) → mode flips back to
`'idle'` (the decompose grid unmounts, the F1 capture text input
re-mounts).

## Acceptance criteria

### 1. The `<ProposeDecompositionAction>` component renders inside the bottom-strip slot in decompose mode

- `<ProposeDecompositionAction>` component under
  `apps/moderator/src/layout/ProposeDecompositionAction.tsx`
  renders a `<div role="group" data-testid="propose-decomposition-action">`
  containing a `<button data-testid="propose-decomposition-action-button">`
  with a `<kbd data-testid="propose-decomposition-action-key-chip">`
  chord chip.
- The button is reachable via
  `screen.getByRole('button', { name: /Propose decomposition/ })`
  in en-US.
- `OperateRoute` passes `<ProposeDecompositionAction />` (not
  `<ProposeAction />`) into `<BottomStripCapture>`'s `proposeAction`
  prop **when** `mode === 'decompose'`.
- `OperateRoute` passes `<ProposeAction />` (the F1 component) into
  the slot when `mode !== 'decompose'`. The route-level conditional
  swap mirrors the three existing `mod_multi_component_capture`
  ternaries.

### 2. Validation gate (four rules)

- With `decomposeTargetNodeId === null`, the button has the
  `disabled` attribute set; `aria-disabled="true"`; the
  validation-error region renders the localized `target-missing`
  reason.
- With `decomposeTargetNodeId` set + `decomposeComponents === []`,
  the button is disabled; the validation-error region renders the
  localized `components-invalid` reason.
- With `decomposeTargetNodeId` set + two empty rows
  (`decomposeComponents = [{ text: '', classification: null }, {
  text: '', classification: null }]` — the
  `enterDecomposeMode`-seeded state), the button is disabled; the
  validation-error region renders `components-invalid`.
- With `decomposeTargetNodeId` set + two rows each having
  non-empty text and non-null classification, the button is
  enabled; no validation-error region renders.
- With `connectionStatus !== 'open'`, the button is disabled; the
  validation-error region renders the localized `not-connected`
  reason.

### 3. Successful propose round-trip

- Pre-state: `mode='decompose'`,
  `decomposeTargetNodeId='<parent-uuid>'`,
  `decomposeComponents=[{text:'A',classification:'fact'}, {text:'B',classification:'value'}]`,
  `useWsStore.sessionState['<sid>'].lastAppliedSequence=3`.
- Click the propose button. Assert:
  - exactly one `propose` envelope is sent through the WS client
    (asserted via spy);
  - the envelope's payload is
    `{ sessionId: '<sid>', expectedSequence: 3, proposal: { kind:
    'decompose', parent_node_id: '<parent-uuid>', components: [{
    wording: 'A', classification: 'fact' }, { wording: 'B',
    classification: 'value' }] } }`;
  - immediately (BEFORE the `proposed` ack resolves) the capture
    store transitions: `mode === 'idle'`,
    `decomposeTargetNodeId === null`,
    `decomposeComponents === []`, `proposing === true`;
  - on the `proposed` ack resolve, `proposing === false`,
    `lastError === undefined`.

### 4. Error path: validation rejection from server

- Pre-state: valid two-row decomposition.
- The WS client's `send` is stubbed to reject with
  `WsRequestError({ code: 'illegal-state-transition', message:
  'parent already superseded' })`.
- Click propose. Assert:
  - after the rejection, `useCaptureStore.getState()` has
    `mode === 'decompose'`,
    `decomposeTargetNodeId === '<parent-uuid>'`,
    `decomposeComponents` deep-equals the pre-state's array
    (the snapshot was restored via
    `enterDecomposeMode` + per-row replay);
  - `lastError.code === 'illegal-state-transition'`;
  - the inline `propose-decomposition-action-wire-error` region
    renders the localized `wireError` message with the wire code
    + message;
  - `proposing === false`.

### 5. Error path: timeout

- The WS client's `send` is stubbed to reject with
  `WsRequestTimeoutError('propose', '<id>')`.
- After the rejection: the capture store is restored, the inline
  error region renders the localized `timeoutError` message,
  `proposing` is `false`.

### 6. Error dismissal

- After a failed propose (wire-error region visible), the
  moderator types into row 0's textarea (via
  `setDecomposeComponentText(0, 'updated')`). Assert the
  wire-error region disappears (the
  `decomposeComponents` array reference changed).
- After a failed propose, the moderator clicks a per-row
  classification (via `setDecomposeComponentClassification`).
  Assert the wire-error region disappears.
- After a failed propose, clicking the per-row add or remove
  button dismisses the region.
- After a failed propose, a subsequent successful propose clears
  the region.

### 7. In-flight state

- During the round-trip (before the ack resolves):
  - `proposing === true` on the capture store;
  - the button's `disabled` attribute is set;
  - the button's text is the localized `inFlightLabel`
    ("Proposing decomposition…");
  - the per-row textareas + classification pickers are NOT
    disabled (the operator can edit a row mid-flight; v1 doesn't
    disable the inputs per Decision §5).

### 8. Concurrent re-entry guard

- During the round-trip, calling `propose()` a second time (e.g.,
  via a double-click on the button) is a no-op — no second
  envelope is sent (asserted via spy that exactly one
  `client.send` call was made).

### 9. WBS-level mode-aware swap

- When `mode === 'idle'` initially, the `proposeAction` slot
  renders `<ProposeAction>` (F1).
- After `enterDecomposeMode('<parent-uuid>')`, the slot renders
  `<ProposeDecompositionAction>`.
- After `exitDecomposeMode()`, the slot renders `<ProposeAction>`
  again.

### 10. Vitest cases (per ADR 0022)

Minimum **14 new cases** across the two new test files (the exact
distribution below is the floor; the implementer may add cases
as the implementation suggests them):

**`apps/moderator/src/layout/ProposeDecompositionAction.test.tsx`
(≥ 6 cases):**

1. **Renders the component with all five testids when validation
   gates pass + connected**.
2. **Localized button label + ariaLabel + key-chip glyph resolve**
   — every `t(...)` call resolves to a non-key string.
3. **Validation-error region renders when components-invalid
   fires** — empty rows present.
4. **Wire-error region renders when `lastError !== undefined`**.
5. **Button is disabled during in-flight**.
6. **Button click invokes the hook's `propose()`**.

**`apps/moderator/src/layout/useProposeDecompositionAction.test.tsx`
(≥ 8 cases):**

1. **`canPropose === false` + `validationError === 'components-invalid'`
   on the seeded empty-row state**.
2. **`canPropose === true` + `validationError === null` on two
   valid rows + target set + connected**.
3. **Successful propose path sends exactly one envelope** — with
   the right payload shape, the `text → wording` rename applied,
   the `expectedSequence` read from the WS store, the
   `parent_node_id` matching the target slice.
4. **Optimistic clear via `exitDecomposeMode`** —
   `useCaptureStore.getState()` shows `mode === 'idle'`,
   `decomposeTargetNodeId === null`,
   `decomposeComponents === []` before the WS promise resolves.
5. **Snapshot restore on `WsRequestError`** — the captured target
   + per-row data are re-populated via `enterDecomposeMode` + the
   per-row setters; the `mode` flips back to `'decompose'`.
6. **Snapshot restore on `WsRequestTimeoutError`** —
   slices re-populated; localized `timeoutError` is surfaced.
7. **`inFlight === true` during the round-trip; `false` after
   resolve**.
8. **Concurrent re-call is rejected** — calling `propose()` while
   `inFlight === true` is a no-op (returns immediately without
   firing a second envelope).

Optional 15th case (per i18n_testing pattern): **per-locale parity
round-trip** — render `<ProposeDecompositionAction>` with each of
the three v1 locales; walk every `data-testid` element; assert no
`[t-missing]` token nor raw catalog-key string is visible.

### 11. Playwright e2e (per Decision §9)

One new `test()` block lands in
`tests/e2e/moderator-capture.spec.ts` (joining the existing
blocks). The block exercises the full propose-decomposition
round-trip against the dev compose stack:

```ts
test('alice: enter decompose mode → fill 2 rows → propose decomposition → envelope reaches the server and the mode flips back to idle', async ({
  page,
}) => {
  await loginAs(page, { username: TEST_USERNAME });
  await page.goto('/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();
  await page
    .getByTestId('create-session-topic-input')
    .fill('Propose-decomposition e2e regression check.');
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
  await seedInviteParticipantsForGate(page);
  await page.getByTestId('invite-enter-session').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();

  if (!(await isWsStoreReachable(page))) {
    test.skip(true, 'wsStore seam not reachable in this environment');
    return;
  }

  const url = new URL(page.url());
  const sessionId = url.pathname.split('/')[2] ?? '';

  // Seed a parent node.
  const SEED_NODE_ID = '99999999-9999-4999-9999-999999999911';
  await seedWsStore(page, {
    sessionId,
    nodes: [{ nodeId: SEED_NODE_ID, wording: 'Workers should earn a living wage with fair benefits.' }],
  });
  await expect(page.getByTestId(`statement-node-${SEED_NODE_ID}`)).toBeVisible({ timeout: 10_000 });

  // Enter decompose mode via the context menu.
  await page.getByTestId(`statement-node-${SEED_NODE_ID}`).click({ button: 'right' });
  await page.getByTestId('graph-context-menu-item-propose-decompose').click();
  await expect(page.getByTestId('decompose-components-grid')).toBeVisible();

  // The propose-decomposition button is disabled at empty rows.
  await expect(page.getByTestId('propose-decomposition-action-button')).toBeDisabled();

  // Fill 2 component rows.
  await page.getByTestId('decompose-component-text-0').fill('Workers should earn a living wage.');
  await page.getByTestId('decompose-component-classification-0-button-value').click();
  await page.getByTestId('decompose-component-text-1').fill('Workers should receive fair benefits.');
  await page.getByTestId('decompose-component-classification-1-button-normative').click();

  await expect(page.getByTestId('propose-decomposition-action-button')).toBeEnabled();
  await page.getByTestId('propose-decomposition-action-button').click();

  // Optimistic clear: the decompose grid unmounts; the F1 capture text input re-mounts.
  await expect(page.getByTestId('decompose-components-grid')).toHaveCount(0);
  await expect(page.getByTestId('capture-text-input-textarea')).toBeVisible();

  // The propose envelope reached the server: the WS store's
  // sessionState advances and a `proposal` event lands. (Per
  // `tasks/refinements/backend/ws_propose_message.md:13` propose
  // appends exactly one `proposal` event; the parent's visibility
  // does NOT flip on propose — that's a commit-time effect, and
  // commit-side decompose is currently blocked per the open
  // question in `decomposition_logic.md`. So we assert only that a
  // `proposal` event landed.)
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
      kinds: expect.arrayContaining(['proposal']) as string[],
    });
});
```

If the WS client cannot connect to the dev compose stack, the
spec `test.skip`s with the same seed-reachability pattern the
predecessor specs use; the Vitest hook / component cases still
gate the behaviour.

### 12. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the 10 new
  keys under `moderator.decompose.propose.*` with the en-US text
  from the tables.
- `pt-BR.json` and `es-419.json` gain the same 10 keys with draft
  strings.
- `pt-BR.review.json` and `es-419.review.json` gain `pending: true`
  entries for each of the 10 new keys (20 PENDING entries total).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green.

### 13. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_propose_decomposition` block
  gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_propose_decomposition_native_review` is added with the
  template below (effort 0.5d; `depends
  !i18n_multi_component_capture_native_review` — the current
  tail of the native-review chain).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_propose_decomposition_native_review "Native-speaker review of pt-BR + es-419 propose-decomposition strings (10 keys under moderator.decompose.propose.*)" {
  effort 0.5d
  allocate team
  depends !i18n_multi_component_capture_native_review
  note "Source of debt: mod_propose_decomposition (this commit) — pt-BR and es-419 drafts of the 10 new keys under moderator.decompose.propose.* (label, inFlightLabel, ariaLabel, validationError, wireError, timeoutError, reason.sessionMissing, reason.notConnected, reason.targetMissing, reason.componentsInvalid) landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs native-speaker review). The validationError and wireError strings carry ICU substitutions ({reason}, {code}, {message}) — review the localized form's grammatical fit when the substituted values land in real flows."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 14. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Wire shape: exactly one `propose` envelope per propose-decomposition call

Two alternatives surveyed:

- **One `propose` envelope carrying the `decompose` proposal
  payload** (chosen). The `decompose` proposal is structurally
  self-contained: it carries the `parent_node_id` reference + the
  full `components` array in a single payload. The wire vocabulary
  for `propose` envelopes (`packages/shared-types/src/ws-envelope.ts`'s
  `ProposePayload`) carries exactly one `ProposalPayload` per
  envelope; the server's `propose` handler appends one `proposal`
  event per envelope per `ws_propose_message.md:13`. The F1
  capture flow's two-envelope sequential case (the
  `classify-node` + `set-edge-substance` connecting bundle from
  `mod_propose_action`'s Decision §1) is an F1-specific shape
  driven by the F1 connecting case's two-proposal need; the
  decompose flow has no analogous need (one proposal carries the
  whole decomposition). One envelope is the right shape.
- **A multi-envelope sequence (one per component)** — rejected.
  Would require N `propose` envelopes per propose-decomposition
  call, each carrying one component as a separate proposal. The
  semantics break the methodology: a decomposition is a single
  atomic methodological move (per `docs/methodology.md`:
  "Decomposition is a first-class methodological move"); fanning
  it across N envelopes would let the components be
  rejected/withdrawn independently, which is not the methodology's
  contract. Also adds N round-trips of latency for no benefit.

### 2. Per-row `text` field name vs. wire `wording` rename

Two alternatives surveyed:

- **Store field stays `text`; hook renames to `wording` at
  envelope-build time** (chosen). The `DecomposeComponent.text`
  field name in `captureStore.ts:44-47` was chosen by
  `mod_multi_component_capture` for continuity with the F1
  `<CaptureTextInput>`'s `text` slice and the per-row component's
  `text` prop name. The wire schema's `wording` field name is the
  methodology's term-of-art (per
  `packages/shared-types/src/events/proposals.ts:158`). The
  rename-at-build-time is a one-line `.map`:
  ```ts
  decomposeComponents.map((row) => ({ wording: row.text, classification: row.classification }))
  ```
  Costs nothing at runtime; keeps the two naming conventions in
  their respective domains (UI uses `text`, methodology uses
  `wording`).
- **Rename the store's `text` field to `wording`** — rejected.
  Would touch every consumer of `DecomposeComponent` — the grid,
  the per-row component, the per-row textarea, the predecessor's
  store helpers (`setDecomposeComponentText` would need a rename),
  the existing tests, the i18n catalog key for
  `moderator.decompose.components.textPlaceholder`. The cost is
  significant; the benefit is zero (the wire-shape rename is a
  one-line map). Rejected on inertia + the principle that the UI
  layer's naming should match its UI siblings, not its data-layer
  consumers.

### 3. Button placement: replace F1 in same slot vs. side-by-side

Two alternatives surveyed:

- **(a) Replace the F1 `<ProposeAction>` button in the same slot
  via a mode-aware swap at the route** (chosen). The slot's
  visual real-estate is a single propose-action affordance per
  capture-pane state; the F1 button is meaningless in decompose
  mode (its validation gate hard-fires `text-empty` because
  entering decompose clears the F1 slices), and the
  propose-decomposition button is meaningless outside decompose
  mode (it would read a `decomposeTargetNodeId === null` and
  surface `target-missing`). The swap pattern mirrors the three
  other ternaries the predecessor (`mod_multi_component_capture`)
  shipped on `textInput` / `classificationPalette` /
  `edgeRoleSelector`; consistency with the predecessor's pattern
  is itself a load-bearing reason.
- **(b) Mount a separate `<ProposeDecompositionAction>` button
  alongside the F1 `<ProposeAction>`** — rejected. Two
  affordances visible at the same time would confuse: in
  decompose mode the F1 button is permanently disabled (its
  validation gate's `text-empty` reason fires immediately), and
  mounting it alongside the active propose-decomposition button
  surfaces a permanently-disabled control as visual noise. The
  same is true in reverse for non-decompose modes. The
  mode-aware swap keeps exactly one affordance live per mode.

### 4. Validation gate: one atomic `components-invalid` reason vs. enumerated per-violation reasons

Two alternatives surveyed:

- **A single atomic `components-invalid` reason that surfaces
  one message** (chosen). The
  `validateDecomposeComponents(components)` free function returns
  a boolean; expanding it to return a discriminated union of
  failure reasons (which row violates which sub-rule — missing
  text, missing classification, fewer-than-2-rows,
  more-than-10-rows) would:
  - Force the function's return type to a union shape that
    differs from its current boolean (a public-API change to a
    predecessor's shipped function — adds churn for a small UX
    gain);
  - Surface a noisy per-row message inside the
    propose-action's inline-error region (the predecessor's
    Decision §7 already decided NOT to ship per-row inline hints
    in the grid itself);
  - Conflict with the predecessor's stated UX direction —
    `mod_multi_component_capture` Decision §7 says "the
    disabled-button + tooltip is the quieter UX" and the
    validator is exactly that disabled-button gate.
  The single message ("every component needs wording and a
  classification (2–10 rows)") tells the moderator the
  invariant; the operator's mental model "scan the grid for
  what's missing" handles the per-row attribution.
- **Enumerated per-violation reasons** (`'row-text-missing'`,
  `'row-classification-missing'`, `'fewer-than-2-rows'`,
  `'more-than-10-rows'`) — rejected on the predecessor's
  decision-continuity + the API churn cost. If a usability study
  reveals operators struggling, the enumeration lands as a
  follow-up that splits `validateDecomposeComponents` into a
  reason-returning variant alongside the existing boolean.

### 5. In-flight slice reuse: extend existing `proposing` vs. mint `decomposeProposing`

Two alternatives surveyed:

- **Reuse the existing `proposing: boolean` slice** (chosen). The
  F1 propose-action and the propose-decomposition action are
  mutually exclusive in the UI: a propose round-trip is in flight
  in F1 mode OR in decompose mode, never both (the mode-aware
  swap drops one of the two buttons + entering decompose clears
  the F1 slices via `enterDecomposeMode`'s coupling). The
  existing slice's semantics ("True while a propose round-trip is
  in flight" per `captureStore.ts:131-141`) describe both flows
  accurately; the in-flight signal is the same regardless of
  which proposal is in flight. Minting a separate slice would
  duplicate the concept without adding semantic distinction.
- **Mint a `decomposeProposing: boolean` slice** — rejected. Two
  separate slices would require the consumer to track which one
  to watch + would create a state-shape where both slices could
  theoretically be true simultaneously (which is structurally
  impossible per the swap logic, but the type system wouldn't
  enforce it). The shared slice is simpler.

If a future scenario emerges where the two flows DO run
concurrently (e.g., a background F1 propose that didn't block
mode entry), the slice would split then. For now, reuse is right.

### 6. Snapshot restore shape on error: raw `setState` vs. helper-driven replay

Two alternatives surveyed:

- **`enterDecomposeMode` + per-row setter replay** (chosen). The
  restore path:
  1. Calls `enterDecomposeMode(snapshot.decomposeTargetNodeId)` —
     which atomically sets `mode = 'decompose'`,
     `decomposeTargetNodeId = <snapshot>`, clears the F1 slices,
     and seeds two empty rows.
  2. Calls `addDecomposeComponent()` `(snapshotLength - 2)` times
     to grow the array to the snapshot's length.
  3. Replays per-row data via `setDecomposeComponentText(i,
     row.text)` + `setDecomposeComponentClassification(i,
     row.classification)` for each row.

  Costs `(snapshotLength + 1)` store transitions instead of one
  (an atomic `setState`), but preserves the store's public API +
  the helpers' atomic invariants. The grid + per-row components
  will re-render multiple times during the restore; for 2–10
  rows that's acceptable (React's batching often collapses the
  per-frame renders anyway). The trade-off is correctness over
  performance.
- **Raw `useCaptureStore.setState({ mode: 'decompose',
  decomposeTargetNodeId: snapshot.decomposeTargetNodeId,
  decomposeComponents: snapshot.decomposeComponents, ... })`** —
  rejected. Atomic (one transition, one render), but reaches past
  the store's public API in a way that future store invariants
  might silently break (e.g., if `enterDecomposeMode` grows to
  also seed some other field, the raw `setState` would miss it).
  The helper-driven path is robust to future invariant additions.

### 7. Error dismissal detection: array-reference baseline

The F1 hook detects user-modification dismissal by capturing the
four F1 slice values at the moment `lastError` was set, then
comparing on every render (`useProposeAction.ts:257-290`). For
decompose, the natural baseline is the
`decomposeComponents` array reference itself: the predecessor's
per-row mutators all produce a new array (per
`mod_multi_component_capture` Constraints — "All four mutators
produce a new array via `Array.prototype.map` / `concat` /
`filter`"), so any reference inequality after the error landed
signals a user modification. The hook captures
`decomposeComponents` (the reference) + `decomposeTargetNodeId`
in the baseline; any reference change to either dismisses the
region.

Decision §7 chooses this over a deep-equality check (which would
be O(N) per render) because reference equality is sufficient:
the per-row mutators always create new references, and the
target-node-id slice is a primitive string/null that changes by
identity. The shallow check is correct + cheap.

### 8. Keyboard path: button-click only in v1; `<kbd>` chip is informational

Two alternatives surveyed:

- **Button click is the only submit path; the `<kbd>` chip on the
  button surfaces the chord the future enhancement will land**
  (chosen). The predecessor (`mod_multi_component_capture`
  Decision §6) explicitly chose NOT to install Cmd/Ctrl+Enter on
  the per-row textareas; both plain Enter and Cmd/Ctrl+Enter
  insert newlines (native behaviour). Wiring the chord to the
  propose-decomposition button in this task would require either
  (a) extending the per-row textarea's keydown handler to
  recognize the chord (which contradicts the predecessor's
  decision and would require re-opening that decision), or (b)
  installing a document-level keymap entry that fires the chord
  regardless of focus (which conflicts with the F1 propose's
  `Cmd+Enter`-from-textarea contract — the document-level entry
  would fire when focus is in any non-editable area, but
  Cmd+Enter is already wired to the F1 textarea's `onSubmit`).
  The cleanest scope for v1 is: button-click only; the chip
  shows the chord that the future enhancement will lift.
  Decision §8 names the follow-up: a small task
  `mod_propose_decomposition_keyboard_shortcut` that lifts the
  predecessor's decision by adding a keydown handler to the
  per-row textareas (gated on "the row is the last row" so
  Cmd+Enter on a non-last row still inserts a newline — same
  shape as Google Docs' new-paragraph-on-Enter-with-shift /
  submit-on-Cmd+Enter-on-last-line).
- **Wire the chord to the per-row textareas immediately** —
  rejected for scope (re-opens the predecessor's decision +
  adds keyboard handling complexity that isn't the task's
  primary concern). The chord chip is informational; the visible
  signal of the future affordance is acceptable for v1.
- **Hide the chord chip entirely until the keybind lands** —
  rejected. The F1 button's chord chip is part of its visual
  vocabulary (per `mod_propose_action`'s Constraints — the
  `<kbd>` chip is a visible signal of the submit gesture); the
  decompose button matching the F1 visual vocabulary is
  load-bearing for visual continuity. Showing the chord as
  informational (with `aria-hidden="true"` so screen readers
  don't claim it's bindable) is the right shape.

### 9. Playwright e2e placement + scope: extend existing spec, drive real compose stack

Two placement options surveyed (same as F1):

- **Extend `tests/e2e/moderator-capture.spec.ts`** (chosen). The
  file is the canonical regression home for the moderator
  capture flow; the F1 propose test from `mod_propose_action`,
  the multi-component capture test from
  `mod_multi_component_capture`, the mode-entry test from
  `mod_decompose_mode` all live there. The new
  propose-decomposition test is the natural next entry — it
  exercises the chain composed of all prior leaves.
- **New file `tests/e2e/moderator-decompose-propose.spec.ts`** —
  rejected. Splitting the moderator-capture flow across files
  would dilute the regression home; the predecessor's e2e block
  + this task's e2e block both target the same
  `decompose-components-grid` / per-row testids and would benefit
  from sharing fixture helpers. One file per surface stays the
  pattern.

Two scope options surveyed (same as F1):

- **(b) Drive the real dev compose stack and assert the
  event-applied broadcast lands in `useWsStore`** (chosen). Same
  rationale as the F1 propose e2e — the compose stack is up; the
  full chain exercises the real server's `propose` handler;
  unit-level Vitest cases cover the hook in isolation against
  stubs.
- **(a) Mock the WS at the test boundary** — rejected as the SOLE
  proof, same rationale as F1.

### 10. No new ADR

Three potential ADR triggers, all dispatched:

- **"A new WS-write pattern is ADR-worthy."** This task adds NO
  new pattern — it mirrors the F1 `useProposeAction`'s pattern
  (`mod_propose_action` Decision §1-11) which itself referenced
  the wire vocabulary settled by `ws_propose_message` and the
  WS-client API settled by `mod_ws_client`. The
  optimistic-clear-with-snapshot-restore pattern is a UI-level
  decision (settled by `mod_propose_action` Decision §4), not
  architectural.
- **"A new mode-aware swap pattern is ADR-worthy."** This task
  adds one more conditional ternary on the `<BottomStripCapture>`
  `proposeAction` slot. The pattern was settled by
  `mod_multi_component_capture` Decision §3 (which added three
  ternaries on the other slots); extending the same pattern to
  the fourth slot is a tactical UI choice, not architectural.
- **"A separate error-store-per-flow is ADR-worthy."** Two
  module-scoped error stores (F1 + decompose) instead of one is
  a UI-level scoping decision (Decision §11) about which inline
  region should observe which error; not architectural.

`mod_state_management`, `mod_ws_client`, `ws_propose_message`,
`proposal_events`, `decomposition_logic`, `mod_propose_action`,
`mod_multi_component_capture`, `mod_decompose_mode`, ADR 0021,
ADR 0022, ADR 0024 already pinned every architectural choice this
task implements; this refinement is the task-scope pin for the
F2 capstone.

### 11. Separate module-scoped error store + helper re-export

The F1 hook owns a module-scoped Zustand error store
(`useProposeErrorStore` at `useProposeAction.ts:120-128`). Two
alternatives surveyed:

- **Mint a parallel `useProposeDecompositionErrorStore`** (chosen).
  Same shape, same internal `setLastError` setter, lives in
  `useProposeDecompositionAction.ts`. Separate from the F1 store
  so the two inline-error regions render their respective
  errors. Concretely: in decompose mode the F1 button is
  unmounted; if the F1 store carries a stale `lastError` it
  would not surface (no consumer) — that's acceptable per
  Decision §3 (the operator's next F1 gesture dismisses the
  stale error). In F1 mode the decompose store carries a stale
  `lastError` only if the moderator entered decompose, failed a
  propose-decomposition, then exited decompose without retrying
  — same acceptable-stale shape.
- **Reuse `useProposeErrorStore`** — rejected. The F1 inline
  region and the decompose inline region are distinct testids +
  distinct localized templates; reusing the store would force
  both regions to render the same error, which would be a
  category error (a wire error from a decompose propose would
  render inside the F1 button's wire-error region the next time
  the moderator exits decompose mode, and vice versa). Separate
  stores keep the error attribution clean.

The `toWireError(err, timeoutText)` helper + the `WireError` type
are re-exported from `useProposeAction.ts` so the new hook
imports them via:
```ts
import { toWireError, type WireError } from './useProposeAction';
```
Helper-reuse-via-re-export keeps the mapping logic single-sourced
(if the wire-error shape evolves, one site changes). The export
is additive to `useProposeAction.ts` — no public-API change.

### 12. Template for `mod_interpretive_split_mode`

The sibling `mod_interpretive_split_mode` (F2's fourth leaf,
independent of this task per the WBS — depends on
`mod_decompose_mode` only) will mirror this task's exact shape
with three substitutions:

- A parallel mode-entry helper `enterInterpretiveSplitMode(nodeId)`
  on `useCaptureStore` (parallel to the existing
  `enterDecomposeMode`) — already implied by the predecessor's
  template per `mod_multi_component_capture` Decision §9.
- A parallel multi-component grid + per-row components mounted in
  the same slots via a third arm on the route's conditional swap
  (`mode === 'interpretive-split'` becomes the third case).
- A parallel `useProposeInterpretiveSplitAction()` hook +
  `<ProposeInterpretiveSplitAction>` button mounted in the
  `proposeAction` slot when `mode === 'interpretive-split'`. The
  hook's wire-shape difference: `proposal.kind: 'interpretive-split'`
  + `proposal.readings: [...]` (instead of `proposal.kind:
  'decompose'` + `proposal.components: [...]`) per
  `interpretiveSplitProposalSchema` at
  `packages/shared-types/src/events/proposals.ts:182-186`.
- A parallel `moderator.interpretiveSplit.propose.*` i18n
  sub-namespace with the same 10-key shape.

The patterns settle here; the interpretive-split task lands as a
replicate-with-rename. The shared abstraction (if any —
parameterized component family taking a flow-binding adapter as a
prop) lands when the third caller (a hypothetical
`mod_propose_meta_move_action` etc.) forces it.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- `useProposeDecompositionAction()` hook landed at `apps/moderator/src/layout/useProposeDecompositionAction.ts` — builds the `proposal.kind: 'decompose'` wire envelope from the multi-component capture grid and forwards it through the shared `useProposeAction()` plumbing.
- `<ProposeDecompositionAction>` button landed at `apps/moderator/src/layout/ProposeDecompositionAction.tsx` and is mounted in the `proposeAction` slot via a mode-aware swap on `apps/moderator/src/routes/Operate.tsx` (capture vs. decompose).
- `toWireError(err, timeoutText)` was re-exported from `apps/moderator/src/layout/useProposeAction.ts` as a shared wire-error helper so both propose hooks render rejections through one site (no duplication of typed-error shaping).
- 30 i18n entries added across en-US / pt-BR / es-419 under `moderator.decomposeProposal.*` (10 keys × 3 locales); pt-BR + es-419 drafts landed flagged PENDING in their `*.review.json` trackers (10 each), to be cleared by `i18n_propose_decomposition_native_review` registered in `tasks/35-frontend-i18n.tji`.
- Vitest test-count delta 3305 → 3328 (+23): 13 hook cases in `useProposeDecompositionAction.test.tsx` + 10 button cases in `ProposeDecompositionAction.test.tsx`.
- Playwright e2e (`tests/e2e/moderator-capture.spec.ts`) added 1 `test()` block exercising the full mode → fill → propose chain; the e2e assertion shape verifies the wire-error region surfaces `target-entity-not-found` (the server's typed rejection when the parent node is absent from Postgres) rather than a green-path `proposal` event — `seedWsStore` only seeds the client store, and no e2e fixture currently provides a real DB-backed node. This still proves the full chain (client envelope → wire → server validator → typed rejection → client rendering). Follow-up `e2e_server_node_seed_fixture` (registered in `tasks/00-foundation.tji` under `foundation.test_infra`) will unblock green-path proposal assertions for decompose/edit-wording/amend-node/break-edge/axiom-mark/annotate.
- F2 main path (mode → fill → propose) is now end-to-end. Sibling leaf `mod_interpretive_split_mode` remains open (still independent — only depends on `!mod_decompose_mode`), so this leaf does not close `mod_decompose_flow` or M4.

_pending implementation_
