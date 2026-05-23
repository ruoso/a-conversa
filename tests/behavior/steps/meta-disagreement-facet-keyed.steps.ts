// Steps for tests/behavior/methodology/meta-disagreement-facet-keyed.feature.
//
// Wire-and-replay round-trip pin for the `target`-discriminated
// `meta-disagreement-marked` payload shape (per ADR 0030 §2 + §9 +
// `pf_facet_keyed_meta_disagreement_payload`). The Vitest tests at
// `packages/shared-types/src/events.test.ts` and
// `apps/server/src/events/validate.test.ts` cover the in-memory schema
// (round-trip both arms + reject every cross-arm corruption). THIS
// integration layer pins the seams those tests cannot reach:
//   (a) pglite's `session_events` JSONB column round-trips both arms
//       intact through the TIMESTAMPTZ / BIGINT coercion path;
//   (b) `validateEvent` recovers the typed envelope for both arms;
//   (c) `projectFromLog` advances `lastAppliedSequence` past the
//       proposal-keyed arm without throwing.
//
// **Projection-side handling of the facet-keyed arm is out of scope**
// for this task. The methodology engine still emits the proposal-keyed
// arm for ALL meta-disagreement marks (per the
// TODO(pf_meta_disagreement_handler_facet_keyed) in
// `apps/server/src/methodology/handlers/markMetaDisagreement.ts`); the
// projection's `handleMetaDisagreementMarked` rejects the facet-keyed
// arm with a runtime error so any inadvertent emit during the
// transition surfaces loudly. The downstream
// `pf_meta_disagreement_handler_facet_keyed` task rewires both halves.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_facet_keyed_meta_disagreement_payload.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  projectFromLog,
  type Event,
  type Projection,
} from '../../../apps/server/src/projection/index.js';

// Distinct UUID prefix from other methodology / projection step files
// (vote-facet-keyed uses 'e', commit-facet-keyed uses 'd') so the
// shared World doesn't collide across scenarios run in one Cucumber
// pass.
const FKM_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc000';
const FKM_HOST_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc001';
const FKM_DEBATER_A_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc002';
const FKM_DEBATER_B_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc003';

const FKM_NODE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc00a';
const FKM_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc00b';
const FKM_PROPOSAL_MARK_EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc00c';
const FKM_FACET_MARK_EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccc00d';

