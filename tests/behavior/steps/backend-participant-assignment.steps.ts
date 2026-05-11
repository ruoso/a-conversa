// Step definitions for tests/behavior/backend/participant-assignment.feature.
//
// Refinement: tasks/refinements/backend/participant_assignment.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.participant_assignment
//
// **What this layer exercises.** Both participant-assignment endpoints
// end-to-end against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables with
// real partial-unique indexes; the visibility-gated SELECT, the
// authority check, the INSERT/UPDATE on `session_participants`, the
// MAX(sequence) read, and the participant-joined / participant-left
// INSERT all run through the production handler against the pglite-
// backed DbPool adapter.
//
// What's covered (5 scenarios):
//   1. Host creates a session → the moderator participant row + the
//      participant-joined event auto-land at sequence=2 (the create-
//      session amendment from this task).
//   2. Host assigns debater-A then debater-B → both rows + both events
//      land at consecutive sequences (3 and 4).
//   3. Non-host cannot assign → 403 `not-a-moderator`.
//   4. Already-filled role → 409 `role-already-filled`.
//   5. Host removes a debater → row's `left_at` flips and a
//      `participant-left` event lands.
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
//   - "the session_events table has {int} row at sequence {int} with kind {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface ParticipantAssignmentScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): ParticipantAssignmentScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ParticipantAssignmentScratch;
}

// Shared test secret pinned by `backend-create-session.steps.ts`.
const TEST_SESSION_SECRET = 'test-session-secret';

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

async function lookupSessionId(world: AConversaWorld): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const sessionId = res.rows[0]?.id;
  assert.ok(sessionId, 'no sessions row found');
  return sessionId;
}

async function lookupUserId(world: AConversaWorld, screenName: string): Promise<string> {
  const res = (await world.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
    screenName,
  ])) as QueryResult<{ id: string }>;
  const userId = res.rows[0]?.id;
  assert.ok(userId, `no users row found for screen_name ${screenName}`);
  return userId;
}

// =====================================================================
// Whens — POST /sessions/:id/participants (assign) and
//         DELETE /sessions/:id/participants/:userId (remove)
// =====================================================================

When(
  'I POST \\/sessions\\/:id\\/participants assigning user {string} as role {string}',
  async function (this: AConversaWorld, screenName: string, role: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await lookupSessionId(this);
    const targetUserId = await lookupUserId(this, screenName);
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      payload: { userId: targetUserId, role },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/sessions\\/:id\\/participants assigning user {string} as role {string} as user {string}',
  async function (
    this: AConversaWorld,
    targetScreenName: string,
    role: string,
    actorScreenName: string,
  ) {
    // Mint a session cookie for the named actor (different from the
    // Background's alice — this is the cross-user authority test).
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const sessionId = await lookupSessionId(this);
    const actorUserId = await lookupUserId(this, actorScreenName);
    const targetUserId = await lookupUserId(this, targetScreenName);
    const token = await signSessionToken({ sub: actorUserId }, TEST_SESSION_SECRET);
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: targetUserId, role },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I DELETE \\/sessions\\/:id\\/participants for user {string}',
  async function (this: AConversaWorld, screenName: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await lookupSessionId(this);
    const targetUserId = await lookupUserId(this, screenName);
    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${sessionId}/participants/${targetUserId}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

// =====================================================================
// Thens — response-body shape + DB-state assertions
// =====================================================================

Then("the response body's role is {string}", function (this: AConversaWorld, expected: string) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { role?: string };
  assert.equal(body.role, expected);
});

Then("the response body's leftAt is a non-null ISO timestamp", function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { leftAt?: unknown };
  assert.ok(
    isIsoTimestamp(body.leftAt),
    `expected body.leftAt to be an ISO timestamp; got ${String(body.leftAt)}`,
  );
});

Then(
  'the session_participants table has {int} active row(s) for the host as moderator',
  async function (this: AConversaWorld, expected: number) {
    // The Background's alice is the host; the create-session amendment
    // writes a `session_participants` row with role='moderator' for
    // her in the same transaction as the session itself.
    const userRes = (await this.db.query(
      'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, 'no users row found');
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_participants
       WHERE user_id = $1 AND role = 'moderator' AND left_at IS NULL`,
      [userId],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expected);
  },
);

Then(
  'the participant-joined event at sequence {int} has role {string}',
  async function (this: AConversaWorld, sequence: number, expectedRole: string) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1 AND sequence = $2
       LIMIT 1`,
      ['participant-joined', sequence],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, `no participant-joined event found at sequence ${sequence}`);
    assert.equal(payload['role'], expectedRole);
  },
);

Then(
  'the session_participants table has {int} active row(s) for the most recent session',
  async function (this: AConversaWorld, expected: number) {
    const sessionId = await lookupSessionId(this);
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_participants
       WHERE session_id = $1 AND left_at IS NULL`,
      [sessionId],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expected);
  },
);

Then(
  'the session_participants row for user {string} has left_at not null',
  async function (this: AConversaWorld, screenName: string) {
    const userId = await lookupUserId(this, screenName);
    const sessionId = await lookupSessionId(this);
    const res = (await this.db.query(
      `SELECT left_at FROM session_participants
       WHERE session_id = $1 AND user_id = $2
       ORDER BY joined_at DESC
       LIMIT 1`,
      [sessionId, userId],
    )) as QueryResult<{ left_at: Date | string | null }>;
    const leftAt = res.rows[0]?.left_at;
    assert.notEqual(leftAt, null, 'expected session_participants.left_at to be non-null');
    assert.notEqual(leftAt, undefined, 'expected session_participants row to exist');
  },
);
