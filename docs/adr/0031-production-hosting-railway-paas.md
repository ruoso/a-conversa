# 0031 — Production hosting: Railway PaaS

- **Date**: 2026-05-24
- **Status**: Accepted

## Context

M9 (`m_deployment_ready`) gates the first always-on production instance.
The dev stack (compose: app + Authelia + Postgres on a user-defined
bridge, [ADR 0018](0018-compose-file-three-service-dev-stack.md)) is the
inheritable shape; production needs a host for the same three components
plus TLS, a public hostname, and a story for migrations + secrets.

The hosting shape was a four-way pick: single VPS with compose,
managed PaaS (Fly.io / Railway / Render), Kubernetes, or self-hosted
PaaS (Coolify on a VPS). Kubernetes is overkill for a single hosted
instance running one debate at a time. Bare-metal compose puts the
TLS, backup, and update burden entirely on us. Managed PaaS trades a
small monthly bill for a large reduction in operator work — which is
the right trade for an open-content platform where the operator is
also the developer.

Within managed PaaS the pick narrowed to Fly.io vs Railway. Fly.io is
container-native with fine-grained per-resource billing and multi-region
networking; Railway is dashboard-driven Heroku-like with a one-click
managed Postgres add-on. Both support WebSockets without idle drops.
The deciding factor is operator time: Railway's built-in Postgres
(with daily backups) eliminates whole work items from the M9 WBS that
Fly would leave as manual setup, and the dashboard-driven flow is
faster to bootstrap with one operator. The portable Dockerfile means
the migration cost to Fly later is days, not weeks, if Railway
disappoints.

The project will be hosted at **a-conversa.org** as a single open
instance for open-content debates. Self-hosting docs are explicitly
deferred to post-v1 — third parties running their own instances is a
future story, not a v1 requirement.

## Decision

**Production runs as a single Railway project named `aconversa`.** Three
services in one project, on Railway's per-project private network:

- **`app`** — built from the repo `Dockerfile` ([ADR 0015](0015-dockerfile-multi-stage-pnpm-corepack.md)).
  Railway builds the image on tag push (per [ADR 0034](0034-releases-calendar-versioning-tag-deploy.md))
  rather than pulling from an external registry. The runtime container
  is the same one CI exercises in the `e2e-playwright` job — no
  prod-only image variant.
- **`authelia`** — `authelia/authelia:4.39` (the same upstream image
  [ADR 0017](0017-mock-oauth-authelia-users-file.md) uses in dev),
  configured per [ADR 0032](0032-production-oauth-authelia-federation.md)
  to federate to real upstream OAuth providers.
- **Postgres** — Railway's managed Postgres add-on. `DATABASE_URL` is
  injected into the `app` service as a Railway shared variable. Daily
  automatic backups are included.

Surrounding operational choices that fall out of the platform pick:

- **TLS + domain.** Railway auto-provisions Let's Encrypt certificates
  for any custom domain. `a-conversa.org` points at the `app` service
  via a CNAME registered at the domain's DNS provider. Authelia is
  reachable at `authelia.a-conversa.org` (separate CNAME → the
  `authelia` service) so the OIDC issuer URL is HTTPS-clean for both
  the browser and the in-network app→Authelia call.
- **Private networking.** `app` reaches `authelia` and `postgres` via
  Railway's per-project internal DNS (`<service>.railway.internal`)
  over IPv6. The Postgres connection never crosses the public
  internet.
- **Secrets.** Railway Variables hold every secret: `SESSION_TOKEN_SECRET`,
  the Authelia upstream OAuth client secrets, the Authelia OIDC
  client secret, and the Sentry DSN ([ADR 0033](0033-production-observability-railway-sentry.md)).
  No external secret manager.
- **Image registry.** None. Railway builds the Dockerfile from the
  git tag and serves the resulting image directly. The
  `deployment.prod_container.prod_image_publish` task reduces to
  configuring Railway's GitHub integration on the tag-triggered
  build.

## Consequences

