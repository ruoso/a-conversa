// Steps for tests/behavior/projection/incremental.feature.
//
// The behavior-test layer for `applyEventIncremental`. The
// Vitest tests cover the in-memory dispatch + sequence-gap
// detection with TS-literal events; these scenarios round-trip
// events through pglite's `session_events` table so JSONB / BIGINT
// / TIMESTAMPTZ coercion is exercised on the steady-state apply
// path too. See tests/behavior/support/event-rows.ts for the
// shared row-mapping helpers.
//
// Refinement: tasks/refinements/data-and-methodology/project_incrementally.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { loadFixture } from '../../../packages/test-fixtures/src/loader.js';
import {
  evId,
  insertEventRow,
  rowToEnvelopeShape,
  rowToValidatedEvent,
  selectEvents,
  type EnvelopeShape,
  type SessionEventRow,
} from '../support/event-rows.js';
import { type Event, type EventKind } from '../../../packages/shared-types/src/events.js';
import {
  applyEventIncremental,
  createEmptyProjection,
  OutOfOrderEventError,
  projectFromLog,
  type Projection,
  type ProjectionChange,
} from '../../../apps/server/src/projection/index.js';

// ---------------------------------------------------------------
// Stable UUIDs. Distinct from projection-from-log.steps.ts so
// the two step files can co-exist in the same Cucumber run
// without scenario cross-talk via the shared World scratch.
// ---------------------------------------------------------------

const SEEDED_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const EMPTY_FIXTURE_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const HOST_ID = '11111111-1111-4111-8111-111111111111';
const DEBATER_A_ID = '22222222-2222-4222-8222-222222222222';
const DEBATER_B_ID = '33333333-3333-4333-8333-333333333333';

const NODE_INCR_GENERIC_ID = '66666666-6666-4666-8666-66666666667a';
const NODE_INCR_SECOND_ID = '66666666-6666-4666-8666-66666666667b';
const PROPOSAL_INCR_CLASSIFY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1';

const TS_BASE = '2026-05-10T13:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// ---------------------------------------------------------------
// Scenario 1 — steady-state stream.
//
// `loadFixture` inserts the bundled empty fixture's four events
// directly into `session_events`. The empty fixture's payloads
// pre-date the tightened payload schemas (same situation as
// projection-from-log.steps.ts), so we map row -> envelope
// without validateEvent and rely on the dispatcher's payload-
// field-tolerance to populate the projection.
// ---------------------------------------------------------------

function asEventKind(k: string): EventKind {
  return k as EventKind;
}

function envelopeToEvent(shape: EnvelopeShape): Event {
  return {
    id: shape.id,
    sessionId: shape.sessionId,
    sequence: shape.sequence,
    kind: asEventKind(shape.kind),
    actor: shape.actor,
    payload: shape.payload,
    createdAt: shape.createdAt,
  } as Event;
}

Given(
  'the empty fixture is loaded and the projection has caught up',
  async function (this: AConversaWorld) {
    await loadFixture('empty', this.client);
    const rows = await selectEvents(this, EMPTY_FIXTURE_SESSION_ID);
    const projection = createEmptyProjection(EMPTY_FIXTURE_SESSION_ID);
    for (const row of rows) {
      const event = envelopeToEvent(rowToEnvelopeShape(row));
      applyEventIncremental(projection, event);
    }
    this.scratch['incrProjection'] = projection;
    // The bundled empty fixture has 4 events.
    this.scratch['incrNextSeq'] = 5;
    assert.equal(projection.lastAppliedSequence, 4, 'expected empty fixture to apply 4 events');
  },
);

