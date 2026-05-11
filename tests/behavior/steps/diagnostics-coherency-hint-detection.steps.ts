// Steps for tests/behavior/diagnostics/coherency-hint-detection.feature.
//
// The behavior-test layer for `detectCoherencyHints`. The Vitest tests
// at apps/server/src/diagnostics/coherency-hint-detection.test.ts cover
// the in-memory algorithm against TS-literal events; these scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the coherency-
// hint-detection path too.
//
// Refinement: tasks/refinements/data-and-methodology/coherency_hint_detection.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import { detectCoherencyHints } from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c5...`) so the scratch keys can't collide
// with cycle-detection (`c1...`), contradiction-detection (`c2...`),
// multi-warrant-detection (`c3...`), dangling-claim-detection (`c4...`),
// active-firing (`88...`), or any other step file.
const CH_SESSION_ID = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const CH_HOST_ID = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const CH_DEBATER_A_ID = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const CH_DEBATER_B_ID = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const CH_NODE_D = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeeed01';
const CH_NODE_C = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeeec01';
const CH_NODE_W = 'c5eeeeee-eeee-4eee-8eee-eeeeeeeeef01';

const CH_EDGE_W_FROM_D = 'c5eeeeee-eeee-4eee-8eee-eeeeeeee1fd1';
const CH_EDGE_W_TO_C = 'c5eeeeee-eeee-4eee-8eee-eeeeeeee1ac1';

const TS_BASE = '2026-05-12T18:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['chNextSeq'] as number;
  world.scratch['chNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CH_HOST_ID, sub: 'fixture-ch:host', name: 'host' },
    { id: CH_DEBATER_A_ID, sub: 'fixture-ch:a', name: 'a' },
    { id: CH_DEBATER_B_ID, sub: 'fixture-ch:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CH_SESSION_ID, CH_HOST_ID, 'public', 'Diagnostics coherency-hint-detection behavior tests'],
  );

  // Lifecycle event ids use the 9xxx band so the per-sequence
  // `evId(seq * 1000 + N)` scheme below — which can produce 5xxx,
  // 6xxx, 7xxx, 8xxx as the seq counter increases — never collides
  // with the lifecycle's fixed ids. (Sibling step files use 4xxx
  // for lifecycle and never reach seq=4; this file uses 9xxx and
  // never reaches seq=9 across the two scenarios.)
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(9001),
    sequence: 1,
    kind: 'session-created',
    actor: CH_HOST_ID,
    payload: {
      host_user_id: CH_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics coherency-hint-detection behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(9002),
    sequence: 2,
    kind: 'participant-joined',
    actor: CH_HOST_ID,
    payload: {
      user_id: CH_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(9003),
    sequence: 3,
    kind: 'participant-joined',
    actor: CH_DEBATER_A_ID,
    payload: {
      user_id: CH_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(9004),
    sequence: 4,
    kind: 'participant-joined',
    actor: CH_DEBATER_B_ID,
    payload: {
      user_id: CH_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['chNextSeq'] = 5;
}

// Per-sequence event ids live in the 10xxxx band (`seq * 10 + kind`),
// well clear of the lifecycle's fixed 9xxx ids. The sibling step files
// use `seq * 1000 + N`, which collides with lifecycle ids 4001-4004
// only when seq <= 4 — they avoid it by reserving the first four
// sequences for the lifecycle. Switching to a wider multiplier here
// keeps the id space comfortably disjoint regardless of how many
// per-seq rows the scenarios accumulate.
async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(100000 + seq * 10 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: CH_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: CH_DEBATER_A_ID,
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
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(100000 + seq * 10 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: CH_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role,
      source_node_id: source,
      target_node_id: target,
      created_by: CH_DEBATER_A_ID,
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
  await insertEventRow(world, CH_SESSION_ID, {
    id: evId(100000 + seq * 10 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: CH_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: CH_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for coherency-hint-detection tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'data node D and warrant node W for coherency-hint tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CH_NODE_D, 'Data D.');
    await createNodeRow(this, CH_NODE_W, 'Warrant W.');
  },
);

Given(
  'data node D, claim node C, and warrant node W for coherency-hint tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CH_NODE_D, 'Data D.');
    await createNodeRow(this, CH_NODE_C, 'Claim C.');
    await createNodeRow(this, CH_NODE_W, 'Warrant W.');
  },
);

Given('a W->D bridges-from edge for coherency-hint tests', async function (this: AConversaWorld) {
  await createEdgeRow(this, CH_EDGE_W_FROM_D, 'bridges-from', CH_NODE_W, CH_NODE_D);
});

Given(
  'W->D bridges-from and W->C bridges-to edges for coherency-hint tests',
  async function (this: AConversaWorld) {
    await createEdgeRow(this, CH_EDGE_W_FROM_D, 'bridges-from', CH_NODE_W, CH_NODE_D);
    await createEdgeRow(this, CH_EDGE_W_TO_C, 'bridges-to', CH_NODE_W, CH_NODE_C);
  },
);

Given(
  'entity-included events for the incomplete-warrant coherency-hint nodes and edge',
  async function (this: AConversaWorld) {
    for (const nodeId of [CH_NODE_D, CH_NODE_W]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    await entityIncludedRow(this, 'edge', CH_EDGE_W_FROM_D);
  },
);

Given(
  'entity-included events for the complete-warrant coherency-hint nodes and edges',
  async function (this: AConversaWorld) {
    for (const nodeId of [CH_NODE_D, CH_NODE_C, CH_NODE_W]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [CH_EDGE_W_FROM_D, CH_EDGE_W_TO_C]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the coherency-hint event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, CH_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, CH_SESSION_ID);
    this.scratch['chProjection'] = projection;
  },
);

Then(
  'detectCoherencyHints returns one incomplete-warrant-missing-bridges-to entry naming W and D',
  function (this: AConversaWorld) {
    const projection = this.scratch['chProjection'] as Projection;
    const result = detectCoherencyHints(projection);
    assert.equal(result.length, 1, `expected one coherency-hint entry, got ${result.length}`);
    const entry = result[0];
    assert.ok(entry, 'expected a coherency-hint entry');
    assert.equal(entry.kind, 'incomplete-warrant-missing-bridges-to');
    // Narrow on `kind` so the per-variant fields are visible.
    if (entry.kind !== 'incomplete-warrant-missing-bridges-to') {
      throw new Error('unreachable — narrowed above');
    }
    assert.equal(entry.warrantNodeId, CH_NODE_W);
    assert.equal(entry.dataNodeId, CH_NODE_D);
  },
);

Then(
  'detectCoherencyHints returns no entries for coherency-hint tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['chProjection'] as Projection;
    const result = detectCoherencyHints(projection);
    assert.deepEqual(result, []);
  },
);
