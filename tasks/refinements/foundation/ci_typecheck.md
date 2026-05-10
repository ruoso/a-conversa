# Typecheck job in CI

**TaskJuggler entry**: `foundation.ci.ci_typecheck` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.25d

## What and why

CI step that runs `tsc -b` against the whole repo and fails on type errors. Even though pre-commit runs typecheck (per R24), CI is the canonical safety net — it catches issues that bypass pre-commit and runs in a known-clean environment.

## Decisions

- Job name: `typecheck`.
- Runs `pnpm typecheck` (alias for `tsc -b`).
- Parallel with `lint`, `format`, `unit-tests`.
- TypeScript build cache (`tsbuildinfo`) **not** restored from cache in CI — clean type-check every run.

## Acceptance criteria

- A `typecheck` job in CI.
- Passes on a clean repo; fails on a deliberately-introduced type error.
