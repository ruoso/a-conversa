// Steps for tests/behavior/methodology/structural-target.feature.
//
// The behavior-test layer for the structural-target round-trip pin —
// per ADR 0030 §9, the six structural proposal sub-kinds (`decompose`,
// `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`,
// `break-edge`) retain proposal-id-keyed vote / commit envelopes. The
// Vitest tests at
// `apps/server/src/methodology/handlers/structural-target.test.ts`
// cover the in-memory contract across all six sub-kinds. This file
// covers the DB-driven integration path for the decompose canonical
// case: round-trip the session's events (including proposal-keyed
// `vote` events with `target: 'proposal'`) through pglite's
// `session_events` table, replay through `projectFromLog`, then call
// `validateAction` with a commit action against the resulting
// projection and confirm the commit envelope is also proposal-keyed.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_structural_handlers_unchanged.md

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
} from '../../../apps/server/src/methodology/index.js';

// Distinct UUID prefix to avoid scratch-state collisions with the
// other methodology step files that share a Cucumber World.
const ST_SESSION_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee0';
const ST_HOST_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee1';
const ST_DEBATER_A_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee2';
const ST_DEBATER_B_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee3';

const ST_PARENT_NODE_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee4';
const ST_COMPONENT_1_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee5';
const ST_COMPONENT_2_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee6';
const ST_DECOMPOSE_PROPOSAL_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee7';
const ST_COMMIT_EVENT_ID = 'ffeeffee-ffee-4fee-8fee-ffeeffeefee8';

