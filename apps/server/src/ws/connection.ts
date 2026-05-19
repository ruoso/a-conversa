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
//   2. Register a single `GET /api/ws` route with `{ websocket: true }`.
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
//
//   - **Auth gate (ws_auth_on_connect).** The `GET /api/ws` route attaches a
//     `preValidation` hook that reads the `aconversa-session` cookie off
//     the upgrade request, verifies the HS256 JWT via the same
//     `authenticateRequest` primitive `apps/server/src/auth/middleware.ts`
//     uses for HTTP routes, and either:
//
//       - On success: attaches `{ id, screenName }` to
//         `request.authUser` so the connection handler can stash it on
//         the per-connection context (`WsConnectionContext.user`).
//       - On failure: throws `ApiError(401, 'auth-required', ...)` which
//         the centralized error-handler plugin renders as the canonical
//         envelope. `@fastify/websocket`'s dispatch lets Fastify's HTTP
//         pipeline run BEFORE the upgrade is hijacked — the 401 response
//         is sent on the raw upgrade socket and the library's
//         `onResponse` hook destroys it. The client's `injectWS` promise
//         rejects with "Unexpected server response: 401". The WS
//         handshake never completes; no `connectionId` is minted; no
//         per-connection state is allocated.
//
//     Rationale for the pre-upgrade reject (vs. an accept-then-close
//     with a 4xxx close code): the README of `@fastify/websocket`
//     explicitly endorses `preValidation` hooks for auth, the
//     HTTP-status surface is the same one HTTP routes use, and 401 is
//     the canonical Fastify error envelope. Inventing a custom 4401
//     close code would diverge from the HTTP middleware's envelope for
//     no semantic gain.
//
//     Cookie-on-upgrade contract: the WS endpoint is **same-origin** in
//     the production deployment (and in compose dev) so the browser's
//     native `new WebSocket(...)` API sends the session cookie on the
//     upgrade `Request` automatically — per the WebSocket spec. The
//     browser API does NOT permit setting arbitrary headers on a WS
//     upgrade; same-origin cookies are the contract this auth gate
//     relies on. Any future cross-origin audience surface (e.g.
//     `audience.broadcast_surface`) MUST either be same-origin to the
//     app or carry a different auth primitive (a query-string ticket
//     issued by an authenticated HTTP exchange). The audience-surface
//     task is reminded of this constraint in its own refinement.

import { randomUUID } from 'node:crypto';

import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { authenticateRequest, type AuthUser } from '../auth/middleware.js';
import { resolveSessionTokenSecret } from '../auth/pending-cookie.js';
import { getDefaultPool, type DbPool } from '../db.js';
import { ApiError } from '../errors.js';
import { WS_ORIGIN_ALLOWLIST_ANY, type WsOriginAllowlist } from '../ws-origin-allowlist.js';
// `@fastify/websocket` is wired against the `ws` library; `@types/ws`
// provides the `WebSocket` type referenced below in the connection
// context and the handler signature. Importing the type directly
// (rather than reaching for `fastifyWebsocket.WebSocket`) sidesteps
// the namespace-import shape the upstream `.d.ts` uses, which the
// tests tsconfig's `moduleResolution: Bundler` resolver doesn't see
// as a value namespace.
import type { WebSocket } from 'ws';

import {
  wsBroadcastPlugin,
  wsConnectionSendersPlugin,
  wsEventAppliedBroadcastPlugin,
} from './broadcast/index.js';
import { wsDispatcherPlugin } from './dispatcher.js';
import {
  buildHelloEnvelope,
  parseWsEnvelopeJson,
  serializeWsEnvelope,
  WsEnvelopeValidationError,
} from './envelope.js';
import { sendWsError, WS_MALFORMED_ENVELOPE_CODE } from './error-envelope.js';
import { clearCatchUpRateStateForConnection } from './handlers/catch-up.js';
import { wsSubscriptionsPlugin } from './subscriptions.js';

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
 * Application-defined WebSocket close code emitted by
 * `closeUserConnections(...)` when a still-open connection is revoked
 * because its authenticated user has been soft-deleted (or, more
 * generally, the upgrade-time auth contract no longer holds). Closes
 * `docs/security/m3-review/coverage.md` G-003.
 *
 * **Why 4401.** RFC 6455 §7.4 reserves the 4000–4999 range for
 * application use; the project picks 4401 so the numeric value mirrors
 * the HTTP 401 the upgrade-time gate would emit on a fresh connection
 * attempt by the same (now-revoked) user. A WS-aware client can map
 * the close code directly to "your session is no longer valid; sign in
 * again" without a custom vocabulary.
 *
 * **Why a custom 4xxx here and not at upgrade-time.** The
 * upgrade-rejection path (`ws_auth_on_connect`) intentionally uses
 * HTTP 401 + the canonical envelope because the HTTP response surface
 * is reachable BEFORE the handshake completes. AFTER upgrade, no HTTP
 * response surface exists; a structured 4xxx close code is the only
 * signal the client can read.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/user_soft_delete_ws_close.md.
 */
export const WS_AUTH_REVOKED_CLOSE_CODE = 4401;

/**
 * Default reason string emitted alongside `WS_AUTH_REVOKED_CLOSE_CODE`.
 * Carries the "why category" — `'auth-revoked'` is broader than
 * `'user-deleted'` so future revocation surfaces (token rotation,
 * ban, password reset) can reuse the same wire shape without a
 * vocabulary change.
 *
 * RFC 6455 §5.5.1 caps WS close-frame reasons at 123 bytes; this
 * default is 12 bytes, comfortably inside the limit. Callers
 * overriding the reason are subject to a defensive byte-truncation
 * inside `closeUserConnections` (a too-long reason does NOT throw —
 * the helper truncates so a misconfigured caller does not block a
 * security-critical revocation).
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/user_soft_delete_ws_close.md.
 */
export const WS_AUTH_REVOKED_REASON = 'auth-revoked';

/**
 * Hard byte ceiling on the `reason` argument forwarded to
 * `socket.close(code, reason)`. RFC 6455 §5.5.1 caps WS close-frame
 * reasons at 123 bytes (the 125-byte control-frame limit minus the
 * two-byte close-code prefix). Truncation lives in the helper rather
 * than the call site so a misconfigured caller can't block a
 * security-critical revocation by passing an over-long string.
 */
const WS_CLOSE_REASON_MAX_BYTES = 123;

/**
 * Default `@fastify/websocket` `maxPayload` (incoming-frame ceiling).
 * Closes `docs/security/m3-review/inputs.md` F-002. The underlying
 * `ws` library defaults to `100 * 1024 * 1024` (100 MiB) when unset;
 * `@fastify/websocket` does not force a smaller default. 64 KiB is
 * tight enough to choke a memory-pressure DoS — any oversized inbound
 * frame is rejected by the receiver with close code 1009 ("Too Big")
 * BEFORE the dispatcher pays the JSON-parse cost — and generous
 * enough that no legitimate client→server envelope bumps against it.
 *
 * **Direction**: `maxPayload` gates the receiver path only (verified
 * against `ws@8.20.0`'s `lib/receiver.js` + `lib/permessage-deflate.js`;
 * the sender does not consult it). Outgoing frames — including a
 * potentially-large `snapshot-state` response — are NOT subject to
 * this limit.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/fastify_body_limit.md.
 */
