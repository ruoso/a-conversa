// Barrel for the moderator's local-state Zustand stores.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
//
// Three focused local-state slices — capture (in-progress proposal),
// selection (currently-selected entity), and UI chrome (sidebar pane +
// zoom). The server-state slice (`useWsStore`) is owned by `mod_ws_client`
// and re-exported here for convenience so callers have one barrel for
// every moderator-side Zustand store.

export { useCaptureStore, type CaptureMode, type CaptureState } from './captureStore.js';
export { useFlashStore, type FlashState } from './flashStore.js';
export { useSelectionStore, type Selection, type SelectionState } from './selectionStore.js';
export { useUiStore, type SidebarPane, type UiState, MIN_ZOOM, MAX_ZOOM } from './uiStore.js';
export {
  useWsStore,
  type WsConnectionStatus,
  type WsSessionState,
  type WsState,
} from '../ws/wsStore.js';
