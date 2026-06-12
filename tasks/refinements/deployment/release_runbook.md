# Release runbook — the operator's tag-cut procedure

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.release_process.release_runbook`
**Effort estimate**: 1d
**Inherited dependencies**: `release_process.release_versioning` (settled in this M9-prep batch — the calver scheme, CHANGELOG conventions, and tag-gate workflow this runbook walks the operator through).
**Executor**: implementation agent — repo-only documentation, part of milestone `m_predeploy_agent_work` (M9-prep). The procedure itself is *exercised* by the operator at M9 (the first real tag cut).

## What this task is

Write the operator-facing, step-by-step procedure for cutting a
production release, per
[ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md):
pick the calendar version, write the CHANGELOG entry in the commit
that gets tagged, push the tag, watch the gated workflow through to
the deploy, and verify. Includes the **two-tag dance** procedure for
destructive migrations (ADR 0034 defers its "procedural detail" to
exactly this runbook) and the pre-release rollback rehearsal step.

## Why it needs to be done

- ADR 0034's Verification section names this leaf as the owner of
  the tag-cut procedure documentation; `release_rollback_runbook`
  gates on it in the WBS.
- The release process has a single human in the loop by design
  ("the CHANGELOG entry is the operator's pause-and-think moment");
  a written procedure is what makes that loop reliable at
  one-show-every-couple-weeks cadence, where every cut is preceded
  by enough time to forget the steps.
- M9-prep (`m_predeploy_agent_work`) lists this leaf; M9 gates on
  the full `release_process` rollup.

## Inputs / context

- **ADR 0034** — calver, same-commit CHANGELOG rule, tag-triggered
  deploy, no deploys from `main`, immutable tags, two-tag dance.
- **`release.yml`** (post-`release_versioning`) — the gate the
  procedure runs against: calver format, `main` ancestry, CHANGELOG
  entry, no-recut, smoke suites, ghcr publish. The Railway deploy
  job is appended by `prod_railway_app_service` (operator chain);
  the runbook references it as the final stage with a note about
  the pre-Railway interim.
- **`CHANGELOG.md`** — the `Unreleased` section convention the
  procedure consumes.
- **Migration discipline artifacts** — the safety linter
  (`migration_safety_checks`), the rollback strategy + rehearsal
  (`rollback_strategy`), and `migration_dry_run` (M9, prod-sized
  local dry run) — the runbook is where they're sequenced into the
  operator's flow.

## Constraints / requirements

- **`docs/runbooks/release.md`** (the `docs/runbooks/` directory is
  introduced here; the rollback runbook joins it next). Contents:
  - one-time setup (GitHub tag-protection ruleset for `v*` — the
    repo-settings layer of the no-recut defense);
  - preconditions checklist (target commit on `main` with CI green,
    `Unreleased` section accurate, migration checklist below clear);
  - the cut, step by step: version pick (zero-padded date, `.N`
    counter), CHANGELOG section rename + fresh `Unreleased`, the
    same-commit rule, tag + push commands, what the workflow gate
    will verify (so a gate failure is self-diagnosable);
  - watch-and-verify: workflow stages, the deploy, post-deploy
    checks (`/readyz`, version stamp, Sentry release) — referencing
    `smoke_test_after_deploy` as the owner of the full post-deploy
    checklist;
  - **migration checklist**: linter clean; if any migration is not
    trivially additive — dry run per `migration_dry_run`, rollback
    rehearsal with `PREVIOUS_IMAGE` = current prod tag;
  - **the two-tag dance**, procedurally: how to recognize you need
    it (the linter said so), what ships in release N vs N+1, the
    marker text to write, and the rule that N must actually be
    deployed (not just tagged) before N+1 cuts;
  - failure handling per stage (gate failure → fix and re-cut a NEW
    tag; deploy failure → rollback runbook).
- Commands shown must be the real ones (no pseudo-shell); tag names
  in examples follow the calver format.
- No secrets, no Railway dashboard walkthroughs (those live in the
  operator-executed `prod_railway_*` refinements).

## Acceptance criteria

- `docs/runbooks/release.md` exists and covers the seven content
  areas above; every referenced artifact (workflow, CHANGELOG,
  linter, rehearsal, dry run) is linked.
- A reader can dry-read the procedure against `release.yml` and find
  the gate steps in the same order the workflow runs them.
- `pnpm run format:check` green on the new file.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **`docs/runbooks/` as the runbook home.** Operator procedures are
  a different document genre from design docs (`docs/*.md` describe
  what IS; runbooks prescribe what to DO, in order, under time
  pressure). A subdirectory keeps the genre boundary visible and
  gives `release_rollback_runbook` and `admin_runbook` their slots.
- **Release N must be deployed before N+1 cuts (two-tag dance).**
  ADR 0034 defines the dance in terms of *releases*; the runbook
  makes explicit that tagging N without deploying it and then
  cutting N+1 silently reduces the dance to a single destructive
  release (the rollback target would skip N). The procedural rule:
  verify prod runs N before starting N+1.
- **Gate failures always produce a NEW tag, never a fixed re-push.**
  Follows from immutable tags (ADR 0034); the runbook spells out the
  mechanics (delete nothing; bump the `.N` counter).
- **The runbook references — never duplicates — the post-deploy
  smoke checklist.** `smoke_test_after_deploy` owns it; duplicating
  steps across runbooks is how they drift apart.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12. Landed as:

- [`docs/runbooks/release.md`](../../../docs/runbooks/release.md) —
  one-time setup, preconditions, the cut, watch-and-verify, the
  migration checklist, the two-tag dance procedure, and per-stage
  failure handling, with commands matching `release.yml`'s gate
  order.
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
