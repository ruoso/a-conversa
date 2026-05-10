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
