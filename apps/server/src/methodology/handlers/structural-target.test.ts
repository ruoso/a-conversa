// Structural-handler proposal-target pin tests.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_structural_handlers_unchanged.md
// TaskJuggler: per_facet_refactor.server_handlers.pf_structural_handlers_unchanged
// ADR: docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md §9
//
// **Purpose — pin the contract.** Per ADR 0030 §9, the six structural
// proposal sub-kinds — `decompose`, `interpretive-split`, `axiom-mark`,
// `annotate`, `meta-move`, `break-edge` — retain their proposal-id-
// keyed vote / commit / meta-disagreement-marked envelopes under the
// `target: 'proposal'` branch of the discriminated union (the four
// facet-valued sub-kinds emit `target: 'facet'` per §2). The two
// patterns coexist by design.
//
// The sibling-task tests (`vote.test.ts`, `commit.test.ts`,
// `markMetaDisagreement.test.ts`) cover the rule sets per arm; this
// file pins the **mixed-model contract** explicitly. If a future
// implementer accidentally tries to facet-key a structural proposal's
// vote / commit / meta-mark — or removes the proposal-keyed arm of the
// dispatch — these tests fail loudly, directing the reader back to
// ADR 0030 §9 for the rationale.
//
// **Test surfaces are the contract.** Per the refinement's "Decisions"
// section: "Tests are the contract. A future reader who edits the
// structural handlers and breaks the proposal-target path will see
// these tests fail, and the failure will direct them to ADR 0030 §9
// for the rationale."
//
// Coverage shape (one round-trip per structural sub-kind):
//
//   1. Seed a session with the entity each sub-kind needs.
//   2. Land the structural proposal at the next sequence (using the
//      same `propose` event the methodology engine would emit).
//   3. Issue unanimous-agree `vote` events with `target: 'proposal'`
//      (NOT `target: 'facet'`), one per debater. Assert the projection
//      records them on the pending proposal's `perParticipantVotes`
//      map (the structural-arm store), NOT on any facet's
//      `perParticipant` map.
//   4. Issue a `commit` event with `target: 'proposal'` (NOT
//      `target: 'facet'`). Assert it goes through and lands on the
//      projection's `committedProposals` map.
//
// Plus, for at least one structural sub-kind (decompose, picked as
// canonical), a `meta-disagreement-marked` round-trip with
// `target: 'proposal'`: applies the event directly onto the projection
// (the methodology engine's meta-disagreement handler currently rejects
// structural sub-kinds at the rule-4 boundary per
// `meta_disagreement_logic`; structural meta-mark semantics are
// deferred to the per-sub-kind sibling tasks — but the projection-arm
// of `handleMetaDisagreementMarked` accepts `target: 'proposal'`
// envelopes and that is what this test pins).
//
// Schema-layer cross-arm rejection (a malformed `target: 'facet'`
// payload sent against a structural proposal) is already covered by the
// Zod discriminated-union tests at
// `packages/shared-types/src/events.test.ts` ("rejects a facet-arm
// payload that ALSO carries proposal_id (cross-arm corruption)" and
// siblings). This file adds the **runtime cross-arm pin** at the
// handler dispatch site: a vote-validate call against a structural
// proposal MUST emit `target: 'proposal'` (the validator never emits
// the facet arm for a structural sub-kind; the dispatcher's
// `facetTargetForProposal === null` branch is the discriminator).

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type CommitAction, type VoteAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111ff';

const HOST_ID = '22222222-2222-4222-8222-2222222222ff';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333333ff';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444444ff';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555555ff';

const PARENT_NODE_ID = '66666666-6666-4666-8666-6666666666ff';
const SECOND_NODE_ID = '77777777-7777-4777-8777-7777777777ff';
const EDGE_ID = '88888888-8888-4888-8888-8888888888ff';

// Per-sub-kind structural-proposal ids (each test seeds its own
// proposal at a distinct id to avoid collisions when describe blocks
// share fixtures).
const DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const INTERPRETIVE_SPLIT_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const AXIOM_MARK_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
const ANNOTATE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc04';
const META_MOVE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc05';
const BREAK_EDGE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc06';

