// Vitest cover for the synthetic-scenario builders.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0006-test-framework-vitest.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// Pure-function tests (no DB needed — the builders carry no I/O). They
// pin, per Acceptance §2:
//
//   - validity: every event each builder emits passes the shared-types
//     `validateEvent` (ADR 0021 conformance);
//   - shape: sequences are contiguous ascending from 1; `empty` emits
//     `session-created` + three `participant-joined`; `structured` emits
//     the declared node-created / entity-included / proposal / vote /
//     commit shape;
//   - determinism: the same `(sessionId, hostUserId, idFactory)` yields a
//     deep-equal log;
//   - re-runnability: two invocations with distinct fresh ids produce
//     disjoint session / entity ids;
//   - referential integrity: every event carries the passed-in
//     `sessionId`, and the structured builder's references resolve within
//     its own emitted entity ids (no dangling reference).

import { describe, expect, it } from 'vitest';

import { validateEvent, type Event } from '@a-conversa/shared-types';

import {
  getScenarioBuilder,
  SYNTHETIC_SCENARIO_DESCRIPTORS,
  SYNTHETIC_SCENARIO_KEYS,
  type IdFactory,
} from './scenarios.js';

const SESSION_ID = '99999999-9999-4999-8999-999999999999';
const HOST_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Deterministic id factory yielding distinct valid UUIDs from a counter,
 * optionally with a per-run prefix nibble so two runs draw from disjoint
 * id spaces. The shape is a valid v4-style UUID so the emitted envelope
 * ids / entity ids pass `validateEvent`'s `z.string().uuid()` checks.
 */
function makeSeqIdFactory(runNibble = '0'): IdFactory {
  let counter = 0;
  return () => {
    const tail = counter.toString(16).padStart(11, '0');
    counter += 1;
    return `${runNibble}0000000-0000-4000-8000-0${tail}`;
  };
}

function build(key: string, idFactory: IdFactory): Event[] {
  const builder = getScenarioBuilder(key);
  if (builder === undefined) {
    throw new Error(`no builder for scenario '${key}'`);
  }
  return builder(SESSION_ID, HOST_ID, idFactory);
}

describe('synthetic scenario registry', () => {
  it('advertises descriptors whose keys all resolve to a builder', () => {
    expect(SYNTHETIC_SCENARIO_KEYS).toContain('empty');
    expect(SYNTHETIC_SCENARIO_KEYS).toContain('structured');
    for (const descriptor of SYNTHETIC_SCENARIO_DESCRIPTORS) {
      expect(descriptor.title.length).toBeGreaterThan(0);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(getScenarioBuilder(descriptor.key)).toBeTypeOf('function');
    }
  });

  it('returns undefined for an unknown scenario key', () => {
    expect(getScenarioBuilder('does-not-exist')).toBeUndefined();
  });
});

describe.each(SYNTHETIC_SCENARIO_KEYS)('builder %s — validity + shape', (key) => {
  it('emits only events that pass validateEvent', () => {
    const events = build(key, makeSeqIdFactory());
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      // Throws EventValidationError on any envelope / payload mismatch.
      expect(() => validateEvent(event)).not.toThrow();
    }
  });

  it('stamps contiguous ascending sequences from 1', () => {
    const events = build(key, makeSeqIdFactory());
    expect(events.map((e) => e.sequence)).toEqual(events.map((_e, i) => i + 1));
  });

  it('stamps the passed-in sessionId on every event', () => {
    const events = build(key, makeSeqIdFactory());
    for (const event of events) {
      expect(event.sessionId).toBe(SESSION_ID);
    }
  });

  it('mints unique event ids', () => {
    const events = build(key, makeSeqIdFactory());
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(events.length);
  });

  it('is deterministic for a fixed (sessionId, hostUserId, idFactory)', () => {
    expect(build(key, makeSeqIdFactory())).toEqual(build(key, makeSeqIdFactory()));
  });
});

describe('builder empty — declared shape', () => {
  it('emits session-created followed by three participant-joined', () => {
    const events = build('empty', makeSeqIdFactory());
    expect(events.map((e) => e.kind)).toEqual([
      'session-created',
      'participant-joined',
      'participant-joined',
      'participant-joined',
    ]);
  });
});

describe('builder structured — declared shape + referential integrity', () => {
  it('emits the node-created / entity-included / proposal / vote / commit shape', () => {
    const events = build('structured', makeSeqIdFactory());
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('node-created');
    expect(kinds).toContain('entity-included');
    expect(kinds).toContain('proposal');
    expect(kinds).toContain('vote');
    expect(kinds).toContain('commit');
  });

  it('resolves every entity reference within its own emitted node id (no dangling reference)', () => {
    const events = build('structured', makeSeqIdFactory());

    const nodeCreated = events.find((e) => e.kind === 'node-created');
    expect(nodeCreated).toBeDefined();
    const nodeId = (nodeCreated as Event & { kind: 'node-created' }).payload.node_id;

    const included = events.find((e) => e.kind === 'entity-included');
    expect((included as Event & { kind: 'entity-included' }).payload.entity_id).toBe(nodeId);

    const proposal = events.find((e) => e.kind === 'proposal');
    const proposalPayload = (proposal as Event & { kind: 'proposal' }).payload.proposal;
    expect(proposalPayload.kind).toBe('classify-node');
    if (proposalPayload.kind === 'classify-node') {
      expect(proposalPayload.node_id).toBe(nodeId);
    }

    for (const vote of events.filter((e) => e.kind === 'vote')) {
      const payload = (vote as Event & { kind: 'vote' }).payload;
      if (payload.target === 'facet') {
        expect(payload.entity_id).toBe(nodeId);
      }
    }

    const commit = events.find((e) => e.kind === 'commit');
    const commitPayload = (commit as Event & { kind: 'commit' }).payload;
    if (commitPayload.target === 'facet') {
      expect(commitPayload.entity_id).toBe(nodeId);
    }
  });
});

describe('builders — non-destructive re-runnability', () => {
  it('two invocations with distinct fresh ids produce disjoint session/entity ids', () => {
    const runA = build('structured', makeSeqIdFactory('a'));
    const runB = build('structured', makeSeqIdFactory('b'));

    // Disjoint event ids.
    const idsA = new Set(runA.map((e) => e.id));
    const idsB = new Set(runB.map((e) => e.id));
    for (const id of idsB) {
      expect(idsA.has(id)).toBe(false);
    }

    // Disjoint entity (node) ids.
    const nodeA = (runA.find((e) => e.kind === 'node-created') as Event & { kind: 'node-created' })
      .payload.node_id;
    const nodeB = (runB.find((e) => e.kind === 'node-created') as Event & { kind: 'node-created' })
      .payload.node_id;
    expect(nodeA).not.toBe(nodeB);
  });
});
