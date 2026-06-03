// Steps for tests/behavior/methodology/commit-meta-move.feature.
//
// The behavior-test layer for the methodology engine's commit handler
// (`apps/server/src/methodology/handlers/commit.ts`), meta-move arm of
// `buildStructuralEventsForCommit`. The Vitest tests at
// `apps/server/src/methodology/handlers/commit.test.ts` cover the
// in-memory event-shaping. This file covers the DB-driven protocol
// seam: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, call
// `validateAction` with a commit action against the meta-move proposal,
// then append the emitted `annotation-created` + `commit` events and
// re-project so the annotation surfaces on the target node/edge.
//
// The shared `When 'the methodology engine validates the commit action
// against the projected session'` step (reads `this.scratch['commitProjection']`
// / `this.scratch['commitAction']`, writes `this.scratch['methodologyResult']`)
// and the shared `Then 'the validation result is Valid'` step are reused
// from `methodology-commit.steps.ts` / `methodology-engine.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/meta_move_commit_logic.md

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
  validateAction,
  type CommitAction,
  type ValidationResult,
  type VoteAction,
} from '../../../apps/server/src/methodology/index.js';
import { computeFacetStatuses } from '../../../packages/shell/src/index.js';

// Distinct UUID prefix (`c3...`) to avoid scratch-state / SQL-row
// collisions with the other methodology step files that share the
// Cucumber World.
const CMM_SESSION_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const CMM_HOST_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const CMM_DEBATER_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const CMM_DEBATER_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const CMM_NODE_A_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const CMM_NODE_B_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const CMM_EDGE_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const CMM_PROPOSAL_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee007';
const CMM_NEW_EVENT_ID = 'c3eeeeee-eeee-4eee-8eee-eeeeeeeee008';