// Per-sub-kind component / reading node ids for the multi-entity sub-
// kinds (decompose / interpretive-split). The methodology engine emits
// these via `node-created` + `entity-included` at propose-time per
// ADR 0027; the seeds below mirror that fan-out.
const DECOMPOSE_COMPONENT_1_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
const DECOMPOSE_COMPONENT_2_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';
const SPLIT_READING_1_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03';
const SPLIT_READING_2_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04';

const VOTE_A_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const VOTE_B_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
const COMMIT_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd03';
const META_MARK_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd04';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T9 = '2026-05-10T12:00:09Z';

function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function makeEvent<K extends Event['kind']>(
  sequence: number,
  kind: K,
  actor: string | null,
  createdAt: string,
  payload: Extract<Event, { kind: K }>['payload'],
): Extract<Event, { kind: K }> {
  return {
    id: evId(sequence),
    sessionId: SESSION_ID,
    sequence,
    kind,
    actor,
    payload,
    createdAt,
  } as Extract<Event, { kind: K }>;
}

// Seed a session with three participants, two visible nodes, and a
// `supports` edge between them. Each describe block layers in the
// structural-sub-kind-specific proposal event(s) on top of this base.
function seedSessionBase(): ReturnType<typeof createEmptyProjection> {
  const projection = createEmptyProjection(SESSION_ID);
  applyEvent(
    projection,
    makeEvent(1, 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 'Structural handler pin tests.',
      created_at: T0,
    }),
  );
  applyEvent(
    projection,
    makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'M',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(3, 'participant-joined', DEBATER_A_ID, T1, {
      user_id: DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'A',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(4, 'participant-joined', DEBATER_B_ID, T1, {
      user_id: DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'B',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: PARENT_NODE_ID,
      wording: 'A structural-test parent claim.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(6, 'node-created', DEBATER_B_ID, T2, {
      node_id: SECOND_NODE_ID,
      wording: 'A structural-test backing claim.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(7, 'edge-created', DEBATER_B_ID, T2, {
      edge_id: EDGE_ID,
      role: 'supports',
      source_node_id: SECOND_NODE_ID,
      target_node_id: PARENT_NODE_ID,
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Apply propose-time `node-created` + `entity-included` for a structural
// component / reading, mirroring `buildStructuralEventsForPropose` in
// `apps/server/src/methodology/handlers/propose.ts`.
function applyComponentCreate(
  projection: ReturnType<typeof createEmptyProjection>,
  nodeId: string,
  wording: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'node-created', DEBATER_A_ID, T2, {
      node_id: nodeId,
      wording,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'node',
      entity_id: nodeId,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
}

// ---------------------------------------------------------------
// Per-sub-kind helpers.
//
// Each `seedFooProposal` walks the projection forward by appending the
// `propose` event (and its propose-time structural fan-out, for the
// sub-kinds that have one). Returns nothing; the caller reads back
// state through the projection's methods.
// ---------------------------------------------------------------

function seedDecomposeProposal(projection: ReturnType<typeof createEmptyProjection>): void {
  applyComponentCreate(projection, DECOMPOSE_COMPONENT_1_ID, 'Decompose component one.');
  applyComponentCreate(projection, DECOMPOSE_COMPONENT_2_ID, 'Decompose component two.');
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'decompose',
        parent_node_id: PARENT_NODE_ID,
        components: [
          {
            wording: 'Decompose component one.',
            classification: 'fact',
            node_id: DECOMPOSE_COMPONENT_1_ID,
          },
          {
            wording: 'Decompose component two.',
            classification: 'value',
            node_id: DECOMPOSE_COMPONENT_2_ID,
          },
        ],
      },
    }),
    id: DECOMPOSE_PROPOSAL_ID,
  });
}

function seedInterpretiveSplitProposal(projection: ReturnType<typeof createEmptyProjection>): void {
  applyComponentCreate(projection, SPLIT_READING_1_ID, 'Interpretive reading one.');
  applyComponentCreate(projection, SPLIT_READING_2_ID, 'Interpretive reading two.');
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: PARENT_NODE_ID,
        readings: [
          {
            wording: 'Interpretive reading one.',
            classification: 'fact',
            node_id: SPLIT_READING_1_ID,
          },
          {
            wording: 'Interpretive reading two.',
            classification: 'value',
            node_id: SPLIT_READING_2_ID,
          },
        ],
      },
    }),
    id: INTERPRETIVE_SPLIT_PROPOSAL_ID,
  });
}

