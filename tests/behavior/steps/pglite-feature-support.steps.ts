// Steps for tests/behavior/pglite/feature-support.feature.
//
// These steps are the committed form of what would otherwise be
// `node -e` probes ("does pglite support gen_random_uuid? does
// JSONB work?"). The probe IS the scenario.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

When('I select gen_random_uuid', async function (this: AConversaWorld) {
  const res = (await this.db.query('SELECT gen_random_uuid() AS u')) as QueryResult<{ u: string }>;
  this.scratch['uuid'] = res.rows[0]?.u;
});

Then('the result is a UUID-shaped string', function (this: AConversaWorld) {
  const u = this.scratch['uuid'];
  assert.equal(typeof u, 'string');
  assert.match(u as string, UUID_RE);
});

Given('a probe table with a JSONB column', async function (this: AConversaWorld) {
  await this.db.exec('CREATE TABLE jsonb_probe (id SERIAL PRIMARY KEY, data JSONB NOT NULL)');
});

// The probe object is fixed in code (not in the Gherkin) because
// Cucumber Expressions reserve `{` / `}` for parameter type syntax, so
// embedding a literal JSON object in the step text requires a regex
// step. Pinning the object here keeps the assertion explicit and the
// step phrase parseable; the round-trip Then below compares against the
// same constant.
const PROBE_JSONB = { a: 1, nested: { b: 'two' } } as const;

When('I insert the probe JSON object', async function (this: AConversaWorld) {
  await this.db.query('INSERT INTO jsonb_probe (data) VALUES ($1::jsonb)', [
    JSON.stringify(PROBE_JSONB),
  ]);
});

Then('the round-tripped JSONB equals the inserted object', async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT data FROM jsonb_probe ORDER BY id DESC LIMIT 1',
  )) as QueryResult<{ data: unknown }>;
  assert.deepEqual(res.rows[0]?.data, PROBE_JSONB);
});

Given(
  'a probe table with a partial unique index on x where active is true',
  async function (this: AConversaWorld) {
    await this.db.exec(
      `CREATE TABLE partial_unique_probe (
         id     SERIAL PRIMARY KEY,
         x      INTEGER NOT NULL,
         active BOOLEAN NOT NULL
       )`,
    );
    await this.db.exec(
      'CREATE UNIQUE INDEX partial_unique_probe_x_idx ON partial_unique_probe (x) WHERE active = TRUE',
    );
  },
);

When('I insert two inactive rows with the same x', async function (this: AConversaWorld) {
  await this.db.query('INSERT INTO partial_unique_probe (x, active) VALUES ($1, $2)', [1, false]);
  await this.db.query('INSERT INTO partial_unique_probe (x, active) VALUES ($1, $2)', [1, false]);
});

Then('both rows are accepted', async function (this: AConversaWorld) {
  const res = (await this.db.query(
    'SELECT count(*)::int AS n FROM partial_unique_probe WHERE active = FALSE AND x = 1',
  )) as QueryResult<{ n: number }>;
  assert.equal(res.rows[0]?.n, 2);
});

When('I insert two active rows with the same x', async function (this: AConversaWorld) {
  await this.db.query('INSERT INTO partial_unique_probe (x, active) VALUES ($1, $2)', [9, true]);
  this.scratch['lastError'] = undefined;
  try {
    await this.db.query('INSERT INTO partial_unique_probe (x, active) VALUES ($1, $2)', [9, true]);
  } catch (err) {
    this.scratch['lastError'] = err;
  }
});

Then('the second active insert is rejected', function (this: AConversaWorld) {
  const err = this.scratch['lastError'];
  assert.ok(err instanceof Error, 'expected an Error from duplicate active insert');
  assert.match(err.message, /unique|duplicate/i);
});

Given(
  'a probe table with a CHECK constraint that color is in red, green, blue',
  async function (this: AConversaWorld) {
    await this.db.exec(
      `CREATE TABLE check_probe (
         id    SERIAL PRIMARY KEY,
         color TEXT NOT NULL CHECK (color IN ('red', 'green', 'blue'))
       )`,
    );
  },
);

When('I insert a row with color {string}', async function (this: AConversaWorld, color: string) {
  this.scratch['lastError'] = undefined;
  try {
    await this.db.query('INSERT INTO check_probe (color) VALUES ($1)', [color]);
  } catch (err) {
    this.scratch['lastError'] = err;
  }
});

Then('the row is accepted', function (this: AConversaWorld) {
  assert.equal(this.scratch['lastError'], undefined);
});

Then('the row is rejected', function (this: AConversaWorld) {
  const err = this.scratch['lastError'];
  assert.ok(err instanceof Error, 'expected a CHECK violation Error');
  assert.match(err.message, /check|constraint/i);
});
