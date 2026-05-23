// Steps for tests/behavior/projection/facet-status.feature.
//
// The behavior-test layer for `deriveFacetStatus`. The Vitest tests at
// apps/server/src/projection/facet-status.test.ts cover the in-memory
// derivation against TS-literal events; these scenarios round-trip
// events through pglite's `session_events` table so the JSONB / BIGINT
// / TIMESTAMPTZ coercion is exercised on the derivation path too.
//
// Refinement: tasks/refinements/data-and-methodology/per_facet_status_derivation.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { evId, insertEventRow, rowToValidatedEvent, selectEvents } from '../support/event-rows.js';
import {
  deriveFacetStatus,
  projectFromLog,
  type Projection,
} from '../../../apps/server/src/projection/index.js';

// Distinct UUIDs from projection-from-log.steps.ts and projection-
// incremental.steps.ts so the three step files can co-exist in one
// Cucumber run without scenario cross-talk via the shared World.
const FS_SESSION_ID = '77777777-7777-4777-8777-777777777771';
const HOST_ID = '77777777-7777-4777-8777-777777777772';
const DEBATER_A_ID = '77777777-7777-4777-8777-777777777773';
const DEBATER_B_ID = '77777777-7777-4777-8777-777777777774';

const NODE_FS_ID = '77777777-7777-4777-8777-77777777777a';
const PROPOSAL_FS_CLASSIFY_ID = '77777777-7777-4777-8777-77777777777b';

const TS_BASE = '2026-05-10T14:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

Given(
  'a seeded session with three participants in session_events for facet-status tests',
  async function (this: AConversaWorld) {
    for (const u of [
      { id: HOST_ID, sub: 'fixture-fs:host', name: 'host' },
      { id: DEBATER_A_ID, sub: 'fixture-fs:a', name: 'a' },
      { id: DEBATER_B_ID, sub: 'fixture-fs:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [FS_SESSION_ID, HOST_ID, 'public', 'Projection facet-status behavior tests'],
    );

    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(101),
      sequence: 1,
      kind: 'session-created',
      actor: HOST_ID,
      payload: {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Projection facet-status behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(102),
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
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(103),
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
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(104),
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

    this.scratch['fsNextSeq'] = 5;
  },
);

Given(
  'a node-created event for the seeded facet-status session',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fsNextSeq'] as number;
    this.scratch['fsNextSeq'] = seq + 1;
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(seq * 100 + 5),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: NODE_FS_ID,
        wording: 'A statement under facet-status classification.',
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'an entity-included event for that node for facet-status tests',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fsNextSeq'] as number;
    this.scratch['fsNextSeq'] = seq + 1;
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(seq * 100 + 5),
      sequence: seq,
      kind: 'entity-included',
      actor: HOST_ID,
      payload: {
        entity_kind: 'node',
        entity_id: NODE_FS_ID,
        included_by: HOST_ID,
        included_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'a classify-node proposal event for that node with classification {string} for facet-status tests',
  async function (this: AConversaWorld, classification: string) {
    const seq = this.scratch['fsNextSeq'] as number;
    this.scratch['fsNextSeq'] = seq + 1;
    await insertEventRow(this, FS_SESSION_ID, {
      id: PROPOSAL_FS_CLASSIFY_ID,
      sequence: seq,
      kind: 'proposal',
      actor: DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'classify-node',
          node_id: NODE_FS_ID,
          classification,
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'three agree votes on that classify proposal for facet-status tests',
  async function (this: AConversaWorld) {
    for (const voter of [HOST_ID, DEBATER_A_ID, DEBATER_B_ID]) {
      const seq = this.scratch['fsNextSeq'] as number;
      this.scratch['fsNextSeq'] = seq + 1;
      await insertEventRow(this, FS_SESSION_ID, {
        id: evId(seq * 100 + 5),
        sequence: seq,
        kind: 'vote',
        actor: voter,
        payload: {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_FS_CLASSIFY_ID,
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
  'a commit event for that classify proposal for facet-status tests',
  async function (this: AConversaWorld) {
    const seq = this.scratch['fsNextSeq'] as number;
    this.scratch['fsNextSeq'] = seq + 1;
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(seq * 100 + 5),
      sequence: seq,
      kind: 'commit',
      actor: HOST_ID,
      payload: {
        proposal_id: PROPOSAL_FS_CLASSIFY_ID,
        moderator: HOST_ID,
        committed_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  "a withdraw-agreement event on that node's classification facet for facet-status tests",
  async function (this: AConversaWorld) {
    // Per ADR 0030 §3 + `pf_withdraw_agreement_event_kind`: withdrawal
    // is now its own event kind (not a `vote.choice = 'withdraw'`
    // arm). The downstream `pf_withdraw_agreement_handler` task adds
    // the projection-side handler that flips the facet status to
    // `withdrawn`; today the replay no-ops on this kind.
    const seq = this.scratch['fsNextSeq'] as number;
    this.scratch['fsNextSeq'] = seq + 1;
    await insertEventRow(this, FS_SESSION_ID, {
      id: evId(seq * 100 + 5),
      sequence: seq,
      kind: 'withdraw-agreement',
      actor: DEBATER_B_ID,
      payload: {
        entity_kind: 'node',
        entity_id: NODE_FS_ID,
        facet: 'classification',
        participant: DEBATER_B_ID,
        withdrawn_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'I project the facet-status event log via projectFromLog',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, FS_SESSION_ID);
    const events = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, FS_SESSION_ID);
    this.scratch['fsProjection'] = projection;
  },
);

Then(
  "deriveFacetStatus on the seeded node's classification facet is {string}",
  function (this: AConversaWorld, expected: string) {
    const projection = this.scratch['fsProjection'] as Projection;
    const status = deriveFacetStatus(projection, 'node', NODE_FS_ID, 'classification');
    assert.equal(status, expected);
  },
);