function seedAxiomMarkProposal(projection: ReturnType<typeof createEmptyProjection>): void {
  // The declarer is DEBATER_A — per the axiom-mark methodology rule
  // (see `commit.ts`'s `checkUnanimousAgreeStructural`), the declared
  // participant is excluded from the required-voters set; only the
  // OTHER debaters need to vote agree. This shapes how the test
  // unanimity is constructed below: only DEBATER_B votes.
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'axiom-mark',
        node_id: PARENT_NODE_ID,
        participant: DEBATER_A_ID,
      },
    }),
    id: AXIOM_MARK_PROPOSAL_ID,
  });
}

function seedAnnotateProposal(projection: ReturnType<typeof createEmptyProjection>): void {
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: PARENT_NODE_ID,
        annotation_kind: 'note',
        content: 'Context for the parent node.',
      },
    }),
    id: ANNOTATE_PROPOSAL_ID,
  });
}

function seedMetaMoveProposal(projection: ReturnType<typeof createEmptyProjection>): void {
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'The real question is the operational form, not the surface phrasing.',
        target_kind: 'node',
        target_id: PARENT_NODE_ID,
      },
    }),
    id: META_MOVE_PROPOSAL_ID,
  });
}

function seedBreakEdgeProposal(projection: ReturnType<typeof createEmptyProjection>): void {
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'break-edge',
        edge_id: EDGE_ID,
      },
    }),
    id: BREAK_EDGE_PROPOSAL_ID,
  });
}

// Build a `vote` action at the next sequence — proposal-target shape.
// The methodology engine's vote dispatcher reads
// `facetTargetForProposal(proposal.payload) === null` for structural
// sub-kinds and emits `target: 'proposal'`; this helper constructs the
// action whose emission the test then asserts.
function makeVoteAction(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string,
  vote: 'agree' | 'dispute',
  proposalEventId: string,
  eventId: string,
): VoteAction {
  return {
    kind: 'vote',
    target: 'proposal',
    requester,
    sessionId: SESSION_ID,
    eventId,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposalEventId,
    vote,
    votedAt: T9,
  };
}

// Build a `commit` action at the next sequence for the moderator.
function makeCommitAction(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalEventId: string,
): CommitAction {
  return {
    kind: 'commit',
    target: 'proposal',
    requester: MODERATOR_ID,
    sessionId: SESSION_ID,
    eventId: COMMIT_EVENT_ID,
    sequence: nextSequence(projection),
    actor: MODERATOR_ID,
    createdAt: T9,
    proposalEventId,
    committedAt: T9,
  };
}

// Drive a vote action through the engine and apply the emitted event
// onto the projection so subsequent reads see the recorded vote.
function castVote(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string,
  proposalEventId: string,
  eventId: string,
): void {
  const action = makeVoteAction(projection, requester, 'agree', proposalEventId, eventId);
  const r = validateAction(projection, action);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.events).toHaveLength(1);
  const ev = r.events[0]!;
  expect(ev.kind).toBe('vote');
  if (ev.kind !== 'vote') return;
  // Pin: the structural-vote arm of the dispatcher emits
  // `target: 'proposal'` per ADR 0030 §9. If a future refactor flips
  // this to `target: 'facet'` for a structural sub-kind, this assertion
  // catches it.
  expect(ev.payload.target).toBe('proposal');
  if (ev.payload.target !== 'proposal') return;
  expect(ev.payload.proposal_id).toBe(proposalEventId);
  expect(ev.payload.participant).toBe(requester);
  applyEvent(projection, ev);
}

// ---------------------------------------------------------------
// Per-sub-kind round-trip pins.
//
// Each test:
//   1. Seeds the proposal.
//   2. Casts `agree` votes (proposal-keyed) from the participants
//      whose agreement is required.
//   3. Reads back the recorded votes from the pending proposal's
//      `perParticipantVotes` map — proving the structural-arm of the
//      projection replay populates the right store.
//   4. Commits via the moderator and asserts the commit event's
//      `target: 'proposal'` shape and `proposal_id` field.
//   5. Applies the commit and confirms the proposal is now in the
//      `committedProposals` map.
// ---------------------------------------------------------------

