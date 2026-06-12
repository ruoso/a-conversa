// Steps for tests/behavior/migrations/sessions-started-at-backfill.feature.
//
// Refinement: tasks/refinements/session_discovery/sd_schema.md
//
// Exercises the 0018 backfill UPDATE: seed a pre-migration-shaped
// session (started_at NULL) plus historical session-mode-changed
// events, then re-run the actual migration SQL and assert started_at.
// The "a user and a session by that user" Given is reused from
// session-events.steps.ts (Cucumber globs all step files); it inserts
// alice + TEST_UUIDS.session.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { TEST_UUIDS } from '../support/helpers.js';
import { reexecMigration } from '../support/migrate.js';

const STARTED_AT_MIGRATION = '0018_sessions_started_at';

async function sessionStartedAt(world: AConversaWorld): Promise<Date | string | null | undefined> {
  const res = (await world.db.query('SELECT started_at FROM sessions WHERE id = $1', [
    TEST_UUIDS.session,
  ])) as QueryResult<{ started_at: Date | string | null }>;
  return res.rows[0]?.started_at;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

Given("that session's started_at is NULL", async function (this: AConversaWorld) {
  const startedAt = await sessionStartedAt(this);
  assert.notEqual(startedAt, undefined, 'expected the seeded session row to exist');
  assert.equal(startedAt, null, 'expected the seeded session to start with started_at NULL');
});

Given(
  'a {string} {word} event in that session at {string} with sequence {int}',
  async function (
    this: AConversaWorld,
    kind: string,
    mode: string,
    createdAt: string,
    seq: number,
  ) {
    const payload = JSON.stringify({
      previous_mode: 'lobby',
      new_mode: mode,
      changed_by: TEST_UUIDS.alice,
      changed_at: createdAt,
    });
    await this.db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [TEST_UUIDS.session, seq, kind, TEST_UUIDS.alice, payload, createdAt],
    );
  },
);

When('migration 0018 is re-applied', async function (this: AConversaWorld) {
  await reexecMigration(this.db, STARTED_AT_MIGRATION);
});

Then(
  "that session's started_at equals {string}",
  async function (this: AConversaWorld, expected: string) {
    const startedAt = await sessionStartedAt(this);
    assert.ok(startedAt instanceof Date || typeof startedAt === 'string', 'started_at is unset');
    assert.equal(
      toIso(startedAt),
      new Date(expected).toISOString(),
      `expected started_at to equal ${expected}`,
    );
  },
);
