// Tests for the audience-side per-entity per-facet `FacetStatus`
// derivation.
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//
// Per ADR 0022 these are committed Vitest cases. The audience's
// `facetStatus.ts` is a verbatim port of the participant's
// `apps/participant/src/graph/facetStatus.ts`; these cases mirror the
// participant's `facetStatus.test.ts` pin shape so a reader cross-
// referencing the four copies (server canonical + moderator + participant
// + audience) sees the same coverage on the client mirrors.

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
      joined_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
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
      left_at: '2026-05-27T00:01:00.000Z',
    },
    createdAt: '2026-05-27T00:01:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
    createdAt: '2026-05-27T00:00:00.000Z',
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
      voted_at: '2026-05-27T00:00:10.000Z',
    },
    createdAt: '2026-05-27T00:00:10.000Z',
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
      committed_at: '2026-05-27T00:00:20.000Z',
    },
    createdAt: '2026-05-27T00:00:20.000Z',
  };
}

function withdrawAgreementEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording' | 'shape',
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
      withdrawn_at: '2026-05-27T00:00:25.000Z',
    },
    createdAt: '2026-05-27T00:00:25.000Z',
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
      marked_at: '2026-05-27T00:00:30.000Z',
    },
    createdAt: '2026-05-27T00:00:30.000Z',
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
    const pairs: Array<[FacetStatus, FacetStatus]> = [];
    for (let i = 0; i < ROLLUP_PRIORITY.length; i += 1) {
      for (let j = i + 1; j < ROLLUP_PRIORITY.length; j += 1) {
        pairs.push([ROLLUP_PRIORITY[i]!, ROLLUP_PRIORITY[j]!]);
      }
    }
    for (const [higher, lower] of pairs) {
      const record = { classification: higher, substance: lower };
      expect(cardRollupStatus(record)).toBe(higher);
      const reverseRecord = { classification: lower, substance: higher };
      expect(cardRollupStatus(reverseRecord)).toBe(higher);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Shape facet (edge) — mirrors the participant's shape-facet block
// verbatim in shape. Per ADR 0030 §5: the `shape` facet on an edge
// lands inline with the `edge-created` event (the carriage of the
// role). There is no `propose-edge-shape` sub-kind in v1, so the
// facet's candidate seeds from the create event directly.
// ──────────────────────────────────────────────────────────────────────

function edgeCreatedEvent(
  seq: number,
  edgeId: string,
  source: string = '00000000-0000-4000-8000-000000000001',
  target: string = '00000000-0000-4000-8000-000000000002',
): Event {
  return {
    id: envId('e', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: edgeId,
      source_node_id: source,
      target_node_id: target,
      role: 'supports',
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function facetVoteEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording' | 'shape',
  participant: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: envId('V', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant,
      choice,
      voted_at: '2026-05-27T00:00:10.000Z',
    },
    createdAt: '2026-05-27T00:00:10.000Z',
  };
}

function facetCommitEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording' | 'shape',
): Event {
  return {
    id: envId('C', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      committed_by: ACTOR,
      committed_at: '2026-05-27T00:00:20.000Z',
    },
    createdAt: '2026-05-27T00:00:20.000Z',
  };
}

describe('computeFacetStatuses — shape facet (edge)', () => {
  it('edge-created seeds the shape facet with a candidate; empty-session degenerates to proposed', () => {
    const events: Event[] = [edgeCreatedEvent(1, EDGE_E)];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)).toEqual({
      shape: 'proposed',
      substance: 'awaiting-proposal',
    });
  });

  it('all current participants vote agree on (edge, shape) → agreed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('agreed');
  });

  it('a dispute vote on (edge, shape) → disputed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'dispute'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('disputed');
  });

  it('facet-arm commit on (edge, shape) → committed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'agree'),
      facetCommitEvent(6, 'edge', EDGE_E, 'shape'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('committed');
  });

  it('withdraw-agreement on committed (edge, shape) → withdrawn', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'agree'),
      facetCommitEvent(6, 'edge', EDGE_E, 'shape'),
      withdrawAgreementEvent(7, 'edge', EDGE_E, 'shape', PARTICIPANT_A),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('withdrawn');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Multi-facet independence on one entity — pinned for the audience port.
// ──────────────────────────────────────────────────────────────────────

describe('computeFacetStatuses — multi-facet independence', () => {
  it('a node carries independent statuses on classification + substance', () => {
    // classification reaches agreed; substance stays proposed.
    const PROPOSAL_CLASS = '00000000-0000-4000-8000-0000000000c1';
    const PROPOSAL_SUB = '00000000-0000-4000-8000-0000000000c2';
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_CLASS, NODE_X),
      voteEvent(4, PROPOSAL_CLASS, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_CLASS, PARTICIPANT_B, 'agree'),
      setNodeSubstanceProposal(6, PROPOSAL_SUB, NODE_X),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({
      classification: 'agreed',
      substance: 'proposed',
    });
  });
});
