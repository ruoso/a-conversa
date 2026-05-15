// Step definitions for tests/behavior/backend/end-session.feature.
//
// Refinement: tasks/refinements/backend/end_session_endpoint.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.end_session_endpoint
//
// **What this layer exercises.** `POST /sessions/:id/end` end-to-end
// against the real migrated schema in pglite — `sessions` and
// `session_events` are real tables; the visibility-gated SELECT, the
// UPDATE, the MAX(sequence) read, and the session-ended INSERT all
// run through the production handler against the pglite-backed DbPool
// adapter (the same adapter the create-session / list-session / get-
// session scenarios use, registered in
// backend-create-session.steps.ts's "the sessions server is built
// with the pglite-backed pool" Given).
//
// What's covered:
//   1. Host ends an active session → 200 + endedAt populated; the
//      sessions row's `ended_at` flips to non-null; the session-ended
//      event lands at sequence=2 (sequence=1 is the prior session-
//      created event from the POST /sessions step). Atomic write
//      contract verified against the real schema's UNIQUE
//      (session_id, sequence) constraint.
//   2. Non-host caller → 403 `not-a-moderator`; the sessions row's
//      `ended_at` stays null (transaction rolled back).
//   3. Already-ended session → 409 `session-already-ended` on the
//      second end-attempt by the same host. Demonstrates the
//      non-idempotent decision: the second call sees `ended_at IS
//      NOT NULL` and short-circuits.
//   4. Unknown id → 404 `not-found`.
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
//   - "the response body's topic is {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

// Local view onto the shared scratch. The create-session step file
// stores `sessionsApp` and `sessionCookieValue` under these keys.
interface EndSessionScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): EndSessionScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as EndSessionScratch;
}

// Shared test secret pinned by the create-session steps. Re-used so
// per-user tokens minted here verify under the same key the middleware
// (instantiated by `the sessions server is built ...`) uses.
const TEST_SESSION_SECRET = 'test-session-secret';

// ISO-8601 with offset (the shape `sessionEndedPayloadSchema`'s
// `z.string().datetime({ offset: true })` accepts). Both `Z` and
// numeric offsets parse via JS's `Date` constructor; we use the same
// `Date.parse` check the schema implicitly performs.
function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

// ============================================================
// Whens — issue POST /sessions/:id/end against the most recently
// created session, either as the Background user or as a freshly-
// authenticated other user. Plus a literal-id variant for the
// unknown-id scenario.
// ============================================================

When(
  'I POST \\/sessions\\/:id\\/end for the most recently created session',
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
    assert.ok(sessionId, 'no sessions row found to end by id');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
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
  'I POST \\/sessions\\/:id\\/end for the most recently created session as user {string}',
  async function (this: AConversaWorld, screenName: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user authority test). Re-uses
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
    assert.ok(sessionId, 'no sessions row found to end by id');
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When('I POST \\/sessions\\/{word}\\/end', async function (this: AConversaWorld, literalId: string) {
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
    url: `/api/sessions/${literalId}/end`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

// ============================================================
// Thens — assert on the response body and the resulting DB state.
// ============================================================

Then("the response body's endedAt is a non-null ISO timestamp", function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { endedAt?: unknown };
  assert.ok(
    isIsoTimestamp(body.endedAt),
    `expected body.endedAt to be an ISO timestamp; got ${String(body.endedAt)}`,
  );
});

Then("the sessions row's ended_at is not null", async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT ended_at FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ ended_at: Date | string | null }>;
  const endedAt = res.rows[0]?.ended_at;
  assert.notEqual(endedAt, null, 'expected sessions.ended_at to be non-null');
  assert.notEqual(endedAt, undefined, 'expected sessions row to exist');
});

Then("the sessions row's ended_at is null", async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT ended_at FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ ended_at: Date | string | null }>;
  const endedAt = res.rows[0]?.ended_at;
  assert.equal(endedAt, null, 'expected sessions.ended_at to be null');
});

Then(
  "the session-ended event's payload ended_at is a non-null ISO timestamp",
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      ['session-ended'],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload, 'no session-ended event row found');
    assert.ok(
      isIsoTimestamp(payload['ended_at']),
      `expected payload.ended_at to be an ISO timestamp; got ${String(payload['ended_at'])}`,
    );
  },
);

// Note: `the session_events table has {int} row at sequence {int} with kind {string}`
// is owned by tests/behavior/steps/backend-create-session.steps.ts.
// Reused unchanged.
//
// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
