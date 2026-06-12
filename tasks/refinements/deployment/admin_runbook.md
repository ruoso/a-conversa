# Admin runbook — common tasks, troubleshooting

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.deployment_docs.admin_runbook`
**Effort estimate**: 1d
**Inherited dependencies**: the operator chain (prod live), the runbook set (release, rollback, smoke, rotation, restore), and the observability/backup leaves — all settled.
**Executor**: agent-authored from the bring-up record; operator-maintained thereafter.

## What this task is

The operator's single entry point: orientation (topology, hostnames,
access), an index of every operational procedure (each owned by its
own runbook — this document links, never duplicates), a
troubleshooting playbook distilled from the real incidents of the
production bring-up, an explicit map of where alerts do and do not
come from, and a running incident log.

## Why it needs to be done

Every procedure existed but nothing tied them together; the
troubleshooting knowledge lived in one conversation transcript and
two refinement Status blocks. The runbook is what makes the system
operable by the operator-of-six-months-from-now (or a second
operator) without archaeology.

## Acceptance criteria

- `docs/runbooks/admin.md` exists, links every sibling runbook and
  the topology manifest, and carries the incident playbook + log
  seeded with the bring-up incidents.
- No procedure is duplicated into it — index + playbook only.

## Decisions

- **Index + playbook, not a manual.** Procedures stay in their owning
  runbooks (single source of truth); the admin runbook adds the two
  things nothing else owns: cross-cutting diagnosis patterns
  ("establish vantage first") and the incident log.

## Open questions

(none — all decided)

## Status

**Done — 2026-06-12.** [`docs/runbooks/admin.md`](../../../docs/runbooks/admin.md)
authored: orientation, common-task index over the five sibling
runbooks + provider-addition/log-reading/user-management pointers,
troubleshooting playbook (vantage-first diagnosis, edge-binding
404s, sign-in chain walk, deploy-failure triage incl. the
re-run-failed-job recovery and the silent-Crashed gap, database
notes), the alert-source map with the recorded deferrals, and the
incident log seeded with the two 2026-06-12 bring-up incidents.
