// Tests for `deriveFacetStatus`.
//
// Refinement: tasks/refinements/data-and-methodology/per_facet_status_derivation.md
// TaskJuggler: data_and_methodology.projection.per_facet_status_derivation
//
// Coverage:
//   - Empty / unvoted facet → 'proposed'.
//   - Partial agreement → 'proposed' (missing votes don't auto-agree).
//   - All current participants agree → 'agreed'.
//   - Any current participant disputes → 'disputed'.
//   - All agree + commit → 'committed'.
//   - Committed + withdraw → 'withdrawn'.
//   - meta-disagreement-marked → 'meta-disagreement'.
//   - Participant leaves after voting agree → vote no longer counts.
//   - Property-style: random vote sequences against a fixed
//     participant set + sometimes-commits — derived status matches a
//     hand-rolled reference implementation in this file.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from './projection.js';
import { applyEvent } from './replay.js';
import { deriveFacetStatus, FacetStatusDerivationError } from './facet-status.js';
import type { FacetStatus } from './types.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const NODE_ID_1 = '66666666-6666-4666-8666-666666666666';
const NODE_ID_2 = '77777777-7777-4777-8777-777777777777';
const EDGE_ID_1 = '99999999-9999-4999-8999-999999999999';

const PROPOSAL_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';
const T5 = '2026-05-10T12:00:05Z';
const T6 = '2026-05-10T12:00:06Z';
const T7 = '2026-05-10T12:00:07Z';
const T8 = '2026-05-10T12:00:08Z';
const T9 = '2026-05-10T12:00:09Z';

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

// Build a projection with: session-created, 3 participants joined
// (moderator + two debaters), one node created, one classify-node
// proposal pinned at PROPOSAL_ID_1. Returns the projection at
// sequence 7.
function seedSession(
  proposalId: string = PROPOSAL_ID_1,
  classification: 'fact' | 'value' = 'fact',
): ReturnType<typeof createEmptyProjection> {
  const projection = createEmptyProjection(SESSION_ID);
  applyEvent(
    projection,
    makeEvent(1, 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 't',
      created_at: T0,
    }),
  );
  applyEvent(
    projection,
    makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'M',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(3, 'participant-joined', DEBATER_A_ID, T1, {
      user_id: DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'A',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(4, 'participant-joined', DEBATER_B_ID, T1, {
      user_id: DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'B',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_1,
      wording: 'A statement.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(projection, {
    ...makeEvent(6, 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification },
    }),
    id: proposalId,
  });
  return projection;
}

let voteSeq = 7;

function castVote(
  projection: ReturnType<typeof createEmptyProjection>,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
  proposalId: string = PROPOSAL_ID_1,
  voteTime: string = T4,
): void {
  applyEvent(
    projection,
    makeEvent(voteSeq++, 'vote', participant, voteTime, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: voteTime,
    }),
  );
}

function commit(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string = PROPOSAL_ID_1,
  commitTime: string = T7,
): void {
  applyEvent(
    projection,
    makeEvent(voteSeq++, 'commit', MODERATOR_ID, commitTime, {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: MODERATOR_ID,
      committed_at: commitTime,
    }),
  );
}

function leaveSession(
  projection: ReturnType<typeof createEmptyProjection>,
  participant: string,
  leftAt: string = T8,
): void {
  applyEvent(
    projection,
    makeEvent(voteSeq++, 'participant-left', participant, leftAt, {
      user_id: participant,
      left_at: leftAt,
    }),
  );
}

// Reset the voteSeq counter at the start of every test so the
// per-test sequence fits between seedSession's 6 events and any
// subsequent ones.
function resetSeq(): void {
  voteSeq = 7;
}

// ---------------------------------------------------------------
// Empty / unvoted.
// ---------------------------------------------------------------

describe('deriveFacetStatus — proposed (empty / unvoted)', () => {
  it('an unvoted classification facet is proposed', () => {
    resetSeq();
    const projection = seedSession();
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('proposed');
  });

  it('a partial-agree (only one of three voted) is still proposed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('proposed');
  });
});

// ---------------------------------------------------------------
// Agreed (no commit yet — methodology's pre-commit "everyone-voted-
// agree" intermediate state).
// ---------------------------------------------------------------

describe('deriveFacetStatus — agreed (all current participants voted agree, no commit yet)', () => {
  it('all three voted agree → agreed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('agreed');
  });
});

// ---------------------------------------------------------------
// Disputed.
// ---------------------------------------------------------------

describe('deriveFacetStatus — disputed (any current dispute)', () => {
  it('one dispute, two agree → disputed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'dispute');
    castVote(projection, DEBATER_B_ID, 'agree');
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('disputed');
  });

  it('all three dispute → disputed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'dispute');
    castVote(projection, DEBATER_A_ID, 'dispute');
    castVote(projection, DEBATER_B_ID, 'dispute');
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('disputed');
  });
});

