// Steps for tests/behavior/diagnostics/event-emission.feature.
//
// The behavior-test layer for diagnostic_event_emission. The Vitest
// tests at apps/server/src/diagnostics/event-emission.test.ts cover
// the aggregator, the diff, the identity-key canonicalization, and
// the DiagnosticBus in isolation (TS-literal events for the detectors;
// synthetic DiagnosticEntry constructors for the bus). These scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the event-
// emission path too — and so the diff against the previous diagnostic
// snapshot exercises the cross-projection identity-key behavior.
//
// Refinement: tasks/refinements/data-and-methodology/diagnostic_event_emission.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import {
  computeAllDiagnostics,
  diffDiagnostics,
  type DiagnosticEntry,
} from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c7...`) so scratch keys don't collide with
// cycle-detection (`c1...`), contradiction-detection (`c2...`),
// multi-warrant-detection (`c3...`), dangling-claim-detection
// (`c4...`), coherency-hint-detection (`c5...`), or pending-
// consequences (`c6...`).
const EE_SESSION_ID = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const EE_HOST_ID = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const EE_DEBATER_A_ID = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const EE_DEBATER_B_ID = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const EE_NODE_A = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeea01';
const EE_NODE_B = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeea02';
const EE_NODE_C = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeea03';

const EE_EDGE_AB = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeeb12';
const EE_EDGE_BC = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeeb23';
const EE_EDGE_CA = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeeb31';

// Stable proposal ids per facet (matches the pattern in the cycle-
// detection step file).
const EE_PROP_NODE_A_SUBST = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeec01';
const EE_PROP_NODE_B_SUBST = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeec02';
const EE_PROP_NODE_C_SUBST = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeec03';
const EE_PROP_EDGE_AB_SUBST = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeed12';
const EE_PROP_EDGE_BC_SUBST = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeed23';
const EE_PROP_EDGE_CA_SUBST = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeed31';
const EE_PROP_BREAK_CA = 'c7eeeeee-eeee-4eee-8eee-eeeeeeeeee31';

const TS_BASE = '2026-05-12T20:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['eeNextSeq'] as number;
  world.scratch['eeNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: EE_HOST_ID, sub: 'fixture-ee:host', name: 'host' },
    { id: EE_DEBATER_A_ID, sub: 'fixture-ee:a', name: 'a' },
    { id: EE_DEBATER_B_ID, sub: 'fixture-ee:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [EE_SESSION_ID, EE_HOST_ID, 'public', 'Diagnostics event-emission behavior tests'],
  );

  // Lifecycle event ids use the 900xxx band (900001-900004) to stay
  // clear of the per-sequence `seq * 1000 + N` scheme below — at
  // seq>=5 with N in {1..5} the per-sequence ids range from 5001 up
  // through the high tens of thousands as the scenario grows
  // (proposal+3 votes+commit = 5 events per facet; 6 facets per cycle
  // scenario; ~50 events per scenario worst-case → ids up to ~50_005).
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(900001),
    sequence: 1,
    kind: 'session-created',
    actor: EE_HOST_ID,
    payload: {
      host_user_id: EE_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics event-emission behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(900002),
    sequence: 2,
    kind: 'participant-joined',
    actor: EE_HOST_ID,
    payload: {
      user_id: EE_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(900003),
    sequence: 3,
    kind: 'participant-joined',
    actor: EE_DEBATER_A_ID,
    payload: {
      user_id: EE_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(900004),
    sequence: 4,
    kind: 'participant-joined',
    actor: EE_DEBATER_B_ID,
    payload: {
      user_id: EE_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['eeNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: EE_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: EE_DEBATER_A_ID,
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
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: EE_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role: 'supports',
      source_node_id: source,
      target_node_id: target,
      created_by: EE_DEBATER_A_ID,
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
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: EE_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: EE_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// Emit proposal + 3 agree votes + commit. The proposalId is supplied
// by the caller so each facet has a stable, distinct id.
async function emitProposalVotesCommit(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, EE_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: EE_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [EE_HOST_ID, EE_DEBATER_A_ID, EE_DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, EE_SESSION_ID, {
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
  await insertEventRow(world, EE_SESSION_ID, {
    id: evId(seq * 1000 + 5),
    sequence: seq,
    kind: 'commit',
    actor: EE_HOST_ID,
    payload: {
      proposal_id: proposalId,
      moderator: EE_HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function projectAll(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, EE_SESSION_ID);
  const events = rows.map(rowToValidatedEvent);
  return projectFromLog(events, EE_SESSION_ID);
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for event-emission tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'nodes A, B, C with a partial supports chain A->B, B->C for event-emission tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, EE_NODE_A, 'Statement A.');
    await createNodeRow(this, EE_NODE_B, 'Statement B.');
    await createNodeRow(this, EE_NODE_C, 'Statement C.');
    await createEdgeRow(this, EE_EDGE_AB, EE_NODE_A, EE_NODE_B);
    await createEdgeRow(this, EE_EDGE_BC, EE_NODE_B, EE_NODE_C);
  },
);

Given(
  'nodes A, B, C with a closed supports cycle A->B, B->C, C->A for event-emission tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, EE_NODE_A, 'Statement A.');
    await createNodeRow(this, EE_NODE_B, 'Statement B.');
    await createNodeRow(this, EE_NODE_C, 'Statement C.');
    await createEdgeRow(this, EE_EDGE_AB, EE_NODE_A, EE_NODE_B);
    await createEdgeRow(this, EE_EDGE_BC, EE_NODE_B, EE_NODE_C);
    await createEdgeRow(this, EE_EDGE_CA, EE_NODE_C, EE_NODE_A);
  },
);

Given(
  'entity-included events for the partial-chain nodes and edges',
  async function (this: AConversaWorld) {
    for (const nodeId of [EE_NODE_A, EE_NODE_B, EE_NODE_C]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [EE_EDGE_AB, EE_EDGE_BC]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

Given(
  'entity-included events for the closed-cycle nodes and edges',
  async function (this: AConversaWorld) {
    for (const nodeId of [EE_NODE_A, EE_NODE_B, EE_NODE_C]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    for (const edgeId of [EE_EDGE_AB, EE_EDGE_BC, EE_EDGE_CA]) {
      await entityIncludedRow(this, 'edge', edgeId);
    }
  },
);

Given(
  'substance-agreed commits for the partial-chain nodes and edges',
  async function (this: AConversaWorld) {
    for (const [proposalId, nodeId] of [
      [EE_PROP_NODE_A_SUBST, EE_NODE_A],
      [EE_PROP_NODE_B_SUBST, EE_NODE_B],
      [EE_PROP_NODE_C_SUBST, EE_NODE_C],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-node-substance',
        node_id: nodeId,
        value: 'agreed',
      });
    }
    for (const [proposalId, edgeId] of [
      [EE_PROP_EDGE_AB_SUBST, EE_EDGE_AB],
      [EE_PROP_EDGE_BC_SUBST, EE_EDGE_BC],
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
  'substance-agreed commits for the closed-cycle nodes and edges',
  async function (this: AConversaWorld) {
    for (const [proposalId, nodeId] of [
      [EE_PROP_NODE_A_SUBST, EE_NODE_A],
      [EE_PROP_NODE_B_SUBST, EE_NODE_B],
      [EE_PROP_NODE_C_SUBST, EE_NODE_C],
    ] as const) {
      await emitProposalVotesCommit(this, proposalId, {
        kind: 'set-node-substance',
        node_id: nodeId,
        value: 'agreed',
      });
    }
    for (const [proposalId, edgeId] of [
      [EE_PROP_EDGE_AB_SUBST, EE_EDGE_AB],
      [EE_PROP_EDGE_BC_SUBST, EE_EDGE_BC],
      [EE_PROP_EDGE_CA_SUBST, EE_EDGE_CA],
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
  'the closing C->A supports edge with entity-included and substance-agreed commits for event-emission tests',
  async function (this: AConversaWorld) {
    await createEdgeRow(this, EE_EDGE_CA, EE_NODE_C, EE_NODE_A);
    await entityIncludedRow(this, 'edge', EE_EDGE_CA);
    await emitProposalVotesCommit(this, EE_PROP_EDGE_CA_SUBST, {
      kind: 'set-edge-substance',
      edge_id: EE_EDGE_CA,
      value: 'agreed',
    });
  },
);

Given(
  'a committed break-edge against the C->A edge for event-emission tests',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, EE_PROP_BREAK_CA, {
      kind: 'break-edge',
      edge_id: EE_EDGE_CA,
    });
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the event-emission log at the partial-chain position via projectFromLog',
  async function (this: AConversaWorld) {
    const projection = await projectAll(this);
    this.scratch['eePartialProjection'] = projection;
  },
);

When(
  'I project the event-emission log at the closed-cycle position via projectFromLog',
  async function (this: AConversaWorld) {
    const projection = await projectAll(this);
    this.scratch['eeClosedProjection'] = projection;
  },
);

When(
  'I project the event-emission log at the post-break position via projectFromLog',
  async function (this: AConversaWorld) {
    const projection = await projectAll(this);
    this.scratch['eePostBreakProjection'] = projection;
  },
);

When('I record the partial-chain diagnostic snapshot', function (this: AConversaWorld) {
  const projection = this.scratch['eePartialProjection'] as Projection;
  const snapshot = computeAllDiagnostics(projection);
  this.scratch['eePartialSnapshot'] = snapshot;
});

When('I record the closed-cycle diagnostic snapshot', function (this: AConversaWorld) {
  const projection = this.scratch['eeClosedProjection'] as Projection;
  const snapshot = computeAllDiagnostics(projection);
  this.scratch['eeClosedSnapshot'] = snapshot;
});

Then('the partial-chain diagnostic snapshot has no cycle entry', function (this: AConversaWorld) {
  const snapshot = this.scratch['eePartialSnapshot'] as DiagnosticEntry[];
  const cycles = snapshot.filter((e) => e.kind === 'cycle');
  assert.equal(cycles.length, 0, `expected no cycle entries, got ${cycles.length}`);
});

Then(
  'the closed-cycle diagnostic snapshot has one cycle entry covering A, B, and C',
  function (this: AConversaWorld) {
    const snapshot = this.scratch['eeClosedSnapshot'] as DiagnosticEntry[];
    const cycles = snapshot.filter((e) => e.kind === 'cycle');
    assert.equal(cycles.length, 1, `expected one cycle entry, got ${cycles.length}`);
    const cycle = cycles[0];
    assert.ok(cycle && cycle.kind === 'cycle');
    const nodeSet = new Set(cycle.nodes);
    assert.ok(nodeSet.has(EE_NODE_A));
    assert.ok(nodeSet.has(EE_NODE_B));
    assert.ok(nodeSet.has(EE_NODE_C));
  },
);

Then(
  'diffDiagnostics from partial-chain to closed-cycle fires one cycle entry covering A, B, and C',
  function (this: AConversaWorld) {
    const prev = this.scratch['eePartialSnapshot'] as DiagnosticEntry[];
    const nextProjection = this.scratch['eeClosedProjection'] as Projection;
    const next = computeAllDiagnostics(nextProjection);
    this.scratch['eeClosedSnapshot'] = next;
    const { fired } = diffDiagnostics(prev, next);
    const firedCycles = fired.filter((e) => e.kind === 'cycle');
    assert.equal(firedCycles.length, 1, `expected one fired cycle, got ${firedCycles.length}`);
    const cycle = firedCycles[0];
    assert.ok(cycle && cycle.kind === 'cycle');
    const nodeSet = new Set(cycle.nodes);
    assert.ok(nodeSet.has(EE_NODE_A));
    assert.ok(nodeSet.has(EE_NODE_B));
    assert.ok(nodeSet.has(EE_NODE_C));
  },
);

Then(
  'diffDiagnostics from partial-chain to closed-cycle clears no entries',
  function (this: AConversaWorld) {
    const prev = this.scratch['eePartialSnapshot'] as DiagnosticEntry[];
    const next = this.scratch['eeClosedSnapshot'] as DiagnosticEntry[];
    const { cleared } = diffDiagnostics(prev, next);
    assert.deepEqual(cleared, [], `expected no cleared entries, got ${cleared.length}`);
  },
);

Then(
  'diffDiagnostics from closed-cycle to post-break clears one cycle entry covering A, B, and C',
  function (this: AConversaWorld) {
    const prev = this.scratch['eeClosedSnapshot'] as DiagnosticEntry[];
    const nextProjection = this.scratch['eePostBreakProjection'] as Projection;
    const next = computeAllDiagnostics(nextProjection);
    this.scratch['eePostBreakSnapshot'] = next;
    const { cleared } = diffDiagnostics(prev, next);
    const clearedCycles = cleared.filter((e) => e.kind === 'cycle');
    assert.equal(
      clearedCycles.length,
      1,
      `expected one cleared cycle, got ${clearedCycles.length}`,
    );
    const cycle = clearedCycles[0];
    assert.ok(cycle && cycle.kind === 'cycle');
    const nodeSet = new Set(cycle.nodes);
    assert.ok(nodeSet.has(EE_NODE_A));
    assert.ok(nodeSet.has(EE_NODE_B));
    assert.ok(nodeSet.has(EE_NODE_C));
  },
);

Then(
  'diffDiagnostics from closed-cycle to post-break fires no entries',
  function (this: AConversaWorld) {
    const prev = this.scratch['eeClosedSnapshot'] as DiagnosticEntry[];
    const next = this.scratch['eePostBreakSnapshot'] as DiagnosticEntry[];
    const { fired } = diffDiagnostics(prev, next);
    assert.deepEqual(fired, [], `expected no fired entries, got ${fired.length}`);
  },
);
