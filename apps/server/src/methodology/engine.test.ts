// Tests for the methodology engine — universal checks, primitives,
// the `ValidationResult` discriminator, and the placeholder per-
// action handlers.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// TaskJuggler: data_and_methodology.methodology_engine.agreement_state_machine
//
// Per-action specifics (commit-requires-unanimous-agree, withdrawal-
// requires-prior-agree, etc.) are owned by the eight sibling
// `methodology_engine.*` tasks; their tests live next to their files.
// This file covers the foundation framework only.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../projection/projection.js';
import { applyEvent } from '../projection/replay.js';
import {
  findProposal,
  nextSequence,
  requesterIsModerator,
  requesterIsParticipant,
  requireModerator,
  requireParticipant,
  validateAction,
  type CommitAction,
  type MarkMetaDisagreementAction,
  type MethodologyAction,
  type ProposeAction,
  type ValidationResult,
  type VoteAction,
} from './index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '99999999-9999-4999-8999-999999999999';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';
const NON_PARTICIPANT_ID = '66666666-6666-4666-8666-666666666666';

const NODE_ID_1 = '77777777-7777-4777-8777-777777777777';
const PROPOSAL_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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

// Seed a session with three participants and one pending proposal
// (classify-node on NODE_ID_1, classification 'fact'). Returns the
// projection at sequence 6.
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

// Construct a `vote` action at the next expected sequence.
function makeVoteAction(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string,
  vote: 'agree' | 'dispute' | 'withdraw' = 'agree',
  overrides: Partial<VoteAction> = {},
): VoteAction {
  return {
    kind: 'vote',
    requester,
    sessionId: SESSION_ID,
    eventId: NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposalEventId: PROPOSAL_ID_1,
    vote,
    votedAt: T9,
    ...overrides,
  };
}

// ---------------------------------------------------------------
// Primitives — boolean predicates and discriminated `requireX`.
// ---------------------------------------------------------------

describe('primitives — boolean predicates', () => {
  it('requesterIsParticipant returns true for joined users', () => {
    const p = seedSession();
    expect(requesterIsParticipant(p, MODERATOR_ID)).toBe(true);
    expect(requesterIsParticipant(p, DEBATER_A_ID)).toBe(true);
    expect(requesterIsParticipant(p, DEBATER_B_ID)).toBe(true);
  });

  it('requesterIsParticipant returns false for non-joined users', () => {
    const p = seedSession();
    expect(requesterIsParticipant(p, NON_PARTICIPANT_ID)).toBe(false);
  });

  it('requesterIsModerator returns true only for the moderator', () => {
    const p = seedSession();
    expect(requesterIsModerator(p, MODERATOR_ID)).toBe(true);
    expect(requesterIsModerator(p, DEBATER_A_ID)).toBe(false);
    expect(requesterIsModerator(p, DEBATER_B_ID)).toBe(false);
    expect(requesterIsModerator(p, NON_PARTICIPANT_ID)).toBe(false);
  });
});

describe('primitives — requireParticipant', () => {
  it('returns the participant record on success', () => {
    const p = seedSession();
    const r = requireParticipant(p, DEBATER_A_ID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.userId).toBe(DEBATER_A_ID);
      expect(r.record.role).toBe('debater-A');
    }
  });

  it('returns a typed not-a-participant rejection for outsiders', () => {
    const p = seedSession();
    const r = requireParticipant(p, NON_PARTICIPANT_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.reason).toBe('not-a-participant');
      expect(r.rejection.detail).toContain(NON_PARTICIPANT_ID);
    }
  });
});

describe('primitives — requireModerator', () => {
  it('returns the moderator record', () => {
    const p = seedSession();
    const r = requireModerator(p, MODERATOR_ID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.role).toBe('moderator');
  });

  it('rejects with not-a-moderator when joined but wrong role', () => {
    const p = seedSession();
    const r = requireModerator(p, DEBATER_A_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.reason).toBe('not-a-moderator');
      expect(r.rejection.detail).toContain('debater-A');
    }
  });

  it('rejects with not-a-participant when not joined at all', () => {
    const p = seedSession();
    const r = requireModerator(p, NON_PARTICIPANT_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.reason).toBe('not-a-participant');
    }
  });
});

