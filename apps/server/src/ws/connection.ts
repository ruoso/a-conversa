// Fastify plugin: WebSocket connection lifecycle.
//
// Refinement: tasks/refinements/backend/ws_connection_handling.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling
//
// **Scope.** This plugin is the very first of fifteen
// `websocket_protocol` tasks. It lands the foundation that the rest of
// the WS sub-tree builds on:
//
//   1. Register `@fastify/websocket` against the Fastify app.
//   2. Register a single `GET /ws` route with `{ websocket: true }`.
//   3. On each connection: mint a v4 `connectionId`, log open/close,
//      send a placeholder `{ type: 'hello', connectionId }` first
//      message, gracefully close with code 1011 on unexpected errors,
//      and gracefully close with code 1001 on server-side shutdown.
//
// **What this plugin deliberately does NOT do** — each is a separate
// downstream task that builds on this foundation:
//
//   - **Auth on connect** (`ws_auth_on_connect`) — gating the upgrade
//     based on the same session-cookie primitives that
//     `auth/middleware.ts` already uses. A marked seam below is where
//     that check will go.
//   - **Subscription state** (`ws_subscribe_to_session`) — tracking
//     which connection subscribes to which session.
//   - **Message envelope** (`ws_message_envelope`) — the canonical
//     `{ type, id, payload, ... }` wire shape. The `hello` message
//     this plugin sends is a placeholder absolute-minimum-bytes
//     envelope that `ws_message_envelope` will replace; readers
//     wiring up clients should treat the current shape as ephemeral.
//   - **Message types** (`ws_propose_message`, `ws_vote_message`,
//     etc.) — client→server payloads.
//   - **Broadcasts** (`ws_event_broadcast`,
//     `ws_proposal_status_broadcast`, `ws_diagnostic_broadcast`) —
//     server→clients fanout.
//   - **Reconnection** (`ws_reconnection_handling`) — state catch-up
//     after a transient disconnect.
//
// **Design notes.**
//
//   - `connectionId` is `crypto.randomUUID()` (Node 20+ built-in, RFC
//     4122 v4). Short-lived per-connection identifier — useful in
//     logs and as a sender id when the broadcast surface lands. NOT
//     a user id; the auth task will attach a user id alongside it.
//
//   - The plugin tracks open sockets in a module-scoped `Set` so the
//     `onClose` server-shutdown hook can iterate and 1001-close every
//     still-open socket. The set is keyed by the raw `ws` instance
//     (the upstream library tracks its own `clientTracking` set on
//     the WebSocketServer, but we keep ours so we can pair each
//     entry with the per-connection logger and connection id when
//     downstream tasks need them).
//
//   - All logging goes through Fastify's per-request `request.log`
//     (which propagates `reqId` to every line) and the app-level
//     `app.log` for shutdown. No parallel pino instance — see
//     `apps/server/src/logger.ts` and ADR 0023.
//
//   - The `errorHandler` callback wired into `@fastify/websocket`'s
//     options runs when the WS handler throws synchronously OR
//     rejects. We log and emit a 1011 close. The library otherwise
//     terminates the socket without our envelope; routing through
//     `errorHandler` keeps the close code consistent.

import { randomUUID } from 'node:crypto';

import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
// `@fastify/websocket` is wired against the `ws` library; `@types/ws`
// provides the `WebSocket` type referenced below in the connection
// context and the handler signature. Importing the type directly
// (rather than reaching for `fastifyWebsocket.WebSocket`) sidesteps
// the namespace-import shape the upstream `.d.ts` uses, which the
// tests tsconfig's `moduleResolution: Bundler` resolver doesn't see
// as a value namespace.
import type { WebSocket } from 'ws';

/**
 * Close codes used by this plugin. The numeric values follow the
 * IANA WebSocket Close Code Registry (RFC 6455 §7.4).
 *
 *   - `1001 GOING_AWAY` — emitted when the server is shutting down
 *     (Fastify's `onClose` hook fires).
 *   - `1011 INTERNAL_ERROR` — emitted when an unexpected error fires
 *     inside the connection handler (the route's promise rejects, or
 *     a synchronously-thrown error reaches the library's
 *     `errorHandler` hook).
 *
 * Exported so tests can assert against the exact numeric codes
 * without re-declaring the constants in test files.
 */
