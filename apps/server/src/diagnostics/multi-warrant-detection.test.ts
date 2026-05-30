// Tests for `detectMultiWarrants`.
//
// Refinement: tasks/refinements/data-and-methodology/multi_warrant_detection.md
// TaskJuggler: data_and_methodology.diagnostics.multi_warrant_detection
//
// Coverage:
//   - Empty projection → no multi-warrants.
//   - Single complete warrant on (D, C) → no multi-warrant.
//   - Two complete warrants on (D, C) → one multi-warrant entry.
//   - Two warrants on different (D, C) pairs → no multi-warrants.
//   - One complete + one incomplete (missing bridges-to) on (D, C) →
//     no multi-warrant.
//   - One complete + one incomplete (missing bridges-from) on (D, C)
//     → no multi-warrant.
//   - Three complete warrants on (D, C) → one entry with all three
//     warrant ids, sorted.
//   - Non-visible bridges-from → excluded.
//   - Non-visible bridges-to → excluded.
//   - Warrant with two bridges-to to different claims contributes
//     to each (D, C) group separately.
//
// Reuses the seedSession / createNode / createEdge helper pattern
// from `cycle-detection.test.ts` and `contradiction-detection.test.ts`.
// Each test builds a fresh projection via TS-literal events and
// applies them through `applyEvent`; no DB. Per the refinement
// "structural-only detection" decision, the tests don't commit
// substance on any node or edge — the pattern fires on structure
// alone.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import { detectMultiWarrants } from './multi-warrant-detection.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111133';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

// Node ids chosen so that NODE_D < NODE_C lexicographically AND
// WARRANT_W1 < WARRANT_W2 < WARRANT_W3 for stable sort assertions.
const NODE_D = '66666666-6666-4666-8666-66666666660d';
const NODE_D2 = '66666666-6666-4666-8666-66666666060e';
const NODE_C = '66666666-6666-4666-8666-66666666660c';
const NODE_C2 = '66666666-6666-4666-8666-66666666060f';
const WARRANT_W1 = '66666666-6666-4666-8666-666666666601';
const WARRANT_W2 = '66666666-6666-4666-8666-666666666602';
const WARRANT_W3 = '66666666-6666-4666-8666-666666666603';

// Edge ids: name `EDGE_<W>_FROM_<D>` for bridges-from W→D and
// `EDGE_<W>_TO_<C>` for bridges-to W→C.
const EDGE_W1_FROM_D = '77777777-7777-4777-8777-777777777711';
const EDGE_W1_TO_C = '77777777-7777-4777-8777-777777777712';
const EDGE_W2_FROM_D = '77777777-7777-4777-8777-777777777721';
const EDGE_W2_TO_C = '77777777-7777-4777-8777-777777777722';
const EDGE_W3_FROM_D = '77777777-7777-4777-8777-777777777731';
const EDGE_W3_TO_C = '77777777-7777-4777-8777-777777777732';
const _EDGE_W1_FROM_D2 = '77777777-7777-4777-8777-777777777741';
const EDGE_W2_TO_C2 = '77777777-7777-4777-8777-777777777742';
const EDGE_W1_TO_C2 = '77777777-7777-4777-8777-777777777743';

const T0 = '2026-05-10T18:00:00Z';
const T1 = '2026-05-10T18:00:01Z';
const T2 = '2026-05-10T18:00:02Z';

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

