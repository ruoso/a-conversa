// Tests for the real propose-side validator for the `amend-node`
// proposal sub-kind.
//
// Refinement: tasks/refinements/data-and-methodology/amend_node_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.amend_node_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// amend-node-specific rule set:
//
//   1. Node-exists — unknown id rejected with
//      `'target-entity-not-found'`.
//   2. Node-visible — already-superseded node rejected with
//      `'illegal-state-transition'`.
//   3. No conflicting decompose / interpretive-split / edit-wording /
//      amend-node pending — second wording-touching proposal rejected
//      with `'illegal-state-transition'`. The conflict-walker shares
//      the `CONFLICTING_PARENT_KINDS` set with the sibling arms; this
//      task extends the set to include `'amend-node'`.
//   4. Node-is-party-to-agreed-contradicts — amend-node is the
//      contradiction-resolution path per docs/methodology.md line 219;
//      a propose against a node with no agreed `contradicts` edge is
//      rejected with `'methodology-not-exhausted'`.
//   5. Accept path — emits one `proposal` event with payload mirroring
//      the action.
//
// Plus a Zod-layer assertion: the structural shape — `kind:
// 'amend-node'`, `node_id: UUID`, `new_content` non-empty — is
// enforced upstream by `amendNodeProposalSchema` per ADR 0021. The
// methodology validator is never reached for those failures.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';
import { amendNodeProposalSchema } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111ad';

const HOST_ID = '22222222-2222-4222-8222-2222222222ad';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333333ad';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444444ad';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555555ad';

// The candidate amend-node target — node A — and a second node node B
// that we'll wire to A via a contradicts edge.
const NODE_A_ID = '66666666-6666-4666-8666-6666666666ad';
const NODE_B_ID = '77777777-7777-4777-8777-7777777777ad';
const NODE_C_ID = '88888888-8888-4888-8888-8888888888ad';
const CONTRADICTS_EDGE_ID = '99999999-9999-4999-8999-9999999999ad';
const SUPPORTS_EDGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbad';
const UNKNOWN_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';

const PRIOR_RESTRUCTURE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd1';
const PRIOR_FRESH_NODE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd2';
const PENDING_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd3';
const PENDING_SPLIT_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd4';
const PENDING_EDIT_WORDING_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd5';
const PENDING_AMEND_NODE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd6';
const SUBSTANCE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccd7';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddad';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';
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

// Seed a session with three participants and TWO visible nodes (A and
// B), with a `contradicts` edge from A → B that has been substance-
// committed to `agreed`. This is the strict-rule-4 prerequisite — A
// is currently a party to an agreed contradicts edge.
function seedSessionWithAgreedContradicts(): ReturnType<typeof createEmptyProjection> {
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
      wording: 'Anna says zoos do more good than harm.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(6, 'node-created', DEBATER_B_ID, T2, {
      node_id: NODE_B_ID,
      wording: 'Ben says zoos do more harm than good.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(7, 'edge-created', DEBATER_A_ID, T3, {
      edge_id: CONTRADICTS_EDGE_ID,
      role: 'contradicts',
      source_node_id: NODE_A_ID,
      target_node_id: NODE_B_ID,
      created_by: DEBATER_A_ID,
      created_at: T3,
    }),
  );
  // Land a `set-edge-substance` proposal + commit on the contradicts
  // edge to set its substance facet to `agreed`. After this the
  // strict-rule-4 prerequisite is satisfied for both NODE_A_ID and
  // NODE_B_ID.
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'set-edge-substance',
        edge_id: CONTRADICTS_EDGE_ID,
        value: 'agreed',
      },
    }),
    id: SUBSTANCE_PROPOSAL_ID,
  });
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T4, {
      proposal_id: SUBSTANCE_PROPOSAL_ID,
      moderator: MODERATOR_ID,
      committed_at: T4,
    }),
  );
  return projection;
}

// Seed a session with three participants and ONE visible node (NODE_A)
// — but NO contradicts edge against it. Used to exercise rule 4.
function seedSessionWithoutContradiction(): ReturnType<typeof createEmptyProjection> {
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
      wording: 'A statement with no contradiction yet.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

// Build a well-formed propose-amend-node action at the next-expected
// sequence.
function makeAmendNodeAction(
  projection: ReturnType<typeof createEmptyProjection>,
  overrides: Partial<{
    nodeId: string;
    newContent: string;
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
      kind: 'amend-node',
      node_id: overrides.nodeId ?? NODE_A_ID,
      new_content: overrides.newContent ?? 'Anna refines the claim to remove the conflict.',
    },
  };
}

// ---------------------------------------------------------------
// Rule 1 — node-exists.
// ---------------------------------------------------------------

