// Step definitions for tests/behavior/backend/create-session.feature.
//
// Refinement: tasks/refinements/backend/create_session_endpoint.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.create_session_endpoint
//
// **What this layer exercises.** `POST /sessions` end-to-end against
// the real migrated schema in pglite:
//
//   1. Successful creation writes BOTH the `sessions` row AND the
//      `session-created` event (sequence=1, payload mirrors the row).
//   2. Privacy defaults to `'public'` when omitted.
//   3. Empty topic is rejected with 400 `validation-failed`; neither
//      table is written.
//
// What's real:
//   - The handler's BEGIN / INSERT(sessions) / INSERT(session_events)
//     / COMMIT chain — runs against the migrated `sessions` and
//     `session_events` tables. The pglite single-handle adapter
//     issues the transaction-control statements directly.
//   - The JWT verification (HS256) against the shared test secret.
//   - The Fastify schema validator + the centralized error-handler's
//     `validation-failed` envelope.
//
// Re-uses Givens from `users.steps.ts` (the
// `a user with oauth_subject {string} exists with screen_name {string}`
// step lives in `backend-session-token.steps.ts`).

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface CreateSessionScratch {
  sessionsApp?: FastifyAppInstance;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
  sessionCookieValue?: string;
}

function scratch(world: AConversaWorld): CreateSessionScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as CreateSessionScratch;
}

// The shared test secret pinned by `backend-oauth-callback.steps.ts`
// (same value the auth middleware uses) so JWTs minted in
// `backend-session-token.steps.ts`'s
// `I have a valid session cookie for that user` step verify under the
// same key the server's middleware uses.
const TEST_SESSION_SECRET = 'test-session-secret';

Given(
  'the sessions server is built with the pglite-backed pool',
  async function (this: AConversaWorld) {
    // Adapter — translate the DbPool surface onto the world's PGlite
    // handle. PGlite's `query(text, params?)` returns `Results<T>` (with
    // `.rows`), which is structurally compatible with our DbPool's
    // `{ rows: T[] }` return type. The adapter does NOT implement
    // `connect()`: PGlite is single-connection by nature, so the
    // `withTransaction` helper falls back to issuing BEGIN/COMMIT/ROLLBACK
    // directly against `pool.query` — which against pglite is exactly
    // what we want (one in-process transaction, no cross-connection
    // hazards). The production `pg.Pool` path (with `connect()`) is
    // exercised by the Vitest unit suite via a memory shim.
    const dbHandle = this.db;
    const pool = {
      async query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
        return { rows: result.rows };
      },
    };

    const app = await __buildTestSessionsApp({
      pool,
      sessionTokenSecret: TEST_SESSION_SECRET,
    });
    scratch(this).sessionsApp = app;
  },
);

When(
  'I POST \\/sessions with topic {string} and privacy {string}',
  async function (this: AConversaWorld, topic: string, privacy: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      payload: { topic, privacy },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/sessions with topic {string} and no privacy field',
  async function (this: AConversaWorld, topic: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      payload: { topic },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

// Note: `Then('the response status is {int}', ...)` is owned by
// tests/behavior/steps/http-server.steps.ts. Reused unchanged.

// Note: `Then("the response body's error.code is {string}", ...)` is
// owned by tests/behavior/steps/backend-oauth-callback.steps.ts.
// Reused unchanged.

Then("the response body's hostUserId matches the user's id", async function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { hostUserId?: string };
  const result = (await this.db.query(
    'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const expected = result.rows[0]?.id;
  assert.ok(expected, 'no users row found to compare against');
  assert.equal(body.hostUserId, expected);
});

Then("the response body's privacy is {string}", function (this: AConversaWorld, expected: string) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { privacy?: string };
  assert.equal(body.privacy, expected);
});

Then("the response body's topic is {string}", function (this: AConversaWorld, expected: string) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { topic?: string };
  assert.equal(body.topic, expected);
});

Then("the response body's endedAt is null", function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { endedAt?: unknown };
  assert.equal(body.endedAt, null);
});

Then(
  'the sessions table has {int} row(s) for that host',
  async function (this: AConversaWorld, expected: number) {
    const userRes = (await this.db.query(
      'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, 'no users row found');
    const res = (await this.db.query(
      'SELECT COUNT(*)::int AS count FROM sessions WHERE host_user_id = $1',
      [userId],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expected);
  },
);

Then(
  'the session_events table has {int} row at sequence {int} with kind {string}',
  async function (this: AConversaWorld, expectedCount: number, sequence: number, kind: string) {
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_events
       WHERE sequence = $1 AND kind = $2`,
      [sequence, kind],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expectedCount);
  },
);

Then(
  'the session_events table has {int} rows',
  async function (this: AConversaWorld, expected: number) {
    const res = (await this.db.query(
      'SELECT COUNT(*)::int AS count FROM session_events',
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expected);
  },
);

Then(
  "the session-created event's payload host_user_id matches the user's id",
  async function (this: AConversaWorld) {
    const userRes = (await this.db.query(
      'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, 'no users row found');
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1 AND sequence = $2
       LIMIT 1`,
      ['session-created', 1],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-created event row found');
    assert.equal(payload['host_user_id'], userId);
  },
);

Then(
  "the session-created event's payload privacy is {string}",
  async function (this: AConversaWorld, expected: string) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1 AND sequence = $2
       LIMIT 1`,
      ['session-created', 1],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-created event row found');
    assert.equal(payload['privacy'], expected);
  },
);

Then(
  "the session-created event's payload topic is {string}",
  async function (this: AConversaWorld, expected: string) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1 AND sequence = $2
       LIMIT 1`,
      ['session-created', 1],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-created event row found');
    assert.equal(payload['topic'], expected);
  },
);

Then(
  "the sessions row's privacy is {string}",
  async function (this: AConversaWorld, expected: string) {
    const res = (await this.db.query(
      'SELECT privacy FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ privacy: string }>;
    assert.equal(res.rows[0]?.privacy, expected);
  },
);

After(async function (this: AConversaWorld) {
  const s = scratch(this);
  if (s.sessionsApp) {
    await s.sessionsApp.close();
    delete s.sessionsApp;
  }
});
