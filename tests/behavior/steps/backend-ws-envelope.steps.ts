// Step definitions for tests/behavior/backend/ws-envelope.feature.
//
// Refinement: tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_message_envelope
//
// **Why this file builds its own app instead of reusing the
// `createServer` Given.** The `ws_auth_on_connect` gate makes auth a
// precondition for `/ws`. Driving the WS surface from cucumber
// requires either:
//   1. Setting up a real users-row + a valid session cookie against a
//      pglite-migrated `users` table (heavyweight for a scenario
//      focused on envelope behavior), or
//   2. Building a minimal WS test app with a memory-backed pool, the
//      auth middleware, and a fixture cookie — the exact pattern
//      `connection.test.ts` Vitest uses.
//
// Option 2 is the right cost/benefit here. The envelope behavior we
// care about is post-auth (the hello frame; the malformed-message
// path); auth-rejection has its own dedicated coverage in
// `auth.test.ts` and the (forthcoming) auth-cucumber scenarios. We
// reach for `__buildTestWsApp` from the server workspace — the same
// helper Vitest uses — so the cucumber scenarios exercise the same
// WS app shape.
//
// **Connection-level observation for the malformed-frame scenario.**
// The dispatcher's contract is that a malformed inbound frame is
// logged + dropped, not closed-out. Asserting "the connection stays
// open" exercises that contract through an observable on the WS
// client side (the close event is not received), without reaching
// into the server's pino instance. The wire-format error envelope
// `ws_error_message` will eventually emit is asserted in that task's
// own scenarios — this task only covers the seam.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import {
  signSessionToken,
  SESSION_COOKIE_NAME,
} from '../../../apps/server/src/auth/session-token.js';
import { __buildTestWsApp } from '../../../apps/server/src/ws/index.js';
import {
  FIXTURE_SCREEN_NAME,
  FIXTURE_USER_ID,
  TEST_SESSION_SECRET,
  makeMemoryPool,
} from '../../../apps/server/src/ws/test-helpers.js';

import type { AConversaWorld } from '../support/world.js';

// RFC 4122 v4 UUID matcher — same pattern the lifecycle steps use.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Minimal structural typing for the WS client surface we touch via
// `injectWS`. Avoids reaching for `ws`-library types inside the test
// tsconfig.
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

// The Fastify-instance subset we touch (mirrors the pattern other
// step files use to avoid dragging fastify types across workspace
// boundaries).
interface FastifyLike {
  injectWS(
    path?: string,
    upgradeContext?: { headers?: Record<string, string> },
    options?: { onInit?: (ws: WsClient) => void },
  ): Promise<WsClient>;
  close(): Promise<void>;
}

interface WsEnvelopeScratch {
  wsEnvelopeApp?: FastifyLike;
  wsClient?: WsClient;
  wsFirstFrame?: string;
  wsAuthCookie?: string;
  wsCloseEvent?: { code: number; reason: string };
}

function scratch(world: AConversaWorld): WsEnvelopeScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WsEnvelopeScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

Given('an authenticated WebSocket test app', async function (this: AConversaWorld) {
  const s = scratch(this);
  // Build the WS test app. The memory-backed pool answers the auth
  // middleware's single SELECT against the users table; the fixture
  // user is alive so the cookie below verifies.
  const app = await __buildTestWsApp({
    pool: makeMemoryPool([
      { id: FIXTURE_USER_ID, screenName: FIXTURE_SCREEN_NAME, deletedAt: null },
    ]),
    sessionTokenSecret: TEST_SESSION_SECRET,
  });

  // Pre-mint the session cookie so the When step doesn't have to
  // re-derive it. The shape is the same `name=value` pair browsers
  // send in the `Cookie` header.
  const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
  s.wsAuthCookie = `${SESSION_COOKIE_NAME}=${token}`;
  s.wsEnvelopeApp = app;
});

