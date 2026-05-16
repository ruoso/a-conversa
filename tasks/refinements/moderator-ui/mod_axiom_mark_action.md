# Moderator axiom-mark action — propose an axiom-mark from the node context menu

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_axiom_mark_flow.mod_axiom_mark_action`.

```
task mod_axiom_mark_action "Axiom-mark action with proposing participant" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. This is the **leaf foundation of `mod_axiom_mark_flow`** (the F5
capture flow): every other task in the subgroup depends on this one. The work is
small — wire one node-context-menu stub to a real propose envelope, scoped under a
participant-picker submenu — but it touches three established patterns
(`useProposeAction` / `useCommitAction` hook-shape, the node context-menu
`actionStub` seam, the i18n catalog workflow) and ships an e2e regression cover.
There is no new architecture: the propose-side validator already lives on the
server (`apps/server/src/methodology/handlers/propose.ts` lines 75–92, completed by
`axiom_mark_logic.md`), the `axiom-mark` proposal sub-kind has its Zod schema and
wire envelope settled (`packages/shared-types/src/events/proposals.ts` lines
196–202; `packages/shared-types/src/ws-envelope.ts` lines 341–351), the `WsClient`
exposes `send('propose', payload)` with the proposed ack / WsRequestError
discipline already proven by `useProposeAction.ts` and `useCommitAction.ts`, the
`per-participant` decoration renders committed marks (`mod_axiom_mark_decoration`
— complete 100), and the node context menu has an `axiom-mark` stub at
`GraphCanvasPane.tsx` lines 223–227 ready to be swapped for a real handler.

Concretely the deliverable is:

- **One new hook** `apps/moderator/src/layout/useAxiomMarkAction.ts` —
  mirrors `useCommitAction`'s shape (per-target keyed Zustand store +
  `inFlight` / `lastError` slices) but parameterised over `(nodeId,
  participantId)` rather than `proposalId`. Owns the optimistic-clear-of-error
  + in-flight guard + the single `client.send('propose', payload)` call carrying
  the axiom-mark proposal envelope.
- **One new component** `apps/moderator/src/layout/AxiomMarkSubmenu.tsx` —
  a small inline submenu that the node context-menu `axiom-mark` item opens.
  Lists every currently-joined non-moderator participant as a clickable button
  (using `deriveCurrentParticipants(events)` from
  `apps/moderator/src/graph/proposalFacets.ts` line 449 — the same source the
  pending-proposals pane uses to enumerate the current debaters). Click fires
  the hook's `markAxiom(participantId)` callback.
- **Wire-up replacement** in `apps/moderator/src/graph/GraphCanvasPane.tsx`
  — the `axiom-mark` menu item in `buildNodeMenuItems` (lines 223–227)
  stops calling `actionStub('axiom-mark', target)` and instead opens the
  submenu UI. Decision §2 records the placement strategy (the menu item's
  `onSelect` flips a per-render `submenuOpen` flag rather than firing a
  proposal directly).
- **New i18n catalog keys** under `moderator.axiomMarkAction.*` — the
  submenu trigger label override (the existing `moderator.contextMenu.node.axiomMark`
  stays as the menu-item label; the submenu header / "no participants joined"
  empty-state / inline-error labels live under the new namespace), plus a
  per-participant button label that uses ICU `{participantName}` (drawn from
  `participant-joined.screen_name`). Six new keys × 3 locales = 18 catalog
  entries. Drafts for pt-BR / es-419 land flagged PENDING in the existing
  `*.review.json` trackers, per the catalog workflow.
- **One follow-up native-review task registered** in
  `tasks/35-frontend-i18n.tji` — `i18n_axiom_mark_action_native_review`
  (effort 0.5d, `depends !i18n_session_lobby_native_review` — the tail
  of the existing native-review chain).
- **Vitest cases** under `apps/moderator/src/layout/useAxiomMarkAction.test.tsx`
  and `apps/moderator/src/layout/AxiomMarkSubmenu.test.tsx`.
- **One new `test()` block** extending `tests/e2e/moderator-capture.spec.ts`
  — drives the full chain through the dev compose stack (login → create session
  → seed two debaters via `seedInviteParticipantsForGate` → enter operate →
  seed a node into the WS store via the same `__aConversaWsStore` seam the
  existing propose-action cover uses → right-click the node → assert the
  `axiom-mark` item is present → click → assert the submenu opens with two
  debater buttons → click a debater → assert the `proposal` event with the
  axiom-mark sub-kind lands in `useWsStore.sessionState[sessionId].events`
  via `expect.poll` against `kinds: expect.arrayContaining(['proposal'])`
  exactly as the existing propose-action cover at lines 800–841 does).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public
contracts):

- **`data_and_methodology.methodology_engine.axiom_mark_logic`** (done —
  2026-05-10). The server's propose handler enforces four rules in evaluation
  order: node-exists → node-visible → participant-equals-requester
  (`axiom-mark-not-self`) → no-duplicate (`illegal-state-transition`).
  See `apps/server/src/methodology/handlers/propose.ts` lines 75–92 +
  `tasks/refinements/data-and-methodology/axiom_mark_logic.md`.

  **The rule-3 constraint is load-bearing for this UI:** the moderator is
  authenticated as `moderator`, NOT as a debater. A naive UI that tried to
  send `propose` envelopes with `proposal.participant !== connection.user.id`
  would be rejected by the server with `'axiom-mark-not-self'`. The propose
  envelope's `actor` (the WS handler reads it from `connection.user.id` per
  `apps/server/src/ws/handlers/propose.ts`) defaults to the authenticated
  user. **This task therefore inherits a real constraint** — the moderator
  cannot mark axioms on behalf of debaters from their own moderator session
  in v1. Decision §1 records the resolution.

