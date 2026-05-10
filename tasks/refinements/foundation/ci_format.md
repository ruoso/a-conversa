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
