# 0038 — Annotations are disputable post-commit via direct substance-facet votes

- **Date**: 2026-06-02
- **Status**: Accepted

## Context

The render seam for a disputed annotation shipped with `mod_meta_move_disputed_visibility` (the `<AnnotationBadge>` rose marker + `data-facet-status="disputed"`, [`apps/moderator/src/graph/AnnotationBadge.tsx`](../../apps/moderator/src/graph/AnnotationBadge.tsx)), and the client-side populator that routes a committed meta-move's votes onto the resulting annotation's `substance` facet shipped with `annotation_facet_status_logic` ([`packages/shell/src/facet-status/facet-status.ts`](../../packages/shell/src/facet-status/facet-status.ts)). Neither could ever produce the `disputed` state: meta-move commit is gated on unanimous agree ([`apps/server/src/methodology/handlers/commit.ts`](../../apps/server/src/methodology/handlers/commit.ts) `checkUnanimousAgreeStructural`), so at the instant an annotation exists every routed vote is `agree`; and no event targets an annotation's facets after creation — `VoteEntityKind = 'node' | 'edge'` ([`apps/participant/src/detail/useVoteAction.ts:75`](../../apps/participant/src/detail/useVoteAction.ts)), `facetVotePayloadSchema.entity_kind = z.enum(['node', 'edge'])` ([`packages/shared-types/src/events.ts:441`](../../packages/shared-types/src/events.ts)), and the engine vote handler's `facetStateForTarget` resolves node/edge only ([`apps/server/src/methodology/handlers/vote.ts:80-103`](../../apps/server/src/methodology/handlers/vote.ts)).

`annotation_facet_status_logic` registered `annotation_facet_vote_seam` to build the missing surface and surfaced an open product question to the parking lot (2026-06-02): *should annotations be disputable post-commit at all?* The `ProjectedAnnotation.substanceFacet: FacetState<'agreed' | 'disputed'>` typing ([`apps/server/src/projection/types.ts:250-261`](../../apps/server/src/projection/types.ts)) implies yes, but no ADR recorded the methodology's intent, and building a seam to a type's incidental shape rather than the intended methodology would be a mistake.

The canonical design docs settle the question:

- [`docs/data-model.md:141`](../../docs/data-model.md): "An annotation has its own owner, content, and the standard facet set (`wording` for the annotation text; `substance` if the annotation makes a substantive claim). Annotations are first-class proposed changes that go through the same agreement lifecycle as nodes and edges. **An annotation can itself be disputed, decomposed, or retracted.**"
- [`docs/methodology.md:25`](../../docs/methodology.md): a participant "may **withdraw agreement** they previously gave… Withdrawal is allowed because real reasoning has second thoughts, and the format would be brittle if it didn't accommodate them." The same second-thoughts principle applies to commentary a participant later finds wrong.

**Relationship to ADR 0036.** [ADR 0036](0036-meta-move-target-scope-nodes-and-edges-only.md) froze meta-move *targeting* at node/edge — annotations are never meta-move targets — because a contested meta-move itself renders as an annotation, so allowing a meta-move to target an annotation creates an infinite-regress methodology trap. ADR 0036's "annotations are projection-layer residue" framing is scoped to that argument: a meta-move *creates* an annotation, so meta-moving on one recurses. **Disputing an existing annotation's substance is a different operation — a facet `vote`, which creates no annotation.** It only flips the existing annotation's `substance` facet status; nothing new is materialized, so there is no regress and ADR 0036 is unaffected and remains in force. The two ADRs are orthogonal: 0036 governs what a meta-move may target; this ADR governs whether an annotation's substance may be voted against.

## Decision

**A committed annotation's `substance` facet is disputable by a direct facet-keyed vote.** A participant casts `vote { target: 'facet', entity_kind: 'annotation', entity_id: <annotationId>, facet: 'substance', choice: 'dispute' | 'agree' }`. A current participant's `dispute` rolls the substance facet up to `disputed` via the existing facet-status derivation (Rule 5, "any current dispute → disputed", which outranks the `committed` rule — [`facet-status.ts` `derive`](../../packages/shell/src/facet-status/facet-status.ts)), lighting the rose `data-facet-status="disputed"` badge.

Concrete encodings:

1. **The `entity_kind` enums widen to `['node', 'edge', 'annotation']`, in lockstep**, on: the two facet-vote *wire message* schemas ([`packages/shared-types/src/ws-envelope.ts:480,614`](../../packages/shared-types/src/ws-envelope.ts)); the persisted facet-vote *event* schema (`facetVotePayloadSchema`, [`events.ts:441`](../../packages/shared-types/src/events.ts)); and the participant hook's `VoteEntityKind` ([`useVoteAction.ts:75`](../../apps/participant/src/detail/useVoteAction.ts)). The widening is confined to the **vote** payloads — `facetCommitPayloadSchema` ([events.ts:513](../../packages/shared-types/src/events.ts)), `facetMetaDisagreementPayloadSchema` ([events.ts:571](../../packages/shared-types/src/events.ts)), and `withdrawAgreementPayloadSchema` ([events.ts:701](../../packages/shared-types/src/events.ts)) stay `['node', 'edge']`. Annotations are disputable, not committable/meta-disagreeable/withdrawable via these arms (an annotation's substance commit rides the originating meta-move's commit; meta-disagreement and withdraw on annotations are out of scope and unregistered).

