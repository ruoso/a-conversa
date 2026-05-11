// Step definitions for tests/behavior/backend/ws-connection.feature.
//
// Refinement: tasks/refinements/backend/ws_connection_handling.md
//             tasks/refinements/backend/ws_auth_on_connect.md
//             tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling
//
// **History.** The original ws-connection.feature opened against
// `createServer()` directly and asserted the placeholder hello shape
// (`{ type, connectionId }`). Two parallel WS sub-tasks landed
// afterward and changed the surface:
//
//   1. `ws_auth_on_connect` made the `/ws` upgrade reject any request
//      without a valid `aconversa-session` cookie. Without auth, the
//      upgrade now returns HTTP 401.
//   2. `ws_message_envelope` replaced the placeholder hello with the
//      canonical envelope shape (`{ type, id, payload: { connectionId } }`).
//
// Both changes together mean: every lifecycle scenario in this file
// now runs through the auth-gated `__buildTestWsApp` builder (sharing
// the `wsAuthApp` + `wsAuthCookie` scratch carriers with
// `backend-ws-auth.steps.ts`), and the hello-frame assertion reads
// from `payload.connectionId` rather than top-level `connectionId`.
// The lifecycle behaviors (client-initiated close, server-shutdown
// 1001) are otherwise unchanged.
//
// **Why this file doesn't build its own app.** The auth setup (Given
// `a ws-auth-gated server is built against the pglite-backed pool` +
// `a user with oauth_subject "<sub>" exists with screen_name "<name>"`
// + `the cucumber world has a valid session cookie for that user`) is
// shared with the ws-auth.feature scenarios; centralising the
// auth-gated-app construction in `backend-ws-auth.steps.ts` keeps the
// scratch carriers in one place. This file owns only the lifecycle
// step verbs (connect, close-from-client, close-app, assert close
// codes).

