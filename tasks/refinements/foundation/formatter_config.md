# Configure formatter

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.formatter_config`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions` (settled — TypeScript on Node)

## What this task is

Pick and configure a code formatter that auto-rewrites code to a consistent style on save and in CI.

## Why it needs to be done

Removes formatting from code review entirely. Pairs with linter (no rule conflicts) and `.editorconfig` (compatible defaults).

## Inputs / context

TypeScript ecosystem candidates:

- **Prettier** — the established standard. Wide editor support, framework plugin support, long-stable conventions.
- **Biome** — combines formatter + linter (see `linter_config`). Single binary, very fast, single config. Compatible with Prettier's most-common output.
- **dprint** — another fast formatter; smaller community than Biome.

## Constraints / requirements

- Formats TS, TSX, JSON, Markdown, YAML at minimum.
- Once `frontend_framework_decision` is settled, must format the chosen framework's templates (e.g., Svelte components if Svelte is picked).
- Compatible with the linter (no conflicting rules).
- Integrates with pre-commit hooks and CI (`foundation.ci.ci_format`).
- Two-space indent, LF line endings, UTF-8, single quotes-or-double-quotes choice — matches `.editorconfig`.

## Acceptance criteria

- Formatter chosen and configured.
- Configuration committed (`.prettierrc.json` or `biome.json` or equivalent).
- Lint and format don't fight (`prettier-eslint-config` if ESLint + Prettier; not needed if Biome alone).
- The empty-but-valid project formats clean.
- CI runs format check (`foundation.ci.ci_format`).

## Decisions

- **Formatter: Prettier** (R7). Pairs with the ESLint linter (R6) cleanly. Use `eslint-config-prettier` to disable ESLint rules that conflict with Prettier's output, so the two tools don't fight.
- **Quote style: single quotes** (`'foo'`).
- **Trailing comma: `all`** (everywhere — function args, object literals, arrays, function definitions).
- **Print width: 100** (accommodates the verbose names in this codebase without forcing many one-line declarations to wrap).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10.

- ADR: [docs/adr/0012-formatter-prettier.md](../../../docs/adr/0012-formatter-prettier.md).
- Config: [.prettierrc.json](../../../.prettierrc.json), [.prettierignore](../../../.prettierignore).
- ESLint integration: [eslint.config.js](../../../eslint.config.js) extends `eslint-config-prettier` last so the linter and formatter don't fight.
- Scripts: `pnpm run format`, `pnpm run format:check` in [package.json](../../../package.json).
- Existing repo formatted (13 code/config files rewritten — pure formatting: single-quote and trailing-comma normalization). Markdown excluded from Prettier so `.editorconfig`'s hard-break carve-out (`[*.md] trim_trailing_whitespace = false`) is preserved.

Deferred:

- Pre-commit hook integration → `foundation.repo_skeleton.pre_commit_hooks`.
- CI format-check job → `foundation.ci.ci_format`.
