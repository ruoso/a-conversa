// Step definitions for tests/behavior/backend/ws-error.feature.
//
// Refinement: tasks/refinements/backend/ws_error_message.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_error_message
//
// **What this file owns.** Cucumber-layer regression coverage for the
// canonical server → client `error` envelope landed by
// `ws_error_message`. The error surface has three observable call
// sites:
//
//   1. Dispatcher `onUnknownType` seam — fires when an envelope's
//      `type` IS in the closed `WsMessageType` enum but no handler is
//      registered for it. We exercise this by sending a frame whose
//      `type` is a server-emitted-only value (e.g. `subscribed`) —
//      `parseWsEnvelopeJson` accepts it (closed enum + valid payload),
//      the dispatcher's lookup finds no handler, and `onUnknownType`
//      fires. Wire result: `code: 'unknown-message-type'` +
//      `inResponseTo = envelope.id`.
//
//   2. Connection-level malformed-envelope path — a frame that fails
//      `parseWsEnvelopeJson` (JSON parse fails, OR the envelope
//      schema rejects an unknown `type`, OR the per-`type` payload
//      schema rejects). Wire result: `code: 'malformed-envelope'` and
//      NO `inResponseTo` (no parseable id off the inbound frame). The
//      connection stays open.
//
//   3. Subscribe-handler visibility rejection — a subscribe to a
//      non-visible session. Wire result: `code: 'not-found'` (NOT
//      `forbidden` — the existence-non-leak rule) with `inResponseTo
//      = subscribe envelope's id`.
//
// **Reused steps.** The auth-gated WS app + cookie come from
// `backend-ws-auth.steps.ts`. The connect step comes from
// `backend-ws-connection.steps.ts`. The
// `the client sends a subscribe envelope for session {string}` step
// comes from `backend-ws-subscribe.steps.ts`. The
// `the WebSocket connection is still open` step comes from
// `backend-ws-envelope.steps.ts`. This file adds only the
// error-specific verbs.

import { After, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { AConversaWorld } from '../support/world.js';

// Minimal WS client shape — same approach as the sibling step files.
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface WsErrorScratch {
  // Carriers shared with the sibling files.
  wsLifecycleClient?: WsClient;
  wsSubscribeAckFrame?: string;
  wsSubscribeMessageId?: string;
  // Per-feature carriers — written by the When steps below.
  wsErrorPreviousMessageId?: string;
  wsErrorFrame?: string;
  wsErrorMalformedFrame?: string;
}

function scratch(world: AConversaWorld): WsErrorScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WsErrorScratch;
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

/**
 * Build a syntactically-valid envelope payload for the unknown-type
 * scenario. The dispatcher's `onUnknownType` only fires after
 * `parseWsEnvelopeJson` accepts the frame — meaning the closed-enum
 * `type` check AND the per-`type` payload schema both pass.
 *
 * For server-emitted-only types (`subscribed`, `unsubscribed`) the
 * payload schema requires `{ sessionId: <uuid> }`; for `hello` it's
 * `{ connectionId: <uuid> }`. Other types fall back to an empty
 * object (those types are NOT exercised by the current feature, but
 * the fallback keeps the function total).
 */
function payloadFor(type: string): Record<string, unknown> {
  if (
    type === 'subscribed' ||
    type === 'unsubscribed' ||
    type === 'subscribe' ||
    type === 'unsubscribe'
  ) {
    return { sessionId: '99999999-9999-4999-8999-999999999999' };
  }
  if (type === 'hello') {
    return { connectionId: '99999999-9999-4999-8999-999999999999' };
  }
  return {};
}

// ============================================================
// Whens
// ============================================================

When(
  'the client sends an envelope with type {string}',
  async function (this: AConversaWorld, type: string) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsErrorPreviousMessageId = messageId;

    // One-shot listener captures the next frame (the wire error
    // envelope) into the per-feature carrier.
    const framePromise = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 500);
      ws.on('message', (data: unknown) => {
        clearTimeout(timer);
        resolve(toUtf8(data));
      });
    });

    ws.send(
      JSON.stringify({
        type,
        id: messageId,
        payload: payloadFor(type),
      }),
    );

    const frame = await framePromise;
    if (frame !== null) {
      s.wsErrorFrame = frame;
    }
  },
);

