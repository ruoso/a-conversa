// Steps for tests/behavior/methodology/vote.feature.
//
// The behavior-test layer for the methodology engine's vote handler
// (`apps/server/src/methodology/handlers/vote.ts`). The Vitest tests at
// `apps/server/src/methodology/handlers/vote.test.ts` cover the in-
// memory rule set. This file covers the DB-driven integration path:
// round-trip the session's events through pglite's `session_events`,
// replay through `projectFromLog`, then call `validateAction` with a
// vote action against the resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`).
//
// Refinement: tasks/refinements/data-and-methodology/withdrawal_logic.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  applyEvent,
  projectFromLog,
  type Event,
  type Projection,
} from '../../../apps/server/src/projection/index.js';
import { deriveFacetStatus } from '../../../apps/server/src/projection/facet-status.js';
import {
  nextSequence,
  validateAction,
  type ValidationResult,
  type VoteAction,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the
// other methodology step files that share a Cucumber World.
const VL_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc00';
const VL_HOST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const VL_DEBATER_A_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const VL_DEBATER_B_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
const VL_LATE_JOINER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc07';
const VL_OUTSIDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc08';

const VL_NODE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc04';
const VL_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc05';
const VL_NEW_EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc06';

const TS_BASE = '2026-05-10T17:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + the six lifecycle events (session-created,
// 3x participant-joined, node-created, proposal). Caller layers in
// votes, commits, and additional participants per scenario.
async function seedBaseSession(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: VL_HOST_ID, sub: 'fixture-vl:host', name: 'host' },
    { id: VL_DEBATER_A_ID, sub: 'fixture-vl:a', name: 'a' },
    { id: VL_DEBATER_B_ID, sub: 'fixture-vl:b', name: 'b' },
    { id: VL_LATE_JOINER_ID, sub: 'fixture-vl:late', name: 'late' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [VL_SESSION_ID, VL_HOST_ID, 'public', 'Vote-logic behavior tests'],
  );

  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(401),
    sequence: 1,
    kind: 'session-created',
    actor: VL_HOST_ID,
    payload: {
      host_user_id: VL_HOST_ID,
      privacy: 'public',
      topic: 'Vote-logic behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(402),
    sequence: 2,
    kind: 'participant-joined',
    actor: VL_HOST_ID,
    payload: {
      user_id: VL_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(403),
    sequence: 3,
    kind: 'participant-joined',
    actor: VL_DEBATER_A_ID,
    payload: {
      user_id: VL_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(404),
    sequence: 4,
    kind: 'participant-joined',
    actor: VL_DEBATER_B_ID,
    payload: {
      user_id: VL_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(405),
    sequence: 5,
    kind: 'node-created',
    actor: VL_DEBATER_A_ID,
    payload: {
      node_id: VL_NODE_ID,
      wording: 'A proposition for vote-logic tests.',
      created_by: VL_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, VL_SESSION_ID, {
    id: VL_PROPOSAL_ID,
    sequence: 6,
    kind: 'proposal',
    actor: VL_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: VL_NODE_ID,
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
  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(eventOrdinal),
    sequence,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: VL_PROPOSAL_ID,
      participant,
      choice: vote,
      voted_at: tsAt(tsOffset),
    },
    createdAt: tsAt(tsOffset),
  });
}

async function insertCommit(
  world: AConversaWorld,
  eventOrdinal: number,
  sequence: number,
  moderator: string,
  tsOffset: number,
): Promise<void> {
  await insertEventRow(world, VL_SESSION_ID, {
    id: evId(eventOrdinal),
    sequence,
    kind: 'commit',
    actor: moderator,
    payload: {
      proposal_id: VL_PROPOSAL_ID,
      moderator,
      committed_at: tsAt(tsOffset),
    },
    createdAt: tsAt(tsOffset),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, VL_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, VL_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a pending classify-node proposal for vote-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    this.scratch['voteProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session committed on a classify-node proposal with three agree votes for vote-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    await insertVote(this, 411, 7, VL_HOST_ID, 'agree', 6);
    await insertVote(this, 412, 8, VL_DEBATER_A_ID, 'agree', 7);
    await insertVote(this, 413, 9, VL_DEBATER_B_ID, 'agree', 8);
    await insertCommit(this, 414, 10, VL_HOST_ID, 9);
    this.scratch['voteProjection'] = await projectFromDb(this);
  },
);

Given(
  'a late-joining debater is added after the commit for vote-logic tests',
  async function (this: AConversaWorld) {
    await insertEventRow(this, VL_SESSION_ID, {
      id: evId(415),
      sequence: 11,
      kind: 'participant-joined',
      actor: VL_LATE_JOINER_ID,
      payload: {
        user_id: VL_LATE_JOINER_ID,
        role: 'debater-A',
        screen_name: 'late',
        joined_at: tsAt(10),
      },
      createdAt: tsAt(10),
    });
    this.scratch['voteProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater who previously voted agree constructs a withdraw action against the committed proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['voteProjection'] as Projection;
    const action: VoteAction = {
      kind: 'vote',
      requester: VL_DEBATER_A_ID,
      sessionId: VL_SESSION_ID,
      eventId: VL_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: VL_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposalEventId: VL_PROPOSAL_ID,
      vote: 'withdraw',
      votedAt: tsAt(20),
    };
    this.scratch['voteAction'] = action;
  },
);

When(
  'the late-joining debater constructs a withdraw action against the committed proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['voteProjection'] as Projection;
    const action: VoteAction = {
      kind: 'vote',
      requester: VL_LATE_JOINER_ID,
      sessionId: VL_SESSION_ID,
      eventId: VL_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: VL_LATE_JOINER_ID,
      createdAt: tsAt(20),
      proposalEventId: VL_PROPOSAL_ID,
      vote: 'withdraw',
      votedAt: tsAt(20),
    };
    this.scratch['voteAction'] = action;
  },
);

When(
  'a debater constructs an agree action against the committed proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['voteProjection'] as Projection;
    const action: VoteAction = {
      kind: 'vote',
      requester: VL_DEBATER_A_ID,
      sessionId: VL_SESSION_ID,
      eventId: VL_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: VL_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposalEventId: VL_PROPOSAL_ID,
      vote: 'agree',
      votedAt: tsAt(20),
    };
    this.scratch['voteAction'] = action;
  },
);

When(
  'an outsider constructs an agree action against the pending proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['voteProjection'] as Projection;
    const action: VoteAction = {
      kind: 'vote',
      requester: VL_OUTSIDER_ID,
      sessionId: VL_SESSION_ID,
      eventId: VL_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: VL_OUTSIDER_ID,
      createdAt: tsAt(20),
      proposalEventId: VL_PROPOSAL_ID,
      vote: 'agree',
      votedAt: tsAt(20),
    };
    this.scratch['voteAction'] = action;
  },
);

When(
  'the methodology engine validates the vote action against the projected session',
  function (this: AConversaWorld) {
    const projection = this.scratch['voteProjection'] as Projection;
    const action = this.scratch['voteAction'] as VoteAction;
    this.scratch['methodologyResult'] = validateAction(projection, action);
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  /^the result carries a single vote event with vote value "([^"]+)"$/,
  function (this: AConversaWorld, expectedVote: string) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'vote');
    assert.equal(ev.sessionId, VL_SESSION_ID);
    assert.equal(ev.id, VL_NEW_EVENT_ID);
    if (ev.kind === 'vote' && ev.payload.target === 'proposal') {
      assert.equal(ev.payload.proposal_id, VL_PROPOSAL_ID);
      assert.equal(ev.payload.choice, expectedVote);
    }
  },
);

Then(
  'applying the resulting withdraw event to the projection makes the classification facet read "withdrawn"',
  function (this: AConversaWorld) {
    const projection = this.scratch['voteProjection'] as Projection;
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, 'expected Valid');
    if (!result.ok) return;
    const ev = result.events[0]!;
    // The validator returns an `EventToAppendEnvelope<'vote'>` which is
    // the same shape as a `vote` Event — apply it.
    if (ev.kind !== 'vote') {
      assert.fail(`expected vote event, got ${ev.kind}`);
      return;
    }
    applyEvent(projection, {
      id: ev.id,
      sessionId: ev.sessionId,
      sequence: ev.sequence,
      kind: 'vote',
      actor: ev.actor,
      payload: ev.payload,
      createdAt: ev.createdAt,
    });
    const status = deriveFacetStatus(projection, 'node', VL_NODE_ID, 'classification');
    assert.equal(
      status,
      'withdrawn',
      `expected classification facet to read 'withdrawn' after applying the withdraw event, got '${status}'`,
    );
  },
);
