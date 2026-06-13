// Step definitions for tests/behavior/backend/restart-session.feature.
//
// Refinement: tasks/refinements/session_lifecycle/sl_restart_endpoint.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: session_lifecycle.sl_restart_endpoint
//
// **What this layer exercises.** `POST /sessions/:id/restart` end-to-end
// against the real migrated schema in pglite — `sessions` and
// `session_events` are real tables; the visibility-gated SELECT, the
// `ended_at = NULL` UPDATE, the MAX(sequence) read, and the
// session-restarted INSERT all run through the production handler
// against the pglite-backed DbPool adapter (the same adapter the
// end-session / create-session scenarios use, registered in
// backend-create-session.steps.ts's "the sessions server is built with
// the pglite-backed pool" Given).
//
// What's covered:
//   1. Host restarts an ended session → 200 + endedAt null; the
//      sessions row's `ended_at` clears to null and `started_at` is
//      unchanged; the session-restarted event lands at the next
//      sequence (one past the session-ended event) with an empty
//      payload.
//   2. Restart a not-ended session → 409 `session-not-ended`; the row's
//      `ended_at` stays null and no session-restarted event is appended.
//   3. Non-host caller → 403 `not-a-moderator`; `ended_at` stays set.
//   4. Unknown id → 404 `not-found`.
//   5. End → restart, then the full event log replays clean through the
//      projection loader to the open state (no throw on the
//      `session-restarted` kind).
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool",
//     "I POST /sessions with topic {string} and privacy {string}",
//     "the response body's topic is {string}", and "the session_events
//     table has {int} row at sequence {int} with kind {string}"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}",
//     "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "the response status is {int}" → http-server.steps.ts.
//   - "the response body's error.code is {string}" → backend-oauth-callback.steps.ts.
//   - "I POST /sessions/:id/end for the most recently created session"
//     → backend-end-session.steps.ts.
//   - "the sessions row's ended_at is null" / "is not null"
//     → backend-end-session.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { Event } from '@a-conversa/shared-types';
import { validateEvent } from '@a-conversa/shared-types';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { projectFromLog } from '../../../apps/server/src/projection/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

// Local row shape + mapper, mirroring projection-walkthrough-replay's
// `rowToValidatedEvent` — query the raw `session_events` rows and run
// each through `validateEvent` (which also exercises the new
// `session-restarted` payload schema) before handing the log to
// `projectFromLog`. Kept local rather than reaching for
// `readSessionEventLog` so the step stays clear of the executor-type
// boundary the loader requires.
interface SessionEventRow {
  id: string;
  session_id: string;
  sequence: string | number;
  kind: string;
  actor: string | null;
  payload: unknown;
  created_at: Date | string;
}

function rowToValidatedEvent(row: SessionEventRow): Event {
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return validateEvent({
    id: row.id,
    sessionId: row.session_id,
    sequence: Number(row.sequence),
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  });
}

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

// Local view onto the shared scratch. The create-session step file
// stores `sessionsApp` and `sessionCookieValue` under these keys; this
// file additionally records the pre-restart `started_at` so the
// "unchanged" assertion can compare against it.
interface RestartSessionScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  startedAtBeforeRestart?: Date | string | null;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): RestartSessionScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as RestartSessionScratch;
}

// Shared test secret pinned by the create-session steps. Re-used so
// per-user tokens minted here verify under the same key the middleware
// uses.
const TEST_SESSION_SECRET = 'test-session-secret';

async function mostRecentSessionId(world: AConversaWorld): Promise<string> {
  const idRes = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const sessionId = idRes.rows[0]?.id;
  assert.ok(sessionId, 'no sessions row found to restart by id');
  return sessionId;
}

// Snapshot `started_at` for the most-recent session so a later Then can
// prove the restart UPDATE left it untouched.
async function captureStartedAt(world: AConversaWorld): Promise<void> {
  const res = (await world.db.query(
    'SELECT started_at FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ started_at: Date | string | null }>;
  scratch(world).startedAtBeforeRestart = res.rows[0]?.started_at ?? null;
}

// ============================================================
// Whens — issue POST /sessions/:id/restart against the most recently
// created session, either as the Background user or as a freshly-
// authenticated other user. Plus a literal-id variant for the
// unknown-id scenario.
// ============================================================

When(
  'I POST \\/sessions\\/:id\\/restart for the most recently created session',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await captureStartedAt(this);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/restart`,
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
  'I POST \\/sessions\\/:id\\/restart for the most recently created session as user {string}',
  async function (this: AConversaWorld, screenName: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user authority test). Re-uses the
    // shared TEST_SESSION_SECRET so the middleware accepts it.
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
    const sessionId = await mostRecentSessionId(this);
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/restart`,
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
  'I POST \\/sessions\\/{word}\\/restart',
  async function (this: AConversaWorld, literalId: string) {
    // Used by the "unknown id returns 404" scenario — the feature file
    // hard-codes a UUID the DB will never have. The token is the
    // Background user's, so auth passes and the handler runs the
    // visibility SELECT (which finds zero rows).
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${literalId}/restart`,
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
// Thens — assert on the response body and the resulting DB state.
// ============================================================

// "the response body's endedAt is null" is reused from
// backend-create-session.steps.ts (identical assertion) — Cucumber globs
// all step files, so redefining it here would be an ambiguous-step error.

Then(
  "the sessions row's started_at is unchanged by the restart",
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      'SELECT started_at FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ started_at: Date | string | null }>;
    const after = res.rows[0]?.started_at ?? null;
    const before = scratch(this).startedAtBeforeRestart ?? null;
    // Normalize Date vs string drift across drivers before comparing.
    const norm = (v: Date | string | null): string | null =>
      v === null ? null : v instanceof Date ? v.toISOString() : String(v);
    assert.equal(
      norm(after),
      norm(before),
      `expected started_at unchanged by restart; before=${String(before)} after=${String(after)}`,
    );
  },
);

Then(
  "the session-restarted event's payload is an empty object",
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      `SELECT payload FROM session_events
       WHERE kind = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      ['session-restarted'],
    )) as QueryResult<{ payload: Record<string, unknown> }>;
    const payload = res.rows[0]?.payload;
    assert.ok(payload !== undefined && payload !== null, 'no session-restarted event row found');
    assert.deepEqual(payload, {}, `expected an empty payload; got ${JSON.stringify(payload)}`);
  },
);

Then('no session-restarted event was appended', async function (this: AConversaWorld) {
  const res = (await this.db.query(
    `SELECT COUNT(*)::int AS count FROM session_events WHERE kind = $1`,
    ['session-restarted'],
  )) as QueryResult<{ count: number | string }>;
  const raw = res.rows[0]?.count ?? 0;
  const count = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  assert.equal(count, 0, `expected no session-restarted events; found ${count}`);
});

Then(
  "replaying the session's event log yields a projection in the open state",
  async function (this: AConversaWorld) {
    const sessionId = await mostRecentSessionId(this);
    const res = (await this.db.query(
      `SELECT id, session_id, sequence, kind, actor, payload, created_at
       FROM session_events
       WHERE session_id = $1
       ORDER BY sequence ASC`,
      [sessionId],
    )) as QueryResult<SessionEventRow>;
    const events: Event[] = res.rows.map(rowToValidatedEvent);
    // The replay loader throws on an unknown/unhandled kind or an
    // out-of-order sequence; reaching the assertion proves the
    // `session-restarted` kind replays clean.
    const projection = projectFromLog(events, sessionId);
    assert.equal(
      projection.sessionState,
      'open',
      `expected projection.sessionState 'open' after end→restart; got '${projection.sessionState}'`,
    );
  },
);
