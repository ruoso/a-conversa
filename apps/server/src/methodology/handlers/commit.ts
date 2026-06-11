// `commit` action handler — the real write-side validator.
//
// Refinement: tasks/refinements/data-and-methodology/commit_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.commit_logic
//
// **What this handler enforces** (per docs/methodology.md, lines
// 15–25 — the commit step):
//
//   1. **Moderator gate.** Only the session's moderator may commit.
//      → `'not-a-moderator'` (or `'not-a-participant'` if the requester
//      is not joined at all; unreachable in practice because the
//      universal participant gate in `validateAction` already filtered).
//   2. **Proposal exists.** The proposal id must reference a known
//      proposal in any of the three projection state buckets.
//      → `'proposal-not-found'`.
//   3. **Proposal is pending.** It must still be live (not already
//      committed, not in meta-disagreement). → `'proposal-already-committed'`
//      or `'proposal-already-meta-disagreement'`.
//   4. **Unanimous agree across current participants.** Every change
//      requires unanimous agreement (docs/methodology.md "Every change
//      to the graph requires agreement, regardless of what it is.").
//      The agreement source-of-truth differs by sub-kind:
//        - For the four facet-targeting sub-kinds (`classify-node`,
//          `set-node-substance`, `set-edge-substance`, `edit-wording`),
//          the projection's `handleVote` populates the affected facet's
//          `perParticipant` map — rule 4 walks it.
//        - For the structural sub-kinds (`decompose`,
//          `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`,
//          `amend-node`, `annotate`), no facet target exists; instead
//          `handleVote` populates the pending proposal's
//          `perParticipantVotes` map and rule 4 walks that. Axiom-mark
//          is special: the participant whose bedrock is being marked
//          doesn't vote on it (their proposal IS the declaration; "we
//          all agree that *this participant* holds this node as bedrock"
//          — docs/methodology.md "Axioms"). The unanimity walk excludes
//          the declared participant from the required set for
//          axiom-mark only.
//      → `'unanimous-agree-required'`.
//
// **Per-sub-kind event emission on commit.** For most sub-kinds the
// handler emits exactly one `commit` event; the projection's
// `applyCommittedProposal` arm applies the structural effect on its
// own. For `annotate` the handler additionally emits an
// `annotation-created` event paired with the commit so the annotation
// entity lands on the projection (the annotation id is freshly minted
// at commit time; pre-commit no annotation entity exists). All emitted
// events are appended in order by the WS layer; the projection's
// incremental `applyEvent` processes the `annotation-created` BEFORE
// the `commit` so `handleCommit`'s `applyCommittedProposal` finds the
// annotation in place when needed.
//
// **Participant-leaves-after-voting semantics.** A participant who left
// no longer counts toward rule 4 — neither in the unanimity requirement
// nor in the agreement tally. The handler walks `currentParticipants`
// (left participants are excluded by construction); for each it asserts
// a `perParticipant` record with vote `'agree'`. A participant who
// agreed and then left does not block the commit; their prior agreement
// is preserved in the per-participant map but not consulted.
//
// **Moderator-excluded-from-unanimity-walk semantics.** Per
// `docs/methodology.md` § "The commit step" (lines 15–25): the
// moderator's role is structural, not interpretive — "They don't
// decide whether agreement has been reached on the merits; they enact
// it once participants have expressed it." The **commit IS the
// moderator's act of agreement**; there is no separate moderator vote
// to consult. The rule-4 walk therefore filters
// `currentParticipants()` to NON-moderator participants ("only
// debaters vote"), mirroring the client-side `deriveCurrentParticipants`
// predicate (`apps/moderator/src/graph/proposalFacets.ts`, Decision
// §1.a). Without this filter, a moderator's commit click is rejected
// with `'unanimous-agree-required'` listing the moderator as the
// missing voter even after every debater has voted agree — the
// methodology's commit step is unreachable on the live wire. The
// projection-level `currentParticipants()` shape is unchanged (other
// callers consume every joined participant including the moderator);
// the filter is at this one callsite only.
//
// **Boundary with `replay.ts/handleCommit`.** This handler is the
// **write-side** gate (does the request pass methodology rules?).
// `handleCommit` (in `apps/server/src/projection/replay.ts`) is the
// **read-side** application that runs AFTER the API layer appends the
// event this handler emits: it sets the facet value (for facet-
// targeting sub-kinds), flips parent visibility / records axiom marks
// (for structural sub-kinds), and moves the proposal from
// `pendingProposals` to `committedProposals`. The two layers are
// independent codepaths but compute the same predicate (unanimous-agree
// across current participants) and stay in sync by construction.

