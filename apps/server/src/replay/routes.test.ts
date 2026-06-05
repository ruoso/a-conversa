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

// Seed a minimal *projectable* event log — a valid sequence the replay
// primitive can apply (session-created → participant-joined →
// node-created), all actored by `hostId` (a real users row, satisfying
// the `session_events.actor` FK). Unlike `insertEvents` (which seeds
// opaque `proposal` rows for the raw-log read), these events must be
// real so `projectAtPosition` builds a non-empty projection.
// headSequence = 3; the node appears only at position >= 3.
const PROJECTED_NODE_ID = '66666666-6666-4666-8666-666666666666';

async function insertProjectableLog(db: PGlite, sessionId: string, hostId: string): Promise<void> {
  const ev = async (
    sequence: number,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [sessionId, sequence, kind, hostId, JSON.stringify(payload)],
    );
  };
  await ev(1, 'session-created', {
    host_user_id: hostId,
    privacy: 'public',
    topic: 'public debate',
    created_at: '2026-05-10T12:00:00Z',
  });
  await ev(2, 'participant-joined', {
    user_id: hostId,
    role: 'moderator',
    screen_name: 'alice',
    joined_at: '2026-05-10T12:00:01Z',
  });
  await ev(3, 'node-created', {
    node_id: PROJECTED_NODE_ID,
    wording: 'Claim A',
    created_by: hostId,
    created_at: '2026-05-10T12:00:02Z',
  });
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

interface SnapshotBody {
  snapshotId?: string;
  label?: string;
  logPosition?: number;
  createdAt?: string;
}

