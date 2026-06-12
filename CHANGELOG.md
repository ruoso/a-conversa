# Changelog

Release history for a-conversa, one entry per release tag.

The release scheme is fixed by
[ADR 0034](docs/adr/0034-releases-calendar-versioning-tag-deploy.md):

- **Calendar versioning.** Releases are named `YYYY.MM.DD`
  (zero-padded), tagged `vYYYY.MM.DD`. A second release on the same
  day appends a counter: `2026.06.01.1`, tagged `v2026.06.01.1`.
  No semver, no pre-release suffixes.
- **One entry per tag.** Each entry is a short list of user-visible
  changes, with PR / commit hashes for traceability. No Conventional
  Commits requirement.
- **Same-commit rule.** The entry for a release is added (by renaming
  the `Unreleased` section below to the version) in the same commit
  that gets tagged. The release workflow's gate refuses a tag whose
  version has no entry here.
- **Tags are immutable.** A pushed tag is never re-cut; a fix gets a
  new tag. The gate refuses to overwrite an already-published
  release.

The changelog starts at the adoption of ADR 0034 — earlier history
lives in the git log and the project WBS (`tasks/`).

## Unreleased

- Pre-deployment agent work (M9-prep): production observability
  (`/readyz` readiness probe, Sentry error tracking armed by
  `SENTRY_DSN`, periodic `app-metrics` log lines), release
  versioning + tag-gated publish workflow, migration safety linter
  (`lint:migrations`), rollback strategy + rehearsal
  (`make rehearse-rollback`), release + rollback runbooks
  (`docs/runbooks/`), production image pass (server-only runtime
  dependencies, package managers removed from the runtime layer),
  and the basic load test (`make load-test`).
