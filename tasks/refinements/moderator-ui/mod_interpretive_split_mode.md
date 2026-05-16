# Moderator interpretive-split flow — analogous end-to-end chain for the `interpretive-split` proposal sub-kind

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_decompose_flow.mod_interpretive_split_mode`.

```
task mod_interpretive_split_mode "Interpretive-split mode (analogous flow)" {
  effort 1d
  allocate team
  depends !mod_decompose_mode
}
```

## Effort estimate

**1d.** Confirmed — tight but achievable because **every load-bearing seam already
exists** as a generalisable abstraction; this task is a parameterise-and-replicate
pass, not a re-design. The three predecessor leaves of `mod_decompose_flow`
collectively shipped:

- The mode-flip seam — `enterDecomposeMode(nodeId)` / `exitDecomposeMode()` atomic
  helpers at `apps/moderator/src/stores/captureStore.ts:282-307` with the
  F1-coupling clear pattern (`mod_decompose_mode.md` Decision §6).
- The exit affordance — `<DecomposeModeExitButton>` at
  `apps/moderator/src/layout/DecomposeModeExitButton.tsx:72-120` with the
  events-log target-wording resolver, the visibility gate on `mode === 'decompose'`,
  and the mode-aware Escape keymap routing.
- The mode-aware Escape priority in `captureKeymap` —
  `apps/moderator/src/layout/captureKeymap.ts:215-240` (`onExitMode` handler with
  decompose-mode priority over `onClearTarget`).
- The node context-menu seam — `buildNodeMenuItems`'s
  `onEnterDecomposeMode?: (nodeId: string) => void` parameter at
  `apps/moderator/src/graph/GraphCanvasPane.tsx:228-262` with the `propose-decompose`
  item dispatching to the global store via a stable canvas callback
  (`GraphCanvasPane.tsx:648-655`, wired at line 961).
- The multi-component capture grid — `<DecomposeComponentsGrid>` +
  `<DecomposeComponentRow>` + `<DecomposeComponentTextInput>` +
  `<DecomposeComponentClassificationPicker>` at
  `apps/moderator/src/layout/Decompose*.tsx`, plus the per-row store helpers
  (`setDecomposeComponentText` / `setDecomposeComponentClassification` /
  `addDecomposeComponent` / `removeDecomposeComponent` at
  `captureStore.ts:308-346`), the two-row seed in `enterDecomposeMode`
  (`captureStore.ts:293-297`), the clear-to-`[]` in `exitDecomposeMode`
  (`captureStore.ts:303-306`), and the free-function
  `validateDecomposeComponents` at `captureStore.ts:86-92`.
- The propose-decomposition action — `useProposeDecompositionAction` hook at
  `apps/moderator/src/layout/useProposeDecompositionAction.ts:148-317` and
  `<ProposeDecompositionAction>` component at
  `apps/moderator/src/layout/ProposeDecompositionAction.tsx:89-167` with the
  four-gate validator, the `text → wording` envelope-build rename, the
  optimistic clear via `exitDecomposeMode`, the snapshot-restore-on-error path
  via `enterDecomposeMode` + per-row replay, the module-scoped
  `useProposeDecompositionErrorStore`, the in-flight slice reuse, and the
  user-modification dismissal.
- The route-level mode-aware slot swap — `<OperateRouteInner>` at
  `apps/moderator/src/routes/Operate.tsx:115-162` (`const isDecomposeMode = mode === 'decompose'`)
  with three conditional ternaries on `textInput` / `classificationPalette` /
  `edgeRoleSelector` + one on `proposeAction`.
- The server-side wire contract — `validateInterpretiveSplitProposal` at
  `apps/server/src/methodology/handlers/propose.ts:383-446` (with the
  `'interpretive-split'` arm of the switch at lines 1134-1137), the Zod
  `interpretiveSplitProposalSchema` at
  `packages/shared-types/src/events/proposals.ts:182-186` (identical structural
  shape to `decomposeProposalSchema`: `parent_node_id: UUID` +
  `readings: z.array(proposalComponentSchema).min(2).max(10)`), and the
  symmetric mutual-exclusion `CONFLICTING_PARENT_KINDS` set at
  `propose.ts:279` (which already includes `'interpretive-split'` alongside
  `'decompose'`, `'edit-wording'`, `'amend-node'`).

The work is therefore: (a) **parameterise the four mode seams** by a `mode:
'decompose' | 'interpretive-split'` discriminant — the store helpers, the
context-menu factory, the exit-button component, the captureKeymap mode-aware
priority — without breaking the existing decompose call sites; (b) **mint the
`'interpretive-split'` `CaptureMode` enum value** + the parallel store slices
(`interpretiveSplitTargetNodeId`, `interpretiveSplitReadings`) + the parallel
helpers; (c) **add the `interpretive-split` node-context-menu item** alongside
the existing `propose-decompose` item; (d) **mint the parallel hook +
component** for the propose action (mirroring
`useProposeDecompositionAction` / `<ProposeDecompositionAction>`); (e) **wire
two new route-level slot-content swaps** (`textInput` / `proposeAction`) so
the existing decompose grid + propose-decomposition button are joined by
interpretive-split equivalents; (f) **add the 22 new i18n keys** under
`moderator.interpretiveSplit.*` (mirroring `moderator.decompose.*`'s 22 keys
across `exit.*`, `banner.*`, `components.*`, `propose.*` sub-namespaces) +
the `moderator.modeBanner.interpretive-split.*` keys (label + description) +
the `moderator.contextMenu.node.proposeInterpretiveSplit` key; (g) **register
the native-review follow-up** task.

Concretely, the deliverable is:

- **`CaptureMode` enum extension** at `apps/moderator/src/stores/captureStore.ts:103-111` —
  add `'interpretive-split'` as the ninth valid value. This is the single
  load-bearing type change.
- **Two new slices** on `useCaptureStore`: `interpretiveSplitTargetNodeId:
  string | null` (parallel to `decomposeTargetNodeId`) and
  `interpretiveSplitReadings: ReadonlyArray<DecomposeComponent>` (parallel to
  `decomposeComponents` — same row shape; same Zod-mirroring 2..10 bounds;
  Decision §1 records why this task **does NOT** rename
  `DecomposeComponent` to a more neutral `ProposalRow` v1 — the deferred-
  rename argument from `mod_multi_component_capture` Decision §2 applies
  symmetrically here, the deferral lands when a future third caller forces
  it).
- **Six new coordination helpers** on `useCaptureStore` — parallel-named to
  the decompose set: `setInterpretiveSplitTargetNodeId`,
  `enterInterpretiveSplitMode(nodeId)`, `exitInterpretiveSplitMode()`,
  `setInterpretiveSplitReadingText(index, text)`,
  `setInterpretiveSplitReadingClassification(index, classification)`,
  `addInterpretiveSplitReading()`, `removeInterpretiveSplitReading(index)`.
  (Total seven helpers — one mirrors `setDecomposeTargetNodeId`, two mirror
  the mode-flip pair, four mirror the per-row mutators.) Each is an atomic
  single-`set()` per the existing pattern.
- **Generalised free function** — `validateProposalRows(rows)` at the same
  module — body identical to `validateDecomposeComponents` (the validator
  checks `length ∈ [2, 10]` + each row has non-empty trimmed text + non-null
  classification; the **same** Zod constraints apply to both
  `decomposeProposalSchema.components` and
  `interpretiveSplitProposalSchema.readings`). `validateDecomposeComponents`
  is preserved as a thin re-export wrapper for the existing call site
  (`useProposeDecompositionAction.ts:177`); `useProposeInterpretiveSplitAction`
  imports the generalised name. Decision §1 records the
  no-rename-of-existing-name choice.
- **Context-menu factory extension** at
  `apps/moderator/src/graph/GraphCanvasPane.tsx:228-262` — add an optional
  fourth positional parameter
  `onEnterInterpretiveSplitMode?: (nodeId: string) => void` (mirrors the
  existing third positional `onEnterDecomposeMode?`) AND add a new menu item
  `propose-interpretive-split` immediately after the existing
  `propose-decompose` item. Decision §3 records the entry-point choice
  (option a — peer menu item).
- **Canvas wire-up** at `apps/moderator/src/graph/GraphCanvasPane.tsx:648-655,
  943-962` — add a stable
  `enterInterpretiveSplitMode = useCallback((nodeId) => useCaptureStore.getState().enterInterpretiveSplitMode(nodeId), [])`
  callback alongside the existing `enterDecomposeMode`; pass it as the
  fourth argument to `buildNodeMenuItems`. No new canvas-local state.
- **Exit-affordance component generalisation** — extract a shared
  `<ProposalModeExitAffordance mode={'decompose'|'interpretive-split'}>`
  component at `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`
  (Decision §2: extract-and-share strategy) parameterised by `mode`. The
  existing `<DecomposeModeExitButton>` becomes a thin wrapper that calls
  `<ProposalModeExitAffordance mode="decompose">`; the new
  `<InterpretiveSplitModeExitButton>` calls
  `<ProposalModeExitAffordance mode="interpretive-split">`. Both wrappers
  preserve their existing `data-testid` (`decompose-mode-exit*` /
  `interpretive-split-mode-exit*`) and per-mode i18n key resolution. The
  events-log target-wording resolver (`resolveDecomposeTargetWording` at
  `DecomposeModeExitButton.tsx:57-68`) is re-exported as
  `resolveProposalTargetWording` (rename-with-alias) so both wrappers reuse
  the same lookup.
- **captureKeymap mode-aware Escape** at `captureKeymap.ts:226-240` —
  generalise the early-return: when
  `useCaptureStore.getState().mode === 'decompose' || mode === 'interpretive-split'`
  AND `handlers.onExitMode !== undefined`, route Escape to `onExitMode`.
  The handler signature stays single (`onExitMode?: () => void`); each
  mounting component owns its own `onExitMode` closure (decompose's wraps
  `exitDecomposeMode`; interpretive-split's wraps
  `exitInterpretiveSplitMode`).
- **Grid component reuse** — the existing
  `<DecomposeComponentsGrid>` + `<DecomposeComponentRow>` +
  `<DecomposeComponentTextInput>` + `<DecomposeComponentClassificationPicker>`
  are parameterised by `mode` in v1 via a new prop
  `mode: 'decompose' | 'interpretive-split'` on the grid and on the row
  (the row threads it to the text-input and the picker). The components
  switch their store-read selectors on the `mode` prop:
  ```ts
  const componentsLength = useCaptureStore((s) =>
    props.mode === 'decompose'
      ? s.decomposeComponents.length
      : s.interpretiveSplitReadings.length,
  );
  ```
  Each component also gains a per-mode `data-testid` (e.g.
  `decompose-components-grid` vs `interpretive-split-readings-grid`).
  Decision §2 records the parameterise-don't-duplicate choice; Decision §1
  records why no rename of the existing components (the per-mode files keep
  their `Decompose*` names — the parametisation lands inside them, the
  filenames themselves migrate when a third caller forces the rename).
- **Propose-action hook generalisation** — introduce
  `apps/moderator/src/layout/useProposeProposalAction.ts` exporting a
  parameterised hook
  `useProposeProposalAction({ mode: 'decompose' | 'interpretive-split' })`.
  Body extracted from `useProposeDecompositionAction.ts:148-317` with the
  three substitutions: (a) the slice reads switch on `mode`, (b) the
  envelope's `kind` field switches on `mode` (`'decompose'` vs
  `'interpretive-split'`), (c) the envelope's per-component field name
  switches (`components` for decompose; `readings` for interpretive-split —
  per `interpretiveSplitProposalSchema` at
  `packages/shared-types/src/events/proposals.ts:182-186`); the
  optimistic-clear helper switches between `exitDecomposeMode` and
  `exitInterpretiveSplitMode`; the snapshot-restore similarly switches.
  `useProposeDecompositionAction` is preserved as a thin wrapper that
  calls `useProposeProposalAction({ mode: 'decompose' })`; the new
  `useProposeInterpretiveSplitAction` calls the same with
  `mode: 'interpretive-split'`. The four-gate validation is unchanged
  (the gate reads — session id, connection status, target id, validator
  truth — apply symmetrically). The module-scoped error store is
  **per-mode** (Decision §6: parallel `useProposeInterpretiveSplitErrorStore`
  mirroring the predecessor's per-mode separation rationale).
- **Propose-action component generalisation** — introduce
  `<ProposalAction mode>` at
  `apps/moderator/src/layout/ProposalAction.tsx` parameterised by `mode`.
  The existing `<ProposeDecompositionAction>` becomes a thin wrapper
  (`<ProposalAction mode="decompose" />`); the new
  `<ProposeInterpretiveSplitAction>` calls
  `<ProposalAction mode="interpretive-split" />`. The wrapper resolves
  the per-mode i18n key namespaces + the per-mode `data-testid` prefix
  (`propose-decomposition-action*` vs
  `propose-interpretive-split-action*`).
- **Route-level slot swap extension** at
  `apps/moderator/src/routes/Operate.tsx:115-162` — extend the four
  `isDecomposeMode` ternaries to compose: derive
  `isInterpretiveSplitMode = mode === 'interpretive-split'` and
  `isProposalMode = isDecomposeMode || isInterpretiveSplitMode` next to
  the existing `isDecomposeMode`; the three body slots (`textInput` /
  `classificationPalette` / `edgeRoleSelector`) gate on `isProposalMode`
  with the grid swap reading `mode`:
  ```tsx
  textInput={
    isProposalMode ? (
      mode === 'decompose'
        ? <DecomposeComponentsGrid />
        : <InterpretiveSplitReadingsGrid />
    ) : (
      <CaptureTextInput onSubmit={() => { void propose(); }} />
    )
  }
  classificationPalette={isProposalMode ? null : <ClassificationPalette />}
  edgeRoleSelector={isProposalMode ? null : <CaptureTargetAndRole />}
  proposeAction={
    isDecomposeMode
      ? <ProposeDecompositionAction />
      : isInterpretiveSplitMode
        ? <ProposeInterpretiveSplitAction />
        : <ProposeAction />
  }
  ```
  The `modeBanner` slot grows to also mount the new
  `<InterpretiveSplitModeExitButton />` alongside `<DecomposeModeExitButton />` —
  each component is mode-gated internally so the slot contents stay
  conditional-render-free at the route level.
- **i18n catalog keys** — new top-level sub-namespace
  `moderator.interpretiveSplit.*` mirroring `moderator.decompose.*`:
  - `moderator.interpretiveSplit.exit.{ariaLabel, tooltip}` — 2 keys.
  - `moderator.interpretiveSplit.banner.targetWording` — 1 key.
  - `moderator.interpretiveSplit.readings.{rowLabel, textPlaceholder,
    classificationLegend, addRow, removeRowAria}` — 5 keys. The
    sub-namespace is named `readings.*` (not `components.*`) to mirror
    the wire schema's field name; Decision §4 records the choice.
  - `moderator.interpretiveSplit.propose.{label, inFlightLabel, ariaLabel,
    validationError, wireError, timeoutError}` + `reason.{sessionMissing,
    notConnected, targetMissing, readingsInvalid}` — 6 chrome + 4 reason
    keys = 10 keys. The reason key is named `readingsInvalid` (parallel
    to `componentsInvalid`) to mirror the slice field name.
  - `moderator.modeBanner.interpretive-split.{label, description}` —
    2 keys (the modeBanner already covers the other 8 modes; this task
    adds the 9th mode's pair).
  - `moderator.contextMenu.node.proposeInterpretiveSplit` — 1 key (the
    node menu's new item label).

  **Total: 21 new keys × 3 locales = 63 new catalog entries.** pt-BR /
  es-419 drafts land flagged PENDING in `pt-BR.review.json` +
  `es-419.review.json` (42 entries total). Native-speaker review
  registered as a tech-debt follow-up.
- **1 follow-up tech-debt task** registered in
  `tasks/35-frontend-i18n.tji` —
  `i18n_interpretive_split_mode_native_review`, effort 0.5d,
  `depends !i18n_propose_decomposition_native_review` (the current tail
  of the native-review chain per `tasks/35-frontend-i18n.tji:214-220`).
- **Vitest cases** across the touched + new test files: `captureStore.test.ts`
  (the new enum value + the new slices + the new mode-flip helpers + the
  new per-row helpers + the validator-generalisation pin); the parameterised
  grid/row/input/picker `*.test.tsx` extensions for the new `mode` prop;
  `<ProposalModeExitAffordance>` cases under both modes;
  `useProposeProposalAction.test.tsx` extending the existing hook tests
  with per-mode parameter cases; per-locale parity round-trips for the new
  21 keys.
- **Playwright e2e** in `tests/e2e/moderator-capture.spec.ts` — extend
  the canonical capture-flow spec with the analogous full-chain
  interpretive-split block (right-click → "Propose interpretive split" →
  fill 2 reading rows → click the propose-interpretive-split button →
  envelope reaches server → mode flips back to `'idle'`). Decision §7
  records the e2e scope (full chain, mirrors
  `mod_propose_decomposition`'s Decision §9).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their
public contracts; the predecessor work shipped all of these as
generalisable abstractions):

- **`moderator_ui.mod_decompose_flow.mod_decompose_mode`** (done — 2026-05-16
  per `mod_decompose_mode.md` Status block, commit `83bea9b`). Shipped the
  `decomposeTargetNodeId` slice + the `enterDecomposeMode` /
  `exitDecomposeMode` atomic helpers + the node context-menu wiring +
  `<DecomposeModeExitButton>` + the mode-aware Escape keymap routing +
  the `moderator.decompose.{exit, banner}.*` i18n keys. **This task
  generalises the same shape for interpretive-split** (a new `CaptureMode`
  enum value + a parallel slice + parallel helpers + a parallel
  context-menu item + a per-mode exit-button wrapper of a shared
  `<ProposalModeExitAffordance>`). Decision §1 records the rationale for
  parameterising the existing shapes rather than duplicating-then-merging.
- **`moderator_ui.mod_decompose_flow.mod_multi_component_capture`** (done —
  2026-05-16 per `mod_multi_component_capture.md` Status block, commit
  `216aa34`). Shipped the `decomposeComponents` slice + the four per-row
  mutators + the seed-two-rows invariant in `enterDecomposeMode` + the
  clear-to-`[]` invariant in `exitDecomposeMode` + the
  `validateDecomposeComponents` free function +
  `<DecomposeComponentsGrid>` + `<DecomposeComponentRow>` +
  `<DecomposeComponentTextInput>` +
  `<DecomposeComponentClassificationPicker>` + the route-level slot swap
  on `textInput` / `classificationPalette` / `edgeRoleSelector` + the
  `moderator.decompose.components.*` i18n keys. **This task generalises
  the grid family for interpretive-split** (the four components take a
  new `mode` prop; the existing
  `<DecomposeComponentsGrid>`-named entry points keep their identity as
  thin wrappers OR are rendered directly by the route with the mode prop
  — Decision §2 picks the **shared parameterised component + per-mode
  wrapper** factoring).
- **`moderator_ui.mod_decompose_flow.mod_propose_decomposition`** (done —
  2026-05-16 per `mod_propose_decomposition.md` Status block). Shipped
  `useProposeDecompositionAction` + `<ProposeDecompositionAction>` + the
  four-gate validator + the optimistic-clear-with-snapshot-restore
  contract + the module-scoped `useProposeDecompositionErrorStore` + the
  user-modification-dismissal + the wire envelope shape (the per-row
  `text → wording` rename at envelope-build time) + the
  `moderator.decompose.propose.*` i18n keys. **This task generalises the
  hook + component pair for interpretive-split** (a parameterised
  `useProposeProposalAction` hook + a `<ProposalAction mode>` component
  with per-mode wrappers preserving the existing names + testid
  prefixes; the envelope's `kind` field + the per-component-array field
  name switch on `mode`).
- **`data_and_methodology.methodology_engine.interpretive_split_logic`**
  (done — 2026-05-10 per
  [`interpretive_split_logic.md`](../data-and-methodology/interpretive_split_logic.md)
  Status block). Shipped `validateInterpretiveSplitProposal` at
  `apps/server/src/methodology/handlers/propose.ts:383-446` enforcing the
  three rules in evaluation order (parent-exists → `'target-entity-not-found'`,
  parent-visible → `'illegal-state-transition'`, no-conflicting-pending →
  `'illegal-state-transition'`) plus the rule-4 structural-shape layer
  via Zod. The propose handler's switch arm at lines 1134-1137 is in
  place. **This task drives the validator from the moderator side; the
  wire contract is settled.** Rejections surface as
  `WsRequestError(payload)` with `payload.code` set to one of
  `'target-entity-not-found'` / `'illegal-state-transition'` (plus the
  engine universals `'not-a-participant'` / `'sequence-mismatch'` etc.).
  The `CONFLICTING_PARENT_KINDS` set at
  `propose.ts:279` (which already includes `'interpretive-split'`) means
  the symmetric mutual exclusion is already enforced server-side; a
  pending decompose against the same parent rejects a new
  interpretive-split with `'illegal-state-transition'`.
- **`data_and_methodology.event_types.proposal_events`** (done — 2026-05-10).
  Pinned the `interpretiveSplitProposalSchema` shape at
  `packages/shared-types/src/events/proposals.ts:182-186`
  (`{ kind: 'interpretive-split', parent_node_id: UUID, readings:
  z.array(proposalComponentSchema).min(2).max(10) }`). The shared
  `proposalComponentSchema` at lines 155-160 carries
  `wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH)` +
  `classification: statementKindSchema`. **This task constructs payloads
  conforming to the schema; the API layer's structural validator parses
  them at ingress per ADR 0021.** The envelope's per-row field name is
  `readings` (not `components`) — the hook does the per-row map at
  envelope-build time so the store's slice field name stays
  `interpretiveSplitReadings` (Decision §4).
- **`backend.websocket_protocol.ws_propose_message`** (done — 2026-05-11).
  Shipped the server-side `propose` handler with the subscribe-before-act
  gate, the visibility re-check, the engine `validateAction` call,
  `appendSessionEvent`, the post-commit `proposed` ack +
  `event-applied` broadcast, and the `rejectedToApiError`-mapped error
  path. **This task drives the same handler with an
  `interpretive-split` proposal payload; the wire contract is settled —
  exactly one `proposal` event is appended per envelope per
  `ws_propose_message.md:13`.**
- **`moderator_ui.mod_layout.mod_mode_banner`** (done — banner reads
  `useCaptureStore((s) => s.mode)` and renders the localized
  `moderator.modeBanner.<mode>.{label,description}`). This task adds the
  **9th mode's** keys (`moderator.modeBanner.interpretive-split.{label,
  description}`); the banner reads them with no code change.
- **`moderator_ui.mod_state_management`** (done — `useCaptureStore`
  contract; the new slices + helpers are additive).
- **`moderator_ui.mod_layout.mod_bottom_strip_capture`** (done — exposes
  the five stable sub-slots; this task reuses three of them via the
  route-level conditional swap. The scaffold itself is unchanged).
- **`moderator_ui.mod_graph_rendering.mod_context_menus`** (done —
  `<GraphContextMenu>` + the node menu's items factory at
  `GraphCanvasPane.tsx:228-262`. This task adds a new menu item alongside
  the existing five via the same factory-extension pattern).
- **`moderator_ui.mod_shell.mod_ws_client`** (done — `createWsClient` +
  `WsClient.send('propose', ...)` + `WsClientProvider` + `useWsClient()` +
  `useWsStore`; reused unchanged from `mod_propose_decomposition`'s
  integration).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done —
  commit `05f7d67`; the operate route is reachable from a real user
  flow; this task's gestures are reachable from the same chain).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — `useTranslation()`, the
  parity-check script, the `*.review.json` PENDING-flag lifecycle, the
  per-locale parity round-trip pattern are all in place).
- **[ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)**
  — the schema-on-write boundary the moderator's send-path crosses.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — `useTranslation()` + ICU interpolation for `{nodeWording}` /
  `{index}` / `{reason}` / `{message}` / `{code}` substitutions.

Pending edges (this task does NOT depend on them; this task FEEDS them
or is independent of them):

- **`moderator_ui.mod_pending_proposals_pane.*`** — downstream consumer.
  The interpretive-split proposal landed by this task's envelope
  surfaces in the pending-proposals pane the same way an F1 propose or
  the decompose proposal does (the pane reads
  `useWsStore.sessionState[sessionId].pendingProposals` and renders
  per-kind; `PendingProposalsPane.tsx:167` already lists
  `'interpretive-split'` as one of the kinds with hard-coded English in
  the structural list — replacing that with localized strings is a
  separate concern outside this task).
- **Future `mod_commit_decomposition` / commit-time fan-out** (NOT
  registered in the WBS — gated by the open question flagged in
  `decomposition_logic.md` / `interpretive_split_logic.md` Open
  Questions sections). The commit-time multi-event fan-out for both
  decompose and interpretive-split is unresolved; a landed
  interpretive-split proposal cannot currently be committed. **This task
  does NOT lift that block** — it only ships the propose-side UI. The
  pending interpretive-split proposal sits in the pane awaiting the
  future commit-logic extension.
- **`frontend_i18n.i18n_interpretive_split_mode_native_review`**
  (registered by this task). The pt-BR + es-419 drafts of the 21 new
  keys land flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text.

## What this task is

Land the **full end-to-end interpretive-split flow** — the analogous F2
chain for the `interpretive-split` proposal sub-kind. Per
`docs/moderator-ui.md:62`: *"Interpretive splits use the same flow with a
different proposal kind."* The decompose flow shipped as three leaves
(mode-entry + multi-component capture + propose); the interpretive-split
flow is delivered in a single task because the **shape is identical** —
the work is parameterising the existing seams by a `mode:
'decompose' | 'interpretive-split'` discriminant rather than re-designing
from scratch.

Decision §1 (Scope) records the choice between (a) just the mode-entry
seam vs. (b) the full chain end-to-end. **This task chooses (b)** — the
WBS task name "Interpretive-split mode (analogous flow)" emphasises *flow*
(the full chain); the WBS has no follow-up sibling tasks for
interpretive-split component capture or propose action; and the
sibling-decompose chain already shipped every reusable abstraction this
task plugs into. Delivering only the mode-entry seam would leave the
moderator entering interpretive-split mode and staring at an empty
capture pane with no path to propose — the same dead end the decompose
flow had between `mod_decompose_mode` shipping and
`mod_multi_component_capture` + `mod_propose_decomposition` landing.

"The interpretive-split flow" means four coordinated state surfaces +
one server round-trip:

1. **Mode entry** — `captureStore.mode` flips from `'idle'` (or any other
   non-proposal mode) to `'interpretive-split'`. The
   `interpretiveSplitTargetNodeId` slice gets the right-clicked node's
   id. The F1 slices clear (same coupling
   `mod_decompose_mode.md` Decision §6 documented for the decompose
   mode). The `interpretiveSplitReadings` slice seeds to two empty rows.

2. **Reading capture** — the same N-row grid as decompose, parameterised
   on `mode` so it reads from `interpretiveSplitReadings` rather than
   `decomposeComponents`. The moderator types reading wording into each
   row and picks a statement-kind classification per row. The grid
   shows an "Add reading" button (capped at 10) and a per-row remove
   button (gated at the minimum 2). The visible chrome
   differs only in localized labels: "Reading {index}" instead of
   "Component {index}"; "Add reading" instead of "Add component"; etc.

3. **Propose action** — a "Propose interpretive split" button in the
   bottom-strip's `proposeAction` slot fires the
   `useProposeInterpretiveSplitAction()` hook. The hook applies the
   same four-gate validation (`session-missing`, `not-connected`,
   `target-missing`, `readings-invalid`), constructs the envelope (with
   `kind: 'interpretive-split'` and `readings: [...]` instead of
   `kind: 'decompose'` and `components: [...]`), optimistically clears
   via `exitInterpretiveSplitMode`, sends, and restores the snapshot on
   error.

4. **Exit affordance** — a small `×` button + the "Splitting
   {nodeWording}" target wording overlay alongside `<ModeBanner>` in
   the `bottom-strip-mode-banner` slot. Escape exits the mode (with
   priority over `onClearTarget` per the existing keymap convention,
   extended for the new mode value).

The server-side wire contract is settled: the propose handler appends
exactly one `proposal` event per envelope; the structural fan-out
(reading-node creation per `readings` array entry) is a commit-time
concern that's still unresolved (the open question in
[`interpretive_split_logic.md`](../data-and-methodology/interpretive_split_logic.md)
cross-references the same gap that decompose carries). The pending
interpretive-split proposal lands in the session's event log and the
pending-proposals projection but cannot currently be committed.

**Out of scope** (deferred):

- **Commit-time multi-event emission for interpretive-split.** Mirrors
  decompose's identical gap (per
  [`interpretive_split_logic.md`](../data-and-methodology/interpretive_split_logic.md)
  Open Questions). When that follow-up lands, it lifts the block for
  BOTH sub-kinds symmetrically; this task ships the propose-side UI and
  leaves the commit gap unchanged.
- **Cmd-shortcut keyboard entry.** `docs/moderator-ui.md:185-204`
  lists per-flow keyboard shortcuts. No `Cmd+I` / `Cmd+S` entry for
  interpretive-split exists in the shortcuts mapping at
  `packages/i18n-catalogs/src/keyboard-shortcuts.ts`; the decompose
  flow's `Cmd+D` shortcut is similarly out of scope per
  `mod_decompose_mode.md` Decision §8. Adding the shortcut is a future
  `mod_interpretive_split_shortcut` task (not registered in the WBS).
- **Per-row inline validation hints.** The grid surfaces no inline
  validation; the propose button's disabled state + the
  `readings-invalid` reason text in the validation-error inline region
  carry the surface — mirrors
  `mod_multi_component_capture.md` Decision §7 (deferred to a follow-up
  if usability testing reveals a need).
- **The pending-proposals pane's per-kind tile for
  `interpretive-split`.** The pane renders a generic placeholder for
  the kind today (`PendingProposalsPane.tsx:167`); per-kind tiles are
  the pending-proposals-pane subgroup's scope, not this task's.

## Why it needs to be done

Three reasons, in priority order:

1. **`mod_decompose_flow` (the parent block) closes only when this
   task closes.** Per the WBS at `tasks/30-moderator-ui.tji:330-353`,
   the parent block has four leaves: `mod_decompose_mode` (done
   2026-05-16), `mod_multi_component_capture` (done 2026-05-16),
   `mod_propose_decomposition` (done 2026-05-16), and this task.
   Closing this leaf derives-completes the parent.

2. **The methodology's primary tool for interpretive-seam disputes has
   no UI path today.** Per `docs/methodology.md:168-181`, interpretive
   splits are "the methodology's primary tool for 'we agree this
   statement is real but read it as different things' — produces N
   alternative readings of the same parent." The
   server-side validator landed two weeks ago
   (`interpretive_split_logic`, 2026-05-10); the wire schema landed
   (`packages/shared-types/src/events/proposals.ts:182-186`); the wire
   contract is settled (`ws_propose_message`'s `propose` handler with
   the `'interpretive-split'` arm). But the moderator has no UI path to
   construct the envelope today. This task closes the gap: a moderator
   can right-click a node, click "Propose interpretive split", capture
   N readings (wording + classification per reading), click "Propose
   interpretive split", and the envelope lands on the server.

3. **It tests whether the decompose flow's abstractions are right.**
   The decompose flow shipped as three concrete components-bound files
   (`Decompose*.tsx`); the implicit promise was that the
   interpretive-split task would reuse them via parameterisation. This
   task makes the promise concrete: every reuse seam (the store
   helpers, the grid + per-row components, the propose hook + button,
   the exit affordance, the captureKeymap mode-aware Escape) is either
   parameterised by `mode` OR generalised into a shared component with
   per-mode wrappers. If the abstractions don't survive the second
   caller, the right answer is to make them survive in this task —
   the alternative is parallel-but-divergent decompose and
   interpretive-split chains that drift in maintenance.

Downstream, no other task depends on this leaf — interpretive-split is
a terminal capability for the propose-side UI v1.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- `apps/moderator/src/stores/captureStore.ts:103-111` — the
  `CaptureMode` enum. Add `'interpretive-split'` as the ninth value.
- `apps/moderator/src/stores/captureStore.ts:44-47` — the
  `DecomposeComponent` type (`{ text: string; classification:
  StatementKind | null }`). Reused unchanged for the interpretive-split
  readings slice (Decision §1 records the no-rename choice).
- `apps/moderator/src/stores/captureStore.ts:56-92` — the existing
  bounds constants + `createEmptyDecomposeComponents()` factory +
  `validateDecomposeComponents()` free function. This task adds:
  - A neutral-named generalisation
    `validateProposalRows(rows: ReadonlyArray<DecomposeComponent>): boolean`
    with the same body; `validateDecomposeComponents` becomes a thin
    wrapper for source-stable consumers (`useProposeDecompositionAction.ts:177`).
  - A neutral-named `createEmptyProposalRows()` factory; the existing
    `createEmptyDecomposeComponents()` becomes a thin wrapper.
- `apps/moderator/src/stores/captureStore.ts:142-249` — the
  `CaptureState` interface. This task adds:
  - `interpretiveSplitTargetNodeId: string | null` (parallel to
    `decomposeTargetNodeId` at line 154).
  - `interpretiveSplitReadings: ReadonlyArray<DecomposeComponent>`
    (parallel to `decomposeComponents` at line 172).
  - `setInterpretiveSplitTargetNodeId`, `enterInterpretiveSplitMode`,
    `exitInterpretiveSplitMode`, `setInterpretiveSplitReadingText`,
    `setInterpretiveSplitReadingClassification`,
    `addInterpretiveSplitReading`, `removeInterpretiveSplitReading`
    (parallel to the seven existing decompose setters at lines 181-246).
- `apps/moderator/src/stores/captureStore.ts:251-270` — the
  `initialCaptureState` literal. Grows by two keys
  (`interpretiveSplitTargetNodeId: null`,
  `interpretiveSplitReadings: []`) so the `reset()` invariant clears
  the new slices automatically.
- `apps/moderator/src/stores/captureStore.ts:272-349` — the store
  factory closure. Grows by the seven new helpers; the
  `enterInterpretiveSplitMode` and `exitInterpretiveSplitMode` atomic
  updates clear the F1 slices on entry (same coupling as
  `enterDecomposeMode`) and seed the two-empty-row invariant on entry
  / clear on exit. The store does NOT clear the
  `decompose*` slices on `enterInterpretiveSplitMode` — the two modes
  are mutually exclusive (only one `mode` value at a time) and
  cross-clearing would compound risk; the operator who somehow has a
  populated `decomposeComponents` array while entering
  interpretive-split mode (a transient inconsistency that shouldn't
  happen in normal flow) will see those rows get cleared the next
  time decompose mode is entered. Decision §5 records the choice.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:228-262` — the
  `buildNodeMenuItems` factory. Add a fourth optional positional
  parameter `onEnterInterpretiveSplitMode?: (nodeId: string) => void`
  (after `onEnterDecomposeMode`). Add a new menu item
  `propose-interpretive-split` immediately after the existing
  `propose-decompose` item; the new item's `onSelect` is
  `target.kind === 'node' && target.id !== null && onEnterInterpretiveSplitMode`
  guarded — when supplied, calls `onEnterInterpretiveSplitMode(target.id)`;
  when omitted (direct unit-test invocations), falls through to the
  legacy `actionStub('propose-interpretive-split', target)`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:648-655` — the
  `enterDecomposeMode` stable callback. Add a sibling
  `enterInterpretiveSplitMode` callback alongside.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:943-962` — the
  `buildNodeMenuItems` call site. Pass `enterInterpretiveSplitMode` as
  the fourth positional argument.
