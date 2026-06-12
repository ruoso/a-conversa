# a-conversa application image — multi-stage build.
#
# See docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md for the
# rationale (multi-stage; build on node:lts Debian; runtime on
# node:lts-alpine; pnpm via Corepack; single image serves all
# surfaces) and its Amendments — the production iteration pass that
# ADR 0015 deferred to `deployment.prod_container` landed via
# tasks/refinements/deployment/prod_dockerfile.md (dedicated
# prod-deps stage; no package manager in the runtime stage) and
# tasks/refinements/deployment/prod_image_minimization.md (runtime
# layer hardening: apk upgrade + npm/corepack/yarn removal).
#
# Stages:
#   deps      — install pnpm workspace deps with --frozen-lockfile
#   build     — copy source, run `pnpm -r build`
#   prod-deps — production-only node_modules for the SERVER workspace
#               closure (the frontends ship as static dist/ and need
#               no runtime dependencies)
#   runtime   — hardened Alpine image carrying only what runs
#
# Build:    docker build -t a-conversa-app:dev .
# Run:      docker run --rm a-conversa-app:dev
#
# The runtime entry point runs the Fastify-based HTTP server
# (apps/server/dist/index.js) per ADR 0023 and ADR 0015's Amendment.
# As of `backend.api_skeleton.health_endpoint` (2026-05-10) the
# server also applies pending migrations on startup (ADR 0020 C6)
# and answers `/healthz` for the compose healthcheck.

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
COPY apps/root/package.json          ./apps/root/package.json
COPY apps/moderator/package.json     ./apps/moderator/package.json
COPY apps/participant/package.json   ./apps/participant/package.json
COPY apps/audience/package.json      ./apps/audience/package.json
COPY apps/test-mode/package.json     ./apps/test-mode/package.json
COPY apps/root/package.json          ./apps/root/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/i18n-catalogs/package.json ./packages/i18n-catalogs/package.json
COPY packages/shell/package.json     ./packages/shell/package.json
COPY packages/graph-view/package.json ./packages/graph-view/package.json
COPY packages/test-fixtures/package.json ./packages/test-fixtures/package.json

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
# prod-deps — production-only node_modules for the server closure.
#
# The runtime process is the compiled Fastify server; its only
# workspace dependency is @a-conversa/shared-types. The frontends are
# served as static dist/ trees and need no runtime node_modules, so
# the install filters to the server workspace + its dependency
# closure (`--filter @a-conversa/server...`) — react / cytoscape /
# i18next and friends never enter the runtime image. Runs on the same
# Debian base as deps/build so native modules (pg, etc.) resolve the
# same way. Refinement:
# tasks/refinements/deployment/prod_dockerfile.md.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

WORKDIR /app

RUN corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

# Full manifest topology — the lockfile's importers cover every
# workspace, so `--frozen-lockfile` needs all of them present even
# though only the server closure gets installed.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json        ./apps/server/package.json
COPY apps/root/package.json          ./apps/root/package.json
COPY apps/moderator/package.json     ./apps/moderator/package.json
COPY apps/participant/package.json   ./apps/participant/package.json
COPY apps/audience/package.json      ./apps/audience/package.json
COPY apps/test-mode/package.json     ./apps/test-mode/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/i18n-catalogs/package.json ./packages/i18n-catalogs/package.json
COPY packages/shell/package.json     ./packages/shell/package.json
COPY packages/graph-view/package.json ./packages/graph-view/package.json
COPY packages/test-fixtures/package.json ./packages/test-fixtures/package.json

RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @a-conversa/server...


# ---------------------------------------------------------------------------
# runtime — hardened Alpine image carrying only what's needed to run.
#
# The entry point runs the compiled Fastify server (see ADR 0023);
# the stage carries the emitted JS, the server-closure production
# node_modules from prod-deps, the SQL migrations, and the static
# surface bundles — no package manager, no compiler, no shellable
# tooling beyond busybox.
#
# Hardening (tasks/refinements/deployment/prod_image_minimization.md):
#   - `apk upgrade` picks up musl/openssl/zlib fixes published since
#     the base tag was cut (the image is rebuilt on every release per
#     ADR 0034, so each release carries the then-current fixes);
#   - npm / corepack / yarn are deleted in the SAME layer — none is
#     referenced by the CMD or any runtime code path, and a serving
#     container has no business carrying package managers.
#
# Signal handling: plain `node` as PID 1 is deliberate — the server
# registers its own SIGINT/SIGTERM handlers (apps/server/src/index.ts)
# and spawns no children, so an init shim would only add surface.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime

ENV NODE_ENV=production

RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /opt/yarn*

WORKDIR /app

# The server-closure production node_modules tree, wholesale — pnpm's
# layout (root node_modules/.pnpm + per-workspace symlink dirs with
# relative targets) survives a whole-tree copy, and enumerating its
# internals here would couple the image to a pnpm implementation
# detail. The stray per-workspace manifest files carried along are
# bytes.
COPY --from=prod-deps /app /app

# Carry the compiled outputs from the build stage. Source `.ts/.tsx`
# does not ship; only emitted JS + .d.ts.
COPY --from=build /app/apps/server/dist            ./apps/server/dist
COPY --from=build /app/apps/root/dist              ./apps/root/dist
COPY --from=build /app/packages/shared-types/dist  ./packages/shared-types/dist

# The migration runner (both the startup gate and the standalone
# `scripts/migrate.ts` CLI) reads SQL files from
# `apps/server/migrations/`. They're plain `.sql` (no build step), so
# we copy them verbatim from the build context's `apps/server/migrations/`
# checkout via the build stage. Without this, the startup gate hits
# ENOENT and the container restart-loops with a clear "Can't get
# migration files" error (which is the gate doing its job).
COPY --from=build /app/apps/server/migrations      ./apps/server/migrations

# Root app + moderator surface bundle — the Fastify server's
# `staticFrontendsPlugin` (registered last in
# `apps/server/src/server.ts` per
# tasks/refinements/backend/serve_static_frontends.md) serves these
# static assets from the same process as the JSON API, so the
# deployment is a single origin (one hostname + port answers both
# `/` HTML, `/_surfaces/*` bundle assets, and `/api/sessions` JSON). The server fails fast at boot if
# the dist tree is absent; an image that strips this layer would
# crash at startup instead of silently degrading to a JSON-only API.
#
# The `ROOT_DIST_DIR` / `MODERATOR_DIST_DIR` env vars can override these locations at
# runtime; the default the plugin resolves to
# `apps/root/dist` and `apps/moderator/dist` relative to the server's
# compiled output, which under this image layout are
# `/app/apps/root/dist` and `/app/apps/moderator/dist`.
COPY --from=build /app/apps/root/dist              ./apps/root/dist
COPY --from=build /app/apps/moderator/dist         ./apps/moderator/dist
COPY --from=build /app/apps/participant/dist       ./apps/participant/dist
COPY --from=build /app/apps/audience/dist          ./apps/audience/dist
COPY --from=build /app/apps/test-mode/dist         ./apps/test-mode/dist

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
