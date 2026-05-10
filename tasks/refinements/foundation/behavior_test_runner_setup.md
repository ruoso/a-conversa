# Wire up the behavior test runner

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.test_infra.behavior_test_runner_setup`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.stack_decisions.test_behavior_framework_decision` (settled — `@cucumber/cucumber` standalone)

## What this task is

Install `@cucumber/cucumber`, set up Gherkin feature files and step-definition conventions, and ensure `pnpm test:behavior` runs the BDD scenarios across the project.

## Why it needs to be done

Every `*_behavior_tests` task across the WBS depends on this. The behavior layer is where scenario-level coverage lives — backend BDD scenarios run at the HTTP / WebSocket level; frontend BDD scenarios drive the running app via Playwright when needed.

## Inputs / context

- `@cucumber/cucumber` with TypeScript support (via `ts-node` or compiled steps).
- Gherkin feature files use `Given / When / Then` syntax.
- Backend scenarios talk to the running server (real HTTP / WebSocket); frontend scenarios drive a browser via Playwright.
- Each scenario gets a clean test database (`foundation.test_infra.test_db_provisioning`).
- Fixtures from `packages/test-fixtures/` available to scenarios.

## Decisions

- **Feature files live at `apps/*/features/` and `apps/server/features/`** — co-located with the workspace they exercise.
- **Step definitions live at `apps/*/features/steps/`**.
- **Hooks** (Before/After) handle test-DB cleanup per scenario via the test-db-provisioning helper.
- **Test environment**: each scenario starts the server pointed at a clean per-scenario database; for browser-driven scenarios, Playwright launches a fresh browser context.
- **Step-definition style**: shared ambient world; typed via `cucumber-tsflow` or plain function signatures.
- **Top-level `pnpm test:behavior`** runs all feature files; per-workspace `pnpm test:behavior` runs that workspace's scenarios.

## Acceptance criteria

- Cucumber installed (root devDependency).
- A `cucumber.cjs` or `cucumber.json` config at the root pointing at workspace feature paths.
- A "hello scenario" feature in one workspace runs and passes.
- Hooks integrate with `test_db_provisioning` so each scenario has a clean DB.
- CI runs the behavior-test step (extends `ci_config`).
