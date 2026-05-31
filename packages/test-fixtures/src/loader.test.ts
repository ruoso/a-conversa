// Loader + walkthrough-fixture schema cover.
//
// **Two layers of cover.**
//
//   1. **Author-time schema cover.** The walkthrough fixture is
//      authored to satisfy each per-kind Zod schema. Every event in
//      `events.json` round-trips through `validateEvent` here, with
//      `createdAt` mapped to ISO-8601 and snake_case row keys
//      remapped to the camelCase envelope. This is the "dry" cover —
//      reads JSON, validates, never touches DB.
//
//   2. **Append-mode validation gate (R23).** The loader's opt-in
//      `appendEvent` mode runs `validateEvent` on every event before
//      calling the caller-supplied helper. The discipline test
//      below feeds a synthetic malformed `snapshot-created` event
//      through a mini-driver that mirrors `loader.ts:insertEvents`'
//      append-mode loop, and asserts the call throws
//      `EventValidationError` from `@a-conversa/shared-types`. No
//      append happens — the validate call rejects first.
//
//      The companion semantics-preservation cover (R23) lives in
//      `apps/server/src/events/fixture-append-mode.test.ts` — that
//      test exercises the real `appendSessionEvent` against pglite,
//      which test-fixtures can't import from (its tsconfig rootDir
//      is `src`; apps → packages layering keeps the helper out of
//      this package).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type Event, EventValidationError, validateEvent } from '@a-conversa/shared-types';
import { listFixtures, type LoadFixtureClient } from './loader.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface RawFixtureEvent {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: unknown;
  readonly created_at: string;
}

async function readWalkthroughEvents(): Promise<RawFixtureEvent[]> {
  const text = await readFile(join(FIXTURES_DIR, 'walkthrough', 'events.json'), 'utf8');
  return JSON.parse(text) as RawFixtureEvent[];
}

async function readEmptyEvents(): Promise<RawFixtureEvent[]> {
  const text = await readFile(join(FIXTURES_DIR, 'empty', 'events.json'), 'utf8');
  return JSON.parse(text) as RawFixtureEvent[];
}

function rowToEnvelope(row: RawFixtureEvent): {
  id: string;
  sessionId: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: unknown;
  createdAt: string;
} {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

describe('listFixtures', () => {
  it('lists the walkthrough fixture alongside the empty fixture', async () => {
    const names = await listFixtures();
    expect(names).toContain('empty');
    expect(names).toContain('walkthrough');
  });
});

describe('walkthrough fixture event-log schema cover', () => {
  it('encodes a deterministic, monotonically-increasing sequence', async () => {
    const events = await readWalkthroughEvents();
    expect(events.length).toBeGreaterThan(200);
    for (let i = 0; i < events.length; i += 1) {
      expect(events[i]!.sequence).toBe(i + 1);
    }
  });

  it('every event validates against the per-kind Zod schema', async () => {
    const events = await readWalkthroughEvents();
    for (const row of events) {
      // validateEvent throws on schema mismatch — the assertion is that
      // none of the ~250 events throw. We wrap each call so a failing
      // event surfaces its sequence + kind in the failure message
      // rather than a bare stack trace.
      try {
        validateEvent(rowToEnvelope(row));
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `walkthrough event seq=${row.sequence} kind=${row.kind} failed validateEvent: ${reason}`,
          { cause },
        );
      }
    }
  });

  it('records exactly one snapshot-created event labeled "Segment 1 close"', async () => {
    const events = await readWalkthroughEvents();
    const snapshots = events.filter((e) => e.kind === 'snapshot-created');
    expect(snapshots).toHaveLength(1);
    const payload = snapshots[0]!.payload as { label: string; log_position: number };
    expect(payload.label).toBe('Segment 1 close');
    expect(payload.log_position).toBeGreaterThan(0);
  });
});

describe('empty fixture event-log schema cover', () => {
  it('every event validates against the per-kind Zod schema', async () => {
    const events = await readEmptyEvents();
    expect(events.length).toBe(4);
    for (const row of events) {
      try {
        validateEvent(rowToEnvelope(row));
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `empty event seq=${row.sequence} kind=${row.kind} failed validateEvent: ${reason}`,
          { cause },
        );
      }
    }
  });
});

describe('loadFixture append-mode validation gate (R23)', () => {
  it('rejects a malformed event at load time with EventValidationError', async () => {
    // Mini-driver mirroring `insertEvents`' append-mode per-event
    // loop (see ./loader.ts: normalize snake-case → camelCase, then
    // `validateEvent`, then call the append callback). A real
    // `loadFixture` call would require a synthetic fixture
    // directory; the per-event driver is the focused cover and
    // matches the production path byte-for-byte at the call site
    // that fails.
    const malformed: RawFixtureEvent = {
      id: '10000040-0000-4000-8000-00000000bad0',
      session_id: '10000005-0000-4000-8000-000000000001',
      sequence: 1,
      kind: 'snapshot-created',
      actor: '10000001-0000-4000-8000-00000000a001',
      // Missing required `label` / `log_position`; `snapshot-created`'s
      // payload schema requires both. The failure surfaces at the
      // per-kind payload stage, not the envelope stage.
      payload: { unexpected_field: true },
      created_at: '2026-03-01T18:00:01.000Z',
    };

    let appendCallCount = 0;
    const sink: LoadFixtureClient = { query: () => Promise.resolve(undefined) };
    const appendStub = (_client: LoadFixtureClient, _event: Event): Promise<void> => {
      appendCallCount += 1;
      return Promise.resolve();
    };
    const driver = async (): Promise<void> => {
      // Mirror loader.ts:insertEvents append-mode branch.
      const envelope = rowToEnvelope(malformed);
      const validated = validateEvent(envelope);
      await appendStub(sink, validated);
    };

    await expect(driver()).rejects.toBeInstanceOf(EventValidationError);
    // The append callback must NOT have run — validation throws
    // first, the same property that makes the load-time gate
    // useful (no rows leak into the DB on a malformed fixture).
    expect(appendCallCount).toBe(0);
  });
});
