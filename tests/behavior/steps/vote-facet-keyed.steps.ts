// Steps for tests/behavior/methodology/vote-facet-keyed.feature.
//
// Wire-and-replay round-trip pin for the `target`-discriminated `vote`
// payload shape (per ADR 0030 §2 + §9 + `pf_facet_keyed_vote_payload`).
// The Vitest tests at `packages/shared-types/src/events.test.ts` and
// `apps/server/src/events/validate.test.ts` cover the in-memory schema
// (round-trip both arms + reject every cross-arm corruption). THIS
// integration layer pins the seams those tests cannot reach:
//   (a) pglite's `session_events` JSONB column round-trips both arms
//       intact through the TIMESTAMPTZ / BIGINT coercion path;
//   (b) `validateEvent` recovers the typed envelope for both arms;
//   (c) `projectFromLog` advances `lastAppliedSequence` past the
//       proposal-keyed arm without throwing.
//
// **Scope: schema-seam round-trip only.** Dispatch-side coverage now
// lives with the methodology engine: per `pf_vote_handler_facet_keyed`,
// the engine emits the facet-keyed arm for facet-valued proposal sub-
// kinds and the proposal-keyed arm for structural sub-kinds, and the
// projection's `handleVote` consumes both arms. This step file's pins
// remain limited to (a) JSONB round-trip + (b) `validateEvent`
// recovery + (c) `projectFromLog` advancing past the proposal-keyed
// arm without throwing.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_facet_keyed_vote_payload.md

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
// so the shared World doesn't collide across scenarios run in one
// Cucumber pass.
const FK_SESSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee000';
const FK_HOST_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee001';
const FK_DEBATER_A_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee002';
const FK_DEBATER_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee003';

const FK_NODE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee00a';
const FK_PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee00b';
const FK_PROPOSAL_VOTE_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee00c';
const FK_FACET_VOTE_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee00d';

