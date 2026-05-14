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
  closeUserConnections,
  ORIGIN_NOT_ALLOWED_CODE,
  ORIGIN_NOT_ALLOWED_MESSAGE,
  WS_AUTH_REVOKED_CLOSE_CODE,
  WS_AUTH_REVOKED_REASON,
  WS_CLOSE_CODES,
  WS_TEST_FORCE_ERROR_HEADER,
  wsConnectionHandlingPlugin,
  __buildTestWsApp,
  __getConnectionsByUserSizeForTests,
  __getConnectionsForUserForTests,
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

// `ws_error_message` — canonical server → client error envelope.
// Builder + sender helper reused by the dispatcher seams, the
// connection-level malformed-envelope path, and the subscribe
// handler's visibility-rejection branch.
export {
  buildWsErrorEnvelope,
  isApiErrorShape,
  sendWsError,
  WS_INTERNAL_ERROR_CODE,
  WS_INTERNAL_ERROR_MESSAGE,
  WS_MALFORMED_ENVELOPE_CODE,
  WS_UNKNOWN_MESSAGE_TYPE_CODE,
  type WsErrorEnvelopeOptions,
  type WsErrorSender,
} from './error-envelope.js';

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

// `ws_diagnostic_broadcast` — bridge from the projection-layer
// `DiagnosticBus` to the WS fan-out surface. Decorates
// `app.diagnosticBus` (the per-instance bus) + `app.wsDiagnosticBroadcast`
// (the session-context-aware wrapper); registers `fired` / `cleared`
// listeners that fan out a `diagnostic` envelope to every subscribed
// connection.
export {
  buildDiagnosticBroadcastListener,
  WsDiagnosticBroadcast,
  wsDiagnosticBusPlugin,
  wsDiagnosticBroadcastPlugin,
  type DiagnosticBroadcastActiveContext,
  type DiagnosticBroadcastListener,
  type DiagnosticBroadcastListenerOptions,
  type DiagnosticBroadcastStatus,
} from './broadcast/diagnostic.js';

// `ws_proposal_status_broadcast` — derived per-facet proposal-status
// broadcast subscriber. Listens on `app.wsBroadcast` for the four
// status-affecting event kinds (propose / vote / commit /
// meta-disagreement-marked); computes the current per-facet status
// via `deriveFacetStatus`; fans out a `proposal-status` envelope to
// every connection subscribed to the affected session. Registered
// AFTER `wsEventAppliedBroadcastPlugin` so the bus's synchronous
// dispatch order is `event-applied` → `proposal-status`.
export {
  buildProposalStatusBroadcastListener,
  buildPoolEventLoader,
  wsProposalStatusBroadcastPlugin,
  type ProposalStatusBroadcastListenerOptions,
  type ProposalStatusEventLoader,
  type WsProposalStatusBroadcastOptions,
} from './broadcast/proposal-status.js';
