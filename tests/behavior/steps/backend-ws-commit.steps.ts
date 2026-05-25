// Step definitions for tests/behavior/backend/ws-commit.feature.
//
// Refinement: tasks/refinements/backend/ws_commit_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_commit_message
//
// **What this file owns.** The cucumber-layer regression net for the
// `commit` WS handler — exercises the full subscribe → commit → engine
// validation → INSERT → COMMIT → broadcast → ack path through the
// real `__buildTestWsApp` instance against pglite.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The first WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`. This file adds only the
// commit-specific verbs:
//
//   1. The `Given a commit-ready session for <screen_name> exists ...
//      with all participants agreeing` step — seeds a session +
//      participants + node + a pending `classify-node` proposal +
//      three agree votes so MAX(sequence)=9 and a commit on the
//      proposal is engine-valid.
//   2. The `Given a commit-ready session hosted by <other> ... where
//      <user> is a debater` step — seeds a session where the cucumber
//      user is a debater (not moderator). Used for the
//      `not-a-moderator` headline-gate scenario.
//   3. The `Given a half-agree session ... where only the moderator
//      has agreed` step — seeds a session where the moderator's agree
//      vote is recorded but debater-B has not voted. Used for the
//      `unanimous-agree-required` scenario.
//   4. The `When the client sends a commit envelope ...` step — sends
//      a commit envelope on the open client and captures the next
//      inbound frames into a commit-specific queue.
//   5. The `Then the client receives a committed ack ...` and
//      `Then the client also receives an event-applied envelope for
//      the commit ...` step pair — assert the dual-signal contract.
//   6. The `Then the client receives an error envelope with code
//      <code> referencing the commit envelope` step — assert the
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

interface CommitScratch {
  // Per-feature carriers shared between Given and When steps:
  // commit-ready Given steps seed a `classify-node` proposal on a
  // specific node, so the WS commit step constructs a facet-arm wire
  // envelope addressing `(node, <nodeId>, 'classification')` per
  // ADR 0030 §2.
  wsCommitReadyNodeId?: string;
  // Carriers shared with the upstream step files.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsCommitMessageId?: string;
  wsCommitFrames?: string[];
}

function scratch(world: AConversaWorld): CommitScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as CommitScratch;
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

function ensureCommitFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsCommitFrames === undefined) {
    s.wsCommitFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsCommitFrames?.push(toUtf8(data));
    });
  }
  return s.wsCommitFrames;
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
// Givens — seed sessions with varying agreement states.
// ============================================================

/**
 * Seed a commit-ready session: 1 host (moderator) + 2 debaters + a
 * pending `classify-node` proposal + a unanimous `agree` from every
 * participant. MAX(sequence) = 9 after the seed; the next commit
 * lands at sequence 10.
 */
Given(
  'a commit-ready session for {string} exists with id {string} and node id {string} and pending proposal id {string} with all participants agreeing',
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
      `authelia:commit-a-${sessionId.slice(-12)}`,
      `commit-a-${sessionId.slice(-12)}`,
    ]);
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterBId,
      `authelia:commit-b-${sessionId.slice(-12)}`,
      `commit-b-${sessionId.slice(-12)}`,
    ]);

    // Session row + participant rows.
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Commit test (${hostScreenName})`],
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
    const sessionCreatedId = randomUUID();
    const participantJoinedModId = randomUUID();
    const participantJoinedAId = randomUUID();
    const participantJoinedBId = randomUUID();
    const nodeCreatedId = randomUUID();
    const voteModeratorId = randomUUID();
    const voteDebaterAId = randomUUID();
    const voteDebaterBId = randomUUID();

    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 1, 'session-created', $3, $4::jsonb, $5)`,
      [
        sessionCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          host_user_id: hostId,
          privacy: 'public',
          topic: `Commit test (${hostScreenName})`,
          created_at: t(0),
        }),
        t(0),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 2, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        participantJoinedModId,
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
        participantJoinedAId,
        sessionId,
        debaterAId,
        JSON.stringify({
          user_id: debaterAId,
          role: 'debater-A',
          screen_name: `commit-a-${sessionId.slice(-12)}`,
          joined_at: t(2),
        }),
        t(2),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 4, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        participantJoinedBId,
        sessionId,
        debaterBId,
        JSON.stringify({
          user_id: debaterBId,
          role: 'debater-B',
          screen_name: `commit-b-${sessionId.slice(-12)}`,
          joined_at: t(3),
        }),
        t(3),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 5, 'node-created', $3, $4::jsonb, $5)`,
      [
        nodeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim to commit during the cucumber commit scenario.',
          created_by: hostId,
          created_at: t(4),
        }),
        t(4),
      ],
    );
    // Proposal event — id is the proposal id used by the commit action.
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
    // Three `agree` votes — unanimous across all current participants.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 7, 'vote', $3, $4::jsonb, $5)`,
      [
        voteModeratorId,
        sessionId,
        hostId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: hostId,
          choice: 'agree',
          voted_at: t(6),
        }),
        t(6),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 8, 'vote', $3, $4::jsonb, $5)`,
      [
        voteDebaterAId,
        sessionId,
        debaterAId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: debaterAId,
          choice: 'agree',
          voted_at: t(7),
        }),
        t(7),
      ],
    );
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 9, 'vote', $3, $4::jsonb, $5)`,
      [
        voteDebaterBId,
        sessionId,
        debaterBId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: debaterBId,
          choice: 'agree',
          voted_at: t(8),
        }),
        t(8),
      ],
    );
    // Stash the node id so the legacy `on proposal {id}` commit step
    // can construct a facet-arm wire envelope addressing the
    // classification facet directly (the seeded proposal is
    // `classify-node`).
    scratch(this).wsCommitReadyNodeId = nodeId;
  },
);

