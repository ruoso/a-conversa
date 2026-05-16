// Step definitions for tests/behavior/backend/session-invite-self-claim.feature.
//
// Refinement: tasks/refinements/backend/session_invite_self_claim_endpoint.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.session_invite_self_claim_endpoint
//
// **What this layer exercises.** The self-claim endpoint end-to-end
// against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables with
// real partial-unique indexes; the visibility-gated SELECT ... FOR
// UPDATE, the host-blocks check, the role/user availability pre-
// checks, the INSERT, the MAX(sequence) read, and the
// `participant-joined` event INSERT all run through the production
// handler against the pglite-backed DbPool adapter.
//
// What's covered (5 scenarios):
//   1. Happy path — a non-host authenticated debater self-claims
//      debater-A → 200 + new participants row + a participant-joined
//      event at the next sequence with actor === payload.user_id.
//   2. Repeat self-claim by the same caller → 409 user-already-joined;
//      no new event row lands.
//   3. Foreign-user collision on the same role → 409
//      role-already-filled; only one debater row for that role.
//   4. Unknown session id → 404 not-found (existence-non-leak).
//   5. Unauthenticated POST → 401 auth-required (middleware-owned).
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
//   - "the response body's role is {string}"
//     → tests/behavior/steps/backend-participant-assignment.steps.ts.
//   - "the session_events table has {int} row at sequence {int} with kind {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "the session_participants table has {int} active row(s) for the most recent session"
//     → tests/behavior/steps/backend-participant-assignment.steps.ts.
//   - "the participant-joined event at sequence {int} has role {string}"
//     → tests/behavior/steps/backend-participant-assignment.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface SelfClaimScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): SelfClaimScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SelfClaimScratch;
}

// Shared test secret pinned by `backend-create-session.steps.ts`.
const TEST_SESSION_SECRET = 'test-session-secret';

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
// Whens — POST /sessions/:id/invite/claim variants
// =====================================================================

When(
  'I POST \\/sessions\\/:id\\/invite\\/claim for the most recently created session as user {string} with role {string}',
  async function (this: AConversaWorld, actorScreenName: string, role: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const sessionId = await lookupSessionId(this);
    const actorUserId = await lookupUserId(this, actorScreenName);
    const token = await signSessionToken({ sub: actorUserId }, TEST_SESSION_SECRET);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/sessions\\/{word}\\/invite\\/claim as user {string} with role {string}',
  async function (this: AConversaWorld, sessionId: string, actorScreenName: string, role: string) {
    // Literal-session-id variant — used by the "unknown session id"
    // scenario which posts to a hard-coded UUID that doesn't exist in
    // the sessions table.
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const actorUserId = await lookupUserId(this, actorScreenName);
    const token = await signSessionToken({ sub: actorUserId }, TEST_SESSION_SECRET);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/sessions\\/:id\\/invite\\/claim for the most recently created session with no cookie and role {string}',
  async function (this: AConversaWorld, role: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const sessionId = await lookupSessionId(this);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/invite/claim`,
      payload: { role },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

// =====================================================================
// Thens — response-body shape + DB-state assertions specific to the
//          self-claim's actor-equals-subject envelope shape and the
//          "no new event row landed" assertion the repeat-claim
//          scenario needs.
// =====================================================================

Then(
  "the response body's userId matches the user {string}",
  async function (this: AConversaWorld, screenName: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { userId?: string };
    const expected = await lookupUserId(this, screenName);
    assert.equal(body.userId, expected);
  },
);

Then(
  'the participant-joined event at sequence {int} has actor matching its payload user_id',
  async function (this: AConversaWorld, sequence: number) {
    // ADR 0021's self-action shape: a self-claim's envelope has
    // `actor === payload.user_id`; a host-driven assignment has
    // `actor !== payload.user_id`. This step pins the self-claim
    // discriminator at the event-log level.
    const res = (await this.db.query(
      `SELECT actor, payload FROM session_events
       WHERE kind = $1 AND sequence = $2
       LIMIT 1`,
      ['participant-joined', sequence],
    )) as QueryResult<{ actor: string; payload: Record<string, unknown> }>;
    const row = res.rows[0];
    assert.ok(row, `no participant-joined event found at sequence ${sequence}`);
    const payloadUserId = row.payload['user_id'];
    assert.equal(
      row.actor,
      payloadUserId,
      `expected actor === payload.user_id (self-claim shape); got actor=${String(row.actor)} payload.user_id=${String(payloadUserId)}`,
    );
  },
);

Then(
  'the session_events table has {int} rows at sequence {int}',
  async function (this: AConversaWorld, expected: number, sequence: number) {
    // Kind-agnostic count at a given sequence — used by the repeat-
    // claim scenario to assert that no NEW event landed after the
    // 409.
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count FROM session_events WHERE sequence = $1`,
      [sequence],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expected);
  },
);
