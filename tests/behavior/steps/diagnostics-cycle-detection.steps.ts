// Steps for tests/behavior/diagnostics/cycle-detection.feature.
//
// The behavior-test layer for `detectSupportsCycles`. The Vitest tests
// at apps/server/src/diagnostics/cycle-detection.test.ts cover the
// in-memory algorithm against TS-literal events; these scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the cycle-
// detection path too.
//
// Refinement: tasks/refinements/data-and-methodology/cycle_detection.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import { detectSupportsCycles } from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c1...`) so the scratch keys can't collide
// with the active-firing (`88...`), facet-status / from-log /
// incremental / methodology (`b3...`, `e0...`, etc.) step files.
const CD_SESSION_ID = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const CD_HOST_ID = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const CD_DEBATER_A_ID = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const CD_DEBATER_B_ID = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const CD_NODE_A = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeea01';
const CD_NODE_B = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeea02';
const CD_NODE_C = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeea03';
const CD_EDGE_AB = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeeb12';
const CD_EDGE_BC = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeeb23';
const CD_EDGE_CA = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeeb31';

// Substance / break proposal ids: stable per cycle node / edge.
const CD_PROP_NODE_A_SUBST = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeec01';
const CD_PROP_NODE_B_SUBST = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeec02';
const CD_PROP_NODE_C_SUBST = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeec03';
const CD_PROP_EDGE_AB_SUBST = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeed12';
const CD_PROP_EDGE_BC_SUBST = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeed23';
const CD_PROP_EDGE_CA_SUBST = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeed31';
const CD_PROP_BREAK_CA = 'c1eeeeee-eeee-4eee-8eee-eeeeeeeeee31';

