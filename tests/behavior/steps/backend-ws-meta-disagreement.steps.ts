// Step definitions for tests/behavior/backend/ws-meta-disagreement.feature.
//
// Refinement: tasks/refinements/backend/ws_meta_disagreement_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_meta_disagreement_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `mark-meta-disagreement` WS handler — exercises the full subscribe
// → mark → engine validation → INSERT → COMMIT → broadcast → ack path
// through the real `__buildTestWsApp` instance against pglite.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`. This file adds only the
// mark-specific verbs:
//
//   1. The `Given a markable session for <screen_name> exists ...
//      with a recorded dispute` step — seeds a session +
//      participants + node + a pending `classify-node` proposal +
//      one `dispute` vote so MAX(sequence)=7 and a mark on the
//      proposal is engine-valid (rule-4 exhaustion gate satisfied).
//   2. The `Given a markable session hosted by <other> ... where
//      <user> is a debater with a recorded dispute` step — seeds a
//      session where the cucumber user is a debater (not moderator)
//      plus a dispute so rule 1 (moderator gate) fires first.
//   3. The `Given a committed-proposal session ...` step — seeds a
//      session where the proposal has been committed (rule 3 fires
//      `proposal-already-committed` before rule 4 ever runs).
//   4. The `When the client sends a mark-meta-disagreement envelope
//      ...` step — sends a mark envelope on the open client and
//      captures the next inbound frames into a mark-specific queue.
//   5. The `Then the client receives a meta-disagreement-marked ack
//      ...` and `Then the client also receives an event-applied
//      envelope for the meta-disagreement-marked event ...` step
//      pair — assert the dual-signal contract.
//   6. The `Then the client receives an error envelope with code
//      <code> referencing the mark envelope` step — assert the
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

interface MarkScratch {
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsMarkMessageId?: string;
  wsMarkFrames?: string[];
}

function scratch(world: AConversaWorld): MarkScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as MarkScratch;
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
    'no ws client — the `an authenticated WebSocket client connects to "/ws"` When step must precede',
  );
  return ws;
}

function ensureMarkFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsMarkFrames === undefined) {
    s.wsMarkFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsMarkFrames?.push(toUtf8(data));
    });
  }
  return s.wsMarkFrames;
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
 * Seed a markable session: 1 host (moderator) + 2 debaters + a
 * pending `classify-node` proposal + a `dispute` vote from debater-B
 * (satisfies the rule-4 methodology-exhaustion gate). MAX(sequence)
 * = 7 after the seed; the next mark lands at sequence 8.
 */
Given(
  'a markable session for {string} exists with id {string} and node id {string} and pending proposal id {string} with a recorded dispute',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const hostId = await lookupUserId(this, hostScreenName);

    // Two debaters. Distinct UUID per scenario so parallel cucumber
    // runs don't collide on the unique key.
    const debaterAId = randomUUID();
    const debaterBId = randomUUID();
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterAId,
      `authelia:mark-a-${sessionId.slice(-12)}`,
      `mark-a-${sessionId.slice(-12)}`,
    ]);
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterBId,
      `authelia:mark-b-${sessionId.slice(-12)}`,
      `mark-b-${sessionId.slice(-12)}`,
    ]);

    // Session row + participant rows.
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Mark test (${hostScreenName})`],
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
          topic: `Mark test (${hostScreenName})`,
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
          screen_name: `mark-a-${sessionId.slice(-12)}`,
          joined_at: t(2),
        }),
        t(2),
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
          screen_name: `mark-b-${sessionId.slice(-12)}`,
          joined_at: t(3),
        }),
        t(3),
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
          wording: 'A claim that will get marked as meta-disagreement.',
          created_by: hostId,
          created_at: t(4),
        }),
        t(4),
      ],
    );
    // Proposal event — id is the proposal id used by the mark action.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'proposal', $3, $4::jsonb, $5)`,
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
        t(5),
      ],
    );
    // One `dispute` vote — satisfies the rule-4 exhaustion gate.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 7, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterBId,
        JSON.stringify({
          proposal_id: proposalId,
          participant: debaterBId,
          vote: 'dispute',
          voted_at: t(6),
        }),
        t(6),
      ],
    );
  },
);

