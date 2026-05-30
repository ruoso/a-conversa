# 0030 — Per-facet vote keying and sequential capture

- **Date**: 2026-05-23
- **Status**: Accepted

## Context

[ADR 0027](0027-entity-and-facet-layers-strict-separation.md) drew the line between the entity layer (structural facts: an entity exists in the graph) and the facet layer (agreement state on each of an entity's facets). The runtime change that ADR landed moved structural events to propose-time so a proposed node appears on the canvas immediately. But the *facet layer* was left in its original shape: votes, commits, and meta-disagreement marks are still keyed by `proposalId`, and the proposal kinds still bundle "create the entity" with "name a candidate value for one of its facets."

That shape contradicts the sequential capture methodology specified in [`docs/methodology.md`](../../docs/methodology.md). The worked example at L88 is explicit:

> Anna says "zoos do more good than harm." Maria proposes a node N1 with that wording → wording facet `proposed`. Everyone agrees the wording is faithful → wording facet `agreed`. Maria proposes classification `normative` → classification facet `proposed`. Everyone agrees → classification facet `agreed`. The substance facet is still `proposed` and gets engaged later …

Three facets, three independently captured sequential proposals. The implementation, by contrast, binds capture-of-wording, naming-of-classification, and the substance lifecycle to a single bundled gesture: today the capture pane mints both a node and a classification proposal in one shot, and the wording facet has no vote affordance at all until somebody proposes an `edit-wording` against it. Per [`apps/participant/src/detail/ParticipantVoteButtons.tsx:146`](../../apps/participant/src/detail/ParticipantVoteButtons.tsx) (`proposalFacetTarget`), participant votes route through whichever proposal happens to exist on a facet — so a freshly captured node whose wording nobody has proposed an edit against is *voteless* on its wording facet, exactly the facet the methodology says is captured first.

The deeper diagnosis: the facet layer's identity is the pair `(entity, facet)`, not the proposal that last touched it. Today's `vote { proposal_event_id, participant, vote }` envelope per [ADR 0021](0021-event-envelope-discriminated-union-with-zod.md) and the matching `commit { proposal_event_id }` and `meta-disagreement-marked { proposal_event_id }` envelopes encode the agreement state as a property of *the proposal* — but the methodology treats it as a property of *the facet*, with proposals being the moves that name new candidate values for it. Two proposals against the same facet in sequence should clear votes (the candidate changed), but the proposal-keyed wire shape makes that an artificial second-order rule rather than a direct read of the data.

The same conflation explains the `propose-wording` shape: there is no such proposal kind today because the wording's initial candidate value is *already* what the node was captured with. Forcing a synthetic propose-wording proposal at `node-created` time would just rename the bundle. The cleaner expression of ADR 0027's principle is that wording is an entity-layer concern: it ships inline on `node-created`, the same way edge endpoints ship inline on `edge-created`. The facet layer then tracks agreement against that inline value, and only mints a proposal when somebody wants to *change* it (`edit-wording.reword` for a candidate swap, `edit-wording.restructure` for a fresh node id).

The structural proposal kinds (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) are different: they don't "set a facet value." Decomposing a node is a structural move whose agreement is the move itself, not a candidate value on any single facet. The existing proposal-keyed vote/commit envelope fits these naturally and there's no value in synthesizing a fake facet to host their votes.

This ADR settles how the facet layer's wire shape changes to track the methodology, and where the two patterns coexist.

## Decision

**Votes, commits, and meta-disagreement marks against facet-valued proposals are keyed by `(entity_kind, entity_id, facet)`. Wording and edge shape live inline on the entity-creation event. Each new proposal targeting a facet resets prior per-participant votes on it. The server refuses out-of-sequence facet proposals at the wire. Structural proposals retain their existing proposal-keyed envelope; the two patterns coexist by design.**

Concrete decisions:

1. **Capture is sequential and per-facet.** The methodology's wording → classification → substance order (and edge shape → edge substance) is reflected in the wire: capturing a node is a single gesture that emits `node-created` with the inline wording; classifying that node is a *separate* later `classify-node` proposal; setting its substance is a *third* later `set-node-substance` proposal. The bundled "capture + classify" gesture is removed. The capture pane keeps only the wording textarea + a propose button; classification and substance affordances live on the moderator's per-node card alongside their participant-facing facet rows.

2. **`vote` / `commit` / `meta-disagreement-marked` envelopes are `(entity, facet)`-keyed.** The payloads become `{ entity_kind, entity_id, facet, choice, … }` (votes) and `{ entity_kind, entity_id, facet, … }` (commit and meta-mark). The `proposal_event_id` / `proposal_id` field is removed from these envelopes for facet-valued proposals. The facet itself is the identity the agreement-state machine reads against; the latest proposal targeting that facet supplies the candidate value the votes attach to.

3. **New event kind: `withdraw-agreement`.** Withdraw is no longer a `choice` variant on `vote`; it is a first-class event kind with payload `{ entity_kind, entity_id, facet, participant }`. The current `vote.choice = 'withdraw'` shape conflated two distinct gestures (changing your most-recent vote vs. rescinding a previously-committed agreement); the methodology's withdraw at [`docs/methodology.md:25`](../../docs/methodology.md) is the second, and it sends the facet back to `disputed`. Promoting it to its own event makes that transition a direct read of the log rather than a derivation.

4. **Wording lives inline on `node-created`.** `node-created.wording` carries the captured text; the wording facet enters life with that value as its candidate. No `propose-wording` kind. An `edit-wording.reword` proposal later sets a new candidate value on the wording facet (votes reset, the new value supersedes the inline one on agreement). An `edit-wording.restructure` proposal mints a new node id with its own inline wording per the existing semantics in [`docs/data-model.md:251`](../../docs/data-model.md).

5. **Edge shape lives inline on `edge-created`.** `edge-created` carries the role and endpoints; the shape facet enters life with that value as its candidate. No `propose-edge-shape` kind. (v1 has no edge-shape-edit proposal kind, matching the comment at [`apps/server/src/projection/facet-status.ts:67`](../../apps/server/src/projection/facet-status.ts); if a future feature adds one, it follows the wording model.)

6. **Per-facet proposal kinds set candidate values; they don't own votes.** `classify-node`, `set-node-substance`, `set-edge-substance`, and `edit-wording` continue to exist — they're the moves a moderator makes to *name a candidate value* on the corresponding facet. After this ADR, that's the whole of their job: the votes against that candidate attach to the `(entity, facet)` pair, not to the proposal's event id. Two `classify-node` proposals against the same node in sequence are two successive candidate values on the same `classification` facet; the vote state is read off that facet, not off whichever proposal happens to be live.

7. **Each new candidate clears prior votes on the facet.** When a proposal sets a new candidate value on a facet, the per-participant vote map for that facet is cleared. The old votes were votes against the *old* candidate; the methodology treats the new candidate as a fresh proposal that needs fresh agreement. The reset is performed by the projection when it walks the proposal event; it does not need its own event kind.

8. **The server enforces the sequence at the wire.** The propose handler refuses a `classify-node` proposal while the target node's `wording` facet is not `agreed` (or `committed`); refuses a `set-node-substance` while `classification` is not `agreed`; refuses a `set-edge-substance` while the edge's `shape` facet is not `agreed`. The refusal is a typed `error` envelope (per the existing wire error pattern), not a UI hide — UI hides are correct UX but cannot be the integrity boundary, because a misbehaving client (or a stale moderator session, or a future automation) must not be able to land out-of-sequence facet proposals.

9. **Structural proposals stay proposal-keyed (mixed model, by design).** `decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, and `break-edge` continue to take `proposalId`-keyed votes, commits, and meta-marks. These are *structural moves* whose agreement is the move itself; there is no per-facet candidate value to attach votes to. The current `proposalFacetTarget` path in `ParticipantVoteButtons.tsx` that routes structural-proposal votes through a synthetic `'proposal'` facet stays — it's the right shape for these. The two patterns coexist:

   - **Facet-valued proposals** (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`) — votes / commits / meta-marks keyed by `(entity, facet)`. Inline wording on `node-created` and inline shape on `edge-created` enter the same facet-keyed world without needing a proposal at all.
   - **Structural proposals** (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) — votes / commits / meta-marks keyed by `proposalId`.

   This split is explicit, not a transitional accident. Future readers deciding where a new proposal kind belongs ask: does it name a candidate value on a single facet of an existing entity? If yes, facet-keyed. Otherwise, proposal-keyed.

