// Event-log replay — build / mutate a projection from typed events.
//
// Refinement: tasks/refinements/data-and-methodology/project_from_log.md
// TaskJuggler: data_and_methodology.projection.project_from_log
//
// Two entry points:
//
//   - `applyEvent(projection, event)` — per-event dispatcher; mutates
//     in place. Switches on `event.kind`, then on the proposal sub-
//     kind for `commit` events. Reused by the next task
//     (`project_incrementally`) for single-event apply.
//
//   - `projectFromLog(events, sessionId)` — on-load entry point.
//     Creates an empty projection and iterates the events in the
//     order they were given (the caller is responsible for sorting
//     by `sequence` ascending — typically a single ORDER BY clause
//     in the loader's SQL).
//
// **Validation discipline**. Events are expected to have already
// passed `validateEvent` (per ADR 0021). We do not re-validate
// payloads here — the dispatcher trusts the discriminated-union
// type. What we DO check: cross-event referential consistency
// (e.g. a commit's `proposal_id` references a proposal currently
// in `pendingProposals`), because that's the one thing payload
// validation can't see and it's cheap to surface here.
//
// **Methodology-engine boundary**. For `commit` events, this
// dispatcher applies the *structural* effect of each proposal
// sub-kind (set classification facet value; mark old node not-
// visible on decompose; etc.). The deeper methodology semantics —
// per-participant agreement-state transitions, axiom-mark
// invariants, decompose component-edge rebinding, meta-move
// rendering — live downstream in
// `data_and_methodology.methodology_engine.*`. TODO comments mark
// each such handoff.

import type {
  AnnotationCreatedPayload,
  EdgeCreatedPayload,
  EntityIncludedPayload,
  Event,
  NodeCreatedPayload,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  ProposalEnvelopePayload,
  ProposalPayload,
  SessionEndedPayload,
  SnapshotCreatedPayload,
  VotePayload,
  CommitPayload,
  MetaDisagreementMarkedPayload,
} from '@a-conversa/shared-types';

import { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
import type { PendingProposal, PerParticipantVote } from './types.js';

export class ReplayError extends Error {
  override readonly name = 'ReplayError';
}

// ---------------------------------------------------------------
// Per-event-kind handlers. Each handler signature is
// `(projection: Projection, event: Event<K>) => void`. The
// dispatcher narrows by `event.kind` so the handler sees the
// concrete payload type.
// ---------------------------------------------------------------

function handleSessionCreated(projection: Projection): void {
  // Session metadata only. The projection already knows its
  // sessionId; this event marks the log start. Re-affirm `open`
  // state defensively (the field defaults to `'open'` on
  // construction; setting it explicitly costs nothing and reads
  // honestly).
  projection.setSessionState('open');
}

function handleSessionEnded(projection: Projection, _payload: SessionEndedPayload): void {
  projection.setSessionState('ended');
}

function handleParticipantJoined(projection: Projection, payload: ParticipantJoinedPayload): void {
  projection.addParticipant({
    userId: payload.user_id,
    role: payload.role,
    screenName: payload.screen_name,
    joinedAt: payload.joined_at,
    leftAt: null,
  });
}

function handleParticipantLeft(projection: Projection, payload: ParticipantLeftPayload): void {
  projection.markParticipantLeft(payload.user_id, payload.left_at);
}

function handleNodeCreated(projection: Projection, payload: NodeCreatedPayload): void {
  if (projection.getNode(payload.node_id) !== undefined) {
    throw new ReplayError(`node-created: node ${payload.node_id} already present`);
  }
  projection.addNode({
    id: payload.node_id,
    wording: payload.wording,
    createdBy: payload.created_by,
    createdAt: payload.created_at,
  });
}

function handleEdgeCreated(projection: Projection, payload: EdgeCreatedPayload): void {
  if (projection.getEdge(payload.edge_id) !== undefined) {
    throw new ReplayError(`edge-created: edge ${payload.edge_id} already present`);
  }
  projection.addEdge({
    id: payload.edge_id,
    role: payload.role,
    sourceNodeId: payload.source_node_id,
    targetNodeId: payload.target_node_id,
    createdBy: payload.created_by,
    createdAt: payload.created_at,
  });
}

function handleAnnotationCreated(projection: Projection, payload: AnnotationCreatedPayload): void {
  if (projection.getAnnotation(payload.annotation_id) !== undefined) {
    throw new ReplayError(
      `annotation-created: annotation ${payload.annotation_id} already present`,
    );
  }
  projection.addAnnotation({
    id: payload.annotation_id,
    kind: payload.kind,
    content: payload.content,
    targetNodeId: payload.target_node_id,
    targetEdgeId: payload.target_edge_id,
    createdBy: payload.created_by,
    createdAt: payload.created_at,
  });
}

function handleEntityIncluded(projection: Projection, payload: EntityIncludedPayload): void {
  // The session begins referencing a global entity. For an entity
  // the session itself created (the common single-session-log
  // case) the corresponding `node-created` / `edge-created` /
  // `annotation-created` event already added it to the projection
  // — this is a no-op. For a cross-session inclusion, the loader
  // is responsible for synthesizing the global-creation event
  // ahead of `entity-included` (joining `session_events` against
  // `nodes` / `edges` / `annotations`); if it didn't, the entity
  // is missing and we surface a clean failure rather than
  // silently dropping it.
  switch (payload.entity_kind) {
    case 'node':
      if (projection.getNode(payload.entity_id) === undefined) {
        throw new ReplayError(
          `entity-included(node ${payload.entity_id}): not in projection — loader must inject the matching node-created event first`,
        );
      }
      return;
    case 'edge':
      if (projection.getEdge(payload.entity_id) === undefined) {
        throw new ReplayError(
          `entity-included(edge ${payload.entity_id}): not in projection — loader must inject the matching edge-created event first`,
        );
      }
      return;
    case 'annotation':
      if (projection.getAnnotation(payload.entity_id) === undefined) {
        throw new ReplayError(
          `entity-included(annotation ${payload.entity_id}): not in projection — loader must inject the matching annotation-created event first`,
        );
      }
      return;
  }
}

function handleProposal(
  projection: Projection,
  proposalEventId: string,
  proposer: string | null,
  proposedAt: string,
  payload: ProposalEnvelopePayload,
): void {
  const pending: PendingProposal = {
    proposalEventId,
    payload: payload.proposal,
    proposer,
    proposedAt,
  };
  projection.addPendingProposal(pending);
}

function handleVote(projection: Projection, payload: VotePayload): void {
  // Per-facet status derivation owns the fan-out from a vote on a
  // proposal into per-participant agreement state on the affected
  // facet (and the resulting overall facet status). For this task
  // we only record the vote against the pending proposal, leaving
  // a note on the proposal that this vote was seen. The
  // methodology engine will read the `pendingProposals` map plus
  // the resolution events to compute final state.
  //
  // TODO(per_facet_status_derivation): Project this vote into the
  // affected entity's per-participant facet state map. For now
  // the projection's pending proposal alone captures vote
  // arrival; downstream tests of facet derivation will exercise
  // the full path.
  const pending = projection.getPendingProposal(payload.proposal_id);
  if (pending === undefined) {
    throw new ReplayError(
      `vote: proposal ${payload.proposal_id} is not pending in this projection`,
    );
  }
  // No-op on the storage layer beyond the existence check. The
  // vote enum (`agree | dispute | withdraw`) is the methodology
  // engine's input; this dispatcher just confirms the vote
  // references a real proposal.
  const _vote: PerParticipantVote = payload.vote;
  void _vote;
  void payload.participant;
  void payload.voted_at;
  void pending;
}

function handleCommit(projection: Projection, payload: CommitPayload): void {
  const pending = projection.getPendingProposal(payload.proposal_id);
  if (pending === undefined) {
    throw new ReplayError(
      `commit: proposal ${payload.proposal_id} is not pending in this projection`,
    );
  }
  applyCommittedProposal(projection, pending.payload);
  projection.removePendingProposal(payload.proposal_id);
}

function handleMetaDisagreementMarked(
  projection: Projection,
  payload: MetaDisagreementMarkedPayload,
): void {
  const pending = projection.getPendingProposal(payload.proposal_id);
  if (pending === undefined) {
    throw new ReplayError(
      `meta-disagreement-marked: proposal ${payload.proposal_id} is not pending`,
    );
  }
  projection.markMetaDisagreement({
    proposalEventId: pending.proposalEventId,
    payload: pending.payload,
    proposer: pending.proposer,
    proposedAt: pending.proposedAt,
    markedBy: payload.moderator,
    markedAt: payload.marked_at,
  });
  projection.removePendingProposal(payload.proposal_id);
}

function handleSnapshotCreated(
  projection: Projection,
  payload: SnapshotCreatedPayload,
  createdAt: string,
): void {
  projection.addSnapshot({
    snapshotId: payload.snapshot_id,
    label: payload.label,
    logPosition: payload.log_position,
    createdAt,
  });
}

// ---------------------------------------------------------------
// Per-proposal-sub-kind structural effects (commit handlers).
//
// Each handler applies the visible-graph structural effect of the
// committed proposal. Methodology semantics (agreement-state
// fan-out, axiom-mark per-participant invariants, decompose-
// component edge rebinding, meta-move rendering) live downstream
// in `data_and_methodology.methodology_engine.*` and are flagged
// with TODO comments here.
// ---------------------------------------------------------------

function applyCommittedProposal(projection: Projection, proposal: ProposalPayload): void {
  switch (proposal.kind) {
    case 'classify-node': {
      const node = projection.getNode(proposal.node_id);
      if (!node) {
        throw new ReplayError(`commit/classify-node: node ${proposal.node_id} not present`);
      }
      node.classificationFacet.value = proposal.classification;
      node.classificationFacet.status = 'agreed';
      // TODO(per_facet_status_derivation): populate
      // `classificationFacet.perParticipant` from the votes that
      // produced this commit.
      return;
    }
    case 'set-node-substance': {
      const node = projection.getNode(proposal.node_id);
      if (!node) {
        throw new ReplayError(`commit/set-node-substance: node ${proposal.node_id} not present`);
      }
      node.substanceFacet.value = proposal.value;
      node.substanceFacet.status = 'agreed';
      return;
    }
    case 'set-edge-substance': {
      const edge = projection.getEdge(proposal.edge_id);
      if (!edge) {
        throw new ReplayError(`commit/set-edge-substance: edge ${proposal.edge_id} not present`);
      }
      edge.substanceFacet.value = proposal.value;
      edge.substanceFacet.status = 'agreed';
      return;
    }
    case 'edit-wording': {
      if (proposal.edit_kind === 'reword') {
        const node = projection.getNode(proposal.node_id);
        if (!node) {
          throw new ReplayError(
            `commit/edit-wording(reword): node ${proposal.node_id} not present`,
          );
        }
        node.wording = proposal.new_wording;
        node.wordingFacet.value = proposal.new_wording;
        node.wordingFacet.status = 'agreed';
        return;
      }
      // restructure: supersede the old node; the matching
      // `node-created` event for `new_node_id` ran independently
      // (per docs/data-model.md — a paired node-created event).
      // TODO(reword_vs_restructure): edge rebinding semantics —
      // edges to the old node do not auto-follow per the data
      // model; the methodology engine renders the consequences.
      const oldNode = projection.getNode(proposal.node_id);
      if (!oldNode) {
        throw new ReplayError(
          `commit/edit-wording(restructure): old node ${proposal.node_id} not present`,
        );
      }
      projection.setNodeVisible(proposal.node_id, false);
      const replacement = projection.getNode(proposal.new_node_id);
      if (!replacement) {
        throw new ReplayError(
          `commit/edit-wording(restructure): new node ${proposal.new_node_id} not present — paired node-created should run before this commit`,
        );
      }
      // The replacement node is created via its own
      // `node-created` event with `wording = new_wording`; its
      // visibility defaults to `true`. No further work here.
      return;
    }
    case 'decompose': {
      // TODO(decomposition_logic): the methodology engine creates
      // the component nodes (each with its own `node-created` and
      // initial classification) when the decompose proposal
      // commits, including the edge-rebinding and the components'
      // initial agreement state. For M1 the structural effect is
      // "parent becomes invisible" — components are added by
      // their own `node-created` events the methodology engine
      // emits.
      const parent = projection.getNode(proposal.parent_node_id);
      if (!parent) {
        throw new ReplayError(`commit/decompose: parent ${proposal.parent_node_id} not present`);
      }
      projection.setNodeVisible(proposal.parent_node_id, false);
      return;
    }
    case 'interpretive-split': {
      // TODO(interpretive_split_logic): downstream methodology
      // engine semantics. For M1 the structural effect is the
      // same as decompose — parent becomes invisible; readings
      // are added via their own `node-created` events.
      const parent = projection.getNode(proposal.parent_node_id);
      if (!parent) {
        throw new ReplayError(
          `commit/interpretive-split: parent ${proposal.parent_node_id} not present`,
        );
      }
      projection.setNodeVisible(proposal.parent_node_id, false);
      return;
    }
    case 'axiom-mark': {
      // TODO(axiom_mark_logic): per-participant axiom-mark
      // invariants and the consequences for cycle-resolution
      // routing live in the methodology engine. Structurally we
      // record the (node, participant) pair on the projection.
      const node = projection.getNode(proposal.node_id);
      if (!node) {
        throw new ReplayError(`commit/axiom-mark: node ${proposal.node_id} not present`);
      }
      node.axiomMarks.set(proposal.participant, {
        proposalEventId: '',
        markedAt: '',
      });
      return;
    }
    case 'meta-move': {
      // TODO(meta_move_logic): rendering semantics (where the
      // meta-move annotation surfaces, whether it grants edit-
      // privileges, etc.) live in the methodology engine. The
      // structural effect per docs/data-model.md is "meta-moves
      // are events recorded in history; their effects appear on
      // the graph" — for M1 we synthesize an annotation tied to
      // the target so the projection has a visible artifact.
      // Annotation id is derived from the proposal id (stable
      // across replay; collision-free vs. user annotations
      // because user-created annotations have UUIDs from a
      // separate generation path).
      const annotationId = `meta-move:${proposal.target_id}:${proposal.meta_kind}:${proposal.content.length}`;
      // We don't have the proposal-event id at this layer (the
      // `payload` argument is just the inner proposal payload).
      // Honest scope: leave the meta-move's projection-level
      // representation to the methodology engine. For now, no
      // structural change.
      void annotationId;
      return;
    }
    case 'break-edge': {
      const edge = projection.getEdge(proposal.edge_id);
      if (!edge) {
        throw new ReplayError(`commit/break-edge: edge ${proposal.edge_id} not present`);
      }
      projection.setEdgeVisible(proposal.edge_id, false);
      return;
    }
    case 'amend-node': {
      // TODO(amend_node_logic): contradiction-resolution path —
      // the methodology engine determines whether amend produces
      // a wording change or a structural rewrite. For M1 we
      // mirror reword semantics (in-place wording update).
      const node = projection.getNode(proposal.node_id);
      if (!node) {
        throw new ReplayError(`commit/amend-node: node ${proposal.node_id} not present`);
      }
      node.wording = proposal.new_content;
      node.wordingFacet.value = proposal.new_content;
      node.wordingFacet.status = 'agreed';
      return;
    }
    case 'annotate': {
      // TODO(annotation_logic): the annotation's own facet
      // lifecycle (vote / commit / withdraw on the annotation
      // itself) is owned by `annotation_logic`. Here we just
      // structurally land the annotation on the target. The
      // annotation id, like meta-move's, isn't carried in the
      // proposal payload — for v1 the annotation-create path
      // goes through a paired `annotation-created` event the
      // methodology engine emits, so this branch leaves
      // structural placement to that flow. For M1 we no-op.
      return;
    }
  }
}

// ---------------------------------------------------------------
// Public dispatcher and replay entry point.
// ---------------------------------------------------------------

export function applyEvent(projection: Projection, event: Event): void {
  if (event.sessionId !== projection.sessionId) {
    throw new ReplayError(
      `event ${event.id} session mismatch: event.sessionId=${event.sessionId}, projection.sessionId=${projection.sessionId}`,
    );
  }
  try {
    switch (event.kind) {
      case 'session-created':
        handleSessionCreated(projection);
        return;
      case 'session-ended':
        handleSessionEnded(projection, event.payload);
        return;
      case 'participant-joined':
        handleParticipantJoined(projection, event.payload);
        return;
      case 'participant-left':
        handleParticipantLeft(projection, event.payload);
        return;
      case 'node-created':
        handleNodeCreated(projection, event.payload);
        return;
      case 'edge-created':
        handleEdgeCreated(projection, event.payload);
        return;
      case 'annotation-created':
        handleAnnotationCreated(projection, event.payload);
        return;
      case 'entity-included':
        handleEntityIncluded(projection, event.payload);
        return;
      case 'proposal':
        handleProposal(projection, event.id, event.actor, event.createdAt, event.payload);
        return;
      case 'vote':
        handleVote(projection, event.payload);
        return;
      case 'commit':
        handleCommit(projection, event.payload);
        return;
      case 'meta-disagreement-marked':
        handleMetaDisagreementMarked(projection, event.payload);
        return;
      case 'snapshot-created':
        handleSnapshotCreated(projection, event.payload, event.createdAt);
        return;
    }
  } catch (cause) {
    if (cause instanceof ReplayError) throw cause;
    if (cause instanceof ProjectionInvariantError) {
      throw new ReplayError(
        `event ${event.id} (${event.kind}, sequence=${event.sequence}): ${cause.message}`,
        { cause },
      );
    }
    throw cause;
  }
}

export function projectFromLog(events: readonly Event[], sessionId: string): Projection {
  const projection = createEmptyProjection(sessionId);
  for (const event of events) applyEvent(projection, event);
  return projection;
}
