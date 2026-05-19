// Step definitions for tests/behavior/backend/ws-auth.feature.
//
// Refinement: tasks/refinements/backend/ws_auth_on_connect.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_auth_on_connect
//
// **What this file owns.** The cucumber-layer regression net for the
// `/ws` upgrade auth gate (`ws_auth_on_connect`):
//
//   1. An upgrade with no cookie is refused with HTTP 401 BEFORE the
//      WS handshake completes (the handshake never succeeds; the
//      client's `injectWS` rejects with "Unexpected server response:
//      401").
//   2. An upgrade with a valid cookie completes; the server emits the
//      canonical hello envelope as the first frame.
//
// The unit-layer counterpart (`apps/server/src/ws/auth.test.ts`) covers
// the rejection variants in isolation (no cookie / tampered signature /
// expired token / valid token / per-connection user shape). This file
// covers the end-to-end wire path against a real migrated `users`
// table via pglite — proving the same `authenticateRequest` primitive
// the HTTP middleware uses verifies cookies the same way through the
// WS upgrade.
//
// **Why we share `wsAuthApp` + `wsAuthCookie` with the ws-connection
// steps.** Once the auth gate landed, the previously-passing
// `ws-connection.feature` scenarios (which connected to `/ws` without a
// cookie via `createServer()`) started failing with 401. The fix is to
// move them onto the same auth-gated test app this feature uses; both
// step files therefore reach for the same scratch keys
// (`wsAuthApp`, `wsAuthCookie`). The `ws-connection.steps.ts`
// `After` hook leaves the app teardown to whichever file built the
// app — we own it here.
//
// **Why `__buildTestWsApp` + a pglite-pool adapter (not `createServer`).**
// `createServer` reaches for the singleton `pg.Pool` lazily via
// `getDefaultPool()` on the first authenticated request, which throws
// when `DATABASE_URL` is unset — the standard cucumber surface uses
// the per-scenario PGlite handle, not a real Postgres URL. The
// `__buildTestWsApp` helper takes the pool as an explicit option;
// adapting the world's PGlite handle to the `DbPool` shape (a single
// `query(text, params?)` method) is the canonical pattern
// `backend-oauth-callback.steps.ts` already uses for the same gap.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import {
  signSessionToken,
  SESSION_COOKIE_NAME,
} from '../../../apps/server/src/auth/session-token.js';
import { __buildTestWsApp } from '../../../apps/server/src/ws/index.js';

import type { AConversaWorld } from '../support/world.js';

// The shared cucumber-layer session-token secret. Pinned identically
// across `backend-session-token.steps.ts`, `backend-auth-middleware.steps.ts`,
// etc.; the WS test app verifies cookies with the same key.
const TEST_SESSION_SECRET = 'test-session-secret';

// Minimal structural typing for the WS client surface we touch via
// `injectWS`. Mirrors the pattern other ws step files use to avoid
// reaching across workspace boundaries for `ws`-library types.
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

// The Fastify-instance subset we touch. The full `FastifyInstance`
// type lives under `apps/server/node_modules` (workspace-local dep);
// typing the carrier structurally keeps the dep boundary clean.
interface FastifyLike {
  injectWS(
    path?: string,
    upgradeContext?: { headers?: Record<string, string> },
    options?: { onInit?: (ws: WsClient) => void },
  ): Promise<WsClient>;
  close(): Promise<void>;
}

// Shared shape on `world.scratch` consumed by this file and
// `backend-ws-connection.steps.ts` (which delegates its app+cookie
// setup to the Given step below). The keys mirror the
// `backend-ws-envelope.steps.ts` carrier names so the WS substream's
// scratch vocabulary is consistent.
interface WsAuthScratch {
  wsAuthApp?: FastifyLike;
  wsAuthCookie?: string;
  wsAuthClient?: WsClient;
  wsAuthFirstFrame?: string;
  wsAuthRejectionMessage?: string;
}

function scratch(world: AConversaWorld): WsAuthScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as WsAuthScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

// ============================================================
// Givens
// ============================================================

