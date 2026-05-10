# Participant state management setup

**TaskJuggler entry**: `participant_ui.part_shell.part_state_management` — [tasks/40-participant-ui.tji](../../40-participant-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `part_app_skeleton` (settled)

## What and why

Set up Zustand-based state management for the participant tablet's local UI — current vote selections, expanded proposal panes, selected node detail.

## Decisions

- **Library: Zustand** (matching `mod_state_management`).
- **Stores**:
  - `useVoteStore` — pending vote actions before they're sent.
  - `useSelectionStore` — selected node/edge.
  - `useUiStore` — pending-proposals tab badge count, current tab.
- **Persistence**: in-memory.
- **DevTools** in dev only.

## Acceptance criteria

- Zustand installed.
- Store slices wired up in `apps/participant/src/stores/`.
- ESLint / Prettier / typecheck pass.
