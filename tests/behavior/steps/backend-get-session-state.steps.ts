// Step definitions for tests/behavior/backend/get-session-state.feature.
//
// Refinement: tasks/refinements/backend/get_at_position.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.replay_endpoints.get_at_position
//
// **What this layer exercises.** `GET /sessions/:id/state?position=N`
// end-to-end against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables; the read
// runs through the production handler (including the real replay
// primitive `projectAtPosition`) against the pglite-backed DbPool
// adapter. Covers the projected-state read at a position (matching the
// WS-snapshot shape), the empty baseline at position 0, the visibility
// gate (private session NOT visible to a non-participant → 404), and the
// out-of-range-position → 400 path.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the replay server is built with the pglite-backed pool" and its
//     scenario-end `After` hook closing the replay app
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

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestReplayApp } from '../../../apps/server/src/replay/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestReplayApp>>;

interface GetStateScratch {
  replayApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): GetStateScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as GetStateScratch;
}

// Shared test secret pinned by the session-token steps.
const TEST_SESSION_SECRET = 'test-session-secret';

// A deterministic node id, so the projection-shape Thens can be precise.
const PROJECTED_NODE_ID = '66666666-6666-4666-8666-666666666666';

async function mostRecentSessionId(world: AConversaWorld): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, 'no sessions row found — a Given seeding a session is missing');
  return id;
}

async function injectState(
  world: AConversaWorld,
  sessionId: string,
  position: number,
  cookieValue: string,
): Promise<void> {
  const s = scratch(world);
  const app = s.replayApp;
  assert.ok(app, 'replay app not initialized — Background step missing');
  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/state?position=${position}`,
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
  'the most recently created session has a projectable event log',
  async function (this: AConversaWorld) {
    // Seed a minimal *valid* event log the replay primitive can apply:
    // session-created → participant-joined → node-created, all actored by
    // the host (a real users row, satisfying the `actor` FK). headSequence
    // = 3; the node appears only at position >= 3. Unlike the opaque
    // `proposal` rows the raw-log feature seeds, these must be real events
    // so `projectAtPosition` builds a non-empty projection.
    const res = (await this.db.query(
      'SELECT id, host_user_id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string; host_user_id: string }>;
    const row = res.rows[0];
    assert.ok(row, 'no sessions row found to seed a projectable log into');
    const seed = async (
      sequence: number,
      kind: string,
      payload: Record<string, unknown>,
    ): Promise<void> => {
      await this.db.query(
        `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [row.id, sequence, kind, row.host_user_id, JSON.stringify(payload)],
      );
    };
    await seed(1, 'session-created', {
      host_user_id: row.host_user_id,
      privacy: 'public',
      topic: 'public debate',
      created_at: '2026-05-10T12:00:00Z',
    });
    await seed(2, 'participant-joined', {
      user_id: row.host_user_id,
      role: 'moderator',
      screen_name: 'alice',
      joined_at: '2026-05-10T12:00:01Z',
    });
    await seed(3, 'node-created', {
      node_id: PROJECTED_NODE_ID,
      wording: 'Claim A',
      created_by: row.host_user_id,
      created_at: '2026-05-10T12:00:02Z',
    });
  },
);

// ============================================================
// Whens
// ============================================================

When(
  'I GET the state at position {int} for the most recently created session',
  async function (this: AConversaWorld, position: number) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectState(this, sessionId, position, cookieValue);
  },
);

When(
  'I GET the state at position {int} for the most recently created session as user {string}',
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
    await injectState(this, sessionId, position, token);
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  /^the response body's sequence is (\d+)$/,
  function (this: AConversaWorld, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { sequence?: number };
    assert.equal(body.sequence, Number.parseInt(expectedRaw, 10));
  },
);

Then(
  /^the response body's projection\.lastAppliedSequence is (\d+)$/,
  function (this: AConversaWorld, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { projection?: { lastAppliedSequence?: number } };
    assert.equal(body.projection?.lastAppliedSequence, Number.parseInt(expectedRaw, 10));
  },
);

// Singular/plural tolerant: "has 1 entry" and "has 0 entries".
Then(
  /^the response body's projection\.nodes array has (\d+) entr(?:y|ies)$/,
  function (this: AConversaWorld, expectedRaw: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { projection?: { nodes?: unknown[] } };
    assert.ok(
      Array.isArray(body.projection?.nodes),
      'response body lacks a projection.nodes array',
    );
    assert.equal(body.projection?.nodes?.length, Number.parseInt(expectedRaw, 10));
  },
);