const TS_BASE = '2026-05-10T18:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: CMM_HOST_ID, sub: 'fixture-cmm:host', name: 'host' },
    { id: CMM_DEBATER_A_ID, sub: 'fixture-cmm:a', name: 'a' },
    { id: CMM_DEBATER_B_ID, sub: 'fixture-cmm:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [CMM_SESSION_ID, CMM_HOST_ID, 'public', 'Commit-meta-move behavior tests'],
  );

  await insertEventRow(world, CMM_SESSION_ID, {
    id: evId(1301),
    sequence: 1,
    kind: 'session-created',
    actor: CMM_HOST_ID,
    payload: {
      host_user_id: CMM_HOST_ID,
      privacy: 'public',
      topic: 'Commit-meta-move behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, CMM_SESSION_ID, {
    id: evId(1302),
    sequence: 2,
    kind: 'participant-joined',
    actor: CMM_HOST_ID,
    payload: { user_id: CMM_HOST_ID, role: 'moderator', screen_name: 'host', joined_at: tsAt(1) },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, CMM_SESSION_ID, {
    id: evId(1303),
    sequence: 3,
    kind: 'participant-joined',
    actor: CMM_DEBATER_A_ID,
    payload: { user_id: CMM_DEBATER_A_ID, role: 'debater-A', screen_name: 'a', joined_at: tsAt(2) },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, CMM_SESSION_ID, {
    id: evId(1304),
    sequence: 4,
    kind: 'participant-joined',
    actor: CMM_DEBATER_B_ID,
    payload: { user_id: CMM_DEBATER_B_ID, role: 'debater-B', screen_name: 'b', joined_at: tsAt(3) },
    createdAt: tsAt(3),
  });
}

// Insert the next-sequence node and return the sequence it landed at.
async function insertNode(
  world: AConversaWorld,
  ordinal: number,
  sequence: number,
  nodeId: string,
  wording: string,
  actor: string,
  tsOffset: number,
): Promise<void> {
  await insertEventRow(world, CMM_SESSION_ID, {
    id: evId(ordinal),
    sequence,
    kind: 'node-created',
    actor,
    payload: { node_id: nodeId, wording, created_by: actor, created_at: tsAt(tsOffset) },
    createdAt: tsAt(tsOffset),
  });
}

async function insertMetaMoveProposal(
  world: AConversaWorld,
  sequence: number,
  metaKind: 'reframe' | 'scope-change' | 'stance',
  content: string,
  targetKind: 'node' | 'edge',
  targetId: string,
  tsOffset: number,
): Promise<void> {
  await insertEventRow(world, CMM_SESSION_ID, {
    id: CMM_PROPOSAL_ID,
    sequence,
    kind: 'proposal',
    actor: CMM_DEBATER_A_ID,
    payload: {
      proposal: {
        kind: 'meta-move',
        meta_kind: metaKind,
        content,
        target_kind: targetKind,
        target_id: targetId,
      },
    },
    createdAt: tsAt(tsOffset),
  });
}

async function insertAgreeVotes(
  world: AConversaWorld,
  firstOrdinal: number,
  firstSequence: number,
  firstTsOffset: number,
): Promise<void> {
  const voters = [CMM_HOST_ID, CMM_DEBATER_A_ID, CMM_DEBATER_B_ID];
  for (let i = 0; i < voters.length; i++) {
    const participant = voters[i]!;
    await insertEventRow(world, CMM_SESSION_ID, {
      id: evId(firstOrdinal + i),
      sequence: firstSequence + i,
      kind: 'vote',
      actor: participant,
      payload: {
        target: 'proposal' as const,
        proposal_id: CMM_PROPOSAL_ID,
        participant,
        choice: 'agree' as const,
        voted_at: tsAt(firstTsOffset + i),
      },
      createdAt: tsAt(firstTsOffset + i),
    });
  }
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, CMM_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, CMM_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants, a visible node, a pending reframe meta-move proposal, and three agree votes for commit-meta-move tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertNode(
      this,
      1305,
      5,
      CMM_NODE_A_ID,
      'A proposition for commit-meta-move tests.',
      CMM_DEBATER_A_ID,
      4,
    );
    await insertMetaMoveProposal(
      this,
      6,
      'reframe',
      'The real question is the operational form, not the surface phrasing.',
      'node',
      CMM_NODE_A_ID,
      5,
    );
    await insertAgreeVotes(this, 1311, 7, 6);
    this.scratch['commitProjection'] = await projectFromDb(this);
    this.scratch['cmmTargetKind'] = 'node';
    this.scratch['cmmTargetId'] = CMM_NODE_A_ID;
  },
);

Given(
  'a seeded session with three participants, a visible edge, a pending scope-change meta-move proposal, and three agree votes for commit-meta-move tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertNode(
      this,
      1305,
      5,
      CMM_NODE_A_ID,
      'Edge source node for commit-meta-move tests.',
      CMM_DEBATER_A_ID,
      4,
    );
    await insertNode(
      this,
      1306,
      6,
      CMM_NODE_B_ID,
      'Edge target node for commit-meta-move tests.',
      CMM_DEBATER_B_ID,
      5,
    );
    await insertEventRow(this, CMM_SESSION_ID, {
      id: evId(1307),
      sequence: 7,
      kind: 'edge-created',
      actor: CMM_DEBATER_A_ID,
      payload: {
        edge_id: CMM_EDGE_ID,
        role: 'supports',
        source_node_id: CMM_NODE_A_ID,
        target_node_id: CMM_NODE_B_ID,
        created_by: CMM_DEBATER_A_ID,
        created_at: tsAt(6),
      },
      createdAt: tsAt(6),
    });
    await insertMetaMoveProposal(
      this,
      8,
      'scope-change',
      'We should be defending the typical case, not the edge case.',
      'edge',
      CMM_EDGE_ID,
      7,
    );
    await insertAgreeVotes(this, 1311, 9, 8);
    this.scratch['commitProjection'] = await projectFromDb(this);
    this.scratch['cmmTargetKind'] = 'edge';
    this.scratch['cmmTargetId'] = CMM_EDGE_ID;
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'the moderator constructs a commit action against the meta-move proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['commitProjection'] as Projection;
    // Meta-move is a structural sub-kind → proposal-keyed commit per
    // ADR 0030 §2/§9 (no facet target).
    const action: CommitAction = {
      kind: 'commit',
      target: 'proposal',
      requester: CMM_HOST_ID,
      sessionId: CMM_SESSION_ID,
      eventId: CMM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: CMM_HOST_ID,
      createdAt: tsAt(20),
      proposalEventId: CMM_PROPOSAL_ID,
      committedAt: tsAt(20),
    };
    this.scratch['commitAction'] = action;
  },
);

// `When 'the methodology engine validates the commit action against the
// projected session'` is reused from `methodology-commit.steps.ts`.

When(
  'the resulting meta-move events are appended to the session log and the projection is replayed',
  async function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid before appending, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    // [annotation-created, commit] — append both, in order, so the
    // round-tripped log carries the annotation ahead of the commit.
    assert.equal(result.events.length, 2, 'expected exactly two events to append');
    for (const ev of result.events) {
      await insertEventRow(this, CMM_SESSION_ID, {
        id: ev.id,
        sequence: ev.sequence,
        kind: ev.kind,
        actor: ev.actor,
        payload: ev.payload,
        createdAt: ev.createdAt,
      });
    }
    // Re-project the full log so the annotation is read back from the
    // round-tripped JSONB column (the schema-seam pin).
    this.scratch['commitProjection'] = await projectFromDb(this);
  },
);

