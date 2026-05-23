// @vitest-environment node
//
// Vitest unit tests for the WS `mark-meta-disagreement` handler.
//
// Refinement: tasks/refinements/backend/ws_meta_disagreement_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_meta_disagreement_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The methodology
// engine's per-rule logic is covered in
// `methodology/handlers/markMetaDisagreement.test.ts`; this file is
// the integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire error.
//   3. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   4. **Headline gate**: a non-moderator subscribed participant
//      attempting mark → `not-a-moderator` wire error (the
//      methodology engine's rule-1 rejection, mapped to status 403 by
//      `rejectedToApiError`).
//   5. Engine rejection — proposal-already-committed (idempotency
//      adjacent: a mark on an already-committed proposal) → 422
//      `proposal-already-committed` wire error.
//   6. Engine rejection — proposal-already-meta-disagreement
//      (idempotency: a second mark on the same proposal) → 422
//      `proposal-already-meta-disagreement` wire error.
//   7. Successful mark (moderator on a proposal with a recorded
//      dispute) → `meta-disagreement-marked` ack + appended event +
//      `event-applied` broadcast on the same socket.
//   8. **Security invariant**: even when the client includes a spoofed
//      `moderatorId` on the payload, the handler ignores it and uses
//      `connection.user.id` for both the methodology requester and the
//      event actor. A non-moderator who spoofs the moderator id still
//      hits `not-a-moderator`.
//
// The pool shim is the same shape as the propose/vote/commit handler
// tests — same recogniser superset for `BEGIN`/`COMMIT`/auth-SELECT/
// visibility/FOR UPDATE/MAX(sequence)/event-log SELECT/INSERT.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
const MARKABLE_SESSION_ID = '00000000-0000-4000-8000-000000000d01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000d02';
const NODE_ID = '00000000-0000-4000-8000-000000000d03';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000d04';
const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-000000000db1';
const DEBATER_A_ID = '00000000-0000-4000-8000-000000000d05';
const DEBATER_B_ID = '00000000-0000-4000-8000-000000000d06';
// The non-moderator session: FIXTURE_USER_ID is a debater (not moderator)
// in this session — used for the headline `not-a-moderator` gate test.
// The proposal here also has a recorded dispute so rule 1 fires first
// (moderator gate) rather than rule 4 (methodology-exhaustion).
const NON_MODERATOR_SESSION_ID = '00000000-0000-4000-8000-000000000d07';
const NON_MODERATOR_PROPOSAL_ID = '00000000-0000-4000-8000-000000000db2';
// The already-committed session — used for the
// `proposal-already-committed` test (mark on a closed proposal).
const COMMITTED_SESSION_ID = '00000000-0000-4000-8000-000000000d08';
const COMMITTED_PROPOSAL_ID = '00000000-0000-4000-8000-000000000db3';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// MARKABLE_SESSION_ID is seeded with:
//   seq 1: session-created (FIXTURE_USER_ID as host)
//   seq 2: participant-joined (FIXTURE_USER_ID, moderator)
//   seq 3: participant-joined (DEBATER_A_ID, debater-A)
//   seq 4: participant-joined (DEBATER_B_ID, debater-B)
//   seq 5: node-created (NODE_ID)
//   seq 6: proposal (PROPOSAL_EVENT_ID, classify-node on NODE_ID)
//   seq 7: vote (DEBATER_B_ID disputes — satisfies rule-4 exhaustion gate)
// MAX(sequence) = 7; the next mark lands at sequence 8.
//
// HIDDEN_SESSION_ID is a private session hosted by OTHER_HOST_ID — not
// visible to FIXTURE_USER_ID. Used for the not-found gate test.
//
// NON_MODERATOR_SESSION_ID is hosted by OTHER_HOST_ID (the moderator);
// FIXTURE_USER_ID is a debater-A. Public so visibility passes. Has a
// recorded dispute too so the engine's rule-1 (moderator gate) fires
// first — without the dispute, rule-4 (methodology-not-exhausted)
// would fire first and the test wouldn't actually exercise the
// `not-a-moderator` headline gate. MAX(sequence) = 6.
//
// COMMITTED_SESSION_ID is hosted by FIXTURE_USER_ID with a proposal
// that has been disputed AND committed (yes — both states can exist
// historically: the engine accepts an `agree` from each participant
// after a recorded `dispute` is withdrawn, but we set this scenario
// up with the committed-state directly so rule 3 fires). Actually,
// the simpler setup: the proposal is in `committedProposals` (a
// `commit` event followed the proposal). The engine's rule 3 fires
// `proposal-already-committed` before rule 4 can run. MAX(sequence)
// = 8 (lifecycle + proposal + dispute + commit).

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

function makeMarkPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      {
        id: MARKABLE_SESSION_ID,
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
        id: COMMITTED_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
    ],
    events: [
      // MARKABLE_SESSION_ID — three participants, pending proposal,
      // one recorded dispute → rule-4 exhaustion gate satisfied. The
      // moderator can mark.
      {
        id: '00000000-0000-4000-8000-00000000da01',
        session_id: MARKABLE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS mark-meta-disagreement test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000da02',
        session_id: MARKABLE_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000000da03',
        session_id: MARKABLE_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000000da04',
        session_id: MARKABLE_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000000da05',
        session_id: MARKABLE_SESSION_ID,
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
        session_id: MARKABLE_SESSION_ID,
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
      // One recorded dispute — satisfies rule-4 exhaustion gate.
      {
        id: '00000000-0000-4000-8000-00000000da07',
        session_id: MARKABLE_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: DEBATER_B_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_EVENT_ID,
          participant: DEBATER_B_ID,
          choice: 'dispute',
          voted_at: t(6).toISOString(),
        },
        created_at: t(6),
      },

      // NON_MODERATOR_SESSION_ID — FIXTURE_USER_ID is a debater (not
      // moderator). Hosted by OTHER_HOST_ID. Has a dispute recorded so
      // rule 4 (methodology-exhaustion) wouldn't be the failing rule;
      // rule 1 (moderator gate) fires first and the test actually
      // exercises the headline `not-a-moderator` gate.
      {
        id: '00000000-0000-4000-8000-00000000db01',
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
        id: '00000000-0000-4000-8000-00000000db02',
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
        id: '00000000-0000-4000-8000-00000000db03',
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
        id: '00000000-0000-4000-8000-00000000db04',
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
      // Dispute so rule 4 isn't what fires.
      {
        id: '00000000-0000-4000-8000-00000000db06',
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: NON_MODERATOR_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          choice: 'dispute',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },

      // COMMITTED_SESSION_ID — proposal is committed. A mark attempt
      // hits rule 3 (`proposal-already-committed`) before rule 4 ever
      // runs. Three agree votes + one commit → MAX(sequence) = 9.
      {
        id: '00000000-0000-4000-8000-00000000dc01',
        session_id: COMMITTED_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Committed-proposal session',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000dc02',
        session_id: COMMITTED_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000000dc03',
        session_id: COMMITTED_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a-c',
          joined_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000000dc04',
        session_id: COMMITTED_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim that will be committed.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: COMMITTED_PROPOSAL_ID,
        session_id: COMMITTED_SESSION_ID,
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
      {
        id: '00000000-0000-4000-8000-00000000dc06',
        session_id: COMMITTED_SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          choice: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
      {
        id: '00000000-0000-4000-8000-00000000dc07',
        session_id: COMMITTED_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_ID,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: t(6).toISOString(),
        },
        created_at: t(6),
      },
      {
        id: '00000000-0000-4000-8000-00000000dc08',
        session_id: COMMITTED_SESSION_ID,
        sequence: 8,
        kind: 'commit',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal',
          proposal_id: COMMITTED_PROPOSAL_ID,
          committed_by: FIXTURE_USER_ID,
          committed_at: t(7).toISOString(),
        },
        created_at: t(7),
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

      // FOR UPDATE on `sessions` inside the mark handler's transaction.
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

      // `auth_token_denylist` consult — default-empty pool says
      // "no jti revoked" so the auth gate falls through to the
      // user-row lookup. Post-`jwt_revocation_jti_denylist`.
      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in WS mark test pool: ${text}`));
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
    '/api/ws',
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
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111dd1';
const MARK_MSG_ID = '22222222-2222-4222-8222-222222222dd1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function markFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  proposalId: string,
): string {
  return JSON.stringify({
    type: 'mark-meta-disagreement',
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

describe('ws_meta_disagreement_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeMarkPool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed mark with a `forbidden` wire error and does NOT append an event', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip subscribe — go straight to mark.
      ws.send(markFrame(MARK_MSG_ID, MARKABLE_SESSION_ID, 7, PROPOSAL_EVENT_ID));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(MARK_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter((e) => e.session_id === MARKABLE_SESSION_ID).length;
      expect(eventCount).toBe(7);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a mark for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly mark this connection as subscribed to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate to isolate the
      // mark handler's own gate (mirrors the commit/vote test approach).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(markFrame(MARK_MSG_ID, HIDDEN_SESSION_ID, 0, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(MARK_MSG_ID);
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

      ws.send(subscribeFrame(SUB_MSG_ID, MARKABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Seed MAX(sequence) is 7; expectedSequence=6 is stale.
      ws.send(markFrame(MARK_MSG_ID, MARKABLE_SESSION_ID, 6, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(MARK_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      const eventCount = store.events.filter((e) => e.session_id === MARKABLE_SESSION_ID).length;
      expect(eventCount).toBe(7);
    } finally {
      ws.terminate();
    }
  });

  it('HEADLINE: rejects a non-moderator subscribed participant attempting mark with `not-a-moderator`', async () => {
    // FIXTURE_USER_ID is a debater-A (not the moderator) in
    // NON_MODERATOR_SESSION_ID. They pass the subscribe-before-act
    // gate (they're a participant), pass visibility (the session is
    // public), and the engine fires `not-a-moderator` (rule 1 of
    // `markMetaDisagreementHandler`). This is the headline gate for
    // this handler.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_MODERATOR_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for NON_MODERATOR_SESSION_ID is 6.
      ws.send(markFrame(MARK_MSG_ID, NON_MODERATOR_SESSION_ID, 6, NON_MODERATOR_PROPOSAL_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(MARK_MSG_ID);
      expect(payload.code).toBe('not-a-moderator');
      expect(typeof payload.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_MODERATOR_SESSION_ID,
      ).length;
      expect(eventCount).toBe(6);
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `proposal-already-committed` rejection on a mark targeting a committed proposal', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for COMMITTED_SESSION_ID is 8 (after the commit).
      ws.send(markFrame(MARK_MSG_ID, COMMITTED_SESSION_ID, 8, COMMITTED_PROPOSAL_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(MARK_MSG_ID);
      expect(payload.code).toBe('proposal-already-committed');

      const eventCount = store.events.filter((e) => e.session_id === COMMITTED_SESSION_ID).length;
      expect(eventCount).toBe(8);
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `proposal-already-meta-disagreement` rejection on a duplicate mark (idempotency check)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, MARKABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First mark — should land successfully at seq 8.
      const FIRST_MARK_ID = '22222222-2222-4222-8222-222222222dd2';
      ws.send(markFrame(FIRST_MARK_ID, MARKABLE_SESSION_ID, 7, PROPOSAL_EVENT_ID));

      // Drain the `meta-disagreement-marked` ack + `event-applied` broadcast.
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        const parsed = JSON.parse(raw) as { type?: unknown };
        expect(['meta-disagreement-marked', 'event-applied']).toContain(parsed.type);
      }

      // Second mark on the same proposal — engine rejects with
      // `proposal-already-meta-disagreement`. expectedSequence is now 8.
      ws.send(markFrame(MARK_MSG_ID, MARKABLE_SESSION_ID, 8, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(MARK_MSG_ID);
      expect(payload.code).toBe('proposal-already-meta-disagreement');
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + moderator + recorded dispute → `meta-disagreement-marked` ack + appended event + `event-applied` broadcast on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, MARKABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Mark the disputed proposal. MAX(sequence) is 7; the new mark
      // event lands at seq 8.
      ws.send(markFrame(MARK_MSG_ID, MARKABLE_SESSION_ID, 7, PROPOSAL_EVENT_ID));

      // The moderator receives BOTH the `meta-disagreement-marked`
      // ack AND the `event-applied` broadcast (the moderator is also
      // a subscriber). Read tolerantly.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('meta-disagreement-marked');
      expect(types).toContain('event-applied');

      // `meta-disagreement-marked` ack assertions.
      const ack = frames.find((f) => f.type === 'meta-disagreement-marked') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: { sessionId?: unknown; sequence?: unknown; eventId?: unknown };
          }
        | undefined;
      expect(ack?.inResponseTo).toBe(MARK_MSG_ID);
      expect(ack?.id).toMatch(UUID_V4_PATTERN);
      expect(ack?.payload?.sessionId).toBe(MARKABLE_SESSION_ID);
      expect(ack?.payload?.sequence).toBe(8);
      expect(ack?.payload?.eventId).toMatch(UUID_V4_PATTERN);

      // `event-applied` broadcast assertions.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | {
            payload?: {
              event?: { kind?: unknown; sequence?: unknown; sessionId?: unknown };
            };
          }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('meta-disagreement-marked');
      expect(applied?.payload?.event?.sequence).toBe(8);
      expect(applied?.payload?.event?.sessionId).toBe(MARKABLE_SESSION_ID);

      // The event was appended to the store at sequence 8.
      const appended = store.events.find(
        (e) => e.session_id === MARKABLE_SESSION_ID && e.sequence === 8,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('meta-disagreement-marked');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      // The event payload references the proposal + records the moderator.
      const appendedPayload = appended?.payload as
        | {
            proposal_id?: unknown;
            moderator?: unknown;
            marked_at?: unknown;
          }
        | undefined;
      expect(appendedPayload?.proposal_id).toBe(PROPOSAL_EVENT_ID);
      expect(appendedPayload?.moderator).toBe(FIXTURE_USER_ID);
      expect(typeof appendedPayload?.marked_at).toBe('string');
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY: ignores any client-supplied `moderatorId` field on the payload — moderator identity comes from the authenticated connection', async () => {
    // FIXTURE_USER_ID is a debater-A in NON_MODERATOR_SESSION_ID (not
    // the moderator). The client sends a `mark-meta-disagreement`
    // envelope with an EXTRA `moderatorId` field naming OTHER_HOST_ID
    // (the actual moderator) in an attempt to impersonate the
    // moderator. The wire schema strips unknown fields on parse;
    // even if it didn't, the handler uses `connection.user.id`
    // regardless. The engine sees requester=FIXTURE_USER_ID and
    // rejects with `not-a-moderator` — the spoof has zero effect on
    // authority. This is the security invariant pinned in this test.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_MODERATOR_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      const spoofedFrame = JSON.stringify({
        type: 'mark-meta-disagreement',
        id: MARK_MSG_ID,
        payload: {
          sessionId: NON_MODERATOR_SESSION_ID,
          expectedSequence: 6,
          proposalId: NON_MODERATOR_PROPOSAL_ID,
          moderatorId: OTHER_HOST_ID, // <-- spoof attempt
        },
      });
      ws.send(spoofedFrame);

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(MARK_MSG_ID);
      // The engine sees FIXTURE_USER_ID as the requester (not the
      // spoofed OTHER_HOST_ID) and rejects with `not-a-moderator` —
      // the spoof has zero effect on the authority gate.
      expect(payload.code).toBe('not-a-moderator');

      // No event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_MODERATOR_SESSION_ID,
      ).length;
      expect(eventCount).toBe(6);
    } finally {
      ws.terminate();
    }
  });
});
