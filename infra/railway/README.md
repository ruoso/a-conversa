# Railway production manifest — project `aconversa`

The versioned record of the production topology, sufficient (together
with the operator's password manager and the deployment refinements)
to rebuild the project on Railway or re-derive a compose file for
another host. Owned by the
[`prod_railway_iac_committed`](../../tasks/refinements/deployment/prod_railway_iac_committed.md)
task; per its acceptance, **no secret values appear here or anywhere
in git** — names, references, and structure only.

This file is deliberately an **index, not an inventory**: during the
2026-06-12 Dex rework every service refinement absorbed its own
variable table and config detail, and a duplicated inventory here
would drift from those. One line per fact; the link owns the detail.

**Live-state fetch:** `railway status --json` returns the project
topology (services, sources, start commands, domains) with no secret
values — it is the cross-check tool for this manifest, and what this
file was verified against on 2026-06-12. Variable *names* per
service: `railway variables --service <name> --json | jq 'keys'`
(never print values; they are secrets).

## Project

- **Name/region/plan**: `aconversa`, us-east, Hobby — [`prod_railway_project_bootstrap.md`](../../tasks/refinements/deployment/prod_railway_project_bootstrap.md)
- **Hostname scheme**: `www.a-conversa.org` is canonical (apex is
  registrar root-only forwarding) — ADR 0031, hostname-scheme
  amendment 2026-06-12.
- **Private networking**: Postgres traffic only; app→dex rides the
  public edge — [`prod_railway_internal_networking.md`](../../tasks/refinements/deployment/prod_railway_internal_networking.md)

## Services

### `app`

- **Source**: this GitHub repo, Dockerfile build. Build/deploy
  settings are enforced from [`railway.json`](../../railway.json) at
  the repo root (healthcheck `/readyz` per ADR 0033, restart
  on-failure) — Railway re-reads it on every deploy.
- **Deploys**: `v*` tags only, via the `deploy` job in
  `.github/workflows/release.yml` (`railway up --service app --ci`,
  `RAILWAY_TOKEN` repo secret); auto-deploy from `main` is off
  (ADR 0034).
- **Domain**: `www.a-conversa.org`.
- **Variables** (names + provenance): the table in
  [`prod_railway_app_service.md`](../../tasks/refinements/deployment/prod_railway_app_service.md)
  — `NODE_ENV`, `APP_BASE_URL`, `DATABASE_URL` (reference),
  `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `SESSION_TOKEN_SECRET`; `SENTRY_DSN` when error tracking is armed.

### `dex`

- **Source**: image `ghcr.io/dexidp/dex:v2.44.0` (pinned; upgrades
  are deliberate). Target port 5556.
- **Start command**: writes the Variables-rendered config and execs
  `dex serve` — the exact command, the config template, and the
  Variable table (`ACONVERSA_STORAGE_PASSWORD`, `ACONVERSA_PGHOST`
  reference, `ACONVERSA_OAUTH_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `ACONVERSA_DEX_CONFIG_YML`) live in
  [`prod_railway_dex_service.md`](../../tasks/refinements/deployment/prod_railway_dex_service.md).
- **Domain**: `auth.a-conversa.org` (the OIDC issuer).

### `Postgres`

- **Source**: Railway managed add-on
  (`ghcr.io/railwayapp-templates/postgres-ssl:18` at capture time —
  major 18; the dev/CI baseline is 16, covered by the pg18 e2e run
  prescribed in the refinement's open question).
- **Databases**: the add-on default (app, consumed only as the
  `${{Postgres.DATABASE_URL}}` reference) and `dex` (owner `dex`,
  least-privilege) — [`prod_postgres_config.md`](../../tasks/refinements/deployment/prod_postgres_config.md),
  [`postgres_credentials_handling.md`](../../tasks/refinements/deployment/postgres_credentials_handling.md).
- **Backups**: Railway daily backups enabled.

## Keeping this in sync

Any change to a service's Variables, domains, source, or start
command updates the owning refinement table (and this index if the
shape changed) in the same change — and re-run the cross-check:
`railway status --json` against this file.