export const WS_CLOSE_CODES = {
  GOING_AWAY: 1001,
  INTERNAL_ERROR: 1011,
} as const;

/**
 * Per-connection context tracked on the server. Today carries only
 * the `connectionId` and the underlying socket; downstream tasks
 * will extend this with `authUser` (`ws_auth_on_connect`),
 * `sessionId` + `subscriptions` (`ws_subscribe_to_session`), and a
 * per-connection send-buffer state machine (`ws_reconnection_handling`).
 *
 * Kept as an interface (not a class) so each downstream task can
 * widen the shape without touching this file's structural contract —
 * the only invariants this plugin owns are `connectionId` and
 * `socket`, and those are stable.
 */
export interface WsConnectionContext {
  /** v4 UUID minted on open; stable for the connection's lifetime. */
  readonly connectionId: string;
  /** The underlying `ws` socket. Kept so the shutdown hook can close it. */
  readonly socket: WebSocket;
}

/**
 * The placeholder envelope shape this plugin emits as the first
 * message on every connection. **This is NOT the canonical
 * envelope** — `ws_message_envelope` (next-but-one task) defines
 * that. Documented here so frontend / client code reading the wire
 * during the gap between this task and the envelope task can find
 * the spec in one place.
 *
 * The shape is intentionally minimal — `type: 'hello'` plus the
 * connection id. Any client built against this shape WILL need to
 * be updated when the envelope task lands; the migration plan lives
 * in that refinement.
 */
export interface WsHelloPlaceholder {
  readonly type: 'hello';
  readonly connectionId: string;
}

/**
 * Test-only hook: when this header is present on the upgrade request,
 * the connection handler synchronously throws after sending `hello`.
 * Exercises the unexpected-error path without mocking the WS library
 * (per ADR 0022 — empirical verifications are committed tests, not
 * mocks of the system under test).
 *
 * Production clients never set this header; the env-gate below
 * (`NODE_ENV !== 'production'`) keeps it off the production surface
 * entirely so a hostile client can't flood the server with internal
 * errors via crafted headers.
 *
 * The header name is exported so the test file can use the same
 * constant — no string duplication across the seam.
 */
export const WS_TEST_FORCE_ERROR_HEADER = 'x-ws-test-force-error';

/**
 * Build the connection-lifecycle handler. Returned as a closure over
 * `app` (currently unused beyond the type position; kept so future
 * downstream tasks can reach for `app.log` or `app.websocketServer`
 * without re-threading parameters).
 */
