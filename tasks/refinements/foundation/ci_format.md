# Format-check job in CI

**TaskJuggler entry**: `foundation.ci.ci_format` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.25d

## What and why

CI step that runs `prettier --check .` (or equivalent) and fails if any file is unformatted. Catches the case where pre-commit was bypassed.

## Decisions

- Job name: `format`.
- Runs `pnpm format:check` (alias for `prettier --check .`).
- Parallel with `lint`, `typecheck`, `unit-tests`.

## Acceptance criteria

- A `format` job in CI.
- Passes on a clean repo; fails on a deliberately-unformatted file.

## Status

**Done** 2026-05-10. Implemented in [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) as a top-level `format` job (parallel with `lint`, `checks`, `tests`; `needs: setup`). Single step: `pnpm run format:check`. Setup mirrors the `lint` job (checkout, Node 20, Corepack, pnpm install with `HUSKY=0`, shared pnpm store cache key). The `pnpm run format:check` step has been removed from the `checks` job; on this task's completion the `checks` job only runs the three typecheck steps (`typecheck`, `typecheck:tools`, `typecheck:tests`), waiting on `foundation.ci.ci_typecheck` to finish the split and retire the job.
