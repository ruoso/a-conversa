// Tests for `deriveEdgeShapeStatus` — the narrow per-edge shape-facet
// status derivation that gates the inline `<EdgeShapeCommitAffordance>`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_shape_commit_affordance.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the three-value
// rollup (`'agreed' | 'committed' | 'other'`) against synthetic event
// logs covering each rule branch from `edgeShapeStatus.ts`:
//   1. Empty / edge-not-found → 'other'.
//   2. edge-created + no votes → 'other' (not all participants agreed).
//   3. edge-created + every current participant voted agree → 'agreed'.
//   4. Agreed + dispute → 'other' (Rule 4 in derive: dispute disqualifies).
//   5. Agreed + commit → 'committed'.
//   6. Agreed + meta-disagreement → 'other' (Rule 1: short-circuit).
//   7. Agreed + withdraw-agreement → 'other' (Rule 3: withdrawal exits).
//   8. Moderator's join is excluded (only debaters count toward unanimity).
//   9. Participant who left does not count toward unanimity.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { deriveEdgeShapeStatus } from './edgeShapeStatus';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const MODERATOR = '00000000-0000-4000-8000-0000000000ab';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
const NODE_S = '00000000-0000-4000-8000-00000000000a';
const NODE_T = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function joinedEvent(
  seq: number,
  userId: string,
  role: 'debater-A' | 'debater-B' | 'moderator',
): Event {
  return {
    id: envId('j', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-joined',
    actor: ACTOR,
    payload: {
      user_id: userId,
      role,
      screen_name: 'Test',
      joined_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function leftEvent(seq: number, userId: string): Event {
  return {
    id: envId('l', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-left',
    actor: ACTOR,
    payload: {
      user_id: userId,
      left_at: '2026-05-11T00:01:00.000Z',
    },
    createdAt: '2026-05-11T00:01:00.000Z',
  };
}

function edgeCreatedEvent(seq: number, edgeId: string): Event {
  return {
    id: envId('e', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: edgeId,
      source_node_id: NODE_S,
      target_node_id: NODE_T,
      role: 'supports',
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:05.000Z',
    },
    createdAt: '2026-05-11T00:00:05.000Z',
  };
}

function facetVote(
  seq: number,
  edgeId: string,
  participant: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: envId('v', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: edgeId,
      facet: 'shape',
      participant,
      choice,
      voted_at: '2026-05-11T00:00:10.000Z',
    },
    createdAt: '2026-05-11T00:00:10.000Z',
  };
}

function facetCommit(seq: number, edgeId: string): Event {
  return {
    id: envId('c', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: edgeId,
      facet: 'shape',
      committed_by: ACTOR,
      committed_at: '2026-05-11T00:00:20.000Z',
    },
    createdAt: '2026-05-11T00:00:20.000Z',
  };
}

function facetMetaDisagreement(seq: number, edgeId: string): Event {
  return {
    id: envId('m', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'meta-disagreement-marked',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: edgeId,
      facet: 'shape',
      marked_by: ACTOR,
      marked_at: '2026-05-11T00:00:30.000Z',
    },
    createdAt: '2026-05-11T00:00:30.000Z',
  };
}

function withdrawAgreementEvent(seq: number, edgeId: string, participant: string): Event {
  return {
    id: envId('w', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'withdraw-agreement',
    actor: participant,
    payload: {
      entity_kind: 'edge',
      entity_id: edgeId,
      facet: 'shape',
      participant,
      withdrawn_at: '2026-05-11T00:00:25.000Z',
    },
    createdAt: '2026-05-11T00:00:25.000Z',
  };
}

describe('deriveEdgeShapeStatus — base cases', () => {
  it('returns "other" for an empty event log', () => {
    expect(deriveEdgeShapeStatus([], EDGE_E)).toBe('other');
  });

  it('returns "other" when the edge id is not in the log', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });

  it('returns "other" for an edge-created with no votes (zero participants agreed)', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });

  it('returns "other" when only one of two current participants has voted agree', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });
});

describe('deriveEdgeShapeStatus — agreed gate', () => {
  it('returns "agreed" when every current participant has voted agree', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
      facetVote(5, EDGE_E, PARTICIPANT_B, 'agree'),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('agreed');
  });

  it('excludes the moderator from unanimity (only debater-A + debater-B count)', () => {
    const events: Event[] = [
      joinedEvent(1, MODERATOR, 'moderator'),
      joinedEvent(2, PARTICIPANT_A, 'debater-A'),
      joinedEvent(3, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(4, EDGE_E),
      facetVote(5, EDGE_E, PARTICIPANT_A, 'agree'),
      facetVote(6, EDGE_E, PARTICIPANT_B, 'agree'),
    ];
    // Moderator never votes; both debaters did → 'agreed'.
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('agreed');
  });

  it('excludes a participant who has left from the unanimity count', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
      leftEvent(5, PARTICIPANT_B),
    ];
    // After B leaves, only A is a current participant; A agreed → 'agreed'.
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('agreed');
  });
});

describe('deriveEdgeShapeStatus — committed / meta-disagreement / withdraw', () => {
  it('returns "committed" once a facet-arm commit on (edge, shape) lands', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
      facetVote(5, EDGE_E, PARTICIPANT_B, 'agree'),
      facetCommit(6, EDGE_E),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('committed');
  });

  it('returns "other" when a participant disputes the shape facet', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
      facetVote(5, EDGE_E, PARTICIPANT_B, 'dispute'),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });

  it('returns "other" when a meta-disagreement-marked event short-circuits', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
      facetVote(5, EDGE_E, PARTICIPANT_B, 'agree'),
      facetMetaDisagreement(6, EDGE_E),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });

  it('returns "other" when a withdraw-agreement against (edge, shape) lands', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVote(4, EDGE_E, PARTICIPANT_A, 'agree'),
      facetVote(5, EDGE_E, PARTICIPANT_B, 'agree'),
      withdrawAgreementEvent(6, EDGE_E, PARTICIPANT_A),
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });
});

describe('deriveEdgeShapeStatus — isolation', () => {
  it('does not bucket votes from a different edge id', () => {
    const OTHER_EDGE = '00000000-0000-4000-8000-00000000000f';
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      edgeCreatedEvent(4, OTHER_EDGE),
      facetVote(5, OTHER_EDGE, PARTICIPANT_A, 'agree'),
      facetVote(6, OTHER_EDGE, PARTICIPANT_B, 'agree'),
    ];
    // Votes are against OTHER_EDGE; EDGE_E should remain 'other'.
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
    expect(deriveEdgeShapeStatus(events, OTHER_EDGE)).toBe('agreed');
  });

  it('ignores proposal-arm votes (no shape proposal sub-kind exists)', () => {
    // A defensive case: a malformed log that records a proposal-arm
    // vote against some proposal id should NOT contribute to shape
    // unanimity (the helper only reads facet-arm votes for (edge, shape)).
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      {
        id: envId('v', 4),
        sessionId: SESSION,
        sequence: 4,
        kind: 'vote',
        actor: PARTICIPANT_A,
        payload: {
          target: 'proposal',
          proposal_id: '00000000-0000-4000-8000-0000000000fa',
          participant: PARTICIPANT_A,
          choice: 'agree',
          voted_at: '2026-05-11T00:00:10.000Z',
        },
        createdAt: '2026-05-11T00:00:10.000Z',
      },
    ];
    expect(deriveEdgeShapeStatus(events, EDGE_E)).toBe('other');
  });
});
