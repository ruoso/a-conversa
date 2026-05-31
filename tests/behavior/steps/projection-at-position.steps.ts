import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { loadFixture } from '../../../packages/test-fixtures/src/loader.js';
import type { EventKind } from '../../../packages/shared-types/src/events.js';
import {
  appendSessionEvent,
  type SessionEventAppendClient,
} from '../../../apps/server/src/events/append.js';
import {
  type Event,
  type Projection,
  projectAtPosition,
  projectFromLog,
} from '../../../apps/server/src/projection/index.js';

import { rowToEnvelopeShape, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import type { AConversaWorld } from '../support/world.js';

const EMPTY_FIXTURE_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const WALKTHROUGH_SESSION_ID = '10000005-0000-4000-8000-000000000001';

async function appendForFixture(
  client: { query: (text: string, params?: ReadonlyArray<unknown>) => Promise<unknown> },
  event: Event,
): Promise<void> {
  await appendSessionEvent(client as unknown as SessionEventAppendClient, event);
}

function asEventKind(kind: string): EventKind {
  return kind as EventKind;
}

function isSnapshotCreatedEvent(
  event: Event,
): event is Extract<Event, { kind: 'snapshot-created' }> {
  return event.kind === 'snapshot-created';
}

function findSnapshotCreatedEvent(events: readonly Event[], label: string) {
  return events.find(
    (event): event is Extract<Event, { kind: 'snapshot-created' }> =>
      isSnapshotCreatedEvent(event) && event.payload.label === label,
  );
}

function projectionFingerprint(p: Projection): string {
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
      sourceNodeId: e.sourceNodeId,
      sourceAnnotationId: e.sourceAnnotationId,
      targetNodeId: e.targetNodeId,
      targetAnnotationId: e.targetAnnotationId,
      visible: e.visible,
      substance: e.substanceFacet.value,
      substanceStatus: e.substanceFacet.status,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const annotations = [...p.annotations()]
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      content: a.content,
      visible: a.visible,
      substance: a.substanceFacet.value,
      substanceStatus: a.substanceFacet.status,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshots = [...p.snapshots()]
    .map((s) => ({ id: s.snapshotId, label: s.label, logPosition: s.logPosition }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pending = [...p.pendingProposals()].map((pp) => pp.proposalEventId).sort();
  const participants = [...p.currentParticipants()]
    .map((pp) => ({ userId: pp.userId, role: pp.role }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  return JSON.stringify({
    sessionState: p.sessionState,
    currentMode: p.currentMode,
    lastAppliedSequence: p.lastAppliedSequence,
    nodes,
    edges,
    annotations,
    snapshots,
    pending,
    participants,
  });
}

When(
  'I load the {string} fixture and project it at position {int}',
  async function (this: AConversaWorld, name: string, position: number) {
    await loadFixture(name, this.client, { appendEvent: appendForFixture });
    assert.equal(name, 'empty', 'only the empty fixture uses the shared position step');
    const rows = await selectEvents(this, EMPTY_FIXTURE_SESSION_ID);
    const events: Event[] = rows.map((row) => {
      const envelope = rowToEnvelopeShape(row);
      return {
        id: envelope.id,
        sessionId: envelope.sessionId,
        sequence: envelope.sequence,
        kind: asEventKind(envelope.kind),
        actor: envelope.actor,
        payload: envelope.payload,
        createdAt: envelope.createdAt,
      } as Event;
    });
    this.scratch['projection'] = projectAtPosition(events, EMPTY_FIXTURE_SESSION_ID, position);
  },
);

When(
  'I load the walkthrough fixture and project it at the recorded log position for snapshot {string}',
  async function (this: AConversaWorld, label: string) {
    await loadFixture('walkthrough', this.client, { appendEvent: appendForFixture });
    const rows = await selectEvents(this, WALKTHROUGH_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const snapshotEvent = findSnapshotCreatedEvent(events, label);
    assert.ok(snapshotEvent, `expected a walkthrough snapshot-created event labeled "${label}"`);
    this.scratch['walkthroughProjection'] = projectAtPosition(
      events,
      WALKTHROUGH_SESSION_ID,
      snapshotEvent.payload.log_position,
    );
  },
);

When(
  'I load the walkthrough fixture and project it at the snapshot-created event for snapshot {string}',
  async function (this: AConversaWorld, label: string) {
    await loadFixture('walkthrough', this.client, { appendEvent: appendForFixture });
    const rows = await selectEvents(this, WALKTHROUGH_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const snapshotEvent = findSnapshotCreatedEvent(events, label);
    assert.ok(snapshotEvent, `expected a walkthrough snapshot-created event labeled "${label}"`);
    this.scratch['walkthroughProjection'] = projectAtPosition(
      events,
      WALKTHROUGH_SESSION_ID,
      snapshotEvent.sequence,
    );
  },
);

When(
  'I load the walkthrough fixture and project it at head and via full replay',
  async function (this: AConversaWorld) {
    await loadFixture('walkthrough', this.client, { appendEvent: appendForFixture });
    const rows = await selectEvents(this, WALKTHROUGH_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const head = events[events.length - 1]!.sequence;
    this.scratch['walkthroughProjection'] = projectAtPosition(events, WALKTHROUGH_SESSION_ID, head);
    this.scratch['walkthroughFullReplay'] = projectFromLog(events, WALKTHROUGH_SESSION_ID);
  },
);

Then(
  'the at-position projection has lastAppliedSequence {int}',
  function (this: AConversaWorld, sequence: number) {
    const projection = this.scratch['walkthroughProjection'] as Projection | undefined;
    assert.ok(projection, 'expected the walkthrough at-position projection');
    assert.equal(projection.lastAppliedSequence, sequence);
  },
);

Then(
  'the walkthrough projection does not contain a snapshot labeled {string}',
  function (this: AConversaWorld, label: string) {
    const projection = this.scratch['walkthroughProjection'] as Projection | undefined;
    assert.ok(projection, 'expected the walkthrough at-position projection');
    const found = [...projection.snapshots()].some((snapshot) => snapshot.label === label);
    assert.equal(found, false, `did not expect a snapshot labeled "${label}"`);
  },
);

Then(
  'the at-position projection matches the full-replay fingerprint',
  function (this: AConversaWorld) {
    const atPosition = this.scratch['walkthroughProjection'] as Projection | undefined;
    const fullReplay = this.scratch['walkthroughFullReplay'] as Projection | undefined;
    assert.ok(atPosition, 'expected the walkthrough at-position projection');
    assert.ok(fullReplay, 'expected the walkthrough full-replay projection');
    assert.equal(projectionFingerprint(atPosition), projectionFingerprint(fullReplay));
  },
);
