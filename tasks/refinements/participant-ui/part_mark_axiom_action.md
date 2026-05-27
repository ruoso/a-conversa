# Mark-as-my-axiom action in the participant entity detail panel

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task
`participant_ui.part_axiom_mark_from_tablet.part_mark_axiom_action`.

```
task part_axiom_mark_from_tablet "Axiom-mark from tablet (P5)" {
  depends !part_graph_view, data_and_methodology.methodology_engine.axiom_mark_logic
  task part_mark_axiom_action "Mark-as-my-axiom action in node detail panel" {
    effort 1d
    allocate team
  }
  task part_axiom_mark_proposal "Send axiom-mark proposal" {
    effort 0.5d
    allocate team
    depends !part_mark_axiom_action
  }
}
```

## Effort estimate

**1d.** Confirmed. The leaf wires one button into the existing
`<EntityDetailPanel>` `actionSlot` (per `part_entity_detail_panel` Decision §11 the
slot was reserved exactly for the future voting / axiom-mark leaves) and ships a
participant-side `useAxiomMarkAction` hook that produces the `propose` envelope.
The plumbing is small but pulls in three established patterns: the per-target
Zustand-backed in-flight + lastError store (mirrors `useVoteAction` /
`useWithdrawAgreementAction`), the `<EntityDetailPanel actionSlot=…>` seam (per
[`apps/participant/src/detail/EntityDetailPanel.tsx:336-346`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L336)),
and the i18n catalog parity workflow (new `participant.axiomMarkButton.*`
namespace + `participant.detailPanel.sectionTitle.markAxiom`).

The deliverable is:

- **`apps/participant/src/detail/useAxiomMarkAction.ts`** — per-`nodeId` hook
  mirroring `useVoteAction`'s shape. Module-scoped Zustand slice keyed on the
  bare `nodeId` (Decision §3 — the composite-key variant the moderator uses
  for its multi-participant submenu degenerates to a single key on the
  participant side because the debater can only mark themselves). Exposes
  `{ markAsAxiom, inFlight, lastError }`; `markAsAxiom` builds the canonical
  `propose` envelope with `{ kind: 'axiom-mark', node_id, participant }` and
  calls `client.send('propose', payload)`.
- **`apps/participant/src/detail/ParticipantAxiomMarkButton.tsx`** — single
  visible button mounted into `<EntityDetailPanel>`'s `actionSlot` from
  `OperateRoute.tsx`. Carries the `data-testid="participant-axiom-mark-button"`
  + `data-node-id` selector contract; reflects the hook's `inFlight` /
  `lastError` state on disabled / aria-disabled / inline error region.
- **`apps/participant/src/routes/OperateRoute.tsx`** wire-up — derive the
  `axiomMarkButton` from the current selection (kind === 'node' AND the
  current participant has NOT already marked the node) and pass it through
  `<EntityDetailPanel actionSlot={…}>`.
- **i18n catalog extensions** under `participant.axiomMarkButton.*` (six
  keys: `label`, `inFlightLabel`, `ariaLabel`, `wireError`, `timeoutError`,
  `errorRoleLabel`) + one new sectionTitle key
  (`participant.detailPanel.sectionTitle.markAxiom`). Drafts for pt-BR /
  es-419 ride flagged PENDING in the existing `*.review.json` trackers.
- **Vitest coverage** at `useAxiomMarkAction.test.tsx` and
  `ParticipantAxiomMarkButton.test.tsx`. Covers the canonical envelope
  shape, in-flight transitions, the engine `axiom-mark-not-self` rejection,
  the `WsRequestTimeoutError` localized fallback, per-`nodeId` isolation
  across concurrent calls, and the `alreadyMarked` suppression.

This task ALSO carries the wire dispatch in the same hook — the sibling
`part_axiom_mark_proposal` (0.5d, `tasks/40-participant-ui.tji:312`) is
structurally absorbed by this one because the action button is only useful
if it sends. Decision §10 records the merger and the implication for the
closer.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public
contracts):

