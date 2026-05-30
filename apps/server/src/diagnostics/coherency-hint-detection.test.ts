// Tests for `detectCoherencyHints`.
//
// Refinement: tasks/refinements/data-and-methodology/coherency_hint_detection.md
// TaskJuggler: data_and_methodology.diagnostics.coherency_hint_detection
//
// Coverage:
//   - Empty projection → no hints (the registry composes to []).
//   - Complete warrant (both bridge edges present) → no hints
//     (positive case for both incomplete rules).
//   - Warrant with only `bridges-from` → one incomplete-warrant-
//     missing-bridges-to hint.
//   - Warrant with only `bridges-to` → one incomplete-warrant-
//     missing-bridges-from hint.
//   - Warrant with two `bridges-from` and no `bridges-to` → two
//     incomplete-warrant-missing-bridges-to hints (one per dangling
//     bridges-from).
//   - Warrant where the `bridges-to` is invisible → still treated
//     as incomplete (visibility filter).
//   - Isolated node → no hints.
//   - Self-`contradicts` edge → one self-contradicts hint.
//   - Non-self `contradicts` edge → no self-contradicts hint.
//   - Invisible self-`contradicts` edge → no hint.
//   - Multiple hints in one projection: incomplete-warrant + self-
//     contradicts → both kinds emitted.
//   - Two incomplete warrants of different kinds in one projection →
//     two hints, one of each kind, in rule-declaration order.
//
// Reuses the seedSession / createNode / createEdge helper pattern
// from the sibling test files. Each test builds a fresh projection
// via TS-literal events and applies them through `applyEvent`; no DB.
// Per the refinement "structural-only detection" decision, the tests
// don't commit substance on any node or edge — the hints fire on
// structure alone.

import { describe, expect, it } from 'vitest';

import type { Event, EdgeRole } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import { detectCoherencyHints } from './coherency-hint-detection.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111155';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

// Node ids. Use lexicographic ordering for assertion-friendly results.
const NODE_D = '66666666-6666-4666-8666-66666666660d';
const NODE_D2 = '66666666-6666-4666-8666-66666666060e';
const NODE_C = '66666666-6666-4666-8666-66666666660c';
const WARRANT_W = '66666666-6666-4666-8666-666666666601';
const WARRANT_W2 = '66666666-6666-4666-8666-666666666602';
const NODE_X = '66666666-6666-4666-8666-666666666603';
const NODE_Y = '66666666-6666-4666-8666-666666666604';

const EDGE_W_FROM_D = '77777777-7777-4777-8777-777777777711';
const EDGE_W_FROM_D2 = '77777777-7777-4777-8777-777777777712';
const EDGE_W_TO_C = '77777777-7777-4777-8777-777777777713';
const EDGE_W2_TO_C = '77777777-7777-4777-8777-777777777721';
const EDGE_SELF_CON = '77777777-7777-4777-8777-777777777731';
const EDGE_XY_CON = '77777777-7777-4777-8777-777777777732';

const T0 = '2026-05-12T18:00:00Z';
const T1 = '2026-05-12T18:00:01Z';
const T2 = '2026-05-12T18:00:02Z';

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

function nextSeq(): number {
  return seq++;
}

