// Steps for tests/behavior/diagnostics/contradiction-detection.feature.
//
// The behavior-test layer for `detectContradictions`. The Vitest tests
// at apps/server/src/diagnostics/contradiction-detection.test.ts cover
// the in-memory algorithm against TS-literal events; these scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the
// contradiction-detection path too.
//
// Refinement: tasks/refinements/data-and-methodology/contradiction_detection.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import { projectFromLog, type Projection } from '../../../apps/server/src/projection/index.js';
import { detectContradictions } from '../../../apps/server/src/diagnostics/index.js';

// Distinct UUID prefix (`c2...`) so the scratch keys can't collide
// with the cycle-detection (`c1...`), active-firing (`88...`),
// facet-status / from-log / incremental / methodology (`b3...`,
// `e0...`, `c4...`, etc.) step files.
const CT_SESSION_ID = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const CT_HOST_ID = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const CT_DEBATER_A_ID = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const CT_DEBATER_B_ID = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeee003';

// Nodes are chosen with NODE_A < NODE_B lexicographically so the
// canonical-pair assertion lines up.
const CT_NODE_A = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeea01';
const CT_NODE_B = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeea02';
const CT_EDGE_AB = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeeb12';

// Stable proposal ids per facet operation.
const CT_PROP_NODE_A_SUBST = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeec01';
const CT_PROP_NODE_B_SUBST = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeec02';
const CT_PROP_EDGE_AB_SUBST = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeed12';
const CT_PROP_AMEND_A = 'c2eeeeee-eeee-4eee-8eee-eeeeeeeeef01';

const TS_BASE = '2026-05-10T17:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['ctNextSeq'] as number;
  world.scratch['ctNextSeq'] = seq + 1;
  return seq;
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CT_HOST_ID, sub: 'fixture-ct:host', name: 'host' },
    { id: CT_DEBATER_A_ID, sub: 'fixture-ct:a', name: 'a' },
    { id: CT_DEBATER_B_ID, sub: 'fixture-ct:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CT_SESSION_ID, CT_HOST_ID, 'public', 'Diagnostics contradiction-detection behavior tests'],
  );

  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(3001),
    sequence: 1,
    kind: 'session-created',
    actor: CT_HOST_ID,
    payload: {
      host_user_id: CT_HOST_ID,
      privacy: 'public',
      topic: 'Diagnostics contradiction-detection behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(3002),
    sequence: 2,
    kind: 'participant-joined',
    actor: CT_HOST_ID,
    payload: {
      user_id: CT_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(3003),
    sequence: 3,
    kind: 'participant-joined',
    actor: CT_DEBATER_A_ID,
    payload: {
      user_id: CT_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(3004),
    sequence: 4,
    kind: 'participant-joined',
    actor: CT_DEBATER_B_ID,
    payload: {
      user_id: CT_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });

  world.scratch['ctNextSeq'] = 5;
}

async function createNodeRow(
  world: AConversaWorld,
  nodeId: string,
  wording: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(seq * 1000 + 1),
    sequence: seq,
    kind: 'node-created',
    actor: CT_DEBATER_A_ID,
    payload: {
      node_id: nodeId,
      wording,
      created_by: CT_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

async function createContradictsEdgeRow(
  world: AConversaWorld,
  edgeId: string,
  source: string,
  target: string,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(seq * 1000 + 2),
    sequence: seq,
    kind: 'edge-created',
    actor: CT_DEBATER_A_ID,
    payload: {
      edge_id: edgeId,
      role: 'contradicts',
      source_node_id: source,
      target_node_id: target,
      created_by: CT_DEBATER_A_ID,
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
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(seq * 1000 + 3),
    sequence: seq,
    kind: 'entity-included',
    actor: CT_HOST_ID,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      included_by: CT_HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// Emit a proposal-only row (no votes, no commit). Used to set up the
// "pending substance" scenario where the contradicts edge has a
// proposal but no commit.
async function emitProposalOnly(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  const seq = nextSeq(world);
  await insertEventRow(world, CT_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: CT_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
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
  await insertEventRow(world, CT_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: CT_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [CT_HOST_ID, CT_DEBATER_A_ID, CT_DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, CT_SESSION_ID, {
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
  await insertEventRow(world, CT_SESSION_ID, {
    id: evId(seq * 1000 + 5),
    sequence: seq,
    kind: 'commit',
    actor: CT_HOST_ID,
    payload: {
      proposal_id: proposalId,
      moderator: CT_HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Givens.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for contradiction-detection tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
  },
);

Given(
  'two nodes A, B plus one contradicts edge A->B for contradiction-detection tests',
  async function (this: AConversaWorld) {
    await createNodeRow(this, CT_NODE_A, 'Statement A.');
    await createNodeRow(this, CT_NODE_B, 'Statement B.');
    await createContradictsEdgeRow(this, CT_EDGE_AB, CT_NODE_A, CT_NODE_B);
  },
);

Given(
  'entity-included events for the contradiction-detection nodes and edge',
  async function (this: AConversaWorld) {
    for (const nodeId of [CT_NODE_A, CT_NODE_B]) {
      await entityIncludedRow(this, 'node', nodeId);
    }
    await entityIncludedRow(this, 'edge', CT_EDGE_AB);
  },
);

Given(
  'the substance of each contradiction node is committed agreed for contradiction-detection tests',
  async function (this: AConversaWorld) {
    for (const [proposalId, nodeId] of [
      [CT_PROP_NODE_A_SUBST, CT_NODE_A],
      [CT_PROP_NODE_B_SUBST, CT_NODE_B],
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
  'the substance of the contradicts edge is committed agreed for contradiction-detection tests',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, CT_PROP_EDGE_AB_SUBST, {
      kind: 'set-edge-substance',
      edge_id: CT_EDGE_AB,
      value: 'agreed',
    });
  },
);

Given(
  'the substance of the contradicts edge is proposed but uncommitted for contradiction-detection tests',
  async function (this: AConversaWorld) {
    await emitProposalOnly(this, CT_PROP_EDGE_AB_SUBST, {
      kind: 'set-edge-substance',
      edge_id: CT_EDGE_AB,
      value: 'agreed',
    });
  },
);

Given(
  'an amend-node proposal against A is committed by all for contradiction-detection tests',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, CT_PROP_AMEND_A, {
      kind: 'amend-node',
      node_id: CT_NODE_A,
      new_content: 'Statement A, amended.',
    });
  },
);

// ---------------------------------------------------------------
// When / Then.
// ---------------------------------------------------------------

When(
  'I project the contradiction-detection event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, CT_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, CT_SESSION_ID);
    this.scratch['ctProjection'] = projection;
  },
);

Then(
  'detectContradictions returns one contradiction pair containing both contradiction-detection nodes and the contradicts edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['ctProjection'] as Projection;
    const contradictions = detectContradictions(projection);
    assert.equal(
      contradictions.length,
      1,
      `expected one contradiction, got ${contradictions.length}`,
    );
    const entry = contradictions[0];
    assert.ok(entry, 'expected a contradiction entry');
    // Canonical pair ordering: CT_NODE_A < CT_NODE_B lexicographically.
    assert.equal(entry.nodeA, CT_NODE_A);
    assert.equal(entry.nodeB, CT_NODE_B);
    assert.deepEqual(entry.edges, [CT_EDGE_AB]);
  },
);

Then(
  'detectContradictions returns no contradictions for contradiction-detection tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['ctProjection'] as Projection;
    const contradictions = detectContradictions(projection);
    assert.deepEqual(contradictions, []);
  },
);