describe('structural-target pin — decompose', () => {
  it('round-trips a decompose proposal through proposal-keyed votes and commit', () => {
    const p = seedSessionBase();
    seedDecomposeProposal(p);

    castVote(p, MODERATOR_ID, DECOMPOSE_PROPOSAL_ID, VOTE_A_EVENT_ID);
    castVote(p, DEBATER_A_ID, DECOMPOSE_PROPOSAL_ID, VOTE_B_EVENT_ID);
    castVote(p, DEBATER_B_ID, DECOMPOSE_PROPOSAL_ID, evId(900));

    // Per-participant votes live on the pending proposal's
    // `perParticipantVotes` map for structural sub-kinds (NOT on any
    // facet's `perParticipant`). This is the projection-arm pin.
    const pending = p.getPendingProposal(DECOMPOSE_PROPOSAL_ID);
    expect(pending).toBeDefined();
    expect(pending?.perParticipantVotes.size).toBe(3);
    expect(pending?.perParticipantVotes.get(DEBATER_A_ID)?.vote).toBe('agree');
    expect(pending?.perParticipantVotes.get(DEBATER_B_ID)?.vote).toBe('agree');

    const commitAction = makeCommitAction(p, DECOMPOSE_PROPOSAL_ID);
    const commitResult = validateAction(p, commitAction);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    expect(commitResult.events).toHaveLength(1);
    const commitEvent = commitResult.events[0]!;
    expect(commitEvent.kind).toBe('commit');
    if (commitEvent.kind !== 'commit') return;
    // Pin: the commit dispatcher emits `target: 'proposal'` for
    // structural sub-kinds per ADR 0030 §9. The presence of a
    // `proposal_id` field (and absence of `entity_kind` / `facet`) is
    // the wire-shape contract.
    expect(commitEvent.payload.target).toBe('proposal');
    if (commitEvent.payload.target !== 'proposal') return;
    expect(commitEvent.payload.proposal_id).toBe(DECOMPOSE_PROPOSAL_ID);
    expect(commitEvent.payload.committed_by).toBe(MODERATOR_ID);

    applyEvent(p, commitEvent);
    // After commit the proposal moves to committedProposals and is
    // removed from pendingProposals — the proposal-keyed arm of
    // `handleCommit` per ADR 0030 §9.
    expect(p.getCommittedProposal(DECOMPOSE_PROPOSAL_ID)).toBeDefined();
    expect(p.getPendingProposal(DECOMPOSE_PROPOSAL_ID)).toBeUndefined();
  });
});

describe('structural-target pin — interpretive-split', () => {
  it('round-trips an interpretive-split proposal through proposal-keyed votes and commit', () => {
    const p = seedSessionBase();
    seedInterpretiveSplitProposal(p);

    castVote(p, MODERATOR_ID, INTERPRETIVE_SPLIT_PROPOSAL_ID, VOTE_A_EVENT_ID);
    castVote(p, DEBATER_A_ID, INTERPRETIVE_SPLIT_PROPOSAL_ID, VOTE_B_EVENT_ID);
    castVote(p, DEBATER_B_ID, INTERPRETIVE_SPLIT_PROPOSAL_ID, evId(901));

    const pending = p.getPendingProposal(INTERPRETIVE_SPLIT_PROPOSAL_ID);
    expect(pending).toBeDefined();
    expect(pending?.perParticipantVotes.size).toBe(3);

    const commitAction = makeCommitAction(p, INTERPRETIVE_SPLIT_PROPOSAL_ID);
    const commitResult = validateAction(p, commitAction);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    const commitEvent = commitResult.events[0]!;
    expect(commitEvent.kind).toBe('commit');
    if (commitEvent.kind !== 'commit') return;
    expect(commitEvent.payload.target).toBe('proposal');
    if (commitEvent.payload.target !== 'proposal') return;
    expect(commitEvent.payload.proposal_id).toBe(INTERPRETIVE_SPLIT_PROPOSAL_ID);

    applyEvent(p, commitEvent);
    expect(p.getCommittedProposal(INTERPRETIVE_SPLIT_PROPOSAL_ID)).toBeDefined();
  });
});