function resetSeq(): void {
  seq = 1;
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
  role: EdgeRole,
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

// Helpers for annotation-of-annotation-chain test cases. Per refinement
// D6 these wrap the existing `applyEvent` + `makeEvent` pattern; each
// new case needs 2–4 annotations and 1–3 annotation-to-annotation
// edges, and inlining the events would clutter the file.
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

function createAnnotationEdge(
  projection: Projection,
  edgeId: string,
  sourceAnnotationId: string,
  targetAnnotationId: string,
  role: EdgeRole,
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

// Helpers for self-referential-annotation-contradicts cases. Per
// refinement D8 two direction-named helpers (vs. one mixed-union
// helper) keep call sites direct.
function createNodeToAnnotationEdge(
  projection: Projection,
  edgeId: string,
  sourceNodeId: string,
  targetAnnotationId: string,
  role: EdgeRole,
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
  role: EdgeRole,
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

// ---------------------------------------------------------------
// No hints.
// ---------------------------------------------------------------

describe('detectCoherencyHints — no hints', () => {
  it('empty projection → no hints', () => {
    resetSeq();
    const projection = seedSession();
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('complete warrant (both bridge edges present) → no hints', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    createEdge(projection, EDGE_W_TO_C, WARRANT_W, NODE_C, 'bridges-to');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('isolated node (no outgoing edges) → no hints', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_X, 'X');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('non-self `contradicts` edge → no self-contradicts hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_X, 'X');
    createNode(projection, NODE_Y, 'Y');
    createEdge(projection, EDGE_XY_CON, NODE_X, NODE_Y, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('invisible self-`contradicts` edge → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_X, 'X');
    createEdge(projection, EDGE_SELF_CON, NODE_X, NODE_X, 'contradicts');
    projection.setEdgeVisible(EDGE_SELF_CON, false);
    expect(detectCoherencyHints(projection)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Incomplete-warrant hints.
// ---------------------------------------------------------------

describe('detectCoherencyHints — incomplete-warrant hints', () => {
  it('warrant with only `bridges-from` → one incomplete-warrant-missing-bridges-to hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: WARRANT_W,
        dataNodeId: NODE_D,
      },
    ]);
  });

  it('warrant with only `bridges-to` → one incomplete-warrant-missing-bridges-from hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_C, 'C');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_TO_C, WARRANT_W, NODE_C, 'bridges-to');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'incomplete-warrant-missing-bridges-from',
        warrantNodeId: WARRANT_W,
        claimNodeId: NODE_C,
      },
    ]);
  });

  it('warrant with two `bridges-from` and no `bridges-to` → two hints (one per dangling bridges-from)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_D2, 'D2');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    createEdge(projection, EDGE_W_FROM_D2, WARRANT_W, NODE_D2, 'bridges-from');
    const result = detectCoherencyHints(projection);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      kind: 'incomplete-warrant-missing-bridges-to',
      warrantNodeId: WARRANT_W,
      dataNodeId: NODE_D,
    });
    expect(result).toContainEqual({
      kind: 'incomplete-warrant-missing-bridges-to',
      warrantNodeId: WARRANT_W,
      dataNodeId: NODE_D2,
    });
  });

  it('warrant with `bridges-to` made invisible → still treated as incomplete (visibility filter)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    createEdge(projection, EDGE_W_TO_C, WARRANT_W, NODE_C, 'bridges-to');
    // Initially complete — no hint.
    expect(detectCoherencyHints(projection)).toEqual([]);
    // Flip the bridges-to invisible (mirrors a committed `break-edge`
    // effect; isolating the visibility filter without the proposal
    // sugar). Now the warrant looks structurally incomplete.
    projection.setEdgeVisible(EDGE_W_TO_C, false);
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: WARRANT_W,
        dataNodeId: NODE_D,
      },
    ]);
  });

  it('two incomplete warrants of different kinds in one projection → two hints, in rule-declaration order', () => {
    resetSeq();
    const projection = seedSession();
    // W has bridges-from only (missing bridges-to).
    createNode(projection, NODE_D, 'D');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    // W2 has bridges-to only (missing bridges-from).
    createNode(projection, NODE_C, 'C');
    createNode(projection, WARRANT_W2, 'W2');
    createEdge(projection, EDGE_W2_TO_C, WARRANT_W2, NODE_C, 'bridges-to');
    const result = detectCoherencyHints(projection);
    expect(result).toEqual([
      {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: WARRANT_W,
        dataNodeId: NODE_D,
      },
      {
        kind: 'incomplete-warrant-missing-bridges-from',
        warrantNodeId: WARRANT_W2,
        claimNodeId: NODE_C,
      },
    ]);
  });
});

