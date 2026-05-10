// Steps for tests/behavior/methodology/propose-edit-wording.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `edit-wording` arm (`apps/server/src/methodology/handlers/propose.ts`
// — the `validateEditWordingProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeEditWording.test.ts`
// cover the in-memory rule set. This file covers the DB-driven
// integration path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-edit-wording action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`). The shared `When 'the
// methodology engine validates the propose action against the projected
// session'` step is reused from `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/reword_vs_restructure.md

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
  type ProposeAction,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix (`c3...`) to avoid scratch-state collisions with
// the propose-decompose (`e0...`), propose-interpretive-split (`f0...`),
// propose-axiom-mark (`a1...`), and propose-meta-move (`b2...`) step
// files. All five share the same Cucumber World so the prefixes keep
// their SQL rows in separate sessions.
const PEW_SESSION_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PEW_HOST_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PEW_DEBATER_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PEW_DEBATER_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PEW_NODE_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PEW_NODE_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PEW_FRESH_NEW_NODE_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const PEW_NEW_EVENT_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee007';
const PEW_PENDING_DECOMPOSE_PROPOSAL_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee008';

const TS_BASE = '2026-05-10T23:30:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PEW_HOST_ID, sub: 'fixture-pew:host', name: 'host' },
    { id: PEW_DEBATER_A_ID, sub: 'fixture-pew:a', name: 'a' },
    { id: PEW_DEBATER_B_ID, sub: 'fixture-pew:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PEW_SESSION_ID, PEW_HOST_ID, 'public', 'Propose-edit-wording behavior tests'],
  );

  await insertEventRow(world, PEW_SESSION_ID, {
    id: evId(1201),
    sequence: 1,
    kind: 'session-created',
    actor: PEW_HOST_ID,
    payload: {
      host_user_id: PEW_HOST_ID,
      privacy: 'public',
      topic: 'Propose-edit-wording behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PEW_SESSION_ID, {
    id: evId(1202),
    sequence: 2,
    kind: 'participant-joined',
    actor: PEW_HOST_ID,
    payload: {
      user_id: PEW_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PEW_SESSION_ID, {
    id: evId(1203),
    sequence: 3,
    kind: 'participant-joined',
    actor: PEW_DEBATER_A_ID,
    payload: {
      user_id: PEW_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PEW_SESSION_ID, {
    id: evId(1204),
    sequence: 4,
    kind: 'participant-joined',
    actor: PEW_DEBATER_B_ID,
    payload: {
      user_id: PEW_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertCandidateNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PEW_SESSION_ID, {
    id: evId(1205),
    sequence: 5,
    kind: 'node-created',
    actor: PEW_DEBATER_A_ID,
    payload: {
      node_id: PEW_NODE_A_ID,
      wording: 'A candidate node wording for edit-wording tests.',
      created_by: PEW_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function insertSecondNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PEW_SESSION_ID, {
    id: evId(1206),
    sequence: 6,
    kind: 'node-created',
    actor: PEW_DEBATER_B_ID,
    payload: {
      node_id: PEW_NODE_B_ID,
      wording: 'A second candidate node that will be the collision target.',
      created_by: PEW_DEBATER_B_ID,
      created_at: tsAt(5),
    },
    createdAt: tsAt(5),
  });
}

async function insertPendingDecompose(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PEW_SESSION_ID, {
    id: PEW_PENDING_DECOMPOSE_PROPOSAL_ID,
    sequence: 6,
    kind: 'proposal',
    actor: PEW_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: PEW_NODE_A_ID,
        components: [
          { wording: 'A pending decompose component one.', classification: 'fact' },
          { wording: 'A pending decompose component two.', classification: 'value' },
        ],
      },
    },
    createdAt: tsAt(6),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PEW_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PEW_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate node for propose-edit-wording tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and two visible nodes for propose-edit-wording tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertSecondNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants, a visible node, and a pending decompose against that node for propose-edit-wording tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertPendingDecompose(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-reword action against the visible node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PEW_DEBATER_A_ID,
      sessionId: PEW_SESSION_ID,
      eventId: PEW_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PEW_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: PEW_NODE_A_ID,
        new_wording: 'A clearer phrasing of the same claim.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-restructure action against the visible node with a fresh new_node_id',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PEW_DEBATER_A_ID,
      sessionId: PEW_SESSION_ID,
      eventId: PEW_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PEW_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: PEW_NODE_A_ID,
        new_wording: 'A meaningfully different statement.',
        new_node_id: PEW_FRESH_NEW_NODE_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-restructure action whose new_node_id collides with an existing node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PEW_DEBATER_A_ID,
      sessionId: PEW_SESSION_ID,
      eventId: PEW_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PEW_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: PEW_NODE_A_ID,
        new_wording: 'A restructure whose new_node_id is already taken.',
        new_node_id: PEW_NODE_B_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

// The "validates the propose action against the projected session"
// When step is shared with the propose-decompose feature and lives in
// `methodology-propose-decompose.steps.ts`. Reused as-is.

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  'the result carries a single proposal event for the reword action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PEW_SESSION_ID);
    assert.equal(ev.id, PEW_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'edit-wording');
      if (inner.kind === 'edit-wording') {
        assert.equal(inner.edit_kind, 'reword');
        assert.equal(inner.node_id, PEW_NODE_A_ID);
        assert.equal(inner.new_wording, 'A clearer phrasing of the same claim.');
      }
    }
  },
);

Then(
  'the result carries a single proposal event for the restructure action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PEW_SESSION_ID);
    assert.equal(ev.id, PEW_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'edit-wording');
      if (inner.kind === 'edit-wording') {
        assert.equal(inner.edit_kind, 'restructure');
        assert.equal(inner.node_id, PEW_NODE_A_ID);
        if (inner.edit_kind === 'restructure') {
          assert.equal(inner.new_node_id, PEW_FRESH_NEW_NODE_ID);
        }
      }
    }
  },
);
