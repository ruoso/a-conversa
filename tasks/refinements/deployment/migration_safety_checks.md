# Migration safety checks — the backward-compat linter

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_migrations.migration_safety_checks`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.schema.migrations_tooling` (settled — `node-pg-migrate`, plain-SQL forward-only migrations under `apps/server/migrations/`, per ADR 0020).
**Executor**: implementation agent — repo-only tooling, part of milestone `m_predeploy_agent_work` (M9-prep).

## What this task is

Implement the migration safety linter that
[ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md)
requires:

> **Migration safety linter** — owned by the
> `prod_migrations.migration_safety_checks` refinement. Rejects
> migrations that fail the backward-compat invariant (column drops,
> renames, type narrowing) without a paired prior-release marker.
> The exact mechanism (PR-time check vs pre-commit hook) is a
> refinement-time choice; the *requirement* is settled here.

The invariant being enforced (ADR 0034): rollback is **image
rollback, never migration rollback** — Railway redeploys the previous
image while migrations stay applied — so *every migration must be
tolerable by the immediately previous deployed image*. A schema
change the prior image can't tolerate must be split across two
consecutive releases (the "two-tag dance").

## Why it needs to be done

- Without mechanical enforcement, the invariant holds only as long as
  every migration author remembers it; the first forgotten case
  silently breaks rollback exactly when rollback is needed.
- `prod_migrations.rollback_strategy` and the two release runbooks
  document the discipline this linter enforces;
  `deployment_tests.migration_dry_run` gates on this leaf in the WBS.
- M9-prep (`m_predeploy_agent_work`) lists this leaf.

## Inputs / context

- **Migration corpus**: `apps/server/migrations/NNNN_name.sql` —
  plain SQL, whole file is the up step, no down sections (ADR 0020).
  The existing 17 files are additive (CREATE TABLE / CREATE INDEX /
  ALTER ... ADD with defaults) and must pass the linter unmodified —
  the baseline is clean by construction, not by grandfathering.
- **Tooling conventions**: repo-root `scripts/*.ts` run via `tsx`,
  typechecked by `tsconfig.tools.json`; cross-tree tests live in
  `tests/smoke/` (vitest, included in `test:smoke`); repo-wide
  gates run in `pnpm run check` and as `ci.yml` steps.

## Constraints / requirements

- **Linter** at `scripts/lint-migrations.ts`: pure rule core
  (exported, unit-testable) + a CLI main that scans
  `apps/server/migrations/*.sql`, prints `file:rule:detail` findings,
  exits non-zero on any finding.
- **Rules** (applied to SQL with comments and string literals
  stripped, so prose can't false-positive):
  - `drop-table` — `DROP TABLE`
  - `drop-column` — `DROP COLUMN`
  - `rename-table` / `rename-column` — `RENAME TO` / `RENAME COLUMN`
  - `alter-column-type` — `ALTER COLUMN … [SET DATA] TYPE` (any type
    change is flagged; mechanically distinguishing widening from
    narrowing needs a SQL type system, and even "widening" changes
    can break the prior image's value handling — the marker is the
    escape hatch for the legitimately safe cases)
  - `set-not-null` — `ALTER COLUMN … SET NOT NULL` (the prior image
    may still insert rows without the column)
  - `add-not-null-without-default` — `ADD COLUMN … NOT NULL` with no
    `DEFAULT` in the same statement (same failure mode)
  - `truncate` — `TRUNCATE` (destructive data loss)
- **Prior-release marker** (the paired escape hatch): a comment line
  in the migration file, one per allowed rule —
  `-- migration-safety: allow <rule-id>: <justification>` —
  with a non-empty justification naming why the prior image
  tolerates the change (typically: "release vX stopped reading this
  column; this is the N+1 half of the two-tag dance"). A marker for
  rule A does not silence rule B; a marker without justification is
  itself a finding.
- **Enforcement points** (the ADR's refinement-time mechanism
  choice): a `lint:migrations` root script wired into (a)
  `pnpm run check` (local + agent gate) and (b) the `ci.yml` Lint
  job (PR-time gate). Not a pre-commit hook — the husky hook is
  already heavy, and a migration that sneaks past a `--no-verify`
  commit still hits CI.
- **Tests** (`tests/smoke/lint-migrations.test.ts`): each rule fires
  on a minimal offending SQL; additive SQL passes; marker with
  justification silences exactly its rule; marker without
  justification / for a different rule does not; comment- and
  string-embedded pattern text does not false-positive; the real
  migration corpus is clean (the baseline pin — runs the linter over
  `apps/server/migrations/`).

## Acceptance criteria

- `pnpm run lint:migrations` exits 0 on the current corpus; seeding a
  scratch violation makes it exit non-zero with a finding naming the
  file, rule, and offending statement (pinned via the rule-core unit
  tests, not by committing a violation).
- `pnpm run check` runs the linter; the `ci.yml` Lint job runs it.
- `pnpm run test:smoke` green including the new test file.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Regex-over-stripped-SQL, not a SQL parser.** The migration corpus
  is hand-written DDL in a constrained style (ADR 0020's conventions
  doc); the seven rules are keyword-shaped and a real parser
  (pg-query-parser etc.) adds a native dependency for no additional
  recall on this corpus. The stripping pass (comments + string
  literals) removes the false-positive surface that matters. Revisit
  if migrations ever start being generated.
- **Flag ALL column-type changes, not just narrowing.** Mechanical
  narrowing detection requires type-system knowledge (is
  `varchar(50) → varchar(100)` widening? what about
  `text → citext`?), and the prior image's *application-level*
  handling can break even on widening. Cheap rule + explicit marker
  beats clever rule + silent misses.
- **`set-not-null` and `add-not-null-without-default` included**
  beyond the ADR's named three (drops, renames, narrowing): both
  break the prior image's INSERTs the same way, which is exactly the
  invariant. The ADR names examples, not an exhaustive list.
- **Marker is per-rule with mandatory justification.** A bare
  "allow everything" switch would erode into cargo-cult copying; the
  justification line is what the release_runbook's two-tag-dance
  procedure tells the author to write, so reviewers see the pairing
  claim at the diff site.
- **CI + `check`, not pre-commit.** PR-time is the ADR's first-listed
  option and the layer that can't be skipped locally; `check`
  inclusion gives authors the same signal before pushing. The husky
  pre-commit already runs lint-staged + full lint + 3 typechecks —
  adding more is hostile to commit latency for a file class that
  changes rarely.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12. Landed as:

- [`scripts/lint-migrations.ts`](../../../scripts/lint-migrations.ts) —
  rule core (`lintMigrationSql`, exported types + `MIGRATION_SAFETY_RULES`)
  + CLI main scanning `apps/server/migrations/*.sql`.
- [`package.json`](../../../package.json) — `lint:migrations` script;
  `check` chain extended;
  [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) —
  Lint job runs the linter after eslint.
- Tests: [`tests/smoke/lint-migrations.test.ts`](../../../tests/smoke/lint-migrations.test.ts) —
  per-rule fire/pass cases, marker semantics, strip-pass
  false-positive guards, and the clean-corpus baseline pin.
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
