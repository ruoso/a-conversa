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
