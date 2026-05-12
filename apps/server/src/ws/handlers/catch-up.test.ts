// @vitest-environment node
//
// Vitest unit tests for the WS `catch-up` handler (Shape B —
// server-mediated catch-up with snapshot fallback).
//
// Refinement: tasks/refinements/backend/ws_reconnection_handling.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_reconnection_handling
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire
//      error (existence-non-leak).
//   3. `sinceSequence` within the catch-up window → stream of
//      `event-applied` envelopes for missing events + `caught-up`
//      ack with `fromSnapshot: false`.
//   4. `sinceSequence` too far behind (gap > threshold) →
//      `snapshot-state` envelope + `caught-up` ack with
//      `fromSnapshot: true`.
//   5. `sinceSequence === MAX(sequence)` → no replay; single
//      `caught-up` ack with `eventCount: 0`.
//   6. `sinceSequence > MAX(sequence)` (client-ahead defensive
//      path) → no replay, no error; single `caught-up` ack with
//      `eventCount: 0` + `throughSequence: MAX(sequence)`.
//   7. The configurable threshold via the handler-options injection
//      surface (`__buildTestWsApp({ catchUpMaxEvents })`).
//   8. The pure `resolveCatchUpMaxEvents(env)` helper — env parsing.

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

import {
  DEFAULT_WS_CATCHUP_MAX_EVENTS,
  resolveCatchUpMaxEvents,
  WS_CATCHUP_MAX_EVENTS_ENV,
} from './catch-up.js';

// Stable fixture ids.
const SEEDED_SESSION_ID = '00000000-0000-4000-8000-000000000c01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000c02';
const NODE_ID = '00000000-0000-4000-8000-000000000c04';
const DEBATER_A_ID = '00000000-0000-4000-8000-000000000c05';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000c06';
const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-000000000cb1';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// SEEDED_SESSION_ID has 5 events:
//   seq 1: session-created
//   seq 2: participant-joined (FIXTURE_USER_ID, moderator)
//   seq 3: participant-joined (DEBATER_A_ID, debater-A)
//   seq 4: node-created (NODE_ID)
//   seq 5: proposal (PROPOSAL_EVENT_ID, classify-node)
//
// HIDDEN_SESSION_ID is a private session hosted by OTHER_HOST_ID — not
// visible to FIXTURE_USER_ID. Used for the not-found gate test.

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

function makeCatchUpPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      { id: SEEDED_SESSION_ID, host_user_id: FIXTURE_USER_ID, privacy: 'public', ended_at: null },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
    ],
    events: [
      {
        id: '00000000-0000-4000-8000-00000000ca01',
        session_id: SEEDED_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS catch-up test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000ca02',
        session_id: SEEDED_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000000ca03',
        session_id: SEEDED_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000000ca04',
        session_id: SEEDED_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim the catch-up will replay.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: PROPOSAL_EVENT_ID,
        session_id: SEEDED_SESSION_ID,
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
    ],
  };

  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      const trimmed = text.trim();

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

      // MAX(sequence) — catch-up boundary read.
      if (
        text.includes('COALESCE(MAX(sequence)') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1')
      ) {
        const sessionId = p[0] as string;
        const max = store.events
          .filter((e) => e.session_id === sessionId)
          .reduce((acc, e) => (e.sequence > acc ? e.sequence : acc), 0);
        return Promise.resolve({ rows: [{ max_seq: max }] as unknown as TRow[] });
      }

      // Slice SELECT for replay.
      if (
        text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1 AND sequence > $2 AND sequence <= $3') &&
        text.includes('ORDER BY sequence ASC')
      ) {
        const sessionId = p[0] as string;
        const since = p[1] as number;
        const through = p[2] as number;
        const rows = store.events
          .filter((e) => e.session_id === sessionId && e.sequence > since && e.sequence <= through)
          .sort((a, b) => a.sequence - b.sequence);
        return Promise.resolve({ rows: rows as unknown as TRow[] });
      }

      // Full event-log SELECT for snapshot-fallback projection-build.
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

      return Promise.reject(new Error(`unexpected SQL in WS catch-up test pool: ${text}`));
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

async function buildHandlerApp(
  pool: DbPool,
  opts: { catchUpMaxEvents?: number } = {},
): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool,
    sessionTokenSecret: TEST_SESSION_SECRET,
    ...(opts.catchUpMaxEvents !== undefined ? { catchUpMaxEvents: opts.catchUpMaxEvents } : {}),
  });
}

