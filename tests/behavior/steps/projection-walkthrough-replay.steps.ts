// Steps for tests/behavior/projection/walkthrough-replay.feature.
//
// Loads the bundled `walkthrough` fixture (packages/test-fixtures/src/
// fixtures/walkthrough/) into pglite, reads the resulting event log out
// of `session_events`, runs each row through `validateEvent`, replays
// via `projectFromLog`, then exposes the resulting `Projection` to a set
// of focused assertion steps that walk the coda checklist named in
// docs/example-walkthrough.md.
//
// The walkthrough identifier → UUID mapping below mirrors the fixture's
// meta.json header — both files must move in lockstep when a node is
// renamed. The mapping is small (~40 ids) and lives in source rather
// than reading meta.json so step definitions stay easy to scan.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { loadFixture } from '../../../packages/test-fixtures/src/loader.js';
import { type Event, validateEvent } from '../../../packages/shared-types/src/events.js';
import {
  deriveFacetStatus,
  isEdgeActive,
  type Projection,
  projectFromLog,
} from '../../../apps/server/src/projection/index.js';

import type { AConversaWorld, QueryResult } from '../support/world.js';

// ---------------------------------------------------------------
// Walkthrough identifier mapping. Keep these in lockstep with
// packages/test-fixtures/src/fixtures/walkthrough/meta.json.
// ---------------------------------------------------------------

const WALKTHROUGH_SESSION_ID = '10000005-0000-4000-8000-000000000001';

const ANNA_USER_ID = '10000001-0000-4000-8000-00000000a001';
const BEN_USER_ID = '10000001-0000-4000-8000-00000000b001';

const N_OPENER_A = '10000010-0000-4000-8000-0000000000a0';
const N_LEG_B = '10000010-0000-4000-8000-0000000000b0';

const NODE_IDS: Record<string, string> = {
  N1: '10000010-0000-4000-8000-000000000001',
  N2: '10000010-0000-4000-8000-000000000002',
  N3: '10000010-0000-4000-8000-000000000003',
  N4: '10000010-0000-4000-8000-000000000004',
  N5: '10000010-0000-4000-8000-000000000005',
  N6: '10000010-0000-4000-8000-000000000006',
  N7: '10000010-0000-4000-8000-000000000007',
  N8: '10000010-0000-4000-8000-000000000008',
  N9: '10000010-0000-4000-8000-000000000009',
  N10: '10000010-0000-4000-8000-000000000010',
  N11: '10000010-0000-4000-8000-000000000011',
  N12: '10000010-0000-4000-8000-000000000012',
  N13: '10000010-0000-4000-8000-000000000013',
  N14: '10000010-0000-4000-8000-000000000014',
  N15: '10000010-0000-4000-8000-000000000015',
  N16: '10000010-0000-4000-8000-000000000016',
  N17: '10000010-0000-4000-8000-000000000017',
  N18: '10000010-0000-4000-8000-000000000018',
  N19: '10000010-0000-4000-8000-000000000019',
  N_OPENER_A,
  N_LEG_B,
};

const EDGE_IDS: Record<string, string> = {
  E1: '10000020-0000-4000-8000-000000000001',
  E2: '10000020-0000-4000-8000-000000000002',
  E3: '10000020-0000-4000-8000-000000000003',
  E4: '10000020-0000-4000-8000-000000000004',
  E5: '10000020-0000-4000-8000-000000000005',
  E6: '10000020-0000-4000-8000-000000000006',
  E7: '10000020-0000-4000-8000-000000000007',
  E8: '10000020-0000-4000-8000-000000000008',
  E9: '10000020-0000-4000-8000-000000000009',
  E10: '10000020-0000-4000-8000-000000000010',
  E11: '10000020-0000-4000-8000-000000000011',
  E11a: '10000020-0000-4000-8000-00000000011a',
  E11b: '10000020-0000-4000-8000-00000000011b',
  E12: '10000020-0000-4000-8000-000000000012',
  E13: '10000020-0000-4000-8000-000000000013',
  E14: '10000020-0000-4000-8000-000000000014',
  E15: '10000020-0000-4000-8000-000000000015',
};

const ANNOTATION_IDS: Record<string, string> = {
  A1: '10000030-0000-4000-8000-000000000001',
  A2: '10000030-0000-4000-8000-000000000002',
  A3: '10000030-0000-4000-8000-000000000003',
};

