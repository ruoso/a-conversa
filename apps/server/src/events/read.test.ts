// Unit suite for `readSessionEventsPage` (`read.ts`) against a real
// migrated schema in pglite. Verifies the forward, sequence-ordered,
// cursor-paginated read contract: ascending order, exclusive `after`
// cursor, `limit` capping, exact `nextCursor` via the look-ahead, and
// the empty-slice answer.
//
// Refinement: tasks/refinements/backend/get_session_log.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

import { readSessionEventsPage, type SessionEventReadExecutor } from './read.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/server/src/events/ -> ../../.. -> repo root -> apps/server/migrations
const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'migrations');

// Minimal migrations runner — reads every `.sql` file under
// `apps/server/migrations/` in lex order and exec's it against the
// supplied pglite handle. Mirrors `fixture-append-mode.test.ts`; kept
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

function asExecutor(db: PGlite): SessionEventReadExecutor {
  return {
    async query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const result = await db.query<TRow>(text, params as unknown[] | undefined);
      return { rows: result.rows };
    },
  };
}

/**
 * Seed a user + session and `count` `proposal` events (sequences
 * 1..count). Returns the session id. The FK chain
 * (session_events.session_id → sessions → users) is satisfied by the
 * seeded rows; `actor` is set to the seeded user.
 */
async function seedSessionWithEvents(db: PGlite, count: number): Promise<string> {
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) RETURNING id`,
    ['authelia:seed', 'seed-user'],
  );
  const userId = userRes.rows[0]!.id;
  const sessionRes = await db.query<{ id: string }>(
    `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, 'public', $2) RETURNING id`,
    [userId, 'seed topic'],
  );
  const sessionId = sessionRes.rows[0]!.id;
  for (let seq = 1; seq <= count; seq += 1) {
    await db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, 'proposal', $3, $4::jsonb)`,
      [sessionId, seq, userId, JSON.stringify({ n: seq })],
    );
  }
  return sessionId;
}

describe('readSessionEventsPage', () => {
  it('returns events in ascending sequence order', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 5);

      const page = await readSessionEventsPage(asExecutor(db), {
        sessionId,
        afterSequence: 0,
        limit: 100,
      });

      expect(page.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
      // The mapped envelope is the wire shape: camelCase, ISO createdAt.
      expect(page.events[0]?.sessionId).toBe(sessionId);
      expect(typeof page.events[0]?.createdAt).toBe('string');
      expect(page.events[0]?.kind).toBe('proposal');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('excludes events at or below the `after` cursor (exclusive lower bound)', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 5);

      const page = await readSessionEventsPage(asExecutor(db), {
        sessionId,
        afterSequence: 3,
        limit: 100,
      });

      expect(page.events.map((e) => e.sequence)).toEqual([4, 5]);
      expect(page.nextCursor).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it('caps the page at `limit` and sets `nextCursor` to the last returned sequence', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 5);

      const page = await readSessionEventsPage(asExecutor(db), {
        sessionId,
        afterSequence: 0,
        limit: 2,
      });

      expect(page.events.map((e) => e.sequence)).toEqual([1, 2]);
      // More remain → nextCursor is the last returned sequence.
      expect(page.nextCursor).toBe(2);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('sets `nextCursor` to null at the head of the log (last page)', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 5);

      // Page size exactly equals the remaining count — the look-ahead
      // finds no extra row, so nextCursor is null (no spurious trailing
      // empty page).
      const page = await readSessionEventsPage(asExecutor(db), {
        sessionId,
        afterSequence: 3,
        limit: 2,
      });

      expect(page.events.map((e) => e.sequence)).toEqual([4, 5]);
      expect(page.nextCursor).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it('walks the full log page by page until nextCursor is null', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 5);

      const seen: number[] = [];
      let after = 0;
      // Bounded loop — at most 10 pages for a 5-event log.
      for (let i = 0; i < 10; i += 1) {
        const page = await readSessionEventsPage(asExecutor(db), {
          sessionId,
          afterSequence: after,
          limit: 2,
        });
        seen.push(...page.events.map((e) => e.sequence));
        if (page.nextCursor === null) break;
        after = page.nextCursor;
      }

      expect(seen).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('returns an empty page for a session with no events past the cursor', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 0);

      const page = await readSessionEventsPage(asExecutor(db), {
        sessionId,
        afterSequence: 0,
        limit: 100,
      });

      expect(page.events).toEqual([]);
      expect(page.nextCursor).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);
});
