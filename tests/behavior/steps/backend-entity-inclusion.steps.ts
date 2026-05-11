// Step definitions for tests/behavior/backend/entity-inclusion.feature.
//
// Refinement: tasks/refinements/backend/entity_inclusion_endpoint.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.entity_inclusion_endpoint
//
// **What this layer exercises.** `POST /sessions/:id/include` end-to-end
// against the real migrated schema in pglite. The `sessions`,
// `session_participants`, `nodes`, `session_nodes`, and `session_events`
// tables are real; the handler's full transactional chain runs through
// the production Fastify instance against the pglite-backed pool:
//
//   1. Visibility-gated SELECT ... FOR UPDATE on the destination
//      session.
//   2. Active-participant check against `session_participants` (the
//      moderator row auto-landed by `POST /sessions` is the path the
//      success scenarios rely on).
//   3. Lifecycle gate.
//   4. Source-side `canReferenceNode` predicate.
//   5. `INSERT INTO session_nodes ... ON CONFLICT DO NOTHING
//      RETURNING ...`.
//   6. MAX(sequence)+1 inside the transaction.
//   7. Build + validate + INSERT the `entity-included` event.
//
// What's covered (5 scenarios):
//   1. Successful node inclusion cross-session (the host of the
//      destination — and an active moderator participant — brings a
//      node from a public source).
//   2. Non-participant of the destination → 403 `not-a-participant`.
//   3. Source is a private session the caller can't see → 403
//      `entity-not-referenceable`.
//   4. Re-including the same entity → 409 `entity-already-included`.
//   5. Including into an ended destination → 409
//      `session-already-ended`.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     → backend-session-token.steps.ts.
//   - "I have a valid session cookie for that user"
//     → backend-session-token.steps.ts.
//   - "I POST /sessions with topic {string} and privacy {string}"
//     → backend-create-session.steps.ts.
//   - "the response status is {int}" → http-server.steps.ts.
//   - "the response body's error.code is {string}"
//     → backend-oauth-callback.steps.ts.
//   - "I POST /sessions/:id/end for the most recently created session"
//     → backend-end-session.steps.ts (used via the wrapper Given below).

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME, signSessionToken } from '../../../apps/server/src/auth/index.js';
import { __buildTestSessionsApp } from '../../../apps/server/src/sessions/routes.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestSessionsApp>>;

interface EntityInclusionScratch {
  sessionsApp?: FastifyAppInstance;
  sessionCookieValue?: string;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
  // Inclusion-specific captures — sibling tests use the "most recent
  // sessions row" shortcut, but this feature has TWO sessions in play
  // at once (a source and a destination) so the shortcut isn't enough.
  // We capture each by id at the When step that creates it.
  inclusionSourceSessionId?: string;
  inclusionDestinationSessionId?: string;
  // The most recently seeded entity id, captured when a Given like
  // "a node exists in the inclusion source seeded by ..." runs. The
  // include-step then threads this into the request body.
  inclusionEntityId?: string;
}

function scratch(world: AConversaWorld): EntityInclusionScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as EntityInclusionScratch;
}

// Shared test secret pinned by `backend-create-session.steps.ts`.
const TEST_SESSION_SECRET = 'test-session-secret';

async function lookupUserId(world: AConversaWorld, screenName: string): Promise<string> {
  const res = (await world.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
    screenName,
  ])) as QueryResult<{ id: string }>;
  const userId = res.rows[0]?.id;
  assert.ok(userId, `no users row found for screen_name ${screenName}`);
  return userId;
}

// ============================================================
// Whens / Givens — capture source/destination + seed entities +
// invoke the inclusion endpoint.
// ============================================================

// "I POST /sessions with topic X and privacy Y as user Z" — sibling
// of the existing create-session step that lets a NAMED user (not
// the Background user) host the session. Used by the "private source
// hosted by alice; destination hosted by ben" scenario where the
// destination is built under ben's cookie so ben is the
// auto-moderator participant for the include attempt.
When(
  'I POST \\/sessions with topic {string} and privacy {string} as user {string}',
  async function (this: AConversaWorld, topic: string, privacy: string, actorScreenName: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const actorUserId = await lookupUserId(this, actorScreenName);
    const token = await signSessionToken({ sub: actorUserId }, TEST_SESSION_SECRET);
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic, privacy },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

Then('I capture that session as the inclusion source', async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const sessionId = res.rows[0]?.id;
  assert.ok(sessionId, 'no sessions row found to capture as the source');
  scratch(this).inclusionSourceSessionId = sessionId;
});

