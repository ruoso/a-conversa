# Backup restore runbook

Validating that Railway's daily Postgres backups actually restore —
and rehearsing the moves before they're ever needed under pressure.
Owned by `deployment.backup_and_export.backup_restore_test` (the
procedure) and `deployment.deployment_tests.backup_restore_drill`
(the rehearsal). RPO at v1 is **one day** (Railway's daily schedule,
verified enabled under `prod_postgres_config`).

Railway's backup/restore UI moves around — the steps below name
capabilities, not buttons; follow the current dashboard.

## The drill (run periodically; first run pre-launch)

1. **Pick a backup.** Postgres service → Backups → most recent daily
   snapshot.
2. **Restore to a scratch target, never over production.** If the
   dashboard restores in-place only, first fork/duplicate the
   database service and restore onto the fork. Production keeps
   serving throughout the drill.
3. **Verify the restored data** (via `railway connect` against the
   scratch instance):
   - both databases present (the app's default DB and `dex`);
   - the app's event log is intact: row counts on the core tables
     (sessions, events, users) are plausible against production's;
   - the most recent event's timestamp is within the backup window
     (≤ RPO).
4. **Tear the scratch instance down** — it contains production data;
   it must not outlive the drill (and it bills).
5. **Record the run**: date, backup used, verification outcome, time
   the restore took (that's the realistic RTO floor), one line in the
   operator log / admin runbook.

## Real-recovery notes (when it's not a drill)

- The restore target choice is different: stand up the restored
  instance, verify it (step 3), then repoint by swapping which
  service the `${{Postgres.DATABASE_URL}}` reference resolves from —
  never hand-paste a connection string
  ([`postgres_credentials_handling`](../../tasks/refinements/deployment/postgres_credentials_handling.md)).
- The `dex` database restores with the same snapshot; Dex re-runs its
  migrations idempotently on boot. Sessions/refresh tokens inside it
  may be stale after a restore — users re-authenticate; that's
  expected and fine.
- Anything lost inside the RPO window is event-log data — say so
  plainly in the incident note; the event-sourced model means there
  is no partial-recovery ambiguity to paper over.
