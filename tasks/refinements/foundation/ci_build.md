# Build job in CI

**TaskJuggler entry**: `foundation.ci.ci_build` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.5d

## What and why

CI step that builds the application image and the four frontend bundles. Validates that the codebase actually compiles and bundles cleanly. A passing build is the prerequisite for `ci_image_publish`.

## Decisions

- Job name: `build`.
- Runs `pnpm build` (which builds backend `tsc -b` and the four frontend Vite builds).
- Builds the Docker image (multi-stage per `dockerfile_app`) and runs a smoke test (`docker run … /healthz` returns 200).
- Does **not** publish (publish is a separate job tied to release tags).
- Uses Docker buildx with build cache.

## Acceptance criteria

- A `build` job in CI.
- Builds backend and all four frontend bundles.
- Builds the application Docker image.
- A trivial smoke test against the built image succeeds.

## Status

**Done** 2026-05-10.

- Root `build` script added to `package.json` as `"build": "pnpm -r build"`.
  The per-workspace `build` scripts already exist (added by
  `dockerfile_app`): `tsc -b` for `apps/server` and
  `packages/shared-types`, placeholder echoes for the three React
  frontends until the bundler tasks land.
- New `build` job in `.github/workflows/ci.yml`:
  - Reuses the `setup` / pnpm-store-cache pattern of the other jobs
    (checkout, Node 20, Corepack, `pnpm install --frozen-lockfile`,
    `HUSKY=0`).
  - Runs `pnpm run build`.
  - Sets up Docker Buildx via `docker/setup-buildx-action@v3` and
    builds the image with `docker/build-push-action@v6`
    (`tags: aconversa/app:ci`, `load: true`, `push: false`,
    `cache-from: type=gha`, `cache-to: type=gha,mode=max`).
  - Smoke test: `docker run --rm aconversa/app:ci` — the ADR 0015
    stub entry point prints a banner and exits 0. Proves the image
    starts cleanly without depending on a runtime endpoint that
    doesn't exist yet.
  - Depends on `setup`; parallel with `lint` / `format` /
    `typecheck` / `tests`.
  - Does **not** publish — that lives in
    `foundation.ci.ci_image_publish` / `release.yml`.

### Deferred

- HTTP `/healthz` probe: not possible today — the runtime entry point
  is the ADR 0015 stub (no HTTP server). Lands as a follow-up to this
  job once `backend.api_skeleton` adds the real endpoint. The current
  `docker run --rm` is the honest smoke we can do against the stub.
