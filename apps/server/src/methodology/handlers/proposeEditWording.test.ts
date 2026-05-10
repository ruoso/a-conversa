// Tests for the real propose-side validator for the `edit-wording`
// proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/reword_vs_restructure.md
// TaskJuggler: data_and_methodology.methodology_engine.reword_vs_restructure
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// edit-wording-specific rule set. The handler sub-switches on
// `edit_kind` (`'reword' | 'restructure'`); the two inner kinds share
// three rules; `restructure` adds a fourth:
//
//   Shared (both inner kinds):
//   1. Node-exists — unknown id rejected with
//      `'target-entity-not-found'`.
//   2. Node-visible — already-superseded node rejected with
//      `'illegal-state-transition'`.
//   3. No conflicting edit-wording / decompose / interpretive-split
//      pending against the same node — second proposal rejected with
//      `'illegal-state-transition'` (mutual exclusion across the three
//      structural sub-kinds).
//
//   Restructure only:
//   4. `new_node_id` does not collide with an existing node id —
//      colliding id rejected with `'illegal-state-transition'`.
//
//   Both inner kinds:
//   5. Accept path — emits one `proposal` event with payload mirroring
//      the action.
//
// Plus a Zod-layer assertion: the structural shape — outer
// `kind: 'edit-wording'`, nested `edit_kind` discriminator,
// `node_id: UUID`, `new_wording` non-empty, and (for restructure)
// `new_node_id: UUID` — is enforced upstream by
// `editWordingProposalSchema` per ADR 0021. The methodology validator
// relies on this layering and is never reached for malformed payloads.
// Four test cases (missing `new_node_id` on restructure, empty
// `new_wording`, missing `node_id`, invalid `edit_kind`) call
// `editWordingProposalSchema.safeParse` directly and confirm
// `success === false` — that's the layering pin.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { editWordingProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111ee0';

const HOST_ID = '22222222-2222-4222-8222-222222222ee0';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333ee0';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444ee0';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555ee0';

const NODE_ID = '77777777-7777-4777-8777-777777777ee0';
const OTHER_NODE_ID = '88888888-8888-4888-8888-888888888ee0';
const UNKNOWN_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaee0';
const FRESH_NEW_NODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbee0';

const PRIOR_RESTRUCTURE_COMMIT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccee1';
const PENDING_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccee2';
const PENDING_SPLIT_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccee3';
const PENDING_REWORD_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccee4';
const PENDING_RESTRUCTURE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccee5';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddee0';

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
// candidate edit-wording target). Returns the projection at sequence 5.
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
      wording: 'An original phrasing of the claim.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-edit-wording (reword) action at the next-
// expected sequence.
function makeRewordAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    nodeId: string;
    newWording: string;
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
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: overrides.nodeId ?? NODE_ID,
      new_wording: overrides.newWording ?? 'A clearer phrasing of the same claim.',
    },
  };
}

// Build a well-formed propose-edit-wording (restructure) action at the
// next-expected sequence.
function makeRestructureAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    nodeId: string;
    newWording: string;
    newNodeId: string;
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
      kind: 'edit-wording',
      edit_kind: 'restructure',
      node_id: overrides.nodeId ?? NODE_ID,
      new_wording: overrides.newWording ?? 'A meaningfully different statement.',
      new_node_id: overrides.newNodeId ?? FRESH_NEW_NODE_ID,
    },
  };
}

// ---------------------------------------------------------------
// Shared rule 1 — node-exists. Tested under both inner kinds because
// the rejection detail includes the `edit_kind` and we want both
// paths pinned.
// ---------------------------------------------------------------

