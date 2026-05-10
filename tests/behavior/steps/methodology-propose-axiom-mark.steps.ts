// Steps for tests/behavior/methodology/propose-axiom-mark.feature.
//
// The behavior-test layer for the methodology engine's propose handler,
// `axiom-mark` arm (`apps/server/src/methodology/handlers/propose.ts`
// — the `validateAxiomMarkProposal` branch). The Vitest tests at
// `apps/server/src/methodology/handlers/proposeAxiomMark.test.ts` cover
// the in-memory rule set. This file covers the DB-driven integration
// path: round-trip the session's events through pglite's
// `session_events`, replay through `projectFromLog`, then call
// `validateAction` with a propose-axiom-mark action against the
// resulting projection.
//
// The shared "Then the validation result is Valid" / "Then the
// validation result is Rejected with reason ..." steps are reused from
// `methodology-engine.steps.ts` / `methodology-commit.steps.ts` (both
// read `this.scratch['methodologyResult']`). The shared `When 'the
// methodology engine validates the propose action against the projected
// session'` step is reused from `methodology-propose-decompose.steps.ts`.
//
// Refinement: tasks/refinements/data-and-methodology/axiom_mark_logic.md

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

// Distinct UUID prefix (`a1...`) to avoid scratch-state collisions with
// the propose-decompose step file's `e0...` prefix and the propose-
// interpretive-split step file's `f0...` prefix. All three files share
// the same Cucumber World so the prefixes keep their SQL rows in
// separate sessions.
const PAM_SESSION_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee000';
const PAM_HOST_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee001';
const PAM_DEBATER_A_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee002';
const PAM_DEBATER_B_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee003';

const PAM_NODE_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee004';
const PAM_PRIOR_DECOMPOSE_PROPOSAL_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee005';
const PAM_NEW_EVENT_ID = 'a1eeeeee-eeee-4eee-8eee-eeeeeeeee006';

const TS_BASE = '2026-05-10T22:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// Insert users + session + the four lifecycle events (session-created,
// 3x participant-joined). Caller layers in additional events per
// scenario.
async function seedLifecycle(world: AConversaWorld): Promise<void> {
  for (const u of [
    { id: PAM_HOST_ID, sub: 'fixture-pam:host', name: 'host' },
    { id: PAM_DEBATER_A_ID, sub: 'fixture-pam:a', name: 'a' },
    { id: PAM_DEBATER_B_ID, sub: 'fixture-pam:b', name: 'b' },
  ]) {
    await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      u.id,
      u.sub,
      u.name,
    ]);
  }
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [PAM_SESSION_ID, PAM_HOST_ID, 'public', 'Propose-axiom-mark behavior tests'],
  );

  await insertEventRow(world, PAM_SESSION_ID, {
    id: evId(901),
    sequence: 1,
    kind: 'session-created',
    actor: PAM_HOST_ID,
    payload: {
      host_user_id: PAM_HOST_ID,
      privacy: 'public',
      topic: 'Propose-axiom-mark behavior tests',
      created_at: tsAt(0),
    },
    createdAt: tsAt(0),
  });
  await insertEventRow(world, PAM_SESSION_ID, {
    id: evId(902),
    sequence: 2,
    kind: 'participant-joined',
    actor: PAM_HOST_ID,
    payload: {
      user_id: PAM_HOST_ID,
      role: 'moderator',
      screen_name: 'host',
      joined_at: tsAt(1),
    },
    createdAt: tsAt(1),
  });
  await insertEventRow(world, PAM_SESSION_ID, {
    id: evId(903),
    sequence: 3,
    kind: 'participant-joined',
    actor: PAM_DEBATER_A_ID,
    payload: {
      user_id: PAM_DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'a',
      joined_at: tsAt(2),
    },
    createdAt: tsAt(2),
  });
  await insertEventRow(world, PAM_SESSION_ID, {
    id: evId(904),
    sequence: 4,
    kind: 'participant-joined',
    actor: PAM_DEBATER_B_ID,
    payload: {
      user_id: PAM_DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'b',
      joined_at: tsAt(3),
    },
    createdAt: tsAt(3),
  });
}

async function insertCandidateNode(world: AConversaWorld): Promise<void> {
  await insertEventRow(world, PAM_SESSION_ID, {
    id: evId(905),
    sequence: 5,
    kind: 'node-created',
    actor: PAM_DEBATER_A_ID,
    payload: {
      node_id: PAM_NODE_ID,
      wording: 'A candidate statement someone might hold as bedrock.',
      created_by: PAM_DEBATER_A_ID,
      created_at: tsAt(4),
    },
    createdAt: tsAt(4),
  });
}

