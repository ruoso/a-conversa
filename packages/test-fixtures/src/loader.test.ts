// Loader + walkthrough-fixture schema cover.
//
// Per the walkthrough_replay_e2e refinement (D2 + "Constraints"): even
// though the loader uses raw INSERTs today (TODO(R23) — replay-through-
// append-API is deferred until event_validation + backend.api_skeleton
// land), the walkthrough fixture is authored to satisfy each per-kind Zod
// schema. This file is the discipline cover for that authoring contract —
// every event in the walkthrough's events.json round-trips through
// validateEvent, with createdAt mapped to ISO-8601 and the snake_case row
// keys remapped to the camelCase envelope shape the validator expects.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateEvent } from '@a-conversa/shared-types';
import { listFixtures } from './loader.js';

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
