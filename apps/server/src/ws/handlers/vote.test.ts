// @vitest-environment node
//
// Vitest unit tests for the WS `vote` handler.
//
// Refinement: tasks/refinements/backend/ws_vote_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_vote_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The methodology
// engine's per-arm rule logic is covered in
// `methodology/handlers/vote.test.ts`; this file is the integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire error.
//   3. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   4. Engine rejection — duplicate agree → `already-voted` wire error.
//   5. Engine rejection — withdraw of an un-agreed (pending) proposal
//      → `no-prior-agree` wire error.
//   6. Successful agree → `voted` ack + event appended + `event-applied`
//      broadcast fires on the same socket (the voter is also a
//      subscriber).
//   7. **Security invariant**: even when the client includes a spoofed
//      `voterId` on the payload, the handler ignores it and uses
//      `connection.user.id` for both the methodology requester and the
//      event actor.
//
// The pool shim is the same shape as the propose handler's test — same
// recogniser superset for `BEGIN`/`COMMIT`/auth-SELECT/visibility/FOR
// UPDATE/MAX(sequence)/event-log SELECT/INSERT.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
const VISIBLE_SESSION_ID = '00000000-0000-4000-8000-000000000e01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000e02';
const NODE_ID = '00000000-0000-4000-8000-000000000e03';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000e04';
const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-000000000eb1';
const ANOTHER_PARTICIPANT_ID = '00000000-0000-4000-8000-000000000e05';
const PENDING_SESSION_ID = '00000000-0000-4000-8000-000000000e07';
const PENDING_PROPOSAL_ID = '00000000-0000-4000-8000-000000000eb2';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// VISIBLE_SESSION_ID is seeded with:
//   seq 1: session-created (FIXTURE_USER_ID as host)
//   seq 2: participant-joined (FIXTURE_USER_ID, moderator)
//   seq 3: participant-joined (ANOTHER_PARTICIPANT_ID, debater-A)
//   seq 4: node-created (NODE_ID)
//   seq 5: proposal (PROPOSAL_EVENT_ID, classify-node on NODE_ID)
// MAX(sequence) = 5; the next vote will land at sequence 6.
//
// HIDDEN_SESSION_ID is a private session hosted by OTHER_HOST_ID — not
// visible to FIXTURE_USER_ID. Used for the not-found gate test.
//
// PENDING_SESSION_ID is identical to VISIBLE_SESSION_ID but without
// the proposal being voted-then-committed — used for the
// `no-prior-agree` (withdraw of a pending proposal) scenario.

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: 'public' | 'private';
  ended_at: Date | null;
}

