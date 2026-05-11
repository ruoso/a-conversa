// Step definitions for tests/behavior/backend/ws-vote.feature.
//
// Refinement: tasks/refinements/backend/ws_vote_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_vote_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `vote` WS handler — exercises the full subscribe → vote → engine
// validation → INSERT → COMMIT → broadcast → ack path through the
// real `__buildTestWsApp` instance against pglite.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The first WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`. The second WS client + the
// broadcast-frame queue scaffolding for the second connection are
// owned by `backend-ws-event-broadcast.steps.ts`. This file adds only
// the vote-specific verbs:
//
//   1. The `Given a vote-ready session for <screen_name> exists with
//      id <session_id> and node id <node_id> and pending proposal id
//      <proposal_id>` step — seeds a session + participant + node + a
//      pending `classify-node` proposal so MAX(sequence)=5 and a vote
//      on the proposal is engine-valid.
//   2. The `When the client sends a vote envelope ...` step — sends a
//      vote envelope on the open client and captures the next inbound
//      frames into a vote-specific queue.
//   3. The `When the client waits for the voted ack` step — drains the
//      `voted` ack (and the matching `event-applied`) before the next
//      send. Used by the duplicate-vote scenario to clear the wire
//      between the first agree and the second.
//   4. The `Then the client receives a voted ack ...` and
//      `Then the client receives an error envelope with code <code>
//      referencing the vote envelope` step pair — assert the ack shape
//      and the rejection wire shape.

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

interface VoteScratch {
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsVoteMessageId?: string;
  wsVoteFrames?: string[];
}

function scratch(world: AConversaWorld): VoteScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as VoteScratch;
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

function ensureVoteFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsVoteFrames === undefined) {
    s.wsVoteFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsVoteFrames?.push(toUtf8(data));
    });
  }
  return s.wsVoteFrames;
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
// Givens — seed a vote-ready session: session row, host
// participant, session-created event, participant-joined event,
// node-created event, proposal event. After the seed, MAX(sequence)=5
// and the fixture user is a participant with a pending proposal to
// vote on.
// ============================================================

Given(
  'a vote-ready session for {string} exists with id {string} and node id {string} and pending proposal id {string}',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      hostScreenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${hostScreenName}`);

    // Session row.
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Vote test (${hostScreenName})`],
    );

    // Participant row — needed for the engine's universal
    // `not-a-participant` gate to PASS for the vote.
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );

    // Seed events: session-created (1) + participant-joined (2) +
    // participant-joined (3, second debater so engine has multiple
    // participants on the projection) + node-created (4) + proposal (5).
    const t0 = '2026-05-11T10:00:00.000Z';
    const t1 = '2026-05-11T10:00:01.000Z';
    const t2 = '2026-05-11T10:00:02.000Z';
    const t3 = '2026-05-11T10:00:03.000Z';
    const t4 = '2026-05-11T10:00:04.000Z';
    const sessionCreatedId = randomUUID();
    const participantJoinedId = randomUUID();
    const secondParticipantJoinedId = randomUUID();
    const nodeCreatedId = randomUUID();
    // Stable second participant — a distinct UUID for each scenario so
    // the parallel cucumber runs (one per scenario) don't collide on the
    // unique key.
    const secondParticipantId = randomUUID();

    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      secondParticipantId,
      `authelia:vote-debater-${sessionId.slice(-12)}`,
      `vote-debater-${sessionId.slice(-12)}`,
    ]);

    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'debater-A')`,
      [sessionId, secondParticipantId],
    );

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
          topic: `Vote test (${hostScreenName})`,
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
       VALUES ($1, $2, 3, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        secondParticipantJoinedId,
        sessionId,
        secondParticipantId,
        JSON.stringify({
          user_id: secondParticipantId,
          role: 'debater-A',
          screen_name: `vote-debater-${sessionId.slice(-12)}`,
          joined_at: t2,
        }),
        t2,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'node-created', $3, $4::jsonb, $5)`,
      [
        nodeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim to vote on during the cucumber vote scenario.',
          created_by: hostId,
          created_at: t3,
        }),
        t3,
      ],
    );
    // Proposal event — id is the proposal id used by the vote action.
    // The proposal is `classify-node` on the seeded node so the engine
    // can locate a facet for vote-tracking.
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
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
        t4,
      ],
    );
  },
);

// ============================================================
// Whens — send a vote envelope on the open client.
// ============================================================

When(
  'the client sends a vote envelope for session {string} with expectedSequence {int} on proposal {string} choosing {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    proposalId: string,
    choice: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsVoteMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureVoteFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'vote',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          proposalId,
          choice,
        },
      }),
    );
  },
);

When('the client waits for the voted ack', async function (this: AConversaWorld) {
  const queue = ensureVoteFramesQueue(this);
  // Drain both the `voted` ack and the `event-applied` broadcast (the
  // voter is also a subscriber so both arrive).
  const ack = await waitForFrame(queue, (parsed) => parsed.type === 'voted');
  assert.ok(ack, 'did not receive a `voted` ack within timeout');
  const broadcast = await waitForFrame(queue, (parsed) => parsed.type === 'event-applied');
  assert.ok(broadcast, 'did not receive an `event-applied` broadcast within timeout');
});

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a voted ack referencing the vote envelope at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const s = scratch(this);
    const queue = ensureVoteFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'voted');
    assert.ok(ack, 'did not receive a `voted` ack within timeout');
    assert.equal(ack.type, 'voted');
    assert.equal(
      ack.inResponseTo,
      s.wsVoteMessageId,
      `expected inResponseTo to match the vote envelope's id (${s.wsVoteMessageId})`,
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
  'the client also receives an event-applied envelope for the vote at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    // Distinct from the existing `event-applied envelope for sequence`
    // step in `backend-ws-event-broadcast.steps.ts` and from the
    // `event-applied envelope for sequence` step in
    // `backend-ws-propose.steps.ts` — each reads from its own queue,
    // and using distinct step text keeps cucumber's matcher
    // unambiguous. We additionally assert that the inner event is a
    // `vote` kind (vs. a stray broadcast).
    const queue = ensureVoteFramesQueue(this);
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as
        | { event?: { sequence?: unknown; kind?: unknown } }
        | undefined;
      return payload?.event?.sequence === sequence && payload?.event?.kind === 'vote';
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope (kind=vote) for sequence ${String(sequence)}`,
    );
  },
);

Then(
  'the second client receives an event-applied envelope for the vote at sequence {int}',
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
      const payload = parsed.payload as
        | { event?: { sequence?: unknown; kind?: unknown } }
        | undefined;
      return payload?.event?.sequence === sequence && payload?.event?.kind === 'vote';
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope (kind=vote) for sequence ${String(sequence)} on second client`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the vote envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureVoteFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsVoteMessageId,
      `expected inResponseTo to match the vote envelope's id (${s.wsVoteMessageId})`,
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
  delete s.wsVoteMessageId;
  delete s.wsVoteFrames;
});
