// Steps for tests/behavior/runner/migrate.feature.
//
// The Before hook in support/world.ts has already applied every
// migration via `applyMigrations` against this scenario's fresh
// pglite. These steps re-call it to assert the no-op rerun and
// shape-check the `pgmigrations` table.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { applyMigrations, listMigrationFiles } from '../support/migrate.js';

Then(
  'the pgmigrations table has one row per migration file',
  async function (this: AConversaWorld) {
    const files = await listMigrationFiles();
    const res = (await this.db.query(
      `SELECT count(*)::int AS n FROM pgmigrations`,
    )) as QueryResult<{ n: number }>;
    assert.equal(res.rows[0]?.n, files.length);
  },
);

Then(
  `every migration file's basename appears in pgmigrations`,
  async function (this: AConversaWorld) {
    const files = await listMigrationFiles();
    const res = (await this.db.query(`SELECT name FROM pgmigrations`)) as QueryResult<{
      name: string;
    }>;
    const recorded = new Set(res.rows.map((r) => r.name));
    for (const f of files) {
      assert.ok(recorded.has(f), `expected ${f} in pgmigrations`);
    }
  },
);

When('I run the migration runner again', async function (this: AConversaWorld) {
  const before = (await this.db.query(
    `SELECT count(*)::int AS n FROM pgmigrations`,
  )) as QueryResult<{ n: number }>;
  this.scratch['pgmigrationsBefore'] = before.rows[0]?.n;
  const applied = await applyMigrations(this.db);
  this.scratch['secondRunApplied'] = applied;
});

Then('no additional migrations are reported as applied', function (this: AConversaWorld) {
  const applied = this.scratch['secondRunApplied'] as readonly { name: string }[];
  assert.equal(applied.length, 0);
});

Then('the pgmigrations row count is unchanged', async function (this: AConversaWorld) {
  const after = (await this.db.query(
    `SELECT count(*)::int AS n FROM pgmigrations`,
  )) as QueryResult<{ n: number }>;
  assert.equal(after.rows[0]?.n, this.scratch['pgmigrationsBefore']);
});