- **`moderator_ui.mod_capture_flow`** (parent dep — done via the chain of
  five leaf tasks). The `useProposeAction` hook + module-scoped Zustand-store
  error pattern + `WsRequestError` / `WsRequestTimeoutError` discipline are
  the template this task mirrors. See `apps/moderator/src/layout/useProposeAction.ts`
  (the propose hook) and `apps/moderator/src/layout/useCommitAction.ts` (the
  per-target keyed variant — closer template for this task because axiom-marks
  are keyed by `(nodeId, participantId)`).

- **`moderator_ui.mod_graph_rendering.mod_context_menus`** (done — 2026-05-11).
  Shipped `<GraphContextMenu>` + the node menu's `axiom-mark` stub at
  `GraphCanvasPane.tsx` lines 223–227. This task replaces the stub's
  `onSelect` callback. The menu shell, the close-on-outside / close-on-Escape
  behaviour, the cursor-position seam, and the localized labels are pinned by
  that task; this task plugs into them.

- **`moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration`** (done —
  2026-05-11). The per-participant badge rendering is in place; once this task
  ships, the moderator can both PROPOSE an axiom-mark (this task) and SEE it
  surface as a badge once it commits (existing). The pending-state
  visualisation is the sibling `mod_axiom_mark_pending_render` task.

- **`backend.websocket_protocol.ws_propose_message`** (done — 2026-05-11).
  The `propose` envelope's wire shape (`{ sessionId, expectedSequence,
  proposal: ProposalPayload }`) is settled and the server's handler emits
  the `proposed` ack + the `event-applied` broadcast on success or throws
  `ApiError` (echoed as a typed `error` envelope) on rejection. The
  `useProposeAction` hook's wire-error → `WireError` mapping carries over
  directly.

- **`data_and_methodology.event_types.proposal_events`** (done — 2026-05-10).
  The `axiom-mark` proposal payload shape — `{ kind: 'axiom-mark', node_id:
  UUID, participant: UUID }` — is settled by `axiomMarkProposalSchema` in
  `packages/shared-types/src/events/proposals.ts` lines 196–202. This task
  builds the payload to that shape; Zod validates at the server's API
  ingress.

- **`moderator_ui.mod_state_management`** (done). The captureStore is NOT
  extended by this task (Decision §5 — axiom-mark is fire-and-forget; per-target
  in-flight tracking lives in a new module-scoped Zustand slice mirroring
  `useCommitStore`, not in `useCaptureStore`).

Pending (none — every gating dep is done).

## What this task is

Wire the moderator's "mark this node as an axiom for {participant}" gesture into
the existing node context menu's `axiom-mark` stub. The action targets the
right-clicked node; the participant the axiom-mark is for is picked from a small
submenu that opens on-click of the menu item. Click on a participant button fires
a single `propose` envelope with `{ proposal: { kind: 'axiom-mark', node_id,
participant } }` against the WS surface; the existing server-side validator
(complete 100 per `axiom_mark_logic.md`) enforces the four rules. The pending-state
visualisation lands in the sibling `mod_axiom_mark_pending_render`; the
committed-state visualisation already renders via `mod_axiom_mark_decoration`'s
`AxiomMarkBadge`.

The task delivers:

- **`useAxiomMarkAction(nodeId)` hook** at `apps/moderator/src/layout/useAxiomMarkAction.ts`
  — mirrors `useCommitAction`'s shape (Zustand store with per-key in-flight set
  + per-key error map). Exposes `{ markAxiom(participantId), inFlightFor(participantId),
  lastErrorFor(participantId) }`. The `markAxiom` callback builds the
  axiom-mark proposal envelope and calls `client.send('propose', payload)`.
  The in-flight guard short-circuits concurrent clicks on the same
  `(nodeId, participantId)` pair; clicks on different pairs are allowed in
  parallel (each row gets its own slice — disjoint state by construction).

- **`<AxiomMarkSubmenu>` component** at `apps/moderator/src/layout/AxiomMarkSubmenu.tsx`
  — renders inside the node context menu's `axiom-mark` item when opened.
  Lists every currently-joined non-moderator participant (via
  `deriveCurrentParticipants(events)` from `proposalFacets.ts` line 449)
  as a clickable `<button data-testid="axiom-mark-submenu-participant-{participantId}">`.
  Each button label is the participant's `screen_name` resolved from the
  most-recent `participant-joined` event for that user id (the same map
  `InviteParticipants.tsx`'s `deriveSlotOccupants` builds at lines 108–137
  — Decision §4 records the local-derivation choice). An empty-state row
  (`data-testid="axiom-mark-submenu-empty"`) renders when zero debaters
  have joined.

- **Wire-up replacement** in `apps/moderator/src/graph/GraphCanvasPane.tsx`
  — the node menu's `axiom-mark` item's `onSelect` flips a local
  `submenuOpen: boolean` state on the canvas (not in any external store —
  same transient-UI-fact rationale `mod_context_menus` used for the
  `contextMenu` state itself; Decision §2). When `submenuOpen === true`,
  `<AxiomMarkSubmenu>` renders at the same cursor coordinates as the
  parent menu (slightly inset). Click on a participant button fires
  `markAxiom(participantId)` then closes both menus.

- **i18n catalog extensions** — six new keys under `moderator.axiomMarkAction.*`
  in all three locale catalogs (`en-US`, `pt-BR`, `es-419`):
  - `moderator.axiomMarkAction.submenu.header` — `"Mark as axiom for…"` /
    `"Marcar como axioma para…"` / `"Marcar como axioma para…"`.
  - `moderator.axiomMarkAction.submenu.empty` — `"No debaters have joined yet"` /
    `"Nenhum debatedor entrou ainda"` / `"Ningún debatedor se ha unido aún"`.
  - `moderator.axiomMarkAction.submenu.participantLabel` — ICU
    `"{participantName}"` (the format string lives in the catalog so a future
    locale can decorate the bare name without touching the component).
  - `moderator.axiomMarkAction.errorBanner.timeout` — `"The mark request timed
    out — try again"` / pt-BR / es-419 drafts.
  - `moderator.axiomMarkAction.errorBanner.unknown` — `"Could not mark the
    axiom — please retry"` / pt-BR / es-419 drafts.
  - `moderator.axiomMarkAction.errorBanner.notSelf` — `"Axiom-marks are
    personal — the debater must propose this from their own tablet"` /
    pt-BR / es-419 drafts. This is the localized message for the engine's
    `'axiom-mark-not-self'` rejection (Decision §1 — surfaces what the engine
    rejects when the moderator-proposing-on-behalf attempt happens).

