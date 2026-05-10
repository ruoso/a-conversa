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

## Decisions

- **Workspace structure: pnpm workspaces** (R3). Top-level layout:
  - `apps/server` — backend (TypeScript on Node), HTTP + WebSocket server, event-log writer, projection runtime.
  - `apps/moderator` — moderator-UI frontend (React).
  - `apps/participant` — participant tablet frontend (React).
  - `apps/audience` — audience surface frontend (React).
  - `apps/replay` (or merged into `apps/audience`) — replay viewer + test mode (decision deferred until those surfaces are refined).
  - `packages/shared-types` — TypeScript types shared between server and clients (event payloads, API contracts).
- **Migrations location: `apps/server/migrations/`** (R4). Ships with the backend service and runs from there.
- **Top-level task runner: Makefile at root** (R5). Thin wrappers around `docker compose` and `pnpm` — keeps `make up` as the headline command.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10. ADR: [docs/adr/0010-directory-layout-pnpm-workspaces.md](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md).

Top-level tree as committed:

```
apps/
  server/         @a-conversa/server
  moderator/      @a-conversa/moderator
  participant/    @a-conversa/participant
  audience/       @a-conversa/audience
packages/
  shared-types/   @a-conversa/shared-types
docs/             design docs and ADRs
scripts/          stack-validation throwaways (ADRs 0001/0003/0004/0005)
tests/            root-level smoke tests for the test runners
tasks/            TaskJuggler WBS and per-task refinements
Makefile          top-level operator entry point
pnpm-workspace.yaml
package.json      (root, packageManager: pnpm@9.15.4)
pnpm-lock.yaml
```

`apps/replay` is **deferred** — the replay viewer / test-mode surface may merge into `apps/audience` or land as its own workspace; the replay refinement decides. Migrations directory under `apps/server/migrations/` is also deferred to the migration-runner task.

Verification: `pnpm -r ls` lists all six workspaces; root smoke tests (`test:smoke`, `test:behavior:smoke`, `test:e2e:smoke`) and one-off scripts (`smoke:react`, `smoke:reactflow`, `smoke:cytoscape`, `smoke:tailwind`) all pass post-migration.
