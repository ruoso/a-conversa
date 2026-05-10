# 0006 — Unit-test framework: Vitest with v8 coverage and happy-dom

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` needs one unit-test framework spanning the Node backend (`apps/server`) and the three React frontends (`apps/moderator`, `apps/participant`, `apps/audience`) — the substrate for every `*_unit_tests` task in the WBS. Behavior tests (Cucumber.js) and end-to-end tests (Playwright) are settled separately. The refinement at [tasks/refinements/foundation/test_unit_framework_decision.md](../../tasks/refinements/foundation/test_unit_framework_decision.md) records the constraints in full; the load-bearing ones are TypeScript-native execution (no transpiler glue), React Testing Library compatibility under a DOM shim, snapshot and coverage support, and a fast watch loop for DX.

Three candidates were surveyed:

- **Vitest** — Vite-native; runs `.ts` and `.tsx` directly through esbuild; Jest-compatible API (`describe`/`it`/`expect`/`vi`); first-class happy-dom and jsdom support; built-in coverage with v8 or istanbul providers; watch mode is fast because it reuses Vite's module graph.
- **Jest** — the long-standing default; very mature; large plugin ecosystem; TypeScript runs via `ts-jest` or an SWC plugin (workable, but an extra moving part) and ESM support is still rough enough that most projects keep CJS interop shims around.
- **`node:test`** — built into Node; minimal; growing; no native DOM environment, so React component tests would still need an external shim wired in by hand, and the assertion / mocking ergonomics are thinner than Jest's.

Three sub-choices ride along with the runner pick: the DOM shim (jsdom vs happy-dom), the coverage provider (v8 vs istanbul), and the assertion style (Jest-compatible vs novel). Happy-dom is materially faster than jsdom and covers what React Testing Library exercises; v8 coverage uses Node's native instrumentation and avoids istanbul's source-transform step; Jest-compat assertions keep the API recognizable to outside contributors.

## Decision

Unit tests run on **Vitest**, with **`@vitest/coverage-v8`** for coverage and **happy-dom** as the DOM environment for component tests.

Frontend component tests pair Vitest with **React Testing Library**. Backend tests run in the default Node environment; component tests opt into happy-dom either via the per-file `// @vitest-environment happy-dom` pragma or via a config-level project split when the workspaces land.

Vitest is **the unit-test layer** — pure in-memory specs against TypeScript modules with no I/O. Anything that opens a database connection or hits a network is the integration layer (Cucumber + pglite, [ADR 0007](0007-behavior-test-framework-cucumber.md)) or the end-to-end layer (Playwright + the live compose stack, [ADR 0008](0008-e2e-framework-playwright.md)). Tests for Zod payload validators, projection arithmetic, agreement-state transitions, and the like belong here.

This ADR settles only the framework and its companion choices. The real wiring — per-workspace `vitest.config.ts` files under `apps/*` and `packages/*`, the shared test-setup module (`@testing-library/jest-dom` matchers, common mocks), and the CI step — is deferred to its owning tasks.

## Consequences

- **TS and TSX run with no transpiler glue.** Vitest hands `.ts` / `.tsx` to esbuild directly; no `ts-jest`, no Babel preset chain, no separate build step before tests run.
- **Jest-compat API keeps the surface familiar.** `describe`/`it`/`expect`/`vi.mock` mirror Jest closely enough that contributors with Jest experience can write tests immediately, and most React Testing Library examples on the web port across unchanged.
- **Fast watch loop.** Vite's module graph is reused between runs, so re-running affected tests on file change is sub-second on the smoke surface. This pays back daily.
- **happy-dom over jsdom.** Faster startup and per-test runtime; sufficient for everything React Testing Library exercises in this codebase. If a specific test ever needs jsdom-only behavior, the per-file `@vitest-environment` pragma allows a one-off override without flipping the global default.
- **v8 coverage over istanbul.** Native Node instrumentation; no source transform; coverage of TS source files maps back through Vite's sourcemaps cleanly.
- **One runner, four workspaces (eventually).** When `repo_skeleton.dir_layout` lands the `apps/*` and `packages/*` structure, each workspace gets a thin `vitest.config.ts` extending a shared root config; `vitest --project <name>` (or root-level `vitest`) runs them together.
- **Per-workspace tests deferred.** The acceptance-criterion item "a 'hello, unit test' passes from each workspace" cannot land until the workspaces themselves exist (`repo_skeleton.dir_layout`). It is explicitly carried forward and will be discharged by each workspace's `*_unit_tests` task. The ADR's smoke test (below) proves the runner end-to-end inline so the runner choice itself is not blocked on workspace creation.
- **CI integration deferred.** "CI runs unit tests across all workspaces" is owned by `foundation.test_infra.ci_unit_test_step`, which depends on `unit_test_runner_setup`. Not touched here.
- **Downstream tasks now constrained.** `unit_test_runner_setup` wires the shared config and per-workspace files; every `*_unit_tests` task writes Vitest specs against this runner; the CI test step runs Vitest.

## Stack-validation smoke test

A single file at [`tests/smoke/hello.test.ts`](../../tests/smoke/hello.test.ts) proves the chain end-to-end without needing the workspace structure: a trivial arithmetic assertion proves the runner executes, and a React Testing Library mount of a tiny `<Hello />` component under happy-dom proves the React + DOM-shim path works. Run with:

```sh
pnpm install   # one-time
pnpm run test:smoke
```

Expected output includes Vitest's standard pass summary with both tests green. The sketch is throwaway and will be removed when the real per-workspace test setups land as part of `unit_test_runner_setup` and the per-app `*_unit_tests` tasks.

## Amendments

- **2026-05-10** — Switched the package manager from npm to pnpm as part of [ADR 0010](0010-directory-layout-pnpm-workspaces.md). Run command above is now `pnpm install` / `pnpm run test:smoke`. The decision (Vitest) is unchanged.
- **2026-05-10** — Added a paragraph to the Decision section clarifying Vitest's role in the three-layer test stack (unit → integration via Cucumber+pglite → E2E via Playwright+compose). The original three ADRs (0006/0007/0008) left "what database does each layer hit" implicit; this clarification makes the boundary explicit so future tasks file their tests in the right layer. The decision (Vitest) is unchanged.