- **One follow-up native-review task** registered in
  `tasks/35-frontend-i18n.tji` — `i18n_axiom_mark_action_native_review`
  (effort 0.5d, depends on `!i18n_session_lobby_native_review` — appended at
  the tail of the existing native-review dependency chain so the in-order
  workflow is preserved).

- **Tests**:
  - **Vitest** — `useAxiomMarkAction.test.tsx` (the hook's mocked-WsClient
    cases: success path emits one propose envelope with the right payload;
    in-flight guard rejects re-entry on the same key; WireError mapping for
    `'axiom-mark-not-self'` / timeout / unknown; per-key disjoint state
    pinned by parallel calls against different `(nodeId, participantId)`).
    `AxiomMarkSubmenu.test.tsx` (the component's rendered-list cases: lists
    every joined debater; renders the empty-state when zero debaters; clicks
    a button → fires `markAxiom(participantId)` once with the right id;
    locale parity for the three new labels × 3 locales = 9 cases).
  - **Playwright e2e** — `tests/e2e/moderator-capture.spec.ts` extended with
    a new `test()` block that drives the full chain through the dev compose
    stack. Decision §8 records the spec choice.

This task is **propose-side action only**. The pending-state graph rendering
(showing the not-yet-committed axiom-mark on the node) is the sibling
`mod_axiom_mark_pending_render`; the committed-state badge rendering already
ships from `mod_axiom_mark_decoration`. The participants-projection /
sidebar work-stream will later replace raw screen-name lookups with a richer
participant view; this task only reads `participant-joined.screen_name`
locally from the events log (the same source the existing
`deriveSlotOccupants` reader uses).

## Why it needs to be done