// ---------------------------------------------------------------
// Self-contradicts hints.
// ---------------------------------------------------------------

describe('detectCoherencyHints — self-contradicts hints', () => {
  it('self-`contradicts` edge → one self-contradicts hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_X, 'X');
    createEdge(projection, EDGE_SELF_CON, NODE_X, NODE_X, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'self-contradicts',
        edgeId: EDGE_SELF_CON,
        nodeId: NODE_X,
      },
    ]);
  });

  it('self-`contradicts` plus a regular contradicts edge → only the self-loop emits a hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_X, 'X');
    createNode(projection, NODE_Y, 'Y');
    createEdge(projection, EDGE_SELF_CON, NODE_X, NODE_X, 'contradicts');
    createEdge(projection, EDGE_XY_CON, NODE_X, NODE_Y, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'self-contradicts',
        edgeId: EDGE_SELF_CON,
        nodeId: NODE_X,
      },
    ]);
  });
});

// ---------------------------------------------------------------
// Multiple-rule composition.
// ---------------------------------------------------------------

describe('detectCoherencyHints — multiple rules combined', () => {
  it('incomplete warrant + self-contradicts → both kinds emitted', () => {
    resetSeq();
    const projection = seedSession();
    // Incomplete warrant (missing bridges-to).
    createNode(projection, NODE_D, 'D');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    // Self-contradicts on an unrelated node.
    createNode(projection, NODE_X, 'X');
    createEdge(projection, EDGE_SELF_CON, NODE_X, NODE_X, 'contradicts');

    const result = detectCoherencyHints(projection);
    // Rule order: incomplete-missing-bridges-to first, then
    // self-contradicts last.
    expect(result).toEqual([
      {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: WARRANT_W,
        dataNodeId: NODE_D,
      },
      {
        kind: 'self-contradicts',
        edgeId: EDGE_SELF_CON,
        nodeId: NODE_X,
      },
    ]);
  });
});

// ---------------------------------------------------------------
// Annotation-endpoint edges — per `diagnostics_annotation_endpoint_semantics_audit`
// D3, coherency-hint detection skips annotation-endpoint edges. The
// v1 rules (incomplete-warrant, self-contradicts) are node-node by
// construction; candidate annotation-endpoint rules are pre-named
// under the audit's Tech-debt registration.
// ---------------------------------------------------------------