When(
  'I append a node-created event and incrementally project it',
  async function (this: AConversaWorld) {
    const seq = this.scratch['incrNextSeq'] as number;
    this.scratch['incrNextSeq'] = seq + 1;
    await insertEventRow(this, EMPTY_FIXTURE_SESSION_ID, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: NODE_INCR_GENERIC_ID,
        wording: 'first incremental node',
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    // Re-SELECT the newest row and apply it incrementally.
    const rows = await selectEvents(this, EMPTY_FIXTURE_SESSION_ID);
    const lastRow = rows[rows.length - 1]!;
    const event = rowToValidatedEvent(lastRow);
    const projection = this.scratch['incrProjection'] as Projection;
    const changes = applyEventIncremental(projection, event);
    this.scratch['lastChanges'] = changes;
  },
);

When(
  'I append a second node-created event and incrementally project it',
  async function (this: AConversaWorld) {
    const seq = this.scratch['incrNextSeq'] as number;
    this.scratch['incrNextSeq'] = seq + 1;
    await insertEventRow(this, EMPTY_FIXTURE_SESSION_ID, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: NODE_INCR_SECOND_ID,
        wording: 'second incremental node',
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
    const rows = await selectEvents(this, EMPTY_FIXTURE_SESSION_ID);
    const lastRow = rows[rows.length - 1]!;
    const event = rowToValidatedEvent(lastRow);
    const projection = this.scratch['incrProjection'] as Projection;
    applyEventIncremental(projection, event);
  },
);

Then("the projection's lastAppliedSequence is {int}", function (this: AConversaWorld, n: number) {
  const projection = this.scratch['incrProjection'] as Projection;
  assert.equal(projection.lastAppliedSequence, n);
});

Then(
  "the projection's lastAppliedSequence is still {int}",
  function (this: AConversaWorld, n: number) {
    const projection = this.scratch['incrProjection'] as Projection;
    assert.equal(projection.lastAppliedSequence, n);
  },
);

// ---------------------------------------------------------------
// Scenario 2 — sequence gap rejected.
// ---------------------------------------------------------------

When(
  'I attempt to apply an event at sequence {int} to a projection at sequence {int}',
  function (this: AConversaWorld, gapSeq: number, baseSeq: number) {
    const projection = this.scratch['incrProjection'] as Projection;
    assert.equal(
      projection.lastAppliedSequence,
      baseSeq,
      `expected projection at sequence ${baseSeq}, got ${projection.lastAppliedSequence}`,
    );
    // Construct a synthetic node-created event directly — the gap
    // is in the in-memory dispatch contract; we don't need to
    // insert the row into pglite to verify the throw shape.
    const event: Event = {
      id: evId(9999),
      sessionId: EMPTY_FIXTURE_SESSION_ID,
      sequence: gapSeq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: NODE_INCR_GENERIC_ID,
        wording: 'gap probe',
        created_by: DEBATER_A_ID,
        created_at: tsAt(gapSeq),
      },
      createdAt: tsAt(gapSeq),
    };
    try {
      applyEventIncremental(projection, event);
      this.scratch['lastError'] = undefined;
    } catch (err) {
      this.scratch['lastError'] = err;
    }
  },
);

Then('the apply throws an OutOfOrderEventError', function (this: AConversaWorld) {
  const err = this.scratch['lastError'];
  assert.ok(err, 'expected an error to have been thrown');
  assert.ok(
    err instanceof OutOfOrderEventError,
    `expected OutOfOrderEventError, got ${err?.constructor?.name}`,
  );
});

// ---------------------------------------------------------------
// Scenario 3 — equivalence with full replay.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants in session_events for incremental tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: HOST_ID, sub: 'fixture-incr:host', name: 'host' },
      { id: DEBATER_A_ID, sub: 'fixture-incr:a', name: 'a' },
      { id: DEBATER_B_ID, sub: 'fixture-incr:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [SEEDED_SESSION_ID, HOST_ID, 'public', 'Projection incremental behavior tests'],
    );

    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(1),
      sequence: 1,
      kind: 'session-created',
      actor: HOST_ID,
      payload: {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Projection incremental behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(2),
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
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(3),
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
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(4),
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

    this.scratch['incrNextSeq'] = 5;
  },
);

