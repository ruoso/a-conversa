# 0008 — Web E2E framework: Playwright

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships four user-facing surfaces — moderator console, participant tablet, audience broadcast view, and replay viewer — each with non-trivial real-time behavior (graph rendering, WebSocket-driven state, OBS-style overlays, video). Every `*_pw_*` test task in the WBS already presumes Playwright as the end-to-end driver, and [docs/architecture.md](../architecture.md) names it as the engine for full-session runs that have to drive a moderator and a participant tablet from the same test. This ADR formalizes that choice. The refinement at [tasks/refinements/foundation/playwright_decision.md](../../tasks/refinements/foundation/playwright_decision.md) records the constraints in full; the load-bearing ones are cross-browser execution, multi-context (multiple browser instances driven from one test), TypeScript-first ergonomics, screenshot/video/trace artifacts for visual regressions and failure diagnosis, and an integration path with the per-test database provisioning workflow.

The candidates surveyed were:

- **Playwright** — first-class Chromium / Firefox / WebKit support from one runner; native multi-context API for driving several browser sessions in a single test; built-in trace viewer with timeline, network log, and DOM snapshots; built-in video and screenshot capture; auto-waiting selectors; `@playwright/test` ships its own runner and `expect` so no Mocha/Jest glue is needed; broad TypeScript fluency; active development and community.
- **Cypress** — strong DX and time-travel debugger, but historically single-browser per run, no native multi-context (cross-origin and multi-tab support has improved but remains awkward), and its in-browser execution model makes WebSocket-heavy multi-actor scenarios harder than Playwright's out-of-process driver.
- **Selenium / WebDriverIO** — mature and standards-based, but heavier setup, slower iteration loop, weaker default artifacts, and the multi-context story is bolted on rather than first-class.

Playwright's combination of multi-context support and a real trace viewer is the deciding pair: `mod_pw_full_session_run` and the audience-rendering checks both need behaviors that the alternatives can do only with friction.

## Decision

End-to-end web tests run on **Playwright** via the `@playwright/test` runner. Specs are written in TypeScript and discovered from the per-workspace E2E directories that will exist once `repo_skeleton.dir_layout` lands; until then, the decision-proof spec lives at `tests/e2e/hello.spec.ts`. The runner ships its own `test` and `expect`; we do not add a separate assertion library.

Playwright is **the end-to-end layer** — it drives the live compose stack ([ADR 0018](0018-compose-file-three-service-dev-stack.md)), exercising real `postgres:16-alpine`, real Authelia, and the real backend image once `backend.api_skeleton` lands. The integration layer below — Cucumber + pglite ([ADR 0007](0007-behavior-test-framework-cucumber.md)) — covers DB-touching scenarios in-process without Docker, while the unit layer above — Vitest ([ADR 0006](0006-unit-test-framework-vitest.md)) — covers pure in-memory specs. Browser-driving Cucumber step definitions spin up Playwright from inside a step; non-BDD UI suites use `@playwright/test` directly.

This ADR settles only the framework choice. The actual operational scaffolding is owned by separate tasks and is explicitly **not** done here:

- **Browser installation** (Chromium / Firefox / WebKit binaries via `npx playwright install`, system deps, headless vs headed defaults) — owned by `foundation.test_infra.playwright_setup`.
- **Test helpers** (auth login, session creation, event-log seeding, multi-context choreography) — owned by `foundation.test_infra.playwright_test_helpers`.
- **CI integration** (which jobs run Playwright, browser caching, artifact upload, sharding) — owned by `foundation.test_infra.ci_playwright_step`.
- **Per-test database** (clean DB per Playwright test, hookup with the runner's `beforeEach` / fixtures) — owned by `foundation.test_infra.test_db_provisioning`.

Per-surface specs (moderator, participant, audience, replay-test) are written by their `*_pw_*` test tasks against this runner once the helpers and DB workflow are in place.

## Consequences

- **One E2E runner across all four surfaces.** The moderator console, participant tablet, audience view, and replay viewer share one test invocation, one config schema, one trace viewer for diagnosis. Cross-surface tests (moderator + participant in one scenario) are first-class via `browser.newContext()`.
- **Cross-browser coverage available when needed.** Audience-side OBS-equivalent rendering checks can run against WebKit and Firefox in addition to Chromium; per-project filters in `playwright.config.ts` will be configured by `playwright_setup` so day-to-day local runs stay fast.
- **Trace, video, and screenshot artifacts on failure.** `playwright_setup` will turn these on with `retain-on-failure` semantics; this ADR doesn't configure them, but the framework choice makes them available without additional tooling.
- **TypeScript-native, no transpiler glue.** `@playwright/test` runs `.ts` specs directly; matches the rest of the toolchain (Vitest via esbuild, Cucumber via `tsx`).
- **Browser binaries deferred.** This ADR's smoke deliberately runs without a browser to keep the decision proof small. The first time the runner needs a real browser, `playwright_setup`'s `npx playwright install` provisions it; CI gets browser caching as part of `ci_playwright_step`.
- **Behavior tests stay on Cucumber.** ADR 0007 settled BDD on `@cucumber/cucumber` standalone. Browser-driving Cucumber scenarios spin up Playwright from inside a step definition; non-BDD UI suites use `@playwright/test` directly. The two runners stay decoupled.
- **Downstream tasks now constrained.** `playwright_setup` installs browsers and writes the real `playwright.config.ts` (with browser projects, base URL, artifacts); `playwright_test_helpers` ships the auth/seed/multi-context helpers; `ci_playwright_step` wires the CI job; `test_db_provisioning` provides the per-test DB; every `*_pw_*` task writes specs against this runner.

## Stack-validation smoke test

A single spec at [`tests/e2e/hello.spec.ts`](../../tests/e2e/hello.spec.ts) and a minimal config at [`playwright.config.ts`](../../playwright.config.ts) prove the chain end-to-end without needing a browser binary or a running app: one test, a synchronous arithmetic assertion via Playwright's own `expect`, no `page` fixture. Run with:

```sh
pnpm install   # one-time
pnpm run test:e2e:smoke
```

Expected output is `1 passed` from the Playwright `list` reporter. The sketch is throwaway and will be superseded by the real per-workspace E2E setups produced by `playwright_setup` and the per-surface `*_pw_*` tasks.

## Amendments

- **2026-05-10** — Switched the package manager from npm to pnpm as part of [ADR 0010](0010-directory-layout-pnpm-workspaces.md). Run command above is now `pnpm install` / `pnpm run test:e2e:smoke`. The decision (`@playwright/test`) is unchanged.
- **2026-05-10** — Added a paragraph to the Decision section clarifying Playwright's role in the three-layer test stack: Playwright + the live compose stack is the end-to-end layer; Cucumber + pglite ([ADR 0007](0007-behavior-test-framework-cucumber.md)) covers integration in-process; Vitest ([ADR 0006](0006-unit-test-framework-vitest.md)) covers pure unit. The original ADRs left "what does each runner hit" implicit; this clarification makes the boundary explicit. The decision (`@playwright/test`) is unchanged.
