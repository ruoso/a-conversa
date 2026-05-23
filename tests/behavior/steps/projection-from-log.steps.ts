// Steps for tests/behavior/projection/from-log.feature.
//
// The behavior-test layer for `projectFromLog`. Events are inserted
// into pglite's `session_events` table (via `loadFixture` for the
// empty-fixture scenario, or via parameterized INSERTs for the
// richer scenarios), SELECTed back out, mapped to typed `Event`
// envelopes, and replayed through `projectFromLog` from
// `apps/server/src/projection/replay.ts`. The Vitest tests cover the
// per-event-kind logic with TS-literal events; these scenarios
// exercise the DB-round-tripped path so any JSONB encoding quirk,
// TIMESTAMPTZ-vs-ISO-string mismatch, or BIGINT-vs-number issue
// surfaces here.
//
// **DB-row → Event-envelope field mapping.** `session_events` uses
// snake_case column names; the `EventEnvelope` type
// (packages/shared-types/src/events.ts) uses camelCase property
// names. The `rowToEventEnvelope` helper below performs the
// mapping explicitly:
//   id          (UUID)         -> id          (string)
//   session_id  (UUID)         -> sessionId   (string)
//   sequence    (BIGINT)       -> sequence    (number; coerced via Number())
//   kind        (TEXT)         -> kind        (EventKind)
//   actor       (UUID|NULL)    -> actor       (string|null)
//   payload     (JSONB)        -> payload     (per-kind payload type)
//   created_at  (TIMESTAMPTZ)  -> createdAt   (ISO-8601 string)
// The `created_at` round-trip is the subtle one: pglite returns
// TIMESTAMPTZ as a JS `Date`, which we convert to an ISO-8601
// string (the envelope-level Zod schema expects
// `z.string().datetime({ offset: true })`). BIGINT comes back as
// `string` from pglite; `Number()` coerces it to the JS number the
// envelope type uses (per the documented 2^53 ceiling).
//
// **`validateEvent` is the type bridge.** Rows are mapped to the
// envelope shape, then passed through `validateEvent` so the full
// validator → projection chain runs end-to-end. The empty-fixture
// scenario is the one exception (the bundled fixture's payloads
// pre-date the tightened payload schemas; we skip validation there
// and rely on the dispatcher's payload-field-tolerance, which is
// itself documented in `replay.ts`).

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld, QueryResult } from '../support/world.js';
import { loadFixture } from '../../../packages/test-fixtures/src/loader.js';
// Relative-path imports for shared-types and the projection module —
// matches the existing pattern in tests/behavior/steps/fixtures.steps.ts
// (which imports the test-fixtures loader by relative path rather than
// pulling the workspace package into the test code's dependency
// graph). The Cucumber runner loads these step files directly via
// tsx without workspace-package resolution.
import {
  type Event,
  type EventKind,
  validateEvent,
} from '../../../packages/shared-types/src/events.js';
import { type Projection, projectFromLog } from '../../../apps/server/src/projection/index.js';

// ---------------------------------------------------------------
// Stable UUIDs for the seeded scenarios. The bundled empty
// fixture's UUIDs (used by the first scenario) live in
// packages/test-fixtures/src/fixtures/empty/*.json — kept in
// sync with the constants below so a seeded scenario layered on
// top of the empty fixture would compose without id collisions.
// The seeded scenarios in this file do NOT use loadFixture; they
// build their own session row from these UUIDs.
// ---------------------------------------------------------------

const SEEDED_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const HOST_ID = '11111111-1111-4111-8111-111111111111';
const DEBATER_A_ID = '22222222-2222-4222-8222-222222222222';
const DEBATER_B_ID = '33333333-3333-4333-8333-333333333333';

