# 0010 — Directory layout: pnpm workspaces with apps/ and packages/

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships one backend service (`@a-conversa/server`) and three React frontends (moderator, participant, audience), all written in TypeScript and sharing event payloads, API contracts, and node/edge shapes. The architectural baseline is recorded in [docs/architecture.md](../architecture.md); the foundation refinement at [tasks/refinements/foundation/dir_layout.md](../../tasks/refinements/foundation/dir_layout.md) settled the workspace shape (R3), the migrations location (R4), and the top-level task runner (R5). What remained was picking the workspace tool and committing the skeleton.

The candidates for the workspace tool were:

- **npm workspaces** — bundled with Node, no extra install. Hoists aggressively into the root `node_modules`, which makes phantom-dependency bugs (a workspace importing a package it doesn't declare, because the root happens to have it) easy to hit.
- **pnpm workspaces** — separate install, but the de-facto pick for multi-package TypeScript repos at this size. Strict by default: each workspace only sees the packages it declares; faster installs via the content-addressable store; first-class `--filter` semantics for running a script in one workspace.
- **yarn workspaces (Berry)** — capable but carries a heavier toolchain (PnP, zero-installs, Plug'n'Play resolution) that we don't need and that adds friction with editor and CI tooling.
- **Turborepo / Nx on top of one of the above** — task orchestration on top of a workspace tool. Premature for v1's six workspaces; can be added later without restructuring.

The repo also already had a flat `package.json` from the stack-validation smoke tests (ADRs 0001 / 0003 / 0004 / 0005) and a checked-in `package-lock.json`. Migrating to pnpm meant picking a stable version, deleting the npm lockfile, and running a fresh install.

## Decision

The repo is a **pnpm workspace** rooted at the existing `package.json`, configured by `pnpm-workspace.yaml`, with `packageManager` pinned to `pnpm@9.15.4` (current stable on Node 20, the LTS we run).

The top-level layout is:

```
apps/
  server/         @a-conversa/server         backend (HTTP + WebSocket, event log, projections)
  moderator/      @a-conversa/moderator      moderator-UI frontend (React)
  participant/    @a-conversa/participant    participant tablet frontend (React)
  audience/       @a-conversa/audience       audience surface frontend (React)
packages/
  shared-types/   @a-conversa/shared-types   event payloads, API contracts, node/edge shapes
docs/             design docs and ADRs
scripts/          stack-validation throwaways (owned by ADRs 0001/0003/0004/0005)
tests/            root-level smoke tests for the test runners
tasks/            TaskJuggler WBS and per-task refinements
Makefile          top-level operator entry point
```

Migrations live at `apps/server/migrations/` per refinement R4 and ship with the backend service. The directory itself isn't created by this task — it lands with the migration-runner work.

The `apps/replay` workspace from the refinement sketch is **not created in this task**. The replay viewer / test-mode surface may end up living inside `apps/audience` (sharing rendering code) or as its own workspace; that decision is deferred to the replay refinement, and adding the directory now would be a guess.

The Makefile at root holds thin wrappers around `pnpm` and (eventually) `docker compose`. `make up` is a placeholder that the dev-env compose task will wire to the real stack; `make install` and `make test` already do the right thing today.

## Consequences

- **Strict dependency hygiene from day one.** A workspace that imports a package it doesn't declare fails at install or runtime, not silently in production. Phantom-dependency bugs are designed out, not whack-a-moled.
- **Single lockfile, single store.** `pnpm-lock.yaml` is checked in at root; the content-addressable store de-duplicates across workspaces. CI installs are fast and reproducible.
- **`packageManager` field pins the tool.** Corepack (or any compliant launcher) reads `pnpm@9.15.4` from the root `package.json` and uses exactly that version, so contributors and CI agree without anyone running `npm install -g`. The pin will be bumped explicitly when we want a new minor.
- **`apps/replay` deferred.** No empty workspace squatting on a name we may not use. The trade-off is one more task-level decision later, accepted explicitly.
- **Stack-validation throwaways stay at root for now.** `scripts/hello-*` and the root-level `tests/` smoke harness belong to ADRs 0001/0003/0004/0005 and will be removed as their corresponding workspaces grow real code. Moving them now would scatter ownership.
- **Linter, formatter, typecheck configs not yet workspace-aware.** Those configs don't exist yet and are owned by separate `repo_skeleton` tasks; when they land they'll choose root-vs-per-workspace placement. This ADR doesn't pre-empt that.
- **Makefile is the headline operator entry point.** The README (and downstream docs) point at `make up`, `make test`, `make install`. Underlying tools change without the operator-facing surface moving.
- **No production code or per-workspace deps land in this task.** Each workspace ships with `package.json` (`name`, `version: 0.0.0`, `private: true`, `type: module`, empty `scripts`) and a README placeholder. Real deps land per workspace as their own tasks fire.

## Amendments

- **2026-05-10** — Linter, formatter, and typecheck configs landed at the repo root, not per-workspace, under [ADR 0011](0011-linter-eslint-with-typescript-eslint.md), [ADR 0012](0012-formatter-prettier.md), and [ADR 0013](0013-typecheck-tsconfig-strict-with-project-references.md). ADR 0013 also adds per-workspace `tsconfig.json` files extending a shared `tsconfig.base.json` (project references). The "not yet workspace-aware" note above is resolved; the placement choice was root-level configs with per-workspace tsconfigs. The decision (pnpm workspaces with `apps/` and `packages/`) is unchanged.
- **2026-05-10** — Workspace `scripts` blocks are no longer empty: [ADR 0015](0015-dockerfile-multi-stage-pnpm-corepack.md) added a `build` script to every workspace (`tsc -b` for `apps/server` and `packages/shared-types`; an explicit no-op echo for the React-frontend placeholders) so `pnpm -r build` walks the whole tree. The decision (workspace shape) is unchanged; only the per-workspace manifest contents grew.
- **2026-05-10** — `make up` is no longer a placeholder. [ADR 0018](0018-compose-file-three-service-dev-stack.md) wired the dev compose stack at `compose.yaml`, and the Makefile's `make up`/`make down`/`make down-v`/`make logs`/`make ps` targets now run the corresponding `docker compose` commands directly. The decision (Makefile as the operator entry point) is unchanged; the wiring behind `make up` is now real.
