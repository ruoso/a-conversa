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

## 2026.06.12

First release — the complete MVP (milestones M1–M8 plus the
pre-deployment hardening pass), ahead of the first production
deployment.

a-conversa is a debate platform built as the format for a YouTube
show: two debaters, one moderator, a live audience. Every statement
is captured into a shared live graph and classified — by statement
kind (fact / predictive / value / normative / definitional) and by
argument role (supports / rebuts / qualifies / bridges-from /
bridges-to / defines / contradicts) — and no change lands until every
participant agrees. The format slows debate down so clarity can
build: internal contradictions, category mismatches, and bedrock
axioms become visible instead of slipping past.

What this tag contains:

- **The four surfaces**, served single-origin: root landing + auth
  (`/`), moderator console (`/m/*`), participant tablet (`/p/*`), and
  audience view (`/a/*`); UI localized in `en-US`, `pt-BR`, and
  `es-419`.
- **The debate engine**: event-sourced sessions over a global graph,
  per-facet agreement voting, structural diagnostics, decomposition
  and interpretive splits, axiom marking, change history, and full
  debate replay.
- **The platform underneath**: server-authoritative real-time over
  WebSockets (Fastify + Postgres), federated OAuth identity with
  screen names only, annotation endpoints at the schema layer
  (da9a6a80).
- **Production readiness (M9-prep)**: `/readyz` readiness probe,
  Sentry error tracking armed by `SENTRY_DSN`, periodic `app-metrics`
  log lines, this tag-gated release process (ADR 0034) with its ghcr
  publish workflow, migration safety linter (`lint:migrations`) with
  an executed prod-sized dry-run drill, rollback strategy + rehearsal
  (`make rehearse-rollback`), release + rollback runbooks
  (`docs/runbooks/`), a minimized production image, and a basic load
  test (`make load-test`).