- `apps/moderator/src/layout/DecomposeModeExitButton.tsx:1-120` — the
  predecessor exit-button component. This task **extracts** the body
  into a shared parameterised component
  `<ProposalModeExitAffordance mode>` at
  `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`; the
  existing `<DecomposeModeExitButton>` becomes a thin wrapper for
  source-stable consumers. The events-log target-wording resolver
  (`resolveDecomposeTargetWording`) is re-exported from the new shared
  module as `resolveProposalTargetWording`; the existing name stays as
  an alias.
- `apps/moderator/src/layout/captureKeymap.ts:215-240` — the
  mode-aware Escape early-return. Generalise the `mode === 'decompose'`
  check to `mode === 'decompose' || mode === 'interpretive-split'`.
  The existing comment update (`Decision §5 of mod_decompose_mode.md`)
  grows by a one-line reference to this task's refinement.
- `apps/moderator/src/layout/DecomposeComponentsGrid.tsx:46-91` — the
  multi-component grid. Add a new prop
  `mode: 'decompose' | 'interpretive-split'` (no default — explicit
  prop). The store reads switch on the prop. The `data-testid`s switch
  on the prop (`decompose-components-grid` vs
  `interpretive-split-readings-grid`; per-row testids similarly). The
  `componentsLength` selector reads
  `s.decomposeComponents.length` or `s.interpretiveSplitReadings.length`
  per the prop. The "Add component" / "Add reading" button label keys
  switch on the prop (`moderator.decompose.components.addRow` vs
  `moderator.interpretiveSplit.readings.addRow`). Decision §2 records
  the parameterise-vs-duplicate trade-off.
