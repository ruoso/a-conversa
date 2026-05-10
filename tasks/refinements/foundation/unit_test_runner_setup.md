# Wire up the unit test runner

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.test_infra.unit_test_runner_setup`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.stack_decisions.test_unit_framework_decision` (settled — Vitest + happy-dom + v8 coverage)

## What this task is

Install Vitest in the workspace, set up the per-workspace `vitest.config.ts`, wire up coverage, and ensure `pnpm test:unit` runs unit tests across all workspaces. Component tests use React Testing Library inside frontend workspaces; backend tests use plain Vitest in `apps/server`.

## Why it needs to be done

Every `*_unit_tests` task across the WBS depends on the runner being installed and working. Without this, no unit-level test can run.

## Inputs / context

- Vitest with `@vitest/coverage-v8` and happy-dom.
- React Testing Library for `apps/moderator`, `apps/participant`, `apps/audience` (and wherever else React components live).
- pnpm workspaces; project-references-aware tsconfig; ESLint; Prettier.

## Decisions

- **Per-workspace `vitest.config.ts`**: each `apps/*` and `packages/*` workspace has its own config inheriting from a shared base in `packages/test-config/` (or `vitest.config.base.ts` at root).
- **Backend tests use Node environment**; frontend tests use happy-dom.
- **Test files**: `*.test.ts` (and `*.test.tsx` for React components) co-located with source.
- **Coverage**: v8 provider, target 80% line / 80% branch on the steady-state path. Failing CI on under-coverage is left disabled until coverage stabilizes.
- **Watch mode** for local DX (`pnpm test:unit --watch`).
- **Top-level `pnpm test:unit`** runs all workspaces; per-workspace `pnpm test:unit` runs that workspace only.

## Acceptance criteria

- Vitest installed at the root (devDependency in root `package.json`).
- A shared base config (`vitest.config.base.ts` or `packages/test-config/`) referenced by per-workspace configs.
- Each frontend workspace has React Testing Library set up; renders a trivial component in a test.
- The backend has at least one trivial Vitest spec.
- `pnpm test:unit` runs across all workspaces and passes.
- CI runs the unit-test step (extends `ci_config`).