function buildConnectionHandler(
  _app: FastifyInstance,
): (socket: WebSocket, request: FastifyRequest) => void {
  return (socket, request) => {
    // ws_auth_on_connect will gate here — that task wraps the same
    // primitives `auth/middleware.ts` uses to validate the platform
    // session cookie off the upgrade request. The seam is BEFORE the
    // connection-id mint so an unauthenticated upgrade is rejected
    // without allocating any per-connection state. See
    // tasks/refinements/backend/auth_middleware.md and the eventual
    // refinement for ws_auth_on_connect.

    const connectionId = randomUUID();
    const ctx: WsConnectionContext = { connectionId, socket };
    openConnections.add(ctx);

    // Per-request logger carries `reqId`; the explicit `connectionId`
    // is added so a single connection's lifecycle can be filtered out
    // of an aggregator with one predicate. The fastify request id and
    // the WS connection id are deliberately distinct: a single
    // upgrade flow can in principle retry (today's `@fastify/websocket`
    // only spins one request per upgrade, but future-proof the log
    // vocabulary).
    request.log.info({ connectionId }, 'ws-connection-opened');

    // Placeholder envelope — see WsHelloPlaceholder docs above.
    // ws_message_envelope will replace this with the canonical
    // wire shape. Stringified explicitly so the wire bytes are
    // deterministic for tests that read the first frame.
    const hello: WsHelloPlaceholder = { type: 'hello', connectionId };
    socket.send(JSON.stringify(hello));

    socket.on('close', (code: number, reasonBuffer: Buffer) => {
      openConnections.delete(ctx);
      // The `reason` arrives as a `Buffer` (possibly empty); convert
      // to a string for the log line. Empty buffers serialise to an
      // empty string, which is the right "no reason given" signal.
      const reason = reasonBuffer.toString('utf8');
      request.log.info({ connectionId, code, reason }, 'ws-connection-closed');
    });

    // Unexpected-error path. Triggered today by:
    //   - The test-only force-error header (see
    //     WS_TEST_FORCE_ERROR_HEADER docs above).
    //   - Any future synchronous error inside the handler — the
    //     route's promise rejects, the `errorHandler` plugin option
    //     fires, and the library closes the socket. Routing the
    //     close through this branch keeps the close code consistent
    //     across both paths (handler-throw and errorHandler-fire).
    //
    // The env gate is double-belt-and-braces: even though the
    // refinement says "do not implement auth here," a malicious
    // client could in principle set this header in dev; the
    // `process.env.NODE_ENV !== 'production'` check prevents
    // production exposure.
    if (
      process.env['NODE_ENV'] !== 'production' &&
      request.headers[WS_TEST_FORCE_ERROR_HEADER] === '1'
    ) {
      // Throwing here propagates to @fastify/websocket's
      // `errorHandler` hook (wired in registerWsPlugin below), which
      // logs and emits a 1011 close. Wrapping in a thrown Error
      // rather than calling socket.close(1011) directly is the
      // canonical path — exercising the same code path a real
      // unexpected error would.
      throw new Error('ws-test-forced-error');
    }
  };
}

/**
 * Module-scoped set of open connections. Used by the route plugin
 * for tracking + by the outer plugin's `preClose` hook for shutdown
 * closes. Kept module-scoped (rather than route-scoped) so the
 * `preClose` callback the outer plugin passes to `@fastify/websocket`
 * shares the same bookkeeping the route handler writes to.
 *
 * If the test surface ever stands up two `createServer` instances in
 * the same process, this would conflate their connection sets. The
 * trade-off is acceptable: today's tests build a fresh instance per
 * test (`beforeEach` / `afterEach`) and only one is live at a time,
 * and the outer fp-wrapped plugin can't reach a closure-scoped set
 * inside the inner route plugin via the upstream-library options.
 */
const openConnections = new Set<WsConnectionContext>();

/**
 * Internal Fastify plugin — registers the `GET /ws` route. The
 * `@fastify/websocket` library is registered by the OUTER plugin
 * (see `wsConnectionHandlingPlugin` below); registering it here too
 * would either decorate the encapsulation child only (so the root
 * loses `app.injectWS` — breaks tests) or duplicate-decorate (so
 * Fastify throws at startup).
 */
const wsRoutePlugin: FastifyPluginAsync = (app, _opts) => {
  app.get(
    '/ws',
    {
      websocket: true,
      // Mark as internal/undocumented for OpenAPI: the WS protocol
      // documentation is owned by `ws_protocol_documentation`, not
      // by the OpenAPI surface. `@fastify/swagger` skips routes that
      // declare `hide: true`.
      schema: {
        hide: true,
        tags: ['ws'],
        summary: 'WebSocket upgrade endpoint (placeholder hello envelope)',
        description:
          'WebSocket upgrade endpoint owned by ws_connection_handling. The on-open ' +
          'hello frame `{ type: "hello", connectionId }` is a placeholder envelope ' +
          'and will be replaced by the canonical shape from ws_message_envelope. ' +
          'Auth gating, subscription routing, and message handling are downstream ' +
          'sibling tasks.',
      },
    },
    buildConnectionHandler(app),
  );

  // FastifyPluginAsync demands a Promise return; the registration
  // itself is sync (the route attaches synchronously and the close
  // hook is wired by the outer plugin's `@fastify/websocket` options).
  // Wrapping in `Promise.resolve` keeps the plugin-async contract
  // without a gratuitous `async` keyword that would trigger
  // `@typescript-eslint/require-await`.
  return Promise.resolve();
};

