// Steps for tests/behavior/methodology/commit-facet-keyed.feature.
//
// Wire-and-replay round-trip pin for the `target`-discriminated `commit`
// payload shape (per ADR 0030 §2 + §9 + `pf_facet_keyed_commit_payload`).
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
// **Projection-side handling of both arms is now wired** (per the
// downstream `pf_projection_replay_updates` + `pf_commit_handler_facet_keyed`
// pair). This step file remains the wire-and-replay round-trip pin for
// the schema seam — both arms are inserted directly into pglite (rather
// than via the methodology engine) so the schema seam is exercised
// independently of the engine's dispatch choice. The engine itself
// emits `target: 'facet'` for the four facet-valued sub-kinds and
// `target: 'proposal'` for the seven structural sub-kinds per ADR 0030
// §2 + §9; see `apps/server/src/methodology/handlers/commit.ts`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_facet_keyed_commit_payload.md

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
// (and from vote-facet-keyed's `eeeeeeee-...000` prefix) so the shared
// World doesn't collide across scenarios run in one Cucumber pass.
const FKC_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd000';
const FKC_HOST_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
const FKC_DEBATER_A_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002';
const FKC_DEBATER_B_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003';

const FKC_NODE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00a';
const FKC_PROPOSAL_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00b';
const FKC_PROPOSAL_COMMIT_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00c';
const FKC_FACET_COMMIT_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00d';
const FKC_AGREE_VOTE_HOST_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00e';
const FKC_AGREE_VOTE_B_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd00f';

const TS_BASE = '2026-05-10T20:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants for facet-keyed commit tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: FKC_HOST_ID, sub: 'fixture-fkc:host', name: 'host' },
      { id: FKC_DEBATER_A_ID, sub: 'fixture-fkc:a', name: 'a' },
      { id: FKC_DEBATER_B_ID, sub: 'fixture-fkc:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [FKC_SESSION_ID, FKC_HOST_ID, 'public', 'facet-keyed commit behavior tests'],
    );

    await insertEventRow(this, FKC_SESSION_ID, {
      id: evId(801),
      sequence: 1,
      kind: 'session-created',
      actor: FKC_HOST_ID,
      payload: {
        host_user_id: FKC_HOST_ID,
        privacy: 'public',
        topic: 'facet-keyed commit behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, FKC_SESSION_ID, {
      id: evId(802),
      sequence: 2,
      kind: 'participant-joined',
      actor: FKC_HOST_ID,
      payload: {
        user_id: FKC_HOST_ID,
        role: 'moderator',
        screen_name: 'host',
        joined_at: tsAt(1),
      },
      createdAt: tsAt(1),
    });
    await insertEventRow(this, FKC_SESSION_ID, {
      id: evId(803),
      sequence: 3,
      kind: 'participant-joined',
      actor: FKC_DEBATER_A_ID,
      payload: {
        user_id: FKC_DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'a',
        joined_at: tsAt(2),
      },
      createdAt: tsAt(2),
    });
    await insertEventRow(this, FKC_SESSION_ID, {
      id: evId(804),
      sequence: 4,
      kind: 'participant-joined',
      actor: FKC_DEBATER_B_ID,
      payload: {
        user_id: FKC_DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'b',
        joined_at: tsAt(3),
      },
      createdAt: tsAt(3),
    });

    this.scratch['fkcNextSeq'] = 5;
  },
);