interface EventRow {
  id: string;
  session_id: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

interface Store {
  sessions: SessionRow[];
  events: EventRow[];
}

function makeVotePool(): { pool: DbPool; store: Store } {
  const t0 = new Date('2026-05-11T10:00:00.000Z');
  const t1 = new Date('2026-05-11T10:00:01.000Z');
  const t2 = new Date('2026-05-11T10:00:02.000Z');
  const t3 = new Date('2026-05-11T10:00:03.000Z');
  const t4 = new Date('2026-05-11T10:00:04.000Z');
  const t5 = new Date('2026-05-11T10:00:05.000Z');

  const store: Store = {
    sessions: [
      {
        id: VISIBLE_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
      {
        id: PENDING_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
    ],
    events: [
      // VISIBLE_SESSION_ID: 5 prior events ending in a pending proposal.
      {
        id: '00000000-0000-4000-8000-00000000ea01',
        session_id: VISIBLE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS vote test',
          created_at: t0.toISOString(),
        },
        created_at: t0,
      },
      {
        id: '00000000-0000-4000-8000-00000000ea02',
        session_id: VISIBLE_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t1.toISOString(),
        },
        created_at: t1,
      },
      {
        id: '00000000-0000-4000-8000-00000000ea03',
        session_id: VISIBLE_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: ANOTHER_PARTICIPANT_ID,
        payload: {
          user_id: ANOTHER_PARTICIPANT_ID,
          role: 'debater-A',
          screen_name: 'bob-ws',
          joined_at: t2.toISOString(),
        },
        created_at: t2,
      },
      {
        id: '00000000-0000-4000-8000-00000000ea04',
        session_id: VISIBLE_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim under test.',
          created_by: FIXTURE_USER_ID,
          created_at: t3.toISOString(),
        },
        created_at: t3,
      },
      {
        id: PROPOSAL_EVENT_ID,
        session_id: VISIBLE_SESSION_ID,
        sequence: 5,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t4,
      },
      // PENDING_SESSION_ID: same shape ending in a pending proposal at
      // seq 5. Used for the `no-prior-agree` withdraw-of-pending case.
      {
        id: '00000000-0000-4000-8000-00000000eb01',
        session_id: PENDING_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Pending vote test',
          created_at: t0.toISOString(),
        },
        created_at: t0,
      },
      {
        id: '00000000-0000-4000-8000-00000000eb02',
        session_id: PENDING_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t1.toISOString(),
        },
        created_at: t1,
      },
      {
        id: '00000000-0000-4000-8000-00000000eb03',
        session_id: PENDING_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim under test.',
          created_by: FIXTURE_USER_ID,
          created_at: t2.toISOString(),
        },
        created_at: t2,
      },
      {
        id: PENDING_PROPOSAL_ID,
        session_id: PENDING_SESSION_ID,
        sequence: 4,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t3,
      },
    ],
  };

  // Compute t5 to silence unused-var warning when t5 unused above.
  void t5;

  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      const trimmed = text.trim();

      if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
        return Promise.resolve({ rows: [] as TRow[] });
      }

      // Auth middleware SELECT.
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        if (id === FIXTURE_USER_ID) {
          return Promise.resolve({
            rows: [{ id: FIXTURE_USER_ID, screen_name: FIXTURE_SCREEN_NAME }] as unknown as TRow[],
          });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      // `canSeeSession` — visibility-gated SELECT 1.
      if (
        trimmed.startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'") &&
        text.includes('host_user_id = $2') &&
        text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        if (isPublic || isHost) {
          return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      // FOR UPDATE on `sessions` inside the vote handler's transaction.
      if (
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes('FOR UPDATE') &&
        !text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        return Promise.resolve({
          rows: [{ id: session.id, ended_at: session.ended_at }] as unknown as TRow[],
        });
      }

      // MAX(sequence) for the optimistic-concurrency check.
      if (
        text.includes('FROM session_events') &&
        text.includes('MAX(sequence)') &&
        text.includes('WHERE session_id = $1')
      ) {
        const sessionId = p[0] as string;
        const seqs = store.events.filter((e) => e.session_id === sessionId).map((e) => e.sequence);
        const maxSeq = seqs.length === 0 ? 0 : Math.max(...seqs);
        return Promise.resolve({ rows: [{ max_seq: maxSeq }] as unknown as TRow[] });
      }

      // Event-log SELECT for projection-load.
      if (
        text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1') &&
        text.includes('ORDER BY sequence ASC')
      ) {
        const sessionId = p[0] as string;
        const rows = store.events
          .filter((e) => e.session_id === sessionId)
          .sort((a, b) => a.sequence - b.sequence);
        return Promise.resolve({ rows: rows as unknown as TRow[] });
      }

      // INSERT INTO session_events via `appendSessionEvent`.
      if (text.includes('INSERT INTO session_events')) {
        const [id, sessionId, sequence, kind, actor, payloadJson] = p as [
          string,
          string,
          number,
          string,
          string | null,
          string,
        ];
        store.events.push({
          id,
          session_id: sessionId,
          sequence,
          kind,
          actor,
          payload: JSON.parse(payloadJson) as Record<string, unknown>,
          created_at: new Date('2026-05-11T10:00:10.000Z'),
        });
        return Promise.resolve({ rows: [] as TRow[] });
      }

      return Promise.reject(new Error(`unexpected SQL in WS vote test pool: ${text}`));
    },
  };

  return { pool, store };
}

// ---- WS client plumbing --------------------------------------------

type WsLike = {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
};

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

interface OpenedWs {
  ws: WsLike;
  next: () => Promise<string>;
}