When(
  'an authenticated WebSocket client connects to {string}',
  async function (this: AConversaWorld, path: string) {
    const s = scratch(this);
    assert.ok(s.wsEnvelopeApp, 'WS test app not initialized — Given step missing');
    assert.ok(s.wsAuthCookie, 'WS auth cookie not initialized — Given step missing');

    let firstFrameResolve: ((value: string) => void) | null = null;
    const firstFrame = new Promise<string>((resolve) => {
      firstFrameResolve = resolve;
    });
    let closeResolve: ((value: { code: number; reason: string }) => void) | null = null;
    const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
      closeResolve = resolve;
    });

    const ws = await s.wsEnvelopeApp.injectWS(
      path,
      { headers: { cookie: s.wsAuthCookie } },
      {
        onInit(client: WsClient) {
          client.on('message', (data: unknown) => {
            if (firstFrameResolve) {
              const fn = firstFrameResolve;
              firstFrameResolve = null;
              fn(toUtf8(data));
            }
          });
          client.on('close', (code: number, reason: Buffer) => {
            if (closeResolve) {
              const fn = closeResolve;
              closeResolve = null;
              fn({ code, reason: reason.toString('utf8') });
            }
          });
        },
      },
    );

    s.wsClient = ws;
    // Stash the close-event promise via background await; the Then
    // step reads `wsCloseEvent` to verify the connection state.
    void closeEvent.then((evt) => {
      s.wsCloseEvent = evt;
    });

    // Wait for the first frame (the hello envelope) before letting
    // the When step resolve. Bounded so a regression doesn't hang the
    // suite.
    const frame = await Promise.race([
      firstFrame,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('ws first frame timeout')), 500),
      ),
    ]);
    s.wsFirstFrame = frame;
  },
);

When(
  'the client sends the malformed frame {string}',
  async function (this: AConversaWorld, frame: string) {
    const ws = scratch(this).wsClient;
    assert.ok(ws, 'no ws client — connect step missing');
    ws.send(frame);
    // Brief settle so the server-side receive handler has time to
    // process the message before the Then step reads the connection
    // state. 50ms is generous for an in-process injectWS path.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  },
);

Then(
  'the client receives a canonical hello envelope with a UUID id and a UUID connectionId',
  function (this: AConversaWorld) {
    const frame = scratch(this).wsFirstFrame;
    assert.ok(frame, 'no first frame captured');
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      id?: unknown;
      payload?: { connectionId?: unknown };
    };
    assert.equal(parsed.type, 'hello', `expected type "hello", got ${JSON.stringify(parsed.type)}`);
    assert.equal(typeof parsed.id, 'string', 'expected envelope id to be a string');
    assert.match(parsed.id as string, UUID_V4_PATTERN, 'envelope id must be a UUID v4');
    assert.equal(
      typeof parsed.payload?.connectionId,
      'string',
      'expected payload.connectionId to be a string',
    );
    assert.match(
      parsed.payload?.connectionId as string,
      UUID_V4_PATTERN,
      'connectionId must be a UUID v4',
    );
  },
);

Then('the WebSocket connection is still open', function (this: AConversaWorld) {
  const s = scratch(this);
  assert.ok(s.wsClient, 'no ws client — connect step missing');
  // The `ws` library uses numeric ready-state values:
  //   0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED.
  // The malformed-frame path's contract is that the server logs and
  // drops the message but leaves the socket open — so the client's
  // readyState is still 1 (OPEN), and no `close` event has fired.
  assert.equal(
    s.wsClient.readyState,
    1,
    `expected WS readyState=1 (OPEN), got ${s.wsClient.readyState}`,
  );
  assert.equal(
    s.wsCloseEvent,
    undefined,
    `expected no close event, got ${JSON.stringify(s.wsCloseEvent)}`,
  );
});

// Per-scenario teardown — close the WS client and the Fastify app.
After(async function (this: AConversaWorld) {
  const s = scratch(this);
  const ws = s.wsClient;
  if (ws) {
    try {
      if (ws.readyState !== 3) {
        ws.terminate();
      }
    } catch {
      // Defensive — terminate on a torn-down socket can throw on
      // some Node versions.
    }
    delete s.wsClient;
  }
  const app = s.wsEnvelopeApp;
  if (app) {
    await app.close();
    delete s.wsEnvelopeApp;
  }
  delete s.wsFirstFrame;
  delete s.wsAuthCookie;
  delete s.wsCloseEvent;
});
