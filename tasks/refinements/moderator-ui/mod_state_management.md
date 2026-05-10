# Moderator state management setup

**TaskJuggler entry**: `moderator_ui.mod_shell.mod_state_management` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `mod_app_skeleton` (settled)

## What and why

Set up Zustand-based state management for the moderator's local UI state — pending proposal under construction, current capture mode, selection, etc. Server state (the live event stream) is kept in a separate WebSocket-backed store; this task covers the local UI store only.

## Decisions

- **Library: Zustand** (per `mod_app_skeleton`).
- **Stores**: split into focused slices:
  - `useCaptureStore` — current capture pane state (text, classification, target, mode).
  - `useSelectionStore` — selected node/edge.
  - `useUiStore` — global UI toggles (sidebar pane visibility, zoom level).
- **Persistence**: in-memory only; no localStorage (consistent with token policy).
- **DevTools**: Zustand devtools middleware enabled in dev builds (off in prod).
- **Type-safe selectors** with `zustand/shallow` for derived-state stability.

## Acceptance criteria

- Zustand installed.
- Three store slices wired up in `apps/moderator/src/stores/`.
- A trivial component reads from each store and re-renders on update.
- ESLint / Prettier / typecheck pass.
