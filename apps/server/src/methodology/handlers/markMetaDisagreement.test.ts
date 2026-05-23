// Tests for the real `mark-meta-disagreement` action handler.
//
// Refinement: tasks/refinements/data-and-methodology/meta_disagreement_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.meta_disagreement_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// mark-meta-disagreement-specific rule set:
//
//   1. Moderator gate — debaters can't mark meta-disagreement.
//   2. Proposal exists — unknown id rejected.
//   3. Proposal is pending — already-committed / already-meta-disagreement
//      rejected.
//   4. Methodology-exhaustion gate (Option A — structural) — the
//      affected facet's `perParticipant` map must contain at least one
//      record with vote `'dispute'`. A proposal with no recorded
//      dispute is rejected as `'methodology-not-exhausted'`.
//
// Plus the structural-sub-kind boundary: `decompose` (and the six
// other structural sub-kinds) doesn't have per-participant vote state
// on the projection, so the handler defers with
// `'illegal-state-transition'`.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type MarkMetaDisagreementAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const NODE_ID_1 = '77777777-7777-4777-8777-777777777777';
const NODE_ID_STRUCT = '88888888-8888-4888-8888-888888888888';
const PROPOSAL_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID_STRUCT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PROPOSAL_ID_UNKNOWN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
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

// Seed a session at sequence 6 with three participants, one node, and
// one pending `classify-node` proposal. No votes yet — caller adds
// votes per-scenario.
function seedSession(): ReturnType<typeof createEmptyProjection> {
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
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    }),
    id: PROPOSAL_ID_1,
  });
  return projection;
}

function applyVote(
  projection: ReturnType<typeof createEmptyProjection>,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
  proposalId: string = PROPOSAL_ID_1,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'vote', participant, T9, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: T9,
    }),
  );
}

function makeMarkAction(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string = MODERATOR_ID,
  proposalEventId: string = PROPOSAL_ID_1,
): MarkMetaDisagreementAction {
  return {
    kind: 'mark-meta-disagreement',
    requester,
    sessionId: SESSION_ID,
    eventId: NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposalEventId,
    markedAt: T9,
  };
}

// ---------------------------------------------------------------
// Rule 1 — moderator gate.
// ---------------------------------------------------------------

describe('mark-meta-disagreement handler — rule 1: moderator gate', () => {
  it('rejects a mark from a debater with not-a-moderator', () => {
    const p = seedSession();
    // Layer in a dispute so the only failing rule is the moderator gate
    // — otherwise rule 4 would fire first.
    applyVote(p, DEBATER_B_ID, 'dispute');
    const action = makeMarkAction(p, DEBATER_A_ID);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-a-moderator');
      expect(r.detail).toContain(DEBATER_A_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — proposal exists.
// ---------------------------------------------------------------

describe('mark-meta-disagreement handler — rule 2: proposal exists', () => {
  it('rejects a mark referencing an unknown proposal id', () => {
    const p = seedSession();
    const action = makeMarkAction(p, MODERATOR_ID, PROPOSAL_ID_UNKNOWN);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-not-found');
      expect(r.detail).toContain(PROPOSAL_ID_UNKNOWN);
    }
  });
});

// ---------------------------------------------------------------
// Rule 3 — proposal is pending.
// ---------------------------------------------------------------

describe('mark-meta-disagreement handler — rule 3: proposal is pending', () => {
  it('rejects a mark on an already-committed proposal with proposal-already-committed', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    const action = makeMarkAction(p, MODERATOR_ID, PROPOSAL_ID_1);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-committed');
    }
  });

  it('rejects a mark on an already-meta-disagreement-marked proposal with proposal-already-meta-disagreement', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'meta-disagreement-marked', MODERATOR_ID, T9, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        marked_at: T9,
      }),
    );
    const action = makeMarkAction(p, MODERATOR_ID, PROPOSAL_ID_1);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-meta-disagreement');
    }
  });
});

// ---------------------------------------------------------------
// Rule 4 — methodology-exhaustion gate (Option A — structural).
// ---------------------------------------------------------------

describe('mark-meta-disagreement handler — rule 4: methodology-exhaustion gate', () => {
  it('rejects a mark on a proposal with no recorded votes (methodology-not-exhausted)', () => {
    const p = seedSession();
    // No votes at all — the proposal is in `proposed` state on the
    // affected facet. Meta-disagreement is the last resort; the
    // methodology hasn't even started.
    const action = makeMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('methodology-not-exhausted');
      expect(r.detail).toContain(PROPOSAL_ID_1);
    }
  });

  it('rejects a mark on a proposal with only agree votes (no dispute → not stuck)', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    // DEBATER_B has not voted; nobody has disputed.
    const action = makeMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('methodology-not-exhausted');
    }
  });

  it('accepts a mark when at least one participant has voted dispute on the affected facet', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'dispute');
    const action = makeMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('meta-disagreement-marked');
      expect(ev.id).toBe(NEW_EVENT_ID);
      expect(ev.sessionId).toBe(SESSION_ID);
      expect(ev.sequence).toBe(action.sequence);
      expect(ev.actor).toBe(MODERATOR_ID);
      expect(ev.createdAt).toBe(T9);
      if (ev.kind === 'meta-disagreement-marked') {
        expect(ev.payload.proposal_id).toBe(PROPOSAL_ID_1);
        expect(ev.payload.moderator).toBe(MODERATOR_ID);
        expect(ev.payload.marked_at).toBe(T9);
      }
    }
  });

  it('accepts a mark when the only dispute is from a participant who has since left', () => {
    // Per the refinement's participant-leaves-semantics: a `dispute`
    // from a left participant still counts toward the exhaustion gate
    // (the dispute *did* happen; the methodology-stuck signal is the
    // historical fact). DEBATER_B disputes, then leaves; the moderator
    // marks meta-disagreement.
    const p = seedSession();
    applyVote(p, DEBATER_B_ID, 'dispute');
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'participant-left', DEBATER_B_ID, T9, {
        user_id: DEBATER_B_ID,
        left_at: T9,
      }),
    );
    const action = makeMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Structural-sub-kind boundary.
//
// `decompose` (and the other structural sub-kinds) doesn't have per-
// participant vote state on the projection. meta_disagreement_logic
// defers to the sibling sub-kind handler and returns
// `'illegal-state-transition'` with a sub-kind-naming detail.
// ---------------------------------------------------------------

describe('mark-meta-disagreement handler — structural-sub-kind boundary', () => {
  it('rejects a mark on a decompose proposal with illegal-state-transition and a sub-kind-naming detail', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T2, {
        node_id: NODE_ID_STRUCT,
        wording: 'Parent to decompose.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID_STRUCT,
          components: [
            {
              wording: 'Component one.',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-00000000e071',
            },
            {
              wording: 'Component two.',
              classification: 'value',
              node_id: '00000000-0000-4000-8000-00000000e072',
            },
          ],
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    const action = makeMarkAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain('decompose');
    }
  });
});