Then('I capture that session as the inclusion destination', async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ id: string }>;
  const sessionId = res.rows[0]?.id;
  assert.ok(sessionId, 'no sessions row found to capture as the destination');
  scratch(this).inclusionDestinationSessionId = sessionId;
});

// Seed a global `nodes` row AND a `session_nodes` row anchoring it
// to the inclusion source. The handler doesn't run for this seed —
// we INSERT directly so the source-side reachability check has
// something to find. (The architecture's node-creation event would
// normally drive both INSERTs at once; this feature exercises the
// inclusion-endpoint's source-side check, so direct seeding is the
// right shape.)
Then(
  'a node exists in the inclusion source seeded by {string}',
  async function (this: AConversaWorld, creatorScreenName: string) {
    const sourceId = scratch(this).inclusionSourceSessionId;
    assert.ok(sourceId, 'no inclusion source captured yet');
    const creatorId = await lookupUserId(this, creatorScreenName);
    const nodeRes = (await this.db.query(
      `INSERT INTO nodes (wording, created_by) VALUES ($1, $2) RETURNING id`,
      ['A node for inclusion', creatorId],
    )) as QueryResult<{ id: string }>;
    const nodeId = nodeRes.rows[0]?.id;
    assert.ok(nodeId, 'failed to INSERT nodes row');
    await this.db.query(
      `INSERT INTO session_nodes (session_id, node_id, included_by) VALUES ($1, $2, $3)`,
      [sourceId, nodeId, creatorId],
    );
    scratch(this).inclusionEntityId = nodeId;
  },
);

When(
  'I POST \\/sessions\\/:id\\/include with that node into the inclusion destination as {string}',
  async function (this: AConversaWorld, actorScreenName: string) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const destinationId = s.inclusionDestinationSessionId;
    assert.ok(destinationId, 'no inclusion destination captured yet');
    const entityId = s.inclusionEntityId;
    assert.ok(entityId, 'no inclusion entity captured yet');
    const actorUserId = await lookupUserId(this, actorScreenName);
    const token = await signSessionToken({ sub: actorUserId }, TEST_SESSION_SECRET);
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${destinationId}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/sessions\\/:id\\/end on the inclusion destination',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const app = s.sessionsApp;
    assert.ok(app, 'sessions app not initialized — Background step missing');
    const destinationId = s.inclusionDestinationSessionId;
    assert.ok(destinationId, 'no inclusion destination captured yet');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured');
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${destinationId}/end`,
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
// Thens — response-body shape + DB-state assertions.
// ============================================================

Then(
  "the response body's entityKind is {string}",
  function (this: AConversaWorld, expected: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { entityKind?: string };
    assert.equal(body.entityKind, expected);
  },
);

Then(
  'the session_nodes table has {int} row(s) for the destination linking to that node',
  async function (this: AConversaWorld, expected: number) {
    const s = scratch(this);
    const destinationId = s.inclusionDestinationSessionId;
    assert.ok(destinationId, 'no inclusion destination captured yet');
    const entityId = s.inclusionEntityId;
    assert.ok(entityId, 'no inclusion entity captured yet');
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_nodes
       WHERE session_id = $1 AND node_id = $2`,
      [destinationId, entityId],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expected);
  },
);

Then(
  'the session_events table has {int} row at sequence {int} with kind {string} in the destination',
  async function (this: AConversaWorld, expectedCount: number, sequence: number, kind: string) {
    const destinationId = scratch(this).inclusionDestinationSessionId;
    assert.ok(destinationId, 'no inclusion destination captured yet');
    const res = (await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM session_events
       WHERE session_id = $1 AND sequence = $2 AND kind = $3`,
      [destinationId, sequence, kind],
    )) as QueryResult<{ count: number }>;
    assert.equal(res.rows[0]?.count, expectedCount);
  },
);
