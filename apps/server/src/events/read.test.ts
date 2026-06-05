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

import {
  readSessionEventLog,
  readSessionEventsPage,
  readSessionSnapshots,
  type SessionEventReadExecutor,
} from './read.js';

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

describe('readSessionEventLog', () => {
  it('returns the full log in ascending sequence order', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 5);

      const events = await readSessionEventLog(asExecutor(db), { sessionId });

      expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
      // The mapped envelope is the wire shape: camelCase, ISO createdAt.
      expect(events[0]?.sessionId).toBe(sessionId);
      expect(events[0]?.kind).toBe('proposal');
      expect(typeof events[0]?.createdAt).toBe('string');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('returns an empty array for a session with no events', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const sessionId = await seedSessionWithEvents(db, 0);

      const events = await readSessionEventLog(asExecutor(db), { sessionId });

      expect(events).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('reads by session id alone — it does not gate visibility', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      // A private session is invisible at the HTTP layer, but the read
      // helper returns its events regardless: the visibility gate is the
      // caller's responsibility (it runs before this read).
      const userRes = await db.query<{ id: string }>(
        `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) RETURNING id`,
        ['authelia:log-priv', 'log-priv-user'],
      );
      const userId = userRes.rows[0]!.id;
      const sessionRes = await db.query<{ id: string }>(
        `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, 'private', $2) RETURNING id`,
        [userId, 'private topic'],
      );
      const sessionId = sessionRes.rows[0]!.id;
      await db.query(
        `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
         VALUES ($1, 1, 'proposal', $2, $3::jsonb)`,
        [sessionId, userId, JSON.stringify({ n: 1 })],
      );

      const events = await readSessionEventLog(asExecutor(db), { sessionId });

      expect(events.map((e) => e.sequence)).toEqual([1]);
    } finally {
      await db.close();
    }
  }, 30_000);
});

/**
 * Seed a user + session, then append a snapshot-created event at the
 * given `sequence` with the supplied label. `log_position === sequence`
 * by construction (cf. `createSnapshot.ts`), mirrored here. `actor` is
 * the seeded user. Returns the seeded session id (and host) for reuse.
 */
async function seedSessionWithUser(db: PGlite): Promise<{ sessionId: string; userId: string }> {
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) RETURNING id`,
    ['authelia:snap-seed', 'snap-seed-user'],
  );
  const userId = userRes.rows[0]!.id;
  const sessionRes = await db.query<{ id: string }>(
    `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, 'public', $2) RETURNING id`,
    [userId, 'snapshot topic'],
  );
  return { sessionId: sessionRes.rows[0]!.id, userId };
}

async function insertSnapshotEvent(
  db: PGlite,
  sessionId: string,
  actorId: string,
  sequence: number,
  snapshotId: string,
  label: string,
): Promise<void> {
  await db.query(
    `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
     VALUES ($1, $2, 'snapshot-created', $3, $4::jsonb)`,
    [
      sessionId,
      sequence,
      actorId,
      JSON.stringify({ snapshot_id: snapshotId, label, log_position: sequence }),
    ],
  );
}

async function insertProposalEvent(
  db: PGlite,
  sessionId: string,
  actorId: string,
  sequence: number,
): Promise<void> {
  await db.query(
    `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
     VALUES ($1, $2, 'proposal', $3, $4::jsonb)`,
    [sessionId, sequence, actorId, JSON.stringify({ n: sequence })],
  );
}

const SNAP_A = '00000000-0000-4000-8000-aaaaaaaa0001';
const SNAP_B = '00000000-0000-4000-8000-aaaaaaaa0002';

describe('readSessionSnapshots', () => {
  it('returns snapshot markers ascending by sequence, mapped to the camelCase record', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const { sessionId, userId } = await seedSessionWithUser(db);
      // Insert out of sequence order to prove the ORDER BY, not insert order.
      await insertSnapshotEvent(db, sessionId, userId, 7, SNAP_B, 'Chapter two');
      await insertSnapshotEvent(db, sessionId, userId, 3, SNAP_A, 'Chapter one');

      const snapshots = await readSessionSnapshots(asExecutor(db), { sessionId });

      expect(snapshots.map((s) => s.logPosition)).toEqual([3, 7]);
      expect(snapshots[0]).toEqual({
        snapshotId: SNAP_A,
        label: 'Chapter one',
        logPosition: 3,
        createdAt: expect.any(String) as string,
      });
      expect(snapshots[1]?.label).toBe('Chapter two');
      expect(snapshots[1]?.snapshotId).toBe(SNAP_B);
      // createdAt normalized to an ISO-8601 string.
      expect(typeof snapshots[0]?.createdAt).toBe('string');
      expect(snapshots[0]?.createdAt).toMatch(/T.*Z$/);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('ignores non-snapshot events (proposals/votes are not markers)', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const { sessionId, userId } = await seedSessionWithUser(db);
      await insertProposalEvent(db, sessionId, userId, 1);
      await insertProposalEvent(db, sessionId, userId, 2);
      await insertSnapshotEvent(db, sessionId, userId, 3, SNAP_A, 'Only marker');
      await insertProposalEvent(db, sessionId, userId, 4);

      const snapshots = await readSessionSnapshots(asExecutor(db), { sessionId });

      expect(snapshots.map((s) => s.snapshotId)).toEqual([SNAP_A]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('returns an empty array for a session with no snapshots', async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const { sessionId, userId } = await seedSessionWithUser(db);
      await insertProposalEvent(db, sessionId, userId, 1);

      const snapshots = await readSessionSnapshots(asExecutor(db), { sessionId });

      expect(snapshots).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