describe('structural-target pin — axiom-mark', () => {
  it('round-trips an axiom-mark proposal through proposal-keyed votes and commit (declarer is excluded from the required set)', () => {
    const p = seedSessionBase();
    seedAxiomMarkProposal(p);

    // DEBATER_A is the declarer — they don't vote. Only DEBATER_B's
    // agree (plus the moderator's optional vote) is required.
    castVote(p, MODERATOR_ID, AXIOM_MARK_PROPOSAL_ID, VOTE_A_EVENT_ID);
    castVote(p, DEBATER_B_ID, AXIOM_MARK_PROPOSAL_ID, VOTE_B_EVENT_ID);

    const pending = p.getPendingProposal(AXIOM_MARK_PROPOSAL_ID);
    expect(pending).toBeDefined();
    expect(pending?.perParticipantVotes.get(DEBATER_B_ID)?.vote).toBe('agree');

    const commitAction = makeCommitAction(p, AXIOM_MARK_PROPOSAL_ID);
    const commitResult = validateAction(p, commitAction);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    const commitEvent = commitResult.events[0]!;
    expect(commitEvent.kind).toBe('commit');
    if (commitEvent.kind !== 'commit') return;
    expect(commitEvent.payload.target).toBe('proposal');
    if (commitEvent.payload.target !== 'proposal') return;
    expect(commitEvent.payload.proposal_id).toBe(AXIOM_MARK_PROPOSAL_ID);

    applyEvent(p, commitEvent);
    expect(p.getCommittedProposal(AXIOM_MARK_PROPOSAL_ID)).toBeDefined();
  });
});

describe('structural-target pin — annotate', () => {
  it('round-trips an annotate proposal through proposal-keyed votes and commit (commit emits annotation-created + commit)', () => {
    const p = seedSessionBase();
    seedAnnotateProposal(p);

    castVote(p, MODERATOR_ID, ANNOTATE_PROPOSAL_ID, VOTE_A_EVENT_ID);
    castVote(p, DEBATER_A_ID, ANNOTATE_PROPOSAL_ID, VOTE_B_EVENT_ID);
    castVote(p, DEBATER_B_ID, ANNOTATE_PROPOSAL_ID, evId(902));

    const pending = p.getPendingProposal(ANNOTATE_PROPOSAL_ID);
    expect(pending).toBeDefined();
    expect(pending?.perParticipantVotes.size).toBe(3);

    const commitAction = makeCommitAction(p, ANNOTATE_PROPOSAL_ID);
    const commitResult = validateAction(p, commitAction);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    // annotate emits a paired `annotation-created` + `commit` per
    // `commit.ts`'s `buildStructuralEventsForCommit` — the commit
    // envelope is the LAST event in the list. Per ADR 0030 §9 it must
    // still carry `target: 'proposal'`.
    expect(commitResult.events).toHaveLength(2);
    expect(commitResult.events[0]!.kind).toBe('annotation-created');
    const commitEvent = commitResult.events[1]!;
    expect(commitEvent.kind).toBe('commit');
    if (commitEvent.kind !== 'commit') return;
    expect(commitEvent.payload.target).toBe('proposal');
    if (commitEvent.payload.target !== 'proposal') return;
    expect(commitEvent.payload.proposal_id).toBe(ANNOTATE_PROPOSAL_ID);

    // Apply both events in emission order so the annotation lands
    // before the commit (matches the projection's incremental
    // `applyEvent` contract).
    for (const ev of commitResult.events) {
      applyEvent(p, ev);
    }
    expect(p.getCommittedProposal(ANNOTATE_PROPOSAL_ID)).toBeDefined();
  });
});

describe('structural-target pin — meta-move', () => {
  it('round-trips a meta-move proposal through proposal-keyed votes and commit', () => {
    const p = seedSessionBase();
    seedMetaMoveProposal(p);

    castVote(p, MODERATOR_ID, META_MOVE_PROPOSAL_ID, VOTE_A_EVENT_ID);
    castVote(p, DEBATER_A_ID, META_MOVE_PROPOSAL_ID, VOTE_B_EVENT_ID);
    castVote(p, DEBATER_B_ID, META_MOVE_PROPOSAL_ID, evId(903));

    const pending = p.getPendingProposal(META_MOVE_PROPOSAL_ID);
    expect(pending).toBeDefined();
    expect(pending?.perParticipantVotes.size).toBe(3);

    const commitAction = makeCommitAction(p, META_MOVE_PROPOSAL_ID);
    const commitResult = validateAction(p, commitAction);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    const commitEvent = commitResult.events[0]!;
    expect(commitEvent.kind).toBe('commit');
    if (commitEvent.kind !== 'commit') return;
    expect(commitEvent.payload.target).toBe('proposal');
    if (commitEvent.payload.target !== 'proposal') return;
    expect(commitEvent.payload.proposal_id).toBe(META_MOVE_PROPOSAL_ID);

    applyEvent(p, commitEvent);
    expect(p.getCommittedProposal(META_MOVE_PROPOSAL_ID)).toBeDefined();
  });
});

