# 0036 — Meta-move target scope: nodes and edges only, annotations never

- **Date**: 2026-06-01
- **Status**: Accepted

## Context

`metaMoveProposalSchema` in [`packages/shared-types/src/events/proposals.ts:412-419`](../../packages/shared-types/src/events/proposals.ts) ships `target_kind: z.enum(['node', 'edge'])` with `target_id: z.string().uuid()`. The schema deliberately omits `'annotation'`; the moderator UI's `useMetaMoveAction` hook ([`apps/moderator/src/layout/useMetaMoveAction.ts:135-144`](../../apps/moderator/src/layout/useMetaMoveAction.ts)) refuses to propose when the staged `targetEntityKind === 'annotation'` and surfaces the localized `reason.targetKindInvalid` message inline.

The `mod_meta_move_action` action task ([refinement Decision §4](../../tasks/refinements/moderator-ui/mod_meta_move_action.md)) registered two follow-ups under its AC §11 / §12:

- `mod_meta_move_edge_target_gesture` (now done — 2026-06-01) lit up the schema's `'edge'` arm with a click-to-stage gesture and a chip label that names the edge by role + endpoint snippets.
- `mod_meta_move_annotation_target_gesture` (this ADR's owner) had to decide between two paths: **widen the engine** to accept `target_kind: 'annotation'` (schema enum + a new `projection.getAnnotation` validator branch + a UI gesture), or **freeze the annotation rejection as a permanent product rule** and document the decision so it's not re-litigated.

Three forces converged on the "freeze" call:

1. **Methodologically, annotations are projection-layer residue, not first-class objects.** [`docs/methodology.md:189-197`](../../docs/methodology.md) frames a meta-move as a proposal to *relocate the debate* — a claim that the real question is X, not the Y currently on the board. The board's first-class methodology objects are statements (nodes) and inferential links (edges); those are the things participants argue *about*. Annotations are projection-layer renderings — facet-status badges, axiom marks, disputed-meta-move markers, interpretive-split residue. A meta-move on an annotation isn't a meta-move on what the debate is *about*; it's a meta-move on how the methodology engine is *labeling* the debate, which is a category error. The proper expression of "the framing of this observation is itself the question" is a meta-move on the underlying node or edge the annotation hangs from.

2. **Contested meta-moves themselves render as annotations.** `mod_meta_move_disputed_visibility` (done 2026-06-01) extended [`apps/moderator/src/graph/AnnotationBadge.tsx`](../../apps/moderator/src/graph/AnnotationBadge.tsx) so a contested meta-move on a node surfaces as a disputed annotation badge on the host. If meta-moves could target annotations, a contested meta-move could target the disputed-annotation badge that depicts a contested meta-move that targets the disputed-annotation badge that depicts… — an infinite-regress methodology trap with no resolution path. The rule keeps the methodology layer terminating.

3. **The wire-side widening would be far from free.** Adding `'annotation'` to the schema enum is one line; making the engine actually validate annotation targets requires a new `projection.getAnnotation(target_id)` accessor (which doesn't exist), new visibility predicates analogous to `edgeIsVisible` for annotations, a new dispatch arm in `validateMetaMoveProposal` ([`apps/server/src/methodology/handlers/propose.ts:96-111`](../../apps/server/src/methodology/handlers/propose.ts)), and projector logic deciding where a committed annotation-targeted meta-move actually hangs (on the annotation's host? on a new free-floating annotation?). All of this for a methodologically unclear product value.

## Decision

**Meta-move proposals target nodes or edges. Annotations are not permissible meta-move targets, ever.** The `metaMoveProposalSchema.target_kind` enum stays `z.enum(['node', 'edge'])`; the engine validator stays node/edge-only; the moderator UI's `useMetaMoveAction` hook continues to reject `targetEntityKind === 'annotation'` inline with the `reason.targetKindInvalid` message. A moderator who wants to question the framing of an observation surfaced as an annotation does so by meta-moving on the annotation's host node or edge.

Concrete consequences encoded by this decision:

1. **Schema is frozen at `{'node', 'edge'}`.** Future refinements MUST NOT widen `metaMoveProposalSchema.target_kind` to add `'annotation'`. The schema file carries a one-line comment pointing at this ADR to make the constraint explicit at the seam.

2. **Validator is frozen at two dispatch arms.** `validateMetaMoveProposal` keeps its `target_kind === 'node'` and `target_kind === 'edge'` arms; no `'annotation'` arm is added; no `projection.getAnnotation` accessor is introduced for meta-move validation.

3. **Client guard stays as the friendly failure surface.** The inline `useMetaMoveAction` annotation-rejection guard remains. Its job is to convert "moderator has an annotation selected while in meta-move mode" into a clear localized inline message rather than letting the propose attempt fail at the schema/validator with a less actionable error. The guard is not a defense-in-depth substitute for the schema rule — it's the user-facing complement to it.

4. **Annotation auto-suggest stays kind-agnostic.** `selectMostRecentlyActiveEntity` in [`apps/moderator/src/stores/recentlyActiveNode.ts`](../../apps/moderator/src/stores/recentlyActiveNode.ts) continues to return annotation-kind targets when the moderator most recently interacted with an annotation. The `CaptureTargetChip` auto-suggest path will stage an annotation in meta-move mode; the inline guard catches the propose attempt with the corrected localized message. Filtering annotations out of auto-suggest specifically in meta-move mode would add modal-state-dependent auto-suggest, which both `mod_propose_annotation_endpoint_gestures` §5 and `mod_meta_move_edge_target_gesture` §5 explicitly rejected — the keep-auto-suggest-kind-agnostic invariant takes priority over the small UX win of pre-filtering.

5. **`reason.targetKindInvalid` and `reason.targetMissing` are corrected to reflect node+edge.** The strings shipped with `mod_meta_move_action` referenced "a node" only (correct under that task's v1 narrowing); after `mod_meta_move_edge_target_gesture` widened the allow-list to `{'node', 'edge'}`, they became inaccurate. The annotation-rejection refinement is the right occasion to correct them.

## Consequences

**Accepted.**

- The methodology layer terminates: there is no path by which the agreement lifecycle on a meta-move can land on an annotation that depicts another meta-move's agreement lifecycle. The graph stays simple (nodes + edges + annotations) and the methodology operations target the first-class layer only.
- The wire surface stays narrow: schema and validator dispatch on two kinds, not three. Future projection refactors don't have to invent an annotation-host policy for committed annotation-targeted meta-moves.
- Moderators have a clear redirection when they try the gesture: the inline message names what the valid targets are (node or edge) and what to do (clear the annotation, stage a node or edge).
- The "what about meta-moving on the framing of this disputed-facet observation?" use case is preserved — it's expressed as a meta-move on the underlying node or edge, which is how the methodology already names the act.

**Trade-offs.**

- A moderator who clicks an annotation to read it and then presses F8 will see the annotation auto-staged and have to clear it. The inline message is the redirect surface; this is the cost of keeping auto-suggest kind-agnostic (Decision §4 above). If production telemetry shows this is a friction point, a future ADR could revisit modal-state-dependent auto-suggest — but it would supersede `mod_meta_move_edge_target_gesture` §5 and `mod_propose_annotation_endpoint_gestures` §5 along with this ADR.
- If a methodological refinement of the spec later argues annotations should be first-class methodology objects (rather than projection-layer residue), this ADR has to be superseded — schema + validator + UI all in one swing. Locating the decision in a single ADR (rather than scattered across refinements) makes that supersession tractable.

**Constraints on future work.**

- Refinements that touch `metaMoveProposalSchema`, `validateMetaMoveProposal`, or `useMetaMoveAction`'s rejection guard cite this ADR. Any proposed widening of the `target_kind` enum to include `'annotation'` is an ADR-superseding change, not a routine widening.
- The `'target-kind-invalid'` reason key continues to fire only against annotation targets. If a future kind is added to the schema enum (e.g., a hypothetical `'edge-substance'` facet-meta-move), its rejection path for unsupported staged kinds reuses this reason key — the localized message stays in the "name the valid kinds, name what's been staged" shape.
