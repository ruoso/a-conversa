// Tests for `detectContradictions`.
//
// Refinement: tasks/refinements/data-and-methodology/contradiction_detection.md
// TaskJuggler: data_and_methodology.diagnostics.contradiction_detection
//
// Coverage:
//   - Empty projection -> no contradictions.
//   - A pair with a non-active contradicts edge (edge substance
//     unagreed) -> no contradictions.
//   - A pair with an active contradicts edge whose endpoints'
//     substance is agreed -> one contradiction.
//   - Target-node substance unagreed -> no contradictions (the
//     contradiction-specific rule).
//   - Symmetric pair (A->B + B->A, both active, both endpoints
//     agreed) -> one entry with both edge ids.
//   - Non-contradicts edge (a `supports` edge) between an agreed
//     pair -> no contradictions.
//   - Broken contradicts edge (committed break-edge) -> not detected.
//   - Multiple independent contradictions -> multiple entries.
//   - Self-loop (A -> A, contradicts) -> not detected.
//   - Canonical pair ordering -> `nodeA < nodeB`.
//
// Reuses the seedSession / proposeSetX / castVote / commit helper
// pattern from `cycle-detection.test.ts` and `active-firing.test.ts`.
// Each test builds a fresh projection via TS-literal events and
// applies them through `applyEvent`; no DB.

import { describe, expect, it } from 'vitest';

import type { Event, EdgeRole } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import { detectContradictions } from './contradiction-detection.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111122';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

// Node ids chosen so that NODE_A < NODE_B < NODE_C < NODE_D
// lexicographically. The detector orders canonical pairs by
// `string <` comparison, so the assertion `nodeA < nodeB` lines up
// against this seed.
const NODE_A = '66666666-6666-4666-8666-66666666660a';
const NODE_B = '66666666-6666-4666-8666-66666666660b';
const NODE_C = '66666666-6666-4666-8666-66666666660c';
const NODE_D = '66666666-6666-4666-8666-66666666660d';

const EDGE_AB = '77777777-7777-4777-8777-7777777777ab';
const EDGE_BA = '77777777-7777-4777-8777-7777777777ba';
const EDGE_AA = '77777777-7777-4777-8777-7777777777aa';
const EDGE_CD = '77777777-7777-4777-8777-7777777777cd';

// Annotation-endpoint test ids (per
// contradiction_annotation_endpoint_semantics_audit D1, D6).
const ANN_1 = '88888888-8888-4888-8888-888888888881';
const ANN_2 = '88888888-8888-4888-8888-888888888882';
const EDGE_NA = '77777777-7777-4777-8777-77777777a001';
const EDGE_AN = '77777777-7777-4777-8777-77777777a002';
const EDGE_AA_DISTINCT = '77777777-7777-4777-8777-77777777a003';
const EDGE_AA_SHARED = '77777777-7777-4777-8777-77777777a004';

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
  role: EdgeRole = 'contradicts',
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

// --- Annotation-endpoint helpers (per
// contradiction_annotation_endpoint_semantics_audit D6) ---
//
// Mirror the thin direction-tagged shape the sibling
// `coherency_self_referential_annotation_contradicts_rule` task added
// to `coherency-hint-detection.test.ts`: separate helpers per
// endpoint-direction combination read more directly at call sites than
// a tagged-union mixed helper would.

