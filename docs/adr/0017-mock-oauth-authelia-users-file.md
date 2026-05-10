# 0017 — Mock OAuth in dev: Authelia in users-file mode

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

The local-dev Compose stack needs an OIDC provider that issues real
tokens to the application without relying on external OAuth accounts.
Per [docs/architecture.md](../architecture.md) the local dev environment
must run the full auth flow with no external accounts and no per-developer
secrets — `make up` produces a working login. The application speaks
generic OIDC to Authelia in production ([ADR 0002](0002-auth-self-hosted-oidc-authelia.md));
the dev story has to exercise the same code path.

The shape of the choice is two-way: stand up a small mock-OIDC server
written for the project (e.g., `node-mock-oauth2-server`, a hand-rolled
Express handler), or run the same Authelia binary that production uses
in a dev-friendly configuration. The foundation refinement at
[tasks/refinements/foundation/dockerfile_mock_oauth.md](../../tasks/refinements/foundation/dockerfile_mock_oauth.md)
settled the broad shape (Authelia in users-file mode); this ADR records
the concrete dev-mode configuration choices and the boundary against the
surrounding tasks.

A separate mock-OIDC server is two implementations to maintain — the
dev server's behaviour drifts from real Authelia's behaviour over time,
and any subtle protocol-level bug in the application's relying-party
code won't be caught until it hits a real OIDC provider in CI or staging.
Authelia's flat-file users mode is faithful OIDC: the provider issues
real id_tokens, signs them with a real RSA key, exposes a real JWKS
endpoint and a real discovery document. The only thing that differs
between dev and prod is the user store behind the login screen
(committed YAML vs. database) and the upstream federation chain (none
vs. Google/GitHub/etc.).

## Decision

The local-dev OIDC provider is the **upstream Authelia image
(`authelia/authelia:4.39`) in users-file mode**, with all configuration
shipped in `infra/authelia/`. No custom Dockerfile, no separate mock
server, no fake-Google upstream chain.

- **Configuration files committed to the repo.**
  `infra/authelia/configuration.yml` (server, access control, sessions,
  storage, notifier, OIDC provider) and `infra/authelia/users.yml` (the
  six dev users) are mounted into the upstream image at `/config/`.
  Compose wiring lands with `compose_file`; this ADR fixes the contents.
- **Six dev users with one shared password.** `alice`, `ben`, `maria`,
  `dave`, `erin`, `frank` — three from the canonical walkthrough plus
  three more so two parallel Playwright sessions can run side by side.
  Every user authenticates with the same dev password (`aconversa-dev`,
  documented in `infra/authelia/README.md`). Per-user passwords would
  add ceremony without adding any property a contributor needs; the
  shared password is intentional and dev-only.
- **One-factor for everyone.** `access_control.default_policy:
  one_factor` with no per-rule overrides. 2FA in dev would require
  enrolment flows that are useless friction for testing the application.
  Production uses per-domain access rules and 2FA where it matters.
- **No federated upstream in dev.** Authelia issues tokens directly from
  its users-file. The login terminates at Authelia's own credentials
  screen; no fake Google or GitHub upstream is chained behind it.
  Production Authelia chains to real upstream providers; the
  application never sees the difference because the protocol surface
  to the application is identical.
- **Sqlite storage and filesystem notifier in dev.** Authelia requires
  both even when neither is exercised by the dev flow. Sqlite at
  `/var/lib/authelia/db.sqlite3` (backed onto a Compose volume so it
  survives `docker compose down` but drops on `down -v`); filesystem
  notifier writes any reset/2FA emails to `/var/lib/authelia/notifications.txt`
  for grep. Production swaps both for Postgres + SMTP via the
  production config, out of scope here.
- **Dev-only signing key inline.** The OIDC provider needs an RSA
  private key for id_token signing; an RSA-2048 key is generated with
  `authelia crypto pair rsa generate` and embedded inline in
  `configuration.yml` under `identity_providers.oidc.jwks[0].key`. It
  is not a secret — anyone reading the public repo can read it — and
  the only id_tokens it ever signs are dev id_tokens for dev users.
  Production overrides the JWKS entry with material held as a deploy
  secret.
- **Dev secrets are placeholders.** `session.secret`,
  `storage.encryption_key`, `identity_providers.oidc.hmac_secret`,
  `identity_validation.reset_password.jwt_secret`, and the OIDC
  client secret live in the committed config as recognisable
  `dev-only-...-replace-in-env` strings. Real values are supplied at
  runtime via the env-var overrides documented by `env_var_template`;
  production deploys never read the placeholders.

## Consequences

- **One identity-server implementation across dev and prod.** The
  application's OIDC client code is exercised against the same
  Authelia binary that runs in production; protocol-level bugs surface
  in dev rather than at deploy time. The mock-server implementation
  burden is zero — no code, no maintenance, no drift.
- **Six known dev users with one known password.** Documented in three
  places (this ADR, the infra README, the users-file header). Anyone
  cloning the repo can log in immediately. The shared-password
  decision is a dev-quality-of-life trade and is the natural amendment
  point if Playwright tests later need per-user credential isolation
  (per the ADR amendment carve-out — config rotation does not require
  a new ADR).
- **Cookie-domain choice (`aconversa.local`) leaks into the dev URL
  story.** Authelia's session validation requires the cookie domain to
  contain a period or be an IP, so plain `localhost` doesn't work. The
  Compose stack adds an `aconversa.local` entry to dev `/etc/hosts` (or
  routes via a dev reverse proxy); this is documented in the dev-env
  docs that `dev_env_docs` will write. Production uses real DNS names
  and is unaffected.
- **Compose wiring, env-var template, and the Playwright auth helper
  are deferred.** This ADR commits to the Authelia container's config
  surface; the surrounding tasks consume that surface:
  - `foundation.dev_env.compose_file` writes the `authelia` service
    block, the volume, and the dependency edges.
  - `foundation.dev_env.env_var_template` writes `.env.example` with
    the OIDC issuer URLs, client ID/secret, and Authelia secret
    overrides.
  - `foundation.test_infra.playwright_test_helpers` writes the
    auth-flow helper that drives Authelia's login screen and lands a
    test on the application with a session token.
- **Production config is a separate ADR.** The contents of
  `infra/authelia/` are dev-only. `deployment.prod_compose.prod_oauth_config`
  authors the production Authelia config (real upstream providers,
  production storage, production secrets) and supersedes nothing here.

## Verification

The committed configuration starts cleanly under
`docker run --rm -v "$PWD/infra/authelia:/config:ro" -v
/tmp/authelia-data:/var/lib/authelia -p 9091:9091
authelia/authelia:4.39 --config /config/configuration.yml`. Authelia
logs `Authelia v4.39.19 is starting`, performs a sqlite schema migration
to version 23, and reports `Startup complete` followed by `Listening
for non-TLS connections on '[::]:9091'`. The `/.well-known/openid-configuration`
endpoint returns 500 in this bare-container smoke test because the
issuer URL is configured for the Compose hostname rather than
`localhost`; full end-to-end OIDC discovery is verified by the Playwright
auth helper once `compose_file` and `env_var_template` are in place.
