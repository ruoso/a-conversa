// Steps for tests/behavior/methodology/commit-interpretive-split.feature.
//
// The behavior-test layer for ADR 0046's interpretive-split edge
// inheritance. The Vitest tests at
// `apps/server/src/methodology/handlers/commit.test.ts` cover the
// commit-time fan-out predicate and
// `apps/server/src/projection/replay.test.ts` covers the carry
// application; this file covers the DB-driven integration path: the
// session's events (including the new `carried_from_edge_id` commit
// payload field) are round-tripped through pglite's `session_events`
// JSONB column, replayed through `projectFromLog`, and the projection
// is asserted across the full propose → vote → commit → replay chain.
//
// The shared `Then 'the validation result is Valid'` step (defined in
// methodology-engine.steps.ts against scratch['methodologyResult']) is
// reused.
//
// Refinement: tasks/refinements/data-and-methodology/interpretive_split_edge_inheritance.md

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
  validateAction,
  type CommitAction,
  type EventToAppend,
  type ValidationResult,
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix (`ad46...`) keeping this file's rows and ids
// apart from the other methodology step files' series (e0/f0/bb...).
const ISI_SESSION_ID = 'ad460000-0000-4000-8000-000000000000';
const ISI_HOST_ID = 'ad460000-0000-4000-8000-000000000001';
const ISI_DEBATER_A_ID = 'ad460000-0000-4000-8000-000000000002';
const ISI_DEBATER_B_ID = 'ad460000-0000-4000-8000-000000000003';

const ISI_PARENT_NODE_ID = 'ad460000-0000-4000-8000-000000000010';
const ISI_TARGET_NODE_ID = 'ad460000-0000-4000-8000-000000000011';
const ISI_READING_NODE_ID_1 = 'ad460000-0000-4000-8000-000000000012';
const ISI_READING_NODE_ID_2 = 'ad460000-0000-4000-8000-000000000013';
const ISI_PARENT_EDGE_ID = 'ad460000-0000-4000-8000-000000000020';

const ISI_SUBSTANCE_PROPOSAL_ID = 'ad460000-0000-4000-8000-000000000030';
const ISI_SPLIT_PROPOSAL_ID = 'ad460000-0000-4000-8000-000000000031';
const ISI_NEW_EVENT_ID = 'ad460000-0000-4000-8000-000000000040';

const TS_BASE = '2026-06-10T16:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, ISI_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, ISI_SESSION_ID);
}

