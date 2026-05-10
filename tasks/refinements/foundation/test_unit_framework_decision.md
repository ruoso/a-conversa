# Pick unit-test framework

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.test_unit_framework_decision`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions.lang_decision` (settled — TypeScript on Node), `foundation.stack_decisions.frontend_framework_decision` (settled — React)

## What this task is

Pick the unit-test framework used across both backend (`apps/server`) and frontend (`apps/moderator`, `apps/participant`, `apps/audience`) workspaces. Used at the component / function-level layer; behavior tests use Cucumber.js (separate decision); E2E uses Playwright (separate decision).

## Why it needs to be done

Every `*_unit_tests` task across the WBS depends on this. The choice affects test runner, mocking conventions, assertion library, and how coverage is collected.

## Inputs / context

TS/Node + React ecosystem candidates:

- **Vitest** — modern, fast, Vite-based; TypeScript-native; Jest-compatible API. Excellent React Testing Library support. Watch mode and the new web UI are great for DX.
- **Jest** — the long-standing default. Very mature; extensive plugin ecosystem; Jest's transformer chain has historically been a TS pain point but `ts-jest` and SWC plugins work fine now.
- **Node test runner** (`node:test`) — built-in; minimal; growing in ecosystem support; less mature for React component testing.

Project context:

- Frontend uses React + (likely Tailwind, per `style_tooling_decision`); React Testing Library is the standard for component tests.
- Backend has typed event-log primitives, projection logic, methodology-engine state machines. Heavy unit-test surface.
- pnpm workspaces (per `dir_layout`). Test runner should work cleanly across workspaces.

## Constraints / requirements

- Works in both Node (server) and browser-like (jsdom or happy-dom) environments.
- React Testing Library compatible.
- Snapshot support (for visual-regression-adjacent component tests where appropriate).
- Coverage collection.
- Fast watch mode for DX.
- TypeScript-native (no transpilation friction).

## Acceptance criteria

- Framework chosen, recorded in the ADR log.
- A "hello, unit test" passes in the dev environment from each workspace.
- CI runs unit tests across all workspaces.

## Decisions

- **Vitest** (R17). Modern, TS-native, Jest-compat API, fast watch mode. Aligns with the bundler-resolution convention used on the frontend.
- **Coverage tool: Vitest's built-in coverage with the v8 provider.**
- **DOM environment: happy-dom.** Faster than jsdom and sufficient for React Testing Library's needs.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10. Settled by [ADR 0006](../../../docs/adr/0006-unit-test-framework-vitest.md) and the runner-validation smoke test at [tests/smoke/hello.test.ts](../../../tests/smoke/hello.test.ts) (run via `npm run test:smoke`). Two acceptance-criterion items are explicitly deferred:

- **Per-workspace "hello, unit test"** waits on `repo_skeleton.dir_layout` to create the `apps/*` and `packages/*` workspaces; each per-workspace test will land with its owning `*_unit_tests` task. The inline smoke test above proves the runner choice itself is sound.
- **CI runs unit tests across all workspaces** is owned by `foundation.test_infra.ci_unit_test_step`, which depends on `unit_test_runner_setup`. Not touched here.
