// Steps for tests/behavior/migrations/session-joins.feature.

import { Given, When } from '@cucumber/cucumber';
import type { AConversaWorld } from '../support/world.js';
import {
  expectQuery,
  insertNode,
  insertSession,
  insertUser,
  TEST_UUIDS,
} from '../support/helpers.js';

Given('a user, a session, and a node by that user', async function (this: AConversaWorld) {
  await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
  await insertSession(this, TEST_UUIDS.session, TEST_UUIDS.alice);
  await insertNode(this, TEST_UUIDS.nodeA, TEST_UUIDS.alice, 'A');
});

Given('the node is included in the session', async function (this: AConversaWorld) {
  await this.db.query(
    `INSERT INTO session_nodes (session_id, node_id, included_by) VALUES ($1, $2, $3)`,
    [TEST_UUIDS.session, TEST_UUIDS.nodeA, TEST_UUIDS.alice],
  );
});

When('I include the same node in the same session again', async function (this: AConversaWorld) {
  await expectQuery(
    this,
    `INSERT INTO session_nodes (session_id, node_id, included_by) VALUES ($1, $2, $3)`,
    [TEST_UUIDS.session, TEST_UUIDS.nodeA, TEST_UUIDS.alice],
  );
});

Given(
  'a user, a session, two nodes A and B by that user, and an edge A->B',
  async function (this: AConversaWorld) {
    await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
    await insertSession(this, TEST_UUIDS.session, TEST_UUIDS.alice);
    await insertNode(this, TEST_UUIDS.nodeA, TEST_UUIDS.alice, 'A');
    await insertNode(this, TEST_UUIDS.nodeB, TEST_UUIDS.alice, 'B');
    await this.db.query(
      `INSERT INTO edges (id, role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [TEST_UUIDS.edgeA, 'supports', TEST_UUIDS.nodeA, TEST_UUIDS.nodeB, TEST_UUIDS.alice],
    );
  },
);

Given('the edge is included in the session', async function (this: AConversaWorld) {
  await this.db.query(
    `INSERT INTO session_edges (session_id, edge_id, included_by) VALUES ($1, $2, $3)`,
    [TEST_UUIDS.session, TEST_UUIDS.edgeA, TEST_UUIDS.alice],
  );
});

When('I include the same edge in the same session again', async function (this: AConversaWorld) {
  await expectQuery(
    this,
    `INSERT INTO session_edges (session_id, edge_id, included_by) VALUES ($1, $2, $3)`,
    [TEST_UUIDS.session, TEST_UUIDS.edgeA, TEST_UUIDS.alice],
  );
});

Given(
  'a user, a session, a node A by that user, and an annotation on A',
  async function (this: AConversaWorld) {
    await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
    await insertSession(this, TEST_UUIDS.session, TEST_UUIDS.alice);
    await insertNode(this, TEST_UUIDS.nodeA, TEST_UUIDS.alice, 'A');
    await this.db.query(
      `INSERT INTO annotations (id, target_node_id, kind, content, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [TEST_UUIDS.annA, TEST_UUIDS.nodeA, 'note', 'an annotation', TEST_UUIDS.alice],
    );
  },
);

Given('the annotation is included in the session', async function (this: AConversaWorld) {
  await this.db.query(
    `INSERT INTO session_annotations (session_id, annotation_id, included_by) VALUES ($1, $2, $3)`,
    [TEST_UUIDS.session, TEST_UUIDS.annA, TEST_UUIDS.alice],
  );
});

When(
  'I include the same annotation in the same session again',
  async function (this: AConversaWorld) {
    await expectQuery(
      this,
      `INSERT INTO session_annotations (session_id, annotation_id, included_by) VALUES ($1, $2, $3)`,
      [TEST_UUIDS.session, TEST_UUIDS.annA, TEST_UUIDS.alice],
    );
  },
);
