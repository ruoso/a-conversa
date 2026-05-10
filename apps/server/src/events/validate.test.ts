// Tests for the server-side `validateEvent` gate.
//
// Refinement: tasks/refinements/data-and-methodology/event_validation.md
// TaskJuggler: data_and_methodology.event_types.event_validation
//
// Coverage:
//   1. Round-trip — every registered kind passes through with a
//      representative payload.
//   2. Envelope-level failure modes (id / sessionId UUIDs, missing
//      kind, unknown kind, non-integer sequence) — assert
//      `code === 'envelope-invalid'` (or `'unknown-kind'` for the
//      unknown-kind case) and `kind === null` (or the recovered
//      kind string for `'unknown-kind'`).
//   3. Payload-level failure modes — at least one example per kind
//      where the payload is malformed, asserting
//      `code === 'payload-invalid'` and `kind === <the kind>`.
//   4. Property-style — for every kind in `eventKinds`, build a
//      representative payload (acceptance), then flip one field to
//      garbage (rejection) and confirm the rejection has
//      `code: 'payload-invalid'` and the right `kind`.
//
// Together these confirm the wrapper's behaviour matches the
// invariants the eventual server append path depends on.

import { describe, expect, it } from 'vitest';
import { type EventKind, eventKinds } from '@a-conversa/shared-types';

import { EventValidationError, validateEvent } from './validate.js';

// Valid sample UUIDs (v4: version-nibble = 4, variant-nibble in [89ab]).
// Same fixtures the shared-types tests use, so the two suites read
// the same way.
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

// One representative payload per registered kind. Mirrors the
// REPRESENTATIVE_PAYLOADS table in
// `packages/shared-types/src/events.test.ts` so the two test suites
// drift together if a payload shape changes.
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
  commit: {
    proposal_id: PROPOSAL_ID,
    moderator: USER_ID,
    committed_at: '2026-05-10T12:34:56Z',
  },
  'meta-disagreement-marked': {
    proposal_id: PROPOSAL_ID,
    moderator: USER_ID,
    marked_at: '2026-05-10T12:34:56Z',
  },
  'snapshot-created': {
    snapshot_id: SNAPSHOT_ID,
    label: 'Segment 1 close',
    log_position: 42,
  },
};

/** Build a full envelope around a payload for the given kind. */
function envelope<K extends EventKind>(
  kind: K,
  payload: unknown,
  overrides: Partial<{
    id: unknown;
    sessionId: unknown;
    sequence: unknown;
    actor: unknown;
    createdAt: unknown;
  }> = {},
): unknown {
  return {
    id: 'id' in overrides ? overrides.id : EVENT_ID,
    sessionId: 'sessionId' in overrides ? overrides.sessionId : SESSION_ID,
    sequence: 'sequence' in overrides ? overrides.sequence : 0,
    kind,
    actor: 'actor' in overrides ? overrides.actor : ACTOR_ID,
    payload,
    createdAt: 'createdAt' in overrides ? overrides.createdAt : '2026-05-10T12:34:56Z',
  };
}

/** Capture an error thrown by `validateEvent`, narrowed to our type. */
function captureError(input: unknown): EventValidationError {
  let caught: unknown;
  try {
    validateEvent(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EventValidationError);
  return caught as EventValidationError;
}

// -- Round-trip ------------------------------------------------------

describe('validateEvent — round-trip every kind', () => {
  for (const kind of eventKinds) {
    it(`accepts a well-formed '${kind}' envelope`, () => {
      const candidate = envelope(kind, REPRESENTATIVE_PAYLOADS[kind]);
      const validated = validateEvent(candidate);
      expect(validated.kind).toBe(kind);
    });
  }
});

// -- Envelope-level failure modes ------------------------------------

describe('validateEvent — envelope-level failures', () => {
  it("flags a non-UUID id as 'envelope-invalid' with kind: null", () => {
    const bad = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, { id: 'not-a-uuid' });
    const error = captureError(bad);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues[0]?.path.startsWith('payload')).toBe(false);
  });

  it("flags a non-UUID sessionId as 'envelope-invalid' with kind: null", () => {
    const bad = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, { sessionId: 'nope' });
    const error = captureError(bad);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
  });

  it("flags a missing kind as 'envelope-invalid' with kind: null", () => {
    // Build a raw object without a `kind` field at all.
    const raw = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      actor: ACTOR_ID,
      payload: REPRESENTATIVE_PAYLOADS.vote,
      createdAt: '2026-05-10T12:34:56Z',
    };
    const error = captureError(raw);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
  });

  it("flags an unknown kind as 'unknown-kind' with the recovered kind string", () => {
    const raw = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      kind: 'no-such-kind',
      actor: ACTOR_ID,
      payload: {},
      createdAt: '2026-05-10T12:34:56Z',
    };
    const error = captureError(raw);
    expect(error.code).toBe('unknown-kind');
    expect(error.kind).toBe('no-such-kind');
  });

  it("flags a non-integer sequence as 'envelope-invalid' with kind: null", () => {
    const bad = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, { sequence: 1.5 });
    const error = captureError(bad);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
  });

  it("flags a non-string actor (non-UUID) as 'envelope-invalid' with kind: null", () => {
    const bad = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, { actor: 'not-a-uuid' });
    const error = captureError(bad);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
  });

  it("flags a non-ISO createdAt as 'envelope-invalid' with kind: null", () => {
    const bad = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, { createdAt: 'tomorrow' });
    const error = captureError(bad);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
  });
});

