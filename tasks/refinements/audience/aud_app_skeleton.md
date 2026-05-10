# Audience read-only app skeleton

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_app_skeleton`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton, foundation.stack_decisions.frontend_framework_decision` (both settled)

## What this task is

Scaffold the audience-broadcast surface — the read-only React app that renders the live debate graph and serves as the OBS browser source. This is the v1 "show" surface.

## Why it needs to be done

Every other audience-surface task (graph rendering, animations, OBS sizing, segment markers, URL routing) builds on top of this app skeleton. Without it, there's nothing to wire those features into.

## Inputs / context

- React (R1), Vite (per `dockerfile_app`), Tailwind (R16), Cytoscape.js (R14 — audience uses Cytoscape).
- Lives at `apps/audience/` (per `dir_layout`).
- Designed for OBS browser source: clean typography, animation hooks, distinct visual states.

## Decisions

- **Workspace location**: `apps/audience/`.
- **Bundler**: Vite.
- **Routing**: React Router or Wouter. Audience surface is essentially URL-mapped per session: `/sessions/:id` for live, `/sessions/:id?position=N` for replay-deep-link. Pick during build (no decision needed in skeleton; standard React Router fits).
- **Entry point** `src/main.tsx` mounts `<App />` into `#root`.
- **WebSocket client** lives in `src/lib/ws.ts`, set up to connect to the backend's per-session event stream (concrete protocol comes in `aud_ws_client`).
- **State management**: a small React context plus useReducer for the event-stream state. No Redux or similar — the audience surface's state is straightforward (list of events, derived projection).
- **Static-asset build**: `pnpm --filter audience build` produces a `dist/` that the server serves.
- **Dev server**: `pnpm --filter audience dev` runs Vite's dev server, proxying API/WS to the running backend on the dev compose network.

## Acceptance criteria

- `apps/audience/` with `package.json`, `tsconfig.json` extending the root base, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`.
- App renders a "loading session..." placeholder when navigated to.
- Tailwind configured; design tokens imported from `packages/ui-tokens`.
- `pnpm --filter audience dev` runs the Vite dev server.
- `pnpm --filter audience build` produces a static bundle.
- ESLint / Prettier / typecheck all pass on the skeleton.
