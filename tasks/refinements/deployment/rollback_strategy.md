# Rollback strategy — document the mechanics, ship the local rehearsal

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_migrations.rollback_strategy`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.schema.migrations_tooling` (settled). Practically also `prod_migrations.migration_safety_checks` (settled in this same M9-prep batch — the linter is the enforcement half of the strategy documented here).
**Executor**: implementation agent — repo-only work (the rehearsal runs against the local compose stack), part of milestone `m_predeploy_agent_work` (M9-prep).

## What this task is

"Document and test rollback strategy." The strategy itself is fixed
by [ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md):

> **Rollback = redeploy the previous image** via Railway's
> Deployments tab. Migrations that landed with the rolled-forward
> release stay applied. The prior image must tolerate the newer
> schema.

This task delivers the two halves the ADR leaves open:

1. **The document** — `docs/rollback-strategy.md`: why image
   rollback (not migration rollback), what the prior image actually
   experiences when it boots against a newer schema, the
   backward-compat invariant and its enforcement (the safety
   linter), the two-tag dance, and what to do when a rollback is
   needed anyway for a release that violated the invariant.
2. **The test** — a committed, re-runnable local rehearsal
   (`scripts/rehearse-rollback.sh`, `make rehearse-rollback`) that
   exercises the rollback boot path against the compose stack and
   asserts the rolled-back container comes up healthy. Executed as
   part of landing this task (output recorded in Status).

## Why it needs to be done

- The rollback lever is only trustworthy if someone has actually
  pulled it before production needs it. The first execution of an
  undocumented, untested rollback during a live-show incident is the
  worst possible rehearsal venue.
- A load-bearing behavioral question was OPEN until this task: does
  the previous image's **startup migration gate** even boot when the
  database's `pgmigrations` table contains rows for migrations the
  image doesn't ship? If the gate aborted on unknown applied
  migrations, image rollback would be structurally broken regardless
  of schema compatibility. (Answer: it boots — see Inputs.)
- `release_rollback_runbook` gates on this leaf in the WBS and
  documents the operator procedure on top of the strategy fixed
  here; `deployment_tests.backup_restore_drill` and the M9 rollup
  follow.

## Inputs / context

- **ADR 0034** — image rollback, forward-only migrations (ADR 0020),
  the backward-compat invariant, the two-tag dance, the linter
  requirement (landed as
  [`migration_safety_checks`](migration_safety_checks.md)).
- **The startup migration gate** (`apps/server/src/index.ts` +
  `migrate-startup.ts`): every boot runs `node-pg-migrate`'s `runner`
  with `direction: 'up'`, `checkOrder: true`. Rollback therefore
  means the OLD image's gate runs against a DB whose `pgmigrations`
  has MORE rows than the image has files.
- **Upstream behavior verified against `node-pg-migrate@8.0.4`**
  (dist/bundle/index.js): `checkOrder(runNames, migrations)` compares
  only the common prefix (`len = min(runNames.length,
  migrations.length)`), and `getMigrationsToRun` selects files not in
  `runNames` — so a DB with applied rows that are a strict superset
  (in prefix order) of the image's on-disk files passes the order
  check and resolves to "No migrations to run!". Under the project's
  append-only `NNNN_` numbering, the prefix always matches. **The
  rolled-back image boots; the gate is rollback-safe by
  construction.** The rehearsal exercises this live rather than
  trusting source inspection alone.
- **Compose stack** (`compose.yaml` + `.env.example`): app (built
  from the repo Dockerfile, `NODE_ENV=production`, migration gate
  armed), postgres, authelia; the app healthcheck targets
  `/healthz`; `/readyz` (landed in this M9-prep batch) reports db +
  migration-gate state.

## Constraints / requirements

- **`docs/rollback-strategy.md`** covering: the lever (Railway
  Deployments tab → redeploy previous image), what the old image's
  boot actually does against the newer schema (gate no-op path), the
  invariant + linter + marker, the two-tag dance with a worked
  example, and the "invariant was violated anyway" recovery options
  (roll forward with a fix tag; restore-from-backup as last resort —
  owned by `backup_and_export`).
