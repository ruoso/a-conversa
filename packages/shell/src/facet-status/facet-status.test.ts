// Consolidated Vitest coverage for the shell's facet-status derivation.
//
// Refinement: tasks/refinements/shell-package/extract_facet_status_rules.md
//
// Per ADR 0022 these are committed Vitest cases. They consolidate the
// three predecessor per-app `facetStatus.test.ts` suites (moderator,
// participant, audience) plus the moderator's `StatementNode.test.tsx`
// `cardRollupStatus — rollup priority order` describe block, which all
// pinned the same rule walk + the same rollup priority verbatim. The
// union covers every distinct case across the predecessors:
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
//   (j) empty-session facet (no current participants) stays proposed
//   (k) set-node-substance proposal → substance facet
//   (l) set-edge-substance proposal → edge substance facet
//   (m) edit-wording.reword proposal → wording facet
//   (n) decompose proposal → per-component classification facets
//   (o) interpretive-split proposal → per-reading classification facets
//   (p) out-of-scope sub-kinds (axiom-mark, meta-move, break-edge,
//       annotate) produce no facet entry
//   (q) entities without proposals — no entry in the index
//   (r) two nodes, proposal against one leaves the other absent
//   (s) one node carries independent statuses on classification + substance
//   (t) three participants, one absent → facet stays proposed
//   (u) edge-created seeds the shape facet (empty-session degenerates to
//       proposed, substance is awaiting-proposal)
//   (v–z) shape-facet derivation (agree / dispute / commit / withdraw)
//   cardRollupStatus: empty-record → undefined; single-status pass-through
//       for all seven values; priority-pair exhaustive sweep; the
//       moderator's specific multi-status cases verbatim.

import { describe, expect, it } from 'vitest';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import {
  cardRollupStatus,
  computeFacetStatuses,
  EMPTY_FACET_STATUSES,
  ROLLUP_PRIORITY,
  type FacetStatus,
} from './facet-status.js';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
const PARTICIPANT_C = '00000000-0000-4000-8000-0000000000a3';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const NODE_Z = '00000000-0000-4000-8000-00000000000c';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000fe';
const ANNOTATION_M = '00000000-0000-4000-8000-0000000000d1';

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
      joined_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
      left_at: '2026-05-28T00:01:00.000Z',
    },
    createdAt: '2026-05-28T00:01:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
      voted_at: '2026-05-28T00:00:10.000Z',
    },
    createdAt: '2026-05-28T00:00:10.000Z',
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
      committed_at: '2026-05-28T00:00:20.000Z',
    },
    createdAt: '2026-05-28T00:00:20.000Z',
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
      withdrawn_at: '2026-05-28T00:00:25.000Z',
    },
    createdAt: '2026-05-28T00:00:25.000Z',
  };
}

function proposalWithdrawnEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('W', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal-withdrawn',
    actor: ACTOR,
    payload: {
      proposal_id: proposalId,
      withdrawn_by: ACTOR,
      withdrawn_at: '2026-05-28T00:00:27.000Z',
    },
    createdAt: '2026-05-28T00:00:27.000Z',
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
      marked_at: '2026-05-28T00:00:30.000Z',
    },
    createdAt: '2026-05-28T00:00:30.000Z',
  };
}

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
      created_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
      voted_at: '2026-05-28T00:00:10.000Z',
    },
    createdAt: '2026-05-28T00:00:10.000Z',
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
      committed_at: '2026-05-28T00:00:20.000Z',
    },
    createdAt: '2026-05-28T00:00:20.000Z',
  };
}

