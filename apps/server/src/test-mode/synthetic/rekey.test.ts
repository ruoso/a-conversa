// Re-keyer tests — validity, no-leak, cross-reference integrity, user
// mapping, determinism/disjointness, sequence allocation.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_scenario_library.md
// ADRs:        docs/adr/0042-runtime-fixture-reuse-via-vendored-module.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// Runs against the *vendored* walkthrough data (the committed
// `walkthrough.data.ts`) — the same `const` the runtime builder feeds the
// re-keyer — so these pins cover the real instantiation path end to end.

import { describe, expect, it } from 'vitest';

import { validateEvent } from '@a-conversa/shared-types';

import { rekeyFixture, type IdFactory, type VendoredFixture } from './rekey.js';
import { SYNTHETIC_DEBATER_A, SYNTHETIC_DEBATER_B } from './scenarios.js';
import { walkthroughFixtureData } from './walkthrough.data.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A deterministic UUID stream — distinct `prefix` ⇒ disjoint streams. */
function makeIdFactory(prefix: string): IdFactory {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  };
}

/** Recursively collect every UUID-shaped string (id-bearing fields). */
function collectUuids(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (UUID_RE.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUuids(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectUuids((value as Record<string, unknown>)[key], out);
    }
  }
}

// Normalize a snake-case fixture event to the camelCase envelope key
// ORDER the re-keyer emits, so a positional UUID walk over source and
// output stays aligned field-for-field.
function normalizeSource(e: VendoredFixture['events'][number]): unknown {
  return {
    id: e.id,
    sessionId: e.session_id,
    sequence: e.sequence,
    kind: e.kind,
    actor: e.actor,
    createdAt: e.created_at,
    payload: e.payload,
  };
}

const HOST_USER_ID = '0c0c0c0c-0000-4000-8000-0000000000c0';
const SESSION_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const ALLOWED_USERS = new Set([HOST_USER_ID, SYNTHETIC_DEBATER_A.id, SYNTHETIC_DEBATER_B.id]);

// The enumerated user/actor-bearing payload field names (Constraint §3).
const USER_FIELDS = new Set([
  'host_user_id',
  'user_id',
  'created_by',
  'included_by',
  'committed_by',
  'marked_by',
  'changed_by',
  'withdrawn_by',
  'removed_by',
  'participant',
]);

function assertUserFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) assertUserFields(v);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (USER_FIELDS.has(key) && typeof v === 'string') {
        expect(ALLOWED_USERS.has(v), `user field "${key}"=${v} resolves to a seeded user`).toBe(
          true,
        );
      }
      assertUserFields(v);
    }
  }
}

function build(prefix: string, sessionId: string = SESSION_ID) {
  return rekeyFixture(walkthroughFixtureData, {
    sessionId,
    hostUserId: HOST_USER_ID,
    idFactory: makeIdFactory(prefix),
  });
}

