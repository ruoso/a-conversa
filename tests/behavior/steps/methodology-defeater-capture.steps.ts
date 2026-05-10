// Steps for tests/behavior/methodology/defeater-capture.feature.
//
// The behavior-test layer for the defeater-capture layering note
// (Option B in the refinement). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts`
// cover the propose-set-edge-substance handler arm in isolation. This
// file covers the integration path: the three event-stream operations
// of the F6 flow (node-created for Y, edge-created for the rebut Y -> X,
// propose-vote-commit cycle for set-edge-substance with value 'agreed')
// are written into pglite's `session_events` table, replayed through
// `projectFromLog`, and the resulting projection's edge-firing
// predicate is asserted under two source-node-substance regimes:
// proposed (the defeater sits in the graph and does not fire) and
// agreed (the defeater activates per docs/data-model.md line 102).
//
// Distinct UUID prefix (`d4...`) to avoid scratch-state collisions with
// the propose-decompose (`e0...`), propose-interpretive-split (`f0...`),
// propose-axiom-mark (`a1...`), propose-meta-move (`b2...`),
// propose-edit-wording (`c3...`), and active-firing (`88...`) step
// files. All step files share the same Cucumber World so the prefixes
// keep their SQL rows in separate sessions.
//
// Refinement: tasks/refinements/data-and-methodology/defeater_capture_logic.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  isEdgeActive,
  projectFromLog,
  type Projection,
} from '../../../apps/server/src/projection/index.js';

const DC_SESSION_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const DC_HOST_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const DC_DEBATER_A_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const DC_DEBATER_B_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee003';

// X — the defeated target (substantively established).
const DC_TARGET_NODE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee010';
// Y — the defeater node (retraction condition; substance proposed at
// capture time per docs/methodology.md line 114).
const DC_DEFEATER_NODE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee011';
// The rebut edge Y -> X.
const DC_REBUT_EDGE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee012';

// Proposal-event ids for the three propose-vote-commit cycles the
// scenarios walk. Each cycle's id is fixed so the vote and commit
// events can reference them by `proposal_id`.
const DC_PROP_TARGET_SUBSTANCE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee020';
const DC_PROP_REBUT_SUBSTANCE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee021';
const DC_PROP_DEFEATER_SUBSTANCE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee022';

const DC_TS_BASE = '2026-05-10T23:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(DC_TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function nextSeq(world: AConversaWorld): number {
  const seq = world.scratch['dcNextSeq'] as number;
  world.scratch['dcNextSeq'] = seq + 1;
  return seq;
}