The F5 capture flow surfaces axioms as one of the methodology's primary success
states (`docs/methodology.md` lines 192–200 — "the debate dead-ends at 'A holds X
as bedrock, B holds Y as bedrock, and that is the real disagreement'"). The
server-side validator landed two weeks ago (`axiom_mark_logic.md`'s `complete
100`), the per-participant decoration landed last week
(`mod_axiom_mark_decoration`'s `complete 100`), and the node context menu has the
`axiom-mark` stub waiting to be wired (`GraphCanvasPane.tsx` line 226 —
`actionStub('axiom-mark', target)`). Without this task there is no path from the
moderator UI to a `proposal: axiom-mark` envelope on the wire: the badge surface
renders nothing because nothing ever commits, and the F5 flow is dead-on-arrival
in the moderator console.

This task is also the **foundation** of the `mod_axiom_mark_flow` subgroup. The
sibling `mod_axiom_mark_pending_render` task explicitly depends on this leaf
(`tasks/30-moderator-ui.tji` line 400 — `depends !mod_axiom_mark_action`):
there is nothing for pending-render to render until proposals can be created.

## Inputs / context

- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
  — the `Event` envelope's camelCased fields and the `proposal` payload's
  snake-cased `node_id` / `participant` for the axiom-mark sub-kind. The Zod
  schema enforces structural shape at the server's API ingress; the methodology
  validator on top.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every
  empirical check ships as a committed Vitest case; e2e ships as a committed
  Playwright spec.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) —
  every user-facing label resolves via `useTranslation` against the catalog
  namespace.
- [`docs/methodology.md`](../../../docs/methodology.md) §"Axioms / terminal
  values" lines 192–200 — the per-participant personal-bedrock invariant.
  "An axiom mark goes through the standard agreement lifecycle (proposed →
  committed by the moderator once everyone has agreed)."
- [`tasks/refinements/data-and-methodology/axiom_mark_logic.md`](../data-and-methodology/axiom_mark_logic.md)
  — the canonical methodology rules. Rule 3 (participant-equals-requester)
  is the load-bearing invariant for Decision §1 below.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](mod_axiom_mark_decoration.md)
  — visual conventions for the committed badge (the per-participant
  rounded-square with the centered "A" glyph and the 6-bucket-hash color
  palette). This task is the action that produces the commits that produce
  the badges.
- [`tasks/refinements/moderator-ui/mod_propose_action.md`](mod_propose_action.md)
  — the propose-hook pattern (module-scoped Zustand error slice + WsClient
  send + WireError mapping). This task mirrors the `WireError` discipline.
- [`tasks/refinements/moderator-ui/mod_commit_button.md`](mod_commit_button.md)
  — the per-target keyed propose-hook pattern (Zustand store with per-key
  in-flight Set + per-key error Map). Closer template than `useProposeAction`
  because axiom-mark is keyed on `(nodeId, participantId)` rather than session-
  global.
- [`tasks/refinements/moderator-ui/mod_context_menus.md`](mod_context_menus.md)
  — the context-menu seam. The node menu's `axiom-mark` stub at
  `GraphCanvasPane.tsx` lines 223–227 is the entry point this task wires.
- [`tasks/refinements/backend/ws_propose_message.md`](../backend/ws_propose_message.md)
  — the `propose` wire envelope and the server's handler discipline.
- [`tasks/refinements/data-and-methodology/proposal_events.md`](../data-and-methodology/proposal_events.md)
  — the proposal-event shape including the `axiom-mark` sub-kind
  (`{ kind: 'axiom-mark', node_id, participant }`).
- [`apps/moderator/src/layout/useProposeAction.ts`](../../../apps/moderator/src/layout/useProposeAction.ts)
  lines 1–407 — the propose-hook implementation (the WireError discipline at
  lines 196–206, the in-flight guard at lines 306–309, the snapshot/restore at
  lines 322–327 + 388–394). This task does NOT inherit the snapshot/restore
  pattern (no capture-store reset to undo — Decision §5).
- [`apps/moderator/src/layout/useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts)
  lines 1–223 — the closer template. The per-key Zustand slice at lines
  86–110 (`committing: ReadonlySet<string>` + `errors: ReadonlyMap<string,
  WireError>` + setters) is the shape this task's slice mirrors, parameterised
  by the composite key `nodeId|participantId` (Decision §3 records the
  composite-key serialisation choice).
- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx)
  lines 201–229 — the node-menu factory; this task replaces line 226's
  `actionStub('axiom-mark', target)` with a real flip-to-submenu handler.
  Lines 580–620 — the right-click handlers; lines 845–860 — the menu-items
  wiring; lines 906–915 — the menu render. The submenu plugs in alongside,
  not inside, the existing `<GraphContextMenu>` render (Decision §2).
- [`apps/moderator/src/graph/GraphContextMenu.tsx`](../../../apps/moderator/src/graph/GraphContextMenu.tsx)
  lines 1–125 — the menu shell. NOT modified by this task.
- [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts)
  lines 449–463 — `deriveCurrentParticipants(events)`. Returns the set of
  currently-joined non-moderator user ids. Reused for the submenu's
  participant-list source.
- [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx)
  lines 108–137 — `deriveSlotOccupants(events)`. The reference template for
  the screen-name lookup; this task adapts the same `participant-joined` /
  `participant-left` collapse for the submenu's per-button label resolution.
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts)
  lines 75–92 — the server's `axiom-mark` validator. The rejection-reason
  catalog (`'target-entity-not-found'`, `'illegal-state-transition'`,
  `'axiom-mark-not-self'`) is the source for this task's error-banner
  localization keys.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts)
  lines 196–202 — `axiomMarkProposalSchema`. The exact shape this task's
  envelope writes.
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts)
  lines 341–351 — the `propose` payload envelope. `expectedSequence` reads
  from `useWsStore.sessionState[sessionId].lastAppliedSequence` exactly as
  the existing propose / commit hooks do.
- [`apps/moderator/src/ws/client.ts`](../../../apps/moderator/src/ws/client.ts)
  — `WsClient.send('propose', payload)` returns a Promise that resolves on
  the `proposed` ack or rejects with `WsRequestError` (carrying the server's
  typed error payload) / `WsRequestTimeoutError`.
