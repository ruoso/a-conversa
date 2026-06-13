// Step definitions for tests/behavior/backend/my-sessions.feature.
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_endpoint.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: session_discovery.sd_api.sd_my_sessions_endpoint
//
// **What this layer exercises.** `GET /sessions/mine` end-to-end against
// the real migrated schema in pglite — `sessions` (with `started_at`)
// and `session_participants` are real tables; the SELECT runs through
// the production handler via the same DbPool adapter the create-session
// and list-sessions scenarios use (registered in
// backend-create-session.steps.ts's "the sessions server is built with
// the pglite-backed pool" Given).
//
// What's covered: membership scope + per-row role annotation
// (host/moderator/debater), non-member absence (incl. a public
// session), lifecycle inclusion (lobby/started/ended), lobby-first
// ordering, role precedence (host beats participant; active beats
// historical), topic + date filtering, the over-cap 400, pagination,
// and auth.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     and "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → tests/behavior/steps/backend-oauth-callback.steps.ts.
//   - "the response body's sessions array has {int} entry/entries" and
//     "the response body's sessions[{int}].topic is {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "the response body's total is {int}"
//     → tests/behavior/steps/backend-list-sessions-filters.steps.ts.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface MySessionsScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): MySessionsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as MySessionsScratch;
}

async function userIdByScreenName(world: AConversaWorld, screenName: string): Promise<string> {
  const res = (await world.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
    screenName,
  ])) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, `no users row found for screen_name ${screenName}`);
  return id;
}

async function sessionIdByTopic(world: AConversaWorld, topic: string): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions WHERE topic = $1 ORDER BY created_at DESC LIMIT 1',
    [topic],
  )) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, `no sessions row found with topic ${topic}`);
  return id;
}

async function inject(
  world: AConversaWorld,
  url: string,
  cookie: string | undefined,
): Promise<void> {
  const s = scratch(world);
  const app = s.sessionsApp;
  assert.ok(app, 'sessions app not initialized — Background step missing');
  const headers = cookie !== undefined ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {};
  const response = await app.inject({ method: 'GET', url, headers });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
}

// ============================================================
// Givens — seed sessions (with started_at / ended_at) and membership
// rows directly into pglite.
// ============================================================

Given(
  'a lobby session with topic {string} hosted by {string}',
  async function (this: AConversaWorld, topic: string, screenName: string) {
    const hostId = await userIdByScreenName(this, screenName);
    // started_at NULL ⟺ lobby (unstarted); ended_at NULL ⟺ live.
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic, started_at, ended_at)
       VALUES ($1, 'public', $2, NULL, NULL)`,
      [hostId, topic],
    );
  },
);

Given(
  'a started session with topic {string} hosted by {string} started at {string}',
  async function (this: AConversaWorld, topic: string, screenName: string, startedAt: string) {
    const hostId = await userIdByScreenName(this, screenName);
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic, started_at, ended_at)
       VALUES ($1, 'public', $2, $3, NULL)`,
      [hostId, topic, startedAt],
    );
  },
);

Given(
  'an ended session with topic {string} hosted by {string} started at {string}',
  async function (this: AConversaWorld, topic: string, screenName: string, startedAt: string) {
    const hostId = await userIdByScreenName(this, screenName);
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic, started_at, ended_at)
       VALUES ($1, 'public', $2, $3, NOW())`,
      [hostId, topic, startedAt],
    );
  },
);

Given(
  '{string} is a {string} participant in the session with topic {string}',
  async function (this: AConversaWorld, screenName: string, role: string, topic: string) {
    const userId = await userIdByScreenName(this, screenName);
    const sessionId = await sessionIdByTopic(this, topic);
    // Active membership row (left_at NULL).
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, $3)`,
      [sessionId, userId, role],
    );
  },
);

Given(
  '{string} held a {string} participant row in the session with topic {string} but left',
  async function (this: AConversaWorld, screenName: string, role: string, topic: string) {
    const userId = await userIdByScreenName(this, screenName);
    const sessionId = await sessionIdByTopic(this, topic);
    // Historical row — left_at populated. The partial-unique index only
    // covers active rows, so a left row plus a later active row in a
    // different role coexist (the role-precedence pin).
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role, left_at)
       VALUES ($1, $2, $3, NOW())`,
      [sessionId, userId, role],
    );
  },
);

// ============================================================
// Whens — issue GET /sessions/mine with various query-string shapes.
// ============================================================

// NB: the bare verb is deliberately phrased "I request my sessions"
// rather than "I GET /sessions/mine" — the latter would collide with
// the parametric `I GET /sessions/{word}` step (backend-get-session.steps.ts),
// which `{word}`-matches "mine" and makes the step ambiguous.
When('I request my sessions', async function (this: AConversaWorld) {
  await inject(this, '/api/sessions/mine', scratch(this).sessionCookieValue);
});

When(
  'I request my sessions filtered by topic {string}',
  async function (this: AConversaWorld, topic: string) {
    await inject(
      this,
      `/api/sessions/mine?topic=${encodeURIComponent(topic)}`,
      scratch(this).sessionCookieValue,
    );
  },
);

When(
  'I request my sessions started after {string}',
  async function (this: AConversaWorld, startedAfter: string) {
    await inject(
      this,
      `/api/sessions/mine?startedAfter=${encodeURIComponent(startedAfter)}`,
      scratch(this).sessionCookieValue,
    );
  },
);

When(
  'I request my sessions with limit {int} and offset {int}',
  async function (this: AConversaWorld, limit: number, offset: number) {
    await inject(
      this,
      `/api/sessions/mine?limit=${String(limit)}&offset=${String(offset)}`,
      scratch(this).sessionCookieValue,
    );
  },
);

When(
  'I request my sessions with offset {int}',
  async function (this: AConversaWorld, offset: number) {
    await inject(
      this,
      `/api/sessions/mine?offset=${String(offset)}`,
      scratch(this).sessionCookieValue,
    );
  },
);

When('I request my sessions without a session cookie', async function (this: AConversaWorld) {
  await inject(this, '/api/sessions/mine', undefined);
});

// ============================================================
// Thens — membership/role assertions over the `{ sessions, total }`
// wrapper (order-independent; the ordering scenario uses the shared
// `sessions[{int}].topic` step instead).
// ============================================================

Then(
  'the response body contains a session with topic {string} and role {string}',
  function (this: AConversaWorld, topic: string, role: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: Array<{ topic?: string; role?: string }> };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    const match = body.sessions.find((s) => s.topic === topic);
    assert.ok(match, `no session with topic ${topic} in the response`);
    assert.equal(match.role, role, `session ${topic} role mismatch`);
  },
);

Then(
  'the response body does not contain a session with topic {string}',
  function (this: AConversaWorld, topic: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: Array<{ topic?: string }> };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    const match = body.sessions.find((s) => s.topic === topic);
    assert.equal(match, undefined, `unexpected session with topic ${topic} in the response`);
  },
);

// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