import { randomUUID } from 'node:crypto';

import type { Projection } from '../../projection/index.js';
import type { FacetName, FacetState } from '../../projection/index.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import type { ProposalPayload } from '@a-conversa/shared-types';
import { findProposal, requireModerator } from '../primitives.js';
import type {
  CommitAction,
  EventToAppend,
  EventToAppendEnvelope,
  RejectedValidationResult,
  ValidationResult,
  Validator,
} from '../types.js';

// ---------------------------------------------------------------
// Facet-target resolution.
//
// Mirrors the private `facetTargetForProposal` / `facetStateForTarget`
// helpers in `replay.ts`. Duplicated here intentionally: those helpers
// are projection-private and resolving facets is a write-side need for
// the rule-4 unanimity walk. If a future refactor extracts them into a
// shared module, both call sites can switch.
// ---------------------------------------------------------------

interface FacetTarget {
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
  facet: FacetName;
}

function facetStateForTarget(
  projection: Projection,
  target: FacetTarget,
): FacetState<unknown> | null {
  if (target.entityKind === 'node') {
    const node = projection.getNode(target.entityId);
    if (!node) return null;
    if (target.facet === 'classification') return node.classificationFacet;
    if (target.facet === 'substance') return node.substanceFacet;
    if (target.facet === 'wording') return node.wordingFacet;
    return null;
  }
  if (target.entityKind === 'edge') {
    const edge = projection.getEdge(target.entityId);
    if (!edge) return null;
    if (target.facet === 'substance') return edge.substanceFacet;
    // Per ADR 0030 §5 + `pf_shape_facet_wire_vote`: a facet-keyed
    // commit may target the edge's `shape` facet (no proposal sub-kind
    // produces a shape candidate in v1, so this arm is reachable only
    // via direct facet-keyed commit envelopes — the per-sub-kind
    // commit dispatch via `facetTargetForProposal` returns `null` for
    // shape-targeting commits because no proposal kind names shape).
    if (target.facet === 'shape') return edge.shapeFacet;
    return null;
  }
  if (target.entityKind === 'annotation') {
    const ann = projection.getAnnotation(target.entityId);
    if (!ann) return null;
    if (target.facet === 'wording') return ann.wordingFacet;
    if (target.facet === 'substance') return ann.substanceFacet;
    return null;
  }
  return null;
}

// ---------------------------------------------------------------
// Rule 4 — unanimous agree across current participants (facet-targeting
// sub-kinds variant).
//
// Returns `null` on success (rule satisfied), or a `Rejected` carrying
// `'unanimous-agree-required'` with a `detail` that enumerates which
// participants are still missing / are voting non-agree. The detail
// is for surfacing to the requester so the moderator's UI can show
// "still waiting on Alice and Bob" rather than just "rejected".
// ---------------------------------------------------------------

