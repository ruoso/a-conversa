// Tests for the real propose-side validator for the
// `interpretive-split` proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/interpretive_split_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.interpretive_split_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// interpretive-split-specific rule set, mirroring
// `proposeDecompose.test.ts`:
//
//   1. Parent-node-exists — unknown id rejected with
//      `'target-entity-not-found'`.
//   2. Parent-node-visible — already-superseded parent rejected with
//      `'illegal-state-transition'`.
//   3. No conflicting decompose OR interpretive-split pending — second
//      proposal against the same parent rejected with
//      `'illegal-state-transition'` (mutual exclusion symmetric across
//      the two structural sub-kinds — both flip parent.visible=false on
//      commit).
//   4. Accept path — emits one `proposal` event with payload mirroring
//      the action.
//
// Plus a Zod-layer assertion: the structural shape (2..10 readings,
// each `wording` non-empty) is enforced upstream by
// `interpretiveSplitProposalSchema` per ADR 0021. The methodology
// validator relies on this layering and is never reached for malformed
// payloads. The three test cases here (`{ readings: 1 }`,
// `{ readings: 11 }`, empty-wording) call
// `interpretiveSplitProposalSchema.safeParse` directly and confirm
// `success === false` — that's the layering pin.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { interpretiveSplitProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111aaa';

const HOST_ID = '22222222-2222-4222-8222-222222222aaa';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333aaa';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444aaa';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555aaa';

const PARENT_NODE_ID = '77777777-7777-4777-8777-777777777aaa';
const SECOND_NODE_ID = '88888888-8888-4888-8888-888888888aaa';
const UNKNOWN_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaabbb';

const FIRST_SPLIT_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccaa0';
const PENDING_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccaa1';
const PRIOR_SPLIT_COMMIT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccaa2';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddaa';

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
// candidate split parent). Returns the projection at sequence 5.
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
      node_id: PARENT_NODE_ID,
      wording: 'Capability-frustration reduces to welfare deficits.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-interpretive-split action at the next-
// expected sequence. The two-reading payload is the minimum that
// passes the upstream Zod schema (`min(2)`).
function makeSplitAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{ parentNodeId: string; requester: string; eventId: string }> = {},
): ProposeAction {
  return {
    kind: 'propose',
    requester: overrides.requester ?? DEBATER_A_ID,
    sessionId: SESSION_ID,
    eventId: overrides.eventId ?? NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: overrides.requester ?? DEBATER_A_ID,
    createdAt: T9,
    proposal: {
      kind: 'interpretive-split',
      parent_node_id: overrides.parentNodeId ?? PARENT_NODE_ID,
      readings: [
        {
          wording: 'Welfare deficits are our evidence for constitutive capacities (epistemic).',
          classification: 'fact',
        },
        {
          wording: 'Capability-frustration just is welfare loss, ontologically (metaphysical).',
          classification: 'definitional',
        },
      ],
    },
  };
}

// ---------------------------------------------------------------
// Rule 1 — parent-node-exists.
// ---------------------------------------------------------------

describe('propose interpretive-split — rule 1: parent-node-exists', () => {
  it('rejects when parent_node_id refers to no node in the projection', () => {
    const p = seedSession();
    const action = makeSplitAction(p, { parentNodeId: UNKNOWN_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — parent-node-visible.
//
// The not-visible state is produced by a prior committed
// interpretive-split (or decompose) against the same node —
// `applyCommittedProposal`'s arms flip `parent.visible = false`. We
// synthesize the events directly (proposal → commit) so the
// projection's read-side state matches what would happen after a real
// interpretive-split commit.
//
// Note: `commit_logic`'s rule 4 currently rejects commits of
// structural sub-kinds; the projection's `applyEvent` path doesn't
// re-validate methodology rules, so feeding events directly through
// `applyEvent` is the same pattern proposeDecompose.test.ts uses.
// ---------------------------------------------------------------

describe('propose interpretive-split — rule 2: parent-node-visible', () => {
  it('rejects when the parent node has already been interpretively-split (not visible)', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: PARENT_NODE_ID,
          readings: [
            { wording: 'Prior reading one.', classification: 'fact' },
            { wording: 'Prior reading two.', classification: 'value' },
          ],
        },
      }),
      id: PRIOR_SPLIT_COMMIT_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_SPLIT_COMMIT_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    expect(p.getNode(PARENT_NODE_ID)?.visible).toBe(false);

    const action = makeSplitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PARENT_NODE_ID);
      expect(r.detail).toContain('not currently visible');
    }
  });
});

// ---------------------------------------------------------------
// Rule 3 — no conflicting decompose OR interpretive-split pending.
//
// The mutual exclusion is symmetric: a new interpretive-split is
// blocked by either a pending decompose OR a pending interpretive-
// split against the same parent. Both cases live here.
// ---------------------------------------------------------------

