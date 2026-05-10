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