Given(
  'a ws-auth-gated server is built against the pglite-backed pool',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    // Adapter — translate the `DbPool` interface (`query(text, params?)`)
    // onto the world's PGlite handle. PGlite's `query(text, params?)`
    // already returns `{ rows: T[] }`, which is structurally
    // compatible with `DbPool`. Same shape `backend-oauth-callback.steps.ts`
    // uses for the auth-middleware integration tests.
    const dbHandle = this.db;
    const pool = {
      async query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
        return { rows: result.rows };
      },
    };
    const app = (await __buildTestWsApp({
      pool,
      sessionTokenSecret: TEST_SESSION_SECRET,
    })) as unknown as FastifyLike;
    s.wsAuthApp = app;
  },
);

Given(
  'the cucumber world has a valid session cookie for that user',
  async function (this: AConversaWorld) {
    // Look up the most-recently-created users row to mint a cookie for.
    // Same idiom `backend-session-token.steps.ts` uses — every Given
    // that creates a user (here: the shared
    // `a user with oauth_subject ... exists with screen_name ...`
    // step in `backend-session-token.steps.ts`) inserts a row whose
    // `id` we read back here.
    const result = (await this.db.query(
      'SELECT id FROM users ORDER BY created_at DESC LIMIT 1',
    )) as { rows: Array<{ id: string }> };
    const userId = result.rows[0]?.id;
    assert.ok(userId, 'no users row found to mint a session cookie for');
    const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
    scratch(this).wsAuthCookie = `${SESSION_COOKIE_NAME}=${token}`;
  },
);

// ============================================================
// Whens
// ============================================================

When(
  'a WebSocket client connects to {string} without a session cookie',
  async function (this: AConversaWorld, path: string) {
    const s = scratch(this);
    assert.ok(s.wsAuthApp, 'WS auth app not initialized — Given step missing');
    // Per ADR 0029 + `aud_anonymous_ws_subscribe`, a cookie-less
    // upgrade is no longer 401 — the gate falls through to
    // anonymous and the upgrade completes. Capture the hello frame
    // for the Then step to assert.
    let firstFrameResolve: ((value: string) => void) | null = null;
    const firstFrame = new Promise<string>((resolve) => {
      firstFrameResolve = resolve;
    });
    try {
      const ws = await s.wsAuthApp.injectWS(
        path,
        {},
        {
          onInit(client: WsClient) {
            client.on('message', (data: unknown) => {
              if (firstFrameResolve) {
                const fn = firstFrameResolve;
                firstFrameResolve = null;
                fn(toUtf8(data));
              }
            });
          },
        },
      );
      s.wsAuthClient = ws;
      // Drain the hello frame.
      const frame = await Promise.race([
        firstFrame,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('ws first frame timeout')), 500),
        ),
      ]);
      s.wsAuthFirstFrame = frame;
    } catch (err) {
      // If the upgrade was unexpectedly refused, capture the
      // rejection so the Then step can surface a precise failure.
      s.wsAuthRejectionMessage = err instanceof Error ? err.message : String(err);
    }
  },
);

When(
  'a WebSocket client connects to {string} with the session cookie',
  async function (this: AConversaWorld, path: string) {
    const s = scratch(this);
    assert.ok(s.wsAuthApp, 'WS auth app not initialized — Given step missing');
    assert.ok(s.wsAuthCookie, 'WS auth cookie not initialized — Given step missing');

    let firstFrameResolve: ((value: string) => void) | null = null;
    const firstFrame = new Promise<string>((resolve) => {
      firstFrameResolve = resolve;
    });

    const ws = await s.wsAuthApp.injectWS(
      path,
      { headers: { cookie: s.wsAuthCookie } },
      {
        onInit(client: WsClient) {
          // Pre-attach the message listener BEFORE the handshake
          // completes — the server-initiated hello frame can arrive
          // before injectWS's promise resolves the open event. Same
          // pattern as `backend-ws-envelope.steps.ts` /
          // `backend-ws-connection.steps.ts`.
          client.on('message', (data: unknown) => {
            if (firstFrameResolve) {
              const fn = firstFrameResolve;
              firstFrameResolve = null;
              fn(toUtf8(data));
            }
          });
        },
      },
    );
    s.wsAuthClient = ws;

    // Wait for the first frame (the hello envelope) before letting the
    // When step resolve. Bounded so a regression doesn't hang the
    // suite — the in-process injectWS path settles in single-digit ms.
    const frame = await Promise.race([
      firstFrame,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('ws first frame timeout')), 500),
      ),
    ]);
    s.wsAuthFirstFrame = frame;
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the WebSocket upgrade is refused with HTTP status {int}',
  function (this: AConversaWorld, expectedStatus: number) {
    const message = scratch(this).wsAuthRejectionMessage;
    assert.ok(message, 'no WS rejection captured — the When step did not record a rejection');
    // The rejection message from `ws` (the library `@fastify/websocket`
    // wraps) carries the HTTP status the server emitted on the
    // upgrade response. The canonical form is "Unexpected server
    // response: <status>"; we string-match the numeric status to
    // avoid coupling to the library's exact phrasing.
    assert.ok(
      message.includes(String(expectedStatus)),
      `expected rejection message to include HTTP status ${expectedStatus}; got ${JSON.stringify(message)}`,
    );
  },
);

