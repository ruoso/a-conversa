// Steps for tests/behavior/migrations/edges.feature.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { expectQuery, insertNode, insertUser, TEST_UUIDS } from '../support/helpers.js';

Given('a user, and two nodes A and B by that user', async function (this: AConversaWorld) {
  await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
  await insertNode(this, TEST_UUIDS.nodeA, TEST_UUIDS.alice, 'A');
  await insertNode(this, TEST_UUIDS.nodeB, TEST_UUIDS.alice, 'B');
});

Given('an edge {string} from A to B', async function (this: AConversaWorld, role: string) {
  await this.db.query(
    `INSERT INTO edges (id, role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
    [TEST_UUIDS.edgeA, role, TEST_UUIDS.nodeA, TEST_UUIDS.nodeB, TEST_UUIDS.alice],
  );
});

When(
  'I insert another edge {string} from A to B',
  async function (this: AConversaWorld, role: string) {
    await expectQuery(
      this,
      `INSERT INTO edges (role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [role, TEST_UUIDS.nodeA, TEST_UUIDS.nodeB, TEST_UUIDS.alice],
    );
  },
);

When('I insert an edge {string} from B to A', async function (this: AConversaWorld, role: string) {
  await expectQuery(
    this,
    `INSERT INTO edges (role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4)`,
    [role, TEST_UUIDS.nodeB, TEST_UUIDS.nodeA, TEST_UUIDS.alice],
  );
});

Then('both edges are recorded', async function (this: AConversaWorld) {
  const res = (await this.db.query(`SELECT count(*)::int AS n FROM edges`)) as QueryResult<{
    n: number;
  }>;
  assert.equal(res.rows[0]?.n, 2);
});

When(
  'I insert an edge with role {string} from A to B',
  async function (this: AConversaWorld, role: string) {
    await expectQuery(
      this,
      `INSERT INTO edges (role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [role, TEST_UUIDS.nodeA, TEST_UUIDS.nodeB, TEST_UUIDS.alice],
    );
  },
);

When(
  'I insert an edge {string} with a non-existent source node',
  async function (this: AConversaWorld, role: string) {
    await expectQuery(
      this,
      `INSERT INTO edges (role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [role, TEST_UUIDS.nodeC /* never inserted */, TEST_UUIDS.nodeB, TEST_UUIDS.alice],
    );
  },
);
