// Steps for tests/behavior/methodology/mark-meta-disagreement.feature.
//
// The behavior-test layer for the methodology engine's
// mark-meta-disagreement handler
// (`apps/server/src/methodology/handlers/markMetaDisagreement.ts`).
// The Vitest tests at
// `apps/server/src/methodology/handlers/markMetaDisagreement.test.ts`
// cover the in-memory rule set. This file covers the DB-driven
// integration path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a mark-meta-disagreement action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`).
//
// Refinement: tasks/refinements/data-and-methodology/meta_disagreement_logic.md

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
  type MarkMetaDisagreementAction,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the
// other methodology step files that share a Cucumber World.
const ML_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd000';
const ML_HOST_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
const ML_DEBATER_A_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002';
const ML_DEBATER_B_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003';

const ML_NODE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd004';
const ML_PROPOSAL_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd005';
const ML_NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd006';

const TS_BASE = '2026-05-10T18:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + the six lifecycle events (session-created,
// 3x participant-joined, node-created, proposal). Caller layers in any
// votes / commits per scenario.
async function seedBaseSession(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: ML_HOST_ID, sub: 'fixture-ml:host', name: 'host' },
    { id: ML_DEBATER_A_ID, sub: 'fixture-ml:a', name: 'a' },
    { id: ML_DEBATER_B_ID, sub: 'fixture-ml:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [ML_SESSION_ID, ML_HOST_ID, 'public', 'Meta-disagreement-logic behavior tests'],
  );

  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(501),
    sequence: 1,
    kind: 'session-created',
    actor: ML_HOST_ID,
    payload: {
      host_user_id: ML_HOST_ID,
      privacy: 'public',
      topic: 'Meta-disagreement-logic behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(502),
    sequence: 2,
    kind: 'participant-joined',
    actor: ML_HOST_ID,
    payload: {
      user_id: ML_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(503),
    sequence: 3,
    kind: 'participant-joined',
    actor: ML_DEBATER_A_ID,
    payload: {
      user_id: ML_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(504),
    sequence: 4,
    kind: 'participant-joined',
    actor: ML_DEBATER_B_ID,
    payload: {
      user_id: ML_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(505),
    sequence: 5,
    kind: 'node-created',
    actor: ML_DEBATER_A_ID,
    payload: {
      node_id: ML_NODE_ID,
      wording: 'A proposition for meta-disagreement-logic tests.',
      created_by: ML_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, ML_SESSION_ID, {
    id: ML_PROPOSAL_ID,
    sequence: 6,
    kind: 'proposal',
    actor: ML_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: ML_NODE_ID,
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
  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(eventOrdinal),
    sequence,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: ML_PROPOSAL_ID,
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
  await insertEventRow(world, ML_SESSION_ID, {
    id: evId(eventOrdinal),
    sequence,
    kind: 'commit',
    actor: moderator,
    payload: {
      target: 'proposal',
      proposal_id: ML_PROPOSAL_ID,
      committed_by: moderator,
      committed_at: tsAt(tsOffset),
    },
    createdAt: tsAt(tsOffset),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, ML_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, ML_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants, a pending proposal, and one dispute vote for meta-disagreement-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    // One participant disputes — enough to satisfy rule 4 (Option A).
    await insertVote(this, 511, 7, ML_DEBATER_B_ID, 'dispute', 6);
    this.scratch['markProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session committed on a classify-node proposal for meta-disagreement-logic tests',
  async function (this: AConversaWorld) {
    await seedBaseSession(this);
    await insertVote(this, 511, 7, ML_HOST_ID, 'agree', 6);
    await insertVote(this, 512, 8, ML_DEBATER_A_ID, 'agree', 7);
    await insertVote(this, 513, 9, ML_DEBATER_B_ID, 'agree', 8);
    await insertCommit(this, 514, 10, ML_HOST_ID, 9);
    this.scratch['markProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'the moderator constructs a mark-meta-disagreement action against the pending proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['markProjection'] as Projection;
    const action: MarkMetaDisagreementAction = {
      kind: 'mark-meta-disagreement',
      requester: ML_HOST_ID,
      sessionId: ML_SESSION_ID,
      eventId: ML_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: ML_HOST_ID,
      createdAt: tsAt(20),
      proposalEventId: ML_PROPOSAL_ID,
      markedAt: tsAt(20),
    };
    this.scratch['markAction'] = action;
  },
);

When(
  'a debater constructs a mark-meta-disagreement action against the pending proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['markProjection'] as Projection;
    const action: MarkMetaDisagreementAction = {
      kind: 'mark-meta-disagreement',
      requester: ML_DEBATER_A_ID,
      sessionId: ML_SESSION_ID,
      eventId: ML_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: ML_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposalEventId: ML_PROPOSAL_ID,
      markedAt: tsAt(20),
    };
    this.scratch['markAction'] = action;
  },
);

When(
  'the moderator constructs a mark-meta-disagreement action against the committed proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['markProjection'] as Projection;
    const action: MarkMetaDisagreementAction = {
      kind: 'mark-meta-disagreement',
      requester: ML_HOST_ID,
      sessionId: ML_SESSION_ID,
      eventId: ML_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: ML_HOST_ID,
      createdAt: tsAt(20),
      proposalEventId: ML_PROPOSAL_ID,
      markedAt: tsAt(20),
    };
    this.scratch['markAction'] = action;
  },
);

When(
  'the methodology engine validates the mark-meta-disagreement action against the projected session',
  function (this: AConversaWorld) {
    const projection = this.scratch['markProjection'] as Projection;
    const action = this.scratch['markAction'] as MarkMetaDisagreementAction;
    this.scratch['methodologyResult'] = validateAction(projection, action);
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  'the result carries a single meta-disagreement-marked event for the pending proposal',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'meta-disagreement-marked');
    assert.equal(ev.sessionId, ML_SESSION_ID);
    assert.equal(ev.id, ML_NEW_EVENT_ID);
    if (ev.kind === 'meta-disagreement-marked') {
      assert.equal(ev.payload.proposal_id, ML_PROPOSAL_ID);
      assert.equal(ev.payload.moderator, ML_HOST_ID);
      assert.equal(ev.payload.marked_at, tsAt(20));
    }
  },
);
