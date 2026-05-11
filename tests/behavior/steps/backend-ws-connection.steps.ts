// Step definitions for tests/behavior/backend/ws-connection.feature.
//
// Refinement: tasks/refinements/backend/ws_connection_handling.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling
//
// These steps reuse the `Given an HTTP server built from createServer`
// step defined in `http-server.steps.ts` — building the same Fastify
// instance via `createServer({ logger: false })` and stashing it on
// the World's scratch carrier under `httpServer`. The WS scenarios
// then drive the instance via `app.injectWS(...)` (provided by
// `@fastify/websocket`), which exercises the full upgrade dispatch
// through Fastify's routing without binding a port.
//
// **Why a separate steps file.** The HTTP-server steps own `httpServer`
// + `lastResponse`; this file adds WS-specific scratch carriers
// (`wsClient`, `wsFirstFrame`, `wsCloseEvent`) without bloating the
// HTTP file's responsibility. Both files cast `world.scratch` to
// their own interface — the cast pattern is the same one
// http-server.steps.ts uses (see its comments).
//
// The `pglite` Before hook in support/world.ts spins up a per-scenario
// DB handle which these scenarios don't use; the upfront cost is the
// same trade-off http-server.steps.ts already made (cheaper than a
// World-variant split).

import { After, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { AConversaWorld } from '../support/world.js';

// RFC 4122 v4 UUID matcher — mirrors the one used in the Vitest unit
// test. Kept inline rather than imported from the server package so
// the test tsconfig doesn't have to reach across workspace
// boundaries for a single regex.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Minimal structural typing for the ws-client surface we touch.
// Avoids reaching into apps/server/node_modules for the `ws` library
// types directly.
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface WsScratch {
  wsClient?: WsClient;
  wsFirstFrame?: string;
  wsCloseEvent?: { code: number; reason: string };
  wsAppClosed?: boolean;
  // The http-server.steps.ts file owns this carrier; we narrow our
  // view of it here so our steps can reach the Fastify instance the
  // shared Given step set up.
  httpServer?: unknown;
}

function scratch(world: AConversaWorld): WsScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WsScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

// Narrow the unknown httpServer carrier to the subset of FastifyInstance
// we touch (`injectWS`, `close`). The shared Given step in
// http-server.steps.ts stashes a real Fastify instance there; this
// helper avoids dragging `fastify` types into this file.
interface FastifyLike {
  injectWS(
    path?: string,
    upgradeContext?: { headers?: Record<string, string> },
    options?: {
      onInit?: (ws: WsClient) => void;
      onOpen?: (ws: WsClient) => void;
    },
  ): Promise<WsClient>;
  close(): Promise<void>;
}

function getApp(world: AConversaWorld): FastifyLike {
  const app = scratch(world).httpServer;
  assert.ok(
    app,
    'http server not initialized — "Given an HTTP server built from createServer" missing',
  );
  return app as FastifyLike;
}

When(
  'a WebSocket client connects to {string}',
  async function (this: AConversaWorld, path: string) {
    const s = scratch(this);
    let firstFrameResolve: ((value: string) => void) | null = null;
    const firstFrame = new Promise<string>((resolve) => {
      firstFrameResolve = resolve;
    });
    let closeResolve: ((value: { code: number; reason: string }) => void) | null = null;
    const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
      closeResolve = resolve;
    });

    const ws = await getApp(this).injectWS(
      path,
      {},
      {
        onInit(client: WsClient) {
          // Attach message + close listeners BEFORE the handshake
          // completes — the placeholder hello frame the server sends
          // can arrive before the `open` event resolves injectWS's
          // promise. Capturing the first frame's payload here so the
          // assertion step can read it deterministically.
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
    // Stash the promises' resolved values via background awaits — the
    // Then steps consume `wsFirstFrame` / `wsCloseEvent` from the
    // scratch carrier. Each background await writes the captured
    // value once the corresponding event fires.
    void firstFrame.then((frame) => {
      s.wsFirstFrame = frame;
    });
    void closeEvent.then((evt) => {
      s.wsCloseEvent = evt;
    });

    // Wait for the first frame to arrive before letting the When step
    // resolve — the next step is either an assertion against the
    // frame (scenario 1) or a follow-up action that should observe
    // a settled connection (scenarios 2 + 3). 500ms is generous
    // (the in-process injectWS resolves in single-digit ms) and
    // bounded so a regression doesn't hang the suite.
    await Promise.race([
      firstFrame,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('ws first frame timeout')), 500),
      ),
    ]);
  },
);

