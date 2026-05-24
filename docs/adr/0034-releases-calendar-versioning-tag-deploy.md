# 0034 — Releases: calendar versioning, tag-triggered deploy, forward-only with image rollback

- **Date**: 2026-05-24
- **Status**: Accepted

## Context

The `deployment.release_process` rollup has three leaves:
`release_versioning`, `release_runbook`, `release_rollback_runbook`.
M9 needs all three before public traffic lands. The migration
strategy is already settled — [ADR 0020](0020-migrations-node-pg-migrate-forward-only.md)
commits to forward-only migrations via `node-pg-migrate`. What's
open is: how a release is named, how it gets to production, and
how a rollback works given the forward-only constraint.

The platform context shapes the answer. v1 ships from `main` to one
production target ([ADR 0031](0031-production-hosting-railway-paas.md))
with no staging environment per the M9 scope decisions. There's no
external API surface that needs semver — the platform's users are
humans signing in via a browser, not developers integrating against
a versioned API. The release cadence is "one show every couple
weeks" with bug-fix deploys between. The operator and the
developer are the same person.

In that shape, semver carries cost without payoff. There's nothing
to declare breaking against — every change is observable in the UI,
not in an API contract. Date-based versioning matches the natural
cadence (each show is roughly one release) and makes "when did
this go live?" trivially answerable from the tag itself.

For rollback, the forward-only constraint means the lever is
**image rollback, not migration rollback**. Railway's Deployments
tab lets the operator redeploy any prior image in one click, but
migrations stay applied. That puts a discipline burden on
migrations: every migration must be backward-compatible with the
immediately previous deployed image. The discipline is enforceable
via a migration linter and a two-tag dance for destructive
changes; without that scaffolding, rollback silently breaks.

## Decision

**Releases use calendar versioning, deploy on git tag push, and
roll back by redeploying the previous image — never by reversing
the migration.**

- **Versioning** — `YYYY.MM.DD`, e.g., `2026.06.01`. Two releases
  in the same day suffix `.1`, `.2`, etc.: `2026.06.01.1`. Tags are
  prefixed with `v` per git convention: `v2026.06.01`,
  `v2026.06.01.1`. No semver. No pre-release suffixes.
- **CHANGELOG.md** at the repo root, updated in the same commit
  that creates the tag. One entry per tag. Format: a short list of
  user-visible changes; PR / commit hashes for traceability. No
  Conventional Commits requirement.
- **Tag-triggered deploy.** Pushing a tag matching `v*` runs a
  GitHub Actions workflow that (a) verifies the tag was made from a
  commit on `main`, (b) verifies tests pass on that commit, (c)
  emits a build artifact and signals Railway to deploy the
  tagged commit. Direct pushes to `main` do **not** trigger
  production deploys. The operator explicitly cuts a release.
- **Forward-only migrations** — confirmed per [ADR 0020](0020-migrations-node-pg-migrate-forward-only.md).
  No `down` migrations are written. The migration runner is the
  same `migrate-startup` gate the dev stack uses; Railway runs it
  as part of every deploy.
- **Rollback = redeploy the previous image** via Railway's
  Deployments tab. Migrations that landed with the rolled-forward
  release stay applied. The prior image must tolerate the newer
  schema.
- **Backward-compat invariant for migrations.** A schema change
  the immediately previous app cannot tolerate (dropping a column
  the prior version reads, renaming a column, changing a type in
  a non-widening way) is **split across two consecutive releases**:
  - Release N: app stops reading the soon-to-be-removed column /
    starts writing the new shape additively.
  - Release N+1: migration removes the old column / completes the
    rename.
  This makes rolling back from N+1 to N safe (the data shape N
  expects still exists, because the destructive migration only
  ran in N+1, which is what we just rolled away from).
- **Migration safety linter** — owned by the
  `prod_migrations.migration_safety_checks` refinement. Rejects
  migrations that fail the backward-compat invariant (column
  drops, renames, type narrowing) without a paired prior-release
  marker. The exact mechanism (PR-time check vs pre-commit hook)
  is a refinement-time choice; the *requirement* is settled here.

## Consequences

- **The tag is the release name.** "What's running in prod?" is
  the latest `v*` tag. The CHANGELOG entry under that tag answers
  "what changed?". No version-resolution ceremony.
- **No semver-breaking-change protocol.** Acceptable because the
  platform has no programmatic API surface for which
  breaking-change signaling is meaningful. If a-conversa later
  publishes a webhook or HTTP API for third-party consumers,
  that surface gets its own semver — a separate decision.
- **One tag = one image = one rollback target.** Operationally
  simple. Railway's Deployments tab shows the history; rollback
  is one click. No `docker pull` ceremony, no registry hygiene.
- **Discipline burden lands on migration authors.** Every
  migration must be safe to roll back away from. The linter
  catches violations mechanically; the two-tag dance is the
  documented escape hatch for genuinely destructive changes.
  Worth it: the alternative (writing reversible `down`
  migrations) costs every migration's author a chunk of work to
  cover the rare rollback case.
- **No staging dry-run.** Per the M9 scope decisions, prod-only
  for v1. The `migration_dry_run` task is reshaped to "verify
  the migration against a local compose stack seeded with
  prod-sized data" — an operator action ahead of any
  not-trivially-additive migration, documented in the
  `release_runbook` refinement.
- **Continuous deployment is intentionally not the model.**
  Tag-on-merge would couple every PR merge to a production
  deploy. With one operator and no staging, the human-in-the-loop
  tag step is the safety. The CHANGELOG entry is the operator's
  pause-and-think moment.
- **Re-cutting a tag is forbidden.** Once `v2026.06.01` is
  pushed, it points at one commit forever. A fix gets a new tag
  (`v2026.06.01.1`), not an amended tag. Force-pushing tags is
  blocked by the workflow.

## Deferred questions

- **Automated CHANGELOG generation.** v1 writes the entry by hand
  at tag time. Automation (e.g., from PR labels or commit
  conventions) is a refinement-time call once the volume justifies
  it.
- **Migration safety linter implementation.** Owned by
  `prod_migrations.migration_safety_checks`. This ADR fixes the
  invariant (backward-compat with the previous image); the linter
  refinement picks the mechanism.
- **The two-tag dance procedural detail.** Owned by
  `release_runbook`. This ADR fixes that the dance exists for
  destructive migrations; the runbook documents the step-by-step
  for the operator.
- **Public API surface.** If/when a-conversa exposes a webhook or
  HTTP API for third-party integration, that surface gets its own
  versioning — likely semver. Out of scope until the use case
  exists.

## Verification

This ADR commits to the release shape. The GitHub Actions
workflow, the Railway tag-trigger configuration, the CHANGELOG
seed, and the migration-safety linter are owned by:

- `release_process.release_versioning` — adopts calendar
  versioning, seeds CHANGELOG.md.
- `release_process.release_runbook` — documents the tag-cut
  procedure including the two-tag dance for destructive
  migrations.
- `release_process.release_rollback_runbook` — documents the
  one-click Railway image rollback, including the
  forward-only constraint and the migration-discipline
  invariant.
- `prod_migrations.migration_safety_checks` — implements the
  linter that enforces the backward-compat invariant.

All four refinements cite this ADR as their decision input.
