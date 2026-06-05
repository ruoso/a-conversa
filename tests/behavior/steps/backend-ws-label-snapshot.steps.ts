// Step definitions for tests/behavior/backend/ws-label-snapshot.feature.
//
// Refinement: tasks/refinements/backend/ws_label_snapshot_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_label_snapshot_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `label-snapshot` WS handler — exercises the full subscribe →
// label-snapshot → moderator-only check → engine helper call →
// INSERT → COMMIT → broadcast → ack path through the real
// `__buildTestWsApp` instance against pglite.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`. This file adds only the
// label-snapshot-specific verbs:
//
//   1. The `Given a snapshottable session for <screen_name> exists ...`
//      step — seeds a session row + a single `participant-joined`
//      event with role `moderator`. MAX(sequence) = 2; the next
//      label-snapshot lands at sequence 3.
//   2. The `Given a snapshottable session hosted by <other> ... where
//      <user> is a debater` step — seeds a session where the cucumber
//      user is a debater (not the moderator). The WS-layer
//      moderator-only gate fires.
//   3. The `When the client sends a label-snapshot envelope ...` step
//      — sends a label-snapshot envelope on the open client and
//      captures the next inbound frames into a label-snapshot-specific
//      queue.
//   4. The `Then the client receives a snapshot-labeled ack ...` and
//      `Then the client also receives an event-applied envelope for
//      the snapshot-created event ...` step pair — assert the
//      dual-signal contract.
//   5. The `Then the client receives an error envelope with code
//      <code> referencing the label-snapshot envelope` step — assert
//      the rejection wire shape.

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

interface LabelSnapshotScratch {
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsLabelSnapshotMessageId?: string;
  wsLabelSnapshotFrames?: string[];
  // The `snapshotId` from the most recent `snapshot-labeled` ack —
  // captured so a cross-boundary round-trip scenario (the
  // create→list contract in `list-session-snapshots.feature`) can
  // assert the REST list returns the same id the write-path minted.
  wsLabelSnapshotId?: string;
}

function scratch(world: AConversaWorld): LabelSnapshotScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as LabelSnapshotScratch;
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

function ensureLabelSnapshotFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsLabelSnapshotFrames === undefined) {
    s.wsLabelSnapshotFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsLabelSnapshotFrames?.push(toUtf8(data));
    });
  }
  return s.wsLabelSnapshotFrames;
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
// Givens — seed sessions with moderator-or-debater roles.
// ============================================================

/**
 * Seed a snapshottable session: 1 host (moderator). MAX(sequence) = 2
 * after the seed; the next label-snapshot lands at sequence 3.
 */
Given(
  'a snapshottable session for {string} exists with id {string}',
  async function (this: AConversaWorld, hostScreenName: string, sessionId: string) {
    const hostId = await lookupUserId(this, hostScreenName);

    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Label-snapshot test (${hostScreenName})`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );

    const t = (n: number) => `2026-05-31T10:00:${String(n).padStart(2, '0')}.000Z`;
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
          topic: `Label-snapshot test (${hostScreenName})`,
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
  },
);

/**
 * Seed a session where the cucumber user is a DEBATER, not the
 * moderator. MAX(sequence) = 3 after seed (session-created +
 * moderator participant-joined + debater participant-joined).
 */
Given(
  'a snapshottable session hosted by {string} with id {string} where {string} is a debater',
  async function (
    this: AConversaWorld,
    otherHostScreenName: string,
    sessionId: string,
    debaterScreenName: string,
  ) {
    // Create the foreign moderator user.
    const otherHostId = randomUUID();
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      otherHostId,
      `authelia:${otherHostScreenName}-${sessionId.slice(-12)}`,
      otherHostScreenName,
    ]);
    const debaterId = await lookupUserId(this, debaterScreenName);

    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, otherHostId, `Non-moderator label-snapshot test`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, otherHostId],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, debaterId],
    );

    const t = (n: number) => `2026-05-31T10:00:${String(n).padStart(2, '0')}.000Z`;
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 1, 'session-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        otherHostId,
        JSON.stringify({
          host_user_id: otherHostId,
          privacy: 'public',
          topic: `Non-moderator label-snapshot test`,
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
        otherHostId,
        JSON.stringify({
          user_id: otherHostId,
          role: 'moderator',
          screen_name: otherHostScreenName,
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
          screen_name: debaterScreenName,
          joined_at: t(2),
        }),
        t(2),
      ],
    );
  },
);

// ============================================================
// Whens — send a label-snapshot envelope on the open client.
// ============================================================

When(
  'the client sends a label-snapshot envelope for session {string} with expectedSequence {int} and label {string}',
  function (this: AConversaWorld, sessionId: string, expectedSequence: number, label: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsLabelSnapshotMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureLabelSnapshotFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'label-snapshot',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          label,
        },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a snapshot-labeled ack referencing the label-snapshot envelope',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const queue = ensureLabelSnapshotFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'snapshot-labeled');
    assert.ok(ack, 'did not receive a `snapshot-labeled` ack within timeout');
    assert.equal(ack.type, 'snapshot-labeled');
    assert.equal(
      ack.inResponseTo,
      s.wsLabelSnapshotMessageId,
      `expected inResponseTo to match the label-snapshot envelope's id (${s.wsLabelSnapshotMessageId})`,
    );
    const payload = ack.payload as { snapshotId?: unknown };
    assert.ok(
      typeof payload.snapshotId === 'string' && payload.snapshotId.length > 0,
      'expected payload.snapshotId to be a non-empty string',
    );
    // Stash the minted id so a downstream REST read-back can pin
    // producer→consumer record identity (see list-session-snapshots).
    s.wsLabelSnapshotId = payload.snapshotId;
  },
);

Then(
  'the client also receives an event-applied envelope for the snapshot-created event at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const queue = ensureLabelSnapshotFramesQueue(this);
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as
        | { event?: { sequence?: unknown; kind?: unknown } }
        | undefined;
      return payload?.event?.sequence === sequence && payload?.event?.kind === 'snapshot-created';
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope (kind=snapshot-created) for sequence ${String(sequence)}`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the label-snapshot envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureLabelSnapshotFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsLabelSnapshotMessageId,
      `expected inResponseTo to match the label-snapshot envelope's id (${s.wsLabelSnapshotMessageId})`,
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
  delete s.wsLabelSnapshotMessageId;
  delete s.wsLabelSnapshotFrames;
  delete s.wsLabelSnapshotId;
});