describe('propose amend-node — rule 1: node-exists', () => {
  it('rejects when node_id refers to no node in the projection', () => {
    const p = seedSessionWithAgreedContradicts();
    const action = makeAmendNodeAction(p, { nodeId: UNKNOWN_NODE_ID });
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
// The not-visible state is produced by a prior committed restructure
// against the same node. We synthesize the events directly (proposal →
// commit) so the projection's read-side state matches what would
// happen after a real restructure commit.
// ---------------------------------------------------------------

describe('propose amend-node — rule 2: node-visible', () => {
  it('rejects when the node has been superseded (not visible)', () => {
    const p = seedSessionWithAgreedContradicts();
    // Land a prior restructure against NODE_A_ID and its paired
    // node-created for the replacement; then commit the restructure.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T3, {
        node_id: PRIOR_FRESH_NODE_ID,
        wording: 'A meaningfully different replacement.',
        created_by: DEBATER_A_ID,
        created_at: T3,
      }),
    );
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: NODE_A_ID,
          new_wording: 'A meaningfully different replacement.',
          new_node_id: PRIOR_FRESH_NODE_ID,
        },
      }),
      id: PRIOR_RESTRUCTURE_PROPOSAL_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        proposal_id: PRIOR_RESTRUCTURE_PROPOSAL_ID,
        moderator: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Sanity: the original node is now invisible.
    expect(p.getNode(NODE_A_ID)?.visible).toBe(false);

    const action = makeAmendNodeAction(p);
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
// Rule 3 — no conflicting decompose / interpretive-split /
// edit-wording / amend-node pending.
//
// Symmetric across all four sub-kinds; we pin one representative case
// per (decompose, interpretive-split, edit-wording, amend-node).
// ---------------------------------------------------------------

describe('propose amend-node — rule 3: no conflicting pending proposal', () => {
  it('rejects when a decompose proposal against the same node is pending', () => {
    const p = seedSessionWithAgreedContradicts();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_A_ID,
          components: [
            { wording: 'A decompose component one.', classification: 'fact' },
            { wording: 'A decompose component two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_DECOMPOSE_PROPOSAL_ID,
    });
    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_DECOMPOSE_PROPOSAL_ID);
      expect(r.detail).toContain('decompose');
      expect(r.detail).toContain(NODE_A_ID);
    }
  });

  it('rejects when an interpretive-split proposal against the same node is pending', () => {
    const p = seedSessionWithAgreedContradicts();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: NODE_A_ID,
          readings: [
            { wording: 'Reading one.', classification: 'fact' },
            { wording: 'Reading two.', classification: 'value' },
          ],
        },
      }),
      id: PENDING_SPLIT_PROPOSAL_ID,
    });
    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_SPLIT_PROPOSAL_ID);
      expect(r.detail).toContain('interpretive-split');
      expect(r.detail).toContain(NODE_A_ID);
    }
  });

  it('rejects when an edit-wording proposal against the same node is pending', () => {
    const p = seedSessionWithAgreedContradicts();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'reword',
          node_id: NODE_A_ID,
          new_wording: 'A pending wording edit on the same node.',
        },
      }),
      id: PENDING_EDIT_WORDING_PROPOSAL_ID,
    });
    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_EDIT_WORDING_PROPOSAL_ID);
      expect(r.detail).toContain('edit-wording');
      expect(r.detail).toContain(NODE_A_ID);
    }
  });

  it('rejects when another amend-node proposal against the same node is pending', () => {
    const p = seedSessionWithAgreedContradicts();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'amend-node',
          node_id: NODE_A_ID,
          new_content: 'A first amend attempt on the same node.',
        },
      }),
      id: PENDING_AMEND_NODE_PROPOSAL_ID,
    });
    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(PENDING_AMEND_NODE_PROPOSAL_ID);
      expect(r.detail).toContain('amend-node');
      expect(r.detail).toContain(NODE_A_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 4 — node-is-party-to-agreed-contradicts.
//
// Strict reading per the refinement (docs/methodology.md line 219):
// amend-node is the contradiction-resolution path. A propose against
// a node that isn't currently a party to an agreed contradicts edge
// is rejected — the participant should propose `edit-wording(reword)`
// instead.
// ---------------------------------------------------------------

describe('propose amend-node — rule 4: node-is-party-to-agreed-contradicts', () => {
  it('rejects when the node has no contradicts edge against it', () => {
    const p = seedSessionWithoutContradiction();
    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('methodology-not-exhausted');
      expect(r.detail).toContain(NODE_A_ID);
      expect(r.detail).toContain('contradicts');
    }
  });

  it('rejects when a contradicts edge exists but its substance is still proposed (not agreed)', () => {
    const p = seedSessionWithoutContradiction();
    // Add NODE_B and a contradicts edge from A to B — but skip the
    // substance-commit step, so the edge's substance facet stays
    // `proposed` rather than `agreed`.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_B_ID, T2, {
        node_id: NODE_B_ID,
        wording: 'A counter-claim that contradicts NODE_A.',
        created_by: DEBATER_B_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T3, {
        edge_id: CONTRADICTS_EDGE_ID,
        role: 'contradicts',
        source_node_id: NODE_A_ID,
        target_node_id: NODE_B_ID,
        created_by: DEBATER_A_ID,
        created_at: T3,
      }),
    );
    // Sanity: the contradicts edge exists and is visible, but its
    // substance facet has not been committed to `agreed`.
    const edge = p.getEdge(CONTRADICTS_EDGE_ID);
    expect(edge?.visible).toBe(true);
    expect(edge?.substanceFacet.status).not.toBe('agreed');

    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('methodology-not-exhausted');
      expect(r.detail).toContain(NODE_A_ID);
    }
  });

  it('rejects when only a non-contradicts edge (e.g. supports) connects to the node', () => {
    const p = seedSessionWithoutContradiction();
    // Add NODE_C and a `supports` edge — not a `contradicts`. The
    // walker must skip non-contradicts roles.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_B_ID, T2, {
        node_id: NODE_C_ID,
        wording: 'Backing data for NODE_A.',
        created_by: DEBATER_B_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_B_ID, T3, {
        edge_id: SUPPORTS_EDGE_ID,
        role: 'supports',
        source_node_id: NODE_C_ID,
        target_node_id: NODE_A_ID,
        created_by: DEBATER_B_ID,
        created_at: T3,
      }),
    );
    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('methodology-not-exhausted');
    }
  });

  it('accepts when the node is the TARGET (not source) of an agreed contradicts edge', () => {
    // The contradicts walker must check both sourceNodeId and
    // targetNodeId. Build a session where the contradicts edge points
    // FROM NODE_B TO NODE_A and substance-commit it; the propose
    // amend-node against NODE_A should accept.
    const p = seedSessionWithoutContradiction();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_B_ID, T2, {
        node_id: NODE_B_ID,
        wording: 'A counter-claim contradicting NODE_A.',
        created_by: DEBATER_B_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_B_ID, T3, {
        edge_id: CONTRADICTS_EDGE_ID,
        role: 'contradicts',
        source_node_id: NODE_B_ID,
        target_node_id: NODE_A_ID,
        created_by: DEBATER_B_ID,
        created_at: T3,
      }),
    );
    // Substance-commit the contradicts edge.
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'set-edge-substance',
          edge_id: CONTRADICTS_EDGE_ID,
          value: 'agreed',
        },
      }),
      id: SUBSTANCE_PROPOSAL_ID,
    });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T4, {
        proposal_id: SUBSTANCE_PROPOSAL_ID,
        moderator: MODERATOR_ID,
        committed_at: T4,
      }),
    );

    const action = makeAmendNodeAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// Accept path — well-formed propose amend-node.
