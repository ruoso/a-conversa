// Handler suite for `GET /sessions/:id/events` (`replay/routes.ts`),
// driven via Fastify `.inject()` against a real migrated schema in
// pglite. Covers auth, the visibility gate (incl. the 404-not-403
// existence-leak rule), validation, and cursor pagination.
//
// Refinement: tasks/refinements/backend/get_session_log.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PGlite } from '@electric-sql/pglite';

import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/session-token.js';
import type { DbPool } from '../db.js';
import { __buildTestReplayApp } from './routes.js';

const TEST_SECRET = 'unit-test-replay-secret';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/server/src/replay/ -> .. -> src -> .. -> apps/server -> migrations
const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'migrations');

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

// pglite-backed DbPool adapter — no `connect()`, matching the
// cucumber-support shape. The read path issues plain `pool.query`.
function asPool(db: PGlite): DbPool {
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

async function insertUser(db: PGlite, oauthSubject: string, screenName: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) RETURNING id`,
    [oauthSubject, screenName],
  );
  return res.rows[0]!.id;
}

async function insertSession(
  db: PGlite,
  hostUserId: string,
  privacy: 'public' | 'private',
  topic: string,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, $2, $3) RETURNING id`,
    [hostUserId, privacy, topic],
  );
  return res.rows[0]!.id;
}

async function insertEvents(
  db: PGlite,
  sessionId: string,
  actorId: string,
  count: number,
): Promise<void> {
  for (let seq = 1; seq <= count; seq += 1) {
    await db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, 'proposal', $3, $4::jsonb)`,
      [sessionId, seq, actorId, JSON.stringify({ n: seq })],
    );
  }
}

async function insertSnapshot(
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

interface EventsBody {
  events?: Array<{ sequence?: number; sessionId?: string; payload?: { n?: number } }>;
  nextCursor?: number | null;
}

interface SnapshotsBody {
  snapshots?: Array<{
    snapshotId?: string;
    label?: string;
    logPosition?: number;
    createdAt?: string;
  }>;
}

const SNAP_ONE = '00000000-0000-4000-8000-bbbbbbbb0001';
const SNAP_TWO = '00000000-0000-4000-8000-bbbbbbbb0002';

describe('GET /sessions/:id/events', () => {
  let db: PGlite;
  let app: FastifyInstance;

  // A non-existent but well-formed UUID for the unknown-id case.
  const UNKNOWN_ID = '00000000-0000-4000-8000-ffffffff0001';

  beforeEach(async () => {
    db = new PGlite();
    await applyMigrations(db);
    app = await __buildTestReplayApp({ pool: asPool(db), sessionTokenSecret: TEST_SECRET });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it('returns 200 + events in ascending sequence order for an authenticated, visible caller', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertEvents(db, sessionId, alice, 3);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<EventsBody>();
    expect(body.events?.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(body.events?.[0]?.sessionId).toBe(sessionId);
    // The payload survives serialization (additionalProperties: true).
    expect(body.events?.[0]?.payload?.n).toBe(1);
    expect(body.nextCursor).toBeNull();
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events`,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 404 not-found when the session id does not exist', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${UNKNOWN_ID}/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const ben = await insertUser(db, 'authelia:ben', 'ben');
    const sessionId = await insertSession(db, alice, 'private', "alice's private");
    await insertEvents(db, sessionId, alice, 2);

    const token = await signSessionToken({ sub: ben }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    // The existence-leak rule: 404, identical to the unknown-id case.
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 200 for a private session visible to its host', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'private', "alice's private");
    await insertEvents(db, sessionId, alice, 2);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<EventsBody>();
    expect(body.events?.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('returns 200 for a private session visible to a participant', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const ben = await insertUser(db, 'authelia:ben', 'ben');
    const sessionId = await insertSession(db, alice, 'private', "alice's private");
    await insertEvents(db, sessionId, alice, 2);
    await db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, ben],
    );

    const token = await signSessionToken({ sub: ben }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<EventsBody>();
    expect(body.events?.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/not-a-uuid/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when ?limit=0 (below minimum)', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events?limit=0`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when ?limit=5000 (above maximum)', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events?limit=5000`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('pages forward: ?after=<nextCursor> returns the continuation, ending at nextCursor null', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertEvents(db, sessionId, alice, 5);
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const first = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events?limit=2`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<EventsBody>();
    expect(firstBody.events?.map((e) => e.sequence)).toEqual([1, 2]);
    expect(firstBody.nextCursor).toBe(2);

    const second = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events?limit=2&after=${firstBody.nextCursor}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<EventsBody>();
    expect(secondBody.events?.map((e) => e.sequence)).toEqual([3, 4]);
    expect(secondBody.nextCursor).toBe(4);

    const third = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events?limit=2&after=${secondBody.nextCursor}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(third.statusCode).toBe(200);
    const thirdBody = third.json<EventsBody>();
    expect(thirdBody.events?.map((e) => e.sequence)).toEqual([5]);
    expect(thirdBody.nextCursor).toBeNull();
  });

  it('returns 200 with an empty page for a visible session with no events', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'brand-new');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<EventsBody>();
    expect(body.events).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe('GET /sessions/:id/snapshots', () => {
  let db: PGlite;
  let app: FastifyInstance;

  const UNKNOWN_ID = '00000000-0000-4000-8000-ffffffff0001';

  beforeEach(async () => {
    db = new PGlite();
    await applyMigrations(db);
    app = await __buildTestReplayApp({ pool: asPool(db), sessionTokenSecret: TEST_SECRET });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it('returns 200 + snapshot markers ascending by logPosition for a visible caller', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    // Insert out of order to prove the ORDER BY.
    await insertSnapshot(db, sessionId, alice, 7, SNAP_TWO, 'Chapter two');
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotsBody>();
    expect(body.snapshots?.map((s) => s.logPosition)).toEqual([3, 7]);
    expect(body.snapshots?.[0]?.snapshotId).toBe(SNAP_ONE);
    expect(body.snapshots?.[0]?.label).toBe('Chapter one');
    expect(typeof body.snapshots?.[0]?.createdAt).toBe('string');
    expect(body.snapshots?.[1]?.label).toBe('Chapter two');
  });

  it('returns 200 + { snapshots: [] } for a visible session with no snapshots', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'no snapshots');
    await insertEvents(db, sessionId, alice, 3);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotsBody>();
    expect(body.snapshots).toEqual([]);
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots`,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 404 not-found when the session id does not exist', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${UNKNOWN_ID}/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const ben = await insertUser(db, 'authelia:ben', 'ben');
    const sessionId = await insertSession(db, alice, 'private', "alice's private");
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');

    const token = await signSessionToken({ sub: ben }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 200 for a private session visible to its host', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'private', "alice's private");
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotsBody>();
    expect(body.snapshots?.map((s) => s.snapshotId)).toEqual([SNAP_ONE]);
  });

  it('returns 200 for a private session visible to a participant', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const ben = await insertUser(db, 'authelia:ben', 'ben');
    const sessionId = await insertSession(db, alice, 'private', "alice's private");
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');
    await db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, ben],
    );

    const token = await signSessionToken({ sub: ben }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotsBody>();
    expect(body.snapshots?.map((s) => s.snapshotId)).toEqual([SNAP_ONE]);
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/not-a-uuid/snapshots`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 validation-failed when an unknown query param is sent', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots?after=2`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});