describe('propose edit-wording — rule 1: node-exists', () => {
  it('rejects reword when node_id refers to no node in the projection', () => {
    const p = seedSession();
    const action = makeRewordAction(p, { nodeId: UNKNOWN_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
      expect(r.detail).toContain('reword');
    }
  });

  it('rejects restructure when node_id refers to no node in the projection', () => {
    const p = seedSession();
    const action = makeRestructureAction(p, { nodeId: UNKNOWN_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
      expect(r.detail).toContain('restructure');
    }
  });
});

// ---------------------------------------------------------------
// Shared rule 2 — node-visible.
//
// The not-visible state is produced by a prior committed restructure
// against the same node — `applyCommittedProposal`'s edit-wording arm
// flips `oldNode.visible = false` for restructure. We synthesize the
// events directly (proposal → commit) so the projection's read-side
// state matches what would happen after a real restructure commit
// (same pattern proposeDecompose.test.ts uses).
// ---------------------------------------------------------------

describe('propose edit-wording — rule 2: node-visible', () => {
  it('rejects reword when the node has been superseded (not visible)', () => {
    const p = seedSession();
    // Land a prior restructure against NODE_ID and its paired
    // node-created for the replacement; then commit the restructure.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T3, {
        node_id: FRESH_NEW_NODE_ID,
        wording: 'A meaningfully different statement.',
        created_by: DEBATER_A_ID,
        created_at: T3,
      }),
    );
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: NODE_ID,
          new_wording: 'A meaningfully different statement.',
          new_node_id: FRESH_NEW_NODE_ID,
        },
      }),
      id: PRIOR_RESTRUCTURE_COMMIT_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_RESTRUCTURE_COMMIT_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Sanity: the original node is now invisible.
    expect(p.getNode(NODE_ID)?.visible).toBe(false);

    const action = makeRewordAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(NODE_ID);
      expect(r.detail).toContain('not currently visible');
    }
  });

  it('rejects restructure when the node has been superseded (not visible)', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T3, {
        node_id: FRESH_NEW_NODE_ID,
        wording: 'A meaningfully different statement.',
        created_by: DEBATER_A_ID,
        created_at: T3,
      }),
    );
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: NODE_ID,
          new_wording: 'A meaningfully different statement.',
          new_node_id: FRESH_NEW_NODE_ID,
        },
      }),
      id: PRIOR_RESTRUCTURE_COMMIT_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_RESTRUCTURE_COMMIT_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    expect(p.getNode(NODE_ID)?.visible).toBe(false);

    // A second restructure with a different new_node_id so rule 4
    // doesn't pre-empt rule 2.
    const action = makeRestructureAction(p, {
      newNodeId: '99999999-9999-4999-8999-999999999ee9',
    });
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
// Shared rule 3 — no conflicting decompose / interpretive-split /
// edit-wording pending.
//
// The mutual exclusion is symmetric across all three sub-kinds. Each
// inner kind (reword, restructure) should reject when ANY of the three
// is pending against the same node. The matrix is large; we pin one
// representative case per (inner-kind × conflicting-kind) cell.
// ---------------------------------------------------------------

