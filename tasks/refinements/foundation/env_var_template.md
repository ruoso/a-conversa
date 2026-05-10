# `.env.example` template

**TaskJuggler entry**: `foundation.dev_env.env_var_template` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort**: 0.25d

## What and why

Provide a `.env.example` at the repo root that documents every environment variable the application and dev compose stack expect. New contributors copy this to `.env` and edit as needed.

## Decisions

- Variables include: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_TOKEN_SECRET`, `APP_PORT`.
- Each line has a `# comment` documenting purpose, expected format, and dev-default value.
- `.env.example` is checked in; `.env` is in `.gitignore`.

## Acceptance criteria

- `.env.example` at repo root with documented variables.
- `cp .env.example .env && docker compose up` works without further editing.

## Status

**Done** 2026-05-10. `.env.example` lives at the repo root
([../../../.env.example](../../../.env.example)) with the nine variables
listed above, each preceded by a comment that documents purpose,
expected format, and the dev default. Variables are grouped under
`# --- Application ---`, `# --- Postgres ---`, `# --- OIDC (Authelia) ---`,
and `# --- Sessions ---` headers.

Verified end-to-end with `cp .env.example .env && docker compose up -d
postgres authelia`: both services reached `healthy` within ~11s,
followed by `docker compose down -v && rm .env`. The full-stack
`docker compose up` path (including `app`) is still expected to fail
because the application container exits 0 per ADR 0015 — `app` becomes
useful end-to-end once `backend.api_skeleton` lands; not in scope here.

Cross-references for downstream tasks:

- Production secrets (`OIDC_CLIENT_SECRET`, `SESSION_TOKEN_SECRET`,
  `POSTGRES_PASSWORD`) are owned by `deployment.prod_secrets`; the
  values in `.env.example` are dev-only placeholders.
- Per-test database URLs (overrides of `DATABASE_URL` for Playwright
  isolation) are owned by `foundation.test_infra.test_db_provisioning`.
- `APP_PORT` may need to be split or renamed once a frontend dev
  server (Vite) wants its own port; revisit as part of the frontend
  scaffolding task.
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` mirror the values registered
  in `infra/authelia/configuration.yml` (`aconversa-app-dev` /
  plaintext `aconversa-app-dev-secret`, stored hashed). Authelia's
  config was not modified for this task.
