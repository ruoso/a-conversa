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

## Status

**Done** 2026-05-10.

- New `typecheck` job lives in [.github/workflows/ci.yml](../../../.github/workflows/ci.yml),
  parallel with `lint`, `format`, and `tests`, depending only on `setup`.
- Three sequential steps in the one job: `pnpm run typecheck`,
  `pnpm run typecheck:tools`, `pnpm run typecheck:tests`. Splitting into
  three jobs would just multiply checkout/install cold-start cost — each
  step is fast and they share the same TS environment.
- The pnpm store cache is reused via the same key as the other jobs.
  `*.tsbuildinfo` is **not** restored — every CI run does a clean
  type-check from cold, as decided above.
- The transitional `checks` job has been retired in this same change:
  lint, format, and the three typecheck commands now all live in their
  own per-concern jobs (`lint`, `format`, `typecheck`), so `checks` no
  longer has any steps to run.
