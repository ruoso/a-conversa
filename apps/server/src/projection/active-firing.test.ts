// Tests for `isEdgeActive` / `getActiveFiring`.
//
// Refinement: tasks/refinements/data-and-methodology/active_firing_computation.md
// TaskJuggler: data_and_methodology.projection.active_firing_computation
//
// Coverage:
//   - Edge with proposed substance (source proposed) → not active.
//   - Edge agreed, source proposed → not active.
//   - Edge agreed, source agreed (both pre-commit) → active.
//   - Edge committed, source committed → active.
//   - Edge committed → one participant withdraws edge substance →
//     not active.
//   - Source committed → one participant withdraws source substance
//     → not active.
//   - meta-disagreement on edge → not active; same on source → not
//     active.
//   - Edge committed with value 'disputed' → not active.
//   - Source committed with value 'disputed' → not active.
//   - Target-node substance is irrelevant (firing depends only on
//     edge + source).
//   - Property test: random vote sequences, walk every edge, derived
//     equals reference impl.
//   - `getActiveFiring` round-trips with `isEdgeActive`.
//   - Throws `ActiveFiringComputationError` on unknown edge id.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from './projection.js';
import { applyEvent } from './replay.js';
import { ActiveFiringComputationError, getActiveFiring, isEdgeActive } from './active-firing.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const SOURCE_NODE_ID = '66666666-6666-4666-8666-666666666666';
const TARGET_NODE_ID = '77777777-7777-4777-8777-777777777777';
const EDGE_ID = '88888888-8888-4888-8888-888888888888';

const PROP_EDGE_SUBSTANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROP_SOURCE_SUBSTANCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROP_TARGET_SUBSTANCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';
const T7 = '2026-05-10T12:00:07Z';
const T8 = '2026-05-10T12:00:08Z';

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

// Seed a session with: session-created, 3 participants joined, two
// nodes (source + target), one supports edge between them. Returns
// the projection at whatever sequence number we land on.
function seedSessionWithEdge(): ReturnType<typeof createEmptyProjection> {
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
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'node-created', DEBATER_A_ID, T2, {
      node_id: SOURCE_NODE_ID,
      wording: 'Source statement.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'node-created', DEBATER_A_ID, T2, {
      node_id: TARGET_NODE_ID,
      wording: 'Target statement.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: EDGE_ID,
      role: 'supports',
      source_node_id: SOURCE_NODE_ID,
      target_node_id: TARGET_NODE_ID,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

function proposeSetNodeSubstance(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string,
  nodeId: string,
  value: 'agreed' | 'disputed' = 'agreed',
): void {
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value },
    }),
    id: proposalId,
  });
}

function proposeSetEdgeSubstance(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string,
  edgeId: string,
  value: 'agreed' | 'disputed' = 'agreed',
): void {
  applyEvent(projection, {
    ...makeEvent(nextSeq(), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value },
    }),
    id: proposalId,
  });
}

function castVote(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string,
  participant: string,
  vote: 'agree' | 'dispute',
  voteTime: string = T4,
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'vote', participant, voteTime, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote,
      voted_at: voteTime,
    }),
  );
}

function commit(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string,
  commitTime: string = T7,
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'commit', MODERATOR_ID, commitTime, {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: MODERATOR_ID,
      committed_at: commitTime,
    }),
  );
}

function markMetaDisagreement(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string,
  markedAt: string = T8,
): void {
  applyEvent(
    projection,
    makeEvent(nextSeq(), 'meta-disagreement-marked', MODERATOR_ID, markedAt, {
      target: 'proposal',
      proposal_id: proposalId,
      marked_by: MODERATOR_ID,
      marked_at: markedAt,
    }),
  );
}

// All three participants vote agree on the given proposal.
function allAgree(projection: ReturnType<typeof createEmptyProjection>, proposalId: string): void {
  castVote(projection, proposalId, MODERATOR_ID, 'agree');
  castVote(projection, proposalId, DEBATER_A_ID, 'agree');
  castVote(projection, proposalId, DEBATER_B_ID, 'agree');
}

