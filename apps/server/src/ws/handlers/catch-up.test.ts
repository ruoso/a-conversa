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
  __clearAllCatchUpRateStateForTests,
  CATCH_UP_RATE_LIMIT_WINDOW_MS,
  DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
  DEFAULT_WS_CATCHUP_MAX_EVENTS,
  MAX_CATCH_UP_EVENTS_CEILING,
  resolveCatchUpMaxEvents,
  resolveCatchUpRateLimit,
  WS_CATCH_UP_RATE_LIMIT_ENV,
  WS_CATCHUP_MAX_EVENTS_ENV,
  WS_TOO_MANY_CATCH_UP_REQUESTS_CODE,
} from './catch-up.js';

// Stable fixture ids.
const SEEDED_SESSION_ID = '00000000-0000-4000-8000-000000000c01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000c02';
const NODE_ID = '00000000-0000-4000-8000-000000000c04';
const DEBATER_A_ID = '00000000-0000-4000-8000-000000000c05';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000c06';
const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-000000000cb1';

// G-002 fixtures — race-against-the-prune + former-participant pins.
// Refinement: tasks/refinements/backend-hardening/catch_up_revoked_visibility_pin.md.
// Sessions whose host is OTHER_HOST_ID so FIXTURE_USER_ID is structurally
// a non-host; the privacy bit is mutated mid-test for Scenario A, and the
// `participants` array's `left_at` is non-null for Scenario B.
const STRANGER_SUB_SESSION_ID = '00000000-0000-4000-8000-000000000c07';
const FORMER_PARTICIPANT_SESSION_ID = '00000000-0000-4000-8000-000000000c08';

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
//
// STRANGER_SUB_SESSION_ID (G-002 Scenario A): public-then-private
// session hosted by OTHER_HOST_ID. FIXTURE_USER_ID is neither host nor
// participant. The test subscribes while public, then mutates
// `store.sessions[…].privacy = 'private'` to simulate the race-window
// state the privacy-flip prune (predecessor task G-001) leaves open:
// the registry entry exists but `canSeeSession` would now reject. No
// seeded events — gate-2 fires before the boundary read so events are
// not needed.
//
// FORMER_PARTICIPANT_SESSION_ID (G-002 Scenario B): private session
// hosted by OTHER_HOST_ID. FIXTURE_USER_ID has a `session_participants`
// row with `left_at` set, so they are a FORMER participant. Per the
// visibility rule (once-a-participant always seeable; see
// apps/server/src/sessions/visibility.ts:12-19), the predicate admits.
// No seeded events — the catch-up's `caught-up` ack with eventCount=0
// is sufficient evidence that gate-2 admitted the request.

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

/**
 * Per-row shape mirroring the `session_participants` table — minimal
 * subset the visibility recogniser needs. `left_at` is present
 * intentionally so Scenario B can exercise the former-participant
 * branch of the once-a-participant rule (the production EXISTS clause
 * has no `left_at IS NULL` filter, so this column is informational
 * only — the mock admits regardless of its value).
 */
interface ParticipantRow {
  session_id: string;
  user_id: string;
  left_at: Date | null;
}

interface Store {
  sessions: SessionRow[];
  events: EventRow[];
  participants: ParticipantRow[];
}

function makeCatchUpPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      { id: SEEDED_SESSION_ID, host_user_id: FIXTURE_USER_ID, privacy: 'public', ended_at: null },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
      // G-002 Scenario A — public, FIXTURE_USER_ID is non-host and
      // non-participant. Test mutates `privacy` to 'private' mid-test.
      {
        id: STRANGER_SUB_SESSION_ID,
        host_user_id: OTHER_HOST_ID,
        privacy: 'public',
        ended_at: null,
      },
      // G-002 Scenario B — private, FIXTURE_USER_ID is a former
      // participant (left_at set; see `participants` below). Per the
      // once-a-participant rule, `canSeeSession` admits.
      {
        id: FORMER_PARTICIPANT_SESSION_ID,
        host_user_id: OTHER_HOST_ID,
        privacy: 'private',
        ended_at: null,
      },
    ],
    participants: [
      // G-002 Scenario B fixture — FIXTURE_USER_ID joined and then left
      // FORMER_PARTICIPANT_SESSION_ID. The production participant
      // EXISTS clause has no `left_at IS NULL` filter, so this row
      // admits the user via `canSeeSession`.
      {
        session_id: FORMER_PARTICIPANT_SESSION_ID,
        user_id: FIXTURE_USER_ID,
        left_at: t(5),
      },
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
        // Once-a-participant rule: the production EXISTS clause has no
        // `left_at IS NULL` filter, so any matching participant row
        // (current OR past) admits visibility. Refinement: tasks/
        // refinements/backend-hardening/catch_up_revoked_visibility_pin.md.
        const isOrWasParticipant = store.participants.some(
          (p2) => p2.session_id === sessionId && p2.user_id === userId,
        );
        if (isPublic || isHost || isOrWasParticipant) {
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

      // Slice SELECT for replay. Now carries `LIMIT $4` per F-004's
      // bounded-SELECT contract; the mock honors the limit to mirror
      // the real DB's behavior.
      if (
        text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1 AND sequence > $2 AND sequence <= $3') &&
        text.includes('ORDER BY sequence ASC') &&
        text.includes('LIMIT $4')
      ) {
        const sessionId = p[0] as string;
        const since = p[1] as number;
        const through = p[2] as number;
        const limit = p[3] as number;
        const rows = store.events
          .filter((e) => e.session_id === sessionId && e.sequence > since && e.sequence <= through)
          .sort((a, b) => a.sequence - b.sequence)
          .slice(0, limit);
        return Promise.resolve({ rows: rows as unknown as TRow[] });
      }

      // Full event-log SELECT for snapshot-fallback projection-build.
      // Now carries `LIMIT $2` per F-004's bounded-SELECT contract; the
      // mock honors the limit.
      if (
        text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1') &&
        text.includes('ORDER BY sequence ASC') &&
        text.includes('LIMIT $2')
      ) {
        const sessionId = p[0] as string;
        const limit = p[1] as number;
        const rows = store.events
          .filter((e) => e.session_id === sessionId)
          .sort((a, b) => a.sequence - b.sequence)
          .slice(0, limit);
        return Promise.resolve({ rows: rows as unknown as TRow[] });
      }

      // `auth_token_denylist` consult (post-`jwt_revocation_jti_denylist`).
      // Default-empty: no jti revoked. Tests in this file don't
      // exercise revocation paths.
      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
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

async function buildHandlerApp(
  pool: DbPool,
  opts: {
    catchUpMaxEvents?: number;
    catchUpRateLimitPerWindow?: number;
    now?: () => number;
  } = {},
): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool,
    sessionTokenSecret: TEST_SESSION_SECRET,
    ...(opts.catchUpMaxEvents !== undefined ? { catchUpMaxEvents: opts.catchUpMaxEvents } : {}),
    ...(opts.catchUpRateLimitPerWindow !== undefined
      ? { catchUpRateLimitPerWindow: opts.catchUpRateLimitPerWindow }
      : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
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
  proposalStatus: Array<Record<string, unknown>>;
  caughtUp?: Record<string, unknown>;
  snapshotState?: Record<string, unknown>;
}

/**
 * Drain frames from `next` until a `caught-up` ack arrives. Returns
 * the captured `event-applied` envelopes (in order) + the
 * `snapshot-state` envelope (if present) + any seed
 * `proposal-status` envelopes (per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`
 * D7 — case-2 emits one per pending facet target after the
 * `snapshot-state` send) + the final `caught-up` ack.
 */
async function drainUntilCaughtUp(
  next: () => Promise<string>,
  maxFrames = 50,
): Promise<FrameCollection> {
  const result: FrameCollection = { eventApplied: [], proposalStatus: [] };
  for (let i = 0; i < maxFrames; i++) {
    const raw = await next();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === 'event-applied') {
      result.eventApplied.push(parsed);
    } else if (parsed.type === 'snapshot-state') {
      result.snapshotState = parsed;
    } else if (parsed.type === 'proposal-status') {
      result.proposalStatus.push(parsed);
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
    // Clear the module-scoped per-connection rate-limit Map so a
    // stale bucket from one test doesn't bleed into the next.
    // Production callers reach for `clearCatchUpRateStateForConnection`
    // from the connection-close hook; the test reset is a coarser
    // hammer because back-to-back tests build fresh app instances and
    // close hooks may interleave with `app.close()`.
    __clearAllCatchUpRateStateForTests();
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

  it('SECURITY (G-002): subscribe → privacy-flip server-side → racing `catch-up` is rejected with `not-found` (gate-2 re-check)', async () => {
    // Pin G-002 (coverage.md): the catch-up handler's gate-2
    // `canSeeSession` re-check at apps/server/src/ws/handlers/catch-up.ts:464
    // catches the race where a `catch-up` envelope lands AFTER a
    // session has flipped to private but BEFORE the active prune
    // (privacy_flip_subscription_prune, G-001) has evicted the
    // subscriber from the registry. The two defenses are
    // complementary — the prune is the active fix; this gate is the
    // structural defense for the in-flight envelope that races the
    // prune iteration.
    //
    // Setup: STRANGER_SUB_SESSION_ID starts public; FIXTURE_USER_ID
    // (a non-host non-participant) subscribes via the normal
    // subscribe handler path so the registry entry carries the userId
    // binding the predecessor task added. Then the test mutates
    // `store.sessions[…].privacy = 'private'` directly — simulating
    // the race-window state (privacy bit committed, prune not yet
    // iterated to this connection). Catch-up: gate-2 fires.
    //
    // The wire shape is `code: 'not-found'` (NOT `forbidden`) per the
    // existence-non-leak rule — same shape as the existing not-found
    // gate test above, so a reader of the two tests sees the parallel.
    //
    // Refinement: tasks/refinements/backend-hardening/catch_up_revoked_visibility_pin.md.
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Subscribe normally while the session is public — succeeds.
      ws.send(subscribeFrame(SUB_MSG_ID, STRANGER_SUB_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Sanity check: registry entry exists for this connection
      // BEFORE the privacy flip (mirrors the pre-prune state).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      const beforeFlip = app.wsSubscriptions.connectionsForSession(STRANGER_SUB_SESSION_ID);
      expect(beforeFlip).toContain(connectionId);

      // Server-side privacy flip — without triggering the prune.
      // This is the race state: privacy='private' is committed; the
      // prune helper has not yet evicted this connection.
      const sessionRow = built.store.sessions.find((s) => s.id === STRANGER_SUB_SESSION_ID);
      expect(sessionRow).toBeDefined();
      sessionRow!.privacy = 'private';

      // Registry entry still exists (prune did NOT run) — pin the
      // race precondition.
      const afterFlip = app.wsSubscriptions.connectionsForSession(STRANGER_SUB_SESSION_ID);
      expect(afterFlip).toContain(connectionId);

      // Racing catch-up envelope. Gate-1 (subscribe-before-act)
      // passes because the registry entry persists; gate-2
      // (visibility re-check) fires because canSeeSession now
      // returns false for this non-host non-participant on a
      // private session.
      ws.send(catchUpFrame(CATCH_MSG_ID, STRANGER_SUB_SESSION_ID, 0));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.type).toBe('error');
      expect(err.parsed.inResponseTo).toBe(CATCH_MSG_ID);
      expect(payload.code).toBe('not-found');
      expect(typeof payload.message).toBe('string');

      // Per-frame logical errors leave the connection open — pinned
      // explicitly so a future regression that closes the socket on
      // gate-2 fails this test.
      expect(ws.readyState).toBe(1);
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY (G-002): former participant (left_at set) on a private session is still admitted (pins once-a-participant rule)', async () => {
    // Pin the complementary half of G-002: the visibility predicate's
    // participant EXISTS clause has NO `left_at IS NULL` filter, so a
    // user who joined and then left a private session is still
    // visible at catch-up time. The rule is documented in
    // apps/server/src/sessions/visibility.ts:12-19 ("once you've seen
    // a session you've seen it"). This test pins the methodology
    // decision — a future regression that tightens the predicate to
    // current-participants-only (intuitively reasonable, but a
    // security-model change that would silently break audience-replay
    // for past participants) fails this test.
    //
    // Setup: FORMER_PARTICIPANT_SESSION_ID is private, hosted by
    // OTHER_HOST_ID. FIXTURE_USER_ID has a participants row with
    // `left_at: t(5)` (left), so they are NOT a current participant.
    // The test uses the forcibly-subscribe shortcut (same pattern as
    // the not-found gate test above) to install the registry entry
    // without going through the subscribe handler — keeping the focus
    // on the catch-up surface; subscribe-handler coverage of the
    // participant case lives in subscribe.test.ts.
    //
    // The fixture session has zero events; `MAX(sequence) = 0`,
    // `sinceSequence = 0`, so the handler reaches the no-op-at-head
    // branch and emits a single `caught-up` ack with `eventCount: 0`,
    // `throughSequence: 0`, `fromSnapshot: false`. The ack is
    // sufficient evidence that gate-2 admitted the request.
    //
    // Refinement: tasks/refinements/backend-hardening/catch_up_revoked_visibility_pin.md.
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly install the registry entry — the production
      // subscribe handler would also admit (the participant rule
      // applies there too), but bypassing it keeps the test focused
      // on the catch-up surface.
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, FORMER_PARTICIPANT_SESSION_ID);

      // Pre-condition: the participant row exists with left_at set,
      // and the user is NOT host. So the predicate admits via the
      // participant EXISTS branch, not the host or public branches.
      const sessionRow = built.store.sessions.find((s) => s.id === FORMER_PARTICIPANT_SESSION_ID);
      expect(sessionRow?.privacy).toBe('private');
      expect(sessionRow?.host_user_id).toBe(OTHER_HOST_ID);
      const participantRow = built.store.participants.find(
        (p) => p.session_id === FORMER_PARTICIPANT_SESSION_ID && p.user_id === FIXTURE_USER_ID,
      );
      expect(participantRow).toBeDefined();
      expect(participantRow!.left_at).not.toBeNull();

      ws.send(catchUpFrame(CATCH_MSG_ID, FORMER_PARTICIPANT_SESSION_ID, 0));

      const drained = await drainUntilCaughtUp(next);

      // Gate-2 admitted — no error frame, single caught-up ack.
      expect(drained.eventApplied.length).toBe(0);
      expect(drained.snapshotState).toBeUndefined();
      expect(drained.caughtUp).toBeDefined();
      const ackPayload = drained.caughtUp!.payload as {
        sessionId?: unknown;
        throughSequence?: unknown;
        eventCount?: unknown;
        fromSnapshot?: unknown;
      };
      expect(drained.caughtUp!.inResponseTo).toBe(CATCH_MSG_ID);
      expect(ackPayload.sessionId).toBe(FORMER_PARTICIPANT_SESSION_ID);
      expect(ackPayload.throughSequence).toBe(0);
      expect(ackPayload.eventCount).toBe(0);
      expect(ackPayload.fromSnapshot).toBe(false);

      // Connection stays open across the success path too — pinned
      // for symmetry with Scenario A.
      expect(ws.readyState).toBe(1);
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

      // Per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`
      // D7 — case-2 follows `snapshot-state` with one `proposal-status`
      // seed envelope per `(pending proposal × facet target)` on the
      // requesting connection. The seeded fixture has one pending
      // classify-node, so exactly one seed envelope arrives, carrying
      // the new explicit `entityKind` + `entityId` fields per D1.
      expect(drained.proposalStatus.length).toBe(1);
      const seedPayload = drained.proposalStatus[0]!.payload as {
        sessionId?: unknown;
        proposalId?: unknown;
        entityKind?: unknown;
        entityId?: unknown;
        perFacetStatus?: Record<string, unknown>;
      };
      expect(seedPayload.sessionId).toBe(SEEDED_SESSION_ID);
      expect(seedPayload.proposalId).toBe(PROPOSAL_EVENT_ID);
      expect(seedPayload.entityKind).toBe('node');
      expect(seedPayload.perFacetStatus).toMatchObject({ classification: 'proposed' });

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

  it('SECURITY (G-006): wire-boundary rejection of adversarial `sinceSequence` values → `malformed-envelope`', async () => {
    // Pin G-006 (coverage.md): the Zod schema's
    // `sinceSequence: z.number().int().nonnegative()` rejects each
    // boundary value, and the dispatcher surfaces every rejection as
    // a canonical `malformed-envelope` error envelope. The full
    // schema-level vocabulary is exercised in
    // `packages/shared-types/src/ws-envelope.test.ts` (pure-logic
    // layer per ADR 0022); this case pins the WIRE BOUNDARY — that
    // the dispatcher actually reaches the envelope parser and emits
    // the canonical error wire shape for the catch-up surface.
    //
    // The bad values cover negative / fractional / string / null
    // (the JSON image of NaN / Infinity). Iterating all of them on
    // a single connection also verifies the connection stays open
    // across repeated parse failures (a per-frame client bug, not
    // a connection-state problem — pinned by `connection.test.ts`).
    const badLiterals = [
      '-1', // negative
      '0.5', // fractional
      '"0"', // string masquerading as number
      'null', // JSON.stringify(NaN) === 'null'; same for Infinity
      '9007199254740993', // above Number.MAX_SAFE_INTEGER
    ];

    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool);
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Subscribe so the visibility gate is closed — the parse
      // failure happens BEFORE the gate fires, so this is belt-and-
      // suspenders; without it, a future regression that moves the
      // parse downstream of the gate would still surface as a wire
      // error of a different code, and we want this test to fail
      // loudly if that happens.
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      for (const literal of badLiterals) {
        const wire = `{"type":"catch-up","id":"${CATCH_MSG_ID}","payload":{"sessionId":"${SEEDED_SESSION_ID}","sinceSequence":${literal}}}`;
        ws.send(wire);

        const errRaw = await next();
        const err = JSON.parse(errRaw) as {
          type?: unknown;
          inResponseTo?: unknown;
          payload?: { code?: unknown; message?: unknown };
        };
        expect(err.type).toBe('error');
        // The malformed-envelope error has no `inResponseTo` per the
        // canonical contract — the inbound frame's `id` is not
        // trusted because the envelope itself failed validation.
        expect(err.inResponseTo).toBeUndefined();
        expect(err.payload?.code).toBe('malformed-envelope');
        expect(typeof err.payload?.message).toBe('string');
      }

      // Connection stayed open across all five parse failures
      // (per the malformed-envelope contract: per-frame client bug,
      // not connection-fatal).
      expect(ws.readyState).toBe(1);
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

  // F-005 clamp — closes docs/security/m3-review/inputs.md F-005.
  // Refinement: tasks/refinements/backend-hardening/catch_up_event_limit.md.
  it('clamps an env value above MAX_CATCH_UP_EVENTS_CEILING down to the ceiling (F-005)', () => {
    expect(resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: '10000000' })).toBe(
      MAX_CATCH_UP_EVENTS_CEILING,
    );
  });

  it('returns the ceiling exactly when env value equals it', () => {
    expect(
      resolveCatchUpMaxEvents({ [WS_CATCHUP_MAX_EVENTS_ENV]: String(MAX_CATCH_UP_EVENTS_CEILING) }),
    ).toBe(MAX_CATCH_UP_EVENTS_CEILING);
  });

  it('returns an env value below the ceiling verbatim', () => {
    expect(
      resolveCatchUpMaxEvents({
        [WS_CATCHUP_MAX_EVENTS_ENV]: String(MAX_CATCH_UP_EVENTS_CEILING - 1),
      }),
    ).toBe(MAX_CATCH_UP_EVENTS_CEILING - 1);
  });

  it('exports MAX_CATCH_UP_EVENTS_CEILING as 5000', () => {
    expect(MAX_CATCH_UP_EVENTS_CEILING).toBe(5000);
  });
});

// ============================================================
// Pure-logic tests for the rate-limit env resolver.
// Refinement: tasks/refinements/backend-hardening/catch_up_event_limit.md.
// Closes docs/security/m3-review/inputs.md F-004.
// ============================================================

describe('resolveCatchUpRateLimit — env-resolution helper', () => {
  it('returns the default (10) when the env var is absent', () => {
    expect(resolveCatchUpRateLimit({})).toBe(DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE);
  });

  it('returns the default when the env var is empty', () => {
    expect(resolveCatchUpRateLimit({ [WS_CATCH_UP_RATE_LIMIT_ENV]: '' })).toBe(
      DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
    );
  });

  it('parses a positive integer', () => {
    expect(resolveCatchUpRateLimit({ [WS_CATCH_UP_RATE_LIMIT_ENV]: '25' })).toBe(25);
  });

  it('rejects zero and falls back to the default', () => {
    expect(resolveCatchUpRateLimit({ [WS_CATCH_UP_RATE_LIMIT_ENV]: '0' })).toBe(
      DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
    );
  });

  it('rejects negative values and falls back to the default', () => {
    expect(resolveCatchUpRateLimit({ [WS_CATCH_UP_RATE_LIMIT_ENV]: '-5' })).toBe(
      DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
    );
  });

  it('rejects unparseable values and falls back to the default', () => {
    expect(resolveCatchUpRateLimit({ [WS_CATCH_UP_RATE_LIMIT_ENV]: 'not-a-number' })).toBe(
      DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
    );
  });

  it('exports the default as 10', () => {
    expect(DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE).toBe(10);
  });

  it('exports the window-ms constant as 60_000', () => {
    expect(CATCH_UP_RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('exports the typed wire `code` literal', () => {
    expect(WS_TOO_MANY_CATCH_UP_REQUESTS_CODE).toBe('too-many-catch-up-requests');
  });
});

// ============================================================
// Integration tests for the per-connection rate-limit gate.
// Closes docs/security/m3-review/inputs.md F-004.
// Refinement: tasks/refinements/backend-hardening/catch_up_event_limit.md.
//
// Each test stands up a fresh app with a small `catchUpRateLimitPerWindow`
// + an injected clock so the cap can fire deterministically in a
// handful of frames without depending on wall-clock timing.
// ============================================================

describe('ws_reconnection_handling — per-connection rate limit (F-004)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
    __clearAllCatchUpRateStateForTests();
  });

  it('accepts up to the cap within a single window — all envelopes succeed', async () => {
    // Cap = 10 (the production default). Use a frozen clock so every
    // envelope lands inside the same window deterministically.
    // Anchor the mocked clock to real "now" so the auth gate (which
    // also reads `now`) accepts the cookie-signed JWT — both the
    // signer and the verifier read `Date.now`-shaped values, and a
    // fixed past timestamp would make `iat > now` and fail the
    // session-token invariant check.
    let mockNow = Date.now();
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool, {
      catchUpRateLimitPerWindow: DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
      now: () => mockNow,
    });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      for (let i = 0; i < DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE; i++) {
        const msgId = `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`;
        ws.send(catchUpFrame(msgId, SEEDED_SESSION_ID, 5));
        const drained = await drainUntilCaughtUp(next);
        expect(drained.caughtUp).toBeDefined();
        const ackPayload = drained.caughtUp!.payload as {
          throughSequence?: unknown;
          eventCount?: unknown;
        };
        expect(ackPayload.eventCount).toBe(0);
        expect(ackPayload.throughSequence).toBe(5);
        // Drift the clock a few ms per request — well within the
        // 60 s window so every envelope shares the same bucket.
        mockNow += 100;
      }
    } finally {
      ws.terminate();
    }
  });

  it('rejects the (cap + 1)th envelope within the window with a too-many-catch-up-requests wire error', async () => {
    // Tight cap (2) so the assertion fires in three envelopes without
    // a long send/drain loop.
    // Anchor the mocked clock to real "now" so the auth gate (which
    // also reads `now`) accepts the cookie-signed JWT — both the
    // signer and the verifier read `Date.now`-shaped values, and a
    // fixed past timestamp would make `iat > now` and fail the
    // session-token invariant check.
    let mockNow = Date.now();
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool, {
      catchUpRateLimitPerWindow: 2,
      now: () => mockNow,
    });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First two envelopes succeed (cap = 2).
      for (let i = 0; i < 2; i++) {
        const msgId = `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`;
        ws.send(catchUpFrame(msgId, SEEDED_SESSION_ID, 5));
        const drained = await drainUntilCaughtUp(next);
        expect(drained.caughtUp).toBeDefined();
        mockNow += 100;
      }

      // Third envelope (the cap + 1th) is rejected. Clock has only
      // advanced ~200 ms, well inside the 60 s window.
      const overCapMsgId = '44444444-4444-4444-8444-000000000003';
      ws.send(catchUpFrame(overCapMsgId, SEEDED_SESSION_ID, 5));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(overCapMsgId);
      expect(payload.code).toBe(WS_TOO_MANY_CATCH_UP_REQUESTS_CODE);
      expect(typeof payload.message).toBe('string');
    } finally {
      ws.terminate();
    }
  });

  it('resets the window after CATCH_UP_RATE_LIMIT_WINDOW_MS passes — new envelopes succeed', async () => {
    // Anchor the mocked clock to real "now" so the auth gate (which
    // also reads `now`) accepts the cookie-signed JWT — both the
    // signer and the verifier read `Date.now`-shaped values, and a
    // fixed past timestamp would make `iat > now` and fail the
    // session-token invariant check.
    let mockNow = Date.now();
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool, {
      catchUpRateLimitPerWindow: 1,
      now: () => mockNow,
    });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First envelope succeeds.
      const firstMsgId = '55555555-5555-4555-8555-000000000001';
      ws.send(catchUpFrame(firstMsgId, SEEDED_SESSION_ID, 5));
      const firstDrain = await drainUntilCaughtUp(next);
      expect(firstDrain.caughtUp).toBeDefined();

      // Second envelope in the same window is rejected (cap = 1).
      const secondMsgId = '55555555-5555-4555-8555-000000000002';
      ws.send(catchUpFrame(secondMsgId, SEEDED_SESSION_ID, 5));
      const rejected = await readUntilType(next, 'error');
      expect((rejected.parsed.payload as { code?: unknown }).code).toBe(
        WS_TOO_MANY_CATCH_UP_REQUESTS_CODE,
      );

      // Advance the clock past the window. A fresh envelope starts a
      // new window and succeeds.
      mockNow += CATCH_UP_RATE_LIMIT_WINDOW_MS + 1;
      const thirdMsgId = '55555555-5555-4555-8555-000000000003';
      ws.send(catchUpFrame(thirdMsgId, SEEDED_SESSION_ID, 5));
      const thirdDrain = await drainUntilCaughtUp(next);
      expect(thirdDrain.caughtUp).toBeDefined();
      const ackPayload = thirdDrain.caughtUp!.payload as {
        throughSequence?: unknown;
        eventCount?: unknown;
      };
      expect(ackPayload.eventCount).toBe(0);
      expect(ackPayload.throughSequence).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('stays open after a rate-limit reject — the connection can still receive subsequent frames', async () => {
    // Anchor the mocked clock to real "now" so the auth gate (which
    // also reads `now`) accepts the cookie-signed JWT — both the
    // signer and the verifier read `Date.now`-shaped values, and a
    // fixed past timestamp would make `iat > now` and fail the
    // session-token invariant check.
    let mockNow = Date.now();
    const built = makeCatchUpPool();
    app = await buildHandlerApp(built.pool, {
      catchUpRateLimitPerWindow: 1,
      now: () => mockNow,
    });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // First envelope succeeds (consumes the cap).
      const okMsgId = '66666666-6666-4666-8666-000000000001';
      ws.send(catchUpFrame(okMsgId, SEEDED_SESSION_ID, 5));
      await drainUntilCaughtUp(next);

      // Second envelope hits the cap.
      const rejectedMsgId = '66666666-6666-4666-8666-000000000002';
      ws.send(catchUpFrame(rejectedMsgId, SEEDED_SESSION_ID, 5));
      const err = await readUntilType(next, 'error');
      expect((err.parsed.payload as { code?: unknown }).code).toBe(
        WS_TOO_MANY_CATCH_UP_REQUESTS_CODE,
      );

      // Advance past the window — same socket, fresh envelope, no
      // reconnect needed (asserts the connection-stays-open rule).
      mockNow += CATCH_UP_RATE_LIMIT_WINDOW_MS + 1;
      const recoveredMsgId = '66666666-6666-4666-8666-000000000003';
      ws.send(catchUpFrame(recoveredMsgId, SEEDED_SESSION_ID, 5));
      const recovered = await drainUntilCaughtUp(next);
      expect(recovered.caughtUp).toBeDefined();
      expect(recovered.caughtUp!.inResponseTo).toBe(recoveredMsgId);
    } finally {
      ws.terminate();
    }
  });
});

