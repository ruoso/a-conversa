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

## Open questions

- **Which framework?**
  - **`@cucumber/cucumber` standalone** — runs scenarios at any layer (HTTP, WS, or driving a browser via Playwright). Most flexible; familiar to teams.
  - **`playwright-bdd` (or similar)** — couples BDD to Playwright. Cleaner if all BDD scenarios go through a browser anyway.
  - My instinct: **`@cucumber/cucumber` standalone** — backend BDD scenarios don't need a browser, and we get one runner for everything. The Playwright E2E suites stay separate (and Playwright-native).
  - **Awaiting input.**
