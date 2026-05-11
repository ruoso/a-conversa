// Vitest unit tests for `POST /sessions` and `GET /sessions`
// (apps/server/src/sessions/routes.ts).
//
// Refinements: tasks/refinements/backend/create_session_endpoint.md,
//              tasks/refinements/backend/list_sessions_endpoint.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.create_session_endpoint,
//              backend.session_management.list_sessions_endpoint
//
// **Coverage for `POST /sessions`** (per the create-endpoint refinement):
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
// **Coverage for `GET /sessions`** (per the list-endpoint refinement):
//
//   1. Authenticated → 200 + ordered list (created_at DESC).
//   2. No auth cookie → 401.
//   3. Public-only visibility for a user with no participation history.
//   4. Public + private-where-participant visible to a participant.
//   5. Private-where-not-a-participant is hidden.
//   6. `?status=active` filters out ended sessions.
//   7. `?status=ended` returns only ended sessions.
//
// **Coverage for `GET /sessions/:id`** (per the get-endpoint refinement):
//
//   1. Authenticated + visible → 200 + SessionResponse shape.
//   2. No auth cookie → 401.
//   3. Unknown id → 404 not-found.
//   4. Private session not visible to caller → 404 (NOT 403; the
//      existence-leak rule).
//   5. Private session visible to host → 200.
//   6. Private session visible to participant → 200.
//   7. Bad UUID path param → 400 validation-failed.
//
// **Coverage for `POST /sessions/:id/end`** (per the end-endpoint refinement):
//
//   1. Host ends an active session → 200 + endedAt populated; BOTH the
//      UPDATE and the session-ended event INSERT recorded via the
//      memory shim; transaction trace is BEGIN…COMMIT (no ROLLBACK).
//   2. Non-host (visible but not host) → 403 `not-a-moderator`; no
//      writes; trace ends with ROLLBACK.
//   3. Non-participant on a private session → 404 `not-found` (the
//      existence-non-leak rule fires BEFORE the authority check).
//   4. Already-ended session (host re-attempts) → 409
//      `session-already-ended`; no new writes; trace ends with ROLLBACK.
//   5. Unknown id → 404 `not-found`.
//   6. Bad UUID path param → 400 `validation-failed`.
//   7. No auth cookie → 401 `auth-required`.
//
// **Coverage for `PATCH /sessions/:id/privacy`** (per the privacy-toggle refinement):
//
//   1. Host toggles public → private → 200 + the new privacy in the
//      response; the in-memory row's privacy reflects the new value.
//   2. Non-host (visible but not host) → 403 `not-a-moderator`; the
//      row's privacy is unchanged.
//   3. Non-participant on a private session → 404 `not-found` (the
//      existence-non-leak rule fires BEFORE the authority check).
//   4. Ended session → 409 `session-already-ended`; the row's privacy
//      is unchanged.
//   5. Unknown id → 404 `not-found`.
//   6. Setting the same value the row already has → 200 (idempotent
//      no-op); the response carries the unchanged privacy.
//   7. Bad body (missing privacy / invalid enum) → 400 `validation-failed`.
//   8. No auth cookie → 401 `auth-required`.
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

interface SessionParticipantRow {
  session_id: string;
  user_id: string;
}

