// Barrel for the moderator's WebSocket client surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md

export {
  createWsClient,
  WsRequestError,
  WsRequestTimeoutError,
  type CreateWsClientOptions,
  type EnvelopeHandler,
  type SendFn,
  type SendOptions,
  type WsClient,
  type WsClientStatus,
  type WsFactory,
  type WsLike,
} from './client.js';
export {
  useWsStore,
  type WsConnectionStatus,
  type WsSessionState,
  type WsState,
} from './wsStore.js';
export {
  WsClientProvider,
  useWsClient,
  type WsClientAuthState,
  type WsClientProviderProps,
} from './WsClientProvider.js';