// ---------------------------------------------------------------
// Shared DB-row → typed-Event helpers (parallel to those in
// projection-from-log.steps.ts).
// ---------------------------------------------------------------

interface SessionEventRow {
  id: string;
  session_id: string;
  sequence: string | number;
  kind: string;
  actor: string | null;
  payload: unknown;
  created_at: Date | string;
}

function rowToValidatedEvent(row: SessionEventRow): Event {
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return validateEvent({
    id: row.id,
    sessionId: row.session_id,
    sequence: Number(row.sequence),
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  });
}

function getWalkthroughProjection(world: AConversaWorld): Projection {
  const p = world.scratch['walkthroughProjection'];
  assert.ok(p, 'expected the walkthrough projection in scratch — call the When step first');
  return p as Projection;
}

function resolveNode(label: string): string {
  const id = NODE_IDS[label];
  assert.ok(id, `unknown walkthrough node label "${label}"`);
  return id;
}

function resolveEdge(label: string): string {
  const id = EDGE_IDS[label];
  assert.ok(id, `unknown walkthrough edge label "${label}"`);
  return id;
}

function resolveAnnotation(label: string): string {
  const id = ANNOTATION_IDS[label];
  assert.ok(id, `unknown walkthrough annotation label "${label}"`);
  return id;
}

// ---------------------------------------------------------------
// Steps.
// ---------------------------------------------------------------

When('I load the walkthrough fixture and project it', async function (this: AConversaWorld) {
  await loadFixture('walkthrough', this.client);
  const res = (await this.db.query(
    `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
    [WALKTHROUGH_SESSION_ID],
  )) as QueryResult<SessionEventRow>;
  const events: Event[] = res.rows.map(rowToValidatedEvent);
  this.scratch['walkthroughProjection'] = projectFromLog(events, WALKTHROUGH_SESSION_ID);
});

Given(
  'the walkthrough fixture has been loaded and projected',
  async function (this: AConversaWorld) {
    await loadFixture('walkthrough', this.client);
    const res = (await this.db.query(
      `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
      [WALKTHROUGH_SESSION_ID],
    )) as QueryResult<SessionEventRow>;
    const events: Event[] = res.rows.map(rowToValidatedEvent);
    this.scratch['walkthroughProjection'] = projectFromLog(events, WALKTHROUGH_SESSION_ID);
  },
);

Then(
  "the walkthrough projection's sessionState is {string}",
  function (this: AConversaWorld, state: string) {
    assert.equal(getWalkthroughProjection(this).sessionState, state);
  },
);

Then(
  'the walkthrough projection has at least {int} nodes',
  function (this: AConversaWorld, n: number) {
    assert.ok(
      getWalkthroughProjection(this).nodeCount() >= n,
      `expected at least ${n} nodes; got ${getWalkthroughProjection(this).nodeCount()}`,
    );
  },
);

Then('the walkthrough projection has {int} edges', function (this: AConversaWorld, n: number) {
  assert.equal(getWalkthroughProjection(this).edgeCount(), n);
});

Then(
  'the walkthrough projection has {int} annotations',
  function (this: AConversaWorld, n: number) {
    assert.equal(getWalkthroughProjection(this).annotationCount(), n);
  },
);

Then(
  'the walkthrough projection has {int} current participants',
  function (this: AConversaWorld, n: number) {
    assert.equal(getWalkthroughProjection(this).participantCount(), n);
  },
);

Then(
  'the walkthrough projection has at least {int} pending proposal',
  function (this: AConversaWorld, n: number) {
    assert.ok(
      getWalkthroughProjection(this).pendingProposalCount() >= n,
      `expected at least ${n} pending proposals; got ${getWalkthroughProjection(this).pendingProposalCount()}`,
    );
  },
);

Then(
  'walkthrough node {word} classification facet is {string}',
  function (this: AConversaWorld, label: string, status: string) {
    const nodeId = resolveNode(label);
    const projection = getWalkthroughProjection(this);
    const actual = deriveFacetStatus(projection, 'node', nodeId, 'classification');
    assert.equal(actual, status, `node ${label}.classification: expected ${status}, got ${actual}`);
  },
);

Then(
  'walkthrough node {word} substance facet is {string}',
  function (this: AConversaWorld, label: string, status: string) {
    const nodeId = resolveNode(label);
    const projection = getWalkthroughProjection(this);
    const actual = deriveFacetStatus(projection, 'node', nodeId, 'substance');
    assert.equal(actual, status, `node ${label}.substance: expected ${status}, got ${actual}`);
  },
);

