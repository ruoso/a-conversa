// Step definitions for tests/behavior/backend/get-session-snapshot.feature.
//
// Refinement: tasks/refinements/backend/get_snapshot.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.replay_endpoints.get_snapshot
//
// **What this layer exercises.** `GET /sessions/:id/snapshots/:snapshotId`
// end-to-end against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables; the read
// runs through the production handler against the pglite-backed DbPool
// adapter. Covers by-`snapshotId` resolution (returning the right
// `label`/`logPosition`), the unknown-but-well-formed-snapshotId → 404
// path, the visibility gate (private session NOT visible to a
// non-participant → 404), and unknown session id → 404.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the replay server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-get-session-events.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     and "I have a valid session cookie for that user"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "a public session with topic {string} exists for that user at {string}"
//     and "a private session with topic {string} exists for user {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "the most recently created session has a snapshot {string} at position {int}"
//     → tests/behavior/steps/backend-list-session-snapshots.steps.ts. That
//     Given seeds the `snapshot_id` as `snapshotIdForPosition(position)`,
//     which the position-based Whens here re-derive to address the marker.
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → tests/behavior/steps/backend-oauth-callback.steps.ts.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestReplayApp } from '../../../apps/server/src/replay/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestReplayApp>>;

interface SnapshotScratch {
  replayApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): SnapshotScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SnapshotScratch;
}

// Shared test secret pinned by the session-token steps.
const TEST_SESSION_SECRET = 'test-session-secret';

async function mostRecentSessionId(world: AConversaWorld): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, 'no sessions row found — a Given seeding a session is missing');
  return id;
}

// Mirrors `snapshotIdForPosition` in the list-snapshots steps: the seed
// Given derives each snapshot's `snapshot_id` from its log position, so a
// position-based When re-derives the same UUID to address the marker.
function snapshotIdForPosition(position: number): string {
  const suffix = position.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

async function injectSnapshot(
  world: AConversaWorld,
  sessionId: string,
  snapshotId: string,
  cookieValue: string,
): Promise<void> {
  const s = scratch(world);
  const app = s.replayApp;
  assert.ok(app, 'replay app not initialized — Background step missing');
  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/snapshots/${snapshotId}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
}

// ============================================================
// Whens
// ============================================================

When(
  'I GET the snapshot at position {int} for the most recently created session',
  async function (this: AConversaWorld, position: number) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectSnapshot(this, sessionId, snapshotIdForPosition(position), cookieValue);
  },
);

When(
  'I GET the snapshot at position {int} for the most recently created session as user {string}',
  async function (this: AConversaWorld, position: number, screenName: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user visibility test).
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
    const sessionId = await mostRecentSessionId(this);
    await injectSnapshot(this, sessionId, snapshotIdForPosition(position), token);
  },
);

When(
  'I GET the snapshot {string} for the most recently created session',
  async function (this: AConversaWorld, snapshotId: string) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectSnapshot(this, sessionId, snapshotId, cookieValue);
  },
);

When(
  'I GET the snapshot {string} for session {string}',
  async function (this: AConversaWorld, snapshotId: string, literalSessionId: string) {
    // The unknown-id scenario — both path segments are well-formed UUIDs
    // the DB will never have. Auth passes (Background user's cookie); the
    // visibility gate finds zero rows → 404.
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    await injectSnapshot(this, literalSessionId, snapshotId, cookieValue);
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  /^the response body's snapshot label is "([^"]*)"$/,
  function (this: AConversaWorld, expected: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { label?: string };
    assert.equal(body.label, expected);
  },
);

Then(
  /^the response body's snapshot logPosition is (\d+)$/,
  function (this: AConversaWorld, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { logPosition?: number };
    assert.equal(body.logPosition, Number.parseInt(expectedRaw, 10));
  },
);