describe('GET /sessions/:id/snapshots/:snapshotId', () => {
  let db: PGlite;
  let app: FastifyInstance;

  const UNKNOWN_ID = '00000000-0000-4000-8000-ffffffff0001';
  // A well-formed UUID for a snapshot that is never inserted.
  const ABSENT_SNAP = '00000000-0000-4000-8000-cccccccc0001';

  beforeEach(async () => {
    db = new PGlite();
    await applyMigrations(db);
    app = await __buildTestReplayApp({ pool: asPool(db), sessionTokenSecret: TEST_SECRET });
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it('returns 200 + the matching snapshot record for a visible caller', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');
    await insertSnapshot(db, sessionId, alice, 7, SNAP_TWO, 'Chapter two');

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots/${SNAP_TWO}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotBody>();
    expect(body.snapshotId).toBe(SNAP_TWO);
    expect(body.label).toBe('Chapter two');
    expect(body.logPosition).toBe(7);
    expect(typeof body.createdAt).toBe('string');
  });

  it('returns 404 not-found when the snapshotId is a valid UUID with no matching snapshot', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots/${ABSENT_SNAP}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('does NOT return a snapshot belonging to a different session (sessionId filter honored)', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionA = await insertSession(db, alice, 'public', 'session A');
    const sessionB = await insertSession(db, alice, 'public', 'session B');
    // SNAP_ONE lives in session B, not session A.
    await insertSnapshot(db, sessionB, alice, 3, SNAP_ONE, 'Chapter one');

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionA}/snapshots/${SNAP_ONE}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots/${SNAP_ONE}`,
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
      url: `/api/sessions/${UNKNOWN_ID}/snapshots/${SNAP_ONE}`,
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
      url: `/api/sessions/${sessionId}/snapshots/${SNAP_ONE}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    // Indistinguishable from snapshot-not-found: the gate short-circuits
    // before any snapshot lookup, so this is 404, not 403.
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
      url: `/api/sessions/${sessionId}/snapshots/${SNAP_ONE}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotBody>();
    expect(body.snapshotId).toBe(SNAP_ONE);
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
      url: `/api/sessions/${sessionId}/snapshots/${SNAP_ONE}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SnapshotBody>();
    expect(body.snapshotId).toBe(SNAP_ONE);
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/not-a-uuid/snapshots/${SNAP_ONE}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 validation-failed when the path :snapshotId is not a UUID', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots/not-a-uuid`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 validation-failed when an unknown query param is sent', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertSnapshot(db, sessionId, alice, 3, SNAP_ONE, 'Chapter one');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/snapshots/${SNAP_ONE}?after=2`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});

interface StateBody {
  sessionId?: string;
  sequence?: number;
  projection?: {
    lastAppliedSequence?: number;
    sessionState?: string;
    nodes?: unknown[];
    participants?: unknown[];
  };
}

describe('GET /sessions/:id/state', () => {
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

  it('returns 200 + the projected state at position = headSequence for a visible caller', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertProjectableLog(db, sessionId, alice); // headSequence = 3

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=3`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<StateBody>();
    expect(body.sessionId).toBe(sessionId);
    // sequence === position === projection.lastAppliedSequence.
    expect(body.sequence).toBe(3);
    expect(body.projection?.lastAppliedSequence).toBe(3);
    // The node created at seq 3 is present in the full-log projection.
    expect(body.projection?.nodes?.length).toBe(1);
    expect(body.projection?.participants?.length).toBe(1);
  });

  it('returns the empty baseline projection at position 0', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertProjectableLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=0`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<StateBody>();
    expect(body.sequence).toBe(0);
    expect(body.projection?.lastAppliedSequence).toBe(0);
    expect(body.projection?.sessionState).toBe('open');
    expect(body.projection?.nodes).toEqual([]);
    expect(body.projection?.participants).toEqual([]);
  });

  it('returns the position-0 baseline for a brand-new session with no events', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'brand-new');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=0`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<StateBody>();
    expect(body.sequence).toBe(0);
    expect(body.projection?.lastAppliedSequence).toBe(0);
    expect(body.projection?.nodes).toEqual([]);
  });

  it('returns a strict-prefix projection at a mid-log position (node not yet applied)', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertProjectableLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    // position = 2 applies session-created + participant-joined but NOT
    // the node at seq 3.
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=2`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<StateBody>();
    expect(body.sequence).toBe(2);
    expect(body.projection?.lastAppliedSequence).toBe(2);
    expect(body.projection?.nodes).toEqual([]);
    expect(body.projection?.participants?.length).toBe(1);
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=0`,
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
      url: `/api/sessions/${UNKNOWN_ID}/state?position=0`,
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
    await insertProjectableLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: ben }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=0`,
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
    await insertProjectableLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=3`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<StateBody>();
    expect(body.projection?.lastAppliedSequence).toBe(3);
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/not-a-uuid/state?position=0`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when position is missing', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when position is negative', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=-1`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when position is non-integer', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=1.5`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 (out-of-range) when position > headSequence, carrying the valid range', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertProjectableLog(db, sessionId, alice); // headSequence = 3

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=99`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{
      error?: { code?: string; position?: number; headSequence?: number };
    }>();
    expect(body.error?.code).toBe('validation-failed');
    // The error carries the valid 0..headSequence range it computed.
    expect(body.error?.position).toBe(99);
    expect(body.error?.headSequence).toBe(3);
  });

  it('returns 400 when an unknown query key is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/state?position=0&bogus=1`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});

// ===========================================================================
// GET /sessions/:id/diagnostics — structural diagnostics at a log position.
// The diagnostics-shaped sibling of /state: read the log, replay to N, run
// `computeAllDiagnostics` over the projection, return `{ diagnostics: [...] }`
// (bare DiagnosticEntry objects — the shipped client narrows on `kind`).
// ===========================================================================

// Two extra node ids + an edge id for the diagnostic-producing log: an
// edge with a NON-justification role (`defines`) from a source node to a
// target node makes the target "claim-positioned but unjustified" → a
// `dangling-claim` diagnostic for the target (see
// `diagnostics/dangling-claim-detection.ts`). The source node is not
// claim-positioned (no incoming edges) so it yields no entry.
const DANGLING_SOURCE_NODE_ID = '66666666-6666-4666-8666-666666666601';
const DANGLING_TARGET_NODE_ID = '66666666-6666-4666-8666-666666666602';
const DANGLING_EDGE_ID = '77777777-7777-4777-8777-777777777701';