When(
  'the client sends a malformed frame {string} and waits for the error envelope',
  async function (this: AConversaWorld, frame: string) {
    const s = scratch(this);
    const ws = getClient(this);

    // One-shot listener captures the wire error envelope.
    const framePromise = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 500);
      ws.on('message', (data: unknown) => {
        clearTimeout(timer);
        resolve(toUtf8(data));
      });
    });

    ws.send(frame);

    const result = await framePromise;
    if (result !== null) {
      s.wsErrorMalformedFrame = result;
    }
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives an error envelope with code {string} referencing the previous envelope',
  function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const frame = s.wsErrorFrame;
    assert.ok(frame, 'no error envelope captured');
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    assert.equal(
      parsed.type,
      'error',
      `expected envelope type "error", got ${JSON.stringify(parsed.type)}`,
    );
    assert.equal(
      parsed.payload?.code,
      expectedCode,
      `expected payload.code ${JSON.stringify(expectedCode)}, got ${JSON.stringify(parsed.payload?.code)}`,
    );
    assert.equal(
      parsed.inResponseTo,
      s.wsErrorPreviousMessageId,
      `expected inResponseTo to match the previous envelope's id (${s.wsErrorPreviousMessageId}), got ${JSON.stringify(parsed.inResponseTo)}`,
    );
    assert.equal(
      typeof parsed.payload?.message,
      'string',
      'expected payload.message to be a string',
    );
  },
);

Then(
  'the client receives an error envelope with code {string} with no inResponseTo',
  function (this: AConversaWorld, expectedCode: string) {
    const frame = scratch(this).wsErrorMalformedFrame;
    assert.ok(frame, 'no error envelope captured for malformed frame');
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    assert.equal(parsed.type, 'error');
    assert.equal(
      parsed.payload?.code,
      expectedCode,
      `expected payload.code ${JSON.stringify(expectedCode)}, got ${JSON.stringify(parsed.payload?.code)}`,
    );
    assert.equal(
      parsed.inResponseTo,
      undefined,
      `expected inResponseTo to be absent for malformed-envelope, got ${JSON.stringify(parsed.inResponseTo)}`,
    );
    assert.equal(
      typeof parsed.payload?.message,
      'string',
      'expected payload.message to be a string',
    );
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the subscribe envelope',
  function (this: AConversaWorld, expectedCode: string) {
    // The subscribe-When step from `backend-ws-subscribe.steps.ts`
    // captures the next inbound frame into `wsSubscribeAckFrame`. When
    // the visibility check rejects, that frame IS the wire error
    // envelope (per `ws_error_message`'s placeholder replacement).
    const s = scratch(this);
    const frame = s.wsSubscribeAckFrame;
    assert.ok(
      frame,
      'no frame captured after subscribe — the When step might have timed out (check that ws_error_message landed)',
    );
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    assert.equal(parsed.type, 'error');
    assert.equal(
      parsed.payload?.code,
      expectedCode,
      `expected payload.code ${JSON.stringify(expectedCode)}, got ${JSON.stringify(parsed.payload?.code)}`,
    );
    assert.equal(
      parsed.inResponseTo,
      s.wsSubscribeMessageId,
      `expected inResponseTo to match the subscribe envelope's id (${s.wsSubscribeMessageId}), got ${JSON.stringify(parsed.inResponseTo)}`,
    );
    assert.equal(
      typeof parsed.payload?.message,
      'string',
      'expected payload.message to be a string',
    );
  },
);

// ============================================================
// Teardown
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsErrorPreviousMessageId;
  delete s.wsErrorFrame;
  delete s.wsErrorMalformedFrame;
});