- **`data_and_methodology.methodology_engine.axiom_mark_logic`** (done —
  2026-05-10). The server's `propose` handler enforces four rules in
  evaluation order: node-exists → node-visible →
  participant-equals-requester (`axiom-mark-not-self`) → no-duplicate
  (`illegal-state-transition`). See
  [`apps/server/src/methodology/handlers/propose.ts:75-92`](../../../apps/server/src/methodology/handlers/propose.ts#L75)
  + [`tasks/refinements/data-and-methodology/axiom_mark_logic.md`](../data-and-methodology/axiom_mark_logic.md).
  The rule-3 constraint is the load-bearing invariant that distinguishes the
  participant flow from the moderator flow: the participant passes their own
  authenticated user id as `proposal.participant`, so rule 3 passes
  naturally (Decision §1).

- **`participant_ui.part_graph_view.part_axiom_mark_decoration`** (done —
  2026-05-17). Shipped the participant's
  [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts)
  port of `projectAxiomMarks` / `groupAxiomMarksByNode` / `nodeHasAxiomMark`
  / the `AxiomMark` interface. The participant's `axiomMarkIndex:
  ReadonlyMap<string, readonly AxiomMark[]>` is the data source this task
  reads for the `alreadyMarked` suppression (Decision §4).

- **`participant_ui.part_graph_view.part_entity_detail_panel`** (done —
  2026-05-22). Shipped the panel's `actionSlot` prop (Decision §11 of that
  refinement: "Reserved for future voting / axiom-mark leaves") at
  [`EntityDetailPanel.tsx:336-346`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L336)
  + 537-539. This task plugs into that slot from `OperateRoute.tsx`; no
  panel-internal change.

- **`participant_ui.part_voting.part_vote_single_tap`** (done — established
  the participant's `useVoteAction` template: per-target Zustand store +
  in-flight + lastError + `WsRequestError` / `WsRequestTimeoutError` →
  `WireError` mapping). The participant's `useAxiomMarkAction` adopts the
  same shape per-`nodeId`.

- **`participant_ui.part_withdraw.part_withdraw_action`** (done — established
  the participant's "per-slot keyed Zustand-backed per-action hook" idiom at
  [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts)
  — the closest sibling pattern). Same posture: hook colocated with the
  panel, slot-keyed disjoint state, pessimistic-wait on the broadcast.

- **`backend.websocket_protocol.ws_propose_message`** (done). The `propose`
  envelope's wire shape is settled; `client.send('propose', payload)` returns
  on the `proposed` ack or rejects with `WsRequestError` /
  `WsRequestTimeoutError`. The `useVoteAction` hook's error-mapping helper is
  the verbatim template.

- **`data_and_methodology.event_types.proposal_events`** (done). The
  `axiom-mark` proposal payload shape — `{ kind: 'axiom-mark', node_id:
  UUID, participant: UUID }` — is settled by `axiomMarkProposalSchema` at
  [`packages/shared-types/src/events/proposals.ts:275-281`](../../../packages/shared-types/src/events/proposals.ts#L275).
  This task writes exactly that shape; Zod validates at the server's API
  ingress.

- **`moderator_ui.mod_axiom_mark_flow.mod_axiom_mark_action`** (done —
  2026-05-16). The moderator-side analogue (refinement
  [`tasks/refinements/moderator-ui/mod_axiom_mark_action.md`](../moderator-ui/mod_axiom_mark_action.md))
  ships the same envelope shape end-to-end but always trips
  `axiom-mark-not-self` because the moderator's authenticated user id is not
  a debater's. The moderator's `useAxiomMarkAction` is the per-target
  per-`(nodeId, participantId)` template; this task degenerates to per-`nodeId`
  (Decision §3) because the participant only marks themselves.

Pending (none — every gating dep is done).

## What this task is

Wire the participant's "mark this node as my axiom" gesture into the existing
entity-detail-panel `actionSlot`. The button only mounts when the current
selection is a **node** (edges have no axiom-mark semantic per
`axiomMarkProposalSchema`) AND when the current participant does NOT already
hold a committed axiom-mark on that node (the panel's existing
`AxiomMarkAttributionSection` at
[`EntityDetailPanel.tsx:481-486`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L481)
surfaces the existing mark; no second affordance needed). Tap fires one
`propose` envelope with `{ proposal: { kind: 'axiom-mark', node_id, participant }
}` — the engine's rule-3 constraint passes naturally because the participant
sends their own user id.

The task delivers:

- **`useAxiomMarkAction({ nodeId, participantId })` hook** at
  `apps/participant/src/detail/useAxiomMarkAction.ts` — per-`nodeId`-keyed
  Zustand slice (`marking: ReadonlySet<string>` + `errors: ReadonlyMap<string,
  WireError>`) with `setMarking` / `setError` setters. Exposes
  `{ markAsAxiom, inFlight, lastError }`. The `markAsAxiom` callback builds
  the propose envelope and `await`s `client.send('propose', payload)`; on
  success it removes the `nodeId` from the in-flight set and clears any
  stale error; on failure it remaps the thrown error to a `WireError` via
  the `toWireError(err, timeoutText)` helper (the timeout text is
  pre-resolved via `useTranslation()` so the helper stays React-free).

- **`<ParticipantAxiomMarkButton>` component** at
  `apps/participant/src/detail/ParticipantAxiomMarkButton.tsx` — accepts
  `{ nodeId, currentParticipantId, alreadyMarked }`. When `alreadyMarked
  === true` returns `null` (suppress entirely — Decision §4). Otherwise
  renders a `<section data-testid="participant-detail-panel-axiom-mark-section">`
  with a section heading + a single `<button>` carrying:
  - `data-testid="participant-axiom-mark-button"`
  - `data-node-id={nodeId}`
  - `data-axiom-mark-state={inFlight ? 'in-flight' : 'enabled'}`
  - `disabled={inFlight}` + `aria-disabled={inFlight}`
  - `aria-label` from `participant.axiomMarkButton.ariaLabel`
  - inline error region (`role="alert"` +
    `data-testid="participant-axiom-mark-button-wire-error"`) when
    `lastError !== undefined`.

- **`<OperateRoute>` wire-up** — derive `axiomMarkButton` from the current
  selection. The route already hosts the projection chain (per
  `part_entity_detail_panel` Decision §2 — projector hoisted to the route);
  this task adds:
  ```tsx
  const selected = useSelectionStore((s) => s.selected);
  const axiomMarkButton =
    selected !== null && selected.kind === 'node'
      ? (() => {
          const marks = axiomMarkIndex.get(selected.id) ?? [];
          const alreadyMarked = marks.some(
            (m) => m.participantId === currentParticipantId,
          );
          return (
            <ParticipantAxiomMarkButton
              nodeId={selected.id}
              currentParticipantId={currentParticipantId}
              alreadyMarked={alreadyMarked}
            />
          );
        })()
      : null;
  const actionSlot =
    axiomMarkButton !== null ? (
      <div className="flex flex-col gap-3">{axiomMarkButton}</div>
    ) : undefined;
  ```
  Then `<EntityDetailPanel … actionSlot={actionSlot} />`. The route reads
  `currentParticipantId` from the existing `auth.user.userId` already in
  scope (per `part_state_management`).

- **i18n catalog extensions** — six new keys under
  `participant.axiomMarkButton.*` + one new sectionTitle key
  (`participant.detailPanel.sectionTitle.markAxiom`) across the three
  catalogs (`en-US`, `pt-BR`, `es-419`). Drafts for pt-BR / es-419 ride
  flagged PENDING in the existing `*.review.json` trackers.

- **Vitest cases** under
  `apps/participant/src/detail/useAxiomMarkAction.test.tsx` and
  `apps/participant/src/detail/ParticipantAxiomMarkButton.test.tsx`. Cover:
  - canonical envelope shape (`kind: 'axiom-mark'` / `node_id` / `participant`
    + `sessionId` / `expectedSequence`);
  - `expectedSequence` read off `useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence`;
  - in-flight transitions (`false → true → false` around the awaited send);
  - in-flight guard (concurrent `markAsAxiom` while the prior is in flight
    is a no-op);
  - per-`nodeId` isolation (two simultaneous marks against different
    `nodeId`s observe disjoint state);
  - WireError mapping (the `axiom-mark-not-self` rejection lands on the
    per-key error slice; `WsRequestTimeoutError` maps to
    `{ code: 'timeout', message: <localized> }`; plain `Error` maps to
    `'unknown'`);
  - button suppression when `alreadyMarked === true` (returns `null`);
  - button suppression when the selection is an edge (the route does NOT
    mount the button; the button itself doesn't need to know).

Out of scope (deferred to existing or future leaves):

- **Optimistic pending-state visualisation on the graph canvas.** The
  participant's at-a-glance signal is "ratified bedrock" (boolean
  `isAxiom` overlay per `part_axiom_mark_decoration` Out-of-scope). A
  pending visualisation (dashed border, pulsing dot, etc.) is deferred to
  the (future) `part_pending_proposals.*` group when the participant gets
  a pending-proposals pane. Behaviour today: between click and broadcast,
  the button flips `data-axiom-mark-state="in-flight"`; the panel's
  `AxiomMarkAttributionSection` adds the new mark on the next render once
  the `event-applied` broadcast lands and the projector picks up the
  proposal + commit pair.

- **"Remove my axiom" action.** The methodology specifies axiom-marks as
  monotonic (a debater can ADD a mark but cannot retract it through this
  surface — the withdrawal vocabulary is the per-facet
  `withdraw-agreement` event, which has no axiom-mark arm). If the
  methodology grows a `withdraw-axiom-mark` arm in the future, the
  affordance lives in the same panel section; this task does not pre-empt
  it.

- **Per-participant chromatic identity in the button.** The button text is
  the localized "Mark as my axiom" — no per-participant color, because the
  button only ever marks the CURRENT participant. The chromatic badge in
  the panel's `AxiomMarkAttributionSection` (per
  `part_entity_detail_panel_chromatic_axiom_mark_badge`) carries the
  per-participant identity for the existing marks; the button is a
  prompt-text affordance, not an identity surface.

- **e2e Playwright spec.** Deferred to `part_axiom_mark_proposal` (the
  sibling 0.5d task — Decision §10) which the closer may either repurpose
  as the Playwright cover OR mark redundant. Phase 7.1 of the e2e
  methodology spec already selects this button via
  `[data-testid="participant-axiom-mark-button"][data-node-id="<id>"]`; the
  selector contract is locked.

## Why it needs to be done

The methodology document is explicit on the load-bearing-ness of the
axiom-mark gesture from the debater's surface:

- [`docs/methodology.md` §"Axioms / terminal values"](../../../docs/methodology.md)
  — "Axioms are not a defect. They are often the most valuable output of
  the exercise: the debate dead-ends at 'A holds X as bedrock, B holds Y as
  bedrock, and that is the real disagreement.'"
- [`DESIGN.md`](../../../DESIGN.md) — bedrock axioms surface the irreducible
  disagreement; without the gesture from the debater's side the
  methodology's "primary success state" is never reachable.

The moderator-side flow `mod_axiom_mark_action` (done 2026-05-16) ships the
analogous gesture for the moderator surface but **always trips
`axiom-mark-not-self`** — the moderator's authenticated user id is never
a debater's. The moderator's submenu renders the localized "axiom-marks are
personal — the debater must propose this from their own tablet" message
inline (Decision §1.c of `mod_axiom_mark_action`); the participant tablet
surface is the v1 path that actually succeeds. Without this leaf the
methodology's bedrock-marking step is unreachable end-to-end.

The leaf also closes the
`participant_ui.part_axiom_mark_from_tablet.*` subgroup: the sibling
`part_axiom_mark_proposal` (0.5d) is structurally absorbed by the wire
dispatch this hook ships (Decision §10).

## Inputs / context

### ADRs

- [ADR 0003 — React](../../../docs/adr/0003-frontend-react.md) — the
  participant surface's component framework. The hook + button are
  function-component idiomatic React.
- [ADR 0005 — Tailwind utility classes](../../../docs/adr/0005-styling-tailwind.md)
  — the button's chrome.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
  — the propose envelope's wire shape; the inner `proposal` payload's
  snake-cased `node_id` / `participant` for the axiom-mark sub-kind. Zod
  validates at the server's API ingress; the methodology validator on top.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical check ships as a committed Vitest case; Playwright
  coverage is deferred to the sibling (Decision §10).
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — every user-facing label resolves via `useTranslation` against the
  catalog namespace.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md)
  — the hook + component live in the participant workspace, not in
  `@a-conversa/shell`; the "promote on the third caller" rule keeps the
  surface participant-only until an audience equivalent (which is unlikely
  — the audience surface is read-only) materialises.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md)
  — an axiom-mark is per-node, not per-facet; the action is keyed on
  `nodeId` only, no `facet` parameter.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)
  — does NOT apply to axiom-marks (per-node, not per-facet). The hook's
  per-`nodeId` slot keying is the axiom analogue of ADR 0030's per-facet
  slot keying for `useVoteAction`.

No new ADR. Every decision below applies an existing ADR or mirrors a
settled moderator-side decision; the architectural seams are settled.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](part_entity_detail_panel.md)
  — the panel's `actionSlot` (Decision §11) is the seam this task plugs
  into.
- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md)
  — the participant's `axiomMarkIndex` derivation is the data source for
  the `alreadyMarked` suppression.
- [`tasks/refinements/participant-ui/part_entity_detail_panel_chromatic_axiom_mark_badge.md`](part_entity_detail_panel_chromatic_axiom_mark_badge.md)
  — the panel's existing per-participant chromatic-badge row for
  committed marks; the button this task adds is the "create" side of the
  same surface.
- [`tasks/refinements/participant-ui/part_vote_single_tap.md`](part_vote_single_tap.md)
  + the per-facet refactor's `pf_part_*` chain — the canonical
  participant per-target wire-action template (`useVoteAction` /
  `useWithdrawAgreementAction`). This task's hook adopts the same Zustand
  shape per-`nodeId`.
- [`tasks/refinements/participant-ui/part_withdraw_action.md`](part_withdraw_action.md)
  — the closest sibling pattern in the participant surface (the
  `useWithdrawAgreementAction` hook at
  [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts)).
- [`tasks/refinements/moderator-ui/mod_axiom_mark_action.md`](../moderator-ui/mod_axiom_mark_action.md)
  — the moderator analogue. Decisions §3 (composite-key Zustand slice),
  §5 (no captureStore extension), §7 (inline error region not a toast),
  §10 (wire envelope shape) all carry over modulo the per-`nodeId`
  degeneration on this side.

### Live code the leaf plugs into

- [`apps/participant/src/detail/EntityDetailPanel.tsx:336-346`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L336)
  — the `actionSlot` prop documentation; lines 537-539 are the render
  site. No change to the panel internals.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:481-486`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L481)
  — the `<AxiomMarkAttributionSection>` mount. This is the surface the
  button's `alreadyMarked` suppression reads against (Decision §4 —
  the button and the attribution row are mutually exclusive for the
  current participant on a single node).
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx)
  — adds the selection-conditional `axiomMarkButton` derivation +
  threads `actionSlot` into `<EntityDetailPanel>`. The `axiomMarkIndex`
  + `currentParticipantId` are already in scope.
