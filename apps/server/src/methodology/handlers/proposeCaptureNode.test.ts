// Tests for the propose-side `capture-node` proposal sub-kind.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_capture_emits_inline_wording_only.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §4, §5)
// ADR:        docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: per_facet_refactor.server_handlers.pf_capture_emits_inline_wording_only
//
// **What this file pins.** Per ADR 0030 §1 capture is a stand-alone
// gesture that emits the entity-layer record (`node-created` with
// inline `wording`) WITHOUT bundling any facet proposal. The
// `capture-node` arm of `buildStructuralEventsForPropose` in
// `apps/server/src/methodology/handlers/propose.ts` discriminates two
// shapes via the optional `edge` block:
//
//   - Wording-only capture: emit `node-created` + `entity-included(node)`
//     + `proposal{capture-node}` in that order (3 events). The
//     classification / substance facets enter life as `awaiting-proposal`
//     until a later separate moderator gesture names a candidate.
//   - Capture-with-edge (ADR 0030 §4): additionally emit `edge-created`
//     + `entity-included(edge)` after the node pair, before the
//     proposal envelope (5 events). The edge's shape (role +
//     endpoints) lives inline on `edge-created` per ADR 0030 §5; the
//     substance facet is `awaiting-proposal`.
//
// **Distinction from `classify-node`-with-wording (legacy bundle).** The
// legacy bundled `classify-node`-with-wording path stays alive until
// the moderator UI catches up (`pf_mod_capture_pane_wording_only`).
// `capture-node` is the new wording-only gesture; tests below pin the
// new arm and assert no facet proposal is co-bundled.
//
// **Validator rules pinned here.** node_id uniqueness (rule 1);
// capture-with-edge edge_id uniqueness (rule 2) and source/target
// reference resolution (rule 3 — either pre-extant visible node OR
// the just-captured node id).

import { describe, expect, it } from 'vitest';

import type {
  CaptureNodeProposal,
  EdgeCreatedPayload,
  EntityIncludedPayload,
  Event,
  NodeCreatedPayload,
} from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111ee111';

const HOST_ID = '22222222-2222-4222-8222-2222222ee222';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333ee333';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444ee444';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555ee555';

// Pre-existing node — used as the supports-target for the capture-with-edge case.
const TARGET_NODE_ID = '66666666-6666-4666-8666-6666666ee666';
// The freshly-captured node id the client mints for this propose.
const FRESH_NODE_ID = '77777777-7777-4777-8777-7777777ee777';
// The freshly-captured edge id for the capture-with-edge case.
const FRESH_EDGE_ID = '88888888-8888-4888-8888-8888888ee888';
// An unknown-to-the-projection node id for the negative reference case.
const UNKNOWN_NODE_ID = '99999999-9999-4999-8999-9999999ee999';

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

// Seed: three participants, no candidate nodes yet. The wording-only
// capture case proposes against this empty-graph pre-state.
function seedEmptyGraph(): ReturnType<typeof createEmptyProjection> {
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
  return projection;
}

// Seed: three participants + one pre-existing visible target node. The
// capture-with-edge case uses this pre-state to link the freshly-
// captured node to the existing target via a `supports` edge.
function seedOneNode(): ReturnType<typeof createEmptyProjection> {
  const projection = seedEmptyGraph();
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
  return projection;
}