Given(
  'a node-created event for the seeded incremental session',
  async function (this: AConversaWorld) {
    const seq = this.scratch['incrNextSeq'] as number;
    this.scratch['incrNextSeq'] = seq + 1;
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: NODE_INCR_GENERIC_ID,
        wording: 'A proposition under incremental classification.',
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'an entity-included event for that node for incremental tests',
  async function (this: AConversaWorld) {
    const seq = this.scratch['incrNextSeq'] as number;
    this.scratch['incrNextSeq'] = seq + 1;
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'entity-included',
      actor: HOST_ID,
      payload: {
        entity_kind: 'node',
        entity_id: NODE_INCR_GENERIC_ID,
        included_by: HOST_ID,
        included_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'a classify-node proposal event for that node with classification {string} for incremental tests',
  async function (this: AConversaWorld, classification: string) {
    const seq = this.scratch['incrNextSeq'] as number;
    this.scratch['incrNextSeq'] = seq + 1;
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: PROPOSAL_INCR_CLASSIFY_ID,
      sequence: seq,
      kind: 'proposal',
      actor: DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'classify-node',
          node_id: NODE_INCR_GENERIC_ID,
          classification,
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'three agree votes on that classify proposal for incremental tests',
  async function (this: AConversaWorld) {
    for (const voter of [HOST_ID, DEBATER_A_ID, DEBATER_B_ID]) {
      const seq = this.scratch['incrNextSeq'] as number;
      this.scratch['incrNextSeq'] = seq + 1;
      await insertEventRow(this, SEEDED_SESSION_ID, {
        id: evId(seq * 10),
        sequence: seq,
        kind: 'vote',
        actor: voter,
        payload: {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_INCR_CLASSIFY_ID,
          participant: voter,
          choice: 'agree',
          voted_at: tsAt(seq),
        },
        createdAt: tsAt(seq),
      });
    }
  },
);

Given(
  'a commit event for that classify proposal for incremental tests',
  async function (this: AConversaWorld) {
    const seq = this.scratch['incrNextSeq'] as number;
    this.scratch['incrNextSeq'] = seq + 1;
    await insertEventRow(this, SEEDED_SESSION_ID, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'commit',
      actor: HOST_ID,
      payload: {
        target: 'proposal',
        proposal_id: PROPOSAL_INCR_CLASSIFY_ID,
        committed_by: HOST_ID,
        committed_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When('I project the full event log via projectFromLog', async function (this: AConversaWorld) {
  const rows = await selectEvents(this, SEEDED_SESSION_ID);
  const events = rows.map(rowToValidatedEvent);
  const projection = projectFromLog(events, SEEDED_SESSION_ID);
  this.scratch['fromLogProjection'] = projection;
});

When(
  'I project the same event log via repeated applyEventIncremental',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, SEEDED_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = createEmptyProjection(SEEDED_SESSION_ID);
    for (const event of events) {
      applyEventIncremental(projection, event);
    }
    this.scratch['incrementalProjection'] = projection;
  },
);

function fingerprint(p: Projection): string {
  const nodes = [...p.nodes()]
    .map((n) => ({
      id: n.id,
      wording: n.wording,
      visible: n.visible,
      classification: n.classificationFacet.value,
      classificationStatus: n.classificationFacet.status,
      substance: n.substanceFacet.value,
      substanceStatus: n.substanceFacet.status,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...p.edges()]
    .map((e) => ({
      id: e.id,
      role: e.role,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      visible: e.visible,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pending = [...p.pendingProposals()].map((pp) => pp.proposalEventId).sort();
  const participants = [...p.currentParticipants()].map((pp) => pp.userId).sort();
  return JSON.stringify({
    sessionState: p.sessionState,
    lastAppliedSequence: p.lastAppliedSequence,
    nodes,
    edges,
    pending,
    participants,
  });
}

Then('the two projections have identical fingerprints', function (this: AConversaWorld) {
  const fromLog = this.scratch['fromLogProjection'] as Projection;
  const incremental = this.scratch['incrementalProjection'] as Projection;
  assert.equal(fingerprint(fromLog), fingerprint(incremental));
});

// ---------------------------------------------------------------
// Scenario 4 — change feed for a commit-classify-node round.
// ---------------------------------------------------------------

When(
  'I walk the event log incrementally and collect per-event change feeds',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, SEEDED_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = createEmptyProjection(SEEDED_SESSION_ID);
    const perEventChanges: Array<{ event: Event; changes: ProjectionChange[] }> = [];
    for (const event of events) {
      const changes = applyEventIncremental(projection, event);
      perEventChanges.push({ event, changes });
    }
    this.scratch['perEventChanges'] = perEventChanges;
  },
);

function getCommitChanges(world: AConversaWorld): ProjectionChange[] {
  const all = world.scratch['perEventChanges'] as Array<{
    event: Event;
    changes: ProjectionChange[];
  }>;
  const commit = all.find((e) => e.event.kind === 'commit');
  assert.ok(commit, 'expected the event log to include a commit event');
  return commit.changes;
}

Then(
  "the commit event's change feed contains a pending-proposal-cleared with reason {string}",
  function (this: AConversaWorld, reason: string) {
    const changes = getCommitChanges(this);
    const hit = changes.find((c) => c.kind === 'pending-proposal-cleared' && c.reason === reason);
    assert.ok(
      hit,
      `expected commit change feed to contain pending-proposal-cleared with reason="${reason}"; got ${JSON.stringify(changes)}`,
    );
  },
);

Then(
  "the commit event's change feed contains a facet-updated with facet {string} and value {string}",
  function (this: AConversaWorld, facet: string, value: string) {
    const changes = getCommitChanges(this);
    const hit = changes.find(
      (c) => c.kind === 'facet-updated' && c.facet === facet && c.value === value,
    );
    assert.ok(
      hit,
      `expected commit change feed to contain facet-updated with facet="${facet}" value="${value}"; got ${JSON.stringify(changes)}`,
    );
  },
);

// Silence unused-import warnings for SessionEventRow when this
// file is bundled by tsx.
void undefined as SessionEventRow | undefined;
