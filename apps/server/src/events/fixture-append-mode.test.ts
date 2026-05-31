// Walkthrough-fixture append-mode semantics-preservation cover (R23).
//
// Refinement: tasks/refinements/data-and-methodology/
//             r23_loader_replay_through_append_for_walkthrough.md
//
// **What this pins.** When `loadFixture('walkthrough', ...)` is run
// twice — once in raw-INSERT mode and once with the real
// `appendSessionEvent` helper as `options.appendEvent` — the
// resulting `session_events` rows agree on the projection-relevant
// columns `(id, session_id, sequence, kind, actor, payload)`.
// `created_at` is allowed to differ (raw mode writes the fixture's
// encoded timestamp; append mode falls back to the DB default
// `NOW()`).
//
// **Why this is the integration cover.** The mini-driver in
// `packages/test-fixtures/src/loader.test.ts` pins the validation
// gate without needing a real DB or the real append helper. This
// test is the other half: real pglite, real migrations, real
// `appendSessionEvent`. Together they pin the contract end-to-end.
// The walkthrough's 5 Cucumber scenarios on top run the projection
// over the result and act as the regression cover for any subtle
// drift beyond the row-equality property checked here.
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
const appendForFixture: NonNullable<LoadFixtureOptions['appendEvent']> = async (client, event) => {
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

async function readEventsForCompare(db: PGlite): Promise<
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
    [WALKTHROUGH_SESSION_ID],
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

describe('loadFixture append-mode (R23) — semantics preservation', () => {
  it('produces the same session_events rows as the raw-INSERT default for the walkthrough', async () => {
    // Two fresh pglite handles — one per loader mode. Both run the
    // full migration chain so the `session_events` schema is
    // identical to production's.
    const rawDb = new PGlite();
    const appendDb = new PGlite();
    try {
      await applyMigrations(rawDb);
      await applyMigrations(appendDb);

      await loadFixture('walkthrough', asLoadFixtureClient(rawDb));
      await loadFixture('walkthrough', asLoadFixtureClient(appendDb), {
        appendEvent: appendForFixture,
      });

      const rawRows = await readEventsForCompare(rawDb);
      const appendRows = await readEventsForCompare(appendDb);

      // Same row count, same ordering, same projection-relevant
      // columns. `created_at` is deliberately excluded — see file
      // header (raw mode preserves the fixture's encoded
      // timestamp; append mode falls back to the DB default).
      expect(appendRows.length).toBe(rawRows.length);
      expect(rawRows.length).toBeGreaterThan(200);
      expect(appendRows).toEqual(rawRows);
    } finally {
      await rawDb.close();
      await appendDb.close();
    }
    // The walkthrough has ~266 events; pglite + 2 full loads can take a
    // few seconds. Bumped from the default 5s.
  }, 30_000);
});
