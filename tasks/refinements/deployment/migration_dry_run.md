# Migration dry run — pending migrations against a prod-sized local stack

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.deployment_tests.migration_dry_run`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_migrations.migration_safety_checks` (settled — the linter is the static half of pre-release migration discipline; this drill is the dynamic half).
**Executor**: implementation agent — repo-only work against the local compose stack. Surfaced as ready (and agent-doable per the `.tji`'s own rollup comment: "migration_dry_run is likewise local per ADR 0031") by the 2026-06-12 open-leaf audit.

## What this task is

The `.tji` title says "staging"; [ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md)
reshaped it:

> **No staging dry-run.** Per the M9 scope decisions, prod-only for
> v1. The `migration_dry_run` task is reshaped to "verify the
> migration against a local compose stack seeded with prod-sized
> data" — an operator action ahead of any not-trivially-additive
> migration, documented in the `release_runbook` refinement.

Deliverable: a committed, parameterized drill
(`scripts/migration-dry-run.sh`, `make migration-dry-run`, an
on-demand workflow venue) that:

1. boots an isolated Postgres (own compose project/volume, alternate
   host port — a running dev stack is untouched);
2. applies the **baseline** migration set — the files as of
   `BASE_REF` (default `origin/main`; for a release drill, the tag
   currently in production) — through the real `node-pg-migrate`
   runner;
3. seeds **prod-sized data** (users / nodes / edges / sessions /
   `session_events`, sizes env-tunable, defaults ~50k entities +
   200k events);
4. applies the **candidate** migrations (the working tree) through
   the same runner, timed, against that data — failing on error or
   on exceeding the time budget;
5. sanity-checks that the seeded data survived and the
   `pgmigrations` ledger matches the on-disk file count, then tears
   everything down.

## Why it needs to be done

- The safety linter catches backward-incompatible *shapes*; it says
  nothing about whether a migration **completes in acceptable time
  against realistic volume** (index builds, table rewrites, lock
  duration). This drill is where an `ALTER TABLE` meets 50k rows
  before it meets production.
- The release runbook's migration checklist already references this
  drill by task name; landing it turns that line into a runnable
  command.
- It gates M9 via the `deployment_tests` rollup and is the last
  agent-doable leaf found by the audit.

## Inputs / context

- **Runner**: `node-pg-migrate` CLI (same library as the startup
  gate), `-m <dir> -t pgmigrations --check-order`, DSN via the
  `DATABASE_URL` env var. Plain-SQL migrations are supported
  natively — both the baseline (extracted from `BASE_REF` via
  `git show`) and the candidate (the working tree's
  `apps/server/migrations/`) run through the identical code path
  production boots with.
- **Compose**: the drill reuses `compose.yaml`'s `postgres` service
  definition (image/credentials single-sourced per ADR 0016/0018) in
  its own project, with a `!override` port remap (default 5499) and
  the app/authelia services simply not started.
- **Seed shapes** (from the migrations themselves): `users`
  (oauth_subject unique), `nodes` (wording + created_by), `edges`
  (unique (role, source, target) — seeded as a chain of consecutive
  node pairs so uniqueness holds by construction), `sessions`
  (host + topic), `session_events` (UNIQUE (session_id, sequence),
  kind CHECK — seeded as `node-created` rows with ascending
  per-session sequences and arbitrary JSONB payloads; the DB layer
  deliberately doesn't validate payload shape per 0010's comments).
- **Sandbox constraint**: the agent sandbox cannot pull images
  (registry blob CDNs blocked), so the executed run happens on a
  GitHub runner via a `workflow_dispatch` workflow — the same
  pattern as the rollback rehearsal and load test.

## Constraints / requirements

- **`scripts/migration-dry-run.sh`** with env knobs: `BASE_REF`
  (default `origin/main`), `DRYRUN_HOST_PORT` (5499), seed sizes
  (`DRYRUN_USERS`/`DRYRUN_NODES`/`DRYRUN_SESSIONS`/`DRYRUN_EVENTS` —
  edges are derived as the node chain),
  `DRYRUN_MAX_SECONDS` (120 — the candidate-apply budget). Prints
  the applied-pending list, the wall time, and the row counts;
  exits non-zero on apply failure, budget overrun, data loss, or
  ledger/file-count mismatch. `down -v` cleanup on success and
  failure alike.
- **No-pending case is explicit**: when `BASE_REF` already contains
  every working-tree migration, the drill reports that, still
  exercises the full mechanism (baseline apply + seed + no-op
  candidate pass + sanity), and exits 0.
- **`make migration-dry-run`** target + help text.
- **`.github/workflows/migration-dry-run.yml`** (`workflow_dispatch`,
  `base_ref` input). Executed once for this task via a temporary
  branch trigger (removed at completion) — and the run is genuinely
  meaningful: this branch carries a real pending migration
  (`0017_edges_polymorphic_endpoints.sql`) over `origin/main`'s
  baseline, so the drill times an actual `ALTER TABLE` + unique-index
  rebuild over the seeded edges.
- `bash -n` clean; actionlint clean; `pnpm run check` green.
- The release runbook's migration-checklist line gains the concrete
  command.

## Acceptance criteria

- On a Docker-capable machine: `make migration-dry-run` (defaults)
  completes all five phases and exits 0; `BASE_REF` pointing at a
  ref with fewer migrations makes the candidate phase apply and time
  the delta.
- The workflow run on a GitHub runner passed with the 0017 candidate;
  Status records the numbers.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **The real runner, not psql replay, for both phases.** The drill's
  subject includes the runner's own behavior (ordering check, single
  transaction, ledger writes); replaying SQL via psql would dry-run
  a code path production never executes. The baseline phase uses the
  same runner pointed at a `git show`-extracted directory.
- **SQL-generator seeding, not the app's synthetic seam.** Migration
  timing cares about table shapes and row volume, not event-log
  semantic validity; `generate_series` seeds 250k+ rows in seconds
  with no app build, no auth, and no compose `app` service. The load
  test already covers the semantically-valid-traffic axis.
- **Chained node pairs for edges.** Random endpoint pairs would
  collide with the `(role, source, target)` uniqueness; consecutive
  pairs give exactly `nodes − 1` unique edges with zero retry logic.
- **A time budget, not a lock profiler.** v1's bar is "the operator
  notices a migration that would stall a deploy"; 120 s against 50k
  rows is generous for additive DDL and trips loudly on accidental
  table rewrites. Postgres lock-level analysis (`log_lock_waits`,
  `pg_stat_activity` sampling) is a post-v1 refinement if a real
  migration ever gets close to the budget.
- **`BASE_REF` defaults to `origin/main`,** which makes the dev-loop
  question "do MY branch's migrations apply cleanly over what's
  merged?" the zero-config invocation; the release runbook's
  pre-release drill passes the production tag explicitly.

## Open questions

(none — all decided)

