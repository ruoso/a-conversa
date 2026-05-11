# 0014 — Pre-commit hooks: Husky + lint-staged

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` has a settled lint stack (ESLint with `typescript-eslint/recommendedTypeChecked`, ADR 0011), formatter (Prettier 3, ADR 0012), and typecheck stack (TypeScript 6 strict with project references, ADR 0013). The refinement at [tasks/refinements/foundation/pre_commit_hooks.md](../../tasks/refinements/foundation/pre_commit_hooks.md) settled what runs in the hook (lint, format, typecheck — but **not** tests) and pointed at the pre-commit-hook tooling options:

- **Husky + lint-staged** — the de-facto Node-ecosystem standard. Husky installs git hooks; lint-staged runs commands against staged files.
- **simple-git-hooks** — leaner config, smaller dependency, but a much smaller community and less documentation.
- **pre-commit (Python tool)** — language-agnostic but introduces a Python dependency on every contributor's machine, which a pure TS/Node project shouldn't need.

The downstream constraint is that `apps/server`, `apps/{moderator,participant,audience}`, `packages/shared-types`, `tests/`, and `scripts/` are all under one repo with a project-references typecheck graph; the hook needs to work no matter which workspace's files are staged.

## Decision

**Husky + lint-staged.** Pinned versions: `husky@9.1.7`, `lint-staged@17.0.4` at the workspace root.

A `prepare` script (`husky`) initializes `.husky/_/` (Husky 9's auto-managed dispatcher directory, which is itself gitignored by Husky) on `pnpm install`. The single user-authored hook lives at `.husky/pre-commit` and is committed to the repo:

```sh
pnpm exec lint-staged && pnpm run typecheck
```

The order is load-bearing: `lint-staged` auto-fixes and re-stages first, then `tsc -b` runs against the whole project-references graph.

`lint-staged` config (in root `package.json`):

```json
{
  "*.{ts,tsx,js,jsx,cjs,mjs}": ["eslint --fix", "prettier --write"],
  "*.{json,yml,yaml,html,css}": ["prettier --write"]
}
```

`*.md` is **not** in the prettier glob: `.prettierignore` already excludes markdown so the `.editorconfig` "preserve trailing whitespace" hard-break convention survives. `.editorconfig`, `.gitignore`, `*.tji`, `*.tjp`, and other infra files are intentionally absent — Prettier doesn't format them and lint-staged would warn.

**Typecheck runs on the whole repo, not just staged files.** `tsc -b` walks the project-references graph; per-file typecheck doesn't make sense (you can break a downstream workspace by editing an upstream type). The first run is slow, but project references make every subsequent commit incremental — steady-state, the typecheck step is well under a second.

**No tests in pre-commit.** Vitest, Cucumber, and Playwright are too slow to be acceptable on every commit; CI catches them. This is an explicit design decision.

## Consequences

- **Standard tooling.** Anyone who's worked in a modern TS/Node monorepo knows Husky + lint-staged. Onboarding cost is near zero.
- **`pnpm install` wires the hook automatically** via `prepare`. No "did you remember to install the hook?" footgun.
- **Lint and format are scoped to staged files; typecheck is whole-repo.** The split is right: `eslint --fix` and `prettier --write` both auto-modify, so scoping them to staged files keeps the working tree behaviour predictable. Typecheck has no auto-fix and depends on cross-workspace types, so scoping to staged files would be wrong.
- **Auto-fix re-stages.** lint-staged automatically `git add`s the formatted output before yielding to the hook chain, so the cleaned content is what lands in the commit.
- **Bypass mechanism stays git's.** `git commit --no-verify` works. We don't try to defeat it; if a contributor needs to bypass, they can, and CI catches what they skipped.
- **`tests/**` and `scripts/**` are not in the project-references graph,** so a typecheck error in those directories will not be caught by the pre-commit `tsc -b`. This is the same trade-off documented in ADR 0013: those files are covered by `pnpm typecheck:tools` and `pnpm typecheck:tests` in CI. Adding them to the pre-commit hook would double the typecheck time on every commit for a small marginal catch-rate; the call is to leave them to CI.
- **Husky 9's hooksPath is `.husky/_`,** with the user-authored `.husky/pre-commit` consumed by the auto-generated dispatcher in `.husky/_/pre-commit`. Only `.husky/pre-commit` is committed; `.husky/_/` regenerates from `pnpm install`.
- **Verified end-to-end** at landing: a commit with a formatting issue auto-fixed and landed cleanly; a commit with a `no-floating-promises` violation was rejected by `eslint --fix`; a commit with a missing-property type error was rejected by `tsc -b`. Test artifacts were removed before landing this ADR.
- **Downstream constraint.** `foundation.repo_skeleton.readme_dev_section` will expand the README's "Local development" section into a full development-workflow document; this ADR's one-paragraph mention there is a placeholder.

## Amendments

- **2026-05-10** — `foundation.repo_skeleton.readme_dev_section` has landed; the README's "Local development" section now folds in the pre-commit-hook paragraph this ADR seeded. The "Downstream constraint" above is resolved. The decision (Husky + lint-staged) is unchanged.
- **2026-05-10** — Reversed the Consequences-section trade-off about `typecheck:tools` and `typecheck:tests` being CI-only. The hook now runs all three (`typecheck`, `typecheck:tools`, `typecheck:tests`) after `lint-staged`. Trigger: a behavior-test step file imported `type Event` from `apps/server/src/projection/index.js` and the barrel never re-exported it; the bug shipped to CI because the hook ran only `typecheck`. All three `tsc -b` invocations are fast and share the pnpm store cache, so steady-state cost stays sub-second. The decision (Husky + lint-staged + typecheck at commit; no tests) is unchanged.