When(
  "a participant casts a facet-keyed dispute vote on the resulting annotation's substance and it is appended and replayed",
  async function (this: AConversaWorld) {
    // ADR 0038: a committed annotation's `substance` facet is disputable
    // post-commit via a facet-keyed `entity_kind: 'annotation'` vote. Run
    // the dispute through the real engine vote handler against the
    // DB-projected session (exercising the annotation arm of
    // `facetStateForTarget` + the committed-facet gate divergence), then
    // round-trip the emitted event through pglite and re-project.
    const annotationId = this.scratch['cmmAnnotationId'] as string;
    const projection = this.scratch['commitProjection'] as Projection;
    const action: VoteAction = {
      kind: 'vote',
      target: 'facet',
      requester: CMM_DEBATER_A_ID,
      sessionId: CMM_SESSION_ID,
      eventId: evId(1330),
      sequence: nextSequence(projection),
      actor: CMM_DEBATER_A_ID,
      createdAt: tsAt(30),
      entityKind: 'annotation',
      entityId: annotationId,
      facet: 'substance',
      vote: 'dispute',
      votedAt: tsAt(30),
    };
    const result = validateAction(projection, action);
    assert.ok(result.ok, `expected Valid annotation dispute vote, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one vote event');
    const ev = result.events[0]!;
    await insertEventRow(this, CMM_SESSION_ID, {
      id: ev.id,
      sequence: ev.sequence,
      kind: ev.kind,
      actor: ev.actor,
      payload: ev.payload,
      createdAt: ev.createdAt,
    });
    this.scratch['commitProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then(
  /^the result carries an annotation-created event of kind "([^"]+)" on the (node|edge) ahead of the commit event$/,
  function (this: AConversaWorld, kind: string, targetType: string) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 2, 'expected [annotation-created, commit]');
    const annotationEvent = result.events[0]!;
    const commitEvent = result.events[1]!;
    assert.equal(annotationEvent.kind, 'annotation-created');
    assert.equal(commitEvent.kind, 'commit');
    if (annotationEvent.kind !== 'annotation-created') return;
    const targetId = this.scratch['cmmTargetId'] as string;
    assert.equal(annotationEvent.payload.kind, kind);
    if (targetType === 'edge') {
      assert.equal(annotationEvent.payload.target_edge_id, targetId);
      assert.equal(annotationEvent.payload.target_node_id, null);
    } else {
      assert.equal(annotationEvent.payload.target_node_id, targetId);
      assert.equal(annotationEvent.payload.target_edge_id, null);
    }
    // Stash the minted annotation id for the replay assertion.
    this.scratch['cmmAnnotationId'] = annotationEvent.payload.annotation_id;
  },
);

Then(
  /^the resulting annotation's substance facet rolls up to "([^"]+)" after replay$/,
  async function (this: AConversaWorld, expectedStatus: string) {
    // The per-annotation facet status is a pure function of the event
    // log: `computeFacetStatuses` routes the meta-move's per-participant
    // votes onto the resulting annotation's substance facet (correlated
    // by the [annotation-created, commit] adjacency). Re-derive it over
    // the round-tripped DB log — the projection/replay seam.
    // Refinement: tasks/refinements/data-and-methodology/annotation_facet_status_logic.md
    const annotationId = this.scratch['cmmAnnotationId'] as string;
    const rows = await selectEvents(this, CMM_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    const index = computeFacetStatuses(events);
    const statuses = index.annotations.get(annotationId);
    assert.ok(statuses, `expected annotation ${annotationId} in the facet-status index`);
    assert.equal(statuses.substance, expectedStatus);
  },
);

Then(
  /^the projection surfaces a "([^"]+)" annotation on the (node|edge) target$/,
  function (this: AConversaWorld, kind: string, targetType: string) {
    const projection = this.scratch['commitProjection'] as Projection;
    const annotationId = this.scratch['cmmAnnotationId'] as string;
    const targetId = this.scratch['cmmTargetId'] as string;
    const ann = projection.getAnnotation(annotationId);
    assert.ok(ann, `expected annotation ${annotationId} present after replay`);
    assert.equal(ann.kind, kind);
    if (targetType === 'edge') {
      assert.equal(ann.targetEdgeId, targetId);
      assert.equal(ann.targetNodeId, null);
      const indexed = projection.getAnnotationsByEdge(targetId).map((a) => a.id);
      assert.ok(indexed.includes(annotationId), 'annotation indexed against its target edge');
    } else {
      assert.equal(ann.targetNodeId, targetId);
      assert.equal(ann.targetEdgeId, null);
      const indexed = projection.getAnnotationsByNode(targetId).map((a) => a.id);
      assert.ok(indexed.includes(annotationId), 'annotation indexed against its target node');
    }
  },
);