// ============================================================
// Integration tests for the bounded-SELECT (LIMIT) contract.
// Closes docs/security/m3-review/inputs.md F-004.
// Refinement: tasks/refinements/backend-hardening/catch_up_event_limit.md.
//
// Each test asserts that the SQL the handler issues against the test
// pool's mock includes the `LIMIT` clause AND that the per-row count
// returned to the wire is bounded by the configured threshold.
// ============================================================

describe('ws_reconnection_handling — bounded SELECT LIMIT (F-004)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
    __clearAllCatchUpRateStateForTests();
  });

  it('slice-replay SELECT carries `LIMIT $4`; the mock + handler honor it', async () => {
    // Tap the SQL the handler issues so we can assert the LIMIT
    // clause is present in the slice-replay text. The mock returns at
    // most `LIMIT` rows so the handler's wire output is bounded.
    const built = makeCatchUpPool();
    const issuedSql: string[] = [];
    const tapPool: DbPool = {
      query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        issuedSql.push(text);
        return built.pool.query<TRow>(text, params);
      },
    };
    app = await buildHandlerApp(tapPool, { catchUpMaxEvents: 100 });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 2));
      await drainUntilCaughtUp(next);

      // The slice-replay branch ran; one of the tapped SQL strings
      // matches the slice predicate AND carries `LIMIT $4`.
      const sliceSql = issuedSql.find(
        (s) =>
          s.includes('WHERE session_id = $1 AND sequence > $2 AND sequence <= $3') &&
          s.includes('ORDER BY sequence ASC'),
      );
      expect(sliceSql).toBeDefined();
      expect(sliceSql).toMatch(/LIMIT \$4/);
    } finally {
      ws.terminate();
    }
  });

  it('snapshot-fallback SELECT carries `LIMIT $2`; the mock + handler honor it', async () => {
    const built = makeCatchUpPool();
    const issuedSql: string[] = [];
    const tapPool: DbPool = {
      query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        issuedSql.push(text);
        return built.pool.query<TRow>(text, params);
      },
    };
    // Threshold = 2 forces the snapshot-fallback branch on a sinceSequence=0 catch-up
    // (5 - 0 = 5 > 2).
    app = await buildHandlerApp(tapPool, { catchUpMaxEvents: 2 });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 0));
      await drainUntilCaughtUp(next);

      // The snapshot branch's SELECT (full event-log read, no
      // `sequence >` predicate) appears in the tapped SQL AND carries
      // `LIMIT $2`. We discriminate from the MAX(sequence) read by
      // looking for the explicit column list. The slice predicate
      // must NOT appear (snapshot branch is mutually exclusive with
      // the slice branch).
      const snapshotSql = issuedSql.find(
        (s) =>
          s.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
          s.includes('FROM session_events') &&
          s.includes('WHERE session_id = $1') &&
          !s.includes('AND sequence >'),
      );
      expect(snapshotSql).toBeDefined();
      expect(snapshotSql).toMatch(/LIMIT \$2/);
    } finally {
      ws.terminate();
    }
  });

  it('snapshot-fallback LIMIT param is `MAX_CATCH_UP_EVENTS_CEILING`, not the slice threshold', async () => {
    // The snapshot SELECT's LIMIT is decoupled from `threshold`: the
    // threshold drives slice-vs-snapshot branching, but the snapshot
    // SELECT is bounded by the hard ceiling so a session that fits
    // under the ceiling gets a FULL snapshot regardless of the
    // (potentially tiny) test-injected threshold. Verify by tapping
    // the SQL params: the snapshot SELECT's $2 param is the ceiling.
    const built = makeCatchUpPool();
    const issuedQueries: Array<{ text: string; params: ReadonlyArray<unknown> }> = [];
    const tapPool: DbPool = {
      query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        issuedQueries.push({ text, params: params ?? [] });
        return built.pool.query<TRow>(text, params);
      },
    };
    app = await buildHandlerApp(tapPool, { catchUpMaxEvents: 2 });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 0));
      const drained = await drainUntilCaughtUp(next);
      expect(drained.snapshotState).toBeDefined();

      const snapshotQuery = issuedQueries.find(
        (q) =>
          q.text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
          q.text.includes('FROM session_events') &&
          q.text.includes('WHERE session_id = $1') &&
          !q.text.includes('AND sequence >'),
      );
      expect(snapshotQuery).toBeDefined();
      // LIMIT param is the ceiling, NOT the threshold (2). This is
      // the F-004 + F-005 invariant: the snapshot is bounded by the
      // hard ceiling, not by the per-request threshold.
      expect(snapshotQuery!.params[1]).toBe(MAX_CATCH_UP_EVENTS_CEILING);
    } finally {
      ws.terminate();
    }
  });

  it('builder clamps a too-large `maxCatchUpEvents` option to MAX_CATCH_UP_EVENTS_CEILING', async () => {
    // Passing a huge value directly (bypassing `resolveCatchUpMaxEvents`)
    // must not let the slice-replay LIMIT escape the ceiling. Tap the
    // issued SQL + params and assert the slice-replay LIMIT param is
    // the ceiling.
    const built = makeCatchUpPool();
    const issuedQueries: Array<{ text: string; params: ReadonlyArray<unknown> }> = [];
    const tapPool: DbPool = {
      query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        issuedQueries.push({ text, params: params ?? [] });
        return built.pool.query<TRow>(text, params);
      },
    };
    app = await buildHandlerApp(tapPool, {
      catchUpMaxEvents: MAX_CATCH_UP_EVENTS_CEILING * 10,
    });
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(catchUpFrame(CATCH_MSG_ID, SEEDED_SESSION_ID, 2));
      await drainUntilCaughtUp(next);

      // Find the slice SELECT; its LIMIT param ($4 → params[3]) must
      // be the ceiling, not the huge passed-in value.
      const slice = issuedQueries.find(
        (q) =>
          q.text.includes('WHERE session_id = $1 AND sequence > $2 AND sequence <= $3') &&
          q.text.includes('LIMIT $4'),
      );
      expect(slice).toBeDefined();
      expect(slice!.params[3]).toBe(MAX_CATCH_UP_EVENTS_CEILING);
    } finally {
      ws.terminate();
    }
  });
});