Given(
  'a node-created event for the facet-keyed-commit-test node',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: evId(seq * 100 + 7),
      sequence: seq,
      kind: 'node-created',
      actor: FKC_DEBATER_A_ID,
      payload: {
        node_id: FKC_NODE_ID,
        wording: 'A statement for facet-keyed commit tests.',
        created_by: FKC_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'an axiom-mark proposal for the facet-keyed-commit-test node',
  async function (this: AConversaWorld) {
    // Seed the node first.
    let seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: evId(seq * 100 + 7),
      sequence: seq,
      kind: 'node-created',
      actor: FKC_DEBATER_A_ID,
      payload: {
        node_id: FKC_NODE_ID,
        wording: 'An axiom-marked statement.',
        created_by: FKC_DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });

    // Then the axiom-mark proposal. axiom-mark is a structural sub-
    // kind per ADR 0030 §9 — commits against it use the proposal-keyed
    // arm of the new commit-payload discriminated union.
    seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: FKC_PROPOSAL_ID,
      sequence: seq,
      kind: 'proposal',
      actor: FKC_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'axiom-mark',
          node_id: FKC_NODE_ID,
          participant: FKC_DEBATER_A_ID,
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'unanimous-agree proposal-keyed votes for the axiom-mark proposal',
  async function (this: AConversaWorld) {
    // For axiom-mark the proposer (debater A) is excluded from the
    // required-voters set per `docs/methodology.md`; debater B's agree
    // is sufficient. We add a host (moderator) vote too — the
    // projection's `handleVote` is happy to record it; the engine's
    // unanimity walk filters the moderator out separately. This is a
    // SCHEMA-seam pin: the projection just needs the proposal in
    // `pendingProposals` so the commit's `getPendingProposal` lookup
    // succeeds — no unanimity check runs on the read side.
    let seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: FKC_AGREE_VOTE_HOST_EVENT_ID,
      sequence: seq,
      kind: 'vote',
      actor: FKC_HOST_ID,
      payload: {
        target: 'proposal',
        proposal_id: FKC_PROPOSAL_ID,
        participant: FKC_HOST_ID,
        choice: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });

    seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: FKC_AGREE_VOTE_B_EVENT_ID,
      sequence: seq,
      kind: 'vote',
      actor: FKC_DEBATER_B_ID,
      payload: {
        target: 'proposal',
        proposal_id: FKC_PROPOSAL_ID,
        participant: FKC_DEBATER_B_ID,
        choice: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'a proposal-keyed commit envelope is inserted for the axiom-mark proposal',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    this.scratch['fkcProposalCommitSequence'] = seq;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: FKC_PROPOSAL_COMMIT_EVENT_ID,
      sequence: seq,
      kind: 'commit',
      actor: FKC_HOST_ID,
      payload: {
        target: 'proposal',
        proposal_id: FKC_PROPOSAL_ID,
        committed_by: FKC_HOST_ID,
        committed_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  "a facet-keyed commit envelope is inserted for the node's classification facet",
  async function (this: AConversaWorld) {
    const seq = this.scratch['fkcNextSeq'] as number;
    this.scratch['fkcNextSeq'] = seq + 1;
    this.scratch['fkcFacetCommitSequence'] = seq;
    await insertEventRow(this, FKC_SESSION_ID, {
      id: FKC_FACET_COMMIT_EVENT_ID,
      sequence: seq,
      kind: 'commit',
      actor: FKC_HOST_ID,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: FKC_NODE_ID,
        facet: 'classification',
        committed_by: FKC_HOST_ID,
        committed_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'I project the facet-keyed-commit event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, FKC_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    this.scratch['fkcEvents'] = events;
    const projection = projectFromLog(events, FKC_SESSION_ID);
    this.scratch['fkcProjection'] = projection;
  },
);

Then(
  "the facet-keyed-commit projection's lastAppliedSequence equals the proposal-keyed-commit event's sequence",
  function (this: AConversaWorld) {
    const projection = this.scratch['fkcProjection'] as Projection;
    const expectedSeq = this.scratch['fkcProposalCommitSequence'] as number;
    assert.equal(projection.lastAppliedSequence, expectedSeq);
  },
);

Then(
  'the proposal-keyed-commit event round-trips through validateEvent with kind {string} and target {string}',
  async function (this: AConversaWorld, expectedKind: string, expectedTarget: string) {
    // Lazy-load the events if the previous step didn't already project.
    let events = this.scratch['fkcEvents'] as Event[] | undefined;
    if (events === undefined) {
      const rows = await selectEvents(this, FKC_SESSION_ID);
      events = rows.map(rowToValidatedEvent);
      this.scratch['fkcEvents'] = events;
    }
    const found = events.find((e) => e.id === FKC_PROPOSAL_COMMIT_EVENT_ID);
    assert.ok(found, `expected a commit event with id ${FKC_PROPOSAL_COMMIT_EVENT_ID}`);
    assert.equal(found.kind, expectedKind);
    // Narrow on kind === 'commit' so TypeScript can see the
    // discriminator. Confirm both the kind and the inner `target`
    // discriminator survived the JSONB round-trip.
    if (found.kind === 'commit') {
      assert.equal(found.payload.target, expectedTarget);
    }
  },
);

Then(
  'the facet-keyed-commit event round-trips through validateEvent with kind {string} and target {string}',
  async function (this: AConversaWorld, expectedKind: string, expectedTarget: string) {
    // Pull the events fresh here; the facet-keyed scenario does NOT
    // project (per the refinement's scoping — projection-side handling
    // of the facet-keyed arm lives in the downstream task).
    const rows = await selectEvents(this, FKC_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    const found = events.find((e) => e.id === FKC_FACET_COMMIT_EVENT_ID);
    assert.ok(found, `expected a commit event with id ${FKC_FACET_COMMIT_EVENT_ID}`);
    assert.equal(found.kind, expectedKind);
    if (found.kind === 'commit') {
      assert.equal(found.payload.target, expectedTarget);
      if (found.payload.target === 'facet') {
        // Sanity-check the discriminated arm: the facet-keyed payload
        // carries the (entity_kind, entity_id, facet) trio per ADR
        // 0030 §2 — and NO proposal_id. This pin would fail if the
        // JSONB round-trip silently re-shaped the payload.
        assert.equal(found.payload.entity_kind, 'node');
        assert.equal(found.payload.entity_id, FKC_NODE_ID);
        assert.equal(found.payload.facet, 'classification');
      }
    }
  },
);
