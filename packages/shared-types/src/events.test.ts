// Tests for the event envelope, payload registry, and validateEvent.
//
// Refinement: tasks/refinements/data-and-methodology/event_base_envelope.md
// ADR: docs/adr/0021-event-envelope-discriminated-union-with-zod.md

import { describe, expect, it } from 'vitest';
import {
  type Event,
  type EventEnvelope,
  type EventKind,
  EventValidationError,
  annotationCreatedPayloadSchema,
  commitPayloadSchema,
  edgeCreatedPayloadSchema,
  entityIncludedPayloadSchema,
  eventEnvelopeSchema,
  eventKinds,
  eventPayloadSchemas,
  facetNameSchema,
  metaDisagreementMarkedPayloadSchema,
  nodeCreatedPayloadSchema,
  participantJoinedPayloadSchema,
  participantLeftPayloadSchema,
  sessionCreatedPayloadSchema,
  sessionEndedPayloadSchema,
  sessionModeChangedPayloadSchema,
  snapshotCreatedPayloadSchema,
  validateEvent,
  votePayloadSchema,
  withdrawAgreementPayloadSchema,
} from './events.js';

// Valid sample UUIDs (v4: version-nibble = 4, variant-nibble in [89ab]).
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const HOST_USER_ID = '44444444-4444-4444-8444-444444444444';
const PROPOSAL_ID = '55555555-5555-4555-8555-555555555555';
const PARTICIPANT_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const NODE_ID = '88888888-8888-4888-8888-888888888888';
const NODE_ID_2 = '99999999-9999-4999-8999-999999999999';
const EDGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANNOTATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SNAPSHOT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('EventEnvelope round-trip', () => {
  it('serializes and re-validates a `vote` envelope unchanged', () => {
    const original: EventEnvelope<'vote'> = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 42,
      kind: 'vote',
      actor: ACTOR_ID,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: NODE_ID,
        facet: 'classification',
        participant: PARTICIPANT_ID,
        choice: 'agree',
        voted_at: '2026-05-10T12:34:56Z',
      },
      createdAt: '2026-05-10T12:34:56Z',
    };

    const wire = JSON.parse(JSON.stringify(original)) as unknown;
    const validated: Event = validateEvent(wire);

    expect(validated).toEqual(original);
  });

  it('accepts a null actor (system-emitted future events)', () => {
    const envelope: EventEnvelope<'session-created'> = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      kind: 'session-created',
      actor: null,
      payload: {
        host_user_id: HOST_USER_ID,
        privacy: 'public',
        topic: 'A topic',
        created_at: '2026-05-10T12:34:56Z',
      },
      createdAt: '2026-05-10T12:34:56Z',
    };
    expect(() => validateEvent(envelope)).not.toThrow();
  });
});

// -- Session lifecycle event payload schemas -------------------------
//
// Owned by `session_lifecycle_events`. Each schema gets a happy-path
// round-trip (parse → JSON → parse → equal) and at least one
// invalid-input case asserting `validateEvent` rejects with a message
// naming the kind.

