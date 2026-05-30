// Tests for `detectSupportsCycles`.
//
// Refinement: tasks/refinements/data-and-methodology/cycle_detection.md
// TaskJuggler: data_and_methodology.diagnostics.cycle_detection
//
// Coverage:
//   - Empty projection → no cycles.
//   - Graph with no supports edges (only rebuts) → no cycles.
//   - Linear supports chain (A → B → C) → no cycles.
//   - Self-loop (A → A) → one cycle.
//   - Two-node cycle (A → B, B → A) → one cycle.
//   - Three-node cycle (A → B → C → A) → one cycle.
//   - Two independent (disjoint) cycles → two cycle entries.
//   - Cycle involving a non-active edge (substance not committed-
//     agreed on one edge) → not detected.
//   - Cycle involving a non-active edge because of an unagreed source
//     node → not detected.
//   - Cycle involving a non-visible edge → not detected.
//   - Cycle involving non-`supports` edges (mixed with supports) →
//     only supports forms the cycle.
//   - Overlapping cycles (two cycles sharing one node) → single SCC
//     reported as one cycle entry.
//
// Reuses the seedSession / proposeSetX / castVote / commit helper
// pattern from `active-firing.test.ts`. Each test builds a fresh
// projection via TS-literal events and applies them through
// `applyEvent`; no DB.

import { describe, expect, it } from 'vitest';

import type { Event, EdgeRole } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import { detectSupportsCycles } from './cycle-detection.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const NODE_A = '66666666-6666-4666-8666-666666666601';
const NODE_B = '66666666-6666-4666-8666-666666666602';
const NODE_C = '66666666-6666-4666-8666-666666666603';
const NODE_D = '66666666-6666-4666-8666-666666666604';
const NODE_E = '66666666-6666-4666-8666-666666666605';
const NODE_F = '66666666-6666-4666-8666-666666666606';

const EDGE_AB = '77777777-7777-4777-8777-777777777712';
const EDGE_BC = '77777777-7777-4777-8777-777777777723';
const EDGE_CA = '77777777-7777-4777-8777-777777777731';
const EDGE_AA = '77777777-7777-4777-8777-777777777711';
const EDGE_BA = '77777777-7777-4777-8777-777777777721';
const EDGE_DE = '77777777-7777-4777-8777-777777777745';
const EDGE_EF = '77777777-7777-4777-8777-777777777756';
const EDGE_FD = '77777777-7777-4777-8777-777777777764';
const EDGE_CB_REBUTS = '77777777-7777-4777-8777-777777777732';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';
const T7 = '2026-05-10T12:00:07Z';

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
let propCounter = 0x100;

function nextSeq(): number {
  return seq++;
}

function resetSeq(): void {
  seq = 1;
  propCounter = 0x100;
}

function nextProposalId(): string {
  propCounter++;
  const hex = propCounter.toString(16).padStart(12, '0');
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

type Projection = ReturnType<typeof createEmptyProjection>;

// Seed a session with: session-created, 3 participants joined.
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
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'vote', participant, T4, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: T4,
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

function allAgree(projection: Projection, proposalId: string): void {
  castVote(projection, proposalId, MODERATOR_ID, 'agree');
  castVote(projection, proposalId, DEBATER_A_ID, 'agree');
  castVote(projection, proposalId, DEBATER_B_ID, 'agree');
}

// Commit substance:agreed for a node (proposal + 3 votes + commit).
function commitNodeAgreed(projection: Projection, nodeId: string): void {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' },
    }),
    id: proposalId,
  });
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

// Same for an edge.
function commitEdgeAgreed(projection: Projection, edgeId: string): void {
  const proposalId = nextProposalId();
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
    }),
    id: proposalId,
  });
  allAgree(projection, proposalId);
  commit(projection, proposalId);
}

// Commit a break-edge proposal against `edgeId`.
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

