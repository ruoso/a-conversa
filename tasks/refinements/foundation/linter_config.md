# Configure linter

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.linter_config`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions` (settled — TypeScript on Node)

## What this task is

Pick and configure a linter for the TypeScript codebase. Enforces code style, catches common mistakes, surfaces unused imports / dead code, etc.

## Why it needs to be done

Linting is the lightweight enforcement layer between freeform code and the type checker. Catches typos, no-floating-promises, no-unused-vars, etc., before they hit review or CI tests.

## Inputs / context

TypeScript ecosystem candidates:

- **ESLint with `typescript-eslint`** — the established standard. Largest plugin ecosystem (React, Svelte, Solid plugins all exist; Playwright plugin too). Requires a careful set of rules to avoid noise.
- **Biome** — newer, single-binary linter + formatter combined. Much faster. Smaller plugin ecosystem; framework-specific lints are still maturing. Rust-based, so lints run quickly even on large codebases.
- **deno_lint, oxlint** — emerging, less mature.

## Constraints / requirements

- Must lint TS / TSX (and possibly Svelte/Solid component files once `frontend_framework_decision` is settled).
- Pluggable rule set — we'll add framework-specific rules later.
- Integrates with pre-commit hooks (round-2 task) and CI (`foundation.ci.ci_lint`).
- Plays well with the formatter (round-2 task) — no rule conflicts.

## Acceptance criteria

- Linter chosen and configured at the repo root.
- A baseline rule set agreed (e.g., `eslint-config-recommended` + `typescript-eslint/recommended-type-checked` for ESLint; or Biome's recommended ruleset).
- The empty-but-valid project lints clean.
- CI runs the linter (`foundation.ci.ci_lint`).

## Decisions

- **Linter: ESLint** with `typescript-eslint` (R6). React-specific rules will land via `eslint-plugin-react` and `eslint-plugin-react-hooks` once frontend code lives in the repo. Revisit Biome later if/when its plugin ecosystem matches.
- **Rule strictness: `typescript-eslint/recommended-type-checked`** baseline. Type-aware rules are exactly what makes ESLint pull its weight on a TS project.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10.

- ADR: [docs/adr/0011-linter-eslint-with-typescript-eslint.md](../../../docs/adr/0011-linter-eslint-with-typescript-eslint.md)
- Config: [eslint.config.js](../../../eslint.config.js)
- Scripts: `pnpm run lint`, `pnpm run lint:fix` (root `package.json`).
- Tier: **non-type-checked** (`tseslint.configs.recommended`). The type-aware tier (`recommendedTypeChecked` + `parserOptions.projectService: true`) is deferred until `foundation.repo_skeleton.typecheck_config` lands a root `tsconfig.json` — the swap is mechanical, recorded in the ADR's Consequences.
- CI integration deferred to `foundation.ci.ci_lint`. Pre-commit hook deferred to `foundation.repo_skeleton.pre_commit_hooks`. Framework-specific plugins (React, JSX-A11y, Playwright) deferred to per-workspace tasks.
