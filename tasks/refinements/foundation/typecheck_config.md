# Configure type checker

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.typecheck_config`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions.lang_decision` (settled — TypeScript on Node)

## What this task is

Configure TypeScript itself — the `tsconfig.json` (or per-workspace `tsconfig.json` files if `dir_layout` lands on workspaces) that govern strictness, target, module resolution, and project references.

## Why it needs to be done

The type checker is the strongest correctness layer in the stack. Strict configuration up front catches whole categories of bugs that would otherwise leak through.

## Inputs / context

A TypeScript codebase across backend (Node) and frontend (browser, framework TBD) needs at minimum:

- A root `tsconfig.json` with strict defaults.
- Per-target `tsconfig.json` files (e.g., `apps/server/tsconfig.json` for Node, `apps/audience/tsconfig.json` for browser) inheriting from the root.
- TypeScript project references so workspaces type-check incrementally.

Default strictness flags worth enabling:

- `strict: true` (enables `noImplicitAny`, `strictNullChecks`, etc.).
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined` (catches off-by-one bugs).
- `noImplicitOverride: true` — explicit `override` keyword on subclass methods.
- `exactOptionalPropertyTypes: true` — `{ x?: string }` is `{ x: string }` or absent, not `{ x: string | undefined }`.
- `noFallthroughCasesInSwitch: true`, `noUnusedLocals`, `noUnusedParameters` (or delegate the unused-* rules to the linter).
- `module: "NodeNext"` (or `"ESNext"` with bundler resolution for the frontend targets).
- `target: "ES2022"` (broadly supported; Node 18+ runtimes accept it; modern browsers handle it).

## Constraints / requirements

- Strictest practical TS configuration.
- Workspaces compatible (if `dir_layout` picks workspaces).
- CI runs `tsc --noEmit` as the typecheck step (`foundation.ci.ci_typecheck`).
- Editor integrations work out of the box.

## Acceptance criteria

- A root `tsconfig.json` with strict settings.
- Per-target `tsconfig.json` files inheriting from root, set up for each workspace's runtime (Node vs. browser).
- TypeScript project references configured.
- `tsc --noEmit -p .` passes on the empty-but-valid project.
- CI runs the typecheck step.

## Decisions

- **Module resolution** (R8): `module: NodeNext` for `apps/server` (Node), `module: ESNext` + `moduleResolution: bundler` for frontend workspaces (React + bundler).
- **Target: ES2022.** Node 20+ supports it natively; all modern browsers handle it; no transpilation tax for common features.
- **`exactOptionalPropertyTypes: true`.** Fits the project's "explicit decisions" ethos; flags legitimate-looking patterns that mask actual ambiguity.
- **Project references.** Workspaces use TypeScript project references for incremental type-check speed; each `apps/*` and `packages/*` workspace ships its own `tsconfig.json` extending a shared `tsconfig.base.json` at the root.
- **Strict flags enabled:** `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`. Unused-* rules delegated to the linter.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10 — see [docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md).

Files landed:

- `tsconfig.base.json` — shared compiler options (strict + the four extra strictness flags, `composite`, `declaration`, `verbatimModuleSyntax`, etc.).
- Root solution-style `tsconfig.json` — `files: []` plus references to all five workspaces.
- Per-workspace `apps/server/tsconfig.json` (NodeNext), `apps/{moderator,participant,audience}/tsconfig.json` (ESNext + Bundler + DOM + react-jsx), `packages/shared-types/tsconfig.json` (NodeNext).
- `tsconfig.tools.json` — root scripts + `*.config.ts`, non-composite `noEmit`, ESNext+Bundler resolution.
- `tests/tsconfig.json` — same shape as tools, scoped to `tests/**`. Lives at `tests/tsconfig.json` (not in the root tools config) so `typescript-eslint`'s `projectService` can auto-discover it.

Scripts: `pnpm typecheck` (`tsc -b`), `pnpm typecheck:tools`, `pnpm typecheck:tests`.

ESLint was upgraded from `tseslint.configs.recommended` to `tseslint.configs.recommendedTypeChecked` for `apps/**`, `packages/**`, and `tests/**` (the linter ADR 0011 explicitly flagged this as the follow-up once a tsconfig existed). `scripts/**` stays on the non-type-checked tier — type-aware rules misfired on Node globals when projectService's default-project fallback couldn't see ambient `@types/node`, and the original spec anticipated this carve-out. ADR 0011 has an Amendments section noting the upgrade.