// ---------------------------------------------------------------

describe('propose amend-node — accept path', () => {
  it('accepts a well-formed amend-node proposal and emits one proposal event', () => {
    const p = seedSessionWithAgreedContradicts();
    const action = makeAmendNodeAction(p);
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
        expect(inner.kind).toBe('amend-node');
        if (inner.kind === 'amend-node') {
          expect(inner.node_id).toBe(NODE_A_ID);
          expect(inner.new_content).toBe('Anna refines the claim to remove the conflict.');
        }
      }
    }
  });
});

// ---------------------------------------------------------------
// Layering pin — the Zod schema enforces the structural shape
// (`node_id: UUID`, `new_content` non-empty). The methodology
// validator is never reached for those failures because the structural
// validator (ADR 0021) runs first.
// ---------------------------------------------------------------

describe('propose amend-node — structural shape (upstream Zod layering)', () => {
  it('rejects payloads missing `node_id` at the Zod layer', () => {
    const result = amendNodeProposalSchema.safeParse({
      kind: 'amend-node',
      new_content: 'Some replacement content.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects payloads with empty `new_content` at the Zod layer', () => {
    const result = amendNodeProposalSchema.safeParse({
      kind: 'amend-node',
      node_id: NODE_A_ID,
      new_content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID `node_id` at the Zod layer', () => {
    const result = amendNodeProposalSchema.safeParse({
      kind: 'amend-node',
      node_id: 'not-a-uuid',
      new_content: 'Some replacement content.',
    });
    expect(result.success).toBe(false);
  });
});