// Build a 3-node supports cycle A → B → C → A with every node and
// every edge committed-substance-agreed.
function buildThreeNodeCycle(projection: Projection): void {
  createNode(projection, NODE_A, 'A');
  createNode(projection, NODE_B, 'B');
  createNode(projection, NODE_C, 'C');
  createEdge(projection, EDGE_AB, NODE_A, NODE_B);
  createEdge(projection, EDGE_BC, NODE_B, NODE_C);
  createEdge(projection, EDGE_CA, NODE_C, NODE_A);
  commitNodeAgreed(projection, NODE_A);
  commitNodeAgreed(projection, NODE_B);
  commitNodeAgreed(projection, NODE_C);
  commitEdgeAgreed(projection, EDGE_AB);
  commitEdgeAgreed(projection, EDGE_BC);
  commitEdgeAgreed(projection, EDGE_CA);
}

// ---------------------------------------------------------------
// No cycles.
// ---------------------------------------------------------------

describe('detectSupportsCycles — no cycles', () => {
  it('empty projection → no cycles', () => {
    resetSeq();
    const projection = seedSession();
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('graph with no supports edges (only rebuts) → no cycles', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    // Two `rebuts` edges that would form a cycle if they were supports.
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'rebuts');
    createEdge(projection, EDGE_BA, NODE_B, NODE_A, 'rebuts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BA);
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('linear supports chain (A → B → C) → no cycles', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    createEdge(projection, EDGE_BC, NODE_B, NODE_C);
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitNodeAgreed(projection, NODE_C);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BC);
    expect(detectSupportsCycles(projection)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Cycles detected.
// ---------------------------------------------------------------

describe('detectSupportsCycles — cycles detected', () => {
  it('self-loop (A → A, supports) → one cycle with just A', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createEdge(projection, EDGE_AA, NODE_A, NODE_A);
    commitNodeAgreed(projection, NODE_A);
    commitEdgeAgreed(projection, EDGE_AA);
    const cycles = detectSupportsCycles(projection);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodes).toEqual([NODE_A]);
  });

  it('two-node cycle (A → B, B → A) → one cycle of 2 nodes', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    createEdge(projection, EDGE_BA, NODE_B, NODE_A);
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BA);
    const cycles = detectSupportsCycles(projection);
    expect(cycles).toHaveLength(1);
    const cycleNodes = cycles[0]?.nodes ?? [];
    expect(cycleNodes).toHaveLength(2);
    expect(new Set(cycleNodes)).toEqual(new Set([NODE_A, NODE_B]));
  });

  it('three-node cycle (A → B → C → A) → one cycle of 3 nodes in adjacency order', () => {
    resetSeq();
    const projection = seedSession();
    buildThreeNodeCycle(projection);
    const cycles = detectSupportsCycles(projection);
    expect(cycles).toHaveLength(1);
    const cycleNodes = cycles[0]?.nodes ?? [];
    expect(cycleNodes).toHaveLength(3);
    expect(new Set(cycleNodes)).toEqual(new Set([NODE_A, NODE_B, NODE_C]));
    // Verify adjacency order: every consecutive pair (with wrap) is
    // connected by a supports edge in the projection.
    for (let i = 0; i < cycleNodes.length; i++) {
      const from = cycleNodes[i] as string;
      const to = cycleNodes[(i + 1) % cycleNodes.length] as string;
      const matchingEdge = [...projection.edges()].find(
        (e) => e.role === 'supports' && e.sourceNodeId === from && e.targetNodeId === to,
      );
      expect(matchingEdge).toBeDefined();
    }
  });

  it('two independent (disjoint) cycles → two cycle entries', () => {
    resetSeq();
    const projection = seedSession();
    // Cycle 1: A → B → A
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    createEdge(projection, EDGE_BA, NODE_B, NODE_A);
    // Cycle 2: D → E → F → D
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_E, 'E');
    createNode(projection, NODE_F, 'F');
    createEdge(projection, EDGE_DE, NODE_D, NODE_E);
    createEdge(projection, EDGE_EF, NODE_E, NODE_F);
    createEdge(projection, EDGE_FD, NODE_F, NODE_D);
    for (const n of [NODE_A, NODE_B, NODE_D, NODE_E, NODE_F]) {
      commitNodeAgreed(projection, n);
    }
    for (const e of [EDGE_AB, EDGE_BA, EDGE_DE, EDGE_EF, EDGE_FD]) {
      commitEdgeAgreed(projection, e);
    }
    const cycles = detectSupportsCycles(projection);
    expect(cycles).toHaveLength(2);
    // One cycle has {A, B}, the other has {D, E, F}.
    const cycleSets = cycles.map((c) => new Set(c.nodes));
    expect(cycleSets).toContainEqual(new Set([NODE_A, NODE_B]));
    expect(cycleSets).toContainEqual(new Set([NODE_D, NODE_E, NODE_F]));
  });

  it('overlapping cycles (two cycles sharing nodes) → single SCC reported as one entry', () => {
    resetSeq();
    const projection = seedSession();
    // A → B, B → A (cycle 1), and B → C, C → A (forming cycle 2 with
    // A → B). Both cycles share nodes A and B; the SCC is {A, B, C}.
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    createEdge(projection, EDGE_BA, NODE_B, NODE_A);
    createEdge(projection, EDGE_BC, NODE_B, NODE_C);
    createEdge(projection, EDGE_CA, NODE_C, NODE_A);
    for (const n of [NODE_A, NODE_B, NODE_C]) commitNodeAgreed(projection, n);
    for (const e of [EDGE_AB, EDGE_BA, EDGE_BC, EDGE_CA]) commitEdgeAgreed(projection, e);
    const cycles = detectSupportsCycles(projection);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0]?.nodes ?? [])).toEqual(new Set([NODE_A, NODE_B, NODE_C]));
  });
});

