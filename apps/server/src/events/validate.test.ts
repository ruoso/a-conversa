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
  // `vote` is a `target`-discriminated union per ADR 0030 §2 + §9.
  // The representative is the facet-keyed arm; a dedicated test
  // (below) covers the proposal-keyed arm round-trip + a cross-arm
  // corruption case.
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
  // The representative is the facet-keyed arm; a dedicated test
  // (below) covers the proposal-keyed arm round-trip + cross-arm
  // corruption cases.
  commit: {
    target: 'facet',
    entity_kind: 'node',
    entity_id: NODE_ID,
    facet: 'classification',
    committed_by: USER_ID,
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

// -- KNOWN-LIMITATION: sequence safe-integer ceiling (G-010) ---------
//
// Per-session `session_events.sequence` values are JS `number`s, safe
// up to and including `Number.MAX_SAFE_INTEGER` (`2^53 - 1` =
// 9007199254740991). The pg driver returns BIGINT as a string by
// default; production code parses with `Number.parseInt(rawMax, 10)`
// at `propose.ts:232`, `vote.ts:184`, `commit.ts:188`,
// `meta-disagreement.ts:213`, and five sites in `sessions/routes.ts`.
//
// The LOAD-BEARING safety net for the propose / vote / commit /
// meta-disagreement write paths is THIS `validateEvent` gate: the
// event envelope schema constrains
// `sequence: z.number().int().nonnegative()` and Zod v4's `.int()`
// defers to `Number.isSafeInteger`, so any proposed write at sequence
// > `Number.MAX_SAFE_INTEGER` is rejected at write-time before the
// row hits the DB. The wire surface for that rejection is the
// dispatcher's `onHandlerError` seam — since `EventValidationError`
// is NOT `ApiError`-shaped (see `apps/server/src/ws/dispatcher.ts`'s
// `isApiErrorShape` check), the client sees a generic
// `code: 'internal-error'` envelope, not a typed `'sequence-overflow'`.
// The handler's `validateEvent(emitted)` call (e.g., `propose.ts:305`)
// throws inside `withTransaction`; the transaction rolls back; no
// row is appended. The connection stays open — a per-message
// validation failure is recoverable.
//
// Why these pins live HERE and not in `ws/handlers/propose.test.ts`:
// the propose handler runs `projectFromLog(priorEvents, sessionId)`
// over every prior event, and the projection's per-event check at
// `apps/server/src/projection/replay.ts:780` enforces "next event's
// sequence is exactly `lastAppliedSequence + 1`," throwing
// `OutOfOrderEventError` on any gap. Seeding a `participant-joined`
// at `MAX_SAFE_INTEGER` requires `MAX_SAFE_INTEGER - 1` prior events
// (impossible to enumerate). Mocking the projection would break the
// integration property the propose-test layer exists to verify. The
// closest *faithful* test is at THIS gate: `validateEvent`'s schema
// check on a candidate event at the boundary value. Pinning here
// is cheap, fast, and verifies the actual safety net.
//
// No typed `sequence-overflow` wire code today; the structural fix
// is a future `sequence_bigint_storage` task (bigint columns +
// bigint-aware JS handling). When that task lands, pin #1 stays
// (`MAX_SAFE_INTEGER` accepted), pin #2 inverts (sequence > 2^53
// would become acceptable), and pin #3 becomes obsolete (bigint
// math is precise past 2^53). See
// `tasks/refinements/backend-hardening/bigint_sequence_overflow_pin.md`.
describe('validateEvent — KNOWN-LIMITATION: sequence safe-integer ceiling (G-010)', () => {
  it('SAFE: accepts sequence = Number.MAX_SAFE_INTEGER (the boundary)', () => {
    // The ceiling itself IS a safe integer; only values past it fail.
    // Pinning that the safe boundary is exactly `MAX_SAFE_INTEGER`
    // catches a regression that introduced a cap BELOW this (e.g., an
    // over-eager DoS guard at `MAX_SAFE_INTEGER / 2`) or that swapped
    // `.int()` for a stricter predicate. A regression here would
    // surface as a deployment failure when a real session crossed
    // the new (wrong) cap; pinning the boundary is the early-warning.
    const candidate = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, {
      sequence: Number.MAX_SAFE_INTEGER,
    });
    // Sanity-check the precondition: MAX_SAFE_INTEGER IS a safe
    // integer (ESLint's `no-loss-of-precision` won't fire on the
    // built-in constant).
    expect(Number.isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    const validated = validateEvent(candidate);
    expect(validated.kind).toBe('vote');
    expect(validated.sequence).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("UNSAFE: rejects sequence = Number.MAX_SAFE_INTEGER + 1 with code: 'envelope-invalid'", () => {
    // `Number.MAX_SAFE_INTEGER + 1` = 9007199254740992 — NOT a safe
    // integer (`Number.isSafeInteger(MAX_SAFE_INTEGER + 1) === false`).
    // The envelope schema's `sequence: z.number().int().nonnegative()`
    // constraint (Zod v4's `.int()` defers to `Number.isSafeInteger`)
    // rejects it; the wrapper classifies the failure as
    // `'envelope-invalid'` with `kind: null` (the violation is on the
    // envelope's `sequence` field, not the per-kind payload).
    //
    // This is the load-bearing safety net for the propose / vote /
    // commit / meta-disagreement WS handlers: when the engine emits
    // an event with `sequence = MAX(sequence) + 1` and that next
    // allocation crosses the safe-integer ceiling, this gate rejects
    // it BEFORE the INSERT lands. The wire surface (downstream
    // consequence) is the dispatcher's generic `internal-error`
    // envelope; the connection stays open. See the block comment
    // above for the full chain.
    //
    // When the future `sequence_bigint_storage` task lands, this
    // assertion inverts: bigint sequences > 2^53 become acceptable
    // and the propose chain no longer needs the safety net.
    const seq = Number.MAX_SAFE_INTEGER + 1;
    // Sanity-check the precondition this pin depends on. If a future
    // ES spec change re-defines MAX_SAFE_INTEGER or relaxes
    // `Number.isSafeInteger`, this pin will need to be revisited —
    // failing here is the early-warning signal.
    expect(Number.isSafeInteger(seq)).toBe(false);
    const bad = envelope('vote', REPRESENTATIVE_PAYLOADS.vote, { sequence: seq });
    const error = captureError(bad);
    expect(error.code).toBe('envelope-invalid');
    expect(error.kind).toBeNull();
    expect(error.issues.length).toBeGreaterThan(0);
    // At least one Zod issue must be rooted at the `sequence` field —
    // otherwise a future regression that returns the right error
    // CODE but for the wrong FIELD (e.g., an actor-related rejection
    // that also happens to be envelope-invalid) would pass this test
    // for the wrong reason.
    expect(error.issues.some((issue) => issue.path === 'sequence')).toBe(true);
  });

  it('PRECISION-LOSS: Number.parseInt("9007199254740993", 10) === 9007199254740992 — pins the silent precision-loss formula G-010 names', () => {
    // Direct pin of the JS-runtime fact G-010's adversarial-scenario
    // hypothesis depends on. The pg driver returns BIGINT as a
    // string; `propose.ts:232` (and the eight sibling parseInt call
    // sites named in the refinement) parse the string with
    // `Number.parseInt(rawMax, 10)`. For any value strictly above
    // `Number.MAX_SAFE_INTEGER`, the parse silently rounds to the
    // nearest representable IEEE 754 double — there is NO runtime
    // exception, NO console warning, NO loss-of-precision sentinel.
    //
    // Why this matters: if a non-application-mediated INSERT (DBA
    // error, hand-crafted migration, restore-from-backup with a
    // poison row, ...) ever lands a row with `sequence =
    // 9007199254740993`, the next propose's `MAX(sequence)` read
    // returns the string '9007199254740993', the parseInt produces
    // 9007199254740992 (one less in math), and the propose-handler
    // chain runs against the wrong value. The application-mediated
    // write path is still protected by `validateEvent` (per the
    // UNSAFE pin above — the engine's emitted event at
    // `nextSeq = parsedMax + 1 = 9007199254740993` would fail
    // `validateEvent`'s `.int()` check), but the precision-loss
    // formula itself is the empirical fact this pin makes visible
    // to the auditor.
    //
    // The literal is written as a string (not as a numeric literal)
    // so ESLint's `no-loss-of-precision` rule doesn't fire on what
    // is exactly the condition being pinned.
    const rawFromDb = '9007199254740993'; // one past MAX_SAFE_INTEGER
    const parsed = Number.parseInt(rawFromDb, 10);
    // The mathematical value 9007199254740993 is not representable
    // as an IEEE 754 double; the nearest representable value is
    // 9007199254740992 (= MAX_SAFE_INTEGER + 1).
    expect(parsed).toBe(Number.MAX_SAFE_INTEGER + 1);
    // The parsed value is NOT a safe integer — feeding it forward
    // into an event envelope would fail validation per the UNSAFE
    // pin above.
    expect(Number.isSafeInteger(parsed)).toBe(false);
    // And critically: the parsed value is NOT the original DB value.
    // This silent inequality is the structural foundation of the
    // G-010 adversarial scenario.
    expect(String(parsed)).not.toBe(rawFromDb);
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
  // Corrupting `choice` to an unknown value rejects on the facet-arm
  // schema (`z.enum(['agree', 'dispute'])`). The cross-arm
  // corruption — a `target: 'facet'` payload missing entity fields —
  // is exercised separately in `describe('vote — proposal arm + cross-arm')`.
  vote: (base) => ({ ...base, choice: 'maybe' }),
  // Corrupting `entity_kind` to 'annotation' (which the facet arm
  // rejects — facet-valued proposals only target nodes and edges) is
  // the cheapest payload-level corruption for the facet arm. The
  // cross-arm corruption (a `target: 'facet'` payload missing the
  // entity_id, or a `target: 'proposal'` payload missing proposal_id)
  // is exercised separately in `describe('validateEvent — commit payload …')`.
  commit: (base) => ({ ...base, entity_kind: 'annotation' }),
  'meta-disagreement-marked': (base) => ({ ...base, proposal_id: 'not-a-uuid' }),
  'snapshot-created': (base) => ({ ...base, log_position: -1 }),
  'entity-removed': (base) => ({ ...base, entity_kind: 'attribute' }),
  'session-mode-changed': (base) => ({ ...base, new_mode: 'concluded' }),
  // The narrower `entity_kind: 'node' | 'edge'` enum on the new kind
  // rejects 'annotation' (deliberately tighter than the entity-removed
  // and entity-included payloads — facet-valued proposals don't target
  // annotations in v1).
  'withdraw-agreement': (base) => ({ ...base, entity_kind: 'annotation' }),
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

// -- Vote payload — proposal-keyed arm + cross-arm corruption --------
//
// The kind-keyed `REPRESENTATIVE_PAYLOADS['vote']` table entry covers
// the facet-keyed arm. The proposal-keyed arm (per ADR 0030 §9 — votes
// against structural proposal sub-kinds) needs its own round-trip pin,
// and the discriminated union's cross-arm corruptions deserve explicit
// failure-mode coverage.
describe('validateEvent — vote payload proposal arm + cross-arm', () => {
  const proposalArmValid = {
    target: 'proposal' as const,
    proposal_id: PROPOSAL_ID,
    participant: PARTICIPANT_ID,
    choice: 'agree' as const,
    voted_at: '2026-05-10T12:34:56Z',
  };

  it('accepts a proposal-keyed vote envelope', () => {
    const candidate = envelope('vote', proposalArmValid);
    const validated = validateEvent(candidate);
    expect(validated.kind).toBe('vote');
  });

  it("rejects 'withdraw' as a vote choice (now its own event kind)", () => {
    const bad = envelope('vote', { ...proposalArmValid, choice: 'withdraw' });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('vote');
  });

  it('rejects a facet-arm payload missing entity_id (cross-arm corruption)', () => {
    const bad = envelope('vote', {
      target: 'facet',
      participant: PARTICIPANT_ID,
      choice: 'agree',
      voted_at: '2026-05-10T12:34:56Z',
    });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('vote');
  });

  it('rejects a proposal-arm payload missing proposal_id (cross-arm corruption)', () => {
    const bad = envelope('vote', {
      target: 'proposal',
      participant: PARTICIPANT_ID,
      choice: 'agree',
      voted_at: '2026-05-10T12:34:56Z',
    });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('vote');
  });

  it('rejects a payload missing the target discriminator', () => {
    const bad = envelope('vote', {
      proposal_id: PROPOSAL_ID,
      participant: PARTICIPANT_ID,
      choice: 'agree',
      voted_at: '2026-05-10T12:34:56Z',
    });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('vote');
  });

  it("rejects an unknown target value ('node')", () => {
    const bad = envelope('vote', { ...proposalArmValid, target: 'node' });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('vote');
  });
});

// -- Commit payload — proposal-keyed arm + cross-arm corruption ------
//
// The kind-keyed `REPRESENTATIVE_PAYLOADS['commit']` table entry covers
// the facet-keyed arm. The proposal-keyed arm (per ADR 0030 §9 — commits
// against structural proposal sub-kinds) needs its own round-trip pin,
// and the discriminated union's cross-arm corruptions deserve explicit
// failure-mode coverage.
describe('validateEvent — commit payload proposal arm + cross-arm', () => {
  const proposalArmValid = {
    target: 'proposal' as const,
    proposal_id: PROPOSAL_ID,
    committed_by: USER_ID,
    committed_at: '2026-05-10T12:34:56Z',
  };

  it('accepts a proposal-keyed commit envelope', () => {
    const candidate = envelope('commit', proposalArmValid);
    const validated = validateEvent(candidate);
    expect(validated.kind).toBe('commit');
  });

  it('rejects a facet-arm payload missing entity_id (cross-arm corruption)', () => {
    const bad = envelope('commit', {
      target: 'facet',
      committed_by: USER_ID,
      committed_at: '2026-05-10T12:34:56Z',
    });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('commit');
  });

  it('rejects a proposal-arm payload missing proposal_id (cross-arm corruption)', () => {
    const bad = envelope('commit', {
      target: 'proposal',
      committed_by: USER_ID,
      committed_at: '2026-05-10T12:34:56Z',
    });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('commit');
  });

  it('rejects a payload missing the target discriminator', () => {
    const bad = envelope('commit', {
      proposal_id: PROPOSAL_ID,
      committed_by: USER_ID,
      committed_at: '2026-05-10T12:34:56Z',
    });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('commit');
  });

  it("rejects an unknown target value ('node')", () => {
    const bad = envelope('commit', { ...proposalArmValid, target: 'node' });
    const error = captureError(bad);
    expect(error.code).toBe('payload-invalid');
    expect(error.kind).toBe('commit');
  });
});

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
    const bad = envelope('vote', { ...(REPRESENTATIVE_PAYLOADS.vote as object), choice: 'maybe' });
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
    const bad = envelope('vote', { ...(REPRESENTATIVE_PAYLOADS.vote as object), choice: 'maybe' });
    const error = captureError(bad);
    expect(error.cause).toBeDefined();
  });
});
