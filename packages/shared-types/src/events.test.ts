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
  edgeCreatedPayloadSchema,
  entityIncludedPayloadSchema,
  eventEnvelopeSchema,
  eventKinds,
  eventPayloadSchemas,
  nodeCreatedPayloadSchema,
  participantJoinedPayloadSchema,
  participantLeftPayloadSchema,
  sessionCreatedPayloadSchema,
  sessionEndedPayloadSchema,
  validateEvent,
  votePayloadSchema,
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

describe('EventEnvelope round-trip', () => {
  it('serializes and re-validates a `vote` envelope unchanged', () => {
    const original: EventEnvelope<'vote'> = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 42,
      kind: 'vote',
      actor: ACTOR_ID,
      payload: {
        proposal_id: PROPOSAL_ID,
        participant: PARTICIPANT_ID,
        vote: 'agree',
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

describe('vote payload schema', () => {
  const valid = {
    proposal_id: PROPOSAL_ID,
    participant: PARTICIPANT_ID,
    vote: 'agree' as const,
    voted_at: '2026-05-10T12:34:56Z',
  };

  it('round-trips a well-formed payload through JSON', () => {
    const parsed = votePayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(votePayloadSchema.parse(wire)).toEqual(valid);
  });

  it('accepts each of agree / dispute / withdraw', () => {
    for (const vote of ['agree', 'dispute', 'withdraw'] as const) {
      const result = votePayloadSchema.safeParse({ ...valid, vote });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown vote value via validateEvent and names the kind', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 8,
      kind: 'vote' as const,
      actor: ACTOR_ID,
      payload: { ...valid, vote: 'maybe' },
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
    const result = votePayloadSchema.safeParse(withoutVotedAt);
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
    ] as const;
    for (const kind of expectedKinds) {
      expect(eventPayloadSchemas[kind]).toBeDefined();
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
        proposal_id: PROPOSAL_ID,
        participant: PARTICIPANT_ID,
        vote: 'maybe',
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
        proposal_id: PROPOSAL_ID,
        participant: PARTICIPANT_ID,
        vote: 'agree',
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
// and assert equality. Tight schemas exercise their full shape;
// placeholder kinds get `{}` (the placeholder accepts any object —
// downstream `event_types.*` tasks replace these representatives as
// each kind tightens).

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
    proposal_id: PROPOSAL_ID,
    participant: PARTICIPANT_ID,
    vote: 'agree',
    voted_at: '2026-05-10T12:34:56Z',
  },
  commit: {},
  'meta-disagreement-marked': {},
  'snapshot-created': {},
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