- **`scripts/rehearse-rollback.sh`** — committed, parameterized,
  idempotent (own compose project name, `down -v` cleanup on both
  ends, remapped host port so a running dev stack is untouched):
  1. build/tag the **candidate** image from the working tree (or
     accept `CANDIDATE_IMAGE`);
  2. fresh postgres + authelia; boot candidate; assert `/readyz` 200
     (migrations applied);
  3. stop the candidate; **inject a synthetic future row** into
     `pgmigrations` (`9999_rollback_rehearsal_synthetic`) — this
     simulates "the candidate applied a migration the previous image
     does not ship" without needing a real schema delta between the
     two images;
  4. boot the **previous** image (`PREVIOUS_IMAGE`; defaults to the
     candidate itself — the mechanics-mode self-rollback) against
     the same database; assert it reaches healthy, `/healthz` 200,
     `/readyz` 200 where the image has it, and that its logs show
     the gate took the no-migrations-to-run path;
  5. clean up.
- **`make rehearse-rollback`** target wrapping the script (Makefile
  is the repo's operator entry point), plus an on-demand CI venue:
  `.github/workflows/rollback-rehearsal.yml` (`workflow_dispatch`,
  optional `previous_image` input) so the drill can run on a GitHub
  runner when no Docker-capable local machine is at hand.
- **Executed once as part of this task** (via the dispatch workflow —
  see Decisions); outcome recorded in Status.
- `bash -n` clean; shellcheck clean if available.

## Acceptance criteria

- `docs/rollback-strategy.md` exists and covers the five content
  areas above.
- `make rehearse-rollback` runs the full rehearsal locally and exits
  0, including the synthetic-superset boot of the "previous" image;
  a failed health assertion exits non-zero.
- The rehearsal was executed and passed (Status records the run).
- `pnpm run check` green; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"`
  silent after `complete 100`.

## Decisions

- **The synthetic `pgmigrations` row is the superset simulator.**
  A "real" rehearsal needs two images whose migration sets actually
  differ — which won't exist until the first two calver releases.
  Injecting `9999_rollback_rehearsal_synthetic` before booting the
  previous image reproduces exactly what the gate sees after a real
  rollback (applied rows ⊃ on-disk files) with zero release
  prerequisites, so the rehearsal is meaningful from day one and
  stays meaningful (future runs can point `PREVIOUS_IMAGE` at the
  actual previous release tag).
- **Self-rollback default (`PREVIOUS_IMAGE` = candidate).** The
  mechanics being rehearsed — container swap against a live volume,
  gate no-op boot, health verification — are image-content-agnostic;
  defaulting to the candidate makes the rehearsal runnable in CI-like
  environments with no registry dependency. Real pre-release
  rehearsals (the release runbook's "before any not-trivially-additive
  migration" step) pass the genuine previous tag.
- **`/healthz` asserted always; `/readyz` asserted when present.**
  Genuinely old images predate `/readyz`; a 404 there must not fail
  a rollback rehearsal whose subject is the gate + schema
  tolerance. `/healthz` has existed since the API skeleton.
- **Recovery from an invariant violation is roll-FORWARD.** If a
  rollback lands on an image that genuinely can't tolerate the
  schema (the linter was bypassed or a marker was wrong), the
  documented recovery is cutting a fix tag — not hand-reversing DDL
  in production. Migration rollback stays off the table even in the
  failure story; restore-from-backup is the data-loss-accepting last
  resort and belongs to `backup_and_export`.
- **A `workflow_dispatch` job is the rehearsal's second venue.**
  The drill needs a Docker daemon with registry egress; the
  implementation-agent sandbox has the daemon but its network policy
  blocks registry blob CDNs, so the live run for THIS task executes
  on a GitHub runner via the new manual workflow (dispatched against
  the task branch). Deliberately not a per-merge CI job: the drill's
  subject only changes when migrations or the gate change, and the
  release runbook invokes it as a pre-release step, not per PR.
- **Upstream gate behavior pinned by rehearsal, not by unit test.**
  Pinning `checkOrder`'s prefix tolerance hermetically would mean
  either importing `node-pg-migrate` bundle internals (fragile) or
  building a pg-protocol shim for pglite (disproportionate). The
  rehearsal boots the real gate against a real superset DB — higher
  fidelity than any unit pin — and the strategy doc records the
  source-level analysis with version + line references for readers.

## Open questions

(none — all decided)

