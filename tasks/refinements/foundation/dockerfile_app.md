# Dockerfile for the application

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.dev_env.dockerfile_app`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton` (settled — pnpm workspaces, ESLint, Prettier, strict TS, Husky)

## What this task is

Author a Dockerfile that builds and runs the application stack — the backend server (`apps/server`) plus the four frontend surfaces (`apps/moderator`, `apps/participant`, `apps/audience`, and the replay viewer). Used by the local-dev compose stack and (with minor adjustments) for production deployment.

## Why it needs to be done

The local-dev environment runs entirely in Docker Compose (per architecture.md). The dev compose stack needs an image for the application; the production deployment ships a similar image. Both come from this Dockerfile.

## Inputs / context

Stack pieces in place:

- TypeScript on Node, pnpm workspaces (`apps/server`, `apps/moderator`, `apps/participant`, `apps/audience`, `packages/shared-types`, `packages/ui-tokens`, `packages/test-fixtures`).
- Backend serves WebSocket and HTTP; runs node-pg-migrate on startup; refuses to start with pending migrations (per C6).
- Frontend apps are React, built by their bundler (TBD — likely Vite per Vitest pairing).
- Migrations live at `apps/server/migrations/`.
- Local mock OAuth provider runs as a separate container (`dockerfile_mock_oauth`); Postgres also runs as a separate container.

## Constraints / requirements

- **Multi-stage build**: a builder stage that installs dev deps, runs typechecks, builds, and bundles; a runtime stage that ships only what's needed to run.
- **Layer caching friendly**: install dependencies before copying source so dependency layers cache between builds.
- **pnpm-aware**: use pnpm to install, with `pnpm fetch` + `pnpm install --offline` patterns or pnpm's built-in caching.
- **Slim runtime image**: `node:LTS-alpine` (or distroless if we can get pnpm/native deps to cooperate).
- **Single image serves all surfaces**: the same image runs the server, and the frontend bundles are served as static assets from the server. Or each frontend is served from a dedicated path/port. (See open question.)
- **Health endpoint** present (`/healthz`); `dev_env_compose` health checks it.
- **Migration application on startup** built into the image's entry point.

## Acceptance criteria

- `Dockerfile` at the repo root (or `apps/server/Dockerfile`).
- Multi-stage: `deps` → `build` → `runtime`.
- Built image runs the server with migrations applied.
- Built image's size is reasonable (target < 200MB for runtime stage).
- `docker build .` succeeds in CI.
- Image runs cleanly under the local-dev compose stack.

## Decisions

- **Multi-stage build**: deps / build / runtime separated so the runtime layer doesn't carry build tools.
- **Base image: `node:lts-alpine`** for runtime; the build stage uses `node:lts` (Debian-based) so native module compilation has the typical toolchain.
- **pnpm via Corepack** rather than a separate install — `corepack enable && corepack prepare pnpm@<version> --activate` is the contemporary way.

## Additional decisions

- **Single image for v1.** Server serves frontend bundles as static assets. Matches architecture's "single Docker container" framing. Revisit if frontend bundles get unwieldy.
- **Bundler: Vite.** Pairs naturally with Vitest (R17); standard for React + TS in 2026.
- **Alpine runtime base.** Build stage uses `node:lts` (Debian) for native-module compilation; runtime is `node:lts-alpine`. Switch to debian-slim only if musl/glibc friction appears.

## Status

**Done** — 2026-05-10. Landed as [`Dockerfile`](../../../Dockerfile) at the repo root with companion [`.dockerignore`](../../../.dockerignore); rationale captured in [ADR 0015](../../../docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md).

Verified end-to-end: `docker build -t a-conversa-app:dev .` succeeds against the current placeholder repo; `docker run --rm a-conversa-app:dev` prints the stub banner and exits 0. Runtime image size **155 MB** (target was < 200 MB).

**Inevitable revisits**:

- `backend.api_skeleton` will replace the stub `CMD` with the real server entry point (HTTP + WebSocket startup, healthz wiring).
- `data_and_methodology.schema` (migrations) will add the `apps/server/migrations/` tree and the migration-runner; the runtime entry point then needs to apply migrations on startup (per architecture C6).
- The frontend bundler tasks (`apps/{moderator,participant,audience}` Vite wiring) will replace each placeholder workspace's no-op `"build": "echo ..."` script with a real bundler invocation, and their `dist/` directories will need `COPY --from=build` lines added in the runtime stage.
- `deployment.prod_container` will iterate on this Dockerfile for production (image signing, scanning, possibly distroless). The multi-stage shape is intended to be the spine production inherits from.
- `foundation.dev_env.compose_file` is the immediate consumer; it will reference this image by tag.