- `apps/moderator/src/layout/DecomposeComponentRow.tsx` — same
  parameterisation. The row threads the `mode` prop to its
  text-input + picker children.
- `apps/moderator/src/layout/DecomposeComponentTextInput.tsx` — same
  parameterisation. The store-read selector switches on `mode`. The
  `aria-label` resolves to per-mode label keys.
- `apps/moderator/src/layout/DecomposeComponentClassificationPicker.tsx` —
  same parameterisation. The store-write helper switches on `mode`
  (`setDecomposeComponentClassification` vs
  `setInterpretiveSplitReadingClassification`).
- `apps/moderator/src/layout/useProposeDecompositionAction.ts:1-317` —
  the predecessor hook. **Extract** the body into
  `apps/moderator/src/layout/useProposeProposalAction.ts` exporting
  `useProposeProposalAction({ mode })`. The existing
  `useProposeDecompositionAction` becomes a thin wrapper for
  source-stable consumers (the Operate route). The new
  `useProposeInterpretiveSplitAction` calls
  `useProposeProposalAction({ mode: 'interpretive-split' })`. The
  three substitutions: store-slice reads switch on `mode`; envelope's
  `kind` field switches; per-component-array field name in the
  envelope switches (`components` for decompose; `readings` for
  interpretive-split per
  `packages/shared-types/src/events/proposals.ts:185`).
- `apps/moderator/src/layout/useProposeDecompositionAction.ts:112-115` —
  the module-scoped `useProposeDecompositionErrorStore`. The
  parameterised hook owns a Map-style per-mode store: the two modes
  each get their own slice (Decision §6 mirrors
  `mod_propose_decomposition.md` Decision §11 — the two inline-error
  regions target different surfaces; cross-flow error bleed would be
  a regression).
- `apps/moderator/src/layout/ProposeDecompositionAction.tsx:89-167` —
  the predecessor button component. **Extract** the body into
  `apps/moderator/src/layout/ProposalAction.tsx` exporting
  `<ProposalAction mode>`. The existing
  `<ProposeDecompositionAction>` becomes a thin wrapper; the new
  `<ProposeInterpretiveSplitAction>` calls
  `<ProposalAction mode="interpretive-split">`. Each wrapper resolves
  the per-mode i18n key namespaces + the per-mode `data-testid`
  prefix (`propose-decomposition-action*` vs
  `propose-interpretive-split-action*`). Both wrappers share the
  Tailwind palette + the platform-detection chord glyph + the
  click-fires-hook-propose shape.
- `apps/moderator/src/routes/Operate.tsx:115-162` — the route's
  bottom-strip mount. Extend the four conditional ternaries to read
  the new `'interpretive-split'` mode value; mount the new wrappers
  (`<InterpretiveSplitReadingsGrid />`, the `<InterpretiveSplitModeExitButton />`
  alongside the existing exit button, the
  `<ProposeInterpretiveSplitAction />` alternative). Decision §5
  records the slot-content composition.
- `apps/server/src/methodology/handlers/propose.ts:279` — the
  `CONFLICTING_PARENT_KINDS` set. **Unchanged by this task** — already
  includes `'interpretive-split'`. The wire contract is settled; the
  symmetric mutual exclusion is server-enforced.
- `apps/server/src/methodology/handlers/propose.ts:383-446,1134-1137` —
  the `validateInterpretiveSplitProposal` validator + the propose
  handler's switch arm. **Unchanged by this task** — already in
  place. The wire envelope this task constructs lands at this arm
  and gets the same Valid/Rejected treatment a decompose envelope
  does.
- `packages/shared-types/src/events/proposals.ts:182-186` — the
  `interpretiveSplitProposalSchema`. **Unchanged** — already in
  place; the wire envelope conforms to this schema.
- `packages/i18n-catalogs/src/catalogs/en-US.json:285-314` — the
  existing `moderator.decompose.*` namespace. This task adds a
  parallel sibling namespace `moderator.interpretiveSplit.*` at the
  same nesting level.
- `packages/i18n-catalogs/src/catalogs/en-US.json:331-334` — the
  existing `moderator.modeBanner.decompose.*` block. This task adds
  the parallel `moderator.modeBanner.interpretive-split.*` block.
- `packages/i18n-catalogs/src/catalogs/en-US.json:357-363` — the
  node context-menu vocabulary. Add
  `moderator.contextMenu.node.proposeInterpretiveSplit`.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` — same key additions in the drafts.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` — 21 new `pending: true` entries per locale
  (42 total).
- `tasks/35-frontend-i18n.tji:214-220` — the existing
  `i18n_propose_decomposition_native_review` task (tail of the
  native-review chain). This task registers
  `i18n_interpretive_split_mode_native_review` after it.
- `tests/e2e/moderator-capture.spec.ts` — the canonical regression
  home. The new `test()` block joins the file as the next group entry.

DESIGN.md / docs consulted:

- `DESIGN.md:37` — design-doc link to `docs/moderator-ui.md` for the
  F2 decompose flow specification (which interpretive-split shares).
- `docs/moderator-ui.md:52-62` — F2 flow specification, including line
  62: "Interpretive splits use the same flow with a different
  proposal kind." The canonical statement settling scope (b).
- `docs/moderator-ui.md:14` — "Proposes decompositions and interpretive
  splits." The interpretive-split UI surface is one of the moderator
  role's stated capabilities.
