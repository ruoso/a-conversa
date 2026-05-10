# Pick auth library / OAuth implementation

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.auth_lib_decision`
**Effort estimate (placeholder)**: 1d
**Inherited dependencies**: none — truly unblocked

## What this task is

Decide what mechanism the backend uses to authenticate users via OAuth. The choice is between a self-hosted identity service (which the project ships with), a hosted identity provider (which users would have to sign up for to deploy a-conversa), or a hand-rolled OAuth client wired against external providers directly.

## Why it needs to be done

The auth choice gates the entire backend authentication subsystem (`backend.auth.*`), the dev-environment local OAuth provider (`dev_env.dockerfile_mock_oauth`), and the production OAuth configuration (`deployment.prod_compose.prod_oauth_config`).

It is independent of the backend language choice and can be made in parallel.

## Inputs / context

From [docs/architecture.md — open architectural questions](../../../docs/architecture.md#open-architectural-questions):

> Auth library / OAuth implementation. Self-hosted (Keycloak, Authelia, hand-rolled OAuth client) vs. hosted (Auth0, Clerk). Self-hosted aligns with open-source values; hosted is faster to ship.

Architectural facts that constrain the choice (from [docs/architecture.md — identity](../../../docs/architecture.md#identity)):

- **Federated identity via OAuth** — accept generic OAuth providers, with first-class wiring for the familiar ones (Google, GitHub, GitLab, etc.).
- **Do not read identity profile data.** OAuth is used purely as an authentication signal.
- **Ask each user a screen name** during the connect flow. The screen name is the only piece of user-supplied info the platform stores.
- **All session participants must be authenticated.** Audience watching via OBS broadcast does not authenticate.

Other constraints:

- The local development environment runs entirely locally. A local OAuth provider must work in Docker Compose without external accounts (`dev_env.dockerfile_mock_oauth`).
- Open-source ethos — the chosen approach should be reproducible by anyone running their own instance, without a paid SaaS being a hard dependency.

## Constraints / requirements

- Generic OAuth client capability (so any OAuth-compliant provider can be plugged in).
- First-class wiring for at least Google and GitHub at v1.
- Compatible with a local mock OAuth provider for development (so `make up` produces a fully working auth flow without real provider credentials).
- Doesn't read or store profile data beyond the OAuth subject identifier.
- Works with the chosen backend language (downstream of `lang_decision`, but the identity-service approach itself can be language-independent if the project uses a self-hosted OIDC service like Keycloak or Authelia).
- Open-source license compatible with AGPL-3.0-or-later (the project's license).

## Acceptance criteria

- A specific approach chosen (self-hosted OIDC service / hosted SaaS / hand-rolled OAuth client) and the specific tool named.
- Rationale recorded in the ADR log.
- A draft of how it integrates with the dev environment (mock provider) and production (real providers).

## Decisions

- **Approach: self-hosted OIDC service.** Runs as a Compose service in dev and production. Generic OIDC client in our backend speaks standard OIDC to it. Upstream identity providers (Google, GitHub, GitLab) plug in via the OIDC service's configuration, not application code.
- **Specific tool: Authelia.** Single Go binary that includes both an OIDC server and a federated login UI. Lightest-weight option in the self-hosted family; matches the project's "single Docker container, simple ops, open-source self-hostable" profile. Avoids the hydra+kratos two-service complexity.

## Open questions

- **Local mock-provider workflow.** Authelia in Compose with prefab dev credentials should be enough; need to verify the upstream-provider stub story for fully offline development (i.e., tests where Google/GitHub aren't reachable). Will surface during dev-env build.

## Status

**Done** — 2026-05-10. Recorded as [ADR 0002 — Authentication: self-hosted OIDC service via Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md).
