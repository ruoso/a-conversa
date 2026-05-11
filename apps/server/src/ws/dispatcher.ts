// WebSocket message dispatcher — registry + dispatch surface.
//
// Refinement: tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_message_envelope
//
// **What this module owns.**
//
// `WsDispatcher` — a per-server-instance registry that maps the
// envelope's `type` discriminator to a handler function. Downstream
// message-type tasks (`ws_propose_message`, `ws_vote_message`,
// `ws_commit_message`, `ws_meta_disagreement_message`,
// `ws_snapshot_message`, `ws_error_message`) each call
// `dispatcher.register('<type>', handler)` from their own plugin /
// setup hook.
//
// `wsDispatcherPlugin` — a Fastify plugin that constructs a dispatcher
// per app instance and decorates it onto `app.wsDispatcher`. Mirrors
// the pattern `authenticatePlugin` uses for `app.authenticate`:
// `fastify-plugin`-wrapped + skip-override so sibling plugins in any
// encapsulation can reach for the dispatcher.
//
// **Why per-app-instance (not module-scoped).** Each `createServer()`
// call gets its own dispatcher. Tests build a fresh app instance per
// scenario and need a clean handler registry; a module-scoped registry
// would carry handlers across instances and tests would interfere with
// each other.
//
// **Unknown-type policy.** When the inbound envelope's `type` is in
// the closed `WsMessageType` enum (so `parseWsEnvelope` accepted it)
// but no handler is registered, the dispatcher logs a warn-level line
// with `connectionId`, `messageId`, and `messageType` AND sends a
// canonical `error` envelope on the connection with `code:
// 'unknown-message-type'` and `inResponseTo = envelope.id`. The wire-
// format error envelope is owned by `ws_error_message`; this
// dispatcher's default `onUnknownType` reaches for `sendWsError` so
// production code paths emit the wire envelope without further
// wiring. The seam stays replaceable so a downstream task can override
// (e.g. a metrics-emitting seam) without changing the contract.
//
// **Handler-exception policy.** A handler's thrown error or rejected
// promise is caught by the dispatcher, logged at error level with the
// envelope id + type for correlation, AND surfaced as an `error`
// envelope on the connection. Discrimination: if the thrown value is
// `ApiError`-shaped (duck-typed via `isApiErrorShape`), the wire
// envelope echoes its `code` + `message`; otherwise the wire envelope
// emits the generic `code: 'internal-error'` / `message: 'internal
// error'` and the full underlying error stays in the server log only
// (the no-leak rule from `ws_error_message`).

import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { WsEnvelopeUnion, WsMessageType } from '@a-conversa/shared-types';

import type { WsConnectionContext } from './connection.js';
import {
  isApiErrorShape,
  sendWsError,
  WS_INTERNAL_ERROR_CODE,
  WS_INTERNAL_ERROR_MESSAGE,
  WS_UNKNOWN_MESSAGE_TYPE_CODE,
} from './error-envelope.js';

/**
 * The shape every message handler implements. Receives the typed
 * envelope and the connection context; returns a `Promise<void>`
 * because most handlers will reach for the DB or emit broadcasts
 * asynchronously. Thrown errors / rejected promises are caught by the
 * dispatcher.
 */
export type WsMessageHandler<T extends WsMessageType = WsMessageType> = (
  envelope: Extract<WsEnvelopeUnion, { type: T }>,
  connection: WsConnectionContext,
) => Promise<void>;

/**
 * Optional dispatcher-construction options. Today only the seams the
 * downstream `ws_error_message` task will fill in.
 */
export interface WsDispatcherOptions {
  /**
   * Callback invoked when a parsed envelope arrives for a `type` with
   * no registered handler. Receives the envelope (so the error
   * response can echo `id` via `inResponseTo`) and the connection
   * (so the error envelope can be sent on the right socket).
   *
   * Today the default implementation logs at warn level and returns.
   * `ws_error_message` will replace the default with one that
   * constructs and sends a typed error envelope on the connection.
   */
  onUnknownType?: (envelope: WsEnvelopeUnion, connection: WsConnectionContext) => void;
  /**
   * Callback invoked when a handler throws / rejects. Receives the
   * thrown value, the originating envelope (for `inResponseTo`
   * correlation), and the connection.
   *
   * Today the default implementation logs at error level and returns.
   * `ws_error_message` will replace it with the wire-format
   * error envelope.
   */
  onHandlerError?: (
    err: unknown,
    envelope: WsEnvelopeUnion,
    connection: WsConnectionContext,
  ) => void;
}