function createAnnotation(
  projection: Projection,
  annotationId: string,
  anchor: { nodeId: string } | { edgeId: string },
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
      annotation_id: annotationId,
      kind: 'note',
      content: 'a',
      target_node_id: 'nodeId' in anchor ? anchor.nodeId : null,
      target_edge_id: 'edgeId' in anchor ? anchor.edgeId : null,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function createNodeToAnnotationEdge(
  projection: Projection,
  edgeId: string,
  sourceNodeId: string,
  targetAnnotationId: string,
  role: EdgeRole = 'contradicts',
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role,
      source_node_id: sourceNodeId,
      target_annotation_id: targetAnnotationId,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function createAnnotationToNodeEdge(
  projection: Projection,
  edgeId: string,
  sourceAnnotationId: string,
  targetNodeId: string,
  role: EdgeRole = 'contradicts',
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role,
      source_annotation_id: sourceAnnotationId,
      target_node_id: targetNodeId,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function createAnnotationToAnnotationEdge(
  projection: Projection,
  edgeId: string,
  sourceAnnotationId: string,
  targetAnnotationId: string,
  role: EdgeRole = 'contradicts',
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role,
      source_annotation_id: sourceAnnotationId,
      target_annotation_id: targetAnnotationId,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

// Build a pair A, B with an A->B contradicts edge, with both node
// substances committed-agreed and the edge substance committed-agreed.
function buildAgreedContradiction(projection: Projection): void {
  createNode(projection, NODE_A, 'A');
  createNode(projection, NODE_B, 'B');
  createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
  commitNodeAgreed(projection, NODE_A);
  commitNodeAgreed(projection, NODE_B);
  commitEdgeAgreed(projection, EDGE_AB);
}

// ---------------------------------------------------------------
// No contradictions.
// ---------------------------------------------------------------

describe('detectContradictions — no contradictions', () => {
  it('empty projection → no contradictions', () => {
    resetSeq();
    const projection = seedSession();
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('pair with a non-active contradicts edge (edge substance unagreed) → no contradictions', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    // EDGE_AB substance left unagreed (no proposal).
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('pair with a non-active contradicts edge (source-node substance unagreed) → no contradictions', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    // Skip commitNodeAgreed(NODE_A) — source unagreed.
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('pair with target-node substance unagreed → no contradictions (the contradiction-specific rule)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    // Skip commitNodeAgreed(NODE_B) — target unagreed.
    commitEdgeAgreed(projection, EDGE_AB);
    // The generic `isEdgeActive` primitive accepts this (it checks
    // edge + source substance), but `detectContradictions` adds the
    // target-substance rule, so the contradiction does NOT fire.
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('non-contradicts edge (supports) between an agreed pair → no contradictions', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'supports');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('broken contradicts edge (committed break-edge) → not detected', () => {
    resetSeq();
    const projection = seedSession();
    buildAgreedContradiction(projection);
    // Sanity: contradiction exists before the break.
    expect(detectContradictions(projection)).toHaveLength(1);
    commitBreakEdge(projection, EDGE_AB);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('self-loop (A → A, contradicts, active) → not detected', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createEdge(projection, EDGE_AA, NODE_A, NODE_A, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitEdgeAgreed(projection, EDGE_AA);
    expect(detectContradictions(projection)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Contradictions detected.
// ---------------------------------------------------------------

describe('detectContradictions — contradictions detected', () => {
  it('active contradicts edge with both endpoints agreed → one contradiction', () => {
    resetSeq();
    const projection = seedSession();
    buildAgreedContradiction(projection);
    const result = detectContradictions(projection);
    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toBeDefined();
    // Canonical ordering: NODE_A < NODE_B lexicographically.
    expect(entry?.nodeA).toBe(NODE_A);
    expect(entry?.nodeB).toBe(NODE_B);
    expect(entry?.edges).toEqual([EDGE_AB]);
  });

  it('symmetric pair (A→B + B→A) → one entry whose edges field carries both edge ids', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    createEdge(projection, EDGE_BA, NODE_B, NODE_A, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AB);
    commitEdgeAgreed(projection, EDGE_BA);
    const result = detectContradictions(projection);
    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toBeDefined();
    expect(entry?.nodeA).toBe(NODE_A);
    expect(entry?.nodeB).toBe(NODE_B);
    expect(new Set(entry?.edges ?? [])).toEqual(new Set([EDGE_AB, EDGE_BA]));
    expect(entry?.edges).toHaveLength(2);
  });

  it('multiple independent contradictions → multiple entries', () => {
    resetSeq();
    const projection = seedSession();
    // Contradiction 1: A ↔ B (asymmetric; one edge).
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    // Contradiction 2: C ↔ D (asymmetric; one edge).
    createNode(projection, NODE_C, 'C');
    createNode(projection, NODE_D, 'D');
    createEdge(projection, EDGE_CD, NODE_C, NODE_D, 'contradicts');
    for (const n of [NODE_A, NODE_B, NODE_C, NODE_D]) commitNodeAgreed(projection, n);
    for (const e of [EDGE_AB, EDGE_CD]) commitEdgeAgreed(projection, e);
    const result = detectContradictions(projection);
    expect(result).toHaveLength(2);
    const pairs = result.map((c) => `${c.nodeA} ${c.nodeB}`);
    expect(pairs).toContain(`${NODE_A} ${NODE_B}`);
    expect(pairs).toContain(`${NODE_C} ${NODE_D}`);
    for (const entry of result) {
      // Each entry has exactly one edge id and the pair is in canonical order.
      expect(entry.edges).toHaveLength(1);
      expect(entry.nodeA < entry.nodeB).toBe(true);
    }
  });

  it('canonical pair ordering: B → A contradicts (reversed in storage) still reports nodeA < nodeB', () => {
    resetSeq();
    const projection = seedSession();
    // Edge source is NODE_B, target is NODE_A — but the entry should
    // still order them lexicographically with NODE_A first.
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_BA, NODE_B, NODE_A, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_BA);
    const result = detectContradictions(projection);
    expect(result).toHaveLength(1);
    expect(result[0]?.nodeA).toBe(NODE_A);
    expect(result[0]?.nodeB).toBe(NODE_B);
    expect(result[0]?.edges).toEqual([EDGE_BA]);
  });
});

// --- Annotation-endpoint contradicts edges (per contradiction_annotation_endpoint_semantics_audit D1, D6) ---
//
// The detector skips annotation-endpoint contradicts edges in all three
// shapes (node-source / annotation-target, annotation-source / node-
// target, annotation-source / annotation-target) across both anchor
// configurations (self-referential, cross-anchor) and both edge
// directions. Methodology grounding: `docs/methodology.md` L236
// positions `contradicts` as a substance-layer relation between peer
// entities, not between an entity and its commentary. Annotations
// carry no substance facet (`ProjectedAnnotation` has no
// `substanceFacet`), so the rule-4 target-substance check would also
// fail to fire even without the early skip — the skip is defence-in-
// depth.
//
// Each case asserts `detectContradictions(projection).length === 0`
// on a fixture whose annotation-endpoint contradicts edge is the only
// edge-of-interest. Even with all substance facets committed-agreed
// (so the detector's other rules would be satisfied on a node-node
// edge), the early skip guarantees zero findings.

describe('detectContradictions — annotation-endpoint contradicts edges (audit D1)', () => {
  it('node N → contradicts → annotation A (A annotates N): no contradiction surfaced', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'N');
    createAnnotation(projection, ANN_1, { nodeId: NODE_A });
    createNodeToAnnotationEdge(projection, EDGE_NA, NODE_A, ANN_1, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitEdgeAgreed(projection, EDGE_NA);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('annotation A → contradicts → node N (A annotates N): no contradiction surfaced', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'N');
    createAnnotation(projection, ANN_1, { nodeId: NODE_A });
    createAnnotationToNodeEdge(projection, EDGE_AN, ANN_1, NODE_A, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitEdgeAgreed(projection, EDGE_AN);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('node N1 → contradicts → annotation A (A annotates N2, cross-anchor): no contradiction surfaced', () => {
    resetSeq();
    const projection = seedSession();
    // The walkthrough E15 shape generalised: A annotates N2 but the
    // contradicts edge runs from N1 to A. The future
    // `coherency_non_self_referential_annotation_contradicts_rule`
    // (per D3) would surface this advisorily; the blocking
    // contradiction detector does not.
    createNode(projection, NODE_A, 'N1');
    createNode(projection, NODE_B, 'N2');
    createAnnotation(projection, ANN_1, { nodeId: NODE_B });
    createNodeToAnnotationEdge(projection, EDGE_NA, NODE_A, ANN_1, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_NA);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('annotation A → contradicts → node N1 (A annotates N2, cross-anchor): no contradiction surfaced', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'N1');
    createNode(projection, NODE_B, 'N2');
    createAnnotation(projection, ANN_1, { nodeId: NODE_B });
    createAnnotationToNodeEdge(projection, EDGE_AN, ANN_1, NODE_A, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AN);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('annotation A1 → contradicts → annotation A2 (both annotate distinct nodes): no contradiction surfaced', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'N1');
    createNode(projection, NODE_B, 'N2');
    createAnnotation(projection, ANN_1, { nodeId: NODE_A });
    createAnnotation(projection, ANN_2, { nodeId: NODE_B });
    createAnnotationToAnnotationEdge(projection, EDGE_AA_DISTINCT, ANN_1, ANN_2, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitNodeAgreed(projection, NODE_B);
    commitEdgeAgreed(projection, EDGE_AA_DISTINCT);
    expect(detectContradictions(projection)).toEqual([]);
  });

  it('annotation A1 → contradicts → annotation A2 (both annotate the same node N): no contradiction surfaced', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'N');
    createAnnotation(projection, ANN_1, { nodeId: NODE_A });
    createAnnotation(projection, ANN_2, { nodeId: NODE_A });
    createAnnotationToAnnotationEdge(projection, EDGE_AA_SHARED, ANN_1, ANN_2, 'contradicts');
    commitNodeAgreed(projection, NODE_A);
    commitEdgeAgreed(projection, EDGE_AA_SHARED);
    expect(detectContradictions(projection)).toEqual([]);
  });
});