10. **New `FacetStatus` value: `awaiting-proposal`.** The existing six-value enum (`proposed | agreed | disputed | committed | withdrawn | meta-disagreement`) at [`apps/server/src/projection/facet-status.ts`](../../apps/server/src/projection/facet-status.ts) and its moderator mirror at [`apps/moderator/src/graph/facetStatus.ts`](../../apps/moderator/src/graph/facetStatus.ts) grows a seventh: `awaiting-proposal`. It applies when the entity exists but no candidate value has been set for that facet yet — most commonly a freshly captured node's `classification` and `substance` facets, before the moderator has run a `classify-node` / `set-node-substance` gesture against them. The participant detail panel renders an empty-state row for `awaiting-proposal` facets (with no vote buttons); the moderator-side facet card surfaces the affordance to propose a candidate. This is distinct from `proposed`, which means "a candidate has been set and is gathering votes."

Alternatives considered and rejected:

- **Bundle all three facets at capture (status quo).** Rejected — directly contradicts the worked example at [`docs/methodology.md:88`](../../docs/methodology.md), which describes three sequential gestures by Maria with agreement between each. The bundled gesture is what produces the voteless-wording-facet bug; preserving it would force the facet-keyed vote model to special-case wording-with-no-proposal forever.

- **Server-synthesizes a `propose-wording` proposal alongside `node-created`.** Rejected — this just renames the bundle. It would keep the proposal-keyed vote model alive and conflate "proposed *change*" with "initial value." The whole point of ADR 0027's split is that the entity layer carries structural facts; the captured wording *is* a structural fact about the node (what was captured), distinct from whether participants subsequently agree the wording is faithful. Inline wording is the cleanest expression of that.