const TS_BASE = '2026-05-10T21:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: ST_HOST_ID, sub: 'fixture-st:host', name: 'host' },
    { id: ST_DEBATER_A_ID, sub: 'fixture-st:a', name: 'a' },
    { id: ST_DEBATER_B_ID, sub: 'fixture-st:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [ST_SESSION_ID, ST_HOST_ID, 'public', 'Structural-target behavior tests'],
  );

  await insertEventRow(world, ST_SESSION_ID, {
    id: evId(801),
    sequence: 1,
    kind: 'session-created',
    actor: ST_HOST_ID,
    payload: {
      host_user_id: ST_HOST_ID,
      privacy: 'public',
      topic: 'Structural-target behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, ST_SESSION_ID, {
    id: evId(802),
    sequence: 2,
    kind: 'participant-joined',
    actor: ST_HOST_ID,
    payload: {
      user_id: ST_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, ST_SESSION_ID, {
    id: evId(803),
    sequence: 3,
    kind: 'participant-joined',
    actor: ST_DEBATER_A_ID,
    payload: {
      user_id: ST_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, ST_SESSION_ID, {
    id: evId(804),
    sequence: 4,
    kind: 'participant-joined',
    actor: ST_DEBATER_B_ID,
    payload: {
      user_id: ST_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, ST_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, ST_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a pending decompose proposal for structural-target tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    // Parent node the decompose proposal targets.
    await insertEventRow(this, ST_SESSION_ID, {
      id: evId(805),
      sequence: 5,
      kind: 'node-created',
      actor: ST_DEBATER_A_ID,
      payload: {
        node_id: ST_PARENT_NODE_ID,
        wording: 'A structural-target parent claim for the decompose pin.',
        created_by: ST_DEBATER_A_ID,
        created_at: tsAt(4),
      },
      createdAt: tsAt(4),
    });
    // Propose-time fan-out per ADR 0027 — each component lands as
    // `node-created` + `entity-included` ahead of the `proposal`
    // envelope. Mirrors `buildStructuralEventsForPropose` in
    // `apps/server/src/methodology/handlers/propose.ts`.
    for (const [ordinal, componentId, wording] of [
      [806, ST_COMPONENT_1_ID, 'Decompose component one.'],
      [808, ST_COMPONENT_2_ID, 'Decompose component two.'],
    ] as const) {
      const baseSeq = ordinal === 806 ? 6 : 8;
      await insertEventRow(this, ST_SESSION_ID, {
        id: evId(ordinal),
        sequence: baseSeq,
        kind: 'node-created',
        actor: ST_DEBATER_A_ID,
        payload: {
          node_id: componentId,
          wording,
          created_by: ST_DEBATER_A_ID,
          created_at: tsAt(5),
        },
        createdAt: tsAt(5),
      });
      await insertEventRow(this, ST_SESSION_ID, {
        id: evId(ordinal + 1),
        sequence: baseSeq + 1,
        kind: 'entity-included',
        actor: ST_DEBATER_A_ID,
        payload: {
          entity_kind: 'node',
          entity_id: componentId,
          included_by: ST_DEBATER_A_ID,
          included_at: tsAt(5),
        },
        createdAt: tsAt(5),
      });
    }
    // The decompose proposal envelope itself.
    await insertEventRow(this, ST_SESSION_ID, {
      id: ST_DECOMPOSE_PROPOSAL_ID,
      sequence: 10,
      kind: 'proposal',
      actor: ST_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: ST_PARENT_NODE_ID,
          components: [
            {
              wording: 'Decompose component one.',
              classification: 'fact',
              node_id: ST_COMPONENT_1_ID,
            },
            {
              wording: 'Decompose component two.',
              classification: 'value',
              node_id: ST_COMPONENT_2_ID,
            },
          ],
        },
      },
      createdAt: tsAt(6),
    });
    this.scratch['stProjection'] = await projectFromDb(this);
  },
);

Given(
  'three proposal-keyed agree votes against the decompose proposal in the session log',
  async function (this: AConversaWorld) {
    // Three `vote` envelopes with `target: 'proposal'` — one per current
    // participant. The proposal-keyed arm is the ADR 0030 §9 contract
    // for structural sub-kinds; emitting `target: 'facet'` here would
    // be a cross-arm corruption and the Zod schema would reject the
    // row at validateEvent recovery.
    const voters: ReadonlyArray<readonly [number, number, string]> = [
      [811, 11, ST_HOST_ID],
      [812, 12, ST_DEBATER_A_ID],
      [813, 13, ST_DEBATER_B_ID],
    ];
    for (const [ordinal, sequence, participant] of voters) {
      await insertEventRow(this, ST_SESSION_ID, {
        id: evId(ordinal),
        sequence,
        kind: 'vote',
        actor: participant,
        payload: {
          target: 'proposal' as const,
          proposal_id: ST_DECOMPOSE_PROPOSAL_ID,
          participant,
          choice: 'agree',
          voted_at: tsAt(7 + (sequence - 11)),
        },
        createdAt: tsAt(7 + (sequence - 11)),
      });
    }
    // Re-project after the votes so the commit step sees the
    // pendingProposal.perParticipantVotes map populated.
    this.scratch['stProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'the moderator constructs a commit action against the pending decompose proposal',
  function (this: AConversaWorld) {
    const projection = this.scratch['stProjection'] as Projection;
    const action: CommitAction = {
      kind: 'commit',
      requester: ST_HOST_ID,
      sessionId: ST_SESSION_ID,
      eventId: ST_COMMIT_EVENT_ID,
      sequence: nextSequence(projection),
      actor: ST_HOST_ID,
      createdAt: tsAt(20),
      proposalEventId: ST_DECOMPOSE_PROPOSAL_ID,
      committedAt: tsAt(20),
    };
    this.scratch['stCommitAction'] = action;
  },
);

When(
  'the methodology engine validates the commit action against the projected session for structural-target tests',
  function (this: AConversaWorld) {
    const projection = this.scratch['stProjection'] as Projection;
    const action = this.scratch['stCommitAction'] as CommitAction;
    this.scratch['stMethodologyResult'] = validateAction(projection, action);
  },
);

// ---------------------------------------------------------------
// Then steps.
// ---------------------------------------------------------------

Then('the validation result is Valid for structural-target tests', function (this: AConversaWorld) {
  const result = this.scratch['stMethodologyResult'] as ValidationResult;
  assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
});

Then(
  'the emitted commit event carries target "proposal" and the original decompose proposal id',
  function (this: AConversaWorld) {
    const result = this.scratch['stMethodologyResult'] as ValidationResult;
    assert.ok(result.ok, 'expected Valid result before asserting emission shape');
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event for a non-annotate commit');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'commit');
    if (ev.kind !== 'commit') return;
    // The mixed-model pin: structural sub-kinds keep `target: 'proposal'`
    // per ADR 0030 §9. If a future refactor flips the dispatcher into
    // the facet arm, this assertion fires.
    assert.equal(ev.payload.target, 'proposal');
    if (ev.payload.target !== 'proposal') return;
    assert.equal(ev.payload.proposal_id, ST_DECOMPOSE_PROPOSAL_ID);
    assert.equal(ev.payload.committed_by, ST_HOST_ID);
  },
);

Then(
  'appending the commit event to the session log and re-projecting moves the decompose proposal into committedProposals',
  async function (this: AConversaWorld) {
    const result = this.scratch['stMethodologyResult'] as ValidationResult;
    assert.ok(result.ok, 'expected Valid result before appending commit');
    if (!result.ok) return;
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'commit');
    await insertEventRow(this, ST_SESSION_ID, {
      id: ev.id,
      sequence: ev.sequence,
      kind: ev.kind,
      actor: ev.actor,
      payload: ev.payload,
      createdAt: ev.createdAt,
    });
    const projection = await projectFromDb(this);
    // Proposal-keyed arm of `handleCommit` removes the pending
    // proposal AND records it on `committedProposals`. This is the
    // ADR 0030 §9 contract.
    assert.ok(
      projection.getCommittedProposal(ST_DECOMPOSE_PROPOSAL_ID) !== undefined,
      'expected the decompose proposal to land on committedProposals after replay',
    );
    assert.equal(
      projection.getPendingProposal(ST_DECOMPOSE_PROPOSAL_ID),
      undefined,
      'expected the decompose proposal to be removed from pendingProposals after replay',
    );
  },
);
