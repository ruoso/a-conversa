// Step definitions for tests/behavior/backend/ws-subscribe.feature.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//
// **What this file owns.** The cucumber-layer regression net for the
// `subscribe` / `unsubscribe` WS handlers — exercises the same wire
// path the unit tests in `apps/server/src/ws/handlers/subscribe.test.ts`
// cover, against the real migrated `sessions` table via pglite.
//
// **Why this file does NOT build a new test app.** The auth-gated WS
// app + the session cookie are owned by `backend-ws-auth.steps.ts`'s
// Given steps (`a ws-auth-gated server is built against the pglite-
// backed pool` + `the cucumber world has a valid session cookie for
// that user`). The `When an authenticated WebSocket client connects to
// {string}` step that drives the upgrade is owned by
// `backend-ws-connection.steps.ts`. This file adds only the
// subscribe-specific verbs (send a subscribe / unsubscribe envelope,
// assert the ack arrives or doesn't) and a helper Given for seeding a
// session row whose id the scenario references directly.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { AConversaWorld, QueryResult } from '../support/world.js';

// Minimal structural typing for the WS client surface we touch. Same
// shape as `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts`
// — avoids dragging `ws`-library types across the workspace boundary.
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface WsSubscribeScratch {
  // Carriers shared with `backend-ws-connection.steps.ts` /
  // `backend-ws-auth.steps.ts`. The connect step populates
  // `wsLifecycleClient` (the ws client); this file reads it and writes
  // its own `wsSubscribeAck` / `wsSubscribeMessageId` carriers.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsSubscribeMessageId?: string;
  wsUnsubscribeMessageId?: string;
  wsSubscribeAckFrame?: string;
  wsUnsubscribeAckFrame?: string;
  wsSubscribeNoAck?: boolean;
}

function scratch(world: AConversaWorld): WsSubscribeScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WsSubscribeScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function getClient(world: AConversaWorld): WsClient {
  const ws = scratch(world).wsLifecycleClient;
  assert.ok(
    ws,
    'no ws client — the `an authenticated WebSocket client connects to "/ws"` When step must precede',
  );
  return ws;
}

// ============================================================
// Givens — seed a session row whose id the scenario references.
// Distinct from the existing `a public session with topic "X" exists
// for user "Y"` Given (which generates a random id and then queries
// `ORDER BY created_at DESC LIMIT 1` from the next step) because the
// subscribe envelope carries the session id explicitly — we want a
// stable id the scenario controls.
// ============================================================

Given(
  'a public session owned by {string} exists with id {string}',
  async function (this: AConversaWorld, hostScreenName: string, sessionId: string) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      hostScreenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${hostScreenName}`);
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Subscribe test (${hostScreenName})`],
    );
  },
);

Given(
  'a private session owned by {string} exists with id {string}',
  async function (this: AConversaWorld, hostScreenName: string, sessionId: string) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      hostScreenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${hostScreenName}`);
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'private', $3)`,
      [sessionId, hostId, `Subscribe test private (${hostScreenName})`],
    );
  },
);

// ============================================================
// Whens — send subscribe / unsubscribe envelopes on the open client.
// The connect step from `backend-ws-connection.steps.ts` has already
// run; it pre-attached the `message` listener via `onInit` and the
// hello frame has been consumed into `wsLifecycleFirstFrame`. Each
// send below installs its own one-shot ack listener that captures the
// NEXT message arriving on the socket — that's the ack we expect.
// ============================================================

When(
  'the client sends a subscribe envelope for session {string}',
  async function (this: AConversaWorld, sessionId: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsSubscribeMessageId = messageId;

    // Install a one-shot listener for the ack BEFORE the send so we
    // don't race the message-receive surface. The connect step's
    // `onInit` listener also fires for every message — we only need
    // ONE more listener that captures the NEXT frame and resolves the
    // promise. The frame-buffer carrier `wsLifecycleFirstFrame` already
    // holds the hello envelope; we capture the ack into our own carrier.
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
    if (ack !== null) {
      s.wsSubscribeAckFrame = ack;
    } else {
      s.wsSubscribeNoAck = true;
    }
  },
);

When(
  'the client sends an unsubscribe envelope for session {string}',
  async function (this: AConversaWorld, sessionId: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsUnsubscribeMessageId = messageId;

    const ackPromise = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 500);
      ws.on('message', (data: unknown) => {
        clearTimeout(timer);
        resolve(toUtf8(data));
      });
    });

    ws.send(
      JSON.stringify({
        type: 'unsubscribe',
        id: messageId,
        payload: { sessionId },
      }),
    );

    const ack = await ackPromise;
    assert.ok(ack, 'expected an unsubscribed ack but none arrived');
    s.wsUnsubscribeAckFrame = ack;
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a subscribed ack referencing the subscribe envelope',
  function (this: AConversaWorld) {
    const s = scratch(this);
    const frame = s.wsSubscribeAckFrame;
    assert.ok(frame, 'no subscribed ack captured');
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { sessionId?: unknown };
    };
    assert.equal(
      parsed.type,
      'subscribed',
      `expected type "subscribed", got ${JSON.stringify(parsed.type)}`,
    );
    assert.equal(
      parsed.inResponseTo,
      s.wsSubscribeMessageId,
      `expected inResponseTo to match the subscribe envelope's id (${s.wsSubscribeMessageId}), got ${JSON.stringify(parsed.inResponseTo)}`,
    );
    assert.ok(
      typeof parsed.payload?.sessionId === 'string',
      'expected payload.sessionId to be a string',
    );
  },
);

Then(
  'the client receives an unsubscribed ack referencing the unsubscribe envelope',
  function (this: AConversaWorld) {
    const s = scratch(this);
    const frame = s.wsUnsubscribeAckFrame;
    assert.ok(frame, 'no unsubscribed ack captured');
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { sessionId?: unknown };
    };
    assert.equal(
      parsed.type,
      'unsubscribed',
      `expected type "unsubscribed", got ${JSON.stringify(parsed.type)}`,
    );
    assert.equal(
      parsed.inResponseTo,
      s.wsUnsubscribeMessageId,
      `expected inResponseTo to match the unsubscribe envelope's id (${s.wsUnsubscribeMessageId}), got ${JSON.stringify(parsed.inResponseTo)}`,
    );
    assert.ok(
      typeof parsed.payload?.sessionId === 'string',
      'expected payload.sessionId to be a string',
    );
  },
);

Then(
  'the client receives no subscribed ack within 200ms and the connection stays open',
  function (this: AConversaWorld) {
    // Placeholder error-path assertion. The handler logs + drops today;
    // `ws_error_message` will replace this with a typed error envelope
    // and this Then will switch to asserting the error envelope's shape.
    const s = scratch(this);
    assert.equal(s.wsSubscribeNoAck, true, 'expected no subscribed ack to arrive but one did');
    const ws = getClient(this);
    // 1 = OPEN per the `ws` library's readyState enum.
    assert.equal(ws.readyState, 1, `expected WS readyState=1 (OPEN), got ${ws.readyState}`);
  },
);

// ============================================================
// Teardown — only the per-feature carriers; the lifecycle client + the
// auth app are torn down by `backend-ws-connection.steps.ts` /
// `backend-ws-auth.steps.ts` (idempotent across step files).
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsSubscribeMessageId;
  delete s.wsUnsubscribeMessageId;
  delete s.wsSubscribeAckFrame;
  delete s.wsUnsubscribeAckFrame;
  delete s.wsSubscribeNoAck;
});
