// Steps for tests/behavior/diagnostics/pending-consequences.feature.
//
// The behavior-test layer for `detectPendingConsequences`. The Vitest
// tests at apps/server/src/diagnostics/pending-consequences.test.ts
// cover the in-memory algorithm against TS-literal events; these
// scenarios round-trip events through pglite's `session_events` table
// so the JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the
// pending-consequences path too.
//
// Refinement: tasks/refinements/data-and-methodology/pending_consequences_stub.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import { detectPendingConsequences } from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c6...`) so the scratch keys can't collide
// with the cycle-detection (`c1...`), contradiction-detection
// (`c2...`), multi-warrant (`c3...`), dangling-claim (`c4...`),
// coherency-hint (`c5...`), or the other step files.
const PC_SESSION_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PC_HOST_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PC_DEBATER_A_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PC_DEBATER_B_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PC_SOURCE_NODE_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeeea01';
const PC_TARGET_NODE_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeeea02';
const PC_EDGE_ID = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeeeb12';

// Stable proposal ids per facet operation.
const PC_PROP_EDGE_SUBST = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeeec12';
const PC_PROP_SOURCE_SUBST = 'c6eeeeee-eeee-4eee-8eee-eeeeeeeeed01';

const TS_BASE = '2026-05-10T18:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['pcNextSeq'] as number;
  world.scratch['pcNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PC_HOST_ID, sub: 'fixture-pc:host', name: 'host' },
    { id: PC_DEBATER_A_ID, sub: 'fixture-pc:a', name: 'a' },
    { id: PC_DEBATER_B_ID, sub: 'fixture-pc:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PC_SESSION_ID, PC_HOST_ID, 'public', 'Diagnostics pending-consequences behavior tests'],
  );

  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(4001),
    sequence: 1,
    kind: 'session-created',
    actor: PC_HOST_ID,
    payload: {
      host_user_id: PC_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics pending-consequences behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(4002),
    sequence: 2,
    kind: 'participant-joined',
    actor: PC_HOST_ID,
    payload: {
      user_id: PC_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(4003),
    sequence: 3,
    kind: 'participant-joined',
    actor: PC_DEBATER_A_ID,
    payload: {
      user_id: PC_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(4004),
    sequence: 4,
    kind: 'participant-joined',
    actor: PC_DEBATER_B_ID,
    payload: {
      user_id: PC_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['pcNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: PC_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: PC_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function createSupportsEdgeRow(
  world: AConversaWorld,
  edgeId: string,
  source: string,
  target: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: PC_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role: 'supports',
      source_node_id: source,
      target_node_id: target,
      created_by: PC_DEBATER_A_ID,
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
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: PC_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: PC_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// Emit proposal + 3 agree votes + commit. The proposalId is supplied
// so each facet operation has a stable, distinct id.
async function emitProposalVotesCommit(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, PC_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: PC_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [PC_HOST_ID, PC_DEBATER_A_ID, PC_DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, PC_SESSION_ID, {
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
  await insertEventRow(world, PC_SESSION_ID, {
    id: evId(seq * 1000 + 5),
    sequence: seq,
    kind: 'commit',
    actor: PC_HOST_ID,
    payload: {
      proposal_id: proposalId,
      moderator: PC_HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for pending-consequences tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'one source node, one target node, plus a supports edge source->target for pending-consequences tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, PC_SOURCE_NODE_ID, 'Source statement.');
    await createNodeRow(this, PC_TARGET_NODE_ID, 'Target statement.');
    await createSupportsEdgeRow(this, PC_EDGE_ID, PC_SOURCE_NODE_ID, PC_TARGET_NODE_ID);
  },
);

Given(
  'entity-included events for the pending-consequences nodes and edge',
  async function (this: AConversaWorld) {
    for (const nodeId of [PC_SOURCE_NODE_ID, PC_TARGET_NODE_ID]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    await entityIncludedRow(this, 'edge', PC_EDGE_ID);
  },
);

Given(
  'the substance of the pending-consequences edge is committed agreed',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, PC_PROP_EDGE_SUBST, {
      kind: 'set-edge-substance',
      edge_id: PC_EDGE_ID,
      value: 'agreed',
    });
  },
);

Given(
  'the substance of the pending-consequences source node is committed agreed',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, PC_PROP_SOURCE_SUBST, {
      kind: 'set-node-substance',
      node_id: PC_SOURCE_NODE_ID,
      value: 'agreed',
    });
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the pending-consequences event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, PC_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, PC_SESSION_ID);
    this.scratch['pcProjection'] = projection;
  },
);

Then(
  'detectPendingConsequences returns one pending consequence for the pending-consequences edge with reason source-substance-proposed',
  function (this: AConversaWorld) {
    const projection = this.scratch['pcProjection'] as Projection;
    const pendings = detectPendingConsequences(projection);
    assert.equal(pendings.length, 1, `expected one pending consequence, got ${pendings.length}`);
    const entry = pendings[0];
    assert.ok(entry, 'expected a pending-consequence entry');
    assert.equal(entry.edgeId, PC_EDGE_ID);
    assert.equal(entry.sourceNodeId, PC_SOURCE_NODE_ID);
    assert.equal(entry.reason, 'source-substance-proposed');
  },
);

Then(
  'detectPendingConsequences returns no pending consequences for pending-consequences tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['pcProjection'] as Projection;
    const pendings = detectPendingConsequences(projection);
    assert.deepEqual(pendings, []);
  },
);