When(
  'the client closes the WebSocket with code {int}',
  async function (this: AConversaWorld, code: number) {
    const ws = scratch(this).wsClient;
    assert.ok(ws, 'no ws client — When connect step missing');
    ws.close(code, 'client-done');
    // Wait briefly for the close handshake to complete so the
    // following Then step reads a settled `wsCloseEvent`.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  },
);

When('the server closes the HTTP application', async function (this: AConversaWorld) {
  const app = getApp(this);
  await app.close();
  scratch(this).wsAppClosed = true;
  // Brief settle so the preClose-driven 1001 frame propagates to the
  // client side of the in-memory duplex stream before the Then step
  // reads `wsCloseEvent`.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
});

Then(
  'the client receives a placeholder hello frame with a UUID connectionId',
  function (this: AConversaWorld) {
    const frame = scratch(this).wsFirstFrame;
    assert.ok(frame, 'no first frame captured');
    const parsed = JSON.parse(frame) as { type?: unknown; connectionId?: unknown };
    assert.equal(parsed.type, 'hello', `expected type "hello", got ${JSON.stringify(parsed.type)}`);
    assert.equal(
      typeof parsed.connectionId,
      'string',
      `expected connectionId to be a string, got ${typeof parsed.connectionId}`,
    );
    assert.match(
      parsed.connectionId as string,
      UUID_V4_PATTERN,
      `expected connectionId to match UUID v4, got ${String(parsed.connectionId)}`,
    );
  },
);

Then(
  'the WebSocket close handshake completes with code {int}',
  function (this: AConversaWorld, expected: number) {
    const evt = scratch(this).wsCloseEvent;
    assert.ok(evt, 'no close event captured');
    assert.equal(evt.code, expected, `expected close code ${expected}, got ${evt.code}`);
  },
);

Then(
  'the WebSocket received a server-shutdown close with code {int} and reason {string}',
  function (this: AConversaWorld, expectedCode: number, expectedReason: string) {
    const evt = scratch(this).wsCloseEvent;
    assert.ok(evt, 'no close event captured');
    assert.equal(evt.code, expectedCode, `expected close code ${expectedCode}, got ${evt.code}`);
    assert.equal(
      evt.reason,
      expectedReason,
      `expected close reason ${JSON.stringify(expectedReason)}, got ${JSON.stringify(evt.reason)}`,
    );
  },
);

// Tear down the per-scenario ws client. The HTTP server itself is
// torn down by the http-server.steps.ts `After` hook; we only own
// the client carrier here. Calling `.terminate()` on an already-
// closed socket is a no-op in the `ws` library, so the hook is
// idempotent across scenarios that closed cleanly + scenarios
// where the server-shutdown path already destroyed the socket.
// Cucumber's `After` hook accepts a sync function; we don't await
// anything in this teardown (`terminate()` is sync). The async
// signature would trip `@typescript-eslint/require-await`.
After(function (this: AConversaWorld) {
  const s = scratch(this);
  const ws = s.wsClient;
  if (ws) {
    try {
      // Only terminate if the socket isn't already closed (state
      // CLOSED = 3 in the ws library).
      if (ws.readyState !== 3) {
        ws.terminate();
      }
    } catch {
      // Defensive — termination on a torn-down socket can throw on
      // some Node versions. Swallow and continue; the scenario has
      // already asserted what it cared about.
    }
    delete s.wsClient;
  }
  delete s.wsFirstFrame;
  delete s.wsCloseEvent;
  delete s.wsAppClosed;
});
