// @vitest-environment node
//
// Vitest unit tests for the WS `propose` handler.
//
// Refinement: tasks/refinements/backend/ws_propose_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_propose_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The methodology
// engine's per-sub-kind rule logic is covered separately in the
// `methodology/handlers/propose*.test.ts` files; this file is the
// integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire error.
//   3. Subscribed + visible + valid action → `proposed` ack arrives,
//      event appended, `event-applied` broadcast fires (on the same
//      socket, since the proposer is also a subscriber).
//   4. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   5. Methodology rejection (engine `'not-a-participant'`) → 403
//      `not-a-participant` wire error via `rejectedToApiError`.
//
// **Memory pool composition.** The handler issues several SQL statements
// that the pool must recognise:
//
//   - The auth-middleware SELECT (`SELECT id, screen_name FROM users`).
//   - `canSeeSession`'s visibility-gated SELECT (the pre-transaction
//     gate 2 check + the in-transaction FOR UPDATE on `sessions`).
//   - `SELECT MAX(sequence) FROM session_events WHERE session_id = $1`.
//   - `SELECT ... FROM session_events WHERE session_id = $1 ORDER BY
//     sequence ASC` (the projection-load SELECT).
//   - `INSERT INTO session_events ...` (via `appendSessionEvent`).
//   - `BEGIN` / `COMMIT` / `ROLLBACK` no-ops for the transactional wrapper.
//
// The shim below mirrors the recogniser shape `sessions/routes.test.ts`
// + `ws/handlers/subscribe.test.ts` already use; it's local to this file
// because no other test exercises this exact superset.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
const VISIBLE_SESSION_ID = '00000000-0000-4000-8000-000000000d01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000d02';
const NODE_ID = '00000000-0000-4000-8000-000000000d03';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000d04';
const NON_PARTICIPANT_USER_ID = '00000000-0000-4000-8000-000000000d05';
const NON_PARTICIPANT_SESSION_ID = '00000000-0000-4000-8000-000000000d06';

// RFC 4122 v4 UUID matcher — mirrors `subscribe.test.ts`.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// One memory pool that answers EVERY SQL statement the WS auth gate +
// `canSeeSession` predicate + the propose handler's transactional flow
// issues. Mirrors the SQL recognisers in `sessions/routes.test.ts` and
// `ws/handlers/subscribe.test.ts`, scoped to what the propose path
// actually needs.

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

function makeProposePool(): { pool: DbPool; store: Store } {
  // FIXTURE_USER_ID hosts a public session (visible + the user is a
  // participant via the session-created/participant-joined seed).
  // OTHER_HOST_ID hosts a private hidden session.
  // NON_PARTICIPANT_USER_ID hosts a public session FIXTURE_USER_ID can
  // see but isn't a participant of.
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
        id: NON_PARTICIPANT_SESSION_ID,
        host_user_id: NON_PARTICIPANT_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
    ],
    // Seed events: VISIBLE_SESSION_ID has a session-created +
    // participant-joined for FIXTURE_USER_ID + a node-created on
    // NODE_ID so the annotate propose has a target. The seed mirrors
    // what `routes.ts`'s POST /sessions handler would produce.
    events: [
      {
        id: '00000000-0000-4000-8000-00000000eeee',
        session_id: VISIBLE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS propose test',
          created_at: '2026-05-11T10:00:00.000Z',
        },
        created_at: new Date('2026-05-11T10:00:00.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-00000000eeef',
        session_id: VISIBLE_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: '2026-05-11T10:00:01.000Z',
        },
        created_at: new Date('2026-05-11T10:00:01.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-00000000eef0',
        session_id: VISIBLE_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim to annotate during the propose test.',
          created_by: FIXTURE_USER_ID,
          created_at: '2026-05-11T10:00:02.000Z',
        },
        created_at: new Date('2026-05-11T10:00:02.000Z'),
      },
      // NON_PARTICIPANT_SESSION_ID: only session-created — no
      // participant-joined for FIXTURE_USER_ID, so the engine's
      // universal `not-a-participant` gate rejects propose attempts.
      {
        id: '00000000-0000-4000-8000-00000000eef1',
        session_id: NON_PARTICIPANT_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: NON_PARTICIPANT_USER_ID,
        payload: {
          host_user_id: NON_PARTICIPANT_USER_ID,
          privacy: 'public',
          topic: 'Non-participant session',
          created_at: '2026-05-11T10:00:00.000Z',
        },
        created_at: new Date('2026-05-11T10:00:00.000Z'),
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

      // BEGIN/COMMIT/ROLLBACK — no-ops in the in-memory store.
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

      // `canSeeSession` — the visibility-gated SELECT 1 (NOT FOR UPDATE).
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

      // FOR UPDATE on `sessions` inside the propose handler's
      // transaction. The shim only routes on `WHERE id = $1` + the
      // FOR UPDATE textual marker — `FOR UPDATE` is a no-op in the
      // single-threaded test runtime.
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

      // Event-log SELECT for the projection-load step.
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

      // INSERT INTO session_events — via `appendSessionEvent`.
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

      return Promise.reject(new Error(`unexpected SQL in WS propose test pool: ${text}`));
    },
  };

  return { pool, store };
}