// ---------------------------------------------------------------
// Committed.
// ---------------------------------------------------------------

describe('deriveFacetStatus — committed (all agreed + commit)', () => {
  it('all three agree + commit → committed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    commit(projection);
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('committed');
  });
});

// ---------------------------------------------------------------
// Withdrawn (committed → withdraw).
// ---------------------------------------------------------------

describe('deriveFacetStatus — withdrawn (committed, then withdraw)', () => {
  it('agree x3 → commit → one participant withdraws → withdrawn', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    commit(projection);
    castVote(projection, DEBATER_B_ID, 'withdraw', PROPOSAL_ID_1, T8);
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('withdrawn');
  });
});

// ---------------------------------------------------------------
// Meta-disagreement.
// ---------------------------------------------------------------

describe('deriveFacetStatus — meta-disagreement', () => {
  it('classify-node proposal → moderator marks meta-disagreement → derived status is meta-disagreement', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'dispute');
    castVote(projection, DEBATER_B_ID, 'dispute');
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'meta-disagreement-marked', MODERATOR_ID, T8, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        marked_at: T8,
      }),
    );
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe(
      'meta-disagreement',
    );
  });
});

// ---------------------------------------------------------------
// Participant leaves between voting and commit.
// ---------------------------------------------------------------

describe('deriveFacetStatus — left participants do not count', () => {
  it('B agrees then leaves; M and A agreed → agreed (B no longer current)', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    leaveSession(projection, DEBATER_B_ID);
    // After B leaves, only M and A are current; both voted agree.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('agreed');
  });

  it("a left participant's earlier dispute does not pin status to disputed", () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'dispute');
    leaveSession(projection, DEBATER_B_ID);
    // B disputed but is no longer current; remaining two agreed.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('agreed');
  });
});

// ---------------------------------------------------------------
// Withdraw without prior commit collapses to disputed.
// ---------------------------------------------------------------

describe('deriveFacetStatus — withdraw without prior commit is treated as dispute', () => {
  it('participant votes agree then withdraws before commit → disputed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'withdraw', PROPOSAL_ID_1, T6);
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('disputed');
  });
});

// ---------------------------------------------------------------
// Resolution errors.
// ---------------------------------------------------------------

