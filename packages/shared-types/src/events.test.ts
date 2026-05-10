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
  eventEnvelopeSchema,
  eventKinds,
  eventPayloadSchemas,
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
const PROPOSAL_EVENT_ID = '55555555-5555-4555-8555-555555555555';
const PARTICIPANT_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';

describe('EventEnvelope round-trip', () => {
  it('serializes and re-validates a `vote` envelope unchanged', () => {
    const original: EventEnvelope<'vote'> = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 42,
      kind: 'vote',
      actor: ACTOR_ID,
      payload: {
        proposal_event_id: PROPOSAL_EVENT_ID,
        participant_id: PARTICIPANT_ID,
        vote: 'agree',
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

describe('vote payload schema (worked example)', () => {
  it('accepts each of agree / dispute / withdraw', () => {
    for (const vote of ['agree', 'dispute', 'withdraw'] as const) {
      const result = votePayloadSchema.safeParse({
        proposal_event_id: PROPOSAL_EVENT_ID,
        participant_id: PARTICIPANT_ID,
        vote,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown vote value', () => {
    const result = votePayloadSchema.safeParse({
      proposal_event_id: PROPOSAL_EVENT_ID,
      participant_id: PARTICIPANT_ID,
      vote: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});

describe('placeholder payload schemas', () => {
  it('accepts an empty object for `proposal` (downstream task tightens)', () => {
    // Placeholder accepts any object; once `proposal_events` lands,
    // this will require a tightened shape.
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'proposal' as const,
      actor: ACTOR_ID,
      payload: {},
      createdAt: '2026-05-10T12:34:56Z',
    };
    expect(() => validateEvent(envelope)).not.toThrow();
  });

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
        proposal_event_id: PROPOSAL_EVENT_ID,
        participant_id: PARTICIPANT_ID,
        vote: 'maybe',
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
        proposal_event_id: PROPOSAL_EVENT_ID,
        participant_id: PARTICIPANT_ID,
        vote: 'agree',
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
  'node-created': {},
  'edge-created': {},
  'annotation-created': {},
  'entity-included': {},
  proposal: {},
  vote: {
    proposal_event_id: PROPOSAL_EVENT_ID,
    participant_id: PARTICIPANT_ID,
    vote: 'agree',
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
