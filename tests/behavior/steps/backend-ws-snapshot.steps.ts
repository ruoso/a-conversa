// Step definitions for tests/behavior/backend/ws-snapshot.feature.
//
// Refinement: tasks/refinements/backend/ws_snapshot_message.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_snapshot_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `snapshot` WS handler — exercises the full subscribe → snapshot →
// projection-replay → response path through the real
// `__buildTestWsApp` instance against pglite. The handler is
// **read-only** (no event append, no broadcast, no transaction) and
// implements Interpretation A of the WBS task; see the refinement
// Decisions for the choice rationale.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`. The `propose-ready` session +
// the propose envelope are owned by `backend-ws-propose.steps.ts`
// (used by the third regression-pin scenario). This file adds only
// the snapshot-specific verbs:
//
//   1. The `Given a snapshot-ready session for <screen_name> exists
//      ... with id <session_id> and node id <node_id> and pending
//      proposal id <proposal_id>` step — seeds a session +
//      participants + node + a pending `classify-node` proposal so
//      the snapshot has something to render. MAX(sequence) = 5
//      after the seed.
//   2. The `When the client sends a snapshot envelope for session
//      <session_id>` step — sends a snapshot envelope on the open
//      client and captures inbound frames into a snapshot-specific
//      queue.
//   3. The `Then the client receives a snapshot-state response
//      referencing the snapshot envelope at sequence <n>` step —
//      asserts the response envelope shape + the `inResponseTo`
//      correlation + the `payload.sequence`.
//   4. The `Then the snapshot-state projection contains the seeded
//      node <id> and pending proposal <id>` step — asserts the
//      projection payload references the seeded fixtures.
//   5. The `Then the snapshot-state projection contains one pending
//      proposal` step — used in the regression-pin scenario to
//      confirm that a snapshot taken AFTER a propose reflects the
//      newly-appended event (catch-up contract).
//   6. The `Then the client receives an error envelope with code
//      <code> referencing the snapshot envelope` step — asserts
//      rejection paths surface as canonical `error` envelopes.

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

interface SnapshotScratch {
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsSnapshotMessageId?: string;
  wsSnapshotFrames?: string[];
}

function scratch(world: AConversaWorld): SnapshotScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SnapshotScratch;
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

function ensureSnapshotFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsSnapshotFrames === undefined) {
    s.wsSnapshotFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsSnapshotFrames?.push(toUtf8(data));
    });
  }
  return s.wsSnapshotFrames;
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

async function lookupUserId(world: AConversaWorld, screenName: string): Promise<string> {
  const res = (await world.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
    screenName,
  ])) as QueryResult<{ id: string }>;
  const userId = res.rows[0]?.id;
  assert.ok(userId, `no users row for screen_name ${screenName}`);
  return userId;
}

// ============================================================
// Givens — seed a snapshot-ready session with a pending proposal.
// ============================================================

/**
 * Seed a snapshot-ready session: host (moderator) + 1 debater + a
 * node + a pending `classify-node` proposal. After the seed,
 * MAX(sequence) = 5 and the snapshot covers participants + nodes +
 * pending proposals.
 */
Given(
  'a snapshot-ready session for {string} exists with id {string} and node id {string} and pending proposal id {string}',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const hostId = await lookupUserId(this, hostScreenName);

    const debaterId = randomUUID();
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterId,
      `authelia:snap-${sessionId.slice(-12)}`,
      `snap-debater-${sessionId.slice(-12)}`,
    ]);

    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Snapshot test (${hostScreenName})`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, debaterId],
    );

    const t = (n: number) => `2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`;
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 1, 'session-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          host_user_id: hostId,
          privacy: 'public',
          topic: `Snapshot test (${hostScreenName})`,
          created_at: t(0),
        }),
        t(0),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 2, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          user_id: hostId,
          role: 'moderator',
          screen_name: hostScreenName,
          joined_at: t(1),
        }),
        t(1),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 3, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterId,
        JSON.stringify({
          user_id: debaterId,
          role: 'debater-A',
          screen_name: `snap-debater-${sessionId.slice(-12)}`,
          joined_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'node-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim the snapshot will surface.',
          created_by: hostId,
          created_at: t(3),
        }),
        t(3),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 5, 'proposal', $3, $4::jsonb, $5)`,
      [
        proposalId,
        sessionId,
        hostId,
        JSON.stringify({
          proposal: {
            kind: 'classify-node',
            node_id: nodeId,
            classification: 'fact',
          },
        }),
        t(4),
      ],
    );
  },
);

