// Barrel for the WebSocket plugin family. Today re-exports the
// connection-lifecycle + auth-gate + message-envelope + dispatcher
// primitives (ws_connection_handling + ws_auth_on_connect +
// ws_message_envelope); downstream websocket_protocol tasks
// (subscribe, message types, broadcasts, reconnection) will add their
// own exports here.
//
// Refinement: tasks/refinements/backend/ws_connection_handling.md,
//             tasks/refinements/backend/ws_auth_on_connect.md,
//             tasks/refinements/backend/ws_message_envelope.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling,
//              backend.websocket_protocol.ws_auth_on_connect,
//              backend.websocket_protocol.ws_message_envelope

export {
  WS_CLOSE_CODES,
  WS_TEST_FORCE_ERROR_HEADER,
  wsConnectionHandlingPlugin,
  __buildTestWsApp,
  __getOpenConnectionsForTests,
  type BuildTestWsAppOptions,
  type WsConnectionContext,
  type WsConnectionHandlingOptions,
  type WsHelloPlaceholder,
} from './connection.js';

// `ws_message_envelope` — canonical envelope contract + dispatcher.
// The shared envelope schema + parse/serialize helpers re-export
// through this barrel so server-internal callers reach for one path.
// Cross-app consumers (participant / moderator / audience apps)
// import the same types from `@a-conversa/shared-types` directly.
export {
  buildHelloEnvelope,
  buildServerEnvelope,
  parseWsEnvelope,
  parseWsEnvelopeJson,
  serializeWsEnvelope,
  WsEnvelopeValidationError,
  type WsEnvelope,
  type WsEnvelopeUnion,
  type WsMessageType,
  type WsPayloadFor,
} from './envelope.js';
export {
  WsDispatcher,
  wsDispatcherPlugin,
  type WsDispatcherOptions,
  type WsMessageHandler,
} from './dispatcher.js';

// `ws_subscribe_to_session` — per-connection subscription registry.
// Decorated onto `app.wsSubscriptions`; the future broadcast surface
// reaches for `connectionsForSession(...)` to iterate fan-out targets.
export { WsSubscriptionRegistry, wsSubscriptionsPlugin } from './subscriptions.js';
export {
  buildSubscribeHandler,
  buildUnsubscribeHandler,
  registerSubscribeHandlers,
  wsHandlersPlugin,
  type SubscribeHandlerOptions,
  type WsHandlersOptions,
} from './handlers/index.js';
