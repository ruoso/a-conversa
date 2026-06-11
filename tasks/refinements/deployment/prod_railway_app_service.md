# App service — Dockerfile build, Variables wiring, tag-triggered deploy

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_compose_file.prod_railway_app_service`
**Effort estimate**: 0.5d
**Inherited dependencies**: `prod_railway_project_bootstrap` (settled — project + GitHub link). Practically also `prod_postgres_config` (the `DATABASE_URL` reference needs the add-on to exist) — do that first.
**Executor**: human operator (dashboard config, secret Variables, Railway token). One small code touchpoint (release workflow edit) can be delegated, but the operator supplies the token.

## What this task is

Create the `app` service in the `aconversa` Railway project: built
from the repo's root `Dockerfile`, deployed **only when a `v*` tag is
cut** (never on `main` pushes), with the full set of environment
Variables the server consumes — including the production secrets.

## Why it needs to be done

This is the application itself. `prod_railway_internal_networking`,
`prod_tls_and_domain`, and every later observability/release task act
on this service. The Variables set here are the production embodiment
of the entire `prod_secrets` rollup.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> **`app`** — built from the repo `Dockerfile`. Railway builds the
> image on tag push (per ADR 0034) rather than pulling from an
> external registry. The runtime container is the same one CI
> exercises in the `e2e-playwright` job — no prod-only image variant.

From [ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md):

> Pushing a tag matching `v*` runs a GitHub Actions workflow that (a)
> verifies the tag was made from a commit on `main`, (b) verifies
> tests pass on that commit, (c) emits a build artifact and signals
> Railway to deploy the tagged commit. Direct pushes to `main` do
> **not** trigger production deploys.

Existing artifacts:

- **`Dockerfile`** (repo root) — multi-stage, runtime is
  `node:20-alpine`, listens on **3000**, runs as the `node` user, and
  **applies pending migrations on startup before listening** (the
  gate aborts the boot on migration failure — this is the deploy-time
  migration runner ADR 0034 references).
- **`.github/workflows/release.yml`** — already triggers on `v*` tags
  and publishes the image to ghcr.io. The ghcr publish predates
  ADR 0031 (which needs no external registry); it stays as an
  open-source artifact, but Railway does not consume it — the Railway
  deploy signal is **added to this workflow** here.
- **Server env contract** (see `.env.example` and
  `apps/server/src/auth/config.ts`): boot-validates `OIDC_ISSUER_URL`,
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `APP_BASE_URL`;
  `SESSION_TOKEN_SECRET` must be ≥32 bytes and, under
  `NODE_ENV=production`, must not match the known dev placeholders;
  `DATABASE_URL` absence skips the migration gate with a warning —
  in production it must always be present.
- **`/healthz`** exists (liveness). `/readyz` lands with
  `observability.health_and_readiness_endpoints`; per ADR 0033 it
  becomes the Railway readiness probe — switch the healthcheck path
  when it ships.

## Execution steps (operator)

1. **Create the service.** In the `aconversa` project: New → GitHub
   Repo → select the a-conversa repo. Name the service **`app`**.
   Railway detects the root `Dockerfile`; confirm the builder is
   "Dockerfile".
2. **Disable auto-deploy.** In the service's settings, disable
   automatic deploys on push to `main` (per ADR 0034, only tags
   deploy). The first deploy will be triggered manually or by the
   first tag — expect it to **fail or idle** until Variables and
   Postgres wiring below are in place; that's fine.
3. **Set the target port** to `3000` (the Dockerfile's `EXPOSE`/listen
   port) and the **healthcheck path** to `/healthz`.
4. **Wire the Variables** (service → Variables). Generation and
   handling rules for each secret live in the linked refinements:

   | Variable | Value | Notes |
   |---|---|---|
   | `NODE_ENV` | `production` | arms the boot gates (secret denylist, Secure cookies, CORS/WS-origin lockdown, JSON logs) |
   | `APP_BASE_URL` | `https://a-conversa.org` | OIDC redirect URI derives from it (`/api/auth/callback`) |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | **reference**, not a pasted value — [`postgres_credentials_handling.md`](postgres_credentials_handling.md) |
   | `OIDC_ISSUER_URL` | `https://authelia.a-conversa.org` | must equal the issuer Authelia advertises |
   | `OIDC_CLIENT_ID` | `aconversa-app-prod` | per ADR 0032 |
   | `OIDC_CLIENT_SECRET` | plaintext half of the generated pair | [`oauth_credentials_handling.md`](oauth_credentials_handling.md) — the digest half goes in the Authelia config |
   | `SESSION_TOKEN_SECRET` | `openssl rand -base64 48` | [`session_token_secret_handling.md`](session_token_secret_handling.md) |
   | `SENTRY_DSN` | *(leave unset)* | set when `observability.error_tracking` lands; absence is non-fatal (ADR 0033) |

   Rate-limit / body-size / WS-payload variables keep their built-in
   defaults — set none of them.