describe('propose interpretive-split — rule 3: no conflicting pending proposal', () => {
  it('rejects when another interpretive-split proposal against the same parent is pending', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: PARENT_NODE_ID,
          readings: [
            { wording: 'First-proposal reading one.', classification: 'fact' },
            { wording: 'First-proposal reading two.', classification: 'value' },
          ],
        },
      }),
      id: FIRST_SPLIT_PROPOSAL_ID,
    });

    const action = makeSplitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(FIRST_SPLIT_PROPOSAL_ID);
      expect(r.detail).toContain('interpretive-split');
      expect(r.detail).toContain(PARENT_NODE_ID);
    }
  });

  it('rejects when a decompose proposal against the same parent is already pending (cross-kind conflict)', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: PARENT_NODE_ID,
          components: [
            { wording: 'A decompose component one.', classification: 'fact' },
            { wording: 'A decompose component two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_DECOMPOSE_PROPOSAL_ID,
    });

    const action = makeSplitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_DECOMPOSE_PROPOSAL_ID);
      expect(r.detail).toContain('decompose');
      expect(r.detail).toContain(PARENT_NODE_ID);
    }
  });

  // Cross-kind mutual-exclusion case introduced by reword_vs_restructure's
  // extension of `CONFLICTING_PARENT_KINDS` to include `'edit-wording'`:
  // an interpretive-split proposal also rejects when an edit-wording
  // (reword or restructure) is already pending against the same parent.
  // The conflict's reported kind is `edit-wording`. See
  // reword_vs_restructure.md for the symmetry argument.
  it('rejects when an edit-wording proposal against the same parent is already pending (cross-kind conflict)', () => {
    const p = seedSession();
    const PENDING_EDIT_WORDING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccaa3';
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: PARENT_NODE_ID,
          new_wording: 'A pending wording restructure on the same node.',
          new_node_id: '99999999-9999-4999-8999-999999999aa9',
        },
      }),
      id: PENDING_EDIT_WORDING_ID,
    });

    const action = makeSplitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_EDIT_WORDING_ID);
      expect(r.detail).toContain('edit-wording');
      expect(r.detail).toContain(PARENT_NODE_ID);
    }
  });

  it('accepts an interpretive-split against a different parent while one is pending elsewhere', () => {
    const p = seedSession();
    // Add a second visible node.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T2, {
        node_id: SECOND_NODE_ID,
        wording: 'A second statement.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    // First interpretive-split against PARENT_NODE_ID (pending).
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: PARENT_NODE_ID,
          readings: [
            { wording: 'First parent reading one.', classification: 'fact' },
            { wording: 'First parent reading two.', classification: 'value' },
          ],
        },
      }),
      id: FIRST_SPLIT_PROPOSAL_ID,
    });
    // Second interpretive-split against SECOND_NODE_ID — no conflict.
    const action = makeSplitAction(p, { parentNodeId: SECOND_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Accept path — well-formed propose interpretive-split.
// ---------------------------------------------------------------

describe('propose interpretive-split — accept path', () => {
  it('accepts a well-formed interpretive-split proposal and emits one proposal event', () => {
    const p = seedSession();
    const action = makeSplitAction(p);
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
        expect(inner.kind).toBe('interpretive-split');
        if (inner.kind === 'interpretive-split') {
          expect(inner.parent_node_id).toBe(PARENT_NODE_ID);
          expect(inner.readings).toHaveLength(2);
          expect(inner.readings[0]!.classification).toBe('fact');
          expect(inner.readings[1]!.classification).toBe('definitional');
        }
      }
    }
  });

  it('accepts a 10-reading interpretive-split (upper bound of the Zod constraint)', () => {
    const p = seedSession();
    const readings = Array.from({ length: 10 }, (_, i) => ({
      wording: `Reading ${i + 1}.`,
      classification: 'fact' as const,
    }));
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: PARENT_NODE_ID,
        readings,
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces 2..10 readings and non-empty
// wording. The methodology validator is never reached for those
// failures because the structural validator (ADR 0021) runs first.
// This block asserts the layering by calling the schema directly.
// ---------------------------------------------------------------

describe('propose interpretive-split — structural shape (upstream Zod layering)', () => {
  it('rejects 1-reading payloads at the Zod layer', () => {
    const result = interpretiveSplitProposalSchema.safeParse({
      kind: 'interpretive-split',
      parent_node_id: PARENT_NODE_ID,
      readings: [{ wording: 'Only one reading.', classification: 'fact' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects 11-reading payloads at the Zod layer', () => {
    const readings = Array.from({ length: 11 }, (_, i) => ({
      wording: `Reading ${i + 1}.`,
      classification: 'fact' as const,
    }));
    const result = interpretiveSplitProposalSchema.safeParse({
      kind: 'interpretive-split',
      parent_node_id: PARENT_NODE_ID,
      readings,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-wording reading at the Zod layer', () => {
    const result = interpretiveSplitProposalSchema.safeParse({
      kind: 'interpretive-split',
      parent_node_id: PARENT_NODE_ID,
      readings: [
        { wording: '', classification: 'fact' },
        { wording: 'Second reading.', classification: 'value' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
