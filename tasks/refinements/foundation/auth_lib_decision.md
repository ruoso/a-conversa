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

## Open questions

- **Which approach?**
  - **Self-hosted OIDC service** (Keycloak, Authelia, ory/hydra, dex): runs as a Compose service in dev and production. Pro: consistent local/prod story, no SaaS dependency. Con: another service to operate.
  - **Hand-rolled OAuth client** in the backend: directly speaks to provider OAuth endpoints. Pro: minimal dependencies, full control. Con: more code to maintain, less off-the-shelf.
  - **Hosted IDP** (Auth0, Clerk, etc.): faster to ship. Con: requires every operator to set up and pay for an account, conflicts with self-hosting story.
- **Which specific tool?** If self-hosted: Keycloak vs. Authelia vs. ory/hydra vs. dex.
- **Does the choice cleanly support the local mock OAuth provider workflow?** The dev environment requires single-command startup with no external accounts; the chosen approach must accommodate this.

The final decision is awaited from you.