describe('primitives — findProposal', () => {
  it('returns the pending record for a live proposal', () => {
    const p = seedSession();
    const found = findProposal(p, PROPOSAL_ID_1);
    expect(found?.state).toBe('pending');
    expect(found?.record.proposalEventId).toBe(PROPOSAL_ID_1);
  });

  it('returns null for an unknown proposal id', () => {
    const p = seedSession();
    expect(findProposal(p, PROPOSAL_ID_UNKNOWN)).toBeNull();
  });

  it('returns the committed record after commit', () => {
    const p = seedSession();
    // Three agree votes + commit.
    for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
      applyEvent(
        p,
        makeEvent(nextSequence(p), 'vote', voter, T9, {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_ID_1,
          participant: voter,
          choice: 'agree',
          voted_at: T9,
        }),
      );
    }
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    const found = findProposal(p, PROPOSAL_ID_1);
    expect(found?.state).toBe('committed');
  });

  it('returns the meta-disagreement record after marking', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'meta-disagreement-marked', MODERATOR_ID, T9, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        marked_at: T9,
      }),
    );
    const found = findProposal(p, PROPOSAL_ID_1);
    expect(found?.state).toBe('meta-disagreement');
  });
});

describe('primitives — nextSequence', () => {
  it('returns lastAppliedSequence + 1', () => {
    const p = seedSession();
    expect(nextSequence(p)).toBe(p.lastAppliedSequence + 1);
    expect(nextSequence(p)).toBe(7);
  });
});

// ---------------------------------------------------------------
// validateAction — universal checks.
// ---------------------------------------------------------------

