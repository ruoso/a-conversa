# 0007 — Behavior-test framework: `@cucumber/cucumber` standalone

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` runs three streams of behavior (BDD) tests — data-and-methodology, backend (HTTP and WebSocket), and the three frontends — and every `*_behavior_tests` task in the WBS produces Gherkin scenarios. The runner has to be in place first and used consistently across streams. The refinement at [tasks/refinements/foundation/test_behavior_framework_decision.md](../../tasks/refinements/foundation/test_behavior_framework_decision.md) records the constraints in full; the load-bearing ones are Gherkin (Given / When / Then) syntax for non-developer readability, the ability to drive scenarios at any layer (HTTP, WS, browser), and a clean integration with the per-scenario test-DB workflow.

Three candidates were surveyed in the TS/Node ecosystem:

- **`@cucumber/cucumber`** — the canonical Gherkin runner for Node. Most mature, broadest documentation, layer-agnostic (a step definition can hit `fetch`, a WebSocket client, or drive Playwright — Cucumber doesn't care). Works with any assertion library, including `node:assert` and `expect`.
- **`playwright-bdd`** — runs Gherkin scenarios on top of `@playwright/test`. Cleanest unification when every scenario goes through a browser, but couples BDD to the Playwright test runner: backend HTTP/WS scenarios that don't need a browser would carry Playwright fixtures and lifecycle for no win, and the moderator/participant/audience suites would need to share Playwright projects with the data-and-methodology suites.
- **`vitest-cucumber` / behave-style alternatives** — niche, smaller community, partial Gherkin support (most omit `Background`, hooks, parameter types, or report formats). Not a credible substrate for three workstreams.

TypeScript loading is a sub-decision. cucumber-js v12 supports an `import` field in the config and a `loader` field that registers a Node module loader. Two viable TS paths:

- **`tsx` via `--import tsx`** — modern Node loader hook, matches the `--loader` deprecation in Node ≥20.6 / ≥18.19. Already a project dependency (used by every existing smoke).
- **`ts-node/esm`** — long-standing, but requires its own ESM-compat shims and adds a second TS runner alongside the `tsx` already in the tree.

Using `tsx` keeps the toolchain to one TS runner across smokes, scripts, and behavior tests.

## Decision

Behavior tests run on **`@cucumber/cucumber` standalone**. Step definitions are written in TypeScript and loaded via **`tsx`**, registered with `NODE_OPTIONS='--import tsx'` so cucumber-js's worker / loader pipeline picks it up without the deprecated `--loader` flag.

Cucumber is invoked through a thin root-level config (`cucumber.cjs`) that sets the feature glob (`tests/behavior/**/*.feature`) and the step-definition glob (`tests/behavior/steps/**/*.ts`). Scenarios that need to drive a browser will spin up a Playwright instance from inside a step definition; scenarios that exercise the backend at HTTP or WS layer call those clients directly. Playwright remains the E2E runner for non-BDD UI suites and is settled separately (ADR forthcoming).

This ADR settles only the framework, the TS-loading mechanism, and the conventional layout. The actual runner wiring across workspaces, the per-scenario clean-DB hookup, and the CI step are deferred to their owning tasks.

## Consequences

- **One Gherkin runner across all streams.** Backend HTTP/WS scenarios, frontend browser scenarios, and data-and-methodology scenarios all use the same `Given/When/Then` vocabulary and the same test invocation. Step definitions can compose helpers without crossing runner boundaries.
- **Layer-agnostic step definitions.** A scenario can hit `fetch`, open a WebSocket, or drive Playwright from inside a step — Cucumber doesn't constrain the transport. This is the win that `playwright-bdd` would have given up.
- **TS via `tsx` only.** No second TS runner in the tree; `tsx` is already used by every existing smoke. The `NODE_OPTIONS='--import tsx'` prefix in the npm script is the canonical Node-≥20.6 way to register a loader hook.
- **Test-DB hookup deferred.** "Each scenario gets a clean DB" is owned by `foundation.test_infra.test_db_provisioning` and the runner-wiring task `foundation.test_infra.behavior_test_runner_setup`. The hook will be a `Before` / `After` pair that asks the provisioner for a fresh DB and tears it down. Not touched here — the smoke below proves only that `cucumber-js` runs against a feature file.
- **CI integration deferred.** "CI runs behavior tests" is owned by `foundation.test_infra.ci_behavior_test_step`, which depends on `behavior_test_runner_setup`. Not touched here.
- **Per-stream behavior tests deferred.** Each `*_behavior_tests` task writes its own scenarios under the eventual workspace layout once `repo_skeleton.dir_layout` lands. The smoke proves the runner end-to-end inline so the framework choice itself is not blocked on workspace creation.
- **Downstream tasks now constrained.** `behavior_test_runner_setup` wires the shared config and per-workspace step packages; every `*_behavior_tests` task writes Cucumber scenarios; the CI behavior step runs `cucumber-js`.

## Stack-validation smoke test

A single feature file at [`tests/behavior/hello.feature`](../../tests/behavior/hello.feature) and matching step definitions at [`tests/behavior/steps/hello.steps.ts`](../../tests/behavior/steps/hello.steps.ts) prove the chain end-to-end without needing the workspace structure or a running app: one scenario, three steps, trivial `node:assert` checks. The cucumber config lives at [`cucumber.cjs`](../../cucumber.cjs). Run with:

```sh
pnpm install   # one-time
pnpm run test:behavior:smoke
```

Expected output is `1 scenario (1 passed)` and `3 steps (3 passed)`. The sketch is throwaway and will be removed when the real per-workspace behavior-test setups land as part of `behavior_test_runner_setup` and the per-stream `*_behavior_tests` tasks.

## Amendments

- **2026-05-10** — Switched the package manager from npm to pnpm as part of [ADR 0010](0010-directory-layout-pnpm-workspaces.md). Run command above is now `pnpm install` / `pnpm run test:behavior:smoke`. The decision (`@cucumber/cucumber`) is unchanged.
