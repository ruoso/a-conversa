# Add `.editorconfig`

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.editorconfig`
**Effort estimate**: 0.25d
**Inherited dependencies**: `foundation.stack_decisions` (settled)

## What this task is

Add an `.editorconfig` file at the repo root so editors and IDEs apply consistent indentation, line endings, and trailing-whitespace handling regardless of which editor a contributor uses.

## Why it needs to be done

Avoids the "every commit is half-formatting-noise" problem. Pairs with the formatter (round-2 task) — the formatter enforces stronger conventions; `.editorconfig` covers the smallest universal subset that any editor honors.

## Inputs / context

Standard `.editorconfig` covers:
- `indent_style` (space vs. tab)
- `indent_size`
- `end_of_line` (lf / crlf)
- `charset` (utf-8)
- `trim_trailing_whitespace`
- `insert_final_newline`

For a TypeScript codebase, the conventional defaults are:
- `indent_style = space`
- `indent_size = 2`
- `end_of_line = lf`
- `charset = utf-8`
- `trim_trailing_whitespace = true`
- `insert_final_newline = true`

For Markdown, `trim_trailing_whitespace` is often disabled (Markdown uses trailing spaces for line breaks).

## Constraints / requirements

- Defaults match TypeScript ecosystem norms.
- Markdown carve-out for trailing whitespace.
- Enforced at editor-save time (any editor that respects `.editorconfig`).

## Acceptance criteria

- `.editorconfig` at the repo root with the defaults above.
- Verified that `prettier --check .` (once formatter is configured) doesn't conflict with the `.editorconfig` settings.

## Open questions

(none — this is a standardized file with industry defaults; no decisions needed)
