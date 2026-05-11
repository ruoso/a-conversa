// Steps for tests/behavior/diagnostics/multi-warrant-detection.feature.
//
// The behavior-test layer for `detectMultiWarrants`. The Vitest tests
// at apps/server/src/diagnostics/multi-warrant-detection.test.ts cover
// the in-memory algorithm against TS-literal events; these scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the multi-
// warrant-detection path too.
//
// Refinement: tasks/refinements/data-and-methodology/multi_warrant_detection.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import { detectMultiWarrants } from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c3...`) so the scratch keys can't collide
// with the cycle-detection (`c1...`), contradiction-detection (`c2...`),
// active-firing (`88...`), facet-status / from-log / incremental /
// methodology (`b3...`, `e0...`, etc.) step files.
const MW_SESSION_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const MW_HOST_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const MW_DEBATER_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const MW_DEBATER_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee003';

// Pick lexicographic order so the W1 < W2 sort assertion lines up.
const MW_NODE_D = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeeed01';
const MW_NODE_C = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeeec01';
const MW_NODE_W1 = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeeef01';
const MW_NODE_W2 = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeeef02';

const MW_EDGE_W1_FROM_D = 'c3eeeeee-eeee-4eee-8eee-eeeeeeee1fd1';
const MW_EDGE_W1_TO_C = 'c3eeeeee-eeee-4eee-8eee-eeeeeeee1ac1';
const MW_EDGE_W2_FROM_D = 'c3eeeeee-eeee-4eee-8eee-eeeeeeee2fd1';
const MW_EDGE_W2_TO_C = 'c3eeeeee-eeee-4eee-8eee-eeeeeeee2ac1';

const TS_BASE = '2026-05-10T18:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['mwNextSeq'] as number;
  world.scratch['mwNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: MW_HOST_ID, sub: 'fixture-mw:host', name: 'host' },
    { id: MW_DEBATER_A_ID, sub: 'fixture-mw:a', name: 'a' },
    { id: MW_DEBATER_B_ID, sub: 'fixture-mw:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [MW_SESSION_ID, MW_HOST_ID, 'public', 'Diagnostics multi-warrant-detection behavior tests'],
  );

  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(4001),
    sequence: 1,
    kind: 'session-created',
    actor: MW_HOST_ID,
    payload: {
      host_user_id: MW_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics multi-warrant-detection behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(4002),
    sequence: 2,
    kind: 'participant-joined',
    actor: MW_HOST_ID,
    payload: {
      user_id: MW_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(4003),
    sequence: 3,
    kind: 'participant-joined',
    actor: MW_DEBATER_A_ID,
    payload: {
      user_id: MW_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(4004),
    sequence: 4,
    kind: 'participant-joined',
    actor: MW_DEBATER_B_ID,
    payload: {
      user_id: MW_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['mwNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: MW_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: MW_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function createEdgeRow(
  world: AConversaWorld,
  edgeId: string,
  role: 'bridges-from' | 'bridges-to',
  source: string,
  target: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: MW_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role,
      source_node_id: source,
      target_node_id: target,
      created_by: MW_DEBATER_A_ID,
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
  await insertEventRow(world, MW_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: MW_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: MW_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for multi-warrant-detection tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'data node D, claim node C, and warrant nodes W1, W2 for multi-warrant tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, MW_NODE_D, 'Data D.');
    await createNodeRow(this, MW_NODE_C, 'Claim C.');
    await createNodeRow(this, MW_NODE_W1, 'Warrant W1.');
    await createNodeRow(this, MW_NODE_W2, 'Warrant W2.');
  },
);

Given(
  'data node D, claim node C, and warrant node W1 only for multi-warrant tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, MW_NODE_D, 'Data D.');
    await createNodeRow(this, MW_NODE_C, 'Claim C.');
    await createNodeRow(this, MW_NODE_W1, 'Warrant W1.');
  },
);

Given(
  'four bridge edges wiring W1 and W2 to D and C for multi-warrant tests',
  async function (this: AConversaWorld) {
    await createEdgeRow(this, MW_EDGE_W1_FROM_D, 'bridges-from', MW_NODE_W1, MW_NODE_D);
    await createEdgeRow(this, MW_EDGE_W1_TO_C, 'bridges-to', MW_NODE_W1, MW_NODE_C);
    await createEdgeRow(this, MW_EDGE_W2_FROM_D, 'bridges-from', MW_NODE_W2, MW_NODE_D);
    await createEdgeRow(this, MW_EDGE_W2_TO_C, 'bridges-to', MW_NODE_W2, MW_NODE_C);
  },
);

Given(
  'two bridge edges wiring W1 to D and C for multi-warrant tests',
  async function (this: AConversaWorld) {
    await createEdgeRow(this, MW_EDGE_W1_FROM_D, 'bridges-from', MW_NODE_W1, MW_NODE_D);
    await createEdgeRow(this, MW_EDGE_W1_TO_C, 'bridges-to', MW_NODE_W1, MW_NODE_C);
  },
);

Given(
  'entity-included events for the multi-warrant nodes and edges',
  async function (this: AConversaWorld) {
    for (const nodeId of [MW_NODE_D, MW_NODE_C, MW_NODE_W1, MW_NODE_W2]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [MW_EDGE_W1_FROM_D, MW_EDGE_W1_TO_C, MW_EDGE_W2_FROM_D, MW_EDGE_W2_TO_C]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

Given(
  'entity-included events for the multi-warrant single-warrant nodes and edges',
  async function (this: AConversaWorld) {
    for (const nodeId of [MW_NODE_D, MW_NODE_C, MW_NODE_W1]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [MW_EDGE_W1_FROM_D, MW_EDGE_W1_TO_C]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the multi-warrant event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, MW_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, MW_SESSION_ID);
    this.scratch['mwProjection'] = projection;
  },
);

Then(
  'detectMultiWarrants returns one entry naming D, C, and warrants W1 and W2',
  function (this: AConversaWorld) {
    const projection = this.scratch['mwProjection'] as Projection;
    const result = detectMultiWarrants(projection);
    assert.equal(result.length, 1, `expected one multi-warrant entry, got ${result.length}`);
    const entry = result[0];
    assert.ok(entry, 'expected a multi-warrant entry');
    assert.equal(entry.dataNodeId, MW_NODE_D);
    assert.equal(entry.claimNodeId, MW_NODE_C);
    // Sorted lexicographically. MW_NODE_W1 < MW_NODE_W2.
    assert.deepEqual(entry.warrantNodeIds, [MW_NODE_W1, MW_NODE_W2]);
  },
);

Then(
  'detectMultiWarrants returns no entries for multi-warrant tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['mwProjection'] as Projection;
    const result = detectMultiWarrants(projection);
    assert.deepEqual(result, []);
  },
);
