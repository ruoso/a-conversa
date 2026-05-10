// Steps for tests/behavior/methodology/propose-decompose.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `decompose` arm
// (`apps/server/src/methodology/handlers/propose.ts` — the
// `validateDecomposeProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeDecompose.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-decompose action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`).
//
// Refinement: tasks/refinements/data-and-methodology/decomposition_logic.md

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
  type ProposeAction,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the
// other methodology step files that share a Cucumber World.
const PD_SESSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PD_HOST_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PD_DEBATER_A_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PD_DEBATER_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PD_PARENT_NODE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PD_UNKNOWN_NODE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee0aa';
const PD_PRIOR_DECOMPOSE_PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PD_NEW_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee006';

const TS_BASE = '2026-05-10T20:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + the four lifecycle events (session-created,
// 3x participant-joined). Caller layers in additional events per
// scenario.
async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PD_HOST_ID, sub: 'fixture-pd:host', name: 'host' },
    { id: PD_DEBATER_A_ID, sub: 'fixture-pd:a', name: 'a' },
    { id: PD_DEBATER_B_ID, sub: 'fixture-pd:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PD_SESSION_ID, PD_HOST_ID, 'public', 'Propose-decompose behavior tests'],
  );

  await insertEventRow(world, PD_SESSION_ID, {
    id: evId(701),
    sequence: 1,
    kind: 'session-created',
    actor: PD_HOST_ID,
    payload: {
      host_user_id: PD_HOST_ID,
      privacy: 'public',
      topic: 'Propose-decompose behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PD_SESSION_ID, {
    id: evId(702),
    sequence: 2,
    kind: 'participant-joined',
    actor: PD_HOST_ID,
    payload: {
      user_id: PD_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PD_SESSION_ID, {
    id: evId(703),
    sequence: 3,
    kind: 'participant-joined',
    actor: PD_DEBATER_A_ID,
    payload: {
      user_id: PD_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PD_SESSION_ID, {
    id: evId(704),
    sequence: 4,
    kind: 'participant-joined',
    actor: PD_DEBATER_B_ID,
    payload: {
      user_id: PD_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertParentNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PD_SESSION_ID, {
    id: evId(705),
    sequence: 5,
    kind: 'node-created',
    actor: PD_DEBATER_A_ID,
    payload: {
      node_id: PD_PARENT_NODE_ID,
      wording: 'A candidate parent statement for decompose tests.',
      created_by: PD_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PD_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PD_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate-parent node for propose-decompose tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertParentNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and no candidate-parent node for propose-decompose tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // No node-created event — the parent_node_id referenced in the
    // propose action will not resolve in the projection.
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a previously-decomposed parent node for propose-decompose tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertParentNode(this);
    // A prior decompose proposal and its commit — the projection's
    // `applyCommittedProposal` decompose arm flips parent.visible=false
    // on commit. We hand-craft the events directly through pglite so
    // the read-side projection state matches what would happen after
    // a real decompose commit (commit_logic's structural-sub-kind
    // boundary would reject the commit if routed through the
    // methodology engine, but the projection's `applyEvent` path
    // doesn't re-validate methodology rules — same pattern the unit
    // test uses).
    await insertEventRow(this, PD_SESSION_ID, {
      id: PD_PRIOR_DECOMPOSE_PROPOSAL_ID,
      sequence: 6,
      kind: 'proposal',
      actor: PD_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: PD_PARENT_NODE_ID,
          components: [
            { wording: 'Prior component one.', classification: 'fact' },
            { wording: 'Prior component two.', classification: 'value' },
          ],
        },
      },
      createdAt: tsAt(5),
    });
    await insertEventRow(this, PD_SESSION_ID, {
      id: evId(707),
      sequence: 7,
      kind: 'commit',
      actor: PD_HOST_ID,
      payload: {
        proposal_id: PD_PRIOR_DECOMPOSE_PROPOSAL_ID,
        moderator: PD_HOST_ID,
        committed_at: tsAt(6),
      },
      createdAt: tsAt(6),
    });
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-decompose action against the visible parent',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PD_DEBATER_A_ID,
      sessionId: PD_SESSION_ID,
      eventId: PD_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PD_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'decompose',
        parent_node_id: PD_PARENT_NODE_ID,
        components: [
          { wording: 'Component one (fact).', classification: 'fact' },
          { wording: 'Component two (value).', classification: 'value' },
        ],
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-decompose action against an unknown parent',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PD_DEBATER_A_ID,
      sessionId: PD_SESSION_ID,
      eventId: PD_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PD_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'decompose',
        parent_node_id: PD_UNKNOWN_NODE_ID,
        components: [
          { wording: 'Component one.', classification: 'fact' },
          { wording: 'Component two.', classification: 'value' },
        ],
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-decompose action against the previously-decomposed parent',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PD_DEBATER_A_ID,
      sessionId: PD_SESSION_ID,
      eventId: PD_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PD_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'decompose',
        parent_node_id: PD_PARENT_NODE_ID,
        components: [
          { wording: 'Retry component one.', classification: 'fact' },
          { wording: 'Retry component two.', classification: 'value' },
        ],
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'the methodology engine validates the propose action against the projected session',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action = this.scratch['proposeAction'] as ProposeAction;
    this.scratch['methodologyResult'] = validateAction(projection, action);
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  'the result carries a single proposal event for the decompose action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PD_SESSION_ID);
    assert.equal(ev.id, PD_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'decompose');
      if (inner.kind === 'decompose') {
        assert.equal(inner.parent_node_id, PD_PARENT_NODE_ID);
        assert.equal(inner.components.length, 2);
      }
    }
  },
);