Given(
  'a seeded session with a committed rebut edge and a fully-agreed pending interpretive-split',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: ISI_HOST_ID, sub: 'fixture-isi:host', name: 'host' },
      { id: ISI_DEBATER_A_ID, sub: 'fixture-isi:a', name: 'a' },
      { id: ISI_DEBATER_B_ID, sub: 'fixture-isi:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [ISI_SESSION_ID, ISI_HOST_ID, 'public', 'Interpretive-split edge inheritance tests'],
    );

    let seq = 0;
    const append = async (
      kind: string,
      actor: string,
      payload: Record<string, unknown>,
      id?: string,
    ): Promise<void> => {
      seq += 1;
      await insertEventRow(this, ISI_SESSION_ID, {
        id: id ?? evId(46000 + seq),
        sequence: seq,
        kind,
        actor,
        payload,
        createdAt: tsAt(seq),
      });
    };

    await append('session-created', ISI_HOST_ID, {
      host_user_id: ISI_HOST_ID,
      privacy: 'public',
      topic: 'Interpretive-split edge inheritance tests',
      created_at: tsAt(0),
    });
    for (const [userId, role, name] of [
      [ISI_HOST_ID, 'moderator', 'host'],
      [ISI_DEBATER_A_ID, 'debater-A', 'a'],
      [ISI_DEBATER_B_ID, 'debater-B', 'b'],
    ] as const) {
      await append('participant-joined', userId, {
        user_id: userId,
        role,
        screen_name: name,
        joined_at: tsAt(seq + 1),
      });
    }
    await append('node-created', ISI_DEBATER_A_ID, {
      node_id: ISI_PARENT_NODE_ID,
      wording: 'The parent statement the split re-reads.',
      created_by: ISI_DEBATER_A_ID,
      created_at: tsAt(seq + 1),
    });
    await append('node-created', ISI_DEBATER_B_ID, {
      node_id: ISI_TARGET_NODE_ID,
      wording: 'The statement the parent rebuts.',
      created_by: ISI_DEBATER_B_ID,
      created_at: tsAt(seq + 1),
    });
    // The parent's outgoing rebut edge, substance landed committed:
    // a set-edge-substance proposal supplies the candidate, a
    // facet-keyed commit pins it.
    await append('edge-created', ISI_DEBATER_A_ID, {
      edge_id: ISI_PARENT_EDGE_ID,
      role: 'rebuts',
      source_node_id: ISI_PARENT_NODE_ID,
      target_node_id: ISI_TARGET_NODE_ID,
      created_by: ISI_DEBATER_A_ID,
      created_at: tsAt(seq + 1),
    });
    await append(
      'proposal',
      ISI_DEBATER_A_ID,
      {
        proposal: { kind: 'set-edge-substance', edge_id: ISI_PARENT_EDGE_ID, value: 'agreed' },
      },
      ISI_SUBSTANCE_PROPOSAL_ID,
    );
    await append('commit', ISI_HOST_ID, {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: ISI_PARENT_EDGE_ID,
      facet: 'substance',
      committed_by: ISI_HOST_ID,
      committed_at: tsAt(seq + 1),
    });
    // Propose-time reading fan-out (node-created + entity-included per
    // reading, per ADR 0027) followed by the split proposal envelope.
    for (const [readingId, wording] of [
      [ISI_READING_NODE_ID_1, 'Reading one (epistemic).'],
      [ISI_READING_NODE_ID_2, 'Reading two (metaphysical).'],
    ] as const) {
      await append('node-created', ISI_DEBATER_A_ID, {
        node_id: readingId,
        wording,
        created_by: ISI_DEBATER_A_ID,
        created_at: tsAt(seq + 1),
      });
      await append('entity-included', ISI_DEBATER_A_ID, {
        entity_kind: 'node',
        entity_id: readingId,
        included_by: ISI_DEBATER_A_ID,
        included_at: tsAt(seq + 1),
      });
    }
    await append(
      'proposal',
      ISI_DEBATER_A_ID,
      {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: ISI_PARENT_NODE_ID,
          readings: [
            {
              wording: 'Reading one (epistemic).',
              classification: 'predictive',
              node_id: ISI_READING_NODE_ID_1,
            },
            {
              wording: 'Reading two (metaphysical).',
              classification: 'normative',
              node_id: ISI_READING_NODE_ID_2,
            },
          ],
        },
      },
      ISI_SPLIT_PROPOSAL_ID,
    );
    // Unanimous agree across the current debaters (the moderator's
    // commit IS their act of agreement; they don't vote).
    for (const participant of [ISI_DEBATER_A_ID, ISI_DEBATER_B_ID]) {
      await append('vote', participant, {
        target: 'proposal',
        proposal_id: ISI_SPLIT_PROPOSAL_ID,
        participant,
        choice: 'agree',
        voted_at: tsAt(seq + 1),
      });
    }
    this.scratch['isiProjection'] = await projectFromDb(this);
  },
);

When(
  'the moderator constructs a commit action against the pending interpretive-split',
  function (this: AConversaWorld) {
    const projection = this.scratch['isiProjection'] as Projection;
    const action: CommitAction = {
      kind: 'commit',
      requester: ISI_HOST_ID,
      sessionId: ISI_SESSION_ID,
      eventId: ISI_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: ISI_HOST_ID,
      createdAt: tsAt(100),
      committedAt: tsAt(100),
      target: 'proposal',
      proposalEventId: ISI_SPLIT_PROPOSAL_ID,
    };
    this.scratch['isiAction'] = action;
  },
);

When(
  'the methodology engine validates the interpretive-split commit against the projected session',
  function (this: AConversaWorld) {
    const projection = this.scratch['isiProjection'] as Projection;
    const action = this.scratch['isiAction'] as CommitAction;
    this.scratch['methodologyResult'] = validateAction(projection, action);
  },
);

