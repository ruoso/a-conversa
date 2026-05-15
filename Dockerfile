# a-conversa application image — multi-stage build.
#
# See docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md for the
# rationale (multi-stage; build on node:lts Debian; runtime on
# node:lts-alpine; pnpm via Corepack; single image serves all
# surfaces).
#
# Stages:
#   deps    — install pnpm workspace deps with --frozen-lockfile
#   build   — copy source, run `pnpm -r build`
#   runtime — slim Alpine image carrying only what runs
#
# Build:    docker build -t a-conversa-app:dev .
# Run:      docker run --rm a-conversa-app:dev
#
# The runtime entry point runs the Fastify-based HTTP server
# (apps/server/dist/index.js) per ADR 0023 and ADR 0015's Amendment.
# As of `backend.api_skeleton.health_endpoint` (2026-05-10) the
# server also applies pending migrations on startup (ADR 0020 C6)
# and answers `/healthz` for the compose healthcheck.
# `deployment.prod_container` will iterate on this Dockerfile for
# production.

ARG NODE_VERSION=20
ARG PNPM_VERSION=9.15.4

# ---------------------------------------------------------------------------
# deps — resolve and install workspace dependencies.
#
# Only manifests + lockfile are copied so this layer caches across
# source-only changes. Native modules compile here under Debian's
# usual toolchain.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

# Workspace topology — root + per-workspace manifests + lockfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json        ./apps/server/package.json
COPY apps/moderator/package.json     ./apps/moderator/package.json
COPY apps/participant/package.json   ./apps/participant/package.json
COPY apps/audience/package.json      ./apps/audience/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json

# `prepare` (Husky) runs on `pnpm install`; skip it inside Docker —
# there's no .git directory and no need for client-side git hooks.
ENV HUSKY=0
RUN pnpm install --frozen-lockfile


# ---------------------------------------------------------------------------
# build — compile every workspace.
#
# `pnpm -r build` walks all workspaces; `apps/server` and
# `packages/shared-types` actually emit JS via `tsc -b`, the React
# frontends are placeholder no-ops until the bundler task lands.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

WORKDIR /app

RUN corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

# Bring in the entire resolved workspace tree from deps. Source code
# isn't there yet (the deps stage only copied manifests + lockfile),
# so the next COPY layers in the rest. pnpm may or may not create
# per-workspace `node_modules/` symlinks depending on hoisting; copying
# the whole /app tree handles either case without enumerating them.
COPY --from=deps /app /app

# Layer the source on top. Existing manifests are overwritten with
# identical content; everything else (src/, tsconfig.json, etc.) is
# fresh.
COPY . .

RUN pnpm -r build


# ---------------------------------------------------------------------------
# runtime — slim Alpine image carrying only what's needed to run.
#
# The entry point runs the compiled Fastify server (see ADR 0023);
# the runtime stage carries the emitted JS, the production-only
# node_modules tree, and nothing else.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime

ARG PNPM_VERSION
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

WORKDIR /app

# Corepack + pnpm so the runtime can install production-only deps
# in this stage. Kept around at runtime for migration / admin tooling
# the api_skeleton task may want to invoke (`pnpm exec ...`).
RUN corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

# Manifests + lockfile, again — needed for `pnpm install --prod`.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json        ./apps/server/package.json
COPY apps/moderator/package.json     ./apps/moderator/package.json
COPY apps/participant/package.json   ./apps/participant/package.json
COPY apps/audience/package.json      ./apps/audience/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json

# Production-only install. Skips devDependencies (typescript, eslint,
# vitest, etc.) so the runtime layer stays small.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Carry the compiled outputs from the build stage. Source `.ts/.tsx`
# does not ship; only emitted JS + .d.ts.
COPY --from=build /app/apps/server/dist            ./apps/server/dist
COPY --from=build /app/packages/shared-types/dist  ./packages/shared-types/dist

# The migration runner (both the startup gate and the standalone
# `scripts/migrate.ts` CLI) reads SQL files from
# `apps/server/migrations/`. They're plain `.sql` (no build step), so
# we copy them verbatim from the build context's `apps/server/migrations/`
# checkout via the build stage. Without this, the startup gate hits
# ENOENT and the container restart-loops with a clear "Can't get
# migration files" error (which is the gate doing its job).
COPY --from=build /app/apps/server/migrations      ./apps/server/migrations

# Moderator SPA bundle — the Fastify server's
# `staticFrontendsPlugin` (registered last in
# `apps/server/src/server.ts` per
# tasks/refinements/backend/serve_static_frontends.md) serves these
# static assets from the same process as the JSON API, so the
# deployment is a single origin (one hostname + port answers both
# `/` HTML and `/api/sessions` JSON). The server fails fast at boot if
# the dist tree is absent; an image that strips this layer would
# crash at startup instead of silently degrading to a JSON-only API.
#
# The `MODERATOR_DIST_DIR` env var can override this location at
# runtime; the default the plugin resolves to
# `apps/moderator/dist` relative to the server's compiled output,
# which under this image layout is `/app/apps/moderator/dist`.
#
# Participant, audience, and replay don't have a `dist/` yet
# (stubbed apps) — when their bundlers land, add the matching
# `COPY --from=build /app/apps/<name>/dist ./apps/<name>/dist`
# line and a matching frontend entry in the static-frontends plugin.
COPY --from=build /app/apps/moderator/dist         ./apps/moderator/dist

# Drop privileges. The `node` user (uid 1000) ships with the official
# image and owns nothing under /app — that's fine for the read-only
# bundle we ship.
USER node

EXPOSE 3000

# Real entry point — the Fastify-based HTTP server bootstrap (ADR 0023).
# On start, applies any pending migrations against `DATABASE_URL`
# (ADR 0020 C6, settled in `backend.api_skeleton.health_endpoint`)
# and then listens on :3000. The compose `app` service's healthcheck
# targets `/healthz`, which is now wired and flips the container to
# `healthy` once the listen succeeds.
CMD ["node", "/app/apps/server/dist/index.js"]
