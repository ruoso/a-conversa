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

## Status

**Done** — 2026-05-11.

- Pinned `zustand@5.0.13` in `apps/moderator/package.json` (no `^`, per the project's version-pinning convention).
- Added three store slices under `apps/moderator/src/stores/`:
  - `captureStore.ts` — `useCaptureStore` with `text` / `classification` (typed as `StatementKind` from `@a-conversa/shared-types`) / `targetEntityId` / `mode` (eight-state `CaptureMode` covering F1–F8 capture flows) plus per-field setters and a `reset()` for post-propose cleanup.
  - `selectionStore.ts` — `useSelectionStore` with `selected: { kind: EntityKind, id }` plus `select()` / `clear()`.
  - `uiStore.ts` — `useUiStore` with `activeSidebarPane` (typed `SidebarPane`) and `zoom` (clamped to `[MIN_ZOOM, MAX_ZOOM]`).
- DevTools gating: `stores/devtools.ts` wraps each slice in the Zustand `devtools` middleware behind `import.meta.env.DEV`, so the production Vite bundle tree-shakes the middleware (the moderator `tsconfig.json` picks up the matching ambient types via `"types": ["vite/client"]`).
- `OperateRoute` now subscribes to each store with discrete selectors and renders the live values, satisfying the "trivial component reads from each store and re-renders on update" AC.
- Smoke tests: `apps/moderator/src/stores/stores.test.tsx` covers store initial state, per-field setters, `reset()` / `clear()`, zoom clamping, and React re-renders for each slice (11 new tests; `pnpm run test:smoke` total: 1160 → 1171).
- ESLint, Prettier, `tsc -b`, and `pnpm -F @a-conversa/moderator build` all clean.

Downstream consumers (`mod_ws_client`, `mod_auth_flow`) plug into this surface by adding sibling stores under `apps/moderator/src/stores/` (server-state and auth-state, respectively) — the `stores/` directory and the barrel `index.ts` are the obvious extension point.