const TS_BASE = '2026-05-10T19:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants for facet-keyed vote tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: FK_HOST_ID, sub: 'fixture-fk:host', name: 'host' },
      { id: FK_DEBATER_A_ID, sub: 'fixture-fk:a', name: 'a' },
      { id: FK_DEBATER_B_ID, sub: 'fixture-fk:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [FK_SESSION_ID, FK_HOST_ID, 'public', 'facet-keyed vote behavior tests'],
    );

    await insertEventRow(this, FK_SESSION_ID, {
      id: evId(701),
      sequence: 1,
      kind: 'session-created',
      actor: FK_HOST_ID,
      payload: {
        host_user_id: FK_HOST_ID,
        privacy: 'public',
        topic: 'facet-keyed vote behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, FK_SESSION_ID, {
      id: evId(702),
      sequence: 2,
      kind: 'participant-joined',
      actor: FK_HOST_ID,
      payload: {
        user_id: FK_HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, FK_SESSION_ID, {
      id: evId(703),
      sequence: 3,
      kind: 'participant-joined',
      actor: FK_DEBATER_A_ID,
      payload: {
        user_id: FK_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, FK_SESSION_ID, {
      id: evId(704),
      sequence: 4,
      kind: 'participant-joined',
      actor: FK_DEBATER_B_ID,
      payload: {
        user_id: FK_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    this.scratch['fkNextSeq'] = 5;
  },
);

Given(
  'a node-created event for the facet-keyed-vote-test node',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkNextSeq'] as number;
    this.scratch['fkNextSeq'] = seq + 1;
    await insertEventRow(this, FK_SESSION_ID, {
      id: evId(seq * 100 + 7),
      sequence: seq,
      kind: 'node-created',
      actor: FK_DEBATER_A_ID,
      payload: {
        node_id: FK_NODE_ID,
        wording: 'A statement for facet-keyed vote tests.',
        created_by: FK_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'an axiom-mark proposal for the facet-keyed-vote-test node',
  async function (this: AConversaWorld) {
    // Seed the node first.
    let seq = this.scratch['fkNextSeq'] as number;
    this.scratch['fkNextSeq'] = seq + 1;
    await insertEventRow(this, FK_SESSION_ID, {
      id: evId(seq * 100 + 7),
      sequence: seq,
      kind: 'node-created',
      actor: FK_DEBATER_A_ID,
      payload: {
        node_id: FK_NODE_ID,
        wording: 'An axiom-marked statement.',
        created_by: FK_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });

    // Then the axiom-mark proposal. axiom-mark is a structural sub-
    // kind per ADR 0030 §9 — votes against it use the proposal-keyed
    // arm of the new vote-payload discriminated union.
    seq = this.scratch['fkNextSeq'] as number;
    this.scratch['fkNextSeq'] = seq + 1;
    await insertEventRow(this, FK_SESSION_ID, {
      id: FK_PROPOSAL_ID,
      sequence: seq,
      kind: 'proposal',
      actor: FK_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'axiom-mark',
          node_id: FK_NODE_ID,
          participant: FK_DEBATER_A_ID,
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'a proposal-keyed vote envelope is inserted for the axiom-mark proposal',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkNextSeq'] as number;
    this.scratch['fkNextSeq'] = seq + 1;
    this.scratch['fkProposalVoteSequence'] = seq;
    await insertEventRow(this, FK_SESSION_ID, {
      id: FK_PROPOSAL_VOTE_EVENT_ID,
      sequence: seq,
      kind: 'vote',
      actor: FK_DEBATER_B_ID,
      payload: {
        target: 'proposal',
        proposal_id: FK_PROPOSAL_ID,
        participant: FK_DEBATER_B_ID,
        choice: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  "a facet-keyed vote envelope is inserted for the node's classification facet",
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkNextSeq'] as number;
    this.scratch['fkNextSeq'] = seq + 1;
    this.scratch['fkFacetVoteSequence'] = seq;
    await insertEventRow(this, FK_SESSION_ID, {
      id: FK_FACET_VOTE_EVENT_ID,
      sequence: seq,
      kind: 'vote',
      actor: FK_DEBATER_B_ID,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: FK_NODE_ID,
        facet: 'classification',
        participant: FK_DEBATER_B_ID,
        choice: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'I project the facet-keyed-vote event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, FK_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    this.scratch['fkEvents'] = events;
    const projection = projectFromLog(events, FK_SESSION_ID);
    this.scratch['fkProjection'] = projection;
  },
);

Then(
  "the facet-keyed-vote projection's lastAppliedSequence equals the proposal-keyed-vote event's sequence",
  function (this: AConversaWorld) {
    const projection = this.scratch['fkProjection'] as Projection;
    const expectedSeq = this.scratch['fkProposalVoteSequence'] as number;
    assert.equal(projection.lastAppliedSequence, expectedSeq);
  },
);

Then(
  'the proposal-keyed-vote event round-trips through validateEvent with kind {string} and target {string}',
  async function (this: AConversaWorld, expectedKind: string, expectedTarget: string) {
    // Lazy-load the events if the previous step didn't already project.
    let events = this.scratch['fkEvents'] as Event[] | undefined;
    if (events === undefined) {
      const rows = await selectEvents(this, FK_SESSION_ID);
      events = rows.map(rowToValidatedEvent);
      this.scratch['fkEvents'] = events;
    }
    const found = events.find((e) => e.id === FK_PROPOSAL_VOTE_EVENT_ID);
    assert.ok(found, `expected a vote event with id ${FK_PROPOSAL_VOTE_EVENT_ID}`);
    assert.equal(found.kind, expectedKind);
    // Narrow on kind === 'vote' so TypeScript can see the
    // discriminator. Confirm both the kind and the inner `target`
    // discriminator survived the JSONB round-trip.
    if (found.kind === 'vote') {
      assert.equal(found.payload.target, expectedTarget);
    }
  },
);

Then(
  'the facet-keyed-vote event round-trips through validateEvent with kind {string} and target {string}',
  async function (this: AConversaWorld, expectedKind: string, expectedTarget: string) {
    // Pull the events fresh here; the facet-keyed scenario does NOT
    // project (per the refinement's scoping — projection-side handling
    // of the facet-keyed arm lives in the downstream task).
    const rows = await selectEvents(this, FK_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    const found = events.find((e) => e.id === FK_FACET_VOTE_EVENT_ID);
    assert.ok(found, `expected a vote event with id ${FK_FACET_VOTE_EVENT_ID}`);
    assert.equal(found.kind, expectedKind);
    if (found.kind === 'vote') {
      assert.equal(found.payload.target, expectedTarget);
      if (found.payload.target === 'facet') {
        // Sanity-check the discriminated arm: the facet-keyed payload
        // carries the (entity_kind, entity_id, facet) trio per ADR
        // 0030 §2 — and NO proposal_id. This pin would fail if the
        // JSONB round-trip silently re-shaped the payload.
        assert.equal(found.payload.entity_kind, 'node');
        assert.equal(found.payload.entity_id, FK_NODE_ID);
        assert.equal(found.payload.facet, 'classification');
      }
    }
  },
);