Then(
  'walkthrough node {word} substance facet is not {string}',
  function (this: AConversaWorld, label: string, status: string) {
    const nodeId = resolveNode(label);
    const projection = getWalkthroughProjection(this);
    const actual = deriveFacetStatus(projection, 'node', nodeId, 'substance');
    assert.notEqual(
      actual,
      status,
      `node ${label}.substance: expected NOT ${status}, got ${actual}`,
    );
  },
);

Then(
  'walkthrough edge {word} substance facet is {string}',
  function (this: AConversaWorld, label: string, status: string) {
    const edgeId = resolveEdge(label);
    const projection = getWalkthroughProjection(this);
    const actual = deriveFacetStatus(projection, 'edge', edgeId, 'substance');
    assert.equal(actual, status, `edge ${label}.substance: expected ${status}, got ${actual}`);
  },
);

Then(
  'walkthrough edge {word} substance facet is not {string}',
  function (this: AConversaWorld, label: string, status: string) {
    const edgeId = resolveEdge(label);
    const projection = getWalkthroughProjection(this);
    const actual = deriveFacetStatus(projection, 'edge', edgeId, 'substance');
    assert.notEqual(
      actual,
      status,
      `edge ${label}.substance: expected NOT ${status}, got ${actual}`,
    );
  },
);

Then(
  'walkthrough annotation {word} substance facet is not {string}',
  function (this: AConversaWorld, label: string, status: string) {
    const annId = resolveAnnotation(label);
    const projection = getWalkthroughProjection(this);
    const actual = deriveFacetStatus(projection, 'annotation', annId, 'substance');
    assert.notEqual(
      actual,
      status,
      `annotation ${label}.substance: expected NOT ${status}, got ${actual}`,
    );
  },
);

Then(
  'walkthrough node {word} is in the projection but not visible',
  function (this: AConversaWorld, label: string) {
    const nodeId = resolveNode(label);
    const node = getWalkthroughProjection(this).getNode(nodeId);
    assert.ok(node, `node ${label} should be in the projection`);
    assert.equal(node.visible, false, `node ${label} should be invisible`);
  },
);

Then(
  'walkthrough annotation {word} is present in the projection',
  function (this: AConversaWorld, label: string) {
    const annId = resolveAnnotation(label);
    const ann = getWalkthroughProjection(this).getAnnotation(annId);
    assert.ok(ann, `annotation ${label} should be in the projection`);
  },
);

Then('walkthrough node N12 carries an axiom-mark for Anna', function (this: AConversaWorld) {
  const node = getWalkthroughProjection(this).getNode(NODE_IDS['N12']!);
  assert.ok(node, 'N12 should be in the projection');
  assert.ok(
    node.axiomMarks.has(ANNA_USER_ID),
    `N12 should carry an axiom-mark for Anna (${ANNA_USER_ID})`,
  );
});

Then('walkthrough node N12 carries an axiom-mark for Ben', function (this: AConversaWorld) {
  const node = getWalkthroughProjection(this).getNode(NODE_IDS['N12']!);
  assert.ok(node, 'N12 should be in the projection');
  assert.ok(
    node.axiomMarks.has(BEN_USER_ID),
    `N12 should carry an axiom-mark for Ben (${BEN_USER_ID})`,
  );
});

Then(
  'walkthrough node N12 carries exactly {int} axiom-marks',
  function (this: AConversaWorld, count: number) {
    const node = getWalkthroughProjection(this).getNode(NODE_IDS['N12']!);
    assert.ok(node, 'N12 should be in the projection');
    assert.equal(node.axiomMarks.size, count);
  },
);

Then('walkthrough edge {word} is not active', function (this: AConversaWorld, label: string) {
  const edgeId = resolveEdge(label);
  const projection = getWalkthroughProjection(this);
  assert.equal(
    isEdgeActive(projection, edgeId),
    false,
    `edge ${label} should be inactive (one endpoint substance is not committed)`,
  );
});

Then(
  'the walkthrough projection contains a snapshot labeled {string}',
  function (this: AConversaWorld, label: string) {
    const projection = getWalkthroughProjection(this);
    let found = false;
    for (const snap of projection.snapshots()) {
      if (snap.label === label) {
        found = true;
        break;
      }
    }
    assert.ok(found, `expected a snapshot labeled "${label}" on the projection`);
  },
);
