// Tests for `detectDanglingClaims`.
//
// Refinement: tasks/refinements/data-and-methodology/dangling_claim_detection.md
// TaskJuggler: data_and_methodology.diagnostics.dangling_claim_detection
//
// Coverage:
//   - Empty projection → no dangling claims.
//   - Isolated node (no edges at all) → not claim-positioned → not
//     detected.
//   - Node with only outgoing edges → not claim-positioned → not
//     detected.
//   - Node with incoming `defines` only → claim-positioned but
//     unjustified → dangling, detected.
//   - Node with incoming `qualifies` only → dangling, detected.
//   - Node with incoming `contradicts` only → dangling, detected
//     (follows the doc's literal triplet — contradicts is excluded
//     from justification).
//   - Node with incoming `bridges-from` only → dangling, detected
//     (`bridges-from` points at the data side; the data side is not
//     "claim-justified" in the Toulmin sense).
//   - Node with incoming `supports` only → not dangling.
//   - Node with incoming `rebuts` only → not dangling (`rebuts` IS
//     engagement per the doc's triplet).
//   - Node with incoming `bridges-to` only → not dangling.
//   - Mixed: `defines` + `supports` → not dangling.
//   - Mixed: `contradicts` + `defines` → dangling.
//   - Broken (invisible) `supports` edge → falls back to remaining
//     incoming edges; if none are in the triplet, dangling.
//   - Invisible source on the only incoming edge → not claim-
//     positioned (defensive filter).
//   - Multiple dangling nodes in one projection → multiple entries.
//
// Reuses the seedSession / createNode / createEdge helper pattern
// from the sibling test files. Each test builds a fresh projection
// via TS-literal events and applies them through `applyEvent`; no DB.
// Per the refinement "structural-only detection" decision, the tests
// don't commit substance on any node or edge — the diagnostic fires
// on structure alone.

import { describe, expect, it } from 'vitest';

import type { Event, EdgeRole } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import { detectDanglingClaims } from './dangling-claim-detection.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111144';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

// Node ids; the detector emits in projection.nodes() insertion order,
// which is creation order.
const NODE_A = '66666666-6666-4666-8666-66666666660a';
const NODE_B = '66666666-6666-4666-8666-66666666660b';
const NODE_C = '66666666-6666-4666-8666-66666666660c';
const NODE_D = '66666666-6666-4666-8666-66666666660d';

const EDGE_AB = '77777777-7777-4777-8777-7777777777ab';
const EDGE_AB_2 = '77777777-7777-4777-8777-7777777777b2';
const EDGE_CB = '77777777-7777-4777-8777-7777777777cb';
const EDGE_AD = '77777777-7777-4777-8777-7777777777ad';

const T0 = '2026-05-11T12:00:00Z';
const T1 = '2026-05-11T12:00:01Z';
const T2 = '2026-05-11T12:00:02Z';
const T3 = '2026-05-11T12:00:03Z';
const T4 = '2026-05-11T12:00:04Z';
const T7 = '2026-05-11T12:00:07Z';

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

// ---------------------------------------------------------------
// Not detected (no claim-positioning, or fully justified).
// ---------------------------------------------------------------