interface MemoryStore {
  users: Map<string, UserRow>;
  sessions: SessionRow[];
  events: SessionEventRow[];
  // Participation rows — visibility-gate join target for `GET /sessions`.
  // The list-endpoint tests seed this directly to model "user X is a
  // participant in session Y" without going through a participant-
  // assignment endpoint (which is a sibling task, not landed yet).
  participants: SessionParticipantRow[];
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
    participants: [],
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
    if (
      text.includes('FROM sessions') &&
      text.includes('WHERE id = $1') &&
      text.includes("privacy = 'public'") &&
      text.includes('host_user_id = $2') &&
      text.includes('session_participants')
    ) {
      // The `GET /sessions/:id` visibility-gated SELECT (with or
      // without FOR UPDATE — `POST /sessions/:id/end` uses the same
      // predicate plus the row lock). Mirrors the production WHERE
      // clause: id matches AND (public OR host OR participant). The
      // shim implements the same predicate in JS so the test's
      // assertion is against the row set the production SQL would
      // return — not a re-derivation.
      //
      // `FOR UPDATE` is a no-op in the shim — the single-threaded
      // test runtime can't observe the lock semantics. The presence
      // of the clause is enough to route the query here.
      const targetId = p[0] as string;
      const userId = p[1] as string;
      const visible = store.sessions.filter(
        (s) =>
          s.id === targetId &&
          (s.privacy === 'public' ||
            s.host_user_id === userId ||
            store.participants.some((sp) => sp.session_id === s.id && sp.user_id === userId)),
      );
      return Promise.resolve({ rows: visible as unknown as TRow[] });
    }
    if (text.includes('UPDATE sessions') && text.includes('SET privacy = $1')) {
      // The `PATCH /sessions/:id/privacy` UPDATE. Flip the row's
      // privacy column to the desired value and RETURN the full row
      // in the same shape the create / end endpoints use. The shim's
      // mutate-in-place mirrors what Postgres does under the hood —
      // RETURNING surfaces the post-update value.
      const [desiredPrivacy, targetId] = p as [string, string];
      const idx = store.sessions.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const updated: SessionRow = {
        ...(store.sessions[idx] as SessionRow),
        privacy: desiredPrivacy,
      };
      store.sessions[idx] = updated;
      return Promise.resolve({ rows: [updated] as unknown as TRow[] });
    }
    if (text.includes('UPDATE sessions') && text.includes('SET ended_at = NOW()')) {
      // The `POST /sessions/:id/end` UPDATE. Flip the row's
      // `ended_at` to a deterministic timestamp (pinned for hermetic
      // tests; production reads NOW() from the DB clock). RETURNING
      // surfaces the full row in the same shape the create endpoint
      // returns.
      const targetId = p[0] as string;
      const idx = store.sessions.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const updated: SessionRow = {
        ...(store.sessions[idx] as SessionRow),
        ended_at: new Date('2026-05-10T12:00:01.000Z'),
      };
      store.sessions[idx] = updated;
      return Promise.resolve({ rows: [updated] as unknown as TRow[] });
    }
    if (
      text.includes('FROM session_events') &&
      text.includes('MAX(sequence)') &&
      text.includes('WHERE session_id = $1')
    ) {
      // The MAX(sequence) read inside the end-session transaction
      // (ADR 0020 application-managed monotonic sequence allocator).
      // The shim returns the highest sequence currently stored for
      // the session, or 0 when no events exist (the production
      // `COALESCE(MAX(sequence), 0)` produces the same value).
      const sessionId = p[0] as string;
      const sequences = store.events
        .filter((e) => e.session_id === sessionId)
        .map((e) => e.sequence);
      const maxSeq = sequences.length === 0 ? 0 : Math.max(...sequences);
      return Promise.resolve({ rows: [{ max_seq: maxSeq }] as unknown as TRow[] });
    }
    if (
      text.includes('FROM sessions') &&
      text.includes("privacy = 'public'") &&
      text.includes('host_user_id = $1') &&
      text.includes('session_participants')
    ) {
      // The `GET /sessions` visibility-gated SELECT. Mirrors the
      // production WHERE clause: public OR host OR participant. The
      // shim implements the same predicate in JS so the test's
      // assertion is against the row set the production SQL would
      // return — not a re-derivation.
      const userId = p[0] as string;
      const visible = store.sessions.filter(
        (s) =>
          s.privacy === 'public' ||
          s.host_user_id === userId ||
          store.participants.some((sp) => sp.session_id === s.id && sp.user_id === userId),
      );
      // Lifecycle filter — text-substring match on the production
      // SQL surface. The handler concatenates `' AND ended_at IS NULL'`
      // or `' AND ended_at IS NOT NULL'` depending on `?status`.
      let filtered = visible;
      if (text.includes('AND ended_at IS NULL')) {
        filtered = visible.filter((s) => s.ended_at === null);
      } else if (text.includes('AND ended_at IS NOT NULL')) {
        filtered = visible.filter((s) => s.ended_at !== null);
      }
      // ORDER BY created_at DESC.
      const sorted = [...filtered].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return Promise.resolve({ rows: sorted as unknown as TRow[] });
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

describe('GET /sessions — visibility gate and lifecycle filter', () => {
  // Helper: seed N sessions and a participant set, then build the
  // app. Each test seeds the exact shape it needs so the assertions
  // are local.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const PUBLIC_OLD: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Older public debate',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_NEW: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Newer public debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ALICE: SessionRow = {
    id: '00000000-0000-4000-8000-bbbbbbbb0001',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: "Alice's private debate",
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-cccccccc0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A finished public debate',
    created_at: new Date('2026-05-07T10:00:00.000Z'),
    ended_at: new Date('2026-05-07T11:00:00.000Z'),
  };

  it('returns 200 + the sessions list in created_at DESC order for an authenticated caller', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_OLD, PUBLIC_NEW],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; topic?: string }> }>();
    expect(body.sessions).toHaveLength(2);
    // DESC: newer first.
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_NEW.id);
    expect(body.sessions?.[1]?.id).toBe(PUBLIC_OLD.id);
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW],
    });
    const response = await built.app.inject({ method: 'GET', url: '/sessions' });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns ONLY public sessions for a user with no participation history', async () => {
    // Ben is a fresh user — not the host, not a participant in any
    // private session. Alice owns a private session. Ben must NOT see it.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PRIVATE_ALICE],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; privacy?: string }> }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_NEW.id);
    expect(body.sessions?.[0]?.privacy).toBe('public');
  });

  it('returns public + private-where-participant for a participant', async () => {
    // Ben is a participant in Alice's private session.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PRIVATE_ALICE],
      participants: [{ session_id: PRIVATE_ALICE.id, user_id: BEN_ID }],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }> }>();
    const ids = body.sessions?.map((s) => s.id) ?? [];
    expect(ids).toContain(PUBLIC_NEW.id);
    expect(ids).toContain(PRIVATE_ALICE.id);
    expect(ids).toHaveLength(2);
  });

  it('hides private-where-not-a-participant from a non-participant', async () => {
    // Same shape as the "no participation history" case but more
    // explicit — Ben has SOME participant history (in a different
    // private session he won't be a participant of). The endpoint
    // must NOT leak Alice's private session.
    const OTHER_PRIVATE: SessionRow = {
      id: '00000000-0000-4000-8000-bbbbbbbb0002',
      host_user_id: BEN_ID,
      privacy: 'private',
      topic: "Ben's own private session",
      created_at: new Date('2026-05-09T12:00:00.000Z'),
      ended_at: null,
    };
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PRIVATE_ALICE, OTHER_PRIVATE],
      participants: [{ session_id: OTHER_PRIVATE.id, user_id: BEN_ID }],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }> }>();
    const ids = body.sessions?.map((s) => s.id) ?? [];
    expect(ids).toContain(PUBLIC_NEW.id);
    // Ben sees OTHER_PRIVATE because he is host + participant. He
    // does NOT see Alice's PRIVATE_ALICE.
    expect(ids).toContain(OTHER_PRIVATE.id);
    expect(ids).not.toContain(PRIVATE_ALICE.id);
  });

  it('filters out ended sessions when ?status=active', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions?status=active',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; endedAt?: string | null }> }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_NEW.id);
    expect(body.sessions?.[0]?.endedAt).toBeNull();
  });

  it('returns only ended sessions when ?status=ended', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions?status=ended',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; endedAt?: string | null }> }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_ENDED.id);
    expect(typeof body.sessions?.[0]?.endedAt).toBe('string');
  });
});