describe('detectCoherencyHints — annotation-endpoint edges (skipped per audit D3)', () => {
  it('warrant with bridges-from to an annotation target → no incomplete-warrant hint emitted', () => {
    resetSeq();
    const projection = seedSession();
    const ANNOTATION_ID = '00000000-0000-4000-8000-0000000c1001';
    const ANNOT_EDGE_ID = '00000000-0000-4000-8000-0000000c1002';
    createNode(projection, WARRANT_W, 'W');
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: ANNOTATION_ID,
        kind: 'note',
        content: 'annotation target',
        target_node_id: WARRANT_W,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: ANNOT_EDGE_ID,
        role: 'bridges-from',
        source_node_id: WARRANT_W,
        target_annotation_id: ANNOTATION_ID,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('incomplete-warrant rules emit no hints when bridges-from/bridges-to are annotation-endpoint', () => {
    resetSeq();
    const projection = seedSession();
    // A would-be warrant W reached entirely via annotation-endpoint
    // bridges-from and bridges-to. The rule walks outgoing edges of W
    // and skips annotation-target edges; from the detector's view W
    // has zero visible bridges-from and zero visible bridges-to → no
    // incomplete-warrant hint can fire.
    const ANN_D = '00000000-0000-4000-8000-0000000c2001';
    const ANN_C = '00000000-0000-4000-8000-0000000c2002';
    const E_W_FROM_ANN = '00000000-0000-4000-8000-0000000c2101';
    const E_W_TO_ANN = '00000000-0000-4000-8000-0000000c2102';
    createNode(projection, WARRANT_W, 'W');
    for (const annId of [ANN_D, ANN_C]) {
      applyEvent(
        projection,
        makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
          annotation_id: annId,
          kind: 'note',
          content: 'a',
          target_node_id: WARRANT_W,
          target_edge_id: null,
          created_by: DEBATER_A_ID,
          created_at: T2,
        }),
      );
    }
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_W_FROM_ANN,
        role: 'bridges-from',
        source_node_id: WARRANT_W,
        target_annotation_id: ANN_D,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_W_TO_ANN,
        role: 'bridges-to',
        source_node_id: WARRANT_W,
        target_annotation_id: ANN_C,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('self-contradicts rule emits no hint on annotation-endpoint self-loop-shaped contradicts edges', () => {
    resetSeq();
    const projection = seedSession();
    // A self-contradicts-like shape that crosses through an annotation:
    // node X contradicts an annotation that annotates X itself. The
    // self-contradicts rule requires sourceNodeId === targetNodeId
    // (node-node degenerate cycle); the annotation-endpoint guard
    // skips before the equality check, so no `self-contradicts` hint
    // fires — the audit D3 promise this test pins.
    //
    // The node↔own-annotation `contradicts` edge IS the positive
    // shape for the separately-landed `self-referential-annotation-contradicts`
    // rule (see `coherency_self_referential_annotation_contradicts_rule`);
    // that hint is expected here. The ann→ann self-loop is both-annotation
    // (mixed-endpoint filter rejects it) and a single-edge cycle
    // (annotation-of-annotation-chain self-loop guard rejects it), so
    // no further hint fires.
    const ANN_ON_X = '00000000-0000-4000-8000-0000000c3001';
    const E_X_CON_ANN = '00000000-0000-4000-8000-0000000c3002';
    const E_ANN_CON_ANN = '00000000-0000-4000-8000-0000000c3003';
    createNode(projection, NODE_X, 'X');
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: ANN_ON_X,
        kind: 'note',
        content: 'a',
        target_node_id: NODE_X,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    // node X → contradicts → annotation-on-X (node-source, annotation-target)
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_X_CON_ANN,
        role: 'contradicts',
        source_node_id: NODE_X,
        target_annotation_id: ANN_ON_X,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    // annotation-on-X → contradicts → annotation-on-X (ann→ann self-loop)
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: E_ANN_CON_ANN,
        role: 'contradicts',
        source_annotation_id: ANN_ON_X,
        target_annotation_id: ANN_ON_X,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    const hints = detectCoherencyHints(projection);
    expect(hints.filter((h) => h.kind === 'self-contradicts')).toEqual([]);
    expect(hints).toEqual([
      {
        kind: 'self-referential-annotation-contradicts',
        edgeId: E_X_CON_ANN,
        nodeId: NODE_X,
        annotationId: ANN_ON_X,
      },
    ]);
  });
});

// ---------------------------------------------------------------
// Annotation-of-annotation-chain hints.
//
// Refinement: tasks/refinements/data-and-methodology/coherency_annotation_of_annotation_chain_rule.md
//
// The rule fires once per visible annotation-to-annotation edge whose
// source annotation is itself the target of another visible
// annotation-to-annotation edge — i.e., the contiguous annotation-to-
// annotation chain reaches depth ≥ 2 at that edge.
// ---------------------------------------------------------------

const NODE_ANCHOR = '66666666-6666-4666-8666-666666666aaa';
const NODE_ANCHOR_2 = '66666666-6666-4666-8666-666666666abb';

const ANN_A1 = '00000000-0000-4000-8000-0000000aa001';
const ANN_A2 = '00000000-0000-4000-8000-0000000aa002';
const ANN_A3 = '00000000-0000-4000-8000-0000000aa003';
const ANN_A4 = '00000000-0000-4000-8000-0000000aa004';

const EDGE_AAE_1 = '00000000-0000-4000-8000-0000000ae001';
const EDGE_AAE_2 = '00000000-0000-4000-8000-0000000ae002';
const EDGE_AAE_3 = '00000000-0000-4000-8000-0000000ae003';

describe('detectCoherencyHints — annotation-of-annotation-chain hints', () => {
  it('single annotation-to-annotation edge (chain depth 1) → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createNode(projection, NODE_ANCHOR_2, 'anchor2');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR_2 });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('chain depth 2 → one hint on the second hop, carrying the first hop as incomingEdgeId', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A3, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_2,
        sourceAnnotationId: ANN_A2,
        targetAnnotationId: ANN_A3,
        incomingEdgeId: EDGE_AAE_1,
      },
    ]);
  });

  it('chain depth 3 → two hints, one per second-or-later hop', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A4, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A3, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_3, ANN_A3, ANN_A4, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_2,
        sourceAnnotationId: ANN_A2,
        targetAnnotationId: ANN_A3,
        incomingEdgeId: EDGE_AAE_1,
      },
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_3,
        sourceAnnotationId: ANN_A3,
        targetAnnotationId: ANN_A4,
        incomingEdgeId: EDGE_AAE_2,
      },
    ]);
  });

  it('branched chain → only the leaf with annotation-to-annotation incoming emits a hint', () => {
    // E1: A1 → A2, E2: A1 → A3, E3: A2 → A3. A2 is the target of E1
    // (an annotation-to-annotation edge), so E3 has an annotation-to-
    // annotation incoming. A1 is no annotation-to-annotation edge's
    // target, so E2 has none.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A1, ANN_A3, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_3, ANN_A2, ANN_A3, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_3,
        sourceAnnotationId: ANN_A2,
        targetAnnotationId: ANN_A3,
        incomingEdgeId: EDGE_AAE_1,
      },
    ]);
  });

  it('self-loop / cycle → every edge in the cycle emits a hint', () => {
    // E1: A1 → A2, E2: A2 → A1. Both annotations are the target of an
    // annotation-to-annotation edge, so every edge in the cycle is a
    // second-or-later hop.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A1, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_1,
        sourceAnnotationId: ANN_A1,
        targetAnnotationId: ANN_A2,
        incomingEdgeId: EDGE_AAE_2,
      },
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_2,
        sourceAnnotationId: ANN_A2,
        targetAnnotationId: ANN_A1,
        incomingEdgeId: EDGE_AAE_1,
      },
    ]);
  });

  it('node-endpoint edge in the middle of the path breaks the chain → no hint', () => {
    // E1: A1 → A2 (annotation-to-annotation), E2: A2 → N1 (node-target,
    // breaks chain), E3: N1 → A3 (node-source, also broken). Per D2 a
    // node anywhere in the path is *on* the substance graph, not the
    // metadata layer — the chain ends at the node.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createNode(projection, NODE_X, 'mid-chain node');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    // E2: A2 → N1 (annotation source, node target).
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EDGE_AAE_2,
        role: 'supports',
        source_annotation_id: ANN_A2,
        target_node_id: NODE_X,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    // E3: N1 → A3 (node source, annotation target).
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EDGE_AAE_3,
        role: 'supports',
        source_node_id: NODE_X,
        target_annotation_id: ANN_A3,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    const result = detectCoherencyHints(projection);
    expect(result.filter((h) => h.kind === 'annotation-of-annotation-chain')).toEqual([]);
  });

  it('invisibility of the chain-establishing edge breaks the chain', () => {
    // E1: A1 → A2, E2: A2 → A3. Mark E1 invisible. A2 is no longer the
    // target of a *visible* annotation-to-annotation edge, so E2 emits
    // no hint.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A3, 'supports');
    projection.setEdgeVisible(EDGE_AAE_1, false);
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('invisible endpoint annotation breaks the chain', () => {
    // E1: A1 → A2, E2: A2 → A3 — both edges visible, but A2 marked
    // invisible. The defensive endpoint-visibility guard rejects both
    // E1 (target A2 invisible) and E2 (source A2 invisible).
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A3, 'supports');
    projection.setAnnotationVisible(ANN_A2, false);
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('coexists with other coherency hints in rule-declaration order', () => {
    // One incomplete-warrant (node-node) AND one depth-2 annotation
    // chain. The aggregator emits the incomplete-warrant hint before
    // the annotation-of-annotation-chain hint (rules 1–3 before rule
    // 4 in the registry).
    resetSeq();
    const projection = seedSession();
    // Incomplete warrant: W has bridges-from to D but no bridges-to.
    createNode(projection, NODE_D, 'D');
    createNode(projection, WARRANT_W, 'W');
    createEdge(projection, EDGE_W_FROM_D, WARRANT_W, NODE_D, 'bridges-from');
    // Depth-2 annotation chain on an unrelated anchor.
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A3, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'incomplete-warrant-missing-bridges-to',
        warrantNodeId: WARRANT_W,
        dataNodeId: NODE_D,
      },
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_2,
        sourceAnnotationId: ANN_A2,
        targetAnnotationId: ANN_A3,
        incomingEdgeId: EDGE_AAE_1,
      },
    ]);
  });
});

