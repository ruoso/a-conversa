// Steps for tests/behavior/methodology/propose-break-edge.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `break-edge` arm (`apps/server/src/methodology/handlers/propose.ts`
// — the `validateBreakEdgeProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeBreakEdge.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-break-edge action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`). The shared `When 'the
// methodology engine validates the propose action against the projected
// session'` step is reused from `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/break_edge_logic.md

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

// Distinct UUID prefix (`b3...`) to avoid scratch-state collisions with
// the propose-decompose (`e0...`), propose-interpretive-split (`f0...`),
// propose-axiom-mark (`a1...`), and propose-meta-move (`b2...`) step
// files. All five share the same Cucumber World so the prefixes keep
// their SQL rows in separate sessions.
const PBE_SESSION_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PBE_HOST_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PBE_DEBATER_A_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PBE_DEBATER_B_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PBE_NODE_SRC_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PBE_NODE_TGT_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PBE_EDGE_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const PBE_UNKNOWN_EDGE_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee0aa';
const PBE_PRIOR_BREAK_PROPOSAL_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee0b1';
const PBE_NEW_EVENT_ID = 'b3eeeeee-eeee-4eee-8eee-eeeeeeeee007';

const TS_BASE = '2026-05-10T23:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PBE_HOST_ID, sub: 'fixture-pbe:host', name: 'host' },
    { id: PBE_DEBATER_A_ID, sub: 'fixture-pbe:a', name: 'a' },
    { id: PBE_DEBATER_B_ID, sub: 'fixture-pbe:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PBE_SESSION_ID, PBE_HOST_ID, 'public', 'Propose-break-edge behavior tests'],
  );

  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1201),
    sequence: 1,
    kind: 'session-created',
    actor: PBE_HOST_ID,
    payload: {
      host_user_id: PBE_HOST_ID,
      privacy: 'public',
      topic: 'Propose-break-edge behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1202),
    sequence: 2,
    kind: 'participant-joined',
    actor: PBE_HOST_ID,
    payload: {
      user_id: PBE_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1203),
    sequence: 3,
    kind: 'participant-joined',
    actor: PBE_DEBATER_A_ID,
    payload: {
      user_id: PBE_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1204),
    sequence: 4,
    kind: 'participant-joined',
    actor: PBE_DEBATER_B_ID,
    payload: {
      user_id: PBE_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertCandidateEdge(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1205),
    sequence: 5,
    kind: 'node-created',
    actor: PBE_DEBATER_B_ID,
    payload: {
      node_id: PBE_NODE_SRC_ID,
      wording: 'A source-node backing the edge.',
      created_by: PBE_DEBATER_B_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1206),
    sequence: 6,
    kind: 'node-created',
    actor: PBE_DEBATER_A_ID,
    payload: {
      node_id: PBE_NODE_TGT_ID,
      wording: 'A target-node the edge supports.',
      created_by: PBE_DEBATER_A_ID,
      created_at: tsAt(5),
    },
    createdAt: tsAt(5),
  });
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1207),
    sequence: 7,
    kind: 'edge-created',
    actor: PBE_DEBATER_B_ID,
    payload: {
      edge_id: PBE_EDGE_ID,
      role: 'supports',
      source_node_id: PBE_NODE_SRC_ID,
      target_node_id: PBE_NODE_TGT_ID,
      created_by: PBE_DEBATER_B_ID,
      created_at: tsAt(6),
    },
    createdAt: tsAt(6),
  });
}

// Append a prior break-edge proposal + commit pair against PBE_EDGE_ID.
// After replay the edge's `visible` flag will be `false`.
async function insertPriorBreakEdgeCommit(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PBE_SESSION_ID, {
    id: PBE_PRIOR_BREAK_PROPOSAL_ID,
    sequence: 8,
    kind: 'proposal',
    actor: PBE_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'break-edge',
        edge_id: PBE_EDGE_ID,
      },
    },
    createdAt: tsAt(7),
  });
  await insertEventRow(world, PBE_SESSION_ID, {
    id: evId(1209),
    sequence: 9,
    kind: 'commit',
    actor: PBE_HOST_ID,
    payload: {
      proposal_id: PBE_PRIOR_BREAK_PROPOSAL_ID,
      moderator: PBE_HOST_ID,
      committed_at: tsAt(8),
    },
    createdAt: tsAt(8),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PBE_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PBE_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate edge for propose-break-edge tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateEdge(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and no candidate edge for propose-break-edge tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // No edge-created event — the edge_id referenced in the propose
    // action will not resolve in the projection.
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a previously-broken edge for propose-break-edge tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateEdge(this);
    await insertPriorBreakEdgeCommit(this);
    const projection = await projectFromDb(this);
    // Sanity: the prior break-edge commit flipped the edge to invisible.
    assert.equal(projection.getEdge(PBE_EDGE_ID)?.visible, false);
    this.scratch['proposeProjection'] = projection;
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-break-edge action against the visible edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PBE_DEBATER_A_ID,
      sessionId: PBE_SESSION_ID,
      eventId: PBE_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PBE_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'break-edge',
        edge_id: PBE_EDGE_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-break-edge action against an unknown edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PBE_DEBATER_A_ID,
      sessionId: PBE_SESSION_ID,
      eventId: PBE_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PBE_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'break-edge',
        edge_id: PBE_UNKNOWN_EDGE_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-break-edge action against the broken edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PBE_DEBATER_A_ID,
      sessionId: PBE_SESSION_ID,
      eventId: PBE_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PBE_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'break-edge',
        edge_id: PBE_EDGE_ID,
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
  'the result carries a single proposal event for the break-edge action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PBE_SESSION_ID);
    assert.equal(ev.id, PBE_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'break-edge');
      if (inner.kind === 'break-edge') {
        assert.equal(inner.edge_id, PBE_EDGE_ID);
      }
    }
  },
);
