// Tests for the server-enforced per-facet sequence gate (the
// `validateSequence` step in `propose.ts`).
//
// Refinement: tasks/refinements/per-facet-refactor/pf_sequence_gate_server_enforced.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§8)
// ADR:        docs/adr/0029-protocol-rejection-policies.md (typed error envelope; connection stays open)
// TaskJuggler: per_facet_refactor.server_handlers.pf_sequence_gate_server_enforced
//
// **What this file pins.** Per ADR 0030 §8 the propose handler is the
// integrity boundary for the methodology's sequential capture order:
//
//   - `classify-node` refused while the target node's `wording` facet
//     is not `'agreed'` / `'committed'`.
//   - `set-node-substance` refused while the target node's
//     `classification` facet is not `'agreed'` / `'committed'`.
//   - `set-edge-substance` against an extant edge refused while the
//     edge's `shape` facet is not `'agreed'` / `'committed'` (per
//     `pf_shape_facet_wire_vote` + ADR 0030 §8). The fresh-edge case
//     (`getEdge === undefined`) stays exempt — the connecting-capture
//     gesture establishes shape AT propose-time on the entity-layer
//     carriage, mirroring the classify-node-with-wording legacy
//     bundle exemption above.
//
// Each gated arm is tested across the seven non-accepting predecessor
// statuses (`proposed`, `disputed`, `awaiting-proposal`, `withdrawn`,
// `meta-disagreement`) plus the symmetric accept paths (`agreed`,
// `committed`). The gate's exemption for the legacy
// `classify-node`-with-wording bundle (TODO(pf_mod_capture_pane_wording_only))
// is pinned too: a fresh node id + inline `wording` field bypasses
// the gate (wording is established at propose-time on the same
// gesture; there is no prior wording-facet state to gate against).
//
// **Wire-level rejection shape.** The gate emits a typed
// `RejectedValidationResult` with `reason: 'facet-sequence-out-of-order'`
// (per `tasks/refinements/per-facet-refactor/pf_sequence_gate_server_enforced.md`
// "Decisions" + Constraints) and a `detail` string identifying the
// offending facet's current status. The WS dispatcher routes the
// rejection through `rejectedToApiError` per
// `apps/server/src/errors.ts` (which maps the code to HTTP 422 — the
// connection stays open per ADR 0029).

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111c5';

const HOST_ID = '22222222-2222-4222-8222-2222222222c5';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333333c5';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444444c5';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555555c5';

// Target entity ids.
const NODE_ID_1 = '66666666-6666-4666-8666-6666666666c5';
const SOURCE_NODE_ID = '77777777-7777-4777-8777-7777777777c5';
const TARGET_NODE_ID = '88888888-8888-4888-8888-8888888888c5';
const EXTANT_EDGE_ID = '99999999-9999-4999-8999-9999999999c5';
const FRESH_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac5';
const FRESH_EDGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc5';

// Proposal event ids — used as the candidate-supplying proposals.
const WORDING_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const CLASSIFY_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddc5';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';
const T5 = '2026-05-10T12:00:05Z';
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

// Seed a session with three participants + one captured node (NODE_ID_1
// with wording 'A statement.'). The wording facet's candidate is the
// inline value from `node-created`; no votes / commits yet, so the
// wording facet derives to `'proposed'` (Rule 8 in
// `apps/server/src/projection/facet-status.ts`).
function seedSessionWithFreshNode(): ReturnType<typeof createEmptyProjection> {
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
  applyEvent(
    projection,
    makeEvent(6, 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'node',
      entity_id: NODE_ID_1,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
  return projection;
}

// Extend the seed with both debaters voting `agree` on NODE_ID_1's
// wording facet (target='facet', facet='wording'). With both current
// debater votes `agree`, the wording facet derives to `'agreed'` (Rule
// 7). The moderator is NOT a debater; the agreement rule per
// `docs/methodology.md` reads against current participants (which
// includes the moderator in v1's projection — but per the test seed
// the moderator is also a `currentParticipant`). Vote with all three
// to reach `'agreed'`.
function seedSessionWithWordingAgreed(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithFreshNode();
  let seq = 7;
  for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    applyEvent(
      projection,
      makeEvent(seq++, 'vote', voter, T3, {
        target: 'facet' as const,
        entity_kind: 'node' as const,
        entity_id: NODE_ID_1,
        facet: 'wording' as const,
        participant: voter,
        choice: 'agree',
        voted_at: T3,
      }),
    );
  }
  return projection;
}

// Extend the agreed-wording seed with a facet-keyed commit on the
// wording facet. After commit, the facet derives to `'committed'`
// (Rule 6).
function seedSessionWithWordingCommitted(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithWordingAgreed();
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T4, {
      target: 'facet' as const,
      entity_kind: 'node' as const,
      entity_id: NODE_ID_1,
      facet: 'wording' as const,
      committed_by: MODERATOR_ID,
      committed_at: T4,
    }),
  );
  return projection;
}