5. **Create the deploy token.** Project Settings → Tokens: create a
   project token scoped to the production environment, named
   `github-actions-deploy`. Add it to the GitHub repo as Actions
   secret **`RAILWAY_TOKEN`** (repo Settings → Secrets and variables →
   Actions). Record it in the password manager.
6. **Extend `release.yml`.** Add a deploy job after the existing
   publish job: checkout the tag, then
   `railway up --service app --ci` with `RAILWAY_TOKEN` in the
   environment (the CLI builds/deploys the checked-out tag commit).
   This is the "signals Railway" step from ADR 0034 and may be
   delegated to an implementation agent — it contains no secret
   values, only the secret *name*.
7. **First deploy.** Trigger a deploy (manual "Deploy" on the service,
   or cut the first tag once the Authelia service is also up). Watch
   the deploy logs for the migration gate applying all migrations,
   then the listen line; confirm the service goes healthy on
   `/healthz`.

## Constraints / requirements

- No deploys from `main` — the tag is the only path to production
  (ADR 0034). Verify auto-deploy stays off after Railway UI changes.
- Variable **names** are exactly the server's env contract above; the
  IaC task commits the name inventory, never values.
- `OIDC_CLIENT_SECRET` and `SESSION_TOKEN_SECRET` are generated fresh
  for production — no reuse of any committed dev value.
- The deploy is not "done" until the migration gate has run green in
  the deploy logs at least once against the production database.

## Acceptance criteria

- Service `app` exists, builder = Dockerfile, target port 3000,
  healthcheck `/healthz`, auto-deploy from `main` disabled.
- All Variables in the table are set (and `SENTRY_DSN` intentionally
  absent); `DATABASE_URL` shows as a reference to the Postgres
  service, not a literal.
- A `v*` tag push runs CI → publish → Railway deploy with no manual
  dashboard action, and the deployment becomes healthy.
- Deploy logs show the startup migration gate applying the migrations,
  then the server listening.
- `https://<railway-generated-domain>/healthz` returns 200 (custom
  domain comes in `prod_tls_and_domain`).

## Decisions

- **Deploy signal = `railway up --ci` from the tag checkout in
  `release.yml`** (this refinement; ADR 0034 fixed *that* a signal
  exists, not the mechanism). Alternative surveyed: a `release` branch
  that the workflow fast-forwards to the tag with Railway watching
  that branch — fewer tokens, but it splits "what is deployed" between
  a branch pointer and a tag, and Railway's branch auto-deploy can
  race the workflow's test gate. The CLI call keeps the workflow the
  single sequencing point. Rollback is unaffected: Railway's
  Deployments tab redeploys any prior image either way.
- **ghcr.io publish stays.** Harmless, useful as a public artifact for
  the post-v1 self-hosting story; Railway ignores it.
- **Healthcheck on `/healthz` now, `/readyz` when it lands** —
  ADR 0033; tracked under
  `observability.health_and_readiness_endpoints`.

## Open questions

- **Railway UI drift.** Token scoping, healthcheck fields, and the
  auto-deploy toggle move around the dashboard; the steps name the
  *capability*, the operator follows the current UI.
- **`railway up` build context.** `railway up` uploads the local
  checkout for the build; confirm at execution time that this respects
  `.dockerignore` and produces the same image as CI's buildx job (it
  builds the same Dockerfile from the same tree, so it should).
