// Tests for `deriveFacetStatus`.
//
// Refinement (current shape): tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md
// Historical: tasks/refinements/data-and-methodology/per_facet_status_derivation.md
// TaskJuggler: per_facet_refactor.projection.pf_projection_facet_status_refactor
//
// Coverage (eight rules per ADR 0030 §10 + the refactor refinement):
//   - Meta-disagreement-marked → 'meta-disagreement'.
//   - No candidate value (facet awaiting a proposal) → 'awaiting-proposal'.
//   - Empty / unvoted facet with a candidate → 'proposed'.
//   - Partial agreement → 'proposed' (missing votes don't auto-agree).
//   - All current participants agree → 'agreed'.
//   - Any current participant disputes → 'disputed'.
//   - All agree + commit → 'committed'.
//   - Committed + withdraw-agreement → 'withdrawn'.
//   - Participant leaves after voting agree → vote no longer counts.
//   - New facet-valued proposal lands on a populated facet → prior
//     per-participant votes cleared (refactor-task contract).
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
  vote: 'agree' | 'dispute',
  proposalId: string = PROPOSAL_ID_1,
  voteTime: string = T4,
): void {
  applyEvent(
    projection,
    makeEvent(voteSeq++, 'vote', participant, voteTime, {
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

describe('deriveFacetStatus — withdrawn (committed, then withdraw-agreement)', () => {
  // Per ADR 0030 §3 + `pf_projection_facet_status_refactor`: withdrawal is
  // its own first-class event kind (`withdraw-agreement`), keyed by
  // `(entity, facet, participant)`. A withdrawal against a committed
  // candidate sends the facet to `'withdrawn'`.
  it('agree x3 → commit → one participant emits withdraw-agreement → withdrawn', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    commit(projection);
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'withdraw-agreement', DEBATER_B_ID, T8, {
        entity_kind: 'node',
        entity_id: NODE_ID_1,
        facet: 'classification',
        participant: DEBATER_B_ID,
        withdrawn_at: T8,
      }),
    );
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
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        marked_by: MODERATOR_ID,
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
// Withdraw-agreement without a prior commit does NOT flip to withdrawn.
//
// Per ADR 0030 §3 + Rule 4 of the new derivation: `'withdrawn'` requires
// BOTH a current-participant withdrawal mark AND `committedAt !== null`
// AND the committed value still matching the current candidate. A
// stray withdraw-agreement on an uncommitted facet records the mark
// but the derivation does not surface `'withdrawn'`; the methodology
// engine's wire-level validation rejects this pre-commit withdraw at
// the propose handler in practice (this projection-level case exists
// for defense-in-depth — a misbehaving client / future automation must
// not derive a settled "withdrawn" state without a commit upstream).
// ---------------------------------------------------------------

describe('deriveFacetStatus — withdraw-agreement without prior commit does not flip to withdrawn', () => {
  it('participants vote agree then a withdraw-agreement lands pre-commit → still agreed', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    applyEvent(
      projection,
      makeEvent(voteSeq++, 'withdraw-agreement', DEBATER_B_ID, T6, {
        entity_kind: 'node',
        entity_id: NODE_ID_1,
        facet: 'classification',
        participant: DEBATER_B_ID,
        withdrawn_at: T6,
      }),
    );
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('agreed');
  });
});

// ---------------------------------------------------------------
// Awaiting-proposal (no candidate value yet).
//
// Per ADR 0030 §10 + Rule 2 of the new derivation: a facet whose
// `candidateValue` is `null` (the entity exists but no proposal /
// inline carriage has named a value) surfaces as `'awaiting-proposal'`.
// The canonical case is a freshly created node's `classification` and
// `substance` facets — both null until a `classify-node` /
// `set-node-substance` proposal lands.
// ---------------------------------------------------------------

describe('deriveFacetStatus — awaiting-proposal (no candidate value yet)', () => {
  it('a freshly created node has no candidate on classification → awaiting-proposal', () => {
    resetSeq();
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
      makeEvent(3, 'node-created', MODERATOR_ID, T2, {
        node_id: NODE_ID_1,
        wording: 'A statement.',
        created_by: MODERATOR_ID,
        created_at: T2,
      }),
    );
    // No classify-node proposal has landed yet → no candidate value.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe(
      'awaiting-proposal',
    );
    // Same for substance — no candidate value until a
    // `set-node-substance` proposal lands.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'substance')).toBe('awaiting-proposal');
    // Wording is inline on `node-created` — `candidateValue` is set
    // immediately, so the facet is `'proposed'` with no votes.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'wording')).toBe('proposed');
  });

  it('a classify-node proposal flips classification from awaiting-proposal → proposed', () => {
    resetSeq();
    const projection = seedSession();
    // seedSession adds a classify-node proposal; classification should
    // now read `'proposed'`, not `'awaiting-proposal'`.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('proposed');
    // Substance still has no proposal → still awaiting-proposal.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'substance')).toBe('awaiting-proposal');
  });
});

// ---------------------------------------------------------------
// Vote reset on a new candidate value.
//
// Per ADR 0030 §7 + the refactor refinement: when a second
// facet-valued proposal lands on the same facet, the prior
// per-participant vote map is cleared (the old votes were votes
// against the old candidate; the new candidate is a fresh proposal
// that needs fresh agreement).
// ---------------------------------------------------------------

describe('deriveFacetStatus — vote reset on a new candidate', () => {
  it('a second classify-node proposal clears the prior vote map → back to proposed (no votes)', () => {
    resetSeq();
    const projection = seedSession();
    castVote(projection, MODERATOR_ID, 'agree');
    castVote(projection, DEBATER_A_ID, 'agree');
    castVote(projection, DEBATER_B_ID, 'agree');
    // Three agree votes against PROPOSAL_ID_1 (the seeded classify
    // "fact" proposal). Facet should read 'agreed' now.
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('agreed');

    // A second classify-node proposal lands on the same facet, with a
    // different candidate value. The projection clears the prior vote
    // map; the derivation reads "no current participants have voted"
    // → 'proposed'.
    applyEvent(projection, {
      ...makeEvent(voteSeq++, 'proposal', DEBATER_A_ID, T8, {
        proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'value' },
      }),
      id: PROPOSAL_ID_2,
    });
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('proposed');

    // Subsequent votes attach to the new candidate (still keyed by
    // proposal-id in the wire today; the projection routes them via
    // the proposal target → facet lookup).
    castVote(projection, MODERATOR_ID, 'agree', PROPOSAL_ID_2, T9);
    castVote(projection, DEBATER_A_ID, 'agree', PROPOSAL_ID_2, T9);
    castVote(projection, DEBATER_B_ID, 'agree', PROPOSAL_ID_2, T9);
    expect(deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification')).toBe('agreed');
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
// Reference implementation summary (new eight-rule shape per ADR 0030
// §10 + `pf_projection_facet_status_refactor`):
//   1. metaDisagreement → 'meta-disagreement'.
//   2. candidateValue === null → 'awaiting-proposal' (not exercised
//      here — the fixture starts with a classify-node proposal in
//      place, so the facet has a candidate).
//   3. Filter perParticipant + withdrawals by current participants —
//      the moderator is structurally excluded per `docs/methodology.md`
//      § "The commit step" (commit IS the moderator's act of
//      agreement; counting the moderator would block the moderator's
//      own commit affordance from ever surfacing — mirrors the filter
//      in `deriveFacetStatusFromState` and `checkUnanimousAgreeFacet`).
//   4. Committed AND any current-participant withdrawal → 'withdrawn'.
//   5. Any dispute → 'disputed'.
//   6. Committed (current candidate matches) → 'committed'.
//   7. All current non-moderator participants agree → 'agreed'.
//   8. Otherwise → 'proposed'.
//
// Withdrawal is no longer a vote choice — it is a separate
// `withdraw-agreement` event kind per ADR 0030 §3.
// ---------------------------------------------------------------

type Stance = 'agree' | 'dispute';
type Action =
  | { kind: 'vote'; participant: string; vote: Stance; time: string }
  | { kind: 'commit'; time: string }
  | { kind: 'leave'; participant: string; time: string }
  | { kind: 'meta-disagreement'; time: string }
  | { kind: 'withdraw-agreement'; participant: string; time: string };

function referenceStatus(
  votesByParticipant: Map<string, Stance>,
  withdrawals: Set<string>,
  currentParticipants: Set<string>,
  committed: boolean,
  metaDisagreement: boolean,
): FacetStatus {
  if (metaDisagreement) return 'meta-disagreement';
  // Candidate is always present in this property-style fixture (the
  // seeded classify-node proposal supplies it); awaiting-proposal is
  // exercised in its own describe block above.
  const currentVotes: Stance[] = [];
  for (const [p, v] of votesByParticipant) {
    if (currentParticipants.has(p)) currentVotes.push(v);
  }
  let hasCurrentWithdrawal = false;
  for (const p of withdrawals) {
    if (currentParticipants.has(p)) {
      hasCurrentWithdrawal = true;
      break;
    }
  }
  const hasDispute = currentVotes.some((v) => v === 'dispute');
  if (committed && hasCurrentWithdrawal) return 'withdrawn';
  if (hasDispute) return 'disputed';
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

      // Reference state. `refCurrent` excludes the moderator from the
      // start — see the describe-block comment above: the moderator is
      // structurally outside the unanimity walk per `docs/methodology.md`
      // § "The commit step". The projection's `currentParticipants()`
      // still includes the moderator (they ARE a current participant in
      // every other sense — joined, not left), but the derivation
      // filters them out before counting votes, so the reference set
      // omits them to mirror the derivation.
      const refVotes = new Map<string, Stance>();
      const refWithdrawals = new Set<string>();
      const refCurrent = new Set(participants.filter((p) => p !== MODERATOR_ID));
      let refCommitted = false;
      let refMeta = false;

      // Run 20 random actions; cross-check after each.
      for (let i = 0; i < 20; i++) {
        const r = rand();
        let action: Action;
        if (refMeta) {
          // After meta-disagreement-marked, no further events change
          // status.
          continue;
        } else if (refCommitted && r < 0.15) {
          // Occasionally emit a withdraw-agreement against the
          // committed candidate (per ADR 0030 §3, withdrawal is its
          // own event kind, valid only after commit).
          if (refCurrent.size > 0) {
            action = {
              kind: 'withdraw-agreement',
              participant: pick(rand, [...refCurrent]),
              time: T0,
            };
          } else {
            continue;
          }
        } else if (r < 0.65) {
          // Cast a vote — under the new model, choices are only
          // `'agree' | 'dispute'`.
          action = {
            kind: 'vote',
            participant: pick(rand, participants),
            vote: pick(rand, ['agree', 'dispute'] as const),
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
              target: 'proposal',
              proposal_id: PROPOSAL_ID_1,
              marked_by: MODERATOR_ID,
              marked_at: T0,
            }),
          );
          refMeta = true;
        } else if (action.kind === 'withdraw-agreement') {
          applyEvent(
            projection,
            makeEvent(voteSeq++, 'withdraw-agreement', action.participant, T0, {
              entity_kind: 'node',
              entity_id: NODE_ID_1,
              facet: 'classification',
              participant: action.participant,
              withdrawn_at: T0,
            }),
          );
          refWithdrawals.add(action.participant);
        }

        const derived = deriveFacetStatus(projection, 'node', NODE_ID_1, 'classification');
        const ref = referenceStatus(refVotes, refWithdrawals, refCurrent, refCommitted, refMeta);
        expect(derived).toBe(ref);
      }
    }
  });
});
