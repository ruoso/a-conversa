# Establish source directory layout

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.dir_layout`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions` (lang_decision settled)

## What this task is

Define the top-level directory layout for the repo — where backend code, frontend code, shared types, tests, migrations, scripts, infra config, and docs live. Establish naming and organization conventions.

## Why it needs to be done

Every subsequent task drops files into the repo. A consistent layout from day 1 saves churn later. The README's "Local development" section already references `make up` and Docker Compose; the layout should match what those tools expect.

## Inputs / context

From [docs/architecture.md — frontend surfaces](../../../docs/architecture.md#frontend-surfaces):

> V1 ships four distinct surfaces, sharing a TypeScript codebase ...

From [docs/architecture.md — local development environment](../../../docs/architecture.md#local-development-environment):

> Single Docker container for the application + a managed PostgreSQL.

Repo content already in place:

- `DESIGN.md`, `README.md`, `LICENSE` at root.
- `docs/` for design docs.
- `tasks/` for the TaskJuggler WBS and per-task refinements.
- `project.tjp` at root for the WBS entry point.

## Constraints / requirements

- Backend (TypeScript on Node) and four frontend surfaces share a TypeScript codebase per architecture.md.
- Compose file at root or in a known location, consumable via `make up` / `docker compose up`.
- Migrations directory accessible to the migration runner (node-pg-migrate).
- A clear separation between code, tests, infra, and docs.
- Scripts (e.g., dev startup, seed-data) live somewhere predictable.

## Acceptance criteria

- A documented top-level directory tree.
- The first commit on this layout passes lint, typecheck, and the placeholder test in CI.

## Open questions

- **Monorepo structure: single `package.json` workspace, or several?**
  - **Single workspace, multiple `apps/` and `packages/`** (npm/pnpm workspaces) — common for full-stack TS projects. Backend in `apps/server`, frontend surfaces in `apps/moderator`, `apps/participant`, `apps/audience`, shared types in `packages/shared-types`.
  - **Single monolithic project** — one `package.json`, one `tsconfig.json`, source folders distinguish backend / frontend / shared. Simpler for a small team; may bloat as it grows.
  - **My instinct: workspaces** — the four frontend surfaces will diverge in build config (audience needs OBS-friendly bundle, moderator and participant tablets are real-app surfaces); shared types between server and clients are very real. Workspaces handle this cleanly. **Awaiting input.**
- **Workspace tool: npm workspaces / pnpm workspaces / yarn workspaces?** Strong instinct: **pnpm** (fast, disk-efficient, well-supported). **Awaiting input.**
- **Where do migrations live?** Conventional locations: `migrations/`, `db/migrations/`, or `apps/server/migrations/`. **My instinct: `apps/server/migrations/`** so they ship with the backend service. **Awaiting input.**
- **Top-level scripts: `Makefile` vs. npm scripts vs. shell scripts in `scripts/`?** **My instinct: `Makefile` at root** with thin wrappers around `docker compose` and `pnpm` commands; gives the README's `make up` story a real home. **Awaiting input.**
