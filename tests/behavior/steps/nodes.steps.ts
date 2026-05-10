// Steps for tests/behavior/migrations/nodes.feature.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { expectQuery, insertUser, TEST_UUIDS } from '../support/helpers.js';

When(
  'I insert a node with a created_by that does not exist',
  async function (this: AConversaWorld) {
    await expectQuery(this, `INSERT INTO nodes (wording, created_by) VALUES ($1, $2)`, [
      'Orphan',
      TEST_UUIDS.alice, // user table is empty
    ]);
  },
);

Given(
  'a user {string} and a node {string} by alice',
  async function (this: AConversaWorld, sub: string, wording: string) {
    await insertUser(this, TEST_UUIDS.alice, sub, 'alice');
    await this.db.query(`INSERT INTO nodes (id, wording, created_by) VALUES ($1, $2, $3)`, [
      TEST_UUIDS.nodeA,
      wording,
      TEST_UUIDS.alice,
    ]);
    this.scratch['nodeOriginalId'] = TEST_UUIDS.nodeA;
  },
);

When(
  `I update the node's wording to {string}`,
  async function (this: AConversaWorld, wording: string) {
    await this.db.query(`UPDATE nodes SET wording = $1 WHERE id = $2`, [wording, TEST_UUIDS.nodeA]);
  },
);

Then(`the node's id is unchanged`, async function (this: AConversaWorld) {
  const res = (await this.db.query(`SELECT id FROM nodes`)) as QueryResult<{ id: string }>;
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]?.id, this.scratch['nodeOriginalId']);
});

Then(`the node's wording is {string}`, async function (this: AConversaWorld, wording: string) {
  const res = (await this.db.query(`SELECT wording FROM nodes WHERE id = $1`, [
    TEST_UUIDS.nodeA,
  ])) as QueryResult<{ wording: string }>;
  assert.equal(res.rows[0]?.wording, wording);
});

When(
  'I insert a new node {string} by alice with a different id',
  async function (this: AConversaWorld, wording: string) {
    await this.db.query(`INSERT INTO nodes (id, wording, created_by) VALUES ($1, $2, $3)`, [
      TEST_UUIDS.nodeB,
      wording,
      TEST_UUIDS.alice,
    ]);
  },
);

Then(
  'both the old and new node rows exist with their original wordings',
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      `SELECT id, wording FROM nodes ORDER BY created_at`,
    )) as QueryResult<{ id: string; wording: string }>;
    assert.equal(res.rows.length, 2);
    const a = res.rows.find((r) => r.id === TEST_UUIDS.nodeA);
    const b = res.rows.find((r) => r.id === TEST_UUIDS.nodeB);
    assert.equal(a?.wording, 'First wording');
    assert.equal(b?.wording, 'Restructured wording');
  },
);
