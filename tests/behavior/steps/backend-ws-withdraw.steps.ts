// Step definitions for tests/behavior/backend/ws-withdraw.feature.
//
// Refinement: tasks/refinements/backend/ws_withdraw_proposal_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: backend.websocket_protocol.ws_withdraw_proposal_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `withdraw-proposal` WS handler — exercises the full subscribe →
// withdraw → authority + state checks → INSERT(s) → COMMIT →
// broadcast(s) → ack path through the real `__buildTestWsApp`
// instance against pglite.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The first WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`. This file adds only the
// withdraw-specific verbs.

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

interface WithdrawScratch {
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsWithdrawMessageId?: string;
  wsWithdrawFrames?: string[];
}

function scratch(world: AConversaWorld): WithdrawScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WithdrawScratch;
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

function ensureWithdrawFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsWithdrawFrames === undefined) {
    s.wsWithdrawFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsWithdrawFrames?.push(toUtf8(data));
    });
  }
  return s.wsWithdrawFrames;
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
// Givens — seed sessions with varying proposal states.
// ============================================================

/**
 * Seed a withdrawable classify-node session: 1 host (moderator) + a
 * pending free-floating `classify-node` proposal that minted the
 * node at propose-time (so the event log has the full ADR-0027
 * fan-out: node-created + entity-included + proposal). MAX(sequence)
 * = 5 after the seed; the withdraw lands one entity-removed event at
 * sequence 6.
 */
Given(
  'a withdrawable classify-node session for {string} exists with id {string} and node id {string} and pending proposal id {string}',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const hostId = await lookupUserId(this, hostScreenName);

    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Withdraw test (${hostScreenName})`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
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
          topic: `Withdraw test (${hostScreenName})`,
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
       VALUES ($1, $2, 3, 'node-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim to withdraw during the cucumber withdraw scenario.',
          created_by: hostId,
          created_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'entity-included', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          entity_kind: 'node',
          entity_id: nodeId,
          included_by: hostId,
          included_at: t(2),
        }),
        t(2),
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
            wording: 'A claim to withdraw during the cucumber withdraw scenario.',
          },
        }),
        t(2),
      ],
    );
  },
);

/**
 * Seed a session where the cucumber user is a DEBATER, not the
 * original proposer (a foreign moderator hosted + proposed). Used
 * for the proposer-only authority gate scenario. MAX(sequence) = 6
 * after the seed.
 */
Given(
  'a withdrawable classify-node session hosted by {string} with id {string} and node id {string} and pending proposal id {string} where {string} is a debater',
  async function (
    this: AConversaWorld,
    otherHostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
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
      [sessionId, otherHostId, `Non-proposer withdraw test`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, otherHostId],
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
        otherHostId,
        JSON.stringify({
          host_user_id: otherHostId,
          privacy: 'public',
          topic: `Non-proposer withdraw test`,
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
          joined_at: t(1),
        }),
        t(1),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'node-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        otherHostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A foreign-proposed claim.',
          created_by: otherHostId,
          created_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 5, 'entity-included', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        otherHostId,
        JSON.stringify({
          entity_kind: 'node',
          entity_id: nodeId,
          included_by: otherHostId,
          included_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'proposal', $3, $4::jsonb, $5)`,
      [
        proposalId,
        sessionId,
        otherHostId,
        JSON.stringify({
          proposal: {
            kind: 'classify-node',
            node_id: nodeId,
            classification: 'fact',
            wording: 'A foreign-proposed claim.',
          },
        }),
        t(2),
      ],
    );
  },
);

/**
 * Seed a session whose pending proposal has already committed via the
 * moderator (unanimous-agree + commit). Used for the
 * `proposal-already-committed` scenario. MAX(sequence) = 11 after
 * the seed (5 lifecycle/setup + node-created + entity-included +
 * proposal + 3 votes + commit).
 */