const TS_BASE = '2026-05-10T21:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants for facet-keyed meta-disagreement tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: FKM_HOST_ID, sub: 'fixture-fkm:host', name: 'host' },
      { id: FKM_DEBATER_A_ID, sub: 'fixture-fkm:a', name: 'a' },
      { id: FKM_DEBATER_B_ID, sub: 'fixture-fkm:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [FKM_SESSION_ID, FKM_HOST_ID, 'public', 'facet-keyed meta-disagreement behavior tests'],
    );

    await insertEventRow(this, FKM_SESSION_ID, {
      id: evId(901),
      sequence: 1,
      kind: 'session-created',
      actor: FKM_HOST_ID,
      payload: {
        host_user_id: FKM_HOST_ID,
        privacy: 'public',
        topic: 'facet-keyed meta-disagreement behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, FKM_SESSION_ID, {
      id: evId(902),
      sequence: 2,
      kind: 'participant-joined',
      actor: FKM_HOST_ID,
      payload: {
        user_id: FKM_HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, FKM_SESSION_ID, {
      id: evId(903),
      sequence: 3,
      kind: 'participant-joined',
      actor: FKM_DEBATER_A_ID,
      payload: {
        user_id: FKM_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, FKM_SESSION_ID, {
      id: evId(904),
      sequence: 4,
      kind: 'participant-joined',
      actor: FKM_DEBATER_B_ID,
      payload: {
        user_id: FKM_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    this.scratch['fkmNextSeq'] = 5;
  },
);

Given(
  'a node-created event for the facet-keyed-meta-disagreement-test node',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkmNextSeq'] as number;
    this.scratch['fkmNextSeq'] = seq + 1;
    await insertEventRow(this, FKM_SESSION_ID, {
      id: evId(seq * 100 + 7),
      sequence: seq,
      kind: 'node-created',
      actor: FKM_DEBATER_A_ID,
      payload: {
        node_id: FKM_NODE_ID,
        wording: 'A statement for facet-keyed meta-disagreement tests.',
        created_by: FKM_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'an axiom-mark proposal for the facet-keyed-meta-disagreement-test node',
  async function (this: AConversaWorld) {
    // Seed the node first.
    let seq = this.scratch['fkmNextSeq'] as number;
    this.scratch['fkmNextSeq'] = seq + 1;
    await insertEventRow(this, FKM_SESSION_ID, {
      id: evId(seq * 100 + 7),
      sequence: seq,
      kind: 'node-created',
      actor: FKM_DEBATER_A_ID,
      payload: {
        node_id: FKM_NODE_ID,
        wording: 'An axiom-marked statement.',
        created_by: FKM_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });

    // Then the axiom-mark proposal. axiom-mark is a structural sub-
    // kind per ADR 0030 §9 — marks against it use the proposal-keyed
    // arm of the new meta-disagreement-marked payload union.
    seq = this.scratch['fkmNextSeq'] as number;
    this.scratch['fkmNextSeq'] = seq + 1;
    await insertEventRow(this, FKM_SESSION_ID, {
      id: FKM_PROPOSAL_ID,
      sequence: seq,
      kind: 'proposal',
      actor: FKM_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'axiom-mark',
          node_id: FKM_NODE_ID,
          participant: FKM_DEBATER_A_ID,
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'a proposal-keyed meta-disagreement-marked envelope is inserted for the axiom-mark proposal',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkmNextSeq'] as number;
    this.scratch['fkmNextSeq'] = seq + 1;
    this.scratch['fkmProposalMarkSequence'] = seq;
    await insertEventRow(this, FKM_SESSION_ID, {
      id: FKM_PROPOSAL_MARK_EVENT_ID,
      sequence: seq,
      kind: 'meta-disagreement-marked',
      actor: FKM_HOST_ID,
      payload: {
        target: 'proposal',
        proposal_id: FKM_PROPOSAL_ID,
        marked_by: FKM_HOST_ID,
        marked_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  "a facet-keyed meta-disagreement-marked envelope is inserted for the node's classification facet",
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkmNextSeq'] as number;
    this.scratch['fkmNextSeq'] = seq + 1;
    this.scratch['fkmFacetMarkSequence'] = seq;
    await insertEventRow(this, FKM_SESSION_ID, {
      id: FKM_FACET_MARK_EVENT_ID,
      sequence: seq,
      kind: 'meta-disagreement-marked',
      actor: FKM_HOST_ID,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: FKM_NODE_ID,
        facet: 'classification',
        marked_by: FKM_HOST_ID,
        marked_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'I project the facet-keyed-meta-disagreement event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, FKM_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    this.scratch['fkmEvents'] = events;
    const projection = projectFromLog(events, FKM_SESSION_ID);
    this.scratch['fkmProjection'] = projection;
  },
);

Then(
  "the facet-keyed-meta-disagreement projection's lastAppliedSequence equals the proposal-keyed-meta-disagreement event's sequence",
  function (this: AConversaWorld) {
    const projection = this.scratch['fkmProjection'] as Projection;
    const expectedSeq = this.scratch['fkmProposalMarkSequence'] as number;
    assert.equal(projection.lastAppliedSequence, expectedSeq);
  },
);

Then(
  'the proposal-keyed-meta-disagreement event round-trips through validateEvent with kind {string} and target {string}',
  async function (this: AConversaWorld, expectedKind: string, expectedTarget: string) {
    // Lazy-load the events if the previous step didn't already project.
    let events = this.scratch['fkmEvents'] as Event[] | undefined;
    if (events === undefined) {
      const rows = await selectEvents(this, FKM_SESSION_ID);
      events = rows.map(rowToValidatedEvent);
      this.scratch['fkmEvents'] = events;
    }
    const found = events.find((e) => e.id === FKM_PROPOSAL_MARK_EVENT_ID);
    assert.ok(
      found,
      `expected a meta-disagreement-marked event with id ${FKM_PROPOSAL_MARK_EVENT_ID}`,
    );
    assert.equal(found.kind, expectedKind);
    // Narrow on kind === 'meta-disagreement-marked' so TypeScript can
    // see the discriminator. Confirm both the kind and the inner
    // `target` discriminator survived the JSONB round-trip.
    if (found.kind === 'meta-disagreement-marked') {
      assert.equal(found.payload.target, expectedTarget);
    }
  },
);

Then(
  'the facet-keyed-meta-disagreement event round-trips through validateEvent with kind {string} and target {string}',
  async function (this: AConversaWorld, expectedKind: string, expectedTarget: string) {
    // Pull the events fresh here; the facet-keyed scenario does NOT
    // project (per the refinement's scoping — projection-side handling
    // of the facet-keyed arm lives in the downstream task).
    const rows = await selectEvents(this, FKM_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    const found = events.find((e) => e.id === FKM_FACET_MARK_EVENT_ID);
    assert.ok(
      found,
      `expected a meta-disagreement-marked event with id ${FKM_FACET_MARK_EVENT_ID}`,
    );
    assert.equal(found.kind, expectedKind);
    if (found.kind === 'meta-disagreement-marked') {
      assert.equal(found.payload.target, expectedTarget);
      if (found.payload.target === 'facet') {
        // Sanity-check the discriminated arm: the facet-keyed payload
        // carries the (entity_kind, entity_id, facet) trio per ADR
        // 0030 §2 — and NO proposal_id. This pin would fail if the
        // JSONB round-trip silently re-shaped the payload.
        assert.equal(found.payload.entity_kind, 'node');
        assert.equal(found.payload.entity_id, FKM_NODE_ID);
        assert.equal(found.payload.facet, 'classification');
      }
    }
  },
);
