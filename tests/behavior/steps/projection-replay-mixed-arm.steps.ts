// Steps for tests/behavior/projection/replay-mixed-arm.feature.
//
// Integration-level pin for the projection walker's tolerance of both
// arms of the `target`-discriminated vote / commit / meta-disagreement-
// marked payloads (per ADR 0030 §2 + §9 + `pf_projection_replay_updates`).
// The Vitest cases at `apps/server/src/projection/replay.test.ts`
// exercise each arm in isolation; this layer rounds-trips a single
// event log mixing BOTH arms through pglite's `session_events` JSONB
// column so the discriminator survives the wire seam.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_projection_replay_updates.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  deriveFacetStatus,
  projectFromLog,
  type Projection,
} from '../../../apps/server/src/projection/index.js';

// Distinct UUID prefix from other projection / methodology step files
// so the shared World does not collide across scenarios run in one
// Cucumber pass.
const MA_SESSION_ID = '99999999-9999-4999-8999-999999999100';
const MA_HOST_ID = '99999999-9999-4999-8999-999999999101';
const MA_DEBATER_A_ID = '99999999-9999-4999-8999-999999999102';
const MA_DEBATER_B_ID = '99999999-9999-4999-8999-999999999103';

const MA_NODE_1_ID = '99999999-9999-4999-8999-99999999910a';
const MA_NODE_2_ID = '99999999-9999-4999-8999-99999999910b';
const MA_PROPOSAL_1_ID = '99999999-9999-4999-8999-99999999910c';
const MA_PROPOSAL_2_ID = '99999999-9999-4999-8999-99999999910d';

