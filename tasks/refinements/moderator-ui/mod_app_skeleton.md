# Moderator app skeleton

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_shell.mod_app_skeleton`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton, foundation.stack_decisions.frontend_framework_decision` (both settled)

## What this task is

Scaffold the moderator-UI app — the React app that gives the moderator full operator capabilities: capture, classify, decompose, run diagnostics, commit, view history, snapshot.

## Why it needs to be done

Every moderator-UI flow (F1 through F10 in [moderator-ui.md](../../../docs/moderator-ui.md)) builds on this skeleton.

## Inputs / context

- React (R1), Vite, Tailwind (R16), ReactFlow (R14 — moderator uses ReactFlow for drag-to-create-edge ergonomics).
- Lives at `apps/moderator/`.
- Three-pane layout: graph canvas, right sidebar, bottom-strip capture pane.

## Decisions

- **Workspace location**: `apps/moderator/`.
- **Bundler**: Vite.
- **Routing**: React Router; routes are `/login`, `/sessions/:id/lobby`, `/sessions/:id/operate` (the main moderator interface).
- **Entry point** `src/main.tsx`.
- **State management**: Zustand (or similar lightweight store) for the moderator's local state — pending proposal under construction, current mode, etc. Server-state lives in the WebSocket-backed event store, separate from local UI state.
- **Auth flow**: redirect to Authelia on `/login`, capture session token, store in memory (or sessionStorage) — never localStorage to keep tokens out of long-lived storage.
- **Dev server**: `pnpm --filter moderator dev` runs Vite, proxies API/WS to backend.

## Acceptance criteria

- `apps/moderator/` with the standard files.
- App renders a login redirect when unauthenticated.
- Tailwind + UI tokens wired up.
- Routing scaffolded with the three routes above (placeholder pages).
- ESLint / Prettier / typecheck pass.
