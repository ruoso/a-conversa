// @vitest-environment node
//
// Vitest integration test for `ws_event_broadcast` — drives the FULL
// path: WS upgrade via `__buildTestWsApp` → subscribe → emit on
// `app.wsBroadcast` → broadcast subscriber fans out → the WS client
// receives the `event-applied` envelope.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **What this file covers.** The pure-logic surface is exercised by
// `bus.test.ts` and `event-applied.test.ts`. This file pins the wire-
// path integration: a subscribed connection actually receives the
// envelope-shaped `event-applied` frame across the in-memory duplex
// stream `app.injectWS` provides.
//
// Drives the same test-app builder the subscribe-handler tests use
// (`__buildTestWsApp`) so the broadcast surface under test is
// bit-identical to the rest of the WS substream.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

import type { Event } from '@a-conversa/shared-types';

const SESSION_ID = '00000000-0000-4000-8000-0000000000f1';

// Memory pool answering the auth-middleware SELECT AND the
// `canSeeSession` SELECT — same shape `handlers/subscribe.test.ts`
// uses; the fixture user hosts a public session, which `canSeeSession`
// accepts.
function makePool(): DbPool {
  return {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];

      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        if (id === FIXTURE_USER_ID) {
          return Promise.resolve({
            rows: [{ id: FIXTURE_USER_ID, screen_name: FIXTURE_SCREEN_NAME }] as unknown as TRow[],
          });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (
        text.trim().startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'") &&
        text.includes('host_user_id = $2') &&
        text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        if (sessionId === SESSION_ID) {
          return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in broadcast-integration pool: ${text}`));
    },
  };
}

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

function buildEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-0000000000${sequence.toString().padStart(2, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'session-created',
    actor: FIXTURE_USER_ID,
    payload: {
      host_user_id: FIXTURE_USER_ID,
      privacy: 'public',
      topic: `integration ${sequence}`,
      created_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

describe('ws_event_broadcast — wire-path integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await __buildTestWsApp({
      pool: makePool(),
      sessionTokenSecret: TEST_SESSION_SECRET,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('subscribed client receives event-applied envelopes for the session in sequence order', async () => {
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const cookie = `${SESSION_COOKIE_NAME}=${token}`;
    const { ws, next } = await openWsClient(app, cookie);
    try {
      // Drain the hello envelope.
      const helloRaw = await next();
      expect((JSON.parse(helloRaw) as { type?: unknown }).type).toBe('hello');

      // Subscribe to the visible session.
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          id: '11111111-1111-4111-8111-111111111111',
          payload: { sessionId: SESSION_ID },
        }),
      );
      const subAckRaw = await next();
      expect((JSON.parse(subAckRaw) as { type?: unknown }).type).toBe('subscribed');

      // Emit three events on the bus in sequence order. The post-
      // commit-emit invariant is "routes call emit after COMMIT";
      // this test simulates that directly on the bus to keep the
      // fan-out wire-path under test without involving routes (the
      // routes' end-to-end coverage lives in the cucumber feature).
      app.wsBroadcast.emit({ event: buildEvent(1) });
      app.wsBroadcast.emit({ event: buildEvent(2) });
      app.wsBroadcast.emit({ event: buildEvent(3) });

      // The subscribed connection receives each broadcast in emit
      // order. The bus dispatches synchronously, the senders call
      // `socket.send` in order, the in-memory duplex stream preserves
      // order — the receiving side observes the same sequence.
      const frames = [await next(), await next(), await next()];
      const parsed = frames.map(
        (f) =>
          JSON.parse(f) as {
            type?: unknown;
            payload?: { event?: { sequence?: unknown } };
          },
      );
      expect(parsed.map((e) => e.type)).toEqual([
        'event-applied',
        'event-applied',
        'event-applied',
      ]);
      expect(parsed.map((e) => e.payload?.event?.sequence)).toEqual([1, 2, 3]);
    } finally {
      ws.terminate();
    }
  });
});
