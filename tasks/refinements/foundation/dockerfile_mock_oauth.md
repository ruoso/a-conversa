# Local mock OAuth provider container

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.dev_env.dockerfile_mock_oauth`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton` (settled)

## What this task is

Provide a local OAuth provider that runs in Compose so dev environments can complete the full auth flow without external accounts. The application speaks OIDC to **Authelia** in production (per T2 / T3); for dev, we run an Authelia container (or a tiny mock-OIDC alternative) configured with a known set of dev users.

## Why it needs to be done

The architecture explicitly requires that `make up` brings the full stack up with no external accounts needed (per architecture.md — local dev environment). The auth flow has to work end-to-end in dev: user → app → Authelia → app → session-token issued. Without a local provider, every developer would need real Google/GitHub credentials wired in.

## Inputs / context

T3 chose **Authelia** for production OIDC. Authelia supports both production-style federated upstream (Google, GitHub, etc.) and a local users-file mode that's perfect for dev — login with a known username/password and Authelia issues OIDC tokens just like in production.

The app integrates as a generic OIDC client. Same client code in dev and prod; only the OIDC issuer URL changes.

For dev, the mock-OAuth container is **Authelia in users-file mode**:

- A small `users.yml` checked into the repo with a few dev accounts (e.g., `alice`, `ben`, `maria`).
- Authelia runs in a container, loads the users file, exposes its OIDC endpoints on a known port.
- The `.env.example` points the application at `http://authelia:9091` (or similar) as the OIDC issuer.

This way the dev story exercises the same OIDC code path as production; no separate mock-OIDC implementation; no external accounts.

## Constraints / requirements

- A Compose service entry (Authelia container) with a checked-in users file and minimal config.
- Dev users have known passwords (documented in the README's Development section).
- Realistic OIDC flow — issuer discovery, authorization code, token endpoint, JWT issuance.
- The application points at this issuer in dev; in production the same code points at the production Authelia.
- No external network calls during dev or test runs.

## Acceptance criteria

- A `dev/authelia/configuration.yml` (or equivalent) checked in.
- A `dev/authelia/users.yml` with a small set of dev users (alice, ben, maria, etc.).
- A Compose service entry running the upstream Authelia image with these mounted in.
- `.env.example` includes the dev issuer URL pointing at the local Authelia.
- A Playwright helper that runs through the auth flow against the dev Authelia and ends up with a session token.

## Decisions

- **Use Authelia in dev**, not a separate mock-OIDC server. Same code path as production; one less implementation to maintain.
- **Dev users file checked in.** No external accounts; passwords documented in the dev README so contributors know how to log in.
- **No federated upstream in dev.** Authelia issues tokens directly; we don't try to chain to a fake "Google" in dev. (The production Authelia chains to the real upstream providers.)

## Additional decisions

- **No upstream-stub in v1.** Authelia in local-user mode is faithful enough OIDC that the application's relying-party code is exercised the same way as production. Revisit only if tests need to specifically exercise the federated upstream path.
- **Six dev users**: `alice`, `ben`, `maria` (canonical from the walkthrough) plus `dave`, `erin`, `frank` so two parallel sessions can run in tests.
