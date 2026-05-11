// Vitest unit tests for `POST /sessions` (apps/server/src/sessions/routes.ts).
//
// Refinement: tasks/refinements/backend/create_session_endpoint.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.create_session_endpoint
//
// **Coverage** (per the refinement's Acceptance criteria):
//
//   1. Valid body + authenticated user → 201 + camelCase response
//      shape; the memory-backed DB shim records BOTH the sessions row
//      AND the session_events row (sequence=1, kind='session-created',
//      payload mirrors the row), so the atomic write contract is
//      verified.
//   2. No auth cookie → 401 + `auth-required` envelope (verifies the
//      middleware wiring is intact).
//   3. Body missing `topic` → 400 + `validation-failed` envelope.
//   4. Body `topic` too long (≥257 chars) → 400.
//   5. Body `privacy` outside the enum → 400.
//
// All tests use Fastify's `.inject(...)` — no port bind. The pool is a
// memory shim that mimics the production `pg.Pool` surface (BEGIN /
// COMMIT / ROLLBACK + the INSERTs) so the transactional shape is
// exercised in unit-layer isolation; the Cucumber+pglite layer covers
// the end-to-end write against the real migrated schema.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/session-token.js';
import type { DbPool } from '../db.js';
import { __buildTestSessionsApp } from './routes.js';

const TEST_SECRET = 'unit-test-sessions-secret';

interface UserRow {
  id: string;
  oauth_subject: string;
  screen_name: string;
  deleted_at: string | null;
}

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: string;
  topic: string;
  created_at: Date;
  ended_at: Date | null;
}

interface SessionEventRow {
  id: string;
  session_id: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

interface MemoryStore {
  users: Map<string, UserRow>;
  sessions: SessionRow[];
  events: SessionEventRow[];
  // Transaction-control trace — the test's atomicity claim rests on
  // the handler emitting BEGIN → INSERT(sessions) → INSERT(session_events) → COMMIT
  // in order. Failure paths emit ROLLBACK instead of COMMIT. The
  // tests assert against this trace to pin the contract.
  trace: string[];
}

/**
 * In-memory `pg.Pool` shim. Implements `query(text, params)` plus an
 * optional `connect()` that returns a client with the same `query`
 * method and a `release()` no-op — this exercises the
 * `withTransaction` helper's "pool with connect()" branch (the
 * production code path).
 *
 * The shim recognises:
 *
 *   - `BEGIN` / `COMMIT` / `ROLLBACK` — recorded in `trace`.
 *   - The users SELECT the auth middleware issues (mirrors the
 *     production WHERE clause).
 *   - The sessions INSERT ... RETURNING.
 *   - The session_events INSERT.
 *
 * Anything else throws — a regression that changes the SQL surface
 * shows up here, not as a silent mismatch.
 */
function makeMemoryPool(initialUsers: UserRow[]): {
  pool: DbPool;
  store: MemoryStore;
} {
  const store: MemoryStore = {
    users: new Map(initialUsers.map((u) => [u.id, u])),
    sessions: [],
    events: [],
    trace: [],
  };

  let nextSessionId = 1;
  const synthesizeUuid = (n: number): string => {
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };

  function runQuery<TRow extends Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }> {
    const p = (params ?? []) as unknown[];
    const trimmed = text.trim();
    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      store.trace.push(trimmed);
      return Promise.resolve({ rows: [] as TRow[] });
    }
    if (text.includes('SELECT id, screen_name') && text.includes('FROM users')) {
      const id = p[0] as string;
      const row = store.users.get(id);
      if (row === undefined || row.deleted_at !== null) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.resolve({
        rows: [{ id: row.id, screen_name: row.screen_name }] as unknown as TRow[],
      });
    }
    if (text.includes('INSERT INTO sessions')) {
      const [hostUserId, privacy, topic] = p as [string, string, string];
      const row: SessionRow = {
        id: synthesizeUuid(nextSessionId++),
        host_user_id: hostUserId,
        privacy,
        topic,
        created_at: new Date('2026-05-10T12:00:00.000Z'),
        ended_at: null,
      };
      store.sessions.push(row);
      return Promise.resolve({ rows: [row] as unknown as TRow[] });
    }
    if (text.includes('INSERT INTO session_events')) {
      const [id, sessionId, sequence, kind, actor, payloadJson] = p as [
        string,
        string,
        number,
        string,
        string | null,
        string,
      ];
      store.events.push({
        id,
        session_id: sessionId,
        sequence,
        kind,
        actor,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        created_at: new Date('2026-05-10T12:00:00.001Z'),
      });
      return Promise.resolve({ rows: [] as TRow[] });
    }
    return Promise.reject(new Error(`unexpected SQL in sessions memory pool: ${text}`));
  }

  const pool: DbPool & {
    connect(): Promise<{
      query: typeof runQuery;
      release: () => void;
    }>;
  } = {
    query: runQuery,
    connect() {
      return Promise.resolve({
        query: runQuery,
        release: () => undefined,
      });
    },
  };

  return { pool, store };
}

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const BEN_ID = '22222222-2222-4222-8222-222222222222';

