// Tests for the propose-side structural fan-out for the
// `set-edge-substance` proposal sub-kind's **connecting-edge** shape.
//
// Refinement: tasks/refinements/moderator-ui/mod_set_edge_substance_endpoint_carriage.md
// ADR:        docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: moderator_ui.mod_graph_rendering.mod_set_edge_substance_endpoint_carriage
//
// **What this file pins.** Per ADR 0027 ("structural events fire at
// entity lifecycle, propose-time for new entities") the
// `set-edge-substance` arm of `buildStructuralEventsForPropose` in
// `apps/server/src/methodology/handlers/propose.ts` discriminates two
// shapes via the four-branch fresh-edge predicate:
//
//   - Connecting-edge case: `projection.getEdge(edge_id) === undefined`
//     AND all three endpoint fields (`source_node_id`,
//     `target_node_id`, `role`) are present → emit `edge-created` +
//     `entity-included` + `proposal` in that order.
//   - Substance-only re-vote case: any branch fails → emit only the
//     `proposal` envelope (the defeater-precommit / re-vote shape; see
//     `proposeDefeaterPreCommit.test.ts` for the broader coverage).
//
// The substance-only case is already pinned by
// `proposeDefeaterPreCommit.test.ts` (which exercises the same arm
// against an extant edge). This file adds the connecting-case + the
// negative endpoints-absent case to close the four-branch predicate.

import { describe, expect, it } from 'vitest';