async function fixtureCookieHeader(): Promise<string> {
  const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

// Sample v4 UUIDs for the test envelopes' `id` field.
const SUB_MSG_ID = '11111111-1111-4111-8111-11111111cc01';
const CATCH_MSG_ID = '22222222-2222-4222-8222-22222222cc01';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function catchUpFrame(messageId: string, sessionId: string, sinceSequence: number): string {
  return JSON.stringify({
    type: 'catch-up',
    id: messageId,
    payload: { sessionId, sinceSequence },
  });
}

async function readUntilType(
  next: () => Promise<string>,
  type: string,
  maxFrames = 20,
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

interface FrameCollection {
  eventApplied: Array<Record<string, unknown>>;
  caughtUp?: Record<string, unknown>;
  snapshotState?: Record<string, unknown>;
}

/**
 * Drain frames from `next` until a `caught-up` ack arrives. Returns
 * the captured `event-applied` envelopes (in order) + the
 * `snapshot-state` envelope (if present) + the final `caught-up`
 * ack.
 */
async function drainUntilCaughtUp(
  next: () => Promise<string>,
  maxFrames = 50,
): Promise<FrameCollection> {
  const result: FrameCollection = { eventApplied: [] };
  for (let i = 0; i < maxFrames; i++) {
    const raw = await next();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === 'event-applied') {
      result.eventApplied.push(parsed);
    } else if (parsed.type === 'snapshot-state') {
      result.snapshotState = parsed;
    } else if (parsed.type === 'caught-up') {
      result.caughtUp = parsed;
      return result;
    }
  }
  throw new Error(`did not receive 'caught-up' ack within ${String(maxFrames)} frames`);
}

describe('ws_reconnection_handling — handler integration', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  it('rejects an unsubscribed catch-up with a `forbidden` wire error', async () => {
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip the subscribe — go straight to catch-up. Gate fires.
      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 0));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(CATCH_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a catch-up for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly subscribe the connection to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate so we
      // isolate the catch-up handler's own visibility re-check.
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(catchUpFrame(CATCH_MSG_ID, HIDDEN_SESSION_ID, 0));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(CATCH_MSG_ID);
      expect(payload.code).toBe('not-found');
    } finally {
      ws.terminate();
    }
  });

  it('sinceSequence within window → stream of `event-applied` envelopes + `caught-up` ack', async () => {
    // Threshold injected as 100 so the gap of 5 stays inside the
    // window. Default would also work (500), but pinning the option
    // here exercises the injection seam at the same time.
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool, { catchUpMaxEvents: 100 });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Client has seen seq 2; ask for everything after that.
      // Expected: 3 event-applied frames (seq 3, 4, 5) + a caught-up.
      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 2));

      const drained = await drainUntilCaughtUp(next);

      expect(drained.eventApplied.length).toBe(3);
      const sequences = drained.eventApplied.map((frame) => {
        const payload = frame.payload as { event?: { sequence?: unknown } };
        return payload.event?.sequence;
      });
      expect(sequences).toEqual([3, 4, 5]);

      // Each replay frame carries a fresh server-mint message id and
      // NO inResponseTo (replay frames are unsolicited from the
      // client's frame of reference; the caught-up ack carries
      // inResponseTo instead).
      for (const frame of drained.eventApplied) {
        expect(frame.id as string).toMatch(UUID_V4_PATTERN);
        expect(frame.inResponseTo).toBeUndefined();
      }

      // No snapshot-state on the slice path.
      expect(drained.snapshotState).toBeUndefined();

      // caught-up ack with `fromSnapshot: false`.
      expect(drained.caughtUp).toBeDefined();
      const ackPayload = drained.caughtUp!.payload as {
        sessionId?: unknown;
        throughSequence?: unknown;
        eventCount?: unknown;
        fromSnapshot?: unknown;
      };
      expect(drained.caughtUp!.inResponseTo).toBe(CATCH_MSG_ID);
      expect(ackPayload.sessionId).toBe(SEEDED_SESSION_ID);
      expect(ackPayload.throughSequence).toBe(5);
      expect(ackPayload.eventCount).toBe(3);
      expect(ackPayload.fromSnapshot).toBe(false);
    } finally {
      ws.terminate();
    }
  });

  it('sinceSequence too far behind → `snapshot-state` envelope + `caught-up` ack with fromSnapshot:true', async () => {
    // Threshold injected as 2 so the gap of 5 exceeds it. The
    // handler skips the slice and sends a snapshot instead.
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool, { catchUpMaxEvents: 2 });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Gap = 5 - 0 = 5; threshold = 2; 5 > 2 → snapshot path.
      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 0));

      const drained = await drainUntilCaughtUp(next);

      // No per-event replay frames on the snapshot path.
      expect(drained.eventApplied.length).toBe(0);

      // Snapshot envelope arrives first.
      expect(drained.snapshotState).toBeDefined();
      expect(drained.snapshotState!.inResponseTo).toBe(CATCH_MSG_ID);
      const snapPayload = drained.snapshotState!.payload as {
        sessionId?: unknown;
        sequence?: unknown;
        projection?: Record<string, unknown>;
      };
      expect(snapPayload.sessionId).toBe(SEEDED_SESSION_ID);
      expect(snapPayload.sequence).toBe(5);
      expect(snapPayload.projection?.lastAppliedSequence).toBe(5);

      // Then caught-up with fromSnapshot:true, eventCount:0.
      expect(drained.caughtUp).toBeDefined();
      const ackPayload = drained.caughtUp!.payload as {
        throughSequence?: unknown;
        eventCount?: unknown;
        fromSnapshot?: unknown;
      };
      expect(drained.caughtUp!.inResponseTo).toBe(CATCH_MSG_ID);
      expect(ackPayload.throughSequence).toBe(5);
      expect(ackPayload.eventCount).toBe(0);
      expect(ackPayload.fromSnapshot).toBe(true);
    } finally {
      ws.terminate();
    }
  });

  it('sinceSequence === MAX(sequence) → empty replay + `caught-up` with eventCount=0', async () => {
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Client is already at the head — sinceSequence === MAX(sequence) === 5.
      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 5));

      const drained = await drainUntilCaughtUp(next);

      expect(drained.eventApplied.length).toBe(0);
      expect(drained.snapshotState).toBeUndefined();
      expect(drained.caughtUp).toBeDefined();
      const ackPayload = drained.caughtUp!.payload as {
        throughSequence?: unknown;
        eventCount?: unknown;
        fromSnapshot?: unknown;
      };
      expect(ackPayload.throughSequence).toBe(5);
      expect(ackPayload.eventCount).toBe(0);
      expect(ackPayload.fromSnapshot).toBe(false);
    } finally {
      ws.terminate();
    }
  });

  it('sinceSequence > MAX(sequence) (client ahead — defensive) → `caught-up` with eventCount=0, no error', async () => {
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Client says it has seen seq 99 — well beyond the server's MAX(sequence)=5.
      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 99));

      const drained = await drainUntilCaughtUp(next);

      expect(drained.eventApplied.length).toBe(0);
      expect(drained.snapshotState).toBeUndefined();
      expect(drained.caughtUp).toBeDefined();
      const ackPayload = drained.caughtUp!.payload as {
        throughSequence?: unknown;
        eventCount?: unknown;
        fromSnapshot?: unknown;
      };
      // throughSequence pins to currentMax — NOT the bogus client value.
      expect(ackPayload.throughSequence).toBe(5);
      expect(ackPayload.eventCount).toBe(0);
      expect(ackPayload.fromSnapshot).toBe(false);
    } finally {
      ws.terminate();
    }
  });
});

