# Rollback strategy

How a bad production release is rolled back, why the lever is **image
rollback and never migration rollback**, and how the repo keeps that
lever trustworthy. Fixed by
[ADR 0034](adr/0034-releases-calendar-versioning-tag-deploy.md)
(releases) and [ADR 0020](adr/0020-migrations-node-pg-migrate-forward-only.md)
(forward-only migrations); owned by
`deployment.prod_migrations.rollback_strategy`
([refinement](../tasks/refinements/deployment/rollback_strategy.md)).

The operator's step-by-step procedure lives in the rollback runbook
(`deployment.release_process.release_rollback_runbook`); this
document is the engineering strategy underneath it.

## The lever

Production rollback is **redeploying the previous image** from
Railway's Deployments tab — one click, no git operations, no schema
surgery. The previous image is always available because every release
is one tag → one image (ADR 0034).

What rollback does **not** do: reverse migrations. There are no
`down` migrations in this repo (ADR 0020), and nothing in the
rollback path executes DDL. Whatever schema the rolled-forward
release created is the schema the rolled-back image runs against.

## What the old image actually experiences

Every boot runs the startup migration gate
([`apps/server/src/index.ts`](../apps/server/src/index.ts) →
[`migrate-startup.ts`](../apps/server/src/migrate-startup.ts)):
`node-pg-migrate`'s runner with `direction: 'up'`,
`checkOrder: true`. After a rollback, the old image's gate sees a
`pgmigrations` table containing rows for migrations the image does
not ship. Two facts make that safe (verified against
`node-pg-migrate@8.0.4`, `dist/bundle/index.js` — `checkOrder` and
`getMigrationsToRun`):

- `checkOrder` compares only the **common prefix** of applied rows
  vs. on-disk files. Under the repo's append-only `NNNN_` numbering
  the prefix always matches, so the extra applied rows don't trip it.
- Migrations to run are "files not yet applied" — for the old image
  that set is empty, so the gate logs `No migrations to run!` and the
  server starts.

So the rolled-back image **boots**; the open question per rollback is
only whether its *application code* tolerates the newer schema. That
is the invariant below. (Don't trust the source analysis alone — the
rehearsal exercises this boot path live; see below.)

## The backward-compat invariant

> Every migration must be tolerable by the immediately previous
> deployed image. (ADR 0034)

"Tolerable" concretely: the previous image's queries still parse and
return what its code expects, and its INSERTs still succeed. Changes
that violate it — dropping or renaming a column the prior image
reads, changing a column's type, adding `NOT NULL` the prior image's
INSERTs won't satisfy, `TRUNCATE` — must not ship in a single
release.

**Enforcement is mechanical**: `pnpm run lint:migrations`
([`scripts/lint-migrations.ts`](../scripts/lint-migrations.ts)) runs
in `pnpm run check` and the CI Lint job, and rejects those patterns
unless the migration carries a per-rule justification marker
(`-- migration-safety: allow <rule-id>: <justification>`). See the
[safety-checks refinement](../tasks/refinements/deployment/migration_safety_checks.md).

## The two-tag dance (destructive changes)

A change the prior image cannot tolerate is split across two
consecutive releases (ADR 0034). Worked example — renaming
`users.screen_name` to `users.display_name`:

1. **Release N** — additive half. Migration adds `display_name`
   (nullable or defaulted), backfills it; app code writes both
   columns and reads `display_name`. The linter passes (purely
   additive). Rolling back N → N−1 is safe: N−1 still reads
   `screen_name`, which N kept writing.
2. **Release N+1** — destructive half. Migration drops
   `screen_name`; the file carries
   `-- migration-safety: allow drop-column: release N (vYYYY.MM.DD)
   stopped reading users.screen_name — N+1 half of the two-tag
   dance`. Rolling back N+1 → N is safe: N reads `display_name`,
   which still exists.

The justification marker is reviewed at the diff site; the release
runbook tells the author to run the rollback rehearsal (below) with
`PREVIOUS_IMAGE` set to release N before cutting N+1.

## The rehearsal

The committed rehearsal proves the rollback boot path against the
local compose stack — run it before any release whose migration is
not trivially additive, and after any change to the migration gate:

```sh
make rehearse-rollback
# or, against a real previous release:
PREVIOUS_IMAGE=ghcr.io/ruoso/aconversa-app:2026.06.01 make rehearse-rollback
```

No Docker-capable machine at hand? The same drill runs on a GitHub
runner via the manual **Rollback rehearsal** workflow
([`.github/workflows/rollback-rehearsal.yml`](../.github/workflows/rollback-rehearsal.yml)
— Actions tab → Rollback rehearsal → Run workflow; the
`previous_image` input maps to `PREVIOUS_IMAGE`).

[`scripts/rehearse-rollback.sh`](../scripts/rehearse-rollback.sh):

1. builds the **candidate** image from the working tree (override
   with `CANDIDATE_IMAGE`);
2. brings up a fresh, isolated stack (own compose project + volume,
   host port 3300 — a running dev stack is untouched), boots the
   candidate, asserts `/readyz` 200 (all migrations applied);
3. stops the candidate and **injects a synthetic future row** into
   `pgmigrations` (`9999_rollback_rehearsal_synthetic`) — the
   superset state a real rollback produces, with no second release
   needed;
4. boots `PREVIOUS_IMAGE` (default: the candidate itself —
   mechanics mode) against the same database, asserts healthy,
   `/healthz` 200, `/readyz` 200 when the image has it, and the
   gate's `No migrations to run!` line in the logs;
5. tears everything down (`down -v`) on success and failure alike.

## When the invariant was violated anyway

A rollback lands on an image that crashes or misbehaves against the
newer schema (linter bypassed, marker justification wrong). Recovery
is **roll forward, not schema surgery**:

1. Re-deploy the newest image again (undo the rollback) if the
   original incident allows it — a broken-rollback state is worse
   than the bug being rolled back.
2. Cut a fix tag (`vYYYY.MM.DD.N+1`) addressing the original
   incident; tags are cheap by design.
3. Last resort, accepting data loss back to the backup point:
   restore from the Postgres backup
   (`deployment.backup_and_export`; drill owned by
   `deployment_tests.backup_restore_drill`).

Hand-written reverse DDL against production is not an option in any
branch of this tree — it trades a known-bad state for an unknown one.
