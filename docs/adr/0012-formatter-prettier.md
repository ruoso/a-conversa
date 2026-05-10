# 0012 — Formatter: Prettier

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` is a TypeScript repo (one Node backend, three React frontends, a shared types package, root-level smoke scripts and tests) with ESLint already chosen as the linter (see [0011-linter-eslint-with-typescript-eslint.md](0011-linter-eslint-with-typescript-eslint.md)). The refinement at [tasks/refinements/foundation/formatter_config.md](../../tasks/refinements/foundation/formatter_config.md) settled the load-bearing constraints: format TS / TSX / JSON / YAML at minimum, two-space indent, LF line endings, UTF-8, and no rule conflict with the linter. The `.editorconfig` at the repo root pins the same character-level rules, including a Markdown carve-out (`trim_trailing_whitespace = false`) that preserves the two-trailing-spaces hard-break convention.

Three TypeScript-ecosystem candidates were considered:

- **Prettier** — the established standard. Wide editor support (every IDE has first-class integration), broad framework plugin coverage (Svelte, Vue, Astro all available if the frontend choice ever shifts), and `eslint-config-prettier` is the canonical way to disable ESLint's stylistic rules so the two tools don't fight. Mature 3.x line, well-documented configuration surface.
- **Biome** — single Rust binary that bundles formatter + linter. Materially faster than Prettier, but we already picked ESLint over Biome in 0011 for its plugin ecosystem; using Biome only as a formatter would split the toolchain (Biome formats, ESLint lints) without solving the speed concern that motivates Biome in the first place.
- **dprint** — fast, plugin-based, smaller community than either Prettier or Biome. No advantage over Prettier for a TS-only repo, and ecosystem risk is real for a long-lived codebase.

## Decision

Format runs on **Prettier 3.x**, configured at `.prettierrc.json` at the repo root, with `eslint-config-prettier` layered last in `eslint.config.js` to disable any ESLint rules that would otherwise conflict with Prettier's output.

Four explicit settings, all from the refinement (R7):

- `singleQuote: true` — single quotes for JS / TS string literals.
- `trailingComma: "all"` — trailing commas everywhere Prettier can put them (function args, object literals, arrays, function definitions). Keeps diffs minimal when the last element changes.
- `printWidth: 100` — accommodates the verbose names this codebase tends to grow without forcing many one-line declarations to wrap.
- `tabWidth: 2`, `endOfLine: "lf"`, `semi: true` — match `.editorconfig` and the existing TS conventions.

Format scope: every file Prettier recognizes under the repo root, minus the `.prettierignore` set: `node_modules/`, `dist/`, `build/`, `coverage/`, `playwright-report/`, `test-results/`, `pnpm-lock.yaml`, `package-lock.json`, **and `*.md`**. Markdown is excluded because Prettier 3 has no option to preserve trailing whitespace in Markdown, and stripping it would break the hard-break convention `.editorconfig` reserves for `*.md`. Markdown formatting stays the author's responsibility for now; if we later want it automated, it'll be via a Markdown-aware tool that respects hard breaks.

Two scripts wire it into pnpm: `pnpm run format` (write) and `pnpm run format:check` (CI-style verify, exit non-zero on any diff).

## Consequences

- **Lint and format don't fight.** `eslint-config-prettier` is the last entry in the flat ESLint config, turning off every stylistic rule in the recommended sets that would disagree with Prettier. ESLint stays focused on correctness rules; Prettier owns whitespace, quotes, commas, and line-wrapping.
- **One-shot rewrite of the existing repo.** Applying `pnpm run format` to the existing tree rewrote 13 code/config files (TS, TSX, CJS, YAML, the JS ESLint config) — pure formatting changes: double-quote → single-quote, trailing commas added, one over-100-char array reflowed. No content changes.
- **Markdown is unmanaged by Prettier.** `*.md` is in `.prettierignore`. The trade-off is conscious: we keep `.editorconfig`'s hard-break carve-out, and we accept that Markdown style stays a manual discipline. Revisit if Prettier grows a `preserveTrailingWhitespace` option for Markdown or if the codebase outgrows hand-formatting.
- **Pre-commit and CI integration deferred.** `foundation.repo_skeleton.pre_commit_hooks` will wire `pnpm run format:check` (alongside lint and typecheck) into a hook; `foundation.ci.ci_format` runs the same script in CI. Neither is touched here.
- **No editor config shipped.** `.editorconfig` already covers character-level basics (indent, line endings, charset, final newline). Editor-specific Prettier integration (VS Code's `prettier.requireConfig: true`, format-on-save, etc.) is each contributor's responsibility; we don't ship `.vscode/` settings.
- **Downstream tasks now constrained.** `pre_commit_hooks` calls `pnpm run format:check`; `ci_format` calls the same script; any new file extension we want formatted needs a matching adjustment to `.prettierignore` if it should be excluded. The four settings in `.prettierrc.json` are the format-style contract for the repo.

## Stack-validation smoke test

The empty-but-valid project formats clean. Run with:

```sh
pnpm install   # one-time
pnpm run format:check
```

Expected: `All matched files use Prettier code style!` and exit code 0. Auto-fix is `pnpm run format`. The smoke proves Prettier discovers TS / TSX / JSON / YAML / CJS / JS across the workspace tree, root scripts, root tests, and root config files; honours the `.prettierignore` exclusions; and that the formatted files pass `pnpm run lint` cleanly (no rule conflict).

## Amendments

- **2026-05-10** — Pre-commit integration landed via [ADR 0014](0014-pre-commit-hooks-husky-lint-staged.md): `lint-staged` runs `prettier --write` on staged `*.{ts,tsx,js,jsx,cjs,mjs}` (after `eslint --fix`) and on staged `*.{json,yml,yaml,html,css}`. `*.md` is intentionally excluded since `.prettierignore` already excludes it (preserves the `.editorconfig` hard-break convention). CI integration (`foundation.ci.ci_format`) remains deferred. The decision (Prettier 3.x) is unchanged.