- `docs/methodology.md:168-181` — interpretive-split methodology
  semantics. Distinction from decomposition: decomposition surfaces
  what was already bundled; interpretive split clarifies what is
  being argued about when the wording admits multiple readings. The
  graph treatment is identical (parent removed in current view,
  replaced by reading nodes); the methodology semantics differ.
- `docs/methodology.md:180` — "The graph treatment is the same in
  both cases: the parent node is replaced by component nodes in the
  current view; the change history records the original wording and
  the operation." Justifies the UI parallelism this task realises.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
  — the schema-on-write boundary the moderator's send-path crosses.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check ships as a committed Vitest / Playwright
  case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — `useTranslation()` + ICU interpolation for the per-mode label /
  reason / wire-error templates.
- [`mod_decompose_mode.md`](mod_decompose_mode.md) — the predecessor
  mode-entry seam + the `decomposeTargetNodeId` slice + the
  `enterDecomposeMode` / `exitDecomposeMode` atomic helpers + the
  F1-coupling clear pattern this task replicates for
  interpretive-split + the mode-aware Escape keymap routing this task
  extends.
- [`mod_multi_component_capture.md`](mod_multi_component_capture.md) —
  the predecessor multi-component capture grid + the slice + per-row
  mutators + the validator + the route-level slot-content swap +
  Decision §9 which **explicitly anticipates this task's
  parameterisation** ("The interpretive-split mode (sibling task in
  the F2 family) will mirror this task's exact shape").
- [`mod_propose_decomposition.md`](mod_propose_decomposition.md) — the
  predecessor propose-decomposition action + the hook + button + the
  four-gate validator + the optimistic-clear + the snapshot-restore +
  the wire-shape construction + the module-scoped error store. Decision
  §12 of that refinement (the template for `mod_interpretive_split_mode`)
  is what this task realises.
- [`interpretive_split_logic.md`](../data-and-methodology/interpretive_split_logic.md)
  — the server-side methodology validator + the four-rule evaluation
  order + the symmetric mutual exclusion with decompose. The wire
  contract is settled; this task's hook drives the same validator.
- [`decomposition_logic.md`](../data-and-methodology/decomposition_logic.md)
  — the prior decomposition-logic validator + the open question about
  commit-time fan-out (this task does NOT lift the commit block).
- [`mod_state_management.md`](mod_state_management.md) —
  `useCaptureStore` contract.
- [`mod_bottom_strip_capture.md`](mod_bottom_strip_capture.md) — the
  scaffold's slot contract.
- [`mod_mode_banner.md`](mod_mode_banner.md) — the per-mode catalog
  shape; this task adds the 9th mode's keys.
- [`mod_context_menus.md`](mod_context_menus.md) — the node-menu
  factory pattern; this task adds the new item using the same
  optional-parameter shape `mod_axiom_mark_action` and
  `mod_decompose_mode` set.
- [`mod_axiom_mark_action.md`](mod_axiom_mark_action.md) — the
  precedent for the `onOpenXxx?: () => void` parameter pattern on
  `buildNodeMenuItems`.
- [`proposal_events.md`](../data-and-methodology/proposal_events.md) —
  the `interpretive-split.readings` field name + the 2..10 bound.

No new ADR is required (see Decision §9). No new external runtime
dependency lands. No public type signatures change beyond the additive
`CaptureMode` enum value + the additive `CaptureState` slices +
helpers; the existing `DecomposeComponent` / `createEmptyDecomposeComponents` /
`validateDecomposeComponents` / `<DecomposeModeExitButton>` /
`<DecomposeComponentsGrid>` / `useProposeDecompositionAction` /
`<ProposeDecompositionAction>` public names are preserved (as thin
wrappers over the new parameterised shared shapes).

## Constraints / requirements

### Store extension (`apps/moderator/src/stores/captureStore.ts`)

- **`CaptureMode` enum** grows by one value: `'interpretive-split'`.
  Additive; existing call sites are unaffected.
- **Two new slices** on `CaptureState`:
  - `interpretiveSplitTargetNodeId: string | null` (parallel to
    `decomposeTargetNodeId`).
  - `interpretiveSplitReadings: ReadonlyArray<DecomposeComponent>`
    (parallel to `decomposeComponents`).
  Both default to `null` / `[]` in `initialCaptureState`; the
  `Pick<CaptureState, ...>` type union grows by both keys; the
  `reset()` invariant rides for free.
- **Seven new helpers** on `CaptureState` (mirror the decompose seven):
  ```ts
  setInterpretiveSplitTargetNodeId: (id: string | null) => void;
  enterInterpretiveSplitMode: (nodeId: string) => void;
  exitInterpretiveSplitMode: () => void;
  setInterpretiveSplitReadingText: (index: number, text: string) => void;
  setInterpretiveSplitReadingClassification: (index: number, classification: StatementKind | null) => void;
  addInterpretiveSplitReading: () => void;
  removeInterpretiveSplitReading: (index: number) => void;
  ```
- **`enterInterpretiveSplitMode(nodeId)` body** — atomic single-`set()`
  mirroring `enterDecomposeMode`:
  ```ts
  set({
    mode: 'interpretive-split',
    interpretiveSplitTargetNodeId: nodeId,
    // F1-coupling clear — mod_decompose_mode.md Decision §6:
    text: '',
    classification: null,
    targetEntityId: null,
    edgeRole: null,
    // Two-empty-row seed — mod_multi_component_capture.md Decision §1:
    interpretiveSplitReadings: createEmptyProposalRows(),
  })
  ```
  Note: this does **NOT** clear the `decomposeComponents` /
  `decomposeTargetNodeId` slices. The two modes share `mode` as the
  exclusion mechanism; cross-clearing isn't needed (Decision §5).
- **`exitInterpretiveSplitMode()` body** — atomic single-`set()`:
  ```ts
  set({
    mode: 'idle',
    interpretiveSplitTargetNodeId: null,
    interpretiveSplitReadings: [],
  })
  ```
- **Per-row mutator bodies** — exactly mirror the decompose mutator
  shapes (`map`/`concat`/`filter` into new arrays; defensive clamp on
  text per `MAX_METHODOLOGY_TEXT_LENGTH`; no-op at the min / max
  bounds).
- **Two new free-function names** at module scope:
  - `createEmptyProposalRows(): DecomposeComponent[]` — body identical
    to the existing `createEmptyDecomposeComponents()`. The existing
    name stays as a thin wrapper.
  - `validateProposalRows(rows: ReadonlyArray<DecomposeComponent>): boolean` —
    body identical to the existing `validateDecomposeComponents()`. The
    existing name stays as a thin wrapper for
    `useProposeDecompositionAction.ts:177`'s call.

### Context-menu extension (`apps/moderator/src/graph/GraphCanvasPane.tsx`)

- **`buildNodeMenuItems` signature** grows by one optional positional
  parameter:
  ```ts
  export function buildNodeMenuItems(
    target: ContextMenuState['target'],
    onOpenAxiomMarkSubmenu?: () => void,
    onEnterDecomposeMode?: (nodeId: string) => void,
    onEnterInterpretiveSplitMode?: (nodeId: string) => void,
  ): readonly MenuItem[];
  ```
- **New menu item** `propose-interpretive-split` immediately after the
  existing `propose-decompose` item (lines 240-246):
  ```ts
  {
    id: 'propose-interpretive-split',
    labelKey: 'moderator.contextMenu.node.proposeInterpretiveSplit',
    onSelect:
      target.kind === 'node' && target.id !== null && onEnterInterpretiveSplitMode
        ? () => onEnterInterpretiveSplitMode(target.id as string)
        : () => actionStub('propose-interpretive-split', target),
  },
  ```
- **Canvas-local stable callback** alongside the existing
  `enterDecomposeMode` at lines 648-655:
  ```ts
  const enterInterpretiveSplitMode = useCallback(
    (nodeId: string) => useCaptureStore.getState().enterInterpretiveSplitMode(nodeId),
    [],
  );
  ```
- **Menu-items builder call site** at line 943-962 grows by one
  argument:
  ```ts
  menuItems = buildNodeMenuItems(
    contextMenu.target,
    () => { /* axiom-mark submenu opener */ },
    enterDecomposeMode,
    enterInterpretiveSplitMode,
  );
  ```

### Shared exit-affordance extraction (`apps/moderator/src/layout/`)

- **New file** `ProposalModeExitAffordance.tsx` exporting
  `function ProposalModeExitAffordance(props: { mode: 'decompose' |
  'interpretive-split' }): ReactElement | null`. Body extracted from
  the existing `DecomposeModeExitButton.tsx:72-120` with the
  per-mode substitutions:
  - Visibility gate reads `mode === props.mode`.
  - Target-node-id slice reads `s.decomposeTargetNodeId` or
    `s.interpretiveSplitTargetNodeId` per `props.mode`.
  - Exit helper reads `s.exitDecomposeMode` or
    `s.exitInterpretiveSplitMode` per `props.mode`.
  - i18n key resolution uses per-mode namespaces
    (`moderator.decompose.{exit, banner}.*` vs
    `moderator.interpretiveSplit.{exit, banner}.*`).
  - `data-testid` switches per `props.mode`:
    `{decompose, interpretive-split}-mode-exit-container`,
    `{decompose, interpretive-split}-mode-target-wording`,
    `{decompose, interpretive-split}-mode-exit`.
- **New file** `InterpretiveSplitModeExitButton.tsx` exporting
  `function InterpretiveSplitModeExitButton(): ReactElement | null`.
  Thin wrapper:
  ```tsx
  export function InterpretiveSplitModeExitButton(): ReactElement | null {
    return <ProposalModeExitAffordance mode="interpretive-split" />;
  }
  ```
- **Update** `DecomposeModeExitButton.tsx` — replace the body with a
  thin wrapper over `<ProposalModeExitAffordance mode="decompose">`.
  Preserve the export signature. The
  `resolveDecomposeTargetWording` named export stays as an alias for
  the new module-scoped `resolveProposalTargetWording` (the
  events-log walker is rename-with-alias; existing
  `DecomposeModeExitButton.test.tsx` imports the wrapper name and
  asserts the rendered DOM).
- **Both wrapper components preserve their existing `data-testid`s**
  for backward-compat regression continuity. The shared component's
  `data-testid` is `props.mode`-derived; the wrappers don't need to
  thread additional names.

### captureKeymap mode-aware Escape extension (`apps/moderator/src/layout/captureKeymap.ts`)

- **`onExitMode` priority condition** at lines 226-240. Generalise
  the `mode === 'decompose'` check:
  ```ts
  if (key === 'escape') {
    const mode = useCaptureStore.getState().mode;
    if (
      (mode === 'decompose' || mode === 'interpretive-split') &&
      handlers.onExitMode !== undefined
    ) {
      event.preventDefault();
      handlers.onExitMode();
      return;
    }
    if (handlers.onClearTarget !== undefined) {
      event.preventDefault();
      handlers.onClearTarget();
      return;
    }
  }
  ```
- **Update the `onExitMode` doc-block** at lines 91-105 to also
  reference this refinement (`mod_interpretive_split_mode.md`)
  alongside the existing `mod_decompose_mode.md` reference. The
  doc-block already mentions "future interpretive-split"; the
  reference becomes concrete.
- **No new handler is added** to `CaptureKeymapHandlers`. The single
  `onExitMode` handler is the right shape; each mounting component
  (the per-mode exit-button wrappers) owns its own closure.

### Grid family parameterisation (`apps/moderator/src/layout/Decompose*.tsx`)

- **`<DecomposeComponentsGrid>`** grows by a new prop
  `mode: 'decompose' | 'interpretive-split'` (required; no default).
  The component's body:
  - The visibility gate reads `mode === props.mode`.
  - The `componentsLength` selector reads
    `s.decomposeComponents.length` or `s.interpretiveSplitReadings.length`
    per `props.mode`.
  - The add / remove helpers read
    `s.addDecomposeComponent` / `s.removeDecomposeComponent` OR
    `s.addInterpretiveSplitReading` / `s.removeInterpretiveSplitReading`
    per `props.mode`.
  - The root `data-testid` switches per `props.mode`:
    `decompose-components-grid` vs
    `interpretive-split-readings-grid`.
  - The aria-label reads per-mode i18n key
    (`moderator.decompose.components.classificationLegend` vs
    `moderator.interpretiveSplit.readings.classificationLegend`).
  - The "Add component" / "Add reading" button label reads per-mode
    (`moderator.decompose.components.addRow` vs
    `moderator.interpretiveSplit.readings.addRow`).
  - The button's `data-testid` switches per `props.mode`:
    `decompose-components-add-row` vs
    `interpretive-split-readings-add-row`.
  - Threads `mode={props.mode}` to each `<DecomposeComponentRow>`
    child.
- **New thin wrapper** `<InterpretiveSplitReadingsGrid />` at
  `apps/moderator/src/layout/InterpretiveSplitReadingsGrid.tsx`:
  ```tsx
  export function InterpretiveSplitReadingsGrid(): ReactElement | null {
    return <DecomposeComponentsGrid mode="interpretive-split" />;
  }
  ```
  The wrapper exists so the route mounts a named component
  (matching the decompose-side naming convention) and so future test
  imports have a per-mode name to assert against.
- **Update** the existing `<DecomposeComponentsGrid>` callers — the
  route's mount of `<DecomposeComponentsGrid />` becomes
  `<DecomposeComponentsGrid mode="decompose" />`. The route's import
  stays the same.
- **`<DecomposeComponentRow>`** grows by a new prop
  `mode: 'decompose' | 'interpretive-split'`. The row threads it to
  the text-input and the picker; the row-label key + the
  remove-row-aria key switch on `mode`:
  - `moderator.decompose.components.rowLabel` vs
    `moderator.interpretiveSplit.readings.rowLabel`.
  - `moderator.decompose.components.removeRowAria` vs
    `moderator.interpretiveSplit.readings.removeRowAria`.
- **`<DecomposeComponentTextInput>`** grows by the `mode` prop. The
  store-read selector switches; the `data-testid` switches
  (`decompose-component-text-${index}` vs
  `interpretive-split-reading-text-${index}`); the per-row
  `aria-label` reads from the per-mode rowLabel key; the placeholder
  reads per-mode `textPlaceholder`.