describe('structural-target pin — break-edge', () => {
  it('round-trips a break-edge proposal through proposal-keyed votes and commit', () => {
    const p = seedSessionBase();
    seedBreakEdgeProposal(p);

    castVote(p, MODERATOR_ID, BREAK_EDGE_PROPOSAL_ID, VOTE_A_EVENT_ID);
    castVote(p, DEBATER_A_ID, BREAK_EDGE_PROPOSAL_ID, VOTE_B_EVENT_ID);
    castVote(p, DEBATER_B_ID, BREAK_EDGE_PROPOSAL_ID, evId(904));

    const pending = p.getPendingProposal(BREAK_EDGE_PROPOSAL_ID);
    expect(pending).toBeDefined();
    expect(pending?.perParticipantVotes.size).toBe(3);

    const commitAction = makeCommitAction(p, BREAK_EDGE_PROPOSAL_ID);
    const commitResult = validateAction(p, commitAction);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    const commitEvent = commitResult.events[0]!;
    expect(commitEvent.kind).toBe('commit');
    if (commitEvent.kind !== 'commit') return;
    expect(commitEvent.payload.target).toBe('proposal');
    if (commitEvent.payload.target !== 'proposal') return;
    expect(commitEvent.payload.proposal_id).toBe(BREAK_EDGE_PROPOSAL_ID);

    applyEvent(p, commitEvent);
    expect(p.getCommittedProposal(BREAK_EDGE_PROPOSAL_ID)).toBeDefined();
    // Cross-check: the break-edge commit-arm flips the edge invisible
    // (`handleCommit` break-edge case in `replay.ts`).
    expect(p.getEdge(EDGE_ID)?.visible).toBe(false);
  });
});

// ---------------------------------------------------------------
// Meta-disagreement-marked structural-target round-trip.
//
// Per the refinement's acceptance criteria: "ship a meta-disagreement-
// marked structural-target case [...] with `target: 'proposal'`."
//
// **Boundary clarification.** The methodology engine's
// `markMetaDisagreementHandler` currently rejects structural sub-kinds
// at rule 4 with `'illegal-state-transition'` (per
// `markMetaDisagreement.ts:163-170`); structural meta-mark semantics
// are deferred to the per-sub-kind sibling tasks. Until those land,
// the legal path to a structural meta-mark on the wire is for some
// future handler / replay-tool to emit the event directly.
//
// This test pins the **projection-arm contract** for the proposal-
// keyed envelope: a `meta-disagreement-marked` event with
// `target: 'proposal'` applied to the projection moves the pending
// proposal into `unresolvedMetaDisagreements`. The wire shape is what
// the contract guarantees; the methodology gate is a separate
// (deferred) concern.
// ---------------------------------------------------------------

describe('structural-target pin — meta-disagreement-marked (projection-arm round-trip)', () => {
  it('applies a proposal-keyed meta-disagreement-marked envelope on a decompose proposal and moves it to unresolvedMetaDisagreements', () => {
    const p = seedSessionBase();
    seedDecomposeProposal(p);
    // Layer in one dispute so the structural-meta-mark gate (when /
    // if it gets unlocked downstream) would have something to fire on
    // — and so the test scenario reads as "the moderator marks an
    // impasse the participants couldn't resolve." Per the structural
    // vote arm this lands on `perParticipantVotes`, not on any facet.
    castVote(p, DEBATER_A_ID, DECOMPOSE_PROPOSAL_ID, VOTE_A_EVENT_ID);
    const pendingBefore = p.getPendingProposal(DECOMPOSE_PROPOSAL_ID);
    expect(pendingBefore).toBeDefined();

    // Pin the methodology-handler-side boundary: a meta-disagreement-
    // mark request via the engine on a structural sub-kind is REFUSED
    // with `illegal-state-transition` (the per-sub-kind sibling task
    // owns the eventual relaxation). This catches a future refactor
    // that accidentally routes structural meta-marks through the
    // facet-arm of the validator.
    const markAction = {
      kind: 'mark-meta-disagreement' as const,
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: META_MARK_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposalEventId: DECOMPOSE_PROPOSAL_ID,
      markedAt: T9,
    };
    const markResult = validateAction(p, markAction);
    expect(markResult.ok).toBe(false);
    if (!markResult.ok) {
      expect(markResult.reason).toBe('illegal-state-transition');
      expect(markResult.detail).toContain('decompose');
    }

    // Now apply a `meta-disagreement-marked` envelope DIRECTLY onto
    // the projection with `target: 'proposal'`. This is the wire
    // shape any future structural-meta-mark handler must emit per
    // ADR 0030 §9; the projection's `handleMetaDisagreementMarked`
    // proposal-arm accepts it and routes the proposal to
    // `unresolvedMetaDisagreements`. This is the round-trip pin.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'meta-disagreement-marked', MODERATOR_ID, T9, {
        target: 'proposal' as const,
        proposal_id: DECOMPOSE_PROPOSAL_ID,
        marked_by: MODERATOR_ID,
        marked_at: T9,
      }),
    );

    expect(p.getUnresolvedMetaDisagreement(DECOMPOSE_PROPOSAL_ID)).toBeDefined();
    expect(p.getPendingProposal(DECOMPOSE_PROPOSAL_ID)).toBeUndefined();
  });
});

