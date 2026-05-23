// Tests for `detectPendingConsequences`.
//
// Refinement: tasks/refinements/data-and-methodology/pending_consequences_stub.md
// TaskJuggler: data_and_methodology.diagnostics.pending_consequences_stub
//
// Coverage (per Acceptance criteria in the refinement):
//   - Empty projection -> no pending consequences.
//   - Edge substance proposed -> not a pending consequence (the
//     relation itself isn't settled).
//   - Edge substance agreed + source substance agreed -> not a
//     pending consequence (this is an active edge).
//   - Edge substance agreed + source substance proposed -> one pending
//     consequence with reason 'source-substance-proposed'.
//   - Edge substance committed + source substance disputed -> one
//     pending consequence with reason 'source-substance-disputed'.
//   - Edge substance agreed + source substance meta-disagreed -> one
//     pending consequence with reason
//     'source-substance-meta-disagreement'.
//   - Non-visible edge (committed break-edge) -> excluded.
//
// Additional sanity checks of the boundary rules in the refinement:
//   - Edge substance committed-disputed -> excluded (edge half does
//     not establish truth).
//   - Both substances settled with value 'disputed' -> excluded
//     (edge half fails the value check).
//   - Edge substance agreed + source agreed but value 'disputed'
//     (settled-not-true source) -> excluded.
//
// Reuses the seedSession / proposeSetX / castVote / commit /
// markMetaDisagreement helper pattern from
// `active-firing.test.ts` and `contradiction-detection.test.ts`.
// Each test builds a fresh projection via TS-literal events and
// applies them through `applyEvent`; no DB.

import { describe, expect, it } from 'vitest';

import type { Event, EdgeRole } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import { detectPendingConsequences } from './pending-consequences.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111cc';

const HOST_ID = '22222222-2222-4222-8222-22222222220c';
const MODERATOR_ID = '33333333-3333-4333-8333-33333333330c';
const DEBATER_A_ID = '44444444-4444-4444-8444-44444444440c';
const DEBATER_B_ID = '55555555-5555-4555-8555-55555555550c';

const SOURCE_NODE_ID = '66666666-6666-4666-8666-66666666600c';
const TARGET_NODE_ID = '66666666-6666-4666-8666-66666666601c';

const EDGE_ID = '77777777-7777-4777-8777-77777777700c';

const T0 = '2026-05-10T13:00:00Z';
const T1 = '2026-05-10T13:00:01Z';
const T2 = '2026-05-10T13:00:02Z';
const T3 = '2026-05-10T13:00:03Z';
const T4 = '2026-05-10T13:00:04Z';
const T7 = '2026-05-10T13:00:07Z';
const T8 = '2026-05-10T13:00:08Z';

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

let seq = 1;
let propCounter = 0x200;

function nextSeq(): number {
  return seq++;
}

function resetSeq(): void {
  seq = 1;
  propCounter = 0x200;
}