- **`<DecomposeComponentClassificationPicker>`** grows by the `mode`
  prop. The store-write helper switches; the `data-testid`s switch
  (`decompose-component-classification-${index}` vs
  `interpretive-split-reading-classification-${index}`; per-button
  testids similarly).

### Propose-action hook generalisation (`apps/moderator/src/layout/`)

- **New file** `useProposeProposalAction.ts` exporting
  `useProposeProposalAction(args: { mode: 'decompose' |
  'interpretive-split' }): UseProposeProposalActionResult`. Body
  extracted from `useProposeDecompositionAction.ts:148-317` with the
  three substitutions:
  - Slice reads switch on `args.mode`:
    `s.decomposeTargetNodeId` / `s.interpretiveSplitTargetNodeId`;
    `s.decomposeComponents` / `s.interpretiveSplitReadings`.
  - The optimistic-clear helper switches: `exitDecomposeMode` /
    `exitInterpretiveSplitMode`.
  - The snapshot-restore replay switches: `enterDecomposeMode` /
    `enterInterpretiveSplitMode`; the per-row replay uses
    `setDecomposeComponentText` / `setDecomposeComponentClassification` /
    `addDecomposeComponent` OR the parallel interpretive-split
    setters.
  - Envelope construction switches:
    - `kind` field: `'decompose'` vs `'interpretive-split'`.
    - Per-row array field name: `components` vs `readings`. The
      `text → wording` rename remains the same.
  - i18n key resolution switches between the two
    `moderator.{decompose, interpretiveSplit}.propose.*` namespaces.
- **Renamed validation-error reason** — the four-reason union is
  shared:
  ```ts
  export type ProposalValidationErrorReason =
    | 'session-missing'
    | 'not-connected'
    | 'target-missing'
    | 'rows-invalid';
  ```
  The fourth reason is renamed from `'components-invalid'` to
  `'rows-invalid'` (mode-neutral). The existing
  `DecomposeValidationErrorReason` export stays as an alias for
  source-stable consumers (the predecessor's
  `<ProposeDecompositionAction>` test file imports the name); the
  reason key resolution layer maps `'rows-invalid'` to the per-mode
  catalog key (`moderator.decompose.propose.reason.componentsInvalid`
  for decompose; `moderator.interpretiveSplit.propose.reason.readingsInvalid`
  for interpretive-split).
- **Per-mode module-scoped error stores** — preserve
  `useProposeDecompositionErrorStore` (for the decompose wrapper);
  mint `useProposeInterpretiveSplitErrorStore` with the identical
  shape. The parameterised hook reads from the right store per
  `args.mode`; the test seam `resetProposeDecompositionError` stays
  as-is and the new `resetProposeInterpretiveSplitError` mirrors it.
- **New thin wrappers**:
  - `useProposeDecompositionAction()` — unchanged signature; body
    becomes `return useProposeProposalAction({ mode: 'decompose' });`.
  - `useProposeInterpretiveSplitAction()` —
    `return useProposeProposalAction({ mode: 'interpretive-split' });`.

### Propose-action component generalisation (`apps/moderator/src/layout/`)

- **New file** `ProposalAction.tsx` exporting `<ProposalAction
  mode>`. Body extracted from
  `ProposeDecompositionAction.tsx:89-167` with the substitutions:
  - Hook call switches: `useProposeProposalAction({ mode })`.
  - i18n key namespaces switch on `mode`.
  - `data-testid` prefixes switch on `mode`:
    `propose-decomposition-action*` vs
    `propose-interpretive-split-action*`.
- **Thin wrappers**:
  - `<ProposeDecompositionAction>` — unchanged signature; body
    becomes `return <ProposalAction mode="decompose" />;`.
  - `<ProposeInterpretiveSplitAction>` —
    `return <ProposalAction mode="interpretive-split" />;`.

### Route-level slot-content extension (`apps/moderator/src/routes/Operate.tsx`)

- **Derive two new booleans** alongside the existing
  `isDecomposeMode` at line 116:
  ```ts
  const isInterpretiveSplitMode = mode === 'interpretive-split';
  const isProposalMode = isDecomposeMode || isInterpretiveSplitMode;
  ```
- **`modeBanner` slot** at line 143-148 — mount the new exit-button
  alongside the existing one:
  ```tsx
  modeBanner={
    <>
      <ModeBanner />
      <DecomposeModeExitButton />
      <InterpretiveSplitModeExitButton />
    </>
  }
  ```
  Each component is mode-gated internally; only the matching one
  renders DOM in any given mode. Both render `null` outside their
  matching mode.
- **`textInput` slot** at line 149-159:
  ```tsx
  textInput={
    isProposalMode ? (
      isInterpretiveSplitMode
        ? <InterpretiveSplitReadingsGrid />
        : <DecomposeComponentsGrid mode="decompose" />
    ) : (
      <CaptureTextInput onSubmit={() => { void propose(); }} />
    )
  }
  ```
- **`classificationPalette` slot** at line 160 — gate on
  `isProposalMode`:
  ```tsx
  classificationPalette={isProposalMode ? null : <ClassificationPalette />}
  ```
- **`edgeRoleSelector` slot** at line 161 — gate on
  `isProposalMode`:
  ```tsx
  edgeRoleSelector={isProposalMode ? null : <CaptureTargetAndRole />}
  ```
- **`proposeAction` slot** at line 162:
  ```tsx
  proposeAction={
    isDecomposeMode
      ? <ProposeDecompositionAction />
      : isInterpretiveSplitMode
        ? <ProposeInterpretiveSplitAction />
        : <ProposeAction />
  }
  ```
- **Update the route's leading Refinement comment** to reference
  `mod_interpretive_split_mode.md` alongside the existing
  refinements.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.interpretiveSplit.exit.ariaLabel` | "Exit interpretive split mode" | "Sair do modo de divisão interpretativa" | "Salir del modo de división interpretativa" |
| `moderator.interpretiveSplit.exit.tooltip` | "Cancel interpretive split (Esc)" | "Cancelar divisão interpretativa (Esc)" | "Cancelar división interpretativa (Esc)" |
| `moderator.interpretiveSplit.banner.targetWording` | "Splitting {nodeWording}" | "Dividindo {nodeWording}" | "Dividiendo {nodeWording}" |
| `moderator.interpretiveSplit.readings.rowLabel` | "Reading {index}" | "Leitura {index}" | "Lectura {index}" |
| `moderator.interpretiveSplit.readings.textPlaceholder` | "Reading wording…" | "Texto da leitura…" | "Texto de la lectura…" |
| `moderator.interpretiveSplit.readings.classificationLegend` | "Reading kind" | "Tipo da leitura" | "Tipo de la lectura" |
| `moderator.interpretiveSplit.readings.addRow` | "Add reading" | "Adicionar leitura" | "Añadir lectura" |
| `moderator.interpretiveSplit.readings.removeRowAria` | "Remove reading {index}" | "Remover leitura {index}" | "Eliminar lectura {index}" |
| `moderator.interpretiveSplit.propose.label` | "Propose interpretive split" | "Propor divisão interpretativa" | "Proponer división interpretativa" |
| `moderator.interpretiveSplit.propose.inFlightLabel` | "Proposing interpretive split…" | "Propondo divisão interpretativa…" | "Proponiendo división interpretativa…" |
| `moderator.interpretiveSplit.propose.ariaLabel` | "Propose the captured interpretive split as a proposal on the graph" | "Propor a divisão interpretativa capturada como uma proposta no grafo" | "Proponer la división interpretativa capturada como propuesta en el grafo" |
| `moderator.interpretiveSplit.propose.validationError` | "Cannot propose interpretive split: {reason}" | "Não foi possível propor a divisão interpretativa: {reason}" | "No se puede proponer la división interpretativa: {reason}" |
| `moderator.interpretiveSplit.propose.wireError` | "Propose interpretive split failed: {message} ({code})" | "Falha ao propor divisão interpretativa: {message} ({code})" | "Falló al proponer división interpretativa: {message} ({code})" |
| `moderator.interpretiveSplit.propose.timeoutError` | "The propose interpretive split request timed out. Check your connection and try again." | "A solicitação de proposta de divisão interpretativa expirou. Verifique sua conexão e tente novamente." | "La solicitud de proponer división interpretativa expiró. Verifica tu conexión y vuelve a intentarlo." |
| `moderator.interpretiveSplit.propose.reason.sessionMissing` | "no session is loaded" | "nenhuma sessão carregada" | "no hay sesión cargada" |
| `moderator.interpretiveSplit.propose.reason.notConnected` | "the session is not connected — reconnecting…" | "a sessão não está conectada — reconectando…" | "la sesión no está conectada — reconectando…" |
| `moderator.interpretiveSplit.propose.reason.targetMissing` | "no parent node selected for interpretive split" | "nenhum nó pai selecionado para divisão interpretativa" | "no hay nodo padre seleccionado para la división interpretativa" |
| `moderator.interpretiveSplit.propose.reason.readingsInvalid` | "every reading needs wording and a classification (2–10 rows)" | "cada leitura precisa de texto e classificação (2–10 linhas)" | "cada lectura necesita texto y clasificación (2–10 filas)" |
| `moderator.modeBanner.interpretive-split.label` | "Interpretive split" | "Divisão interpretativa" | "División interpretativa" |
| `moderator.modeBanner.interpretive-split.description` | "Surface multiple readings of the selected statement when the wording admits more than one." | "Surge múltiplas leituras da declaração selecionada quando o texto admite mais de uma." | "Surge múltiples lecturas de la declaración seleccionada cuando el texto admite más de una." |
| `moderator.contextMenu.node.proposeInterpretiveSplit` | "Propose interpretive split" | "Propor divisão interpretativa" | "Proponer división interpretativa" |

**Total: 21 keys × 3 locales = 63 catalog entries.** pt-BR / es-419
drafts land flagged PENDING in `pt-BR.review.json` +
`es-419.review.json` (42 PENDING entries total). en-US is
authoritative. Native-speaker review registered as
`i18n_interpretive_split_mode_native_review` (see Acceptance
criteria).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/stores/captureStore.ts` (modified — enum value,
  two slices, seven helpers, the two generalised free functions, the
  thin-wrapper preservation).
- `apps/moderator/src/stores/captureStore.test.ts` (modified — new
  cases for the enum value + slices + helpers + helper-extraction
  pins).
- `apps/moderator/src/graph/GraphCanvasPane.tsx` (modified —
  `buildNodeMenuItems` fourth parameter + the new menu item + the
  canvas-local stable callback + the call-site argument).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (modified — new
  cases for the new menu item + the new factory parameter + the
  canvas-wired click → store-mode flip).
- `apps/moderator/src/layout/ProposalModeExitAffordance.tsx` (new —
  shared parameterised exit-affordance component).
- `apps/moderator/src/layout/ProposalModeExitAffordance.test.tsx`
  (new — covers both modes).
- `apps/moderator/src/layout/DecomposeModeExitButton.tsx` (modified —
  body becomes a thin wrapper; export signature preserved; the
  `resolveDecomposeTargetWording` name stays as an alias of the
  re-exported `resolveProposalTargetWording`).
- `apps/moderator/src/layout/DecomposeModeExitButton.test.tsx`
  (modified — extend assertions for the wrapper preservation; the
  existing testid + behavior assertions stay green via the wrapper).
- `apps/moderator/src/layout/InterpretiveSplitModeExitButton.tsx`
  (new — the parallel thin wrapper).
- `apps/moderator/src/layout/InterpretiveSplitModeExitButton.test.tsx`
  (new — sibling test file).
- `apps/moderator/src/layout/captureKeymap.ts` (modified — generalise
  the mode-aware Escape early-return; update doc-block).
- `apps/moderator/src/layout/captureKeymap.test.ts` (modified — new
  cases for `mode === 'interpretive-split'` routing).
- `apps/moderator/src/layout/DecomposeComponentsGrid.tsx` (modified —
  add the `mode` prop; per-mode `data-testid`s + selector branching +
  per-mode label keys).
- `apps/moderator/src/layout/DecomposeComponentsGrid.test.tsx`
  (modified — new cases under `mode='interpretive-split'`).
- `apps/moderator/src/layout/DecomposeComponentRow.tsx` (modified —
  add `mode`; thread to children; per-mode label keys).
- `apps/moderator/src/layout/DecomposeComponentRow.test.tsx`
  (modified — new cases under both modes).
- `apps/moderator/src/layout/DecomposeComponentTextInput.tsx`
  (modified — add `mode`; selector branching; per-mode `data-testid`
  + label key resolution).
- `apps/moderator/src/layout/DecomposeComponentTextInput.test.tsx`
  (modified — new cases under both modes).
- `apps/moderator/src/layout/DecomposeComponentClassificationPicker.tsx`
  (modified — add `mode`; selector branching; per-mode `data-testid`
  resolution).
- `apps/moderator/src/layout/DecomposeComponentClassificationPicker.test.tsx`
  (modified — new cases under both modes).
- `apps/moderator/src/layout/InterpretiveSplitReadingsGrid.tsx` (new —
  the parallel thin wrapper for naming continuity).
- `apps/moderator/src/layout/useProposeProposalAction.ts` (new —
  parameterised hook with the shared body + per-mode error stores).
- `apps/moderator/src/layout/useProposeProposalAction.test.tsx` (new —
  covers both modes with the parameterised hook).
- `apps/moderator/src/layout/useProposeDecompositionAction.ts`
  (modified — body becomes a thin wrapper over
  `useProposeProposalAction({ mode: 'decompose' })`; the existing
  exports + signatures preserved).
- `apps/moderator/src/layout/useProposeDecompositionAction.test.tsx`
  (modified — assert the wrapper preservation; existing assertions
  stay green via the wrapper).
- `apps/moderator/src/layout/useProposeInterpretiveSplitAction.ts`
  (new — the parallel thin wrapper).
- `apps/moderator/src/layout/ProposalAction.tsx` (new — shared
  parameterised propose-action component).
- `apps/moderator/src/layout/ProposalAction.test.tsx` (new — covers
  both modes).
- `apps/moderator/src/layout/ProposeDecompositionAction.tsx`
  (modified — thin wrapper over `<ProposalAction mode="decompose">`).
- `apps/moderator/src/layout/ProposeDecompositionAction.test.tsx`
  (modified — existing assertions stay green via the wrapper).
- `apps/moderator/src/layout/ProposeInterpretiveSplitAction.tsx`
  (new — the parallel thin wrapper).