- **Production shape diverges from `compose.yaml` in form but
  matches in structure.** The same three components (app + Authelia
  + Postgres), the same env-var contract (`DATABASE_URL`,
  `OIDC_ISSUER_URL`, `OIDC_CLIENT_*`, `SESSION_TOKEN_SECRET`,
  `APP_BASE_URL`), the same image. The prod analogue of
  `compose.yaml` is the Railway project's service configuration; the
  `deployment.prod_compose.prod_compose_file` task is reshaped to
  "Railway project configuration" (committed as `railway.json` for
  IaC + the Variables list documented in the self-host guide once it
  lands post-v1).
- **Vendor dependency on Railway.** A Railway outage is an a-conversa
  outage. Mitigated by: the portable Dockerfile (any container host
  runs it), the standard Postgres (any managed Postgres serves it
  given `DATABASE_URL`), and the Authelia upstream image. Migration to
  Fly.io or a self-hosted compose stack is a refinement task, not a
  rewrite.
- **Several M9 leaves shrink or are satisfied by the platform.**
  - `prod_image_publish` → "configure tag-triggered Railway build."
  - `prod_postgres_config` → "add Railway Postgres, attach to app."
  - `prod_tls_and_domain` → "add custom domain in Railway dashboard."
  - `prod_reverse_proxy` → satisfied by Railway's built-in routing;
    no separate reverse proxy.
  - `secret_storage_choice` → "Railway Variables."
  - `oauth_credentials_handling`, `postgres_credentials_handling`,
    `session_token_secret_handling` → all reduce to setting the
    relevant Railway Variables.
  - `postgres_backup` → Railway's daily backups.
  - `backup_restore_test` → a one-time drill against Railway's
    restore flow.
- **Staging is out of v1 scope.** Railway makes staging cheap (a
  second project), but per the M9 decisions there's no staging
  environment for v1. The `migration_dry_run` task is reshaped to
  "verify the migration against a local compose stack seeded with
  prod-sized data" (a one-off ahead of any destructive migration,
  rather than an automated step).
- **No scale-to-zero.** Railway's Hobby tier runs services
  always-on. This is the intended behavior — the dev stack's
  WebSocket reconnect UX assumes a server that's actually there. The
  cost is the always-on bill (~$5-25/mo realistic).
- **Cost shape.** Hobby plan ($5/mo base, includes $5 usage) covers
  the app + Authelia + Postgres at projected v1 traffic. First show
  may push into the $15-25/mo band; the operator monitors usage via
  the Railway dashboard. Billing alert configuration is deferred to
  the `admin_runbook` refinement.

## Deferred questions

- **Self-hosting recipe.** Defer to post-v1. When the recipe lands,
  it will either be (a) a `docker compose` file that mirrors the
  Railway service shape, or (b) a Railway template URL. The decision
  isn't urgent because no third-party self-hosting is planned in v1.
- **Preview environments per PR.** Railway supports them. Deferred
  to post-v1; the Authelia callback-URL juggling per preview is more
  work than it saves while the team is one person.
- **Multi-region.** Railway's Pro tier supports multiple regions;
  Hobby is one region (US-East). Acceptable for v1; revisit if/when
  an audience outside North America materializes.
- **Move-off plan.** Documented in the `admin_runbook` refinement so
  it isn't reinvented under pressure if Railway has to be left.

## Verification

This ADR commits to the platform shape. End-to-end verification (a
Railway project that actually serves traffic) belongs to the
`deployment.prod_container.prod_dockerfile` refinement and the
subsequent Railway-config refinement, both of which cite this ADR
as their platform decision.

## Amendments

- **2026-06-12** — The identity service in the Decision's service
  list changed: [ADR 0048](0048-production-oauth-dex-identity-broker.md)
  supersedes ADR 0032, replacing the `authelia` service
  (`authelia/authelia:4.39` at `authelia.a-conversa.org`) with a
  `dex` service (upstream `ghcr.io/dexidp/dex` image, tag pinned at
  refinement execution) at `auth.a-conversa.org`. Authelia shipped
  no upstream-federation role to configure. The platform decision —
  three Railway services, private networking, Variables for secrets,
  CNAME-per-service TLS — is unchanged; the secret inventory shrinks
  (no SMTP credentials, no operator-managed JWKS; see ADR 0048).