// Helper: emit one propose + 3 agree votes + commit for a target.
// Mirrors the same shape `projection-active-firing.steps.ts` uses;
// kept inline here so the prefix and session id stay distinct.
async function emitProposalVotesCommit(
  world: AConversaWorld,
  proposalId: string,
  proposalPayload: Record<string, unknown>,
): Promise<void> {
  let seq = nextSeq(world);
  await insertEventRow(world, DC_SESSION_ID, {
    id: proposalId,
    sequence: seq,
    kind: 'proposal',
    actor: DC_DEBATER_A_ID,
    payload: { proposal: proposalPayload },
    createdAt: tsAt(seq),
  });
  for (const voter of [DC_HOST_ID, DC_DEBATER_A_ID, DC_DEBATER_B_ID]) {
    seq = nextSeq(world);
    await insertEventRow(world, DC_SESSION_ID, {
      id: evId(seq * 100 + 3),
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
  await insertEventRow(world, DC_SESSION_ID, {
    id: evId(seq * 100 + 4),
    sequence: seq,
    kind: 'commit',
    actor: DC_HOST_ID,
    payload: {
      proposal_id: proposalId,
      moderator: DC_HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants for defeater-capture tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: DC_HOST_ID, sub: 'fixture-dc:host', name: 'host' },
      { id: DC_DEBATER_A_ID, sub: 'fixture-dc:a', name: 'a' },
      { id: DC_DEBATER_B_ID, sub: 'fixture-dc:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [DC_SESSION_ID, DC_HOST_ID, 'public', 'Defeater-capture behavior tests'],
    );

    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(40001),
      sequence: 1,
      kind: 'session-created',
      actor: DC_HOST_ID,
      payload: {
        host_user_id: DC_HOST_ID,
        privacy: 'public',
        topic: 'Defeater-capture behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(40002),
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
    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(40003),
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
    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(40004),
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

    this.scratch['dcNextSeq'] = 5;
  },
);

Given(
  'the target X and defeater Y nodes plus the rebut edge for defeater-capture tests',
  async function (this: AConversaWorld) {
    // X — the defeated target.
    let seq = nextSeq(this);
    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(seq * 100 + 1),
      sequence: seq,
      kind: 'node-created',
      actor: DC_DEBATER_A_ID,
      payload: {
        node_id: DC_TARGET_NODE_ID,
        wording: 'Captive housing imposes a residual welfare cost on these animals.',
        created_by: DC_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    // Y — the defeater node.
    seq = nextSeq(this);
    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(seq * 100 + 1),
      sequence: seq,
      kind: 'node-created',
      actor: DC_DEBATER_B_ID,
      payload: {
        node_id: DC_DEFEATER_NODE_ID,
        wording:
          'Welfare science plus revealed-preference data converge on no remaining unmet interest in well-managed captives.',
        created_by: DC_DEBATER_B_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    // The rebut edge Y -> X (`role: 'rebuts'`, source = Y, target = X).
    seq = nextSeq(this);
    await insertEventRow(this, DC_SESSION_ID, {
      id: evId(seq * 100 + 1),
      sequence: seq,
      kind: 'edge-created',
      actor: DC_DEBATER_B_ID,
      payload: {
        edge_id: DC_REBUT_EDGE_ID,
        role: 'rebuts',
        source_node_id: DC_DEFEATER_NODE_ID,
        target_node_id: DC_TARGET_NODE_ID,
        created_by: DC_DEBATER_B_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'entity-included events for the target X, defeater Y, and the rebut edge for defeater-capture tests',
  async function (this: AConversaWorld) {
    for (const entity of [
      { kind: 'node' as const, id: DC_TARGET_NODE_ID },
      { kind: 'node' as const, id: DC_DEFEATER_NODE_ID },
      { kind: 'edge' as const, id: DC_REBUT_EDGE_ID },
    ]) {
      const seq = nextSeq(this);
      await insertEventRow(this, DC_SESSION_ID, {
        id: evId(seq * 100 + 2),
        sequence: seq,
        kind: 'entity-included',
        actor: DC_HOST_ID,
        payload: {
          entity_kind: entity.kind,
          entity_id: entity.id,
          included_by: DC_HOST_ID,
          included_at: tsAt(seq),
        },
        createdAt: tsAt(seq),
      });
    }
  },
);

Given(
  'the target X substance is committed-agreed for defeater-capture tests',
  async function (this: AConversaWorld) {
    await emitProposalVotesCommit(this, DC_PROP_TARGET_SUBSTANCE_ID, {
      kind: 'set-node-substance',
      node_id: DC_TARGET_NODE_ID,
      value: 'agreed',
    });
  },
);

Given(
  "the rebut edge's substance is committed-agreed via propose-set-edge-substance for defeater-capture tests",
  async function (this: AConversaWorld) {
    // This is the F6 step-4 pre-commitment: a propose-set-edge-
    // substance with value 'agreed' against the rebut edge, voted-
    // agree by all and committed by the moderator. The "pre" in "pre-
    // committed" is descriptive of WHEN (before the source node's
    // substance is established), not HOW — the standard propose-vote-
    // commit cycle runs.
    await emitProposalVotesCommit(this, DC_PROP_REBUT_SUBSTANCE_ID, {
      kind: 'set-edge-substance',
      edge_id: DC_REBUT_EDGE_ID,
      value: 'agreed',
    });
  },
);

Given(
  'the defeater Y substance is later committed-agreed via propose-set-node-substance for defeater-capture tests',
  async function (this: AConversaWorld) {
    // The "activation" path: Y is substantively established through
    // its own substantiation. Per docs/data-model.md line 102, the
    // rebut edge now fires.
    await emitProposalVotesCommit(this, DC_PROP_DEFEATER_SUBSTANCE_ID, {
      kind: 'set-node-substance',
      node_id: DC_DEFEATER_NODE_ID,
      value: 'agreed',
    });
  },
);

// ---------------------------------------------------------------
// When step.
// ---------------------------------------------------------------

When(
  'I project the defeater-capture event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, DC_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, DC_SESSION_ID);
    this.scratch['dcProjection'] = projection;
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  "the rebut edge's substance facet is agreed for defeater-capture tests",
  function (this: AConversaWorld) {
    const projection = this.scratch['dcProjection'] as Projection;
    const edge = projection.getEdge(DC_REBUT_EDGE_ID);
    assert.ok(edge, `rebut edge ${DC_REBUT_EDGE_ID} not present in projection`);
    assert.equal(edge.substanceFacet.status, 'agreed');
    assert.equal(edge.substanceFacet.value, 'agreed');
  },
);

Then(
  "the defeater node Y's substance facet is proposed for defeater-capture tests",
  function (this: AConversaWorld) {
    const projection = this.scratch['dcProjection'] as Projection;
    const node = projection.getNode(DC_DEFEATER_NODE_ID);
    assert.ok(node, `defeater node ${DC_DEFEATER_NODE_ID} not present in projection`);
    assert.equal(node.substanceFacet.status, 'proposed');
  },
);

Then(
  "the defeater node Y's substance facet is agreed for defeater-capture tests",
  function (this: AConversaWorld) {
    const projection = this.scratch['dcProjection'] as Projection;
    const node = projection.getNode(DC_DEFEATER_NODE_ID);
    assert.ok(node, `defeater node ${DC_DEFEATER_NODE_ID} not present in projection`);
    assert.equal(node.substanceFacet.status, 'agreed');
    assert.equal(node.substanceFacet.value, 'agreed');
  },
);

Then(
  'isEdgeActive on the rebut edge is false for defeater-capture tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['dcProjection'] as Projection;
    assert.equal(isEdgeActive(projection, DC_REBUT_EDGE_ID), false);
  },
);

Then(
  'isEdgeActive on the rebut edge is true for defeater-capture tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['dcProjection'] as Projection;
    assert.equal(isEdgeActive(projection, DC_REBUT_EDGE_ID), true);
  },
);
