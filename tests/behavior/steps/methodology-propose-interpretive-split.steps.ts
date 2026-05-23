// Steps for tests/behavior/methodology/propose-interpretive-split.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `interpretive-split` arm
// (`apps/server/src/methodology/handlers/propose.ts` — the
// `validateInterpretiveSplitProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeInterpretiveSplit.test.ts`
// cover the in-memory rule set. This file covers the DB-driven
// integration path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-interpretive-split action against
// the resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused
// from `methodology-engine.steps.ts` / `methodology-commit.steps.ts`
// (both read `this.scratch['methodologyResult']`).
//
// Refinement: tasks/refinements/data-and-methodology/interpretive_split_logic.md

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

// Distinct UUID prefix (`f0...`) to avoid scratch-state collisions with
// the propose-decompose step file's `e0...` prefix. Both files share
// the same Cucumber World so the prefixes keep their SQL rows in
// separate sessions.
const PIS_SESSION_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PIS_HOST_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PIS_DEBATER_A_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PIS_DEBATER_B_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PIS_PARENT_NODE_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PIS_PRIOR_DECOMPOSE_PROPOSAL_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PIS_PENDING_DECOMPOSE_PROPOSAL_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee006';
const PIS_NEW_EVENT_ID = 'f0eeeeee-eeee-4eee-8eee-eeeeeeeee007';

