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

## Open questions

- **Linter choice.**
  - **ESLint** — broadest plugin coverage; safer pick for a young project that may pick any frontend framework.
  - **Biome** — combines linter + formatter, fast, single config file. If we're confident the framework choice will be supported by Biome's plugins, this collapses two foundation tasks into one config.
  - My instinct: **ESLint** for v1 — the project will need framework-specific lints (React, Svelte, or Solid plugins) and ESLint's coverage is more complete; revisit Biome when its ecosystem catches up. **Awaiting input.**
- **Rule strictness.** Pick a baseline ruleset (`recommended` vs. `recommended-type-checked` vs. custom). My instinct: **`typescript-eslint/recommended-type-checked`** — type-aware rules are exactly what makes ESLint pull its weight on a TS project. **Awaiting input.**
