// Tests for the participant-side per-entity per-facet `FacetStatus`
// derivation.
//
// Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//
// Per ADR 0022 these are committed Vitest cases. The participant's
// `facetStatus.ts` is a verbatim port of the moderator's
// `apps/moderator/src/graph/facetStatus.ts`; these cases mirror the
// moderator's `facetStatus.test.ts` pin shape so a reader cross-
// referencing the two ports sees the same coverage. The refinement's
// Constraints section enumerates the 16 cases:
//
//   (a) empty event log → empty maps
//   (b) classify-node proposal, no votes → 'proposed'
//   (c) classify-node + one agree of two participants → still 'proposed'
//   (d) classify-node + all participants agree → 'agreed'
//   (e) classify-node + a dispute vote → 'disputed'
//   (f) classify-node + all agree + commit → 'committed'
//   (g) committed classify-node + a withdraw-agreement → 'withdrawn'
//   (h) classify-node + mark-meta-disagreement → 'meta-disagreement'
//   (i) a left participant's vote is excluded from the agreement count
//   (j) set-node-substance proposal → substance facet
//   (k) set-edge-substance proposal → edge substance facet
//   (l) edit-wording.reword proposal → wording facet
//   (m) decompose proposal → per-component classification facets
//   (n) interpretive-split proposal → per-reading classification facets
//   (o) out-of-scope sub-kinds (axiom-mark, meta-move, break-edge,
//       annotate) produce no facet entry
//   (p) cardRollupStatus priority-pair coverage (one case per
//       ROLLUP_PRIORITY pair)

import { describe, expect, it } from 'vitest';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import {
  cardRollupStatus,
  computeFacetStatuses,
  EMPTY_FACET_STATUSES,
  ROLLUP_PRIORITY,
  type FacetStatus,
} from './facetStatus';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const NODE_Z = '00000000-0000-4000-8000-00000000000c';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000fe';

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function joinedEvent(seq: number, userId: string, role: 'debater-A' | 'debater-B'): Event {
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
      joined_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
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
      left_at: '2026-05-17T00:01:00.000Z',
    },
    createdAt: '2026-05-17T00:01:00.000Z',
  };
}

function classifyProposal(
  seq: number,
  envelopeId: string,
  nodeId: string,
  classification: StatementKind = 'fact',
): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: nodeId,
        classification,
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function setNodeSubstanceProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function setEdgeSubstanceProposal(seq: number, envelopeId: string, edgeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function rewordProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: nodeId,
        new_wording: 'updated wording',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function decomposeProposal(
  seq: number,
  envelopeId: string,
  parentNodeId: string,
  componentNodeIds: readonly string[],
): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: parentNodeId,
        components: componentNodeIds.map((id, index) => ({
          node_id: id,
          wording: `component ${index}`,
          classification: 'fact',
        })),
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function interpretiveSplitProposal(
  seq: number,
  envelopeId: string,
  parentNodeId: string,
  readingNodeIds: readonly string[],
): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: parentNodeId,
        readings: readingNodeIds.map((id, index) => ({
          node_id: id,
          wording: `reading ${index}`,
          classification: 'fact',
        })),
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function axiomMarkProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'axiom-mark', node_id: nodeId, participant: PARTICIPANT_A },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function metaMoveProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'reframe',
        target_kind: 'node',
        target_id: nodeId,
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function breakEdgeProposal(seq: number, envelopeId: string, edgeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'break-edge', edge_id: edgeId },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function annotateProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: nodeId,
        annotation_kind: 'note',
        content: 'note',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function voteEvent(
  seq: number,
  proposalId: string,
  participant: string,
  vote: 'agree' | 'dispute',
): Event {
  return {
    id: envId('v', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote,
      voted_at: '2026-05-17T00:00:10.000Z',
    },
    createdAt: '2026-05-17T00:00:10.000Z',
  };
}

function commitEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('c', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: ACTOR,
      committed_at: '2026-05-17T00:00:20.000Z',
    },
    createdAt: '2026-05-17T00:00:20.000Z',
  };
}

function withdrawAgreementEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording',
  participant: string,
): Event {
  return {
    id: envId('w', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'withdraw-agreement',
    actor: participant,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant,
      withdrawn_at: '2026-05-17T00:00:25.000Z',
    },
    createdAt: '2026-05-17T00:00:25.000Z',
  };
}

function metaDisagreementEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('m', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'meta-disagreement-marked',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      marked_by: ACTOR,
      marked_at: '2026-05-17T00:00:30.000Z',
    },
    createdAt: '2026-05-17T00:00:30.000Z',
  };
}

describe('computeFacetStatuses — empty input', () => {
  it('(a) returns empty maps for an empty event log', () => {
    const index = computeFacetStatuses([]);
    expect(index.nodes.size).toBe(0);
    expect(index.edges.size).toBe(0);
  });
});

describe('computeFacetStatuses — agreement-layer states', () => {
  it('(b) classify-node proposal with no votes lands as proposed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ classification: 'proposed' });
  });

  it('(c) classify-node + one agree out of two current participants is still proposed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
  });

  it('(d) classify-node + every current participant agreeing → agreed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('agreed');
  });

  it('(e) classify-node + a dispute vote → disputed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'dispute'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('disputed');
  });
});

