# a-conversa application image — multi-stage build.
#
# See docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md for the
# rationale (multi-stage; build on node:lts Debian; runtime on
# node:lts-alpine; pnpm via Corepack; single image serves all
# surfaces; entry point is a stub today).
#
# Stages:
#   deps    — install pnpm workspace deps with --frozen-lockfile
#   build   — copy source, run `pnpm -r build`
#   runtime — slim Alpine image carrying only what runs
#
# Build:    docker build -t a-conversa-app:dev .
# Run:      docker run --rm a-conversa-app:dev
#
# The runtime entry point today only prints a banner and exits 0.
# The real entry point (apply migrations, start the HTTP/WebSocket
# server, serve the frontend bundles) lands with backend.api_skeleton
# and the migrations task; deployment.prod_container will iterate on
# this Dockerfile for production.

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
# Today the entry point is a stub banner; the runtime stage exists
# in its final shape so backend.api_skeleton just has to fill in the
# entry point and any extra runtime files.
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
# Frontend dist directories are placeholders today and may not exist
# under the alpine runtime once bundler tasks land — they will be
# copied here too. Intentionally not copied yet.

# Drop privileges. The `node` user (uid 1000) ships with the official
# image and owns nothing under /app — that's fine for the read-only
# bundle we ship.
USER node

EXPOSE 3000

# Stub entry point. Prints a banner identifying the image and the
# deferred work, then exits 0 so the container starts cleanly. The
# real entry point (apply migrations, then start the server) lands
# with backend.api_skeleton + the migrations task.
CMD ["node", "-e", "console.log('a-conversa app image (stub).\\n' + 'No server entry point yet — backend.api_skeleton will wire migrations + HTTP/WebSocket startup.\\n' + 'Built workspaces: @a-conversa/server, @a-conversa/shared-types (frontend bundlers pending).');"]
