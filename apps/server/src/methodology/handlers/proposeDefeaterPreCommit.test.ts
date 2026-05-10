// Tests for the **defeater pre-commitment** shape of a
// `propose set-edge-substance` action.
//
// Refinement: tasks/refinements/data-and-methodology/defeater_capture_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.defeater_capture_logic
//
// **Option B in the refinement**: defeater capture is a UI-level macro
// built on existing primitives. The methodology engine has no
// defeater-specific handler — the three event-stream operations of the
// F6 flow (`node-created` for Y, `edge-created` for the rebut Y → X,
// `propose set-edge-substance` against the rebut with `value:
// 'agreed'`) all use existing paths. The third — the "pre-committed
// substance" proposal — is a regular propose-set-edge-substance: same
// sub-kind, same Zod schema, same propose-handler arm.
//
// What this file pins:
//
// 1. The propose-handler's `set-edge-substance` arm accepts a defeater-
//    shaped pre-commitment proposal (`value: 'agreed'` against a rebut
//    edge to a substantively-established target node) and emits exactly
//    one `proposal` event with the payload deep-equal to the action's
//    payload.
//
// 2. The placeholder path is value-independent — a symmetric
//    `value: 'disputed'` against the same edge also passes. This proves
//    the placeholder doesn't accidentally gate on the value (defeater
//    capture is a *flavor* of propose-set-edge-substance, not a
//    distinct sub-kind).
//
// 3. The Zod layer pins: `setEdgeSubstanceProposalSchema` rejects a
//    hypothetical defeater-specific value (`'agreed-pre-commit'`). This
//    proves the sub-kind shape has no defeater-specific extension — the
//    only allowed values are `'agreed'` and `'disputed'`, exactly as
//    the schema declares.
//
// The propose-handler's `set-edge-substance` arm is currently on the
// universal-pass placeholder path (per `propose.ts` lines 105–110 — one
// of the six sub-kinds whose sibling task has not yet landed). This
// task does **not** tighten that arm; the defeater layering note only
// pins the existing behavior. Any future tightening lives in the
// sibling task for set-edge-substance.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { setEdgeSubstanceProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-11111111d4d4';

const HOST_ID = '22222222-2222-4222-8222-22222222d4d4';
const MODERATOR_ID = '33333333-3333-4333-8333-33333333d4d4';
const DEBATER_A_ID = '44444444-4444-4444-8444-44444444d4d4';
const DEBATER_B_ID = '55555555-5555-4555-8555-55555555d4d4';

// X — the defeated target (substantively established, will be the
// `target_node_id` on the rebut edge).
const TARGET_NODE_ID = '66666666-6666-4666-8666-66666666d4d4';
// Y — the defeater node (retraction condition; substance stays
// proposed at capture time per docs/methodology.md line 114).
const DEFEATER_NODE_ID = '77777777-7777-4777-8777-77777777d4d4';
// The rebut edge Y → X.
const REBUT_EDGE_ID = '88888888-8888-4888-8888-88888888d4d4';

const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd4d';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
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