// ---- WS client plumbing --------------------------------------------
//
// Same shape as `subscribe.test.ts` — pre-attach a `message` listener
// via `onInit` so server-initiated frames don't race the reader.

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
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111aa1';
const PROPOSE_MSG_ID = '22222222-2222-4222-8222-222222222aa1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function annotateProposeFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  targetNodeId: string,
): string {
  return JSON.stringify({
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
        content: 'A note attached during the propose-handler test.',
      },
    },
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

describe('ws_propose_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeProposePool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed propose with a `forbidden` wire error and does NOT append an event', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip the subscribe — go straight to propose. The gate fires.
      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, VISIBLE_SESSION_ID, 3, NODE_ID));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter((e) => e.session_id === VISIBLE_SESSION_ID).length;
      expect(eventCount).toBe(3);
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + valid action → `proposed` ack arrives, event appended, `event-applied` broadcast fires on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Subscribe first.
      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Propose. `expectedSequence` matches MAX(sequence) = 3 (the
      // seed has session-created + participant-joined + node-created).
      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, VISIBLE_SESSION_ID, 3, NODE_ID));

      // The proposer receives BOTH the `proposed` ack AND the
      // `event-applied` broadcast. Order is not guaranteed by the
      // contract — read until both have arrived, then assert.
      // In practice the implementation emits the broadcast FIRST
      // (synchronous bus dispatch) and then the ack (handler send),
      // but the test reads tolerantly.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('proposed');
      expect(types).toContain('event-applied');

      // `proposed` ack assertions.
      const proposed = frames.find((f) => f.type === 'proposed') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: { sessionId?: unknown; sequence?: unknown; eventId?: unknown };
          }
        | undefined;
      expect(proposed?.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(proposed?.id).toMatch(UUID_V4_PATTERN);
      expect(proposed?.payload?.sessionId).toBe(VISIBLE_SESSION_ID);
      expect(proposed?.payload?.sequence).toBe(4);
      expect(proposed?.payload?.eventId).toMatch(UUID_V4_PATTERN);

      // `event-applied` broadcast assertions.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | { payload?: { event?: { kind?: unknown; sequence?: unknown; sessionId?: unknown } } }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('proposal');
      expect(applied?.payload?.event?.sequence).toBe(4);
      expect(applied?.payload?.event?.sessionId).toBe(VISIBLE_SESSION_ID);

      // The event was appended to the store at sequence 4.
      const appended = store.events.find(
        (e) => e.session_id === VISIBLE_SESSION_ID && e.sequence === 4,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('proposal');
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

      // The seed's MAX(sequence) is 3 — sending expectedSequence=2
      // models a client whose view of the session is stale.
      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, VISIBLE_SESSION_ID, 2, NODE_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      // No new event appended on the rejection path.
      const eventCount = store.events.filter((e) => e.session_id === VISIBLE_SESSION_ID).length;
      expect(eventCount).toBe(3);
    } finally {
      ws.terminate();
    }
  });

  it('KNOWN-LIMITATION: pins no wire-layer dedupe by envelope id — first copy succeeds, second copy fails with `sequence-mismatch` (G-009)', async () => {
    // Pins the CURRENT, documented limitation that the server has no
    // wire-layer dedupe by `envelope.id` (source: `docs/security/m3-
    // review/coverage.md` G-009). The dispatcher at
    // `apps/server/src/ws/dispatcher.ts` trusts the inbound `id` and
    // does NOT maintain a per-connection seen-set; replay protection
    // for write actions lives at the engine layer via
    // `expectedSequence`. The first copy of a `propose` envelope
    // appends at MAX+1; the second copy carries the SAME (now stale)
    // `expectedSequence` and is rejected by the engine's optimistic-
    // concurrency check as `sequence-mismatch`.
    //
    // This is an ACCEPTED limitation — what should be a server-side
    // dedupe is instead a methodology-engine reject. The structural
    // fix is a future `wire_dedupe` task (per-connection
    // `(connectionId, envelope.id)` seen-set + an explicit
    // `duplicate-envelope` error code). When that task lands, this
    // test MUST be inverted: the second copy should produce a
    // `duplicate-envelope` error envelope (or be silently dropped,
    // TBD by that task's refinement) rather than `sequence-mismatch`.
    // Refinement: `tasks/refinements/backend-hardening/duplicate_envelope_id_pin.md`.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First copy: well-formed propose at the seed's MAX(sequence)=3
      // boundary. Mirrors the happy-path test's setup beat-for-beat.
      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, VISIBLE_SESSION_ID, 3, NODE_ID));

      // Drain the `proposed` ack + `event-applied` broadcast for the
      // first copy. Order is not contractually fixed (mirror the
      // happy-path test's tolerant read).
      const firstFrames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        firstFrames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const firstTypes = firstFrames.map((f) => f.type);
      expect(firstTypes).toContain('proposed');
      expect(firstTypes).toContain('event-applied');

      // The `proposed` ack carries `inResponseTo` = the shared
      // envelope id. This is the auditor-readable proof that the
      // first server frame correlates to the FIRST client envelope.
      const firstProposed = firstFrames.find((f) => f.type === 'proposed') as
        | { inResponseTo?: unknown; payload?: { sequence?: unknown } }
        | undefined;
      expect(firstProposed?.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(firstProposed?.payload?.sequence).toBe(4);

      // Second copy: the EXACT same envelope (identical `id`,
      // identical `expectedSequence`, identical proposal payload).
      // A wire-layer dedupe would intercept this before the handler
      // ran; today nothing does, so the handler runs and the
      // engine's optimistic-concurrency check rejects it because
      // MAX(sequence) has advanced to 4 while the carried
      // `expectedSequence` is still 3.
      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, VISIBLE_SESSION_ID, 3, NODE_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      // Both the `proposed` ack AND the `error` envelope carry the
      // SAME `inResponseTo` — the duplicate id is propagated
      // faithfully through both success and error paths, NOT
      // mangled or de-duplicated server-side. This is the wire-
      // contract surface G-009 names.
      expect(err.parsed.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      // Persisted side-effect: exactly ONE new `proposal` event for
      // the session (sequence 4). The second copy was rejected
      // before any append. Pins the store-level invariant that the
      // replay did NOT cause a double-append; the engine's check
      // is load-bearing for replay protection even though it isn't
      // the *intended* wire-layer dedupe surface.
      const proposalEvents = store.events.filter(
        (e) => e.session_id === VISIBLE_SESSION_ID && e.kind === 'proposal',
      );
      expect(proposalEvents.length).toBe(1);
      expect(proposalEvents[0]?.sequence).toBe(4);
      const totalEvents = store.events.filter((e) => e.session_id === VISIBLE_SESSION_ID).length;
      expect(totalEvents).toBe(4); // 3 seed + 1 proposal
    } finally {
      ws.terminate();
    }
  });

  it('echoes the methodology engine `not-a-participant` rejection as a wire error', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // NON_PARTICIPANT_SESSION_ID is visible (public) but the
      // FIXTURE_USER_ID is not a participant. Subscribe is allowed
      // (visibility-gated only); the propose hits the engine's
      // universal `not-a-participant` rejection.
      ws.send(subscribeFrame(SUB_MSG_ID, NON_PARTICIPANT_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, NON_PARTICIPANT_SESSION_ID, 1, NODE_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(payload.code).toBe('not-a-participant');
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY: ignores any client-supplied `proposerId` / `actor` field on the payload — proposer identity comes from the authenticated connection', async () => {
    // Pins the actor-spoof-rejected invariant for the WS `propose`
    // handler. The vote / commit / mark-meta-disagreement handlers
    // already pin this in their respective `*.test.ts` files; this is
    // the propose parity case (`docs/security/m3-review/coverage.md`
    // G-007).
    //
    // The wire schema `wsProposePayloadSchema` is a closed `z.object`
    // — Zod's default behavior strips unknown keys at parse time, so
    // the extra `proposerId` / `actor` field never makes it past
    // `parseWsEnvelope`. Even if a future refactor loosened the
    // schema, the handler at `propose.ts:280` reads
    // `connection.user.id` for the action's `actor` and never
    // consults the payload for identity. Both layers together
    // guarantee the appended event's `actor` is `FIXTURE_USER_ID`,
    // regardless of any client-supplied spoof attempt.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, VISIBLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Build a propose envelope with EXTRA spoof fields on the
      // payload: `proposerId`, `actor`, `requester` — every name a
      // future attacker might guess. `wsProposePayloadSchema`'s
      // closed `z.object` strips them at parse time; the handler
      // would ignore them even if they survived parse.
      const spoofedFrame = JSON.stringify({
        type: 'propose',
        id: PROPOSE_MSG_ID,
        payload: {
          sessionId: VISIBLE_SESSION_ID,
          expectedSequence: 3,
          proposal: {
            kind: 'annotate',
            target_kind: 'node',
            target_id: NODE_ID,
            annotation_kind: 'note',
            content: 'Spoof-attempt note.',
          },
          // <-- spoof attempts below; all of these MUST be ignored
          proposerId: OTHER_HOST_ID,
          actor: OTHER_HOST_ID,
          requester: OTHER_HOST_ID,
        },
      });
      ws.send(spoofedFrame);

      // Drain `proposed` ack + `event-applied` broadcast (order is
      // not contractually fixed — mirror the existing happy-path
      // test's tolerant read).
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        const parsed = JSON.parse(raw) as { type?: unknown };
        expect(['proposed', 'event-applied']).toContain(parsed.type);
      }

      // The appended event's `actor` is the connection's
      // authenticated user, NOT the spoofed `OTHER_HOST_ID`. This is
      // the security invariant G-007 pins.
      const appended = store.events.find(
        (e) => e.session_id === VISIBLE_SESSION_ID && e.sequence === 4,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('proposal');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      expect(appended?.actor).not.toBe(OTHER_HOST_ID);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a propose for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly populate the registry as if the client were already
      // subscribed to HIDDEN_SESSION_ID — bypassing the subscribe
      // handler's visibility gate so we can isolate the propose
      // handler's own gate. (Production never reaches this state
      // because `subscribe` itself would have been rejected; this test
      // pins what would happen if a session became invisible between
      // subscribe and propose.)
      const opened = app.wsSubscriptions.connectionsForSession(VISIBLE_SESSION_ID);
      // After the hello the connection has a fresh id; reach it from
      // openConnections via the `wsSubscriptions` decoration's
      // `subscribe(conn, sess)` method. Force the subscription:
      void opened;
      // We need the connection id. Inspect openConnections — exported
      // for tests via `__getOpenConnectionsForTests`.
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(annotateProposeFrame(PROPOSE_MSG_ID, HIDDEN_SESSION_ID, 0, NODE_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(PROPOSE_MSG_ID);
      expect(payload.code).toBe('not-found');

      // No new event appended.
      const eventCount = store.events.filter((e) => e.session_id === HIDDEN_SESSION_ID).length;
      expect(eventCount).toBe(0);
    } finally {
      ws.terminate();
    }
  });
});
