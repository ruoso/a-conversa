# Lint job in CI

**TaskJuggler entry**: `foundation.ci.ci_lint` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.25d

## What and why

Add a CI job that runs ESLint against the whole repo; fails the build on lint errors. Catches regressions when contributors bypass the pre-commit hook (`--no-verify`) or when CI's stricter ruleset finds something.

## Decisions

- Job name: `lint`.
- Runs `pnpm lint` (which invokes `eslint .` with the repo's config).
- Runs in parallel with `format`, `typecheck`, `unit-tests` jobs.
- Uses pnpm cache shared with the rest of the workflow.

## Acceptance criteria

- A `lint` job in `.github/workflows/ci.yml`.
- Passes on the empty-but-valid project; fails on a deliberately-introduced lint error.
- Annotates failures inline on the PR via GitHub's lint annotations API (or via `eslint --format @microsoft/eslint-formatter-sarif` output).
