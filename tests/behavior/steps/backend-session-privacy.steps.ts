// Step definitions for tests/behavior/backend/session-privacy.feature.
//
// Refinement: tasks/refinements/backend/session_privacy_toggle.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.session_privacy_toggle
//
// **What this layer exercises.** `PATCH /sessions/:id/privacy` end-to-
// end against the real migrated schema in pglite. The visibility-gated
// SELECT and the UPDATE both run through the production handler
// against the pglite-backed DbPool adapter (same adapter the create-
// / list- / get- / end-session scenarios use; registered by the
// "the sessions server is built with the pglite-backed pool" Given
// in backend-create-session.steps.ts).
//
// What's covered:
//   1. Host toggles public → private → 200 + the row's privacy column
//      reflects the new value. No `session-privacy-changed` event
//      lands (Option B); the only session event in the log is the
//      `session-created` from the POST /sessions step.
//   2. Non-host caller → 403 `not-a-moderator`; the row's privacy is
//      unchanged.
//   3. Ended session → 409 `session-already-ended`; the row's privacy
//      is unchanged.
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
//   - "I POST /sessions/:id/end for the most recently created session"
//     → tests/behavior/steps/backend-end-session.steps.ts.
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → tests/behavior/steps/backend-oauth-callback.steps.ts.
//   - "the response body's privacy is {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "the sessions row's privacy is {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "the session_events table has {int} rows"
//     → tests/behavior/steps/backend-create-session.steps.ts.

import { When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

// Local view onto the shared scratch. The create-session step file
// stores `sessionsApp` and `sessionCookieValue` under these keys.
interface PrivacyToggleScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): PrivacyToggleScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as PrivacyToggleScratch;
}

// Shared test secret pinned by the create-session steps. Re-used so
// per-user tokens minted here verify under the same key the
// middleware (instantiated by "the sessions server is built ...") uses.
const TEST_SESSION_SECRET = 'test-session-secret';

// ============================================================
// Whens — issue PATCH /sessions/:id/privacy against the most
// recently created session, either as the Background user or as a
// freshly-authenticated other user.
// ============================================================

When(
  'I PATCH \\/sessions\\/:id\\/privacy for the most recently created session with privacy {string}',
  async function (this: AConversaWorld, desiredPrivacy: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const idRes = (await this.db.query(
      'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const sessionId = idRes.rows[0]?.id;
    assert.ok(sessionId, 'no sessions row found to toggle by id');
    const response = await app.inject({
      method: 'PATCH',
      url: `/sessions/${sessionId}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      payload: { privacy: desiredPrivacy },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I PATCH \\/sessions\\/:id\\/privacy for the most recently created session as user {string} with privacy {string}',
  async function (this: AConversaWorld, screenName: string, desiredPrivacy: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user authority test). Reuses the
    // shared TEST_SESSION_SECRET so the middleware accepts it.
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
    assert.ok(sessionId, 'no sessions row found to toggle by id');
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const response = await app.inject({
      method: 'PATCH',
      url: `/sessions/${sessionId}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: desiredPrivacy },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

// Note: assertion steps reused from sibling step files. See header
// comment for the index.
//
// `After` hook for the sessions app is owned by
// backend-create-session.steps.ts; reused unchanged.