- **Keep votes proposal-keyed and accept that wording has no votes until edit-wording.** Rejected — this is exactly the bug we're fixing. The wording facet is supposed to be the *first* thing the methodology agrees on (per [`docs/methodology.md:88`](../../docs/methodology.md)); leaving it voteless from capture until somebody disagrees enough to mint an `edit-wording` is the inverse of the methodology.

- **Make all proposals facet-keyed, including structural ones.** Considered. Rejected for the structural proposals because there's no natural `(entity, facet)` pair to key against: `decompose` replaces one node with N components plus M edges, `interpretive-split` mints multiple reading variants, `meta-move` reframes scope. Synthesizing a `'proposal'` facet on the parent entity (as the current `proposalFacetTarget` does for the participant vote UI) is fine as a *UI lookup*, but using it as the wire-level key would erase the proposal-id audit trail for moves that genuinely are about the proposal itself, not about a single facet. The mixed model honors what each proposal kind actually is.

## Consequences

- **This is a breaking wire change.** The `vote`, `commit`, and `meta-disagreement-marked` payload shapes change for facet-valued proposals; `withdraw-agreement` is a new event kind; the `eventKinds` registry, the SQL `CHECK` at [`apps/server/migrations/0010_session_events.sql`](../../apps/server/migrations/0010_session_events.sql), and the Zod payload schemas in [`packages/shared-types/src/events.ts`](../../packages/shared-types/src/events.ts) all change. Migration is a **clean break**: the project is pre-release, existing dev/test session logs are dropped, no production data exists to preserve. A forward-only SQL migration per [ADR 0020](0020-migrations-node-pg-migrate-forward-only.md) adds `withdraw-agreement` to the kinds list; old payload shapes don't need to be readable.

- **`FacetStatus` gains `awaiting-proposal`.** The enum at [`apps/server/src/projection/facet-status.ts`](../../apps/server/src/projection/facet-status.ts), the moderator mirror at [`apps/moderator/src/graph/facetStatus.ts`](../../apps/moderator/src/graph/facetStatus.ts), and the participant mirror at `apps/participant/src/graph/facetStatus.ts` all grow the seventh value. Exhaustive `switch`es in consumers (per the `noFallthroughCasesInSwitch` + `never` default pattern from ADR 0021) become compile errors until they handle it; the missing case is the surface that needs to surface the empty-state row.

- **Moderator capture pane simplifies; per-node classification + substance affordances move to the node card.** The current bottom-strip classification palette is removed. The capture pane keeps only the wording textarea + propose button — that's the wording-on-`node-created` gesture. The classification proposal and the substance proposal each have their own affordance on the moderator's node card, alongside the participant-visible facet row that displays the current candidate (if any) and its vote state. Detailed UI shape is the moderator-ui doc task downstream; the principle here is "capture is one gesture per facet, in methodology order."

