# Production Dockerfile — the production iteration pass

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_container.prod_dockerfile`
**Effort estimate**: 1d
**Inherited dependencies**: `root_app.root_moderator_cutover`, `backend.api_skeleton.serve_static_frontends_multi_surface` (both settled — the multi-surface static layout the image must carry).
**Executor**: implementation agent. Not itself in milestone `m_predeploy_agent_work`, but it gates `prod_image_minimization`, which is — the two land as one Dockerfile rework in consecutive commits.

## What this task is

The production iteration pass on the foundation Dockerfile that
[ADR 0015](../../../docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md)
explicitly deferred ("`deployment.prod_container` will iterate on
this Dockerfile for production" — reconfirmed by the 2026-06-10
completion audit, which found prod_dockerfile "open by design").
Concretely:

1. **Restructure the runtime dependency story.** The foundation image
   ran `pnpm install --prod` *inside the runtime stage*, which (a)
   installs production deps for **every** workspace — the React
   frontends' `react` / `cytoscape` / `i18next` trees ship in the
   image even though frontends are served as static `dist/` — and
   (b) requires corepack + pnpm in the runtime layer. A dedicated
   `prod-deps` stage performs a server-filtered production install
   (`--filter @a-conversa/server...`), and the runtime stage just
   copies the result.
2. **Confirm and document the production posture**: `NODE_ENV=production`
   baked, `USER node`, `EXPOSE 3000`, plain-`node` entry (the server
   registers its own SIGINT/SIGTERM handlers — no init shim needed),
   migrations + multi-surface dist layout unchanged.

## Why it needs to be done

- `prod_image_minimization` (M9-prep) depends on this leaf and
  builds directly on the restructure; Railway builds this exact
  Dockerfile on every release (ADR 0031), so the production pass is
  what actually ships.
- The runtime-stage install was the foundation-era compromise; in
  production it inflates the image with never-executed frontend
  dependency trees and keeps a package manager in the serving
  container.

## Inputs / context

- **ADR 0015** (+ Amendment): multi-stage, Debian build / Alpine
  runtime, pnpm via Corepack, single image serves all surfaces.
- **Server runtime deps** (`apps/server/package.json`): fastify
  stack, pg, jose, openid-client, node-pg-migrate, @sentry/node,
  pino(+pretty), zod — and exactly one workspace dep,
  `@a-conversa/shared-types`. Everything else in the workspace is
  build-time-only for the image.
- **Static surfaces**: the server's `staticFrontendsPlugin` fails
  fast at boot if `apps/root/dist` / `apps/moderator/dist` are
  missing; all surface `dist/` trees are plain static files needing
  no runtime node_modules.
- **pnpm filtered install**: `pnpm install --frozen-lockfile --prod
  --ignore-scripts --filter @a-conversa/server...` installs the
  server workspace + its workspace dependency closure only. The full
  manifest topology must still be present (the lockfile's importers
  cover every workspace), which the existing manifest-COPY block
  already provides.
- **Signal handling**: `apps/server/src/index.ts` registers SIGINT /
  SIGTERM handlers that `app.close()` cleanly — PID-1 `node` is fine
  without tini/dumb-init.

## Constraints / requirements

- New `prod-deps` stage on the same Debian base as `deps`/`build`
  (native modules resolve identically); runtime stage copies the
  installed tree wholesale (same copy-the-tree pattern, and pnpm's
  relative symlink layout survives a whole-tree COPY).
- Runtime stage no longer runs corepack / pnpm at all (their removal
  from the *base image* is the minimization sibling's scope).
- No behavior change: same entry point, same ports, same migration
  + dist layout, same `USER node`; the compose stack and CI e2e job
  build the same file unchanged.
- ADR 0015 gets an Amendment noting the deferred production pass has
  landed and what it changed.
- Validation: the image must build and boot the full compose stack
  green — exercised on a GitHub runner via the rollback-rehearsal
  workflow (the sandbox's network policy blocks registry pulls), in
  the minimization sibling's validation run.

## Acceptance criteria

- Dockerfile has the `prod-deps` stage; the runtime stage contains
  no `corepack`/`pnpm` invocation and no `pnpm install`.
- The rehearsal run (see `prod_image_minimization`) boots the image
  through migrations to `/readyz` 200.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Server-filtered prod install over all-workspace prod install.**
  The frontends are static output; their dependency trees exist in
  the image only because the foundation install didn't filter.
  `--filter @a-conversa/server...` is the smallest correct closure
  and tracks future workspace additions automatically.
- **Copy the whole `/app` tree from `prod-deps`** rather than
  enumerating `node_modules` directories — same rationale as the
  deps→build copy: pnpm's hoisting layout (root `node_modules/.pnpm`
  + per-workspace symlink dirs) is an implementation detail that
  enumeration would couple to. The few stray manifest files carried
  along are bytes.
- **No init shim (tini/dumb-init).** The server's own signal
  handlers cover SIGTERM-driven shutdown; PID-1 zombie reaping is
  irrelevant for a process that spawns no children. Adding an init
  binary would enlarge the attack surface the sibling task exists to
  shrink.
- **`pnpm exec` admin tooling in the runtime image is dropped.** The
  foundation comment kept pnpm "for migration / admin tooling"; in
  practice the migration runner is compiled into the server (startup
  gate) and the standalone CLI is a dev-machine tool. Production
  admin access is Railway's shell against a minimal image, with psql
  living in the postgres service.

## Open questions

(none — all decided)