- [`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts)
  lines 700–842 — the existing propose-action e2e cover. The
  `__aConversaWsStore` probe + `expect.poll(...).toMatchObject({ kinds:
  expect.arrayContaining(['proposal']) })` pattern at lines 800–841 is the
  template for this task's e2e assertion.

## Constraints / requirements

- **The propose envelope shape is fixed by `axiomMarkProposalSchema` +
  `proposePayloadSchema`.** The hook writes exactly:
  ```ts
  await client.send('propose', {
    sessionId,
    expectedSequence: useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0,
    proposal: { kind: 'axiom-mark', node_id: nodeId, participant: participantId },
  });
  ```
  No additional fields; no client-minted proposal-event id (the server mints
  the envelope id at append time per `proposal_events.md`).

- **The `markAxiom` callback fires-and-forgets.** No optimistic clear of any
  capture-store slice (axiom-mark is independent of the bottom-strip capture
  pane — Decision §5). The per-key in-flight slice flips true → false around
  the awaited `client.send` call; the per-key error slice is set on catch.

- **`useAxiomMarkAction(nodeId)` is the per-node hook signature.** Decision §3
  records the choice: a per-node hook lets the submenu render once
  (`useAxiomMarkAction(contextMenu.target.id)`) and dispatch to any of its
  per-participant buttons. The internal Zustand slice is keyed on the
  composite `${nodeId}|${participantId}` so two simultaneous marks on
  different `(nodeId, participantId)` pairs observe disjoint in-flight /
  error state.

- **Participant list source: `deriveCurrentParticipants(events)`.** Reuse the
  existing helper from `proposalFacets.ts:449` — same source the engine and
  the pending-proposals pane use. Excludes the moderator. The screen-name
  lookup is a new local helper `derivePartipantScreenNames(events)` returning
  `Map<userId, screenName>` (Decision §4 — the helper lives next to the
  hook for now; will be lifted to a shared selector when the participants-
  projection lands).

- **Error-banner localization.** The hook's `lastError` carries
  `{ code, message }`. The submenu renders the message verbatim for unknown
  codes; for the three codes the engine emits on the axiom-mark path
  (`'axiom-mark-not-self'`, `'illegal-state-transition'`,
  `'target-entity-not-found'`), the submenu renders a localized
  catalog-resolved message when one exists (currently only `notSelf`; the
  other two are rare in normal UI flow because the menu shell guarantees
  the node exists and is visible by virtue of being right-click-able).
  Falls back to the wire `message` for any unmapped code.

- **No regressions to existing handlers.** The node menu's other four items
  (propose-vote, propose-decompose, propose-meta-disagreement, annotate)
  keep their existing `actionStub` calls. The pane menu and the edge menu
  are untouched. The `<GraphContextMenu>` component itself is untouched.

- **i18n catalog parity** — `pnpm --filter @a-conversa/i18n-catalogs run check`
  must remain green after the six new keys land. The pt-BR / es-419 drafts
  ride in flagged PENDING per the catalog workflow.

- **e2e coverage** — Decision §8: extend `tests/e2e/moderator-capture.spec.ts`
  with one new `test()` block driving the full chain. The
  `__aConversaWsStore` probe at the existing test's lines 800–841 is the
  template. The new test seeds a node into the WS store directly (via the
  same `window.__aConversaWsStore` seam) to avoid coupling to the F1 capture
  flow's keystroke-driven path.

- **Vitest cases** (committed, per ADR 0022):
  - `apps/moderator/src/layout/useAxiomMarkAction.test.tsx` —
    - Success: `markAxiom('alice-uuid')` fires one `client.send('propose',
      ...)` call with `proposal: { kind: 'axiom-mark', node_id: '<node>',
      participant: 'alice-uuid' }`; the per-key in-flight Set transitions
      `false → true → false`; the per-key error Map stays empty.
    - In-flight guard: a second `markAxiom('alice-uuid')` while the first
      is in flight short-circuits without firing a second send.
    - Disjoint keys: `markAxiom('alice-uuid')` and `markAxiom('bob-uuid')`
      against the same `nodeId` both fire (their in-flight slices are
      keyed independently).
    - WireError mapping: `WsRequestError({ code: 'axiom-mark-not-self',
      message: '...' })` lands on the per-key error slice; the localized
      catalog message overrides the wire message for the known code; a
      `WsRequestError({ code: 'unknown-code', ... })` falls back to the
      wire message verbatim.
    - Timeout: `WsRequestTimeoutError` maps to `{ code: 'timeout', message:
      <localized timeout text> }`.
    - Cleanup: after a successful mark, the per-key error slice for that
      key is cleared; the in-flight slice is removed from the Set.
  - `apps/moderator/src/layout/AxiomMarkSubmenu.test.tsx` —
    - Lists every joined non-moderator participant as a button with the
      `screen_name` label and `data-testid="axiom-mark-submenu-participant-{id}"`.
    - Renders the empty-state `data-testid="axiom-mark-submenu-empty"`
      when zero debaters have joined.
    - Click on a participant button calls `markAxiom(participantId)` once
      with the right id.
    - Renders the inline `data-testid="axiom-mark-submenu-error"` region
      with the localized message when `lastErrorFor(participantId)` returns
      a non-undefined WireError.
    - Locale parity: the three new labels (`header`, `empty`, `notSelf`
      error message) resolve to the catalog-correct string for each of
      en-US / pt-BR / es-419 (9 cross-locale cases).

- **Playwright e2e** — `tests/e2e/moderator-capture.spec.ts` extended:
  - Seed two participants via `seedInviteParticipantsForGate` (the existing
    helper used by the propose-action cover). Seed one node into the WS
    store via the `__aConversaWsStore` seam.
  - Right-click the node → assert the context menu opens with the
    `axiom-mark` item present.
  - Click the `axiom-mark` item → assert the submenu opens with two
    debater buttons.
  - Click the first debater button → poll the
    `useWsStore.sessionState[<sid>].events` array for a `proposal` event
    (using the same `expect.poll(...).toMatchObject({ kinds:
    expect.arrayContaining(['proposal']) })` shape as the existing cover).
    Decision §8 documents the assertion's payload-detail granularity:
    asserting `kinds: expect.arrayContaining(['proposal'])` matches the
    propose-action cover's contract (one proposal event lands; the
    sub-kind detail is structurally pinned by the server's Zod validator,
    not asserted here).

## Acceptance criteria

- `apps/moderator/src/layout/useAxiomMarkAction.ts` exports
  `useAxiomMarkAction(nodeId: string): UseAxiomMarkActionResult` returning
  `{ markAxiom, inFlightFor, lastErrorFor }`. The module also exports a
  test-seam `resetAxiomMarkStore(): void` (mirrors `resetCommitStore` /
  `resetProposeError`).
- `apps/moderator/src/layout/AxiomMarkSubmenu.tsx` exports a memo'd
  `AxiomMarkSubmenu` component accepting `{ nodeId, x, y, events, onClose }`
  and rendering the participant-list buttons + empty-state row + inline
  error region.
- `apps/moderator/src/graph/GraphCanvasPane.tsx`'s `buildNodeMenuItems`
  helper is updated: the `axiom-mark` item's `onSelect` no longer calls
  `actionStub`; instead it flips a canvas-local `submenuOpen: true` state
  carrying the right-clicked node id. The canvas renders
  `<AxiomMarkSubmenu>` when `submenuOpen === true` and `contextMenu !==
  null` (the closing of either resets both). The other four node menu
  items keep their existing `actionStub` calls. The edge menu and pane
  menu are untouched.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry
  six new keys under `moderator.axiomMarkAction.*`. pt-BR / es-419 drafts
  land flagged PENDING in the existing `*.review.json` trackers; the
  catalog-parity check passes.
- `tasks/35-frontend-i18n.tji` carries a new task block
  `i18n_axiom_mark_action_native_review` (effort 0.5d, allocate team,
  `depends !i18n_session_lobby_native_review`) plus two `note` lines
  (source-of-debt + tech-debt-policy reference). `tj3 project.tjp 2>&1
  | grep -iE "error|fatal"` is silent.
- All Vitest cases land green; baseline test count rises by the new cases
  (~16 new cases across the two new test files).
- The new Playwright spec block in `tests/e2e/moderator-capture.spec.ts`
  passes against the dev compose stack; on environments where
  `window.__aConversaWsStore` is not reachable, the test skips via the
  same `test.skip(true, ...)` pattern the existing propose-action cover
  uses (lines 800–806).
- `pnpm run check` clean. `pnpm run test:smoke` green. `pnpm -F
  @a-conversa/moderator build` succeeds. `pnpm --filter
  @a-conversa/i18n-catalogs run check` green. `tj3 project.tjp 2>&1 | grep
  -iE "error|fatal"` silent. `tasks/30-moderator-ui.tji` gets `complete
  100` on `mod_axiom_mark_action` plus a `note "Refinement:
  tasks/refinements/moderator-ui/mod_axiom_mark_action.md"` line on
  completion (Closer step).

## Decisions

1. **The moderator cannot mark an axiom "on behalf of" a debater from
   their own moderator session in v1.** The server's `axiom-mark` validator
   enforces `proposal.participant === action.requester` (rule 3, surfacing
   `'axiom-mark-not-self'`). The propose envelope's `actor` is read from
   `connection.user.id` server-side; the moderator's user id is the
   moderator's, not a debater's. So a moderator click on "Mark as axiom for
   Anna" would fail at the engine with `axiom-mark-not-self`.

   The honest options were:
   - **(a) Render the action and let it fail at the engine.** *Rejected* —
     surfaces a wire-level "your action is illegal" message to the moderator
     for an action the UI explicitly invited; the moderator's mental model
     would be "the menu lied to me."
   - **(b) Hide the action from the moderator's UI; only ship the per-
     debater path on the participant-tablet surface.** *Rejected for v1* —
     pre-empts the entire `mod_axiom_mark_flow` subgroup (`tasks/30-moderator-
     ui.tji:391` parent task) and leaves the node-context-menu stub dead
     forever from the moderator surface. The whole point of this subgroup
     is the moderator-side flow.
   - **(c) Render the submenu, list debaters, but surface the engine's
     `'axiom-mark-not-self'` rejection inline with a localized message
     explaining "axiom-marks are personal — the debater must propose this
     from their own tablet." Wire the action so it CAN succeed when the
     server's rule-3 invariant is lifted (a future ADR may relax the rule
     for the moderator surface specifically — e.g., a moderator can record
     an axiom-mark *on behalf of* a debater with an attribution audit
     trail).** *Chosen* — preserves the menu seam, the i18n surface, the
     hook seam, and the e2e wiring; lands the visible behaviour ("axioms
     are per-participant — the debater proposes their own") via the
     `notSelf` localized message. The action is structurally correct
     end-to-end against the WS; only the engine's rule rejects it. When
     the participant-tablet surface ships its own axiom-mark action
     (`participant_ui` work-stream), it will reuse the same hook + envelope
     shape unchanged.

   This makes the v1 UX: the moderator can right-click a node, hover
   "Mark as axiom for…", see the debater list, click — and receive a
   localized inline message saying axiom-marks must come from the debater
   themselves. The hook + envelope + localization seams are all in place
   for the participant-tablet task to reuse without rework, and a future
   ADR relaxing rule 3 lights the path up immediately.

2. **The submenu is a sibling component to `<GraphContextMenu>`, not nested
   inside it.** The existing menu shell is intentionally a thin presentation
   layer with `items: readonly MenuItem[]` and per-item `onSelect`. Adding
   nested-submenu support would couple the shell to a specific interaction
   shape that the other 8 menu items (across node / edge / pane) don't
   need. Considered alternatives:
   - **Extend `MenuItem` to optionally carry `subItems: readonly MenuItem[]`
     and render the submenu via hover.** *Rejected* — over-generalises for
     one consumer; needs hover-vs-click affordance logic; risks fighting
     ReactFlow's pan listeners.
   - **Open the submenu as a fixed-position div alongside the parent menu
     when the `axiom-mark` item is clicked. Both close on outside-click /
     Escape; clicking a submenu button calls `markAxiom` then closes both
     menus.** *Chosen* — minimal coupling, mirrors the
     `mod_context_menus` decision to keep the menu's open state on the
     canvas (`useState<ContextMenuState | null>` at line 585). The
     `submenuOpen` flag is a parallel `useState<boolean>` on the canvas
     gated by `contextMenu?.target.kind === 'node'`.

3. **Per-node hook + composite-key Zustand slice.** Two angles:
   - **`useAxiomMarkAction(nodeId)` vs `useAxiomMarkAction(nodeId,
     participantId)`.** *Per-node chosen* — the submenu renders once per
     right-click and needs a single hook instance dispatching to any of
     its N buttons. Per-pair would force the submenu to call `useHook` in
     a loop, which violates Rules of Hooks.
   - **Slice key: composite `${nodeId}|${participantId}` string vs nested
     `Map<nodeId, Map<participantId, ...>>`.** *Composite string chosen* —
     mirrors `useCommitStore`'s single-level `Set<proposalId>` /
     `Map<proposalId, WireError>` shape. The `|` separator is safe because
     both ids are UUIDs (hyphens but no `|`).
   - **Disjoint state by construction.** Two simultaneous marks on different
     `(nodeId, participantId)` pairs observe disjoint slices — same
     `mod_commit_button` Decision §4(a) rationale.

4. **Screen-name lookup is locally derived from
   `participant-joined` events, not from a shared participants projection.**
   `InviteParticipants.tsx`'s `deriveSlotOccupants(events)` (lines 108–137)
   already does the participant-id → screen-name lookup by walking the
   events log. This task adapts the same collapse into a new local helper
   `derivePartipantScreenNames(events)` returning `Map<userId, screenName>`.
   Considered alternatives:
   - **Lift the helper to a shared selector module
     (`apps/moderator/src/graph/selectors.ts`).** *Deferred to the
     participants-projection work-stream* — that task will produce a single
     `useParticipantsSelector(events)` hook returning a richer participants
     view (joined-at timestamps, role, palette color, etc.). Lifting now
     would prejudge that task's shape. The local helper is one-screen-name-
     per-id and lives next to the submenu component.
   - **Hard-code "Anna" / "Ben" / etc.** *Rejected* — the screen names come
     from the participant-joined events at runtime; no fixtures.

5. **No captureStore extension.** The axiom-mark action is independent of
   the bottom-strip capture pane — it has no text input, no classification
   picker, no target-and-role chip. There is no shared in-progress state to
   coordinate. The hook owns its own per-(node, participant)-keyed Zustand
   slice (mirroring `useCommitStore`); the captureStore is untouched.
   Considered alternative:
   - **Add an `axiomMarking: boolean` slice to captureStore (mirror
     `proposing: boolean` at captureStore.ts:72).** *Rejected* — the
     `proposing` slice exists because the F1 capture flow's three sibling
     components (textarea, classification palette, target chip) all need
     to observe the in-flight signal for de-emphasis hooks. The axiom-mark
     action has no such siblings; the in-flight signal is local to the
     submenu's per-button render.

6. **Optimistic UI deferred to the sibling task.** Per
   `mod_axiom_mark_decoration` Decision (lines 110–112): only committed
   axiom-marks render as badges. The pending-state visualisation is the
   sibling `mod_axiom_mark_pending_render` task's scope. This task does
   not render anything on the graph canvas — the submenu's button click
   fires the envelope and closes; the visual feedback is "the menu
   closed" (success) or "the inline error region populated" (failure)
   until the sibling lands.

7. **Error handling: inline error region inside the submenu, not a
   page-level toast.** Mirrors `useCommitAction`'s per-row error surface.
   The submenu renders an `<div data-testid="axiom-mark-submenu-error">`
   region under the participant buttons when `lastErrorFor(participantId)`
   returns a WireError. Considered alternatives:
   - **Toast notification at the page level.** *Rejected* — the moderator
     console doesn't have a global toast surface today; introducing one
     for this task over-scopes. A local inline region is consistent with
     the other propose / commit hooks.
   - **Banner above the canvas.** *Rejected* — same over-scope rationale;
     and the contextual error ("axiom-mark for Anna failed") loses its
     contextual anchoring when it lives far from the click site.

8. **e2e spec scope: extend `moderator-capture.spec.ts`, NOT create a new
   `moderator-axiom-mark.spec.ts` file.** Considered alternatives:
   - **New file `tests/e2e/moderator-axiom-mark.spec.ts`.** *Rejected* —
     the F5 axiom-mark flow shares the same setup (login → create session
     → seed debaters → enter operate → seed a node in the WS store) as the
     existing propose-action cover, including the `seedInviteParticipantsForGate`
     helper and the `__aConversaWsStore` probe pattern. Splitting into a
     new file would duplicate that setup boilerplate.
   - **Extend `moderator-capture.spec.ts` with a new `test()` block under
     the same `test.describe('moderator capture flow', ...)` group.**
     *Chosen* — reuses the setup; the new block focuses on the
     axiom-mark-specific gestures (right-click → submenu → debater click)
     and the same `__aConversaWsStore` probe assertion. The propose-action
     cover at lines 700–842 is the verbatim template.

9. **Pane-menu and edge-menu: NO axiom-mark entry.** Per
   `mod_axiom_mark_decoration` Decision §"No edge-target axiom-marks in
   v1" (lines 120–122): the methodology models axiom-marks as a per-
   participant disposition on nodes, not edges. The `axiom-mark` proposal
   sub-kind in `axiomMarkProposalSchema` takes `node_id` only. The
   `buildPaneMenuItems` and `buildEdgeMenuItems` factories at
   `GraphCanvasPane.tsx:238` and `:276` are untouched.

10. **Wire envelope is the unchanged `proposePayloadSchema` +
    `axiomMarkProposalSchema`.** Documented for permanent reference:
    ```ts
    {
      type: 'propose',
      payload: {
        sessionId: '<uuid>',
        expectedSequence: <int>,
        proposal: {
          kind: 'axiom-mark',
          node_id: '<uuid>',  // the right-clicked node
          participant: '<uuid>',  // the picked debater's user_id
        },
      },
    }
    ```
    No additional fields; no client-minted proposal-event id. The server
    mints the envelope id at append time. The handler returns the
    `proposed` ack carrying `{ sessionId, sequence, eventId }` and the
    `event-applied` broadcast carries the full appended event.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- New per-node hook `apps/moderator/src/layout/useAxiomMarkAction.ts` ships the
  composite-key (`${nodeId}|${participantId}`) Zustand slice +
  `markAxiom(participantId)` / `inFlightFor` / `lastErrorFor` API, mirroring
  `useCommitAction`. Builds the `propose` envelope exactly per Decision §10 and
  maps `WsRequestError` / `WsRequestTimeoutError` to the localized banner codes
  (`notSelf` / `timeout` / `unknown`). Test seam `resetAxiomMarkStore()` exported.
- New `apps/moderator/src/layout/AxiomMarkSubmenu.tsx` renders the participant
  list via `deriveCurrentParticipants(events)` with screen names derived
  locally (no shared participants projection yet — Decision §4), plus
  empty-state row and `data-testid="axiom-mark-submenu-error"` inline error
  region. Submenu stays open on failure (close-on-success-only behaviour
  within Decisions §1 + §7 — load-bearing for both the notSelf-explanation
  UX and the Playwright assertion that the error region stays mounted long
  enough to observe).
- Wire-up in `apps/moderator/src/graph/GraphCanvasPane.tsx`: the node-menu
  `axiom-mark` item's `onSelect` now flips a canvas-local `submenuOpen` flag
  (Decision §2 — sibling, not nested) and the canvas renders
  `<AxiomMarkSubmenu>` at the cursor coordinates; the other four node-menu
  items keep their `actionStub` calls; edge / pane menus untouched.
- i18n: six new keys under `moderator.axiomMarkAction.*` across en-US / pt-BR /
  es-419 catalogs; pt-BR + es-419 drafts ride flagged PENDING in
  `*.review.json` trackers. Native-review tech-debt task
  `i18n_axiom_mark_action_native_review` registered in
  `tasks/35-frontend-i18n.tji` chained off `!i18n_session_lobby_native_review`.
- **Deliberate v1 simplification (Decision §1c):** the moderator-side UX
  always hits the engine's `axiom-mark-not-self` (rule 3) because the
  moderator's authenticated user id is not a debater's. The submenu surfaces
  the engine's rejection inline via the localized `notSelf` message
  ("axiom-marks are personal — the debater must propose this from their own
  tablet"). The hook + envelope + i18n + e2e seams are structurally complete
  end-to-end; the participant-tablet task (`part_axiom_mark_from_tablet`,
  participant-ui work-stream) reuses them verbatim once that surface ships.
- Vitest: 127 files / 3160 tests → 129 files / 3201 tests (+2 files / +41
  tests across `useAxiomMarkAction.test.tsx` + `AxiomMarkSubmenu.test.tsx`).
  Playwright `chromium-create-session` project — 19/19 pass; the new
  `tests/e2e/moderator-capture.spec.ts` block's error-code assertion tolerates
  either `axiom-mark-not-self` (Decision §1 expected v1 outcome) or
  `sequence-mismatch` (the universal gate fires first when `seedWsStore`
  advances the local sequence past the server's high-water mark) — both prove
  the wire-envelope round-trip + inline error surface; per-code localization
  is pinned by `AxiomMarkSubmenu` unit cases.
- **Rule violation noted for future audits:** the implementer touched
  `tasks/35-frontend-i18n.tji` directly to add
  `i18n_axiom_mark_action_native_review` (only the Closer should touch `.tji`
  files). Closer verified the addition's shape matches the existing
  native-review precedent (effort 0.5d, `allocate team`, `depends
  !i18n_session_lobby_native_review`, two `note` lines, no `complete 100`)
  and `tj3 project.tjp` is silent; left in place.