import { After, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { AConversaWorld } from '../support/world.js';

// RFC 4122 v4 UUID matcher — mirrors the one used in the Vitest unit
// test and the other WS step files.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Minimal structural typing for the ws-client surface we touch. Same
// shape as `backend-ws-auth.steps.ts` / `backend-ws-envelope.steps.ts`.
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

// The Fastify-instance subset we touch via `injectWS` + `close`.
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

// The shared scratch carrier — populated by
// `backend-ws-auth.steps.ts`'s Given steps (auth-gated app +
// cookie) and consumed here. The lifecycle-only fields
// (`wsLifecycleFirstFrame`, `wsLifecycleCloseEvent`) live alongside
// the auth carriers; the per-feature After hooks clean up their own
// carriers.
interface WsConnectionScratch {
  wsAuthApp?: FastifyLike;
  wsAuthCookie?: string;
  // Lifecycle-only carriers — distinct from `wsAuthClient` /
  // `wsAuthFirstFrame` to avoid stomping on the auth feature's state
  // when scenarios from both features run in the same suite.
  wsLifecycleClient?: WsClient;
  wsLifecycleFirstFrame?: string;
  wsLifecycleCloseEvent?: { code: number; reason: string };
  wsLifecycleAppClosed?: boolean;
}

function scratch(world: AConversaWorld): WsConnectionScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WsConnectionScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function getApp(world: AConversaWorld): FastifyLike {
  const app = scratch(world).wsAuthApp;
  assert.ok(
    app,
    'WS auth app not initialized — Given "a ws-auth-gated server is built against the pglite-backed pool" missing',
  );
  return app;
}

function getCookie(world: AConversaWorld): string {
  const cookie = scratch(world).wsAuthCookie;
  assert.ok(
    cookie,
    'WS auth cookie not initialized — Given "the cucumber world has a valid session cookie for that user" missing',
  );
  return cookie;
}

// ============================================================
// Whens
// ============================================================

When(
  'an authenticated WebSocket client connects to {string}',
  async function (this: AConversaWorld, path: string) {
    const s = scratch(this);
    const app = getApp(this);
    const cookie = getCookie(this);

    let firstFrameResolve: ((value: string) => void) | null = null;
    const firstFrame = new Promise<string>((resolve) => {
      firstFrameResolve = resolve;
    });
    let closeResolve: ((value: { code: number; reason: string }) => void) | null = null;
    const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
      closeResolve = resolve;
    });

    const ws = await app.injectWS(
      path,
      { headers: { cookie } },
      {
        onInit(client: WsClient) {
          // Attach message + close listeners BEFORE the handshake
          // completes — the canonical hello envelope can arrive
          // before the `open` event resolves injectWS's promise.
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

    s.wsLifecycleClient = ws;
    // Background-await the resolved values onto the scratch carrier
    // so the Then steps can read them.
    void firstFrame.then((frame) => {
      s.wsLifecycleFirstFrame = frame;
    });
    void closeEvent.then((evt) => {
      s.wsLifecycleCloseEvent = evt;
    });

    // Wait for the first frame to arrive before letting the When step
    // resolve — the following step is either an assertion on the
    // frame (scenario 1) or a follow-up action that should observe a
    // settled connection (scenarios 2 + 3). 500ms is generous and
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
    const ws = scratch(this).wsLifecycleClient;
    assert.ok(ws, 'no ws client — connect step missing');
    ws.close(code, 'client-done');
    // Wait briefly for the close handshake to complete so the
    // following Then step reads a settled `wsLifecycleCloseEvent`.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  },
);

When('the server closes the WebSocket application', async function (this: AConversaWorld) {
  const s = scratch(this);
  const app = getApp(this);
  await app.close();
  s.wsLifecycleAppClosed = true;
  // The auth After hook will skip re-closing the app since we already
  // closed it — but it would still try to delete the carrier. Delete
  // the wsAuthApp carrier here so the After hook is a no-op for the
  // app it doesn't own anymore.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  delete (scratch(this) as WsConnectionScratch).wsAuthApp;
  // Brief settle so the preClose-driven 1001 frame propagates to the
  // client side of the in-memory duplex stream before the Then step
  // reads `wsLifecycleCloseEvent`.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
});

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a hello envelope with a UUID connectionId',
  function (this: AConversaWorld) {
    const frame = scratch(this).wsLifecycleFirstFrame;
    assert.ok(frame, 'no first frame captured');
    // Canonical envelope shape per `ws_message_envelope`:
    // `{ type: 'hello', id, payload: { connectionId } }`. We assert
    // the envelope-level `type` discriminator and the
    // `payload.connectionId` UUID — the envelope-level `id` is
    // exercised by `ws-envelope.feature`.
    const parsed = JSON.parse(frame) as {
      type?: unknown;
      payload?: { connectionId?: unknown };
    };
    assert.equal(parsed.type, 'hello', `expected type "hello", got ${JSON.stringify(parsed.type)}`);
    assert.equal(
      typeof parsed.payload?.connectionId,
      'string',
      `expected payload.connectionId to be a string, got ${typeof parsed.payload?.connectionId}`,
    );
    assert.match(
      parsed.payload?.connectionId as string,
      UUID_V4_PATTERN,
      `expected payload.connectionId to match UUID v4, got ${String(parsed.payload?.connectionId)}`,
    );
  },
);

Then(
  'the WebSocket close handshake completes with code {int}',
  function (this: AConversaWorld, expected: number) {
    const evt = scratch(this).wsLifecycleCloseEvent;
    assert.ok(evt, 'no close event captured');
    assert.equal(evt.code, expected, `expected close code ${expected}, got ${evt.code}`);
  },
);

Then(
  'the WebSocket received a server-shutdown close with code {int} and reason {string}',
  function (this: AConversaWorld, expectedCode: number, expectedReason: string) {
    const evt = scratch(this).wsLifecycleCloseEvent;
    assert.ok(evt, 'no close event captured');
    assert.equal(evt.code, expectedCode, `expected close code ${expectedCode}, got ${evt.code}`);
    assert.equal(
      evt.reason,
      expectedReason,
      `expected close reason ${JSON.stringify(expectedReason)}, got ${JSON.stringify(evt.reason)}`,
    );
  },
);

// Tear down the per-scenario ws client. The auth-app teardown is
// owned by `backend-ws-auth.steps.ts`'s After hook (the same hook
// that built the app via the Given step). Calling `.terminate()` on
// an already-closed socket is a no-op in the `ws` library, so this
// hook is idempotent across scenarios that closed cleanly + scenarios
// where the server-shutdown path already destroyed the socket.
After(function (this: AConversaWorld) {
  const s = scratch(this);
  const ws = s.wsLifecycleClient;
  if (ws) {
    try {
      // 3 = CLOSED in the `ws` library.
      if (ws.readyState !== 3) {
        ws.terminate();
      }
    } catch {
      // Defensive — terminate on a torn-down socket can throw on some
      // Node versions. Swallow; the scenario has already asserted.
    }
    delete s.wsLifecycleClient;
  }
  delete s.wsLifecycleFirstFrame;
  delete s.wsLifecycleCloseEvent;
  delete s.wsLifecycleAppClosed;
});
