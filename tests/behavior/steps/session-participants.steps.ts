// Steps for tests/behavior/migrations/session-participants.feature.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import {
  expectQuery,
  insertSession,
  insertUser,
  lastError,
  TEST_UUIDS,
} from '../support/helpers.js';

Given('a host user, two debaters, and a session exist', async function (this: AConversaWorld) {
  await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
  await insertUser(this, TEST_UUIDS.ben, 'authelia:ben', 'ben');
  await insertUser(this, TEST_UUIDS.maria, 'authelia:maria', 'maria');
  await insertSession(this, TEST_UUIDS.session, TEST_UUIDS.alice);
});

Given('the first debater joined as {string}', async function (this: AConversaWorld, role: string) {
  const res = (await this.db.query(
    `INSERT INTO session_participants (session_id, user_id, role)
       VALUES ($1, $2, $3) RETURNING id`,
    [TEST_UUIDS.session, TEST_UUIDS.ben, role],
  )) as QueryResult<{ id: string }>;
  this.scratch['firstParticipantId'] = res.rows[0]?.id;
});

When(
  'the second debater also tries to join as {string} while the first is active',
  async function (this: AConversaWorld, role: string) {
    await expectQuery(
      this,
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, $3)`,
      [TEST_UUIDS.session, TEST_UUIDS.maria, role],
    );
  },
);

When(
  'the first debater tries to also join as {string} while the first row is active',
  async function (this: AConversaWorld, role: string) {
    await expectQuery(
      this,
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, $3)`,
      [TEST_UUIDS.session, TEST_UUIDS.ben, role],
    );
  },
);

When('the first debater leaves the session', async function (this: AConversaWorld) {
  await this.db.query(`UPDATE session_participants SET left_at = NOW() WHERE id = $1`, [
    this.scratch['firstParticipantId'],
  ]);
});

When('the second debater joins as {string}', async function (this: AConversaWorld, role: string) {
  await this.db.query(
    `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, $3)`,
    [TEST_UUIDS.session, TEST_UUIDS.maria, role],
  );
});

When(
  'the first debater tries to join as {string}',
  async function (this: AConversaWorld, role: string) {
    await expectQuery(
      this,
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, $3)`,
      [TEST_UUIDS.session, TEST_UUIDS.ben, role],
    );
  },
);

Then('both joins are recorded', async function (this: AConversaWorld) {
  // Debater A: a left row + an active row, both for that role.
  const res = (await this.db.query(
    `SELECT count(*)::int AS n FROM session_participants
       WHERE session_id = $1 AND role = 'debater-A'`,
    [TEST_UUIDS.session],
  )) as QueryResult<{ n: number }>;
  assert.equal(res.rows[0]?.n, 2);
  // And among them, exactly one is currently active.
  const active = (await this.db.query(
    `SELECT count(*)::int AS n FROM session_participants
       WHERE session_id = $1 AND role = 'debater-A' AND left_at IS NULL`,
    [TEST_UUIDS.session],
  )) as QueryResult<{ n: number }>;
  assert.equal(active.rows[0]?.n, 1);
  assert.equal(lastError(this), undefined);
});