function nextProposalId(): string {
  propCounter++;
  const hex = propCounter.toString(16).padStart(12, '0');
  return `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
}

type Projection = ReturnType<typeof createEmptyProjection>;

function seedSession(): Projection {
  const projection = createEmptyProjection(SESSION_ID);
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 't',
      created_at: T0,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'M',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'participant-joined', DEBATER_A_ID, T1, {
      user_id: DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'A',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'participant-joined', DEBATER_B_ID, T1, {
      user_id: DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'B',
      joined_at: T1,
    }),
  );
  return projection;
}

function createNode(projection: Projection, nodeId: string, wording: string): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'node-created', DEBATER_A_ID, T2, {
      node_id: nodeId,
      wording,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function createEdge(
  projection: Projection,
  edgeId: string,
  source: string,
  target: string,
  role: EdgeRole = 'supports',
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role,
      source_node_id: source,
      target_node_id: target,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function castVote(
  projection: Projection,
  proposalId: string,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
  voteTime: string = T4,
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'vote', participant, voteTime, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: voteTime,
    }),
  );
}

function commit(projection: Projection, proposalId: string): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'commit', MODERATOR_ID, T7, {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: MODERATOR_ID,
      committed_at: T7,
    }),
  );
}

function markMetaDisagreement(projection: Projection, proposalId: string): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'meta-disagreement-marked', MODERATOR_ID, T8, {
      proposal_id: proposalId,
      moderator: MODERATOR_ID,
      marked_at: T8,
    }),
  );
}

function allAgree(projection: Projection, proposalId: string): void {
  castVote(projection, proposalId, MODERATOR_ID, 'agree');
  castVote(projection, proposalId, DEBATER_A_ID, 'agree');
  castVote(projection, proposalId, DEBATER_B_ID, 'agree');
}

function proposeNodeSubstance(
  projection: Projection,
  nodeId: string,
  value: 'agreed' | 'disputed' = 'agreed',
): string {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value },
    }),
    id: proposalId,
  });
  return proposalId;
}

function proposeEdgeSubstance(
  projection: Projection,
  edgeId: string,
  value: 'agreed' | 'disputed' = 'agreed',
): string {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value },
    }),
    id: proposalId,
  });
  return proposalId;
}

function commitNodeAgreed(projection: Projection, nodeId: string): void {
  const proposalId = proposeNodeSubstance(projection, nodeId, 'agreed');
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

function commitEdgeAgreed(projection: Projection, edgeId: string): void {
  const proposalId = proposeEdgeSubstance(projection, edgeId, 'agreed');
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

function commitNodeDisputed(projection: Projection, nodeId: string): void {
  const proposalId = proposeNodeSubstance(projection, nodeId, 'disputed');
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

function commitEdgeDisputed(projection: Projection, edgeId: string): void {
  const proposalId = proposeEdgeSubstance(projection, edgeId, 'disputed');
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

function commitBreakEdge(projection: Projection, edgeId: string): void {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'break-edge', edge_id: edgeId },
    }),
    id: proposalId,
  });
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

// Seed a session with one source node, one target node, and an edge
// connecting them. Edge role is irrelevant for this detector; we use
// `supports` as the default (a plausible "pending consequence" shape
// is "A would support B, if A were established").
function seedSessionWithEdge(role: EdgeRole = 'supports'): Projection {
  const projection = seedSession();
  createNode(projection, SOURCE_NODE_ID, 'Source statement.');
  createNode(projection, TARGET_NODE_ID, 'Target statement.');
  createEdge(projection, EDGE_ID, SOURCE_NODE_ID, TARGET_NODE_ID, role);
  return projection;
}

// ---------------------------------------------------------------
// No pending consequence.
// ---------------------------------------------------------------

describe('detectPendingConsequences — no pending consequences', () => {
  it('empty projection → no pending consequences', () => {
    resetSeq();
    const projection = seedSession();
    expect(detectPendingConsequences(projection)).toEqual([]);
  });

  it("edge substance proposed → not a pending consequence (the relation itself isn't settled)", () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    // Edge substance has a proposal but no full agree-pass / commit.
    proposeEdgeSubstance(projection, EDGE_ID, 'agreed');
    // Source substance is also still proposed — doesn't matter; the
    // edge half is what fails the detector first.
    expect(detectPendingConsequences(projection)).toEqual([]);
  });

  it('edge substance agreed + source substance agreed → not a pending consequence (active edge)', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    commitEdgeAgreed(projection, EDGE_ID);
    commitNodeAgreed(projection, SOURCE_NODE_ID);
    // This IS active firing per `isEdgeActive`. The detector explicitly
    // excludes it.
    expect(detectPendingConsequences(projection)).toEqual([]);
  });

  it('edge substance committed-disputed + source substance proposed → excluded (edge half fails value check)', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    // Edge substance committed with value 'disputed' — settled, but
    // settled-not-true. The detector's edge half requires effective
    // value 'agreed'.
    commitEdgeDisputed(projection, EDGE_ID);
    expect(detectPendingConsequences(projection)).toEqual([]);
  });

  it('edge substance agreed + source substance committed-disputed → excluded (settled-not-true source)', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    commitEdgeAgreed(projection, EDGE_ID);
    // Source is settled, just with value 'disputed'. The methodology
    // has agreed the source's content is not true; the edge will never
    // fire. Excluded per the refinement Decisions.
    commitNodeDisputed(projection, SOURCE_NODE_ID);
    expect(detectPendingConsequences(projection)).toEqual([]);
  });

  it('non-visible edge (committed break-edge) → excluded', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    commitEdgeAgreed(projection, EDGE_ID);
    // Sanity: would be a pending consequence absent the break.
    expect(detectPendingConsequences(projection)).toHaveLength(1);
    commitBreakEdge(projection, EDGE_ID);
    expect(detectPendingConsequences(projection)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Pending consequence detected — three reason flavors.
// ---------------------------------------------------------------

describe('detectPendingConsequences — pending consequences detected', () => {
  it('edge substance agreed + source substance proposed → one entry, reason source-substance-proposed', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    commitEdgeAgreed(projection, EDGE_ID);
    // Source substance: no proposal at all → derived status 'proposed'.
    const result = detectPendingConsequences(projection);
    expect(result).toEqual([
      {
        edgeId: EDGE_ID,
        sourceNodeId: SOURCE_NODE_ID,
        reason: 'source-substance-proposed',
      },
    ]);
  });

  it('edge substance committed + source substance disputed → one entry, reason source-substance-disputed', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    commitEdgeAgreed(projection, EDGE_ID);
    // Source substance: proposal exists, at least one dispute vote,
    // no commit and not meta-disagreement-marked → derived status
    // 'disputed'.
    const proposalId = proposeNodeSubstance(projection, SOURCE_NODE_ID, 'agreed');
    castVote(projection, proposalId, MODERATOR_ID, 'agree');
    castVote(projection, proposalId, DEBATER_A_ID, 'agree');
    castVote(projection, proposalId, DEBATER_B_ID, 'dispute');
    const result = detectPendingConsequences(projection);
    expect(result).toEqual([
      {
        edgeId: EDGE_ID,
        sourceNodeId: SOURCE_NODE_ID,
        reason: 'source-substance-disputed',
      },
    ]);
  });

  it('edge substance agreed + source substance meta-disagreed → one entry, reason source-substance-meta-disagreement', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    commitEdgeAgreed(projection, EDGE_ID);
    // Source substance: proposal disputed, then meta-disagreement-marked.
    const proposalId = proposeNodeSubstance(projection, SOURCE_NODE_ID, 'agreed');
    castVote(projection, proposalId, MODERATOR_ID, 'agree');
    castVote(projection, proposalId, DEBATER_A_ID, 'dispute');
    castVote(projection, proposalId, DEBATER_B_ID, 'dispute');
    markMetaDisagreement(projection, proposalId);
    const result = detectPendingConsequences(projection);
    expect(result).toEqual([
      {
        edgeId: EDGE_ID,
        sourceNodeId: SOURCE_NODE_ID,
        reason: 'source-substance-meta-disagreement',
      },
    ]);
  });

  it('defeater-style rebuts (agreed substance, source not yet established) → one entry with rebuts edge', () => {
    resetSeq();
    // The canonical worked example per data-model.md line 102: a
    // pre-committed `rebuts` whose source isn't yet substantively
    // established. The detector treats `rebuts` identically to every
    // other role — what matters is the structural shape.
    const projection = seedSessionWithEdge('rebuts');
    commitEdgeAgreed(projection, EDGE_ID);
    const result = detectPendingConsequences(projection);
    expect(result).toEqual([
      {
        edgeId: EDGE_ID,
        sourceNodeId: SOURCE_NODE_ID,
        reason: 'source-substance-proposed',
      },
    ]);
  });
});