const TS_BASE = '2026-05-10T20:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants for mixed-arm replay tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: MA_HOST_ID, sub: 'fixture-ma:host', name: 'host' },
      { id: MA_DEBATER_A_ID, sub: 'fixture-ma:a', name: 'a' },
      { id: MA_DEBATER_B_ID, sub: 'fixture-ma:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [MA_SESSION_ID, MA_HOST_ID, 'public', 'Projection mixed-arm replay tests'],
    );

    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(801),
      sequence: 1,
      kind: 'session-created',
      actor: MA_HOST_ID,
      payload: {
        host_user_id: MA_HOST_ID,
        privacy: 'public',
        topic: 'Projection mixed-arm replay tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(802),
      sequence: 2,
      kind: 'participant-joined',
      actor: MA_HOST_ID,
      payload: {
        user_id: MA_HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(803),
      sequence: 3,
      kind: 'participant-joined',
      actor: MA_DEBATER_A_ID,
      payload: {
        user_id: MA_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(804),
      sequence: 4,
      kind: 'participant-joined',
      actor: MA_DEBATER_B_ID,
      payload: {
        user_id: MA_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    this.scratch['maNextSeq'] = 5;
  },
);

Given('two nodes for the mixed-arm replay session', async function (this: AConversaWorld) {
  let seq = this.scratch['maNextSeq'] as number;
  await insertEventRow(this, MA_SESSION_ID, {
    id: evId(seq * 100 + 9),
    sequence: seq,
    kind: 'node-created',
    actor: MA_DEBATER_A_ID,
    payload: {
      node_id: MA_NODE_1_ID,
      wording: 'First mixed-arm-replay statement.',
      created_by: MA_DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
  seq += 1;
  await insertEventRow(this, MA_SESSION_ID, {
    id: evId(seq * 100 + 9),
    sequence: seq,
    kind: 'node-created',
    actor: MA_DEBATER_B_ID,
    payload: {
      node_id: MA_NODE_2_ID,
      wording: 'Second mixed-arm-replay statement.',
      created_by: MA_DEBATER_B_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
  this.scratch['maNextSeq'] = seq + 1;
});

Given(
  'a proposal-keyed classify round commits on the first node',
  async function (this: AConversaWorld) {
    // proposal -> 3 proposal-keyed agree votes -> proposal-keyed commit.
    let seq = this.scratch['maNextSeq'] as number;
    await insertEventRow(this, MA_SESSION_ID, {
      id: MA_PROPOSAL_1_ID,
      sequence: seq,
      kind: 'proposal',
      actor: MA_DEBATER_A_ID,
      payload: {
        proposal: { kind: 'classify-node', node_id: MA_NODE_1_ID, classification: 'fact' },
      },
      createdAt: tsAt(seq),
    });
    seq += 1;
    for (const voter of [MA_HOST_ID, MA_DEBATER_A_ID, MA_DEBATER_B_ID]) {
      await insertEventRow(this, MA_SESSION_ID, {
        id: evId(seq * 100 + 9),
        sequence: seq,
        kind: 'vote',
        actor: voter,
        payload: {
          target: 'proposal' as const,
          proposal_id: MA_PROPOSAL_1_ID,
          participant: voter,
          choice: 'agree',
          voted_at: tsAt(seq),
        },
        createdAt: tsAt(seq),
      });
      seq += 1;
    }
    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(seq * 100 + 9),
      sequence: seq,
      kind: 'commit',
      actor: MA_HOST_ID,
      payload: {
        target: 'proposal' as const,
        proposal_id: MA_PROPOSAL_1_ID,
        committed_by: MA_HOST_ID,
        committed_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    this.scratch['maNextSeq'] = seq + 1;
  },
);

Given(
  'a facet-keyed classify round commits on the second node',
  async function (this: AConversaWorld) {
    // proposal -> 3 facet-keyed agree votes -> facet-keyed commit.
    let seq = this.scratch['maNextSeq'] as number;
    await insertEventRow(this, MA_SESSION_ID, {
      id: MA_PROPOSAL_2_ID,
      sequence: seq,
      kind: 'proposal',
      actor: MA_DEBATER_A_ID,
      payload: {
        proposal: { kind: 'classify-node', node_id: MA_NODE_2_ID, classification: 'value' },
      },
      createdAt: tsAt(seq),
    });
    seq += 1;
    for (const voter of [MA_HOST_ID, MA_DEBATER_A_ID, MA_DEBATER_B_ID]) {
      await insertEventRow(this, MA_SESSION_ID, {
        id: evId(seq * 100 + 9),
        sequence: seq,
        kind: 'vote',
        actor: voter,
        payload: {
          target: 'facet' as const,
          entity_kind: 'node' as const,
          entity_id: MA_NODE_2_ID,
          facet: 'classification' as const,
          participant: voter,
          choice: 'agree',
          voted_at: tsAt(seq),
        },
        createdAt: tsAt(seq),
      });
      seq += 1;
    }
    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(seq * 100 + 9),
      sequence: seq,
      kind: 'commit',
      actor: MA_HOST_ID,
      payload: {
        target: 'facet' as const,
        entity_kind: 'node' as const,
        entity_id: MA_NODE_2_ID,
        facet: 'classification' as const,
        committed_by: MA_HOST_ID,
        committed_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    this.scratch['maNextSeq'] = seq + 1;
  },
);

Given(
  "a withdraw-agreement against the second node's committed classification facet",
  async function (this: AConversaWorld) {
    const seq = this.scratch['maNextSeq'] as number;
    this.scratch['maNextSeq'] = seq + 1;
    await insertEventRow(this, MA_SESSION_ID, {
      id: evId(seq * 100 + 9),
      sequence: seq,
      kind: 'withdraw-agreement',
      actor: MA_DEBATER_B_ID,
      payload: {
        entity_kind: 'node',
        entity_id: MA_NODE_2_ID,
        facet: 'classification',
        participant: MA_DEBATER_B_ID,
        withdrawn_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When('I project the mixed-arm event log via projectFromLog', async function (this: AConversaWorld) {
  const rows = await selectEvents(this, MA_SESSION_ID);
  const events = rows.map(rowToValidatedEvent);
  const projection = projectFromLog(events, MA_SESSION_ID);
  this.scratch['maProjection'] = projection;
});

Then(
  "deriveFacetStatus on the mixed-arm first node's classification facet is {string}",
  function (this: AConversaWorld, expected: string) {
    const projection = this.scratch['maProjection'] as Projection;
    const status = deriveFacetStatus(projection, 'node', MA_NODE_1_ID, 'classification');
    assert.equal(status, expected);
  },
);

Then(
  "deriveFacetStatus on the mixed-arm second node's classification facet is {string}",
  function (this: AConversaWorld, expected: string) {
    const projection = this.scratch['maProjection'] as Projection;
    const status = deriveFacetStatus(projection, 'node', MA_NODE_2_ID, 'classification');
    assert.equal(status, expected);
  },
);