export const DEFAULT_WS_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Env var name production reads to override
 * `DEFAULT_WS_MAX_PAYLOAD_BYTES`. Exported so tests can assert
 * against the same constant the resolver consults.
 */
export const WS_MAX_PAYLOAD_ENV = 'WS_MAX_PAYLOAD_BYTES';

/**
 * Subset of `process.env` consumed by `resolveWsMaxPayload`. Typed so
 * callers can pass `process.env` directly without an `as any` cast
 * (same pattern as `CorsEnv` / `BodyLimitEnv` in `server.ts`).
 */
export interface WsMaxPayloadEnv {
  readonly WS_MAX_PAYLOAD_BYTES?: string | undefined;
}

/**
 * Resolve the `@fastify/websocket` `maxPayload` (incoming-frame
 * ceiling) from the environment. Production callers pass
 * `process.env`; tests pass a bespoke record.
 *
 *   - Reads `WS_MAX_PAYLOAD_BYTES` from the supplied env object.
 *   - Returns `DEFAULT_WS_MAX_PAYLOAD_BYTES` (64 KiB) when the value
 *     is absent, empty, unparseable, or non-positive.
 *   - Returns the parsed integer otherwise.
 *
 * Mirrors the resolve-pattern used by
 * `resolveCatchUpMaxEvents` (`./handlers/catch-up.ts`) and
 * `resolveBodyLimit` (`../server.ts`). Closes
 * `docs/security/m3-review/inputs.md` F-002. Refinement:
 *   tasks/refinements/backend-hardening/fastify_body_limit.md.
 */
export function resolveWsMaxPayload(env: WsMaxPayloadEnv = process.env): number {
  const raw = env.WS_MAX_PAYLOAD_BYTES;
  if (raw === undefined || raw === '') {
    return DEFAULT_WS_MAX_PAYLOAD_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WS_MAX_PAYLOAD_BYTES;
  }
  return parsed;
}

/**
 * Canonical `error.code` rendered when the WS upgrade's `Origin` header
 * is missing (production) or not on the env-resolved allowlist. Closes
 * `docs/security/m3-review/auth.md` F-002 (the same-origin assumption
 * is now server-enforced, not documentation-only).
 *
 * Exported so tests (and any future audit pipeline / monitoring rule)
 * can assert against the exact wire code without re-declaring the
 * string. Matches the kebab-case pattern of `AUTH_REQUIRED_CODE`.
 */
export const ORIGIN_NOT_ALLOWED_CODE = 'origin-not-allowed';

/**
 * Canonical 403 message rendered alongside `ORIGIN_NOT_ALLOWED_CODE`.
 * Like `AUTH_REQUIRED_MESSAGE`, a single phrasing across every reject
 * variant (missing Origin vs. unlisted Origin) preserves the no-info-
 * leak property — a probe can't distinguish "no header" from "wrong
 * origin" by the message.
 */
export const ORIGIN_NOT_ALLOWED_MESSAGE =
  'the WebSocket upgrade Origin is not on the server allowlist';

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
  /**
   * The authenticated user that owns this connection. Populated by the
   * `preValidation` auth gate (see `ws_auth_on_connect`); shape mirrors
   * `request.authUser` (`{ id, screenName }`) so a downstream
   * `ws_event_broadcast` can route messages by user id without a
   * second user-row lookup.
   *
   * **Type-level optional, runtime invariant non-null** — mirrors the
   * `FastifyRequest.authUser?` pattern in `auth/types.d.ts`. The
   * connection handler only runs after the `preValidation` auth gate
   * has populated this field; downstream consumers reading the
   * context from inside a handler (or via
   * `__getOpenConnectionsForTests()`) can rely on it being defined.
   * The optional type at the surface lets sibling downstream tasks
   * (`ws_message_envelope`'s dispatcher, `ws_subscribe_to_session`'s
   * subscription map) construct context objects in their unit tests
   * without fabricating a user when their test isn't about the auth
   * surface.
   *
   * Marked `readonly` because the user-id binding is fixed for the
   * connection's lifetime; a token-rotation flow that re-binds
   * mid-connection would replace the context, not mutate it.
   */
  readonly user?: AuthUser;
}

/**
 * The placeholder envelope shape this plugin originally emitted as
 * the first message on every connection. **Superseded by
 * `ws_message_envelope`** — the canonical envelope shape now flows
 * through `@a-conversa/shared-types`'s `WsEnvelope<'hello'>`
 * (`{ type: 'hello', id, payload: { connectionId } }`). The runtime
 * sends the envelope-shaped frame via `buildHelloEnvelope` +
 * `serializeWsEnvelope` (see `./envelope.ts`); this interface is kept
 * only as a type-level historical marker for readers tracing the
 * placeholder-to-envelope migration in one place.
 *
 * Marked `@deprecated` so any code wired against the old shape gets
 * a TS lint nudge to migrate. New code MUST use `WsEnvelope<'hello'>`
 * from `@a-conversa/shared-types`.
 *
 * @deprecated Use `WsEnvelope<'hello'>` from `@a-conversa/shared-types`.
 *             Replaced by the canonical envelope per
 *             `tasks/refinements/backend/ws_message_envelope.md`.
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
 * `app` so the handler can reach `app.wsDispatcher` for inbound
 * message routing (per `ws_message_envelope`). Future tasks reach for
 * `app.log` or `app.websocketServer` through the same closure.
 */