describe('deriveFacetStatus — error paths', () => {
  it('throws on a missing node', () => {
    resetSeq();
    const projection = seedSession();
    expect(() => deriveFacetStatus(projection, 'node', NODE_ID_2, 'classification')).toThrow(
      FacetStatusDerivationError,
    );
  });

  it('throws on an inapplicable facet (edge wording)', () => {
    resetSeq();
    const projection = seedSession();
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'node-created', DEBATER_A_ID, T2, {
        node_id: NODE_ID_2,
        wording: 'second',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EDGE_ID_1,
        role: 'supports',
        source_node_id: NODE_ID_1,
        target_node_id: NODE_ID_2,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(() => deriveFacetStatus(projection, 'edge', EDGE_ID_1, 'wording')).toThrow(
      FacetStatusDerivationError,
    );
  });
});

// ---------------------------------------------------------------
// Edge substance facet — derivation works for edges too.
// ---------------------------------------------------------------

describe('deriveFacetStatus — edge substance facet', () => {
  it('all three agree + commit on set-edge-substance → committed on the edge', () => {
    resetSeq();
    const projection = seedSession();
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'node-created', DEBATER_A_ID, T2, {
        node_id: NODE_ID_2,
        wording: 'second',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EDGE_ID_1,
        role: 'supports',
        source_node_id: NODE_ID_1,
        target_node_id: NODE_ID_2,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(projection, {
      ...makeEvent(voteSeq++, 'proposal', DEBATER_A_ID, T3, {
        proposal: { kind: 'set-edge-substance', edge_id: EDGE_ID_1, value: 'agreed' },
      }),
      id: PROPOSAL_ID_2,
    });
    castVote(projection, MODERATOR_ID, 'agree', PROPOSAL_ID_2, T4);
    castVote(projection, DEBATER_A_ID, 'agree', PROPOSAL_ID_2, T5);
    castVote(projection, DEBATER_B_ID, 'agree', PROPOSAL_ID_2, T6);
    commit(projection, PROPOSAL_ID_2, T9);
    expect(deriveFacetStatus(projection, 'edge', EDGE_ID_1, 'substance')).toBe('committed');
  });
});

// ---------------------------------------------------------------
// Property-style: random vote sequences vs. a hand-rolled
// reference implementation.
//
// Reference implementation summary: filter perParticipant by
// current participants; if facetState.status==='meta-disagreement'
// → 'meta-disagreement'; else if (committed && any withdraw) →
// 'withdrawn'; else if (any dispute or any withdraw) → 'disputed';
// else if committed → 'committed'; else if every current
// participant voted agree → 'agreed'; else → 'proposed'.
// ---------------------------------------------------------------

type Stance = 'agree' | 'dispute' | 'withdraw';
type Action =
  | { kind: 'vote'; participant: string; vote: Stance; time: string }
  | { kind: 'commit'; time: string }
  | { kind: 'leave'; participant: string; time: string }
  | { kind: 'meta-disagreement'; time: string };

function referenceStatus(
  votesByParticipant: Map<string, Stance>,
  currentParticipants: Set<string>,
  committed: boolean,
  metaDisagreement: boolean,
): FacetStatus {
  if (metaDisagreement) return 'meta-disagreement';
  const currentVotes: Stance[] = [];
  for (const [p, v] of votesByParticipant) {
    if (currentParticipants.has(p)) currentVotes.push(v);
  }
  const hasWithdraw = currentVotes.some((v) => v === 'withdraw');
  const hasDispute = currentVotes.some((v) => v === 'dispute');
  if (committed && hasWithdraw) return 'withdrawn';
  if (hasDispute || hasWithdraw) return 'disputed';
  if (committed) return 'committed';
  if (
    currentParticipants.size > 0 &&
    currentVotes.filter((v) => v === 'agree').length === currentParticipants.size
  ) {
    return 'agreed';
  }
  return 'proposed';
}

function makePrng(seed: number): () => number {
  // mulberry32 — tiny deterministic PRNG; good enough for property-
  // style spot checks. Tests are stable under repeat runs.
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

describe('deriveFacetStatus — property-style vs. reference implementation', () => {
  it('matches the reference implementation across random vote sequences', () => {
    const seeds = [1, 7, 42, 99, 256, 1023];
    const participants = [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID];

    for (const seed of seeds) {
      resetSeq();
      const projection = seedSession();
      const rand = makePrng(seed);

      // Reference state.
      const refVotes = new Map<string, Stance>();
      const refCurrent = new Set(participants);
      let refCommitted = false;
      let refMeta = false;

      // Run 20 random actions; cross-check after each.
      for (let i = 0; i < 20; i++) {
        const r = rand();
        let action: Action;
        if (refMeta || (refCommitted && rand() < 0.05)) {
          // After meta-disagreement-marked, no further events change
          // status; after commit, occasionally trigger a withdraw.
          if (refCommitted && refCurrent.size > 0 && !refMeta) {
            action = {
              kind: 'vote',
              participant: pick(rand, [...refCurrent]),
              vote: 'withdraw',
              time: T0,
            };
          } else {
            // Skip — re-roll on next iteration.
            continue;
          }
        } else if (r < 0.65) {
          action = {
            kind: 'vote',
            participant: pick(rand, participants),
            vote: pick(rand, ['agree', 'dispute', 'withdraw'] as const),
            time: T0,
          };
        } else if (r < 0.75) {
          // Sometimes have a participant leave (only one of three so
          // we don't drain the set).
          if (refCurrent.size > 1) {
            action = { kind: 'leave', participant: pick(rand, [...refCurrent]), time: T0 };
          } else {
            continue;
          }
        } else if (r < 0.92) {
          // Commit only if not already committed and not meta'd.
          if (!refCommitted && !refMeta) {
            action = { kind: 'commit', time: T0 };
          } else {
            continue;
          }
        } else {
          // Mark meta-disagreement only if not already committed and
          // not already meta'd (the dispatcher requires the proposal
          // be still pending).
          if (!refCommitted && !refMeta) {
            action = { kind: 'meta-disagreement', time: T0 };
          } else {
            continue;
          }
        }

        // Apply to the projection AND to the reference state.
        if (action.kind === 'vote') {
          // Skip votes from participants who have left — the
          // dispatcher only validates against the proposal, not
          // against participant currency, but the reference is
          // identical: a left participant's vote enters the
          // perParticipant map but is filtered out by the
          // derivation.
          castVote(projection, action.participant, action.vote, PROPOSAL_ID_1, T0);
          refVotes.set(action.participant, action.vote);
        } else if (action.kind === 'commit') {
          commit(projection, PROPOSAL_ID_1, T0);
          refCommitted = true;
        } else if (action.kind === 'leave') {
          leaveSession(projection, action.participant, T0);
          refCurrent.delete(action.participant);
        } else if (action.kind === 'meta-disagreement') {
          applyEvent(
            projection,
            makeEvent(voteSeq++, 'meta-disagreement-marked', MODERATOR_ID, T0, {
              proposal_id: PROPOSAL_ID_1,
              moderator: MODERATOR_ID,
              marked_at: T0,
            }),
          );
          refMeta = true;
        }

        const derived = deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification');
        const ref = referenceStatus(refVotes, refCurrent, refCommitted, refMeta);
        expect(derived).toBe(ref);
      }
    }
  });
});
