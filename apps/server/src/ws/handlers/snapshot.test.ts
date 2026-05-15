// @vitest-environment node
//
// Vitest unit tests for the WS `snapshot` handler (Interpretation A —
// state-query catch-up).
//
// Refinement: tasks/refinements/backend/ws_snapshot_message.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_snapshot_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The projection
// layer's per-event derivation is covered separately in
// `projection/replay.test.ts`; this file is the integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire
//      error (existence-non-leak).
//   3. Subscribed + visible (fresh empty session) → `snapshot-state`
//      response with an empty projection. Pins the payload shape.
//   4. Subscribed + visible + seeded events → `snapshot-state`
//      response whose projection reflects the seeded state
//      (participants, nodes, pending proposals, committed
//      proposals).
//   5. NO broadcast emitted. Pins the read-only contract.
//   6. Wire-shape pin for `serializeProjectionForWire`: Maps
//      flattened to plain objects keyed by userId; iterators
//      materialized to arrays.
//
// **Memory pool composition.** The handler issues fewer SQL
// statements than the four write handlers — no `BEGIN`/`COMMIT`/FOR
// UPDATE/MAX(sequence)/INSERT. The shim below recognises:
//
//   - The auth-middleware SELECT (`SELECT id, screen_name FROM users`).
//   - `canSeeSession`'s visibility-gated SELECT 1.
//   - `SELECT ... FROM session_events WHERE session_id = $1 ORDER BY
//     sequence ASC` (the projection-load SELECT).
//
// The shim is local to this file because the snapshot path's SQL
// surface is a subset of the write handlers'; sharing the shim with
// `propose.test.ts` would over-generalise.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';
import { Projection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import type { Event } from '@a-conversa/shared-types';

import { serializeProjectionForWire } from './snapshot.js';

// Stable fixture ids.
const EMPTY_SESSION_ID = '00000000-0000-4000-8000-000000000e01';
const SEEDED_SESSION_ID = '00000000-0000-4000-8000-000000000e02';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000e03';
const NODE_ID = '00000000-0000-4000-8000-000000000e04';
const DEBATER_A_ID = '00000000-0000-4000-8000-000000000e05';
const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000e06';
const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-000000000eb1';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// EMPTY_SESSION_ID is seeded with NO events — the snapshot of this
// session has `lastAppliedSequence=0` and every collection empty.
//
// SEEDED_SESSION_ID has:
//   seq 1: session-created (FIXTURE_USER_ID as host)
//   seq 2: participant-joined (FIXTURE_USER_ID, moderator)
//   seq 3: participant-joined (DEBATER_A_ID, debater-A)
//   seq 4: node-created (NODE_ID)
//   seq 5: proposal (PROPOSAL_EVENT_ID, classify-node on NODE_ID)
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

function makeSnapshotPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      {
        id: EMPTY_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: SEEDED_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
    ],
    events: [
      // SEEDED_SESSION_ID — full participant set + node + proposal so
      // the snapshot has something to render.
      {
        id: '00000000-0000-4000-8000-00000000ea01',
        session_id: SEEDED_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS snapshot test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea02',
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
        id: '00000000-0000-4000-8000-00000000ea03',
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
        id: '00000000-0000-4000-8000-00000000ea04',
        session_id: SEEDED_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim that will appear in the snapshot.',
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

      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in WS snapshot test pool: ${text}`));
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
const SNAP_MSG_ID = '22222222-2222-4222-8222-222222222ee1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function snapshotFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'snapshot', id: messageId, payload: { sessionId } });
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

describe('ws_snapshot_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeSnapshotPool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed snapshot with a `forbidden` wire error', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip the subscribe — go straight to snapshot. The gate fires.
      ws.send(snapshotFrame(SNAP_MSG_ID, SEEDED_SESSION_ID));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(SNAP_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // Sanity: the event store was untouched (snapshot is read-only,
      // but pin it anyway).
      const eventCount = store.events.filter((e) => e.session_id === SEEDED_SESSION_ID).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a snapshot for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly subscribe the connection to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate to isolate
      // the snapshot handler's own visibility re-check (mirrors the
      // commit/vote/mark test approach).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(snapshotFrame(SNAP_MSG_ID, HIDDEN_SESSION_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(SNAP_MSG_ID);
      expect(payload.code).toBe('not-found');
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible (empty session) → `snapshot-state` response with empty projection', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, EMPTY_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(snapshotFrame(SNAP_MSG_ID, EMPTY_SESSION_ID));

      const response = await readUntilType(next, 'snapshot-state');
      expect(response.parsed.inResponseTo).toBe(SNAP_MSG_ID);
      expect(response.parsed.id).toMatch(UUID_V4_PATTERN);

      const payload = response.parsed.payload as {
        sessionId?: unknown;
        sequence?: unknown;
        projection?: Record<string, unknown>;
      };
      expect(payload.sessionId).toBe(EMPTY_SESSION_ID);
      expect(payload.sequence).toBe(0);
      // Empty projection — every collection is an empty array.
      expect(payload.projection?.sessionState).toBe('open');
      expect(payload.projection?.lastAppliedSequence).toBe(0);
      expect(payload.projection?.participants).toEqual([]);
      expect(payload.projection?.nodes).toEqual([]);
      expect(payload.projection?.edges).toEqual([]);
      expect(payload.projection?.annotations).toEqual([]);
      expect(payload.projection?.pendingProposals).toEqual([]);
      expect(payload.projection?.committedProposals).toEqual([]);
      expect(payload.projection?.snapshots).toEqual([]);
      expect(payload.projection?.unresolvedMetaDisagreements).toEqual([]);
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + seeded events → `snapshot-state` response reflects the seeded projection', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(snapshotFrame(SNAP_MSG_ID, SEEDED_SESSION_ID));

      const response = await readUntilType(next, 'snapshot-state');
      expect(response.parsed.inResponseTo).toBe(SNAP_MSG_ID);

      const payload = response.parsed.payload as {
        sessionId?: unknown;
        sequence?: unknown;
        projection?: Record<string, unknown>;
      };
      expect(payload.sessionId).toBe(SEEDED_SESSION_ID);
      // The proposal was sequence 5; that's the highest applied event.
      expect(payload.sequence).toBe(5);
      expect(payload.projection?.lastAppliedSequence).toBe(5);

      // Two current participants — the moderator and one debater.
      const participants = payload.projection?.participants as Array<{
        userId?: unknown;
        role?: unknown;
      }>;
      expect(Array.isArray(participants)).toBe(true);
      expect(participants.length).toBe(2);
      const userIds = participants.map((p) => p.userId).sort();
      expect(userIds).toEqual([DEBATER_A_ID, FIXTURE_USER_ID].sort());

      // One node — the one created at seq 4.
      const nodes = payload.projection?.nodes as Array<{ id?: unknown; wording?: unknown }>;
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBe(1);
      expect(nodes[0]?.id).toBe(NODE_ID);
      expect(nodes[0]?.wording).toBe('A claim that will appear in the snapshot.');

      // One pending proposal — the classify-node at seq 5.
      const pending = payload.projection?.pendingProposals as Array<{
        proposalEventId?: unknown;
      }>;
      expect(Array.isArray(pending)).toBe(true);
      expect(pending.length).toBe(1);
      expect(pending[0]?.proposalEventId).toBe(PROPOSAL_EVENT_ID);
    } finally {
      ws.terminate();
    }
  });

  it('does NOT emit any broadcast — snapshot is read-only', async () => {
    // Pin the read-only contract. After a subscribe + snapshot, the
    // ONLY frames the client receives are: hello, subscribed,
    // snapshot-state. No `event-applied`, no other clients touched
    // (we can't observe the broadcast bus directly here, but the
    // absence-of-a-fourth-frame pins the same invariant — the bus
    // emit is the only way for the same socket to see an
    // `event-applied` for a fresh action, and there isn't one here).
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      const hello = JSON.parse(await next()) as { type?: unknown };
      expect(hello.type).toBe('hello');

      ws.send(subscribeFrame(SUB_MSG_ID, SEEDED_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(snapshotFrame(SNAP_MSG_ID, SEEDED_SESSION_ID));
      const response = JSON.parse(await next()) as { type?: unknown };
      expect(response.type).toBe('snapshot-state');

      // A spurious frame would race here. Race a short timeout
      // against any further frame; pass if the timeout wins.
      const fourthFrame: string = await Promise.race([
        next(),
        new Promise<string>((resolve) => setTimeout(() => resolve('__timeout__'), 50)),
      ]);
      expect(fourthFrame).toBe('__timeout__');
    } finally {
      ws.terminate();
    }
  });
});

// ============================================================
// Pure-logic tests for `serializeProjectionForWire`. Pins the wire
// shape independently of the handler's I/O — same ADR-0022 layering
// the other handler-files use for their pure helpers.
// ============================================================

describe('serializeProjectionForWire — wire-shape pin', () => {
  it('flattens Maps to plain objects + materializes iterators to arrays', () => {
    const projection = new Projection(SEEDED_SESSION_ID);
    const events: Event[] = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        sessionId: SEEDED_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'shape-pin',
          created_at: '2026-05-11T10:00:00.000Z',
        },
        createdAt: '2026-05-11T10:00:00.000Z',
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        sessionId: SEEDED_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: '2026-05-11T10:00:01.000Z',
        },
        createdAt: '2026-05-11T10:00:01.000Z',
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        sessionId: SEEDED_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A node for the shape-pin test.',
          created_by: FIXTURE_USER_ID,
          created_at: '2026-05-11T10:00:02.000Z',
        },
        createdAt: '2026-05-11T10:00:02.000Z',
      },
    ];
    for (const evt of events) {
      applyEvent(projection, evt);
    }

    const wire = serializeProjectionForWire(projection);

    // Top-level keys are present + JSON-serializable. The whole
    // object survives a stringify → parse round-trip.
    const roundTripped = JSON.parse(JSON.stringify(wire)) as Record<string, unknown>;
    expect(roundTripped.sessionState).toBe('open');
    expect(roundTripped.lastAppliedSequence).toBe(3);
    expect(Array.isArray(roundTripped.participants)).toBe(true);
    expect(Array.isArray(roundTripped.nodes)).toBe(true);
    expect(Array.isArray(roundTripped.edges)).toBe(true);
    expect(Array.isArray(roundTripped.annotations)).toBe(true);
    expect(Array.isArray(roundTripped.pendingProposals)).toBe(true);
    expect(Array.isArray(roundTripped.committedProposals)).toBe(true);
    expect(Array.isArray(roundTripped.snapshots)).toBe(true);
    expect(Array.isArray(roundTripped.unresolvedMetaDisagreements)).toBe(true);

    const nodes = roundTripped.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(1);
    const node = nodes[0]!;
    // Each node's facet states carry the flattened `perParticipant`
    // shape — a plain object keyed by userId. With no vote yet, the
    // object is empty.
    const classificationFacet = node.classificationFacet as Record<string, unknown>;
    expect(classificationFacet.status).toBe('proposed');
    expect(classificationFacet.value).toBeNull();
    expect(classificationFacet.perParticipant).toEqual({});
    // `axiomMarks` is also a flattened object (empty here).
    expect(node.axiomMarks).toEqual({});
  });

  it('flattens FacetState.perParticipant — a userId-keyed plain object — and round-trips through JSON', () => {
    // Build a projection that has a vote, so `perParticipant` is
    // non-empty. The point is to pin the Map → object flattening:
    // a `Map<string, PerParticipantFacetState>` becomes
    // `Record<string, PerParticipantFacetState>` in the wire shape.
    const projection = new Projection(SEEDED_SESSION_ID);
    const baseEvents: Event[] = [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        sessionId: SEEDED_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'flatten-test',
          created_at: '2026-05-11T10:00:00.000Z',
        },
        createdAt: '2026-05-11T10:00:00.000Z',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        sessionId: SEEDED_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: '2026-05-11T10:00:01.000Z',
        },
        createdAt: '2026-05-11T10:00:01.000Z',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
        sessionId: SEEDED_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a',
          joined_at: '2026-05-11T10:00:02.000Z',
        },
        createdAt: '2026-05-11T10:00:02.000Z',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
        sessionId: SEEDED_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A node for the perParticipant flatten test.',
          created_by: FIXTURE_USER_ID,
          created_at: '2026-05-11T10:00:03.000Z',
        },
        createdAt: '2026-05-11T10:00:03.000Z',
      },
      {
        id: PROPOSAL_EVENT_ID,
        sessionId: SEEDED_SESSION_ID,
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
        createdAt: '2026-05-11T10:00:04.000Z',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',
        sessionId: SEEDED_SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          proposal_id: PROPOSAL_EVENT_ID,
          participant: DEBATER_A_ID,
          vote: 'agree',
          voted_at: '2026-05-11T10:00:05.000Z',
        },
        createdAt: '2026-05-11T10:00:05.000Z',
      },
    ];
    for (const evt of baseEvents) {
      applyEvent(projection, evt);
    }

    const wire = serializeProjectionForWire(projection);
    const roundTripped = JSON.parse(JSON.stringify(wire)) as Record<string, unknown>;

    const nodes = roundTripped.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(1);
    const node = nodes[0]!;
    const classificationFacet = node.classificationFacet as Record<string, unknown>;
    // The vote recorded a `perParticipant` entry keyed by the
    // debater's userId.
    const perParticipant = classificationFacet.perParticipant as Record<string, unknown>;
    expect(perParticipant[DEBATER_A_ID]).toBeDefined();
    expect((perParticipant[DEBATER_A_ID] as { vote?: unknown }).vote).toBe('agree');
  });
});