const TS_BASE = '2026-05-10T16:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['cdNextSeq'] as number;
  world.scratch['cdNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CD_HOST_ID, sub: 'fixture-cd:host', name: 'host' },
    { id: CD_DEBATER_A_ID, sub: 'fixture-cd:a', name: 'a' },
    { id: CD_DEBATER_B_ID, sub: 'fixture-cd:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CD_SESSION_ID, CD_HOST_ID, 'public', 'Diagnostics cycle-detection behavior tests'],
  );

  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(2001),
    sequence: 1,
    kind: 'session-created',
    actor: CD_HOST_ID,
    payload: {
      host_user_id: CD_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics cycle-detection behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(2002),
    sequence: 2,
    kind: 'participant-joined',
    actor: CD_HOST_ID,
    payload: {
      user_id: CD_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(2003),
    sequence: 3,
    kind: 'participant-joined',
    actor: CD_DEBATER_A_ID,
    payload: {
      user_id: CD_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(2004),
    sequence: 4,
    kind: 'participant-joined',
    actor: CD_DEBATER_B_ID,
    payload: {
      user_id: CD_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['cdNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: CD_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: CD_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function createEdgeRow(
  world: AConversaWorld,
  edgeId: string,
  source: string,
  target: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: CD_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role: 'supports',
      source_node_id: source,
      target_node_id: target,
      created_by: CD_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function entityIncludedRow(
  world: AConversaWorld,
  entityKind: 'node' | 'edge',
  entityId: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: CD_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: CD_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// Emit proposal + 3 agree votes + commit. The proposalId is supplied
// by the caller so each cycle facet has a stable, distinct id.
async function emitProposalVotesCommit(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, CD_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: CD_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [CD_HOST_ID, CD_DEBATER_A_ID, CD_DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, CD_SESSION_ID, {
      id: evId(seq * 1000 + 4),
      sequence: seq,
      kind: 'vote',
      actor: voter,
      payload: {
        target: 'proposal' as const,
        proposal_id: proposalId,
        participant: voter,
        choice: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  }
  seq = nextSeq(world);
  await insertEventRow(world, CD_SESSION_ID, {
    id: evId(seq * 1000 + 5),
    sequence: seq,
    kind: 'commit',
    actor: CD_HOST_ID,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: CD_HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for cycle-detection tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'three nodes A, B, C plus three supports edges A->B, B->C, C->A for cycle-detection tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CD_NODE_A, 'Statement A.');
    await createNodeRow(this, CD_NODE_B, 'Statement B.');
    await createNodeRow(this, CD_NODE_C, 'Statement C.');
    await createEdgeRow(this, CD_EDGE_AB, CD_NODE_A, CD_NODE_B);
    await createEdgeRow(this, CD_EDGE_BC, CD_NODE_B, CD_NODE_C);
    await createEdgeRow(this, CD_EDGE_CA, CD_NODE_C, CD_NODE_A);
  },
);

Given(
  'three nodes A, B, C plus two supports edges A->B, B->C for cycle-detection tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CD_NODE_A, 'Statement A.');
    await createNodeRow(this, CD_NODE_B, 'Statement B.');
    await createNodeRow(this, CD_NODE_C, 'Statement C.');
    await createEdgeRow(this, CD_EDGE_AB, CD_NODE_A, CD_NODE_B);
    await createEdgeRow(this, CD_EDGE_BC, CD_NODE_B, CD_NODE_C);
  },
);

Given(
  'entity-included events for the three nodes and three edges for cycle-detection tests',
  async function (this: AConversaWorld) {
    for (const nodeId of [CD_NODE_A, CD_NODE_B, CD_NODE_C]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [CD_EDGE_AB, CD_EDGE_BC, CD_EDGE_CA]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

Given(
  'entity-included events for the three nodes and two edges for cycle-detection tests',
  async function (this: AConversaWorld) {
    for (const nodeId of [CD_NODE_A, CD_NODE_B, CD_NODE_C]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [CD_EDGE_AB, CD_EDGE_BC]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

Given(
  'the substance of each cycle node is committed agreed for cycle-detection tests',
  async function (this: AConversaWorld) {
    for (const [proposalId, nodeId] of [
      [CD_PROP_NODE_A_SUBST, CD_NODE_A],
      [CD_PROP_NODE_B_SUBST, CD_NODE_B],
      [CD_PROP_NODE_C_SUBST, CD_NODE_C],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-node-substance',
        node_id: nodeId,
        value: 'agreed',
      });
    }
  },
);

Given(
  'the substance of each cycle edge is committed agreed for cycle-detection tests',
  async function (this: AConversaWorld) {
    for (const [proposalId, edgeId] of [
      [CD_PROP_EDGE_AB_SUBST, CD_EDGE_AB],
      [CD_PROP_EDGE_BC_SUBST, CD_EDGE_BC],
      [CD_PROP_EDGE_CA_SUBST, CD_EDGE_CA],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-edge-substance',
        edge_id: edgeId,
        value: 'agreed',
      });
    }
  },
);

Given(
  'the substance of each chain edge is committed agreed for cycle-detection tests',
  async function (this: AConversaWorld) {
    for (const [proposalId, edgeId] of [
      [CD_PROP_EDGE_AB_SUBST, CD_EDGE_AB],
      [CD_PROP_EDGE_BC_SUBST, CD_EDGE_BC],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-edge-substance',
        edge_id: edgeId,
        value: 'agreed',
      });
    }
  },
);

Given(
  'a break-edge proposal against the C->A edge is committed by all for cycle-detection tests',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, CD_PROP_BREAK_CA, {
      kind: 'break-edge',
      edge_id: CD_EDGE_CA,
    });
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the cycle-detection event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, CD_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, CD_SESSION_ID);
    this.scratch['cdProjection'] = projection;
  },
);

Then(
  'detectSupportsCycles returns one cycle containing all three cycle-detection nodes',
  function (this: AConversaWorld) {
    const projection = this.scratch['cdProjection'] as Projection;
    const cycles = detectSupportsCycles(projection);
    assert.equal(cycles.length, 1, `expected one cycle, got ${cycles.length}`);
    const cycle = cycles[0];
    assert.ok(cycle, 'expected a cycle entry');
    assert.equal(cycle.nodes.length, 3);
    const cycleSet = new Set(cycle.nodes);
    assert.ok(cycleSet.has(CD_NODE_A));
    assert.ok(cycleSet.has(CD_NODE_B));
    assert.ok(cycleSet.has(CD_NODE_C));
  },
);

Then(
  'detectSupportsCycles returns no cycles for cycle-detection tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['cdProjection'] as Projection;
    const cycles = detectSupportsCycles(projection);
    assert.deepEqual(cycles, []);
  },
);