async function openWsClient(app: FastifyInstance, cookie: string): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;

  const ws = await app.injectWS(
    '/ws',
    { headers: { cookie } },
    {
      onInit(client: unknown) {
        const wsClient = client as WsLike;
        wsClient.on('message', (data: unknown) => {
          const text = toUtf8(data);
          if (waiter) {
            const w = waiter;
            waiter = null;
            w(text);
          } else {
            queue.push(text);
          }
        });
      },
    },
  );

  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiter = resolve;
    });

  return { ws, next };
}

async function buildHandlerApp(pool: DbPool): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool,
    sessionTokenSecret: TEST_SESSION_SECRET,
  });
}

async function fixtureCookieHeader(): Promise<string> {
  const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

// Sample v4 UUIDs for the test envelopes' `id` field.
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111bb1';
const VOTE_MSG_ID = '22222222-2222-4222-8222-222222222bb1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function voteFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  proposalId: string,
  choice: 'agree' | 'dispute' | 'withdraw',
): string {
  return JSON.stringify({
    type: 'vote',
    id: messageId,
    payload: { sessionId, expectedSequence, proposalId, choice },
  });
}

async function readUntilType(
  next: () => Promise<string>,
  type: string,
  maxFrames = 5,
): Promise<{ raw: string; parsed: Record<string, unknown> }> {
  for (let i = 0; i < maxFrames; i++) {
    const raw = await next();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === type) {
      return { raw, parsed };
    }
  }
  throw new Error(`did not receive frame of type '${type}' within ${String(maxFrames)} reads`);
}