// ============================================================
// Pure-logic tests for `resolveCatchUpMaxEvents`. Pins the env-
// resolution surface independently of the handler I/O.
// ============================================================

describe('resolveCatchUpMaxEvents — env-resolution helper', () => {
  it('returns the default when the env var is absent', () => {
    expect(resolveCatchUpMaxEvents({})).toBe(DEFAULT_WS_CATCHUP_MAX_EVENTS);
  });

  it('returns the default when the env var is empty', () => {
    expect(resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: '' })).toBe(
      DEFAULT_WS_CATCHUP_MAX_EVENTS,
    );
  });

  it('parses a positive integer', () => {
    expect(resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: '250' })).toBe(250);
  });

  it('rejects zero and falls back to the default', () => {
    expect(resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: '0' })).toBe(
      DEFAULT_WS_CATCHUP_MAX_EVENTS,
    );
  });

  it('rejects negative values and falls back to the default', () => {
    expect(resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: '-100' })).toBe(
      DEFAULT_WS_CATCHUP_MAX_EVENTS,
    );
  });

  it('rejects unparseable values and falls back to the default', () => {
    expect(resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: 'not-a-number' })).toBe(
      DEFAULT_WS_CATCHUP_MAX_EVENTS,
    );
  });

  it('exports the default as 500', () => {
    expect(DEFAULT_WS_CATCHUP_MAX_EVENTS).toBe(500);
  });
});
