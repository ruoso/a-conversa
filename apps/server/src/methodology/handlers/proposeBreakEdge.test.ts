// Tests for the real propose-side validator for the `break-edge`
// proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/break_edge_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.break_edge_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// break-edge-specific rule set:
//
//   1. Edge-exists — unknown edge_id rejected with
//      `'target-entity-not-found'`.
//   2. Edge-visible — already-broken edge rejected with
//      `'illegal-state-transition'`.
//   3. No conflicting break-edge pending — a second propose against
//      the same edge while a prior is pending is rejected with
//      `'illegal-state-transition'`.
//   4. Accept path — emits one `proposal` event with payload mirroring
//      the action.
//
// Plus a Zod-layer assertion: the structural shape — `kind:
// 'break-edge'`, `edge_id: UUID` — is enforced upstream by
// `breakEdgeProposalSchema` per ADR 0021. The methodology validator
// relies on this layering and is never reached for malformed payloads.
// Two test cases (missing `edge_id`, non-UUID `edge_id`) call
// `breakEdgeProposalSchema.safeParse` directly and confirm
// `success === false` — that's the layering pin.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { breakEdgeProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111be';

const HOST_ID = '22222222-2222-4222-8222-2222222222be';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333333be';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444444be';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555555be';

const NODE_SRC_ID = '66666666-6666-4666-8666-6666666666be';
const NODE_TGT_ID = '77777777-7777-4777-8777-7777777777be';
const EDGE_ID = '88888888-8888-4888-8888-8888888888be';

const UNKNOWN_EDGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabe';

const PRIOR_BREAK_EDGE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccb1';
const PENDING_BREAK_EDGE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccb2';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddbe1';

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

// Seed a session with three participants, two visible nodes, and one
// visible `supports` edge between them (the candidate break-edge
// target). Returns the projection at the end of the seed.
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
    makeEvent(5, 'node-created', DEBATER_B_ID, T2, {
      node_id: NODE_SRC_ID,
      wording: 'Backing fact for the edge.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(6, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_TGT_ID,
      wording: 'Claim that the edge supports.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(7, 'edge-created', DEBATER_B_ID, T2, {
      edge_id: EDGE_ID,
      role: 'supports',
      source_node_id: NODE_SRC_ID,
      target_node_id: NODE_TGT_ID,
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-break-edge action at the next-expected
// sequence. Default: debater A proposes breaking the seeded edge.
function makeBreakEdgeAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    edgeId: string;
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
      kind: 'break-edge',
      edge_id: overrides.edgeId ?? EDGE_ID,
    },
  };
}

// ---------------------------------------------------------------
// Rule 1 — edge-exists.
// ---------------------------------------------------------------

describe('propose break-edge — rule 1: edge-exists', () => {
  it('rejects when edge_id refers to no edge in the projection', () => {
    const p = seedSession();
    const action = makeBreakEdgeAction(p, { edgeId: UNKNOWN_EDGE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_EDGE_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — edge-visible.
//
// The not-visible state for an edge is produced by a prior committed
// break-edge against it — `applyCommittedProposal`'s break-edge arm
// calls `projection.setEdgeVisible(edge_id, false)`. We synthesize the
// events directly (proposal → commit) so the projection's read-side
// state matches what would happen after a real break-edge commit.
// ---------------------------------------------------------------

describe('propose break-edge — rule 2: edge-visible', () => {
  it('rejects when the target edge has already been broken (not visible)', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'break-edge',
          edge_id: EDGE_ID,
        },
      }),
      id: PRIOR_BREAK_EDGE_PROPOSAL_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_BREAK_EDGE_PROPOSAL_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Sanity: the edge is now invisible.
    expect(p.getEdge(EDGE_ID)?.visible).toBe(false);

    const action = makeBreakEdgeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EDGE_ID);
      expect(r.detail).toContain('not currently visible');
    }
  });
});

// ---------------------------------------------------------------
// Rule 3 — no conflicting break-edge proposal pending.
//
// Lands a pending break-edge against the same edge (proposal event,
// no commit yet). The projection's `applyEvent` path adds it to
// `pendingProposals`. The propose handler's rule 3 walks
// `findConflictingBreakEdgeProposal` and rejects the second propose.
// ---------------------------------------------------------------

describe('propose break-edge — rule 3: no conflicting break-edge pending', () => {
  it('rejects when another break-edge against the same edge is already pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'break-edge',
          edge_id: EDGE_ID,
        },
      }),
      id: PENDING_BREAK_EDGE_PROPOSAL_ID,
    });
    // Sanity: the prior proposal is pending against this edge.
    expect(p.getPendingProposal(PENDING_BREAK_EDGE_PROPOSAL_ID)).toBeDefined();
    // Sanity: the edge is still visible (only proposal landed, no commit).
    expect(p.getEdge(EDGE_ID)?.visible).toBe(true);

    const action = makeBreakEdgeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EDGE_ID);
      expect(r.detail).toContain(PENDING_BREAK_EDGE_PROPOSAL_ID);
    }
  });
});

// ---------------------------------------------------------------
// Accept path — well-formed propose break-edge.
// ---------------------------------------------------------------

describe('propose break-edge — accept path', () => {
  it('accepts a well-formed break-edge proposal and emits one proposal event', () => {
    const p = seedSession();
    const action = makeBreakEdgeAction(p);
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
        expect(inner.kind).toBe('break-edge');
        if (inner.kind === 'break-edge') {
          expect(inner.edge_id).toBe(EDGE_ID);
        }
      }
    }
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces the structural shape
// (`edge_id: UUID`). The methodology validator is never reached for
// those failures because the structural validator (ADR 0021) runs
// first. This block asserts the layering by calling the schema
// directly.
// ---------------------------------------------------------------

describe('propose break-edge — structural shape (upstream Zod layering)', () => {
  it('rejects payloads missing `edge_id` at the Zod layer', () => {
    const result = breakEdgeProposalSchema.safeParse({
      kind: 'break-edge',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID `edge_id` values at the Zod layer', () => {
    const result = breakEdgeProposalSchema.safeParse({
      kind: 'break-edge',
      edge_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});