Then(
  'the WebSocket upgrade completes anonymously and a hello frame arrives',
  function (this: AConversaWorld) {
    const s = scratch(this);
    assert.ok(
      s.wsAuthRejectionMessage === undefined,
      `expected anonymous upgrade to complete but it was refused: ${s.wsAuthRejectionMessage ?? ''}`,
    );
    assert.ok(s.wsAuthClient, 'no ws client — anonymous connect step did not capture a client');
    const frame = s.wsAuthFirstFrame;
    assert.ok(frame, 'no first frame captured for anonymous upgrade');
    // The canonical envelope shape per `ws_message_envelope` —
    // `{ type: 'hello', id, payload: { connectionId } }`. The
    // anonymous-fall-through contract: a hello frame arrives just
    // like the authenticated path; the difference is server-side
    // (`request.authUser === undefined`), not on the wire.
    const parsed = JSON.parse(frame) as { type?: unknown };
    assert.equal(
      parsed.type,
      'hello',
      `expected first frame to be a hello envelope, got type=${JSON.stringify(parsed.type)}`,
    );
  },
);

Then('the WebSocket upgrade completes and a hello frame arrives', function (this: AConversaWorld) {
  const s = scratch(this);
  assert.ok(s.wsAuthClient, 'no ws client — connect step missing');
  const frame = s.wsAuthFirstFrame;
  assert.ok(frame, 'no first frame captured');
  // The canonical envelope shape per `ws_message_envelope` —
  // `{ type: 'hello', id, payload: { connectionId } }`. We only
  // assert `type === 'hello'` here; the envelope-id / connection-id
  // shape is exercised by `ws-envelope.feature`. The auth-gate
  // contract is that a hello frame arrives AT ALL — proving the
  // upgrade completed successfully.
  const parsed = JSON.parse(frame) as { type?: unknown };
  assert.equal(
    parsed.type,
    'hello',
    `expected first frame to be a hello envelope, got type=${JSON.stringify(parsed.type)}`,
  );
});

// ============================================================
// Teardown
// ============================================================

// Per-scenario teardown — close the WS client and the Fastify app this
// file built. The pglite handle is closed by the world-level After
// hook. We only touch carriers this file (or the shared
// ws-connection.steps.ts file) populates; idempotent across scenarios
// that didn't build an auth app.
After(async function (this: AConversaWorld) {
  const s = scratch(this);
  const ws = s.wsAuthClient;
  if (ws) {
    try {
      // 3 = CLOSED in the `ws` library — skip the terminate call if
      // the socket is already torn down.
      if (ws.readyState !== 3) {
        ws.terminate();
      }
    } catch {
      // Defensive — terminate on an already-destroyed socket can
      // throw on some Node versions.
    }
    delete s.wsAuthClient;
  }
  const app = s.wsAuthApp;
  if (app) {
    await app.close();
    delete s.wsAuthApp;
  }
  delete s.wsAuthCookie;
  delete s.wsAuthFirstFrame;
  delete s.wsAuthRejectionMessage;
});