const NODE_PARENT_ID = '66666666-6666-4666-8666-666666666661';
const NODE_COMPONENT_A_ID = '66666666-6666-4666-8666-666666666662';
const NODE_COMPONENT_B_ID = '66666666-6666-4666-8666-666666666663';
const NODE_GENERIC_ID = '66666666-6666-4666-8666-66666666666a';
const NODE_META_TARGET_ID = '66666666-6666-4666-8666-66666666666b';

const PROPOSAL_CLASSIFY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PROPOSAL_DECOMPOSE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const PROPOSAL_META_MOVE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

const SNAPSHOT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// Event-id helper. The dispatcher derives `pendingProposal` keys
// from `event.id`, so we need stable ids for proposal events
// referenced by later vote/commit events.
function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

// Stable timestamps. The replay dispatcher reads `event.createdAt`
// for snapshot records; pin a fixed ISO-8601 string so assertions
// are deterministic.
const TS_BASE = '2026-05-10T12:00:00.000Z';

function tsAt(offsetSeconds: number): string {
  const base = new Date(TS_BASE).getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

// ---------------------------------------------------------------
// DB-row mapping. The raw row shape returned by pglite's `query`.
// ---------------------------------------------------------------

interface SessionEventRow {
  id: string;
  session_id: string;
  // BIGINT — pglite typically returns as `string`; we coerce.
  sequence: string | number;
  kind: string;
  actor: string | null;
  // JSONB — pglite parses to a JS value (object/array/primitive).
  payload: unknown;
  // TIMESTAMPTZ — pglite returns as a JS Date.
  created_at: Date | string;
}

// Map a `session_events` row to the unvalidated envelope shape the
// `validateEvent` parser expects (camelCased keys; sequence as
// number; createdAt as ISO-8601 string). Caller decides whether to
// run `validateEvent` on the result.
function rowToEnvelopeShape(row: SessionEventRow): {
  id: string;
  sessionId: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: unknown;
  createdAt: string;
} {
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    // BIGINT coercion. JS number is safe up to 2^53 — the
    // documented per-session-sequence ceiling.
    sequence: Number(row.sequence),
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  };
}

