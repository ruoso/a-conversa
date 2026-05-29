// Barrel for the shell's WebSocket subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md

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
  WsClientProvider,
  useWsClient,
  type WsClientAuthState,
  type WsClientProviderProps,
} from './WsClientProvider.js';
export { createDefaultWsStore, createDefaultWsStoreInitializer } from './defaultStore.js';
export type {
  BaseWsSessionState,
  BaseWsStoreState,
  WsConnectionStatus,
  WsStoreLike,
} from './store-contract.js';
