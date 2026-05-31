// Steps for tests/behavior/methodology/snapshot-create.feature.
//
// The behavior-test layer for the methodology engine's `createSnapshot`
// standalone helper (`apps/server/src/methodology/handlers/createSnapshot.ts`).
// The Vitest tests at
// `apps/server/src/methodology/handlers/createSnapshot.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's lifecycle events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `createSnapshot` against a `currentSequence` matching the projected
// session's `lastAppliedSequence`. The scenarios do NOT append the
// snapshot event back — the helper is pure and the assertion is on the
// returned `ValidationResult` shape (which the WS layer would then
// hand off to its append/broadcast path; that integration is owned by
// the `ws_label_snapshot_message` task).
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/snapshot_create_logic.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  projectFromLog,
  type Event,
  type Projection,
} from '../../../apps/server/src/projection/index.js';
import {
  createSnapshot,
  type CreateSnapshotInput,
} from '../../../apps/server/src/methodology/index.js';
import { MAX_SNAPSHOT_LABEL_LENGTH } from '../../../packages/shared-types/src/limits.js';
import type { ValidationResult } from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the other
// methodology step files that share a Cucumber World.
const SN_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SN_HOST_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const SN_DEBATER_A_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const SN_DEBATER_B_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const SN_NODE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';

const TS_BASE = '2026-05-31T16:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + six lifecycle events (session-created,
// 3x participant-joined, node-created, proposal). Brings the session to
// `lastAppliedSequence = 6`. The exact event mix is incidental — what
// matters for snapshot-create is that the projection's
// `lastAppliedSequence` is non-zero so `currentSequence + 1` is a
// realistic snapshot sequence.
async function seedBaseSession(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: SN_HOST_ID, sub: 'fixture-sn:host', name: 'host' },
    { id: SN_DEBATER_A_ID, sub: 'fixture-sn:a', name: 'a' },
    { id: SN_DEBATER_B_ID, sub: 'fixture-sn:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [SN_SESSION_ID, SN_HOST_ID, 'public', 'Snapshot-logic behavior tests'],
  );

  await insertEventRow(world, SN_SESSION_ID, {
    id: evId(401),
    sequence: 1,
    kind: 'session-created',
    actor: SN_HOST_ID,
    payload: {
      host_user_id: SN_HOST_ID,
      privacy: 'public',
      topic: 'Snapshot-logic behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, SN_SESSION_ID, {
    id: evId(402),
    sequence: 2,
    kind: 'participant-joined',
    actor: SN_HOST_ID,
    payload: {
      user_id: SN_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, SN_SESSION_ID, {
    id: evId(403),
    sequence: 3,
    kind: 'participant-joined',
    actor: SN_DEBATER_A_ID,
    payload: {
      user_id: SN_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, SN_SESSION_ID, {
    id: evId(404),
    sequence: 4,
    kind: 'participant-joined',
    actor: SN_DEBATER_B_ID,
    payload: {
      user_id: SN_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
  await insertEventRow(world, SN_SESSION_ID, {
    id: evId(405),
    sequence: 5,
    kind: 'node-created',
    actor: SN_DEBATER_A_ID,
    payload: {
      node_id: SN_NODE_ID,
      wording: 'A proposition for snapshot-logic tests.',
      created_by: SN_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, SN_SESSION_ID, {
    id: evId(406),
    sequence: 6,
    kind: 'proposal',
    actor: SN_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: SN_NODE_ID,
        classification: 'fact',
      },
    },
    createdAt: tsAt(5),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, SN_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, SN_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session at sequence 6 for snapshot-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    this.scratch['snapshotProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

function callCreateSnapshot(world: AConversaWorld, label: string): void {
  const projection = world.scratch['snapshotProjection'] as Projection;
  const input: CreateSnapshotInput = {
    sessionId: SN_SESSION_ID,
    moderatorId: SN_HOST_ID,
    label,
    currentSequence: projection.lastAppliedSequence,
    now: tsAt(10),
  };
  world.scratch['methodologyResult'] = createSnapshot(input);
}

When(
  /^the moderator calls createSnapshot with label "([^"]*)" against the projected session$/,
  function (this: AConversaWorld, label: string) {
    callCreateSnapshot(this, label);
  },
);

When(
  'the moderator calls createSnapshot with an empty label against the projected session',
  function (this: AConversaWorld) {
    callCreateSnapshot(this, '');
  },
);

When(
  'the moderator calls createSnapshot with a 129-character label against the projected session',
  function (this: AConversaWorld) {
    callCreateSnapshot(this, 'x'.repeat(MAX_SNAPSHOT_LABEL_LENGTH + 1));
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  /^the result carries a single snapshot-created event whose log_position is (\d+) and label is "([^"]*)"$/,
  function (this: AConversaWorld, logPosition: string, label: string) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'snapshot-created');
    assert.equal(ev.sessionId, SN_SESSION_ID);
    assert.equal(ev.actor, SN_HOST_ID);
    if (ev.kind !== 'snapshot-created') return;
    assert.equal(ev.sequence, Number(logPosition));
    assert.equal(ev.payload.log_position, Number(logPosition));
    assert.equal(ev.payload.label, label);
    // Envelope id and payload snapshot_id are distinct identities.
    assert.notEqual(ev.id, ev.payload.snapshot_id);
  },
);
