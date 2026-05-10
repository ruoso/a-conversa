// Steps for tests/behavior/fixtures/load.feature.
//
// Imports `loadFixture` directly via relative path. We don't pull
// `@a-conversa/test-fixtures` in as a workspace dep because nothing
// outside this test code consumes it; a relative import keeps the
// dependency graph tight and the test code self-contained.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { loadFixture } from '../../../packages/test-fixtures/src/loader.js';

When('I load the {string} fixture', async function (this: AConversaWorld, name: string) {
  await loadFixture(name, this.client);
});

When('I load the {string} fixture again', async function (this: AConversaWorld, name: string) {
  await loadFixture(name, this.client);
});

Then('the session_events row count is {int}', async function (this: AConversaWorld, n: number) {
  const res = (await this.db.query(
    `SELECT count(*)::int AS n FROM session_events`,
  )) as QueryResult<{ n: number }>;
  assert.equal(res.rows[0]?.n, n);
});

Then(
  'the session_participants row count is {int}',
  async function (this: AConversaWorld, n: number) {
    const res = (await this.db.query(
      `SELECT count(*)::int AS n FROM session_participants`,
    )) as QueryResult<{ n: number }>;
    assert.equal(res.rows[0]?.n, n);
  },
);

Then(
  'the participants have roles {string}, {string}, {string}',
  async function (this: AConversaWorld, r1: string, r2: string, r3: string) {
    const res = (await this.db.query(
      `SELECT role FROM session_participants ORDER BY role`,
    )) as QueryResult<{ role: string }>;
    const roles = res.rows.map((r) => r.role).sort();
    const expected = [r1, r2, r3].sort();
    assert.deepEqual(roles, expected);
  },
);

When('I try to load a fixture named {string}', async function (this: AConversaWorld, name: string) {
  this.scratch['lastError'] = undefined;
  try {
    await loadFixture(name, this.client);
  } catch (err) {
    this.scratch['lastError'] = err;
  }
});

Then('the loader throws an unknown-fixture error', function (this: AConversaWorld) {
  const err = this.scratch['lastError'];
  assert.ok(err instanceof Error, 'expected an Error from unknown fixture');
  assert.match(err.message, /Unknown fixture/i);
});