// The `annotation-created` a committed meta-move materializes. Per the
// `meta_move_commit_logic` predecessor it is emitted immediately ahead
// of the meta-move's `commit` (the commit-batch adjacency the
// annotation-routing relies on).
function annotationCreatedEvent(
  seq: number,
  annotationId: string,
  targetNodeId: string,
  kind: 'note' | 'reframe' | 'scope-change' | 'stance' = 'reframe',
): Event {
  return {
    id: envId('A', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'annotation-created',
    actor: ACTOR,
    payload: {
      annotation_id: annotationId,
      kind,
      content: 'the real question is the operational form',
      target_node_id: targetNodeId,
      target_edge_id: null,
      created_by: ACTOR,
      created_at: '2026-05-28T00:00:20.000Z',
    },
    createdAt: '2026-05-28T00:00:20.000Z',
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

  it('(j) an empty-session facet (no current participants) stays proposed', () => {
    // A proposal can land before any participant joins (e.g. the
    // moderator's own actions on an empty lobby). Without current
    // participants the unanimous-agree rule cannot fire, so the facet
    // is proposed.
    const events: Event[] = [classifyProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
  });
});

describe('computeFacetStatuses — facet routing per proposal sub-kind', () => {
  it('(k) set-node-substance proposal targets the substance facet', () => {
    const events: Event[] = [setNodeSubstanceProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ substance: 'proposed' });
  });

  it('(l) set-edge-substance proposal targets an edge substance facet', () => {
    const events: Event[] = [setEdgeSubstanceProposal(1, PROPOSAL_P, EDGE_E)];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)).toEqual({ substance: 'proposed' });
    expect(index.nodes.size).toBe(0);
  });

  it('(m) edit-wording.reword targets the wording facet', () => {
    const events: Event[] = [rewordProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ wording: 'proposed' });
  });

  // Per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`,
  // the per-component decompose / interpretive-split arm was REMOVED
  // from `computeFacetStatuses`: the server-side broadcast at
  // `apps/server/src/ws/broadcast/proposal-status.ts` (covered in
  // `proposal-status.test.ts`) is now the source of truth. The
  // client-side derivation no longer emits per-component classification
  // entries for these multi-component sub-kinds. The parent's
  // classification facet remains unaffected as before.
  it('(n) decompose proposal does NOT emit per-component classification facets (server-side now)', () => {
    const events: Event[] = [decomposeProposal(1, PROPOSAL_P, NODE_X, [NODE_Y, NODE_Z])];
    const index = computeFacetStatuses(events);
    expect(index.nodes.has(NODE_X)).toBe(false);
    expect(index.nodes.has(NODE_Y)).toBe(false);
    expect(index.nodes.has(NODE_Z)).toBe(false);
  });

  it('(o) interpretive-split proposal does NOT emit per-reading classification facets (server-side now)', () => {
    const events: Event[] = [interpretiveSplitProposal(1, PROPOSAL_P, NODE_X, [NODE_Y, NODE_Z])];
    const index = computeFacetStatuses(events);
    expect(index.nodes.has(NODE_X)).toBe(false);
    expect(index.nodes.has(NODE_Y)).toBe(false);
    expect(index.nodes.has(NODE_Z)).toBe(false);
  });
});

describe('computeFacetStatuses — out-of-scope proposal sub-kinds', () => {
  it('(p) axiom-mark / meta-move / break-edge / annotate proposals do NOT produce a facet entry', () => {
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

describe('computeFacetStatuses — committed meta-move routes votes onto the annotation substance facet', () => {
  it('(aa) a unanimously-agreed committed meta-move surfaces its annotation with substance="committed"', () => {
    // [annotation-created, commit] are emitted adjacently by the
    // predecessor; the projector pairs the annotation to the meta-move's
    // votes via that adjacency and routes them onto the substance facet.
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      metaMoveProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      annotationCreatedEvent(6, ANNOTATION_M, NODE_X),
      commitEvent(7, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.annotations.get(ANNOTATION_M)).toEqual({ substance: 'committed' });
    // The meta-move targets a node/edge but produces no per-*entity*
    // facet update — only the annotation bucket is touched.
    expect(index.nodes.has(NODE_X)).toBe(false);
    expect(index.edges.size).toBe(0);
  });

  it('(ab) a pending, never-committed meta-move contributes no annotation entry', () => {
    // No annotation exists yet (commit gates the annotation-created), so
    // the annotations bucket stays empty even though votes were cast.
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      metaMoveProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.annotations.size).toBe(0);
  });

  it('(ac) a committed facet-targeting proposal leaves the annotations bucket empty (no meta-move)', () => {
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
    expect(index.annotations.size).toBe(0);
  });
});

describe('computeFacetStatuses — annotation substance facet is disputable post-commit (ADR 0038)', () => {
  // A facet-keyed vote against an annotation's `substance` facet
  // (`entity_kind: 'annotation'`). Folds directly onto the per-annotation
  // accumulator (no proposal lookup), mirroring the wire/event payload
  // the engine now emits for annotation disputes.
  function annotationSubstanceVote(
    seq: number,
    annotationId: string,
    participant: string,
    choice: 'agree' | 'dispute',
  ): Event {
    return {
      id: envId('av', seq),
      sessionId: SESSION,
      sequence: seq,
      kind: 'vote',
      actor: participant,
      payload: {
        target: 'facet' as const,
        entity_kind: 'annotation' as const,
        entity_id: annotationId,
        facet: 'substance' as const,
        participant,
        choice,
        voted_at: '2026-05-28T00:01:00.000Z',
      },
      createdAt: '2026-05-28T00:01:00.000Z',
    };
  }

  it('(ad) a current participant disputing a committed annotation rolls its substance up to "disputed"', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      metaMoveProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      annotationCreatedEvent(6, ANNOTATION_M, NODE_X),
      commitEvent(7, PROPOSAL_P),
      annotationSubstanceVote(8, ANNOTATION_M, PARTICIPANT_A, 'dispute'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.annotations.get(ANNOTATION_M)).toEqual({ substance: 'disputed' });
    // The dispute touches only the annotation bucket — node/edge buckets
    // are unaffected.
    expect(index.nodes.has(NODE_X)).toBe(false);
    expect(index.edges.size).toBe(0);
  });

  it('(ae) the disputing participant re-agreeing rolls the substance back to "committed"', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      metaMoveProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      annotationCreatedEvent(6, ANNOTATION_M, NODE_X),
      commitEvent(7, PROPOSAL_P),
      annotationSubstanceVote(8, ANNOTATION_M, PARTICIPANT_A, 'dispute'),
      annotationSubstanceVote(9, ANNOTATION_M, PARTICIPANT_A, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.annotations.get(ANNOTATION_M)).toEqual({ substance: 'committed' });
  });
});

describe('computeFacetStatuses — proposal-withdrawn clears the in-flight candidate (ADR 0037)', () => {
  it('a withdrawn first proposal returns the facet to awaiting-proposal and drops its votes', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'dispute'),
      proposalWithdrawnEvent(5, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    // The dead candidate neither lingers as 'proposed' nor leaks its
    // dispute — the facet is empty again.
    expect(index.nodes.get(NODE_X)?.classification).toBe('awaiting-proposal');
  });

  it('withdrawing a superseding proposal restores the committed standing', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      commitEvent(6, PROPOSAL_P),
      // A fresh candidate on the committed facet draws a dispute…
      classifyProposal(7, PROPOSAL_Q, NODE_X, 'value'),
      voteEvent(8, PROPOSAL_Q, PARTICIPANT_B, 'dispute'),
      // …then is withdrawn: the dispute dies with the candidate and the
      // facet falls back to its committed standing.
      proposalWithdrawnEvent(9, PROPOSAL_Q),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('committed');
  });

  it('a stale withdraw (already-superseded proposal) is a no-op', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      classifyProposal(4, PROPOSAL_Q, NODE_X, 'value'),
      voteEvent(5, PROPOSAL_Q, PARTICIPANT_A, 'agree'),
      voteEvent(6, PROPOSAL_Q, PARTICIPANT_B, 'agree'),
      // P was already superseded by Q; withdrawing it must not disturb
      // Q's candidacy or the votes cast against Q.
      proposalWithdrawnEvent(7, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('agreed');
  });

  it('a withdrawn meta-move never routes its votes onto a later annotation', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      metaMoveProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      proposalWithdrawnEvent(6, PROPOSAL_P),
      // A malformed log committing the withdrawn meta-move must not
      // resurrect the dropped votes.
      annotationCreatedEvent(7, ANNOTATION_M, NODE_X),
      commitEvent(8, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.annotations.get(ANNOTATION_M)).toBeUndefined();
  });
});