// Seed a projectable log whose head-position projection carries exactly one
// structural diagnostic: a dangling claim on DANGLING_TARGET_NODE_ID.
//   seq 1 session-created, 2 participant-joined,
//   seq 3 node-created (source), 4 node-created (target),
//   seq 5 edge-created (source -> target, role `defines`).
// headSequence = 5. The dangling claim only exists once the edge at seq 5
// is applied; at position 4 there is no incoming edge, so no diagnostic.
async function insertDanglingClaimLog(
  db: PGlite,
  sessionId: string,
  hostId: string,
): Promise<void> {
  const ev = async (
    sequence: number,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [sessionId, sequence, kind, hostId, JSON.stringify(payload)],
    );
  };
  await ev(1, 'session-created', {
    host_user_id: hostId,
    privacy: 'public',
    topic: 'public debate',
    created_at: '2026-05-10T12:00:00Z',
  });
  await ev(2, 'participant-joined', {
    user_id: hostId,
    role: 'moderator',
    screen_name: 'alice',
    joined_at: '2026-05-10T12:00:01Z',
  });
  await ev(3, 'node-created', {
    node_id: DANGLING_SOURCE_NODE_ID,
    wording: 'Definition node',
    created_by: hostId,
    created_at: '2026-05-10T12:00:02Z',
  });
  await ev(4, 'node-created', {
    node_id: DANGLING_TARGET_NODE_ID,
    wording: 'Unjustified claim',
    created_by: hostId,
    created_at: '2026-05-10T12:00:03Z',
  });
  await ev(5, 'edge-created', {
    edge_id: DANGLING_EDGE_ID,
    role: 'defines',
    source_node_id: DANGLING_SOURCE_NODE_ID,
    target_node_id: DANGLING_TARGET_NODE_ID,
    created_by: hostId,
    created_at: '2026-05-10T12:00:04Z',
  });
}

interface DiagnosticsBody {
  diagnostics?: Array<{ kind?: string; nodeId?: string }>;
}

describe('GET /sessions/:id/diagnostics', () => {
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

  it('returns 200 + a diagnostics array at position = headSequence for a visible caller', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertDanglingClaimLog(db, sessionId, alice); // headSequence = 5

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=5`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DiagnosticsBody>();
    expect(Array.isArray(body.diagnostics)).toBe(true);
    // The dangling-claim diagnostic for the unjustified target node.
    const dangling = body.diagnostics?.find((d) => d.kind === 'dangling-claim');
    expect(dangling).toBeDefined();
    expect(dangling?.nodeId).toBe(DANGLING_TARGET_NODE_ID);
  });

  it('returns the empty diagnostics array at position 0 (empty baseline projection)', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertDanglingClaimLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=0`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DiagnosticsBody>();
    expect(body.diagnostics).toEqual([]);
  });

  it('returns no diagnostics at a mid-log position before the structural issue appears', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertDanglingClaimLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    // position = 4 applies both nodes but NOT the edge at seq 5, so the
    // target is not yet claim-positioned → no dangling-claim diagnostic.
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=4`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DiagnosticsBody>();
    expect(body.diagnostics?.some((d) => d.kind === 'dangling-claim')).toBe(false);
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=0`,
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
      url: `/api/sessions/${UNKNOWN_ID}/diagnostics?position=0`,
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
    await insertDanglingClaimLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: ben }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=0`,
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
    await insertDanglingClaimLog(db, sessionId, alice);

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=5`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DiagnosticsBody>();
    expect(body.diagnostics?.some((d) => d.kind === 'dangling-claim')).toBe(true);
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/not-a-uuid/diagnostics?position=0`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when position is missing', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when position is negative', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=-1`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 when position is non-integer', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=1.5`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 (out-of-range) when position > headSequence, carrying the valid range', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    await insertDanglingClaimLog(db, sessionId, alice); // headSequence = 5

    const token = await signSessionToken({ sub: alice }, TEST_SECRET);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=99`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{
      error?: { code?: string; position?: number; headSequence?: number };
    }>();
    expect(body.error?.code).toBe('validation-failed');
    expect(body.error?.position).toBe(99);
    expect(body.error?.headSequence).toBe(5);
  });

  it('returns 400 when an unknown query key is present', async () => {
    const alice = await insertUser(db, 'authelia:alice', 'alice');
    const sessionId = await insertSession(db, alice, 'public', 'public debate');
    const token = await signSessionToken({ sub: alice }, TEST_SECRET);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/diagnostics?position=0&bogus=1`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});