// ---------------------------------------------------------------
// Cross-arm dispatcher pin — structural votes never emit `target:
// 'facet'`.
//
// The schema layer (`packages/shared-types/src/events.test.ts`)
// already pins the discriminated-union side: a cross-arm-corrupted
// payload (e.g. `target: 'facet'` with a `proposal_id` field) fails
// `safeParse`. This test pins the COMPLEMENTARY discipline at the
// methodology engine's dispatch site: across every structural sub-
// kind, the vote and commit handlers' emitted events MUST carry
// `target: 'proposal'`, never `target: 'facet'`. The
// `facetTargetForProposal` helper in each handler is the discriminator
// (returns `null` for structural sub-kinds → proposal arm); this test
// notices if a future refactor accidentally flips a structural sub-
// kind into the facet arm.
// ---------------------------------------------------------------

describe('structural-target pin — dispatcher never emits facet-arm for structural sub-kinds', () => {
  type SubKindSeeder = (p: ReturnType<typeof createEmptyProjection>) => { proposalId: string };

  const seeders: Record<string, SubKindSeeder> = {
    decompose: (p) => {
      seedDecomposeProposal(p);
      return { proposalId: DECOMPOSE_PROPOSAL_ID };
    },
    'interpretive-split': (p) => {
      seedInterpretiveSplitProposal(p);
      return { proposalId: INTERPRETIVE_SPLIT_PROPOSAL_ID };
    },
    'axiom-mark': (p) => {
      seedAxiomMarkProposal(p);
      return { proposalId: AXIOM_MARK_PROPOSAL_ID };
    },
    annotate: (p) => {
      seedAnnotateProposal(p);
      return { proposalId: ANNOTATE_PROPOSAL_ID };
    },
    'meta-move': (p) => {
      seedMetaMoveProposal(p);
      return { proposalId: META_MOVE_PROPOSAL_ID };
    },
    'break-edge': (p) => {
      seedBreakEdgeProposal(p);
      return { proposalId: BREAK_EDGE_PROPOSAL_ID };
    },
  };

  for (const [subKind, seeder] of Object.entries(seeders)) {
    it(`vote handler emits target: 'proposal' (not 'facet') for ${subKind}`, () => {
      const p = seedSessionBase();
      const { proposalId } = seeder(p);
      const action = makeVoteAction(p, DEBATER_B_ID, 'agree', proposalId, VOTE_A_EVENT_ID);
      const r = validateAction(p, action);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const ev = r.events[0]!;
      expect(ev.kind).toBe('vote');
      if (ev.kind !== 'vote') return;
      expect(ev.payload.target).toBe('proposal');
      // A `target: 'facet'` payload would carry `entity_kind` /
      // `entity_id` / `facet`; the proposal-arm carries `proposal_id`.
      // Asserting both branches catches a hypothetical
      // intersection-typed payload that would pass `expect.toBe`.
      const payload = ev.payload as Record<string, unknown>;
      expect(payload.entity_kind).toBeUndefined();
      expect(payload.entity_id).toBeUndefined();
      expect(payload.facet).toBeUndefined();
      expect(payload.proposal_id).toBe(proposalId);
    });
  }
});
