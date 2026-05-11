// Step definitions for tests/behavior/backend/reference-permission.feature.
//
// Refinement: tasks/refinements/backend/reference_permission_check.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.reference_permission_check
//
// **What this layer exercises.** The three `canReference<Kind>`
// predicates from `apps/server/src/sessions/references.ts`, run against
// the migrated schema in pglite. The `sessions`, `session_participants`,
// `nodes`, `edges`, `annotations`, and three `session_<kind>s` join
// tables are all real; the predicates' parameterized SELECTs run through
// the production module against the pglite-backed pool.
//
// What's covered:
//   1. Node in a public origin → referenceable by any authenticated user.
//   2. Node in a private origin → referenceable by host.
//   3. Node in a private origin → NOT referenceable by a stranger.
//   4. Multi-origin node (private+public) → referenceable by a stranger
//      via the public origin (the any-visible-origin rule).
//   5. Edge in a private origin → NOT referenceable by a stranger.
//   6. Annotation in a public origin → referenceable by any user.
//
// New step phrases — locally distinctive to avoid collision with the
// user/session/node Givens from sibling step files. The seeding paths
// here use the suffix "for reference tests" / "includes a fresh ..." so
// Cucumber's regex matcher routes each phrase to exactly one definition
// (the existing `a user with oauth_subject ... exists with screen_name ...`
// Given still works for any feature that uses the longer form).

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import {
  canReferenceAnnotation,
  canReferenceEdge,
  canReferenceNode,
} from '../../../apps/server/src/sessions/references.js';
import type { VisibilityExecutor } from '../../../apps/server/src/sessions/visibility.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

interface ReferenceScratch {
  // The id of the most-recently-seeded "fresh" entity, by kind. The
  // When-step routes to the appropriate predicate based on which slot
  // is populated.
  freshNodeId?: string;
  freshEdgeId?: string;
  freshAnnotationId?: string;
  lastReachable?: boolean;
}

function scratch(world: AConversaWorld): ReferenceScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ReferenceScratch;
}

/**
 * Adapter — translate the pglite handle's `query` onto the
 * `VisibilityExecutor` shape `canReference<Kind>` consumes. Same pattern
 * the session-visibility step file uses.
 */
function executorFor(world: AConversaWorld): VisibilityExecutor {
  const dbHandle = world.db;
  return {
    async query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
      return { rows: result.rows };
    },
  };
}

// ============================================================
// Givens — seed users / sessions / entities / join rows
// ============================================================

Given(
  'a user with screen name {string} exists for reference tests',
  async function (this: AConversaWorld, screenName: string) {
    // Insert a users row with a synthesised `oauth_subject` so the
    // UNIQUE-by-(oauth_subject) constraint is satisfied without needing
    // a separate fixture. Each test scenario gets a fresh pglite (see
    // tests/behavior/support/world.ts's Before hook), so no cross-
    // scenario interference.
    await this.db.query(`INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2)`, [
      `reftests:${screenName}`,
      screenName,
    ]);
  },
);

Given(
  'a public session hosted by {string} includes a fresh node',
  async function (this: AConversaWorld, hostScreenName: string) {
    await seedSessionWithNode(this, hostScreenName, 'public');
  },
);

Given(
  'a private session hosted by {string} includes a fresh node',
  async function (this: AConversaWorld, hostScreenName: string) {
    await seedSessionWithNode(this, hostScreenName, 'private');
  },
);

Given(
  'a public session hosted by {string} also includes that same node',
  async function (this: AConversaWorld, hostScreenName: string) {
    // The "also includes that same node" form keeps the existing
    // freshNodeId from the prior Given and threads it into a NEW
    // session — i.e. the node now lives in two origin sessions, which
    // is the topology that exercises the any-visible-origin rule.
    const nodeId = scratch(this).freshNodeId;
    assert.ok(nodeId, 'expected a prior Given to have seeded a fresh node');
    const hostId = await lookupUserId(this, hostScreenName);
    const sessionRes = (await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic)
       VALUES ($1, 'public', $2) RETURNING id`,
      [hostId, `${hostScreenName}'s second session`],
    )) as QueryResult<{ id: string }>;
    const sessionId = sessionRes.rows[0]?.id;
    assert.ok(sessionId, 'failed to INSERT a second sessions row');
    await this.db.query(
      `INSERT INTO session_nodes (session_id, node_id, included_by) VALUES ($1, $2, $3)`,
      [sessionId, nodeId, hostId],
    );
  },
);

Given(
  'a private session hosted by {string} includes a fresh edge',
  async function (this: AConversaWorld, hostScreenName: string) {
    const hostId = await lookupUserId(this, hostScreenName);
    const sessionRes = (await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic)
       VALUES ($1, 'private', $2) RETURNING id`,
      [hostId, `${hostScreenName}'s edge session`],
    )) as QueryResult<{ id: string }>;
    const sessionId = sessionRes.rows[0]?.id;
    assert.ok(sessionId, 'failed to INSERT sessions row');
    // An edge needs two endpoint nodes; seed both as global rows.
    const nodeARes = (await this.db.query(
      `INSERT INTO nodes (wording, created_by) VALUES ($1, $2) RETURNING id`,
      ['Source node for edge', hostId],
    )) as QueryResult<{ id: string }>;
    const nodeBRes = (await this.db.query(
      `INSERT INTO nodes (wording, created_by) VALUES ($1, $2) RETURNING id`,
      ['Target node for edge', hostId],
    )) as QueryResult<{ id: string }>;
    const sourceId = nodeARes.rows[0]?.id;
    const targetId = nodeBRes.rows[0]?.id;
    assert.ok(sourceId && targetId, 'failed to INSERT endpoint nodes');
    const edgeRes = (await this.db.query(
      `INSERT INTO edges (role, source_node_id, target_node_id, created_by)
       VALUES ('supports', $1, $2, $3) RETURNING id`,
      [sourceId, targetId, hostId],
    )) as QueryResult<{ id: string }>;
    const edgeId = edgeRes.rows[0]?.id;
    assert.ok(edgeId, 'failed to INSERT edges row');
    await this.db.query(
      `INSERT INTO session_edges (session_id, edge_id, included_by) VALUES ($1, $2, $3)`,
      [sessionId, edgeId, hostId],
    );
    scratch(this).freshEdgeId = edgeId;
  },
);