/**
 * Seed a session where the cucumber user is a DEBATER, not the
 * moderator, with a recorded dispute on the proposal so rule-4
 * exhaustion is satisfied — meaning the rule that fires is rule 1
 * (`not-a-moderator`), the headline-gate scenario. MAX(sequence) = 6.
 */
Given(
  'a markable session hosted by {string} with id {string} and node id {string} and pending proposal id {string} where {string} is a debater with a recorded dispute',
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
      [sessionId, otherHostId, `Non-moderator mark test`],
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
          topic: `Non-moderator mark test`,
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
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'node-created', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        otherHostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim under a session the cucumber user does not moderate.',
          created_by: otherHostId,
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
        otherHostId,
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
    // Dispute from the cucumber user — satisfies rule-4 so the only
    // failing rule is rule 1 (moderator gate). The vote also exercises
    // the moderator/debater asymmetry: the engine sees a debater-A
    // dispute on the proposal.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterId,
        JSON.stringify({
          proposal_id: proposalId,
          participant: debaterId,
          vote: 'dispute',
          voted_at: t(5),
        }),
        t(5),
      ],
    );
  },
);

/**
 * Seed a session with a proposal that has been COMMITTED — used for
 * the `proposal-already-committed` rejection scenario. The seed
 * includes two participants, the proposal, three agree votes, and a
 * commit. MAX(sequence) = 8 after the seed.
 */
Given(
  'a committed-proposal session for {string} exists with id {string} and node id {string} and pending proposal id {string}',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const hostId = await lookupUserId(this, hostScreenName);

    const debaterAId = randomUUID();
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterAId,
      `authelia:committed-a-${sessionId.slice(-12)}`,
      `committed-a-${sessionId.slice(-12)}`,
    ]);

    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Committed-proposal mark test`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, debaterAId],
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
          topic: `Committed-proposal mark test`,
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
          screen_name: `committed-a-${sessionId.slice(-12)}`,
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
          wording: 'A claim that will be committed before the mark attempt.',
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
    // Two unanimous agree votes (moderator + one debater).
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          proposal_id: proposalId,
          participant: hostId,
          vote: 'agree',
          voted_at: t(5),
        }),
        t(5),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 7, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        debaterAId,
        JSON.stringify({
          proposal_id: proposalId,
          participant: debaterAId,
          vote: 'agree',
          voted_at: t(6),
        }),
        t(6),
      ],
    );
    // Commit — proposal moves to `committedProposals`.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 8, 'commit', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          proposal_id: proposalId,
          moderator: hostId,
          committed_at: t(7),
        }),
        t(7),
      ],
    );
  },
);

// ============================================================
// Whens — send a mark envelope on the open client.
// ============================================================

When(
  'the client sends a mark-meta-disagreement envelope for session {string} with expectedSequence {int} on proposal {string}',
  function (this: AConversaWorld, sessionId: string, expectedSequence: number, proposalId: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsMarkMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureMarkFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'mark-meta-disagreement',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          proposalId,
        },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a meta-disagreement-marked ack referencing the mark envelope at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const s = scratch(this);
    const queue = ensureMarkFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'meta-disagreement-marked');
    assert.ok(ack, 'did not receive a `meta-disagreement-marked` ack within timeout');
    assert.equal(ack.type, 'meta-disagreement-marked');
    assert.equal(
      ack.inResponseTo,
      s.wsMarkMessageId,
      `expected inResponseTo to match the mark envelope's id (${s.wsMarkMessageId})`,
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
  'the client also receives an event-applied envelope for the meta-disagreement-marked event at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    // Distinct from the propose/vote/commit step files' `event-applied`
    // steps: each reads from its own queue, and the unique step text
    // keeps cucumber's matcher unambiguous. Also asserts the inner
    // event is a `meta-disagreement-marked` kind.
    const queue = ensureMarkFramesQueue(this);
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as
        | { event?: { sequence?: unknown; kind?: unknown } }
        | undefined;
      return (
        payload?.event?.sequence === sequence && payload?.event?.kind === 'meta-disagreement-marked'
      );
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope (kind=meta-disagreement-marked) for sequence ${String(sequence)}`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the mark envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureMarkFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsMarkMessageId,
      `expected inResponseTo to match the mark envelope's id (${s.wsMarkMessageId})`,
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
  delete s.wsMarkMessageId;
  delete s.wsMarkFrames;
});