describe('detectDanglingClaims — not detected', () => {
  it('empty projection → no dangling claims', () => {
    resetSeq();
    const projection = seedSession();
    expect(detectDanglingClaims(projection)).toEqual([]);
  });

  it('isolated node (no edges at all) → not claim-positioned → not detected', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    expect(detectDanglingClaims(projection)).toEqual([]);
  });

  it('node with only outgoing edges → not claim-positioned → not detected', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    // A → B supports — A has only an outgoing edge; B has an
    // incoming supports edge (which justifies B, so B is also not
    // dangling). Neither node should be detected.
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'supports');
    expect(detectDanglingClaims(projection)).toEqual([]);
  });

  it('node with incoming `supports` only → not dangling', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'supports');
    const result = detectDanglingClaims(projection);
    // A is not claim-positioned (no incoming). B is justified by
    // the supports. Neither should be detected.
    expect(result).toEqual([]);
  });

  it('node with incoming `rebuts` only → not dangling (rebuts IS engagement per the doc triplet)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'rebuts');
    expect(detectDanglingClaims(projection)).toEqual([]);
  });

  it('node with incoming `bridges-to` only → not dangling (warrant-target counts as justification)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A'); // warrant
    createNode(projection, NODE_B, 'B'); // claim
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'bridges-to');
    expect(detectDanglingClaims(projection)).toEqual([]);
  });

  it('node with mixed incoming `defines` + `supports` → not dangling (at least one justification edge)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'defines');
    createEdge(projection, EDGE_CB, NODE_C, NODE_B, 'supports');
    expect(detectDanglingClaims(projection)).toEqual([]);
  });

  it('invisible source on the only incoming edge → not claim-positioned (defensive filter)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    // Force-flip the source invisible directly via the projection
    // setter. Mirrors the multi-warrant-detection test pattern.
    // With the source invisible, the incoming-edge filter rejects
    // this edge; B has no surviving claim-positioning edge.
    projection.setNodeVisible(NODE_A, false);
    expect(detectDanglingClaims(projection)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Detected (claim-positioned and unjustified).
// ---------------------------------------------------------------

describe('detectDanglingClaims — detected', () => {
  it('node with incoming `defines` only → dangling (defines is not in the justification triplet)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'defines');
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });

  it('node with incoming `qualifies` only → dangling', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'qualifies');
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });

  it('node with incoming `contradicts` only → dangling (follows the doc triplet literally)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    // A is not claim-positioned (no incoming). B has only a
    // contradicts incoming — claim-positioned but unjustified.
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });

  it('node with incoming `bridges-from` only → dangling (data side of a warrant pattern)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A'); // warrant
    createNode(projection, NODE_B, 'B'); // data
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'bridges-from');
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });

  it('mixed incoming `contradicts` + `defines` → dangling (neither is justification)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'contradicts');
    createEdge(projection, EDGE_CB, NODE_C, NODE_B, 'defines');
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });

  it('broken `supports` edge falls back to remaining incoming `defines` → dangling', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'supports');
    createEdge(projection, EDGE_CB, NODE_C, NODE_B, 'defines');
    // Sanity: with supports visible, B is justified — no detection.
    expect(detectDanglingClaims(projection)).toEqual([]);
    // Break the supports edge (committed break-edge). Now B's only
    // visible incoming is defines → dangling.
    commitBreakEdge(projection, EDGE_AB);
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });

  it('multiple dangling nodes in one projection → multiple entries (in nodes() insertion order)', () => {
    resetSeq();
    const projection = seedSession();
    // Create source first, then targets in B, D order to verify
    // the result follows projection.nodes() insertion order.
    createNode(projection, NODE_A, 'A'); // source — has no incoming
    createNode(projection, NODE_B, 'B'); // dangling (defines from A)
    createNode(projection, NODE_C, 'C'); // source — has no incoming
    createNode(projection, NODE_D, 'D'); // dangling (contradicts from C)
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'defines');
    createEdge(projection, EDGE_CB, NODE_C, NODE_D, 'contradicts');
    const result = detectDanglingClaims(projection);
    expect(result).toEqual([{ nodeId: NODE_B }, { nodeId: NODE_D }]);
  });

  it('two parallel incoming edges, both unjustifying → single entry (one node — no double-counting)', () => {
    resetSeq();
    const projection = seedSession();
    createNode(projection, NODE_A, 'A');
    createNode(projection, NODE_B, 'B');
    createNode(projection, NODE_C, 'C');
    // Two edges from different sources, both into B, both unjustifying.
    createEdge(projection, EDGE_AB, NODE_A, NODE_B, 'defines');
    createEdge(projection, EDGE_AB_2, NODE_A, NODE_B, 'qualifies');
    createEdge(projection, EDGE_AD, NODE_C, NODE_B, 'contradicts');
    expect(detectDanglingClaims(projection)).toEqual([{ nodeId: NODE_B }]);
  });
});
