// Barrel for the participant's local-state Zustand stores.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// Three focused local-UI slices — vote (pending facet votes), selection
// (currently-selected entity), and UI chrome (current tab + zoom). The
// server-state slice (`useWsStore`) lives in `apps/participant/src/ws/`
// and is re-exported here for convenience so callers have one barrel
// for every participant-side Zustand store (mirrors the moderator's
// `apps/moderator/src/stores/index.ts`).

export { useVoteStore, voteKey, type VoteValue, type VoteState } from './voteStore.js';
export { useSelectionStore, type Selection, type SelectionState } from './selectionStore.js';
export { useUiStore, type ParticipantTab, type UiState, MIN_ZOOM, MAX_ZOOM } from './uiStore.js';
export {
  useWsStore,
  type WsConnectionStatus,
  type WsSessionState,
  type WsState,
} from '../ws/wsStore.js';
