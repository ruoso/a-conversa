// @vitest-environment node
//
// Vitest unit tests for the WS `label-snapshot` handler.
//
// Refinement: tasks/refinements/backend/ws_label_snapshot_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_label_snapshot_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The engine
// helper's per-rule logic is covered in
// `methodology/handlers/createSnapshot.test.ts`; this file is the
// integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire error.
//   3. **Headline gate**: a non-moderator subscribed participant
//      attempting label-snapshot → `moderator-only` wire error
//      (the WS-layer authority gate, mapped to status 403 by
//      `rejectedToApiError`).
//   4. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   5. Invalid label — empty after trim (`'   '`, three-space) →
//      `invalid-label` wire error (the engine helper's rejection).
//   6. Invalid label — over the 128-char cap → `invalid-label` wire
//      error.
//   7. Successful snapshot (moderator + valid label + correct
//      `expectedSequence`) → `snapshot-labeled` ack + appended
//      `snapshot-created` event + `event-applied` broadcast on the
//      same socket.
//   8. **Security invariant**: even when the client smuggles a
//      `moderatorId` field on the payload, the wire schema's closed
//      `z.object` strips it AND the handler ignores any non-schema
//      input; `connection.user.id` is the sole source of moderator
//      identity. A non-moderator who spoofs the moderator id still
//      hits `moderator-only`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
const SNAPSHOTTABLE_SESSION_ID = '00000000-0000-4000-8000-000000000e01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000e02';
const NON_MODERATOR_SESSION_ID = '00000000-0000-4000-8000-000000000e03';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000e04';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// SNAPSHOTTABLE_SESSION_ID is seeded with:
//   seq 1: session-created (FIXTURE_USER_ID as host/moderator)
//   seq 2: participant-joined (FIXTURE_USER_ID, moderator)
// MAX(sequence) = 2; the next label-snapshot lands at sequence 3.
//
// HIDDEN_SESSION_ID is a private session hosted by OTHER_HOST_ID — not
// visible to FIXTURE_USER_ID. Used for the not-found gate test.
//
// NON_MODERATOR_SESSION_ID is hosted by OTHER_HOST_ID (the moderator);
// FIXTURE_USER_ID is a debater. Public so visibility passes. The
// moderator-only gate fires.

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

function makeLabelSnapshotPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-31T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      {
        id: SNAPSHOTTABLE_SESSION_ID,
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
    ],
    events: [
      // SNAPSHOTTABLE_SESSION_ID — FIXTURE_USER_ID is the host/moderator.
      {
        id: '00000000-0000-4000-8000-00000000ea01',
        session_id: SNAPSHOTTABLE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS label-snapshot test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea02',
        session_id: SNAPSHOTTABLE_SESSION_ID,
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

      // NON_MODERATOR_SESSION_ID — OTHER_HOST_ID is the moderator;
      // FIXTURE_USER_ID is a debater. MAX(sequence) = 3 after seed.
      {
        id: '00000000-0000-4000-8000-00000000eb01',
        session_id: NON_MODERATOR_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: OTHER_HOST_ID,
        payload: {
          host_user_id: OTHER_HOST_ID,
          privacy: 'public',
          topic: 'Non-moderator label-snapshot test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb02',
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
        id: '00000000-0000-4000-8000-00000000eb03',
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

      // FOR UPDATE on `sessions` inside the label-snapshot handler's
      // transaction — must return `host_user_id` so the WS-layer
      // moderator gate can run without a second query.
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
          rows: [
            {
              id: session.id,
              host_user_id: session.host_user_id,
              ended_at: session.ended_at,
            },
          ] as unknown as TRow[],
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
          created_at: new Date('2026-05-31T10:00:30.000Z'),
        });
        return Promise.resolve({ rows: [] as TRow[] });
      }

      // `auth_token_denylist` consult — default-empty pool says "no jti
      // revoked" so the auth gate falls through to the user-row lookup.
      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in WS label-snapshot test pool: ${text}`));
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
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111ee1';
const LABEL_MSG_ID = '22222222-2222-4222-8222-222222222ee1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function labelSnapshotFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  label: string,
): string {
  return JSON.stringify({
    type: 'label-snapshot',
    id: messageId,
    payload: { sessionId, expectedSequence, label },
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

describe('ws_label_snapshot_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeLabelSnapshotPool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed label-snapshot with a `forbidden` wire error and does NOT append an event', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip subscribe — go straight to label-snapshot.
      ws.send(labelSnapshotFrame(LABEL_MSG_ID, SNAPSHOTTABLE_SESSION_ID, 2, 'Segment 1 close'));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(LABEL_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === SNAPSHOTTABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(2);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a label-snapshot for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly mark this connection as subscribed to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate to isolate
      // the label-snapshot handler's own gate (mirrors the
      // commit/vote/mark test approach).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(labelSnapshotFrame(LABEL_MSG_ID, HIDDEN_SESSION_ID, 0, 'Segment 1 close'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(LABEL_MSG_ID);
      expect(payload.code).toBe('not-found');
    } finally {
      ws.terminate();
    }
  });

  it('HEADLINE: rejects a non-moderator subscribed participant with `moderator-only`', async () => {
    // FIXTURE_USER_ID is a debater (not the moderator) in
    // NON_MODERATOR_SESSION_ID. They pass the subscribe-before-act
    // gate (they're a participant), pass visibility (the session is
    // public), and the WS-layer moderator-only check fires. This is
    // the headline gate for this handler.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_MODERATOR_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for NON_MODERATOR_SESSION_ID is 3.
      ws.send(labelSnapshotFrame(LABEL_MSG_ID, NON_MODERATOR_SESSION_ID, 3, 'Segment 1 close'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(LABEL_MSG_ID);
      expect(payload.code).toBe('moderator-only');
      expect(typeof payload.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_MODERATOR_SESSION_ID,
      ).length;
      expect(eventCount).toBe(3);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a stale `expectedSequence` with a `sequence-mismatch` wire error', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SNAPSHOTTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Seed MAX(sequence) is 2; expectedSequence=1 is stale.
      ws.send(labelSnapshotFrame(LABEL_MSG_ID, SNAPSHOTTABLE_SESSION_ID, 1, 'Segment 1 close'));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(LABEL_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      const eventCount = store.events.filter(
        (e) => e.session_id === SNAPSHOTTABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(2);
    } finally {
      ws.terminate();
    }
  });

  it('rejects an empty-after-trim label with `invalid-label` (whitespace-only slips the wire schema)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SNAPSHOTTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Three-space whitespace passes the wire schema's `min(1)` check
      // (pre-trim length is 3) and is rejected by the engine helper's
      // trim-then-non-empty check.
      ws.send(labelSnapshotFrame(LABEL_MSG_ID, SNAPSHOTTABLE_SESSION_ID, 2, '   '));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(LABEL_MSG_ID);
      expect(payload.code).toBe('invalid-label');
      expect(typeof payload.message).toBe('string');

      const eventCount = store.events.filter(
        (e) => e.session_id === SNAPSHOTTABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(2);
    } finally {
      ws.terminate();
    }
  });

  it('rejects an over-cap label with `invalid-label` (wire schema rejects pre-handler)', async () => {
    // A 129-char label exceeds the wire schema's `max(128)` and is
    // rejected at the envelope-parse layer with a malformed-envelope
    // error. The handler is never invoked; no event appended. The
    // wire-error surface for that failure path is owned by
    // `ws_error_message` — what we pin here is that the over-cap
    // label does NOT slip through to the engine OR get accepted.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SNAPSHOTTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(labelSnapshotFrame(LABEL_MSG_ID, SNAPSHOTTABLE_SESSION_ID, 2, 'x'.repeat(129)));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      // Either the wire-schema malformed-envelope path or the engine's
      // `invalid-label` — both are valid rejection paths for an
      // over-cap input. Pin that the request is rejected and no event
      // is appended (the contract callers depend on).
      expect(['invalid-label', 'malformed-envelope']).toContain(payload.code);

      const eventCount = store.events.filter(
        (e) => e.session_id === SNAPSHOTTABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(2);
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + moderator + valid label → `snapshot-labeled` ack + appended event + `event-applied` broadcast on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SNAPSHOTTABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) is 2; the new snapshot-created event lands at
      // seq 3.
      ws.send(labelSnapshotFrame(LABEL_MSG_ID, SNAPSHOTTABLE_SESSION_ID, 2, 'Segment 1 close'));

      // The moderator receives BOTH the `snapshot-labeled` ack AND
      // the `event-applied` broadcast (the moderator is also a
      // subscriber). Read tolerantly.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('snapshot-labeled');
      expect(types).toContain('event-applied');

      // `snapshot-labeled` ack assertions.
      const ack = frames.find((f) => f.type === 'snapshot-labeled') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: { snapshotId?: unknown };
          }
        | undefined;
      expect(ack?.inResponseTo).toBe(LABEL_MSG_ID);
      expect(ack?.id).toMatch(UUID_V4_PATTERN);
      expect(ack?.payload?.snapshotId).toMatch(UUID_V4_PATTERN);

      // `event-applied` broadcast assertions.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | {
            payload?: {
              event?: {
                kind?: unknown;
                sequence?: unknown;
                sessionId?: unknown;
                actor?: unknown;
                payload?: { snapshot_id?: unknown; label?: unknown; log_position?: unknown };
              };
            };
          }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('snapshot-created');
      expect(applied?.payload?.event?.sequence).toBe(3);
      expect(applied?.payload?.event?.sessionId).toBe(SNAPSHOTTABLE_SESSION_ID);
      expect(applied?.payload?.event?.actor).toBe(FIXTURE_USER_ID);
      // The snapshot id on the ack matches the event payload's
      // snapshot_id — the moderator's modal can correlate the ack
      // against the incoming projection snapshot.
      expect(applied?.payload?.event?.payload?.snapshot_id).toBe(ack?.payload?.snapshotId);
      // The label is trimmed (no leading/trailing whitespace was
      // sent here so it round-trips verbatim).
      expect(applied?.payload?.event?.payload?.label).toBe('Segment 1 close');
      // The snapshot's `log_position` is the same sequence as the
      // event envelope (`currentSequence + 1`).
      expect(applied?.payload?.event?.payload?.log_position).toBe(3);

      // The event was appended to the store at sequence 3.
      const appended = store.events.find(
        (e) => e.session_id === SNAPSHOTTABLE_SESSION_ID && e.sequence === 3,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('snapshot-created');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY: ignores any client-supplied `moderatorId` field on the payload — moderator identity comes from the authenticated connection', async () => {
    // FIXTURE_USER_ID is a debater in NON_MODERATOR_SESSION_ID (not
    // the moderator). The client sends a `label-snapshot` envelope
    // with an EXTRA `moderatorId` field naming OTHER_HOST_ID (the
    // actual moderator) in an attempt to impersonate the moderator.
    // The wire schema strips unknown fields on parse; even if it
    // didn't, the handler uses `connection.user.id` regardless. The
    // WS-layer moderator gate sees requester=FIXTURE_USER_ID,
    // host_user_id=OTHER_HOST_ID, and rejects with `moderator-only` —
    // the spoof has zero effect on the authority gate.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_MODERATOR_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      const spoofedFrame = JSON.stringify({
        type: 'label-snapshot',
        id: LABEL_MSG_ID,
        payload: {
          sessionId: NON_MODERATOR_SESSION_ID,
          expectedSequence: 3,
          label: 'Segment 1 close',
          moderatorId: OTHER_HOST_ID, // <-- spoof attempt
        },
      });
      ws.send(spoofedFrame);

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(LABEL_MSG_ID);
      // The WS-layer gate sees FIXTURE_USER_ID as the requester (not
      // the spoofed OTHER_HOST_ID) and rejects with `moderator-only`.
      expect(payload.code).toBe('moderator-only');

      // No event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_MODERATOR_SESSION_ID,
      ).length;
      expect(eventCount).toBe(3);
    } finally {
      ws.terminate();
    }
  });
});