// ============================================================
// Whens — send a snapshot envelope on the open client.
// ============================================================

When(
  'the client sends a snapshot envelope for session {string}',
  function (this: AConversaWorld, sessionId: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsSnapshotMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureSnapshotFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'snapshot',
        id: messageId,
        payload: { sessionId },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a snapshot-state response referencing the snapshot envelope at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const s = scratch(this);
    const queue = ensureSnapshotFramesQueue(this);
    const response = await waitForFrame(queue, (parsed) => parsed.type === 'snapshot-state');
    assert.ok(response, 'did not receive a `snapshot-state` response within timeout');
    assert.equal(response.type, 'snapshot-state');
    assert.equal(
      response.inResponseTo,
      s.wsSnapshotMessageId,
      `expected inResponseTo to match the snapshot envelope's id (${s.wsSnapshotMessageId})`,
    );
    const payload = response.payload as {
      sessionId?: unknown;
      sequence?: unknown;
      projection?: unknown;
    };
    assert.equal(payload.sequence, sequence);
    assert.ok(
      typeof payload.sessionId === 'string' && payload.sessionId.length > 0,
      'expected payload.sessionId to be a non-empty string',
    );
    assert.ok(
      payload.projection !== null && typeof payload.projection === 'object',
      'expected payload.projection to be an object',
    );
    // Stash the most-recent snapshot-state payload on the world so a
    // subsequent Then-step can introspect the projection.
    (s as unknown as { wsLastSnapshotPayload?: unknown }).wsLastSnapshotPayload = payload;
  },
);

Then(
  'the snapshot-state projection contains the seeded node {string} and pending proposal {string}',
  function (this: AConversaWorld, nodeId: string, proposalId: string) {
    const s = scratch(this);
    const payload = (s as unknown as { wsLastSnapshotPayload?: unknown }).wsLastSnapshotPayload as
      | { projection?: Record<string, unknown> }
      | undefined;
    assert.ok(payload, 'no snapshot-state payload captured by an earlier Then step');
    const projection = payload.projection;
    assert.ok(projection, 'snapshot-state payload missing .projection');

    const nodes = projection.nodes as Array<{ id?: unknown }>;
    const node = nodes.find((n) => n.id === nodeId);
    assert.ok(
      node,
      `expected projection to contain node ${nodeId}; got ids ${JSON.stringify(nodes.map((n) => n.id))}`,
    );

    const pending = projection.pendingProposals as Array<{ proposalEventId?: unknown }>;
    const proposal = pending.find((p) => p.proposalEventId === proposalId);
    assert.ok(
      proposal,
      `expected projection to contain pending proposal ${proposalId}; got ids ${JSON.stringify(pending.map((p) => p.proposalEventId))}`,
    );
  },
);

Then(
  'the snapshot-state projection contains one pending proposal',
  function (this: AConversaWorld) {
    const s = scratch(this);
    const payload = (s as unknown as { wsLastSnapshotPayload?: unknown }).wsLastSnapshotPayload as
      | { projection?: Record<string, unknown> }
      | undefined;
    assert.ok(payload, 'no snapshot-state payload captured by an earlier Then step');
    const projection = payload.projection;
    assert.ok(projection, 'snapshot-state payload missing .projection');
    const pending = projection.pendingProposals as Array<unknown>;
    assert.equal(
      pending.length,
      1,
      `expected exactly one pending proposal in the projection; got ${String(pending.length)}`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the snapshot envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureSnapshotFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsSnapshotMessageId,
      `expected inResponseTo to match the snapshot envelope's id (${s.wsSnapshotMessageId})`,
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
// auth app are torn down by their owning step files.
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsSnapshotMessageId;
  delete s.wsSnapshotFrames;
  delete (s as unknown as { wsLastSnapshotPayload?: unknown }).wsLastSnapshotPayload;
});
