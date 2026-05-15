// Step definitions for tests/behavior/backend/list-sessions.feature.
//
// Refinement: tasks/refinements/backend/list_sessions_endpoint.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.list_sessions_endpoint
//
// **What this layer exercises.** `GET /sessions` end-to-end against
// the real migrated schema in pglite — `sessions` and
// `session_participants` are real tables; the SELECT runs through the
// production handler against the pglite-backed DbPool adapter (the
// same adapter the create-session scenarios use, registered in
// backend-create-session.steps.ts's
// "the sessions server is built with the pglite-backed pool" Given).
//
// What's covered:
//   1. Empty DB → empty list.
//   2. Two public sessions → both visible in created_at DESC order.
//   3. Private session NOT visible to a non-participant.
//   4. Private session IS visible to a participant.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

// Local view onto the shared scratch. The create-session step file
// already stores `sessionsApp` and `sessionCookieValue` under these
// keys; we read both and add our own response slot. The cast at use
// sites narrows the structural shape.
interface ListSessionsScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): ListSessionsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ListSessionsScratch;
}

// The shared test secret pinned in the create-session steps; we sign
// per-user tokens here under the same key so the auth middleware
// (instantiated by `the sessions server is built ...`) accepts them.
const TEST_SESSION_SECRET = 'test-session-secret';

// ============================================================
// Givens — seed sessions and participation rows directly into pglite
// ============================================================

Given(
  'a public session with topic {string} exists for that user at {string}',
  async function (this: AConversaWorld, topic: string, createdAtIso: string) {
    // Look up the most-recently-created users row (the Background's
    // alice). The sessions INSERT uses the row id as host_user_id.
    // `created_at` is forced to the supplied timestamp so the DESC
    // ordering assertion is deterministic.
    const userRes = (await this.db.query(
      'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, 'no users row found to seed a session against');
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic, created_at)
       VALUES ($1, 'public', $2, $3)`,
      [hostId, topic, createdAtIso],
    );
  },
);

Given(
  'a private session with topic {string} exists for user {string}',
  async function (this: AConversaWorld, topic: string, screenName: string) {
    // Look up the user row by screen_name (the feature's user name
    // identifier in this scenario). Distinct from the "for that user"
    // variant above which keys off the most-recently-created row.
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${screenName}`);
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, 'private', $2)`,
      [hostId, topic],
    );
  },
);

Given(
  'user {string} is a participant in that private session',
  async function (this: AConversaWorld, screenName: string) {
    // Resolve user id by screen_name; resolve the private session
    // id by the most-recently-created private session (the scenario's
    // prior Given just created it). The participants row uses
    // role='debater-A' — any valid role from the CHECK list suffices
    // for the visibility-gate scenario; the role isn't asserted, only
    // the existence of the participants row.
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const sessionRes = (await this.db.query(
      "SELECT id FROM sessions WHERE privacy = 'private' ORDER BY created_at DESC LIMIT 1",
    )) as QueryResult<{ id: string }>;
    const sessionId = sessionRes.rows[0]?.id;
    assert.ok(sessionId, 'no private session found to seed a participant into');
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, userId],
    );
  },
);

// ============================================================
// Whens — issue GET /sessions, either as the Background's alice or
// as a specified other user (mints a fresh token for that user).
// ============================================================

When('I GET \\/sessions', async function (this: AConversaWorld) {
  const s = scratch(this);
  const app = s.sessionsApp;
  assert.ok(app, 'sessions app not initialized — Background step missing');
  const cookieValue = s.sessionCookieValue;
  assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
  const response = await app.inject({
    method: 'GET',
    url: '/api/sessions',
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

When(
  'I GET \\/sessions as user {string}',
  async function (this: AConversaWorld, screenName: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user visibility test). Re-uses
    // the shared TEST_SESSION_SECRET so the middleware accepts it.
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

// ============================================================
// Thens — assert against the wrapped `{ sessions: [...] }` shape.
// ============================================================

Then(
  "the response body's sessions array has {int} entries",
  function (this: AConversaWorld, expected: number) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: unknown[] };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    assert.equal(body.sessions.length, expected);
  },
);

Then(
  "the response body's sessions array has {int} entry",
  function (this: AConversaWorld, expected: number) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: unknown[] };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    assert.equal(body.sessions.length, expected);
  },
);

Then(
  "the response body's sessions[{int}].topic is {string}",
  function (this: AConversaWorld, idx: number, expected: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: Array<{ topic?: string }> };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    assert.equal(body.sessions[idx]?.topic, expected);
  },
);

Then(
  "the response body's sessions[{int}].privacy is {string}",
  function (this: AConversaWorld, idx: number, expected: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: Array<{ privacy?: string }> };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    assert.equal(body.sessions[idx]?.privacy, expected);
  },
);

// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