const TS_BASE = '2026-05-10T21:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + the four lifecycle events (session-created,
// 3x participant-joined). Caller layers in additional events per
// scenario.
async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PIS_HOST_ID, sub: 'fixture-pis:host', name: 'host' },
    { id: PIS_DEBATER_A_ID, sub: 'fixture-pis:a', name: 'a' },
    { id: PIS_DEBATER_B_ID, sub: 'fixture-pis:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PIS_SESSION_ID, PIS_HOST_ID, 'public', 'Propose-interpretive-split behavior tests'],
  );

  await insertEventRow(world, PIS_SESSION_ID, {
    id: evId(801),
    sequence: 1,
    kind: 'session-created',
    actor: PIS_HOST_ID,
    payload: {
      host_user_id: PIS_HOST_ID,
      privacy: 'public',
      topic: 'Propose-interpretive-split behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PIS_SESSION_ID, {
    id: evId(802),
    sequence: 2,
    kind: 'participant-joined',
    actor: PIS_HOST_ID,
    payload: {
      user_id: PIS_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PIS_SESSION_ID, {
    id: evId(803),
    sequence: 3,
    kind: 'participant-joined',
    actor: PIS_DEBATER_A_ID,
    payload: {
      user_id: PIS_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PIS_SESSION_ID, {
    id: evId(804),
    sequence: 4,
    kind: 'participant-joined',
    actor: PIS_DEBATER_B_ID,
    payload: {
      user_id: PIS_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertParentNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PIS_SESSION_ID, {
    id: evId(805),
    sequence: 5,
    kind: 'node-created',
    actor: PIS_DEBATER_A_ID,
    payload: {
      node_id: PIS_PARENT_NODE_ID,
      wording: 'A candidate parent statement for interpretive-split tests.',
      created_by: PIS_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PIS_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PIS_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate-parent node for propose-interpretive-split tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertParentNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a previously-decomposed parent node for propose-interpretive-split tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertParentNode(this);
    // A prior decompose proposal and its commit — the projection's
    // `applyCommittedProposal` decompose arm flips parent.visible=false
    // on commit. We hand-craft the events directly through pglite so
    // the read-side projection state matches what would happen after a
    // real decompose commit (the same pattern propose-decompose
    // scenarios use; commit_logic's structural-sub-kind boundary would
    // reject through the methodology engine but applyEvent doesn't
    // re-validate).
    await insertEventRow(this, PIS_SESSION_ID, {
      id: PIS_PRIOR_DECOMPOSE_PROPOSAL_ID,
      sequence: 6,
      kind: 'proposal',
      actor: PIS_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: PIS_PARENT_NODE_ID,
          components: [
            {
              wording: 'Prior decompose component one.',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-000000bb0001',
            },
            {
              wording: 'Prior decompose component two.',
              classification: 'value',
              node_id: '00000000-0000-4000-8000-000000bb0002',
            },
          ],
        },
      },
      createdAt: tsAt(5),
    });
    await insertEventRow(this, PIS_SESSION_ID, {
      id: evId(807),
      sequence: 7,
      kind: 'commit',
      actor: PIS_HOST_ID,
      payload: {
        target: 'proposal',
        proposal_id: PIS_PRIOR_DECOMPOSE_PROPOSAL_ID,
        committed_by: PIS_HOST_ID,
        committed_at: tsAt(6),
      },
      createdAt: tsAt(6),
    });
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a pending-decompose against the candidate-parent node for propose-interpretive-split tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertParentNode(this);
    // A decompose proposal lands but is NOT committed — it stays in
    // pendingProposals. The interpretive-split arm's rule 3 walks
    // pendingProposals via findConflictingProposalAgainst with the
    // {decompose, interpretive-split} set, finds this proposal, and
    // rejects with illegal-state-transition.
    await insertEventRow(this, PIS_SESSION_ID, {
      id: PIS_PENDING_DECOMPOSE_PROPOSAL_ID,
      sequence: 6,
      kind: 'proposal',
      actor: PIS_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: PIS_PARENT_NODE_ID,
          components: [
            {
              wording: 'Pending decompose component one.',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-000000bb0003',
            },
            {
              wording: 'Pending decompose component two.',
              classification: 'value',
              node_id: '00000000-0000-4000-8000-000000bb0004',
            },
          ],
        },
      },
      createdAt: tsAt(5),
    });
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-interpretive-split action against the visible parent',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PIS_DEBATER_A_ID,
      sessionId: PIS_SESSION_ID,
      eventId: PIS_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PIS_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: PIS_PARENT_NODE_ID,
        readings: [
          {
            wording: 'Reading one (fact).',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-000000bb0005',
          },
          {
            wording: 'Reading two (definitional).',
            classification: 'definitional',
            node_id: '00000000-0000-4000-8000-000000bb0006',
          },
        ],
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-interpretive-split action against the previously-decomposed parent',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PIS_DEBATER_A_ID,
      sessionId: PIS_SESSION_ID,
      eventId: PIS_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PIS_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: PIS_PARENT_NODE_ID,
        readings: [
          {
            wording: 'Retry reading one.',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-000000bb0007',
          },
          {
            wording: 'Retry reading two.',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-000000bb0008',
          },
        ],
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-interpretive-split action against the parent with a pending decompose',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PIS_DEBATER_A_ID,
      sessionId: PIS_SESSION_ID,
      eventId: PIS_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PIS_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: PIS_PARENT_NODE_ID,
        readings: [
          {
            wording: 'Conflicting reading one.',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-000000bb0009',
          },
          {
            wording: 'Conflicting reading two.',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-000000bb000a',
          },
        ],
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
  'the result carries the interpretive-split structural fan-out and proposal envelope',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    const action = this.scratch['proposeAction'] as ProposeAction;
    assert.equal(action.proposal.kind, 'interpretive-split');
    if (action.proposal.kind !== 'interpretive-split') return;
    const r1NodeId = action.proposal.readings[0]!.node_id;
    const r2NodeId = action.proposal.readings[1]!.node_id;

    // Per ADR 0027 a 2-reading interpretive-split emits 5 events in
    // order: node-created(r1), entity-included(r1), node-created(r2),
    // entity-included(r2), proposal.
    assert.equal(result.events.length, 5, 'expected 2N+1 = 5 events');
    const [r1Created, r1Included, r2Created, r2Included, proposalEvent] =
      result.events as readonly [Event, Event, Event, Event, Event];

    assert.equal(r1Created.kind, 'node-created');
    assert.equal(r1Created.sessionId, PIS_SESSION_ID);
    assert.equal(r1Created.sequence, action.sequence);
    if (r1Created.kind === 'node-created') {
      assert.equal(r1Created.payload.node_id, r1NodeId);
    }
    assert.equal(r1Included.kind, 'entity-included');
    assert.equal(r1Included.sequence, action.sequence + 1);
    if (r1Included.kind === 'entity-included') {
      assert.equal(r1Included.payload.entity_kind, 'node');
      assert.equal(r1Included.payload.entity_id, r1NodeId);
    }
    assert.equal(r2Created.kind, 'node-created');
    assert.equal(r2Created.sequence, action.sequence + 2);
    if (r2Created.kind === 'node-created') {
      assert.equal(r2Created.payload.node_id, r2NodeId);
    }
    assert.equal(r2Included.kind, 'entity-included');
    assert.equal(r2Included.sequence, action.sequence + 3);
    if (r2Included.kind === 'entity-included') {
      assert.equal(r2Included.payload.entity_kind, 'node');
      assert.equal(r2Included.payload.entity_id, r2NodeId);
    }

    assert.equal(proposalEvent.kind, 'proposal');
    assert.equal(proposalEvent.sessionId, PIS_SESSION_ID);
    assert.equal(proposalEvent.id, PIS_NEW_EVENT_ID);
    assert.equal(proposalEvent.sequence, action.sequence + 4);
    if (proposalEvent.kind === 'proposal') {
      const inner = proposalEvent.payload.proposal;
      assert.equal(inner.kind, 'interpretive-split');
      if (inner.kind === 'interpretive-split') {
        assert.equal(inner.parent_node_id, PIS_PARENT_NODE_ID);
        assert.equal(inner.readings.length, 2);
      }
    }
  },
);
