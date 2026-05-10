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

## Open questions

- **Which framework?**
  - **Vitest** — modern; matches Vite/bundler-friendly tsconfig (`ESNext` + `bundler` resolution); Jest-compat API means little ramp for anyone with Jest experience. Increasingly the default for new TS/React projects.
  - **Jest** — most mature; broadest ecosystem; well-trodden React Testing Library docs assume Jest.
  - **My instinct: Vitest.** Better TS DX, faster watch mode, and aligns with the modern bundler-resolution convention we're using on the frontend. Mature enough now that "Jest is more mature" is a smaller advantage than it was. **Awaiting input.**
- **Coverage tool.** **My instinct: Vitest's built-in coverage (v8 provider).** **Awaiting input.**
- **DOM environment.** **My instinct: happy-dom.** Faster than jsdom; sufficient for React Testing Library's needs. **Awaiting input.**
