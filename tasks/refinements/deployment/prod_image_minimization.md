# Minimize the production image — size + attack surface

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_container.prod_image_minimization`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_container.prod_dockerfile` (settled in the immediately preceding commit — the production-pass restructure this hardening lands on).
**Executor**: implementation agent — repo-only work, part of milestone `m_predeploy_agent_work` (M9-prep).

## What this task is

Shrink the runtime image and its attack surface on top of the
`prod_dockerfile` restructure:

1. **Remove the package managers from the runtime layer.** With the
   prod install moved to its own stage, the runtime no longer needs
   corepack or pnpm — and the `node:alpine` base's bundled `npm`,
   `corepack`, and `yarn` are pure attack surface in a container
   whose only process is `node dist/index.js`. Delete them.
2. **Refresh the OS packages** (`apk upgrade --no-cache`) so the
   image picks up musl/openssl/zlib CVE fixes published since the
   base tag was cut.
3. **Measure**: before/after image sizes recorded from a clean
   builder, and the boot path re-validated end to end.

## Why it needs to be done

- M9-prep (`m_predeploy_agent_work`) lists this leaf; Railway builds
  this Dockerfile on every release (ADR 0031), so every byte and
  every bundled tool ships to production on every tag.
- Image scanners flag npm's vendored dependency tree perennially;
  removing the package managers eliminates that whole alert class
  for the serving container and removes the "attacker with code
  exec can `npm install` tooling" convenience.

## Inputs / context

- **Post-`prod_dockerfile` Dockerfile** — runtime = `node:20-alpine`
  + copied prod node_modules + dists + migrations; no package-manager
  invocation remains in the runtime stage.
- **`node:alpine` bundled tooling**: `npm` (under
  `/usr/local/lib/node_modules/npm`), `corepack` (sibling dir +
  `/usr/local/bin` symlinks), `yarn` (`/opt/yarn-v*` +  symlinks).
  None is referenced by the `CMD` or by any runtime code path.
- **Validation venue**: the rollback-rehearsal workflow builds the
  image from the working tree on a GitHub runner and boots the full
  compose stack against it (migrations → `/readyz` 200 → rollback
  drill). The implementation-agent sandbox cannot build images (its
  egress policy 403s registry blob CDNs).

## Constraints / requirements

- Runtime stage: `apk upgrade --no-cache` + removal of npm /
  corepack / yarn directories and their `/usr/local/bin` symlinks,
  in the same `RUN` layer (separate layers would carry the deleted
  files in the layer history).
- The build-side stages keep their tooling untouched — minimization
  applies to what ships, not to how it's built.
- No new base image (distroless etc.) — see Decisions.
- Validation on a runner: image builds, full stack boots green
  (`/readyz` 200, migrations applied, rollback drill passes), and
  the before/after sizes are captured into this refinement's Status.
- `node --version` keeps working as `USER node` (the deletions don't
  touch the node binary or its shared libs).

## Acceptance criteria

- `docker run --rm --entrypoint sh <image> -c 'command -v npm pnpm corepack yarn'`
  finds none of them (spot-checked in the validation run).
- The rehearsal run on the minimized image passes end to end.
- Before/after sizes recorded in Status, with the runtime
  node_modules now scoped to the server closure (the
  `prod_dockerfile` restructure) plus this task's base-layer
  deletions.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Stay on `node:alpine`, don't jump to distroless.** Distroless
  node would shave further and drop the shell, but it changes the
  debugging story (no `railway shell`), the user model, and the
  healthcheck patterns the compose/CI stack uses — a bigger
  operational change than a minimization task should smuggle in.
  Alpine-minus-package-managers captures most of the attack-surface
  win at zero operational cost. Revisit post-v1 if scanner noise or
  size actually hurts.
- **Delete tooling rather than switch to a slimmer base tag.** There
  is no official "node, no npm" tag; deletion in the upgrade layer
  is the supported pattern and keeps the Dockerfile's base-image
  story (ADR 0015) unchanged.
- **`apk upgrade` at build time, not pinned package versions.** The
  image is rebuilt on every release (Railway builds from the tag),
  so each release picks up the then-current Alpine fixes;
  reproducibility of the OS layer across rebuilds of the *same* tag
  is not a property v1 needs (the published ghcr artifact is the
  frozen record).
- **No `.dockerignore` changes** — audited; it already excludes
  node_modules, dist, .git, test artifacts, so the build context is
  lean.

## Open questions

(none — all decided)

