// Step definitions for tests/behavior/backend/ws-event-broadcast.feature.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **What this file owns.** The cucumber-layer regression net for the
// `event-applied` broadcast surface — exercises the full WS upgrade →
// subscribe → bus emit → fan-out → client receive path through the
// real `__buildTestWsApp` instance against pglite.
//
// **Why we lean on the existing `wsAuthApp` + `wsLifecycleClient`
// scratch keys.** The auth-gated app is built by
// `backend-ws-auth.steps.ts`'s Given step; the first client is opened
// by `backend-ws-connection.steps.ts`'s `an authenticated WebSocket
// client connects to {string}` When step; the subscribe envelope is
// sent by `backend-ws-subscribe.steps.ts`'s When step. This file only
// adds:
//
//   1. The "second authenticated WebSocket client connects to ..."
//      step (a sibling of the first-client connect step, separate
//      scratch carrier).
//   2. The "second client sends a subscribe envelope" step.
//   3. The bus-emit step ("the server emits an event-applied
//      broadcast for session {string} with sequence {int}").
//   4. The receive-side Then steps.
//
// The bus-emit step reaches for `wsAuthApp.wsBroadcast.emit(...)`
// directly — this simulates what the production routes do AFTER a
// `session_events` INSERT commits (the post-commit-emit invariant).
// Routes' end-to-end behavior is covered separately via the existing
// `routes.test.ts` Vitest suite and the session-management cucumber
// features; this file is specifically about the broadcast wire path.
//
// **Frame capture vs. one-shot listeners.** The existing WS step files
// pre-attach a one-shot listener via `onInit` to capture the canonical
// hello envelope, and each subscribe / unsubscribe step adds another
// one-shot listener for its ack. Broadcasts are a stream — multiple
// frames can arrive per scenario — so this file attaches a streaming
// listener to each client's underlying `on('message')` channel that
// pushes every frame into a per-client queue. The Then steps drain
// the queue.

import { After, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { AConversaWorld, QueryResult } from '../support/world.js';
import type { Event } from '../../../packages/shared-types/src/events.js';

interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

// The Fastify-instance subset we touch — `injectWS` for the second
// client and `wsBroadcast` for the bus emit. Typed structurally to
// avoid dragging the workspace-local `FastifyInstance` and
// `WsBroadcastBus` types across the cucumber boundary; the actual
// instance reaches us via the shared `wsAuthApp` scratch key from
// `backend-ws-auth.steps.ts`.
interface FastifyLike {
  injectWS(
    path?: string,
    upgradeContext?: { headers?: Record<string, string> },
    options?: { onInit?: (ws: WsClient) => void },
  ): Promise<WsClient>;
  close(): Promise<void>;
  wsBroadcast: { emit(evt: { event: Event }): void };
}

interface BroadcastScratch {
  // Read from `backend-ws-auth.steps.ts` (built by the Given step
  // shared with that file).
  wsAuthApp?: FastifyLike;
  wsAuthCookie?: string;
  // Read from `backend-ws-connection.steps.ts` (built by the
  // "authenticated WebSocket client connects to ..." When step).
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsBroadcastFrames?: string[];
  wsBroadcastFramesSecond?: string[];
  wsBroadcastSecondClient?: WsClient;
}

function scratch(world: AConversaWorld): BroadcastScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as BroadcastScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function getApp(world: AConversaWorld): FastifyLike {
  const app = scratch(world).wsAuthApp;
  assert.ok(app, 'WS auth app not initialized — Given step missing');
  return app;
}

function getCookie(world: AConversaWorld): string {
  const cookie = scratch(world).wsAuthCookie;
  assert.ok(cookie, 'WS auth cookie not initialized — Given step missing');
  return cookie;
}

function getFirstClient(world: AConversaWorld): WsClient {
  const ws = scratch(world).wsLifecycleClient;
  assert.ok(ws, 'no ws client — the connect When step must precede');
  return ws;
}

function ensureFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsBroadcastFrames === undefined) {
    s.wsBroadcastFrames = [];
    // Attach a streaming message listener to the first client. Every
    // frame arriving from now on is pushed into the queue; the Then
    // step waits for an event-applied frame to land.
    const ws = getFirstClient(world);
    ws.on('message', (data: unknown) => {
      s.wsBroadcastFrames?.push(toUtf8(data));
    });
  }
  return s.wsBroadcastFrames;
}

function ensureSecondFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsBroadcastFramesSecond === undefined) {
    s.wsBroadcastFramesSecond = [];
  }
  return s.wsBroadcastFramesSecond;
}