async function selectEvents(world: AConversaWorld, sessionId: string): Promise<SessionEventRow[]> {
  const res = (await world.db.query(
    `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
    [sessionId],
  )) as QueryResult<SessionEventRow>;
  return res.rows;
}

// Validated row → typed Event. Used by every scenario except the
// empty-fixture one (whose payload schemas are looser than the
// validator allows).
function rowToValidatedEvent(row: SessionEventRow): Event {
  return validateEvent(rowToEnvelopeShape(row));
}

// Lookup the `kind` field on `EventKind` — narrows the row's
// `kind` string to the enum. Used by the empty-fixture path which
// builds an Event envelope by hand (bypassing validateEvent).
function asEventKind(k: string): EventKind {
  return k as EventKind;
}

// ---------------------------------------------------------------
// Empty-fixture scenario steps.
// ---------------------------------------------------------------

When(
  'I load the {string} fixture for projection',
  async function (this: AConversaWorld, name: string) {
    await loadFixture(name, this.client);
  },
);

When(
  'I read the empty-fixture events out of session_events and project them',
  async function (this: AConversaWorld) {
    // Bundled empty fixture's session id (see packages/test-
    // fixtures/src/fixtures/empty/session.json).
    const sessionId = SEEDED_SESSION_ID;
    const rows = await selectEvents(this, sessionId);

    // Build Event envelopes WITHOUT running validateEvent. The
    // bundled empty fixture's payloads pre-date the tightened
    // payload Zod schemas (e.g. session-created omits the now-
    // required `created_at`; participant-joined carries an extra
    // `participant_id` that the schema strips). The replay
    // dispatcher reads only the payload fields it needs, so the
    // projection populates correctly even though `validateEvent`
    // would reject. We document this here rather than rewrite the
    // fixture — the fixture's payload schema is owned by a
    // separate task; the replay layer's contract is that events
    // arrive already-validated, and downstream tightening of the
    // fixture is its own work.
    const events: Event[] = rows.map((row) => {
      const shape = rowToEnvelopeShape(row);
      return {
        id: shape.id,
        sessionId: shape.sessionId,
        sequence: shape.sequence,
        kind: asEventKind(shape.kind),
        actor: shape.actor,
        payload: shape.payload,
        createdAt: shape.createdAt,
      } as Event;
    });
    this.scratch['projection'] = projectFromLog(events, sessionId);
  },
);

// ---------------------------------------------------------------
// Seeded-session common Given step. Sets up the FK prerequisites
// (users, session row) and the three participant-joined events
// shared by every richer scenario in the file.
// ---------------------------------------------------------------

async function insertEventRow(
  world: AConversaWorld,
  args: {
    id: string;
    sequence: number;
    kind: string;
    actor: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  },
): Promise<void> {
  await world.db.query(
    `INSERT INTO session_events
       (id, session_id, sequence, kind, actor, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      args.id,
      SEEDED_SESSION_ID,
      args.sequence,
      args.kind,
      args.actor,
      JSON.stringify(args.payload),
      args.createdAt,
    ],
  );
}

Given(
  'a seeded session with three participants in session_events',
  async function (this: AConversaWorld) {
    // Users + session FK prereqs.
    for (const u of [
      { id: HOST_ID, sub: 'fixture:host', name: 'host' },
      { id: DEBATER_A_ID, sub: 'fixture:a', name: 'a' },
      { id: DEBATER_B_ID, sub: 'fixture:b', name: 'b' },
    ]) {
      await this.db.query(
        `INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`,
        [u.id, u.sub, u.name],
      );
    }
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
      [SEEDED_SESSION_ID, HOST_ID, 'public', 'Projection from-log behavior tests'],
    );

    // session-created + three participant-joined. Payloads conform
    // to the tightened Zod schemas (session_lifecycle_events) so
    // these rows DO round-trip through validateEvent cleanly.
    await insertEventRow(this, {
      id: evId(1),
      sequence: 1,
      kind: 'session-created',
      actor: HOST_ID,
      payload: {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Projection from-log behavior tests',
        created_at: tsAt(0),
      },
      createdAt: tsAt(0),
    });
    await insertEventRow(this, {
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
    await insertEventRow(this, {
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
    await insertEventRow(this, {
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

    // Seeded sequence counter. Later steps in the same scenario
    // append after the four participant/lifecycle rows above.
    this.scratch['nextSeq'] = 5;
  },
);

function nextSeq(world: AConversaWorld): number {
  const n = (world.scratch['nextSeq'] as number | undefined) ?? 1;
  world.scratch['nextSeq'] = n + 1;
  return n;
}

// ---------------------------------------------------------------
// classify-node scenario steps.
// ---------------------------------------------------------------

Given('a node-created event for the seeded session', async function (this: AConversaWorld) {
  const seq = nextSeq(this);
  await insertEventRow(this, {
    id: evId(seq * 10),
    sequence: seq,
    kind: 'node-created',
    actor: DEBATER_A_ID,
    payload: {
      node_id: NODE_GENERIC_ID,
      wording: 'A proposition under classification.',
      created_by: DEBATER_A_ID,
      created_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
});

Given('an entity-included event for that node', async function (this: AConversaWorld) {
  const seq = nextSeq(this);
  await insertEventRow(this, {
    id: evId(seq * 10),
    sequence: seq,
    kind: 'entity-included',
    actor: HOST_ID,
    payload: {
      entity_kind: 'node',
      entity_id: NODE_GENERIC_ID,
      included_by: HOST_ID,
      included_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
});

Given(
  'a classify-node proposal event for that node with classification {string}',
  async function (this: AConversaWorld, classification: string) {
    const seq = nextSeq(this);
    await insertEventRow(this, {
      id: PROPOSAL_CLASSIFY_ID,
      sequence: seq,
      kind: 'proposal',
      actor: DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'classify-node',
          node_id: NODE_GENERIC_ID,
          classification,
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

Given('three agree votes on that proposal', async function (this: AConversaWorld) {
  for (const voter of [HOST_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    const seq = nextSeq(this);
    await insertEventRow(this, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'vote',
      actor: voter,
      payload: {
        target: 'proposal' as const,
        proposal_id: PROPOSAL_CLASSIFY_ID,
        participant: voter,
        choice: 'agree',
        voted_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  }
});

Given('a commit event for that proposal', async function (this: AConversaWorld) {
  const seq = nextSeq(this);
  await insertEventRow(this, {
    id: evId(seq * 10),
    sequence: seq,
    kind: 'commit',
    actor: HOST_ID,
    payload: {
      target: 'proposal',
      proposal_id: PROPOSAL_CLASSIFY_ID,
      committed_by: HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
});

// ---------------------------------------------------------------
// decompose scenario steps.
// ---------------------------------------------------------------

const NAMED_NODES: Record<string, string> = {
  parent: NODE_PARENT_ID,
  componentA: NODE_COMPONENT_A_ID,
  componentB: NODE_COMPONENT_B_ID,
  metaTarget: NODE_META_TARGET_ID,
};

Given(
  'a node-created event named {string} for the seeded session',
  async function (this: AConversaWorld, name: string) {
    const nodeId = NAMED_NODES[name];
    assert.ok(nodeId, `unknown named node "${name}"`);
    const seq = nextSeq(this);
    await insertEventRow(this, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'node-created',
      actor: DEBATER_A_ID,
      payload: {
        node_id: nodeId,
        wording: `node:${name}`,
        created_by: DEBATER_A_ID,
        created_at: tsAt(seq),
      },
      createdAt: tsAt(seq),
    });
  },
);

Given(
  'a decompose proposal event on {string} with two components',
  async function (this: AConversaWorld, parentName: string) {
    const parentId = NAMED_NODES[parentName];
    assert.ok(parentId, `unknown named node "${parentName}"`);
    const seq = nextSeq(this);
    await insertEventRow(this, {
      id: PROPOSAL_DECOMPOSE_ID,
      sequence: seq,
      kind: 'proposal',
      actor: DEBATER_A_ID,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: parentId,
          components: [
            {
              wording: 'first component',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-000000cc0011',
            },
            {
              wording: 'second component',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-000000cc0012',
            },
          ],
        },
      },
      createdAt: tsAt(seq),
    });
  },
);

Given('a commit event for that decompose proposal', async function (this: AConversaWorld) {
  const seq = nextSeq(this);
  await insertEventRow(this, {
    id: evId(seq * 10),
    sequence: seq,
    kind: 'commit',
    actor: HOST_ID,
    payload: {
      target: 'proposal',
      proposal_id: PROPOSAL_DECOMPOSE_ID,
      committed_by: HOST_ID,
      committed_at: tsAt(seq),
    },
    createdAt: tsAt(seq),
  });
});

// ---------------------------------------------------------------
// snapshot scenario step.
// ---------------------------------------------------------------

Given(
  'a snapshot-created event with label {string} at log position {int}',
  async function (this: AConversaWorld, label: string, logPosition: number) {
    const seq = nextSeq(this);
    await insertEventRow(this, {
      id: evId(seq * 10),
      sequence: seq,
      kind: 'snapshot-created',
      actor: HOST_ID,
      payload: {
        snapshot_id: SNAPSHOT_ID,
        label,
        log_position: logPosition,
      },
      createdAt: tsAt(seq),
    });
  },
);

// ---------------------------------------------------------------
// Round-trip scenario step. Pins the non-trivial payload in code
// so the assertion can compare round-tripped against the literal
// without Gherkin having to render brace-shaped JSON in step text.
// See ADR 0022's framing — the probe IS the scenario; the literal
// is committed alongside the assertion.
// ---------------------------------------------------------------

const META_MOVE_PROBE_PAYLOAD = {
  proposal: {
    kind: 'meta-move',
    meta_kind: 'reframe',
    content: 'Reframe the debate to focus on definitional claims.',
    target_kind: 'node',
    target_id: NODE_META_TARGET_ID,
  },
} as const;

Given(
  'the meta-move probe proposal event is inserted into session_events',
  async function (this: AConversaWorld) {
    const seq = nextSeq(this);
    this.scratch['probeSequence'] = seq;
    this.scratch['probeCreatedAt'] = tsAt(seq);
    this.scratch['probePayload'] = META_MOVE_PROBE_PAYLOAD;
    await insertEventRow(this, {
      id: PROPOSAL_META_MOVE_ID,
      sequence: seq,
      kind: 'proposal',
      actor: DEBATER_A_ID,
      // Spread to defeat the readonly-literal type — JSON.stringify
      // re-serializes either way; this just satisfies TS.
      payload: { ...META_MOVE_PROBE_PAYLOAD },
      createdAt: tsAt(seq),
    });
  },
);

When(
  'I read the meta-move probe event back out of session_events',
  async function (this: AConversaWorld) {
    const res = (await this.db.query(
      `SELECT id, session_id, sequence, kind, actor, payload, created_at
       FROM session_events
       WHERE id = $1`,
      [PROPOSAL_META_MOVE_ID],
    )) as QueryResult<SessionEventRow>;
    assert.equal(res.rows.length, 1, 'expected one row for the probe event id');
    const row = res.rows[0]!;
    this.scratch['probeRow'] = row;
    this.scratch['probeEnvelopeShape'] = rowToEnvelopeShape(row);
  },
);

Then(
  'the round-tripped payload equals the originally-inserted payload exactly',
  function (this: AConversaWorld) {
    const row = this.scratch['probeRow'] as SessionEventRow;
    // deepEqual covers: every key present; no extra keys; nested
    // object structure preserved; string values byte-equal; the
    // string-typed UUID survives Postgres's JSONB string handling;
    // no field reordered or re-typed.
    assert.deepEqual(row.payload, META_MOVE_PROBE_PAYLOAD);
    // Belt-and-braces: also confirm sequence (BIGINT) coerces to
    // the same JS number we inserted, and created_at round-trips
    // through a Date back to an ISO-8601 string that re-parses to
    // the same instant.
    const shape = this.scratch['probeEnvelopeShape'] as ReturnType<typeof rowToEnvelopeShape>;
    assert.equal(shape.sequence, this.scratch['probeSequence']);
    assert.equal(
      new Date(shape.createdAt).toISOString(),
      new Date(this.scratch['probeCreatedAt'] as string).toISOString(),
    );
  },
);

Then(
  'validateEvent accepts the round-tripped envelope as a typed Event',
  function (this: AConversaWorld) {
    const shape = this.scratch['probeEnvelopeShape'] as ReturnType<typeof rowToEnvelopeShape>;
    const event = validateEvent(shape);
    assert.equal(event.kind, 'proposal');
    // Discriminated-union narrowing: the proposal payload is a
    // ProposalEnvelopePayload; inside, the proposal's inner kind
    // discriminates further. Confirm the meta-move sub-kind made
    // it through unchanged.
    if (event.kind !== 'proposal') {
      throw new Error('unreachable: kind asserted above');
    }
    assert.equal(event.payload.proposal.kind, 'meta-move');
    this.scratch['probeValidatedEvent'] = event;
  },
);

Then(
  'projectFromLog accepts the round-tripped event and records the proposal as pending',
  async function (this: AConversaWorld) {
    // Read the full event log (so the projection has the seeded
    // session + node-created for the meta-move target + the probe
    // proposal itself), validate each row, run projectFromLog.
    const rows = await selectEvents(this, SEEDED_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    const projection = projectFromLog(events, SEEDED_SESSION_ID);
    this.scratch['projection'] = projection;
    const pending = projection.getPendingProposal(PROPOSAL_META_MOVE_ID);
    assert.ok(pending, 'expected the meta-move proposal to be pending after replay');
    assert.equal(pending.payload.kind, 'meta-move');
  },
);

// ---------------------------------------------------------------
// Generic "read events and project" When step used by the
// classify, decompose, and snapshot scenarios.
// ---------------------------------------------------------------

When(
  'I read the seeded-session events out of session_events and project them',
  async function (this: AConversaWorld) {
    const rows = await selectEvents(this, SEEDED_SESSION_ID);
    const events: Event[] = rows.map(rowToValidatedEvent);
    this.scratch['projection'] = projectFromLog(events, SEEDED_SESSION_ID);
  },
);

// ---------------------------------------------------------------
// Assertion steps reading the projection off `this.scratch`.
// ---------------------------------------------------------------

function getProjection(world: AConversaWorld): Projection {
  const p = world.scratch['projection'];
  assert.ok(p, 'expected a projection in scratch');
  return p as Projection;
}

Then("the projection's sessionState is {string}", function (this: AConversaWorld, state: string) {
  assert.equal(getProjection(this).sessionState, state);
});

Then('the projection has {int} nodes', function (this: AConversaWorld, n: number) {
  assert.equal(getProjection(this).nodeCount(), n);
});

Then('the projection has {int} edges', function (this: AConversaWorld, n: number) {
  assert.equal(getProjection(this).edgeCount(), n);
});

Then('the projection has {int} pending proposals', function (this: AConversaWorld, n: number) {
  assert.equal(getProjection(this).pendingProposalCount(), n);
});

Then('the projection has {int} current participants', function (this: AConversaWorld, n: number) {
  assert.equal(getProjection(this).participantCount(), n);
});

Then(
  "the projection's participants have roles {string}, {string}, {string}",
  function (this: AConversaWorld, r1: string, r2: string, r3: string) {
    const roles = getProjection(this)
      .currentParticipants()
      .map((p) => p.role)
      .sort();
    assert.deepEqual(roles, [r1, r2, r3].sort());
  },
);

Then('the projection has {int} node', function (this: AConversaWorld, n: number) {
  // Singular variant for "1 node" / "0 node" prose. The {int}
  // matcher captures the number; the cucumber expression parser
  // requires distinct step texts for the singular and plural
  // forms.
  assert.equal(getProjection(this).nodeCount(), n);
});

Then(
  "the projected node's classification value is {string}",
  function (this: AConversaWorld, value: string) {
    const node = getProjection(this).getNode(NODE_GENERIC_ID);
    assert.ok(node, 'expected the classified node to be in the projection');
    assert.equal(node.classificationFacet.value, value);
  },
);

Then(
  "the projected node's classification status is {string}",
  function (this: AConversaWorld, status: string) {
    const node = getProjection(this).getNode(NODE_GENERIC_ID);
    assert.ok(node, 'expected the classified node to be in the projection');
    assert.equal(node.classificationFacet.status, status);
  },
);

Then('the parent node is in the projection but not visible', function (this: AConversaWorld) {
  const parent = getProjection(this).getNode(NODE_PARENT_ID);
  assert.ok(parent, 'expected the parent node to be in the projection');
  assert.equal(parent.visible, false);
});

Then('the component nodes are in the projection and visible', function (this: AConversaWorld) {
  const projection = getProjection(this);
  for (const id of [NODE_COMPONENT_A_ID, NODE_COMPONENT_B_ID]) {
    const node = projection.getNode(id);
    assert.ok(node, `expected component node ${id} to be in the projection`);
    assert.equal(node.visible, true);
  }
});

Then(
  'the projection has the labeled snapshot at log position {int}',
  function (this: AConversaWorld, position: number) {
    const snap = getProjection(this).getSnapshot(SNAPSHOT_ID);
    assert.ok(snap, 'expected the snapshot to be in the projection');
    assert.equal(snap.label, 'midpoint');
    assert.equal(snap.logPosition, position);
  },
);
