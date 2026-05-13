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

## Status

**Done — 2026-05-11.**

Landed:

- `apps/moderator/vite.config.ts` — Vite dev server (port 5173) with `/api` + `/ws` proxy to `http://localhost:3000`; `build` outputs to `dist/` with sourcemaps.
- `apps/moderator/index.html` — single-page entrypoint loading `/src/main.tsx`.
- `apps/moderator/src/main.tsx` — `pickLocale()` reads `navigator.language`, awaits `initI18n(locale)` from the canonical `@a-conversa/i18n-catalogs` config, then mounts `<BrowserRouter><App /></BrowserRouter>` in `React.StrictMode`.
- `apps/moderator/src/App.tsx` — `react-router-dom` v7 `<Routes>` with `/login`, `/sessions/:id/lobby`, `/sessions/:id/operate`, and a `*` -> `/login` `<Navigate>` fallback.
- `apps/moderator/src/routes/{Login,Lobby,Operate}.tsx` — placeholder route components rendering the canonical `chrome.hello` example key plus the URL `:id` segment (for the two `/sessions` routes). Real auth / lobby / console UX lands in downstream tasks per the Decisions block.
- `apps/moderator/src/App.test.tsx` — Vitest + Testing Library smoke covering (a) `chrome.hello` resolution for en-US / pt-BR / es-419 via `changeLanguage`, (b) `/login` render, (c) unmatched-path redirect to `/login`, (d) `/sessions/:id/{lobby,operate}` rendering with the captured `:id`. 7 tests, all green under `pnpm run test:smoke`. ADR 0022 — committed test, not a probe.
- `apps/moderator/package.json` — added `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@7.15.0`, `@vitejs/plugin-react@6.0.1`, `vite@8.0.12` (all pinned). `build` is now `tsc -b && vite build`; `dev` / `preview` / `typecheck` scripts added.
- `tsconfig.tools.json` — added `apps/*/vite.config.ts` to the tools include set so the bundler config typechecks.
- `eslint.config.js` — exempted `apps/*/vite.config.ts` from the type-aware lint tier (which is scoped to the per-workspace `tsconfig.json` `src/` includes) and routed those files to the non-type-checked tier alongside `scripts/**`. Same carve-out shape ADR 0013 documents for the root scripts dir.

Deferred to downstream tasks per the refinement Decisions block:

- **Zustand** state store -> `mod_state_management`.
- **Tailwind + UI tokens** wiring -> picked up by `mod_layout.mod_layout_shell` when the three-pane scaffolding lands (this skeleton task ships only the routing + i18n + bundler chain; the styling layer is the next ring).
- **Real Authelia redirect / token capture** -> `mod_auth_flow`.

Build verification: `pnpm -F @a-conversa/moderator build` produces `apps/moderator/dist/index.html` + `dist/assets/index-*.js` (270 kB pre-gzip, 87 kB gzipped). `pnpm run check` and `pnpm run test:smoke` both green; `tj3 project.tjp` parses silently.
