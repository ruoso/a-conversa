// Step definitions for tests/behavior/backend/ws-propose.feature.
//
// Refinement: tasks/refinements/backend/ws_propose_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_propose_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `propose` WS handler — exercises the full subscribe → propose →
// engine validation → INSERT → COMMIT → broadcast → ack path through
// the real `__buildTestWsApp` instance against pglite.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The first WS client + the subscribe
// envelope are owned by `backend-ws-connection.steps.ts` and
// `backend-ws-subscribe.steps.ts`. The second WS client + the
// broadcast-frame queue scaffolding are owned by
// `backend-ws-event-broadcast.steps.ts`. This file adds only the
// propose-specific verbs:
//
//   1. The `Given a propose-ready session for <screen_name> exists with
//      id <session_id> and node id <node_id>` step — seeds a session
//      row + a participant row for the host + a `session-created` /
//      `participant-joined` / `node-created` event sequence so the
//      propose has a valid sequence-3 baseline and a target node id
//      the annotate sub-kind accepts.
//   2. The `When the client sends a propose envelope ...` step — sends
//      an `annotate` propose envelope on the open client and captures
//      the next inbound frame.
//   3. The `Then the client receives a proposed ack ...` step — asserts
//      the ack shape, the `inResponseTo` correlation, and the
//      `payload.sequence`.
//   4. The `Then the client receives an error envelope with code
//      <code> referencing the propose envelope` step — asserts the
//      rejection wire shape.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { AConversaWorld, QueryResult } from '../support/world.js';

interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface ProposeScratch {
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsProposeMessageId?: string;
  wsProposeFrames?: string[];
}

function scratch(world: AConversaWorld): ProposeScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ProposeScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function getClient(world: AConversaWorld): WsClient {
  const ws = scratch(world).wsLifecycleClient;
  assert.ok(
    ws,
    'no ws client — the `an authenticated WebSocket client connects to "/api/ws"` When step must precede',
  );
  return ws;
}

function ensureProposeFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsProposeFrames === undefined) {
    s.wsProposeFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsProposeFrames?.push(toUtf8(data));
    });
  }
  return s.wsProposeFrames;
}

async function waitForFrame(
  queue: string[],
  predicate: (parsed: Record<string, unknown>) => boolean,
  timeoutMs = 1500,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = 0; i < queue.length; i++) {
      const raw = queue[i]!;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (predicate(parsed)) {
        queue.splice(i, 1);
        return parsed;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

// ============================================================
// Givens — seed a propose-ready session: session row, host
// participant, session-created event, participant-joined event,
// node-created event. After the seed, MAX(sequence)=3 and the
// fixture user is a participant + a node with `node_id` is visible.
// ============================================================

Given(
  'a propose-ready session for {string} exists with id {string} and node id {string}',
  async function (this: AConversaWorld, hostScreenName: string, sessionId: string, nodeId: string) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      hostScreenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${hostScreenName}`);

    // Session row.
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Propose test (${hostScreenName})`],
    );

    // Participant row (host as moderator) — needed for the engine's
    // universal `not-a-participant` gate to PASS for the propose.
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );

    // Seed events: session-created (seq 1) + participant-joined (seq 2)
    // + node-created (seq 3). After the seed, the propose at seq 4
    // targets the node.
    const t0 = '2026-05-11T10:00:00.000Z';
    const t1 = '2026-05-11T10:00:01.000Z';
    const t2 = '2026-05-11T10:00:02.000Z';
    const sessionCreatedId = randomUUID();
    const participantJoinedId = randomUUID();
    const nodeCreatedId = randomUUID();

    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 1, 'session-created', $3, $4::jsonb, $5)`,
      [
        sessionCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          host_user_id: hostId,
          privacy: 'public',
          topic: `Propose test (${hostScreenName})`,
          created_at: t0,
        }),
        t0,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 2, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        participantJoinedId,
        sessionId,
        hostId,
        JSON.stringify({
          user_id: hostId,
          role: 'moderator',
          screen_name: hostScreenName,
          joined_at: t1,
        }),
        t1,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 3, 'node-created', $3, $4::jsonb, $5)`,
      [
        nodeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim to annotate during the cucumber propose scenario.',
          created_by: hostId,
          created_at: t2,
        }),
        t2,
      ],
    );
  },
);