/**
 * Per-server-instance message dispatcher.
 *
 * Created by `wsDispatcherPlugin`; reachable from any plugin's
 * `app.wsDispatcher`. Sibling message-type plugins call
 * `register(type, handler)` once at registration time; the connection
 * handler calls `dispatch(envelope, connection)` for every inbound
 * message.
 */
export class WsDispatcher {
  /**
   * The closed registry. Keys are `WsMessageType` values; values are
   * the registered handler (or undefined if no task has registered
   * for that type yet).
   *
   * `Partial<Record<WsMessageType, …>>` rather than `Record<…>` because
   * the registry is filled incrementally as message-type tasks land;
   * the unknown-handler path is exercised when a type is in the enum
   * but not yet wired.
   */
  private readonly handlers: Partial<Record<WsMessageType, WsMessageHandler>> = {};

  private readonly log: FastifyBaseLogger;

  private readonly onUnknownType: (
    envelope: WsEnvelopeUnion,
    connection: WsConnectionContext,
  ) => void;

  private readonly onHandlerError: (
    err: unknown,
    envelope: WsEnvelopeUnion,
    connection: WsConnectionContext,
  ) => void;

  constructor(log: FastifyBaseLogger, opts: WsDispatcherOptions = {}) {
    this.log = log;
    // Defaults log + send the canonical `error` envelope on the
    // connection (per `ws_error_message`). Replaceable via opts so a
    // downstream task (metrics emitter, alternate transport, ...) can
    // override without changing the contract.
    this.onUnknownType =
      opts.onUnknownType ??
      ((envelope, connection) => {
        this.log.warn(
          {
            connectionId: connection.connectionId,
            messageId: envelope.id,
            messageType: envelope.type,
          },
          'ws-dispatcher: no handler registered for message type — sending unknown-message-type error envelope',
        );
        // Wire-format error envelope. `inResponseTo` correlates the
        // error back to the originating client envelope.
        try {
          sendWsError((wire) => connection.socket.send(wire), {
            code: WS_UNKNOWN_MESSAGE_TYPE_CODE,
            message: `no handler registered for message type '${envelope.type}'`,
            inResponseTo: envelope.id,
          });
        } catch (sendErr) {
          // Defensive — `sendWsError` can throw on a torn-down socket.
          // The dispatcher must not crash on a per-connection send
          // failure; log and continue (the original warn above is
          // already in the log).
          this.log.warn(
            { err: sendErr, connectionId: connection.connectionId, messageId: envelope.id },
            'ws-dispatcher: failed to send unknown-message-type error envelope on socket',
          );
        }
      });
    this.onHandlerError =
      opts.onHandlerError ??
      ((err, envelope, connection) => {
        this.log.error(
          {
            err,
            connectionId: connection.connectionId,
            messageId: envelope.id,
            messageType: envelope.type,
          },
          'ws-dispatcher: handler threw or rejected — sending error envelope',
        );
        // Discriminate via duck-typing. `ApiError`-shaped throws have
        // a safe-to-echo `message` (the handler chose it); other
        // throws (plain `Error`, programmer mistakes, DB driver
        // errors, ...) surface the generic literal so we don't leak
        // stack / column-name / hostname details to the client.
        const safe = isApiErrorShape(err);
        try {
          sendWsError((wire) => connection.socket.send(wire), {
            code: safe ? err.code : WS_INTERNAL_ERROR_CODE,
            message: safe ? err.message : WS_INTERNAL_ERROR_MESSAGE,
            inResponseTo: envelope.id,
          });
        } catch (sendErr) {
          // Same defensive log + continue as the unknown-type seam.
          this.log.warn(
            { err: sendErr, connectionId: connection.connectionId, messageId: envelope.id },
            'ws-dispatcher: failed to send error envelope on socket',
          );
        }
      });
  }