async function projectFromDb(world: AConversaWorld): Promise<Projection> {
  const rows = await selectEvents(world, PAM_SESSION_ID);
  const events: Event[] = rows.map(rowToValidatedEvent);
  return projectFromLog(events, PAM_SESSION_ID);
}

// ---------------------------------------------------------------
// Given steps.
// ---------------------------------------------------------------

Given(
  'a seeded session with three participants and a visible candidate node for propose-axiom-mark tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

Given(
  'a seeded session with three participants and a previously-decomposed candidate node for propose-axiom-mark tests',
  async function (this: AConversaWorld) {
    await seedLifecycle(this);
    await insertCandidateNode(this);
    // A prior decompose proposal and its commit — the projection's
    // `applyCommittedProposal` decompose arm flips node.visible=false
    // on commit. We hand-craft the events directly through pglite so
    // the read-side projection state matches what would happen after
    // a real decompose commit (same pattern propose-decompose and
    // propose-interpretive-split scenarios use; commit_logic's
    // structural-sub-kind boundary would reject through the
    // methodology engine but applyEvent doesn't re-validate).
    await insertEventRow(this, PAM_SESSION_ID, {
      id: PAM_PRIOR_DECOMPOSE_PROPOSAL_ID,
      sequence: 6,
      kind: 'proposal',
      actor: PAM_DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: PAM_NODE_ID,
          components: [
            { wording: 'Prior decompose component one.', classification: 'fact' },
            { wording: 'Prior decompose component two.', classification: 'value' },
          ],
        },
      },
      createdAt: tsAt(5),
    });
    await insertEventRow(this, PAM_SESSION_ID, {
      id: evId(907),
      sequence: 7,
      kind: 'commit',
      actor: PAM_HOST_ID,
      payload: {
        proposal_id: PAM_PRIOR_DECOMPOSE_PROPOSAL_ID,
        moderator: PAM_HOST_ID,
        committed_at: tsAt(6),
      },
      createdAt: tsAt(6),
    });
    this.scratch['proposeProjection'] = await projectFromDb(this);
  },
);

// ---------------------------------------------------------------
// When steps.
// ---------------------------------------------------------------

When(
  'a debater constructs a propose-axiom-mark action on their own behalf against the visible node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PAM_DEBATER_A_ID,
      sessionId: PAM_SESSION_ID,
      eventId: PAM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PAM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'axiom-mark',
        node_id: PAM_NODE_ID,
        participant: PAM_DEBATER_A_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  "debater A constructs a propose-axiom-mark action targeting debater B's participation",
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PAM_DEBATER_A_ID,
      sessionId: PAM_SESSION_ID,
      eventId: PAM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PAM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'axiom-mark',
        node_id: PAM_NODE_ID,
        // Cross-participant marking: A's request, B's bedrock — rule 3
        // rejects.
        participant: PAM_DEBATER_B_ID,
      },
    };
    this.scratch['proposeAction'] = action;
  },
);

When(
  'a debater constructs a propose-axiom-mark action on their own behalf against the previously-decomposed node',
  function (this: AConversaWorld) {
    const projection = this.scratch['proposeProjection'] as Projection;
    const action: ProposeAction = {
      kind: 'propose',
      requester: PAM_DEBATER_A_ID,
      sessionId: PAM_SESSION_ID,
      eventId: PAM_NEW_EVENT_ID,
      sequence: nextSequence(projection),
      actor: PAM_DEBATER_A_ID,
      createdAt: tsAt(20),
      proposal: {
        kind: 'axiom-mark',
        node_id: PAM_NODE_ID,
        participant: PAM_DEBATER_A_ID,
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
  'the result carries a single proposal event for the axiom-mark action',
  function (this: AConversaWorld) {
    const result = this.scratch['methodologyResult'] as ValidationResult;
    assert.ok(result.ok, `expected Valid, got ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.events.length, 1, 'expected exactly one event');
    const ev = result.events[0]!;
    assert.equal(ev.kind, 'proposal');
    assert.equal(ev.sessionId, PAM_SESSION_ID);
    assert.equal(ev.id, PAM_NEW_EVENT_ID);
    if (ev.kind === 'proposal') {
      const inner = ev.payload.proposal;
      assert.equal(inner.kind, 'axiom-mark');
      if (inner.kind === 'axiom-mark') {
        assert.equal(inner.node_id, PAM_NODE_ID);
        assert.equal(inner.participant, PAM_DEBATER_A_ID);
      }
    }
  },
);