// ============================================================
// Givens — seed a propose-ready session that ALSO includes a second
// node + an extant edge (`supports`, source → target) so the
// `set-edge-substance` arm of the propose-handler sequence gate (per
// `pf_shape_facet_wire_vote` + ADR 0030 §8) has an extant edge to
// fire against. The edge's `shape` facet is `'proposed'` (inline
// candidate from `edge-created`, no votes); the gate refuses
// `set-edge-substance` against this edge until the shape facet
// advances. After this seed MAX(sequence)=6 (session-created +
// participant-joined + 2× node-created + edge-created + entity-
// included for the edge). Note `node-created` events do NOT carry an
// entity-included sibling per `mod_proposed_entity_canvas_visibility`
// (ADR 0027): nodes are visible at propose-time without inclusion,
// but the edge needs the `entity-included` to be projected as
// visible. The host's node-created sibling matches the
// `propose-ready session` step's "no entity-included on the seeded
// node" convention so the predicate gate's `visible` check on the
// second node alone is not load-bearing here.
// ============================================================

Given(
  'a propose-ready-with-edge session for {string} exists with id {string} and node ids {string} and {string} and edge id {string}',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    sourceNodeId: string,
    targetNodeId: string,
    edgeId: string,
  ) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      hostScreenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${hostScreenName}`);

    // Session row.
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Propose-with-edge test (${hostScreenName})`],
    );

    // Participant row (host as moderator) — needed for the engine's
    // universal `not-a-participant` gate to PASS for the propose.
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );

    // Seed events: session-created (seq 1) + participant-joined (seq 2)
    // + 2× node-created (seq 3, 4) + edge-created (seq 5) +
    // entity-included for the edge (seq 6). After the seed MAX
    // (sequence)=6 and the propose at seq 7 targets the extant edge.
    const t0 = '2026-05-11T10:00:00.000Z';
    const t1 = '2026-05-11T10:00:01.000Z';
    const t2 = '2026-05-11T10:00:02.000Z';
    const t3 = '2026-05-11T10:00:03.000Z';
    const sessionCreatedId = randomUUID();
    const participantJoinedId = randomUUID();
    const sourceNodeCreatedId = randomUUID();
    const targetNodeCreatedId = randomUUID();
    const edgeCreatedId = randomUUID();
    const edgeIncludedId = randomUUID();

    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 1, 'session-created', $3, $4::jsonb, $5)`,
      [
        sessionCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          host_user_id: hostId,
          privacy: 'public',
          topic: `Propose-with-edge test (${hostScreenName})`,
          created_at: t0,
        }),
        t0,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 2, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        participantJoinedId,
        sessionId,
        hostId,
        JSON.stringify({
          user_id: hostId,
          role: 'moderator',
          screen_name: hostScreenName,
          joined_at: t1,
        }),
        t1,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 3, 'node-created', $3, $4::jsonb, $5)`,
      [
        sourceNodeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          node_id: sourceNodeId,
          wording: 'Source claim for the cucumber set-edge-substance scenario.',
          created_by: hostId,
          created_at: t2,
        }),
        t2,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'node-created', $3, $4::jsonb, $5)`,
      [
        targetNodeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          node_id: targetNodeId,
          wording: 'Target claim for the cucumber set-edge-substance scenario.',
          created_by: hostId,
          created_at: t2,
        }),
        t2,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 5, 'edge-created', $3, $4::jsonb, $5)`,
      [
        edgeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          edge_id: edgeId,
          role: 'supports',
          source_node_id: sourceNodeId,
          target_node_id: targetNodeId,
          created_by: hostId,
          created_at: t2,
        }),
        t2,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'entity-included', $3, $4::jsonb, $5)`,
      [
        edgeIncludedId,
        sessionId,
        hostId,
        JSON.stringify({
          entity_kind: 'edge',
          entity_id: edgeId,
          included_by: hostId,
          included_at: t3,
        }),
        t3,
      ],
    );
  },
);

// ============================================================
// Whens — send a propose envelope on the open client.
// ============================================================

When(
  'the client sends a propose envelope for session {string} with expectedSequence {int} targeting node {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    targetNodeId: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsProposeMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send so
    // the response is captured.
    ensureProposeFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'propose',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          proposal: {
            kind: 'annotate',
            target_kind: 'node',
            target_id: targetNodeId,
            annotation_kind: 'note',
            content: 'A note attached during the cucumber propose scenario.',
          },
        },
      }),
    );
  },
);

// `classify-node` against an EXTANT node id (no inline `wording`
// field — that's the legacy-bundle exemption path; this step
// deliberately omits it so the server-enforced per-facet sequence
// gate (per `pf_sequence_gate_server_enforced` + ADR 0030 §8) fires).
// The seeded `node-created` event leaves the wording facet at
// `'proposed'` (inline candidate, no votes); the gate refuses with
// `facet-sequence-out-of-order` and the connection stays open per
// ADR 0029.
When(
  'the client sends a classify-node propose envelope for session {string} with expectedSequence {int} targeting extant node {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    targetNodeId: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsProposeMessageId = messageId;
    ensureProposeFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'propose',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          proposal: {
            kind: 'classify-node',
            node_id: targetNodeId,
            classification: 'fact',
          },
        },
      }),
    );
  },
);

// `set-edge-substance` against an EXTANT edge id without endpoint
// fields — the substance-only re-vote shape. Per
// `pf_shape_facet_wire_vote` + ADR 0030 §8 the propose-handler
// sequence gate refuses this proposal while the edge's `shape` facet
// is not `'agreed'` / `'committed'`. The seeded edge's shape facet is
// `'proposed'` (inline candidate, no votes); the gate refuses with
// `facet-sequence-out-of-order` and the connection stays open per
// ADR 0029.
When(
  'the client sends a set-edge-substance propose envelope for session {string} with expectedSequence {int} targeting extant edge {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    targetEdgeId: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsProposeMessageId = messageId;
    ensureProposeFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'propose',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          proposal: {
            kind: 'set-edge-substance',
            edge_id: targetEdgeId,
            value: 'agreed',
          },
        },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a proposed ack referencing the propose envelope at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const s = scratch(this);
    const queue = ensureProposeFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'proposed');
    assert.ok(ack, 'did not receive a `proposed` ack within timeout');
    assert.equal(ack.type, 'proposed');
    assert.equal(
      ack.inResponseTo,
      s.wsProposeMessageId,
      `expected inResponseTo to match the propose envelope's id (${s.wsProposeMessageId})`,
    );
    const payload = ack.payload as { sessionId?: unknown; sequence?: unknown; eventId?: unknown };
    assert.equal(payload.sequence, sequence);
    assert.ok(
      typeof payload.eventId === 'string' && payload.eventId.length > 0,
      'expected payload.eventId to be a non-empty string',
    );
    assert.ok(
      typeof payload.sessionId === 'string' && payload.sessionId.length > 0,
      'expected payload.sessionId to be a non-empty string',
    );
  },
);

