# Align the per-facet vote-projector vocabulary across moderator + participant

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.align_vote_facet_target_vocabulary` (lines 387-402).
**Effort estimate**: 0.5d (WBS budget — the alignment edits are small; the deliverable's bulk is the Cucumber pin + symmetric Vitest extensions per ADR 0022).

## Inherited dependencies

- `shell_package.extract_votes_by_facet_projector` (settled 2026-05-28 — [`tasks/refinements/shell-package/extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md)). **Source of debt** (Decision §1 + §4 there). The audit surfaced the proposal-kind vocabulary divergence between [`apps/moderator/src/graph/selectors.ts:517-535`](../../../apps/moderator/src/graph/selectors.ts#L517) and [`apps/participant/src/proposals/otherVotesByFacet.ts:31-46`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L31) and registered this task as the methodology-side resolution. The shell-extract follow-up (`shell_package.extract_votes_by_facet_projector_v2`) waits on this task **and** an audience caller before firing. This refinement closes precondition (1) of that future lift.
- Prose-only context (NOT a `.tji` edge): [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). Authority for the facet-valued vs structural partition at the wire level. §2 (the `target`-discriminated vote payload union — `'facet'` arm vs `'proposal'` arm) and §9 (commit / meta-disagreement-marked symmetry) settle which proposal sub-kinds carry facet-keyed votes vs proposal-keyed votes. The dispatcher this refinement aligns is the **client-side proposal-id → (entity, facet) lookup** the projectors use to resolve `target: 'proposal'` votes back to a per-(entity, facet) bucket — that lookup must agree with the wire-level partition. Note: ADR 0030 line 82 lists `amend-node` alongside `edit-wording` in its "facet-valued proposals" enumeration; the per-facet-refactor stream's implementation refinements ([`pf_commit_handler_facet_keyed.md` line 58](../per-facet-refactor/pf_commit_handler_facet_keyed.md), `vote-facet-keyed.feature` lines 5-11, [`apps/server/src/ws/broadcast/proposal-status.ts:43-56`](../../../apps/server/src/ws/broadcast/proposal-status.ts#L43), [`apps/server/src/projection/replay.ts:682`](../../../apps/server/src/projection/replay.ts#L682)) consistently classified `amend-node` as **structural** (proposal-keyed). The implementation is canonical; the ADR line is stale and the closer flags an ADR 0030 amendment-pass in Decision §5.
- Prose-only context (NOT a `.tji` edge): `data_and_methodology.methodology_engine.amend_node_logic` (settled 2026-05-10 — [`tasks/refinements/data-and-methodology/amend_node_logic.md`](amend_node_logic.md)). Establishes amend-node as the **contradiction-resolution path** distinct from `edit-wording(reword)`: same structural effect on commit, different intent and different rule-4 propose-side gate (node must be party to an agreed `contradicts` edge). The methodology distinction is what makes amend-node a *proposal-level* decision ("we agree to resolve THIS contradiction via THIS amendment") rather than a *candidate-value* decision on the wording facet — the structural classification follows from that. Cited in Decision §2.
- Prose-only context (NOT a `.tji` edge): `data_and_methodology.event_types.proposal_events` (settled — `proposals.ts` schema). Authority for `capture-node`'s voteless-by-design status: the schema-side commentary at [`packages/shared-types/src/events/proposals.ts:111-116`](../../../packages/shared-types/src/events/proposals.ts#L111) states verbatim: *"votes against a capture-node proposal aren't a thing (the gesture has no facet candidate to agree on), so vote / commit / meta-disagreement handlers route via their existing default branches (no facet target) and reject any vote attempt against a capture-node proposal as 'structural'."* Cited in Decision §3.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_other_vote_indicators` (settled — [`tasks/refinements/participant-ui/part_other_vote_indicators.md`](../participant-ui/part_other_vote_indicators.md)). Established the participant's `OtherVotesByFacetIndex` `ReadonlyMap` shape + the self-filter-at-insertion posture. The vocabulary in `facetTargetOf` was authored by porting the moderator's `voteTargetOf` *with errors* (capture-node added, amend-node omitted); the alignment task is the first revisit of the dispatcher's contents since that port.
- Prose-only context (NOT a `.tji` edge): ADR 0022 — No throwaway verifications. The Vitest layer (moderator's [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) and participant's [`apps/participant/src/proposals/otherVotesByFacet.test.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.test.ts)) pins each surface's local behavior; the Cucumber pin at the cross-surface seam is what this task adds.

## What this task is

Land a single, canonical proposal-kind → facet-target vocabulary in both client-side per-facet vote projectors so the same proposal in the same session log produces the same per-(entity, facet) vote bucket on either surface. Today the two helpers disagree:

- The moderator's [`voteTargetOf`](../../../apps/moderator/src/graph/selectors.ts#L517) handles five kinds: `classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`, **`amend-node`** → `(node, wording)`. It omits `capture-node`.
- The participant's [`facetTargetOf`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L31) handles five kinds: `capture-node` → `(node, wording)`, `classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`. It omits `amend-node`.

The shared kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`) project identically and are not in question. The divergent kinds are:

- **`capture-node`** — participant maps to `(node, wording)`; moderator omits.
- **`amend-node`** — moderator maps to `(node, wording)`; participant omits.

The methodology question is: should the dispatcher handle these two kinds at all, and if so, with what target? The chosen vocabulary (Decision §1) is the **canonical facet-valued partition** the rest of the codebase already converged on: four kinds → `(entity, facet)`; all other seven → `null`. Both helpers reduce to byte-identical vocabularies after the alignment.

| Sub-kind | Pre-alignment moderator | Pre-alignment participant | Post-alignment (both) |
|----------|-------------------------|---------------------------|-----------------------|
| `classify-node` | `(node, classification)` | `(node, classification)` | `(node, classification)` |
| `set-node-substance` | `(node, substance)` | `(node, substance)` | `(node, substance)` |
| `set-edge-substance` | `(edge, substance)` | `(edge, substance)` | `(edge, substance)` |
| `edit-wording` | `(node, wording)` | `(node, wording)` | `(node, wording)` |
| `capture-node` | `null` | `(node, wording)` | `null` *(removed from participant)* |
| `amend-node` | `(node, wording)` | `null` | `null` *(removed from moderator)* |
| `decompose` / `interpretive-split` / `axiom-mark` / `meta-move` / `break-edge` / `annotate` | `null` | `null` | `null` |

The alignment is a **bug fix**, not a behavior expansion. The participant's `capture-node` arm is dead code (no `target: 'proposal'` vote envelope ever names a capture-node proposal_id — the schema rejects votes against capture-node as "structural" per `proposals.ts:111-116`; wording-facet votes that follow a capture arrive on the `target: 'facet'` arm and are already routed through the projector's facet-arm branch at [`otherVotesByFacet.ts:80-83`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L80) without consulting the dispatcher). The moderator's `amend-node` arm is **wrong**: amend-node is a structural sub-kind per the canonical pf_* refactor stream ([`pf_commit_handler_facet_keyed.md:58`](../per-facet-refactor/pf_commit_handler_facet_keyed.md) + `vote-facet-keyed.feature:11`), its votes arrive on `target: 'proposal'`, and the projection's per-proposal-id bucket [`projectVotesByProposal`](../../../apps/moderator/src/graph/selectors.ts#L651) is where those votes belong — the per-(entity, facet) bucket is the wrong surface and conflates amend-node's contradiction-resolution semantics with routine wording-facet candidate votes.

After this task:

- Both client dispatchers handle the same four facet-valued sub-kinds (no more, no less).
- The participant's misleading "Mirrors the moderator's `projectVotesByFacet` verbatim except for the self-filter" header comment ([`otherVotesByFacet.ts:48-58`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L48)) becomes accurate.
- A Cucumber scenario at the cross-surface seam pins the alignment: given an event log with one `amend-node` proposal + a vote against it AND one `capture-node` proposal + (its inline `node-created`) + a `target: 'facet'` wording-arm vote, both projectors agree on the per-(entity, facet) bucket contents — the `amend-node` vote lands in NEITHER projector's facet bucket (it's structural; proposal-keyed); the wording vote following capture lands in BOTH projectors' `(node, wording)` bucket via the facet arm.
- `shell_package.extract_votes_by_facet_projector_v2`'s precondition (1) is satisfied; that future leaf's other precondition (audience caller) remains open and unchanged.

Out of scope (explicitly NOT done here):

- **Editing ADR 0030 line 82's text.** The amend-node listing in the "facet-valued proposals" enumeration is stale relative to the implementation; the canonical implementation chose structural. An ADR amendment-pass is warranted (Decision §5 names it) but the edit itself is the closer's call — the brief allows ADR writes, and a one-line `## Amendments` append is the minimum-scope fix. If the closer judges the amendment in-scope for this task, the append lands here; otherwise it's registered as `data_and_methodology.adr_0030_amendment_amend_node_structural` (0.1d).
- **Moderator's `proposalFacets.ts:123-159` dispatcher** (the sidebar breakdown row's `facetTargetOf`). That helper answers a **different** question — "for this pending proposal, which facet's status chip do I render in the breakdown row?" — and maps `capture-node → (node, wording)` as a UI-display affordance (the breakdown chip shows "wording: proposed" for a pending capture-node). The vote-projection dispatcher answers "for a `target: 'proposal'` vote with this proposal_id, which (entity, facet) bucket does it land in?" — and capture-node has no such vote. Different concerns, different partitions allowed. The breakdown-row helper is left alone; cross-helper consistency within the moderator surface is a separate concern downstream of this task (Open Questions §1).
- **Removing the participant's `EMPTY_OTHER_VOTES_BY_FACET_INDEX` constant** or other shell-extract preparation. The lift (`shell_package.extract_votes_by_facet_projector_v2`) waits on its own audience-caller precondition and decides the final shape; this task does not pre-empt it.
- **Server-side broadcast / `deriveFacetStatus` changes.** The server's per-proposal-status broadcast at [`apps/server/src/ws/broadcast/proposal-status.ts:43-56`](../../../apps/server/src/ws/broadcast/proposal-status.ts#L43) already excludes `amend-node` and `capture-node` from facet-valued; no server change is needed to align with the chosen vocabulary. The server is the truth source; this task aligns the clients to it.
- **`projectVotesByProposal` callers.** The moderator already has a working per-proposal-id projection ([`selectors.ts:651`](../../../apps/moderator/src/graph/selectors.ts#L651)) that is the correct home for `target: 'proposal'` votes against structural sub-kinds — including `amend-node`. This task does not add a new projector; it removes one mistakenly-included case from `voteTargetOf`. Whether the moderator's UI surfaces amend-node votes via `projectVotesByProposal` today is downstream of this task (the per-proposal vote display is a moderator-UI concern, not a methodology one); the alignment itself is correct independent of that question.

## Why it needs to be done

Without this alignment, the same event log produces different per-(entity, facet) vote buckets depending on which surface runs the projector. Two concrete observable consequences:

1. **A `target: 'proposal'` vote against an `amend-node` proposal** (which the server emits per `pf_commit_handler_facet_keyed.md:58` — amend-node is structural, proposal-keyed): the moderator's `projectVotesByFacet` resolves the proposal_id via `voteTargetOf(amend-node) → (node, wording)` and pushes the vote into the wording-facet bucket. The participant's `projectOtherVotesByFacet` resolves the proposal_id via `facetTargetOf(amend-node) → null` and silently drops the vote. Two surfaces, two answers, same vote event. Per [`amend_node_logic.md`](amend_node_logic.md) Decisions §1–§2 the moderator's mapping is semantically wrong — amend-node is the contradiction-resolution methodology operation, not a candidate-value-on-wording operation. The right home for those votes is the per-proposal-id bucket (`projectVotesByProposal` exists on the moderator side and is silent on the participant; that's a separate orthogonal gap, not in this task's scope).

2. **A `target: 'facet'` wording-arm vote after a `capture-node` proposal** (the canonical post-capture wording vote per ADR 0030 §1 + the schema's "leaving the wording facet voteless from capture until somebody disagrees enough to mint an edit-wording is the inverse of the methodology" rationale): both projectors handle this via the facet-arm branch (`event.payload.target === 'facet'`) and reach the `(node, wording)` bucket directly, **bypassing the dispatcher entirely**. The participant's `facetTargetOf(capture-node) → (node, wording)` arm is therefore unreachable by any vote event — it's pure dead code that misleads readers into thinking the participant counts capture-node votes via the proposal arm (which is impossible per the schema). Removal is purely a readability and consistency fix; no behavior changes.

The deeper reason — the misalignment exists at all — is that the two helpers were authored by **independent ports of the same logic at different times**: the moderator's `voteTargetOf` predates the pf_* refactor stream and reflects an earlier model where amend-node could be facet-keyed (matching ADR 0030 line 82's then-current text); the participant's `facetTargetOf` was added by `part_other_vote_indicators` as a "port + filter self" of the moderator's helper but its author guessed wrong on `capture-node` (mapping it to wording for symmetry with the post-capture facet arm) and wrong on `amend-node` (omitting it on the assumption it was structural — which is correct today). Neither helper was re-audited when ADR 0030's enumerations were re-classified across the pf_* stream. The alignment task is that re-audit.

The follow-on benefit:

- **Unblocks `shell_package.extract_votes_by_facet_projector_v2`'s precondition (1).** That future lift cannot proceed while the two surfaces' dispatchers diverge; lifting them into the shell as-is would either fork the projector body (defeating the lift's purpose) or silently expand both surfaces' vote-count behavior (the "vocabulary-union" option rejected as Decision §1, alternative B of [`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md)).
- **Removes dead code + misleading commentary from the participant's projector.** The "verbatim except for the self-filter" header claim becomes accurate.
- **Aligns the client surfaces with the server's truth source.** The server's `deriveFacetStatus` + the proposal-status broadcast already use the chosen partition; the clients catch up.
- **Pins the alignment with a regression test at the cross-surface seam.** A Cucumber scenario whose seed log produces the same per-(entity, facet) bucket on both projectors prevents drift; future edits to either dispatcher have to keep the partition aligned to stay green.

## Inputs / context

### ADRs

- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). §2 (vote payload `target`-discriminated union — `'facet'` arm carries `(entity_kind, entity_id, facet)` directly; `'proposal'` arm carries `proposal_id`). §9 (`commit` / `meta-disagreement-marked` symmetry). Line 82 is the stale enumeration listing `amend-node` as facet-valued — flagged for amendment-pass in Decision §5.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest layer pins per surface; the cross-surface seam pin is Cucumber. No throwaway smoke script introduced.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). Structural validation is upstream of the projector; the dispatcher relies on `proposal.kind` being one of the eleven known literals.

### Live code at refinement time

#### Moderator dispatcher to edit

[`apps/moderator/src/graph/selectors.ts:517-535`](../../../apps/moderator/src/graph/selectors.ts#L517):

```typescript
function voteTargetOf(
  proposal: ProposalPayload,
): { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName } | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
    case 'amend-node':                                              // ← line 528: remove
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    default:
      // decompose, interpretive-split, axiom-mark, meta-move,
      // break-edge, annotate — no per-(entity, facet) target.
      return null;
  }
}
```

After alignment: line 528's `case 'amend-node':` falls through to the default branch; the default comment is updated to include `amend-node` and `capture-node` in the structural-/voteless-kind list. Callers: [`GraphCanvasPane.tsx:119, :534`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L119); [`PendingProposalsPane.tsx:64, :633`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L64).

#### Participant dispatcher to edit

[`apps/participant/src/proposals/otherVotesByFacet.ts:31-46`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L31):

```typescript
function facetTargetOf(proposal: ProposalPayload): FacetTarget | null {
  switch (proposal.kind) {
    case 'capture-node':                                            // ← lines 33-34: remove
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    default:
      return null;
  }
}
```

After alignment: lines 33-34 collapse into the default branch; the default branch grows a comment listing the seven kinds (matching the moderator's symmetric list); the header comment at [`otherVotesByFacet.ts:48-58`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L48)'s "verbatim except for the self-filter" claim becomes accurate. Caller: [`PendingProposalsPane.tsx:39, :80`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L39). Public re-export: [`apps/participant/src/proposals/index.ts:34-36`](../../../apps/participant/src/proposals/index.ts#L34).

#### Wire-level authority for the partition

[`apps/server/src/ws/broadcast/proposal-status.ts:43-56`](../../../apps/server/src/ws/broadcast/proposal-status.ts#L43):

```
**Facet-targeting vs. structural proposals.** Of the eleven proposal
sub-kinds in `events/proposals.ts`, six contribute facet targets:

  - `classify-node`         → node.classification (1 target)
  - `set-node-substance`    → node.substance      (1 target)
  - `set-edge-substance`    → edge.substance      (1 target)
  - `edit-wording`          → node.wording        (1 target)
  - `decompose`             → N × node.classification (one per component)
  - `interpretive-split`    → N × node.classification (one per reading)

The remaining five (axiom-mark / meta-move / break-edge / amend-node /
annotate) are structural — they have no facet target and
`deriveFacetStatus` cannot answer for them. The subscriber skips
those: no broadcast.
```

Note `decompose` and `interpretive-split` are facet-targeting at the **server level** with a fan-out shape (N component classification facets). At the **client per-(entity, facet) vote-projection level**, those fan-outs surface as per-component facet entries already keyed by the post-decomposition node ids — votes on those entries arrive via the facet arm (`target: 'facet', entity_id: <component_node_id>, facet: 'classification'`) and never via the proposal-arm. The client dispatcher doesn't need a case for `decompose` / `interpretive-split` because no proposal-arm vote ever names them as facet-valued; the fan-out is server-side. The alignment keeps both clients at the four-kind canonical proposal-arm partition.

[`apps/server/src/projection/replay.ts:682`](../../../apps/server/src/projection/replay.ts#L682) (the projector's structural-arm comment):

```
break-edge, amend-node, annotate) are structural — their per-
```

[`tests/behavior/methodology/vote-facet-keyed.feature:5-11`](../../../tests/behavior/methodology/vote-facet-keyed.feature#L5):

```
#   - `target: 'facet'` — votes against facet-valued proposal sub-
#     kinds (classify-node / set-node-substance / set-edge-substance /
#     edit-wording). Keyed by `(entity_kind, entity_id, facet)`. NO
#     `proposal_id` field.
#   - `target: 'proposal'` — votes against structural proposal sub-
#     kinds (decompose / interpretive-split / axiom-mark / meta-move /
#     break-edge / amend-node / annotate). Keyed by `proposal_id`.
```

Three independent canonical-implementation sources (server broadcast, replay projector, Cucumber feature header) consistently classify `amend-node` as **structural**. ADR 0030 line 82 is the lone holdout listing it as facet-valued.

#### `capture-node`'s voteless-by-design status

[`packages/shared-types/src/events/proposals.ts:111-116`](../../../packages/shared-types/src/events/proposals.ts#L111):

```
// votes against a capture-node proposal aren't a thing (the gesture
// has no facet candidate to agree on), so vote / commit / meta-
// disagreement handlers route via their existing default branches
// (no facet target) and reject any vote attempt against a capture-
// node proposal as 'structural'.
```

The schema's commentary is dispositive: there is no valid `target: 'proposal'` vote event with a capture-node `proposal_id`. The participant's mapping at [`otherVotesByFacet.ts:33-34`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L33) is dead code by construction.

#### Vitest tests to extend

- [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) — nine `projectVotesByFacet` cases at lines 1281, 1299, 1326, 1358, 1391, 1426, 1444, 1469, 1506. Extension: add one case asserting an `amend-node` proposal + a `target: 'proposal'` vote against it produces **NO** entry in the wording-facet bucket (and equally NO entry anywhere — `projectVotesByFacet` cannot bucket it; `projectVotesByProposal` is the correct home).
- [`apps/participant/src/proposals/otherVotesByFacet.test.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.test.ts) — nine cases at lines 124, 133, 144, 155, 167, 179, 188, 198, 207. Extensions: (a) add one case asserting an `amend-node` proposal + a `target: 'proposal'` vote against it produces NO entry (parity with moderator's new case); (b) the participant currently has no test pinning capture-node's no-proposal-arm-vote behavior — add one case asserting a capture-node proposal + an attempt at a `target: 'proposal'` vote against it (a synthetic / shouldn't-happen-in-prod event the projector tolerates by dropping) produces NO entry; (c) add one case asserting a capture-node proposal + a `target: 'facet'` wording-arm vote produces the `(node, wording)` bucket entry via the facet branch (pinning the actual post-capture vote flow). These three new cases pin the alignment from the participant side.

#### Cucumber test layout

- New feature: `tests/behavior/methodology/vote-facet-target-vocabulary.feature` (per Decision §4).
- New step file: `tests/behavior/steps/methodology-vote-facet-target-vocabulary.steps.ts`. Reuses shared step defs from `vote-facet-keyed.steps.ts`, `methodology-engine.steps.ts`, and the `event-rows.ts` row helpers. Distinct UUID prefix (`f7...`) to avoid collisions with sibling step files.

### Prior decisions this task is bound by

- [`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md) Decisions §1, §4 — registered this task with effort + description; Decision §1's three rejected paths (defer / union-vocabulary / parametric-callback) frame this task's scope as the methodology-side resolution that unblocks the shell-extract.
- [`amend_node_logic.md`](amend_node_logic.md) Decisions §1–§2 — amend-node is the contradiction-resolution methodology operation; its votes are about whether to accept this specific repair, not about a candidate value on the wording facet. The structural classification follows from this distinction.
- [`pf_commit_handler_facet_keyed.md`](../per-facet-refactor/pf_commit_handler_facet_keyed.md) line 58 — the canonical authoritative partition: amend-node is structural; commit/meta-disagreement/vote handlers route it through the proposal-keyed arm.
- ADR 0030 §1 — the wording-on-`node-created` inline semantics that make capture-node voteless-as-a-proposal but votable-as-a-facet (wording arm).

## Constraints / requirements

- **Edit ONLY the two dispatcher switch bodies.** No projector body changes (the surrounding accumulator loop in `projectVotesByFacet` / `projectOtherVotesByFacet` stays byte-identical except for the dispatcher's switch cases). No new helper functions, no signature changes.
- **Update the participant's header comment** at [`otherVotesByFacet.ts:48-58`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L48) so the "verbatim except for the self-filter" claim becomes accurate after the dispatcher alignment. No other prose edits to either projector module.
- **Both dispatchers handle exactly four kinds.** After the edits, `voteTargetOf` and `facetTargetOf` are case-for-case identical (modulo the helper's local type alias). The default-branch comment in each is updated to list the seven null-returning kinds (the six the moderator already listed PLUS `capture-node`).
- **No changes to the projector accumulator loops, the `EMPTY_OTHER_VOTES_BY_FACET_INDEX` constant, the `OtherVotesByFacetIndex` type, or the public re-export at [`participant/src/proposals/index.ts:34`](../../../apps/participant/src/proposals/index.ts#L34).** The shell-lift task (`extract_votes_by_facet_projector_v2`) owns those.
- **No changes to `apps/moderator/src/graph/proposalFacets.ts`'s `facetTargetOf`** (the sidebar breakdown-row dispatcher). Different helper, different concern; see Open Questions §1 for the cross-helper consistency follow-up.
- **No changes to server-side code.** The server already uses the canonical partition; aligning the clients is the entire deliverable.
- **No changes to ADR 0030's prose body.** The amendment-pass that corrects line 82's stale `amend-node` listing is registered in Decision §5; if the closer judges it in-scope, a `## Amendments` append is the minimum-scope landing.
- **Vitest extensions per ADR 0022.** Two new cases in the moderator's `selectors.test.ts` (one for the amend-node-as-structural pin; one for capture-node-via-facet-arm parity); three new cases in the participant's `otherVotesByFacet.test.ts` (amend-node no-bucket, capture-node-proposal-arm-attempt no-bucket, capture-node-facet-arm yes-bucket). Existing cases stay green unchanged.
- **One Cucumber scenario at the cross-surface seam.** Single seed log → run BOTH projectors → assert byte-identical per-(entity, facet) bucket maps. The scenario is the methodology-level regression pin per [`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md) Decision §1's "Cucumber scenario pinning the vote-count behavior at the cross-surface seam" requirement.
- **TaskJuggler validity preserved.** The closer's `complete 100` + `note "Refinement: ..."` edits to `tasks/10-data-and-methodology.tji` leave `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Acceptance criteria

- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts): `voteTargetOf`'s switch (lines 520-534) drops the `case 'amend-node':` line so `amend-node` falls through to the default branch; the default-branch comment lists `decompose, interpretive-split, axiom-mark, meta-move, break-edge, annotate, amend-node, capture-node` (eight kinds — the seven non-facet kinds plus the explicit `capture-node` note to match the participant's symmetric comment).
- [`apps/participant/src/proposals/otherVotesByFacet.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.ts): `facetTargetOf`'s switch (lines 32-46) drops the `case 'capture-node':` arm (lines 33-34) so `capture-node` falls through to the default; the default branch gains a comment listing the eight null-returning kinds (matching the moderator's symmetric list). The header comment (lines 48-58) is updated: the "verbatim except for the self-filter" claim becomes accurate; the inaccurate "ported from `apps/moderator/src/graph/selectors.ts:739`" line number (a stale reference — the function is now at line 556) is corrected.
- Post-alignment grep parity: `git diff` shows the same four `case '...':` lines in both files' switches (modulo the helper's local `FacetTarget` type alias on the participant side). The two switch bodies are case-for-case identical.
- [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) gains two new cases:
  - (j) `amend-node` proposal + `target: 'proposal'` vote against it → `projectVotesByFacet` returns an empty map (no `(node, wording)` entry; the vote is structural and belongs in `projectVotesByProposal`). Assertion: `result.size === 0`.
  - (k) `capture-node` proposal + inline `node-created` + `target: 'facet'` wording-arm vote → `projectVotesByFacet` produces a `(node_id, 'wording')` entry containing the voter (parity with the participant's flow; pins that capture-node's wording vote arrives via the facet arm and the dispatcher branch isn't consulted).
- [`apps/participant/src/proposals/otherVotesByFacet.test.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.test.ts) gains three new cases:
  - (j) `amend-node` proposal + `target: 'proposal'` vote against it from a non-self participant → empty map. Symmetric to the moderator's case (j).
  - (k) `capture-node` proposal + a synthetic `target: 'proposal'` vote against it (which production never emits — the server rejects such votes as 'structural'; the projector tolerates by dropping) → empty map. Pins the dispatcher's null-return for `capture-node`.
  - (l) `capture-node` proposal + inline `node-created` + `target: 'facet'` wording-arm vote from a non-self participant → `(node_id, 'wording')` bucket has the voter. Pins the post-capture vote flow.
- `tests/behavior/methodology/vote-facet-target-vocabulary.feature` lands with one scenario:
  - **Cross-surface vote-facet-vocabulary parity at the per-(entity, facet) seam.** Seed: a node `N` plus an edge `E` plus the four facet-valued proposals (one classify-node against `N`, one set-node-substance against `N`, one set-edge-substance against `E`, one edit-wording against `N`), plus an `amend-node` proposal against `N`, plus a `capture-node` proposal that materialized a separate node `N2`. For each facet-valued proposal, a single `target: 'proposal'` vote from `participant-A`. For the amend-node proposal, a single `target: 'proposal'` vote from `participant-A`. For the capture-node, a `target: 'facet'` wording-arm vote on `N2` from `participant-A`. Both projectors (`projectVotesByFacet(events)` and `projectOtherVotesByFacet(events, 'participant-B')`) are run against the same event log. Assert: the per-(entity, facet) bucket sets are equal (modulo the participant's self-filter, which doesn't apply because the voter is `participant-A` and the self id is `participant-B`); specifically, `(N, classification)` / `(N, substance)` / `(E, substance)` / `(N, wording)` / `(N2, wording)` each have one vote in BOTH maps; nothing else; the amend-node vote appears in NEITHER map.
- `tests/behavior/steps/methodology-vote-facet-target-vocabulary.steps.ts` lands with the new step defs. Reuses `tests/behavior/support/event-rows.ts` for row helpers and the shared `Given 'a seeded session with ...'` / `When 'the projectors run against the session event log'` / `Then 'both projectors agree on ...'` step shapes from `vote-facet-keyed.steps.ts` and `methodology-engine.steps.ts`. Distinct UUID prefix (`f7...`) avoids collisions with sibling step files.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `align_vote_facet_target_vocabulary` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green. The existing vitest + cucumber baselines stay green and are extended by this task (+5 vitest cases, +1 cucumber scenario).
- **Deferred coverage**: ADR 0030 amendment-pass (Decision §5). If the closer judges the `## Amendments` append in scope for this task, lands here; otherwise registered as `data_and_methodology.adr_0030_amendment_amend_node_structural` (0.1d, one-line append plus an editorial pass against the prior amendment style). Closer registers in WBS.

## Decisions

### §1 — Choose the canonical facet-valued partition (four kinds); both dispatchers reduce to byte-identical vocabularies

The canonical partition at the wire / projection / commit layers (server broadcast, replay projector, Cucumber feature header, per-facet-refactor stream) consistently classifies four sub-kinds as facet-valued (proposal-arm votes resolve via the dispatcher) and the remaining seven as structural / voteless (no proposal-arm vote-bucketing). The post-alignment vocabulary in BOTH client dispatchers is:

- `classify-node` → `(node, classification)`
- `set-node-substance` → `(node, substance)`
- `set-edge-substance` → `(edge, substance)`
- `edit-wording` → `(node, wording)`
- *all other seven kinds* → `null`

Three options for the vocabulary were considered:

- **(A — chosen)** Adopt the canonical four-kind facet-valued partition. The moderator drops `amend-node`; the participant drops `capture-node`. After alignment both switch bodies are case-for-case identical. **Reasoning**: aligns with the three independent canonical-implementation sources (server broadcast, replay projector, Cucumber feature header) AND with the methodology-engine's structural classification of `amend-node` per [`amend_node_logic.md`](amend_node_logic.md) Decisions §1–§2. Removes dead code (the participant's `capture-node` arm is unreachable per the schema's voteless-by-design rationale; the moderator's `amend-node` arm conflates contradiction-resolution semantics with candidate-value semantics). Costs nothing observable in production today: capture-node votes already arrive via the facet arm (no behavior change); amend-node votes already aren't emitted as `target: 'proposal'` in the moderator's `projectVotesByFacet` pipeline as configured today (the votes against amend-node proposals route through `projectVotesByProposal` on the moderator side; whether the moderator UI surfaces them is a downstream concern). The shell-extract follow-up (`extract_votes_by_facet_projector_v2`) becomes a pure refactor over byte-identical dispatcher bodies.
- **(B)** Adopt a union vocabulary: both surfaces handle six kinds (the four canonical plus `amend-node` AND `capture-node`). Costs: (1) `capture-node` is dead code by the schema's voteless-by-design rationale (no `target: 'proposal'` vote envelope ever names a capture-node `proposal_id`) — adding it on the moderator side replicates the participant's existing dead code rather than removing it; (2) `amend-node` mapping conflates contradiction-resolution methodology with candidate-value-on-wording semantics — adding it on the participant side replicates the moderator's existing semantic bug rather than removing it; (3) silently expands both surfaces' wording-facet vote counts to include amend-node-targeted votes, which is a behavior change masquerading as a refactor (the `extract_facet_status_rules.md` bedrock-divergence framing prohibits this). Rejected. Identical to the [`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md) Decision §1 alternative (B) rejected in the audit.
- **(C)** Adopt a per-surface-native vocabulary: keep each helper's local list (moderator handles amend-node; participant handles capture-node), document the divergence as intentional. Costs: (1) leaves the two projectors disagreeing on the same event log in production — exactly the bug this task exists to fix; (2) blocks the shell-extract follow-up indefinitely (the dispatchers cannot be a single shell-lifted helper while their vocabularies disagree); (3) misaligns both clients with the server's truth-source partition; (4) requires the closer to author *two* Cucumber scenarios pinning the divergence as intentional, which is more code than the alignment fix. Rejected.

Chosen: (A). The methodology-shaped divergence collapses to a single canonical vocabulary; the rest of the codebase already agrees with it.

### §2 — `amend-node` is structural (proposal-keyed), not facet-valued; the moderator's mapping is the bug

The methodology case for treating `amend-node` as structural:

- [`amend_node_logic.md`](amend_node_logic.md) Decisions §1–§2: amend-node is **the contradiction-resolution methodology operation**, gated by rule 4 (node must be party to an agreed `contradicts` edge). The propose-side validator distinguishes it from `edit-wording(reword)` precisely because amend-node is a methodology-driven repair, not a candidate-value-on-wording proposal.
- A vote on an amend-node proposal answers "do we agree to resolve this specific contradiction via this specific amendment?" — a **proposal-level** decision tied to the amend's identity (which contradiction, which amendment text). A vote on the wording facet answers "do we agree this is the right candidate value for this node's wording?" — a **facet-level** decision tied to the candidate value. Conflating them in the same per-(entity, facet) bucket loses the distinction.
- The canonical implementation layers already agree: [`pf_commit_handler_facet_keyed.md`](../per-facet-refactor/pf_commit_handler_facet_keyed.md) line 58, [`apps/server/src/ws/broadcast/proposal-status.ts:43-56`](../../../apps/server/src/ws/broadcast/proposal-status.ts#L43), [`apps/server/src/projection/replay.ts:682`](../../../apps/server/src/projection/replay.ts#L682), [`tests/behavior/methodology/vote-facet-keyed.feature:11`](../../../tests/behavior/methodology/vote-facet-keyed.feature#L11) all classify amend-node as structural / proposal-keyed.
- The wire-level vote payload for an amend-node vote is `{ target: 'proposal', proposal_id: <amend_id>, ... }` per ADR 0030 §2 + §9. The client-side per-proposal-id bucket (`projectVotesByProposal`) is the correct home; the per-(entity, facet) bucket isn't.

The moderator's [`voteTargetOf` line 528](../../../apps/moderator/src/graph/selectors.ts#L528) (`case 'amend-node':` falling through to the wording return) was authored before the pf_* refactor stream landed and reflects an earlier model. It's stale relative to the implementation.

Two options were considered:

- **(A — chosen)** Drop `amend-node` from the moderator's dispatcher; both helpers agree it's structural. Aligns with the four canonical implementation sources cited above + the methodology distinction from `amend_node_logic.md`.
- **(B)** Adopt ADR 0030 line 82's literal text and add `amend-node` to the participant's dispatcher instead (treat amend-node as facet-valued on both sides). Costs: contradicts the four canonical implementation sources; requires server-side and projection-side rework to add `amend-node` to the `target: 'facet'` enumeration in `proposal-status.ts`, the replay projector's facet-broadcast list, the `vote-facet-keyed.feature` comment, the `pf_commit_handler_facet_keyed.md` settled refinement, plus a Cucumber pin against the new behavior. Massively out of scope for a 0.5d alignment task; would re-open the per-facet-refactor stream's settled decisions. Rejected.

Chosen: (A). ADR 0030 line 82 is the outdated artifact; the implementation is the truth source.

### §3 — `capture-node` is voteless-by-design at the proposal arm; the participant's mapping is dead code

The methodology case for treating `capture-node` as voteless at the proposal arm:

- [`packages/shared-types/src/events/proposals.ts:111-116`](../../../packages/shared-types/src/events/proposals.ts#L111) (the schema commentary): *"votes against a capture-node proposal aren't a thing (the gesture has no facet candidate to agree on), so vote / commit / meta-disagreement handlers route via their existing default branches (no facet target) and reject any vote attempt against a capture-node proposal as 'structural'."*
- The wording-facet votes that DO follow a capture arrive on the `target: 'facet'` arm with `entity_id: <captured_node_id>, facet: 'wording'` per ADR 0030 §1's "wording-facet vote arm hangs off the facet, not off the capture proposal" framing. The projector's facet-arm branch at [`otherVotesByFacet.ts:80-83`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L80) (and the moderator's symmetric branch at [`selectors.ts:584-595`](../../../apps/moderator/src/graph/selectors.ts#L584)) handles these directly, **without consulting the dispatcher**.
- The participant's `case 'capture-node':` arm at [`otherVotesByFacet.ts:33-34`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L33) feeds the `proposalTarget` map at [`otherVotesByFacet.ts:71`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L71), which is later consulted ONLY for `target: 'proposal'` votes at line 84. Since no production-emitted vote event ever has `target: 'proposal'` with a capture-node `proposal_id`, the map entry is unreachable by any vote in a real session log.

Three options were considered:

- **(A — chosen)** Drop the participant's `case 'capture-node':` arm. Pure dead-code removal; no behavior change in production (capture-node votes already arrive via the facet arm and reach the same `(node, wording)` bucket). Aligns the participant with the moderator and with the schema's voteless-by-design statement.
- **(B)** Keep the participant's `case 'capture-node':` arm and add it to the moderator's dispatcher too. Costs: replicates dead code across both surfaces; introduces an arm that production never reaches but readers must keep in mind; misaligns with the schema's voteless-by-design statement. Rejected for the same reasons as Decision §1 alternative (B).
- **(C)** Reframe the `case 'capture-node':` arm as a **UI-lookup affordance** (not a vote-projection concern) and factor it into a separate helper. Reasoning: the moderator's `proposalFacets.ts:123-159` already does exactly this — its `facetTargetOf` maps `capture-node → (node, wording)` for the sidebar breakdown-row chip display. The participant has no symmetric "breakdown row" today; its pending-proposal pane uses the vote-projector's lookup directly. A future participant breakdown-row refinement might want a similar lookup helper. Defensible as a forward-looking move but out of scope here: the participant doesn't have the consumer site that would justify the helper yet, and YAGNI applies. Rejected; flagged as Open Questions §2 for the next participant-UI refinement that might create the consumer.

Chosen: (A). Dead-code removal is the right move; the UI-lookup helper question waits for a real consumer.

### §4 — Cucumber pin at the cross-surface seam; per-surface Vitest extensions stay separate

[`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md) Decision §1's "Cucumber scenario pinning the vote-count behavior at the cross-surface seam" requirement is the methodology-level regression pin this task delivers. Three options for the test layout:

- **(A — chosen)** One Cucumber scenario (`vote-facet-target-vocabulary.feature` — single scenario) PLUS per-surface Vitest extensions (two new cases in moderator's `selectors.test.ts`; three new cases in participant's `otherVotesByFacet.test.ts`). Reasoning: Vitest pins each surface's local dispatcher behavior (fast, focused regression on the partition); Cucumber pins the cross-surface seam against the same event log (slow, integration-shaped regression on agreement). The two layers are complementary, not redundant: a future edit to the moderator's dispatcher that breaks the participant alignment would fail the Cucumber pin even if the moderator's Vitest passes (and vice versa).
- **(B)** Vitest only — symmetric cases in both surface tests, no Cucumber. Costs: misses the bedrock-divergence framing — the alignment IS the methodology decision, and methodology-bearing client mirrors get Cucumber pins per `extract_facet_status_rules.md` Decision §1. Also misses the deferred-debt framing from [`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md) which explicitly named "a Cucumber scenario pinning the vote-count behavior at the cross-surface seam" as part of this task's deliverable. Rejected.
- **(C)** Cucumber only — no per-surface Vitest extensions. Costs: leaves each surface's local dispatcher under-pinned at the unit level; loses the regression coverage that ADR 0022 prefers for in-memory pure functions ("Vitest for in-memory logic; Cucumber+pglite for at least one DB-driven scenario"). Rejected.

Chosen: (A). Both layers; each pin's its appropriate level.

The Cucumber scenario's seed log is designed to **maximize coverage with minimum events**: one of each of the four facet-valued proposals against shared entities, one amend-node, one capture-node (with its inline `node-created`), one vote each. The assertion runs both projectors over the same log and compares the per-(entity, facet) bucket sets for equality (modulo the participant's self-filter, which is finessed by choosing a voter id different from the participant's self id). This pins both the alignment AND the projector's accumulator-loop parity in one scenario.

### §5 — Register the ADR 0030 amendment-pass; closer's call on inline vs separate task

ADR 0030 line 82's `amend-node` listing in the "facet-valued proposals" enumeration is stale per the four canonical implementation sources cited in Decision §2. The ADR convention's amendment-pass rule ([`docs/adr/README.md` lines 14-22](../../../docs/adr/README.md#L14)) says: *"When a new ADR changes prior decisions or resolves their open questions, sweep the affected predecessors and append `## Amendments` entries before declaring the new ADR done."*

This task is not a new ADR but it does crystallize the resolution of an open question that was implicit in the pf_* refactor stream's settlement (the stream never amended ADR 0030 to record its narrowing of amend-node's classification). Two options:

- **(A — chosen, conditional)** **If the closer judges the amendment in scope** for this task, append a one-line `## Amendments` entry to ADR 0030 noting: *"2026-MM-DD: `amend-node`'s listing on line 82 as facet-valued was narrowed by the per-facet-refactor stream — see `pf_commit_handler_facet_keyed.md:58` + `apps/server/src/ws/broadcast/proposal-status.ts:43-56` + `tests/behavior/methodology/vote-facet-keyed.feature:5-11` for the canonical structural classification. Aligned in clients by `data_and_methodology.align_vote_facet_target_vocabulary`."* The Decision / Context body of ADR 0030 stays untouched per the immutability rule.
- **(B — fallback)** Register a separate task `data_and_methodology.adr_0030_amendment_amend_node_structural` (0.1d) that lands the amendment-pass in its own commit. Reasoning: amendment-pass commits are easier to review when they're not tangled with the implementation alignment that motivates them; and the amendment-pass mechanic also wants a brief editorial pass to ensure no other stale enumerations exist in ADR 0030 (it has none, but the audit IS the deliverable).

The brief allows ADR writes; the refinement author defaults to (A) and lets the closer choose. If (B), the closer registers in WBS per the tech-debt registration policy.

### §6 — No new RejectionReason; no new dispatcher helper; no per-projector body change

The alignment is a pure switch-case edit. No new helper functions, no new types, no new `RejectionReason` values (this task doesn't touch the methodology engine's reject path — it touches client projectors only). The dispatcher's signature stays the same on both sides; only the case-list contents change. The projector accumulator loops (`projectVotesByFacet` lines 556-648, `projectOtherVotesByFacet` lines 59-125) are byte-identical pre- and post-alignment.

This minimum-scope discipline is what makes the shell-extract follow-up trivial: after the alignment, both dispatchers are case-for-case identical, both projectors share the same loop body, and the lift becomes a verbatim port of one canonical file with a parameterized self-filter shim on the participant side. No vocabulary-union, no callback-shaped indirection — the rejected paths from [`extract_votes_by_facet_projector.md`](../shell-package/extract_votes_by_facet_projector.md) Decision §1 stay rejected.

## Open questions

- **§1 — Moderator's `proposalFacets.ts` cross-helper consistency.** The moderator surface has *two* `facetTargetOf` helpers: this task's vote-projection dispatcher in `selectors.ts` (post-alignment: four canonical kinds → null elsewhere) AND the sidebar-breakdown-row dispatcher in `proposalFacets.ts:123-159` (currently: five kinds including `capture-node → (node, wording)`; `amend-node → null`). The two answer different questions (vote-bucketing vs. breakdown-row chip display) and the partitions can defensibly differ — `capture-node` IS a wording-facet proposal for display purposes even though its votes don't arrive via the proposal arm. But the asymmetry is fragile: a future reader who finds two `facetTargetOf` helpers in the same surface with different switches will reasonably wonder which is right. A small docs pass (a sentence in `proposalFacets.ts`'s header pointing readers at `selectors.ts`'s `voteTargetOf` and explaining the partition difference) would close the gap. Out of scope for this 0.5d task; flagged for a future `moderator_ui` cleanup leaf if any reader hits the confusion.
- **§2 — UI-lookup affordance for participant breakdown rows.** If a future participant-UI refinement adds a sidebar breakdown row mirroring the moderator's `proposalFacets.ts` (a chip per facet a pending proposal targets), it will want a participant-side equivalent of `proposalFacets.ts`'s `facetTargetOf` — and that helper *would* want to map `capture-node → (node, wording)` for display, just as the moderator's does. The right shape is a separately-lifted shell helper (`proposalFacetTarget`) hosted alongside the vote-projection helper in the eventual `packages/shell/src/votes-by-facet/` directory. Decision §3 alternative (C) rejected pre-empting this here; it's a real follow-on but it waits for a real consumer.
- **§3 — Per-proposal-id vote rendering for amend-node on the moderator surface.** Today the moderator's `projectVotesByFacet` includes `amend-node` (about to be removed); its `projectVotesByProposal` ([`selectors.ts:651`](../../../apps/moderator/src/graph/selectors.ts#L651)) is the correct home for amend-node's structural-arm votes. Whether the moderator UI surfaces those votes anywhere today is downstream of this task — if the breakdown row or the pending-proposals pane was relying on `projectVotesByFacet` to render amend-node votes, post-alignment they'll stop appearing there (and the UI should switch to `projectVotesByProposal`). This is a moderator-UI concern, not a methodology one; a follow-on audit (`mod_amend_node_vote_display_audit`, 0.25d) would land any required UI rewires. Likely no-op (the breakdown row uses the synthetic `'proposal'` facet for amend-node per `proposalFacets.ts:147` already, and that arm reads from `votesByProposal` not `votesByFacet`); the audit confirms.

## Status

**Done** — 2026-05-28.

- `apps/moderator/src/graph/selectors.ts` — dropped `case 'amend-node':` from `voteTargetOf`; `amend-node` now falls through to the default (structural) branch; default-branch comment extended to list eight null-returning kinds including `amend-node` and `capture-node`.
- `apps/participant/src/proposals/otherVotesByFacet.ts` — dropped `case 'capture-node':` from `facetTargetOf`; default-branch comment extended to list eight null-returning kinds; corrected stale `selectors.ts:556` line references to `:529` (`voteTargetOf`) and `:571` (`projectVotesByFacet`).
- `apps/moderator/src/graph/selectors.test.ts` — added two new cases: (j) `amend-node` proposal + `target: 'proposal'` vote → empty map; (k) `capture-node` + inline `node-created` + `target: 'facet'` wording vote → `(node, wording)` bucket entry.
- `apps/participant/src/proposals/otherVotesByFacet.test.ts` — added three new cases: (j) `amend-node` no-bucket; (k) `capture-node` proposal-arm synthetic no-bucket; (l) `capture-node` facet-arm yes-bucket.
- `tests/behavior/methodology/vote-facet-target-vocabulary.feature` — new cross-surface seam parity scenario: same seed log, both projectors, assert byte-identical per-(entity, facet) bucket sets.
- `tests/behavior/steps/methodology-vote-facet-target-vocabulary.steps.ts` — new step file (UUID prefix `f7...`) for the vocabulary parity scenario.
- `tests/vite-env.d.ts` — transitive `ImportMeta` augmentation required once the step file's import chain reaches client modules.
- ADR 0030 amendment-pass deferred: `data_and_methodology.adr_0030_amendment_amend_node_structural` registered in WBS (0.1d) per Decision §5 option B.
