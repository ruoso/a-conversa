// Steps for tests/behavior/methodology/propose-annotate.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `annotate` arm (`apps/server/src/methodology/handlers/propose.ts` —
// the `validateAnnotateProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeAnnotate.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-annotate action against the resulting
// projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`). The shared `When 'the
// methodology engine validates the propose action against the projected
// session'` step is reused from `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/annotation_logic.md

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

// Distinct UUID prefix (`c3...`) to avoid scratch-state collisions with
// the prior propose-* step files (propose-decompose `e0...`,
// propose-interpretive-split `f0...`, propose-axiom-mark `a1...`,
// propose-meta-move `b2...`, etc.). All share the same Cucumber World
// so the prefixes keep their SQL rows in separate sessions.
const PA_SESSION_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PA_HOST_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PA_DEBATER_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PA_DEBATER_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PA_NODE_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PA_NODE_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PA_EDGE_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const PA_UNKNOWN_NODE_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee0aa';
const PA_NEW_EVENT_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee007';

// Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
// (Decision §1 wire widening). The candidate-annotation ids backing the
// annotation-of-annotation scenarios.
const PA_ANNOTATION_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee008';
const PA_NEW_EVENT_ID_ANNOTATION = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee009';

const TS_BASE = '2026-05-10T23:30:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PA_HOST_ID, sub: 'fixture-pa:host', name: 'host' },
    { id: PA_DEBATER_A_ID, sub: 'fixture-pa:a', name: 'a' },
    { id: PA_DEBATER_B_ID, sub: 'fixture-pa:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PA_SESSION_ID, PA_HOST_ID, 'public', 'Propose-annotate behavior tests'],
  );

  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1201),
    sequence: 1,
    kind: 'session-created',
    actor: PA_HOST_ID,
    payload: {
      host_user_id: PA_HOST_ID,
      privacy: 'public',
      topic: 'Propose-annotate behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1202),
    sequence: 2,
    kind: 'participant-joined',
    actor: PA_HOST_ID,
    payload: {
      user_id: PA_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1203),
    sequence: 3,
    kind: 'participant-joined',
    actor: PA_DEBATER_A_ID,
    payload: {
      user_id: PA_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1204),
    sequence: 4,
    kind: 'participant-joined',
    actor: PA_DEBATER_B_ID,
    payload: {
      user_id: PA_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertCandidateNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1205),
    sequence: 5,
    kind: 'node-created',
    actor: PA_DEBATER_A_ID,
    payload: {
      node_id: PA_NODE_A_ID,
      wording: 'A candidate node for annotate tests.',
      created_by: PA_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function insertEdgePair(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1206),
    sequence: 6,
    kind: 'node-created',
    actor: PA_DEBATER_B_ID,
    payload: {
      node_id: PA_NODE_B_ID,
      wording: 'A second candidate node (edge source).',
      created_by: PA_DEBATER_B_ID,
      created_at: tsAt(5),
    },
    createdAt: tsAt(5),
  });
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1207),
    sequence: 7,
    kind: 'edge-created',
    actor: PA_DEBATER_B_ID,
    payload: {
      edge_id: PA_EDGE_ID,
      role: 'supports',
      source_node_id: PA_NODE_B_ID,
      target_node_id: PA_NODE_A_ID,
      created_by: PA_DEBATER_B_ID,
      created_at: tsAt(6),
    },
    createdAt: tsAt(6),
  });
}

async function insertCandidateAnnotation(world: AConversaWorld): Promise<void> {
  // First-order annotation targeting NODE_A. This is the candidate target
  // for the annotation-of-annotation scenarios — a second-order annotate
  // proposal aims at this annotation's id.
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1208),
    sequence: 6,
    kind: 'annotation-created',
    actor: PA_DEBATER_A_ID,
    payload: {
      annotation_id: PA_ANNOTATION_A_ID,
      kind: 'note',
      content: 'A first-order annotation that participants want to react to.',
      target_node_id: PA_NODE_A_ID,
      target_edge_id: null,
      created_by: PA_DEBATER_A_ID,
      created_at: tsAt(7),
    },
    createdAt: tsAt(7),
  });
}