describe('session-created payload schema', () => {
  const valid = {
    host_user_id: HOST_USER_ID,
    privacy: 'private' as const,
    topic: 'Resolved: this is a debate motion',
    created_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = sessionCreatedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    const reparsed = sessionCreatedPayloadSchema.parse(wire);
    expect(reparsed).toEqual(valid);
  });

  it('rejects an invalid privacy value via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      kind: 'session-created' as const,
      actor: ACTOR_ID,
      payload: { ...valid, privacy: 'secret' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'session-created'");
  });

  it('rejects a non-UUID host_user_id', () => {
    const result = sessionCreatedPayloadSchema.safeParse({ ...valid, host_user_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('session-ended payload schema', () => {
  const valid = { ended_at: '2026-05-10T13:00:00Z' };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = sessionEndedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(sessionEndedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a missing ended_at via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'session-ended' as const,
      actor: ACTOR_ID,
      payload: {},
      createdAt: '2026-05-10T13:00:00Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'session-ended'");
  });

  it('rejects a non-ISO ended_at', () => {
    const result = sessionEndedPayloadSchema.safeParse({ ended_at: 'tomorrow' });
    expect(result.success).toBe(false);
  });
});

describe('participant-joined payload schema', () => {
  const valid = {
    user_id: USER_ID,
    role: 'debater-A' as const,
    screen_name: 'Alice',
    joined_at: '2026-05-10T12:35:00Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = participantJoinedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(participantJoinedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts each of moderator / debater-A / debater-B', () => {
    for (const role of ['moderator', 'debater-A', 'debater-B'] as const) {
      const result = participantJoinedPayloadSchema.safeParse({ ...valid, role });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown role via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 2,
      kind: 'participant-joined' as const,
      actor: ACTOR_ID,
      payload: { ...valid, role: 'spectator' },
      createdAt: '2026-05-10T12:35:00Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'participant-joined'");
  });

  it('rejects a non-UUID user_id', () => {
    const result = participantJoinedPayloadSchema.safeParse({ ...valid, user_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('participant-left payload schema', () => {
  const valid = { user_id: USER_ID, left_at: '2026-05-10T12:55:00Z' };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = participantLeftPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(participantLeftPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a missing user_id via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 3,
      kind: 'participant-left' as const,
      actor: ACTOR_ID,
      payload: { left_at: '2026-05-10T12:55:00Z' },
      createdAt: '2026-05-10T12:55:00Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'participant-left'");
  });

  it('rejects a non-ISO left_at', () => {
    const result = participantLeftPayloadSchema.safeParse({
      user_id: USER_ID,
      left_at: 'never',
    });
    expect(result.success).toBe(false);
  });
});

// -- Entity creation event payload schemas ---------------------------
//
// Owned by `entity_creation_events`. Each schema gets a happy-path
// round-trip plus invalid-input cases for every constrained field.

describe('node-created payload schema', () => {
  const valid = {
    node_id: NODE_ID,
    wording: 'Capital punishment deters murder.',
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = nodeCreatedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(nodeCreatedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a non-UUID node_id via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 4,
      kind: 'node-created' as const,
      actor: ACTOR_ID,
      payload: { ...valid, node_id: 'not-a-uuid' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'node-created'");
  });

  it('rejects an empty wording', () => {
    const result = nodeCreatedPayloadSchema.safeParse({ ...valid, wording: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID created_by', () => {
    const result = nodeCreatedPayloadSchema.safeParse({ ...valid, created_by: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO created_at', () => {
    const result = nodeCreatedPayloadSchema.safeParse({ ...valid, created_at: 'now' });
    expect(result.success).toBe(false);
  });
});

describe('edge-created payload schema', () => {
  const valid = {
    edge_id: EDGE_ID,
    role: 'supports' as const,
    source_node_id: NODE_ID,
    target_node_id: NODE_ID_2,
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = edgeCreatedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(edgeCreatedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts each of the seven roles', () => {
    for (const role of [
      'supports',
      'rebuts',
      'qualifies',
      'bridges-from',
      'bridges-to',
      'defines',
      'contradicts',
    ] as const) {
      const result = edgeCreatedPayloadSchema.safeParse({ ...valid, role });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown role via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 5,
      kind: 'edge-created' as const,
      actor: ACTOR_ID,
      payload: { ...valid, role: 'undermines' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'edge-created'");
  });

  it('rejects a non-UUID edge_id', () => {
    const result = edgeCreatedPayloadSchema.safeParse({ ...valid, edge_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID source_node_id', () => {
    const result = edgeCreatedPayloadSchema.safeParse({
      ...valid,
      source_node_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID target_node_id', () => {
    const result = edgeCreatedPayloadSchema.safeParse({
      ...valid,
      target_node_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('annotation-created payload schema', () => {
  const validNodeTarget = {
    annotation_id: ANNOTATION_ID,
    kind: 'note' as const,
    content: 'Worth flagging for the moderator.',
    target_node_id: NODE_ID,
    target_edge_id: null,
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  };

  const validEdgeTarget = {
    annotation_id: ANNOTATION_ID,
    kind: 'reframe' as const,
    content: 'This warrant restates the claim.',
    target_node_id: null,
    target_edge_id: EDGE_ID,
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed node-targeted payload through JSON', () => {
    const parsed = annotationCreatedPayloadSchema.parse(validNodeTarget);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(annotationCreatedPayloadSchema.parse(wire)).toEqual(validNodeTarget);
  });

  it('round-trips a well-formed edge-targeted payload through JSON', () => {
    const parsed = annotationCreatedPayloadSchema.parse(validEdgeTarget);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(annotationCreatedPayloadSchema.parse(wire)).toEqual(validEdgeTarget);
  });

  it('accepts each of the four kinds', () => {
    for (const kind of ['note', 'reframe', 'scope-change', 'stance'] as const) {
      const result = annotationCreatedPayloadSchema.safeParse({ ...validNodeTarget, kind });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown kind via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 6,
      kind: 'annotation-created' as const,
      actor: ACTOR_ID,
      payload: { ...validNodeTarget, kind: 'rebuttal' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'annotation-created'");
  });

  it('rejects both target_node_id and target_edge_id non-null with the XOR message', () => {
    const result = annotationCreatedPayloadSchema.safeParse({
      ...validNodeTarget,
      target_edge_id: EDGE_ID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'exactly one of target_node_id / target_edge_id must be set',
      );
    }
  });

  it('rejects both target_node_id and target_edge_id null with the XOR message', () => {
    const result = annotationCreatedPayloadSchema.safeParse({
      ...validNodeTarget,
      target_node_id: null,
      target_edge_id: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'exactly one of target_node_id / target_edge_id must be set',
      );
    }
  });

  it('rejects a non-UUID annotation_id', () => {
    const result = annotationCreatedPayloadSchema.safeParse({
      ...validNodeTarget,
      annotation_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty content', () => {
    const result = annotationCreatedPayloadSchema.safeParse({ ...validNodeTarget, content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID target_node_id (when set)', () => {
    const result = annotationCreatedPayloadSchema.safeParse({
      ...validNodeTarget,
      target_node_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID target_edge_id (when set)', () => {
    const result = annotationCreatedPayloadSchema.safeParse({
      ...validEdgeTarget,
      target_edge_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// -- Entity inclusion event payload schema ---------------------------
//
// Owned by `entity_inclusion_events`. Single payload with
// `entity_kind` discriminating node / edge / annotation (R26).

describe('entity-included payload schema', () => {
  const baseValid = {
    entity_id: NODE_ID,
    included_by: USER_ID,
    included_at: '2026-05-10T12:34:56Z',
  };

  it("round-trips entity_kind: 'node' through JSON", () => {
    const valid = { entity_kind: 'node' as const, ...baseValid };
    const parsed = entityIncludedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(entityIncludedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it("round-trips entity_kind: 'edge' through JSON", () => {
    const valid = { entity_kind: 'edge' as const, ...baseValid, entity_id: EDGE_ID };
    const parsed = entityIncludedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(entityIncludedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it("round-trips entity_kind: 'annotation' through JSON", () => {
    const valid = {
      entity_kind: 'annotation' as const,
      ...baseValid,
      entity_id: ANNOTATION_ID,
    };
    const parsed = entityIncludedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(entityIncludedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a non-UUID entity_id via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 7,
      kind: 'entity-included' as const,
      actor: ACTOR_ID,
      payload: { entity_kind: 'node', ...baseValid, entity_id: 'not-a-uuid' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'entity-included'");
  });

  it("rejects an unknown entity_kind ('attribute')", () => {
    const result = entityIncludedPayloadSchema.safeParse({
      entity_kind: 'attribute',
      ...baseValid,
    });
    expect(result.success).toBe(false);
  });
});

// -- Vote payload schema (per ADR 0030 §2 + §9) ----------------------
//
// `votePayloadSchema` is a discriminated union on `target`:
//
//   - `target: 'facet'` for votes against facet-valued proposal sub-
//     kinds (classify-node / set-node-substance / set-edge-substance /
//     edit-wording). Keyed by `(entity_kind, entity_id, facet)`.
//   - `target: 'proposal'` for votes against structural proposal sub-
//     kinds (decompose / interpretive-split / axiom-mark / meta-move /
//     break-edge / amend-node / annotate). Keyed by `proposal_id`.
//
// `choice` collapses to `'agree' | 'dispute'` — withdrawal is its own
// event kind (`'withdraw-agreement'`).

describe('vote payload schema — facet-keyed arm', () => {
  const valid = {
    target: 'facet' as const,
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    participant: PARTICIPANT_ID,
    choice: 'agree' as const,
    voted_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed facet-keyed payload through JSON', () => {
    const parsed = votePayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(votePayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts each of agree / dispute on the facet arm', () => {
    for (const choice of ['agree', 'dispute'] as const) {
      const result = votePayloadSchema.safeParse({ ...valid, choice });
      expect(result.success).toBe(true);
    }
  });

  it("rejects 'withdraw' as a choice (now its own event kind)", () => {
    const result = votePayloadSchema.safeParse({ ...valid, choice: 'withdraw' });
    expect(result.success).toBe(false);
  });

  it('accepts edge as entity_kind on the facet arm', () => {
    const result = votePayloadSchema.safeParse({
      ...valid,
      entity_kind: 'edge',
      entity_id: EDGE_ID,
      facet: 'substance',
    });
    expect(result.success).toBe(true);
  });

  it("rejects 'annotation' as entity_kind on the facet arm", () => {
    const result = votePayloadSchema.safeParse({ ...valid, entity_kind: 'annotation' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown facet value', () => {
    const result = votePayloadSchema.safeParse({ ...valid, facet: 'role' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID entity_id', () => {
    const result = votePayloadSchema.safeParse({ ...valid, entity_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID participant', () => {
    const result = votePayloadSchema.safeParse({ ...valid, participant: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO voted_at', () => {
    const result = votePayloadSchema.safeParse({ ...valid, voted_at: 'just now' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing voted_at', () => {
    const { voted_at: _omitted, ...withoutVotedAt } = valid;
    void _omitted;
    const result = votePayloadSchema.safeParse(withoutVotedAt);
    expect(result.success).toBe(false);
  });

  it('rejects a facet-arm payload that ALSO carries proposal_id (cross-arm corruption)', () => {
    // The discriminated union's strict-shape inside each arm rejects
    // unknown keys: a facet-arm payload cannot smuggle the
    // proposal-arm's `proposal_id` through.
    const result = votePayloadSchema.safeParse({ ...valid, proposal_id: PROPOSAL_ID });
    // Z.discriminatedUnion by default strips unknown keys; the parse
    // succeeds but the resulting payload has no `proposal_id`. We
    // assert that — the cross-shape value does not survive parse, so
    // the payload-keyed branch is unreachable from this arm.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('proposal_id');
    }
  });

  it('routes a facet-arm payload-shape error through validateEvent naming the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 8,
      kind: 'vote' as const,
      actor: ACTOR_ID,
      payload: { ...valid, choice: 'maybe' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'vote'");
  });
});

describe('vote payload schema — proposal-keyed arm', () => {
  const valid = {
    target: 'proposal' as const,
    proposal_id: PROPOSAL_ID,
    participant: PARTICIPANT_ID,
    choice: 'agree' as const,
    voted_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed proposal-keyed payload through JSON', () => {
    const parsed = votePayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(votePayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts each of agree / dispute on the proposal arm', () => {
    for (const choice of ['agree', 'dispute'] as const) {
      const result = votePayloadSchema.safeParse({ ...valid, choice });
      expect(result.success).toBe(true);
    }
  });

  it("rejects 'withdraw' as a choice on the proposal arm", () => {
    const result = votePayloadSchema.safeParse({ ...valid, choice: 'withdraw' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID proposal_id', () => {
    const result = votePayloadSchema.safeParse({ ...valid, proposal_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID participant', () => {
    const result = votePayloadSchema.safeParse({ ...valid, participant: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed voted_at', () => {
    const result = votePayloadSchema.safeParse({
      ...valid,
      voted_at: '2026-05-10T13:00:00+00:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-ISO voted_at', () => {
    const result = votePayloadSchema.safeParse({ ...valid, voted_at: 'just now' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing voted_at', () => {
    const { voted_at: _omitted, ...withoutVotedAt } = valid;
    void _omitted;
    const result = votePayloadSchema.safeParse(withoutVotedAt);
    expect(result.success).toBe(false);
  });

  it('rejects a missing proposal_id on the proposal arm', () => {
    const { proposal_id: _omitted, ...withoutProposalId } = valid;
    void _omitted;
    const result = votePayloadSchema.safeParse(withoutProposalId);
    expect(result.success).toBe(false);
  });
});

describe('vote payload schema — discriminator', () => {
  const facetValid = {
    target: 'facet' as const,
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    participant: PARTICIPANT_ID,
    choice: 'agree' as const,
    voted_at: '2026-05-10T12:34:56Z',
  };

  it('rejects a missing target discriminator', () => {
    const { target: _omitted, ...withoutTarget } = facetValid;
    void _omitted;
    const result = votePayloadSchema.safeParse(withoutTarget);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown target value ('node')", () => {
    const result = votePayloadSchema.safeParse({ ...facetValid, target: 'node' });
    expect(result.success).toBe(false);
  });

  it('rejects a proposal-arm payload lacking proposal_id (cross-arm corruption)', () => {
    // A `target: 'proposal'` payload with the facet-arm's
    // entity/facet fields but missing proposal_id fails the
    // proposal-arm schema because proposal_id is required there.
    const result = votePayloadSchema.safeParse({
      target: 'proposal',
      entity_kind: 'node',
      entity_id: NODE_ID,
      facet: 'classification',
      participant: PARTICIPANT_ID,
      choice: 'agree',
      voted_at: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a facet-arm payload lacking entity_id (cross-arm corruption)', () => {
    // A `target: 'facet'` payload with proposal_id but missing
    // entity_kind / entity_id / facet fails the facet-arm schema
    // because those fields are required there.
    const result = votePayloadSchema.safeParse({
      target: 'facet',
      proposal_id: PROPOSAL_ID,
      participant: PARTICIPANT_ID,
      choice: 'agree',
      voted_at: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });
});

// -- Resolution event payload schemas --------------------------------
//
// Owned by `resolution_events`. Shape-only validation; server-side
// referential / authority checks (moderator-only commit, no double
// resolve, etc.) live in `event_validation`.

// -- Commit payload schema (per ADR 0030 §2 + §9) --------------------
//
// `commitPayloadSchema` is a discriminated union on `target`, mirroring
// the vote payload's split:
//
//   - `target: 'facet'` for commits against facet-valued proposal sub-
//     kinds (classify-node / set-node-substance / set-edge-substance /
//     edit-wording). Keyed by `(entity_kind, entity_id, facet)`.
//   - `target: 'proposal'` for commits against structural proposal sub-
//     kinds (decompose / interpretive-split / axiom-mark / meta-move /
//     break-edge / amend-node / annotate). Keyed by `proposal_id`.
//
// `committed_by` carries the actor UUID (the moderator in v1; the
// field is action-shaped rather than role-shaped). `committed_at`
// is the action-clock ISO-8601 timestamp on both arms.

describe('commit payload schema — facet-keyed arm', () => {
  const valid = {
    target: 'facet' as const,
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    committed_by: USER_ID,
    committed_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed facet-keyed payload through JSON', () => {
    const parsed = commitPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(commitPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts edge as entity_kind on the facet arm', () => {
    const result = commitPayloadSchema.safeParse({
      ...valid,
      entity_kind: 'edge',
      entity_id: EDGE_ID,
      facet: 'substance',
    });
    expect(result.success).toBe(true);
  });

  it("rejects 'annotation' as entity_kind on the facet arm", () => {
    const result = commitPayloadSchema.safeParse({ ...valid, entity_kind: 'annotation' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown facet value', () => {
    const result = commitPayloadSchema.safeParse({ ...valid, facet: 'role' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID entity_id', () => {
    const result = commitPayloadSchema.safeParse({ ...valid, entity_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID committed_by', () => {
    const result = commitPayloadSchema.safeParse({ ...valid, committed_by: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO committed_at', () => {
    const result = commitPayloadSchema.safeParse({ ...valid, committed_at: 'just now' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing committed_at', () => {
    const { committed_at: _omitted, ...withoutCommittedAt } = valid;
    void _omitted;
    const result = commitPayloadSchema.safeParse(withoutCommittedAt);
    expect(result.success).toBe(false);
  });

  it('strips proposal_id when present on the facet arm (z.object default)', () => {
    // The discriminated union strips unknown keys; a facet-arm payload
    // smuggling a proposal_id from the proposal arm parses but the
    // proposal_id does not survive — the cross-shape value does not
    // round-trip.
    const result = commitPayloadSchema.safeParse({ ...valid, proposal_id: PROPOSAL_ID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('proposal_id');
    }
  });

  it('routes a facet-arm payload-shape error through validateEvent naming the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 9,
      kind: 'commit' as const,
      actor: ACTOR_ID,
      payload: { ...valid, entity_kind: 'annotation' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'commit'");
  });
});

describe('commit payload schema — proposal-keyed arm', () => {
  const valid = {
    target: 'proposal' as const,
    proposal_id: PROPOSAL_ID,
    committed_by: USER_ID,
    committed_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed proposal-keyed payload through JSON', () => {
    const parsed = commitPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(commitPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a non-UUID proposal_id via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 9,
      kind: 'commit' as const,
      actor: ACTOR_ID,
      payload: { ...valid, proposal_id: 'not-a-uuid' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'commit'");
  });

  it('rejects a non-UUID committed_by', () => {
    const result = commitPayloadSchema.safeParse({ ...valid, committed_by: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO committed_at', () => {
    const result = commitPayloadSchema.safeParse({ ...valid, committed_at: 'just now' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing committed_at', () => {
    const { committed_at: _omitted, ...withoutCommittedAt } = valid;
    void _omitted;
    const result = commitPayloadSchema.safeParse(withoutCommittedAt);
    expect(result.success).toBe(false);
  });

  it('rejects a missing proposal_id on the proposal arm', () => {
    const { proposal_id: _omitted, ...withoutProposalId } = valid;
    void _omitted;
    const result = commitPayloadSchema.safeParse(withoutProposalId);
    expect(result.success).toBe(false);
  });
});

describe('commit payload schema — discriminator', () => {
  const facetValid = {
    target: 'facet' as const,
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    committed_by: USER_ID,
    committed_at: '2026-05-10T12:34:56Z',
  };

  it('rejects a missing target discriminator', () => {
    const { target: _omitted, ...withoutTarget } = facetValid;
    void _omitted;
    const result = commitPayloadSchema.safeParse(withoutTarget);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown target value ('node')", () => {
    const result = commitPayloadSchema.safeParse({ ...facetValid, target: 'node' });
    expect(result.success).toBe(false);
  });

  it('rejects a proposal-arm payload lacking proposal_id (cross-arm corruption)', () => {
    // A `target: 'proposal'` payload with the facet-arm's
    // entity/facet fields but missing proposal_id fails the
    // proposal-arm schema because proposal_id is required there.
    const result = commitPayloadSchema.safeParse({
      target: 'proposal',
      entity_kind: 'node',
      entity_id: NODE_ID,
      facet: 'classification',
      committed_by: USER_ID,
      committed_at: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a facet-arm payload lacking entity_id (cross-arm corruption)', () => {
    // A `target: 'facet'` payload with proposal_id but missing
    // entity_kind / entity_id / facet fails the facet-arm schema
    // because those fields are required there.
    const result = commitPayloadSchema.safeParse({
      target: 'facet',
      proposal_id: PROPOSAL_ID,
      committed_by: USER_ID,
      committed_at: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });
});

// -- Meta-disagreement-marked payload schema (per ADR 0030 §2 + §9) --
//
// `metaDisagreementMarkedPayloadSchema` is a discriminated union on
// `target`, mirroring the vote + commit payload splits:
//
//   - `target: 'facet'` for marks against facet-valued proposal sub-
//     kinds (classify-node / set-node-substance / set-edge-substance /
//     edit-wording). Keyed by `(entity_kind, entity_id, facet)`.
//   - `target: 'proposal'` for marks against structural proposal sub-
//     kinds (decompose / interpretive-split / axiom-mark / meta-move /
//     break-edge / amend-node / annotate). Keyed by `proposal_id`.
//
// `marked_by` carries the actor UUID (the moderator in v1; the field
// is action-shaped rather than role-shaped, matching `committed_by`
// on the commit payload). `marked_at` is the action-clock ISO-8601
// timestamp on both arms.

describe('meta-disagreement-marked payload schema — facet-keyed arm', () => {
  const valid = {
    target: 'facet' as const,
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    marked_by: USER_ID,
    marked_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed facet-keyed payload through JSON', () => {
    const parsed = metaDisagreementMarkedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(metaDisagreementMarkedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts edge as entity_kind on the facet arm', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      entity_kind: 'edge',
      entity_id: EDGE_ID,
      facet: 'substance',
    });
    expect(result.success).toBe(true);
  });

  it("rejects 'annotation' as entity_kind on the facet arm", () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      entity_kind: 'annotation',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown facet value', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      facet: 'role',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID entity_id', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      entity_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID marked_by', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      marked_by: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO marked_at', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      marked_at: 'eventually',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing marked_at', () => {
    const { marked_at: _omitted, ...withoutMarkedAt } = valid;
    void _omitted;
    const result = metaDisagreementMarkedPayloadSchema.safeParse(withoutMarkedAt);
    expect(result.success).toBe(false);
  });

  it('strips proposal_id when present on the facet arm (z.object default)', () => {
    // The discriminated union strips unknown keys; a facet-arm payload
    // smuggling a proposal_id from the proposal arm parses but the
    // proposal_id does not survive — the cross-shape value does not
    // round-trip.
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      proposal_id: PROPOSAL_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('proposal_id');
    }
  });

  it('routes a facet-arm payload-shape error through validateEvent naming the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 10,
      kind: 'meta-disagreement-marked' as const,
      actor: ACTOR_ID,
      payload: { ...valid, entity_kind: 'annotation' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'meta-disagreement-marked'");
  });
});

describe('meta-disagreement-marked payload schema — proposal-keyed arm', () => {
  const valid = {
    target: 'proposal' as const,
    proposal_id: PROPOSAL_ID,
    marked_by: USER_ID,
    marked_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed proposal-keyed payload through JSON', () => {
    const parsed = metaDisagreementMarkedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(metaDisagreementMarkedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a non-UUID proposal_id via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 10,
      kind: 'meta-disagreement-marked' as const,
      actor: ACTOR_ID,
      payload: { ...valid, proposal_id: 'not-a-uuid' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'meta-disagreement-marked'");
  });

  it('rejects a non-UUID marked_by', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      marked_by: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO marked_at', () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...valid,
      marked_at: 'eventually',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing marked_at', () => {
    const { marked_at: _omitted, ...withoutMarkedAt } = valid;
    void _omitted;
    const result = metaDisagreementMarkedPayloadSchema.safeParse(withoutMarkedAt);
    expect(result.success).toBe(false);
  });

  it('rejects a missing proposal_id on the proposal arm', () => {
    const { proposal_id: _omitted, ...withoutProposalId } = valid;
    void _omitted;
    const result = metaDisagreementMarkedPayloadSchema.safeParse(withoutProposalId);
    expect(result.success).toBe(false);
  });
});

describe('meta-disagreement-marked payload schema — discriminator', () => {
  const facetValid = {
    target: 'facet' as const,
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    marked_by: USER_ID,
    marked_at: '2026-05-10T12:34:56Z',
  };

  it('rejects a missing target discriminator', () => {
    const { target: _omitted, ...withoutTarget } = facetValid;
    void _omitted;
    const result = metaDisagreementMarkedPayloadSchema.safeParse(withoutTarget);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown target value ('node')", () => {
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      ...facetValid,
      target: 'node',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a proposal-arm payload lacking proposal_id (cross-arm corruption)', () => {
    // A `target: 'proposal'` payload with the facet-arm's
    // entity/facet fields but missing proposal_id fails the
    // proposal-arm schema because proposal_id is required there.
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      target: 'proposal',
      entity_kind: 'node',
      entity_id: NODE_ID,
      facet: 'classification',
      marked_by: USER_ID,
      marked_at: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a facet-arm payload lacking entity_id (cross-arm corruption)', () => {
    // A `target: 'facet'` payload with proposal_id but missing
    // entity_kind / entity_id / facet fails the facet-arm schema
    // because those fields are required there.
    const result = metaDisagreementMarkedPayloadSchema.safeParse({
      target: 'facet',
      proposal_id: PROPOSAL_ID,
      marked_by: USER_ID,
      marked_at: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });
});

// -- Snapshot event payload schema -----------------------------------
//
// Owned by `snapshot_events`. Refinement:
// tasks/refinements/data-and-methodology/snapshot_events.md.
//
// Snapshots are regular events in the session log (no separate table).
// `log_position` is the session's `sequence` value at snapshot time —
// a positive integer; JS `number` is safe up to 2^53, matching the
// ceiling documented in the events.ts header. Label is capped at 128
// characters per the refinement (VARCHAR(128)).

describe('snapshot-created payload schema', () => {
  const valid = {
    snapshot_id: SNAPSHOT_ID,
    label: 'Segment 1 close',
    log_position: 42,
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = snapshotCreatedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(snapshotCreatedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('rejects a non-UUID snapshot_id via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 11,
      kind: 'snapshot-created' as const,
      actor: ACTOR_ID,
      payload: { ...valid, snapshot_id: 'not-a-uuid' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'snapshot-created'");
  });

  it('rejects an empty label', () => {
    const result = snapshotCreatedPayloadSchema.safeParse({ ...valid, label: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a label longer than 128 characters', () => {
    const result = snapshotCreatedPayloadSchema.safeParse({
      ...valid,
      label: 'x'.repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a label of exactly 128 characters (boundary)', () => {
    const result = snapshotCreatedPayloadSchema.safeParse({
      ...valid,
      label: 'x'.repeat(128),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-integer log_position', () => {
    const result = snapshotCreatedPayloadSchema.safeParse({ ...valid, log_position: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects a negative log_position', () => {
    const result = snapshotCreatedPayloadSchema.safeParse({ ...valid, log_position: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects a zero log_position', () => {
    const result = snapshotCreatedPayloadSchema.safeParse({ ...valid, log_position: 0 });
    expect(result.success).toBe(false);
  });
});

describe('placeholder payload schemas', () => {
  it('exposes a registry entry for every kind', () => {
    // Sanity check that the registry is exhaustive — adding a kind
    // to the SQL CHECK without registering a schema would surface
    // here as a missing-key TypeScript error in events.ts and as
    // an explicit runtime entry here.
    const expectedKinds = [
      'session-created',
      'session-ended',
      'participant-joined',
      'participant-left',
      'node-created',
      'edge-created',
      'annotation-created',
      'entity-included',
      'proposal',
      'vote',
      'commit',
      'meta-disagreement-marked',
      'snapshot-created',
      // Added by mod_proposed_entity_canvas_visibility (ADR 0027) —
      // emitted by the proposal-withdraw flow to retract propose-time-
      // minted entities from the structure.
      'entity-removed',
      // Added by part_session_start_handoff_dedicated_event (ADR 0028) —
      // emitted by `POST /api/sessions/:id/start` when the moderator
      // advances the session from the lobby into the operate canvas.
      'session-mode-changed',
      // Added by pf_withdraw_agreement_event_kind (ADR 0030 §3) —
      // promoted from `vote.choice = 'withdraw'` to its own top-level
      // event kind so the per-facet withdrawal transition is a direct
      // read of the log.
      'withdraw-agreement',
    ] as const;
    for (const kind of expectedKinds) {
      expect(eventPayloadSchemas[kind]).toBeDefined();
    }
  });
});

describe('session-mode-changed payload schema', () => {
  const valid = {
    previous_mode: 'lobby' as const,
    new_mode: 'operate' as const,
    changed_by: USER_ID,
    changed_at: '2026-05-17T12:00:00Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = sessionModeChangedPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(sessionModeChangedPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts the reverse transition (operate → lobby)', () => {
    const reverse = { ...valid, previous_mode: 'operate' as const, new_mode: 'lobby' as const };
    const result = sessionModeChangedPayloadSchema.safeParse(reverse);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode value via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 10,
      kind: 'session-mode-changed' as const,
      actor: USER_ID,
      payload: { ...valid, new_mode: 'concluded' },
      createdAt: '2026-05-17T12:00:00Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'session-mode-changed'");
  });

  it('rejects a missing changed_by', () => {
    const { changed_by: _ignored, ...partial } = valid;
    void _ignored;
    const result = sessionModeChangedPayloadSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID changed_by', () => {
    const result = sessionModeChangedPayloadSchema.safeParse({
      ...valid,
      changed_by: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO changed_at', () => {
    const result = sessionModeChangedPayloadSchema.safeParse({ ...valid, changed_at: 'tomorrow' });
    expect(result.success).toBe(false);
  });
});

// -- withdraw-agreement payload schema -------------------------------
//
// Per ADR 0030 §3 — promoted from a `vote.choice = 'withdraw'` variant
// to its own top-level event kind. Payload addresses the targeted
// facet directly via `(entity_kind, entity_id, facet)`. `entity_kind`
// is intentionally NARROWER than `entityKindSchema` (no `'annotation'`)
// because facet-valued proposals only target nodes and edges in v1.

describe('withdraw-agreement payload schema', () => {
  const valid = {
    entity_kind: 'node' as const,
    entity_id: NODE_ID,
    facet: 'classification' as const,
    participant: PARTICIPANT_ID,
    withdrawn_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = withdrawAgreementPayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(withdrawAgreementPayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts edge as entity_kind', () => {
    const result = withdrawAgreementPayloadSchema.safeParse({
      ...valid,
      entity_kind: 'edge',
      entity_id: EDGE_ID,
      facet: 'substance',
    });
    expect(result.success).toBe(true);
  });

  it('accepts substance and wording as facet values', () => {
    for (const facet of ['substance', 'wording'] as const) {
      const result = withdrawAgreementPayloadSchema.safeParse({ ...valid, facet });
      expect(result.success).toBe(true);
    }
  });

  it("rejects 'annotation' as entity_kind (narrower than entityKindSchema)", () => {
    const result = withdrawAgreementPayloadSchema.safeParse({
      ...valid,
      entity_kind: 'annotation',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID entity_id', () => {
    const result = withdrawAgreementPayloadSchema.safeParse({ ...valid, entity_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID participant', () => {
    const result = withdrawAgreementPayloadSchema.safeParse({ ...valid, participant: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown facet value', () => {
    const result = withdrawAgreementPayloadSchema.safeParse({ ...valid, facet: 'shape' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO withdrawn_at', () => {
    const result = withdrawAgreementPayloadSchema.safeParse({ ...valid, withdrawn_at: 'today' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing facet', () => {
    const { facet: _ignored, ...partial } = valid;
    void _ignored;
    const result = withdrawAgreementPayloadSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it('rejects a missing withdrawn_at', () => {
    const { withdrawn_at: _ignored, ...partial } = valid;
    void _ignored;
    const result = withdrawAgreementPayloadSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it('routes a payload-shape error through validateEvent naming the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 20,
      kind: 'withdraw-agreement' as const,
      actor: PARTICIPANT_ID,
      payload: { ...valid, entity_kind: 'annotation' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'withdraw-agreement'");
  });
});

describe('facetNameSchema (Zod enum mirror of FacetName)', () => {
  it('accepts the three v1 facet values', () => {
    for (const facet of ['classification', 'substance', 'wording'] as const) {
      expect(facetNameSchema.safeParse(facet).success).toBe(true);
    }
  });

  it('rejects values outside the v1 facet vocabulary', () => {
    for (const facet of ['shape', 'role', 'content', '', null, 42]) {
      expect(facetNameSchema.safeParse(facet).success).toBe(false);
    }
  });
});

describe('validateEvent failure paths', () => {
  it('throws on an unknown kind', () => {
    const bogus = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      kind: 'no-such-kind',
      actor: ACTOR_ID,
      payload: {},
      createdAt: '2026-05-10T12:34:56Z',
    };
    expect(() => validateEvent(bogus)).toThrow(EventValidationError);
  });

  it('throws on a payload-shape error and names the kind', () => {
    const bad = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      kind: 'vote',
      actor: ACTOR_ID,
      payload: {
        target: 'proposal',
        proposal_id: PROPOSAL_ID,
        participant: PARTICIPANT_ID,
        choice: 'maybe',
        voted_at: '2026-05-10T12:34:56Z',
      },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'vote'");
  });

  it('rejects a non-integer sequence at the envelope level', () => {
    const bad = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 1.5,
      kind: 'vote',
      actor: ACTOR_ID,
      payload: {
        target: 'proposal',
        proposal_id: PROPOSAL_ID,
        participant: PARTICIPANT_ID,
        choice: 'agree',
        voted_at: '2026-05-10T12:34:56Z',
      },
      createdAt: '2026-05-10T12:34:56Z',
    };
    const result = eventEnvelopeSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// -- Property-style round-trip across every kind ---------------------
//
// For each registered kind, build a representative payload, parse it
// through the registry's schema, JSON-serialize it, parse it again,
// and assert equality. All thirteen kinds are tightened today; each
// representative exercises its full payload shape.

const REPRESENTATIVE_PAYLOADS: Record<EventKind, unknown> = {
  'session-created': {
    host_user_id: HOST_USER_ID,
    privacy: 'public',
    topic: 'A topic',
    created_at: '2026-05-10T12:34:56Z',
  },
  'session-ended': { ended_at: '2026-05-10T13:00:00Z' },
  'participant-joined': {
    user_id: USER_ID,
    role: 'moderator',
    screen_name: 'Mod',
    joined_at: '2026-05-10T12:35:00Z',
  },
  'participant-left': { user_id: USER_ID, left_at: '2026-05-10T12:55:00Z' },
  'node-created': {
    node_id: NODE_ID,
    wording: 'A capital-N node statement.',
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  },
  'edge-created': {
    edge_id: EDGE_ID,
    role: 'supports',
    source_node_id: NODE_ID,
    target_node_id: NODE_ID_2,
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  },
  'annotation-created': {
    annotation_id: ANNOTATION_ID,
    kind: 'note',
    content: 'A note on the node above.',
    target_node_id: NODE_ID,
    target_edge_id: null,
    created_by: USER_ID,
    created_at: '2026-05-10T12:34:56Z',
  },
  'entity-included': {
    entity_kind: 'node',
    entity_id: NODE_ID,
    included_by: USER_ID,
    included_at: '2026-05-10T12:34:56Z',
  },
  proposal: {
    proposal: {
      kind: 'classify-node',
      node_id: NODE_ID,
      classification: 'fact',
    },
  },
  vote: {
    target: 'facet',
    entity_kind: 'node',
    entity_id: NODE_ID,
    facet: 'classification',
    participant: PARTICIPANT_ID,
    choice: 'agree',
    voted_at: '2026-05-10T12:34:56Z',
  },
  // `commit` is a `target`-discriminated union per ADR 0030 §2 + §9.
  // The representative is the facet-keyed arm; both arms are covered
  // exhaustively by the dedicated `commit payload schema — *` describes
  // above.
  commit: {
    target: 'facet',
    entity_kind: 'node',
    entity_id: NODE_ID,
    facet: 'classification',
    committed_by: USER_ID,
    committed_at: '2026-05-10T12:34:56Z',
  },
  // `meta-disagreement-marked` is a `target`-discriminated union per
  // ADR 0030 §2 + §9. The representative is the facet-keyed arm; both
  // arms are covered exhaustively by the dedicated
  // `meta-disagreement-marked payload schema — *` describes above.
  'meta-disagreement-marked': {
    target: 'facet',
    entity_kind: 'node',
    entity_id: NODE_ID,
    facet: 'classification',
    marked_by: USER_ID,
    marked_at: '2026-05-10T12:34:56Z',
  },
  'snapshot-created': {
    snapshot_id: SNAPSHOT_ID,
    label: 'Segment 1 close',
    log_position: 42,
  },
  'entity-removed': {
    entity_kind: 'node',
    entity_id: NODE_ID,
    removed_by: USER_ID,
    removed_at: '2026-05-10T12:34:56Z',
  },
  'session-mode-changed': {
    previous_mode: 'lobby',
    new_mode: 'operate',
    changed_by: USER_ID,
    changed_at: '2026-05-17T12:00:00Z',
  },
  'withdraw-agreement': {
    entity_kind: 'node',
    entity_id: NODE_ID,
    facet: 'classification',
    participant: PARTICIPANT_ID,
    withdrawn_at: '2026-05-10T12:34:56Z',
  },
};

describe('every kind round-trips through its registry schema', () => {
  // One sub-test per kind so a per-kind regression points at the
  // offending kind directly.
  for (const kind of eventKinds) {
    it(`round-trips '${kind}'`, () => {
      const schema = eventPayloadSchemas[kind];
      const representative = REPRESENTATIVE_PAYLOADS[kind];
      const parsed = schema.parse(representative);
      const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
      const reparsed = schema.parse(wire);
      expect(reparsed).toEqual(representative);
    });
  }
});
