// Tests for the real propose-side validator for the `axiom-mark`
// proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/axiom_mark_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.axiom_mark_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// axiom-mark-specific rule set:
//
//   1. Node-exists — unknown id rejected with
//      `'target-entity-not-found'`.
//   2. Node-visible — already-superseded node rejected with
//      `'illegal-state-transition'`.
//   3. Participant-equals-requester — cross-participant marking
//      rejected with `'axiom-mark-not-self'`.
//   4. No duplicate axiom-mark — second mark on the same
//      (node, participant) rejected with `'illegal-state-transition'`.
//   5. Accept path — emits one `proposal` event with payload mirroring
//      the action.
//   6. Per-participant uniqueness — a second participant marking the
//      same node is accepted (Anna marking N9 doesn't block Ben
//      marking N9; see docs/data-model.md line 38).
//
// Plus a Zod-layer assertion: the structural shape — `kind:
// 'axiom-mark'`, `node_id: UUID`, `participant: UUID` — is enforced
// upstream by `axiomMarkProposalSchema` per ADR 0021. The methodology
// validator relies on this layering and is never reached for malformed
// payloads. Three test cases (missing `participant`, missing
// `node_id`, non-UUID `participant`) call
// `axiomMarkProposalSchema.safeParse` directly and confirm
// `success === false` — that's the layering pin.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { axiomMarkProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111ccc';

const HOST_ID = '22222222-2222-4222-8222-222222222ccc';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333ccc';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444ccc';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555ccc';

const NODE_ID = '77777777-7777-4777-8777-777777777ccc';
const UNKNOWN_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaccc';

const PRIOR_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const PRIOR_AXIOM_MARK_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddccc';

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

// Seed a session with three participants and one visible node (the
// candidate axiom-mark target). Returns the projection at sequence 5.
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
      node_id: NODE_ID,
      wording: 'A statement that someone might hold as bedrock.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-axiom-mark action at the next-expected
// sequence. By default, debater A proposes a mark on themselves for
// the seeded node — the canonical accept case.
function makeAxiomMarkAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    nodeId: string;
    participant: string;
    requester: string;
    eventId: string;
  }> = {},
): ProposeAction {
  const requester = overrides.requester ?? DEBATER_A_ID;
  return {
    kind: 'propose',
    requester,
    sessionId: SESSION_ID,
    eventId: overrides.eventId ?? NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposal: {
      kind: 'axiom-mark',
      node_id: overrides.nodeId ?? NODE_ID,
      participant: overrides.participant ?? requester,
    },
  };
}

// ---------------------------------------------------------------
// Rule 1 — node-exists.
// ---------------------------------------------------------------

