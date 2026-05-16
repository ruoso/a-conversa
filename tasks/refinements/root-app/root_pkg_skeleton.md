# root_pkg_skeleton

- **TaskJuggler entry:** [`root_app.root_pkg_skeleton`](../../45-root-app.tji)
- **Effort estimate:** 0.5d
- **Inherited dependencies:** `foundation.repo_skeleton`, `foundation.stack_decisions.frontend_framework_decision`, `frontend_i18n.i18n_catalog_workflow`
- **What this task is:** Creates the `apps/root/` workspace with a basic Vite + React + TypeScript + Tailwind setup, and a `package.json` named `@aconversa/root`. 
- **Why it needs to be done:** This is the host app for the micro-frontend architecture per ADR 0026. It will eventually dispatch routes and mount other surfaces (moderator, participant, audience).
- **Inputs / context:** [ADR 0026](../../docs/adr/0026-micro-frontend-root-app.md).
- **Constraints / requirements:** 
  - Must build using Vite. 
  - Must use Tailwind for styling. 
  - Must be configured as a pnpm workspace under `apps/root/`.
  - Must have `index.html` as it is the root app that runs in the browser directly (unlike the surfaces which use library mode).
- **Acceptance criteria:** 
  - Running `pnpm build` in `apps/root/` completes successfully and produces an `index.html` and assets.
  - Running `pnpm run check` (types + lint) passes for the workspace.
- **Decisions:** 
  - *Standard Vite App:* We use the standard Vite SPA template for the root app, rather than library mode, because the root app is responsible for the initial bootstrap and rendering `index.html` (per ADR 0026).
- **Open questions:** `(none — all decided)`

## Status
**Done** — 2026-05-16.
- Created `apps/root/` workspace.
- Configured Vite, React, TypeScript, and Tailwind.
- Extracted basic UI shell into `index.html`, `src/main.tsx`, and `src/App.tsx`.
- Workspace build and types check passed.