// ---------------------------------------------------------------
// Filter rules — non-active / non-visible / non-supports.
// ---------------------------------------------------------------

describe('detectSupportsCycles — filter rules', () => {
  it('cycle involving a non-active edge (edge substance not committed-agreed) → not detected', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    createEdge(projection, EDGE_BC, NODE_B, NODE_C);
    createEdge(projection, EDGE_CA, NODE_C, NODE_A);
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitNodeAgreed(projection, NODE_C);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BC);
    // EDGE_CA substance left unagreed (no proposal at all).
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('cycle involving a non-active edge (source node substance unagreed) → not detected', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B);
    createEdge(projection, EDGE_BC, NODE_B, NODE_C);
    createEdge(projection, EDGE_CA, NODE_C, NODE_A);
    // NODE_C substance left unagreed; edges all committed-agreed.
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BC);
    commitEdgeAgreed(projection, EDGE_CA);
    // EDGE_CA's source is C; C's substance is unagreed, so the edge
    // does not fire. The cycle is broken.
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('cycle involving a non-visible edge (broken by committed break-edge) → not detected', () => {
    resetSeq();
    const projection = seedSession();
    buildThreeNodeCycle(projection);
    // Sanity: cycle exists before the break.
    expect(detectSupportsCycles(projection)).toHaveLength(1);
    commitBreakEdge(projection, EDGE_CA);
    // After the break-edge commits, EDGE_CA.visible === false.
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('cycle involving non-supports edges mixed with supports → only supports forms the cycle', () => {
    resetSeq();
    const projection = seedSession();
    // A → B (supports), B → C (supports), C → A (rebuts, not supports).
    // The supports-only path is A → B → C; no cycle in supports.
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'supports');
    createEdge(projection, EDGE_BC, NODE_B, NODE_C, 'supports');
    createEdge(projection, EDGE_CA, NODE_C, NODE_A, 'rebuts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitNodeAgreed(projection, NODE_C);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BC);
    commitEdgeAgreed(projection, EDGE_CA);
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('non-supports back-edge does not contribute to a supports cycle', () => {
    resetSeq();
    const projection = seedSession();
    // A → B (supports), B → C (supports), C → A (supports — closes
    // the cycle), and a separate C → B (rebuts) edge. The supports
    // cycle is A → B → C → A; the rebuts edge is irrelevant.
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'supports');
    createEdge(projection, EDGE_BC, NODE_B, NODE_C, 'supports');
    createEdge(projection, EDGE_CA, NODE_C, NODE_A, 'supports');
    createEdge(projection, EDGE_CB_REBUTS, NODE_C, NODE_B, 'rebuts');
    for (const n of [NODE_A, NODE_B, NODE_C]) commitNodeAgreed(projection, n);
    for (const e of [EDGE_AB, EDGE_BC, EDGE_CA, EDGE_CB_REBUTS]) commitEdgeAgreed(projection, e);
    const cycles = detectSupportsCycles(projection);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0]?.nodes ?? [])).toEqual(new Set([NODE_A, NODE_B, NODE_C]));
  });
});