describe('propose axiom-mark — rule 1: node-exists', () => {
  it('rejects when node_id refers to no node in the projection', () => {
    const p = seedSession();
    const action = makeAxiomMarkAction(p, { nodeId: UNKNOWN_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — node-visible.
//
// The not-visible state is produced by a prior committed decompose
// against the same node — `applyCommittedProposal`'s decompose arm
// flips `node.visible = false`. We synthesize the events directly
// (proposal → commit) so the projection's read-side state matches what
// would happen after a real decompose commit (same pattern
// proposeDecompose.test.ts uses).
// ---------------------------------------------------------------

describe('propose axiom-mark — rule 2: node-visible', () => {
  it('rejects when the target node has been superseded (not visible)', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID,
          components: [
            { wording: 'Prior decompose component one.', classification: 'fact' },
            { wording: 'Prior decompose component two.', classification: 'value' },
          ],
        },
      }),
      id: PRIOR_DECOMPOSE_PROPOSAL_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_DECOMPOSE_PROPOSAL_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Sanity: the node is now invisible.
    expect(p.getNode(NODE_ID)?.visible).toBe(false);

    const action = makeAxiomMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(NODE_ID);
      expect(r.detail).toContain('not currently visible');
    }
  });
});

// ---------------------------------------------------------------
// Rule 3 — participant-equals-requester.
// ---------------------------------------------------------------

describe('propose axiom-mark — rule 3: participant-equals-requester', () => {
  it('rejects when proposal.participant differs from action.requester', () => {
    const p = seedSession();
    // Debater A proposes an axiom-mark whose `participant` is debater B
    // — declaring B's bedrock on B's behalf. This is the cross-
    // participant marking case the rule rejects.
    const action = makeAxiomMarkAction(p, {
      requester: DEBATER_A_ID,
      participant: DEBATER_B_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('axiom-mark-not-self');
      expect(r.detail).toContain(DEBATER_A_ID);
      expect(r.detail).toContain(DEBATER_B_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 4 — no duplicate axiom-mark.
//
// Lands a prior axiom-mark commit for (NODE_ID, DEBATER_A_ID) directly
// through `applyEvent`. The projection's `applyCommittedProposal`
// axiom-mark arm writes `node.axiomMarks.set(participant, ...)`, so
// `hasAxiomMark` returns true on the second propose's check.
//
// Note: `commit_logic`'s rule 4 currently rejects commits of structural
// sub-kinds with `'illegal-state-transition'`. The projection's
// `applyEvent` path doesn't re-validate methodology rules, so feeding
// events directly through `applyEvent` reaches the read-side state
// (same pattern proposeDecompose.test.ts uses for rule 2).
// ---------------------------------------------------------------

describe('propose axiom-mark — rule 4: no duplicate axiom-mark', () => {
  it('rejects when the participant already has a committed axiom-mark on this node', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'axiom-mark',
          node_id: NODE_ID,
          participant: DEBATER_A_ID,
        },
      }),
      id: PRIOR_AXIOM_MARK_PROPOSAL_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_AXIOM_MARK_PROPOSAL_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Sanity: the projection has the mark on record.
    expect(p.getNode(NODE_ID)?.axiomMarks.has(DEBATER_A_ID)).toBe(true);

    const action = makeAxiomMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(NODE_ID);
      expect(r.detail).toContain(DEBATER_A_ID);
    }
  });
});

// ---------------------------------------------------------------
// Accept path — well-formed propose axiom-mark.
// ---------------------------------------------------------------

describe('propose axiom-mark — accept path', () => {
  it('accepts a well-formed axiom-mark proposal and emits one proposal event', () => {
    const p = seedSession();
    const action = makeAxiomMarkAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('proposal');
      expect(ev.id).toBe(NEW_EVENT_ID);
      expect(ev.sessionId).toBe(SESSION_ID);
      expect(ev.sequence).toBe(action.sequence);
      expect(ev.actor).toBe(DEBATER_A_ID);
      expect(ev.createdAt).toBe(T9);
      if (ev.kind === 'proposal') {
        const inner = ev.payload.proposal;
        expect(inner.kind).toBe('axiom-mark');
        if (inner.kind === 'axiom-mark') {
          expect(inner.node_id).toBe(NODE_ID);
          expect(inner.participant).toBe(DEBATER_A_ID);
        }
      }
    }
  });

  // Per docs/data-model.md line 38: "Ben may hold N9 as an axiom while
  // Anna does not, or both may hold the same node as axiomatic from
  // their respective frames." This test exercises the per-participant
  // uniqueness model: a prior axiom-mark by A on N1 does not block a
  // fresh axiom-mark by B on the same N1.
  it('accepts a second participant marking the same node (per-participant uniqueness)', () => {
    const p = seedSession();
    // Land A's axiom-mark commit on (NODE_ID, DEBATER_A_ID).
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'axiom-mark',
          node_id: NODE_ID,
          participant: DEBATER_A_ID,
        },
      }),
      id: PRIOR_AXIOM_MARK_PROPOSAL_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_AXIOM_MARK_PROPOSAL_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    expect(p.getNode(NODE_ID)?.axiomMarks.has(DEBATER_A_ID)).toBe(true);
    expect(p.getNode(NODE_ID)?.axiomMarks.has(DEBATER_B_ID)).toBe(false);

    // Now B proposes their own axiom-mark on the same node — accepted.
    const action = makeAxiomMarkAction(p, {
      requester: DEBATER_B_ID,
      participant: DEBATER_B_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      if (ev.kind === 'proposal') {
        const inner = ev.payload.proposal;
        if (inner.kind === 'axiom-mark') {
          expect(inner.participant).toBe(DEBATER_B_ID);
        }
      }
    }
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces the structural shape
// (`node_id: UUID`, `participant: UUID`). The methodology validator
// is never reached for those failures because the structural validator
// (ADR 0021) runs first. This block asserts the layering by calling
// the schema directly.
// ---------------------------------------------------------------

describe('propose axiom-mark — structural shape (upstream Zod layering)', () => {
  it('rejects payloads missing `participant` at the Zod layer', () => {
    const result = axiomMarkProposalSchema.safeParse({
      kind: 'axiom-mark',
      node_id: NODE_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects payloads missing `node_id` at the Zod layer', () => {
    const result = axiomMarkProposalSchema.safeParse({
      kind: 'axiom-mark',
      participant: DEBATER_A_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID `participant` values at the Zod layer', () => {
    const result = axiomMarkProposalSchema.safeParse({
      kind: 'axiom-mark',
      node_id: NODE_ID,
      participant: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});
