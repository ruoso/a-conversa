# Runbook: rolling back a release

Operator procedure for backing out a bad production release. The
mechanics and the reasoning live in
[docs/rollback-strategy.md](../rollback-strategy.md) (read it once,
calmly, before you ever need this page); the release-cut procedure
this hands back to is [release.md](release.md). Fixed by
[ADR 0034](../adr/0034-releases-calendar-versioning-tag-deploy.md);
owned by `deployment.release_process.release_rollback_runbook`
([refinement](../../tasks/refinements/deployment/release_rollback_runbook.md)).

**Rollback = redeploy the previous image in Railway. Nothing
git-side changes, no migration is reversed, no tag is touched.**

## 1. Decide: roll back or fix forward?

- **Roll back** when the symptom is user-visible NOW (broken show,
  failed logins, crash loop) and the previous release didn't have
  it. A rollback takes ~2 minutes; a fix tag through CI takes 30+.
  Mid-show: roll back first, diagnose after.
- **Fix forward** when the symptom is tolerable and the diagnosis is
  already in hand — a new tag per the
  [release runbook](release.md) skips the rollback entirely.
- **Do NOT roll back** when the bad release shipped a
  **destructive migration** (one carrying a
  `-- migration-safety: allow …` marker — check the release's diff
  under `apps/server/migrations/`). The previous image is then a
  *known* non-tolerator of the current schema, and rolling back
  trades a known-bad state for a broken one. Go to the
  [strategy doc's violation chapter](../rollback-strategy.md#when-the-invariant-was-violated-anyway)
  and fix forward.

## 2. Determine the rollback target

Don't trust memory. The last-known-good version is:

- the version `/healthz` reported before the bad deploy (Railway's
  deploy history shows when the switch happened), or
- the previous entry in `CHANGELOG.md`.

The target is normally the release immediately before the bad one —
the backward-compat invariant is only guaranteed one step back
(ADR 0034). Rolling back further than one release is strategy-doc
territory, not a runbook move.

## 3. Act

In the Railway dashboard: **`app` service → Deployments → the
deployment for the target version → Redeploy.** One click; Railway
reuses that deployment's already-built image.

Do not: delete or re-cut any tag, revert commits on `main`, or touch
the database. The rolled-back image boots through its normal startup
migration gate, sees nothing to apply ("No migrations to run!" in
the deploy logs — expected, not an error), and serves. Details:
[strategy doc](../rollback-strategy.md#what-the-old-image-actually-experiences).

## 4. Verify

- `https://a-conversa.org/healthz` — version stamp shows the
  **target** version;
- `https://a-conversa.org/readyz` — 200, both checks `ok`;
- the user-visible symptom is gone;
- Sentry's error rate subsides (the bad release's errors stop
  accumulating);
- Railway deploy logs show the no-migrations-to-run gate line.

## 5. Follow up — the rolled-back state is an interim

1. Diagnose the bad release at leisure (its image, logs, and Sentry
   events all still exist).
2. Fix on `main`; cut a **new** tag per the
   [release runbook](release.md) (the bad tag stays where it is,
   forever — next free `.N` counter or next date).
3. Record the incident in the fix release's CHANGELOG entry —
   "reverts/fixes v2026.07.01" — so the deploy history reads
   coherently later.

## 6. If the rollback itself misbehaves

In order (from the
[strategy doc](../rollback-strategy.md#when-the-invariant-was-violated-anyway)):

1. **Redeploy the newest image again** (undo the rollback) — a
   broken-rollback state is worse than the original bug.
2. **Cut a fix tag** addressing the original incident.
3. **Restore from the Postgres backup** (accepting data loss back to
   the backup point) — last resort; owned by
   `deployment.backup_and_export`.

Hand-written reverse DDL against production is not on this list, in
any circumstance.