// -- Payload-level failure modes (one per kind) ----------------------
//
// Each entry corrupts one field in the representative payload. The
// chosen corruption is type-incompatible with the schema (e.g. bad
// UUID, bad ISO string, unknown enum value, etc.) so it surfaces a
// payload-level Zod issue.
const PAYLOAD_CORRUPTIONS: Record<EventKind, (base: Record<string, unknown>) => unknown> = {
  'session-created': (base) => ({ ...base, host_user_id: 'not-a-uuid' }),
  'session-ended': (base) => ({ ...base, ended_at: 'tomorrow' }),
  'participant-joined': (base) => ({ ...base, user_id: 'not-a-uuid' }),
  'participant-left': (base) => ({ ...base, user_id: 'not-a-uuid' }),
  'node-created': (base) => ({ ...base, node_id: 'not-a-uuid' }),
  'edge-created': (base) => ({ ...base, role: 'undermines' }),
  'annotation-created': (base) => ({ ...base, kind: 'rebuttal' }),
  'entity-included': (base) => ({ ...base, entity_kind: 'attribute' }),
  // For `proposal` the payload nests; corrupt the inner proposal's
  // node_id (a UUID) to surface a payload-level failure two levels
  // deep, which the wrapper still classifies correctly.
  proposal: () => ({
    proposal: { kind: 'classify-node', node_id: 'not-a-uuid', classification: 'fact' },
  }),
  vote: (base) => ({ ...base, vote: 'maybe' }),
  commit: (base) => ({ ...base, proposal_id: 'not-a-uuid' }),
  'meta-disagreement-marked': (base) => ({ ...base, proposal_id: 'not-a-uuid' }),
  'snapshot-created': (base) => ({ ...base, log_position: -1 }),
};

describe('validateEvent — payload-level failure per kind', () => {
  for (const kind of eventKinds) {
    it(`flags a malformed '${kind}' payload as 'payload-invalid' with kind: '${kind}'`, () => {
      const base = REPRESENTATIVE_PAYLOADS[kind] as Record<string, unknown>;
      const corruption = PAYLOAD_CORRUPTIONS[kind];
      const badPayload = corruption(base);
      const bad = envelope(kind, badPayload);
      const error = captureError(bad);
      expect(error.code).toBe('payload-invalid');
      expect(error.kind).toBe(kind);
      expect(error.issues.length).toBeGreaterThan(0);
      // First issue must originate inside the payload tree.
      expect(error.issues[0]?.path.startsWith('payload')).toBe(true);
    });
  }
});

// -- Property-style sweep --------------------------------------------
//
// Per the refinement: synthesize a representative payload for every
// kind in the registry, confirm it's accepted, then flip one field
// to garbage and confirm rejection with the right `code` and
// `kind`. This is the small custom property generator the
// refinement calls for — a simple loop over `eventKinds`, no
// fast-check needed for v1. Together with the per-kind tests above
// it covers the full registry twice (acceptance and one rejection
// path) without duplicating the kind-by-kind shape knowledge.

describe('validateEvent — property-style sweep over every kind', () => {
  it('accepts a representative envelope for every kind', () => {
    for (const kind of eventKinds) {
      const candidate = envelope(kind, REPRESENTATIVE_PAYLOADS[kind]);
      // No throw expected.
      const validated = validateEvent(candidate);
      expect(validated.kind).toBe(kind);
    }
  });

  it('rejects every kind when one payload field is corrupted', () => {
    for (const kind of eventKinds) {
      const base = REPRESENTATIVE_PAYLOADS[kind] as Record<string, unknown>;
      const badPayload = PAYLOAD_CORRUPTIONS[kind](base);
      const bad = envelope(kind, badPayload);
      const error = captureError(bad);
      expect(error.code).toBe('payload-invalid');
      expect(error.kind).toBe(kind);
    }
  });
});

// -- Error shape (JSON serialization) --------------------------------

describe('EventValidationError JSON shape', () => {
  it('serializes to a stable JSON shape clients can deserialize', () => {
    const bad = envelope('vote', { ...(REPRESENTATIVE_PAYLOADS.vote as object), vote: 'maybe' });
    const error = captureError(bad);
    const json = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;
    expect(json.name).toBe('EventValidationError');
    expect(json.code).toBe('payload-invalid');
    expect(json.kind).toBe('vote');
    expect(Array.isArray(json.issues)).toBe(true);
    const issues = json.issues as Array<Record<string, unknown>>;
    expect(typeof issues[0]?.path).toBe('string');
    expect(typeof issues[0]?.message).toBe('string');
    expect(typeof issues[0]?.code).toBe('string');
  });

  it('preserves the underlying error as `cause` for server-side logging', () => {
    const bad = envelope('vote', { ...(REPRESENTATIVE_PAYLOADS.vote as object), vote: 'maybe' });
    const error = captureError(bad);
    expect(error.cause).toBeDefined();
  });
});