- [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts)
  — the closest template for the new hook. The `toWireError` helper
  (lines 188-199), the in-flight guard (lines 249-251), the per-slot
  store subscriptions (lines 243-244), and the `client.send` /
  catch-and-map pattern (lines 260-296) all carry over modulo the
  envelope difference (`propose` not `withdraw-agreement`).
- [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts)
  — `nodeHasAxiomMark` exists but the route uses the bucketed map
  directly so it can filter on `participantId === currentParticipantId`
  (the broader `nodeHasAxiomMark` returns true even for axiom-marks held
  by OTHER participants; the suppression is about the current
  participant only).
- [`apps/participant/src/ws/wsStore.ts`](../../../apps/participant/src/ws/wsStore.ts)
  — `useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence`
  is the same `expectedSequence` source `useVoteAction` reads.
- [`apps/participant/src/ws/wsClient.ts`](../../../apps/participant/src/ws/wsClient.ts)
  via `@a-conversa/shell`'s `useWsClient()` — `client.send('propose',
  payload)` returns a Promise that resolves on the `proposed` ack or
  rejects with `WsRequestError` / `WsRequestTimeoutError`.
- [`packages/shared-types/src/events/proposals.ts:275-281`](../../../packages/shared-types/src/events/proposals.ts#L275)
  — `axiomMarkProposalSchema`. The exact shape the hook writes.
- [`apps/server/src/methodology/handlers/propose.ts:75-92`](../../../apps/server/src/methodology/handlers/propose.ts#L75)
  — the engine's axiom-mark validator. Rejection reasons:
  `'target-entity-not-found'` (rules 1+2), `'axiom-mark-not-self'`
  (rule 3 — unreachable from this surface by construction; Decision
  §1), `'illegal-state-transition'` (rule 4 — unreachable when the
  button is suppressed via `alreadyMarked`, but still mappable in the
  rare race where two concurrent participants try to mark the same
  node).

### What the surface MUST NOT do

- **No client-minted proposal-event id.** The server mints the envelope id
  at append time per `proposal_events.md`. The hook writes the three
  payload fields only.
- **No optimistic mutation of `axiomMarkIndex` / `useWsStore`.** The
  pessimistic-wait pattern: the projection picks up the new mark when the
  `event-applied` broadcast lands.
- **No additional `actor` field on the wire.** The server reads
  `connection.user.id` and matches against `proposal.participant`; the
  envelope itself carries no separate actor.
- **No mount on edge selections.** Edges have no axiom-mark semantic
  (`axiomMarkProposalSchema` takes `node_id` only). The route's
  conditional renders the button only when `selected.kind === 'node'`.
- **No mount when `alreadyMarked === true`.** The current participant has
  already declared this node as bedrock; the existing
  `AxiomMarkAttributionSection` surfaces the mark; a second affordance
  would be incoherent (the methodology has no "re-affirm" gesture).

## Constraints / requirements

- **The propose envelope shape is fixed** by `axiomMarkProposalSchema` +
  `proposePayloadSchema`. The hook writes exactly:
  ```ts
  await client.send('propose', {
    sessionId,
    expectedSequence: useWsStore.getState().sessionState[sessionId]
      ?.lastAppliedSequence ?? 0,
    proposal: {
      kind: 'axiom-mark',
      node_id: nodeId,
      participant: participantId,   // === auth.user.userId
    },
  });
  ```
  No additional fields; no client-minted id; no client timestamp.

- **`useAxiomMarkAction({ nodeId, participantId })` is the per-node hook
  signature.** Both args are required; the `participantId` always equals
  the authenticated user id at the call site (the button reads it from a
  prop bound to `auth.user.userId`). Passing them as args (not reading
  `participantId` from a context inside the hook) keeps the wire payload
  testable end-to-end without needing an auth-context mock.

- **Per-`nodeId` Zustand slice.** The slice is module-scoped (`create<…>`
  outside React) so two `useAxiomMarkAction({ nodeId })` callsites for the
  same id share state; per-`nodeId` slice subscriptions
  (`s.marking.has(nodeId)`, `s.errors.get(nodeId)`) keep each consumer's
  re-render scope narrow. The slice is independent of
  `useWithdrawAgreementActionStore` and `useVoteActionStore` (separate
  module-scoped `create()` calls; no namespace prefix collisions because
  the namespaces are physically disjoint).

- **In-flight guard + clear-prior-error.** A second `markAsAxiom()` while
  the first is in flight is a no-op (matches `useVoteAction` /
  `useWithdrawAgreementAction`). On click, the hook flips the slot's
  in-flight to true AND clears any prior error for that slot — symmetric
  with the predecessor hooks.

- **Error mapping.** `WsRequestError` → `{ code, message }` verbatim;
  `WsRequestTimeoutError` → `{ code: 'timeout', message:
  t('participant.axiomMarkButton.timeoutError') }`; any other thrown
  `Error` → `{ code: 'unknown', message: err.message }`; non-Error throws
  → `{ code: 'unknown', message: String(err) }`. Mirrors
  `useWithdrawAgreementAction`'s `toWireError`.

- **Button rendering — only on node selections, only when not already
  marked by the current participant.** Both conditions are evaluated at
  the route level (the button component itself takes `alreadyMarked` as a
  prop). The route reads
  `axiomMarkIndex.get(selected.id)?.some(m => m.participantId ===
  currentParticipantId)` to compute the boolean.

- **Selector contract.** The button MUST carry
  `data-testid="participant-axiom-mark-button"` +
  `data-node-id="<the node id>"` so the e2e methodology spec
  (`tests/e2e/participant-methodology-flow.spec.ts` Phase 7.1) can target
  it. The inline error region MUST carry
  `data-testid="participant-axiom-mark-button-wire-error"` + `role="alert"`
  for screen-reader announcement.

- **i18n catalog parity** — `pnpm --filter @a-conversa/i18n-catalogs run
  check` remains green after the seven new keys land. pt-BR / es-419
  drafts ride flagged PENDING per the catalog workflow.

- **Native-review tech-debt task** — register
  `i18n_axiom_mark_button_native_review` (effort 0.5d, allocate team,
  chained off the tail of the existing native-review chain in
  `tasks/35-frontend-i18n.tji`). The closer adds the `.tji` entry per
  the task-completion ritual; the implementer does NOT touch `.tji`
  files (the moderator-side violation noted in
  `mod_axiom_mark_action.md`'s Status block is the negative precedent).

- **Test coverage (committed, per ADR 0022):**

  - `apps/participant/src/detail/useAxiomMarkAction.test.tsx`:
    - Success: `markAsAxiom()` fires one `client.send('propose', …)` with
      the canonical payload; the per-`nodeId` in-flight slice transitions
      `false → true → false`; the per-`nodeId` error slice stays empty.
    - In-flight guard: a second `markAsAxiom()` while the first is in
      flight short-circuits without firing a second send.
    - Disjoint keys: `markAsAxiom()` calls against two different `nodeId`s
      observe disjoint slices (each `useAxiomMarkAction({ nodeId })` hook
      instance sees its own `inFlight` flip independently).
    - WireError mapping: `WsRequestError({ code: 'axiom-mark-not-self', …
      })` lands on the error slice verbatim; `WsRequestTimeoutError` maps
      to `{ code: 'timeout', message: <localized> }`; plain `Error` maps
      to `'unknown'` with the error's `.message`.
    - `expectedSequence` is read off
      `useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence`
      (or `0` when undefined).
    - Cleanup: after a successful mark the per-`nodeId` error slice is
      cleared; the in-flight `Set` no longer contains the `nodeId`.

  - `apps/participant/src/detail/ParticipantAxiomMarkButton.test.tsx`:
    - Renders the button with the correct `data-testid` + `data-node-id`
      when `alreadyMarked === false`; returns `null` when
      `alreadyMarked === true`.
    - Clicking the button calls `markAsAxiom` once via the hook (mocked
      `useAxiomMarkAction`).
    - `data-axiom-mark-state` flips to `"in-flight"` when the hook
      reports `inFlight: true`; the button becomes `disabled` +
      `aria-disabled="true"`; the label text switches to the
      `inFlightLabel` catalog string.
    - Inline error region renders when `lastError !== undefined` with the
      formatted localized message; carries `role="alert"`.
    - i18n labels resolve through `useTranslation()` (covered by a
      catalog-snapshot assertion against en-US per the existing
      participant-test convention).

## Acceptance criteria

- `apps/participant/src/detail/useAxiomMarkAction.ts` exports
  `useAxiomMarkAction({ nodeId, participantId }): { markAsAxiom, inFlight,
  lastError }`. The module also exports `useAxiomMarkActionStore` (the
  Zustand store) + `resetAxiomMarkActionStore()` (the test seam mirroring
  `resetWithdrawAgreementActionStore`).
- `apps/participant/src/detail/ParticipantAxiomMarkButton.tsx` exports
  `ParticipantAxiomMarkButton({ nodeId, currentParticipantId, alreadyMarked
  })` returning `ReactElement | null`. The selector contract
  (`participant-axiom-mark-button` + `data-node-id`) is locked.
- `apps/participant/src/routes/OperateRoute.tsx` derives the
  selection-conditional `axiomMarkButton` and threads it through
  `<EntityDetailPanel actionSlot={…}>`. No change to the panel internals
  (`<EntityDetailPanel>` is untouched). The route still hosts the
  projection chain; nothing moves.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry
  seven new keys: `participant.axiomMarkButton.label`,
  `.inFlightLabel`, `.ariaLabel`, `.wireError`, `.timeoutError`,
  `.errorRoleLabel`, plus
  `participant.detailPanel.sectionTitle.markAxiom`. pt-BR / es-419
  drafts ride flagged PENDING in `*.review.json` trackers; the
  catalog-parity check passes.
- Vitest cases land green; baseline test count rises by ~16 new cases
  across the two new test files (the hook file carries ~9 cases per the
  commit log; the button file carries ~7).
- The Playwright e2e cover is deferred to the sibling
  `part_axiom_mark_proposal` (Decision §10) — the closer registers the
  shape it expects, OR marks the sibling complete-via-absorption if the
  closer decides the inline button is exercised sufficiently by Phase
  7.1 of the existing `tests/e2e/participant-methodology-flow.spec.ts`.
- A new tech-debt task `i18n_axiom_mark_button_native_review` is
  registered by the closer in `tasks/35-frontend-i18n.tji` (effort 0.5d,
  `allocate team`, chained off the tail of the existing native-review
  chain).
- `pnpm run check` clean. `pnpm run test:smoke` green. `pnpm -F
  @a-conversa/participant build` succeeds. `pnpm --filter
  @a-conversa/i18n-catalogs run check` green. `tj3 project.tjp 2>&1 |
  grep -iE "error|fatal"` silent. `tasks/40-participant-ui.tji` gets
  `complete 100` on `part_mark_axiom_action` (closer step) plus a `note
  "Refinement: tasks/refinements/participant-ui/part_mark_axiom_action.md"`
  line on completion. The closer also decides the disposition of
  `part_axiom_mark_proposal` per Decision §10.

## Decisions

1. **The participant ALWAYS passes their own user id as
   `proposal.participant`.** This is the structural inverse of the
   moderator-side rule-3 (`'axiom-mark-not-self'`) constraint: the
   moderator's authenticated user id never equals a debater's, so the
   moderator submenu always trips the rejection. The participant
   surface, by passing `currentParticipantId === auth.user.userId`,
   satisfies the rule by construction.

   The honest options were:
   - **(a) Hard-bind `participantId` inside the hook via a `useAuth()`
     context call.** *Rejected* — couples the hook to the auth-context
     shape; makes the unit tests need an auth-context mock that lives
     across many other hooks; obscures the wire payload at the call
     site.
   - **(b) Accept `participantId` as a hook argument; bind it at the
     button-component prop level.** *Chosen* — the button's
     `currentParticipantId` prop is bound to `auth.user.userId` at the
     route; the hook is auth-agnostic and individually unit-testable. The
     call site's "the participant marks themselves" invariant is
     enforceable via TypeScript narrowing at the route.

2. **The button mounts only when the selection is a node AND the current
   participant has not already marked it.** The first condition is the
   methodology constraint (`axiomMarkProposalSchema` takes `node_id`
   only — edges are not eligible); the second is a UX choice. The
   rejected alternative — render the button always and let the engine
   trip `'illegal-state-transition'` on the duplicate — leaks an engine
   error into a deliberately-impossible UX path.

   - **(a) Always-render + engine-trip-duplicate.** *Rejected* — surfaces
     a wire error to the debater for a gesture the UI explicitly invited;
     the debater's mental model is "the panel lied to me about whether
     this was do-able."
   - **(b) Suppress the button when already marked.** *Chosen* — the
     panel's existing `AxiomMarkAttributionSection` already surfaces the
     fact the current participant has marked the node (per
     `part_entity_detail_panel_chromatic_axiom_mark_badge`); a second
     affordance offering "mark again" would be incoherent.

3. **Per-`nodeId` keying — NOT the moderator's composite
   `${nodeId}|${participantId}`.** The moderator dispatches against N
   debaters from a submenu (one hook instance per submenu mount,
   N concurrent target dispatches); the composite key is what keeps the
   N rows' in-flight / error states disjoint. The participant only marks
   THEMSELVES — the `participantId` argument is bound to the
   authenticated user id at the call site, so the `(nodeId,
   participantId)` pair degenerates to `nodeId` alone. The slice key is
   the bare `nodeId` string.

   - **(a) Composite key `${nodeId}|${participantId}` (mirror moderator).**
     *Rejected* — over-engineers for a surface that can never call
     `markAsAxiom` with a participantId other than its own; the second
     dimension carries no information.
   - **(b) Bare `nodeId` key.** *Chosen* — simpler, smaller, isomorphic
     to the moderator slice when projected onto the participant's
     single-participant axis. The mental model is "this node has a
     pending mark in flight" — node-scoped is exactly right.

4. **`alreadyMarked` is a prop, not a hook-internal lookup.** The route
   already holds the `axiomMarkIndex` (the panel's projection-hoist per
   `part_entity_detail_panel` Decision §2). Computing `alreadyMarked` at
   the route lets the route also handle the "no axiom-mark button on
   edge selections" case via the same conditional. The button stays a
   pure presentational component receiving the boolean.

   - **(a) Hook reads `axiomMarkIndex` internally.** *Rejected* — couples
     the hook to the projection module; requires the hook to do its own
     selector subscription against the events slice; expands the
     unit-test surface unnecessarily.
   - **(b) Prop-driven `alreadyMarked` boolean.** *Chosen* — the route
     already does the projection work; passing the derived boolean keeps
     the button presentational and the hook focused on wire dispatch.

5. **No `captureStore` / shared in-progress state.** The axiom-mark
   action has no text input, no classification picker, no target-and-role
   chip; there is no shared in-progress state to coordinate. The hook's
   per-`nodeId` Zustand slice owns the in-flight + error state locally.
   Same posture `mod_axiom_mark_action` Decision §5 adopted.

6. **Pessimistic-wait, not optimistic.** The mark only becomes visible in
   the panel's attribution section after the `event-applied` broadcast
   lands and the projector picks up the new proposal + commit pair. The
   button's in-flight state covers the gap between click and broadcast
   (`data-axiom-mark-state="in-flight"`); no optimistic insertion into
   the `axiomMarkIndex`. Mirrors `useVoteAction` /
   `useWithdrawAgreementAction`.

7. **Inline error region, not a page-level toast.** The error region
   lives directly under the button with `role="alert"` for
   screen-reader announcement. Mirrors `useWithdrawAgreementAction`'s
   per-row error surface; same anti-toast posture
   `mod_axiom_mark_action` Decision §7 adopted (the moderator console
   has no global toast surface yet; introducing one for this leaf would
   over-scope).

8. **i18n keys live under `participant.axiomMarkButton.*` + one new
   `participant.detailPanel.sectionTitle.markAxiom`.** The
   `participant.axiomMarkButton` namespace is new (the moderator's
   `moderator.axiomMarkAction` namespace was for a submenu; the
   participant's surface is a single button — different shape, separate
   namespace). The section-title key lives under the existing
   `participant.detailPanel.sectionTitle` namespace alongside the
   other section headings (`facets`, `axiomMarks`, `annotations`,
   `diagnostics`, `ownVote`, `otherVotes`).

9. **YAGNI on `@a-conversa/shell` extraction.** The hook + button stay
   participant-only; the moderator has its own `useAxiomMarkAction`
   (with the composite-key keying for the submenu surface). The two
   hooks are intentionally separate — they handle different surface
   shapes (single-button vs submenu) and different keying. The
   "promote on the third caller" rule applies; if the audience surface
   ever gains an axiom-mark gesture, the extraction trigger fires.

10. **`part_axiom_mark_proposal` is structurally absorbed by this task.**
    The sibling 0.5d task `part_axiom_mark_proposal` (Send axiom-mark
    proposal) was originally planned as the wire-dispatch step on top of
    `part_mark_axiom_action`'s UI button. In practice the moderator-side
    template (`mod_axiom_mark_action`) and the established
    `useVoteAction` / `useWithdrawAgreementAction` patterns all bundle
    the wire dispatch into the same hook as the UI affordance — splitting
    them would create an orphan UI-only commit that doesn't actually
    propose anything. The implementer should land both halves under this
    refinement.

    Options for the sibling's disposition (the **closer** decides; this
    refinement does NOT touch `.tji`):

    - **(a) Mark `part_axiom_mark_proposal` complete-via-absorption** —
      `complete 100` + a refinement stub at
      `tasks/refinements/participant-ui/part_axiom_mark_proposal.md`
      noting it was absorbed by `part_mark_axiom_action`.
    - **(b) Repurpose `part_axiom_mark_proposal` as the Playwright e2e
      cover** — scope a single `test()` block in
      `tests/e2e/participant-methodology-flow.spec.ts` that drives
      Phase 7.1 (tap a node → click the mark button → assert the
      `proposal` event with `kind: 'axiom-mark'` lands on
      `useWsStore.sessionState[sid].events`). The selector contract is
      already locked by this refinement.

    Decision §10's recommendation is **(b)** — the e2e cover is real
    work, the existing Phase 7.1 selector contract is the natural anchor,
    and the 0.5d effort budget matches the cover-only scope.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- Added `apps/participant/src/detail/ParticipantAxiomMarkButton.test.tsx` (new): 11 Vitest cases covering selector contract (`data-testid="participant-axiom-mark-button"` + `data-node-id`), `alreadyMarked` suppression (returns `null`), click → `markAsAxiom` dispatch (mocked hook), in-flight visual transitions (`data-axiom-mark-state`, `disabled`, `aria-disabled`, `inFlightLabel`), inline wire-error region (timeout vs non-timeout interpolation, `role="alert"`, `errorRoleLabel`), and en-US catalog snapshot for section heading + button label + ariaLabel.
- Implementation (hook, button, route wire-up, hook tests, en-US/pt-BR/es-419 catalogs) was shipped in commit `60feb8a` under the umbrella `part_axiom_mark` refinement; this task closes the test-coverage gap on the button component specifically.
- `part_axiom_mark_proposal` (sibling 0.5d task) repurposed as Playwright e2e cover per Decision §10 option (b) — Phase 7.1 of `tests/e2e/participant-methodology-flow.spec.ts` already targets `[data-testid="participant-axiom-mark-button"][data-node-id]`; the selector contract is locked.
- Tech-debt task `i18n_axiom_mark_button_native_review` (0.5d) registered in `tasks/35-frontend-i18n.tji`, chained off `i18n_participant_my_agreements_native_review`, to cover the pt-BR / es-419 PENDING drafts for the seven new `participant.axiomMarkButton.*` + `participant.detailPanel.sectionTitle.markAxiom` keys from commit `60feb8a`.