async function insertEntityRemovedForAnnotation(world: AConversaWorld): Promise<void> {
  // Drive the annotation invisible via an `entity-removed(annotation)`
  // event. Mirrors the projection's set-visible-false path the validator
  // consults via `entityIsVisible(projection, 'annotation', id)`.
  await insertEventRow(world, PA_SESSION_ID, {
    id: evId(1209),
    sequence: 7,
    kind: 'entity-removed',
    actor: PA_HOST_ID,
    payload: {
      entity_kind: 'annotation',
      entity_id: PA_ANNOTATION_A_ID,
      removed_by: PA_HOST_ID,
      removed_at: tsAt(8),
    },
    createdAt: tsAt(8),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PA_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PA_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate node for propose-annotate tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a visible candidate edge for propose-annotate tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertEdgePair(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and no candidate node for propose-annotate tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // No node-created event — the target_id referenced in the propose
    // action will not resolve in the projection.
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
// (Decision §1 wire widening). The visible-annotation scenario seeds a
// first-order annotation targeting NODE_A so a second-order annotate
// proposal can name its id; the invisible-annotation scenario follows up
// with an `entity-removed(annotation)` event so the projection's
// `entityIsVisible(projection, 'annotation', id)` returns false.

Given(
  'a seeded session with three participants and a visible candidate annotation for propose-annotate tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertCandidateAnnotation(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and an invisible target annotation for propose-annotate tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    await insertCandidateAnnotation(this);
    await insertEntityRemovedForAnnotation(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-annotate action against the visible node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PA_DEBATER_A_ID,
      sessionId: PA_SESSION_ID,
      eventId: PA_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PA_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: PA_NODE_A_ID,
        annotation_kind: 'note',
        content: 'Recording context that participants want preserved alongside this claim.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-annotate action against the visible edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PA_DEBATER_A_ID,
      sessionId: PA_SESSION_ID,
      eventId: PA_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PA_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'annotate',
        target_kind: 'edge',
        target_id: PA_EDGE_ID,
        annotation_kind: 'reframe',
        content: 'This support relationship is doing more work than it should.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-annotate action against an unknown node target',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PA_DEBATER_A_ID,
      sessionId: PA_SESSION_ID,
      eventId: PA_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PA_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: PA_UNKNOWN_NODE_ID,
        annotation_kind: 'note',
        content: 'A note against a target that does not exist.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-annotate action against the visible annotation',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PA_DEBATER_A_ID,
      sessionId: PA_SESSION_ID,
      eventId: PA_NEW_EVENT_ID_ANNOTATION,
      sequence: nextSequence(projection),
      actor: PA_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'annotate',
        target_kind: 'annotation',
        target_id: PA_ANNOTATION_A_ID,
        annotation_kind: 'reframe',
        content: 'A second-order annotation that reframes the first.',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-annotate action against the invisible annotation',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PA_DEBATER_A_ID,
      sessionId: PA_SESSION_ID,
      eventId: PA_NEW_EVENT_ID_ANNOTATION,
      sequence: nextSequence(projection),
      actor: PA_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'annotate',
        target_kind: 'annotation',
        target_id: PA_ANNOTATION_A_ID,
        annotation_kind: 'stance',
        content: 'A disagreement on the (now-invisible) annotation.',
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
  'the result carries a single proposal event for the annotate action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PA_SESSION_ID);
    assert.equal(ev.id, PA_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'annotate');
      if (inner.kind === 'annotate') {
        assert.equal(inner.annotation_kind, 'note');
        assert.equal(inner.target_kind, 'node');
        assert.equal(inner.target_id, PA_NODE_A_ID);
      }
    }
  },
);

Then(
  'the result carries a single proposal event for the annotate action targeting the edge',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PA_SESSION_ID);
    assert.equal(ev.id, PA_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'annotate');
      if (inner.kind === 'annotate') {
        assert.equal(inner.annotation_kind, 'reframe');
        assert.equal(inner.target_kind, 'edge');
        assert.equal(inner.target_id, PA_EDGE_ID);
      }
    }
  },
);

Then(
  'the result carries a single proposal event for the annotate action targeting the annotation',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PA_SESSION_ID);
    assert.equal(ev.id, PA_NEW_EVENT_ID_ANNOTATION);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'annotate');
      if (inner.kind === 'annotate') {
        assert.equal(inner.annotation_kind, 'reframe');
        assert.equal(inner.target_kind, 'annotation');
        assert.equal(inner.target_id, PA_ANNOTATION_A_ID);
      }
    }
  },
);
