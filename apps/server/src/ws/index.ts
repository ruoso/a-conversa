// Barrel for the WebSocket plugin family. Today re-exports only the
// connection-lifecycle plugin (ws_connection_handling); downstream
// websocket_protocol tasks (auth, subscribe, envelope, message types,
// broadcasts, reconnection) will add their own exports here.
//
// Refinement: tasks/refinements/backend/ws_connection_handling.md
// TaskJuggler: backend.websocket_protocol.ws_connection_handling

export {
  WS_CLOSE_CODES,
  WS_TEST_FORCE_ERROR_HEADER,
  wsConnectionHandlingPlugin,
  type WsConnectionContext,
  type WsHelloPlaceholder,
} from './connection.js';