describe('computeFacetStatuses — entities without proposals', () => {
  it('(q) a node with no proposals against any of its facets has no entry in the index', () => {
    const events: Event[] = [joinedEvent(1, PARTICIPANT_A, 'debater-A')];
    const index = computeFacetStatuses(events);
    expect(index.nodes.size).toBe(0);
    expect(index.edges.size).toBe(0);
  });

  it('(r) two nodes — proposal against one leaves the other absent from the index', () => {
    const events: Event[] = [classifyProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
    expect(index.nodes.has(NODE_Y)).toBe(false);
  });
});

describe('computeFacetStatuses — multiple facets on the same entity', () => {
  it('(s) one node carries independent statuses on classification and substance', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      // classification: one agree + one dispute → disputed
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'dispute'),
      // substance: no votes yet → proposed
      setNodeSubstanceProposal(6, PROPOSAL_Q, NODE_X),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({
      classification: 'disputed',
      substance: 'proposed',
    });
  });

  it('(t) three participants — one absent → the facet stays proposed until all three have voted', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      joinedEvent(3, PARTICIPANT_C, 'debater-A'),
      classifyProposal(4, PROPOSAL_P, NODE_X),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(6, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      // PARTICIPANT_C hasn't voted yet
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
  });
});

describe('computeFacetStatuses — shape facet (edge)', () => {
  it('(u) edge-created seeds the shape facet with a candidate; empty-session degenerates to proposed', () => {
    // No participants joined — Rule 7's unanimous-agree check fails
    // (currentParticipantCount === 0); Rule 8 'proposed' wins.
    const events: Event[] = [edgeCreatedEvent(1, EDGE_E)];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)).toEqual({
      shape: 'proposed',
      substance: 'awaiting-proposal',
    });
  });

  it('(v) all current participants vote agree on (edge, shape) → agreed', () => {
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

  it('(w) a dispute vote on (edge, shape) → disputed', () => {
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

  it('(x) facet-arm commit on (edge, shape) → committed', () => {
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

  it('(y) withdraw-agreement on committed (edge, shape) → withdrawn', () => {
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

// ---------------------------------------------------------------
// ADR 0046 — interpretive-split substance carry. The commit-time
// fan-out mints inherited edges whose substance facet no proposal
// ever targeted; the facet-keyed commit's `carried_from_edge_id`
// supplies the candidate, so the walker must land `'committed'`
// rather than letting Rule 2 (`awaiting-proposal`) fire.
// ---------------------------------------------------------------

const INHERITED_EDGE_I = '00000000-0000-4000-8000-00000000001e';

function carriedFacetCommitEvent(seq: number, edgeId: string, carriedFromEdgeId: string): Event {
  return {
    id: envId('C', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: edgeId,
      facet: 'substance',
      committed_by: ACTOR,
      committed_at: '2026-05-28T00:00:20.000Z',
      carried_from_edge_id: carriedFromEdgeId,
    },
    createdAt: '2026-05-28T00:00:20.000Z',
  };
}

describe('computeFacetStatuses — interpretive-split substance carry (ADR 0046)', () => {
  it('a carried facet commit lands committed substance on an inherited edge no proposal targeted', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      // The parent edge reaches committed substance the ordinary way.
      edgeCreatedEvent(3, EDGE_E),
      setEdgeSubstanceProposal(4, PROPOSAL_P, EDGE_E),
      facetCommitEvent(5, 'edge', EDGE_E, 'substance'),
      // The inherited edge is minted at split-commit time; its only
      // substance event is the carried commit.
      edgeCreatedEvent(6, INHERITED_EDGE_I),
      carriedFacetCommitEvent(7, INHERITED_EDGE_I, EDGE_E),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(INHERITED_EDGE_I)?.substance).toBe('committed');
    // The parent edge's own substance is unaffected by the carry.
    expect(index.edges.get(EDGE_E)?.substance).toBe('committed');
  });

  it('a non-carried facet commit on a proposal-less substance facet still derives awaiting-proposal (Rule 2 unchanged)', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetCommitEvent(4, 'edge', EDGE_E, 'substance'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.substance).toBe('awaiting-proposal');
  });
});

describe('EMPTY_FACET_STATUSES', () => {
  it('is a frozen empty record and is referentially stable', () => {
    expect(EMPTY_FACET_STATUSES).toEqual({});
    expect(Object.isFrozen(EMPTY_FACET_STATUSES)).toBe(true);
  });
});

describe('cardRollupStatus — empty + single-status', () => {
  it('returns undefined for the empty record', () => {
    expect(cardRollupStatus(EMPTY_FACET_STATUSES)).toBeUndefined();
    expect(cardRollupStatus({})).toBeUndefined();
  });

  it('returns the single status when only one facet is present (every status)', () => {
    for (const status of ROLLUP_PRIORITY) {
      expect(cardRollupStatus({ classification: status })).toBe(status);
    }
  });
});

describe('cardRollupStatus — multi-status priority (verbatim from moderator)', () => {
  // Pinned verbatim from `StatementNode.test.tsx`'s
  // `cardRollupStatus — rollup priority order (mod_agreed_state_styling)`
  // describe block — preserves the moderator-side coverage shape.

  it('proposed beats every other status', () => {
    expect(
      cardRollupStatus({
        classification: 'proposed',
        substance: 'agreed',
        wording: 'committed',
      }),
    ).toBe('proposed');
    expect(cardRollupStatus({ classification: 'meta-disagreement', substance: 'proposed' })).toBe(
      'proposed',
    );
  });

  it('meta-disagreement beats disputed / agreed / committed / withdrawn', () => {
    expect(
      cardRollupStatus({
        classification: 'meta-disagreement',
        substance: 'disputed',
        wording: 'agreed',
      }),
    ).toBe('meta-disagreement');
  });

  it('disputed beats agreed / committed / withdrawn', () => {
    expect(cardRollupStatus({ classification: 'disputed', substance: 'agreed' })).toBe('disputed');
    expect(cardRollupStatus({ classification: 'committed', substance: 'disputed' })).toBe(
      'disputed',
    );
  });

  it('agreed beats committed and withdrawn', () => {
    expect(cardRollupStatus({ classification: 'agreed', substance: 'committed' })).toBe('agreed');
    expect(cardRollupStatus({ classification: 'withdrawn', substance: 'agreed' })).toBe('agreed');
  });

  it('committed beats withdrawn', () => {
    expect(cardRollupStatus({ classification: 'committed', substance: 'withdrawn' })).toBe(
      'committed',
    );
  });
});

describe('cardRollupStatus — exhaustive priority-pair sweep', () => {
  it('every higher-priority status wins over every lower-priority one (both facet orderings)', () => {
    // For every (higher, lower) pair where ROLLUP_PRIORITY.indexOf(higher)
    // < ROLLUP_PRIORITY.indexOf(lower), the rollup returns `higher`. This
    // covers all 21 ordered pairs across the 7 statuses.
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
