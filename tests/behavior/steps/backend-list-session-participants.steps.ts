// Step definitions for tests/behavior/backend/list-session-participants.feature.
//
// Refinement: tasks/refinements/backend/list_session_participants_endpoint.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.list_session_participants_endpoint
//
// **What this layer exercises.** `GET /sessions/:id/participants`
// end-to-end against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables; the
// canonical `canSeeSession` predicate AND the participants SELECT both
// run through the production handler against the pglite-backed DbPool
// adapter (same adapter the create-session / participant-assignment
// scenarios use).
//
// What's covered (3 scenarios):
//   1. Freshly-created session → 1 row (the implicit moderator).
//   2. After two debater assignments → 3 rows in `joined_at ASC` order.
//   3. After a debater DELETE → 3 rows total, the removed debater's
//      row has `leftAt` populated, the moderator + the other debater
//      stay active.
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
//   - "I POST /sessions/:id/participants assigning user {string} as role {string}"
//     → tests/behavior/steps/backend-participant-assignment.steps.ts.
//   - "I DELETE /sessions/:id/participants for user {string}"
//     → tests/behavior/steps/backend-participant-assignment.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface ListParticipantsScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): ListParticipantsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ListParticipantsScratch;
}

interface ParticipantsResponse {
  participants?: Array<{
    id?: string;
    sessionId?: string;
    userId?: string;
    role?: string;
    joinedAt?: string;
    leftAt?: string | null;
  }>;
}

async function lookupSessionId(world: AConversaWorld): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const sessionId = res.rows[0]?.id;
  assert.ok(sessionId, 'no sessions row found');
  return sessionId;
}

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

// =====================================================================
// Whens — issue GET /sessions/:id/participants for the most recently
// created session, using the Background user's cookie.
// =====================================================================

When(
  'I GET \\/sessions\\/:id\\/participants for the most recently created session',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await lookupSessionId(this);
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/participants`,
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
// Thens — response-body shape assertions over the participants array.
// =====================================================================

Then(
  "the response body's participants array has {int} entry",
  function (this: AConversaWorld, expected: number) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as ParticipantsResponse;
    assert.ok(Array.isArray(body.participants), 'expected participants to be an array');
    assert.equal(body.participants.length, expected);
  },
);

Then(
  "the response body's participants array has {int} entries",
  function (this: AConversaWorld, expected: number) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as ParticipantsResponse;
    assert.ok(Array.isArray(body.participants), 'expected participants to be an array');
    assert.equal(body.participants.length, expected);
  },
);

Then(
  'the participants entry at index {int} has role {string}',
  function (this: AConversaWorld, idx: number, expectedRole: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as ParticipantsResponse;
    const entry = body.participants?.[idx];
    assert.ok(entry, `expected participants[${String(idx)}] to exist`);
    assert.equal(entry.role, expectedRole);
  },
);

Then(
  'the participants entry at index {int} has leftAt null',
  function (this: AConversaWorld, idx: number) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as ParticipantsResponse;
    const entry = body.participants?.[idx];
    assert.ok(entry, `expected participants[${String(idx)}] to exist`);
    assert.equal(entry.leftAt, null);
  },
);

Then(
  'the participants entry at index {int} has a non-null leftAt',
  function (this: AConversaWorld, idx: number) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as ParticipantsResponse;
    const entry = body.participants?.[idx];
    assert.ok(entry, `expected participants[${String(idx)}] to exist`);
    assert.ok(
      isIsoTimestamp(entry.leftAt),
      `expected participants[${String(idx)}].leftAt to be an ISO timestamp; got ${String(entry.leftAt)}`,
    );
  },
);
