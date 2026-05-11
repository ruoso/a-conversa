// Steps for tests/behavior/diagnostics/dangling-claim-detection.feature.
//
// The behavior-test layer for `detectDanglingClaims`. The Vitest tests
// at apps/server/src/diagnostics/dangling-claim-detection.test.ts cover
// the in-memory algorithm against TS-literal events; these scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the dangling-
// claim-detection path too.
//
// Refinement: tasks/refinements/data-and-methodology/dangling_claim_detection.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import { detectDanglingClaims } from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c4...`) so the scratch keys can't collide
// with cycle-detection (`c1...`), contradiction-detection (`c2...`),
// multi-warrant-detection (`c3...`), active-firing (`88...`), or any
// of the methodology / projection step files.
const DC_SESSION_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const DC_HOST_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const DC_DEBATER_A_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const DC_DEBATER_B_ID = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const DC_NODE_A = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee0a1';
const DC_NODE_B = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeee0b1';
const DC_EDGE_AB = 'c4eeeeee-eeee-4eee-8eee-eeeeeeeeab01';

const TS_BASE = '2026-05-11T12:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['dcNextSeq'] as number;
  world.scratch['dcNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: DC_HOST_ID, sub: 'fixture-dc:host', name: 'host' },
    { id: DC_DEBATER_A_ID, sub: 'fixture-dc:a', name: 'a' },
    { id: DC_DEBATER_B_ID, sub: 'fixture-dc:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [DC_SESSION_ID, DC_HOST_ID, 'public', 'Diagnostics dangling-claim-detection behavior tests'],
  );

  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(4001),
    sequence: 1,
    kind: 'session-created',
    actor: DC_HOST_ID,
    payload: {
      host_user_id: DC_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics dangling-claim-detection behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(4002),
    sequence: 2,
    kind: 'participant-joined',
    actor: DC_HOST_ID,
    payload: {
      user_id: DC_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(4003),
    sequence: 3,
    kind: 'participant-joined',
    actor: DC_DEBATER_A_ID,
    payload: {
      user_id: DC_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(4004),
    sequence: 4,
    kind: 'participant-joined',
    actor: DC_DEBATER_B_ID,
    payload: {
      user_id: DC_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['dcNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: DC_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: DC_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function createEdgeRow(
  world: AConversaWorld,
  edgeId: string,
  role: 'supports' | 'contradicts',
  source: string,
  target: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: DC_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role,
      source_node_id: source,
      target_node_id: target,
      created_by: DC_DEBATER_A_ID,
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
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: DC_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: DC_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for dangling-claim-detection tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given('nodes A and B for dangling-claim tests', async function (this: AConversaWorld) {
  await createNodeRow(this, DC_NODE_A, 'Node A.');
  await createNodeRow(this, DC_NODE_B, 'Node B.');
});

Given('an A->B contradicts edge for dangling-claim tests', async function (this: AConversaWorld) {
  await createEdgeRow(this, DC_EDGE_AB, 'contradicts', DC_NODE_A, DC_NODE_B);
});

Given('an A->B supports edge for dangling-claim tests', async function (this: AConversaWorld) {
  await createEdgeRow(this, DC_EDGE_AB, 'supports', DC_NODE_A, DC_NODE_B);
});

Given(
  'entity-included events for the dangling-claim nodes and edges',
  async function (this: AConversaWorld) {
    for (const nodeId of [DC_NODE_A, DC_NODE_B]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    await entityIncludedRow(this, 'edge', DC_EDGE_AB);
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the dangling-claim event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, DC_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, DC_SESSION_ID);
    this.scratch['dcProjection'] = projection;
  },
);

Then('detectDanglingClaims returns one entry naming B', function (this: AConversaWorld) {
  const projection = this.scratch['dcProjection'] as Projection;
  const result = detectDanglingClaims(projection);
  assert.equal(result.length, 1, `expected one dangling-claim entry, got ${result.length}`);
  const entry = result[0];
  assert.ok(entry, 'expected a dangling-claim entry');
  assert.equal(entry.nodeId, DC_NODE_B);
});

Then(
  'detectDanglingClaims returns no entries for dangling-claim tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['dcProjection'] as Projection;
    const result = detectDanglingClaims(projection);
    assert.deepEqual(result, []);
  },
);