// ---------------------------------------------------------------
// Not active — substance not yet agreed.
// ---------------------------------------------------------------

describe('isEdgeActive — substance not settled', () => {
  it('edge with no substance proposal, source with no substance proposal → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });

  it('edge substance only partial-agree → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    castVote(projection, PROP_EDGE_SUBSTANCE_ID, MODERATOR_ID, 'agree');
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });

  it('edge agreed but source-node substance still proposed → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    // No proposal on source substance at all.
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });

  it('source agreed but edge substance still proposed → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Active — agreed and committed.
// ---------------------------------------------------------------

describe('isEdgeActive — both settled', () => {
  it('both edge and source substance agreed (pre-commit) → active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(true);
  });

  it('both edge and source substance committed → active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(true);
  });

  it('edge agreed, source committed → active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(true);
  });
});

// ---------------------------------------------------------------
// Withdrawal — committed then withdrawn → not active.
// ---------------------------------------------------------------

describe('isEdgeActive — withdrawal disables firing', () => {
  // Per ADR 0030 §3 + `pf_projection_facet_status_refactor`: withdrawal
  // is its own first-class event kind (`withdraw-agreement`), keyed by
  // `(entity, facet, participant)`. A withdrawal against a committed
  // facet flips the derived status to `'withdrawn'`; the active-firing
  // gate reads that as "not active."
  it('edge committed then withdrawn → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    // Now emit a `withdraw-agreement` event against the edge's substance facet.
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'withdraw-agreement', DEBATER_B_ID, T8, {
        entity_kind: 'edge',
        entity_id: EDGE_ID,
        facet: 'substance',
        participant: DEBATER_B_ID,
        withdrawn_at: T8,
      }),
    );
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });

  it('source committed then withdrawn → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    applyEvent(
      projection,
      makeEvent(nextSeq(), 'withdraw-agreement', DEBATER_A_ID, T8, {
        entity_kind: 'node',
        entity_id: SOURCE_NODE_ID,
        facet: 'substance',
        participant: DEBATER_A_ID,
        withdrawn_at: T8,
      }),
    );
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Meta-disagreement.
// ---------------------------------------------------------------

describe('isEdgeActive — meta-disagreement disables firing', () => {
  it('meta-disagreement on edge substance → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    castVote(projection, PROP_EDGE_SUBSTANCE_ID, MODERATOR_ID, 'agree');
    castVote(projection, PROP_EDGE_SUBSTANCE_ID, DEBATER_A_ID, 'dispute');
    castVote(projection, PROP_EDGE_SUBSTANCE_ID, DEBATER_B_ID, 'dispute');
    markMetaDisagreement(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });

  it('meta-disagreement on source substance → not active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    castVote(projection, PROP_SOURCE_SUBSTANCE_ID, MODERATOR_ID, 'agree');
    castVote(projection, PROP_SOURCE_SUBSTANCE_ID, DEBATER_A_ID, 'dispute');
    castVote(projection, PROP_SOURCE_SUBSTANCE_ID, DEBATER_B_ID, 'dispute');
    markMetaDisagreement(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Settled-disputed values — committed `value: 'disputed'` does not
// fire (the relation / content is settled-not-holding).
// ---------------------------------------------------------------

describe("isEdgeActive — committed substance with value 'disputed' does not fire", () => {
  it("edge substance committed with value 'disputed' → not active", () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID, 'disputed');
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID, 'agreed');
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });

  it("source substance committed with value 'disputed' → not active", () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID, 'agreed');
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID, 'disputed');
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    expect(isEdgeActive(projection, EDGE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Target-node substance must NOT participate in firing.
// ---------------------------------------------------------------

describe('isEdgeActive — target-node substance is irrelevant', () => {
  it('edge agreed, source agreed, target substance still proposed → active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    // No proposal on target substance at all.
    expect(isEdgeActive(projection, EDGE_ID)).toBe(true);
  });

  it('edge agreed, source agreed, target substance committed disputed → still active', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_TARGET_SUBSTANCE_ID, TARGET_NODE_ID, 'disputed');
    allAgree(projection, PROP_TARGET_SUBSTANCE_ID);
    commit(projection, PROP_TARGET_SUBSTANCE_ID);
    // Per the data-model doc, target substance does not participate.
    expect(isEdgeActive(projection, EDGE_ID)).toBe(true);
  });
});

// ---------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------

describe('isEdgeActive — error paths', () => {
  it('throws on unknown edge id', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    const bogus = '00000000-0000-4000-8000-deadbeefdead';
    expect(() => isEdgeActive(projection, bogus)).toThrow(ActiveFiringComputationError);
  });
});