Given(
  'a public session hosted by {string} includes a fresh annotation',
  async function (this: AConversaWorld, hostScreenName: string) {
    const hostId = await lookupUserId(this, hostScreenName);
    const sessionRes = (await this.db.query(
      `INSERT INTO sessions (host_user_id, privacy, topic)
       VALUES ($1, 'public', $2) RETURNING id`,
      [hostId, `${hostScreenName}'s annotation session`],
    )) as QueryResult<{ id: string }>;
    const sessionId = sessionRes.rows[0]?.id;
    assert.ok(sessionId, 'failed to INSERT sessions row');
    // An annotation needs a target — seed a node and annotate it.
    const nodeRes = (await this.db.query(
      `INSERT INTO nodes (wording, created_by) VALUES ($1, $2) RETURNING id`,
      ['Annotation target node', hostId],
    )) as QueryResult<{ id: string }>;
    const nodeId = nodeRes.rows[0]?.id;
    assert.ok(nodeId, 'failed to INSERT target node row');
    const annRes = (await this.db.query(
      `INSERT INTO annotations (target_node_id, kind, content, created_by)
       VALUES ($1, 'note', $2, $3) RETURNING id`,
      [nodeId, 'a fresh annotation', hostId],
    )) as QueryResult<{ id: string }>;
    const annId = annRes.rows[0]?.id;
    assert.ok(annId, 'failed to INSERT annotations row');
    await this.db.query(
      `INSERT INTO session_annotations (session_id, annotation_id, included_by) VALUES ($1, $2, $3)`,
      [sessionId, annId, hostId],
    );
    scratch(this).freshAnnotationId = annId;
  },
);

// ============================================================
// Whens — invoke the appropriate per-kind predicate against pglite.
// The phrase distinguishes the three kinds via the noun ("node" /
// "edge" / "annotation") so we can pick the right predicate without
// extra state.
// ============================================================

When(
  'I ask whether user {string} can reference that node',
  async function (this: AConversaWorld, screenName: string) {
    const userId = await lookupUserId(this, screenName);
    const nodeId = scratch(this).freshNodeId;
    assert.ok(nodeId, 'no fresh node was seeded — expected a prior Given');
    scratch(this).lastReachable = await canReferenceNode(executorFor(this), nodeId, userId);
  },
);

When(
  'I ask whether user {string} can reference that edge',
  async function (this: AConversaWorld, screenName: string) {
    const userId = await lookupUserId(this, screenName);
    const edgeId = scratch(this).freshEdgeId;
    assert.ok(edgeId, 'no fresh edge was seeded — expected a prior Given');
    scratch(this).lastReachable = await canReferenceEdge(executorFor(this), edgeId, userId);
  },
);

When(
  'I ask whether user {string} can reference that annotation',
  async function (this: AConversaWorld, screenName: string) {
    const userId = await lookupUserId(this, screenName);
    const annotationId = scratch(this).freshAnnotationId;
    assert.ok(annotationId, 'no fresh annotation was seeded — expected a prior Given');
    scratch(this).lastReachable = await canReferenceAnnotation(
      executorFor(this),
      annotationId,
      userId,
    );
  },
);

// ============================================================
// Thens — assert the captured reachability boolean.
// ============================================================

Then('the reference predicate returns true', function (this: AConversaWorld) {
  const reachable = scratch(this).lastReachable;
  assert.equal(reachable, true, 'expected the reference predicate to return true');
});

Then('the reference predicate returns false', function (this: AConversaWorld) {
  const reachable = scratch(this).lastReachable;
  assert.equal(reachable, false, 'expected the reference predicate to return false');
});

// ============================================================
// Local helpers
// ============================================================

async function lookupUserId(world: AConversaWorld, screenName: string): Promise<string> {
  const userRes = (await world.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
    screenName,
  ])) as QueryResult<{ id: string }>;
  const userId = userRes.rows[0]?.id;
  assert.ok(userId, `no users row found for screen_name ${screenName}`);
  return userId;
}

async function seedSessionWithNode(
  world: AConversaWorld,
  hostScreenName: string,
  privacy: 'public' | 'private',
): Promise<void> {
  const hostId = await lookupUserId(world, hostScreenName);
  const sessionRes = (await world.db.query(
    `INSERT INTO sessions (host_user_id, privacy, topic)
     VALUES ($1, $2, $3) RETURNING id`,
    [hostId, privacy, `${hostScreenName}'s node session`],
  )) as QueryResult<{ id: string }>;
  const sessionId = sessionRes.rows[0]?.id;
  assert.ok(sessionId, 'failed to INSERT sessions row');
  const nodeRes = (await world.db.query(
    `INSERT INTO nodes (wording, created_by) VALUES ($1, $2) RETURNING id`,
    ['A fresh node', hostId],
  )) as QueryResult<{ id: string }>;
  const nodeId = nodeRes.rows[0]?.id;
  assert.ok(nodeId, 'failed to INSERT nodes row');
  await world.db.query(
    `INSERT INTO session_nodes (session_id, node_id, included_by) VALUES ($1, $2, $3)`,
    [sessionId, nodeId, hostId],
  );
  scratch(world).freshNodeId = nodeId;
}
