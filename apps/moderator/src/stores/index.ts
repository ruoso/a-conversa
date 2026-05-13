// Barrel for the moderator's local-state Zustand stores.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
//
// Three focused slices — capture (in-progress proposal), selection
// (currently-selected entity), and UI chrome (sidebar pane + zoom).
// Server state (the live event stream and projection) is owned by the
// `mod_ws_client` task and lives in its own store; this barrel
// intentionally does not re-export anything from there.

export { useCaptureStore, type CaptureMode, type CaptureState } from './captureStore.js';
export { useSelectionStore, type Selection, type SelectionState } from './selectionStore.js';
export { useUiStore, type SidebarPane, type UiState, MIN_ZOOM, MAX_ZOOM } from './uiStore.js';
