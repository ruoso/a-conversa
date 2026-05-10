// Tests for the event envelope, payload registry, and validateEvent.
//
// Refinement: tasks/refinements/data-and-methodology/event_base_envelope.md
// ADR: docs/adr/0021-event-envelope-discriminated-union-with-zod.md

import { describe, expect, it } from 'vitest';
import {
  type Event,
  type EventEnvelope,
  EventValidationError,
  eventEnvelopeSchema,
  eventPayloadSchemas,
  sessionCreatedPayloadSchema,
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
        ts: '2026-05-10T12:34:56Z',
      },
      createdAt: '2026-05-10T12:34:56Z',
    };
    expect(() => validateEvent(envelope)).not.toThrow();
  });
});

describe('session-created payload schema (worked example)', () => {
  it('accepts a well-formed payload', () => {
    const result = sessionCreatedPayloadSchema.safeParse({
      host_user_id: HOST_USER_ID,
      privacy: 'private',
      topic: 'Resolved: this is a debate motion',
      ts: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid privacy value', () => {
    const result = sessionCreatedPayloadSchema.safeParse({
      host_user_id: HOST_USER_ID,
      privacy: 'secret', // not in {public, private}
      topic: 'A topic',
      ts: '2026-05-10T12:34:56Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID host_user_id', () => {
    const result = sessionCreatedPayloadSchema.safeParse({
      host_user_id: 'not-a-uuid',
      privacy: 'public',
      topic: 'A topic',
      ts: '2026-05-10T12:34:56Z',
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
  it('accepts an empty object for `participant-joined` (downstream task tightens)', () => {
    // Placeholder accepts any object; once `session_lifecycle_events`
    // lands, this will require a tightened shape.
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'participant-joined' as const,
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
