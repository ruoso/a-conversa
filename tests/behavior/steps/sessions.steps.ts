// Steps for tests/behavior/migrations/sessions.feature.

import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { expectQuery, TEST_UUIDS } from '../support/helpers.js';

When(
  'I insert a session with a host_user_id that does not exist',
  async function (this: AConversaWorld) {
    // The user table is empty (fresh-DB Before hook); the FK lookup
    // will miss.
    await expectQuery(
      this,
      `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, $2, $3)`,
      [TEST_UUIDS.alice, 'public', 'A topic'],
    );
  },
);

When(
  'I insert a session with privacy {string} for that user',
  async function (this: AConversaWorld, privacy: string) {
    const userRes = (await this.db.query('SELECT id FROM users LIMIT 1')) as QueryResult<{
      id: string;
    }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, 'expected a host user from prior step');
    await expectQuery(
      this,
      `INSERT INTO sessions (host_user_id, privacy, topic) VALUES ($1, $2, $3)`,
      [hostId, privacy, 'A topic'],
    );
  },
);

When(
  'I insert a session with no privacy specified for that user',
  async function (this: AConversaWorld) {
    const userRes = (await this.db.query('SELECT id FROM users LIMIT 1')) as QueryResult<{
      id: string;
    }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, 'expected a host user from prior step');
    await this.db.query(`INSERT INTO sessions (host_user_id, topic) VALUES ($1, $2)`, [
      hostId,
      'A topic',
    ]);
  },
);

Then(`the session's privacy is {string}`, async function (this: AConversaWorld, expected: string) {
  const res = (await this.db.query(
    'SELECT privacy FROM sessions ORDER BY created_at DESC LIMIT 1',
  )) as QueryResult<{ privacy: string }>;
  assert.equal(res.rows[0]?.privacy, expected);
});