describe('GET /sessions/:id — visibility-gated fetch', () => {
  // Re-uses the same seed helper shape as the list-endpoint suite —
  // seed users + sessions + (optionally) participation rows into the
  // shared memory pool, then build the Fastify app on top.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded session rows. Distinct from the
  // list-suite ids so a stray cross-suite reference fails loudly.
  const PUBLIC_SESSION: SessionRow = {
    id: '00000000-0000-4000-8000-dddddddd0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A public debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ALICE: SessionRow = {
    id: '00000000-0000-4000-8000-eeeeeeee0001',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: "Alice's private debate",
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };

  it('returns 200 + SessionResponse for an authenticated, visible session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_SESSION],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/sessions/${PUBLIC_SESSION.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    // Bare SessionResponse — NOT wrapped in `{ session: ... }`.
    expect(body.id).toBe(PUBLIC_SESSION.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('public');
    expect(body.topic).toBe('A public debate');
    expect(typeof body.createdAt).toBe('string');
    expect(body.endedAt).toBeNull();
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_SESSION],
    });
    const response = await built.app.inject({
      method: 'GET',
      url: `/sessions/${PUBLIC_SESSION.id}`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [], // no sessions seeded
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff0001';
    const response = await built.app.inject({
      method: 'GET',
      url: `/sessions/${unknownId}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // The existence-leak rule: Ben must not be able to tell whether
    // Alice's private session exists. The response must be 404,
    // identical in shape to the unknown-id case above.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ALICE],
      participants: [],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/sessions/${PRIVATE_ALICE.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    // CRITICAL — 404, not 403. Asserting the exact status here is
    // the load-bearing test for the existence-leak rule.
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 200 for the host on their own private session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ALICE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/sessions/${PRIVATE_ALICE.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id?: string; privacy?: string; hostUserId?: string }>();
    expect(body.id).toBe(PRIVATE_ALICE.id);
    expect(body.privacy).toBe('private');
    expect(body.hostUserId).toBe(ALICE_ID);
  });

  it('returns 200 for a participant on a private session they are part of', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ALICE],
      participants: [{ session_id: PRIVATE_ALICE.id, user_id: BEN_ID }],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/sessions/${PRIVATE_ALICE.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id?: string; privacy?: string }>();
    expect(body.id).toBe(PRIVATE_ALICE.id);
    expect(body.privacy).toBe('private');
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_SESSION],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/sessions/not-a-uuid',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});

describe('POST /sessions/:id/end — moderator ends the session', () => {
  // Seed helper — same shape as the list / get suites. Each test seeds
  // the exact users + sessions + (optional) participants + (optional)
  // pre-existing session_events the scenario needs, then drives a
  // POST /sessions/:id/end against the resulting app.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded session rows. Distinct from the list /
  // get-suite ids so a stray cross-suite reference fails loudly.
  const PUBLIC_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-eeee00000001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate to end',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ALREADY_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-eeee00000002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Already ended',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: new Date('2026-05-08T11:00:00.000Z'),
  };
  const PRIVATE_BENS: SessionRow = {
    id: '00000000-0000-4000-8000-eeee00000003',
    host_user_id: BEN_ID,
    privacy: 'private',
    topic: "Ben's private session",
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    ended_at: null,
  };

  // Pre-existing `session-created` event for ALICE's public session.
  // The endpoint's MAX(sequence) read sees this as the highest
  // existing sequence, so `nextSeq = 2` for the session-ended event.
  const SESSION_CREATED_EVENT: SessionEventRow = {
    id: '99999999-9999-4999-8999-999999999001',
    session_id: PUBLIC_ACTIVE.id,
    sequence: 1,
    kind: 'session-created',
    actor: ALICE_ID,
    payload: {
      host_user_id: ALICE_ID,
      privacy: 'public',
      topic: 'A debate to end',
      created_at: '2026-05-09T10:00:00.000Z',
    },
    created_at: new Date('2026-05-09T10:00:00.001Z'),
  };

  it('returns 200 + the camelCase session shape with endedAt populated when the host ends an active session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${PUBLIC_ACTIVE.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(body.id).toBe(PUBLIC_ACTIVE.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('public');
    expect(body.topic).toBe('A debate to end');
    expect(typeof body.endedAt).toBe('string');
    // Same iso the shim's UPDATE handler pinned.
    expect(body.endedAt).toBe('2026-05-10T12:00:01.000Z');
  });

  it('writes BOTH the UPDATE and the session-ended event atomically at the next sequence', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${PUBLIC_ACTIVE.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);

    // The UPDATE: the in-memory session row now carries a non-null
    // ended_at. The shim's UPDATE handler mutates in place, so the
    // store's sessions array has the new ended_at value.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.ended_at).not.toBeNull();

    // The INSERT: the session-ended event landed at sequence=2 (the
    // pre-existing session-created sat at sequence=1, so MAX+1 = 2).
    const endedEvent = built.store.events.find(
      (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-ended',
    );
    expect(endedEvent).toBeDefined();
    expect(endedEvent?.sequence).toBe(2);
    expect(endedEvent?.actor).toBe(ALICE_ID);
    const payload = endedEvent?.payload as Record<string, unknown>;
    expect(typeof payload?.['ended_at']).toBe('string');
    // The payload's ended_at mirrors the column's value (the shim's
    // UPDATE handler pinned both to the same iso string).
    expect(payload?.['ended_at']).toBe('2026-05-10T12:00:01.000Z');

    // Transaction shape: BEGIN, the SELECT + UPDATE + MAX + INSERT
    // run inside, then COMMIT. NO ROLLBACK on the success path.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 403 not-a-moderator when the caller is visible but is not the host', async () => {
    // Public session — Ben can see it (it's public), but Alice is the
    // host, so Ben's attempt to end it must be rejected with 403.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${PUBLIC_ACTIVE.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');

    // No write side-effects: the session remains active, no new event
    // landed, the transaction rolled back.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.ended_at).toBeNull();
    expect(
      built.store.events.filter(
        (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-ended',
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // Alice tries to end Ben's private session — she can't even see
    // it. Visibility-non-leak rule fires BEFORE the authority check:
    // 404, not 403, NOT some other distinguishable status. The
    // session's existence isn't leaked.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_BENS],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${PRIVATE_BENS.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');

    // No write side-effects.
    const sessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_BENS.id);
    expect(sessionAfter?.ended_at).toBeNull();
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 session-already-ended when the host re-attempts on an already-ended session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ALREADY_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${PUBLIC_ALREADY_ENDED.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');

    // The row's ended_at is unchanged (still the original timestamp,
    // not the shim's UPDATE-handler pin), and no new session-ended
    // event landed. The transaction rolled back.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ALREADY_ENDED.id);
    expect(sessionAfter?.ended_at?.toISOString()).toBe('2026-05-08T11:00:00.000Z');
    expect(
      built.store.events.filter(
        (e) => e.session_id === PUBLIC_ALREADY_ENDED.id && e.kind === 'session-ended',
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff0009';
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${unknownId}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/sessions/not-a-uuid/end',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const response = await built.app.inject({
      method: 'POST',
      url: `/sessions/${PUBLIC_ACTIVE.id}/end`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    // No write side-effects whatsoever — the middleware threw before
    // the handler ran, so no BEGIN.
    expect(built.store.trace).toHaveLength(0);
    expect(built.store.events.filter((e) => e.kind === 'session-ended')).toHaveLength(0);
  });
});

describe('PATCH /sessions/:id/privacy — host toggles session privacy', () => {
  // Seed helper — same shape as the list / get / end suites. Each
  // test seeds the exact users + sessions + (optional) participants
  // needed and drives a PATCH /sessions/:id/privacy.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded session rows. Distinct from every
  // other suite's ids so a stray cross-suite reference fails loudly.
  const PUBLIC_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate to privatize',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000002',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'A private debate to publish',
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000003',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Already finished',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: new Date('2026-05-08T11:00:00.000Z'),
  };
  const PRIVATE_BENS: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000004',
    host_user_id: BEN_ID,
    privacy: 'private',
    topic: "Ben's private session",
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    ended_at: null,
  };

  it('returns 200 + the new privacy in the response when the host toggles public to private', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(body.id).toBe(PUBLIC_ACTIVE.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('private');
    expect(body.topic).toBe('A debate to privatize');
    expect(body.endedAt).toBeNull();

    // The in-memory row reflects the new value — the UPDATE landed.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('private');

    // No event landed — Option B (no `session-privacy-changed` kind).
    expect(built.store.events).toHaveLength(0);
  });

  it('returns 200 with the unchanged privacy when the host sets the same value (idempotent)', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    // The row is already public; set it to public again.
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ privacy?: string }>();
    expect(body.privacy).toBe('public');
    // Row's privacy still public — no-op write at the DB layer.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns 403 not-a-moderator when the caller is visible but is not the host', async () => {
    // Public session — Ben can see it, but Alice is the host. Ben's
    // attempt to toggle privacy must be rejected with 403.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');

    // Row's privacy unchanged.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // Alice tries to toggle Ben's private session — she can't even
    // see it. Visibility-non-leak rule fires BEFORE the authority
    // check: 404, not 403. Identical response to nonexistent-id.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_BENS],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PRIVATE_BENS.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');

    // Row's privacy unchanged.
    const sessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_BENS.id);
    expect(sessionAfter?.privacy).toBe('private');
  });

  it('returns 409 session-already-ended when the host attempts to toggle an ended session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PUBLIC_ENDED.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');

    // Row's privacy unchanged.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ENDED.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff000a';
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${unknownId}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 400 validation-failed when the body omits privacy or carries an invalid enum', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ACTIVE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);

    // Missing privacy.
    const missing = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PRIVATE_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Invalid enum.
    const bad = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PRIVATE_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'secret' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Row's privacy unchanged through both attempts.
    const sessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('private');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    // No write side-effects.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('public');
  });
});