describe('validateAction — universal session-mismatch check', () => {
  it('rejects an action whose sessionId does not match the projection', () => {
    const p = seedSession();
    const action: VoteAction = makeVoteAction(p, DEBATER_A_ID, 'agree', {
      sessionId: OTHER_SESSION_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('session-mismatch');
      expect(r.detail).toContain(OTHER_SESSION_ID);
    }
  });
});

describe('validateAction — universal sequence-mismatch check', () => {
  it('rejects an action at the same sequence as lastAppliedSequence (replay)', () => {
    const p = seedSession();
    const action: VoteAction = makeVoteAction(p, DEBATER_A_ID, 'agree', {
      sequence: p.lastAppliedSequence,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sequence-mismatch');
  });

  it('rejects an action at lastAppliedSequence + 2 (gap)', () => {
    const p = seedSession();
    const action: VoteAction = makeVoteAction(p, DEBATER_A_ID, 'agree', {
      sequence: p.lastAppliedSequence + 2,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sequence-mismatch');
  });

  it('accepts the exact next-expected sequence', () => {
    const p = seedSession();
    const action: VoteAction = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

describe('validateAction — universal participant check', () => {
  it('rejects an action from a user not currently joined to the session', () => {
    const p = seedSession();
    const action: VoteAction = makeVoteAction(p, NON_PARTICIPANT_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-a-participant');
      expect(r.detail).toContain(NON_PARTICIPANT_ID);
    }
  });

  it('rejects an action from a user who left the session', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'participant-left', DEBATER_B_ID, T9, {
        user_id: DEBATER_B_ID,
        left_at: T9,
      }),
    );
    const action: VoteAction = makeVoteAction(p, DEBATER_B_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-a-participant');
  });
});

// ---------------------------------------------------------------
// ValidationResult discriminator narrowing.
// ---------------------------------------------------------------

describe('ValidationResult — discriminator round-trips', () => {
  it('Valid narrows to events; Rejected narrows to reason+detail', () => {
    const p = seedSession();
    const r1: ValidationResult = validateAction(p, makeVoteAction(p, DEBATER_A_ID, 'agree'));
    if (r1.ok) {
      // TS narrows: r1.events is ReadonlyArray<EventToAppend>.
      expect(Array.isArray(r1.events)).toBe(true);
      expect(r1.events.length).toBe(1);
    } else {
      throw new Error('expected Valid');
    }

    const r2: ValidationResult = validateAction(p, makeVoteAction(p, NON_PARTICIPANT_ID, 'agree'));
    if (!r2.ok) {
      // TS narrows: r2.reason is RejectionReason; r2.detail is string.
      expect(typeof r2.reason).toBe('string');
      expect(typeof r2.detail).toBe('string');
    } else {
      throw new Error('expected Rejected');
    }
  });
});

// ---------------------------------------------------------------
// Per-action smoke — each of the four action kinds dispatches to its
// placeholder handler and emits a single EventToAppend.
// ---------------------------------------------------------------

describe('validateAction — placeholder per-action handlers', () => {
  it('vote action emits a vote event payload', () => {
    const p = seedSession();
    const action: VoteAction = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('vote');
      expect(ev.sequence).toBe(nextSequence(p));
      expect(ev.sessionId).toBe(SESSION_ID);
      expect(ev.id).toBe(NEW_EVENT_ID);
      expect(ev.actor).toBe(DEBATER_A_ID);
      // payload narrows by kind discriminator + the new `target`
      // sub-discriminator (proposal-keyed vs. facet-keyed). The engine
      // emits the proposal-keyed arm for now per ADR 0030 §9 + the
      // TODO(pf_vote_handler_facet_keyed) carried in the methodology
      // handler.
      if (ev.kind === 'vote' && ev.payload.target === 'proposal') {
        expect(ev.payload.participant).toBe(DEBATER_A_ID);
        expect(ev.payload.proposal_id).toBe(PROPOSAL_ID_1);
        expect(ev.payload.choice).toBe('agree');
      }
    }
  });

  it('propose action emits a proposal envelope event', () => {
    const p = seedSession();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'value' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('proposal');
      if (ev.kind === 'proposal') {
        const inner = ev.payload.proposal;
        expect(inner.kind).toBe('classify-node');
      }
    }
  });

  it('commit action dispatches to the real commit handler (rejects no-vote case)', () => {
    // After `commit_logic` landed, the engine's commit handler is the
    // real write-side validator: it rejects a commit on a pending
    // proposal where no participant has voted yet. This test asserts
    // the dispatcher routes a commit action to that handler — the
    // handler's full rule set is covered in
    // `apps/server/src/methodology/handlers/commit.test.ts`.
    const p = seedSession();
    const action: CommitAction = {
      kind: 'commit',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposalEventId: PROPOSAL_ID_1,
      committedAt: T9,
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
    }
  });

  it('mark-meta-disagreement action dispatches to the real handler (rejects no-dispute case)', () => {
    // After `meta_disagreement_logic` landed, the engine's
    // mark-meta-disagreement handler is the real write-side validator:
    // it rejects a mark on a pending proposal that has no recorded
    // dispute on the affected facet (Option A — the structural
    // exhaustion gate). This test asserts the dispatcher routes a
    // mark-meta-disagreement action to that handler — the handler's
    // full rule set is covered in
    // `apps/server/src/methodology/handlers/markMetaDisagreement.test.ts`.
    const p = seedSession();
    const action: MarkMetaDisagreementAction = {
      kind: 'mark-meta-disagreement',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposalEventId: PROPOSAL_ID_1,
      markedAt: T9,
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('methodology-not-exhausted');
    }
  });
});

// ---------------------------------------------------------------
// End-to-end smoke — typical legal vote flow.
// ---------------------------------------------------------------

describe('end-to-end smoke', () => {
  it('a vote-agree action from a participant on a pending proposal passes universal checks', () => {
    const p = seedSession();
    const action: MethodologyAction = {
      kind: 'vote',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposalEventId: PROPOSAL_ID_1,
      vote: 'agree',
      votedAt: T9,
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('vote');
    }
  });
});
