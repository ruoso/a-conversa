// Steps for tests/behavior/diagnostics/classification.feature.
//
// The behavior-test layer for blocking_vs_advisory_classification. The
// Vitest tests at apps/server/src/diagnostics/classification.test.ts
// cover the classifier and the partition helper as pure functions over
// synthetic DiagnosticEntry literals (no projection, no DB). This file
// rounds-trips events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the
// classification path too — and so the partition operates on the
// detector output computed off the DB-round-tripped projection.
//
// Refinement: tasks/refinements/data-and-methodology/blocking_vs_advisory_classification.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import {
  computeAllDiagnostics,
  partitionBySeverity,
  type DiagnosticEntry,
} from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c8...`) so scratch keys don't collide with
// cycle-detection (`c1...`), contradiction-detection (`c2...`),
// multi-warrant-detection (`c3...`), dangling-claim-detection
// (`c4...`), coherency-hint-detection (`c5...`), pending-consequences
// (`c6...`), or event-emission (`c7...`).
const CL_SESSION_ID = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa000';
const CL_HOST_ID = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const CL_DEBATER_A_ID = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const CL_DEBATER_B_ID = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';

// Cycle nodes A, B, C.
const CL_NODE_A = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa101';
const CL_NODE_B = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa102';
const CL_NODE_C = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa103';

// Multi-warrant nodes D (data), K (claim), W1 / W2 (warrants).
// Disjoint from the cycle nodes so the two patterns coexist.
const CL_NODE_D = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa201';
const CL_NODE_K = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa202';
const CL_NODE_W1 = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa211';
const CL_NODE_W2 = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa212';

// Cycle edges (supports).
const CL_EDGE_AB = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab012';
const CL_EDGE_BC = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab023';
const CL_EDGE_CA = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab031';

// Multi-warrant edges (W -> D as bridges-from, W -> K as bridges-to).
const CL_EDGE_W1_FROM_D = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab111';
const CL_EDGE_W1_TO_K = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab112';
const CL_EDGE_W2_FROM_D = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab121';
const CL_EDGE_W2_TO_K = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaab122';

// Stable per-facet proposal ids.
const CL_PROP_NODE_A_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac001';
const CL_PROP_NODE_B_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac002';
const CL_PROP_NODE_C_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac003';
const CL_PROP_NODE_D_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac004';
const CL_PROP_NODE_K_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac005';
const CL_PROP_NODE_W1_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac006';
const CL_PROP_NODE_W2_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaac007';
const CL_PROP_EDGE_AB_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad012';
const CL_PROP_EDGE_BC_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad023';
const CL_PROP_EDGE_CA_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad031';
const CL_PROP_EDGE_W1_FROM_D_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad111';
const CL_PROP_EDGE_W1_TO_K_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad112';
const CL_PROP_EDGE_W2_FROM_D_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad121';
const CL_PROP_EDGE_W2_TO_K_SUBST = 'c8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaad122';

const TS_BASE = '2026-05-13T15:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['clNextSeq'] as number;
  world.scratch['clNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CL_HOST_ID, sub: 'fixture-cl:host', name: 'host' },
    { id: CL_DEBATER_A_ID, sub: 'fixture-cl:a', name: 'a' },
    { id: CL_DEBATER_B_ID, sub: 'fixture-cl:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CL_SESSION_ID, CL_HOST_ID, 'public', 'Diagnostics classification behavior tests'],
  );

  // Lifecycle event ids live in the 900xxx band to stay clear of the
  // per-sequence `seq * 1000 + N` ids below (which can grow into the
  // tens of thousands as the multi-facet scenario emits proposals,
  // votes, and commits).
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(900001),
    sequence: 1,
    kind: 'session-created',
    actor: CL_HOST_ID,
    payload: {
      host_user_id: CL_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics classification behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(900002),
    sequence: 2,
    kind: 'participant-joined',
    actor: CL_HOST_ID,
    payload: {
      user_id: CL_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(900003),
    sequence: 3,
    kind: 'participant-joined',
    actor: CL_DEBATER_A_ID,
    payload: {
      user_id: CL_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(900004),
    sequence: 4,
    kind: 'participant-joined',
    actor: CL_DEBATER_B_ID,
    payload: {
      user_id: CL_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['clNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: CL_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: CL_DEBATER_A_ID,
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
  role: 'supports' | 'bridges-from' | 'bridges-to' = 'supports',
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: CL_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role,
      source_node_id: source,
      target_node_id: target,
      created_by: CL_DEBATER_A_ID,
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
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: CL_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: CL_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function emitProposalVotesCommit(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, CL_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: CL_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [CL_HOST_ID, CL_DEBATER_A_ID, CL_DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, CL_SESSION_ID, {
      id: evId(seq * 1000 + 4),
      sequence: seq,
      kind: 'vote',
      actor: voter,
      payload: {
        proposal_id: proposalId,
        participant: voter,
        vote: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  }
  seq = nextSeq(world);
  await insertEventRow(world, CL_SESSION_ID, {
    id: evId(seq * 1000 + 5),
    sequence: seq,
    kind: 'commit',
    actor: CL_HOST_ID,
    payload: {
      proposal_id: proposalId,
      moderator: CL_HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function projectAll(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, CL_SESSION_ID);
  const events = rows.map(rowToValidatedEvent);
  return projectFromLog(events, CL_SESSION_ID);
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for classification tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'nodes A, B, C with a closed supports cycle for classification tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CL_NODE_A, 'Cycle statement A.');
    await createNodeRow(this, CL_NODE_B, 'Cycle statement B.');
    await createNodeRow(this, CL_NODE_C, 'Cycle statement C.');
    await createEdgeRow(this, CL_EDGE_AB, CL_NODE_A, CL_NODE_B);
    await createEdgeRow(this, CL_EDGE_BC, CL_NODE_B, CL_NODE_C);
    await createEdgeRow(this, CL_EDGE_CA, CL_NODE_C, CL_NODE_A);
  },
);

Given(
  'nodes D, K with two warrants W1 and W2 bridging D to K for classification tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CL_NODE_D, 'Data node D.');
    await createNodeRow(this, CL_NODE_K, 'Claim node K.');
    await createNodeRow(this, CL_NODE_W1, 'Warrant W1.');
    await createNodeRow(this, CL_NODE_W2, 'Warrant W2.');
    // W1 bridges D -> K. W2 bridges D -> K. Each warrant has a
    // bridges-from edge from itself to D and a bridges-to edge from
    // itself to K (matching the multi-warrant detector's expected
    // shape — see apps/server/src/diagnostics/multi-warrant-detection.ts).
    await createEdgeRow(this, CL_EDGE_W1_FROM_D, CL_NODE_W1, CL_NODE_D, 'bridges-from');
    await createEdgeRow(this, CL_EDGE_W1_TO_K, CL_NODE_W1, CL_NODE_K, 'bridges-to');
    await createEdgeRow(this, CL_EDGE_W2_FROM_D, CL_NODE_W2, CL_NODE_D, 'bridges-from');
    await createEdgeRow(this, CL_EDGE_W2_TO_K, CL_NODE_W2, CL_NODE_K, 'bridges-to');
  },
);

Given(
  'entity-included events for the classification fixture entities',
  async function (this: AConversaWorld) {
    for (const nodeId of [
      CL_NODE_A,
      CL_NODE_B,
      CL_NODE_C,
      CL_NODE_D,
      CL_NODE_K,
      CL_NODE_W1,
      CL_NODE_W2,
    ]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [
      CL_EDGE_AB,
      CL_EDGE_BC,
      CL_EDGE_CA,
      CL_EDGE_W1_FROM_D,
      CL_EDGE_W1_TO_K,
      CL_EDGE_W2_FROM_D,
      CL_EDGE_W2_TO_K,
    ]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

Given(
  'substance-agreed commits for the classification fixture entities',
  async function (this: AConversaWorld) {
    for (const [proposalId, nodeId] of [
      [CL_PROP_NODE_A_SUBST, CL_NODE_A],
      [CL_PROP_NODE_B_SUBST, CL_NODE_B],
      [CL_PROP_NODE_C_SUBST, CL_NODE_C],
      [CL_PROP_NODE_D_SUBST, CL_NODE_D],
      [CL_PROP_NODE_K_SUBST, CL_NODE_K],
      [CL_PROP_NODE_W1_SUBST, CL_NODE_W1],
      [CL_PROP_NODE_W2_SUBST, CL_NODE_W2],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-node-substance',
        node_id: nodeId,
        value: 'agreed',
      });
    }
    for (const [proposalId, edgeId] of [
      [CL_PROP_EDGE_AB_SUBST, CL_EDGE_AB],
      [CL_PROP_EDGE_BC_SUBST, CL_EDGE_BC],
      [CL_PROP_EDGE_CA_SUBST, CL_EDGE_CA],
      [CL_PROP_EDGE_W1_FROM_D_SUBST, CL_EDGE_W1_FROM_D],
      [CL_PROP_EDGE_W1_TO_K_SUBST, CL_EDGE_W1_TO_K],
      [CL_PROP_EDGE_W2_FROM_D_SUBST, CL_EDGE_W2_FROM_D],
      [CL_PROP_EDGE_W2_TO_K_SUBST, CL_EDGE_W2_TO_K],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-edge-substance',
        edge_id: edgeId,
        value: 'agreed',
      });
    }
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When('I project the classification log via projectFromLog', async function (this: AConversaWorld) {
  const projection = await projectAll(this);
  this.scratch['clProjection'] = projection;
});

When('I compute all diagnostics and partition by severity', function (this: AConversaWorld) {
  const projection = this.scratch['clProjection'] as Projection;
  const entries = computeAllDiagnostics(projection);
  this.scratch['clEntries'] = entries;
  this.scratch['clPartition'] = partitionBySeverity(entries);
});

Then(
  'the classification blocking bucket contains exactly one cycle entry covering A, B, and C',
  function (this: AConversaWorld) {
    const partition = this.scratch['clPartition'] as {
      blocking: DiagnosticEntry[];
      advisory: DiagnosticEntry[];
    };
    assert.equal(
      partition.blocking.length,
      1,
      `expected one blocking entry, got ${partition.blocking.length}`,
    );
    const entry = partition.blocking[0];
    assert.ok(entry && entry.kind === 'cycle', `expected blocking entry to be a cycle`);
    const nodeSet = new Set(entry.nodes);
    assert.ok(nodeSet.has(CL_NODE_A));
    assert.ok(nodeSet.has(CL_NODE_B));
    assert.ok(nodeSet.has(CL_NODE_C));
  },
);

Then(
  'the classification advisory bucket contains exactly one multi-warrant entry on D and K with warrants W1 and W2',
  function (this: AConversaWorld) {
    const partition = this.scratch['clPartition'] as {
      blocking: DiagnosticEntry[];
      advisory: DiagnosticEntry[];
    };
    const multiWarrants = partition.advisory.filter((e) => e.kind === 'multi-warrant');
    assert.equal(
      multiWarrants.length,
      1,
      `expected exactly one multi-warrant advisory entry, got ${multiWarrants.length}`,
    );
    const entry = multiWarrants[0];
    assert.ok(entry && entry.kind === 'multi-warrant');
    assert.equal(entry.dataNodeId, CL_NODE_D);
    assert.equal(entry.claimNodeId, CL_NODE_K);
    const warrants = new Set(entry.warrantNodeIds);
    assert.equal(warrants.size, 2);
    assert.ok(warrants.has(CL_NODE_W1));
    assert.ok(warrants.has(CL_NODE_W2));
    // The classifier ruled multi-warrant advisory; therefore no
    // multi-warrant entry should have landed in the blocking bucket.
    const blockingMultiWarrants = partition.blocking.filter((e) => e.kind === 'multi-warrant');
    assert.equal(blockingMultiWarrants.length, 0);
  },
);

Then('every classification entry lands in exactly one bucket', function (this: AConversaWorld) {
  const entries = this.scratch['clEntries'] as DiagnosticEntry[];
  const partition = this.scratch['clPartition'] as {
    blocking: DiagnosticEntry[];
    advisory: DiagnosticEntry[];
  };
  // Round-trip by multiset: the union of the two buckets equals the
  // input list. Reference-equality is fine — the classifier returns
  // the same object references back, just sorted into buckets.
  assert.equal(partition.blocking.length + partition.advisory.length, entries.length);
  const blockingSet = new Set(partition.blocking);
  const advisorySet = new Set(partition.advisory);
  for (const entry of entries) {
    const inBlocking = blockingSet.has(entry);
    const inAdvisory = advisorySet.has(entry);
    assert.ok(
      inBlocking !== inAdvisory,
      `entry must land in exactly one bucket; was in blocking=${inBlocking} advisory=${inAdvisory}`,
    );
  }
});