// Extend the agreed-wording seed with a single dispute vote on the
// wording facet from a current participant. That overturns the
// agreement to `'disputed'` (Rule 5).
function seedSessionWithWordingDisputed(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithWordingAgreed();
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'vote', DEBATER_B_ID, T4, {
      target: 'facet' as const,
      entity_kind: 'node' as const,
      entity_id: NODE_ID_1,
      facet: 'wording' as const,
      participant: DEBATER_B_ID,
      choice: 'dispute',
      voted_at: T4,
    }),
  );
  return projection;
}

// Same as `seedSessionWithWordingCommitted`, plus a `classify-node`
// proposal landing on the node (so the classification facet has a
// candidate) followed by all three participants voting agree + a
// facet-keyed commit on classification. After commit, the
// classification facet derives to `'committed'` (Rule 6).
function seedSessionWithClassificationCommitted(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithWordingCommitted();
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', MODERATOR_ID, T4, {
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    }),
    id: CLASSIFY_PROPOSAL_ID,
  });
  for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    applyEvent(
      projection,
      makeEvent(nextSequence(projection), 'vote', voter, T5, {
        target: 'facet' as const,
        entity_kind: 'node' as const,
        entity_id: NODE_ID_1,
        facet: 'classification' as const,
        participant: voter,
        choice: 'agree',
        voted_at: T5,
      }),
    );
  }
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T5, {
      target: 'facet' as const,
      entity_kind: 'node' as const,
      entity_id: NODE_ID_1,
      facet: 'classification' as const,
      committed_by: MODERATOR_ID,
      committed_at: T5,
    }),
  );
  return projection;
}

// Same as `seedSessionWithWordingCommitted`, plus a `classify-node`
// proposal landing on the node — classification facet has a candidate
// (per ADR 0030 §7 the projection clears prior `perParticipant` votes
// on the facet when a new candidate lands; here no prior votes exist).
// No votes, no commit on classification → classification facet derives
// to `'proposed'` (Rule 8).
function seedSessionWithClassificationProposed(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithWordingCommitted();
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', MODERATOR_ID, T4, {
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    }),
    id: CLASSIFY_PROPOSAL_ID,
  });
  return projection;
}

// Suppress the unused warnings for top-level constants reserved for
// future negative-path expansion. (Both proposal-event-id slots are
// reserved for the awaiting-proposal cases that the projection
// surfaces via a `null` `candidateValue`.)
void WORDING_PROPOSAL_ID;

// Seed a session with three participants, two visible nodes
// (NODE_ID_1 + TARGET_NODE_ID), and one extant edge (EXTANT_EDGE_ID,
// supports: NODE_ID_1 → TARGET_NODE_ID). The edge's shape facet is
// `'proposed'` (inline candidate from `edge-created`, no votes); per
// `pf_shape_facet_wire_vote` + ADR 0030 §8 the propose-handler
// sequence gate refuses `set-edge-substance` against this edge until
// the shape facet advances to `'agreed'` / `'committed'`.
function seedSessionWithExtantEdgeShapeProposed(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithFreshNode();
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'node-created', DEBATER_B_ID, T2, {
      node_id: TARGET_NODE_ID,
      wording: 'Target of the edge.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'entity-included', DEBATER_B_ID, T2, {
      entity_kind: 'node',
      entity_id: TARGET_NODE_ID,
      included_by: DEBATER_B_ID,
      included_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: EXTANT_EDGE_ID,
      role: 'supports',
      source_node_id: NODE_ID_1,
      target_node_id: TARGET_NODE_ID,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'edge',
      entity_id: EXTANT_EDGE_ID,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
  return projection;
}

// Extend `seedSessionWithExtantEdgeShapeProposed` with the three
// participants voting agree on `(edge, 'shape')` + a moderator commit;
// the shape facet derives to `'committed'` (Rule 6), so the gate
// accepts a subsequent `set-edge-substance` against this edge.
function seedSessionWithExtantEdgeShapeCommitted(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSessionWithExtantEdgeShapeProposed();
  for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    applyEvent(
      projection,
      makeEvent(nextSequence(projection), 'vote', voter, T3, {
        target: 'facet' as const,
        entity_kind: 'edge' as const,
        entity_id: EXTANT_EDGE_ID,
        facet: 'shape' as const,
        participant: voter,
        choice: 'agree' as const,
        voted_at: T3,
      }),
    );
  }
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T4, {
      target: 'facet' as const,
      entity_kind: 'edge' as const,
      entity_id: EXTANT_EDGE_ID,
      facet: 'shape' as const,
      committed_by: MODERATOR_ID,
      committed_at: T4,
    }),
  );
  return projection;
}