/**
 * Shutdown contract: close every still-open WS connection with code
 * 1001 (going-away) BEFORE the underlying ws.Server tears down. This
 * runs as the `preClose` option of `@fastify/websocket` — its
 * default `preClose` would call `client.close()` without a code,
 * which surfaces as a 1005 "no status received" on the client. The
 * explicit 1001 gives clients a structured signal they can
 * reconnect against (ws_reconnection_handling will read the 1001
 * to distinguish "server restarting" from "network blip").
 *
 * Hoisted out of the route plugin so the outer plugin can wire it
 * into `@fastify/websocket`'s options at registration time — the
 * library's preClose hook fires earlier in the close sequence than
 * a route-plugin-scoped onClose hook would, ensuring the 1001 frame
 * reaches the wire before the ws.Server-level teardown.
 */
function wsShutdownPreClose(this: FastifyInstance, done: () => void): void {
  for (const ctx of openConnections) {
    try {
      // Only emit a structured close if the socket is still in a
      // state where `.close()` produces a frame. The numeric
      // constants come from the `ws` library:
      //   0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED.
      if (ctx.socket.readyState === 1 || ctx.socket.readyState === 0) {
        ctx.socket.close(WS_CLOSE_CODES.GOING_AWAY, 'server-shutting-down');
      }
    } catch (err) {
      this.log.warn(
        { err, connectionId: ctx.connectionId },
        'ws-shutdown-close failed for connection',
      );
    }
  }
  openConnections.clear();
  done();
}

/**
 * Public entry point — register this in `server.ts`'s `createServer`
 * factory alongside the existing `await app.register(...)` calls.
 * The export is `fastify-plugin`-wrapped only at the outermost layer
 * so the decorations `@fastify/websocket` injects
 * (`app.websocketServer`, `app.injectWS`, `request.ws`) are
 * available at the root scope — tests that build a Fastify instance
 * via `createServer()` and call `app.injectWS('/ws')` need the
 * decoration on the root.
 *
 * The route registration itself is still encapsulated inside the
 * internal plugin above; only the library's decorations are hoisted.
 */
export const wsConnectionHandlingPlugin: FastifyPluginAsync = fp(
  async (app) => {
    // Register `@fastify/websocket` at root so its decorations
    // (`app.websocketServer`, `app.injectWS`, `request.ws`) reach the
    // top scope. The library itself is `fp`-wrapped upstream, but the
    // skip-override semantics only fire if the registrant is also at
    // a non-encapsulated scope — which the outer `fp` wrapper here
    // ensures.
    //
    // `errorHandler` fires when a WS route handler throws
    // synchronously or its returned promise rejects. We log and emit
    // a 1011 close so the client sees a consistent shutdown code
    // regardless of WHICH unexpected-error path fired; the library
    // otherwise terminates the socket without a code + reason.
    await app.register(fastifyWebsocket, {
      preClose: wsShutdownPreClose,
      errorHandler(error, socket, request) {
        request.log.error({ err: error }, 'ws-connection-error — closing with 1011 internal-error');
        try {
          // 1011 = INTERNAL_ERROR per RFC 6455.
          socket.close(WS_CLOSE_CODES.INTERNAL_ERROR, 'internal-error');
        } catch (closeErr) {
          // Defensive — if the socket is already torn down, `.close()`
          // can throw. Swallow and continue; the process must not
          // crash on a per-connection cleanup failure.
          request.log.warn(
            { err: closeErr },
            'ws-connection-error secondary failure while closing socket',
          );
        }
      },
    });

    // Route + shutdown hook stay encapsulated to the child plugin —
    // only the library decorations need to hoist.
    await app.register(wsRoutePlugin);
  },
  {
    name: 'ws-connection-handling',
    fastify: '5.x',
  },
);