describe('propose edit-wording — rule 3: no conflicting pending proposal', () => {
  it('rejects reword when a decompose proposal against the same node is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID,
          components: [
            { wording: 'A decompose component one.', classification: 'fact' },
            { wording: 'A decompose component two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_DECOMPOSE_PROPOSAL_ID,
    });
    const action = makeRewordAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_DECOMPOSE_PROPOSAL_ID);
      expect(r.detail).toContain('decompose');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  it('rejects reword when an interpretive-split proposal against the same node is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: NODE_ID,
          readings: [
            { wording: 'A reading one.', classification: 'fact' },
            { wording: 'A reading two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_SPLIT_PROPOSAL_ID,
    });
    const action = makeRewordAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_SPLIT_PROPOSAL_ID);
      expect(r.detail).toContain('interpretive-split');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  it('rejects reword when another edit-wording (reword) proposal against the same node is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'reword',
          node_id: NODE_ID,
          new_wording: 'A different clearer phrasing.',
        },
      }),
      id: PENDING_REWORD_PROPOSAL_ID,
    });
    const action = makeRewordAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_REWORD_PROPOSAL_ID);
      expect(r.detail).toContain('edit-wording');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  it('rejects restructure when a decompose proposal against the same node is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID,
          components: [
            { wording: 'A decompose component one.', classification: 'fact' },
            { wording: 'A decompose component two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_DECOMPOSE_PROPOSAL_ID,
    });
    const action = makeRestructureAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_DECOMPOSE_PROPOSAL_ID);
      expect(r.detail).toContain('decompose');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  it('rejects restructure when an interpretive-split proposal against the same node is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: NODE_ID,
          readings: [
            { wording: 'A reading one.', classification: 'fact' },
            { wording: 'A reading two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_SPLIT_PROPOSAL_ID,
    });
    const action = makeRestructureAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_SPLIT_PROPOSAL_ID);
      expect(r.detail).toContain('interpretive-split');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  it('rejects restructure when another edit-wording (restructure) proposal against the same node is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: NODE_ID,
          new_wording: 'A first restructure phrasing.',
          new_node_id: '99999999-9999-4999-8999-999999999ee8',
        },
      }),
      id: PENDING_RESTRUCTURE_PROPOSAL_ID,
    });
    const action = makeRestructureAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_RESTRUCTURE_PROPOSAL_ID);
      expect(r.detail).toContain('edit-wording');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  // Cross-kind mutual-exclusion case introduced by amend_node_logic's
  // extension of `CONFLICTING_PARENT_KINDS` to include `'amend-node'`:
  // an edit-wording (reword or restructure) also rejects when an
  // amend-node is already pending against the same node. Both touch
  // the wording facet, so the conflict-walker rejects the second.
  // See amend_node_logic.md for the symmetry argument.
  it('rejects reword when an amend-node proposal against the same node is pending (cross-kind conflict)', () => {
    const p = seedSession();
    const PENDING_AMEND_NODE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccee9';
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'amend-node',
          node_id: NODE_ID,
          new_content: 'A pending amend-node against the same node.',
        },
      }),
      id: PENDING_AMEND_NODE_ID,
    });
    const action = makeRewordAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_AMEND_NODE_ID);
      expect(r.detail).toContain('amend-node');
      expect(r.detail).toContain(NODE_ID);
    }
  });

  it('accepts an edit-wording against a different node while one is pending elsewhere', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T2, {
        node_id: OTHER_NODE_ID,
        wording: 'A second statement.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    // First reword against NODE_ID (pending).
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'reword',
          node_id: NODE_ID,
          new_wording: 'A first clearer phrasing.',
        },
      }),
      id: PENDING_REWORD_PROPOSAL_ID,
    });
    // Second reword against OTHER_NODE_ID — no conflict.
    const action = makeRewordAction(p, { nodeId: OTHER_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Restructure-only rule 4 — new_node_id collision.
// ---------------------------------------------------------------

describe('propose edit-wording — rule 4 (restructure only): new_node_id collision', () => {
  it('rejects restructure when new_node_id collides with an existing node id', () => {
    const p = seedSession();
    // Seed a second visible node we'll collide with.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T2, {
        node_id: OTHER_NODE_ID,
        wording: 'A second statement that already exists.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    const action = makeRestructureAction(p, { newNodeId: OTHER_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(OTHER_NODE_ID);
      expect(r.detail).toContain('already names an existing node');
    }
  });
});

// ---------------------------------------------------------------
// Accept path — well-formed reword and restructure.
// ---------------------------------------------------------------

describe('propose edit-wording — accept path', () => {
  it('accepts a well-formed reword proposal and emits one proposal event', () => {
    const p = seedSession();
    const action = makeRewordAction(p);
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
        expect(inner.kind).toBe('edit-wording');
        if (inner.kind === 'edit-wording') {
          expect(inner.edit_kind).toBe('reword');
          expect(inner.node_id).toBe(NODE_ID);
          expect(inner.new_wording).toBe('A clearer phrasing of the same claim.');
          // reword has no new_node_id field; the discriminated union
          // narrows away that branch.
          expect('new_node_id' in inner).toBe(false);
        }
      }
    }
  });

  it('accepts a well-formed restructure proposal and emits one proposal event', () => {
    const p = seedSession();
    const action = makeRestructureAction(p);
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
        expect(inner.kind).toBe('edit-wording');
        if (inner.kind === 'edit-wording') {
          expect(inner.edit_kind).toBe('restructure');
          expect(inner.node_id).toBe(NODE_ID);
          expect(inner.new_wording).toBe('A meaningfully different statement.');
          if (inner.edit_kind === 'restructure') {
            expect(inner.new_node_id).toBe(FRESH_NEW_NODE_ID);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces the structural shape (outer
// `kind: 'edit-wording'`, nested `edit_kind` discriminator, `node_id`
// UUID, `new_wording` non-empty, and `new_node_id` UUID on restructure
// only). The methodology validator is never reached for those failures
// because the structural validator (ADR 0021) runs first. This block
// asserts the layering by calling the schema directly.
// ---------------------------------------------------------------

describe('propose edit-wording — structural shape (upstream Zod layering)', () => {
  it('rejects restructure payloads missing `new_node_id` at the Zod layer', () => {
    const result = editWordingProposalSchema.safeParse({
      kind: 'edit-wording',
      edit_kind: 'restructure',
      node_id: NODE_ID,
      new_wording: 'A meaningfully different statement.',
      // new_node_id omitted
    });
    expect(result.success).toBe(false);
  });

  it('rejects payloads with empty `new_wording` at the Zod layer', () => {
    const result = editWordingProposalSchema.safeParse({
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_ID,
      new_wording: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects payloads missing `node_id` at the Zod layer', () => {
    const result = editWordingProposalSchema.safeParse({
      kind: 'edit-wording',
      edit_kind: 'reword',
      new_wording: 'A clearer phrasing.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid `edit_kind` value at the Zod layer', () => {
    const result = editWordingProposalSchema.safeParse({
      kind: 'edit-wording',
      edit_kind: 'not-an-edit-kind',
      node_id: NODE_ID,
      new_wording: 'Some phrasing.',
    });
    expect(result.success).toBe(false);
  });
});
