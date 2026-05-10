# Participant app skeleton

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_app_skeleton`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton, foundation.stack_decisions.frontend_framework_decision` (both settled)

## What this task is

Scaffold the participant-tablet UI — the React app a debater uses on a tablet during a debate. Read-only graph view (with own + other vote indicators) + per-facet voting controls.

## Why it needs to be done

Every participant flow (P1 through P7 in [participant-ui.md](../../../docs/participant-ui.md)) builds on this skeleton.

## Inputs / context

- React (R1), Vite, Tailwind (R16), Cytoscape.js (R14 — participant tablet matches audience visually).
- Lives at `apps/participant/`.
- Landscape tablet layout (per the v1 default).

## Decisions

- **Workspace location**: `apps/participant/`.
- **Bundler**: Vite.
- **Routing**: simple — `/login`, `/sessions/:id` (the main tablet view).
- **Entry point** `src/main.tsx`.
- **State management**: Zustand (matching `mod_app_skeleton`).
- **Auth flow**: redirect to Authelia on `/login`, capture session token, in-memory storage.
- **Touch-first** interaction defaults: large tap targets, pinch/pan gestures, no hover-only affordances.
- **Same Cytoscape stylesheet as audience** (so the visual matches), customized to add own/other vote indicators per facet.

## Acceptance criteria

- `apps/participant/` with the standard files.
- App renders a login redirect when unauthenticated.
- Tailwind + UI tokens; touch-first sizing tokens applied.
- Routing scaffolded.
- ESLint / Prettier / typecheck pass.
