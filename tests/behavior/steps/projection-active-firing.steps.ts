// Steps for tests/behavior/projection/active-firing.feature.
//
// The behavior-test layer for `isEdgeActive`. The Vitest tests at
// apps/server/src/projection/active-firing.test.ts cover the
// in-memory computation against TS-literal events; these scenarios
// round-trip events through pglite's `session_events` table so the
// JSONB / BIGINT / TIMESTAMPTZ coercion is exercised on the
// active-firing path too.
//
// Refinement: tasks/refinements/data-and-methodology/active_firing_computation.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  isEdgeActive,
  projectFromLog,
  type Projection,
} from '../../../apps/server/src/projection/index.js';

// Distinct UUID prefix (`88...`) so the scratch keys can't collide
// with from-log / incremental / facet-status step files in a shared
// Cucumber run.
const AF_SESSION_ID = '88888888-8888-4888-8888-888888888881';
const HOST_ID = '88888888-8888-4888-8888-888888888882';
const DEBATER_A_ID = '88888888-8888-4888-8888-888888888883';
const DEBATER_B_ID = '88888888-8888-4888-8888-888888888884';

const SOURCE_NODE_ID = '88888888-8888-4888-8888-88888888888a';
const TARGET_NODE_ID = '88888888-8888-4888-8888-88888888888b';
const EDGE_ID = '88888888-8888-4888-8888-88888888888c';

const PROP_SOURCE_SUBSTANCE_ID = '88888888-8888-4888-8888-88888888888d';
const PROP_EDGE_SUBSTANCE_ID = '88888888-8888-4888-8888-88888888888e';

const TS_BASE = '2026-05-10T15:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['afNextSeq'] as number;
  world.scratch['afNextSeq'] = seq + 1;
  return seq;
}

Given(
  'a seeded session with three participants for active-firing tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: HOST_ID, sub: 'fixture-af:host', name: 'host' },
      { id: DEBATER_A_ID, sub: 'fixture-af:a', name: 'a' },
      { id: DEBATER_B_ID, sub: 'fixture-af:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [AF_SESSION_ID, HOST_ID, 'public', 'Projection active-firing behavior tests'],
    );

    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(201),
      sequence: 1,
      kind: 'session-created',
      actor: HOST_ID,
      payload: {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Projection active-firing behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(202),
      sequence: 2,
      kind: 'participant-joined',
      actor: HOST_ID,
      payload: {
        user_id: HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(203),
      sequence: 3,
      kind: 'participant-joined',
      actor: DEBATER_A_ID,
      payload: {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(204),
      sequence: 4,
      kind: 'participant-joined',
      actor: DEBATER_B_ID,
      payload: {
        user_id: DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    this.scratch['afNextSeq'] = 5;
  },
);

Given(
  'source and target nodes plus a supports edge for active-firing tests',
  async function (this: AConversaWorld) {
    let seq = nextSeq(this);
    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(seq * 100 + 1),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: SOURCE_NODE_ID,
        wording: 'The source statement under test.',
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    seq = nextSeq(this);
    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(seq * 100 + 1),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: TARGET_NODE_ID,
        wording: 'The target statement under test.',
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    seq = nextSeq(this);
    await insertEventRow(this, AF_SESSION_ID, {
      id: evId(seq * 100 + 1),
      sequence: seq,
      kind: 'edge-created',
      actor: DEBATER_A_ID,
      payload: {
        edge_id: EDGE_ID,
        role: 'supports',
        source_node_id: SOURCE_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'entity-included events for the source, target, and edge for active-firing tests',
  async function (this: AConversaWorld) {
    for (const entity of [
      { kind: 'node' as const, id: SOURCE_NODE_ID },
      { kind: 'node' as const, id: TARGET_NODE_ID },
      { kind: 'edge' as const, id: EDGE_ID },
    ]) {
      const seq = nextSeq(this);
      await insertEventRow(this, AF_SESSION_ID, {
        id: evId(seq * 100 + 2),
        sequence: seq,
        kind: 'entity-included',
        actor: HOST_ID,
        payload: {
          entity_kind: entity.kind,
          entity_id: entity.id,
          included_by: HOST_ID,
          included_at: tsAt(seq),
        },
        createdAt: tsAt(seq),
      });
    }
  },
);

// Helper: emit proposal + 3 agree votes + commit for a target.
async function emitProposalVotesCommit(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, AF_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [HOST_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, AF_SESSION_ID, {
      id: evId(seq * 100 + 3),
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
  await insertEventRow(world, AF_SESSION_ID, {
    id: evId(seq * 100 + 4),
    sequence: seq,
    kind: 'commit',
    actor: HOST_ID,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// Helper: emit proposal + only 2 agree votes (no commit).
async function emitProposalPartialVotes(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, AF_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [HOST_ID, DEBATER_A_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, AF_SESSION_ID, {
      id: evId(seq * 100 + 3),
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
}

Given(
  'a set-node-substance proposal on the source with value {string} committed by all for active-firing tests',
  async function (this: AConversaWorld, value: string) {
    await emitProposalVotesCommit(this, PROP_SOURCE_SUBSTANCE_ID, {
      kind: 'set-node-substance',
      node_id: SOURCE_NODE_ID,
      value,
    });
  },
);

Given(
  'a set-node-substance proposal on the source with value {string} partially voted for active-firing tests',
  async function (this: AConversaWorld, value: string) {
    await emitProposalPartialVotes(this, PROP_SOURCE_SUBSTANCE_ID, {
      kind: 'set-node-substance',
      node_id: SOURCE_NODE_ID,
      value,
    });
  },
);

Given(
  'a set-edge-substance proposal on the edge with value {string} committed by all for active-firing tests',
  async function (this: AConversaWorld, value: string) {
    await emitProposalVotesCommit(this, PROP_EDGE_SUBSTANCE_ID, {
      kind: 'set-edge-substance',
      edge_id: EDGE_ID,
      value,
    });
  },
);

When(
  'I project the active-firing event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, AF_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, AF_SESSION_ID);
    this.scratch['afProjection'] = projection;
  },
);

Then(
  'isEdgeActive on the seeded edge is true for active-firing tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['afProjection'] as Projection;
    assert.equal(isEdgeActive(projection, EDGE_ID), true);
  },
);

Then(
  'isEdgeActive on the seeded edge is false for active-firing tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['afProjection'] as Projection;
    assert.equal(isEdgeActive(projection, EDGE_ID), false);
  },
);
