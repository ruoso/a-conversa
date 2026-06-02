// Steps for tests/behavior/methodology/propose-meta-move.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `meta-move` arm (`apps/server/src/methodology/handlers/propose.ts`
// — the `validateMetaMoveProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeMetaMove.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-meta-move action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`). The shared `When 'the
// methodology engine validates the propose action against the projected
// session'` step is reused from `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/meta_move_logic.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  projectFromLog,
  type Event,
  type Projection,
} from '../../../apps/server/src/projection/index.js';
import {
  nextSequence,
  type ProposeAction,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix (`b2...`) to avoid scratch-state collisions with
// the propose-decompose (`e0...`), propose-interpretive-split (`f0...`),
// and propose-axiom-mark (`a1...`) step files. All four share the same
// Cucumber World so the prefixes keep their SQL rows in separate
// sessions.
const PMM_SESSION_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PMM_HOST_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PMM_DEBATER_A_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PMM_DEBATER_B_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PMM_NODE_A_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PMM_NODE_B_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PMM_EDGE_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const PMM_UNKNOWN_NODE_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee0aa';
const PMM_NEW_EVENT_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee007';
const PMM_ANNOTATION_ID = 'b2eeeeee-eeee-4eee-8eee-eeeeeeeee008';

const TS_BASE = '2026-05-10T23:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PMM_HOST_ID, sub: 'fixture-pmm:host', name: 'host' },
    { id: PMM_DEBATER_A_ID, sub: 'fixture-pmm:a', name: 'a' },
    { id: PMM_DEBATER_B_ID, sub: 'fixture-pmm:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PMM_SESSION_ID, PMM_HOST_ID, 'public', 'Propose-meta-move behavior tests'],
  );

  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1101),
    sequence: 1,
    kind: 'session-created',
    actor: PMM_HOST_ID,
    payload: {
      host_user_id: PMM_HOST_ID,
      privacy: 'public',
      topic: 'Propose-meta-move behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1102),
    sequence: 2,
    kind: 'participant-joined',
    actor: PMM_HOST_ID,
    payload: {
      user_id: PMM_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1103),
    sequence: 3,
    kind: 'participant-joined',
    actor: PMM_DEBATER_A_ID,
    payload: {
      user_id: PMM_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1104),
    sequence: 4,
    kind: 'participant-joined',
    actor: PMM_DEBATER_B_ID,
    payload: {
      user_id: PMM_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertCandidateNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1105),
    sequence: 5,
    kind: 'node-created',
    actor: PMM_DEBATER_A_ID,
    payload: {
      node_id: PMM_NODE_A_ID,
      wording: 'A candidate node for meta-move tests.',
      created_by: PMM_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function insertAnnotationOnNodeA(world: AConversaWorld): Promise<void> {
  // Annotation hanging off NODE_A — the cross-layer pin scenario (ADR
  // 0036) needs an annotation id present in projection so the rejection
  // path can be exercised distinctly from the "unknown id" scenario.
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1108),
    sequence: 6,
    kind: 'annotation-created',
    actor: PMM_DEBATER_A_ID,
    payload: {
      annotation_id: PMM_ANNOTATION_ID,
      kind: 'note',
      content: 'A note hanging off the candidate node.',
      target_node_id: PMM_NODE_A_ID,
      target_edge_id: null,
      created_by: PMM_DEBATER_A_ID,
      created_at: tsAt(5),
    },
    createdAt: tsAt(5),
  });
}

async function insertEdgePair(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1106),
    sequence: 6,
    kind: 'node-created',
    actor: PMM_DEBATER_B_ID,
    payload: {
      node_id: PMM_NODE_B_ID,
      wording: 'A second candidate node (edge source).',
      created_by: PMM_DEBATER_B_ID,
      created_at: tsAt(5),
    },
    createdAt: tsAt(5),
  });
  await insertEventRow(world, PMM_SESSION_ID, {
    id: evId(1107),
    sequence: 7,
    kind: 'edge-created',
    actor: PMM_DEBATER_B_ID,
    payload: {
      edge_id: PMM_EDGE_ID,
      role: 'supports',
      source_node_id: PMM_NODE_B_ID,
      target_node_id: PMM_NODE_A_ID,
      created_by: PMM_DEBATER_B_ID,
      created_at: tsAt(6),
    },
    createdAt: tsAt(6),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PMM_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PMM_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate node for propose-meta-move tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a visible candidate edge for propose-meta-move tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertEdgePair(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and no candidate node for propose-meta-move tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // No node-created event — the target_id referenced in the propose
    // action will not resolve in the projection.
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants, a visible node, and an annotation hanging off it for propose-meta-move tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertAnnotationOnNodeA(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-meta-move action against the visible node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PMM_DEBATER_A_ID,
      sessionId: PMM_SESSION_ID,
      eventId: PMM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PMM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'The real question is the operational form, not the surface phrasing.',
        target_kind: 'node',
        target_id: PMM_NODE_A_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-meta-move action against the visible edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PMM_DEBATER_A_ID,
      sessionId: PMM_SESSION_ID,
      eventId: PMM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PMM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'meta-move',
        meta_kind: 'scope-change',
        content: 'We should be defending the typical case, not the edge case.',
        target_kind: 'edge',
        target_id: PMM_EDGE_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  "a debater constructs a propose-meta-move action carrying the annotation id under target_kind 'node'",
  function (this: AConversaWorld) {
    // ADR 0036 / refinement mod_meta_move_annotation_target_gesture §3
    // — the cross-layer rule pin. A misbehaving client could in
    // principle send `target_kind: 'node'` with an annotation id as
    // `target_id`; the engine's projection has no `getAnnotation`
    // accessor on the node-resolution path, so the validator's rule 1
    // returns `target-entity-not-found`.
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PMM_DEBATER_A_ID,
      sessionId: PMM_SESSION_ID,
      eventId: PMM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PMM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'An annotation id smuggled in under target_kind: node.',
        target_kind: 'node',
        target_id: PMM_ANNOTATION_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-meta-move action against an unknown node target',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PMM_DEBATER_A_ID,
      sessionId: PMM_SESSION_ID,
      eventId: PMM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PMM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'A reframe against a target that does not exist.',
        target_kind: 'node',
        target_id: PMM_UNKNOWN_NODE_ID,
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
  'the result carries a single proposal event for the meta-move action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PMM_SESSION_ID);
    assert.equal(ev.id, PMM_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'meta-move');
      if (inner.kind === 'meta-move') {
        assert.equal(inner.meta_kind, 'reframe');
        assert.equal(inner.target_kind, 'node');
        assert.equal(inner.target_id, PMM_NODE_A_ID);
      }
    }
  },
);

Then(
  'the result carries a single proposal event for the meta-move action targeting the edge',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PMM_SESSION_ID);
    assert.equal(ev.id, PMM_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'meta-move');
      if (inner.kind === 'meta-move') {
        assert.equal(inner.meta_kind, 'scope-change');
        assert.equal(inner.target_kind, 'edge');
        assert.equal(inner.target_id, PMM_EDGE_ID);
      }
    }
  },
);
