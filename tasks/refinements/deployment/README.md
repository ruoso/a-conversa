# Deployment refinements — operator-executed provisioning

This directory refines the `deployment` work-stream
([tasks/70-deployment.tji](../../70-deployment.tji)). Unlike the other
refinement directories, most of these tasks are **executed by a human
operator**, not by an implementation agent: they require privileged
access (Railway account + billing, Google Cloud Console, the
`a-conversa.org` DNS registrar, GitHub repo admin) and they handle
secret material that must never enter the repository, the shell
history, or an agent transcript.

Decision inputs for the whole set:

- [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md) — Railway PaaS, project `aconversa`, three services.
- [ADR 0032](../../../docs/adr/0032-production-oauth-authelia-federation.md) — Authelia federating to Google; prod Authelia config shape.
- [ADR 0033](../../../docs/adr/0033-production-observability-railway-sentry.md) — Railway logs + Sentry; `/readyz` as deploy gate.
- [ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md) — calendar versioning, tag-triggered deploy, image rollback.

## Prerequisites checklist (privileged access)

Before starting, the operator needs:

- [ ] **Railway account** with a payment method (Hobby plan, ~$5/mo base). Billing is a personal/financial action — only the operator can do this.
- [ ] **GitHub admin** on the a-conversa repository (to install the Railway GitHub App and add an Actions secret).
- [ ] **Google account** with access to Google Cloud Console (to create the OAuth client).
- [ ] **Registrar / DNS control for `a-conversa.org`** (to add the CNAME/ALIAS records and, later, the SMTP sender-domain records).
- [ ] **An SMTP provider account** (operator's pick — see `prod_railway_authelia_service.md`) for Authelia's notifier.
- [ ] **A password manager** (or equivalent offline secret store) to hold the canonical copy of every generated secret.
- [ ] **A local machine with Docker and `openssl`** to run the secret-generation commands (the Authelia image generates its own key material).

## Execution order

The dependency-correct order for a first production bring-up:

1. [`prod_railway_project_bootstrap.md`](prod_railway_project_bootstrap.md) — account, CLI, project, GitHub link.
2. [`prod_postgres_config.md`](prod_postgres_config.md) — Postgres add-on, the `authelia` database + role.
3. [`prod_oauth_config.md`](prod_oauth_config.md) (Google Cloud Console half) — can run in parallel with 2; produces the Google client ID/secret that step 5 consumes.
4. [`prod_railway_app_service.md`](prod_railway_app_service.md) — `app` service, Variables, tag-triggered deploy.
5. [`prod_railway_authelia_service.md`](prod_railway_authelia_service.md) — `authelia` service, prod config rendering, all Authelia secrets.
6. [`prod_railway_internal_networking.md`](prod_railway_internal_networking.md) — private-network audit + cross-service Variable references.
7. [`prod_tls_and_domain.md`](prod_tls_and_domain.md) — custom domains + DNS records; flips the public URLs live.
8. [`prod_reverse_proxy.md`](prod_reverse_proxy.md) — verification only (satisfied by Railway's edge).
9. [`prod_oauth_config.md`](prod_oauth_config.md) (verification half) — end-to-end Google sign-in once DNS is live.
10. [`prod_railway_iac_committed.md`](prod_railway_iac_committed.md) — commit the IaC manifest + variable inventory.

The `prod_secrets` leaves are **policies, not separate work sessions** —
they're executed inline during steps 4–5 and exist so the handling rules
have a home and a completion marker:

- [`secret_storage_choice.md`](secret_storage_choice.md) — settled: Railway Variables (ADR 0031).
- [`session_token_secret_handling.md`](session_token_secret_handling.md)
- [`postgres_credentials_handling.md`](postgres_credentials_handling.md)
- [`oauth_credentials_handling.md`](oauth_credentials_handling.md)

## Secret-handling ground rules (apply to every step)

- Generate secrets locally; paste them into Railway Variables and the
  password manager, **nowhere else**. No secrets in git, `.env`,
  chat transcripts, or issue trackers.
- Prefer command substitution (`--set "X=$(openssl rand -base64 48)"`)
  or the dashboard paste box so values don't land in shell history.
- Every secret gets a row in the password manager at creation time,
  named exactly after its Railway Variable. The password manager is the
  disaster-recovery copy; Railway is the runtime copy.
- Production secrets share **no material** with the committed dev
  values in `.env.example` / `infra/authelia/` (which are public).

## Out of scope here

The remaining `deployment` rollups (`prod_migrations`, `observability`,
`backup_and_export`, `release_process`, `deployment_docs`,
`deployment_tests`) are mostly code/document tasks and get their own
refinements when scheduled. The repo-only leaves among them (no
secrets, no privileged access) are tracked as milestone
`m_predeploy_agent_work` (M9-prep) in
[`tasks/99-milestones.tji`](../../99-milestones.tji), so agents can
clear them in parallel with the operator chain above. That batch
shipped 2026-06-11/12; its refinements live in this directory too:

- [`structured_logging.md`](structured_logging.md), [`error_tracking.md`](error_tracking.md), [`basic_metrics.md`](basic_metrics.md), [`health_and_readiness_endpoints.md`](health_and_readiness_endpoints.md) — observability code side (ADR 0033; `docs/observability.md`).
- [`migration_safety_checks.md`](migration_safety_checks.md), [`rollback_strategy.md`](rollback_strategy.md) — migration discipline (ADR 0034; `docs/rollback-strategy.md`, `make rehearse-rollback`).
- [`release_versioning.md`](release_versioning.md), [`release_runbook.md`](release_runbook.md), [`release_rollback_runbook.md`](release_rollback_runbook.md) — release process (ADR 0034; `CHANGELOG.md`, the `release.yml` tag gate, `docs/runbooks/`).
- [`prod_dockerfile.md`](prod_dockerfile.md), [`prod_image_minimization.md`](prod_image_minimization.md) — the production image pass (ADR 0015 Amendments).
- [`load_test.md`](load_test.md) — the capacity drill (`make load-test`).

Their **human touchpoints**, for planning:

- `observability.error_tracking` — operator creates the Sentry account/project and sets `SENTRY_DSN` (absence is non-fatal per ADR 0033, so the app service can go live without it).
- `observability.uptime_monitoring` — operator configures the external probe (Sentry uptime or BetterStack) and alert routing.
- `backup_and_export.postgres_backup` / `backup_restore_test` — operator verifies Railway's daily backups and runs the restore drill.
- `release_process.*` — the tag-cut procedure itself (the operator pushes `v*` tags).
- `deployment_tests.smoke_test_after_deploy` — operator runs the post-deploy smoke checklist after each release.
