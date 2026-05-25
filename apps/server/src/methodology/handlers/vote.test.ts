// Tests for the real `vote` action handler.
//
// Refinement: tasks/refinements/data-and-methodology/withdrawal_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.withdrawal_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// vote-specific rule set across all three arms:
//
//   - **agree**: reject when proposal doesn't exist / is committed /
//     is meta-disagreed / requester has already voted agree. Accept
//     fresh agree and dispute → agree switch.
//   - **dispute**: mirror of agree.
//   - **withdraw** (load-bearing): reject when proposal is pending
//     (no commit to withdraw from) / is meta-disagreed / requester has
//     no prior agree on this proposal. Accept when requester has prior
//     agree on a committed proposal — cross-check `deriveFacetStatus`
//     returns `'withdrawn'` after the resulting vote event is applied.
//
// Plus the shared "non-participant rejected by universal gate" case.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type VoteAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';
const OUTSIDER_ID = '66666666-6666-4666-8666-666666666666';

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

// Seed a session at sequence 6 with three participants, one node, and
// one pending `classify-node` proposal. No votes yet.
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
  vote: 'agree' | 'dispute',
  proposalId: string = PROPOSAL_ID_1,
): void {
  // The seeded session's proposal is a facet-valued `classify-node`,
  // so seeded votes use the facet-keyed arm per ADR 0030 §2 — this
  // matches what the methodology engine's vote handler now emits.
  // The `proposalId` argument is ignored on the facet arm (the
  // facet-keyed payload has no `proposal_id`); kept on the signature
  // so the structural-vote helpers below stay symmetric.
  void proposalId;
  // Per ADR 0030 §3 + `pf_withdraw_agreement_handler`: the
  // `'withdraw'` arm is gone from the vote payload's `choice` enum.
  // Callers that want to record a withdrawal use the dedicated
  // `withdraw-agreement` event kind instead (see the projection-
  // replay pin in the withdraw-after-commit test above).
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'vote', participant, T9, {
      target: 'facet' as const,
      entity_kind: 'node' as const,
      entity_id: NODE_ID_1,
      facet: 'classification' as const,
      participant,
      choice: vote,
      voted_at: T9,
    }),
  );
}

function applyCommit(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string = PROPOSAL_ID_1,
  moderator: string = MODERATOR_ID,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', moderator, T9, {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: moderator,
      committed_at: T9,
    }),
  );
}

function applyMetaDisagreementMark(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalId: string = PROPOSAL_ID_1,
  moderator: string = MODERATOR_ID,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'meta-disagreement-marked', moderator, T9, {
      target: 'proposal',
      proposal_id: proposalId,
      marked_by: moderator,
      marked_at: T9,
    }),
  );
}

// Per ADR 0030 §3 + `pf_unit_test_audit`: the wire `vote.choice` enum
// is `'agree' | 'dispute'`; withdrawal is its own first-class event
// kind (`withdraw-agreement`). This helper does NOT carry a
// `'withdraw'` arm — schema rejection is pinned at the wire layer in
// `apps/server/src/events/validate.test.ts` and
// `packages/shared-types/src/events.test.ts`.
function makeVoteAction(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string,
  vote: 'agree' | 'dispute',
  proposalEventId?: string,
): VoteAction {
  // The seeded session's open proposal is `classify-node` against
  // NODE_ID_1; the default action shape uses the facet arm naming the
  // `(entity_kind, entity_id, facet)` triple directly (per ADR 0030 §2
  // + the refactor that drops the proposalEventId roundtrip from the
  // facet arm). Tests that probe the proposal arm (unknown-id /
  // structural sub-kinds) pass an explicit `proposalEventId`.
  const baseCommon = {
    kind: 'vote' as const,
    requester,
    sessionId: SESSION_ID,
    eventId: NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    vote,
    votedAt: T9,
  };
  if (proposalEventId === undefined) {
    return {
      ...baseCommon,
      target: 'facet' as const,
      entityKind: 'node' as const,
      entityId: NODE_ID_1,
      facet: 'classification' as const,
    };
  }
  return {
    ...baseCommon,
    target: 'proposal' as const,
    proposalEventId,
  };
}

// ---------------------------------------------------------------
// Shared — universal gate rejects outsiders.
// ---------------------------------------------------------------