Given(
  'a committed-proposal session for {string} exists with id {string} and node id {string} and committed proposal id {string}',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const hostId = await lookupUserId(this, hostScreenName);
    const debaterAId = randomUUID();
    const debaterBId = randomUUID();
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterAId,
      `authelia:withdraw-cmt-a-${sessionId.slice(-12)}`,
      `withdraw-cmt-a-${sessionId.slice(-12)}`,
    ]);
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterBId,
      `authelia:withdraw-cmt-b-${sessionId.slice(-12)}`,
      `withdraw-cmt-b-${sessionId.slice(-12)}`,
    ]);

    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Committed-proposal withdraw test (${hostScreenName})`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, debaterAId],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-B')`,
      [sessionId, debaterBId],
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
          topic: `Committed-proposal withdraw test (${hostScreenName})`,
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
        debaterAId,
        JSON.stringify({
          user_id: debaterAId,
          role: 'debater-A',
          screen_name: `withdraw-cmt-a-${sessionId.slice(-12)}`,
          joined_at: t(1),
        }),
        t(1),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterBId,
        JSON.stringify({
          user_id: debaterBId,
          role: 'debater-B',
          screen_name: `withdraw-cmt-b-${sessionId.slice(-12)}`,
          joined_at: t(1),
        }),
        t(1),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 5, 'node-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim that already committed.',
          created_by: hostId,
          created_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'entity-included', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          entity_kind: 'node',
          entity_id: nodeId,
          included_by: hostId,
          included_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 7, 'proposal', $3, $4::jsonb, $5)`,
      [
        proposalId,
        sessionId,
        hostId,
        JSON.stringify({
          proposal: {
            kind: 'classify-node',
            node_id: nodeId,
            classification: 'fact',
            wording: 'A claim that already committed.',
          },
        }),
        t(2),
      ],
    );
    // Three agree votes — unanimous.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 8, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: hostId,
          choice: 'agree',
          voted_at: t(3),
        }),
        t(3),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 9, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterAId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: debaterAId,
          choice: 'agree',
          voted_at: t(4),
        }),
        t(4),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 10, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterBId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: debaterBId,
          choice: 'agree',
          voted_at: t(5),
        }),
        t(5),
      ],
    );
    // The commit event.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 11, 'commit', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          proposal_id: proposalId,
          moderator: hostId,
          committed_at: t(6),
        }),
        t(6),
      ],
    );
  },
);

// ============================================================
// Whens — send a withdraw-proposal envelope on the open client.
// ============================================================

When(
  'the client sends a withdraw-proposal envelope for session {string} with expectedSequence {int} on proposal {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    proposalEventId: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsWithdrawMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureWithdrawFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'withdraw-proposal',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          proposalEventId,
        },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a proposal-withdrawn ack referencing the withdraw envelope with removedEventCount {int}',
  async function (this: AConversaWorld, expectedRemovedCount: number) {
    const s = scratch(this);
    const queue = ensureWithdrawFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'proposal-withdrawn');
    assert.ok(ack, 'did not receive a `proposal-withdrawn` ack within timeout');
    assert.equal(ack.type, 'proposal-withdrawn');
    assert.equal(
      ack.inResponseTo,
      s.wsWithdrawMessageId,
      `expected inResponseTo to match the withdraw envelope's id (${s.wsWithdrawMessageId})`,
    );
    const payload = ack.payload as {
      sessionId?: unknown;
      proposalEventId?: unknown;
      removedEventCount?: unknown;
    };
    assert.equal(payload.removedEventCount, expectedRemovedCount);
    assert.ok(
      typeof payload.proposalEventId === 'string' && payload.proposalEventId.length > 0,
      'expected payload.proposalEventId to be a non-empty string',
    );
    assert.ok(
      typeof payload.sessionId === 'string' && payload.sessionId.length > 0,
      'expected payload.sessionId to be a non-empty string',
    );
  },
);

Then(
  'the client also receives an event-applied envelope for an entity-removed event at sequence {int} with entity_id {string}',
  async function (this: AConversaWorld, sequence: number, expectedEntityId: string) {
    // Distinct from the propose/vote/commit step files' `event-applied`
    // steps: each reads from its own queue, and the unique step text
    // keeps cucumber's matcher unambiguous. Also asserts the inner
    // event is an `entity-removed` kind with the expected entity_id.
    const queue = ensureWithdrawFramesQueue(this);
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as
        | {
            event?: {
              sequence?: unknown;
              kind?: unknown;
              payload?: { entity_id?: unknown };
            };
          }
        | undefined;
      return (
        payload?.event?.sequence === sequence &&
        payload?.event?.kind === 'entity-removed' &&
        payload?.event?.payload?.entity_id === expectedEntityId
      );
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope (kind=entity-removed, entity_id=${expectedEntityId}) for sequence ${String(sequence)}`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the withdraw envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureWithdrawFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsWithdrawMessageId,
      `expected inResponseTo to match the withdraw envelope's id (${s.wsWithdrawMessageId})`,
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
  delete s.wsWithdrawMessageId;
  delete s.wsWithdrawFrames;
});