describe('ws_vote_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeVotePool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed vote with a `forbidden` wire error and does NOT append an event', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip subscribe — go straight to vote.
      ws.send(voteFrame(VOTE_MSG_ID, VISIBLE_SESSION_ID, 5, PROPOSAL_EVENT_ID, 'agree'));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(VOTE_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter((e) => e.session_id === VISIBLE_SESSION_ID).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a vote for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly mark this connection as subscribed to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate to isolate the
      // vote handler's own gate (mirrors the propose test's approach).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(voteFrame(VOTE_MSG_ID, HIDDEN_SESSION_ID, 0, PROPOSAL_EVENT_ID, 'agree'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(VOTE_MSG_ID);
      expect(payload.code).toBe('not-found');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a stale `expectedSequence` with a `sequence-mismatch` wire error', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Seed MAX(sequence) is 5; expectedSequence=4 is stale.
      ws.send(voteFrame(VOTE_MSG_ID, VISIBLE_SESSION_ID, 4, PROPOSAL_EVENT_ID, 'agree'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(VOTE_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      const eventCount = store.events.filter((e) => e.session_id === VISIBLE_SESSION_ID).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `already-voted` rejection on a duplicate agree', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First agree — should land successfully at seq 6.
      const FIRST_VOTE_ID = '22222222-2222-4222-8222-222222222bb2';
      ws.send(voteFrame(FIRST_VOTE_ID, VISIBLE_SESSION_ID, 5, PROPOSAL_EVENT_ID, 'agree'));

      // The first agree produces an `event-applied` broadcast and a
      // `voted` ack. Drain both before sending the duplicate.
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        const parsed = JSON.parse(raw) as { type?: unknown };
        expect(['voted', 'event-applied']).toContain(parsed.type);
      }

      // Second agree from the same voter on the same proposal — engine
      // rejects with `already-voted`. expectedSequence is now 6 (after
      // the first agree landed).
      ws.send(voteFrame(VOTE_MSG_ID, VISIBLE_SESSION_ID, 6, PROPOSAL_EVENT_ID, 'agree'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(VOTE_MSG_ID);
      expect(payload.code).toBe('already-voted');
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `no-prior-agree` rejection on a withdraw of a still-pending proposal', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // The PENDING_SESSION_ID has a pending proposal (no commit). Even
      // with a prior agree, withdraw is illegal until commit lands —
      // per `voteHandler`'s rule 3 (pending + withdraw → no-prior-agree).
      ws.send(subscribeFrame(SUB_MSG_ID, PENDING_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(voteFrame(VOTE_MSG_ID, PENDING_SESSION_ID, 4, PENDING_PROPOSAL_ID, 'withdraw'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(VOTE_MSG_ID);
      expect(payload.code).toBe('no-prior-agree');
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + valid agree → `voted` ack + appended event + `event-applied` broadcast on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Agree on the pending proposal. MAX(sequence) is 5; the new vote
      // lands at seq 6.
      ws.send(voteFrame(VOTE_MSG_ID, VISIBLE_SESSION_ID, 5, PROPOSAL_EVENT_ID, 'agree'));

      // The voter receives BOTH the `voted` ack AND the `event-applied`
      // broadcast (the voter is a subscriber). Read tolerantly.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('voted');
      expect(types).toContain('event-applied');

      // `voted` ack assertions.
      const voted = frames.find((f) => f.type === 'voted') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: { sessionId?: unknown; sequence?: unknown; eventId?: unknown };
          }
        | undefined;
      expect(voted?.inResponseTo).toBe(VOTE_MSG_ID);
      expect(voted?.id).toMatch(UUID_V4_PATTERN);
      expect(voted?.payload?.sessionId).toBe(VISIBLE_SESSION_ID);
      expect(voted?.payload?.sequence).toBe(6);
      expect(voted?.payload?.eventId).toMatch(UUID_V4_PATTERN);

      // `event-applied` broadcast assertions.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | {
            payload?: {
              event?: { kind?: unknown; sequence?: unknown; sessionId?: unknown };
            };
          }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('vote');
      expect(applied?.payload?.event?.sequence).toBe(6);
      expect(applied?.payload?.event?.sessionId).toBe(VISIBLE_SESSION_ID);

      // The event was appended to the store at sequence 6.
      const appended = store.events.find(
        (e) => e.session_id === VISIBLE_SESSION_ID && e.sequence === 6,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('vote');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      // The event payload references the proposal + records the voter.
      const appendedPayload = appended?.payload as
        | {
            proposal_id?: unknown;
            participant?: unknown;
            vote?: unknown;
          }
        | undefined;
      expect(appendedPayload?.proposal_id).toBe(PROPOSAL_EVENT_ID);
      expect(appendedPayload?.participant).toBe(FIXTURE_USER_ID);
      expect(appendedPayload?.vote).toBe('agree');
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY: ignores any client-supplied `voterId` field on the payload — voter identity comes from the authenticated connection', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // The client sends an envelope with an EXTRA `voterId` field
      // naming ANOTHER_PARTICIPANT_ID. The wire schema
      // (`wsVotePayloadSchema`) is a closed `z.object` that strips
      // unknown fields on parse; even if it didn't, the handler ignores
      // the payload's voter and uses `connection.user.id`. Either way
      // the appended event's `actor` and `payload.participant` are
      // FIXTURE_USER_ID (the connection's authenticated user).
      const spoofedFrame = JSON.stringify({
        type: 'vote',
        id: VOTE_MSG_ID,
        payload: {
          sessionId: VISIBLE_SESSION_ID,
          expectedSequence: 5,
          proposalId: PROPOSAL_EVENT_ID,
          choice: 'agree',
          voterId: ANOTHER_PARTICIPANT_ID, // <-- spoof attempt
        },
      });
      ws.send(spoofedFrame);

      // Drain `voted` ack + `event-applied` broadcast.
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        const parsed = JSON.parse(raw) as { type?: unknown };
        expect(['voted', 'event-applied']).toContain(parsed.type);
      }

      // The appended event's actor + participant are FIXTURE_USER_ID,
      // NOT ANOTHER_PARTICIPANT_ID. This is the security invariant.
      const appended = store.events.find(
        (e) => e.session_id === VISIBLE_SESSION_ID && e.sequence === 6,
      );
      expect(appended).toBeDefined();
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      const appendedPayload = appended?.payload as { participant?: unknown } | undefined;
      expect(appendedPayload?.participant).toBe(FIXTURE_USER_ID);
      expect(appendedPayload?.participant).not.toBe(ANOTHER_PARTICIPANT_ID);
    } finally {
      ws.terminate();
    }
  });
});