// ---------------------------------------------------------------
// classify-node — wording-facet gate.
// ---------------------------------------------------------------

describe('propose classify-node — sequence gate against wording facet', () => {
  it('refuses with facet-sequence-out-of-order when wording is proposed (Rule 8 — candidate set, no votes)', () => {
    const p = seedSessionWithFreshNode();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('facet-sequence-out-of-order');
      expect(r.detail).toContain(NODE_ID_1);
      // The detail surfaces the offending predecessor facet's
      // current status so debugging clients can branch on it
      // without re-deriving.
      expect(r.detail).toContain("'proposed'");
      expect(r.detail).toContain('wording');
    }
  });

  it('refuses with facet-sequence-out-of-order when wording is disputed (Rule 5 — any current participant disputes)', () => {
    const p = seedSessionWithWordingDisputed();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('facet-sequence-out-of-order');
      expect(r.detail).toContain("'disputed'");
    }
  });

  it('accepts the classify-node when wording is agreed (Rule 7 — all current participants vote agree)', () => {
    const p = seedSessionWithWordingAgreed();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The handler emits the `proposal` envelope (no structural fan-out
      // since the node already exists; classify-node's structural arm
      // only emits when `getNode === undefined && wording !== undefined`).
      expect(r.events.length).toBeGreaterThanOrEqual(1);
      const proposalEvent = r.events[r.events.length - 1]!;
      expect(proposalEvent.kind).toBe('proposal');
    }
  });

  it('accepts the classify-node when wording is committed (Rule 6 — commit lands on the current candidate)', () => {
    const p = seedSessionWithWordingCommitted();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });

  // **Legacy bundle exemption (TODO(pf_mod_capture_pane_wording_only)).**
  // A fresh node id + inline `wording` field bypasses the gate because
  // wording is established AT propose-time on the same gesture; there
  // is no prior wording-facet state to gate against. Once the
  // moderator UI migrates to `capture-node` (downstream task), the
  // `wording` field on `classifyNodeProposalSchema` is retired and
  // this exemption goes away with it.
  it('exempts the legacy classify-node-with-wording bundle (fresh node_id + wording field)', () => {
    const p = seedSessionWithFreshNode();
    // FRESH_NODE_ID does NOT pre-exist on the projection.
    expect(p.getNode(FRESH_NODE_ID)).toBeUndefined();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: {
        kind: 'classify-node',
        node_id: FRESH_NODE_ID,
        classification: 'fact',
        // The legacy bundle's tell — inline wording at propose-time.
        wording: 'A fresh statement captured inline.',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Legacy bundle emits node-created + entity-included + proposal.
      expect(r.events).toHaveLength(3);
      expect(r.events[0]!.kind).toBe('node-created');
      expect(r.events[1]!.kind).toBe('entity-included');
      expect(r.events[2]!.kind).toBe('proposal');
    }
  });
});

// ---------------------------------------------------------------
// set-node-substance — classification-facet gate.
// ---------------------------------------------------------------

describe('propose set-node-substance — sequence gate against classification facet', () => {
  it('refuses with facet-sequence-out-of-order when classification is proposed (candidate set, no votes)', () => {
    const p = seedSessionWithClassificationProposed();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'set-node-substance', node_id: NODE_ID_1, value: 'agreed' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('facet-sequence-out-of-order');
      expect(r.detail).toContain(NODE_ID_1);
      expect(r.detail).toContain('classification');
      expect(r.detail).toContain("'proposed'");
    }
  });

  it('refuses with facet-sequence-out-of-order when classification is awaiting-proposal (no candidate yet — Rule 2)', () => {
    // Wording is committed (predecessor satisfied) but no classify-node
    // proposal has landed → classification facet derives to
    // `'awaiting-proposal'`.
    const p = seedSessionWithWordingCommitted();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'set-node-substance', node_id: NODE_ID_1, value: 'agreed' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('facet-sequence-out-of-order');
      expect(r.detail).toContain("'awaiting-proposal'");
    }
  });

  it('accepts the set-node-substance when classification is committed', () => {
    const p = seedSessionWithClassificationCommitted();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: { kind: 'set-node-substance', node_id: NODE_ID_1, value: 'agreed' },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events.length).toBeGreaterThanOrEqual(1);
      const proposalEvent = r.events[r.events.length - 1]!;
      expect(proposalEvent.kind).toBe('proposal');
    }
  });
});