describe('computeFacetStatuses — committed-layer states', () => {
  it('(f) classify-node + all agree + commit → committed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      commitEvent(6, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('committed');
  });

  it('(g) a withdraw-agreement against a committed facet → withdrawn', () => {
    // Per ADR 0030 §3: withdrawal is now its own first-class event
    // kind, keyed by `(entity, facet, participant)`.
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      commitEvent(6, PROPOSAL_P),
      withdrawAgreementEvent(7, 'node', NODE_X, 'classification', PARTICIPANT_A),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('withdrawn');
  });

  it('(h) mark-meta-disagreement on a facet short-circuits to meta-disagreement', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'dispute'),
      metaDisagreementEvent(6, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('meta-disagreement');
  });
});

describe('computeFacetStatuses — participant filtering', () => {
  it("(i) a left participant's vote is excluded from the agreement count", () => {
    // A and B agree; A leaves; B is now the only current participant and
    // has voted agree, so the facet is agreed (with A's vote no longer
    // contributing to the count but also not contradicting).
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      leftEvent(6, PARTICIPANT_A),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('agreed');
  });
});

describe('computeFacetStatuses — facet routing per proposal sub-kind', () => {
  it('(j) set-node-substance proposal targets the substance facet', () => {
    const events: Event[] = [setNodeSubstanceProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ substance: 'proposed' });
  });

  it('(k) set-edge-substance proposal targets an edge substance facet', () => {
    const events: Event[] = [setEdgeSubstanceProposal(1, PROPOSAL_P, EDGE_E)];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)).toEqual({ substance: 'proposed' });
    expect(index.nodes.size).toBe(0);
  });

  it('(l) edit-wording.reword targets the wording facet', () => {
    const events: Event[] = [rewordProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ wording: 'proposed' });
  });

  it('(m) decompose proposal lands per-component classification facets as proposed', () => {
    const events: Event[] = [decomposeProposal(1, PROPOSAL_P, NODE_X, [NODE_Y, NODE_Z])];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_Y)?.classification).toBe('proposed');
    expect(index.nodes.get(NODE_Z)?.classification).toBe('proposed');
    // The parent node is NOT the target of the decompose proposal —
    // decompose's `targetOf` returns null for the parent — so no entry
    // for the parent itself.
    expect(index.nodes.has(NODE_X)).toBe(false);
  });

  it('(n) interpretive-split proposal lands per-reading classification facets as proposed', () => {
    const events: Event[] = [interpretiveSplitProposal(1, PROPOSAL_P, NODE_X, [NODE_Y, NODE_Z])];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_Y)?.classification).toBe('proposed');
    expect(index.nodes.get(NODE_Z)?.classification).toBe('proposed');
    expect(index.nodes.has(NODE_X)).toBe(false);
  });
});

describe('computeFacetStatuses — out-of-scope proposal sub-kinds', () => {
  it('(o) axiom-mark / meta-move / break-edge / annotate proposals do NOT produce a facet entry', () => {
    const events: Event[] = [
      axiomMarkProposal(1, PROPOSAL_P, NODE_X),
      metaMoveProposal(2, PROPOSAL_Q, NODE_Y),
      breakEdgeProposal(3, envId('b', 1), EDGE_E),
      annotateProposal(4, envId('a', 1), NODE_Z),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.size).toBe(0);
    expect(index.edges.size).toBe(0);
  });
});

describe('cardRollupStatus — priority ordering', () => {
  it('returns undefined for the empty record', () => {
    expect(cardRollupStatus(EMPTY_FACET_STATUSES)).toBeUndefined();
    expect(cardRollupStatus({})).toBeUndefined();
  });

  it('returns the single status when only one facet is present', () => {
    for (const status of ROLLUP_PRIORITY) {
      expect(cardRollupStatus({ classification: status })).toBe(status);
    }
  });

  it('(p) priority-pair coverage — every higher-priority status wins over every lower-priority one', () => {
    // For every (higher, lower) pair where ROLLUP_PRIORITY.indexOf(higher)
    // < ROLLUP_PRIORITY.indexOf(lower), the rollup returns `higher`. This
    // covers all 15 ordered pairs across the 6 statuses.
    const pairs: Array<[FacetStatus, FacetStatus]> = [];
    for (let i = 0; i < ROLLUP_PRIORITY.length; i += 1) {
      for (let j = i + 1; j < ROLLUP_PRIORITY.length; j += 1) {
        pairs.push([ROLLUP_PRIORITY[i]!, ROLLUP_PRIORITY[j]!]);
      }
    }
    for (const [higher, lower] of pairs) {
      const record = { classification: higher, substance: lower };
      expect(cardRollupStatus(record)).toBe(higher);
      // Reverse-order facet keys must not change the outcome (the helper
      // is keyed on the set of values, not the iteration order).
      const reverseRecord = { classification: lower, substance: higher };
      expect(cardRollupStatus(reverseRecord)).toBe(higher);
    }
  });
});