Then(
  'the client also receives an event-applied envelope for sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    // Distinct from the existing `the client receives an event-applied
    // envelope for sequence {int}` in
    // `tests/behavior/steps/backend-ws-event-broadcast.steps.ts:308`
    // — that step reads from the broadcast-feature's own queue
    // (`wsBroadcastFrames`), which it lazily initialises on its
    // first When step. The propose scenario uses its own queue
    // (`wsProposeFrames`, initialised by the `send a propose envelope`
    // step BEFORE the wire send) so the broadcast frame is captured
    // alongside the `proposed` ack. Using a distinct step text keeps
    // the two surfaces unambiguous to cucumber's step matcher.
    const queue = ensureProposeFramesQueue(this);
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as { event?: { sequence?: unknown } } | undefined;
      return payload?.event?.sequence === sequence;
    });
    assert.ok(broadcast, `did not receive event-applied envelope for sequence ${String(sequence)}`);
  },
);

Then(
  'the second client receives an event-applied envelope for sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    // The second-client frames queue lives in the broadcast step
    // file's scratch carrier (`wsBroadcastFramesSecond`); reuse it.
    interface BroadcastScratch {
      wsBroadcastFramesSecond?: string[];
    }
    const s = this.scratch as BroadcastScratch;
    const queue = s.wsBroadcastFramesSecond;
    assert.ok(queue, 'second-client frames queue not initialised — second-client setup missing');
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as { event?: { sequence?: unknown } } | undefined;
      return payload?.event?.sequence === sequence;
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope for sequence ${String(sequence)} on second client`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the propose envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureProposeFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsProposeMessageId,
      `expected inResponseTo to match the propose envelope's id (${s.wsProposeMessageId})`,
    );
    const payload = err.payload as { code?: unknown; message?: unknown };
    assert.equal(payload.code, expectedCode);
    assert.ok(
      typeof payload.message === 'string' && payload.message.length > 0,
      'expected payload.message to be a non-empty string',
    );
  },
);

// ============================================================
// Teardown — only the per-feature carriers; the lifecycle client +
// auth app are torn down by their owning step files (idempotent
// across step files).
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsProposeMessageId;
  delete s.wsProposeFrames;
});