import type { EdgeCreatedPayload, EntityIncludedPayload, Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111ee111';

const HOST_ID = '22222222-2222-4222-8222-2222222ee222';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333ee333';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444ee444';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555ee555';

// Existing target node — already on the projection. The connecting
// `set-edge-substance` proposes a fresh edge into this node.
const TARGET_NODE_ID = '66666666-6666-4666-8666-6666666ee666';
// The just-minted source node (the first envelope of the two-envelope
// chain landed it; the test seeds it directly via `node-created` /
// `entity-included` to isolate the second-envelope behaviour).
const SOURCE_NODE_ID = '77777777-7777-4777-8777-7777777ee777';
// The fresh edge id the connecting case mints client-side.
const FRESH_EDGE_ID = '88888888-8888-4888-8888-8888888ee888';
// An extant edge for the substance-only / negative cases.
const EXTANT_EDGE_ID = '99999999-9999-4999-8999-9999999ee999';

const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddee1ddd';

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

// Seed the canonical connecting-edge pre-state: three participants;
// the target node (visible); the source node (just minted by the
// first envelope's `node-created` + `entity-included` pair). The
// next event the moderator would emit is the connecting
// `propose set-edge-substance` (the second envelope of the two-
// envelope chain) carrying the three endpoint fields.
function seedConnectingEdgePreState(): ReturnType<typeof createEmptyProjection> {
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
  // Target node — already on the canvas.
  applyEvent(
    projection,
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: TARGET_NODE_ID,
      wording: 'Universal basic income reduces poverty.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(6, 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'node',
      entity_id: TARGET_NODE_ID,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
  // Source node — the first envelope of the two-envelope connecting
  // chain just minted this. The test exercises the SECOND envelope's
  // `set-edge-substance` behaviour against this projection.
  applyEvent(
    projection,
    makeEvent(7, 'node-created', MODERATOR_ID, T2, {
      node_id: SOURCE_NODE_ID,
      wording: 'It also reduces work incentives.',
      created_by: MODERATOR_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(8, 'entity-included', MODERATOR_ID, T2, {
      entity_kind: 'node',
      entity_id: SOURCE_NODE_ID,
      included_by: MODERATOR_ID,
      included_at: T2,
    }),
  );
  return projection;
}

// Seed a pre-state where an extant edge already exists — for the
// substance-only / re-vote shape (mirrors `proposeDefeaterPreCommit`'s
// seed but with simpler labels).
function seedExtantEdgePreState(): ReturnType<typeof createEmptyProjection> {
  const projection = seedConnectingEdgePreState();
  applyEvent(
    projection,
    makeEvent(9, 'edge-created', DEBATER_A_ID, T2, {
      edge_id: EXTANT_EDGE_ID,
      role: 'supports',
      source_node_id: SOURCE_NODE_ID,
      target_node_id: TARGET_NODE_ID,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(10, 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'edge',
      entity_id: EXTANT_EDGE_ID,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
  return projection;
}

describe('propose set-edge-substance — endpoint carriage (mod_set_edge_substance_endpoint_carriage)', () => {
  it('connecting case: emits edge-created + entity-included + proposal in that order', () => {
    const p = seedConnectingEdgePreState();
    // Sanity: target + source exist; the fresh edge does NOT.
    expect(p.getNode(TARGET_NODE_ID)).not.toBeUndefined();
    expect(p.getNode(SOURCE_NODE_ID)).not.toBeUndefined();
    expect(p.getEdge(FRESH_EDGE_ID)).toBeUndefined();

    const action: ProposeAction = {
      kind: 'propose',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposal: {
        kind: 'set-edge-substance',
        edge_id: FRESH_EDGE_ID,
        value: 'agreed',
        source_node_id: SOURCE_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        role: 'supports',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Three events, in order: edge-created, entity-included, proposal.
    expect(r.events).toHaveLength(3);
    const [edgeCreated, entityIncluded, proposalEvent] = r.events as [Event, Event, Event];

    expect(edgeCreated.kind).toBe('edge-created');
    expect(edgeCreated.sessionId).toBe(SESSION_ID);
    expect(edgeCreated.sequence).toBe(action.sequence);
    expect(edgeCreated.actor).toBe(MODERATOR_ID);
    expect(edgeCreated.createdAt).toBe(T9);
    if (edgeCreated.kind === 'edge-created') {
      const payload: EdgeCreatedPayload = edgeCreated.payload;
      expect(payload.edge_id).toBe(FRESH_EDGE_ID);
      expect(payload.role).toBe('supports');
      expect(payload.source_node_id).toBe(SOURCE_NODE_ID);
      expect(payload.target_node_id).toBe(TARGET_NODE_ID);
      expect(payload.created_by).toBe(MODERATOR_ID);
      expect(payload.created_at).toBe(T9);
    }

    expect(entityIncluded.kind).toBe('entity-included');
    expect(entityIncluded.sequence).toBe(action.sequence + 1);
    expect(entityIncluded.actor).toBe(MODERATOR_ID);
    if (entityIncluded.kind === 'entity-included') {
      const payload: EntityIncludedPayload = entityIncluded.payload;
      expect(payload.entity_kind).toBe('edge');
      expect(payload.entity_id).toBe(FRESH_EDGE_ID);
      expect(payload.included_by).toBe(MODERATOR_ID);
      expect(payload.included_at).toBe(T9);
    }

    expect(proposalEvent.kind).toBe('proposal');
    expect(proposalEvent.id).toBe(NEW_EVENT_ID);
    expect(proposalEvent.sequence).toBe(action.sequence + 2);
    expect(proposalEvent.actor).toBe(MODERATOR_ID);
    if (proposalEvent.kind === 'proposal') {
      const inner = proposalEvent.payload.proposal;
      expect(inner.kind).toBe('set-edge-substance');
      if (inner.kind === 'set-edge-substance') {
        expect(inner.edge_id).toBe(FRESH_EDGE_ID);
        expect(inner.value).toBe('agreed');
        expect(inner.source_node_id).toBe(SOURCE_NODE_ID);
        expect(inner.target_node_id).toBe(TARGET_NODE_ID);
        expect(inner.role).toBe('supports');
      }
    }
  });

  it('substance-only case: emits only the proposal envelope when endpoint fields are absent (re-vote shape against an extant edge)', () => {
    const p = seedExtantEdgePreState();
    // Sanity: the extant edge IS present.
    expect(p.getEdge(EXTANT_EDGE_ID)).not.toBeUndefined();

    const action: ProposeAction = {
      kind: 'propose',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposal: {
        kind: 'set-edge-substance',
        edge_id: EXTANT_EDGE_ID,
        value: 'disputed',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Exactly one event — the proposal envelope. No structural fan-out.
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('proposal');
  });

  it('predicate symmetry: endpoint fields present BUT edge already exists → no structural fan-out (predicate gates on getEdge as well)', () => {
    // Pre-existing edge means the propose handler treats this as a
    // substance-only re-vote even though the client mistakenly sent
    // endpoint fields. The four-branch predicate's `getEdge ===
    // undefined` branch fails; emit only the proposal envelope.
    const p = seedExtantEdgePreState();
    expect(p.getEdge(EXTANT_EDGE_ID)).not.toBeUndefined();

    const action: ProposeAction = {
      kind: 'propose',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposal: {
        kind: 'set-edge-substance',
        edge_id: EXTANT_EDGE_ID,
        value: 'agreed',
        source_node_id: SOURCE_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        role: 'supports',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('proposal');
  });
});