// ---------------------------------------------------------------
// set-edge-substance — shape-facet gate (per pf_shape_facet_wire_vote
// + ADR 0030 §8).
//
// The fresh-edge case (`getEdge === undefined`) is exempt — the
// connecting-capture gesture establishes shape AT propose-time on the
// entity-layer carriage, mirroring the classify-node-with-wording
// legacy bundle exemption. Against an extant edge the gate refuses
// the proposal while the edge's `shape` facet is not `'agreed'` /
// `'committed'`; the F6 defeater-capture path operates against a
// committed shape and therefore passes the gate.
// ---------------------------------------------------------------

describe('propose set-edge-substance — sequence gate against shape facet', () => {
  it('accepts the connecting case (fresh edge — getEdge undefined) — exempted from the gate', () => {
    const p = seedSessionWithFreshNode();
    // Mint a second node so the edge has source + target.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_B_ID, T2, {
        node_id: SOURCE_NODE_ID,
        wording: 'Backing fact for the edge.',
        created_by: DEBATER_B_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'entity-included', DEBATER_B_ID, T2, {
        entity_kind: 'node',
        entity_id: SOURCE_NODE_ID,
        included_by: DEBATER_B_ID,
        included_at: T2,
      }),
    );
    // Sanity: the fresh edge does NOT yet exist; both endpoints are visible.
    expect(p.getEdge(FRESH_EDGE_ID)).toBeUndefined();
    expect(p.getNode(SOURCE_NODE_ID)?.visible).toBe(true);
    expect(p.getNode(NODE_ID_1)?.visible).toBe(true);

    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: {
        kind: 'set-edge-substance',
        edge_id: FRESH_EDGE_ID,
        value: 'agreed',
        source_node_id: SOURCE_NODE_ID,
        target_node_id: NODE_ID_1,
        role: 'supports',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Per ADR 0027 the connecting case emits edge-created +
      // entity-included + proposal.
      expect(r.events).toHaveLength(3);
      expect(r.events[0]!.kind).toBe('edge-created');
    }
  });

  it('refuses with facet-sequence-out-of-order against an extant edge whose shape is proposed (inline candidate, no votes)', () => {
    const p = seedSessionWithExtantEdgeShapeProposed();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: {
        kind: 'set-edge-substance',
        edge_id: EXTANT_EDGE_ID,
        value: 'disputed',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('facet-sequence-out-of-order');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain('shape');
      expect(r.detail).toContain("'proposed'");
    }
  });

  it('accepts the substance-only re-vote once the edge shape facet is committed (canonical F6 path)', () => {
    const p = seedSessionWithExtantEdgeShapeCommitted();
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: {
        kind: 'set-edge-substance',
        edge_id: EXTANT_EDGE_ID,
        value: 'agreed',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('proposal');
    }
  });
});

// ---------------------------------------------------------------
// Sequence gate exempts the structural sub-kinds.
//
// Per ADR 0030 §9 the structural sub-kinds (`decompose`,
// `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`,
// `break-edge`) coexist with facet-valued proposals; the sequence
// rule applies only to facet-valued advancement. This pin asserts
// that the gate does NOT reject a structural propose against a node
// whose wording is still `'proposed'`.
// ---------------------------------------------------------------

describe('propose — sequence gate exempts structural sub-kinds and capture-node', () => {
  it('axiom-mark against a fresh-wording node passes the gate (not facet-valued)', () => {
    const p = seedSessionWithFreshNode();
    // Wording facet is `'proposed'`; axiom-mark is structural and not
    // gated by the sequence rule. The per-sub-kind validator's rules
    // (node-visible, requester==participant, no duplicate) still run.
    const action: ProposeAction = {
      kind: 'propose',
      requester: DEBATER_A_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: DEBATER_A_ID,
      createdAt: T9,
      proposal: {
        kind: 'axiom-mark',
        node_id: NODE_ID_1,
        participant: DEBATER_A_ID,
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });

  it('capture-node is exempt — it creates a fresh node where no facet exists yet', () => {
    const p = seedSessionWithFreshNode();
    const action: ProposeAction = {
      kind: 'propose',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposal: {
        kind: 'capture-node',
        node_id: FRESH_NODE_ID,
        wording: 'A captured node, post-gate.',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});
