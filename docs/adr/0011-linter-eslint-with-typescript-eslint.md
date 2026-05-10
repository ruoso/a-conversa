# 0011 — Linter: ESLint with `typescript-eslint`

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` is TypeScript-only across one backend service (`apps/server`) and three React frontends (`apps/moderator`, `apps/participant`, `apps/audience`), with a shared types package and several root-level smoke scripts. The repo needs a single linter wired at the root that catches the usual TS hazards (no-unused-vars, no-floating-promises, no-explicit-any, the `@ts-ignore` family, accidental `any` propagation) before review or CI. The refinement at [tasks/refinements/foundation/linter_config.md](../../tasks/refinements/foundation/linter_config.md) records the constraints; the load-bearing ones are TS / TSX support, a pluggable rule set so framework-specific lints can land per workspace later (React, Playwright, JSX-A11y), no rule conflicts with the formatter, and integration with the eventual pre-commit hook and CI lint job.

Three candidates were surveyed:

- **ESLint with `typescript-eslint`** — the established standard. `typescript-eslint` ships parser + plugin under one umbrella package; its `recommended` and `recommended-type-checked` configs are the two canonical baselines. Largest plugin ecosystem (React, React-Hooks, JSX-A11y, Playwright, Storybook, etc.). v9 introduced flat config (`eslint.config.js`) as the default; v10 makes it the only supported form.
- **Biome** — single-binary linter + formatter in Rust. Materially faster and ergonomic for repos that don't need framework-specific rules. The plugin ecosystem is still small: React rules cover hooks but lag behind `eslint-plugin-react`; no Playwright plugin; JSX-A11y coverage is partial.
- **oxlint / deno_lint** — emerging, very fast, narrower rule coverage. Not credible substrates for a multi-frontend TS project today.

Two sub-decisions ride along with the runner pick:

- **Rule strictness.** `typescript-eslint`'s `recommended` (syntactic only) vs `recommended-type-checked` (uses TypeScript's type information for rules like `no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unsafe-assignment`). Type-aware rules are exactly what makes ESLint pull its weight on a TS project.
- **Type-aware lint enablement mechanism.** The modern path is `parserOptions.projectService: true`, which lets `typescript-eslint` discover the right tsconfig for each file automatically — no need to enumerate every workspace `tsconfig.json`. This requires at least one tsconfig to exist somewhere in the tree.

## Decision

Lint runs on **ESLint v10** with **`typescript-eslint` v8**, configured via flat config at `eslint.config.js` at the repo root. The baseline is `tseslint.configs.recommended` (the syntactic, non-type-checked tier) plus `@eslint/js`'s `recommended` rules. A small CommonJS-only block covers root-level `.cjs` config files (currently `cucumber.cjs`).

Lint scope: `apps/**/*.{ts,tsx}`, `packages/**/*.{ts,tsx}`, `scripts/**/*.{ts,tsx}`, `tests/**/*.ts`. Ignored: `node_modules/`, `dist/`, `build/`, `coverage/`, `playwright-report/`, `test-results/`, `pnpm-lock.yaml`, `package-lock.json`.

The repo currently has **no tsconfig** — that file is owned by the downstream `foundation.repo_skeleton.typecheck_config` task — so the type-checked tier and `parserOptions.projectService` are not enabled in this task. Once `typecheck_config` lands a root `tsconfig.json`, this config will swap `recommended` for `recommendedTypeChecked` and turn on `projectService: true`. That swap is mechanical and is not a new decision.

This ADR settles only the framework, the baseline rule set, and the config shape. Pre-commit hooks, the CI lint job, and framework-specific plugins (React, React-Hooks, JSX-A11y, Playwright) are deferred to their owning tasks.

## Consequences

- **Largest plugin ecosystem available when we need it.** When the React frontends grow real code, `eslint-plugin-react` and `eslint-plugin-react-hooks` slot into the relevant `files` blocks per workspace. Playwright lints land alongside the E2E suites the same way. None of those plugins exist for Biome at parity.
- **Type-aware tier is a one-step upgrade.** Rules like `no-floating-promises`, `no-misused-promises`, and `no-unsafe-assignment` — the ones that catch real backend bugs — turn on the moment `typecheck_config` lands a `tsconfig.json`. The fallback to non-type-checked here is an explicit deferral, not a permanent posture.
- **Flat config is the v10 standard.** No legacy `.eslintrc.*` files; one `eslint.config.js` owns scope, ignores, parser, and rule extensions. Workspace-specific overrides will live as additional entries in this same file (or in workspace-local flat configs later if scope demands it).
- **One linter for the repo.** Root-level `pnpm run lint` covers every workspace and every smoke script. No per-workspace lint config until a workspace has a real reason to diverge.
- **No rule overrides today.** The recommended sets are accepted as-is. The first override gets a brief note in this ADR's amendments and a reason; we don't pre-tune for problems we haven't hit.
- **Formatter conflicts not yet a concern.** Prettier (or whatever `formatter_config` picks) lands separately; if it picks Prettier, `eslint-config-prettier` will be added then to disable conflicting stylistic rules. Not pre-empted here.
- **Pre-commit and CI deferred.** `foundation.repo_skeleton.pre_commit_hooks` wires `pnpm run lint` (alongside format and typecheck) into a hook; `foundation.ci.ci_lint` runs the same script in CI. Neither is touched here.
- **Framework-specific plugins deferred.** `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, and `eslint-plugin-playwright` land per workspace as that workspace's code grows. The flat config makes adding them a one-block change.
- **Downstream tasks now constrained.** `pre_commit_hooks` calls `pnpm run lint`; `ci_lint` calls `pnpm run lint`; `typecheck_config` triggers the type-aware-tier upgrade in this config; per-workspace lint additions extend `eslint.config.js`.

## Stack-validation smoke test

The empty-but-valid project lints clean. Run with:

```sh
pnpm install   # one-time
pnpm run lint
```

Expected: zero output, exit code 0. Auto-fix is wired as `pnpm run lint:fix`. The smoke proves the runner discovers TS / TSX across `scripts/`, `tests/`, `apps/`, and `packages/`, and that `cucumber.cjs` lints under the CJS-specific block.