Then(
  'the result carries the inherited-edge cluster before the proposal-keyed commit',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    // 2 readings × 1 qualifying edge × (edge-created + entity-included
    // + carried facet commit) + the proposal-keyed commit envelope.
    assert.equal(result.events.length, 7, 'expected 7 events (2 × 3-event cluster + commit)');
    assert.deepEqual(
      result.events.map((ev) => ev.kind),
      [
        'edge-created',
        'entity-included',
        'commit',
        'edge-created',
        'entity-included',
        'commit',
        'commit',
      ],
    );
    const readingIds = [ISI_READING_NODE_ID_1, ISI_READING_NODE_ID_2];
    for (let i = 0; i < 2; i++) {
      // Explicit annotations: the asserts in the loop body otherwise
      // make these initializers circular for inference (TS7022).
      const created: EventToAppend = result.events[i * 3]!;
      const carried: EventToAppend = result.events[i * 3 + 2]!;
      if (created.kind === 'edge-created') {
        assert.equal(created.payload.role, 'rebuts');
        assert.equal(created.payload.source_node_id, readingIds[i]);
        assert.equal(created.payload.target_node_id, ISI_TARGET_NODE_ID);
        assert.notEqual(created.payload.edge_id, ISI_PARENT_EDGE_ID);
      }
      assert.equal(carried.kind, 'commit');
      if (carried.kind === 'commit' && carried.payload.target === 'facet') {
        assert.equal(carried.payload.facet, 'substance');
        assert.equal(carried.payload.carried_from_edge_id, ISI_PARENT_EDGE_ID);
      }
    }
    const envelope = result.events[6]!;
    if (envelope.kind === 'commit') {
      assert.equal(envelope.payload.target, 'proposal');
    }
  },
);

When(
  'the interpretive-split commit events are appended to the session log and the projection is replayed',
  async function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, 'expected Valid before appending');
    if (!result.ok) return;
    for (const ev of result.events) {
      await insertEventRow(this, ISI_SESSION_ID, {
        id: ev.id,
        sequence: ev.sequence,
        kind: ev.kind,
        actor: ev.actor,
        payload: ev.payload,
        createdAt: ev.createdAt,
      });
    }
    // Re-project the full log so the assertion reads from the
    // round-tripped JSONB column (the schema-seam pin — this is where
    // `carried_from_edge_id` crosses validateEvent on the way back).
    this.scratch['isiReplayed'] = await projectFromDb(this);
  },
);

Then(
  'the replayed projection shows the parent superseded and both readings carrying the inherited committed rebut edge',
  function (this: AConversaWorld) {
    const projection = this.scratch['isiReplayed'] as Projection;
    // The parent is replaced in the visible view; its original edge
    // drops out of the visible graph with it (invisible by missing
    // endpoint — the edge record itself is untouched).
    assert.equal(projection.getNode(ISI_PARENT_NODE_ID)?.visible, false);
    const inheritedByReading = new Map<string, string[]>();
    for (const readingId of [ISI_READING_NODE_ID_1, ISI_READING_NODE_ID_2]) {
      assert.equal(projection.getNode(readingId)?.visible, true);
      const outgoing = projection
        .getEdgesBySource(readingId)
        .filter((edge) => edge.visible && edge.role === 'rebuts');
      assert.equal(outgoing.length, 1, `expected one inherited rebut edge on ${readingId}`);
      const inherited = outgoing[0]!;
      assert.equal(inherited.targetNodeId, ISI_TARGET_NODE_ID);
      // Substance committed by carry; vote state not copied.
      assert.equal(deriveFacetStatus(projection, 'edge', inherited.id, 'substance'), 'committed');
      assert.equal(inherited.substanceFacet.value, 'agreed');
      assert.equal(inherited.substanceFacet.perParticipant.size, 0);
      // The readings' own substance is untouched by the carry.
      assert.equal(
        deriveFacetStatus(projection, 'node', readingId, 'substance'),
        'awaiting-proposal',
      );
      inheritedByReading.set(readingId, [inherited.id]);
    }
    // Two distinct inherited edges (one per reading).
    const ids = [...inheritedByReading.values()].flat();
    assert.equal(new Set(ids).size, 2);
  },
);
