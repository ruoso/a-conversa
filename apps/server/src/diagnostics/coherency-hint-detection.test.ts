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
// Annotation-endpoint edges — per `projection_edge_annotation_endpoint`
// D4, coherency-hint detection skips annotation-endpoint edges (warrant
// rules + self-contradicts are node-node constructs).
// ---------------------------------------------------------------

describe('detectCoherencyHints — annotation-endpoint edges (skipped per D4)', () => {
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
});