interface BuiltApp {
  app: FastifyInstance;
  store: MemoryStore;
}

async function buildApp(opts: { users: UserRow[]; now?: () => number }): Promise<BuiltApp> {
  const { pool, store } = makeMemoryPool(opts.users);
  const appOpts: Parameters<typeof __buildTestSessionsApp>[0] = {
    pool,
    sessionTokenSecret: TEST_SECRET,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  const app = await __buildTestSessionsApp(appOpts);
  return { app, store };
}

describe('POST /sessions — successful creation', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 201 + the camelCase session shape for a valid body', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'Is the moon made of cheese?' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(typeof body.id).toBe('string');
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('public');
    expect(body.topic).toBe('Is the moon made of cheese?');
    expect(typeof body.createdAt).toBe('string');
    expect(body.endedAt).toBeNull();
  });

  it('writes BOTH the sessions row AND the session-created event atomically', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'A debate', privacy: 'private' },
    });
    expect(response.statusCode).toBe(201);

    // Sessions row landed with the supplied values.
    expect(built.store.sessions).toHaveLength(1);
    const sessionRow = built.store.sessions[0];
    expect(sessionRow?.host_user_id).toBe(ALICE_ID);
    expect(sessionRow?.privacy).toBe('private');
    expect(sessionRow?.topic).toBe('A debate');

    // session_events row landed at sequence=1 with the canonical
    // kind and a payload that mirrors the row's snake_case columns.
    expect(built.store.events).toHaveLength(1);
    const eventRow = built.store.events[0];
    expect(eventRow?.session_id).toBe(sessionRow?.id);
    expect(eventRow?.sequence).toBe(1);
    expect(eventRow?.kind).toBe('session-created');
    expect(eventRow?.actor).toBe(ALICE_ID);
    const payload = eventRow?.payload as Record<string, unknown>;
    expect(payload?.['host_user_id']).toBe(ALICE_ID);
    expect(payload?.['privacy']).toBe('private');
    expect(payload?.['topic']).toBe('A debate');
    expect(typeof payload?.['created_at']).toBe('string');

    // Transaction shape: BEGIN, then the two inserts (in any order
    // the SQL surface allows; the trace's BEGIN→COMMIT bookends are
    // what we pin), then COMMIT. NO ROLLBACK.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('defaults privacy to public when the body omits it', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'Hello' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ privacy?: string }>();
    expect(body.privacy).toBe('public');
    expect(built.store.sessions[0]?.privacy).toBe('public');
    expect(built.store.events[0]?.payload?.['privacy']).toBe('public');
  });
});

describe('POST /sessions — auth gate', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { topic: 'No cookie here' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    // Critical: nothing is written when auth fails. The middleware
    // throws before the handler runs, so the transaction never opens.
    expect(built.store.sessions).toHaveLength(0);
    expect(built.store.events).toHaveLength(0);
    expect(built.store.trace).toHaveLength(0);
  });

  it('returns 401 when the cookie refers to a user the DB does not know', async () => {
    // Sign a JWT for a user id the memory pool doesn't carry — the
    // middleware's `SELECT id, screen_name FROM users WHERE id = $1
    // AND deleted_at IS NULL` returns zero rows; the middleware throws
    // 401 auth-required and the handler never runs.
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'Ghost user' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });
});

describe('POST /sessions — body validation', () => {
  let built: BuiltApp;
  let token: string;

  beforeEach(async () => {
    built = await buildApp({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
    token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 400 when the body omits topic', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
    // The handler never runs on a body-validation failure — nothing
    // lands in the DB.
    expect(built.store.sessions).toHaveLength(0);
    expect(built.store.events).toHaveLength(0);
  });

  it('returns 400 when topic exceeds the 256-character cap', async () => {
    const tooLong = 'x'.repeat(257);
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: tooLong },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
    expect(built.store.sessions).toHaveLength(0);
  });

  it('returns 400 when privacy is outside the enum', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'OK topic', privacy: 'secret' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
    expect(built.store.sessions).toHaveLength(0);
  });

  it('returns 400 when topic is an empty string', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});
