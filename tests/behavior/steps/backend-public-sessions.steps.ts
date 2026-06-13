// Step definitions for tests/behavior/backend/public-sessions.feature.
//
// Refinement: tasks/refinements/session_discovery/sd_public_sessions_endpoint.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0029-anonymous-public-session-access.md
// TaskJuggler: session_discovery.sd_api.sd_public_sessions_endpoint
//
// **What this layer exercises.** The anonymous `GET /sessions/public`
// end-to-end against the real migrated schema in pglite — `sessions`
// (with `started_at`) is a real table; the SELECT runs through the
// production handler via the same DbPool adapter the create-session and
// list-sessions scenarios use (registered in
// backend-create-session.steps.ts's "the sessions server is built with
// the pglite-backed pool" Given).
//
// What's covered: the lobby-secrecy + public-only gate (started public
// in; lobby and private out), live + ended inclusion, anonymous access
// (no cookie → 200; a valid cookie does not widen the result),
// listing-fields-only disclosure, start-time ordering, topic + date
// filtering, the over-cap 400, and pagination.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     and "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "a started session with topic {string} hosted by {string} started at {string}",
//     "a lobby session with topic {string} hosted by {string}",
//     "an ended session with topic {string} hosted by {string} started at {string}",
//     and "the response body does not contain a session with topic {string}"
//     → tests/behavior/steps/backend-my-sessions.steps.ts.
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

interface PublicSessionsScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): PublicSessionsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as PublicSessionsScratch;
}

async function userIdByScreenName(world: AConversaWorld, screenName: string): Promise<string> {
  const res = (await world.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
    screenName,
  ])) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, `no users row found for screen_name ${screenName}`);
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
// Givens — seed a started private session (the public-set exclusion the
// sibling my-sessions seed steps, all `'public'`, don't cover).
// ============================================================

Given(
  'a started private session with topic {string} hosted by {string} started at {string}',
  async function (this: AConversaWorld, topic: string, screenName: string, startedAt: string) {
    const hostId = await userIdByScreenName(this, screenName);
    await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic, started_at, ended_at)
       VALUES ($1, 'private', $2, $3, NULL)`,
      [hostId, topic, startedAt],
    );
  },
);

// ============================================================
// Whens — issue GET /sessions/public with various query-string shapes.
// The endpoint is anonymous, so the bare verb omits the cookie; the
// "with my session cookie" variant proves a valid cookie is ignored, not
// required.
// ============================================================

When('I request the public sessions', async function (this: AConversaWorld) {
  await inject(this, '/api/sessions/public', undefined);
});

When(
  'I request the public sessions without a session cookie',
  async function (this: AConversaWorld) {
    await inject(this, '/api/sessions/public', undefined);
  },
);

When('I request the public sessions with my session cookie', async function (this: AConversaWorld) {
  await inject(this, '/api/sessions/public', scratch(this).sessionCookieValue);
});

When(
  'I request the public sessions filtered by topic {string}',
  async function (this: AConversaWorld, topic: string) {
    await inject(this, `/api/sessions/public?topic=${encodeURIComponent(topic)}`, undefined);
  },
);

When(
  'I request the public sessions started after {string}',
  async function (this: AConversaWorld, startedAfter: string) {
    await inject(
      this,
      `/api/sessions/public?startedAfter=${encodeURIComponent(startedAfter)}`,
      undefined,
    );
  },
);

When(
  'I request the public sessions with limit {int} and offset {int}',
  async function (this: AConversaWorld, limit: number, offset: number) {
    await inject(
      this,
      `/api/sessions/public?limit=${String(limit)}&offset=${String(offset)}`,
      undefined,
    );
  },
);

When(
  'I request the public sessions with offset {int}',
  async function (this: AConversaWorld, offset: number) {
    await inject(this, `/api/sessions/public?offset=${String(offset)}`, undefined);
  },
);

// ============================================================
// Thens — assertions over the `{ sessions, total }` wrapper specific to
// this endpoint (presence, the live/ended `endedAt` distinction, and the
// listing-fields-only disclosure posture). Ordering, counts, total, and
// absence reuse the shared steps.
// ============================================================

Then(
  'the response body contains a session with topic {string}',
  function (this: AConversaWorld, topic: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: Array<{ topic?: string }> };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    const match = body.sessions.find((s) => s.topic === topic);
    assert.ok(match, `no session with topic ${topic} in the response`);
  },
);

Then(
  "the response body's session with topic {string} has a null endedAt",
  function (this: AConversaWorld, topic: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as {
      sessions?: Array<{ topic?: string; endedAt?: string | null }>;
    };
    const match = body.sessions?.find((s) => s.topic === topic);
    assert.ok(match, `no session with topic ${topic} in the response`);
    assert.equal(match.endedAt, null, `session ${topic} should be live (endedAt null)`);
  },
);

Then(
  "the response body's session with topic {string} has a non-null endedAt",
  function (this: AConversaWorld, topic: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as {
      sessions?: Array<{ topic?: string; endedAt?: string | null }>;
    };
    const match = body.sessions?.find((s) => s.topic === topic);
    assert.ok(match, `no session with topic ${topic} in the response`);
    assert.ok(
      typeof match.endedAt === 'string' && match.endedAt.length > 0,
      `session ${topic} should be ended (non-null endedAt)`,
    );
  },
);

Then(
  'every returned session exposes only id, topic, startedAt, endedAt',
  function (this: AConversaWorld) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sessions?: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(body.sessions), 'response body lacks a `sessions` array');
    assert.ok(body.sessions.length > 0, 'expected at least one session to inspect');
    const allowed = new Set(['id', 'topic', 'startedAt', 'endedAt']);
    for (const session of body.sessions) {
      const keys = Object.keys(session);
      assert.deepEqual(
        keys.slice().sort(),
        ['endedAt', 'id', 'startedAt', 'topic'],
        `a session row exposed unexpected keys: ${keys.join(', ')}`,
      );
      for (const key of keys) {
        assert.ok(allowed.has(key), `session row leaked field "${key}"`);
      }
    }
  },
);

// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