function buildConnectionHandler(
  app: FastifyInstance,
): (socket: WebSocket, request: FastifyRequest) => void {
  return (socket, request) => {
    // The `preValidation` auth gate (wired below in `wsRoutePlugin`)
    // has already run. Per ADR 0029 + the
    // `aud_anonymous_ws_subscribe` refinement, the gate now ACCEPTS
    // anonymous upgrades — a missing / invalid cookie produces
    // `request.authUser === undefined` and the upgrade proceeds. The
    // narrow below is now a real branch, not a wiring-bug check:
    // anonymous connections carry `ctx.user === undefined` through
    // the handler surface, and the subscribe / write handlers
    // discriminate by `connection.user === undefined`. The
    // origin-allowlist gate (still in the `preValidation` hook
    // above) is the only upgrade-time reject — off-origin upgrades
    // get HTTP 403 and never reach this handler.
    const user = request.authUser;

    const connectionId = randomUUID();
    // `exactOptionalPropertyTypes` distinguishes "property absent"
    // from "property present with `undefined`" — the
    // `WsConnectionContext.user?` field must be OMITTED rather than
    // explicitly `undefined` for an anonymous connection.
    const ctx: WsConnectionContext =
      user === undefined ? { connectionId, socket } : { connectionId, socket, user };
    openConnections.add(ctx);
    addToConnectionsByUser(ctx);

    // Register the per-connection sender on the connection-sender
    // registry so the broadcast surface (`ws_event_broadcast`) can
    // fan out frames over this socket without reaching into this
    // module's closures. The sender is a thin wrapper around
    // `serializeWsEnvelope` + `socket.send` — keeping the
    // serialisation here means every server-emitted frame (hello,
    // ack, broadcast) goes through one code path. The sender is
    // unregistered in the `close` hook below.
    app.wsConnectionSenders.register(connectionId, (envelope) => {
      socket.send(serializeWsEnvelope(envelope));
    });

    // Per-request logger carries `reqId`; the explicit `connectionId`
    // plus `userId` is added so a single connection's lifecycle can be
    // filtered out of an aggregator by either predicate. The fastify
    // request id and the WS connection id are deliberately distinct:
    // a single upgrade flow can in principle retry (today's
    // `@fastify/websocket` only spins one request per upgrade, but
    // future-proof the log vocabulary).
    request.log.info(
      { connectionId, userId: user?.id, screenName: user?.screenName },
      'ws-connection-opened',
    );

    // Canonical envelope-shaped hello, owned by `ws_message_envelope`.
    // Replaces the prior placeholder `{ type: 'hello', connectionId }`
    // shape — the wire frame is now
    // `{ type: 'hello', id: <uuid>, payload: { connectionId } }`. The
    // build helper mints the message `id` (separate from `connectionId`);
    // `serializeWsEnvelope` validates the envelope before emitting so
    // a server-construction bug fails loudly here rather than silently
    // on the wire.
    socket.send(serializeWsEnvelope(buildHelloEnvelope(connectionId)));

    // Inbound message receive loop — owned by `ws_message_envelope`.
    // Every client → server frame is parsed via `parseWsEnvelopeJson`
    // and routed to `app.wsDispatcher`. Downstream message-type tasks
    // (`ws_propose_message`, `ws_vote_message`, etc.) register their
    // handlers against the dispatcher in their own plugin setup;
    // here the connection handler is generic across all types.
    //
    // Failure modes:
    //   1. Non-string frame (Buffer / binary) → convert to UTF-8 text
    //      first. The WS protocol allows binary frames; the canonical
    //      envelope is JSON so a binary frame fails the parse and
    //      surfaces via the same error path as a malformed string.
    //   2. JSON parse failure or schema-invalid envelope →
    //      `parseWsEnvelopeJson` throws `WsEnvelopeValidationError`.
    //      Logged at warn level (the client sent garbage; this is not
    //      a server error). The wire-format error envelope is
    //      `ws_error_message`'s job — when that task lands, the catch
    //      below will construct and send the error envelope on the
    //      socket. Today we log + drop.
    //   3. Well-formed envelope → handed to the dispatcher. Unknown
    //      `type` and handler exceptions are routed through the
    //      dispatcher's seams (logged today; wire-format error
    //      envelope from `ws_error_message`).
    socket.on('message', (data: unknown) => {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[]).toString('utf8')
            : String(data);

      let envelope;
      try {
        envelope = parseWsEnvelopeJson(text);
      } catch (err) {
        if (err instanceof WsEnvelopeValidationError) {
          // Client sent a malformed message. Log + send a canonical
          // `error` envelope (`code: 'malformed-envelope'`) and KEEP
          // the connection open — a per-frame parse failure is a
          // client bug that the client can recover from by re-sending,
          // not a connection-state problem. Closing the socket would
          // force a reconnect + re-auth + re-subscribe handshake for
          // a one-frame hiccup (per `ws_error_message`'s connection-
          // stays-open invariant).
          //
          // `inResponseTo` is absent: the inbound frame failed to
          // parse, so we cannot read an `id` off it.
          request.log.warn(
            { connectionId, err },
            'ws-message-rejected — envelope parse failed; sending malformed-envelope error',
          );
          try {
            sendWsError((wire) => socket.send(wire), {
              code: WS_MALFORMED_ENVELOPE_CODE,
              message: 'envelope parse failed',
            });
          } catch (sendErr) {
            // Defensive — a torn-down socket would throw on send.
            request.log.warn(
              { err: sendErr, connectionId },
              'ws-message-rejected: failed to send malformed-envelope error',
            );
          }
          return;
        }
        // Anything else is a programmer error — re-throw so the
        // library's `errorHandler` emits 1011 (consistent with other
        // unexpected-error paths in this plugin).
        throw err;
      }

      // Hand the parsed envelope to the dispatcher. The dispatcher
      // catches handler exceptions internally (routes them through
      // its `onHandlerError` seam) so the receive loop stays single-
      // exception-safe — one bad message can't kill the connection.
      void app.wsDispatcher.dispatch(envelope, ctx);
    });

    socket.on('close', (code: number, reasonBuffer: Buffer) => {
      openConnections.delete(ctx);
      removeFromConnectionsByUser(ctx);
      // Drop every subscription this connection held (owned by
      // `ws_subscribe_to_session`). Idempotent — a connection that
      // never subscribed makes this a no-op. The registry is at the
      // app level (decorated via `wsSubscriptionsPlugin`), so the
      // handler reaches for `app.wsSubscriptions`. Failing to clean
      // up here would leak entries in both the bySession and
      // byConnection indices; calling once on close is the single
      // teardown point.
      app.wsSubscriptions.removeConnection(connectionId);
      // Drop the per-connection sender so the broadcast surface
      // (`ws_event_broadcast`) skips this connection on future fan-
      // outs. Idempotent — a connection that never registered makes
      // this a no-op. Paired with the `register(...)` call on open.
      app.wsConnectionSenders.unregister(connectionId);
      // Drop the per-connection catch-up rate-limit bucket so the
      // module-scoped state in `handlers/catch-up.ts` matches the
      // documented invariant: per-connection, clears on close. Closes
      // `docs/security/m3-review/inputs.md` F-004. Idempotent — a
      // connection that never sent a catch-up envelope has no bucket;
      // the delete is a no-op. Refinement:
      //   tasks/refinements/backend-hardening/catch_up_event_limit.md.
      clearCatchUpRateStateForConnection(connectionId);
      // The `reason` arrives as a `Buffer` (possibly empty); convert
      // to a string for the log line. Empty buffers serialise to an
      // empty string, which is the right "no reason given" signal.
      const reason = reasonBuffer.toString('utf8');
      request.log.info({ connectionId, userId: user?.id, code, reason }, 'ws-connection-closed');
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
 * Module-scoped per-user index: maps a user id to the set of open
 * `WsConnectionContext`s owned by that user. Maintained alongside
 * `openConnections` so `closeUserConnections(userId, ...)` is O(1) on
 * the lookup AND so a future revocation surface (admin "delete user",
 * self-delete flow) does not have to walk the whole `openConnections`
 * set on every revocation.
 *
 * Storage shape mirrors `WsSubscriptionRegistry.bySession` — one Map
 * keyed by the discriminator (here `userId`) holding Sets of the
 * entities (here `WsConnectionContext`). Empty Sets are pruned via
 * `Map.delete` so the Map's `size` equals the count of distinct users
 * with at least one open connection.
 *
 * **Why the Set carries the full context, not just `connectionId`.**
 * The helper needs to call `socket.close(...)` directly; the registry
 * value is the socket-bearing context so no second lookup is needed.
 * The two-map design that `WsSubscriptionRegistry` uses (a session →
 * connections Map AND a connection → sessions Map) is overkill here:
 * the cleanup path is the connection's own `close` event handler,
 * which already has the `ctx` in scope and can pass it to
 * `removeFromConnectionsByUser(ctx)` in O(1).
 *
 * Cleared by `wsShutdownPreClose` along with `openConnections` so a
 * process restart leaves the registry empty.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/user_soft_delete_ws_close.md.
 */
const connectionsByUser = new Map<string, Set<WsConnectionContext>>();

/**
 * Add a context to `connectionsByUser`. Called from the connection-open
 * path right after `openConnections.add(ctx)`. Idempotent — a re-add of
 * an already-present context is a Set no-op.
 */
function addToConnectionsByUser(ctx: WsConnectionContext): void {
  const userId = ctx.user?.id;
  if (userId === undefined) {
    // The auth gate guarantees `user` is populated for /api/ws (see the
    // defensive narrow inside `buildConnectionHandler`). The guard here
    // is purely for TypeScript's optional-property typing of the
    // `WsConnectionContext.user?` field.
    return;
  }
  let set = connectionsByUser.get(userId);
  if (set === undefined) {
    set = new Set<WsConnectionContext>();
    connectionsByUser.set(userId, set);
  }
  set.add(ctx);
}

/**
 * Remove a context from `connectionsByUser`. Called from the
 * connection-close path right after `openConnections.delete(ctx)`.
 * Idempotent. Empty Sets are pruned so the Map's `size` matches the
 * count of distinct users with at least one open connection.
 */
function removeFromConnectionsByUser(ctx: WsConnectionContext): void {
  const userId = ctx.user?.id;
  if (userId === undefined) {
    return;
  }
  const set = connectionsByUser.get(userId);
  if (set === undefined) {
    return;
  }
  set.delete(ctx);
  if (set.size === 0) {
    connectionsByUser.delete(userId);
  }
}

/**
 * Close every still-open WS connection owned by `userId` with the
 * canonical auth-revoked close code (`WS_AUTH_REVOKED_CLOSE_CODE` =
 * 4401) and reason (`WS_AUTH_REVOKED_REASON` = `'auth-revoked'` by
 * default; callers may override).
 *
 * Returns the number of connections that were targeted by the close
 * loop (i.e. the size of the per-user Set at the start of the call).
 * The counter is captured from a snapshot before any `socket.close`
 * fires so the return value is stable regardless of re-entrant close
 * handlers mutating the index mid-iteration.
 *
 * **Per-connection error isolation.** Each `socket.close(...)` call is
 * wrapped in a try/catch — an already-torn-down socket throwing must
 * not prevent the helper from closing the other connections that
 * share the same userId. Mirrors the `wsShutdownPreClose` pattern.
 *
 * **No DB query.** The helper trusts its caller (the future
 * admin-delete-user surface) to have already performed the soft-delete
 * via `UPDATE users SET deleted_at = NOW()`. Re-querying inside the
 * helper would fork the source of truth and open a race window.
 *
 * **Reason truncation.** RFC 6455 §5.5.1 caps the WS close-frame
 * reason at 123 bytes; the helper truncates an over-long reason
 * defensively rather than throwing. A caller that passes a longer
 * string still gets the desired semantic; the wire reason carries
 * the first 123 bytes.
 *
 * **In-flight dispatches.** This helper closes the socket; it does
 * NOT proactively abort in-flight handler work (a `propose` mid-
 * DB-write completes its transaction). The dispatcher's send path
 * discovers the closed socket on the next `socket.send(...)` attempt
 * and logs via its existing send-error seam. This matches the
 * broader project invariant that the WS layer is a transport, not a
 * transaction manager.
 *
 * **No production caller in v1.** The trigger surface (admin
 * "delete user" endpoint, self-delete flow) is deferred to a future
 * `admin_user_delete` task. This helper lands here so the structural
 * primitive is in place; the wire-up happens later. See the
 * refinement for the scoping rationale.
 *
 * Closes `docs/security/m3-review/coverage.md` G-003. Refinement:
 *   tasks/refinements/backend-hardening/user_soft_delete_ws_close.md.
 *
 * @param userId - the soft-deleted (or otherwise auth-revoked) user id.
 * @param reason - override for the WS close-frame reason. Defaults to
 *                 `WS_AUTH_REVOKED_REASON`. Truncated to 123 bytes.
 * @returns the count of connections the helper attempted to close.
 */
export function closeUserConnections(
  userId: string,
  reason: string = WS_AUTH_REVOKED_REASON,
): number {
  const set = connectionsByUser.get(userId);
  if (set === undefined || set.size === 0) {
    return 0;
  }
  // Snapshot to a fresh array BEFORE iterating: the `socket.close(...)`
  // call below triggers the connection's `close` event synchronously
  // for a socket already in OPEN state, which re-enters
  // `removeFromConnectionsByUser(ctx)` and mutates the underlying Set.
  // Iterating the live Set would risk skipping elements.
  const snapshot = [...set];
  // Truncate the reason defensively. RFC 6455 §5.5.1: 123 bytes.
  // `Buffer.byteLength('utf8')` matches what `socket.close(...)`
  // actually serialises on the wire (the `ws` library copies the
  // reason into a UTF-8 buffer); truncation by code units would
  // either over- or under-shoot for multibyte characters.
  let safeReason = reason;
  if (Buffer.byteLength(safeReason, 'utf8') > WS_CLOSE_REASON_MAX_BYTES) {
    // Walk down a byte-budget by characters. Slicing by characters is
    // safer than `Buffer.subarray(...).toString('utf8')` which can
    // split a multibyte sequence and produce a replacement-character
    // tail. The loop converges in O(reason.length).
    let truncated = safeReason;
    while (Buffer.byteLength(truncated, 'utf8') > WS_CLOSE_REASON_MAX_BYTES) {
      truncated = truncated.slice(0, -1);
    }
    safeReason = truncated;
  }
  for (const ctx of snapshot) {
    try {
      // Only emit a structured close when the socket can produce a
      // frame. `ws` readyState values: 0=CONNECTING, 1=OPEN,
      // 2=CLOSING, 3=CLOSED.
      if (ctx.socket.readyState === 1 || ctx.socket.readyState === 0) {
        // `socket.close(code, reason)` writes the close frame to the
        // client (carrying the 4401 / 'auth-revoked' signal the client
        // reads as "your session is no longer valid"); the underlying
        // `ws` library then waits up to `closeTimeout` (default 30s)
        // for the client's close echo before firing the server-side
        // `close` event. A misbehaving (or slow-to-echo) client must
        // not leave a stale entry in `connectionsByUser` /
        // `openConnections` for 30 seconds, AND a server that's
        // revoking an attacker's auth must not depend on the attacker
        // cooperating with the close handshake to surface the cleanup.
        // Calling `socket.terminate()` immediately after `close()`
        // forces the server-side close event to fire synchronously
        // (the close frame has already been queued on the wire — the
        // client still receives 4401 + 'auth-revoked'); the server's
        // own cleanup path (`socket.on('close', ...)` in
        // `buildConnectionHandler`) runs without waiting for the
        // peer's response.
        ctx.socket.close(WS_AUTH_REVOKED_CLOSE_CODE, safeReason);
        ctx.socket.terminate();
      }
    } catch {
      // Defensive — a torn-down socket would throw on .close(). One
      // bad socket must not prevent the loop from reaching the rest.
      // Logging would require a Fastify instance reference the helper
      // does not carry; the failure mode (a single dead socket in the
      // index) is self-healing because the close event for that
      // socket will still drain the index entry via the normal
      // `removeFromConnectionsByUser(ctx)` path.
    }
  }
  return snapshot.length;
}

/**
 * Resolver bundle the route's `preValidation` auth gate reaches for.
 * Constructed by the outer plugin (which owns the option-resolution
 * closure) and passed into the inner route plugin via plugin options.
 *
 * Pulled out as an interface so the route plugin doesn't need to know
 * how the resolvers are constructed — only that they exist. Production
 * resolvers reach for `getDefaultPool()` and
 * `resolveSessionTokenSecret(process.env)` lazily on first use; tests
 * pin a memory-backed pool plus a fixed secret and clock.
 *
 * The `originAllowlist` field carries the env-resolved WS upgrade
 * `Origin`-header allowlist (per
 * `tasks/refinements/backend-hardening/ws_origin_allowlist.md`):
 * either the dev-only `'*'` sentinel (any origin accepted; cookie
 * check still runs) or an explicit list of normalized origin strings.
 * The gate's narrowing reads the typed sentinel rather than a magic
 * string.
 */
interface WsAuthResolvers {
  readonly ensurePool: () => DbPool;
  readonly ensureSecret: () => string;
  readonly now: (() => number) | undefined;
  readonly originAllowlist: WsOriginAllowlist;
}

/**
 * Internal Fastify plugin — registers the `GET /api/ws` route. The
 * `@fastify/websocket` library is registered by the OUTER plugin
 * (see `wsConnectionHandlingPlugin` below); registering it here too
 * would either decorate the encapsulation child only (so the root
 * loses `app.injectWS` — breaks tests) or duplicate-decorate (so
 * Fastify throws at startup).
 *
 * The auth resolvers are passed in via plugin options so the inner
 * route's `preValidation` hook can reach them. The outer plugin is
 * the lifecycle owner of the resolved pool + secret; this inner plugin
 * is the consumer.
 */
const wsRoutePlugin: FastifyPluginAsync<{ auth: WsAuthResolvers }> = (app, opts) => {
  const { auth } = opts;

  // Defensive decorator: the auth middleware (`authenticatePlugin`)
  // also pre-allocates `request.authUser` to `undefined`. When the WS
  // plugin is registered in a minimal test app alongside the auth
  // middleware, the decorator already exists — Fastify throws on
  // duplicate decoration without this guard. When the WS plugin is
  // registered standalone (a test app that doesn't also register
  // `authenticatePlugin`), the decorator doesn't exist yet and our
  // `preValidation` hook's `request.authUser = ...` write needs the
  // slot allocated. The `hasRequestDecorator` check keeps the two
  // plugins compose-able in either order.
  if (!app.hasRequestDecorator('authUser')) {
    app.decorateRequest('authUser', undefined);
  }

  app.get(
    '/api/ws',
    {
      websocket: true,
      // Mark as internal/undocumented for OpenAPI: the WS protocol
      // documentation is owned by `ws_protocol_documentation`, not
      // by the OpenAPI surface. `@fastify/swagger` skips routes that
      // declare `hide: true`.
      schema: {
        hide: true,
        tags: ['ws'],
        summary: 'WebSocket upgrade endpoint (auth-gated, placeholder hello envelope)',
        description:
          'WebSocket upgrade endpoint owned by ws_connection_handling. The on-open ' +
          'hello frame `{ type: "hello", connectionId }` is a placeholder envelope ' +
          'and will be replaced by the canonical shape from ws_message_envelope. ' +
          'The upgrade is gated by the same `aconversa-session` cookie the HTTP ' +
          'auth middleware reads — unauthenticated upgrades are rejected with HTTP ' +
          '401 + the canonical envelope BEFORE the handshake completes (no 4xxx ' +
          'close code). Subscription routing and message handling are downstream ' +
          'sibling tasks.',
      },
      // **Auth gate** (`ws_auth_on_connect`). Runs Fastify's normal
      // `preValidation` lifecycle hook on the upgrade request — per
      // @fastify/websocket's README, the request travels through the
      // full HTTP pipeline before the library hijacks the socket. The
      // hook:
      //
      //   1. Reads the `Cookie` header off the upgrade `Request`.
      //   2. Calls `authenticateRequest(cookieHeader, pool, secret, now?)`
      //      — the SAME helper `apps/server/src/auth/middleware.ts`
      //      composes for HTTP routes. No duplicated cookie parsing,
      //      no duplicated JWT verify, no duplicated user lookup.
      //   3. On success: stashes `{ id, screenName }` on
      //      `request.authUser`; the WS handler reads it and copies it
      //      onto the per-connection context.
      //   4. On failure: throws `ApiError(401, 'auth-required', ...)`.
      //      The centralized error-handler plugin renders the
      //      canonical envelope; the response is sent on the raw
      //      upgrade socket; the library's `onResponse` hook destroys
      //      the socket; the client's `injectWS` (or browser
      //      `WebSocket`) sees a non-101 response and the handshake
      //      never completes. NO `connectionId` is minted; NO entry
      //      lands in `openConnections`.
      //
      // 401 + the canonical envelope is the right surface (parallel to
      // every HTTP middleware reject). Inventing a custom 4401 WS
      // close code would diverge from the HTTP envelope for no gain.
      preValidation: async (request, _reply) => {
        // **Origin allowlist gate (ws_origin_allowlist, F-002).** Runs
        // BEFORE the cookie/JWT check so an attacker probing the WS
        // surface from an off-origin page is rejected without paying
        // the cookie-parse + JWT-verify cost AND without any 401-vs-
        // 403 leak about whether the attacker happened to also carry
        // a stolen cookie. Two postures:
        //
        //   - Dev sentinel (`WS_ORIGIN_ALLOWLIST_ANY === '*'`): accept
        //     any `Origin` header value AND accept a missing header
        //     (curl, `injectWS` without an explicit `origin`, etc.).
        //     The cookie+JWT gate is the only auth contract in dev.
        //   - Prod (array of normalized origin strings): REQUIRE an
        //     `Origin` header AND require it to be in the allowlist.
        //     Missing or unlisted → throw `ApiError(403,
        //     ORIGIN_NOT_ALLOWED_CODE, ORIGIN_NOT_ALLOWED_MESSAGE)`,
        //     which the centralized error handler renders as the
        //     canonical envelope on the upgrade response. The library's
        //     `onResponse` hook destroys the socket; `injectWS` (and a
        //     real browser `WebSocket`) sees a non-101 response and
        //     the handshake never completes. No `connectionId` minted;
        //     no per-connection state allocated.
        //
        // The check is byte-equal against the WHATWG-normalized origin
        // strings the resolver produced — no scheme casing, no
        // trailing-slash, no port-default surprise. See
        // `apps/server/src/ws-origin-allowlist.ts` for the resolver
        // contract.
        if (auth.originAllowlist !== WS_ORIGIN_ALLOWLIST_ANY) {
          const rawOrigin = request.headers['origin'];
          const originHeader = typeof rawOrigin === 'string' ? rawOrigin : undefined;
          if (originHeader === undefined || originHeader === '') {
            request.log.debug(
              { route: '/api/ws' },
              'ws-origin-allowlist rejected — upgrade request missing Origin header',
            );
            throw new ApiError(403, ORIGIN_NOT_ALLOWED_CODE, ORIGIN_NOT_ALLOWED_MESSAGE);
          }
          if (!auth.originAllowlist.includes(originHeader)) {
            request.log.debug(
              { route: '/api/ws' },
              'ws-origin-allowlist rejected — upgrade request Origin not on the allowlist',
            );
            throw new ApiError(403, ORIGIN_NOT_ALLOWED_CODE, ORIGIN_NOT_ALLOWED_MESSAGE);
          }
        }

        const rawHeader = request.headers['cookie'];
        const cookieHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
        // **Anonymous upgrade is allowed** (per ADR 0029 + refinement
        // `aud_anonymous_ws_subscribe`). The cookie-on-upgrade contract
        // documented above is RELAXED for `/api/ws`: a missing or
        // invalid cookie no longer 401s; instead the upgrade proceeds
        // with `request.authUser = undefined` and the per-handler
        // visibility checks (subscribe → `canSeeSessionAnonymously`;
        // every write handler → wire `forbidden` envelope) enforce the
        // privacy boundary at the data layer. The origin-allowlist
        // gate above is unchanged — anonymous upgrade does NOT relax
        // the same-origin / production-allowlist contract.
        //
        // Short-circuit BEFORE resolving the pool when no cookie is
        // present. `authenticateRequest` would do the same internally
        // (its first step is `readSessionCookieFromHeader`), but
        // pulling the check up here means the lazy pool resolution
        // doesn't fire for anonymous upgrades — important in tests +
        // dev where `DATABASE_URL` may not be set and
        // `getDefaultPool()` throws.
        if (cookieHeader === undefined || cookieHeader === '') {
          request.log.debug(
            { route: '/api/ws' },
            'ws-auth-on-connect: no session cookie — proceeding as anonymous',
          );
          // `request.authUser` is left unset (the `exactOptionalPropertyTypes`
          // distinction: omitted, not explicitly `undefined`). The
          // connection handler reads it back as `undefined` either way.
          return;
        }
        const authUser = await authenticateRequest(
          cookieHeader,
          auth.ensurePool(),
          auth.ensureSecret(),
          auth.now,
        );
        if (authUser === null) {
          // Cookie was present but invalid (expired / forged /
          // soft-deleted user). Treat as anonymous for the
          // audience-surface case; a malicious actor who forged a
          // cookie does not bypass the anonymous-only visibility
          // check (the SQL fragment in `canSeeSessionAnonymously` is
          // strictly `privacy = 'public' AND ended_at IS NULL`).
          //
          // `request.authUser` is left unset (the
          // `exactOptionalPropertyTypes` distinction: omitted, not
          // explicitly `undefined`). The connection handler reads it
          // back as `undefined` either way.
          request.log.debug(
            { route: '/api/ws' },
            'ws-auth-on-connect: cookie present but verify/lookup failed — proceeding as anonymous',
          );
          return;
        }
        request.authUser = authUser;
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
  // Drop the per-user index alongside the open-connections set so a
  // process restart leaves both registries empty (closes
  // `docs/security/m3-review/coverage.md` G-003 — the auth-revoked
  // helper's lookup table). The Map's contents reference the same
  // contexts already drained from `openConnections`; clearing both is
  // strictly bookkeeping symmetry.
  connectionsByUser.clear();
  done();
}

/**
 * Options accepted by `wsConnectionHandlingPlugin`. Every field
 * optional — production callers pass `{}` (or nothing) and the plugin
 * reaches for env-driven defaults. Mirrors the `AuthMiddlewareOptions`
 * shape so the two plugins compose against the same primitives.
 *
 * Tests supply the secret + a stubbed pool + (optionally) a fixed
 * clock to keep the auth-gate verification deterministic.
 */
export interface WsConnectionHandlingOptions {
  /**
   * Database pool. When absent the plugin lazily calls
   * `getDefaultPool()` on the first authenticated upgrade. Tests pass
   * a memory-backed shim or a pglite-backed adapter so the user-row
   * lookup `authenticateRequest` runs hits the test DB.
   */
  readonly pool?: DbPool;
  /**
   * HMAC key for verifying the platform session JWT. When absent the
   * plugin reads `SESSION_TOKEN_SECRET` via `resolveSessionTokenSecret`
   * lazily on first use. Shared with `session-token.ts` and the auth
   * middleware — the same env var, the same key, the same JWT.
   */
  readonly sessionTokenSecret?: string;
  /**
   * Clock injection for hermetic tests. When absent verification uses
   * `Date.now`. Tests pin a fixed value so an "expired token" case
   * runs deterministically without timer manipulation.
   */
  readonly now?: () => number;
  /**
   * Resolved WS upgrade `Origin`-header allowlist. Either the dev-only
   * `'*'` sentinel (any Origin or missing Origin accepted; the
   * cookie/JWT gate is the only auth contract in dev) or an explicit
   * list of WHATWG-normalized origin strings (production: Origin
   * REQUIRED and must appear byte-equal in the array). Owned by
   * `tasks/refinements/backend-hardening/ws_origin_allowlist.md`
   * (closes `docs/security/m3-review/auth.md` F-002).
   *
   * Production callers in `createServer()` pass the resolver output
   * (`resolveWsOriginAllowlist(process.env)`). Tests pass `'*'` for a
   * permissive default or a tight array (e.g.
   * `['https://app.example.com']`) for the gate's reject/accept
   * variants.
   */
  readonly originAllowlist: WsOriginAllowlist;
  /**
   * Optional override for the per-connection subscription cap (closes
   * `docs/security/m3-review/inputs.md` F-001). When absent the
   * subscriptions plugin reads `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION`
   * (default `MAX_SUBSCRIPTIONS_PER_CONNECTION` = 32). Tests inject
   * small values (e.g. 3) to exercise the cap deterministically
   * without `process.env` mutation. Owned by
   * `tasks/refinements/backend-hardening/subscription_cap_per_connection.md`.
   */
  readonly maxSubscriptionsPerConnection?: number;
}

/**
 * Inner plugin body — typed `FastifyPluginAsync<WsConnectionHandlingOptions>`
 * so `opts` receives the proper shape (the `fp(...)` wrapper below
 * loses the generic if the body is inlined; mirrors the
 * `authenticatePluginAsync` + `fp(...)` split in `auth/middleware.ts`).
 */
const wsConnectionHandlingPluginAsync: FastifyPluginAsync<WsConnectionHandlingOptions> = async (
  app,
  opts,
) => {
  // Resolve pool + secret lazily — production callers pass `{}` and
  // the plugin reaches for the singleton pool + the env secret on
  // the first upgrade. Tests inject everything up front.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  let resolvedSecret: string | undefined = opts.sessionTokenSecret;
  const ensureSecret = (): string => {
    if (resolvedSecret !== undefined) {
      return resolvedSecret;
    }
    resolvedSecret = resolveSessionTokenSecret(process.env);
    return resolvedSecret;
  };

  const auth: WsAuthResolvers = {
    ensurePool,
    ensureSecret,
    now: opts.now,
    originAllowlist: opts.originAllowlist,
  };

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
  // `options.maxPayload` is the incoming-frame size ceiling. Closes
  // `docs/security/m3-review/inputs.md` F-002 — without this, the
  // upstream `ws` library defaults to 100 MiB and a hostile client
  // can force the dispatcher to JSON.parse a 100 MiB frame just to
  // reject it as malformed-envelope. With this set, the receiver
  // rejects oversized frames at the WS framing layer and closes the
  // socket with code 1009 ("Too Big") BEFORE any JSON parser sees a
  // byte. The 64 KiB default is env-overridable via
  // `WS_MAX_PAYLOAD_BYTES`; `maxPayload` only gates the receive path
  // (verified against `ws@8.20.0`'s `receiver.js`), so outgoing
  // `snapshot-state` frames are not affected. Refinement:
  //   tasks/refinements/backend-hardening/fastify_body_limit.md.
  await app.register(fastifyWebsocket, {
    options: { maxPayload: resolveWsMaxPayload(process.env) },
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

  // Per-app-instance WS message dispatcher. Decorates
  // `app.wsDispatcher` (skip-override via fastify-plugin so the
  // decoration reaches the root scope). Sibling message-type plugins
  // (`ws_propose_message`, `ws_vote_message`, ...) register handlers
  // against this dispatcher; the connection handler below calls
  // `app.wsDispatcher.dispatch(...)` for every inbound message.
  // Refinement: tasks/refinements/backend/ws_message_envelope.md.
  await app.register(wsDispatcherPlugin);

  // Per-app-instance WS subscription registry. Decorates
  // `app.wsSubscriptions`. The connection-close hook (above) calls
  // `removeConnection(...)`; the `subscribe` / `unsubscribe` message
  // handlers (registered by `wsHandlersPlugin` in `server.ts`) reach
  // for `subscribe(...)` / `unsubscribe(...)`; the broadcast surface
  // (`ws_event_broadcast`) reaches for `connectionsForSession(...)`.
  // The cap option (per-connection subscription cap, env-tunable,
  // default 32) is threaded through here so tests can inject a small
  // value without mutating `process.env`. Refinements:
  //   tasks/refinements/backend/ws_subscribe_to_session.md,
  //   tasks/refinements/backend-hardening/subscription_cap_per_connection.md.
  await app.register(wsSubscriptionsPlugin, {
    ...(opts.maxSubscriptionsPerConnection !== undefined
      ? { maxSubscriptionsPerConnection: opts.maxSubscriptionsPerConnection }
      : {}),
  });

  // Per-app-instance WS broadcast surface. The bus (`app.wsBroadcast`)
  // accepts `event-applied` emissions from the session-management
  // routes after their `session_events` INSERT commits; the per-
  // connection sender registry (`app.wsConnectionSenders`) holds the
  // (connectionId -> send-on-this-socket) lookup the broadcast
  // listener fans out through. Registering the broadcast subscriber
  // (`wsEventAppliedBroadcastPlugin`) wires the listener to the bus
  // so emits are observed. Refinement:
  // tasks/refinements/backend/ws_event_broadcast.md.
  await app.register(wsBroadcastPlugin);
  await app.register(wsConnectionSendersPlugin);
  await app.register(wsEventAppliedBroadcastPlugin);

  // Route + shutdown hook stay encapsulated to the child plugin —
  // only the library decorations need to hoist. The auth resolvers
  // are threaded through plugin options so the route's
  // `preValidation` hook can reach them.
  await app.register(wsRoutePlugin, { auth });
};

/**
 * Public entry point — register this in `server.ts`'s `createServer`
 * factory alongside the existing `await app.register(...)` calls.
 * The export is `fastify-plugin`-wrapped only at the outermost layer
 * so the decorations `@fastify/websocket` injects
 * (`app.websocketServer`, `app.injectWS`, `request.ws`) are
 * available at the root scope — tests that build a Fastify instance
 * via `createServer()` and call `app.injectWS('/api/ws')` need the
 * decoration on the root.
 *
 * The route registration itself is still encapsulated inside the
 * internal plugin above; only the library's decorations are hoisted.
 */
export const wsConnectionHandlingPlugin = fp(wsConnectionHandlingPluginAsync, {
  name: 'ws-connection-handling',
  fastify: '5.x',
});

/**
 * Test-only inspector — returns a snapshot of the open-connection
 * contexts as a readonly array. Test code uses this to assert that
 * the per-connection `user` field was populated by the auth gate
 * (the property is server-private; we don't expose it on the wire
 * yet — `ws_event_broadcast` will eventually surface it as a sender
 * id, but for `ws_auth_on_connect` the check is purely
 * server-internal).
 *
 * The double-underscore prefix marks the export as test-only — same
 * convention as `__buildTestAuthApp` and `__buildStubConfiguration`.
 * Production callers should never reach for this; the
 * connection-context shape is not a public surface and may change
 * with downstream tasks.
 */
export function __getOpenConnectionsForTests(): readonly WsConnectionContext[] {
  return Array.from(openConnections);
}

/**
 * Test-only inspector — returns the count of distinct user ids with
 * at least one open WS connection (i.e. `connectionsByUser.size`).
 * Used by the soft-delete tests to assert that
 * `closeUserConnections(...)` pruned the per-user index entry after
 * closing every connection it covered.
 *
 * The double-underscore prefix marks the export as test-only — same
 * convention as `__getOpenConnectionsForTests`.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/user_soft_delete_ws_close.md.
 */
export function __getConnectionsByUserSizeForTests(): number {
  return connectionsByUser.size;
}

/**
 * Test-only inspector — returns a snapshot of the open
 * `WsConnectionContext`s owned by `userId`. Used by the soft-delete
 * tests to assert that the per-user index is populated correctly on
 * open and drained on close.
 *
 * Returns an empty array when no connection is recorded for the user.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/user_soft_delete_ws_close.md.
 */
export function __getConnectionsForUserForTests(userId: string): readonly WsConnectionContext[] {
  const set = connectionsByUser.get(userId);
  return set === undefined ? [] : [...set];
}

/**
 * Options accepted by `__buildTestWsApp`.
 */
export interface BuildTestWsAppOptions {
  /** DB pool the auth gate consults for the user-row lookup. */
  readonly pool: DbPool;
  /** HMAC key used to sign + verify the session JWT in tests. */
  readonly sessionTokenSecret: string;
  /** Optional clock override for hermetic expired-token cases. */
  readonly now?: () => number;
  /**
   * Optional snapshot-fallback threshold for the catch-up handler.
   * Tests that exercise the slice-replay vs. snapshot-fallback
   * branching of `ws_reconnection_handling` pass a small value
   * (e.g. 3) so the threshold can be crossed in a hermetic setup.
   * Absent → the handler reads the env (`WS_CATCHUP_MAX_EVENTS`)
   * with a default of 500.
   */
  readonly catchUpMaxEvents?: number;
  /**
   * Optional per-connection rate-limit cap for the catch-up handler
   * (envelopes per 60-second window). Tests that exercise the F-004
   * rate-limit reject path pass a small value (e.g. 2). Absent → the
   * handler reads the env (`WS_CATCH_UP_MAX_PER_MINUTE`) with a
   * default of 10. Refinement:
   *   tasks/refinements/backend-hardening/catch_up_event_limit.md.
   */
  readonly catchUpRateLimitPerWindow?: number;
  /**
   * Optional WS `Origin`-header allowlist for the upgrade gate. Tests
   * that aren't about the Origin gate pass nothing — the builder
   * defaults to `WS_ORIGIN_ALLOWLIST_ANY` (`'*'`) so any Origin or a
   * missing Origin header is accepted and the cookie gate stays the
   * only auth contract under test. Tests that exercise the
   * `ws_origin_allowlist` gate's reject/accept variants pass a tight
   * array (e.g. `['https://app.example.com']`).
   */
  readonly originAllowlist?: WsOriginAllowlist;
  /**
   * Optional per-connection subscription cap. Defaults to the
   * env-resolved value (`WS_MAX_SUBSCRIPTIONS_PER_CONNECTION` or 32);
   * tests that exercise the cap pass a small value (e.g. 3 or 5) so
   * the boundary is reachable in a hermetic setup.
   */
  readonly maxSubscriptionsPerConnection?: number;
}

/**
 * Test-only convenience — build a minimal Fastify instance with the
 * shared error-envelope schema, the error-handler plugin, the auth
 * middleware (so its `decorateRequest('authUser')` slot is allocated
 * and the type augmentation is consistent), and the WS plugin all
 * wired against the same pool + secret + clock. Used by both Vitest
 * (`connection.test.ts`, `auth.test.ts`) and Cucumber
 * (`backend-ws-auth.steps.ts`) — single builder so the WS surface
 * under test is identical across layers.
 *
 * Production code does NOT use this helper — `createServer()` in
 * `server.ts` wires the full stack including OpenAPI, CORS,
 * auth-routes, sessions-routes, etc. This helper is the minimum
 * Fastify instance needed to exercise the WS plugin's auth-gate
 * behavior end-to-end.
 *
 * The double-underscore prefix marks the export as test-only. Mirrors
 * `__buildTestAuthApp` in `auth/routes.ts`.
 */
export async function __buildTestWsApp(
  opts: BuildTestWsAppOptions,
): Promise<import('fastify').FastifyInstance> {
  // Importing dynamically so the test tsconfig (which doesn't resolve
  // `fastify` directly because that dep lives under
  // `apps/server/node_modules`) can still consume this helper from
  // outside the server workspace boundary. Resolved at runtime by
  // Node's module resolver since this module lives under
  // `apps/server`. Mirrors the dynamic-import pattern in
  // `__buildTestAuthApp`.
  const { default: fastifyFactory } = await import('fastify');
  const { errorHandlerPlugin } = await import('../error-handler.js');
  const { errorEnvelopeSchema } = await import('../openapi.js');
  const { authenticatePlugin } = await import('../auth/middleware.js');
  const { wsHandlersPlugin } = await import('./handlers/index.js');
  const app = fastifyFactory({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  // Register the auth middleware so its `request.authUser` decorator
  // is allocated at the root scope (mirroring `createServer`'s
  // ordering). The WS plugin's defensive `hasRequestDecorator` check
  // makes the registration idempotent — but keeping the middleware
  // registered keeps the test app's shape identical to production's.
  await app.register(authenticatePlugin, {
    pool: opts.pool,
    sessionTokenSecret: opts.sessionTokenSecret,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  await app.register(wsConnectionHandlingPlugin, {
    pool: opts.pool,
    sessionTokenSecret: opts.sessionTokenSecret,
    originAllowlist: opts.originAllowlist ?? WS_ORIGIN_ALLOWLIST_ANY,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.maxSubscriptionsPerConnection !== undefined
      ? { maxSubscriptionsPerConnection: opts.maxSubscriptionsPerConnection }
      : {}),
  });
  // Register the WS message-type handlers (subscribe / unsubscribe
  // today; more land as their owning tasks ship). Must run AFTER
  // `wsConnectionHandlingPlugin` — that plugin decorates the
  // dispatcher and the subscription registry, both of which
  // `wsHandlersPlugin` reaches for at registration time.
  await app.register(wsHandlersPlugin, {
    pool: opts.pool,
    ...(opts.catchUpMaxEvents !== undefined ? { catchUpMaxEvents: opts.catchUpMaxEvents } : {}),
    ...(opts.catchUpRateLimitPerWindow !== undefined
      ? { catchUpRateLimitPerWindow: opts.catchUpRateLimitPerWindow }
      : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  // Register the WS diagnostic broadcast surface so the cucumber +
  // integration tests can exercise the full bridge:
  // `app.wsDiagnosticBroadcast.notifyForSession(...) → DiagnosticBus
  // → WS fan-out`. Mirrors `createServer`'s registration order —
  // AFTER the connection-handling plugin (so the connection-sender
  // registry + subscription registry are present) and AFTER the
  // handlers plugin (so subscribe handling is wired). Refinement:
  // tasks/refinements/backend/ws_diagnostic_broadcast.md.
  const { wsDiagnosticBroadcastPlugin } = await import('./broadcast/diagnostic.js');
  await app.register(wsDiagnosticBroadcastPlugin);

  // Register the WS proposal-status broadcast surface so the cucumber
  // + integration tests can exercise the derived `proposal-status`
  // envelope path: a propose/vote/commit/meta-disagreement-marked
  // event fired through `app.wsBroadcast` is filtered + reprojected
  // into a per-facet status envelope and fanned out via
  // `app.wsConnectionSenders`. Mirrors `createServer`'s registration
  // order — AFTER `wsEventAppliedBroadcastPlugin` (registered inside
  // `wsConnectionHandlingPlugin`) so the bus's synchronous-dispatch
  // order is `event-applied` → `proposal-status`. Refinement:
  // tasks/refinements/backend/ws_proposal_status_broadcast.md.
  const { wsProposalStatusBroadcastPlugin } = await import('./broadcast/proposal-status.js');
  await app.register(wsProposalStatusBroadcastPlugin, { pool: opts.pool });

  await app.ready();
  return app;
}
