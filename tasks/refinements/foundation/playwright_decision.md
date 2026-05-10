# Confirm Playwright for web E2E

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.playwright_decision`
**Effort estimate**: 0.25d
**Inherited dependencies**: `foundation.stack_decisions.frontend_framework_decision` (settled — React)

## What this task is

Confirm Playwright as the framework that drives the web-UI end-to-end tests for moderator, participant, audience, replay, and test-mode surfaces.

## Why it needs to be done

`foundation.test_infra.playwright_setup` and every `*_pw_*` test task in moderator-ui, participant-ui, audience, and replay-test depend on this confirmation. The choice has been stipulated throughout the WBS; this task formalizes it.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md) the architectural decision was that Playwright drives all web-UI E2E. Throughout the .tji files, all `*_pw_*` test tasks already presume Playwright.

Why Playwright (vs. alternatives like Cypress, Selenium, WebDriverIO):
- Cross-browser support (Chromium, Firefox, WebKit).
- Parallel test execution and trace viewer for debugging.
- Native handling of multi-context tests — driving moderator + participant tablets in parallel browser contexts (used in `mod_pw_full_session_run`).
- Active development, broad TS-first ecosystem.
- Plays well with Cucumber.js standalone for the BDD layer (kept separate per `test_behavior_framework_decision`).

## Constraints / requirements

- Cross-browser test execution.
- Multi-context (multiple browser instances driven from one test) for full-session runs.
- Visual regression captures (screenshots).
- TypeScript-first.
- Integrates with the test database provisioning workflow.

## Acceptance criteria

- Playwright is confirmed; rationale recorded in the ADR log.
- A "hello, world" Playwright test runs in CI against the dev compose stack.

## Decisions

- **Playwright is the web-UI E2E framework.** Confirmed; the decision propagates across `foundation.test_infra.playwright_setup` and all `*_pw_*` test tasks.

## Open questions

(none — confirming a stipulated decision)
