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

## 2026.06.13.1

Rate-limit hardening for the session-discovery endpoints.

- **Per-route rate limits on the discovery listings**: `GET
  /api/sessions/mine` and `GET /api/sessions/public` now carry an
  explicit `config.rateLimit` (100 requests / minute) layered on top of
  the global per-IP limiter from `createServer`. Closes CodeQL
  `js/missing-rate-limiting` alerts #11 and #12 (637e3ba8).

## 2026.06.13

Session discovery — viewers can now find sessions instead of needing a
direct link.

- **Public Sessions page**: an anonymous, paginated list of sessions
  that have started, served from a new `GET /api/sessions/public`
  endpoint (d13e6d69, fbee1312, d2da32a6).
- **My Sessions page**: an authenticated, role-annotated list of the
  signed-in user's sessions, backed by `GET /api/sessions/mine`
  (c7bafc5d, 51ef1844).
- **Discovery affordances**: each listed session offers a role-aware
  "join live" route and, where applicable, a "See replay" link
  (db685f05, 13b5a888).
- Sessions now record a `started_at` timestamp (with a backfill for
  existing rows), which is what the public list filters and orders on
  (5273ff8a). End-to-end coverage for the discovery flows landed
  alongside (b32b7ebd).

## 2026.06.12.3

Security bump and the operator-runbook set.

- **esbuild upgraded to 0.28.1** (121660b2), clearing the Dependabot
  security findings on the default branch.
- **Operational runbooks landed**: post-deploy smoke checklist,
  secret rotation (all five production secrets, drilled against
  production), and backup restore (drilled against a scratch target)
  — `docs/runbooks/` (617742a0, 11433f01, fb100bb5).
- Monitoring: Railway Pro threshold monitors configured; the external
  uptime probe is a recorded deferral to revisit before the first
  show (de58cd7a, ADR 0033 Amendments).

## 2026.06.12.2

Config-as-code for the app service's deploy settings.

- **`railway.json` committed** (27f98715): Railway now reads the app
  service's build/deploy settings from the repo on every deploy —
  notably the healthcheck moves from `/healthz` to **`/readyz`**, so
  a deployment doesn't go live until the database is reachable and
  migrations have applied (ADR 0033's deploy gate). This release is
  the first to exercise it, closing `prod_railway_iac_committed`;
  the narrative manifest lives at `infra/railway/README.md`.
- Record reconciliation with live production: `www.a-conversa.org` is
  the canonical hostname (ADR 0031 amendment, 4b1352fd), and the full
  e2e suite was validated against Postgres 18, the prod add-on's
  major (36cd0574).

## 2026.06.12.1

Production-auth pivot and the first tag-triggered deploy.

- **Dex replaces Authelia as the production OIDC issuer**
  ([ADR 0048](docs/adr/0048-production-oauth-dex-identity-broker.md),
  superseding ADR 0032): first execution found Authelia ships no
  upstream-federation (OIDC Relying Party) role, so production now
  runs `ghcr.io/dexidp/dex:v2.44.0` at `auth.a-conversa.org`,
  federating to Google. No application code changes — the backend's
  generic OIDC client is exactly what made the swap cheap (a2187830).
- **`release.yml` gains the deploy job**: gate → test → publish →
  `railway up --service app --ci` from the tag checkout, making the
  `v*` tag the only path to production per ADR 0034 (90488b17). This
  release is the first to exercise it.

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
