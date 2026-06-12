# 0048 — Production OAuth: Dex identity broker federating to Google (supersedes 0032)

- **Date**: 2026-06-12
- **Status**: Accepted (supersedes [ADR 0032](0032-production-oauth-authelia-federation.md))

## Context

[ADR 0032](0032-production-oauth-authelia-federation.md) settled
production auth as Authelia federating to Google as its sole upstream
provider. On first execution of the
`prod_railway_authelia_service` refinement (2026-06-12), that premise
turned out to be **unimplementable: Authelia has no upstream-federation
capability in any released version.** Authelia implements only the
OIDC *Provider* role (apps log in via Authelia). The *Relying Party*
role — Authelia signing users in via Google or any upstream — is on
the upstream roadmap in the
[Planning stage](https://www.authelia.com/roadmap/planning/openid-connect-1.0-relying-party/),
every component marked "needs design"; the
[4.39 release notes](https://www.authelia.com/blog/4.39-release-notes/)
contain nothing of the kind, and the maintainers'
[stated sequencing](https://github.com/authelia/authelia/discussions/4471)
is provider-role-first, client role later. The boot validator said it
plainly: Authelia's only user sources are a `file` or `ldap` backend.
With no self-registration in Authelia, local accounts cannot serve an
open platform, so production Authelia has no viable role at all.

The gap stayed hidden because the dev mock ([ADR 0017](0017-mock-oauth-authelia-users-file.md))
terminates login at Authelia's users file — no upstream hop ever runs
in dev or CI. ADR 0002's rationale ("Authelia includes both an OIDC
server and the federated login UI") was wrong on the second half.

What still stands from ADR 0032: the provider list and its audience
rationale (Google covers the v1 audience; Microsoft / Facebook /
GitHub post-v1; Apple skipped), the broker pattern itself (backend
provider-agnostic per [ADR 0002](0002-auth-self-hosted-oidc-authelia.md),
upstream credentials never in the app, providers added without an app
deploy), the Railway service shape ([ADR 0031](0031-production-hosting-railway-paas.md)),
and Postgres-backed storage. What's needed is a broker that actually
has the Relying Party role.

Alternatives considered:

- **App speaks OIDC to Google directly.** No identity service in prod
  at all — but Google credentials move into the app (against
  ADR 0002's separation), each future provider becomes app code + a
  deploy, and Google's OIDC quirks (no `offline_access` scope) leak
  into the backend. Rejected: trades the decided architecture for a
  shortcut v1 doesn't need.
- **Keycloak / Zitadel.** Identity brokering is mature there, with
  account-linking UI. But they are full IdPs with admin consoles,
  realms, and a memory footprint to match — far more surface than a
  platform that consumes only `sub` + email. Rejected as oversized.
- **Wait for Authelia's RP role.** Unbounded timeline (planning-stage,
  needs-design). Rejected.

## Decision

**Production runs [Dex](https://dexidp.io/) as the OIDC issuer,
federating to Google as its sole upstream connector at launch.**
Microsoft, Facebook, and GitHub are added post-v1 as Dex connector
config + Railway Variables edits (no app deploy). Apple Sign In stays
skipped. Dev keeps the Authelia users-file mock per ADR 0017.

Production Dex configuration:

- **Image** — upstream `ghcr.io/dexidp/dex`, exact tag pinned at
  refinement execution (same no-custom-image rule as before).
- **Issuer** — `https://auth.a-conversa.org` (renamed from
  `authelia.a-conversa.org`; DNS is not yet provisioned, so the
  rename is free). `OIDC_ISSUER_URL` on the `app` service points
  there; nothing else app-side changes.
- **Storage** — Postgres: a `dex` database and least-privilege `dex`
  role on the shared Railway add-on, same pattern
  `prod_postgres_config` used for the `authelia` database (which is
  dropped). Dex generates and rotates its own token-signing keys
  inside storage — no operator-managed JWKS.
- **Downstream client** — one static client `aconversa-app-prod`,
  redirect URI `https://a-conversa.org/api/auth/callback`, scopes
  `openid profile email offline_access` (Dex supports
  `offline_access`; Google's refresh-token quirk stays Dex's problem,
  not the app's).
- **Google connector** — client created in Google Cloud Console; the
  redirect URI registered with Google is Dex's callback under the
  issuer (`https://auth.a-conversa.org/callback` by Dex convention —
  verify at execution). Scopes `openid email profile`, as in
  ADR 0032.
- **Config delivery** — the Variables-rendered config file via custom
  start command, and the `ACONVERSA_*` Variable naming, exactly as
  landed in the `prod_railway_authelia_service` refinement; the
  remaining secrets are the storage password, the app↔Dex client
  secret, and the Google client secret.
- **Verify-at-execution discipline** — every Dex config key name and
  endpoint path written into refinement docs is confirmed against the
  Dex documentation for the pinned tag during execution, never from
  memory. This ADR records architecture only. (This rule is the
  direct lesson of how ADR 0032 failed.)

## Consequences

- **Backend auth code is unchanged.** The app speaks the same generic
  OIDC; only the issuer URL value differs. ADR 0002's
  provider-agnostic promise is preserved by substituting the broker.
- **Adding a provider remains a config change, not a deploy** — Dex
  connectors play the role Authelia's federation block was assumed
  to.
- **The secret surface shrinks substantially.** Gone: the JWKS
  private key (Dex self-manages signing keys), the SMTP notifier and
  its credentials (Dex sends no mail — the SPF/DKIM DNS records leave
  `prod_tls_and_domain`, and no transactional-email account is
  needed), the session, storage-encryption, reset-JWT, and HMAC
  secrets (Authelia-specific).
- **The pbkdf2 digest asymmetry dies.** Dex static clients hold the
  client secret as a value (env-supplied where supported — verify at
  execution), not a digest. `oauth_credentials_handling`'s
  app↔broker pair becomes symmetric: same secret in two Variables.
  The two-store rule and rotation drills still apply.
- **Dev/prod image parity dies; contract parity is what remains.**
  Dev exercises the app's OIDC client against Authelia, prod runs it
  against Dex. The protocol surface is standard OIDC both sides, and
  end-to-end verification against real Dex+Google belongs to
  `prod_oauth_config` — but a class of issuer-behavior differences
  now exists that dev cannot catch. Accepted.
- **No admin surface at all.** ADR 0032 deferred surfacing Authelia's
  admin endpoints; Dex has no user management whatsoever (it stores
  no users). Banning/deleting a user is wholly an application-layer
  concern (the app stores the OIDC subject + screen name) — the
  deferred per-user-management question moves to the app side.
- **Account-linking remains undefined for v1.** Dex subjects are
  connector-scoped; a user arriving via two upstreams (post-v1) is
  two accounts. Same acceptance as ADR 0032.
- **WBS / refinement impact.** `prod_railway_authelia_service` is
  reworked as a Dex service task (the config-plumbing decisions —
  Variables-rendered file, `ACONVERSA_*` naming, base64 fallback —
  carry over); `prod_oauth_config`, `oauth_credentials_handling`,
  `postgres_credentials_handling`, `prod_postgres_config` (the
  `dex` database replacing `authelia`), and `prod_tls_and_domain`
  (subdomain rename, SPF/DKIM removal) get matching edits.
- **Project-health risk.** Dex is a CNCF project with wide deployment
  in the Kubernetes ecosystem; if it ever stalls, the swap-out cost
  is one service, since the app is a generic OIDC client — the same
  property that made this supersession cheap.

## Verification

End-to-end verification (browser → Google → Dex →
`a-conversa.org` session) stays with the
`deployment.prod_compose.prod_oauth_config` refinement, now citing
this ADR as its decision input.
