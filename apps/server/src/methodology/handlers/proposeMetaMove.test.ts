// Tests for the real propose-side validator for the `meta-move`
// proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/meta_move_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.meta_move_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// meta-move-specific rule set:
//
//   1. Target-entity-exists — unknown id rejected with
//      `'target-entity-not-found'` (dispatched on `target_kind`).
//   2. Target-entity-visible — superseded node / broken edge rejected
//      with `'illegal-state-transition'`.
//   3. Accept path — emits one `proposal` event with payload mirroring
//      the action; exercised across `meta_kind ∈ {reframe, scope-
//      change, stance}` × `target_kind ∈ {node, edge}`.
//
// Plus a Zod-layer assertion: the structural shape — `meta_kind` enum,
// `content` non-empty, `target_kind` enum, `target_id` UUID — is
// enforced upstream by `metaMoveProposalSchema` per ADR 0021 / R28.
// The methodology validator relies on this layering and is never
// reached for malformed payloads. Three test cases (missing
// `target_id`, missing `target_kind`, invalid `meta_kind`) call
// `metaMoveProposalSchema.safeParse` directly and confirm
// `success === false` — that's the layering pin.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { metaMoveProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111dd';

const HOST_ID = '22222222-2222-4222-8222-2222222222dd';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333333dd';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444444dd';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555555dd';

const NODE_A_ID = '66666666-6666-4666-8666-6666666666dd';
const NODE_B_ID = '77777777-7777-4777-8777-7777777777dd';
const EDGE_ID = '88888888-8888-4888-8888-8888888888dd';

const UNKNOWN_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaadd';
const UNKNOWN_EDGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbdd';

const PRIOR_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd1';
const PRIOR_BREAK_EDGE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd2';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

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

// Seed a session with three participants, two visible nodes (the
// meta-move target candidates), and one visible edge between them.
// Returns the projection at the end of the seed.
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
      node_id: NODE_A_ID,
      wording: 'A claim about the operational form.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(6, 'node-created', DEBATER_B_ID, T2, {
      node_id: NODE_B_ID,
      wording: 'A backing fact for the claim.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(7, 'edge-created', DEBATER_B_ID, T2, {
      edge_id: EDGE_ID,
      role: 'supports',
      source_node_id: NODE_B_ID,
      target_node_id: NODE_A_ID,
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-meta-move action at the next-expected
// sequence. Defaults: debater A proposes a `reframe` on NODE_A.
function makeMetaMoveAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    metaKind: 'reframe' | 'scope-change' | 'stance';
    content: string;
    targetKind: 'node' | 'edge';
    targetId: string;
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
      kind: 'meta-move',
      meta_kind: overrides.metaKind ?? 'reframe',
      content:
        overrides.content ?? 'The real question is the operational form, not the surface phrasing.',
      target_kind: overrides.targetKind ?? 'node',
      target_id: overrides.targetId ?? NODE_A_ID,
    },
  };
}

// ---------------------------------------------------------------
// Rule 1 — target-entity-exists (per target_kind dispatch).
// ---------------------------------------------------------------

