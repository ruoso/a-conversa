// Event-log replay — build / mutate a projection from typed events.
//
// Refinement: tasks/refinements/data-and-methodology/project_from_log.md
// Refinement: tasks/refinements/data-and-methodology/project_incrementally.md
// TaskJuggler: data_and_methodology.projection.project_from_log
// TaskJuggler: data_and_methodology.projection.project_incrementally
//
// Two entry points:
//
//   - `applyEvent(projection, event)` — per-event dispatcher; mutates
//     in place. Switches on `event.kind`, then on the proposal sub-
//     kind for `commit` events. Returns a `ProjectionChange[]` change
//     feed describing what the event touched. Reused by
//     `applyEventIncremental` (incremental.ts) for the single-event
//     apply path.
//
//   - `projectFromLog(events, sessionId)` — on-load entry point.
//     Creates an empty projection and iterates the events in the
//     order they were given (the caller is responsible for sorting
//     by `sequence` ascending — typically a single ORDER BY clause
//     in the loader's SQL). Discards the per-event change feeds —
//     the on-load path doesn't have a broadcaster to feed; the
//     incremental path is where the feed matters.
//
// **Sequence ordering**. `applyEvent` enforces the contract
// "the event's sequence is exactly `lastAppliedSequence + 1`."
// Anything else (gap, replay of an already-applied event, out-of-
// order) throws `OutOfOrderEventError`. This is the steady-state
// guarantee: a projection that has consumed events 1..N applies
// the event at sequence N+1, no other. Sequence advances only
// after every other handler step succeeds — a mid-application
// throw leaves the projection at its prior `lastAppliedSequence`
// so a retry of the same sequence is meaningful (the projection
// is otherwise corrupted by the partial mutation; the caller's
// recovery story is "rebuild from the log via projectFromLog,"
// not "try this single event again").
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
  EntityRemovedPayload,
  Event,
  NodeCreatedPayload,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  ProposalEnvelopePayload,
  ProposalPayload,
  SessionEndedPayload,
  SessionModeChangedPayload,
  SnapshotCreatedPayload,
  VotePayload,
  CommitPayload,
  ProposalCommitPayload,
  MetaDisagreementMarkedPayload,
  WithdrawAgreementPayload,
} from '@a-conversa/shared-types';

import { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
import type {
  FacetName,
  FacetState,
  PendingProposal,
  PerParticipantVote,
  ProjectionChange,
} from './types.js';

export class ReplayError extends Error {
  override readonly name = 'ReplayError';
}

export class OutOfOrderEventError extends Error {
  override readonly name = 'OutOfOrderEventError';
  readonly expectedSequence: number;
  readonly actualSequence: number;

  constructor(expectedSequence: number, actualSequence: number) {
    super(
      `out-of-order event: expected sequence ${expectedSequence}, got ${actualSequence}` +
        (actualSequence <= expectedSequence - 1
          ? ' (replay or out-of-order)'
          : actualSequence > expectedSequence
            ? ' (gap)'
            : ''),
    );
    this.expectedSequence = expectedSequence;
    this.actualSequence = actualSequence;
  }
}

// ---------------------------------------------------------------
// Per-event-kind handlers. Each handler appends to a shared
// `ProjectionChange[]` so the outer dispatcher can return the
// full change feed. The dispatcher narrows by `event.kind` so the
// handler sees the concrete payload type.
// ---------------------------------------------------------------

function handleSessionCreated(projection: Projection, changes: ProjectionChange[]): void {
  // Session metadata only. The projection already knows its
  // sessionId; this event marks the log start. Re-affirm `open`
  // state defensively (the field defaults to `'open'` on
  // construction; setting it explicitly costs nothing and reads
  // honestly).
  projection.setSessionState('open');
  changes.push({ kind: 'session-state-changed', state: 'open' });
}

function handleSessionEnded(
  projection: Projection,
  _payload: SessionEndedPayload,
  changes: ProjectionChange[],
): void {
  projection.setSessionState('ended');
  changes.push({ kind: 'session-state-changed', state: 'ended' });
}

// Per ADR 0028 — flips the projection's `currentMode` field to the
// event's `new_mode`. The participant lobby's auto-navigation
// `useEffect` reads the event off the per-session WS slice directly
// (the projection field is the projector's mirror, not the UI's
// trigger surface); the field's first read sites are the future
// replay surface and the new endpoint's idempotency check (read
// `currentMode`; if already the requested mode, return without
// emitting a second event).
function handleSessionModeChanged(
  projection: Projection,
  payload: SessionModeChangedPayload,
  changes: ProjectionChange[],
): void {
  const previousMode = projection.currentMode;
  projection.setCurrentMode(payload.new_mode);
  changes.push({
    kind: 'session-mode-changed',
    previousMode,
    newMode: payload.new_mode,
  });
}

function handleParticipantJoined(
  projection: Projection,
  payload: ParticipantJoinedPayload,
  changes: ProjectionChange[],
): void {
  projection.addParticipant({
    userId: payload.user_id,
    role: payload.role,
    screenName: payload.screen_name,
    joinedAt: payload.joined_at,
    leftAt: null,
  });
  changes.push({
    kind: 'participant-joined',
    userId: payload.user_id,
    role: payload.role,
  });
}

function handleParticipantLeft(
  projection: Projection,
  payload: ParticipantLeftPayload,
  changes: ProjectionChange[],
): void {
  projection.markParticipantLeft(payload.user_id, payload.left_at);
  changes.push({ kind: 'participant-left', userId: payload.user_id });
}

function handleNodeCreated(
  projection: Projection,
  payload: NodeCreatedPayload,
  changes: ProjectionChange[],
): void {
  if (projection.getNode(payload.node_id) !== undefined) {
    throw new ReplayError(`node-created: node ${payload.node_id} already present`);
  }
  projection.addNode({
    id: payload.node_id,
    wording: payload.wording,
    createdBy: payload.created_by,
    createdAt: payload.created_at,
  });
  changes.push({ kind: 'node-added', nodeId: payload.node_id });
}

function handleEdgeCreated(
  projection: Projection,
  payload: EdgeCreatedPayload,
  changes: ProjectionChange[],
): void {
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
  changes.push({
    kind: 'edge-added',
    edgeId: payload.edge_id,
    sourceNodeId: payload.source_node_id,
    targetNodeId: payload.target_node_id,
    role: payload.role,
  });
}

function handleAnnotationCreated(
  projection: Projection,
  payload: AnnotationCreatedPayload,
  changes: ProjectionChange[],
): void {
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
  changes.push({
    kind: 'annotation-added',
    annotationId: payload.annotation_id,
    targetNodeId: payload.target_node_id,
    targetEdgeId: payload.target_edge_id,
  });
}

// `entity-removed` handler — symmetric counterpart to
// `entity-included`. Per ADR 0027: when a proposal-withdraw retracts
// a propose-time-minted entity, this event flips the entity's
// visibility off (so downstream projectors that walk `node.visible` /
// `edge.visible` skip it). The structural records remain on the
// projection (history is replay-authoritative); the visibility flag
// is the seam every renderer consults. For annotations, the
// visibility flag lives on the annotation record itself.
function handleEntityRemoved(
  projection: Projection,
  payload: EntityRemovedPayload,
  changes: ProjectionChange[],
): void {
  switch (payload.entity_kind) {
    case 'node': {
      const node = projection.getNode(payload.entity_id);
      if (node === undefined) {
        throw new ReplayError(
          `entity-removed(node ${payload.entity_id}): not in projection — the matching node-created event must have run earlier`,
        );
      }
      projection.setNodeVisible(payload.entity_id, false);
      changes.push({
        kind: 'visibility-changed',
        entityKind: 'node',
        entityId: payload.entity_id,
        visible: false,
      });
      return;
    }
    case 'edge': {
      const edge = projection.getEdge(payload.entity_id);
      if (edge === undefined) {
        throw new ReplayError(
          `entity-removed(edge ${payload.entity_id}): not in projection — the matching edge-created event must have run earlier`,
        );
      }
      projection.setEdgeVisible(payload.entity_id, false);
      changes.push({
        kind: 'visibility-changed',
        entityKind: 'edge',
        entityId: payload.entity_id,
        visible: false,
      });
      return;
    }
    case 'annotation': {
      const annotation = projection.getAnnotation(payload.entity_id);
      if (annotation === undefined) {
        throw new ReplayError(
          `entity-removed(annotation ${payload.entity_id}): not in projection — the matching annotation-created event must have run earlier`,
        );
      }
      // Annotations don't carry a `visible` flag on the projection
      // record today (per docs/data-model.md L295-300, annotation
      // visibility is derived from `(annotation-created fired) AND
      // (target entity visible)`). The `entity-removed` event simply
      // records the historical fact; the visible-graph derivation
      // checks for the matching removal on read. No projection
      // mutation needed beyond the change-feed entry.
      return;
    }
  }
}

function handleEntityIncluded(
  projection: Projection,
  payload: EntityIncludedPayload,
  changes: ProjectionChange[],
): void {
  // The session begins referencing a global entity. For an entity
  // the session itself created (the common single-session-log
  // case) the corresponding `node-created` / `edge-created` /
  // `annotation-created` event already added it to the projection
  // — this is a no-op on storage but still a change-feed entry
  // (the inclusion is information downstream consumers need).
  // For a cross-session inclusion, the loader is responsible for
  // synthesizing the global-creation event ahead of
  // `entity-included` (joining `session_events` against `nodes` /
  // `edges` / `annotations`); if it didn't, the entity is missing
  // and we surface a clean failure rather than silently dropping
  // it.
  switch (payload.entity_kind) {
    case 'node':
      if (projection.getNode(payload.entity_id) === undefined) {
        throw new ReplayError(
          `entity-included(node ${payload.entity_id}): not in projection — loader must inject the matching node-created event first`,
        );
      }
      break;
    case 'edge':
      if (projection.getEdge(payload.entity_id) === undefined) {
        throw new ReplayError(
          `entity-included(edge ${payload.entity_id}): not in projection — loader must inject the matching edge-created event first`,
        );
      }
      break;
    case 'annotation':
      if (projection.getAnnotation(payload.entity_id) === undefined) {
        throw new ReplayError(
          `entity-included(annotation ${payload.entity_id}): not in projection — loader must inject the matching annotation-created event first`,
        );
      }
      break;
  }
  changes.push({
    kind: 'entity-included',
    entityKind: payload.entity_kind,
    entityId: payload.entity_id,
  });
}

function handleProposal(
  projection: Projection,
  proposalEventId: string,
  proposer: string | null,
  proposedAt: string,
  payload: ProposalEnvelopePayload,
  changes: ProjectionChange[],
): void {
  const pending: PendingProposal = {
    proposalEventId,
    payload: payload.proposal,
    proposer,
    proposedAt,
    perParticipantVotes: new Map(),
  };
  projection.addPendingProposal(pending);
  changes.push({ kind: 'pending-proposal-added', proposalId: proposalEventId });

  // Per ADR 0030 §6 + §7 + `pf_projection_facet_status_refactor`:
  // a facet-valued proposal sets a new candidate value on the targeted
  // facet AND clears the prior per-participant vote map (the old votes
  // were votes against the *old* candidate; the new candidate is a
  // fresh proposal that needs fresh agreement). Withdrawals are NOT
  // cleared — a withdraw-agreement records a separate gesture against
  // the committed value; a new candidate landing doesn't change the
  // historical fact that the participant withdrew. The commit marker
  // is also left in place; the derivation reads
  // `committedCandidateValue !== candidateValue` as "the commit is
  // stale; the current candidate has not (yet) been committed."
  //
  // Structural proposals (`decompose`, `interpretive-split`,
  // `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`)
  // do not name a per-facet candidate value — `firstFacetTargetForVote`
  // returns `null` for them — and this branch leaves their facets
  // untouched. Multi-component sub-kinds (decompose / interpretive-
  // split) carry per-component classification values in their inline
  // payload that DO populate the per-component classification facet's
  // candidate; that fan-out is handled below.
  const proposal = payload.proposal;
  const facetTarget = firstFacetTargetForVote(proposal);
  if (facetTarget !== null) {
    const facet = facetStateForTarget(projection, facetTarget);
    if (facet !== null) {
      const candidate = proposalCandidateValue(proposal);
      facet.candidateValue = candidate;
      facet.candidateProposalEventId = proposalEventId;
      facet.perParticipant.clear();
      // The agreement-layer status is reset to `'proposed'` here so
      // the snapshot wire shape (which exposes `FacetState.status`
      // verbatim) reads honestly while the new candidate is gathering
      // votes. The derivation does NOT rely on this field for the
      // pre-commit states — it reads the per-participant map directly.
      facet.status = 'proposed';
    }
  }

  // Per-component classification candidate fan-out for `decompose` /
  // `interpretive-split` proposals. Each component carries its own
  // classification value inline; the facet enters life with that
  // value as its candidate (votes accrue against the parent proposal
  // per ADR 0030 §9, but the facet's `candidateValue` is populated
  // so the derivation does not surface `'awaiting-proposal'`).
  if (proposal.kind === 'decompose') {
    for (const component of proposal.components) {
      const node = projection.getNode(component.node_id);
      if (node) {
        node.classificationFacet.candidateValue = component.classification;
        node.classificationFacet.candidateProposalEventId = proposalEventId;
      }
    }
  } else if (proposal.kind === 'interpretive-split') {
    for (const reading of proposal.readings) {
      const node = projection.getNode(reading.node_id);
      if (node) {
        node.classificationFacet.candidateValue = reading.classification;
        node.classificationFacet.candidateProposalEventId = proposalEventId;
      }
    }
  }
}

// Extract the candidate value the proposal names on its facet target.
// Mirrors `firstFacetTargetForVote`'s coverage — the four single-target
// facet-valued sub-kinds. Returns `null` for everything else (structural
// sub-kinds and multi-component sub-kinds; multi-component fans out
// per-component candidates in `handleProposal`'s decompose /
// interpretive-split arms above).
function proposalCandidateValue(proposal: ProposalPayload): unknown {
  switch (proposal.kind) {
    case 'classify-node':
      return proposal.classification;
    case 'set-node-substance':
      return proposal.value;
    case 'set-edge-substance':
      return proposal.value;
    case 'edit-wording':
      return proposal.new_wording;
    default:
      return null;
  }
}

// Resolve the (entity, facet) target(s) of a proposal payload.
//
// Owned by `per_facet_status_derivation` +
// `replay_decompose_commit_marks_component_classification_committed`.
//
// Returns a `readonly FacetTarget[]`:
//
//   - A 1-element array for the four single-target sub-kinds
//     (`classify-node`, `set-node-substance`, `set-edge-substance`,
//     `edit-wording`).
//   - An N-element array for the two multi-component sub-kinds
//     (`decompose` — one per component; `interpretive-split` — one per
//     reading). Each per-component target addresses the component's
//     classification facet; per D6 of the
//     `replay_decompose_commit_marks_component_classification_committed`
//     refinement (mirroring the broadcast-side D6), wording + substance
//     facets are NOT included — wording is set at `node-created` time
//     directly, and substance has no value until a future
//     `set-node-substance` proposal commits against the component.
//   - An empty array for the five purely-structural sub-kinds
//     (`axiom-mark`, `meta-move`, `break-edge`, `amend-node`,
//     `annotate`).
//
// The plural-helper shape mirrors the broadcast-side
// `facetTargetsForProposal` at `apps/server/src/ws/broadcast/proposal-status.ts`;
// see D2 of the refinement for the rename rationale (single-call-site loop
// avoids per-sub-kind branching at three handlers).
//
// Per the refinement's D4, per-component stamping uses the parent proposal
// event's id (`payload.proposal_id` in `handleCommit`'s scope), NOT a
// synthesized per-component id. Per D5, `committedAt` uses the commit
// event's `committed_at`.
interface FacetTarget {
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
  facet: FacetName;
}

function facetTargetsForProposal(proposal: ProposalPayload): readonly FacetTarget[] {
  switch (proposal.kind) {
    case 'classify-node':
      return [{ entityKind: 'node', entityId: proposal.node_id, facet: 'classification' }];
    case 'set-node-substance':
      return [{ entityKind: 'node', entityId: proposal.node_id, facet: 'substance' }];
    case 'set-edge-substance':
      return [{ entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' }];
    case 'edit-wording':
      return [{ entityKind: 'node', entityId: proposal.node_id, facet: 'wording' }];
    case 'decompose':
      return proposal.components.map((component) => ({
        entityKind: 'node' as const,
        entityId: component.node_id,
        facet: 'classification' as const,
      }));
    case 'interpretive-split':
      return proposal.readings.map((reading) => ({
        entityKind: 'node' as const,
        entityId: reading.node_id,
        facet: 'classification' as const,
      }));
    default:
      // axiom-mark, meta-move, break-edge, amend-node, annotate —
      // purely-structural sub-kinds with no facet target.
      return [];
  }
}

// Per D2 of the refinement: `handleVote` and
// `handleMetaDisagreementMarked` target only the four single-target
// sub-kinds — votes / meta-disagreement on a decompose / interpretive-
// split apply to the parent proposal as a whole, not per-component
// facets (per-component vote-recording would be a category error per
// `docs/methodology.md`). The wrapper returns the single target for
// those four sub-kinds and `null` for everything else (including the
// two multi-component sub-kinds and the five structural sub-kinds).
function firstFacetTargetForVote(proposal: ProposalPayload): FacetTarget | null {
  switch (proposal.kind) {
    case 'classify-node':
    case 'set-node-substance':
    case 'set-edge-substance':
    case 'edit-wording': {
      const targets = facetTargetsForProposal(proposal);
      return targets[0] ?? null;
    }
    default:
      return null;
  }
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

function handleVote(
  projection: Projection,
  payload: VotePayload,
  changes: ProjectionChange[],
): void {
  // TODO(pf_vote_handler_facet_keyed): per ADR 0030 §2 the vote
  // payload is now a `target`-discriminated union (facet-keyed vs.
  // proposal-keyed). The methodology engine's vote handler currently
  // emits ALL votes on the proposal-keyed arm (see
  // `apps/server/src/methodology/handlers/vote.ts`'s matching TODO);
  // until the downstream task lands, this projection handler only
  // needs to read the proposal-keyed arm. The facet-keyed arm is a
  // dead branch today and lands a runtime error so any inadvertent
  // emit during the transition surfaces loudly. The downstream
  // task rewrites both halves.
  if (payload.target !== 'proposal') {
    throw new ReplayError(
      `vote: target='${payload.target}' arm is not yet implemented in the projection (TODO: pf_vote_handler_facet_keyed)`,
    );
  }

  // Look up the proposal in pending OR committed (a `withdraw` vote
  // typically arrives after the proposal has been committed and
  // therefore left `pendingProposals`).
  const pending = projection.getPendingProposal(payload.proposal_id);
  const committed = pending ? null : projection.getCommittedProposal(payload.proposal_id);
  if (pending === undefined && committed === undefined) {
    throw new ReplayError(
      `vote: proposal ${payload.proposal_id} is neither pending nor committed in this projection`,
    );
  }
  const proposalPayload: ProposalPayload = pending ? pending.payload : committed!.payload;

  // The new payload's `choice` enum is `'agree' | 'dispute'`. The
  // existing `PerParticipantVote` union still includes `'withdraw'`
  // for back-compat with the projection types until
  // `pf_withdraw_agreement_handler` migrates the withdraw projection
  // to the dedicated `withdraw-agreement` event handler. The narrower
  // `'agree' | 'dispute'` happens to be a subtype of
  // `PerParticipantVote`, so this assignment needs no cast.
  const vote: PerParticipantVote = payload.choice;
  changes.push({
    kind: 'vote-recorded',
    proposalId: payload.proposal_id,
    participantId: payload.participant,
    vote,
  });

  // Project the vote into the affected facet's per-participant state
  // for the four facet-targeting proposal sub-kinds. Other sub-kinds
  // (axiom-mark, decompose, interpretive-split, meta-move,
  // break-edge, amend-node, annotate) are structural — their per-
  // participant agreement state is owned by their downstream
  // methodology-engine tasks; this dispatcher does not touch a
  // facet for them. Per D2 of
  // `replay_decompose_commit_marks_component_classification_committed`,
  // votes against decompose / interpretive-split target the parent
  // proposal as a whole, so the `firstFacetTargetForVote` wrapper
  // returns `null` for those sub-kinds even though the plural helper
  // returns N per-component targets.
  const target = firstFacetTargetForVote(proposalPayload);
  if (target !== null) {
    const facet = facetStateForTarget(projection, target);
    if (facet === null) {
      throw new ReplayError(
        `vote: target entity ${target.entityKind}:${target.entityId} for facet ${target.facet} not present`,
      );
    }
    facet.perParticipant.set(payload.participant, {
      vote,
      proposalEventId: payload.proposal_id,
      votedAt: payload.voted_at,
    });
    return;
  }
  // Structural sub-kind — no per-facet target. Record the vote on the
  // pending proposal's `perParticipantVotes` map so the commit handler's
  // unanimous-agree walk has a state to consult. The four facet-targeting
  // sub-kinds returned a non-null target above and never reach this branch.
  // Withdraw / dispute / re-vote all overwrite the entry in place, matching
  // the per-facet semantics on the four facet-targeting sub-kinds.
  if (pending !== undefined) {
    pending.perParticipantVotes.set(payload.participant, {
      vote,
      proposalEventId: payload.proposal_id,
      votedAt: payload.voted_at,
    });
  }
}

function handleCommit(
  projection: Projection,
  payload: CommitPayload,
  changes: ProjectionChange[],
): void {
  // TODO(pf_commit_handler_facet_keyed): per ADR 0030 §2 the commit
  // payload is now a `target`-discriminated union (facet-keyed vs.
  // proposal-keyed). The methodology engine's commit handler currently
  // emits ALL commits on the proposal-keyed arm (see
  // `apps/server/src/methodology/handlers/commit.ts`'s matching TODO);
  // until the downstream task lands, this projection handler only
  // needs to read the proposal-keyed arm. The facet-keyed arm is a
  // dead branch today and lands a runtime error so any inadvertent
  // emit during the transition surfaces loudly. The downstream
  // task rewrites both halves.
  if (payload.target !== 'proposal') {
    throw new ReplayError(
      `commit: target='${payload.target}' arm is not yet implemented in the projection (TODO: pf_commit_handler_facet_keyed)`,
    );
  }

  const pending = projection.getPendingProposal(payload.proposal_id);
  if (pending === undefined) {
    throw new ReplayError(
      `commit: proposal ${payload.proposal_id} is not pending in this projection`,
    );
  }
  applyCommittedProposal(projection, pending.payload, payload, changes);

  // Record the commit on the affected facet(s)'
  // `committedProposalEventId` and `committedAt` so `deriveFacetStatus`
  // can identify "was committed once" without a log re-walk. Owned by
  // `per_facet_status_derivation` +
  // `replay_decompose_commit_marks_component_classification_committed`.
  //
  // The four single-target sub-kinds stamp one facet; the two multi-
  // component sub-kinds (`decompose`, `interpretive-split`) stamp N
  // per-component classification facets with the SAME
  // `(committedProposalEventId, committedAt)` pair — the parent
  // proposal commits ONCE, expressed N times for the N components
  // (receivers correlate per-component via `node.id`, per D4 of the
  // refinement). The five structural sub-kinds return `[]` from
  // `facetTargetsForProposal` and stamp nothing.
  for (const target of facetTargetsForProposal(pending.payload)) {
    const facet = facetStateForTarget(projection, target);
    if (facet !== null) {
      facet.committedProposalEventId = payload.proposal_id;
      facet.committedAt = payload.committed_at;
      // Per ADR 0030 Consequences + `pf_projection_facet_status_refactor`:
      // pin the value at commit time so the derivation can detect a
      // later proposal that supersedes the committed candidate (a fresh
      // candidate landing on the facet leaves the commit marker in
      // place but no longer matches the candidate; the derivation reads
      // `committedCandidateValue !== candidateValue` as "the commit is
      // stale"). The facet's `candidateValue` is the source of truth
      // here — `facet.value` is the agreement-layer mirror, populated
      // by `applyCommittedProposal` for the four facet-valued
      // sub-kinds and may lag the candidate in some edge cases.
      facet.committedCandidateValue = facet.candidateValue;
    }
  }

  projection.addCommittedProposal({
    proposalEventId: payload.proposal_id,
    payload: pending.payload,
    committedAt: payload.committed_at,
    // The wire payload's `committed_by` per ADR 0030 §9 maps onto the
    // projection's pre-existing `moderator` field — the field-rename is
    // wire-level only; the projection's internal shape is unchanged.
    moderator: payload.committed_by,
  });

  projection.removePendingProposal(payload.proposal_id);
  changes.push({
    kind: 'pending-proposal-cleared',
    proposalId: payload.proposal_id,
    reason: 'commit',
  });
}

function handleMetaDisagreementMarked(
  projection: Projection,
  payload: MetaDisagreementMarkedPayload,
  changes: ProjectionChange[],
): void {
  // TODO(pf_meta_disagreement_handler_facet_keyed): meta-disagreement-marked
  // payloads are now a `target`-discriminated union per ADR 0030 §2 + §9.
  // The methodology engine still emits the proposal-keyed arm for ALL
  // meta-disagreement marks (per the matching TODO in
  // `apps/server/src/methodology/handlers/markMetaDisagreement.ts`);
  // until the downstream task lands, this projection handler only needs
  // to read the proposal-keyed arm. The facet-keyed arm is a dead
  // branch today and lands a runtime error so any inadvertent emit
  // during the transition surfaces loudly. The downstream task
  // rewrites both halves.
  if (payload.target !== 'proposal') {
    throw new ReplayError(
      `meta-disagreement-marked: target='${payload.target}' arm is not yet implemented in the projection (TODO: pf_meta_disagreement_handler_facet_keyed)`,
    );
  }
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
    // The wire payload's `marked_by` per ADR 0030 §9 maps onto the
    // projection's pre-existing `markedBy` field — the field-rename is
    // wire-level only; the projection's internal shape is unchanged.
    markedBy: payload.marked_by,
    markedAt: payload.marked_at,
  });

  // Transition the affected facet's underlying agreement state to
  // `meta-disagreement` for the four facet-targeting sub-kinds, so
  // `deriveFacetStatus` returns `meta-disagreement` directly. Owned
  // by `per_facet_status_derivation`. Per D2 of
  // `replay_decompose_commit_marks_component_classification_committed`,
  // meta-disagreement on a decompose / interpretive-split marks the
  // proposal as a whole (not per-component facets) — the
  // `firstFacetTargetForVote` wrapper returns `null` for those sub-
  // kinds.
  const target = firstFacetTargetForVote(pending.payload);
  if (target !== null) {
    const facet = facetStateForTarget(projection, target);
    if (facet !== null) {
      facet.status = 'meta-disagreement';
      facet.metaDisagreement = true;
    }
  }

  projection.removePendingProposal(payload.proposal_id);
  changes.push({ kind: 'meta-disagreement-marked', proposalId: payload.proposal_id });
  changes.push({
    kind: 'pending-proposal-cleared',
    proposalId: payload.proposal_id,
    reason: 'meta-disagreement',
  });
}

// Per ADR 0030 §3 + `pf_projection_facet_status_refactor`:
// `withdraw-agreement` is a first-class event kind, distinct from the
// old `vote.choice = 'withdraw'` arm. The handler records the
// participant's withdrawal against the target `(entity, facet)` pair;
// the derivation reads the per-facet `withdrawals` set to surface
// `'withdrawn'` when the withdrawal lands on a committed candidate.
// The methodology engine's invariant ("withdraw only valid against a
// committed facet") is enforced at the propose / vote handlers
// upstream; this projection handler trusts the validated event.
function handleWithdrawAgreement(
  projection: Projection,
  payload: WithdrawAgreementPayload,
  _changes: ProjectionChange[],
): void {
  const target: FacetTarget = {
    entityKind: payload.entity_kind,
    entityId: payload.entity_id,
    facet: payload.facet,
  };
  const facet = facetStateForTarget(projection, target);
  if (facet === null) {
    throw new ReplayError(
      `withdraw-agreement: target ${payload.entity_kind}:${payload.entity_id} facet ${payload.facet} not present`,
    );
  }
  facet.withdrawals.add(payload.participant);
  // No `ProjectionChange` variant for withdraw-agreement yet — the
  // change-feed widening lands in a downstream task that grows the
  // `ProjectionChange` discriminator. The status flip from
  // `'committed'` → `'withdrawn'` is observable via re-derivation;
  // callers consuming `deriveFacetStatus` see the new status on the
  // next call. (Snapshot consumers walk the projection directly and
  // see the withdrawal set on the facet.)
}

function handleSnapshotCreated(
  projection: Projection,
  payload: SnapshotCreatedPayload,
  createdAt: string,
  changes: ProjectionChange[],
): void {
  projection.addSnapshot({
    snapshotId: payload.snapshot_id,
    label: payload.label,
    logPosition: payload.log_position,
    createdAt,
  });
  changes.push({
    kind: 'snapshot-added',
    snapshotId: payload.snapshot_id,
    label: payload.label,
    logPosition: payload.log_position,
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

function applyCommittedProposal(
  projection: Projection,
  proposal: ProposalPayload,
  // TODO(pf_commit_handler_facet_keyed): narrowed to the proposal-keyed
  // arm of the discriminated commit payload — the engine emits only
  // proposal-keyed commits today (see the matching TODO at the
  // handleCommit call site). When the downstream task lands facet-keyed
  // emission, this helper will need to read `(entity_kind, entity_id,
  // facet)` from the facet arm and resolve the structural target via
  // the projection's pending-proposal map.
  commit: ProposalCommitPayload,
  changes: ProjectionChange[],
): void {
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
      changes.push({
        kind: 'facet-updated',
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'classification',
        value: proposal.classification,
        status: 'agreed',
      });
      return;
    }
    case 'set-node-substance': {
      const node = projection.getNode(proposal.node_id);
      if (!node) {
        throw new ReplayError(`commit/set-node-substance: node ${proposal.node_id} not present`);
      }
      node.substanceFacet.value = proposal.value;
      node.substanceFacet.status = 'agreed';
      changes.push({
        kind: 'facet-updated',
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'substance',
        value: proposal.value,
        status: 'agreed',
      });
      return;
    }
    case 'set-edge-substance': {
      const edge = projection.getEdge(proposal.edge_id);
      if (!edge) {
        throw new ReplayError(`commit/set-edge-substance: edge ${proposal.edge_id} not present`);
      }
      edge.substanceFacet.value = proposal.value;
      edge.substanceFacet.status = 'agreed';
      changes.push({
        kind: 'facet-updated',
        entityKind: 'edge',
        entityId: proposal.edge_id,
        facet: 'substance',
        value: proposal.value,
        status: 'agreed',
      });
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
        changes.push({
          kind: 'node-wording-updated',
          nodeId: proposal.node_id,
          wording: proposal.new_wording,
        });
        changes.push({
          kind: 'facet-updated',
          entityKind: 'node',
          entityId: proposal.node_id,
          facet: 'wording',
          value: proposal.new_wording,
          status: 'agreed',
        });
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
      changes.push({
        kind: 'visibility-changed',
        entityKind: 'node',
        entityId: proposal.node_id,
        visible: false,
      });
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
      changes.push({
        kind: 'visibility-changed',
        entityKind: 'node',
        entityId: proposal.parent_node_id,
        visible: false,
      });
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
      changes.push({
        kind: 'visibility-changed',
        entityKind: 'node',
        entityId: proposal.parent_node_id,
        visible: false,
      });
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
        proposalEventId: commit.proposal_id,
        markedAt: commit.committed_at,
      });
      changes.push({
        kind: 'axiom-mark-added',
        nodeId: proposal.node_id,
        participantId: proposal.participant,
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
      changes.push({
        kind: 'visibility-changed',
        entityKind: 'edge',
        entityId: proposal.edge_id,
        visible: false,
      });
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
      changes.push({
        kind: 'node-wording-updated',
        nodeId: proposal.node_id,
        wording: proposal.new_content,
      });
      changes.push({
        kind: 'facet-updated',
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'wording',
        value: proposal.new_content,
        status: 'agreed',
      });
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

export function applyEvent(projection: Projection, event: Event): ProjectionChange[] {
  if (event.sessionId !== projection.sessionId) {
    throw new ReplayError(
      `event ${event.id} session mismatch: event.sessionId=${event.sessionId}, projection.sessionId=${projection.sessionId}`,
    );
  }

  // Sequence-gap / replay / out-of-order check. The contract is
  // "the next event's sequence is exactly lastAppliedSequence + 1."
  // Anything else throws; the throw fires BEFORE any handler
  // mutation so the projection is unchanged.
  const expectedSequence = projection.lastAppliedSequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new OutOfOrderEventError(expectedSequence, event.sequence);
  }

  const changes: ProjectionChange[] = [];
  try {
    switch (event.kind) {
      case 'session-created':
        handleSessionCreated(projection, changes);
        break;
      case 'session-ended':
        handleSessionEnded(projection, event.payload, changes);
        break;
      case 'participant-joined':
        handleParticipantJoined(projection, event.payload, changes);
        break;
      case 'participant-left':
        handleParticipantLeft(projection, event.payload, changes);
        break;
      case 'node-created':
        handleNodeCreated(projection, event.payload, changes);
        break;
      case 'edge-created':
        handleEdgeCreated(projection, event.payload, changes);
        break;
      case 'annotation-created':
        handleAnnotationCreated(projection, event.payload, changes);
        break;
      case 'entity-included':
        handleEntityIncluded(projection, event.payload, changes);
        break;
      case 'proposal':
        handleProposal(projection, event.id, event.actor, event.createdAt, event.payload, changes);
        break;
      case 'vote':
        handleVote(projection, event.payload, changes);
        break;
      case 'commit':
        handleCommit(projection, event.payload, changes);
        break;
      case 'meta-disagreement-marked':
        handleMetaDisagreementMarked(projection, event.payload, changes);
        break;
      case 'snapshot-created':
        handleSnapshotCreated(projection, event.payload, event.createdAt, changes);
        break;
      case 'entity-removed':
        handleEntityRemoved(projection, event.payload, changes);
        break;
      case 'session-mode-changed':
        handleSessionModeChanged(projection, event.payload, changes);
        break;
      case 'withdraw-agreement':
        handleWithdrawAgreement(projection, event.payload, changes);
        break;
    }
  } catch (cause) {
    // Atomicity floor: the per-handler mutation might have
    // partially mutated the projection before the throw. We do
    // not roll back here — the storage layer's mutators each
    // throw if they hit an invariant, and the handlers above are
    // straight-line code. A mid-handler throw leaves the
    // projection in whatever state the storage-layer mutators
    // landed; the caller's recovery story is to discard the
    // projection and rebuild from the event log via
    // `projectFromLog` (which is the safe path for any
    // projection-level fault). Critically we do NOT advance
    // `lastAppliedSequence` on a failed apply.
    if (cause instanceof ReplayError) throw cause;
    if (cause instanceof ProjectionInvariantError) {
      throw new ReplayError(
        `event ${event.id} (${event.kind}, sequence=${event.sequence}): ${cause.message}`,
        { cause },
      );
    }
    throw cause;
  }

  projection.setLastAppliedSequence(event.sequence);
  return changes;
}

export function projectFromLog(events: readonly Event[], sessionId: string): Projection {
  const projection = createEmptyProjection(sessionId);
  for (const event of events) applyEvent(projection, event);
  return projection;
}
