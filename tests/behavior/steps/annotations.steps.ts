// Steps for tests/behavior/migrations/annotations.feature.
//
// "Then the row is accepted" is the shared step phrase across the
// pglite-feature-support and annotations features. Its single
// canonical definition lives in pglite-feature-support.steps.ts —
// don't redefine it here, Cucumber treats duplicates as ambiguous.

import { Given, When } from '@cucumber/cucumber';
import type { AConversaWorld } from '../support/world.js';
import { expectQuery, insertNode, insertUser, TEST_UUIDS } from '../support/helpers.js';

Given(
  'a user, a node A, and an edge from A to A by that user',
  async function (this: AConversaWorld) {
    await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
    await insertNode(this, TEST_UUIDS.nodeA, TEST_UUIDS.alice, 'A');
    await this.db.query(
      `INSERT INTO edges (id, role, source_node_id, target_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [TEST_UUIDS.edgeA, 'supports', TEST_UUIDS.nodeA, TEST_UUIDS.nodeA, TEST_UUIDS.alice],
    );
  },
);

When(
  'I insert an annotation with both target_node_id and target_edge_id set',
  async function (this: AConversaWorld) {
    await expectQuery(
      this,
      `INSERT INTO annotations (target_node_id, target_edge_id, kind, content, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [TEST_UUIDS.nodeA, TEST_UUIDS.edgeA, 'note', 'both', TEST_UUIDS.alice],
    );
  },
);

When(
  'I insert an annotation with neither target_node_id nor target_edge_id set',
  async function (this: AConversaWorld) {
    await expectQuery(
      this,
      `INSERT INTO annotations (kind, content, created_by) VALUES ($1, $2, $3)`,
      ['note', 'neither', TEST_UUIDS.alice],
    );
  },
);

When(
  'I insert an annotation with kind {string} targeting node A',
  async function (this: AConversaWorld, kind: string) {
    await expectQuery(
      this,
      `INSERT INTO annotations (target_node_id, kind, content, created_by)
       VALUES ($1, $2, $3, $4)`,
      [TEST_UUIDS.nodeA, kind, 'a note', TEST_UUIDS.alice],
    );
  },
);
