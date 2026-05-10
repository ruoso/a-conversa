// Steps for tests/behavior/methodology/propose-amend-node.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `amend-node` arm (`apps/server/src/methodology/handlers/propose.ts`
// — the `validateAmendNodeProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeAmendNode.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-amend-node action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts`. The
// shared `When 'the methodology engine validates the propose action
// against the projected session'` step is reused from
// `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/amend_node_logic.md

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

// Distinct UUID prefix (`c4...`) to avoid scratch-state collisions with
// the propose-decompose (`e0...`), propose-interpretive-split (`f0...`),
// propose-axiom-mark (`a1...`), propose-meta-move (`b2...`), and
// propose-break-edge (`b3...`) step files. All share the same Cucumber
// World so the prefixes keep their SQL rows in separate sessions.
const PAN_SESSION_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PAN_HOST_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PAN_DEBATER_A_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PAN_DEBATER_B_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PAN_NODE_A_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PAN_NODE_B_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PAN_CONTRADICTS_EDGE_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const PAN_UNKNOWN_NODE_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee0aa';
const PAN_SUBSTANCE_PROPOSAL_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee0b1';
const PAN_PENDING_DECOMPOSE_PROPOSAL_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee0b2';
const PAN_NEW_EVENT_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee007';

const TS_BASE = '2026-05-10T22:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PAN_HOST_ID, sub: 'fixture-pan:host', name: 'host' },
    { id: PAN_DEBATER_A_ID, sub: 'fixture-pan:a', name: 'a' },
    { id: PAN_DEBATER_B_ID, sub: 'fixture-pan:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PAN_SESSION_ID, PAN_HOST_ID, 'public', 'Propose-amend-node behavior tests'],
  );

  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1301),
    sequence: 1,
    kind: 'session-created',
    actor: PAN_HOST_ID,
    payload: {
      host_user_id: PAN_HOST_ID,
      privacy: 'public',
      topic: 'Propose-amend-node behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1302),
    sequence: 2,
    kind: 'participant-joined',
    actor: PAN_HOST_ID,
    payload: {
      user_id: PAN_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1303),
    sequence: 3,
    kind: 'participant-joined',
    actor: PAN_DEBATER_A_ID,
    payload: {
      user_id: PAN_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1304),
    sequence: 4,
    kind: 'participant-joined',
    actor: PAN_DEBATER_B_ID,
    payload: {
      user_id: PAN_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

// Insert two nodes (A and B) and a `contradicts` edge from A to B.
// Sequence numbers 5-7. Edge substance facet starts `proposed`.
async function insertContradictionPair(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1305),
    sequence: 5,
    kind: 'node-created',
    actor: PAN_DEBATER_A_ID,
    payload: {
      node_id: PAN_NODE_A_ID,
      wording: 'Anna says zoos do more good than harm.',
      created_by: PAN_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1306),
    sequence: 6,
    kind: 'node-created',
    actor: PAN_DEBATER_B_ID,
    payload: {
      node_id: PAN_NODE_B_ID,
      wording: 'Ben says zoos do more harm than good.',
      created_by: PAN_DEBATER_B_ID,
      created_at: tsAt(5),
    },
    createdAt: tsAt(5),
  });
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1307),
    sequence: 7,
    kind: 'edge-created',
    actor: PAN_DEBATER_A_ID,
    payload: {
      edge_id: PAN_CONTRADICTS_EDGE_ID,
      role: 'contradicts',
      source_node_id: PAN_NODE_A_ID,
      target_node_id: PAN_NODE_B_ID,
      created_by: PAN_DEBATER_A_ID,
      created_at: tsAt(6),
    },
    createdAt: tsAt(6),
  });
}

