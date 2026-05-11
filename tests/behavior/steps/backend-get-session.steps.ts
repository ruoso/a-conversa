// Step definitions for tests/behavior/backend/get-session.feature.
//
// Refinement: tasks/refinements/backend/get_session_endpoint.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.get_session_endpoint
//
// **What this layer exercises.** `GET /sessions/:id` end-to-end
// against the real migrated schema in pglite — `sessions` and
// `session_participants` are real tables; the SELECT runs through
// the production handler against the pglite-backed DbPool adapter
// (the same adapter the create-session / list-session scenarios
// register, in backend-create-session.steps.ts's "the sessions
// server is built with the pglite-backed pool" Given).
//
// What's covered:
//   1. Successful fetch of a visible public session → 200 + body.
//   2. Private session NOT visible to a non-participant → 404
//      (load-bearing: the existence-leak rule says 404, NOT 403).
//   3. Unknown id → 404 not-found.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-create-session.steps.ts.
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
//   - "the response body's topic is {string}"
//   - "the response body's privacy is {string}"
//   - "the response body's hostUserId matches the user's id"
//     → tests/behavior/steps/backend-create-session.steps.ts.

import { When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

// Local view onto the shared scratch. The create-session step file
// stores `sessionsApp` and `sessionCookieValue` under these keys.
interface GetSessionScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): GetSessionScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as GetSessionScratch;
}

// Shared test secret pinned by the create-session steps. Re-used so
// per-user tokens minted here verify under the same key the middleware
// (instantiated by `the sessions server is built ...`) uses.
const TEST_SESSION_SECRET = 'test-session-secret';

// ============================================================
// Whens — issue GET /sessions/:id with either the Background user's
// cookie OR a freshly-minted cookie for a named other user.
// ============================================================

When(
  'I GET \\/sessions\\/:id for the most recently created session',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const idRes = (await this.db.query(
      'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const sessionId = idRes.rows[0]?.id;
    assert.ok(sessionId, 'no sessions row found to fetch by id');
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${sessionId}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I GET \\/sessions\\/:id for the most recently created session as user {string}',
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
    const idRes = (await this.db.query(
      'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const sessionId = idRes.rows[0]?.id;
    assert.ok(sessionId, 'no sessions row found to fetch by id');
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${sessionId}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When('I GET \\/sessions\\/{word}', async function (this: AConversaWorld, literalId: string) {
  // Used by the "unknown id returns 404" scenario — the feature
  // file hard-codes a UUID that the DB will never have. The token
  // is the Background user's, so auth passes and the handler runs
  // the visibility SELECT (which finds zero rows).
  const s = scratch(this);
  const app = s.sessionsApp;
  assert.ok(app, 'sessions app not initialized — Background step missing');
  const cookieValue = s.sessionCookieValue;
  assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
  const response = await app.inject({
    method: 'GET',
    url: `/sessions/${literalId}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