/**
 * Seed a session where the cucumber user is a DEBATER, not the
 * moderator. Used for the `not-a-moderator` headline-gate scenario.
 *
 * MAX(sequence) = 5 after the seed (lifecycle + node + proposal).
 */
Given(
  'a commit-ready session hosted by {string} with id {string} and node id {string} and pending proposal id {string} where {string} is a debater',
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
      [sessionId, otherHostId, `Non-moderator commit test`],
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
          topic: `Non-moderator commit test`,
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
    scratch(this).wsCommitReadyNodeId = nodeId;
  },
);

/**
 * Seed a half-agree session: only the moderator has agreed; debater-B
 * has joined but not voted. Used for the `unanimous-agree-required`
 * scenario. MAX(sequence) = 6 after the seed.
 */
Given(
  'a half-agree session for {string} exists with id {string} and node id {string} and pending proposal id {string} where only the moderator has agreed',
  async function (
    this: AConversaWorld,
    hostScreenName: string,
    sessionId: string,
    nodeId: string,
    proposalId: string,
  ) {
    const hostId = await lookupUserId(this, hostScreenName);
    const debaterBId = randomUUID();
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      debaterBId,
      `authelia:half-b-${sessionId.slice(-12)}`,
      `half-b-${sessionId.slice(-12)}`,
    ]);
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Half-agree commit test`],
    );
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
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
          topic: `Half-agree commit test`,
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
        debaterBId,
        JSON.stringify({
          user_id: debaterBId,
          role: 'debater-B',
          screen_name: `half-b-${sessionId.slice(-12)}`,
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
          wording: 'A claim under a half-agreed proposal.',
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
    // Only the moderator's `agree` — debater-B has not voted.
    await this.db.query(
      `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 6, 'vote', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        sessionId,
        hostId,
        JSON.stringify({
          target: 'proposal',
          proposal_id: proposalId,
          participant: hostId,
          choice: 'agree',
          voted_at: t(5),
        }),
        t(5),
      ],
    );
    scratch(this).wsCommitReadyNodeId = nodeId;
  },
);

// ============================================================
// Whens — send a commit envelope on the open client.
// ============================================================

When(
  'the client sends a commit envelope for session {string} with expectedSequence {int} on proposal {string}',
  function (this: AConversaWorld, sessionId: string, expectedSequence: number, proposalId: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsCommitMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureCommitFramesQueue(this);

    // Wire payload is a `target`-discriminated union per ADR 0030 §2 +
    // §9. The commit-ready Given steps seed `classify-node` proposals
    // (facet-valued), so commits use the facet arm addressing
    // `(node, <nodeId>, 'classification')` directly. The step's
    // legacy `proposalId` argument identifies the proposal for the
    // human reader; the wire envelope addresses the facet.
    const nodeId = s.wsCommitReadyNodeId;
    assert.ok(
      nodeId,
      'WS commit step requires `wsCommitReadyNodeId` — run a commit-ready Given step first',
    );
    void proposalId;
    ws.send(
      JSON.stringify({
        type: 'commit',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          target: 'facet',
          entity_kind: 'node',
          entity_id: nodeId,
          facet: 'classification',
        },
      }),
    );
  },
);

/**
 * Per `pf_mod_pending_proposals_pane_facet_keyed` + ADR 0030 §2:
 * the moderator's commit button on a facet-valued pending row sends a
 * `target: 'facet'` envelope keyed by `(entity_kind, entity_id, facet)`.
 * The server resolves the facet's current candidate proposal via
 * `facet.candidateProposalEventId` (mirrors the vote-facet path) and
 * threads the resolved id into the methodology engine's `commitHandler`.
 */
When(
  'the client sends a facet-keyed commit envelope for session {string} with expectedSequence {int} on the {string} facet of node {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    facet: string,
    nodeId: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsCommitMessageId = messageId;

    ensureCommitFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'commit',
        id: messageId,
        payload: {
          sessionId,
          expectedSequence,
          target: 'facet',
          entity_kind: 'node',
          entity_id: nodeId,
          facet,
        },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a committed ack referencing the commit envelope at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const s = scratch(this);
    const queue = ensureCommitFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'committed');
    assert.ok(ack, 'did not receive a `committed` ack within timeout');
    assert.equal(ack.type, 'committed');
    assert.equal(
      ack.inResponseTo,
      s.wsCommitMessageId,
      `expected inResponseTo to match the commit envelope's id (${s.wsCommitMessageId})`,
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
  'the client also receives an event-applied envelope for the commit at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    // Distinct from the propose/vote step files' `event-applied` steps:
    // each reads from its own queue, and the unique step text keeps
    // cucumber's matcher unambiguous. Also asserts the inner event is
    // a `commit` kind.
    const queue = ensureCommitFramesQueue(this);
    const broadcast = await waitForFrame(queue, (parsed) => {
      if (parsed.type !== 'event-applied') return false;
      const payload = parsed.payload as
        | { event?: { sequence?: unknown; kind?: unknown } }
        | undefined;
      return payload?.event?.sequence === sequence && payload?.event?.kind === 'commit';
    });
    assert.ok(
      broadcast,
      `did not receive event-applied envelope (kind=commit) for sequence ${String(sequence)}`,
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the commit envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureCommitFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, `did not receive an \`error\` envelope within timeout`);
    assert.equal(
      err.inResponseTo,
      s.wsCommitMessageId,
      `expected inResponseTo to match the commit envelope's id (${s.wsCommitMessageId})`,
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
  delete s.wsCommitMessageId;
  delete s.wsCommitFrames;
  delete s.wsCommitReadyNodeId;
});