describe('propose capture-node — wording-only capture (pf_capture_emits_inline_wording_only)', () => {
  it('wording-only case: emits exactly node-created + entity-included + proposal in that order (no co-bundled classify-node)', () => {
    const p = seedEmptyGraph();
    // Sanity: the fresh node id does NOT pre-exist.
    expect(p.getNode(FRESH_NODE_ID)).toBeUndefined();

    const proposal: CaptureNodeProposal = {
      kind: 'capture-node',
      node_id: FRESH_NODE_ID,
      wording: 'Zoos do more good than harm.',
    };
    const action: ProposeAction = {
      kind: 'propose',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposal,
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Exactly three events, in order: node-created, entity-included, proposal.
    // No co-bundled `classify-node` proposal — that's a separate later gesture.
    expect(r.events).toHaveLength(3);
    const [nodeCreated, nodeIncluded, proposalEvent] = r.events as [Event, Event, Event];

    expect(nodeCreated.kind).toBe('node-created');
    expect(nodeCreated.sessionId).toBe(SESSION_ID);
    expect(nodeCreated.sequence).toBe(action.sequence);
    expect(nodeCreated.actor).toBe(MODERATOR_ID);
    expect(nodeCreated.createdAt).toBe(T9);
    if (nodeCreated.kind === 'node-created') {
      const payload: NodeCreatedPayload = nodeCreated.payload;
      expect(payload.node_id).toBe(FRESH_NODE_ID);
      expect(payload.wording).toBe('Zoos do more good than harm.');
      expect(payload.created_by).toBe(MODERATOR_ID);
      expect(payload.created_at).toBe(T9);
    }

    expect(nodeIncluded.kind).toBe('entity-included');
    expect(nodeIncluded.sequence).toBe(action.sequence + 1);
    if (nodeIncluded.kind === 'entity-included') {
      const payload: EntityIncludedPayload = nodeIncluded.payload;
      expect(payload.entity_kind).toBe('node');
      expect(payload.entity_id).toBe(FRESH_NODE_ID);
      expect(payload.included_by).toBe(MODERATOR_ID);
      expect(payload.included_at).toBe(T9);
    }

    expect(proposalEvent.kind).toBe('proposal');
    expect(proposalEvent.id).toBe(NEW_EVENT_ID);
    expect(proposalEvent.sequence).toBe(action.sequence + 2);
    if (proposalEvent.kind === 'proposal') {
      const inner = proposalEvent.payload.proposal;
      // The proposal envelope itself is the wire-level record of the
      // capture gesture; per ADR 0030 §6 it carries no facet
      // candidate. Critically NOT `classify-node` — the legacy
      // bundled wording-plus-classification gesture is dismantled.
      expect(inner.kind).toBe('capture-node');
      if (inner.kind === 'capture-node') {
        expect(inner.node_id).toBe(FRESH_NODE_ID);
        expect(inner.wording).toBe('Zoos do more good than harm.');
        expect(inner.edge).toBeUndefined();
      }
    }

    // Belt-and-suspenders: scan the entire event list for ANY
    // `classify-node` proposal envelope; the bundled gesture is gone.
    for (const ev of r.events) {
      if (ev.kind === 'proposal') {
        expect(ev.payload.proposal.kind).not.toBe('classify-node');
      }
    }
  });

  it('capture-with-edge case: emits node-created + entity-included(node) + edge-created + entity-included(edge) + proposal (5 events, ADR 0030 §4)', () => {
    const p = seedOneNode();
    // Sanity: target exists; the fresh node + edge do NOT.
    expect(p.getNode(TARGET_NODE_ID)).not.toBeUndefined();
    expect(p.getNode(FRESH_NODE_ID)).toBeUndefined();
    expect(p.getEdge(FRESH_EDGE_ID)).toBeUndefined();

    const proposal: CaptureNodeProposal = {
      kind: 'capture-node',
      node_id: FRESH_NODE_ID,
      wording: 'Modern zoos prioritise conservation over entertainment.',
      edge: {
        edge_id: FRESH_EDGE_ID,
        role: 'supports',
        source_node_id: FRESH_NODE_ID,
        target_node_id: TARGET_NODE_ID,
      },
    };
    const action: ProposeAction = {
      kind: 'propose',
      requester: MODERATOR_ID,
      sessionId: SESSION_ID,
      eventId: NEW_EVENT_ID,
      sequence: nextSequence(p),
      actor: MODERATOR_ID,
      createdAt: T9,
      proposal,
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Exactly five events, in order:
    //   1. node-created       (the captured node, wording inline)
    //   2. entity-included    (node)
    //   3. edge-created       (the connecting edge, role+endpoints inline)
    //   4. entity-included    (edge)
    //   5. proposal           (capture-node envelope)
    // No co-bundled `classify-node` or `set-edge-substance` — those are
    // separate later moderator gestures per ADR 0030 §1.
    expect(r.events).toHaveLength(5);
    const [nodeCreated, nodeIncluded, edgeCreated, edgeIncluded, proposalEvent] = r.events as [
      Event,
      Event,
      Event,
      Event,
      Event,
    ];

    expect(nodeCreated.kind).toBe('node-created');
    expect(nodeCreated.sequence).toBe(action.sequence);
    if (nodeCreated.kind === 'node-created') {
      expect(nodeCreated.payload.node_id).toBe(FRESH_NODE_ID);
      expect(nodeCreated.payload.wording).toBe(
        'Modern zoos prioritise conservation over entertainment.',
      );
    }

    expect(nodeIncluded.kind).toBe('entity-included');
    expect(nodeIncluded.sequence).toBe(action.sequence + 1);
    if (nodeIncluded.kind === 'entity-included') {
      expect(nodeIncluded.payload.entity_kind).toBe('node');
      expect(nodeIncluded.payload.entity_id).toBe(FRESH_NODE_ID);
    }

    expect(edgeCreated.kind).toBe('edge-created');
    expect(edgeCreated.sequence).toBe(action.sequence + 2);
    if (edgeCreated.kind === 'edge-created') {
      const payload: EdgeCreatedPayload = edgeCreated.payload;
      expect(payload.edge_id).toBe(FRESH_EDGE_ID);
      expect(payload.role).toBe('supports');
      expect(payload.source_node_id).toBe(FRESH_NODE_ID);
      expect(payload.target_node_id).toBe(TARGET_NODE_ID);
      expect(payload.created_by).toBe(MODERATOR_ID);
    }

    expect(edgeIncluded.kind).toBe('entity-included');
    expect(edgeIncluded.sequence).toBe(action.sequence + 3);
    if (edgeIncluded.kind === 'entity-included') {
      expect(edgeIncluded.payload.entity_kind).toBe('edge');
      expect(edgeIncluded.payload.entity_id).toBe(FRESH_EDGE_ID);
    }

    expect(proposalEvent.kind).toBe('proposal');
    expect(proposalEvent.sequence).toBe(action.sequence + 4);
    if (proposalEvent.kind === 'proposal') {
      const inner = proposalEvent.payload.proposal;
      expect(inner.kind).toBe('capture-node');
      if (inner.kind === 'capture-node') {
        expect(inner.edge).toEqual({
          edge_id: FRESH_EDGE_ID,
          role: 'supports',
          source_node_id: FRESH_NODE_ID,
          target_node_id: TARGET_NODE_ID,
        });
      }
    }

    // Belt-and-suspenders: no co-bundled `classify-node` or
    // `set-edge-substance` proposals.
    for (const ev of r.events) {
      if (ev.kind === 'proposal') {
        expect(ev.payload.proposal.kind).not.toBe('classify-node');
        expect(ev.payload.proposal.kind).not.toBe('set-edge-substance');
      }
    }
  });

  it('rule 1 (uniqueness): rejects with illegal-state-transition when node_id already names an existing node', () => {
    const p = seedOneNode();
    // Pre-existing TARGET_NODE_ID — capture-node against it should reject.
    expect(p.getNode(TARGET_NODE_ID)).not.toBeUndefined();

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
        node_id: TARGET_NODE_ID,
        wording: 'Cannot re-capture an extant node.',
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('illegal-state-transition');
    expect(r.detail).toContain(TARGET_NODE_ID);
    expect(r.detail).toContain('already names');
  });

  it('rule 3 (edge endpoint reference): rejects with target-entity-not-found when source/target is neither pre-extant visible nor the just-captured node', () => {
    const p = seedOneNode();

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
        wording: 'A claim with an edge to a phantom target.',
        edge: {
          edge_id: FRESH_EDGE_ID,
          role: 'supports',
          source_node_id: FRESH_NODE_ID,
          target_node_id: UNKNOWN_NODE_ID,
        },
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('target-entity-not-found');
    expect(r.detail).toContain(UNKNOWN_NODE_ID);
  });

  it('rule 3 (self-reference): accepts capture-with-edge whose endpoint is the just-captured node itself (linking to a pre-extant neighbor)', () => {
    // The common connecting-capture case: capture a brand-new node
    // AND link it via `supports` to a pre-existing target. The
    // source endpoint == the freshly-captured node id, which is NOT
    // visible on the pre-emission projection but is the just-minted
    // node — the validator's self-reference branch allows this.
    const p = seedOneNode();

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
        wording: 'Self-source connecting capture.',
        edge: {
          edge_id: FRESH_EDGE_ID,
          role: 'supports',
          source_node_id: FRESH_NODE_ID,
          target_node_id: TARGET_NODE_ID,
        },
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(5);
  });
});

// ---------------------------------------------------------------
// Capture-with-edge annotation-endpoint cases per
// `set_edge_substance_annotation_endpoint`. The edge's endpoints are
// independently a node id or an annotation id. The capture mints a
// node, so the self-reference path applies only to the node-id slot
// (per the refinement's D7 — annotations cannot self-reference a
// capture-time-minted entity).
// ---------------------------------------------------------------

const TARGET_ANNOTATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee01ee';
const UNKNOWN_ANNOTATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee99ee';

// Seed one annotation attached to the pre-existing target node, used
// by the polymorphic capture-with-edge cases below.
function seedOneNodeAndAnnotation(): ReturnType<typeof createEmptyProjection> {
  const projection = seedOneNode();
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'annotation-created', DEBATER_A_ID, T2, {
      annotation_id: TARGET_ANNOTATION_ID,
      kind: 'note',
      content: 'Annotation on the target node.',
      target_node_id: TARGET_NODE_ID,
      target_edge_id: null,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  return projection;
}

describe('propose capture-node — polymorphic annotation-endpoint cases', () => {
  it('rejects when target_annotation_id references an unknown annotation', () => {
    const p = seedOneNodeAndAnnotation();
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
        wording: 'Capture targeting an unknown annotation.',
        edge: {
          edge_id: FRESH_EDGE_ID,
          role: 'contradicts',
          source_node_id: FRESH_NODE_ID,
          target_annotation_id: UNKNOWN_ANNOTATION_ID,
        },
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('target-entity-not-found');
    expect(r.detail).toContain('target_annotation_id');
    expect(r.detail).toContain(UNKNOWN_ANNOTATION_ID);
  });

  it('rejects when target_annotation_id references an invisible annotation', () => {
    const p = seedOneNodeAndAnnotation();
    p.setAnnotationVisible(TARGET_ANNOTATION_ID, false);
    expect(p.getAnnotation(TARGET_ANNOTATION_ID)?.visible).toBe(false);

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
        wording: 'Capture targeting an invisible annotation.',
        edge: {
          edge_id: FRESH_EDGE_ID,
          role: 'contradicts',
          source_node_id: FRESH_NODE_ID,
          target_annotation_id: TARGET_ANNOTATION_ID,
        },
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('target-entity-not-found');
    expect(r.detail).toContain('target_annotation_id');
  });

  it('node→annotation capture-with-edge happy path — self-source minted node + visible target annotation', () => {
    const p = seedOneNodeAndAnnotation();
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
        wording: 'Fresh node contradicts an existing annotation.',
        edge: {
          edge_id: FRESH_EDGE_ID,
          role: 'contradicts',
          source_node_id: FRESH_NODE_ID,
          target_annotation_id: TARGET_ANNOTATION_ID,
        },
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(5);
    const edgeCreated = r.events[2]!;
    expect(edgeCreated.kind).toBe('edge-created');
    if (edgeCreated.kind === 'edge-created') {
      const payload: EdgeCreatedPayload = edgeCreated.payload;
      expect(payload.source_node_id).toBe(FRESH_NODE_ID);
      expect(payload.target_annotation_id).toBe(TARGET_ANNOTATION_ID);
      expect(payload.target_node_id).toBeUndefined();
      expect(payload.source_annotation_id).toBeUndefined();
    }
  });

  it('annotation→node capture-with-edge happy path — source annotation + self-target minted node', () => {
    const p = seedOneNodeAndAnnotation();
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
        wording: 'Annotation supports a fresh node.',
        edge: {
          edge_id: FRESH_EDGE_ID,
          role: 'supports',
          source_annotation_id: TARGET_ANNOTATION_ID,
          target_node_id: FRESH_NODE_ID,
        },
      },
    };
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(5);
    const edgeCreated = r.events[2]!;
    if (edgeCreated.kind === 'edge-created') {
      const payload: EdgeCreatedPayload = edgeCreated.payload;
      expect(payload.source_annotation_id).toBe(TARGET_ANNOTATION_ID);
      expect(payload.target_node_id).toBe(FRESH_NODE_ID);
      expect(payload.source_node_id).toBeUndefined();
      expect(payload.target_annotation_id).toBeUndefined();
    }
  });
});
