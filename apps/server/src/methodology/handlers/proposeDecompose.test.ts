// Tests for the real propose-side validator for the `decompose`
// proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/decomposition_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.decomposition_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// decompose-specific rule set:
//
//   1. Parent-node-exists — unknown id rejected with
//      `'target-entity-not-found'`.
//   2. Parent-node-visible — already-superseded parent rejected with
//      `'illegal-state-transition'`.
//   3. No conflicting decompose pending — second proposal against the
//      same parent rejected with `'illegal-state-transition'`.
//   4. Accept path — emits one `proposal` event with payload mirroring
//      the action.
//
// Plus a Zod-layer assertion: the structural shape (2..10 components,
// each `wording` non-empty) is enforced upstream by
// `decomposeProposalSchema` per ADR 0021. The methodology validator
// relies on this layering and is never reached for malformed payloads.
// The two test cases here (`{ components: 1 }` and `{ components: 11 }`)
// call `decomposeProposalSchema.safeParse` directly and confirm
// `success === false` — that's the layering pin.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { decomposeProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const PARENT_NODE_ID = '77777777-7777-4777-8777-777777777777';
const SECOND_NODE_ID = '88888888-8888-4888-8888-888888888888';
const UNKNOWN_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FIRST_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc0';
const PRIOR_DECOMPOSE_COMMIT_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
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

// Seed a session with three participants and one visible node (the
// candidate decompose parent). Returns the projection at sequence 5.
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
      wording: 'Zoos do more good than harm.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-decompose action at the next-expected
// sequence. The two-component payload is the minimum that passes the
// upstream Zod schema (`min(2)`).
function makeDecomposeAction(
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
      kind: 'decompose',
      parent_node_id: overrides.parentNodeId ?? PARENT_NODE_ID,
      components: [
        { wording: 'Zoos do more good (fact).', classification: 'fact' },
        { wording: 'Doing more good is praiseworthy (value).', classification: 'value' },
      ],
    },
  };
}

// ---------------------------------------------------------------
// Rule 1 — parent-node-exists.
// ---------------------------------------------------------------

