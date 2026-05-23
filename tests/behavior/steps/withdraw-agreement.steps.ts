// Steps for tests/behavior/methodology/withdraw-agreement.feature.
//
// Wire-and-replay round-trip pin for the new `withdraw-agreement`
// event kind (per ADR 0030 §3). The Vitest tests at
// `packages/shared-types/src/events.test.ts` cover the in-memory
// schema (round-trip + reject-malformed across every payload field).
// This integration layer pins the seams those tests cannot reach:
//   (a) the `0014_session_events_withdraw_agreement.sql` `CHECK (kind
//       IN …)` extension accepts the new kind on INSERT;
//   (b) the JSONB / TIMESTAMPTZ / BIGINT coercion through pglite into
//       `selectEvents` → `validateEvent` recovers a typed envelope;
//   (c) `projectFromLog` advances `lastAppliedSequence` past the new
//       event (no-op handler at this task's landing — handler lives
//       in the downstream `pf_withdraw_agreement_handler` task).
//
// Refinement: tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';

// Distinct UUID prefix from other methodology / projection step files
// so the shared World doesn't collide across scenarios run in one
// Cucumber pass.
const WA_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd000';
const WA_HOST_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
const WA_DEBATER_A_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002';
const WA_DEBATER_B_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003';

const WA_NODE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00a';
const WA_WITHDRAW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00b';

const TS_BASE = '2026-05-10T18:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants for withdraw-agreement tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: WA_HOST_ID, sub: 'fixture-wa:host', name: 'host' },
      { id: WA_DEBATER_A_ID, sub: 'fixture-wa:a', name: 'a' },
      { id: WA_DEBATER_B_ID, sub: 'fixture-wa:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [WA_SESSION_ID, WA_HOST_ID, 'public', 'withdraw-agreement behavior tests'],
    );

    await insertEventRow(this, WA_SESSION_ID, {
      id: evId(601),
      sequence: 1,
      kind: 'session-created',
      actor: WA_HOST_ID,
      payload: {
        host_user_id: WA_HOST_ID,
        privacy: 'public',
        topic: 'withdraw-agreement behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, WA_SESSION_ID, {
      id: evId(602),
      sequence: 2,
      kind: 'participant-joined',
      actor: WA_HOST_ID,
      payload: {
        user_id: WA_HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, WA_SESSION_ID, {
      id: evId(603),
      sequence: 3,
      kind: 'participant-joined',
      actor: WA_DEBATER_A_ID,
      payload: {
        user_id: WA_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, WA_SESSION_ID, {
      id: evId(604),
      sequence: 4,
      kind: 'participant-joined',
      actor: WA_DEBATER_B_ID,
      payload: {
        user_id: WA_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    this.scratch['waNextSeq'] = 5;
  },
);

Given(
  'a node-created event for the withdraw-agreement-test node',
  async function (this: AConversaWorld) {
    const seq = this.scratch['waNextSeq'] as number;
    this.scratch['waNextSeq'] = seq + 1;
    await insertEventRow(this, WA_SESSION_ID, {
      id: evId(seq * 100 + 6),
      sequence: seq,
      kind: 'node-created',
      actor: WA_DEBATER_A_ID,
      payload: {
        node_id: WA_NODE_ID,
        wording: 'A statement targeted by withdraw-agreement.',
        created_by: WA_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  "a withdraw-agreement event is inserted for the withdraw-agreement-test node's classification facet",
  async function (this: AConversaWorld) {
    const seq = this.scratch['waNextSeq'] as number;
    this.scratch['waNextSeq'] = seq + 1;
    this.scratch['waWithdrawSequence'] = seq;
    await insertEventRow(this, WA_SESSION_ID, {
      id: WA_WITHDRAW_EVENT_ID,
      sequence: seq,
      kind: 'withdraw-agreement',
      actor: WA_DEBATER_B_ID,
      payload: {
        entity_kind: 'node',
        entity_id: WA_NODE_ID,
        facet: 'classification',
        participant: WA_DEBATER_B_ID,
        withdrawn_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'I project the withdraw-agreement event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, WA_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    this.scratch['waEvents'] = events;
    const projection = projectFromLog(events, WA_SESSION_ID);
    this.scratch['waProjection'] = projection;
  },
);

Then(
  "the projection's lastAppliedSequence equals the withdraw-agreement event's sequence",
  function (this: AConversaWorld) {
    const projection = this.scratch['waProjection'] as Projection;
    const expectedSeq = this.scratch['waWithdrawSequence'] as number;
    assert.equal(projection.lastAppliedSequence, expectedSeq);
  },
);

Then(
  'the withdraw-agreement event round-trips through validateEvent with kind {string}',
  function (this: AConversaWorld, expectedKind: string) {
    const events = this.scratch['waEvents'] as Array<{ id: string; kind: string }>;
    const found = events.find((e) => e.id === WA_WITHDRAW_EVENT_ID);
    assert.ok(found, `expected a withdraw-agreement event with id ${WA_WITHDRAW_EVENT_ID}`);
    assert.equal(found.kind, expectedKind);
  },
);