function createBridgesFromEdge(
  projection: Projection,
  edgeId: string,
  warrant: string,
  data: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role: 'bridges-from',
      source_node_id: warrant,
      target_node_id: data,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

function createBridgesToEdge(
  projection: Projection,
  edgeId: string,
  warrant: string,
  claim: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role: 'bridges-to',
      source_node_id: warrant,
      target_node_id: claim,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

// Build a complete warrant W: createNode(W), createNode(D) if not
// already, createNode(C) if not already, plus the two bridge edges.
// Callers ensure D and C are created exactly once.
function buildCompleteWarrant(
  projection: Projection,
  warrant: string,
  fromEdgeId: string,
  toEdgeId: string,
  data: string,
  claim: string,
): void {
  createNode(projection, warrant, `Warrant ${warrant.slice(-2)}`);
  createBridgesFromEdge(projection, fromEdgeId, warrant, data);
  createBridgesToEdge(projection, toEdgeId, warrant, claim);
}

// ---------------------------------------------------------------
// No multi-warrants.
// ---------------------------------------------------------------

describe('detectMultiWarrants — no multi-warrants', () => {
  it('empty projection → no multi-warrants', () => {
    resetSeq();
    const projection = seedSession();
    expect(detectMultiWarrants(projection)).toEqual([]);
  });

  it('single complete warrant on (D, C) → no multi-warrant', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    expect(detectMultiWarrants(projection)).toEqual([]);
  });

  it('two warrants on different (D, C) pairs → no multi-warrants', () => {
    resetSeq();
    const projection = seedSession();
    // (D, C) and (D2, C2) — each gets one warrant, neither pair has 2.
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    createNode(projection, NODE_D2, 'D2');
    createNode(projection, NODE_C2, 'C2');
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    buildCompleteWarrant(projection, WARRANT_W2, EDGE_W2_FROM_D, EDGE_W2_TO_C, NODE_D2, NODE_C2);
    expect(detectMultiWarrants(projection)).toEqual([]);
  });

  it('one complete + one incomplete (missing bridges-to) warrant on (D, C) → no multi-warrant', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    // Complete W1 → (D, C).
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    // Incomplete W2: bridges-from only, no bridges-to.
    createNode(projection, WARRANT_W2, 'W2');
    createBridgesFromEdge(projection, EDGE_W2_FROM_D, WARRANT_W2, NODE_D);
    // No bridges-to for W2 → W2 is not a complete warrant on (D, C).
    expect(detectMultiWarrants(projection)).toEqual([]);
  });

  it('one complete + one incomplete (missing bridges-from) warrant on (D, C) → no multi-warrant', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    // Complete W1.
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    // Incomplete W2: bridges-to only, no bridges-from. The outer walk
    // is over bridges-from edges, so W2 is never even considered as
    // a warrant for (D, C) — but for completeness assert no detection.
    createNode(projection, WARRANT_W2, 'W2');
    createBridgesToEdge(projection, EDGE_W2_TO_C, WARRANT_W2, NODE_C);
    expect(detectMultiWarrants(projection)).toEqual([]);
  });

  it('non-visible bridges-from edge → warrant excluded; only one complete warrant remains → no multi-warrant', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    buildCompleteWarrant(projection, WARRANT_W2, EDGE_W2_FROM_D, EDGE_W2_TO_C, NODE_D, NODE_C);
    // Flip W2's bridges-from invisible directly through the projection's
    // setter (no event sugar; this isolates the visibility filter).
    projection.setEdgeVisible(EDGE_W2_FROM_D, false);
    expect(detectMultiWarrants(projection)).toEqual([]);
  });

  it('non-visible bridges-to edge → warrant excluded; only one complete warrant remains → no multi-warrant', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    buildCompleteWarrant(projection, WARRANT_W2, EDGE_W2_FROM_D, EDGE_W2_TO_C, NODE_D, NODE_C);
    projection.setEdgeVisible(EDGE_W2_TO_C, false);
    expect(detectMultiWarrants(projection)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Multi-warrants detected.
// ---------------------------------------------------------------

describe('detectMultiWarrants — multi-warrants detected', () => {
  it('two complete warrants on the same (D, C) → one entry with both warrant ids', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    buildCompleteWarrant(projection, WARRANT_W2, EDGE_W2_FROM_D, EDGE_W2_TO_C, NODE_D, NODE_C);
    const result = detectMultiWarrants(projection);
    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toBeDefined();
    expect(entry?.dataNodeId).toBe(NODE_D);
    expect(entry?.claimNodeId).toBe(NODE_C);
    // Sorted lexicographically — W1 < W2.
    expect(entry?.warrantNodeIds).toEqual([WARRANT_W1, WARRANT_W2]);
  });

  it('three complete warrants on (D, C) → one entry with all three warrant ids, sorted', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    // Build warrants out of natural sort order to verify the detector
    // sorts the warrantNodeIds list rather than relying on insertion.
    buildCompleteWarrant(projection, WARRANT_W3, EDGE_W3_FROM_D, EDGE_W3_TO_C, NODE_D, NODE_C);
    buildCompleteWarrant(projection, WARRANT_W1, EDGE_W1_FROM_D, EDGE_W1_TO_C, NODE_D, NODE_C);
    buildCompleteWarrant(projection, WARRANT_W2, EDGE_W2_FROM_D, EDGE_W2_TO_C, NODE_D, NODE_C);
    const result = detectMultiWarrants(projection);
    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry?.dataNodeId).toBe(NODE_D);
    expect(entry?.claimNodeId).toBe(NODE_C);
    expect(entry?.warrantNodeIds).toEqual([WARRANT_W1, WARRANT_W2, WARRANT_W3]);
  });

  it('warrant with two bridges-to to different claims contributes to each (D, C) separately', () => {
    resetSeq();
    const projection = seedSession();
    // Structure:
    //   - D, C, C2 nodes.
    //   - W1: bridges-from→D, bridges-to→C, bridges-to→C2.
    //   - W2: bridges-from→D, bridges-to→C  (so (D, C) has W1 + W2).
    //   - For (D, C2): only W1 is present, so no multi-warrant on
    //     (D, C2) — we'd need a second warrant to fire.
    // To make the test useful, add a second warrant that also bridges
    // to C2: W3 bridges-from→D, bridges-to→C2. Then (D, C) has {W1,
    // W2} and (D, C2) has {W1, W3} — two multi-warrant entries.
    createNode(projection, NODE_D, 'D');
    createNode(projection, NODE_C, 'C');
    createNode(projection, NODE_C2, 'C2');
    createNode(projection, WARRANT_W1, 'W1');
    createBridgesFromEdge(projection, EDGE_W1_FROM_D, WARRANT_W1, NODE_D);
    createBridgesToEdge(projection, EDGE_W1_TO_C, WARRANT_W1, NODE_C);
    createBridgesToEdge(projection, EDGE_W1_TO_C2, WARRANT_W1, NODE_C2);
    buildCompleteWarrant(projection, WARRANT_W2, EDGE_W2_FROM_D, EDGE_W2_TO_C, NODE_D, NODE_C);
    // W3 bridges-from→D, bridges-to→C2.
    createNode(projection, WARRANT_W3, 'W3');
    createBridgesFromEdge(projection, EDGE_W3_FROM_D, WARRANT_W3, NODE_D);
    createBridgesToEdge(projection, EDGE_W2_TO_C2, WARRANT_W3, NODE_C2);

    const result = detectMultiWarrants(projection);
    expect(result).toHaveLength(2);
    const byPair = new Map(result.map((e) => [`${e.dataNodeId} ${e.claimNodeId}`, e]));
    const dcEntry = byPair.get(`${NODE_D} ${NODE_C}`);
    expect(dcEntry).toBeDefined();
    expect(dcEntry?.warrantNodeIds).toEqual([WARRANT_W1, WARRANT_W2]);
    const dc2Entry = byPair.get(`${NODE_D} ${NODE_C2}`);
    expect(dc2Entry).toBeDefined();
    expect(dc2Entry?.warrantNodeIds).toEqual([WARRANT_W1, WARRANT_W3]);
  });
});

// ---------------------------------------------------------------
// Annotation-endpoint edges — per `projection_edge_annotation_endpoint`
// D4, multi-warrant detection skips annotation-endpoint edges (warrants
// are node-node constructs).
// ---------------------------------------------------------------

describe('detectMultiWarrants — annotation-endpoint edges (skipped per D4)', () => {
  it('bridges-from with annotation source/target → no findings', () => {
    resetSeq();
    const projection = seedSession();
    const ANNOTATION_ID = '00000000-0000-4000-8000-0000000c1001';
    const ANNOT_EDGE_ID = '00000000-0000-4000-8000-0000000c1002';
    createNode(projection, NODE_D, 'D');
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: ANNOTATION_ID,
        kind: 'note',
        content: 'annotation source',
        target_node_id: NODE_D,
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
        source_annotation_id: ANNOTATION_ID,
        target_node_id: NODE_D,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(detectMultiWarrants(projection)).toEqual([]);
  });
});
