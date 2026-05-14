// @vitest-environment node
//
// Vitest unit tests for the WS `commit` handler.
//
// Refinement: tasks/refinements/backend/ws_commit_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_commit_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The methodology
// engine's per-rule logic is covered in
// `methodology/handlers/commit.test.ts`; this file is the integration
// of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire error.
//   3. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   4. **Headline gate**: a non-moderator subscribed participant
//      attempting commit → `not-a-moderator` wire error (the
//      methodology engine's rule-1 rejection, mapped to status 403 by
//      `rejectedToApiError`).
//   5. Engine rejection — unanimous-agree-required (a commit with
//      only the moderator agreeing) → `unanimous-agree-required` wire
//      error.
//   6. Engine rejection — already-committed → `proposal-already-committed`
//      wire error.
//   7. Successful commit (unanimous agree across all current
//      participants) → `committed` ack + appended `commit` event +
//      `event-applied` broadcast on the same socket.
//   8. **Security invariant**: even when the client includes a spoofed
//      `moderatorId` on the payload, the handler ignores it and uses
//      `connection.user.id` for both the methodology requester and the
//      event actor. A non-moderator who spoofs the moderator id still
//      hits `not-a-moderator`.
//
// The pool shim is the same shape as the propose/vote handler tests —
// same recogniser superset for `BEGIN`/`COMMIT`/auth-SELECT/visibility/FOR
// UPDATE/MAX(sequence)/event-log SELECT/INSERT.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
const COMMITTABLE_SESSION_ID = '00000000-0000-4000-8000-000000000f01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000f02';
const NODE_ID = '00000000-0000-4000-8000-000000000f03';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000f04';
const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-000000000fb1';
const DEBATER_A_ID = '00000000-0000-4000-8000-000000000f05';
const DEBATER_B_ID = '00000000-0000-4000-8000-000000000f06';
// The non-moderator session: FIXTURE_USER_ID is a debater (not moderator)
// in this session — used for the headline `not-a-moderator` gate test.
const NON_MODERATOR_SESSION_ID = '00000000-0000-4000-8000-000000000f07';
const NON_MODERATOR_PROPOSAL_ID = '00000000-0000-4000-8000-000000000fb2';
// The half-agree session: only moderator has voted agree, debater B has
// not voted at all — used for `unanimous-agree-required` test.
const HALF_AGREE_SESSION_ID = '00000000-0000-4000-8000-000000000f08';
const HALF_AGREE_PROPOSAL_ID = '00000000-0000-4000-8000-000000000fb3';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// COMMITTABLE_SESSION_ID is seeded with:
//   seq 1: session-created (FIXTURE_USER_ID as host)
//   seq 2: participant-joined (FIXTURE_USER_ID, moderator)
//   seq 3: participant-joined (DEBATER_A_ID, debater-A)
//   seq 4: participant-joined (DEBATER_B_ID, debater-B)
//   seq 5: node-created (NODE_ID)
//   seq 6: proposal (PROPOSAL_EVENT_ID, classify-node on NODE_ID)
//   seq 7..9: three `vote` events with `agree` from each participant
// MAX(sequence) = 9; the next commit lands at sequence 10.
//
// HIDDEN_SESSION_ID is a private session hosted by OTHER_HOST_ID — not
// visible to FIXTURE_USER_ID. Used for the not-found gate test.
//
// NON_MODERATOR_SESSION_ID is hosted by OTHER_HOST_ID (the moderator);
// FIXTURE_USER_ID is a debater-A. Used for the moderator-only
// authority test — the engine's `commitHandler` rejects with
// `not-a-moderator` because FIXTURE_USER_ID is not the moderator.
// Public so visibility passes.
//
// HALF_AGREE_SESSION_ID is hosted by FIXTURE_USER_ID with a pending
// proposal where the moderator has voted agree but debater-B has not
// voted at all — used to surface `unanimous-agree-required`.

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

function makeCommitPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      {
        id: COMMITTABLE_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
      {
        id: NON_MODERATOR_SESSION_ID,
        host_user_id: OTHER_HOST_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: HALF_AGREE_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
    ],
    events: [
      // COMMITTABLE_SESSION_ID — unanimous-agree across three
      // participants, ready to commit at seq 10.
      {
        id: '00000000-0000-4000-8000-00000000fa01',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS commit test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000fa02',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000fa03',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a',
          joined_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000000fa04',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 4,
        kind: 'participant-joined',
        actor: DEBATER_B_ID,
        payload: {
          user_id: DEBATER_B_ID,
          role: 'debater-B',
          screen_name: 'debater-b',
          joined_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-00000000fa05',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim under test.',
          created_by: FIXTURE_USER_ID,
          created_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: PROPOSAL_EVENT_ID,
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t(5),
      },
      // Three `agree` votes — moderator + both debaters.
      {
        id: '00000000-0000-4000-8000-00000000fa07',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal_id: PROPOSAL_EVENT_ID,
          participant: FIXTURE_USER_ID,
          vote: 'agree',
          voted_at: t(6).toISOString(),
        },
        created_at: t(6),
      },
      {
        id: '00000000-0000-4000-8000-00000000fa08',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 8,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          proposal_id: PROPOSAL_EVENT_ID,
          participant: DEBATER_A_ID,
          vote: 'agree',
          voted_at: t(7).toISOString(),
        },
        created_at: t(7),
      },
      {
        id: '00000000-0000-4000-8000-00000000fa09',
        session_id: COMMITTABLE_SESSION_ID,
        sequence: 9,
        kind: 'vote',
        actor: DEBATER_B_ID,
        payload: {
          proposal_id: PROPOSAL_EVENT_ID,
          participant: DEBATER_B_ID,
          vote: 'agree',
          voted_at: t(8).toISOString(),
        },
        created_at: t(8),
      },

      // NON_MODERATOR_SESSION_ID — FIXTURE_USER_ID is a debater (not
      // moderator). Hosted by OTHER_HOST_ID. Two participants suffice
      // for the engine's unanimity check NOT to be the rejecting rule
      // (we want rule 1 — moderator gate — to fire first; the engine
      // runs rule 1 before rule 4, so even with no votes the
      // not-a-moderator rejection wins).
      {
        id: '00000000-0000-4000-8000-00000000fb01',
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: OTHER_HOST_ID,
        payload: {
          host_user_id: OTHER_HOST_ID,
          privacy: 'public',
          topic: 'Non-moderator session',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000fb02',
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: OTHER_HOST_ID,
        payload: {
          user_id: OTHER_HOST_ID,
          role: 'moderator',
          screen_name: 'other-host',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000fb03',
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'debater-A',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000000fb04',
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: OTHER_HOST_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim in the non-moderator session.',
          created_by: OTHER_HOST_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: NON_MODERATOR_PROPOSAL_ID,
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 5,
        kind: 'proposal',
        actor: OTHER_HOST_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t(4),
      },

      // HALF_AGREE_SESSION_ID — FIXTURE_USER_ID is moderator + has
      // voted agree; DEBATER_B has joined but has NOT voted. The
      // commit should be rejected with `unanimous-agree-required`.
      {
        id: '00000000-0000-4000-8000-00000000fc01',
        session_id: HALF_AGREE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Half-agree session',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000fc02',
        session_id: HALF_AGREE_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000fc03',
        session_id: HALF_AGREE_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_B_ID,
        payload: {
          user_id: DEBATER_B_ID,
          role: 'debater-B',
          screen_name: 'debater-b-half',
          joined_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000000fc04',
        session_id: HALF_AGREE_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim in the half-agree session.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: HALF_AGREE_PROPOSAL_ID,
        session_id: HALF_AGREE_SESSION_ID,
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
        created_at: t(4),
      },
      // Only the moderator's agree — debater-B has not voted.
      {
        id: '00000000-0000-4000-8000-00000000fc06',
        session_id: HALF_AGREE_SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal_id: HALF_AGREE_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          vote: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
    ],
  };

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

      // FOR UPDATE on `sessions` inside the commit handler's transaction.
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
          created_at: new Date('2026-05-11T10:00:20.000Z'),
        });
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in WS commit test pool: ${text}`));
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
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111cc1';
const COMMIT_MSG_ID = '22222222-2222-4222-8222-222222222cc1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function commitFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  proposalId: string,
): string {
  return JSON.stringify({
    type: 'commit',
    id: messageId,
    payload: { sessionId, expectedSequence, proposalId },
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

describe('ws_commit_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeCommitPool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed commit with a `forbidden` wire error and does NOT append an event', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip subscribe — go straight to commit.
      ws.send(commitFrame(COMMIT_MSG_ID, COMMITTABLE_SESSION_ID, 9, PROPOSAL_EVENT_ID));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(COMMIT_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter((e) => e.session_id === COMMITTABLE_SESSION_ID).length;
      expect(eventCount).toBe(9);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a commit for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly mark this connection as subscribed to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate to isolate the
      // commit handler's own gate (mirrors the vote test's approach).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(commitFrame(COMMIT_MSG_ID, HIDDEN_SESSION_ID, 0, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(COMMIT_MSG_ID);
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

      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Seed MAX(sequence) is 9; expectedSequence=8 is stale.
      ws.send(commitFrame(COMMIT_MSG_ID, COMMITTABLE_SESSION_ID, 8, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(COMMIT_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      const eventCount = store.events.filter((e) => e.session_id === COMMITTABLE_SESSION_ID).length;
      expect(eventCount).toBe(9);
    } finally {
      ws.terminate();
    }
  });

  it('HEADLINE: rejects a non-moderator subscribed participant attempting commit with `not-a-moderator`', async () => {
    // FIXTURE_USER_ID is a debater-A (not the moderator) in
    // NON_MODERATOR_SESSION_ID. They pass the subscribe-before-act
    // gate (they're a participant), pass visibility (the session is
    // public), and the engine fires `not-a-moderator` (rule 1 of
    // `commitHandler`). This is the headline gate for this handler.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_MODERATOR_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for NON_MODERATOR_SESSION_ID is 5.
      ws.send(commitFrame(COMMIT_MSG_ID, NON_MODERATOR_SESSION_ID, 5, NON_MODERATOR_PROPOSAL_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(COMMIT_MSG_ID);
      expect(payload.code).toBe('not-a-moderator');
      expect(typeof payload.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_MODERATOR_SESSION_ID,
      ).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `unanimous-agree-required` rejection when debaters have not all voted agree', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, HALF_AGREE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence)=6 (5 lifecycle/proposal events + the moderator's
      // agree); the commit lands at seq 7. Debater-B has not voted.
      ws.send(commitFrame(COMMIT_MSG_ID, HALF_AGREE_SESSION_ID, 6, HALF_AGREE_PROPOSAL_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(COMMIT_MSG_ID);
      expect(payload.code).toBe('unanimous-agree-required');

      const eventCount = store.events.filter((e) => e.session_id === HALF_AGREE_SESSION_ID).length;
      expect(eventCount).toBe(6);
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `proposal-already-committed` rejection on a duplicate commit', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First commit — should land successfully at seq 10.
      const FIRST_COMMIT_ID = '22222222-2222-4222-8222-222222222cc2';
      ws.send(commitFrame(FIRST_COMMIT_ID, COMMITTABLE_SESSION_ID, 9, PROPOSAL_EVENT_ID));

      // Drain the `committed` ack + `event-applied` broadcast.
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        const parsed = JSON.parse(raw) as { type?: unknown };
        expect(['committed', 'event-applied']).toContain(parsed.type);
      }

      // Second commit on the same proposal — engine rejects with
      // `proposal-already-committed`. expectedSequence is now 10.
      ws.send(commitFrame(COMMIT_MSG_ID, COMMITTABLE_SESSION_ID, 10, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(COMMIT_MSG_ID);
      expect(payload.code).toBe('proposal-already-committed');
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + unanimous-agree + moderator → `committed` ack + appended event + `event-applied` broadcast on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Commit the unanimous-agreed proposal. MAX(sequence) is 9; the
      // new commit event lands at seq 10.
      ws.send(commitFrame(COMMIT_MSG_ID, COMMITTABLE_SESSION_ID, 9, PROPOSAL_EVENT_ID));

      // The moderator receives BOTH the `committed` ack AND the
      // `event-applied` broadcast (the moderator is also a
      // subscriber). Read tolerantly.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('committed');
      expect(types).toContain('event-applied');

      // `committed` ack assertions.
      const committed = frames.find((f) => f.type === 'committed') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: { sessionId?: unknown; sequence?: unknown; eventId?: unknown };
          }
        | undefined;
      expect(committed?.inResponseTo).toBe(COMMIT_MSG_ID);
      expect(committed?.id).toMatch(UUID_V4_PATTERN);
      expect(committed?.payload?.sessionId).toBe(COMMITTABLE_SESSION_ID);
      expect(committed?.payload?.sequence).toBe(10);
      expect(committed?.payload?.eventId).toMatch(UUID_V4_PATTERN);

      // `event-applied` broadcast assertions.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | {
            payload?: {
              event?: { kind?: unknown; sequence?: unknown; sessionId?: unknown };
            };
          }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('commit');
      expect(applied?.payload?.event?.sequence).toBe(10);
      expect(applied?.payload?.event?.sessionId).toBe(COMMITTABLE_SESSION_ID);

      // The event was appended to the store at sequence 10.
      const appended = store.events.find(
        (e) => e.session_id === COMMITTABLE_SESSION_ID && e.sequence === 10,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('commit');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      // The event payload references the proposal + records the moderator.
      const appendedPayload = appended?.payload as
        | {
            proposal_id?: unknown;
            moderator?: unknown;
            committed_at?: unknown;
          }
        | undefined;
      expect(appendedPayload?.proposal_id).toBe(PROPOSAL_EVENT_ID);
      expect(appendedPayload?.moderator).toBe(FIXTURE_USER_ID);
      expect(typeof appendedPayload?.committed_at).toBe('string');
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY: ignores any client-supplied `moderatorId` field on the payload — moderator identity comes from the authenticated connection', async () => {
    // FIXTURE_USER_ID is a debater-A in NON_MODERATOR_SESSION_ID (not
    // the moderator). The client sends a `commit` envelope with an
    // EXTRA `moderatorId` field naming OTHER_HOST_ID (the actual
    // moderator) in an attempt to impersonate the moderator. The wire
    // schema strips unknown fields on parse; even if it didn't, the
    // handler uses `connection.user.id` regardless. The engine sees
    // requester=FIXTURE_USER_ID and rejects with `not-a-moderator` —
    // the spoof has zero effect on authority. This is the security
    // invariant pinned in this test.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_MODERATOR_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      const spoofedFrame = JSON.stringify({
        type: 'commit',
        id: COMMIT_MSG_ID,
        payload: {
          sessionId: NON_MODERATOR_SESSION_ID,
          expectedSequence: 5,
          proposalId: NON_MODERATOR_PROPOSAL_ID,
          moderatorId: OTHER_HOST_ID, // <-- spoof attempt
        },
      });
      ws.send(spoofedFrame);

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(COMMIT_MSG_ID);
      // The engine sees FIXTURE_USER_ID as the requester (not the
      // spoofed OTHER_HOST_ID) and rejects with `not-a-moderator` —
      // the spoof has zero effect on the authority gate.
      expect(payload.code).toBe('not-a-moderator');

      // No event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_MODERATOR_SESSION_ID,
      ).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });
});
