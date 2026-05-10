# Set up pre-commit hooks

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.pre_commit_hooks`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.repo_skeleton.linter_config`, `foundation.repo_skeleton.formatter_config`, `foundation.repo_skeleton.typecheck_config` (all settled)

## What this task is

Wire up pre-commit hooks that run linter, formatter, and typecheck against staged changes before the commit lands locally. Catches the easy stuff before it hits CI.

## Why it needs to be done

Round-tripping through CI for fixable lint/format errors is slow and noisy in PR reviews. Pre-commit hooks fail fast on the developer's machine.

## Inputs / context

Decisions already in place:

- Linter: ESLint with `typescript-eslint/recommended-type-checked` (R6).
- Formatter: Prettier (R7).
- Typecheck: `tsc --noEmit` against the project-references-aware tsconfig (R8).
- Workspace tool: pnpm workspaces (R3).

Pre-commit-hook tooling for TS/Node:

- **Husky + lint-staged** — the de-facto standard. Husky installs git hooks; lint-staged runs commands against just the staged files (faster than running lint on the whole repo).
- **simple-git-hooks** — lighter alternative to Husky; leaner config; less documentation.
- **pre-commit (Python tool)** — language-agnostic but adds a Python dependency.

## Constraints / requirements

- Runs only against staged files (don't block on unrelated files).
- Auto-formats (Prettier) and re-stages on success.
- Lint and typecheck are blocking errors (no auto-fix beyond Prettier).
- Bypass mechanism (`git commit --no-verify`) is left in git's hands; we don't try to override it.
- Works across pnpm workspaces (the hook should work no matter which workspace's files are staged).

## Acceptance criteria

- A pre-commit hook installed via Husky + lint-staged that runs:
  - `prettier --write` on staged formatable files (re-stages after).
  - `eslint --fix` on staged TS/TSX (re-stages after).
  - `tsc -b` (incremental, project references) on the whole repo — cached after the first run, so most subsequent commits typecheck in well under a second.
- A staged-file commit that violates lint or typecheck rules is rejected.
- A staged-file commit that the formatter cleans up succeeds (with the cleaned content committed).
- Documented in CONTRIBUTING.md (or the README's development section) so contributors know what's running.

## Decisions

- **Tooling: Husky + lint-staged** (R24). Established standard, well-documented, large community.
- **Hook scope: lint, format, typecheck — all three run on every commit** (R24). Typecheck is whole-repo via `tsc -b` (incremental, leverages project-references caching from `typecheck_config`). Catches type errors before they accumulate across commits, while staying fast on the steady-state path. No tests in pre-commit (too slow); CI runs tests.

## Open questions

(none — all decided)
