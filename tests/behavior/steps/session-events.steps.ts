// Steps for tests/behavior/migrations/session-events.feature.

import { Given, When } from '@cucumber/cucumber';
import type { AConversaWorld } from '../support/world.js';
import { expectQuery, insertSession, insertUser, TEST_UUIDS } from '../support/helpers.js';

Given('a user and a session by that user', async function (this: AConversaWorld) {
  await insertUser(this, TEST_UUIDS.alice, 'authelia:alice', 'alice');
  await insertSession(this, TEST_UUIDS.session, TEST_UUIDS.alice);
});

Given(
  'a {string} event with sequence {int} in that session',
  async function (this: AConversaWorld, kind: string, seq: number) {
    await this.db.query(
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [TEST_UUIDS.session, seq, kind, TEST_UUIDS.alice, '{}'],
    );
  },
);

When(
  'I insert another event with the same session and sequence {int}',
  async function (this: AConversaWorld, seq: number) {
    await expectQuery(
      this,
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [TEST_UUIDS.session, seq, 'session-ended', TEST_UUIDS.alice, '{}'],
    );
  },
);

When(
  'I insert an event with kind {string} in that session',
  async function (this: AConversaWorld, kind: string) {
    await expectQuery(
      this,
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [TEST_UUIDS.session, 1, kind, TEST_UUIDS.alice, '{}'],
    );
  },
);

When(
  'I insert a {string} event with sequence {int} and a NULL actor',
  async function (this: AConversaWorld, kind: string, seq: number) {
    await expectQuery(
      this,
      `INSERT INTO session_events (session_id, sequence, kind, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [TEST_UUIDS.session, seq, kind, null, '{}'],
    );
  },
);
