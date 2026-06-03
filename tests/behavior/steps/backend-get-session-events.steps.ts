// Step definitions for tests/behavior/backend/get-session-events.feature.
//
// Refinement: tasks/refinements/backend/get_session_log.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.replay_endpoints.get_session_log
//
// **What this layer exercises.** `GET /sessions/:id/events` end-to-end
// against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables; the
// read runs through the production handler against the pglite-backed
// DbPool adapter. Covers ascending replay order, cursor pagination
// (`?after` + `?limit`), the visibility gate (private session NOT
// visible to a non-participant → 404), and unknown id → 404.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "a public session with topic {string} exists for that user at {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "a private session with topic {string} exists for user {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → tests/behavior/steps/backend-oauth-callback.steps.ts.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestReplayApp } from '../../../apps/server/src/replay/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestReplayApp>>;

interface GetEventsScratch {
  replayApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): GetEventsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as GetEventsScratch;
}

// Shared test secret pinned by the session-token steps. Re-used so
// per-user tokens minted here verify under the same key the middleware
// (instantiated by `the replay server is built ...`) uses.
const TEST_SESSION_SECRET = 'test-session-secret';

async function mostRecentSessionId(world: AConversaWorld): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, 'no sessions row found — a Given seeding a session is missing');
  return id;
}

async function injectEvents(
  world: AConversaWorld,
  sessionId: string,
  cookieValue: string,
  search: string,
): Promise<void> {
  const s = scratch(world);
  const app = s.replayApp;
  assert.ok(app, 'replay app not initialized — Background step missing');
  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/events${search}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
}

// ============================================================
// Givens
// ============================================================

Given(
  'the replay server is built with the pglite-backed pool',
  async function (this: AConversaWorld) {
    // Adapter — translate the DbPool surface onto the world's PGlite
    // handle (same shape the sessions scenarios register). The read
    // path issues plain `pool.query`; no `connect()` needed.
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
    const app = await __buildTestReplayApp({
      pool,
      sessionTokenSecret: TEST_SESSION_SECRET,
    });
    scratch(this).replayApp = app;
  },
);

Given(
  'the most recently created session has {int} events',
  async function (this: AConversaWorld, count: number) {
    // Resolve the just-seeded session and its host; append `count`
    // proposal events at sequences 1..count, actored by the host.
    const res = (await this.db.query(
      'SELECT id, host_user_id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string; host_user_id: string }>;
    const row = res.rows[0];
    assert.ok(row, 'no sessions row found to seed events into');
    for (let seq = 1; seq <= count; seq += 1) {
      await this.db.query(
        `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
         VALUES ($1, $2, 'proposal', $3, $4::jsonb)`,
        [row.id, seq, row.host_user_id, JSON.stringify({ n: seq })],
      );
    }
  },
);

// ============================================================
// Whens
// ============================================================

When(
  'I GET the events for the most recently created session',
  async function (this: AConversaWorld) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectEvents(this, sessionId, cookieValue, '');
  },
);

When(
  'I GET the events for the most recently created session with limit {int}',
  async function (this: AConversaWorld, limit: number) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectEvents(this, sessionId, cookieValue, `?limit=${limit}`);
  },
);

When(
  'I GET the events for the most recently created session with limit {int} after {int}',
  async function (this: AConversaWorld, limit: number, after: number) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectEvents(this, sessionId, cookieValue, `?limit=${limit}&after=${after}`);
  },
);

When(
  'I GET the events for the most recently created session as user {string}',
  async function (this: AConversaWorld, screenName: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user visibility test).
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
    const sessionId = await mostRecentSessionId(this);
    await injectEvents(this, sessionId, token, '');
  },
);

When(
  'I GET the events for session {string}',
  async function (this: AConversaWorld, literalId: string) {
    // The unknown-id scenario — the feature hard-codes a UUID the DB
    // will never have. Auth passes (Background user's cookie); the
    // visibility gate finds zero rows → 404.
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    await injectEvents(this, literalId, cookieValue, '');
  },
);

// ============================================================
// Thens
// ============================================================

// Singular/plural tolerant: "has 1 entry" and "has 3 entries".
Then(
  /^the response body's events array has (\d+) entr(?:y|ies)$/,
  function (this: AConversaWorld, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { events?: unknown[] };
    assert.ok(Array.isArray(body.events), 'response body lacks an `events` array');
    assert.equal(body.events.length, Number.parseInt(expectedRaw, 10));
  },
);

Then(
  /^the response body's events\[(\d+)\]\.sequence is (\d+)$/,
  function (this: AConversaWorld, idxRaw: string, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { events?: Array<{ sequence?: number }> };
    assert.ok(Array.isArray(body.events), 'response body lacks an `events` array');
    const idx = Number.parseInt(idxRaw, 10);
    assert.equal(body.events[idx]?.sequence, Number.parseInt(expectedRaw, 10));
  },
);

Then("the response body's nextCursor is {int}", function (this: AConversaWorld, expected: number) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { nextCursor?: number | null };
  assert.equal(body.nextCursor, expected);
});

Then("the response body's nextCursor is null", function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { nextCursor?: number | null };
  assert.equal(body.nextCursor, null);
});

// Close the replay app at scenario end (the world's After hook closes
// the pglite handle; the Fastify instance is owned here).
After(async function (this: AConversaWorld) {
  const app = scratch(this).replayApp;
  if (app) {
    await app.close();
  }
});