// ---------------------------------------------------------------
// Self-referential-annotation-contradicts hints.
//
// Refinement: tasks/refinements/data-and-methodology/coherency_self_referential_annotation_contradicts_rule.md
//
// The rule fires once per visible `contradicts` edge connecting a
// node `N` and an annotation `A` whose anchor is `N` — in either
// edge direction (per D2).
// ---------------------------------------------------------------

const EDGE_SRAC_1 = '00000000-0000-4000-8000-0000000c5e01';
const EDGE_SRAC_2 = '00000000-0000-4000-8000-0000000c5e02';
const ANN_SR_1 = '00000000-0000-4000-8000-0000000c5e11';
const ANN_SR_2 = '00000000-0000-4000-8000-0000000c5e12';
const NODE_SR = '66666666-6666-4666-8666-666666666551';
const NODE_SR_2 = '66666666-6666-4666-8666-666666666552';
const EDGE_SR_PEER = '00000000-0000-4000-8000-0000000c5e21';

describe('detectCoherencyHints — self-referential-annotation-contradicts hints', () => {
  it('node N → contradicts → annotation A where A annotates N → one hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'self-referential-annotation-contradicts',
        edgeId: EDGE_SRAC_1,
        nodeId: NODE_SR,
        annotationId: ANN_SR_1,
      },
    ]);
  });

  it('annotation A → contradicts → node N where A annotates N → one hint (direction-symmetric per D2)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createAnnotationToNodeEdge(projection, EDGE_SRAC_1, ANN_SR_1, NODE_SR, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'self-referential-annotation-contradicts',
        edgeId: EDGE_SRAC_1,
        nodeId: NODE_SR,
        annotationId: ANN_SR_1,
      },
    ]);
  });

  it('wrong role (supports) on the same shape → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'supports');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('annotation anchors a different node → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N1');
    createNode(projection, NODE_SR_2, 'N2');
    // A anchors on N2 but the contradicts edge runs N1 ↔ A.
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR_2 });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('annotation anchors an edge (not a node) → no hint (per D3 — edge-anchor variant out of scope)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createNode(projection, NODE_SR_2, 'N2');
    // A peer edge to anchor the annotation against.
    createEdge(projection, EDGE_SR_PEER, NODE_SR, NODE_SR_2, 'supports');
    createAnnotation(projection, ANN_SR_1, { edgeId: EDGE_SR_PEER });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('both endpoints are annotations (annotation→annotation contradicts) → no self-referential hint', () => {
    // Two annotations on the same node N, with `A1 → contradicts → A2`.
    // The mixed-endpoint filter excludes both-annotation edges; the
    // annotation-of-annotation-chain rule only fires when the source
    // annotation is also the target of another annotation-to-annotation
    // edge, which isn't the case here either.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createAnnotation(projection, ANN_SR_2, { nodeId: NODE_SR });
    createAnnotationEdge(projection, EDGE_SRAC_1, ANN_SR_1, ANN_SR_2, 'contradicts');
    expect(
      detectCoherencyHints(projection).filter(
        (h) => h.kind === 'self-referential-annotation-contradicts',
      ),
    ).toEqual([]);
  });

  it('both endpoints are nodes (node→node contradicts) → no self-referential hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N1');
    createNode(projection, NODE_SR_2, 'N2');
    createEdge(projection, EDGE_SRAC_1, NODE_SR, NODE_SR_2, 'contradicts');
    expect(
      detectCoherencyHints(projection).filter(
        (h) => h.kind === 'self-referential-annotation-contradicts',
      ),
    ).toEqual([]);
  });

  it('invisible edge → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    projection.setEdgeVisible(EDGE_SRAC_1, false);
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('invisible node endpoint → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    projection.setNodeVisible(NODE_SR, false);
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('invisible annotation endpoint → no hint', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    projection.setAnnotationVisible(ANN_SR_1, false);
    expect(detectCoherencyHints(projection)).toEqual([]);
  });

  it('coexists with self-contradicts on the same node, in rule-declaration order', () => {
    // N → contradicts → N (fires self-contradicts) AND
    // N → contradicts → A where A annotates N (fires this rule).
    // Rule declaration order: self-contradicts is rule 3, this rule is
    // rule 5; self-contradicts emits first.
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_SR, 'N');
    createEdge(projection, EDGE_SRAC_2, NODE_SR, NODE_SR, 'contradicts');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'self-contradicts',
        edgeId: EDGE_SRAC_2,
        nodeId: NODE_SR,
      },
      {
        kind: 'self-referential-annotation-contradicts',
        edgeId: EDGE_SRAC_1,
        nodeId: NODE_SR,
        annotationId: ANN_SR_1,
      },
    ]);
  });

  it('coexists with annotation-of-annotation-chain, in rule-declaration order', () => {
    // Depth-2 annotation chain on one anchor + self-referential-annotation-
    // contradicts on a separate anchor. Both rules fire; annotation-of-
    // annotation-chain (rule 4) emits before self-referential-annotation-
    // contradicts (rule 5).
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_ANCHOR, 'anchor');
    createAnnotation(projection, ANN_A1, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A2, { nodeId: NODE_ANCHOR });
    createAnnotation(projection, ANN_A3, { nodeId: NODE_ANCHOR });
    createAnnotationEdge(projection, EDGE_AAE_1, ANN_A1, ANN_A2, 'supports');
    createAnnotationEdge(projection, EDGE_AAE_2, ANN_A2, ANN_A3, 'supports');
    // Self-referential-annotation-contradicts on an unrelated node.
    createNode(projection, NODE_SR, 'N');
    createAnnotation(projection, ANN_SR_1, { nodeId: NODE_SR });
    createNodeToAnnotationEdge(projection, EDGE_SRAC_1, NODE_SR, ANN_SR_1, 'contradicts');
    expect(detectCoherencyHints(projection)).toEqual([
      {
        kind: 'annotation-of-annotation-chain',
        edgeId: EDGE_AAE_2,
        sourceAnnotationId: ANN_A2,
        targetAnnotationId: ANN_A3,
        incomingEdgeId: EDGE_AAE_1,
      },
      {
        kind: 'self-referential-annotation-contradicts',
        edgeId: EDGE_SRAC_1,
        nodeId: NODE_SR,
        annotationId: ANN_SR_1,
      },
    ]);
  });
});