describe('vote handler — shared: non-participant rejection', () => {
  it('rejects a vote from a non-participant with not-a-participant (universal gate)', () => {
    const p = seedSession();
    const action = makeVoteAction(p, OUTSIDER_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-a-participant');
      expect(r.detail).toContain(OUTSIDER_ID);
    }
  });
});

// ---------------------------------------------------------------
// agree arm.
// ---------------------------------------------------------------

describe('vote handler — agree arm', () => {
  it('rejects an agree on an unknown proposal id with proposal-not-found', () => {
    const p = seedSession();
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_UNKNOWN);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-not-found');
      expect(r.detail).toContain(PROPOSAL_ID_UNKNOWN);
    }
  });

  it('rejects an agree on an already-committed proposal with proposal-already-committed', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    applyCommit(p);
    // A new attempt to agree on the now-committed proposal.
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-committed');
    }
  });

  it('rejects an agree on a meta-disagreement-marked proposal with proposal-already-meta-disagreement', () => {
    const p = seedSession();
    applyMetaDisagreementMark(p);
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-meta-disagreement');
    }
  });

  it('rejects a re-cast agree from the same participant with already-voted', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    // DEBATER_A tries to agree again.
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('already-voted');
      expect(r.detail).toContain(DEBATER_A_ID);
    }
  });

  it('accepts a fresh agree from a current participant — emits facet-keyed event for the classify-node facet', () => {
    const p = seedSession();
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('vote');
      expect(ev.id).toBe(NEW_EVENT_ID);
      expect(ev.sessionId).toBe(SESSION_ID);
      expect(ev.sequence).toBe(action.sequence);
      expect(ev.actor).toBe(DEBATER_A_ID);
      expect(ev.createdAt).toBe(T9);
      // The engine now emits the facet-keyed arm for facet-valued
      // proposal sub-kinds (classify-node here) per ADR 0030 §2.
      if (ev.kind === 'vote') {
        expect(ev.payload.target).toBe('facet');
        if (ev.payload.target === 'facet') {
          expect(ev.payload.entity_kind).toBe('node');
          expect(ev.payload.entity_id).toBe(NODE_ID_1);
          expect(ev.payload.facet).toBe('classification');
          expect(ev.payload.participant).toBe(DEBATER_A_ID);
          expect(ev.payload.choice).toBe('agree');
          expect(ev.payload.voted_at).toBe(T9);
        }
      }
    }
  });

  it('accepts a switch from dispute to agree (vote mutability before commit)', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'dispute');
    // DEBATER_A switches to agree.
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok && r.events[0]!.kind === 'vote') {
      expect(r.events[0].payload.choice).toBe('agree');
    }
  });

  // ----- facet-keyed emission discriminator coverage ----------------

  it('emits the facet-keyed arm with no proposal_id field (per ADR 0030 §2)', () => {
    const p = seedSession();
    const action = makeVoteAction(p, DEBATER_A_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok && r.events[0]!.kind === 'vote') {
      const payload = r.events[0].payload as Record<string, unknown>;
      expect(payload.target).toBe('facet');
      // The facet arm carries `entity_kind` / `entity_id` / `facet`
      // and intentionally has NO `proposal_id` field. The closed Zod
      // discriminated union would reject it; the engine doesn't
      // emit it.
      expect(payload.proposal_id).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------
// dispute arm — mirror of agree.
// ---------------------------------------------------------------

describe('vote handler — dispute arm', () => {
  it('rejects a dispute on an unknown proposal id with proposal-not-found', () => {
    const p = seedSession();
    const action = makeVoteAction(p, DEBATER_A_ID, 'dispute', PROPOSAL_ID_UNKNOWN);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('proposal-not-found');
  });

  it('rejects a dispute on an already-committed proposal with proposal-already-committed', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    applyCommit(p);
    const action = makeVoteAction(p, DEBATER_A_ID, 'dispute');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('proposal-already-committed');
  });

  it('rejects a dispute on a meta-disagreement-marked proposal with proposal-already-meta-disagreement', () => {
    const p = seedSession();
    applyMetaDisagreementMark(p);
    const action = makeVoteAction(p, DEBATER_A_ID, 'dispute');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('proposal-already-meta-disagreement');
  });

  it('rejects a re-cast dispute from the same participant with already-voted', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'dispute');
    const action = makeVoteAction(p, DEBATER_A_ID, 'dispute');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('already-voted');
      expect(r.detail).toContain(DEBATER_A_ID);
    }
  });

  it('accepts a fresh dispute from a current participant', () => {
    const p = seedSession();
    const action = makeVoteAction(p, DEBATER_A_ID, 'dispute');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok && r.events[0]!.kind === 'vote') {
      expect(r.events[0].payload.choice).toBe('dispute');
    }
  });

  it('accepts a switch from agree to dispute (vote mutability before commit)', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    const action = makeVoteAction(p, DEBATER_A_ID, 'dispute');
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok && r.events[0]!.kind === 'vote') {
      expect(r.events[0].payload.choice).toBe('dispute');
    }
  });
});