- `apps/moderator/src/layout/ProposeInterpretiveSplitAction.test.tsx`
  (new — sibling test file with the per-mode `data-testid` +
  catalog-key assertions).
- `apps/moderator/src/routes/Operate.tsx` (modified — derive
  `isInterpretiveSplitMode` + `isProposalMode`, extend the four slot
  conditionals; import the four new wrappers; update the leading
  Refinement comment).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 21 new
  keys).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same 21 keys with the drafts).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 21 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — new `test()`
  block under the existing `test.describe('moderator capture flow',
  ...)` group).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_interpretive_split_mode`
  lands at task-completion time per the README ritual, not at
  refinement-write time. The Closer also adds the new
  `i18n_interpretive_split_mode_native_review` task to
  `tasks/35-frontend-i18n.tji` AND adds `complete 100` to the parent
  `mod_decompose_flow` (this task closing the last leaf
  derives-completes the parent).
- `docs/adr/` — no new ADR (Decision §9).
- `apps/server/src/` — no server-side change. The propose-side
  validator (`validateInterpretiveSplitProposal`) is already in
  place; the `CONFLICTING_PARENT_KINDS` set already includes
  `'interpretive-split'`.
- `apps/moderator/src/layout/ModeBanner.tsx` — unchanged. The
  banner reads `moderator.modeBanner.<mode>.{label, description}`
  per the existing pattern; the new keys for the 9th mode are
  consumed without code change.
- `apps/moderator/src/layout/BottomStripCapture.tsx` — unchanged.
  The scaffold's slot contract is unchanged; the route's
  conditional swap is what changes the slot's content.
- `apps/moderator/src/layout/PendingProposalsPane.tsx` — unchanged.
  The pane's hard-coded English for the `interpretive-split` kind at
  line 167 is a separate concern (the per-kind tile localization is
  the pending-proposals-pane subgroup's scope).
- `apps/moderator/src/layout/ProposeAction.tsx` — unchanged. The F1
  button is consumed unchanged.
- `apps/moderator/src/layout/useProposeAction.ts` — unchanged. The
  F1 hook is consumed unchanged. The `toWireError` helper + the
  `WireError` type are re-imported by the new shared
  `useProposeProposalAction.ts` (already re-exported from
  `useProposeDecompositionAction.ts` per
  `mod_propose_decomposition.md` Decision §11).
- `packages/shared-types/` — no schema change. The
  `interpretiveSplitProposalSchema` + the wire envelope's
  discriminated union are already settled.
- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — no new
  shortcut entry (per the deferred-shortcut Out-of-Scope item in
  "What this task is").
- `apps/server/src/methodology/handlers/propose.ts` — unchanged.
  The interpretive-split arm + the `CONFLICTING_PARENT_KINDS` set
  are settled.

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 32 new cases across the touched +
  new test files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity
  check) green after the catalog edits — every
  `moderator.interpretiveSplit.*` key present in en-US is present in
  pt-BR and es-419; the `moderator.modeBanner.interpretive-split.*`
  pair is present in all three locales; the
  `moderator.contextMenu.node.proposeInterpretiveSplit` key is
  present in all three locales.
- `pnpm -F @a-conversa/moderator build` succeeds (six new small
  files; six modified-to-wrap files; bundle impact modest because
  the wrappers don't add new logic).
- `pnpm exec playwright test` green against a freshly brought-up
  dev compose stack; the new interpretive-split e2e scenario passes
  against the real server.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_interpretive_split_mode` AND
  the parent `mod_decompose_flow` AND registers the new
  `i18n_interpretive_split_mode_native_review` task block.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The interpretive-split flow is fully reachable from a real user
flow as of this task: the moderator can log in, create a session,
bridge the lobby gate, operate, seed a node via `seedWsStore`,
right-click the node, click "Propose interpretive split", fill 2
reading rows, click the propose-interpretive-split button — and the
envelope reaches the server with the `interpretive-split` proposal
kind. Per the UI-stream e2e policy default, the Playwright spec is
**scoped under Acceptance criteria, NOT deferred**. Decision §7
records the full-chain scope; the test mirrors the structure of
`mod_propose_decomposition`'s e2e block.

