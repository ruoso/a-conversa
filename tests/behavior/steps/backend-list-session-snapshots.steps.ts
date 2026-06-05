// Step definitions for tests/behavior/backend/list-session-snapshots.feature.
//
// Refinement: tasks/refinements/backend/list_snapshots.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.replay_endpoints.list_snapshots
//
// **What this layer exercises.** `GET /sessions/:id/snapshots` end-to-end
// against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables; the read
// runs through the production handler against the pglite-backed DbPool
// adapter. Covers chapter-order (ascending `logPosition`) listing, the
// empty-list-is-200 contract, the visibility gate (private session NOT
// visible to a non-participant → 404), and unknown id → 404.
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
//   - "the response status is {int}"
//     → tests/behavior/steps/http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → tests/behavior/steps/backend-oauth-callback.steps.ts.
//
// The replay app + its After-hook teardown also live in the
// get-session-events steps; the shared `scratch` keys (`replayApp`,
// `sessionCookieValue`, `lastResponse`) are reused so this file adds only
// the snapshot-specific Givens / Whens / Thens.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestReplayApp } from '../../../apps/server/src/replay/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestReplayApp>>;

interface SnapshotsScratch {
  replayApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
  // Set by the `snapshot-labeled` ack step in
  // backend-ws-label-snapshot.steps.ts. The round-trip scenario reads
  // it to pin REST-record identity against the write-path-minted id.
  wsLabelSnapshotId?: string;
}

function scratch(world: AConversaWorld): SnapshotsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SnapshotsScratch;
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

// Deterministic snapshot UUID derived from the log position — keeps the
// seed reproducible without Math.random while staying a valid UUID.
function snapshotIdForPosition(position: number): string {
  const suffix = position.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

async function injectSnapshots(
  world: AConversaWorld,
  sessionId: string,
  cookieValue: string,
): Promise<void> {
  const s = scratch(world);
  const app = s.replayApp;
  assert.ok(app, 'replay app not initialized — Background step missing');
  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/snapshots`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
}

// ============================================================
// Givens
// ============================================================

Given(
  'the most recently created session has a snapshot {string} at position {int}',
  async function (this: AConversaWorld, label: string, position: number) {
    // A snapshot is a regular `session_events` row with kind
    // 'snapshot-created'; `log_position === sequence` by construction.
    const res = (await this.db.query(
      'SELECT id, host_user_id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string; host_user_id: string }>;
    const row = res.rows[0];
    assert.ok(row, 'no sessions row found to seed a snapshot into');
    await this.db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, 'snapshot-created', $3, $4::jsonb)`,
      [
        row.id,
        position,
        row.host_user_id,
        JSON.stringify({
          snapshot_id: snapshotIdForPosition(position),
          label,
          log_position: position,
        }),
      ],
    );
  },
);

// ============================================================
// Whens
// ============================================================

When(
  'I GET the snapshots for the most recently created session',
  async function (this: AConversaWorld) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectSnapshots(this, sessionId, cookieValue);
  },
);

When(
  'I GET the snapshots for the most recently created session as user {string}',
  async function (this: AConversaWorld, screenName: string) {
    // Mint a session cookie for the named user (NOT the Background's
    // alice — this When is the cross-user visibility test).
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
    const sessionId = await mostRecentSessionId(this);
    await injectSnapshots(this, sessionId, token);
  },
);

When(
  'I GET the snapshots for session {string}',
  async function (this: AConversaWorld, literalId: string) {
    // The unknown-id scenario — the feature hard-codes a UUID the DB will
    // never have. Auth passes (Background user's cookie); the visibility
    // gate finds zero rows → 404.
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    await injectSnapshots(this, literalId, cookieValue);
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  /^the response body's snapshots array has (\d+) entr(?:y|ies)$/,
  function (this: AConversaWorld, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { snapshots?: unknown[] };
    assert.ok(Array.isArray(body.snapshots), 'response body lacks a `snapshots` array');
    assert.equal(body.snapshots.length, Number.parseInt(expectedRaw, 10));
  },
);

Then(
  /^the response body's snapshots\[(\d+)\]\.logPosition is (\d+)$/,
  function (this: AConversaWorld, idxRaw: string, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { snapshots?: Array<{ logPosition?: number }> };
    assert.ok(Array.isArray(body.snapshots), 'response body lacks a `snapshots` array');
    const idx = Number.parseInt(idxRaw, 10);
    assert.equal(body.snapshots[idx]?.logPosition, Number.parseInt(expectedRaw, 10));
  },
);

Then(
  /^the response body's snapshots\[(\d+)\]\.label is "([^"]*)"$/,
  function (this: AConversaWorld, idxRaw: string, expected: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { snapshots?: Array<{ label?: string }> };
    assert.ok(Array.isArray(body.snapshots), 'response body lacks a `snapshots` array');
    const idx = Number.parseInt(idxRaw, 10);
    assert.equal(body.snapshots[idx]?.label, expected);
  },
);

// The producer→consumer identity pin for the create→list round-trip:
// the REST list must return the same `snapshotId` the WS write-path
// minted (captured by the `snapshot-labeled` ack step). Closes the
// seam the `replay_test.snapshots` consumers stand on.
Then(
  /^the response body's snapshots\[(\d+)\]\.snapshotId matches the snapshot-labeled ack$/,
  function (this: AConversaWorld, idxRaw: string) {
    const s = scratch(this);
    const res = s.lastResponse;
    assert.ok(res, 'no response captured');
    const ackId = s.wsLabelSnapshotId;
    assert.ok(
      ackId,
      'no snapshot-labeled ack snapshotId captured — a `snapshot-labeled ack` Then must precede',
    );
    const body = JSON.parse(res.body) as { snapshots?: Array<{ snapshotId?: string }> };
    assert.ok(Array.isArray(body.snapshots), 'response body lacks a `snapshots` array');
    const idx = Number.parseInt(idxRaw, 10);
    assert.equal(body.snapshots[idx]?.snapshotId, ackId);
  },
);