// ---------------------------------------------------------------
// `getActiveFiring` bulk variant.
// ---------------------------------------------------------------

describe('getActiveFiring — round-trips with isEdgeActive', () => {
  it('produces a map whose entries match isEdgeActive for every edge', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    proposeSetEdgeSubstance(projection, PROP_EDGE_SUBSTANCE_ID, EDGE_ID);
    allAgree(projection, PROP_EDGE_SUBSTANCE_ID);
    commit(projection, PROP_EDGE_SUBSTANCE_ID);
    proposeSetNodeSubstance(projection, PROP_SOURCE_SUBSTANCE_ID, SOURCE_NODE_ID);
    allAgree(projection, PROP_SOURCE_SUBSTANCE_ID);
    commit(projection, PROP_SOURCE_SUBSTANCE_ID);

    const map = getActiveFiring(projection);
    expect(map.size).toBe(projection.edgeCount());
    for (const edge of projection.edges()) {
      expect(map.get(edge.id)).toBe(isEdgeActive(projection, edge.id));
    }
    expect(map.get(EDGE_ID)).toBe(true);
  });

  it('returns false for inactive edges', () => {
    resetSeq();
    const projection = seedSessionWithEdge();
    // Nothing committed; edge is inactive.
    const map = getActiveFiring(projection);
    expect(map.get(EDGE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Property-style: random combinations of edge / source substance
// vote sequences. The reference implementation is the literal rule:
// active iff edge derived status in {agreed, committed} AND edge
// value === 'agreed' AND source derived status in {agreed, committed}
// AND source value === 'agreed'.
// ---------------------------------------------------------------

type Stance = 'agree' | 'dispute';

function makePrng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}

interface FacetSimState {
  votes: Map<string, Stance>;
  withdrawals: Set<string>;
  committed: boolean;
  metaDisagreement: boolean;
  value: 'agreed' | 'disputed';
}

function simulatedStatus(
  state: FacetSimState,
  current: Set<string>,
): 'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement' {
  if (state.metaDisagreement) return 'meta-disagreement';
  const currentVotes: Stance[] = [];
  for (const [p, v] of state.votes) {
    if (current.has(p)) currentVotes.push(v);
  }
  let hasCurrentWithdrawal = false;
  for (const p of state.withdrawals) {
    if (current.has(p)) {
      hasCurrentWithdrawal = true;
      break;
    }
  }
  const hasDispute = currentVotes.some((v) => v === 'dispute');
  // Per ADR 0030 §3 + the refactor: withdrawn requires a withdrawal
  // mark AND committed; pre-commit withdrawals are recorded but the
  // derivation does not surface `'withdrawn'`.
  if (state.committed && hasCurrentWithdrawal) return 'withdrawn';
  if (hasDispute) return 'disputed';
  if (state.committed) return 'committed';
  if (current.size > 0 && currentVotes.filter((v) => v === 'agree').length === current.size) {
    return 'agreed';
  }
  return 'proposed';
}

function referenceActive(
  edgeState: FacetSimState | null,
  sourceState: FacetSimState | null,
  current: Set<string>,
): boolean {
  if (!edgeState || !sourceState) return false;
  const edgeStatus = simulatedStatus(edgeState, current);
  const sourceStatus = simulatedStatus(sourceState, current);
  const edgeSettled = edgeStatus === 'agreed' || edgeStatus === 'committed';
  const sourceSettled = sourceStatus === 'agreed' || sourceStatus === 'committed';
  // `meta-disagreement` is implicitly excluded by the `edgeSettled` /
  // `sourceSettled` checks above (only `'agreed' | 'committed'`
  // qualify). Both effective values must be `'agreed'` to fire.
  return (
    edgeSettled && sourceSettled && edgeState.value === 'agreed' && sourceState.value === 'agreed'
  );
}

describe('isEdgeActive — property-style vs. reference implementation', () => {
  it('matches the reference implementation across random sequences', () => {
    const seeds = [1, 7, 42, 99, 256, 1023];
    const participants = [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID];

    for (const seed of seeds) {
      resetSeq();
      const projection = seedSessionWithEdge();
      const rand = makePrng(seed);
      const refCurrent = new Set(participants);
      let edgeState: FacetSimState | null = null;
      let sourceState: FacetSimState | null = null;

      // Up to 30 random actions across both facets.
      for (let i = 0; i < 30; i++) {
        const action = rand();
        // Pick which facet this action targets.
        const facet = rand() < 0.5 ? 'edge' : 'source';
        const proposalId = facet === 'edge' ? PROP_EDGE_SUBSTANCE_ID : PROP_SOURCE_SUBSTANCE_ID;
        const currentState = facet === 'edge' ? edgeState : sourceState;

        if (currentState === null) {
          // The proposal hasn't been made yet; only valid action is
          // to propose. Propose with random value.
          if (action < 0.7) {
            const value: 'agreed' | 'disputed' = rand() < 0.5 ? 'agreed' : 'disputed';
            if (facet === 'edge') {
              proposeSetEdgeSubstance(projection, proposalId, EDGE_ID, value);
              edgeState = {
                votes: new Map(),
                withdrawals: new Set(),
                committed: false,
                metaDisagreement: false,
                value,
              };
            } else {
              proposeSetNodeSubstance(projection, proposalId, SOURCE_NODE_ID, value);
              sourceState = {
                votes: new Map(),
                withdrawals: new Set(),
                committed: false,
                metaDisagreement: false,
                value,
              };
            }
          }
          continue;
        }

        if (currentState.metaDisagreement) {
          // Terminal — no further actions.
          continue;
        }

        if (action < 0.5) {
          // Vote — under the new model, choices are only `'agree' | 'dispute'`.
          const voter = pick(rand, participants);
          const stance: Stance = pick(rand, ['agree', 'dispute'] as const);
          castVote(projection, proposalId, voter, stance);
          currentState.votes.set(voter, stance);
        } else if (action < 0.7) {
          // Commit (only if not committed and not meta).
          if (!currentState.committed) {
            commit(projection, proposalId);
            currentState.committed = true;
          }
        } else if (action < 0.82) {
          // Mark meta-disagreement (only if not committed and not
          // meta; the dispatcher requires the proposal to still be
          // pending).
          if (!currentState.committed) {
            markMetaDisagreement(projection, proposalId);
            currentState.metaDisagreement = true;
          }
        } else if (action < 0.95) {
          // Per ADR 0030 §3 + `pf_projection_facet_status_refactor`:
          // emit a `withdraw-agreement` event against a random current
          // participant. The methodology engine enforces "withdraw only
          // after commit" at the wire; this projection-level property
          // test exercises both pre- and post-commit cases since the
          // reference implementation also tracks withdrawals as a set
          // (Rule 4 only fires when committed AND a current-participant
          // withdrawal exists).
          const target =
            facet === 'edge'
              ? { entityKind: 'edge' as const, entityId: EDGE_ID }
              : { entityKind: 'node' as const, entityId: SOURCE_NODE_ID };
          const participant = pick(rand, participants);
          applyEvent(
            projection,
            makeEvent(nextSeq(), 'withdraw-agreement', participant, T8, {
              entity_kind: target.entityKind,
              entity_id: target.entityId,
              facet: 'substance',
              participant,
              withdrawn_at: T8,
            }),
          );
          currentState.withdrawals.add(participant);
        }
        // else: no-op (skip iteration)

        const derived = isEdgeActive(projection, EDGE_ID);
        const ref = referenceActive(edgeState, sourceState, refCurrent);
        expect(derived).toBe(ref);
      }
    }
  });
});
