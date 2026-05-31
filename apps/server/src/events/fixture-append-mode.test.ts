// Fixture-loader append-mode row-shape cover.
//
// Refinement: tasks/refinements/data-and-methodology/
//             empty_fixture_payload_tighten_for_append_mode.md
//             (originally seeded by r23_loader_replay_through_append_
//             for_walkthrough.md)
//
// **What this pins.** Each bundled fixture, loaded via the real
// `appendSessionEvent` against a fresh pglite, produces a well-shaped
// `session_events` row set: the row count matches the fixture's
// declared event count, every row's `(id, session_id, sequence, kind,
// actor)` survives the round-trip, and `payload` is non-null JSONB.
// `created_at` is deliberately not asserted — the helper writes the
// six core columns and lets the DB default (`NOW()`) fill in.
//
// **Why this is the integration cover.** The mini-driver in
// `packages/test-fixtures/src/loader.test.ts` pins the validation
// gate without needing a real DB or the real append helper. This
// test is the other half: real pglite, real migrations, real
// `appendSessionEvent`. Together they pin the contract end-to-end.
// The Cucumber walkthrough-replay and from-log scenarios on top run
// the projection over the result and act as the regression cover
// for any subtle drift beyond the row-shape property checked here.
//
// **Why it lives in `apps/server`, not in test-fixtures.** Both
// `loadFixture` and `appendSessionEvent` are imported here. The
// test-fixtures package's `rootDir` is `src` and apps → packages
// layering keeps the helper out of that package; the natural home
// for a test that exercises BOTH is the apps-side layer (which can
// depend on packages, the standard direction).

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PGlite } from '@electric-sql/pglite';

import {
  loadFixture,
  type LoadFixtureClient,
  type LoadFixtureOptions,
} from '@a-conversa/test-fixtures';

import { appendSessionEvent, type SessionEventAppendClient } from './append.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/server/src/events/ -> ../../.. -> repo root -> apps/server/migrations
const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'migrations');

const WALKTHROUGH_SESSION_ID = '10000005-0000-4000-8000-000000000001';
const EMPTY_SESSION_ID = '55555555-5555-4555-8555-555555555555';

// Minimal migrations runner — reads every `.sql` file under
// `apps/server/migrations/` in lex order and exec's it against the
// supplied pglite handle. Mirrors the cucumber-support
// `applyMigrations` (`tests/behavior/support/migrate.ts`); kept
// inline so the test stays self-contained.
async function applyMigrations(db: PGlite): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
  for (const filename of sqlFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
    await db.exec(sql);
  }
}

function asLoadFixtureClient(db: PGlite): LoadFixtureClient {
  return {
    query: (text, params) => db.query(text, params as unknown[] | undefined),
  };
}

// Bridge the loader's wider `LoadFixtureClient` to
// `appendSessionEvent`'s narrower `SessionEventAppendClient`. Both
// shapes are satisfied by the underlying pglite handle; the cast
// lives at the call site so the loader stays leaf-package-clean.
const appendForFixture: LoadFixtureOptions['appendEvent'] = async (client, event) => {
  await appendSessionEvent(client as unknown as SessionEventAppendClient, event);
};

interface DbEventRow {
  id: string;
  session_id: string;
  sequence: string | number;
  kind: string;
  actor: string | null;
  payload: unknown;
}

async function readEventRows(
  db: PGlite,
  sessionId: string,
): Promise<
  Array<{
    id: string;
    session_id: string;
    sequence: number;
    kind: string;
    actor: string | null;
    payload: unknown;
  }>
> {
  const res = await db.query<DbEventRow>(
    `SELECT id, session_id, sequence, kind, actor, payload
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
    [sessionId],
  );
  // Coerce `sequence` (BIGINT) to a JS number for stable comparison;
  // pglite's BIGINT may surface as string or number depending on the
  // driver build.
  return res.rows.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    sequence: Number(r.sequence),
    kind: r.kind,
    actor: r.actor,
    payload: r.payload,
  }));
}

describe('loadFixture append-mode — walkthrough fixture row shape', () => {
  it('writes a complete, well-shaped session_events row set via appendSessionEvent', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      await loadFixture('walkthrough', asLoadFixtureClient(db), {
        appendEvent: appendForFixture,
      });

      const rows = await readEventRows(db, WALKTHROUGH_SESSION_ID);

      // The walkthrough has ~266 events; pin a lower bound so a
      // regression that drops rows surfaces clearly.
      expect(rows.length).toBeGreaterThan(200);
      // Per-row shape: sequence is a 1-based monotonic count, ids
      // and session_id are non-empty UUIDs, kind is non-empty, and
      // payload is non-null JSONB.
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]!;
        expect(row.sequence).toBe(i + 1);
        expect(row.session_id).toBe(WALKTHROUGH_SESSION_ID);
        expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(row.kind.length).toBeGreaterThan(0);
        expect(row.payload).not.toBeNull();
      }
    } finally {
      await db.close();
    }
    // The walkthrough has ~266 events; pglite + full migration +
    // load takes a few seconds. Bumped from the default 5s.
  }, 30_000);
});

describe('loadFixture append-mode — empty fixture row shape', () => {
  it('writes the four empty-fixture session_events rows via appendSessionEvent', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      await loadFixture('empty', asLoadFixtureClient(db), {
        appendEvent: appendForFixture,
      });

      const rows = await readEventRows(db, EMPTY_SESSION_ID);

      // The empty fixture has exactly 4 events: one session-created
      // followed by three participant-joined, in sequence order.
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
      expect(rows.map((r) => r.kind)).toEqual([
        'session-created',
        'participant-joined',
        'participant-joined',
        'participant-joined',
      ]);
      expect(rows.map((r) => r.actor)).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ]);
      for (const row of rows) {
        expect(row.session_id).toBe(EMPTY_SESSION_ID);
        expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(row.payload).not.toBeNull();
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
