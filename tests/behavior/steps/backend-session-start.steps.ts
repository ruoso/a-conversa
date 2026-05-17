// Step definitions for tests/behavior/backend/session-start.feature.
//
// Refinement: tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md
// ADRs:        docs/adr/0028-session-mode-changed-wire-event.md,
//              docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: participant_ui.part_graph_view.part_session_start_handoff_dedicated_event
//
// **What this layer exercises.** `POST /sessions/:id/start` end-to-end
// against the real migrated schema in pglite — `sessions` and
// `session_events` are real tables; the visibility-gated SELECT, the
// MAX(sequence) read, and the session-mode-changed INSERT all run
// through the production handler against the pglite-backed DbPool
// adapter (same adapter as `backend-end-session.steps.ts`).
//
// What's covered:
//   1. Host advances an active session → 200 + session row; the
//      session-mode-changed event lands at sequence=3 (sequence=1 is
//      session-created from `POST /sessions`, sequence=2 is the
//      implicit participant-joined for the host-as-moderator). Atomic
//      write contract verified against the real schema's
//      `session_events_kind_check` CHECK constraint (the new kind
//      passes per migration 0013).
//   2. Non-host caller → 403 `not-a-moderator`; NO session-mode-changed
//      event recorded.
//   3. Idempotent re-POST → 200 on both calls; exactly one
//      session-mode-changed event recorded (Decision §5).
//   4. Ended session → 422 `session-already-ended`.
//   5. Unknown id → 404 `not-found`.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "I POST /sessions with topic {string} and privacy {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → tests/behavior/steps/backend-oauth-callback.steps.ts.
//   - "the response body's topic is {string}",
//     "the response body's endedAt is null",
//     "the session_events table has {int} row at sequence {int} with kind {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "I POST /sessions/:id/end for the most recently created session"
//     → tests/behavior/steps/backend-end-session.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface SessionStartScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): SessionStartScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SessionStartScratch;
}

// Shared test secret pinned by the create-session steps. Re-used so
// per-user tokens minted here verify under the same key the middleware
// (instantiated by `the sessions server is built ...`) uses.
const TEST_SESSION_SECRET = 'test-session-secret';

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

// ============================================================
// Whens
// ============================================================

When(
  'I POST \\/sessions\\/:id\\/start for the most recently created session',
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
    assert.ok(sessionId, 'no sessions row found to start by id');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/start`,
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
  'I POST \\/sessions\\/:id\\/start for the most recently created session as user {string}',
  async function (this: AConversaWorld, screenName: string) {
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
    assert.ok(sessionId, 'no sessions row found to start by id');
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/start`,
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
  'I POST \\/sessions\\/{word}\\/start',
  async function (this: AConversaWorld, literalId: string) {
    // Used by the "unknown id returns 404" scenario — the feature
    // file hard-codes a UUID the DB will never have. The token is
    // the Background user's, so auth passes and the handler runs
    // the visibility SELECT (which finds zero rows).
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${literalId}/start`,
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
// Thens — assertions on the resulting session_events rows.
// ============================================================

Then(
  "the session-mode-changed event's payload new_mode is {string}",
  async function (this: AConversaWorld, expected: string) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      ['session-mode-changed'],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-mode-changed event row found');
    assert.equal(
      payload['new_mode'],
      expected,
      `expected payload.new_mode to be ${expected}; got ${String(payload['new_mode'])}`,
    );
  },
);

Then(
  "the session-mode-changed event's payload previous_mode is {string}",
  async function (this: AConversaWorld, expected: string) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      ['session-mode-changed'],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-mode-changed event row found');
    assert.equal(
      payload['previous_mode'],
      expected,
      `expected payload.previous_mode to be ${expected}; got ${String(payload['previous_mode'])}`,
    );
  },
);

Then(
  "the session-mode-changed event's payload changed_by matches the user's id",
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      ['session-mode-changed'],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-mode-changed event row found');
    const userRes = (await this.db.query(
      'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const expectedUserId = userRes.rows[0]?.id;
    assert.ok(expectedUserId, 'no users row found');
    assert.equal(payload['changed_by'], expectedUserId);
  },
);

Then(
  "the session-mode-changed event's payload changed_at is a non-null ISO timestamp",
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      ['session-mode-changed'],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-mode-changed event row found');
    assert.ok(
      isIsoTimestamp(payload['changed_at']),
      `expected payload.changed_at to be an ISO timestamp; got ${String(payload['changed_at'])}`,
    );
  },
);

Then(
  'no session-mode-changed event has been recorded for the most recently created session',
  async function (this: AConversaWorld) {
    const idRes = (await this.db.query(
      'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const sessionId = idRes.rows[0]?.id;
    assert.ok(sessionId, 'no sessions row found');
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_events
       WHERE session_id = $1 AND kind = $2`,
      [sessionId, 'session-mode-changed'],
    )) as QueryResult<{ count: number }>;
    assert.equal(
      res.rows[0]?.count,
      0,
      `expected 0 session-mode-changed events; got ${res.rows[0]?.count}`,
    );
  },
);

Then(
  'only {int} session-mode-changed event(s) exist(s) for the most recently created session',
  async function (this: AConversaWorld, expected: number) {
    const idRes = (await this.db.query(
      'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const sessionId = idRes.rows[0]?.id;
    assert.ok(sessionId, 'no sessions row found');
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_events
       WHERE session_id = $1 AND kind = $2`,
      [sessionId, 'session-mode-changed'],
    )) as QueryResult<{ count: number }>;
    assert.equal(
      res.rows[0]?.count,
      expected,
      `expected ${expected} session-mode-changed events; got ${res.rows[0]?.count}`,
    );
  },
);