function checkUnanimousAgreeFacet(
  projection: Projection,
  target: FacetTarget,
): RejectedValidationResult | null {
  const facet = facetStateForTarget(projection, target);
  if (facet === null) {
    // The pending proposal references an entity that isn't on the
    // projection. That would be a projection invariant violation
    // (`handleProposal` doesn't validate the target exists), but if
    // it ever happens, surface a clear typed rejection rather than
    // a NPE downstream.
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `commit: target entity ${target.entityKind}:${target.entityId} for facet '${target.facet}' is not present on the projection`,
    };
  }

  // Per the refinement's Constraints / requirements: the facet must
  // currently be `'agreed'` per `deriveFacetStatus`. This is a cross-
  // check on top of the perParticipant walk below — they compute the
  // same predicate (unanimous-agree across current non-moderator
  // participants) and stay in sync by construction. The per-status
  // dispatch here is also the engine's defense-in-depth for the rare
  // race where a pending proposal coexists with an already-resolved
  // facet: the projection's facet-resolution sweep in `handleCommit` /
  // `handleMetaDisagreementMarked` (apps/server/src/projection/replay.ts)
  // removes every pending proposal targeting a resolved facet, so under
  // steady-state replay this dispatch fires only if that sweep is bypassed.
  const status = deriveFacetStatus(projection, target.entityKind, target.entityId, target.facet);
  if (status === 'committed') {
    return {
      ok: false,
      reason: 'proposal-already-committed',
      detail: `commit: facet ${target.entityKind}:${target.entityId}/${target.facet} is already committed (a prior commit landed on the current candidate)`,
    };
  }
  if (status === 'meta-disagreement') {
    return {
      ok: false,
      reason: 'proposal-already-meta-disagreement',
      detail: `commit: facet ${target.entityKind}:${target.entityId}/${target.facet} has been marked as meta-disagreement`,
    };
  }
  if (status === 'withdrawn') {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `commit: facet ${target.entityKind}:${target.entityId}/${target.facet} is in status 'withdrawn' — a fresh candidate must land before a new commit can be considered`,
    };
  }

  // Filter out the moderator: per `docs/methodology.md` § "The commit
  // step", commit IS the moderator's act of agreement, so the
  // moderator is structurally excluded from the per-participant vote
  // walk. Mirrors `deriveCurrentParticipants` on the client side
  // (`apps/moderator/src/graph/proposalFacets.ts`, Decision §1.a).
  const current = projection.currentParticipants().filter((p) => p.role !== 'moderator');
  if (current.length === 0) {
    // No current non-moderator participants — the agreement rule has
    // nothing to satisfy from voters. A session with only a moderator
    // (no debaters) has no per-participant agreement to record; reject
    // with the unanimity reason so the moderator sees a typed signal
    // rather than committing into a vacuum.
    return {
      ok: false,
      reason: 'unanimous-agree-required',
      detail:
        "commit: no current non-moderator participants to evaluate agreement against (the moderator is excluded from the unanimity walk; commit is the moderator's act of agreement)",
    };
  }

  const missing: string[] = [];
  const nonAgree: { participant: string; vote: string }[] = [];
  for (const p of current) {
    const record = facet.perParticipant.get(p.userId);
    if (!record) {
      missing.push(p.userId);
      continue;
    }
    if (record.vote !== 'agree') {
      nonAgree.push({ participant: p.userId, vote: record.vote });
    }
  }

  if (missing.length === 0 && nonAgree.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing votes from: ${missing.join(', ')}`);
  }
  if (nonAgree.length > 0) {
    parts.push('non-agree votes: ' + nonAgree.map((x) => `${x.participant}=${x.vote}`).join(', '));
  }
  return {
    ok: false,
    reason: 'unanimous-agree-required',
    detail: `commit requires every current participant to have voted agree on the proposal — ${parts.join('; ')}`,
  };
}

// ---------------------------------------------------------------
// Rule 4 — unanimous agree across current participants (structural
// sub-kinds variant).
//
// Walks the pending proposal's `perParticipantVotes` map instead of a
// facet's `perParticipant` map. Same enumeration shape — missing /
// non-agree — so the requester's UI can render the same wait-on message.
//
// **Axiom-mark exclusion.** Per docs/methodology.md: "Agreement on an
// axiom mark is roughly: 'we all agree that this participant holds
// this node as bedrock for this debate'." The participant whose bedrock
// is being declared is the proposer; their proposal IS the declaration
// (`validateAxiomMarkProposal` rule 3 enforces `proposal.participant ===
// action.requester`). They are excluded from the required-voters set
// here — only the other current participants need to vote agree. All
// other structural sub-kinds require every current participant
// (including the proposer) to vote.
// ---------------------------------------------------------------

function checkUnanimousAgreeStructural(
  projection: Projection,
  proposalPayload: ProposalPayload,
  perParticipantVotes: ReadonlyMap<string, { vote: string }>,
): RejectedValidationResult | null {
  // Filter out the moderator: per `docs/methodology.md` § "The commit
  // step", commit IS the moderator's act of agreement, so the
  // moderator is structurally excluded from the per-participant vote
  // walk (mirrors `checkUnanimousAgreeFacet` for facet-bearing sub-
  // kinds + the client's `deriveCurrentParticipants` predicate).
  const current = projection.currentParticipants().filter((p) => p.role !== 'moderator');
  if (current.length === 0) {
    return {
      ok: false,
      reason: 'unanimous-agree-required',
      detail:
        "commit: no current non-moderator participants to evaluate agreement against (the moderator is excluded from the unanimity walk; commit is the moderator's act of agreement)",
    };
  }

  // Axiom-mark: the declared participant doesn't vote separately on
  // their own bedrock declaration — the proposal IS the declaration.
  const excludedParticipant =
    proposalPayload.kind === 'axiom-mark' ? proposalPayload.participant : null;

  const missing: string[] = [];
  const nonAgree: { participant: string; vote: string }[] = [];
  for (const p of current) {
    if (p.userId === excludedParticipant) continue;
    const record = perParticipantVotes.get(p.userId);
    if (!record) {
      missing.push(p.userId);
      continue;
    }
    if (record.vote !== 'agree') {
      nonAgree.push({ participant: p.userId, vote: record.vote });
    }
  }

  if (missing.length === 0 && nonAgree.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing votes from: ${missing.join(', ')}`);
  }
  if (nonAgree.length > 0) {
    parts.push('non-agree votes: ' + nonAgree.map((x) => `${x.participant}=${x.vote}`).join(', '));
  }
  return {
    ok: false,
    reason: 'unanimous-agree-required',
    detail: `commit requires every current participant to have voted agree on the proposal — ${parts.join('; ')}`,
  };
}

// ---------------------------------------------------------------
// Per-sub-kind structural event emission on commit.
//
// Most sub-kinds emit nothing beyond the `commit` envelope itself —
// the projection's `applyCommittedProposal` arm applies the structural
// effect (parent invisibility, axiom-mark recording, etc.) directly on
// the receiving side.
//
// `annotate` and `meta-move` are the exceptions: each materializes an
// annotation entity with its own lifecycle (its own visibility, its own
// facets) and so requires a matching `annotation-created` event on the
// log. (`annotate` carries the kind/content/target directly; a
// committed meta-move surfaces as an annotation whose `kind` is the
// proposal's `meta_kind`.) The id is minted at commit time (pre-commit
// no annotation entity exists). The event precedes the `commit`
// envelope in the returned list so the projection's incremental
// `applyEvent` sees the annotation land BEFORE the `handleCommit` arm
// runs.
//
// `interpretive-split` is the third exception (ADR 0046): at commit,
// each of the parent's qualifying outgoing edges is mirrored onto each
// reading node — `edge-created` + `entity-included` + a facet-keyed
// `commit{carried_from_edge_id}` per (reading × edge). The mirrors are
// genuine commit-time creations under ADR 0027 §2: a structural
// consequence of supersession computed from the graph state at commit
// time (NOT a propose-time snapshot — see ADR 0046's rejected
// alternatives). The whole cluster precedes the proposal-keyed `commit`
// envelope so appliers see the parent edge still in place when they
// resolve the carry. Decompose deliberately does NOT take this branch
// (ADR 0046 §4 — relations against a bundle don't distribute over its
// distinct component claims).
// ---------------------------------------------------------------

function buildStructuralEventsForCommit(
  projection: Projection,
  proposalPayload: ProposalPayload,
  action: CommitAction,
): EventToAppend[] {
  const events: EventToAppend[] = [];
  if (proposalPayload.kind === 'annotate') {
    // `annotation-created`'s wire shape has `target_node_id` /
    // `target_edge_id` (the schema's XOR refine requires exactly one).
    // For an annotation-of-annotation proposal (`target_kind:
    // 'annotation'`), the parent annotation's id rides in
    // `target_node_id` — the projection's `addAnnotation` indexes the
    // child under `annotationsByNode` keyed on that id, which the
    // renderer's `groupAnnotationsByEntityId(...)` then surfaces under
    // the parent annotation's `data.annotations` bucket. This shared
    // keyspace is the mechanism the predecessor
    // `mod_annotation_of_annotation_overlay_chain` established for
    // overlaying nested annotations on a promoted annotation node.
    // Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
    // (Decision §1 wire widening).
    const targetIsEdge = proposalPayload.target_kind === 'edge';
    const annotationCreated: EventToAppendEnvelope<'annotation-created'> = {
      id: randomUUID(),
      sessionId: action.sessionId,
      sequence: action.sequence + events.length,
      kind: 'annotation-created',
      actor: action.actor,
      payload: {
        annotation_id: randomUUID(),
        kind: proposalPayload.annotation_kind,
        content: proposalPayload.content,
        target_node_id: targetIsEdge ? null : proposalPayload.target_id,
        target_edge_id: targetIsEdge ? proposalPayload.target_id : null,
        created_by: action.requester,
        created_at: action.createdAt,
      },
      createdAt: action.createdAt,
    };
    events.push(annotationCreated);
  } else if (proposalPayload.kind === 'meta-move') {
    // A committed meta-move materializes as a visible annotation on its
    // target — exactly the way `annotate` does above. The annotation's
    // `kind` IS the meta-move's `meta_kind` (`annotationKindSchema`
    // already admits `reframe` / `scope-change` / `stance`; no mapping
    // table). The id is minted here and persisted, so it is stable
    // across every subsequent replay. Per ADR 0036 a meta-move targets
    // a node or an edge — never an annotation — so the `target_node_id`
    // / `target_edge_id` XOR is set directly from `target_kind` /
    // `target_id` (no annotation-of-annotation case to handle).
    // Refinement: tasks/refinements/data-and-methodology/meta_move_commit_logic.md
    const targetIsEdge = proposalPayload.target_kind === 'edge';
    const annotationCreated: EventToAppendEnvelope<'annotation-created'> = {
      id: randomUUID(),
      sessionId: action.sessionId,
      sequence: action.sequence + events.length,
      kind: 'annotation-created',
      actor: action.actor,
      payload: {
        annotation_id: randomUUID(),
        kind: proposalPayload.meta_kind,
        content: proposalPayload.content,
        target_node_id: targetIsEdge ? null : proposalPayload.target_id,
        target_edge_id: targetIsEdge ? proposalPayload.target_id : null,
        created_by: action.requester,
        created_at: action.createdAt,
      },
      createdAt: action.createdAt,
    };
    events.push(annotationCreated);
  } else if (proposalPayload.kind === 'interpretive-split') {
    // ADR 0046 — commit-time edge inheritance. A parent edge qualifies
    // iff the parent is its SOURCE, it is currently included and
    // visible, and its substance facet carries a landed commit (the
    // shared derivation's `'committed'` — which also excludes
    // superseded, withdrawn, disputed, and meta-disagreement states).
    // Target-side edges never inherit (an inbound agreed edge would
    // fire immediately against readings nobody evaluated); proposed-
    // substance edges never inherit (pending negotiations re-propose
    // against the readings explicitly, matching the restructure
    // posture in docs/data-model.md L304–305).
    const qualifyingEdges = projection
      .getEdgesBySource(proposalPayload.parent_node_id)
      .filter(
        (edge) =>
          edge.visible &&
          deriveFacetStatus(projection, 'edge', edge.id, 'substance') === 'committed',
      );
    for (const reading of proposalPayload.readings) {
      for (const parentEdge of qualifyingEdges) {
        // Fresh edge id minted at commit time (as the `annotate` branch
        // does for annotations); the parent edge's role and target
        // endpoint (node or annotation) carry verbatim, the reading
        // node takes the source slot.
        const inheritedEdgeId = randomUUID();
        const edgeCreated: EventToAppendEnvelope<'edge-created'> = {
          id: randomUUID(),
          sessionId: action.sessionId,
          sequence: action.sequence + events.length,
          kind: 'edge-created',
          actor: action.actor,
          payload: {
            edge_id: inheritedEdgeId,
            role: parentEdge.role,
            source_node_id: reading.node_id,
            ...(parentEdge.targetNodeId !== null
              ? { target_node_id: parentEdge.targetNodeId }
              : {}),
            ...(parentEdge.targetAnnotationId !== null
              ? { target_annotation_id: parentEdge.targetAnnotationId }
              : {}),
            created_by: action.requester,
            created_at: action.createdAt,
          },
          createdAt: action.createdAt,
        };
        events.push(edgeCreated);
        const entityIncluded: EventToAppendEnvelope<'entity-included'> = {
          id: randomUUID(),
          sessionId: action.sessionId,
          sequence: action.sequence + events.length,
          kind: 'entity-included',
          actor: action.actor,
          payload: {
            entity_kind: 'edge',
            entity_id: inheritedEdgeId,
            included_by: action.requester,
            included_at: action.createdAt,
          },
          createdAt: action.createdAt,
        };
        events.push(entityIncluded);
        // The substance carry is its own facet-layer event (ADR 0027's
        // strict separation — the entity events above carry no facet
        // effect). Appliers resolve `carried_from_edge_id` and land
        // this facet in the parent edge's terminal state.
        const carriedCommit: EventToAppendEnvelope<'commit'> = {
          id: randomUUID(),
          sessionId: action.sessionId,
          sequence: action.sequence + events.length,
          kind: 'commit',
          actor: action.actor,
          payload: {
            target: 'facet' as const,
            entity_kind: 'edge' as const,
            entity_id: inheritedEdgeId,
            facet: 'substance' as const,
            committed_by: action.requester,
            committed_at: action.committedAt,
            carried_from_edge_id: parentEdge.id,
          },
          createdAt: action.createdAt,
        };
        events.push(carriedCommit);
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------
// The validator.
// ---------------------------------------------------------------

export const commitHandler: Validator<CommitAction> = (
  projection: Projection,
  action: CommitAction,
): ValidationResult => {
  // Rule 1 — moderator gate.
  const moderator = requireModerator(projection, action.requester);
  if (!moderator.ok) return moderator.rejection;

  // The handler dispatches by `action.target` mirroring the wire
  // envelope (per ADR 0030 §2 + §9). The facet arm names the
  // `(entityKind, entityId, facet)` triple directly; the proposal arm
  // names a structural proposal id (decompose / interpretive-split /
  // axiom-mark / annotate / meta-move / break-edge / amend-node) where
  // no facet target exists.
  //
  // **Mixed-model intent (pinned by `pf_structural_handlers_unchanged`).**
  // Structural sub-kinds intentionally take the proposal-keyed arm
  // below; the two patterns coexist by design per ADR 0030 §9.
  if (action.target === 'facet') {
    // ----- FACET-KEYED ARM ------------------------------------------
    //
    // The commit attaches to `(entityKind, entityId, facet)` directly.
    // No proposal lookup is needed — agreement is a property of the
    // facet itself (`facet.perParticipant`). The projection's
    // `handleCommit` facet arm sweeps any pending proposals targeting
    // the facet via `clearPendingProposalsForFacet`.
    //
    // **Why no proposal lookup.** Some facets reach `'agreed'` without
    // a proposal targeting them — an edge's `shape` facet is seeded
    // inline on `edge-created` per ADR 0030 §5 with no driving
    // proposal. The pre-refactor handler required a `proposalEventId`
    // and rejected commits on inline-seeded facets with
    // `proposal-not-found`. Reading the facet directly removes that
    // asymmetry.
    const target: FacetTarget = {
      entityKind: action.entityKind,
      entityId: action.entityId,
      facet: action.facet,
    };
    const unanimityRejection = checkUnanimousAgreeFacet(projection, target);
    if (unanimityRejection !== null) return unanimityRejection;

    const commitEvent: EventToAppendEnvelope<'commit'> = {
      id: action.eventId,
      sessionId: action.sessionId,
      sequence: action.sequence,
      kind: 'commit',
      actor: action.actor,
      payload: {
        target: 'facet' as const,
        // Wire payload narrows `entity_kind` to `'node' | 'edge'` — the
        // `FacetTarget` interface admits `'annotation'` for the
        // facetStateForTarget helper's flexibility, but the action's
        // `entityKind` is already `'node' | 'edge'` per the
        // `VoteActionFacet` / `CommitActionFacet` types. Reuse
        // `action.entityKind` directly to preserve the narrow type.
        entity_kind: action.entityKind,
        entity_id: action.entityId,
        facet: action.facet,
        committed_by: action.requester,
        committed_at: action.committedAt,
      },
      createdAt: action.createdAt,
    };
    return { ok: true, events: [commitEvent] };
  }

  // ----- PROPOSAL-KEYED ARM (structural sub-kinds) ------------------

  // Rule 2 — proposal exists. Rule 3 — proposal is pending.
  const found = findProposal(projection, action.proposalEventId);
  if (found === null) {
    return {
      ok: false,
      reason: 'proposal-not-found',
      detail: `commit: proposal ${action.proposalEventId} is not known to this session`,
    };
  }
  if (found.state === 'committed') {
    return {
      ok: false,
      reason: 'proposal-already-committed',
      detail: `commit: proposal ${action.proposalEventId} has already been committed at ${found.record.committedAt}`,
    };
  }
  if (found.state === 'meta-disagreement') {
    return {
      ok: false,
      reason: 'proposal-already-meta-disagreement',
      detail: `commit: proposal ${action.proposalEventId} has been marked as meta-disagreement at ${found.record.markedAt}`,
    };
  }

  const proposalPayload = found.record.payload;
  const unanimityRejection = checkUnanimousAgreeStructural(
    projection,
    proposalPayload,
    found.record.perParticipantVotes,
  );
  if (unanimityRejection !== null) return unanimityRejection;

  // Valid — emit the structural fan-out (if any) followed by the
  // `commit` envelope. The structural events take the leading
  // sequence slots; the commit envelope takes the last.
  const structuralEvents = buildStructuralEventsForCommit(projection, proposalPayload, action);
  const commitEvent: EventToAppendEnvelope<'commit'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence + structuralEvents.length,
    kind: 'commit',
    actor: action.actor,
    payload: {
      target: 'proposal' as const,
      proposal_id: action.proposalEventId,
      committed_by: action.requester,
      committed_at: action.committedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [...structuralEvents, commitEvent] };
};

export default commitHandler;
