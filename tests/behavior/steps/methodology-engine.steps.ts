// Steps for tests/behavior/methodology/engine.feature.
//
// The behavior-test layer for the methodology engine's `validateAction`
// dispatcher. The Vitest tests at
// `apps/server/src/methodology/engine.test.ts` cover the in-memory
// universal checks and the per-action placeholder handlers. This
// scenario covers the DB-driven integration path: round-trip the
// session's events through pglite's `session_events`, replay through
// `projectFromLog`, then call `validateAction` against the resulting
// projection.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md

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
  type ValidationResult,
  type VoteAction,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the
// projection step files that share a Cucumber World.
const ME_SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0';
const ME_HOST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ME_DEBATER_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ME_DEBATER_B_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

const ME_NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const ME_PROPOSAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const ME_NEW_EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';

const TS_BASE = '2026-05-10T15:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants and a pending proposal for methodology-engine tests',
  async function (this: AConversaWorld) {
    // Users + session FK prereqs.
    for (const u of [
      { id: ME_HOST_ID, sub: 'fixture-me:host', name: 'host' },
      { id: ME_DEBATER_A_ID, sub: 'fixture-me:a', name: 'a' },
      { id: ME_DEBATER_B_ID, sub: 'fixture-me:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [ME_SESSION_ID, ME_HOST_ID, 'public', 'Methodology engine behavior tests'],
    );

    // session-created + three participant-joined.
    await insertEventRow(this, ME_SESSION_ID, {
      id: evId(201),
      sequence: 1,
      kind: 'session-created',
      actor: ME_HOST_ID,
      payload: {
        host_user_id: ME_HOST_ID,
        privacy: 'public',
        topic: 'Methodology engine behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, ME_SESSION_ID, {
      id: evId(202),
      sequence: 2,
      kind: 'participant-joined',
      actor: ME_HOST_ID,
      payload: {
        user_id: ME_HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, ME_SESSION_ID, {
      id: evId(203),
      sequence: 3,
      kind: 'participant-joined',
      actor: ME_DEBATER_A_ID,
      payload: {
        user_id: ME_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, ME_SESSION_ID, {
      id: evId(204),
      sequence: 4,
      kind: 'participant-joined',
      actor: ME_DEBATER_B_ID,
      payload: {
        user_id: ME_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    // node-created + classify-node proposal so there is a live pending
    // proposal for the vote action to reference.
    await insertEventRow(this, ME_SESSION_ID, {
      id: evId(205),
      sequence: 5,
      kind: 'node-created',
      actor: ME_DEBATER_A_ID,
      payload: {
        node_id: ME_NODE_ID,
        wording: 'A proposition for methodology-engine tests.',
        created_by: ME_DEBATER_A_ID,
        created_at: tsAt(4),
      },
      createdAt: tsAt(4),
    });
    await insertEventRow(this, ME_SESSION_ID, {
      id: ME_PROPOSAL_ID,
      sequence: 6,
      kind: 'proposal',
      actor: ME_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'classify-node',
          node_id: ME_NODE_ID,
          classification: 'fact',
        },
      },
      createdAt: tsAt(5),
    });

    // Replay the events into a fresh projection.
    const rows = await selectEvents(this, ME_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    this.scratch['methodologyProjection'] = projectFromLog(events, ME_SESSION_ID);
  },
);

When(
  'the participant constructs a vote-agree action against the pending proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['methodologyProjection'] as Projection;
    // Seeded proposal is `classify-node` — facet-keyed vote per
    // ADR 0030 §2.
    const action: VoteAction = {
      kind: 'vote',
      target: 'facet',
      requester: ME_DEBATER_A_ID,
      sessionId: ME_SESSION_ID,
      eventId: ME_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: ME_DEBATER_A_ID,
      createdAt: tsAt(6),
      entityKind: 'node',
      entityId: ME_NODE_ID,
      facet: 'classification',
      vote: 'agree',
      votedAt: tsAt(6),
    };
    this.scratch['methodologyAction'] = action;
  },
);

When(
  'the methodology engine validates the action against the projected session',
  function (this: AConversaWorld) {
    const projection = this.scratch['methodologyProjection'] as Projection;
    const action = this.scratch['methodologyAction'] as VoteAction;
    this.scratch['methodologyResult'] = validateAction(projection, action);
  },
);

Then('the validation result is Valid', function (this: AConversaWorld) {
  const result = this.scratch['methodologyResult'] as ValidationResult;
  assert.equal(result.ok, true, `expected Valid, got Rejected: ${JSON.stringify(result)}`);
});

Then(
  'the result carries a single vote event for the pending proposal',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, 'expected Valid');
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'vote');
    assert.equal(ev.sessionId, ME_SESSION_ID);
    assert.equal(ev.id, ME_NEW_EVENT_ID);
    if (ev.kind === 'vote' && ev.payload.target === 'proposal') {
      assert.equal(ev.payload.proposal_id, ME_PROPOSAL_ID);
      assert.equal(ev.payload.participant, ME_DEBATER_A_ID);
      assert.equal(ev.payload.choice, 'agree');
    }
  },
);
