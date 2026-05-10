// Steps for tests/behavior/migrations/users.feature.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { expectQuery, lastError } from '../support/helpers.js';

Given(
  'a user with oauth_subject {string} exists',
  async function (this: AConversaWorld, sub: string) {
    const screenName = sub.split(':')[1] ?? 'tester';
    await this.db.query(
      `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) RETURNING id`,
      [sub, screenName],
    );
  },
);

When(
  'I insert another user with oauth_subject {string}',
  async function (this: AConversaWorld, sub: string) {
    await expectQuery(this, `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2)`, [
      sub,
      'duplicate',
    ]);
  },
);

Then('the insert is rejected with a unique-violation error', function (this: AConversaWorld) {
  const err = lastError(this);
  assert.ok(err, 'expected a unique-violation error');
  assert.match(err.message, /unique|duplicate/i);
});

Then('the insert is rejected with a check-violation error', function (this: AConversaWorld) {
  const err = lastError(this);
  assert.ok(err, 'expected a CHECK-violation error');
  assert.match(err.message, /check|constraint/i);
});

Then('the insert is rejected with a foreign-key-violation error', function (this: AConversaWorld) {
  const err = lastError(this);
  assert.ok(err, 'expected a foreign-key-violation error');
  assert.match(err.message, /foreign key|violates/i);
});

Then(`the user's deleted_at is NULL`, async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT deleted_at FROM users ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ deleted_at: unknown }>;
  assert.equal(res.rows[0]?.deleted_at, null);
});