describe('propose meta-move — rule 1: target-entity-exists', () => {
  it('rejects when target_kind=node and target_id refers to no node in the projection', () => {
    const p = seedSession();
    const action = makeMetaMoveAction(p, {
      targetKind: 'node',
      targetId: UNKNOWN_NODE_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
      expect(r.detail).toContain("'node'");
    }
  });

  it('rejects when target_kind=edge and target_id refers to no edge in the projection', () => {
    const p = seedSession();
    const action = makeMetaMoveAction(p, {
      targetKind: 'edge',
      targetId: UNKNOWN_EDGE_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_EDGE_ID);
      expect(r.detail).toContain("'edge'");
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — target-entity-visible (node case).
//
// The not-visible state for a node is produced by a prior committed
// decompose against it — `applyCommittedProposal`'s decompose arm
// flips `node.visible = false`. We synthesize the events directly
// (proposal → commit) so the projection's read-side state matches what
// would happen after a real decompose commit (same pattern
// proposeAxiomMark.test.ts uses).
// ---------------------------------------------------------------

describe('propose meta-move — rule 2 (node): target-entity-visible', () => {
  it('rejects when the target node has been superseded (not visible)', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_A_ID,
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
    expect(p.getNode(NODE_A_ID)?.visible).toBe(false);

    const action = makeMetaMoveAction(p, {
      targetKind: 'node',
      targetId: NODE_A_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(NODE_A_ID);
      expect(r.detail).toContain('not currently visible');
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — target-entity-visible (edge case).
//
// The not-visible state for an edge is produced by a prior committed
// break-edge against it — `applyCommittedProposal`'s break-edge arm
// calls `projection.setEdgeVisible(edge_id, false)`. We synthesize the
// events directly (proposal → commit).
// ---------------------------------------------------------------

describe('propose meta-move — rule 2 (edge): target-entity-visible', () => {
  it('rejects when the target edge has been broken (not visible)', () => {
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

    const action = makeMetaMoveAction(p, {
      targetKind: 'edge',
      targetId: EDGE_ID,
    });
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
// Accept path — well-formed propose meta-move across the meta_kind ×
// target_kind matrix.
// ---------------------------------------------------------------

describe('propose meta-move — accept path (matrix over meta_kind × target_kind)', () => {
  for (const metaKind of ['reframe', 'scope-change', 'stance'] as const) {
    it(`accepts a ${metaKind} meta-move against a visible node`, () => {
      const p = seedSession();
      const action = makeMetaMoveAction(p, {
        metaKind,
        targetKind: 'node',
        targetId: NODE_A_ID,
        content: `${metaKind} content on a node`,
      });
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
          expect(inner.kind).toBe('meta-move');
          if (inner.kind === 'meta-move') {
            expect(inner.meta_kind).toBe(metaKind);
            expect(inner.target_kind).toBe('node');
            expect(inner.target_id).toBe(NODE_A_ID);
            expect(inner.content).toBe(`${metaKind} content on a node`);
          }
        }
      }
    });

    it(`accepts a ${metaKind} meta-move against a visible edge`, () => {
      const p = seedSession();
      const action = makeMetaMoveAction(p, {
        metaKind,
        targetKind: 'edge',
        targetId: EDGE_ID,
        content: `${metaKind} content on an edge`,
      });
      const r = validateAction(p, action);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.events).toHaveLength(1);
        const ev = r.events[0]!;
        if (ev.kind === 'proposal') {
          const inner = ev.payload.proposal;
          if (inner.kind === 'meta-move') {
            expect(inner.meta_kind).toBe(metaKind);
            expect(inner.target_kind).toBe('edge');
            expect(inner.target_id).toBe(EDGE_ID);
          }
        }
      }
    });
  }
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces the structural shape
// (`meta_kind` enum, `content` non-empty, `target_kind` enum,
// `target_id` UUID). The methodology validator is never reached for
// those failures because the structural validator (ADR 0021) runs
// first. This block asserts the layering by calling the schema
// directly.
// ---------------------------------------------------------------

describe('propose meta-move — structural shape (upstream Zod layering)', () => {
  it('rejects payloads missing `target_id` at the Zod layer', () => {
    const result = metaMoveProposalSchema.safeParse({
      kind: 'meta-move',
      meta_kind: 'reframe',
      content: 'some reframe text',
      target_kind: 'node',
    });
    expect(result.success).toBe(false);
  });

  it('rejects payloads missing `target_kind` at the Zod layer', () => {
    const result = metaMoveProposalSchema.safeParse({
      kind: 'meta-move',
      meta_kind: 'reframe',
      content: 'some reframe text',
      target_id: NODE_A_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid `meta_kind` enum value at the Zod layer', () => {
    const result = metaMoveProposalSchema.safeParse({
      kind: 'meta-move',
      meta_kind: 'not-a-meta-kind',
      content: 'text',
      target_kind: 'node',
      target_id: NODE_A_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty `content` at the Zod layer', () => {
    const result = metaMoveProposalSchema.safeParse({
      kind: 'meta-move',
      meta_kind: 'reframe',
      content: '',
      target_kind: 'node',
      target_id: NODE_A_ID,
    });
    expect(result.success).toBe(false);
  });
});
