// Tests for the standalone `createSnapshot` helper.
//
// Refinement: tasks/refinements/data-and-methodology/snapshot_create_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.snapshot_create_logic
//
// The helper is not part of the `validateAction` dispatcher (see the
// handler's leading comment for why); the test file therefore imports
// `createSnapshot` directly from the handlers barrel rather than going
// through `validateAction`.
//
// Coverage map to the refinement's Acceptance criteria:
//   (a) valid label              — describe block 'valid label'.
//   (b) round-trip through schema — describe block 'schema round-trip'.
//   (c) trim                     — describe block 'trim rule'.
//   (d) empty label rejected     — describe block 'empty label'.
//   (e) whitespace-only rejected — describe block 'empty label'.
//   (f) over-cap rejected        — describe block 'length cap'.
//   (g) at-cap accepted          — describe block 'length cap'.
//   (h) trim then length check   — describe block 'length cap'.
//   (i) distinct UUIDs per call  — describe block 'UUID minting'.
//   (j) currentSequence zero     — describe block 'currentSequence boundary'.

import { describe, expect, it } from 'vitest';

import {
  MAX_SNAPSHOT_LABEL_LENGTH,
  snapshotCreatedPayloadSchema,
  validateEvent,
} from '@a-conversa/shared-types';

import { createSnapshot, type CreateSnapshotInput } from './createSnapshot.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const MODERATOR_ID = '22222222-2222-4222-8222-222222222222';
const T0 = '2026-05-31T12:00:00.000Z';

// Loose UUID-shape regex — RFC 4122 v4 form is what `randomUUID()` mints.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeInput(overrides: Partial<CreateSnapshotInput> = {}): CreateSnapshotInput {
  return {
    sessionId: SESSION_ID,
    moderatorId: MODERATOR_ID,
    label: 'Segment 1 close',
    currentSequence: 7,
    now: T0,
    ...overrides,
  };
}

describe('createSnapshot — valid label', () => {
  it('returns Valid with one snapshot-created envelope populated from the input', () => {
    const result = createSnapshot(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    const env = result.events[0]!;
    expect(env.kind).toBe('snapshot-created');
    expect(env.sessionId).toBe(SESSION_ID);
    expect(env.sequence).toBe(8);
    expect(env.actor).toBe(MODERATOR_ID);
    expect(env.createdAt).toBe(T0);
    expect(env.id).toMatch(UUID_V4_RE);
    if (env.kind !== 'snapshot-created') return;
    expect(env.payload.snapshot_id).toMatch(UUID_V4_RE);
    expect(env.payload.label).toBe('Segment 1 close');
    expect(env.payload.log_position).toBe(8);
    // Envelope id and payload snapshot_id are distinct identities by
    // construction (refinement Decisions §3).
    expect(env.id).not.toBe(env.payload.snapshot_id);
  });
});

describe('createSnapshot — schema round-trip', () => {
  it('emits a payload that satisfies snapshotCreatedPayloadSchema', () => {
    const result = createSnapshot(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    if (env.kind !== 'snapshot-created') return;
    const parsed = snapshotCreatedPayloadSchema.safeParse(env.payload);
    expect(parsed.success).toBe(true);
  });

  it('emits an envelope that passes validateEvent', () => {
    const result = createSnapshot(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    // `validateEvent` throws on mismatch; reaching the assertion proves
    // the envelope is schema-on-write compatible.
    expect(() => validateEvent(env)).not.toThrow();
  });
});

describe('createSnapshot — trim rule', () => {
  it('strips leading and trailing spaces from the label', () => {
    const result = createSnapshot(makeInput({ label: '  Segment 1 close  ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    if (env.kind !== 'snapshot-created') return;
    expect(env.payload.label).toBe('Segment 1 close');
  });

  it('strips tabs and newlines from both ends', () => {
    const result = createSnapshot(makeInput({ label: '\t\nFoo\n\t' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    if (env.kind !== 'snapshot-created') return;
    expect(env.payload.label).toBe('Foo');
  });
});

describe('createSnapshot — empty label', () => {
  it('rejects an empty string with invalid-label', () => {
    const result = createSnapshot(makeInput({ label: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-label');
    expect(result.detail).toContain('cannot be empty');
  });

  it('rejects a whitespace-only string with invalid-label (trim collapses it before the length check)', () => {
    const result = createSnapshot(makeInput({ label: '   ' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-label');
    expect(result.detail).toContain('cannot be empty');
  });
});

describe('createSnapshot — length cap', () => {
  it('rejects an over-cap label and names the actual length in the detail', () => {
    const overCap = 'x'.repeat(MAX_SNAPSHOT_LABEL_LENGTH + 1);
    const result = createSnapshot(makeInput({ label: overCap }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-label');
    expect(result.detail).toContain(`exceeds ${MAX_SNAPSHOT_LABEL_LENGTH} characters`);
    expect(result.detail).toContain(`got ${MAX_SNAPSHOT_LABEL_LENGTH + 1}`);
  });

  it('accepts a label exactly at the cap', () => {
    const atCap = 'x'.repeat(MAX_SNAPSHOT_LABEL_LENGTH);
    const result = createSnapshot(makeInput({ label: atCap }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    if (env.kind !== 'snapshot-created') return;
    expect(env.payload.label.length).toBe(MAX_SNAPSHOT_LABEL_LENGTH);
  });

  it('trims before measuring — a 132-char input that trims to 128 is accepted', () => {
    const padded = '  ' + 'x'.repeat(MAX_SNAPSHOT_LABEL_LENGTH) + '  ';
    const result = createSnapshot(makeInput({ label: padded }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    if (env.kind !== 'snapshot-created') return;
    expect(env.payload.label.length).toBe(MAX_SNAPSHOT_LABEL_LENGTH);
  });

  it('rejects a 129-char input with no trimmable whitespace', () => {
    const overCap = 'x'.repeat(MAX_SNAPSHOT_LABEL_LENGTH) + 'y';
    const result = createSnapshot(makeInput({ label: overCap }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-label');
  });
});

describe('createSnapshot — UUID minting', () => {
  it('mints distinct envelope id and snapshot_id on each call, never colliding', () => {
    const a = createSnapshot(makeInput());
    const b = createSnapshot(makeInput());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const ea = a.events[0]!;
    const eb = b.events[0]!;
    if (ea.kind !== 'snapshot-created' || eb.kind !== 'snapshot-created') return;
    // Envelope ids differ across calls.
    expect(ea.id).not.toBe(eb.id);
    // Payload snapshot_ids differ across calls.
    expect(ea.payload.snapshot_id).not.toBe(eb.payload.snapshot_id);
    // Envelope id and payload snapshot_id differ within each call.
    expect(ea.id).not.toBe(ea.payload.snapshot_id);
    expect(eb.id).not.toBe(eb.payload.snapshot_id);
  });
});

describe('createSnapshot — currentSequence boundary', () => {
  it('accepts currentSequence: 0 — the first snapshot in a fresh session takes sequence 1 / log_position 1', () => {
    const result = createSnapshot(makeInput({ currentSequence: 0 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const env = result.events[0]!;
    expect(env.sequence).toBe(1);
    if (env.kind !== 'snapshot-created') return;
    expect(env.payload.log_position).toBe(1);
  });
});
