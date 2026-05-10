// Steps for tests/behavior/methodology/commit.feature.
//
// The behavior-test layer for the methodology engine's commit handler
// (`apps/server/src/methodology/handlers/commit.ts`). The Vitest tests
// at `apps/server/src/methodology/handlers/commit.test.ts` cover the
// in-memory rule set. This file covers the DB-driven integration path:
// round-trip the session's events through pglite's `session_events`,
// replay through `projectFromLog`, then call `validateAction` with a
// commit action against the resulting projection.
//
// Refinement: tasks/refinements/data-and-methodology/commit_logic.md

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
  nextSequence,
  validateAction,
  type CommitAction,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the
// other methodology step files that share a Cucumber World.
const CL_SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0';
const CL_HOST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const CL_DEBATER_A_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const CL_DEBATER_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

const CL_NODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const CL_PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const CL_NEW_EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';

const TS_BASE = '2026-05-10T16:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + the six lifecycle events (session-created,
// 3x participant-joined, node-created, proposal). Caller layers in any
// votes that vary per scenario.
async function seedBaseSession(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CL_HOST_ID, sub: 'fixture-cl:host', name: 'host' },
    { id: CL_DEBATER_A_ID, sub: 'fixture-cl:a', name: 'a' },
    { id: CL_DEBATER_B_ID, sub: 'fixture-cl:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CL_SESSION_ID, CL_HOST_ID, 'public', 'Commit-logic behavior tests'],
  );

  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(301),
    sequence: 1,
    kind: 'session-created',
    actor: CL_HOST_ID,
    payload: {
      host_user_id: CL_HOST_ID,
      privacy: 'public',
      topic: 'Commit-logic behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(302),
    sequence: 2,
    kind: 'participant-joined',
    actor: CL_HOST_ID,
    payload: {
      user_id: CL_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(303),
    sequence: 3,
    kind: 'participant-joined',
    actor: CL_DEBATER_A_ID,
    payload: {
      user_id: CL_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(304),
    sequence: 4,
    kind: 'participant-joined',
    actor: CL_DEBATER_B_ID,
    payload: {
      user_id: CL_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(305),
    sequence: 5,
    kind: 'node-created',
    actor: CL_DEBATER_A_ID,
    payload: {
      node_id: CL_NODE_ID,
      wording: 'A proposition for commit-logic tests.',
      created_by: CL_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: CL_PROPOSAL_ID,
    sequence: 6,
    kind: 'proposal',
    actor: CL_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: CL_NODE_ID,
        classification: 'fact',
      },
    },
    createdAt: tsAt(5),
  });
}

async function insertVote(
  world: AConversaWorld,
  eventOrdinal: number,
  sequence: number,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
  tsOffset: number,
): Promise<void> {
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(eventOrdinal),
    sequence,
    kind: 'vote',
    actor: participant,
    payload: {
      proposal_id: CL_PROPOSAL_ID,
      participant,
      vote,
      voted_at: tsAt(tsOffset),
    },
    createdAt: tsAt(tsOffset),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, CL_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, CL_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants, a pending proposal, and three agree votes for commit-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    await insertVote(this, 311, 7, CL_HOST_ID, 'agree', 6);
    await insertVote(this, 312, 8, CL_DEBATER_A_ID, 'agree', 7);
    await insertVote(this, 313, 9, CL_DEBATER_B_ID, 'agree', 8);
    this.scratch['commitProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants, a pending proposal, and two agree votes for commit-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    await insertVote(this, 311, 7, CL_HOST_ID, 'agree', 6);
    await insertVote(this, 312, 8, CL_DEBATER_A_ID, 'agree', 7);
    // DEBATER_B has not voted.
    this.scratch['commitProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'the moderator constructs a commit action against the pending proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['commitProjection'] as Projection;
    const action: CommitAction = {
      kind: 'commit',
      requester: CL_HOST_ID,
      sessionId: CL_SESSION_ID,
      eventId: CL_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: CL_HOST_ID,
      createdAt: tsAt(10),
      proposalEventId: CL_PROPOSAL_ID,
      committedAt: tsAt(10),
    };
    this.scratch['commitAction'] = action;
  },
);

When(
  'a debater constructs a commit action against the pending proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['commitProjection'] as Projection;
    const action: CommitAction = {
      kind: 'commit',
      requester: CL_DEBATER_A_ID,
      sessionId: CL_SESSION_ID,
      eventId: CL_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: CL_DEBATER_A_ID,
      createdAt: tsAt(10),
      proposalEventId: CL_PROPOSAL_ID,
      committedAt: tsAt(10),
    };
    this.scratch['commitAction'] = action;
  },
);

When(
  'the methodology engine validates the commit action against the projected session',
  function (this: AConversaWorld) {
    const projection = this.scratch['commitProjection'] as Projection;
    const action = this.scratch['commitAction'] as CommitAction;
    this.scratch['methodologyResult'] = validateAction(projection, action);
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  'the result carries a single commit event for the pending proposal',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'commit');
    assert.equal(ev.sessionId, CL_SESSION_ID);
    assert.equal(ev.id, CL_NEW_EVENT_ID);
    if (ev.kind === 'commit') {
      assert.equal(ev.payload.proposal_id, CL_PROPOSAL_ID);
      assert.equal(ev.payload.moderator, CL_HOST_ID);
      assert.equal(ev.payload.committed_at, tsAt(10));
    }
  },
);

Then(
  /^the validation result is Rejected with reason "([^"]+)"$/,
  function (this: AConversaWorld, reason: string) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.equal(result.ok, false, `expected Rejected, got ${JSON.stringify(result)}`);
    if (result.ok) return;
    assert.equal(result.reason, reason, `expected reason ${reason}, got ${result.reason}`);
  },
);