  /**
   * Register a handler for the given message `type`. Replaces any
   * previously-registered handler — only one handler per type. The
   * generic narrows the handler's `envelope` parameter to the
   * matching per-type shape so the handler body type-checks without
   * a runtime cast.
   *
   * Called by each message-type task's plugin / setup hook.
   *
   * @param type the discriminator value to bind the handler to.
   * @param handler the handler function.
   */
  register<T extends WsMessageType>(type: T, handler: WsMessageHandler<T>): void {
    // The double-cast through `unknown` widens the per-type handler
    // back to the storage shape (`WsMessageHandler<WsMessageType>`).
    // It's safe because the registry is keyed by the same `type` the
    // handler narrowed against; the `dispatch` call below re-narrows
    // on the way out. A direct cast trips
    // `Type 'WsMessageHandler<T>' is not comparable to ...` because
    // the storage type is contravariant in the envelope param.
    this.handlers[type] = handler as unknown as WsMessageHandler;
  }

  /**
   * Dispatch a parsed envelope to its registered handler.
   *
   * Unknown-type path: the dispatcher's `onUnknownType` callback fires
   * and the method returns (no throw). Handler-exception path: the
   * dispatcher catches and routes to `onHandlerError`; the method
   * still returns.
   *
   * Returning rather than throwing keeps the connection handler's
   * receive loop simple — one dispatch per message; failures are
   * surfaced via the seams, not by re-throwing.
   *
   * @param envelope the typed envelope from `parseWsEnvelope`.
   * @param connection the per-connection context.
   */
  async dispatch(envelope: WsEnvelopeUnion, connection: WsConnectionContext): Promise<void> {
    const handler = this.handlers[envelope.type];
    if (handler === undefined) {
      this.onUnknownType(envelope, connection);
      return;
    }
    try {
      // The cast is the inverse of the one in `register`: the storage
      // shape is widened, but the runtime invariant is that
      // `handlers[envelope.type]` was registered with a handler narrowed
      // to `Extract<WsEnvelopeUnion, { type: typeof envelope.type }>`,
      // so calling it with `envelope` (which is exactly that type at
      // runtime) is sound.
      await handler(envelope, connection);
    } catch (err) {
      this.onHandlerError(err, envelope, connection);
    }
  }
}

/**
 * Fastify plugin: construct a `WsDispatcher` per app instance and
 * decorate it onto `app.wsDispatcher`.
 *
 * `fastify-plugin`-wrapped so the decoration reaches the root scope
 * (sibling plugins in any encapsulation can call
 * `app.wsDispatcher.register(...)`). Mirror of the
 * `authenticatePlugin` pattern.
 *
 * The dispatcher's logger is `app.log` — same instance the connection
 * handler uses. No parallel pino instance.
 */
const wsDispatcherPluginAsync: FastifyPluginAsync = (app: FastifyInstance) => {
  // Guard against re-decoration. Production registers the plugin once;
  // a defensive check keeps the failure mode explicit if a future test
  // pattern lands a second `createServer()` against the same instance.
  if (!app.hasDecorator('wsDispatcher')) {
    app.decorate('wsDispatcher', new WsDispatcher(app.log));
  }
  return Promise.resolve();
};

export const wsDispatcherPlugin = fp(wsDispatcherPluginAsync, {
  name: 'a-conversa-ws-dispatcher',
  fastify: '5.x',
});

// -- TypeScript augmentation ---------------------------------------
//
// Adds the `wsDispatcher` field to `FastifyInstance`. The augmentation
// lives in this file (not a separate `.d.ts`) because the type
// `WsDispatcher` is owned here — keeping the augmentation co-located
// makes it easy to see what's been added when reading the runtime
// module. Same trade-off documented in `auth/types.d.ts` (which lives
// separately because the augmentation references types from multiple
// modules; here only one module's surface widens, so co-location wins).

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The per-app-instance WS message dispatcher. Sibling message-type
     * plugins call `app.wsDispatcher.register('<type>', handler)`; the
     * connection handler calls `app.wsDispatcher.dispatch(...)` for
     * every inbound message.
     */
    wsDispatcher: WsDispatcher;
  }
}