// ---------------------------------------------------------------
// withdraw arm — the load-bearing case for this task.
// ---------------------------------------------------------------

describe('vote handler — withdraw arm', () => {
  // Per ADR 0030 §3 + `pf_unit_test_audit`: the legacy `vote.choice =
  // 'withdraw'` arm is retired. The wire schema hard-rejects
  // `'withdraw'` on inbound validation (Zod `z.enum(['agree',
  // 'dispute'])`); `VoteAction.vote` is narrowed to match. The
  // following three cases — "facet-valued withdraw rejected with
  // illegal-state-transition", "meta-disagreement withdraw rejected
  // with proposal-already-meta-disagreement", "committed withdraw
  // rejected with proposal-already-committed" — used to pin the
  // methodology engine's rejection of the legacy choice. They are
  // deleted because the methodology arm cannot be reached: schema
  // rejection happens at the wire layer (pinned in
  // `apps/server/src/events/validate.test.ts:rejects 'withdraw' as a
  // vote choice` + `packages/shared-types/src/events.test.ts`).
  //
  // The replacement legal path — `withdraw-agreement` event kind +
  // projection-side `'withdrawn'` derivation — is pinned by the
  // surviving "records a withdraw-agreement event on the projection"
  // case below.

  // Per ADR 0030 §3 + `pf_withdraw_agreement_handler`: withdraw is
  // no longer a vote choice — it is its own top-level event kind
  // (`'withdraw-agreement'`) handled by
  // `apps/server/src/ws/handlers/withdraw-agreement.ts`. The handler
  // appends a `withdraw-agreement` event; the projection's
  // `handleWithdrawAgreement` adds the participant to the facet's
  // `withdrawals` set; `deriveFacetStatus` rule-4 surfaces
  // `'withdrawn'` once the withdrawal lands on a committed candidate.
  //
  // This test pins the projection-side round-trip the dedicated
  // handler-layer test at
  // `apps/server/src/ws/handlers/withdraw-agreement.test.ts` cannot
  // reach directly: applying a real `withdraw-agreement` event onto
  // the projection flips the facet status to `'withdrawn'`. The
  // happy-path validation lives in the WS handler test; this is the
  // projection-replay pin.
  it('records a withdraw-agreement event on the projection and the facet status flips to withdrawn', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    applyCommit(p);
    expect(deriveFacetStatus(p, 'node', NODE_ID_1, 'classification')).toBe('committed');

    // Apply a real `withdraw-agreement` event directly onto the
    // projection (replay-layer pin). The WS handler test exercises
    // the wire-shape + gate stack; this exercises the projection
    // walker's response to the new event kind.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'withdraw-agreement', DEBATER_A_ID, T9, {
        entity_kind: 'node' as const,
        entity_id: NODE_ID_1,
        facet: 'classification' as const,
        participant: DEBATER_A_ID,
        withdrawn_at: T9,
      }),
    );
    expect(deriveFacetStatus(p, 'node', NODE_ID_1, 'classification')).toBe('withdrawn');
  });

  // Pins the universal gate (not-a-participant) on a committed
  // proposal. The legacy version of this case exercised the
  // `'withdraw'` vote-choice arm — `pf_unit_test_audit` rewrote it
  // against the `'agree'` arm (the universal gate catches the
  // outsider before any choice-specific branch runs).
  it('rejects a vote from a non-participant on a committed proposal with not-a-participant', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    applyCommit(p);
    const action = makeVoteAction(p, OUTSIDER_ID, 'agree');
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-a-participant');
  });
});
