// Step definitions for tests/behavior/backend/get-session-diagnostics.feature.
//
// Refinement: tasks/refinements/backend/get_diagnostics_at_position.md
// ADRs:        docs/adr/0044-replay-position-diagnostics-via-backend-endpoint.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0007-cucumber-pglite-for-protocol-seam.md
// TaskJuggler: backend.replay_endpoints.get_diagnostics_at_position
//
// **What this layer exercises.** `GET /sessions/:id/diagnostics?position=N`
// end-to-end against the real migrated schema in pglite — `sessions`,
// `session_participants`, and `session_events` are real tables; the read
// runs through the production handler (the real replay primitive
// `projectAtPosition` AND the real detectors `computeAllDiagnostics`)
// against the pglite-backed DbPool adapter. Covers the diagnostics read at
// the head position (a dangling-claim diagnostic present), the empty
// baseline at position 0, the visibility gate (private session NOT visible
// to a non-participant → 404), and the out-of-range-position → 400 path.
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

interface GetDiagnosticsScratch {
  replayApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
}

function scratch(world: AConversaWorld): GetDiagnosticsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as GetDiagnosticsScratch;
}

// Shared test secret pinned by the session-token steps.
const TEST_SESSION_SECRET = 'test-session-secret';

// Deterministic ids for the diagnostic-producing log: an edge with a
// non-justification role (`defines`) from a source node to a target node
// makes the target "claim-positioned but unjustified" → a dangling-claim
// diagnostic on the target.
const DANGLING_SOURCE_NODE_ID = '66666666-6666-4666-8666-666666666601';
const DANGLING_TARGET_NODE_ID = '66666666-6666-4666-8666-666666666602';
const DANGLING_EDGE_ID = '77777777-7777-4777-8777-777777777701';

async function mostRecentSessionId(world: AConversaWorld): Promise<string> {
  const res = (await world.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const id = res.rows[0]?.id;
  assert.ok(id, 'no sessions row found — a Given seeding a session is missing');
  return id;
}

async function injectDiagnostics(
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
    url: `/api/sessions/${sessionId}/diagnostics?position=${position}`,
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
  'the most recently created session has a projectable event log with a structural diagnostic',
  async function (this: AConversaWorld) {
    // Seed a valid event log whose head-position projection carries a
    // dangling-claim diagnostic: session-created → participant-joined →
    // node-created (source) → node-created (target) → edge-created
    // (source -> target, role `defines`). The non-justification role makes
    // the target claim-positioned but unjustified → one dangling-claim
    // entry. headSequence = 5; the diagnostic only exists once the edge at
    // seq 5 is applied.
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
      node_id: DANGLING_SOURCE_NODE_ID,
      wording: 'Definition node',
      created_by: row.host_user_id,
      created_at: '2026-05-10T12:00:02Z',
    });
    await seed(4, 'node-created', {
      node_id: DANGLING_TARGET_NODE_ID,
      wording: 'Unjustified claim',
      created_by: row.host_user_id,
      created_at: '2026-05-10T12:00:03Z',
    });
    await seed(5, 'edge-created', {
      edge_id: DANGLING_EDGE_ID,
      role: 'defines',
      source_node_id: DANGLING_SOURCE_NODE_ID,
      target_node_id: DANGLING_TARGET_NODE_ID,
      created_by: row.host_user_id,
      created_at: '2026-05-10T12:00:04Z',
    });
  },
);

// ============================================================
// Whens
// ============================================================

When(
  'I GET the diagnostics at position {int} for the most recently created session',
  async function (this: AConversaWorld, position: number) {
    const cookieValue = scratch(this).sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const sessionId = await mostRecentSessionId(this);
    await injectDiagnostics(this, sessionId, position, cookieValue);
  },
);

When(
  'I GET the diagnostics at position {int} for the most recently created session as user {string}',
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
    await injectDiagnostics(this, sessionId, position, token);
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  /^the response body's diagnostics array contains an entry of kind "([^"]+)"$/,
  function (this: AConversaWorld, expectedKind: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { diagnostics?: Array<{ kind?: string }> };
    assert.ok(Array.isArray(body.diagnostics), 'response body lacks a diagnostics array');
    assert.ok(
      body.diagnostics?.some((d) => d.kind === expectedKind),
      `expected a diagnostics entry of kind "${expectedKind}", got ${JSON.stringify(body.diagnostics)}`,
    );
  },
);

Then(/^the response body's diagnostics array is empty$/, function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { diagnostics?: unknown[] };
  assert.ok(Array.isArray(body.diagnostics), 'response body lacks a diagnostics array');
  assert.equal(body.diagnostics?.length, 0);
});