The commit-side path is still blocked (per the same open question
in `interpretive_split_logic.md`); the test asserts only the
propose-side surface (the envelope reaches the server and the
`proposal` event lands in the session's event log; the parent's
visibility does NOT flip — that's a commit-time effect).

## Acceptance criteria

### 1. Store extensions (`apps/moderator/src/stores/captureStore.ts`)

- `CaptureMode` type union includes `'interpretive-split'` (the ninth
  value).
- `useCaptureStore`'s `CaptureState` interface carries
  `interpretiveSplitTargetNodeId: string | null` +
  `interpretiveSplitReadings: ReadonlyArray<DecomposeComponent>` plus
  the seven new helpers
  (`setInterpretiveSplitTargetNodeId`, `enterInterpretiveSplitMode`,
  `exitInterpretiveSplitMode`, `setInterpretiveSplitReadingText`,
  `setInterpretiveSplitReadingClassification`,
  `addInterpretiveSplitReading`, `removeInterpretiveSplitReading`).
- `initialCaptureState`'s value carries
  `interpretiveSplitTargetNodeId: null` +
  `interpretiveSplitReadings: []`; the `Pick<CaptureState, ...>`
  type union includes both keys.
- `useCaptureStore.getState().enterInterpretiveSplitMode('n1')`
  results in `state.mode === 'interpretive-split'`,
  `state.interpretiveSplitTargetNodeId === 'n1'`,
  `state.interpretiveSplitReadings.length === 2` with both rows
  deep-equal to `{ text: '', classification: null }`. The F1 slices
  are cleared (`text === ''`, `classification === null`,
  `targetEntityId === null`, `edgeRole === null`). The decompose
  slices are NOT cleared (the call doesn't touch them — see
  Decision §5).
- `enterInterpretiveSplitMode` uses a single `set()` — subscribe to
  the store, count subscriber notifications, assert exactly one
  transition per call.
- `useCaptureStore.getState().exitInterpretiveSplitMode()` results in
  `state.mode === 'idle'`,
  `state.interpretiveSplitTargetNodeId === null`,
  `state.interpretiveSplitReadings === []`.
- `useCaptureStore.getState().reset()` clears both new slices to
  their initial values.
- `setInterpretiveSplitReadingText(0, 'hello')` writes to row 0;
  row 1 unchanged; reference identity changes for the slice but not
  for unaffected rows.
- `setInterpretiveSplitReadingText(0, 'x'.repeat(10_001))` clamps to
  `length === 10_000`.
- `addInterpretiveSplitReading()` at `length === 10` is a no-op;
  `removeInterpretiveSplitReading(0)` at `length === 2` is a no-op.
- The exported free functions `validateProposalRows` and
  `createEmptyProposalRows` produce the expected truth-table /
  shape; the existing `validateDecomposeComponents` /
  `createEmptyDecomposeComponents` names continue to resolve via the
  wrapper preservation (asserted by an "imported name still
  resolves" test that calls each via the existing export path).

### 2. Context-menu factory + canvas wire-up

- `buildNodeMenuItems` accepts an optional fourth positional
  parameter `onEnterInterpretiveSplitMode?: (nodeId: string) =>
  void`. When supplied, the new `propose-interpretive-split` item's
  `onSelect` calls `onEnterInterpretiveSplitMode(target.id)` once
  per invocation. When omitted, the item's `onSelect` calls the
  legacy `actionStub('propose-interpretive-split', target)` (so
  existing factory-shape tests do not need to thread a parameter).
- The new menu item's `labelKey` resolves to
  `'moderator.contextMenu.node.proposeInterpretiveSplit'` and the
  rendered text is "Propose interpretive split" in en-US.
- `<GraphCanvasPaneInner>` builds node menu items with a stable
  `enterInterpretiveSplitMode` callback that dispatches to
  `useCaptureStore.getState().enterInterpretiveSplitMode(nodeId)`.
- Right-clicking a node and clicking "Propose interpretive split" in
  the resulting menu transitions
  `useCaptureStore.getState().mode` from `'idle'` to
  `'interpretive-split'` and sets `interpretiveSplitTargetNodeId`
  to the right-clicked node's id.

### 3. Exit-button render gating

- `<InterpretiveSplitModeExitButton>` renders `null` when
  `useCaptureStore((s) => s.mode) !== 'interpretive-split'`. The
  DOM contains no `interpretive-split-mode-exit` element in this
  state.
- `<InterpretiveSplitModeExitButton>` renders the button with the
  `interpretive-split-mode-exit` `data-testid`, the localized
  aria-label ("Exit interpretive split mode"), the localized
  tooltip, and the localized target-wording overlay ("Splitting
  {nodeWording}") when `mode === 'interpretive-split'`.
- Clicking the button calls
  `useCaptureStore.getState().exitInterpretiveSplitMode()` once;
  mode reverts to `'idle'`; `interpretiveSplitTargetNodeId` reverts
  to `null`.
- `<DecomposeModeExitButton>` is unchanged in behaviour — existing
  decompose-mode tests stay green via the wrapper.

### 4. Escape-key exit (mode-aware)

- `attachCaptureKeymap({ onExitMode: handler })` calls `handler`
  once per `Escape` keypress while
  `useCaptureStore.getState().mode === 'interpretive-split'` (under
  the same modifier-bail / editable-target / repeat-skip guards as
  `onClearTarget`).
- When `mode === 'idle'`, `Escape` does NOT call `onExitMode`.
- When both `onExitMode` and `onClearTarget` are supplied AND
  `mode === 'interpretive-split'`, only `onExitMode` is invoked
  (interpretive-split-exit takes priority — same shape as
  decompose-exit).
- The `<InterpretiveSplitModeExitButton>` mount installs an
  `attachCaptureKeymap({ onExitMode: exitInterpretiveSplitMode })`
  listener while mounted AND
  `mode === 'interpretive-split'`; the cleanup function removes the
  listener on unmount OR on a mode flip away.

### 5. Multi-reading capture grid

- `<InterpretiveSplitReadingsGrid>` renders `null` when
  `useCaptureStore((s) => s.mode) !== 'interpretive-split'`.
- After `enterInterpretiveSplitMode`, the grid renders with
  `data-testid="interpretive-split-readings-grid"` and exactly two
  child `<DecomposeComponentRow mode="interpretive-split">` rows
  with `data-testid="interpretive-split-reading-row-0"` and
  `interpretive-split-reading-row-1`.
- The grid's "Add reading" button has the testid
  `interpretive-split-readings-add-row`; clicking it appends a row;
  it's disabled at 10 rows.
- Per-row remove buttons have the testid
  `interpretive-split-reading-row-remove-${index}`; disabled at the
  minimum 2 rows; enabled at 3+ rows; clicking removes the row.
- The per-row text input has the testid
  `interpretive-split-reading-text-${index}`; typing into it calls
  `setInterpretiveSplitReadingText(index, value)`; the textarea's
  `aria-label` resolves to "Reading 1" for index 0, "Reading 2" for
  index 1; the placeholder resolves to "Reading wording…".
- The per-row classification picker has the testid
  `interpretive-split-reading-classification-${index}`; clicking a
  kind button calls
  `setInterpretiveSplitReadingClassification(index, kind)`.
- The decompose grid (when mounted via the route's other branch) is
  unchanged in behaviour — existing decompose-grid tests stay green.

### 6. Propose-interpretive-split action

- `<ProposeInterpretiveSplitAction>` component renders a
  `<div role="group" data-testid="propose-interpretive-split-action">`
  containing a `<button data-testid="propose-interpretive-split-action-button">`
  with a `<kbd data-testid="propose-interpretive-split-action-key-chip">`
  chord chip.
- The button is reachable via
  `screen.getByRole('button', { name: /Propose interpretive split/ })`
  in en-US.
- `OperateRoute` passes `<ProposeInterpretiveSplitAction />` (not
  `<ProposeAction />` and not `<ProposeDecompositionAction />`) into
  `<BottomStripCapture>`'s `proposeAction` prop when
  `mode === 'interpretive-split'`.
- Validation gate: with two empty rows the button is disabled and
  the validation-error region renders the localized
  `readingsInvalid` reason; with two valid rows + target set +
  connected, the button is enabled and no validation-error region
  renders.
- Successful propose round-trip: clicking the button sends exactly
  one `propose` envelope through the WS client with payload
  `{ sessionId, expectedSequence, proposal: { kind:
  'interpretive-split', parent_node_id: '<target>', readings: [{
  wording, classification }, ...] } }` (the per-row `text → wording`
  rename applied; the envelope's per-row array field name is
  `readings`, NOT `components`). Immediately on click,
  optimistic clear flips `mode === 'idle'`,
  `interpretiveSplitTargetNodeId === null`,
  `interpretiveSplitReadings === []`, `proposing === true`. On the
  `proposed` ack, `proposing === false`, `lastError === undefined`.
- Error path (server `WsRequestError`): the snapshot is restored via
  `enterInterpretiveSplitMode` + per-row replay; the inline
  `propose-interpretive-split-action-wire-error` region renders the
  localized wire-error message with the wire code + message;
  `proposing === false`.
- Error dismissal: typing into a row OR picking a classification OR
  adding / removing a row OR a subsequent successful propose
  dismisses the wire-error region (the
  `interpretiveSplitReadings` array reference changed).
- In-flight state: during the round-trip, the button has the
  `disabled` attribute, the button text is the localized
  `inFlightLabel` ("Proposing interpretive split…"), the per-row
  inputs are NOT disabled.
- Concurrent re-entry: a second `propose()` call while
  `inFlight === true` is a no-op (no second envelope sent — asserted
  via spy).

### 7. Route-level slot composition

- When `mode === 'idle'`: the bottom strip mounts
  `<CaptureTextInput>` (textInput), `<ClassificationPalette>`
  (classification), `<CaptureTargetAndRole>` (edgeRole),
  `<ProposeAction>` (proposeAction); both exit-button wrappers
  render `null`; both grid wrappers render `null`.
- When `mode === 'decompose'`: the textInput slot mounts
  `<DecomposeComponentsGrid mode="decompose">`, the
  classification + edgeRole slots are empty (`null`), the
  proposeAction slot mounts `<ProposeDecompositionAction>`, the
  `<DecomposeModeExitButton>` renders alongside `<ModeBanner>`,
  the `<InterpretiveSplitModeExitButton>` renders `null`.
- When `mode === 'interpretive-split'`: the textInput slot mounts
  `<InterpretiveSplitReadingsGrid>`, the classification + edgeRole
  slots are empty, the proposeAction slot mounts
  `<ProposeInterpretiveSplitAction>`, the
  `<InterpretiveSplitModeExitButton>` renders alongside
  `<ModeBanner>`, the `<DecomposeModeExitButton>` renders `null`.
- `<ModeBanner>` resolves
  `moderator.modeBanner.interpretive-split.label` to "Interpretive
  split" in en-US.

### 8. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains 21 new keys
  under `moderator.interpretiveSplit.*` (5 in `exit + banner`
  combined, 5 in `readings`, 10 in `propose + reason`), one new pair
  under `moderator.modeBanner.interpretive-split.*`, and one new key
  under `moderator.contextMenu.node.proposeInterpretiveSplit`.
  Total = 21 keys per locale.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` gain the same 21 keys with the drafts.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` gain `pending: true` entries for each of the
  21 keys.
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after
  the edits.

### 9. Vitest cases (per ADR 0022)

Minimum **32 new cases** across the touched + new test files (the
exact distribution below is the floor; the implementer may add
cases as the implementation suggests them):

**`apps/moderator/src/stores/captureStore.test.ts`** (≥ 12 new
cases):

1. `interpretiveSplitTargetNodeId` is `null` in the initial state.
2. `interpretiveSplitReadings` is `[]` in the initial state.
3. `'interpretive-split'` is a valid `CaptureMode` value (typecheck
   pin + a runtime case that calls `setMode('interpretive-split')`
   and asserts the slice).
4. `enterInterpretiveSplitMode('n1')` sets `mode`, the target id,
   seeds two empty rows, clears F1 slices.
5. `enterInterpretiveSplitMode` uses a single `set()`.
6. `enterInterpretiveSplitMode` does NOT clear the decompose slices.
7. `exitInterpretiveSplitMode()` reverts mode + clears both slices.
8. `reset()` clears both new slices.
9. `setInterpretiveSplitReadingText(0, 'hello')` writes to row 0.
10. `setInterpretiveSplitReadingText(0, 'x'.repeat(10_001))` clamps.
11. `setInterpretiveSplitReadingClassification(1, 'fact')` writes to
    row 1.
12. `addInterpretiveSplitReading()` at length 10 is a no-op;
    `removeInterpretiveSplitReading(0)` at length 2 is a no-op.

**`apps/moderator/src/graph/GraphCanvasPane.test.tsx`** (≥ 3 new
cases):

13. `buildNodeMenuItems(target)` (no extra args) renders a
    `propose-interpretive-split` item whose `onSelect` calls the
    legacy `actionStub` (regression-pinned).
14. `buildNodeMenuItems(target, undefined, undefined, onEnter)`
    renders a `propose-interpretive-split` item whose `onSelect`
    calls `onEnter(target.id)` exactly once per activation.
15. Right-clicking a rendered node and clicking the "Propose
    interpretive split" menu item transitions
    `useCaptureStore.getState().mode` to `'interpretive-split'` and
    sets `interpretiveSplitTargetNodeId` to the node's id.

**`apps/moderator/src/layout/InterpretiveSplitModeExitButton.test.tsx`**
(≥ 4 new cases):

16. Renders `null` when `mode === 'idle'` and when `mode ===
    'decompose'`.
17. Renders the button + the target-wording overlay when
    `mode === 'interpretive-split'` and the events log carries the
    matching node-created event.
18. Click on the button calls
    `useCaptureStore.getState().exitInterpretiveSplitMode()`.
19. Per-locale parity round-trip — render with each of the three v1
    locales; assert the aria-label, tooltip, and target-wording
    overlay each resolve to a non-key string.

**`apps/moderator/src/layout/captureKeymap.test.ts`** (≥ 2 new
cases):

20. `attachCaptureKeymap({ onExitMode: handler })` calls `handler`
    on `Escape` when `mode === 'interpretive-split'`; does NOT call
    `handler` while the mode is `'idle'`.
21. When `mode === 'interpretive-split'` AND both `onExitMode` and
    `onClearTarget` are supplied, `Escape` calls `onExitMode` once
    AND does NOT call `onClearTarget`.

**Grid family parameterisation tests** (≥ 4 new cases across the
four `Decompose*.test.tsx` files):

22. `<DecomposeComponentsGrid mode="interpretive-split">` renders
    `null` when `mode !== 'interpretive-split'`; renders the
    interpretive-split readings grid with the per-mode testids when
    `mode === 'interpretive-split'`.
23. `<DecomposeComponentRow mode="interpretive-split" index={0}>`
    renders the row with the per-mode label resolved to "Reading
    1".
24. `<DecomposeComponentTextInput mode="interpretive-split" index={0}>`
    reads from / writes to the `interpretiveSplitReadings` slice
    via the per-mode setter; its `data-testid` is
    `interpretive-split-reading-text-0`.
25. `<DecomposeComponentClassificationPicker mode="interpretive-split" index={0}>`
    writes via `setInterpretiveSplitReadingClassification`; the
    per-button `data-testid`s are
    `interpretive-split-reading-classification-0-button-<kind>`.

**`apps/moderator/src/layout/useProposeProposalAction.test.tsx`** (≥ 4
new cases):

26. `useProposeProposalAction({ mode: 'decompose' })` matches the
    behaviour of `useProposeDecompositionAction()` (the wrapper
    preservation pin).
27. `useProposeProposalAction({ mode: 'interpretive-split' })`
    constructs an envelope with `kind: 'interpretive-split'` and a
    `readings` field (NOT `components`); the per-row `text →
    wording` rename is applied.
28. Optimistic-clear path under `mode: 'interpretive-split'` calls
    `exitInterpretiveSplitMode` (not `exitDecomposeMode`).
29. Snapshot-restore on error under `mode: 'interpretive-split'`
    calls `enterInterpretiveSplitMode` and replays per-row via the
    interpretive-split setters.

**`apps/moderator/src/layout/ProposeInterpretiveSplitAction.test.tsx`**
(≥ 3 new cases):

30. Renders the component with all five testids
    (`propose-interpretive-split-action*`).
31. Localized button label resolves to "Propose interpretive split"
    in en-US.
32. Button click invokes the hook's `propose()`.

Optional 33rd: **per-locale parity round-trip** across the
interpretive-split component family in all three v1 locales;
assert no `[t-missing]` token nor raw catalog-key string is
visible.

### 10. Playwright e2e

One new `test()` block lands in `tests/e2e/moderator-capture.spec.ts`
under the existing `test.describe('moderator capture flow', ...)`
group, mirroring the structure of the `mod_propose_decomposition`
block:

```ts
test('alice: enter interpretive-split mode → fill 2 reading rows → propose interpretive split → envelope reaches server → mode flips back to idle', async ({
  page,
}) => {
  await loginAs(page, { username: TEST_USERNAME });
  await page.goto('/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();
  await page
    .getByTestId('create-session-topic-input')
    .fill('Propose-interpretive-split e2e regression check.');
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
  await seedInviteParticipantsForGate(page);
  await page.getByTestId('invite-enter-session').click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();

  if (!(await isWsStoreReachable(page))) {
    test.skip(true, 'wsStore seam not reachable');
    return;
  }

  const sessionId = new URL(page.url()).pathname.split('/')[2] ?? '';
  const SEED_NODE_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaa11';
  await seedWsStore(page, {
    sessionId,
    nodes: [{ nodeId: SEED_NODE_ID, wording: 'Welfare deficits explain capability-frustration.' }],
  });
  await expect(page.getByTestId(`statement-node-${SEED_NODE_ID}`)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId(`statement-node-${SEED_NODE_ID}`).click({ button: 'right' });
  await page.getByTestId('graph-context-menu-item-propose-interpretive-split').click();
  await expect(page.getByTestId('interpretive-split-readings-grid')).toBeVisible();
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'interpretive-split');

  await expect(page.getByTestId('propose-interpretive-split-action-button')).toBeDisabled();

  await page.getByTestId('interpretive-split-reading-text-0').fill('Welfare deficits are our evidence for constitutive capacities.');
  await page.getByTestId('interpretive-split-reading-classification-0-button-fact').click();
  await page.getByTestId('interpretive-split-reading-text-1').fill('Capability-frustration just is welfare loss, ontologically.');
  await page.getByTestId('interpretive-split-reading-classification-1-button-value').click();

  await expect(page.getByTestId('propose-interpretive-split-action-button')).toBeEnabled();
  await page.getByTestId('propose-interpretive-split-action-button').click();

  // Optimistic clear: the grid unmounts; the F1 textarea re-mounts.
  await expect(page.getByTestId('interpretive-split-readings-grid')).toHaveCount(0);
  await expect(page.getByTestId('capture-text-input-textarea')).toBeVisible();

  // The envelope reaches the server: a `proposal` event lands.
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

If the WS client cannot connect to the dev compose stack, the spec
`test.skip`s with the same seed-reachability pattern the
predecessor specs use; the Vitest hook / component cases still
gate the behaviour.

### 11. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_interpretive_split_mode` block
  gets `complete 100` after the `allocate team` line plus a `note
  "Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md"`
  line.
- `tasks/30-moderator-ui.tji`: the parent `mod_decompose_flow` block
  also gets `complete 100` (this task closes the last open leaf —
  derives-completes the parent).
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_interpretive_split_mode_native_review` is added with the
  template below (effort 0.5d;
  `depends !i18n_propose_decomposition_native_review` — the current
  tail of the native-review chain per
  `tasks/35-frontend-i18n.tji:214-220`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

The new native-review task template (the Closer registers this
mechanically):

```
task i18n_interpretive_split_mode_native_review "Native-speaker review of pt-BR + es-419 interpretive-split strings (21 keys under moderator.interpretiveSplit.*, moderator.modeBanner.interpretive-split.*, moderator.contextMenu.node.proposeInterpretiveSplit)" {
  effort 0.5d
  allocate team
  depends !i18n_propose_decomposition_native_review
  note "Source of debt: mod_interpretive_split_mode (this commit) — pt-BR and es-419 drafts of the 21 new keys landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. The exit + banner + readings + propose sub-namespaces under moderator.interpretiveSplit.* mirror the moderator.decompose.* shape and carry the same ICU substitutions ({nodeWording}, {index}, {reason}, {message}, {code}); the modeBanner pair adds the 9th mode's label + description; the contextMenu key adds the node-menu item label. Methodology vocabulary: 'interpretive split' / 'reading' / 'splitting' are the methodology terms (per docs/methodology.md:168-181); the native-speaker review should check the localized choices match the methodology's intent (the move is about surfacing multiple readings of a single statement when the wording admits more than one, not about decomposing the statement into bundled atomic claims)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 12. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### 1. Scope: full end-to-end chain (option b), not just the mode-entry seam

Two alternatives surveyed:

- **(a) Just the mode-entry seam** — mint the
  `'interpretive-split'` `CaptureMode` value, the parallel store
  slices for target + readings init, the
  `enterInterpretiveSplitMode` / `exitInterpretiveSplitMode`
  helpers, the new context-menu item, the per-mode exit button, the
  modeBanner key pair, the context-menu key. Document the
  multi-component reading capture + the propose action as future
  tasks. *Rejected.*

- **(b) Full end-to-end chain** — the mode-entry seam + the
  multi-reading capture (parameterised grid family) + the propose
  action (parameterised hook + button) + the route-level slot
  composition + the 21 new i18n keys + the e2e. *Chosen.*

Three reasons for (b):

1. **The WBS task name says "flow", not "mode entry".** The task
   description in `tasks/30-moderator-ui.tji:349` is
   "Interpretive-split mode (analogous flow)". The parenthetical
   "(analogous flow)" pins the scope to the full chain — the
   parallel of the three decompose leaves rolled up. If only the
   mode-entry seam were wanted, the description would say
   "Interpretive-split mode-entry seam"; "flow" implies the full
   chain.
2. **The WBS has no follow-up sibling tasks for
   interpretive-split.** The parent `mod_decompose_flow` block at
   `tasks/30-moderator-ui.tji:330-353` has exactly four leaves:
   `mod_decompose_mode`, `mod_multi_component_capture`,
   `mod_propose_decomposition`, and `mod_interpretive_split_mode`.
   If interpretive-split had been planned as a three-leaf split
   mirroring decompose's, the WBS would carry those three leaves
   (`mod_interpretive_split_mode`,
   `mod_multi_reading_capture`, `mod_propose_interpretive_split`).
   The single-task scoping in the WBS is itself the directive that
   interpretive-split lands as a single derived-from-decompose
   delivery.
3. **The decompose chain shipped reusable abstractions
   anticipating this task.** Each decompose leaf's refinement
   explicitly anticipates the interpretive-split case as a
   replicate-with-rename:
   - `mod_decompose_mode.md` Decision §1 — the slice + helper +
     menu-parameter pattern is "the template the interpretive-split
     task will replicate".
   - `mod_multi_component_capture.md` Decision §9 — "The
     interpretive-split mode (sibling task in the F2 family) will
     mirror this task's exact shape... a parallel slice... parallel
     coordination helpers... parallel grid component."
   - `mod_propose_decomposition.md` Decision §12 — "the future
     `mod_interpretive_split_mode` task mirrors this task's exact
     shape with a different proposal sub-kind".

The 1d effort estimate is tight for the full chain but achievable
because the abstractions exist as designed extension seams (Decision
§2 documents how each gets parameterised); the work is
parameterise-and-replicate, not re-design.

**The `DecomposeComponent` type, the `createEmptyDecomposeComponents`
factory, and the `validateDecomposeComponents` validator stay
named as-is.** Considered renaming each to a neutral
`ProposalRow` / `createEmptyProposalRows` / `validateProposalRows`
in this task. *Rejected for the type + factory*; *adopted as a
sibling export* for the validator:

- Renaming `DecomposeComponent` would force every existing
  decompose-side consumer to update its imports, ripping through
  ~10 files in this task for a cosmetic improvement. The neutral
  name lands when a third caller forces the rename. Same argument
  as `mod_multi_component_capture.md` Decision §2 (mirror Zod
  bounds at the UI vs. introspect them).
- A sibling `validateProposalRows` (and `createEmptyProposalRows`)
  export ships alongside the existing names — the existing names
  stay as thin wrappers so existing consumers don't churn. The new
  shared shape (`useProposeProposalAction`) imports the neutral
  name; the existing thin wrapper
  (`useProposeDecompositionAction.ts:177`) keeps importing the
  decompose-named alias. This avoids the cosmetic rename ripple
  AND avoids growing a future-third-caller rename debt.

### 2. Code reuse strategy: extract-and-share with per-mode thin wrappers

Three alternatives surveyed for each of the four reusable surfaces
(exit affordance, grid family, propose hook, propose button):

- **(a) Duplicate-and-rename** — copy each Decompose* component
  to an InterpretiveSplit* sibling, change the names + bindings.
  Two parallel families with no shared abstraction. *Rejected.*
  Drift is inevitable: a fix to the decompose grid's `onChange`
  guard would not automatically apply to the interpretive-split
  grid; reviewers would have to manually cross-check both files.
  The two flows have identical structure; duplicating them creates
  maintenance burden without buying isolation.
- **(b) Parameterise the existing components by `mode: 'decompose'
  | 'interpretive-split'` and rename them to mode-neutral names
  (e.g. `<ProposalRowsGrid mode>`, `<ProposeProposalAction
  mode>`)** — single shared component family; consumers pass `mode`
  as a prop. *Rejected* in this task scope as the migration end
  state; *adopted as the parameterisation core* but with the
  rename deferred. The two-step migration (rename the existing
  component, change the prop) ripples through every existing
  decompose call site and every existing test file in a way that
  exceeds this task's 1d budget. Combine instead:
- **(c) Extract a shared parameterised component + preserve the
  per-mode wrappers** — the new shared component family
  (`<ProposalModeExitAffordance>`, the parameterised grid family,
  `useProposeProposalAction`, `<ProposalAction>`) takes a `mode`
  prop and holds the body; the existing `<Decompose*>` /
  `useProposeDecomposition*` / `<ProposeDecompositionAction>`
  names become thin wrappers calling the shared shape with
  `mode="decompose"`; the parallel
  `<InterpretiveSplit*>` / `useProposeInterpretiveSplit*` /
  `<ProposeInterpretiveSplitAction>` wrappers call with
  `mode="interpretive-split"`. *Chosen.* Three properties:
  1. **No churn for existing call sites** — the route's existing
     `<DecomposeComponentsGrid />` mount becomes
     `<DecomposeComponentsGrid mode="decompose" />` (one prop
     added); the wrapper preserves its name. Existing tests stay
     green via the wrapper.
  2. **Two paths to the shared body** — the new
     `<InterpretiveSplit*>` wrappers call the same shared
     parameterised body; a future fix to the body applies to both
     modes automatically.
  3. **Future rename is a separate task** — when a future third
     caller arrives, the migration to neutral names lands as its
     own refactor; the wrappers are removable in one pass without
     touching the body.

Three additional notes on the extraction shape:

- The shared component file names use neutral prefixes
  (`ProposalModeExitAffordance`, `ProposalAction`,
  `useProposeProposalAction`). The grid family files keep their
  `Decompose*` names — extracting their bodies into
  `ProposalRowsGrid` etc. would require either renaming the files
  (rippling test imports) or adding a layer of indirection. The
  in-file parameterisation by a `mode` prop is sufficient; the
  filename rename lands with the future third-caller refactor.
- The decompose flow's testids (`decompose-components-grid` etc.)
  are preserved for backward-compat; the per-mode `data-testid`
  resolution happens inside the shared body based on `props.mode`.
- The Tailwind class constants (`SELECTED_CLASSES` etc. inside
  `<DecomposeComponentClassificationPicker>`) stay
  module-local — Decision §4 of
  `mod_multi_component_capture.md` records the YAGNI-extract
  argument for them; the parameterisation by `mode` doesn't
  change the argument.

### 3. Entry-point: peer node-menu item alongside `propose-decompose` (option a)

Three alternatives surveyed:

- **(a) Add a `propose-interpretive-split` item to the node context
  menu, peer to the existing `propose-decompose` item.** *Chosen.*
  Direct precedent — `mod_decompose_mode.md` Decision §2 wired the
  `propose-decompose` item with the same pattern; this task adds
  the peer. The methodology positions interpretive-split as a
  separate move from decompose (per `docs/methodology.md:182-184`:
  "Decomposition — the speaker intended multiple claims and
  bundled them... Interpretive split — the speaker may have
  intended one claim, but the wording admits multiple readings");
  the operator's decision between the two is a semantic call about
  the parent statement's intent. Two peer menu items keep that
  choice explicit at the point of action.
- **(b) Sub-mode within decompose** — once in decompose mode, the
  moderator picks "decompose" vs "interpretive split" via a picker
  inside the capture pane. *Rejected.* This conflates the two
  moves into a single mode-entry gesture; the methodology
  distinguishes them deliberately (different semantics, different
  proposal kinds, different downstream wire envelope). The picker
  would also add an extra click and a mid-flow disambiguation step
  every operator would have to perform. The methodology vocabulary
  (`docs/methodology.md:182-184`) supports two distinct moves;
  the UI should mirror that.
- **(c) Defer the entry-point UI to a future task** — just expose
  the helper API for keyboard / programmatic entry. *Rejected.*
  Same reason scope (b) was chosen in Decision §1: this task is
  "the flow", not "a helper API". A flow with no user-reachable
  entry-point is not delivered.

The new menu item lands immediately after the existing
`propose-decompose` item (lines 240-246 of `GraphCanvasPane.tsx`)
so the two structural-restructure proposals (decompose,
interpretive-split) cluster visually. The remaining items
(`propose-meta-disagreement`, `annotate`, `axiom-mark`) stay in
their existing order.

### 4. Slice naming: `interpretiveSplitReadings` (mirrors the wire schema's field name)

The wire schema names the per-component-array field `readings` for
interpretive-split and `components` for decompose
(`packages/shared-types/src/events/proposals.ts:171,185`). The
store slice name follows the wire schema:
`interpretiveSplitReadings` (mirror `readings`) for the new slice,
`decomposeComponents` (mirror `components`) for the existing slice.

Considered alternatives:

- **Both slices use the same neutral name `rows`** — *rejected*.
  Conflicts with the mode-discriminated state shape; a single
  `rows` slice could hold either decompose components or
  interpretive-split readings but not both, which defeats the
  invariant that the two modes' state doesn't overlap. (The
  invariant is what lets a moderator enter decompose mode, capture
  rows, switch to interpretive-split mode, switch back, and find
  the decompose rows preserved — though Decision §5 records that
  this preservation is a side-effect of the
  no-cross-clearing policy rather than an explicit design goal.)
- **Both slices use the per-flow domain name (`components`,
  `readings`)** — *considered but inconsistent with the existing
  slice naming convention*. The existing
  `decomposeComponents` slice carries its mode-prefix; the new
  slice keeps it for symmetry.

The i18n sub-namespace for the readings UI is
`moderator.interpretiveSplit.readings.*` (not
`moderator.interpretiveSplit.components.*`) — the localized
labels speak "Reading 1" / "Add reading" / "Reading wording…" per
the methodology's vocabulary, not "Component 1" / "Add
component". `docs/methodology.md:173-177` consistently uses
"reading" as the noun for the interpretive-split outputs ("welfare
deficits are our evidence... welfare loss, ontologically").

### 5. No cross-clearing between decompose and interpretive-split slices

`enterInterpretiveSplitMode(nodeId)` clears the F1 slices (same
coupling as `enterDecomposeMode`'s F1-clear in
`mod_decompose_mode.md` Decision §6) but **does NOT clear the
decompose slices** (`decomposeTargetNodeId`, `decomposeComponents`).
Symmetrically, `enterDecomposeMode(nodeId)` is **unchanged** by
this task and does not clear the interpretive-split slices.

Two reasons:

1. **The two modes are mutually exclusive via the `mode` field, not
   via slice clearing.** Only one of `mode === 'decompose'`
   and `mode === 'interpretive-split'` is true at a time. The UI
   visibility gates on `mode` already exclude any cross-mode
   leakage of rendered state; the unused mode's slice is held in
   reserve but never read while not in that mode.
2. **Preserving cross-mode state on accidental mode-switches is
   forgiving.** If a moderator is mid-capture in decompose mode,
   accidentally right-clicks a different node and picks "Propose
   interpretive split", then realises the mistake and switches
   back via `enterDecomposeMode`, the existing decompose work IS
   lost (the new `enterDecomposeMode` clears `decomposeComponents`
   to two empty rows again per its existing behaviour). This is a
   transient corner case the moderator can avoid by exiting the
   wrong mode first (Escape) before re-entering. **The risk
   surfaced by NOT cross-clearing is that the prior decompose
   rows lurk in the slice while interpretive-split is active and
   would re-appear on the next decompose-mode entry IF the
   `enterDecomposeMode` did NOT seed two empty rows** — which it
   does. Since both `enterX` helpers seed two empty rows on
   entry, any prior state in the OTHER mode's slice gets
   over-written on its next entry. The slice values during the
   non-active period are functionally dead.

The alternative (`enterInterpretiveSplitMode` ALSO clears
`decomposeComponents` + `decomposeTargetNodeId`) was considered.
*Rejected* — it would symmetrically require
`enterDecomposeMode` to clear `interpretiveSplit*` slices, which
would expand the predecessor's invariant retroactively. The
existing decompose helpers are unchanged by this task per the
Files-not-touched list; expanding their behaviour would be
scope-creep beyond this task's parameterisation work.

### 6. Per-mode module-scoped error stores (mirrors `mod_propose_decomposition` Decision §11)

The parameterised hook keeps two module-scoped Zustand stores:
`useProposeDecompositionErrorStore` (preserved as-is from the
predecessor) and a new
`useProposeInterpretiveSplitErrorStore`. The shared
`useProposeProposalAction` reads from the right one per `args.mode`.

Considered alternatives:

- **Single shared `useProposeProposalErrorStore`** keyed by `mode`
  — *rejected*. A single store carrying both errors would mean
  switching modes mid-error would leak the prior mode's error into
  the new mode's inline region. Per `mod_propose_decomposition`
  Decision §11, the two inline-error regions target different
  surfaces; cross-flow bleed is a regression.
- **Two completely independent shared stores** (per-mode, no
  unification at the hook layer) — *chosen*. The parameterised
  hook reads from `args.mode === 'decompose' ?
  useProposeDecompositionErrorStore : useProposeInterpretiveSplitErrorStore`.
  Each store has the same shape (`{ lastError, setLastError }`); a
  parallel `resetProposeInterpretiveSplitError` test seam ships
  alongside `resetProposeDecompositionError`.

The two stores' contents are independent — a stale decompose
error stays put while the moderator works in interpretive-split
mode and vice-versa. When the moderator returns to the other mode,
the prior error re-surfaces in its inline region; the next
gesture there dismisses it (the same user-modification dismissal
flows the predecessor shipped).

### 7. Playwright e2e: full chain against the real compose stack

Mirrors `mod_propose_decomposition.md` Decision §9 — option (b):
drive the real dev compose stack rather than mocking the WS
boundary. The compose stack is already up for the predecessor
specs; extending it with the interpretive-split round-trip is the
natural next step. The Playwright spec asserts the full chain:
enter interpretive-split mode → fill 2 reading rows → click propose
→ propose envelope hits the server → `event-applied` broadcast
lands in `useWsStore.sessionState[id].events` (read via the
dev-only `window.__aConversaWsStore` seam) → mode flips back to
`'idle'` (the grid unmounts, the F1 capture text input re-mounts).

The commit-side path is still blocked (per the same open question
in `interpretive_split_logic.md`'s Open Questions section); the
spec asserts only the propose-side surface (the envelope reaches
the server and a `proposal` event lands in the session's event
log; the parent's visibility does NOT flip — that's a commit-time
effect that's still gated).

### 8. No new `CaptureKeymapHandlers` handler; reuse `onExitMode`

The mode-aware Escape priority in `captureKeymap.ts:226-240`
already gates on `mode === 'decompose'` for the existing
`onExitMode`. This task generalises the check:
`mode === 'decompose' || mode === 'interpretive-split'`.

Considered alternatives:

- **New per-mode handlers** (`onExitDecomposeMode`,
  `onExitInterpretiveSplitMode`) — *rejected*. The handler is
  invoked by a single Escape keystroke; the dispatching component
  (the exit-button wrapper) owns the per-mode closure. The keymap
  module stays a pure key-dispatch layer; the per-mode logic
  lives in the components that own each mode's exit semantics.
- **Single `onExitMode` handler with the mode-list extended** —
  *chosen*. Two reasons: (a) the handler shape is mode-neutral
  (just "exit the current mode"); each component supplies its own
  exit semantics via the closure. (b) Future modes that own their
  own Escape semantics (`'capture-defeater'`,
  `'operationalization'`, etc.) extend the mode-list further with
  no new handler — the keymap stays a single-handler design.

### 9. No new ADR

Three potential ADR triggers, all dispatched:

- **"Parameterising shared components by a mode discriminant is
  ADR-worthy."** No — React component parameterisation by a prop
  is the conventional pattern; no architectural lever is pulled.
  The decision is task-scope: the existing decompose components
  get a new `mode` prop; the new interpretive-split flow uses
  them via per-mode wrappers. The same pattern is reused
  routinely across React codebases.
- **"Adding a new `CaptureMode` enum value is ADR-worthy."** No —
  the `CaptureMode` union is settled by `mod_mode_banner` as an
  open list (8 values today, growing per future flows); adding the
  9th value is conventional extension.
- **"Adding a 9th moderator mode is ADR-worthy."** No — the
  moderator-ui design doc (`docs/moderator-ui.md:14`) names
  "decompositions and interpretive splits" as paired capabilities
  from the start. The mode value's addition is execution of the
  pre-settled design, not a new architectural choice.

`mod_decompose_mode`, `mod_multi_component_capture`,
`mod_propose_decomposition`, `mod_state_management`,
`mod_mode_banner`, `mod_context_menus`, `interpretive_split_logic`,
ADRs 0021 / 0022 / 0024 already pinned every architectural choice
this task implements; this refinement is the task-scope pin for the
parameterise-and-replicate work.

## Open questions

(none — all decided)

## Status

_pending implementation_