2. **The engine vote handler resolves an annotation `substance` target.** `facetStateForTarget` in [`vote.ts:80-103`](../../apps/server/src/methodology/handlers/vote.ts) gains an `entity_kind === 'annotation'` arm returning the annotation's `substanceFacet` via `projection.getAnnotation(entityId)` — mirroring the annotation arm already present in [`primitives.ts:209`](../../apps/server/src/methodology/primitives.ts) and [`commit.ts:147`](../../apps/server/src/methodology/handlers/commit.ts). The replay facet-vote arm ([`apps/server/src/projection/replay.ts:651-682`](../../apps/server/src/projection/replay.ts)) and the shell's `computeFacetStatuses` facet-vote arm ([`facet-status.ts:438-448`](../../packages/shell/src/facet-status/facet-status.ts)) likewise record an `entity_kind: 'annotation'` facet vote onto the annotation's substance accumulator.

3. **Post-commit legality asymmetry, by design.** For node/edge facets a `committed` status rejects votes (`'proposal-already-committed'`, [vote.ts:181-186](../../apps/server/src/methodology/handlers/vote.ts)) and re-opening requires the dedicated `withdraw-agreement` event (→ `withdrawn`). **For an annotation's `substance` facet a vote is legal even when committed** — annotations are commentary any participant may contest at any time, and the resulting status must be `disputed` (the rose badge), which `withdraw-agreement` (→ `withdrawn`) would not produce. The annotation arm of the vote handler's status gate admits `committed`/`agreed` in addition to `proposed`/`disputed`; the per-participant already-voted guard ([vote.ts:209-224](../../apps/server/src/methodology/handlers/vote.ts)) still applies (no double-dispute, no double-agree).

4. **Only `substance` is disputable.** An annotation's `wording` is inline-agreed at creation (it *is* the `content`); `classification`/`shape` never apply to annotations. A facet vote naming any facet other than `substance` on an `entity_kind: 'annotation'` target is rejected.

### Alternatives rejected

- **Append-only commentary** — annotations stand once committed; a regretful author annotates or lives with it. Directly contradicts `data-model.md:141` ("an annotation can itself be disputed") and renders the `substanceFacet`'s `'disputed'` variant permanently dead. Rejected; the docs already commit the methodology to disputability.
- **Reuse `withdraw-agreement` for annotations** — widen `withdrawAgreementPayloadSchema.entity_kind`. Yields `withdrawn`, not `disputed`; does not light the rose badge the render seam was built for; and imposes a withdraw ceremony heavier than the "first-class disputable" framing intends. Rejected.
- **A new `dispute-annotation` proposal sub-kind** — a full proposal + agreement lifecycle for what the per-facet model already expresses as a single direct facet vote. Over-built, and it would collide with the existing facet-keyed vote arm that already models direct per-facet dissent (ADR 0030 §2). Rejected in favor of reusing the facet-vote seam.

## Consequences

**Accepted.**

- `moderator_ui.mod_graph_rendering.mod_annotation_dispute_e2e` is unblocked: the participant dispute-annotation affordance and the moderator `[data-facet-status="disputed"]` Playwright round-trip become reachable through the real event stream.
- `ProjectedAnnotation.substanceFacet: FacetState<'agreed' | 'disputed'>` becomes load-bearing — the `'disputed'` variant is now producible end-to-end rather than incidental type residue.
- A disputed annotation is re-agreeable by the same machinery: once every current participant's latest vote on the substance facet is `agree`, the derivation rolls back up to `agreed` (Rule 7). No resolution-specific code is required.
- The vote handler carries an annotation branch whose committed-status gate intentionally differs from node/edge. A comment at [vote.ts:181](../../apps/server/src/methodology/handlers/vote.ts) cites this ADR so the asymmetry is not "corrected" by a later refactor.

**Trade-offs.**

- The committed-facet vote gate is no longer uniform across entity kinds. This is a deliberate methodological distinction (structural commitments are re-opened by an explicit withdraw; commentary is contested by a vote), pinned by tests and documented here, not an inconsistency to iron out.

**Out of scope / left open.**

- **Annotation withdrawability** (the 2026-05-31 parking-lot item, "Should annotations be withdrawable post-commit?") is a *different* question — removing/retracting an annotation (status → `withdrawn` or removed), not contesting its substance (status → `disputed`). This ADR resolves disputability only; withdrawability stays open.

**Constraints on future work.**

- Refinements that touch the facet-vote `entity_kind` enums, the vote handler's `facetStateForTarget`, or its committed-facet gate cite this ADR. Re-narrowing the vote `entity_kind` to `['node', 'edge']`, or applying the node/edge committed-facet rejection to annotations, is an ADR-superseding change.
