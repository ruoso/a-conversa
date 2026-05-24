// Steps for tests/behavior/methodology/propose-capture-node.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `capture-node` arm (`apps/server/src/methodology/handlers/propose.ts` —
// the `validateCaptureNodeProposal` + `buildStructuralEventsForPropose`
// branches). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeCaptureNode.test.ts`
// cover the in-memory rule set. This file covers the DB-driven
// integration path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-capture-node action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts`. The shared `When 'the methodology
// engine validates the propose action against the projected session'`
// step is reused from `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_capture_emits_inline_wording_only.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  deriveFacetStatus,
  projectFromLog,
  type Event,
  type Projection,
} from '../../../apps/server/src/projection/index.js';
import {
  nextSequence,
  type ProposeAction,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix (`d4...`) to avoid scratch-state collisions with
// the prior propose-* step files (propose-decompose `e0...`,
// propose-interpretive-split `f0...`, propose-axiom-mark `a1...`,
// propose-meta-move `b2...`, propose-annotate `c3...`, etc.).
const CN_SESSION_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const CN_HOST_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const CN_MODERATOR_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const CN_DEBATER_A_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee003';
const CN_DEBATER_B_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee004';

const CN_TARGET_NODE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const CN_FRESH_NODE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const CN_FRESH_EDGE_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee007';
const CN_NEW_EVENT_ID = 'd4eeeeee-eeee-4eee-8eee-eeeeeeeee008';

const TS_BASE = '2026-05-11T00:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CN_HOST_ID, sub: 'fixture-cn:host', name: 'host' },
    { id: CN_MODERATOR_ID, sub: 'fixture-cn:mod', name: 'mod' },
    { id: CN_DEBATER_A_ID, sub: 'fixture-cn:a', name: 'a' },
    { id: CN_DEBATER_B_ID, sub: 'fixture-cn:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CN_SESSION_ID, CN_HOST_ID, 'public', 'Propose-capture-node behavior tests'],
  );

  await insertEventRow(world, CN_SESSION_ID, {
    id: evId(1301),
    sequence: 1,
    kind: 'session-created',
    actor: CN_HOST_ID,
    payload: {
      host_user_id: CN_HOST_ID,
      privacy: 'public',
      topic: 'Propose-capture-node behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CN_SESSION_ID, {
    id: evId(1302),
    sequence: 2,
    kind: 'participant-joined',
    actor: CN_MODERATOR_ID,
    payload: {
      user_id: CN_MODERATOR_ID,
      role: 'moderator',
      screen_name: 'mod',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CN_SESSION_ID, {
    id: evId(1303),
    sequence: 3,
    kind: 'participant-joined',
    actor: CN_DEBATER_A_ID,
    payload: {
      user_id: CN_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CN_SESSION_ID, {
    id: evId(1304),
    sequence: 4,
    kind: 'participant-joined',
    actor: CN_DEBATER_B_ID,
    payload: {
      user_id: CN_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertTargetNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, CN_SESSION_ID, {
    id: evId(1305),
    sequence: 5,
    kind: 'node-created',
    actor: CN_DEBATER_A_ID,
    payload: {
      node_id: CN_TARGET_NODE_ID,
      wording: 'A pre-existing visible target node.',
      created_by: CN_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
  await insertEventRow(world, CN_SESSION_ID, {
    id: evId(1306),
    sequence: 6,
    kind: 'entity-included',
    actor: CN_DEBATER_A_ID,
    payload: {
      entity_kind: 'node',
      entity_id: CN_TARGET_NODE_ID,
      included_by: CN_DEBATER_A_ID,
      included_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, CN_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, CN_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and no captured nodes yet',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a visible target node',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertTargetNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'the moderator constructs a wording-only propose-capture-node action',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: CN_MODERATOR_ID,
      sessionId: CN_SESSION_ID,
      eventId: CN_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: CN_MODERATOR_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'capture-node',
        node_id: CN_FRESH_NODE_ID,
        wording: 'Zoos do more good than harm.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'the moderator constructs a capture-with-edge propose-capture-node action linking a fresh node to the visible target',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: CN_MODERATOR_ID,
      sessionId: CN_SESSION_ID,
      eventId: CN_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: CN_MODERATOR_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'capture-node',
        node_id: CN_FRESH_NODE_ID,
        wording: 'Modern zoos prioritise conservation over entertainment.',
        edge: {
          edge_id: CN_FRESH_EDGE_ID,
          role: 'supports',
          source_node_id: CN_FRESH_NODE_ID,
          target_node_id: CN_TARGET_NODE_ID,
        },
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

// The "validates the propose action against the projected session"
// When step is shared with the propose-decompose feature and lives in
// `methodology-propose-decompose.steps.ts`. Reused as-is.

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  'the result carries exactly 3 events — node-created, entity-included, and the capture-node proposal envelope — with no co-bundled classify-node',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(
      result.events.length,
      3,
      `expected exactly 3 events, got ${String(result.events.length)}`,
    );

    const [nodeCreated, nodeIncluded, proposalEvent] = result.events as [Event, Event, Event];
    assert.equal(nodeCreated.kind, 'node-created');
    if (nodeCreated.kind === 'node-created') {
      assert.equal(nodeCreated.payload.node_id, CN_FRESH_NODE_ID);
      assert.equal(nodeCreated.payload.wording, 'Zoos do more good than harm.');
    }

    assert.equal(nodeIncluded.kind, 'entity-included');
    if (nodeIncluded.kind === 'entity-included') {
      assert.equal(nodeIncluded.payload.entity_kind, 'node');
      assert.equal(nodeIncluded.payload.entity_id, CN_FRESH_NODE_ID);
    }

    assert.equal(proposalEvent.kind, 'proposal');
    if (proposalEvent.kind === 'proposal') {
      const inner = proposalEvent.payload.proposal;
      assert.equal(inner.kind, 'capture-node');
    }

    // Belt-and-suspenders: no `classify-node` proposal anywhere in the emit.
    for (const ev of result.events) {
      if (ev.kind === 'proposal') {
        assert.notEqual(
          ev.payload.proposal.kind,
          'classify-node',
          'capture-node must not co-bundle a classify-node proposal',
        );
      }
    }
  },
);

Then(
  "the captured node's classification facet projects as awaiting-proposal",
  async function (this: AConversaWorld) {
    // Project the original DB events + the freshly-emitted events
    // from the propose handler, then check the resulting projection's
    // classification facet status for the captured node. The
    // append-in-place API isn't exposed; the contract is round-trip
    // through `projectFromLog` against the concatenated log.
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const rows = await selectEvents(this, CN_SESSION_ID);
    const original: Event[] = rows.map(rowToValidatedEvent);
    // The action's `result.events` are `EventToAppend` which is
    // structurally identical to `Event` (the engine returns events
    // ready to write back). Concatenate the original log with the
    // freshly-emitted events and replay.
    const appended: Event[] = [...result.events];
    const finalProjection = projectFromLog([...original, ...appended], CN_SESSION_ID);
    const node = finalProjection.getNode(CN_FRESH_NODE_ID);
    assert.ok(node !== undefined, 'captured node must exist on the post-emit projection');
    // Read the DERIVED status — the FacetState's literal `.status`
    // field is initialised to `'proposed'` by `emptyFacet()` (a
    // historical default; the source of truth for participant /
    // moderator surfaces is the `deriveFacetStatus` rule chain).
    // Per `deriveFacetStatus` rule 2, a facet whose `candidateValue
    // === null` derives to `'awaiting-proposal'` regardless of the
    // literal status — and the `capture-node` arm does not set a
    // classification candidate (that's a separate later gesture).
    const derived = deriveFacetStatus(finalProjection, 'node', CN_FRESH_NODE_ID, 'classification');
    assert.equal(
      derived,
      'awaiting-proposal',
      `expected derived classification facet status 'awaiting-proposal', got '${derived}'`,
    );
  },
);

Then(
  'the result carries exactly 5 events — node-created, entity-included for the node, edge-created, entity-included for the edge, and the capture-node proposal envelope — with no co-bundled classify-node or set-edge-substance',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(
      result.events.length,
      5,
      `expected exactly 5 events, got ${String(result.events.length)}`,
    );

    const [nodeCreated, nodeIncluded, edgeCreated, edgeIncluded, proposalEvent] = result.events as [
      Event,
      Event,
      Event,
      Event,
      Event,
    ];

    assert.equal(nodeCreated.kind, 'node-created');
    if (nodeCreated.kind === 'node-created') {
      assert.equal(nodeCreated.payload.node_id, CN_FRESH_NODE_ID);
      assert.equal(
        nodeCreated.payload.wording,
        'Modern zoos prioritise conservation over entertainment.',
      );
    }
    assert.equal(nodeIncluded.kind, 'entity-included');
    if (nodeIncluded.kind === 'entity-included') {
      assert.equal(nodeIncluded.payload.entity_kind, 'node');
      assert.equal(nodeIncluded.payload.entity_id, CN_FRESH_NODE_ID);
    }
    assert.equal(edgeCreated.kind, 'edge-created');
    if (edgeCreated.kind === 'edge-created') {
      assert.equal(edgeCreated.payload.edge_id, CN_FRESH_EDGE_ID);
      assert.equal(edgeCreated.payload.role, 'supports');
      assert.equal(edgeCreated.payload.source_node_id, CN_FRESH_NODE_ID);
      assert.equal(edgeCreated.payload.target_node_id, CN_TARGET_NODE_ID);
    }
    assert.equal(edgeIncluded.kind, 'entity-included');
    if (edgeIncluded.kind === 'entity-included') {
      assert.equal(edgeIncluded.payload.entity_kind, 'edge');
      assert.equal(edgeIncluded.payload.entity_id, CN_FRESH_EDGE_ID);
    }
    assert.equal(proposalEvent.kind, 'proposal');
    if (proposalEvent.kind === 'proposal') {
      const inner = proposalEvent.payload.proposal;
      assert.equal(inner.kind, 'capture-node');
    }

    // Belt-and-suspenders: no `classify-node` or `set-edge-substance` proposals.
    for (const ev of result.events) {
      if (ev.kind === 'proposal') {
        assert.notEqual(
          ev.payload.proposal.kind,
          'classify-node',
          'capture-node must not co-bundle a classify-node proposal',
        );
        assert.notEqual(
          ev.payload.proposal.kind,
          'set-edge-substance',
          'capture-node must not co-bundle a set-edge-substance proposal',
        );
      }
    }
  },
);