describe('rekeyFixture — walkthrough', () => {
  it('emits a contiguous-from-1 sequence matching the fixture event count', () => {
    const events = build('f0000001');
    expect(events.length).toBe(walkthroughFixtureData.events.length);
    expect(events.map((e) => e.sequence)).toEqual(
      Array.from({ length: events.length }, (_, i) => i + 1),
    );
  });

  it('every emitted event passes validateEvent (ADR 0021 conformance)', () => {
    const events = build('f0000002');
    for (const event of events) {
      expect(() => validateEvent(event)).not.toThrow();
    }
  });

  it('leaks no canonical fixture id into any id-bearing field', () => {
    const events = build('f0000003');

    const canonical: string[] = [];
    collectUuids(walkthroughFixtureData.session, canonical);
    collectUuids(walkthroughFixtureData.participants, canonical);
    collectUuids(walkthroughFixtureData.events, canonical);
    const canonicalSet = new Set(canonical);
    expect(canonicalSet.size).toBeGreaterThan(0);

    const emitted: string[] = [];
    collectUuids(events, emitted);
    for (const id of emitted) {
      expect(canonicalSet.has(id), `emitted id ${id} is not a canonical fixture id`).toBe(false);
    }
  });

  it('preserves cross-references — same canonical id ⇒ same fresh id, one-to-one', () => {
    const events = build('f0000004');
    const source = walkthroughFixtureData.events;
    expect(events.length).toBe(source.length);

    const canonToFresh = new Map<string, string>();
    const freshToCanon = new Map<string, string>();
    for (let i = 0; i < events.length; i += 1) {
      const src: string[] = [];
      collectUuids(normalizeSource(source[i]!), src);
      const out: string[] = [];
      collectUuids(events[i]!, out);
      // Same structure ⇒ same number of id-bearing fields, position-aligned.
      expect(out.length).toBe(src.length);
      for (let j = 0; j < src.length; j += 1) {
        const c = src[j]!;
        const f = out[j]!;
        // Cross-reference preservation: a canonical id always maps to the
        // same fresh id (so an edge still points at its node, etc.).
        if (canonToFresh.has(c)) {
          expect(canonToFresh.get(c)).toBe(f);
        } else {
          canonToFresh.set(c, f);
        }
        // Injectivity: distinct canonical ids never collide on one fresh id.
        if (freshToCanon.has(f)) {
          expect(freshToCanon.get(f)).toBe(c);
        } else {
          freshToCanon.set(f, c);
        }
      }
    }
  });

  it('resolves every user/actor field to one of the three seeded users', () => {
    const events = build('f0000005');
    for (const event of events) {
      expect(event.actor === null || ALLOWED_USERS.has(event.actor)).toBe(true);
      assertUserFields(event.payload);
    }
  });

  it('throws on a fixture user id outside the seeded participants (fail loud)', () => {
    const rogue: VendoredFixture = {
      session: {
        id: '10000005-0000-4000-8000-000000000001',
        host_user_id: '10000001-0000-4000-8000-00000000c001',
        privacy: 'public',
        topic: 'rogue',
        created_at: '2026-03-01T18:00:01.000Z',
      },
      participants: [
        {
          id: '10000006-0000-4000-8000-000000000001',
          session_id: '10000005-0000-4000-8000-000000000001',
          user_id: '10000001-0000-4000-8000-00000000c001',
          role: 'moderator',
          joined_at: '2026-03-01T18:00:01.000Z',
        },
        {
          id: '10000006-0000-4000-8000-000000000002',
          session_id: '10000005-0000-4000-8000-000000000001',
          user_id: '10000001-0000-4000-8000-00000000a001',
          role: 'debater-A',
          joined_at: '2026-03-01T18:00:02.000Z',
        },
        {
          id: '10000006-0000-4000-8000-000000000003',
          session_id: '10000005-0000-4000-8000-000000000001',
          user_id: '10000001-0000-4000-8000-00000000b001',
          role: 'debater-B',
          joined_at: '2026-03-01T18:00:03.000Z',
        },
      ],
      events: [
        {
          id: 'ee000000-0000-4000-8000-000000000001',
          session_id: '10000005-0000-4000-8000-000000000001',
          sequence: 1,
          kind: 'node-created',
          // A valid UUID, but NOT a seeded participant — must throw.
          actor: '99999999-0000-4000-8000-000000000099',
          payload: {
            node_id: '10000010-0000-4000-8000-000000000001',
            wording: 'rogue node',
            created_by: '99999999-0000-4000-8000-000000000099',
            created_at: '2026-03-01T18:00:04.000Z',
          },
          created_at: '2026-03-01T18:00:04.000Z',
        },
      ],
    };

    expect(() =>
      rekeyFixture(rogue, {
        sessionId: SESSION_ID,
        hostUserId: HOST_USER_ID,
        idFactory: makeIdFactory('f0000099'),
      }),
    ).toThrow(/not among the fixture's seeded participants/);
  });

  it('two generations produce disjoint session / entity / event ids', () => {
    const a = build('f0000010', 'aaaaaaaa-0000-4000-8000-00000000000a');
    const b = build('f0000020', 'bbbbbbbb-0000-4000-8000-00000000000b');

    // Distinct fresh session ids.
    expect(a[0]!.sessionId).not.toBe(b[0]!.sessionId);

    // The minted ids (every output UUID that is NOT a shared seeded user)
    // must be disjoint across the two runs.
    const minted = (events: ReturnType<typeof build>): Set<string> => {
      const ids: string[] = [];
      collectUuids(events, ids);
      return new Set(ids.filter((id) => !ALLOWED_USERS.has(id)));
    };
    const mintedA = minted(a);
    const mintedB = minted(b);
    expect(mintedA.size).toBeGreaterThan(0);
    for (const id of mintedA) {
      expect(mintedB.has(id), `minted id ${id} is disjoint across runs`).toBe(false);
    }
  });
});