- **Participant detail panel renders all three facet rows per node (two per edge).** A node's panel always shows wording, classification, and substance rows; an edge's panel always shows shape and substance. The row's content depends on the facet's status:
  - `awaiting-proposal` — empty-state text, no vote buttons.
  - `proposed` / `disputed` — current candidate value, agree/dispute buttons.
  - `agreed` / `committed` — current value, withdraw button (the gesture that emits `withdraw-agreement`).
  - `meta-disagreement` — both candidate values side by side; no vote buttons.
  - `withdrawn` — current value, the facet is back in dispute; agree/dispute buttons.

- **Sequence enforcement is wire-level.** The propose handler grows a precondition check before emitting the proposal: target facet's predecessor facet must be at `agreed` or `committed`. Out-of-sequence proposals are refused with a typed `error` envelope (per the existing `ws_error_message` shape; the connection stays open per the ADR 0029 invariant). The UI hides the affordance in the same case, but the server is the integrity boundary.

- **`proposalFacetTarget` in [`ParticipantVoteButtons.tsx:146`](../../apps/participant/src/detail/ParticipantVoteButtons.tsx) splits.** Facet-valued proposals (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`, `amend-node`) no longer need to look up the proposal at all to render the vote row — the row exists for every facet of every entity, hanging off the facet, and the row reads its candidate value off the projection. Structural proposals (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) continue to use the proposal-keyed `'proposal'` facet synthesis the function performs today. The function shrinks to just the structural branches.

- **Vote-reset-on-new-candidate becomes a projection rule.** When the projection walks a new facet-valued proposal event, it clears the prior `perParticipant` vote map on that facet before recording any subsequent votes against the new candidate. The committed marker (`committedProposalEventId`) is no longer the right shape for facet-keyed flow — what the projection tracks is "has this facet's *current candidate value* been committed?" rather than "has this specific proposal id been committed?". The data structure in [`apps/server/src/projection/types.ts`](../../apps/server/src/projection/types.ts) and the parallel structure in `apps/moderator/src/graph/facetStatus.ts` change accordingly; the seven derivation rules in `deriveFacetStatus` stay shape-wise the same but read off the new fields.

- **The `withdraw` choice on `vote` is removed.** The existing three-way `'agree' | 'dispute' | 'withdraw'` choice on `vote` collapses to two: `'agree' | 'dispute'`. Withdraw is its own event kind. The Cucumber scenarios that exercise withdraw via `vote { choice: 'withdraw' }` are rewritten against `withdraw-agreement`.

- **e2e validation lands downstream.** The methodology-full-flow Playwright spec at `tests/e2e/` (the same one ADR 0027 referenced as its validation surface) is the canonical exercise of the sequential capture flow and the new envelope shapes. The downstream WBS task that lands the runtime change amends that spec; this ADR does not pre-write the validation, in keeping with [ADR 0022](0022-no-throwaway-verifications.md)'s discipline.

## Amendments

### 2026-05-30 — `amend-node` is structural, not facet-valued

The decision body above (the `proposalFacetTarget` bullet) lists `amend-node`
among the facet-valued proposal sub-kinds. That listing is **stale**. As the
methodology engine landed, `amend-node` was classified as **structural**
(proposal-keyed), alongside `axiom-mark` / `meta-move` / `break-edge` /
`annotate` — it has no facet target. The canonical implementation reflects this
consistently:

- Server broadcast — [`apps/server/src/ws/broadcast/proposal-status.ts`](../../apps/server/src/ws/broadcast/proposal-status.ts) (`facetTargetsForProposal` returns `[]` for `amend-node`).
- Replay projector — [`apps/server/src/projection/replay.ts`](../../apps/server/src/projection/replay.ts) (`facetTargetsForReplay` lists `amend-node` among the purely-structural sub-kinds).
- Methodology spec — [`tests/behavior/methodology/vote-facet-keyed.feature`](../../tests/behavior/methodology/vote-facet-keyed.feature) (votes against `amend-node` use `target: 'proposal'`, keyed by `proposal_id`).

The client-side projectors were realigned to match by
`data_and_methodology.align_vote_facet_target_vocabulary` (done 2026-05-28),
which registered this amendment as follow-up. Read the facet-valued enumeration
above as the four sub-kinds `classify-node` / `set-node-substance` /
`set-edge-substance` / `edit-wording` only; `amend-node` belongs in the
structural list.