describe('propose decompose — rule 1: parent-node-exists', () => {
  it('rejects when parent_node_id refers to no node in the projection', () => {
    const p = seedSession();
    const action = makeDecomposeAction(p, { parentNodeId: UNKNOWN_NODE_ID });
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
// The not-visible state is produced by a prior committed decompose
// against the same node — `applyCommittedProposal`'s decompose arm
// flips `parent.visible = false`. We synthesize the events directly
// (proposal → 3x agree votes → commit) so the projection's read-side
// state matches what would happen after a real decompose commit.
//
// Note: `commit_logic`'s rule 4 currently rejects commits of structural
// sub-kinds with `'illegal-state-transition'` — meaning *via the
// methodology engine* a decompose can't currently be committed. The
// projection's `applyEvent` path doesn't re-validate methodology
// rules, however; we exercise the same read-side state by feeding
// the events directly through `applyEvent`. This is the same pattern
// `commit.test.ts` uses for its participant-leaves cases.
// ---------------------------------------------------------------

describe('propose decompose — rule 2: parent-node-visible', () => {
  it('rejects when the parent node has already been decomposed (not visible)', () => {
    const p = seedSession();
    // Land a prior decompose against PARENT_NODE_ID. We hand-craft the
    // event log to reach the read-side state where parent.visible is
    // false; this bypasses commit_logic (which would reject) by
    // operating one layer down on the projection directly.
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: PARENT_NODE_ID,
          components: [
            { wording: 'Prior component one.', classification: 'fact' },
            { wording: 'Prior component two.', classification: 'value' },
          ],
        },
      }),
      id: PRIOR_DECOMPOSE_COMMIT_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_DECOMPOSE_COMMIT_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Sanity: the parent is now invisible.
    expect(p.getNode(PARENT_NODE_ID)?.visible).toBe(false);

    const action = makeDecomposeAction(p);
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
// Rule 3 — no conflicting decompose pending.
// ---------------------------------------------------------------

describe('propose decompose — rule 3: no conflicting decompose pending', () => {
  it('rejects when another decompose proposal against the same parent is pending', () => {
    const p = seedSession();
    // Land a first decompose proposal (it stays pending — no commit).
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: PARENT_NODE_ID,
          components: [
            { wording: 'First proposal component one.', classification: 'fact' },
            { wording: 'First proposal component two.', classification: 'value' },
          ],
        },
      }),
      id: FIRST_DECOMPOSE_PROPOSAL_ID,
    });

    // Second decompose proposal against the same parent → rejected.
    const action = makeDecomposeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(FIRST_DECOMPOSE_PROPOSAL_ID);
      expect(r.detail).toContain(PARENT_NODE_ID);
    }
  });

  // Symmetric mutual-exclusion case introduced by interpretive_split_logic's
  // refactor of `decomposeConflictsWith` → `findConflictingProposalAgainst`:
  // a decompose proposal also rejects when an interpretive-split is already
  // pending against the same parent (both flip parent.visible=false on
  // commit, so they race). The conflict's reported kind is
  // `interpretive-split`. See interpretive_split_logic.md for the
  // symmetry argument.
  it('rejects when an interpretive-split proposal against the same parent is already pending', () => {
    const p = seedSession();
    const PENDING_SPLIT_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: PARENT_NODE_ID,
          readings: [
            { wording: 'Reading one — epistemic.', classification: 'fact' },
            { wording: 'Reading two — metaphysical.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_SPLIT_ID,
    });

    const action = makeDecomposeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_SPLIT_ID);
      expect(r.detail).toContain('interpretive-split');
      expect(r.detail).toContain(PARENT_NODE_ID);
    }
  });

  // Cross-kind mutual-exclusion case introduced by reword_vs_restructure's
  // extension of `CONFLICTING_PARENT_KINDS` to include `'edit-wording'`:
  // a decompose proposal also rejects when an edit-wording (reword or
  // restructure) is already pending against the same parent. The
  // conflict's reported kind is `edit-wording`. See
  // reword_vs_restructure.md for the symmetry argument.
  it('rejects when an edit-wording proposal against the same parent is already pending', () => {
    const p = seedSession();
    const PENDING_EDIT_WORDING_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'reword',
          node_id: PARENT_NODE_ID,
          new_wording: 'A pending wording edit on the same node.',
        },
      }),
      id: PENDING_EDIT_WORDING_ID,
    });

    const action = makeDecomposeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_EDIT_WORDING_ID);
      expect(r.detail).toContain('edit-wording');
      expect(r.detail).toContain(PARENT_NODE_ID);
    }
  });

  it('accepts a decompose proposal against a different parent while one is pending elsewhere', () => {
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
    // First decompose against PARENT_NODE_ID (pending).
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: PARENT_NODE_ID,
          components: [
            { wording: 'First parent component one.', classification: 'fact' },
            { wording: 'First parent component two.', classification: 'value' },
          ],
        },
      }),
      id: FIRST_DECOMPOSE_PROPOSAL_ID,
    });
    // Second decompose against SECOND_NODE_ID — no conflict.
    const action = makeDecomposeAction(p, { parentNodeId: SECOND_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Accept path — well-formed propose decompose.
// ---------------------------------------------------------------

describe('propose decompose — accept path', () => {
  it('accepts a well-formed decompose proposal and emits one proposal event', () => {
    const p = seedSession();
    const action = makeDecomposeAction(p);
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
        expect(inner.kind).toBe('decompose');
        if (inner.kind === 'decompose') {
          expect(inner.parent_node_id).toBe(PARENT_NODE_ID);
          expect(inner.components).toHaveLength(2);
          expect(inner.components[0]!.wording).toBe('Zoos do more good (fact).');
          expect(inner.components[0]!.classification).toBe('fact');
          expect(inner.components[1]!.classification).toBe('value');
        }
      }
    }
  });

  it('accepts a 10-component decompose (upper bound of the Zod constraint)', () => {
    const p = seedSession();
    const components = Array.from({ length: 10 }, (_, i) => ({
      wording: `Component ${i + 1}.`,
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
        kind: 'decompose',
        parent_node_id: PARENT_NODE_ID,
        components,
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces 2..10 components and non-
// empty wording. The methodology validator is never reached for those
// failures because the structural validator (ADR 0021) runs first.
// This block asserts the layering by calling the schema directly.
//
// Per the refinement: documenting the layering and not duplicating the
// check in the methodology validator is the right factoring; if the
// upstream bound ever moves, this test would catch it.
// ---------------------------------------------------------------

describe('propose decompose — structural shape (upstream Zod layering)', () => {
  it('rejects 1-component payloads at the Zod layer', () => {
    const result = decomposeProposalSchema.safeParse({
      kind: 'decompose',
      parent_node_id: PARENT_NODE_ID,
      components: [{ wording: 'Only one component.', classification: 'fact' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects 11-component payloads at the Zod layer', () => {
    const components = Array.from({ length: 11 }, (_, i) => ({
      wording: `Component ${i + 1}.`,
      classification: 'fact' as const,
    }));
    const result = decomposeProposalSchema.safeParse({
      kind: 'decompose',
      parent_node_id: PARENT_NODE_ID,
      components,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-wording component at the Zod layer', () => {
    const result = decomposeProposalSchema.safeParse({
      kind: 'decompose',
      parent_node_id: PARENT_NODE_ID,
      components: [
        { wording: '', classification: 'fact' },
        { wording: 'Second component.', classification: 'value' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
