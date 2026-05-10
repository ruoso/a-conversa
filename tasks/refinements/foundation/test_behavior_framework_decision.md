# Pick behavior-test framework

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.test_behavior_framework_decision`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions.lang_decision` (settled — TypeScript on Node)

## What this task is

Pick the framework that runs the behavior (BDD) test suites across the project. Behavior tests describe scenarios in a structured format (typically Gherkin: Given / When / Then) and exercise the system end-to-end at the scenario level. Used by data-and-methodology, backend, and the UI work streams.

## Why it needs to be done

Each work stream's `*_behavior_tests` task produces Gherkin scenarios. The runner has to be in place first and used consistently across streams.

## Inputs / context

From [tasks/00-foundation.tji](../../00-foundation.tji):

> Pick behavior-test framework. Cucumber / Gherkin or equivalent BDD framework — for scenario-level tests describing system behavior.

The TS/Node ecosystem narrows the candidates:

- **`@cucumber/cucumber`** — the canonical Gherkin runner for Node. Most mature, broadest documentation, integrates with assertion libraries and Playwright cleanly.
- **`@playwright/test` with custom feature-file harness** — Playwright doesn't ship Gherkin support natively; community plugins exist (e.g., `playwright-bdd`). Cleaner unification with E2E if the BDD scenarios always run through a browser.
- **Behave-style alternatives** (`vitest-cucumber`, etc.) — niche, smaller community.

## Constraints / requirements

- Gherkin (Given / When / Then) syntax for scenarios — keeps behavior-test specs readable by non-developers.
- Integrates with the test database provisioning workflow (clean DB per scenario).
- Works against both the backend (HTTP / WebSocket level) and the frontend (browser level via Playwright).

## Acceptance criteria

- Framework chosen and recorded in the ADR log.
- A "hello-scenario" feature file runs in CI and asserts something simple about the running app.
- Wired up to the test-DB provisioning task (`foundation.test_infra.test_db_provisioning`) so each scenario gets a clean DB.

## Decisions

- **Behavior-test framework: `@cucumber/cucumber` standalone** (R2). Runs scenarios at any layer (HTTP, WS, or browser-driving via Playwright when needed). Backend BDD scenarios don't need a browser, so coupling BDD to Playwright would add ceremony for no win. Playwright E2E suites remain separate and Playwright-native.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10.

- ADR: [docs/adr/0007-behavior-test-framework-cucumber.md](../../../docs/adr/0007-behavior-test-framework-cucumber.md)
- Smoke feature: [tests/behavior/hello.feature](../../../tests/behavior/hello.feature)
- Smoke steps: [tests/behavior/steps/hello.steps.ts](../../../tests/behavior/steps/hello.steps.ts)
- Cucumber config: [cucumber.cjs](../../../cucumber.cjs)
- Run: `npm run test:behavior:smoke` (1 scenario, 3 steps, all green).

**Deferred to downstream tasks** (explicitly carried forward, not closed here):

- The "scenario asserts something about the running app" acceptance bullet is deferred to the per-stream `*_behavior_tests` tasks — those tasks own the actual scenarios. The smoke here only proves the runner choice end-to-end.
- CI integration is deferred to `foundation.test_infra.ci_behavior_test_step`.
- Per-scenario clean-DB hookup is deferred to `foundation.test_infra.test_db_provisioning` and `foundation.test_infra.behavior_test_runner_setup`.
