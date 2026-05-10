# 0013 — Type checker: TypeScript with strict tsconfig + project references

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` is TypeScript across one Node backend (`apps/server`), three React frontends (`apps/moderator`, `apps/participant`, `apps/audience`), and a shared types package (`packages/shared-types`). Root-level `scripts/` (smoke tests for the dependency stack) and `tests/` (smoke / behavior / e2e) also need type coverage. The refinement at [tasks/refinements/foundation/typecheck_config.md](../../../tasks/refinements/foundation/typecheck_config.md) settled the load-bearing decisions: ES2022 target, strict + the four extra strictness flags, NodeNext for the server vs ESNext+bundler for the frontends, project references across workspaces, per-workspace `tsconfig.json` files extending a shared `tsconfig.base.json` at the repo root, and unused-* delegated to the linter. The downstream constraint is that ESLint can flip from `recommended` to `recommendedTypeChecked` once a tsconfig exists (ADR 0011 explicitly flagged this as a follow-up).

## Decision

TypeScript **6.0.3** (current stable; latest dist-tag at the time of writing) is pinned at the repo root. Compiler options live in **`tsconfig.base.json`**; every workspace and tooling tsconfig extends it. The settled flags are:

- `target: "ES2022"`, `lib: ["ES2022"]` (frontends layer in `"DOM"` / `"DOM.Iterable"`).
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `exactOptionalPropertyTypes: true`. The last fits this project's "explicit decisions" ethos — `{ x?: string }` is `{ x: string }` or absent, not `{ x: string | undefined }`.
- `noEmit: true` (workspaces flip it off via `"noEmit": false` to write `.d.ts` for project references).
- `composite: true`, `declaration: true`, `declarationMap: true` — required by project references and they let downstream consumers navigate to source.
- `forceConsistentCasingInFileNames`, `esModuleInterop`, `isolatedModules`, `verbatimModuleSyntax`, `skipLibCheck`, `resolveJsonModule`.
- `module` / `moduleResolution` are deliberately **not** in the base — they belong per-workspace.

Per-workspace tsconfigs:

- `apps/server/tsconfig.json` — `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `lib: ["ES2022"]` (no DOM); references `packages/shared-types`.
- `apps/moderator|participant|audience/tsconfig.json` — `module: "ESNext"`, `moduleResolution: "Bundler"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`; references `packages/shared-types`.
- `packages/shared-types/tsconfig.json` — `module: "NodeNext"`, `moduleResolution: "NodeNext"` (the emitted `.d.ts` works for both Node and bundler consumers).

The solution-style root **`tsconfig.json`** is `files: []` plus `references` to all five workspaces, so `tsc -b` builds the graph in topological order.

Two non-reference tsconfigs cover root-level files that don't belong to any workspace:

- **`tsconfig.tools.json`** — `noEmit: true`, ESNext+Bundler resolution, includes `scripts/**` and `*.config.ts`. Bundler resolution (rather than NodeNext) keeps the smoke scripts that import bundler-style packages like `reactflow` (default export from a dual-package build) type-checking under `verbatimModuleSyntax`.
- **`tests/tsconfig.json`** — same shape as the tools config, includes `tests/**`. Lives at `tests/tsconfig.json` (not in the root tools config) specifically so `typescript-eslint`'s `projectService` can auto-discover it for type-aware lint coverage of the test files.

`pnpm` scripts:

- `typecheck` → `tsc -b` (the project-references graph).
- `typecheck:tools` → `tsc --noEmit -p tsconfig.tools.json`.
- `typecheck:tests` → `tsc --noEmit -p tests/tsconfig.json`.

**ESLint upgrade.** As part of this task, `eslint.config.js` flips from `tseslint.configs.recommended` to `tseslint.configs.recommendedTypeChecked` for `apps/**`, `packages/**`, and `tests/**`, with `parserOptions.projectService: true` letting `typescript-eslint` discover the right tsconfig per file. **`scripts/**` is held on the non-type-checked tier** — type-aware lint over those throwaway smoke scripts misfired on Node globals when `projectService`'s default-project fallback couldn't see ambient `@types/node`, and the spec explicitly anticipated this carve-out. The scripts are still type-checked by `pnpm typecheck:tools`; only the *type-aware lint rules* are off for them.

## Consequences

- **Strict-by-default catches the right bugs early.** `noUncheckedIndexedAccess` flags array / object index access as `T | undefined`; `exactOptionalPropertyTypes` blocks the silent `undefined`-as-optional foot-gun; `noImplicitOverride` keeps subclass dispatch honest. Unused-* lives in the linter (already wired in ADR 0011's recommended set).
- **Project references give incremental builds across workspaces.** `tsc -b` rebuilds only what changed and uses the upstream `.d.ts` rather than re-checking source. This pays for itself the moment two workspaces share types.
- **NodeNext vs ESNext+bundler split matches each runtime.** The server runs on Node 20+ where NodeNext is the right model; the frontends ship through a bundler that owns module resolution. Mixing them in one config would force pessimistic choices for both.
- **Three tsc invocations in CI, not one.** The project-references graph (`tsc -b`) doesn't include `scripts/**` or `tests/**` — those are non-composite tooling configs. `ci_typecheck` will need to run all three (`typecheck`, `typecheck:tools`, `typecheck:tests`). The trade-off is clean: workspace builds stay incremental, root-level files stay type-checked, no fake placeholder workspace is needed to wedge them into the references graph.
- **Type-aware lint is now active for source code.** `no-floating-promises`, `no-misused-promises`, `no-unsafe-assignment`, and the rest of `recommendedTypeChecked` will catch real bugs in `apps/**`, `packages/**`, and `tests/**`. `scripts/**` stays on syntactic-only lint — revisit if those scripts ever stop being throwaway.
- **`verbatimModuleSyntax` is strict.** Mixing value and type imports needs the explicit `import { type Foo }` form (or a separate `import type` line). The smoke scripts already do this.
- **Each workspace owns one `src/index.{ts,tsx}` placeholder.** Stub `export {};` files exist only so `tsc` has something to compile under each `include: ["src"]`. They get replaced when real code lands per workspace; nothing in the placeholder is load-bearing.
- **Downstream tasks now constrained.** `foundation.ci.ci_typecheck` runs `pnpm typecheck && pnpm typecheck:tools && pnpm typecheck:tests`. `foundation.repo_skeleton.pre_commit_hooks` wires the same scripts (or a subset) into the hook. Each `apps/*` workspace that grows real code will need to add `dependencies` / `devDependencies` and may add per-workspace lib entries; the base config stays untouched. Per-workspace lint plugin additions (React, React-Hooks, JSX-A11y, Playwright) extend `eslint.config.js` per ADR 0011.

## Stack-validation smoke test

The empty-but-valid project type-checks and lints clean. Run with:

```sh
pnpm install  # one-time
pnpm run typecheck && pnpm run typecheck:tools && pnpm run typecheck:tests
pnpm run lint
```

Expected: zero output for typecheck, zero output for lint, exit code 0 for all. The smoke proves: each workspace's `tsconfig.json` resolves under project references; `tsc -b` builds the graph in topological order; the tools and tests configs cover root-level files; `tseslint`'s `projectService` finds the right tsconfig per file; the type-aware rule set runs without misfires on the workspace placeholders.
