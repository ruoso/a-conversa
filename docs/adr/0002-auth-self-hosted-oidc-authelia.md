# 0002 — Authentication: self-hosted OIDC service via Authelia

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` needs federated identity over OAuth, with first-class wiring for the familiar providers (Google, GitHub, GitLab) and the ability to plug in any generic OAuth-compliant provider. The architectural constraints recorded in [docs/architecture.md — identity](../architecture.md#identity) and [— local development environment](../architecture.md#local-development-environment) shape the choice:

- The platform reads no profile data — OAuth is purely an authentication signal. The only user-supplied datum stored is a screen name collected during connect.
- The local development environment must run the full auth flow with no external accounts and no per-developer secrets — `make up` produces a working login.
- The same application image runs in dev and production; only the surrounding services differ.
- Open-source ethos: anyone cloning the repo must be able to run their own instance without a paid SaaS being a hard dependency. License must be compatible with AGPL-3.0-or-later.

The shape of the choice is three-way: a hosted SaaS identity provider (Auth0, Clerk), a self-hosted OIDC service that the project ships with (Keycloak, Authelia, Hydra+Kratos), or a hand-rolled OAuth client wired against upstream providers directly from the backend.

A hosted SaaS conflicts with the open-source self-hostability requirement and forces every operator to sign up for a third-party account. A hand-rolled OAuth client puts every upstream provider's quirks into the backend code and makes the dev-environment mock story messier (the backend has to special-case the mock). A self-hosted OIDC service decouples the backend from the set of upstream providers entirely — the backend speaks one protocol (OIDC) to one endpoint, and the set of upstream providers becomes a configuration concern of the identity service.

## Decision

The backend authenticates users via a **self-hosted OIDC service**. The specific tool is **[Authelia](https://www.authelia.com/)**.

The backend is a generic OIDC client. It speaks standard OIDC to Authelia and never directly talks to Google, GitHub, or any other upstream provider. Upstream identity providers are configured inside Authelia's YAML, not in application code.

Authelia was chosen over the alternatives in the self-hosted family for these reasons:

- **Single Go binary, single container.** Matches the project's "single Docker image, simple ops" deployment profile. Keycloak is a much heavier JVM service with a Postgres dependency of its own; overkill for our scale.
- **Authelia includes both an OIDC server and the federated login UI.** Hydra+Kratos splits these into two services with their own integration surface; we don't need that flexibility.
- **Apache-2.0 licensed**, compatible with AGPL-3.0-or-later.
- Lightweight enough to run as a regular Compose service in dev with no special tuning.

## Consequences

- **Backend stays provider-agnostic.** The backend only knows "OIDC, talk to this issuer URL." Adding a new upstream provider (say, a self-hosted GitLab for a private deployment) is a YAML edit in Authelia, not a code change.
- **One more service in every deployment.** Compose gains an `authelia` service in both dev and prod. Acceptable; it is a single container.
- **Authelia owns its own user/session data** (file-backed in dev, database-backed in prod). The application database stores only the OIDC subject identifier and the user-supplied screen name.
- **Operator burden:** anyone running their own a-conversa instance configures upstream OAuth credentials in Authelia's YAML, not in application env vars. This is a documentation task for `deployment.prod_compose.prod_oauth_config`.
- **Downstream tasks now constrained.** `backend.auth.*` builds against a generic OIDC client library. `dev_env.dockerfile_mock_oauth` becomes "package an Authelia container with prefab dev credentials" rather than "build a custom mock OAuth server." `deployment.prod_compose.prod_oauth_config` documents the Authelia YAML for real providers.

## Integration sketch

This is a sketch — implementation details belong to the dev-environment and deployment tasks.

**Development.** Authelia runs as a Compose service alongside the application and Postgres. It is preconfigured with a small set of dev users (e.g., `alice`, `bob`, `mod`) and known passwords, committed to the repo. The backend is configured to point at the Compose-internal Authelia URL as its OIDC issuer. A developer running `make up` can log in immediately with a dev account; no external OAuth credentials are needed and nothing leaves the machine.

**Production.** The same Authelia container runs in the prod Compose set, but its YAML is populated with real OAuth client credentials for Google, GitHub, GitLab, etc., supplied as secrets at deploy time. The backend's OIDC client config is identical in shape — only the issuer URL and the trust material differ. Operators wanting to add another provider edit Authelia's YAML and restart that one service.

**Open question (deferred).** Fully offline development — including tests where the dev Authelia instance must not reach out to a real upstream provider — needs a stubbed-upstream story. Authelia's dev users may already cover this (login terminates at Authelia without an upstream hop), but it needs verification when the dev environment is actually built. Tracked under `dev_env.dockerfile_mock_oauth`.

## Amendments

- **2026-05-10** — The dev-side counterpart now lives in [ADR 0017](0017-mock-oauth-authelia-users-file.md): Authelia in users-file mode with six checked-in dev users (alice, ben, maria, dave, erin, frank), no federated upstream in dev. The deferred open question above is resolved — login terminates at Authelia, fully offline. This ADR's production-side decision (self-hosted Authelia OIDC) is unchanged.
- **2026-05-24** — The production federation chain that this ADR's Integration Sketch left as "Google, GitHub, GitLab, etc., supplied as secrets at deploy time" is now concretized in [ADR 0032](0032-production-oauth-authelia-federation.md): Authelia federates to **Google only at launch**, with Microsoft / Facebook / GitHub added post-v1 as config-only changes (no app deploy). Apple Sign In is skipped indefinitely. The production runtime is a Railway service ([ADR 0031](0031-production-hosting-railway-paas.md)) rather than a Compose set, but the protocol surface to the application is unchanged: the backend still speaks generic OIDC to one Authelia issuer URL. This ADR's decision (self-hosted Authelia OIDC) is unchanged.
- **2026-06-12** — A factual premise of this ADR failed in execution: Authelia does **not** include federated login to upstream providers (the OIDC Relying Party role is an unbuilt, planning-stage roadmap item upstream — see [ADR 0048](0048-production-oauth-dex-identity-broker.md)). The production issuer role therefore moves to **Dex** per ADR 0048, which supersedes ADR 0032. This ADR's architectural decision — a self-hosted OIDC service with the backend as a generic, provider-agnostic OIDC client and upstream credentials outside the app — is unchanged, and is exactly what made the substitution cheap. Authelia remains the dev-side mock per [ADR 0017](0017-mock-oauth-authelia-users-file.md); it is no longer the production tool.