// Land a `set-edge-substance` proposal + commit on the contradicts
// edge, moving its substance facet to `agreed`. Sequence numbers 8-9.
async function commitContradictsSubstance(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PAN_SESSION_ID, {
    id: PAN_SUBSTANCE_PROPOSAL_ID,
    sequence: 8,
    kind: 'proposal',
    actor: PAN_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'set-edge-substance',
        edge_id: PAN_CONTRADICTS_EDGE_ID,
        value: 'agreed',
      },
    },
    createdAt: tsAt(7),
  });
  await insertEventRow(world, PAN_SESSION_ID, {
    id: evId(1309),
    sequence: 9,
    kind: 'commit',
    actor: PAN_HOST_ID,
    payload: {
      proposal_id: PAN_SUBSTANCE_PROPOSAL_ID,
      moderator: PAN_HOST_ID,
      committed_at: tsAt(8),
    },
    createdAt: tsAt(8),
  });
}

// Land a pending decompose proposal against NODE_A. Sequence 10.
async function insertPendingDecompose(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PAN_SESSION_ID, {
    id: PAN_PENDING_DECOMPOSE_PROPOSAL_ID,
    sequence: 10,
    kind: 'proposal',
    actor: PAN_DEBATER_B_ID,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: PAN_NODE_A_ID,
        components: [
          { wording: 'Component one of NODE_A.', classification: 'fact' },
          { wording: 'Component two of NODE_A.', classification: 'value' },
        ],
      },
    },
    createdAt: tsAt(9),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PAN_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PAN_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a node party to an agreed contradicts edge for propose-amend-node tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertContradictionPair(this);
    await commitContradictsSubstance(this);
    const projection = await projectFromDb(this);
    // Sanity: the contradicts edge's substance facet is now `agreed`.
    assert.equal(projection.getEdge(PAN_CONTRADICTS_EDGE_ID)?.substanceFacet.status, 'agreed');
    this.scratch['proposeProjection'] = projection;
  },
);

Given(
  'a seeded session with three participants and no candidate node for propose-amend-node tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // No node-created event — the node_id referenced in the propose
    // action will not resolve in the projection.
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants, a node party to an agreed contradicts edge, and a pending decompose against that node for propose-amend-node tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertContradictionPair(this);
    await commitContradictsSubstance(this);
    await insertPendingDecompose(this);
    const projection = await projectFromDb(this);
    // Sanity: the contradicts edge is `agreed` AND a decompose is pending.
    assert.equal(projection.getEdge(PAN_CONTRADICTS_EDGE_ID)?.substanceFacet.status, 'agreed');
    assert.ok(projection.getPendingProposal(PAN_PENDING_DECOMPOSE_PROPOSAL_ID));
    this.scratch['proposeProjection'] = projection;
  },
);

Given(
  'a seeded session with three participants and a visible node with no contradicts edge for propose-amend-node tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // Add only NODE_A — no NODE_B, no contradicts edge. Rule 4
    // rejects on this projection.
    await insertEventRow(this, PAN_SESSION_ID, {
      id: evId(1305),
      sequence: 5,
      kind: 'node-created',
      actor: PAN_DEBATER_A_ID,
      payload: {
        node_id: PAN_NODE_A_ID,
        wording: 'A statement with no contradiction yet.',
        created_by: PAN_DEBATER_A_ID,
        created_at: tsAt(4),
      },
      createdAt: tsAt(4),
    });
    const projection = await projectFromDb(this);
    assert.equal(projection.getNode(PAN_NODE_A_ID)?.visible, true);
    this.scratch['proposeProjection'] = projection;
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-amend-node action against the contradicting node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PAN_DEBATER_A_ID,
      sessionId: PAN_SESSION_ID,
      eventId: PAN_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PAN_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'amend-node',
        node_id: PAN_NODE_A_ID,
        new_content: 'Anna refines the claim to remove the conflict.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-amend-node action against an unknown node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PAN_DEBATER_A_ID,
      sessionId: PAN_SESSION_ID,
      eventId: PAN_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PAN_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'amend-node',
        node_id: PAN_UNKNOWN_NODE_ID,
        new_content: 'A would-be amendment of a non-existent node.',
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
  'the result carries a single proposal event for the amend-node action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PAN_SESSION_ID);
    assert.equal(ev.id, PAN_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'amend-node');
      if (inner.kind === 'amend-node') {
        assert.equal(inner.node_id, PAN_NODE_A_ID);
        assert.equal(inner.new_content, 'Anna refines the claim to remove the conflict.');
      }
    }
  },
);
