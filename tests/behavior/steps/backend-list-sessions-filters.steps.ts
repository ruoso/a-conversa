// Step definitions for tests/behavior/backend/list-sessions-filters.feature.
//
// Refinement: tasks/refinements/backend/session_listing_filters.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.session_listing_filters
//
// **What this layer exercises.** `GET /sessions` with the new filter
// surface (`?host=`, `?participant=`, `?privacy=`, `?topic=`, `?limit=`,
// `?offset=`) end-to-end against the real migrated schema in pglite —
// the visibility gate is still in place; the filters AND-compose on
// top. The response wrapper now carries `{ sessions, total }` and the
// scenarios assert against both.
//
// What's covered:
//   1. `?host=<userId>` narrows to sessions hosted by the named user.
//   2. `?privacy=private` respects the visibility gate — a non-
//      participant asking for the private bucket sees nothing.
//   3. `?topic=<substring>` matches case-insensitively (ILIKE).
//   4. `?limit` + `?offset` paginates over the full visibility-gated
//      set; `total` reports the unpaged count.
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
//   - "a public session with topic {string} exists for that user at {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "the response body's sessions array has {int} entry/entries"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "the response body's sessions[{int}].topic is {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface FiltersScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): FiltersScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as FiltersScratch;
}

// Pinned in the create-session steps' Background — same value the auth
// middleware uses when the sessions app is instantiated, so JWTs minted
// in step bodies here verify under the same key.
const TEST_SESSION_SECRET = 'test-session-secret';

// ============================================================
// Givens — seed sessions for the named user (by screen_name)
// ============================================================

Given(
  'a public session with topic {string} exists for user {string}',
  async function (this: AConversaWorld, topic: string, screenName: string) {
    // Look up the user row by screen_name (distinct from the
    // "for that user" variant in backend-list-sessions.steps.ts which
    // keys off the most-recently-created users row).
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${screenName}`);
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, 'public', $2)`,
      [hostId, topic],
    );
  },
);

// ============================================================
// Whens — issue GET /sessions with various query-string shapes
// ============================================================

When(
  'I GET \\/sessions filtered by host {string}',
  async function (this: AConversaWorld, screenName: string) {
    // Resolve the screen_name → user id, then query with `?host=<id>`.
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);

    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions?host=${userId}`,
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
  'I GET \\/sessions filtered by privacy {string} as user {string}',
  async function (this: AConversaWorld, privacy: string, screenName: string) {
    // Mint a fresh cookie for the named user (the Background's cookie
    // is for alice; this step is the cross-user visibility-respect
    // test, so we need ben's identity).
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
      url: `/api/sessions?privacy=${encodeURIComponent(privacy)}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I GET \\/sessions filtered by topic {string}',
  async function (this: AConversaWorld, topic: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions?topic=${encodeURIComponent(topic)}`,
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
  'I GET \\/sessions with limit {int} and offset {int}',
  async function (this: AConversaWorld, limit: number, offset: number) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions?limit=${String(limit)}&offset=${String(offset)}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

// ============================================================
// Thens — assert against the wrapped `{ sessions, total }` shape
// ============================================================

Then("the response body's total is {int}", function (this: AConversaWorld, expected: number) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { total?: number };
  assert.equal(body.total, expected);
});

// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