// ---------------------------------------------------------------
// Annotation-endpoint edges — per `diagnostics_annotation_endpoint_semantics_audit`
// D1, the cycle detector skips annotation-endpoint edges (cycles are
// over the node-supports subgraph; annotation endpoints are
// entity-layer metadata, not part of the supports subgraph).
// ---------------------------------------------------------------

describe('detectSupportsCycles — annotation-endpoint edges (skipped per audit D1)', () => {
  it('projection containing only annotation-endpoint supports edges → no cycles', () => {
    resetSeq();
    const projection = seedSession();
    const ANNOTATION_ID_1 = '00000000-0000-4000-8000-0000000a1001';
    const ANNOTATION_ID_2 = '00000000-0000-4000-8000-0000000a1002';
    const ANNOT_EDGE_ID = '00000000-0000-4000-8000-0000000a1003';
    createNode(projection, NODE_A, 'A');
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: ANNOTATION_ID_1,
        kind: 'note',
        content: 'annotation 1',
        target_node_id: NODE_A,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: ANNOTATION_ID_2,
        kind: 'note',
        content: 'annotation 2',
        target_node_id: NODE_A,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: ANNOT_EDGE_ID,
        role: 'supports',
        source_annotation_id: ANNOTATION_ID_1,
        target_annotation_id: ANNOTATION_ID_2,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(detectSupportsCycles(projection)).toEqual([]);
  });

  it('annotation-endpoint supports edges produce no cycles regardless of annotation shape', () => {
    resetSeq();
    const projection = seedSession();
    // Three would-be-cycle shapes, all via the `supports` role:
    //   - node→ann→node (NODE_A → ANN_X → NODE_A)
    //   - ann→node→ann (ANN_Y → NODE_A → ANN_Y)
    //   - ann→ann self-loop (ANN_Z → ANN_Z)
    // Every annotation-endpoint supports edge is skipped at the
    // top-of-loop guard, so no cycle entry can emerge.
    const ANN_X = '00000000-0000-4000-8000-0000000a2001';
    const ANN_Y = '00000000-0000-4000-8000-0000000a2002';
    const ANN_Z = '00000000-0000-4000-8000-0000000a2003';
    const E_NODE_TO_ANN_X = '00000000-0000-4000-8000-0000000a2101';
    const E_ANN_X_TO_NODE = '00000000-0000-4000-8000-0000000a2102';
    const E_ANN_Y_TO_NODE = '00000000-0000-4000-8000-0000000a2103';
    const E_NODE_TO_ANN_Y = '00000000-0000-4000-8000-0000000a2104';
    const E_ANN_Z_SELF = '00000000-0000-4000-8000-0000000a2105';
    createNode(projection, NODE_A, 'A');
    for (const annId of [ANN_X, ANN_Y, ANN_Z]) {
      applyEvent(
        projection,
        makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
          annotation_id: annId,
          kind: 'note',
          content: 'a',
          target_node_id: NODE_A,
          target_edge_id: null,
          created_by: DEBATER_A_ID,
          created_at: T2,
        }),
      );
    }
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_NODE_TO_ANN_X,
        role: 'supports',
        source_node_id: NODE_A,
        target_annotation_id: ANN_X,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_ANN_X_TO_NODE,
        role: 'supports',
        source_annotation_id: ANN_X,
        target_node_id: NODE_A,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_ANN_Y_TO_NODE,
        role: 'supports',
        source_annotation_id: ANN_Y,
        target_node_id: NODE_A,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_NODE_TO_ANN_Y,
        role: 'supports',
        source_node_id: NODE_A,
        target_annotation_id: ANN_Y,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_ANN_Z_SELF,
        role: 'supports',
        source_annotation_id: ANN_Z,
        target_annotation_id: ANN_Z,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(detectSupportsCycles(projection)).toEqual([]);
  });
});
