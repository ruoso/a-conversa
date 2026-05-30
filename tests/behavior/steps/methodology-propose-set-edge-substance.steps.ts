// Steps for tests/behavior/methodology/propose-set-edge-substance.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `set-edge-substance` arm (`apps/server/src/methodology/handlers/propose.ts`).
// The Vitest tests at
// `apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts`
// cover the in-memory rule set (including the polymorphic Phase 1
// symmetry, Phase 2a/2b/2c, and happy paths for node→annotation /
// annotation→node / annotation→annotation). This file covers the DB-
// driven integration path per `set_edge_substance_annotation_endpoint`
// D8: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-set-edge-substance action against
// the resulting projection. Replaying the concatenated log
// (original + freshly-emitted events) yields a projected edge with
// polymorphic endpoints.
//
// The shared "Then the validation result is Valid" step is reused
// from `methodology-engine.steps.ts`. The shared "validates the
// propose action against the projected session" step is reused from
// `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/set_edge_substance_annotation_endpoint.md

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

// Distinct UUID prefix (`e5...`) to avoid scratch-state collisions
// with the prior propose-* step files.
const SES_SESSION_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const SES_HOST_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const SES_MODERATOR_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const SES_DEBATER_A_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee003';
const SES_DEBATER_B_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee004';

const SES_SOURCE_NODE_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const SES_TARGET_ANNOTATION_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const SES_FRESH_EDGE_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee007';
const SES_NEW_EVENT_ID = 'e5eeeeee-eeee-4eee-8eee-eeeeeeeee008';

const TS_BASE = '2026-05-12T00:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, SES_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, SES_SESSION_ID);
}

Given(
  'a seeded session with three participants, a visible source node, and a visible target annotation',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: SES_HOST_ID, sub: 'fixture-ses:host', name: 'host' },
      { id: SES_MODERATOR_ID, sub: 'fixture-ses:mod', name: 'mod' },
      { id: SES_DEBATER_A_ID, sub: 'fixture-ses:a', name: 'a' },
      { id: SES_DEBATER_B_ID, sub: 'fixture-ses:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [
        SES_SESSION_ID,
        SES_HOST_ID,
        'public',
        'Propose set-edge-substance annotation-endpoint tests',
      ],
    );

    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1401),
      sequence: 1,
      kind: 'session-created',
      actor: SES_HOST_ID,
      payload: {
        host_user_id: SES_HOST_ID,
        privacy: 'public',
        topic: 'Propose set-edge-substance annotation-endpoint tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1402),
      sequence: 2,
      kind: 'participant-joined',
      actor: SES_MODERATOR_ID,
      payload: {
        user_id: SES_MODERATOR_ID,
        role: 'moderator',
        screen_name: 'mod',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1403),
      sequence: 3,
      kind: 'participant-joined',
      actor: SES_DEBATER_A_ID,
      payload: {
        user_id: SES_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1404),
      sequence: 4,
      kind: 'participant-joined',
      actor: SES_DEBATER_B_ID,
      payload: {
        user_id: SES_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1405),
      sequence: 5,
      kind: 'node-created',
      actor: SES_DEBATER_A_ID,
      payload: {
        node_id: SES_SOURCE_NODE_ID,
        wording: 'Source node for the polymorphic edge.',
        created_by: SES_DEBATER_A_ID,
        created_at: tsAt(4),
      },
      createdAt: tsAt(4),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1406),
      sequence: 6,
      kind: 'entity-included',
      actor: SES_DEBATER_A_ID,
      payload: {
        entity_kind: 'node',
        entity_id: SES_SOURCE_NODE_ID,
        included_by: SES_DEBATER_A_ID,
        included_at: tsAt(4),
      },
      createdAt: tsAt(4),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1407),
      sequence: 7,
      kind: 'annotation-created',
      actor: SES_DEBATER_B_ID,
      payload: {
        annotation_id: SES_TARGET_ANNOTATION_ID,
        kind: 'note',
        content: 'Annotation that the new edge points at.',
        target_node_id: SES_SOURCE_NODE_ID,
        target_edge_id: null,
        created_by: SES_DEBATER_B_ID,
        created_at: tsAt(5),
      },
      createdAt: tsAt(5),
    });
    await insertEventRow(this, SES_SESSION_ID, {
      id: evId(1408),
      sequence: 8,
      kind: 'entity-included',
      actor: SES_DEBATER_B_ID,
      payload: {
        entity_kind: 'annotation',
        entity_id: SES_TARGET_ANNOTATION_ID,
        included_by: SES_DEBATER_B_ID,
        included_at: tsAt(5),
      },
      createdAt: tsAt(5),
    });
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

When(
  'the moderator constructs a set-edge-substance propose action whose target is the annotation',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: SES_MODERATOR_ID,
      sessionId: SES_SESSION_ID,
      eventId: SES_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: SES_MODERATOR_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'set-edge-substance',
        edge_id: SES_FRESH_EDGE_ID,
        value: 'agreed',
        source_node_id: SES_SOURCE_NODE_ID,
        target_annotation_id: SES_TARGET_ANNOTATION_ID,
        role: 'contradicts',
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

Then(
  'the result carries exactly 3 events — edge-created, entity-included, and the set-edge-substance proposal envelope',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(
      result.events.length,
      3,
      `expected exactly 3 events, got ${String(result.events.length)}`,
    );
    const [edgeCreated, entityIncluded, proposalEvent] = result.events as [Event, Event, Event];
    assert.equal(edgeCreated.kind, 'edge-created');
    assert.equal(entityIncluded.kind, 'entity-included');
    assert.equal(proposalEvent.kind, 'proposal');
    if (proposalEvent.kind === 'proposal') {
      assert.equal(proposalEvent.payload.proposal.kind, 'set-edge-substance');
    }
  },
);

Then(
  'the emitted edge-created event carries source_node_id and target_annotation_id with the node-side and annotation-side slots empty for their opposites',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok);
    if (!result.ok) return;
    const edgeCreated = result.events[0]!;
    assert.equal(edgeCreated.kind, 'edge-created');
    if (edgeCreated.kind === 'edge-created') {
      const payload = edgeCreated.payload;
      assert.equal(payload.source_node_id, SES_SOURCE_NODE_ID);
      assert.equal(payload.target_annotation_id, SES_TARGET_ANNOTATION_ID);
      assert.equal(payload.source_annotation_id, undefined);
      assert.equal(payload.target_node_id, undefined);
      assert.equal(payload.role, 'contradicts');
    }
  },
);

Then(
  'replaying the concatenated log yields a projected edge whose source is the node and whose target is the annotation',
  async function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok);
    if (!result.ok) return;

    const rows = await selectEvents(this, SES_SESSION_ID);
    const original: Event[] = rows.map(rowToValidatedEvent);
    const appended: Event[] = [...result.events];
    const finalProjection = projectFromLog([...original, ...appended], SES_SESSION_ID);
    const edge = finalProjection.getEdge(SES_FRESH_EDGE_ID);
    assert.ok(edge !== undefined, 'fresh edge must be on the post-emit projection');
    if (edge !== undefined) {
      assert.equal(edge.sourceNodeId, SES_SOURCE_NODE_ID);
      assert.equal(edge.sourceAnnotationId, null);
      assert.equal(edge.targetNodeId, null);
      assert.equal(edge.targetAnnotationId, SES_TARGET_ANNOTATION_ID);
      assert.equal(edge.role, 'contradicts');
    }
  },
);