// Seed the canonical defeater-capture pre-state: three participants;
// the target node X (visible); the defeater node Y (visible — already
// created by the moderator's F6 step 3); the rebut edge Y → X (created
// by the same F6 step 3). The next event the moderator would emit is
// the `propose set-edge-substance` against the rebut edge with
// `value: 'agreed'` (F6 step 4). That's the action under test.
function seedDefeaterCapturePreState(): ReturnType<typeof createEmptyProjection> {
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
  // X — the claim that someone might offer a retraction condition for.
  applyEvent(
    projection,
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: TARGET_NODE_ID,
      wording: 'Captive housing imposes a residual welfare cost on these animals.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  // Y — the retraction condition node (substance stays proposed; the
  // node's own substance facet is not pre-committed).
  applyEvent(
    projection,
    makeEvent(6, 'node-created', DEBATER_B_ID, T2, {
      node_id: DEFEATER_NODE_ID,
      wording:
        'Welfare science plus revealed-preference data converge on no remaining unmet interest in well-managed captives.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  // The rebut edge Y → X. Created at capture time per F6 step 3. The
  // edge substance facet starts `proposed` and is what the pending
  // propose-set-edge-substance will move to `agreed`.
  applyEvent(
    projection,
    makeEvent(7, 'edge-created', DEBATER_B_ID, T2, {
      edge_id: REBUT_EDGE_ID,
      role: 'rebuts',
      source_node_id: DEFEATER_NODE_ID,
      target_node_id: TARGET_NODE_ID,
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-set-edge-substance action at the next-
// expected sequence. The default shape is the defeater pre-commitment:
// `value: 'agreed'` against the rebut edge, requester is the
// participant declaring the retraction condition (debater B).
function makeSetEdgeSubstanceAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    edgeId: string;
    value: 'agreed' | 'disputed';
    requester: string;
    eventId: string;
  }> = {},
): ProposeAction {
  const requester = overrides.requester ?? DEBATER_B_ID;
  return {
    kind: 'propose',
    requester,
    sessionId: SESSION_ID,
    eventId: overrides.eventId ?? NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposal: {
      kind: 'set-edge-substance',
      edge_id: overrides.edgeId ?? REBUT_EDGE_ID,
      value: overrides.value ?? 'agreed',
    },
  };
}

// ---------------------------------------------------------------
// Defeater pre-commitment accept path — the canonical F6 step-4 shape.
// ---------------------------------------------------------------

describe('propose set-edge-substance — defeater pre-commitment (value: agreed)', () => {
  it('accepts a propose-set-edge-substance with value=agreed against a rebut edge', () => {
    const p = seedDefeaterCapturePreState();
    // Sanity: the rebut edge exists with the right role and source.
    const edge = p.getEdge(REBUT_EDGE_ID);
    expect(edge).not.toBeUndefined();
    expect(edge?.role).toBe('rebuts');
    expect(edge?.sourceNodeId).toBe(DEFEATER_NODE_ID);
    expect(edge?.targetNodeId).toBe(TARGET_NODE_ID);

    const action = makeSetEdgeSubstanceAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('proposal');
      expect(ev.id).toBe(NEW_EVENT_ID);
      expect(ev.sessionId).toBe(SESSION_ID);
      expect(ev.sequence).toBe(action.sequence);
      expect(ev.actor).toBe(DEBATER_B_ID);
      expect(ev.createdAt).toBe(T9);
      if (ev.kind === 'proposal') {
        const inner = ev.payload.proposal;
        expect(inner.kind).toBe('set-edge-substance');
        if (inner.kind === 'set-edge-substance') {
          expect(inner.edge_id).toBe(REBUT_EDGE_ID);
          expect(inner.value).toBe('agreed');
        }
      }
    }
  });

  // Symmetric pin: the placeholder path does not gate on the value.
  // Defeater capture is a `value: 'agreed'` flavor of the same
  // sub-kind; a `value: 'disputed'` proposal is structurally identical
  // and uses the same path. (When the sibling task for
  // set-edge-substance lands, it may tighten gating in ways that
  // depend on value — but it will not introduce defeater-specific
  // shape.)
  it('accepts a propose-set-edge-substance with value=disputed against the same rebut edge (placeholder path is value-independent)', () => {
    const p = seedDefeaterCapturePreState();
    const action = makeSetEdgeSubstanceAction(p, { value: 'disputed' });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      if (ev.kind === 'proposal') {
        const inner = ev.payload.proposal;
        if (inner.kind === 'set-edge-substance') {
          expect(inner.value).toBe('disputed');
        }
      }
    }
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema for set-edge-substance has no
// defeater-specific value. The only allowed values are `'agreed'` and
// `'disputed'`. A hypothetical defeater-specific marker
// (`'agreed-pre-commit'`) is rejected by the schema — proving the
// sub-kind shape has no defeater extension and the "pre-committed"
// language in the docs is descriptive, not a schema-level distinction.
// ---------------------------------------------------------------

describe('propose set-edge-substance — structural shape (upstream Zod layering)', () => {
  it('rejects a hypothetical defeater-specific value at the Zod layer', () => {
    const result = setEdgeSubstanceProposalSchema.safeParse({
      kind: 'set-edge-substance',
      edge_id: REBUT_EDGE_ID,
      value: 'agreed-pre-commit',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing `value` at the Zod layer', () => {
    const result = setEdgeSubstanceProposalSchema.safeParse({
      kind: 'set-edge-substance',
      edge_id: REBUT_EDGE_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID `edge_id` at the Zod layer', () => {
    const result = setEdgeSubstanceProposalSchema.safeParse({
      kind: 'set-edge-substance',
      edge_id: 'not-a-uuid',
      value: 'agreed',
    });
    expect(result.success).toBe(false);
  });
});