async function waitForEventApplied(
  queue: string[],
  expectedSequence: number,
  timeoutMs = 1000,
): Promise<{
  type?: unknown;
  payload?: { event?: { sequence?: unknown; sessionId?: unknown } };
} | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = 0; i < queue.length; i++) {
      const frame = queue[i]!;
      let parsed: {
        type?: unknown;
        payload?: { event?: { sequence?: unknown; sessionId?: unknown } };
      };
      try {
        parsed = JSON.parse(frame) as {
          type?: unknown;
          payload?: { event?: { sequence?: unknown; sessionId?: unknown } };
        };
      } catch {
        continue;
      }
      if (parsed.type === 'event-applied' && parsed.payload?.event?.sequence === expectedSequence) {
        // Drain matched frame from the queue so subsequent assertions
        // don't re-match the same frame.
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
// Whens
// ============================================================

When(
  'a second authenticated WebSocket client connects to {string}',
  async function (this: AConversaWorld, path: string) {
    const s = scratch(this);
    const app = getApp(this);
    const cookie = getCookie(this);
    const frames: string[] = [];
    s.wsBroadcastFramesSecond = frames;

    let firstFrameResolve: ((value: string) => void) | null = null;
    const firstFrame = new Promise<string>((resolve) => {
      firstFrameResolve = resolve;
    });

    const ws = await app.injectWS(
      path,
      { headers: { cookie } },
      {
        onInit(client: WsClient) {
          client.on('message', (data: unknown) => {
            const text = toUtf8(data);
            if (firstFrameResolve) {
              const fn = firstFrameResolve;
              firstFrameResolve = null;
              fn(text);
              return;
            }
            frames.push(text);
          });
        },
      },
    );
    s.wsBroadcastSecondClient = ws;

    // Drain the hello envelope before letting the When step resolve.
    await Promise.race([
      firstFrame,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('second-client hello timeout')), 500),
      ),
    ]);
  },
);

When(
  'the second client sends a subscribe envelope for session {string}',
  async function (this: AConversaWorld, sessionId: string) {
    const s = scratch(this);
    const ws = s.wsBroadcastSecondClient;
    assert.ok(ws, 'second client not opened');
    const messageId = randomUUID();

    // One-shot ack listener — captures the next frame, then frames
    // flow back into the streaming queue (re-attached after).
    const ackPromise = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 500);
      ws.on('message', (data: unknown) => {
        clearTimeout(timer);
        resolve(toUtf8(data));
      });
    });

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        id: messageId,
        payload: { sessionId },
      }),
    );

    const ack = await ackPromise;
    assert.ok(ack, 'second client did not receive subscribed ack');
    // Re-attach the streaming listener for the broadcast frames.
    ws.on('message', (data: unknown) => {
      s.wsBroadcastFramesSecond?.push(toUtf8(data));
    });
  },
);

When(
  'the server emits an event-applied broadcast for session {string} with sequence {int}',
  async function (this: AConversaWorld, sessionId: string, sequence: number) {
    // Ensure the streaming listener is attached to the first client
    // BEFORE the emit so the broadcast frame isn't dropped.
    ensureFramesQueue(this);
    ensureSecondFramesQueue(this);

    const app = getApp(this);
    const hostUserId = await lookupUserId(this, 'alice-ws');
    // Build a minimal `session-created` event — shape is owned by
    // `packages/shared-types/src/events.ts`. The exact field values
    // don't drive assertions; only the envelope shape (type,
    // sequence, sessionId) matters for the receive-side Then steps.
    const event: Event = {
      id: randomUUID(),
      sessionId,
      sequence,
      kind: 'session-created',
      actor: hostUserId,
      payload: {
        host_user_id: hostUserId,
        privacy: 'public',
        topic: `broadcast cucumber ${sequence}`,
        created_at: '2026-05-11T12:00:00.000Z',
      },
      createdAt: '2026-05-11T12:00:00.001Z',
    };
    app.wsBroadcast.emit({ event });
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives an event-applied envelope for sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    const queue = ensureFramesQueue(this);
    const parsed = await waitForEventApplied(queue, sequence);
    assert.ok(
      parsed,
      `did not receive event-applied envelope for sequence ${sequence} within timeout`,
    );
    assert.equal(parsed.type, 'event-applied');
    assert.equal(parsed.payload?.event?.sequence, sequence);
  },
);

Then(
  'the client receives event-applied envelopes with sequences {int} then {int}',
  async function (this: AConversaWorld, seq1: number, seq2: number) {
    const queue = ensureFramesQueue(this);
    const first = await waitForEventApplied(queue, seq1);
    assert.ok(first, `expected event-applied for sequence ${seq1}`);
    const second = await waitForEventApplied(queue, seq2);
    assert.ok(second, `expected event-applied for sequence ${seq2}`);
  },
);

Then(
  'the second client receives event-applied envelopes with sequences {int} then {int}',
  async function (this: AConversaWorld, seq1: number, seq2: number) {
    const queue = ensureSecondFramesQueue(this);
    const first = await waitForEventApplied(queue, seq1);
    assert.ok(first, `expected event-applied for sequence ${seq1} on second client`);
    const second = await waitForEventApplied(queue, seq2);
    assert.ok(second, `expected event-applied for sequence ${seq2} on second client`);
  },
);

Then(
  'the client receives no event-applied envelope within {int}ms',
  async function (this: AConversaWorld, timeoutMs: number) {
    const queue = ensureFramesQueue(this);
    // Drain anything until the deadline; assert nothing event-applied
    // shows up in the queue.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of queue) {
        let parsed: { type?: unknown };
        try {
          parsed = JSON.parse(frame) as { type?: unknown };
        } catch {
          continue;
        }
        assert.notEqual(
          parsed.type,
          'event-applied',
          `did not expect an event-applied envelope; got ${frame}`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  },
);

// ============================================================
// Teardown
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  const second = s.wsBroadcastSecondClient;
  if (second) {
    try {
      if (second.readyState !== 3) {
        second.terminate();
      }
    } catch {
      // Defensive — terminate on a torn-down socket can throw.
    }
    delete s.wsBroadcastSecondClient;
  }
  delete s.wsBroadcastFrames;
  delete s.wsBroadcastFramesSecond;
});
