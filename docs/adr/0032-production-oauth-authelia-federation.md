# 0032 — Production OAuth: Authelia federating to Google (Microsoft / Facebook / GitHub post-v1)

- **Date**: 2026-05-24
- **Status**: Accepted

## Context

[ADR 0002](0002-auth-self-hosted-oidc-authelia.md) settled the
production auth shape as a self-hosted OIDC service (Authelia) with
the backend speaking generic OIDC to it. [ADR 0017](0017-mock-oauth-authelia-users-file.md)
settled the dev-side counterpart: Authelia in users-file mode with six
checked-in dev users. Both ADRs deferred the production federation
chain — the actual list of upstream OAuth providers Authelia
proxies to — to `deployment.prod_compose.prod_oauth_config`. This ADR
resolves that deferral.

The deferred question is two layers deep:

1. **Which upstream providers.** Authelia can federate to Google,
   GitHub, GitLab, Microsoft (personal + work), Facebook, Apple,
   and any generic OIDC provider. Each upstream costs a developer
   account or OAuth-app registration to set up, and each adds a
   redirect-URI maintenance touch.
2. **Authelia's production configuration.** The dev config
   ([`infra/authelia/configuration.yml`](../../infra/authelia/configuration.yml))
   is sqlite-backed, filesystem-notifier, dev-only signing keys, and
   committed placeholder secrets. None of those are production-ready.

The provider-list decision is anchored in a-conversa's audience:
open-content creators making public debates. Two providers cover the
realistic v1 audience (Google for the general population, GitHub for
the technical/open-source crowd that's likely to find the project
first). Microsoft and Facebook extend reach into non-tech audiences
including the pt-BR / es-419 locales the platform supports
([DESIGN.md — Languages](../../DESIGN.md#languages)). Apple Sign In
requires an Apple Developer Program account ($99/yr) plus a more
complex JWT client-assertion flow plus opaque private-relay email
addresses — high cost for marginal v1 reach.

The shape of the v1 launch favors a smaller surface that can be
exercised end-to-end before the first show, with the
remaining providers added incrementally after launch when the
operational pattern is proven.

## Decision

**Production Authelia runs as a Railway service ([ADR 0031](0031-production-hosting-railway-paas.md)) federating to Google as
its sole upstream OAuth provider at launch.** Microsoft, Facebook,
and GitHub are added post-v1 by Authelia config + Railway Variables
edits (no app deploy). Apple Sign In is skipped indefinitely.

Production Authelia configuration:

- **Image** — same `authelia/authelia:4.39` upstream image as dev.
  No custom image; the dev/prod parity from ADR 0017's Consequences
  carries straight through. Configuration lives in
  `infra/authelia/prod/` (separate from the committed dev
  `infra/authelia/`) and is loaded via Railway's filesystem mount or
  Variables-rendered file.
- **Storage backend** — Postgres, not sqlite. Authelia gets its own
  database (`authelia`) on the same Railway Postgres add-on the
  application uses ([ADR 0031](0031-production-hosting-railway-paas.md)).
  Connection string supplied via Railway Variables; rotated as part
  of the same rotation flow as the app's `DATABASE_URL`.
- **Notifier** — SMTP. The notifier sends password-reset and similar
  flows that the dev filesystem notifier swallows. SMTP credentials
  supplied via Railway Variables; concrete provider pick (Postmark /
  Resend / SES) is a refinement-time decision and not architectural.
- **Signing material** — rotated, not the dev-committed JWKS. The OIDC
  JWKS RSA key is generated fresh for prod, stored as a Railway
  Variable, and rendered into the config at boot. The dev-only inline
  signing key from ADR 0017 is explicitly not used in prod.
- **Session / encryption / HMAC secrets** — rotated per the same
  pattern; the dev `dev-only-...-replace-in-env` placeholders are
  replaced with high-entropy values held as Railway Variables.
- **Access control** — `default_policy: one_factor` (same as dev).
  Any user with a successful upstream OAuth handshake is granted a
  session. No per-user allowlist; the platform is intentionally
  open. 2FA enforcement is deferred.
- **Cookie domain** — `a-conversa.org`. The application sits at the
  apex (`a-conversa.org`); Authelia sits at `authelia.a-conversa.org`.
  The shared parent domain satisfies Authelia's cookie-domain
  matcher (it requires a period in the domain, same constraint as
  dev's `authelia.aconversa.local` per [docs/dev-environment.md
  Host resolution for Authelia](../dev-environment.md#host-resolution-for-authelia)).
- **OIDC client to the app** — one client (`aconversa-app-prod`) with a
  rotated secret. Redirect URI is
  `https://a-conversa.org/api/auth/callback` (matches `APP_BASE_URL`
  + the auth-callback route the backend already implements).

Upstream federation (Google):

- **Google OAuth client** created in Google Cloud Console under the
  operator's account. The redirect URI registered with Google is
  Authelia's, not the application's:
  `https://authelia.a-conversa.org/api/oidc/callback/google` (Authelia's
  upstream-callback convention). The application never sees Google's
  redirect URI; that's the whole point of the federation layer.
- **Client ID** committed to the prod Authelia config file as a
  variable placeholder; **client secret** supplied via Railway
  Variable.
- **Scopes** — `openid email profile`. The platform reads no profile
  data beyond the OIDC subject identifier (ADR 0002 Context), but
  `email` is requested so Authelia can populate the federated-account
  display name. The application stores only the OIDC subject and
  the user-supplied screen name.

## Consequences

- **Backend auth code is unchanged.** The application speaks the same
  OIDC to Authelia in prod as in dev. The only delta is the issuer
  URL (`https://authelia.a-conversa.org` vs.
  `https://authelia.aconversa.local:9091`) and the client secret.
  ADR 0002's "backend stays provider-agnostic" promise holds.
- **Adding a provider is a config change, not a deploy.** When
  Microsoft / Facebook / GitHub land post-v1, the operator edits the
  prod Authelia config + adds Railway Variables for the new client
  credentials + restarts the `authelia` service. The application
  doesn't change. This is exactly the upside ADR 0002 chose Authelia
  for.
- **Authelia + the app share a Postgres instance.** Two databases on
  one Railway Postgres add-on. Acceptable at v1 scale; if Authelia's
  load profile diverges from the app's, a separate Postgres add-on
  is a refinement.
- **Apple Sign In is permanently out.** Revisit only if a concrete
  user demand emerges that can't be met by Google + Microsoft +
  Facebook + GitHub. The $99/yr + JWT assertion + private-relay
  email cost is not justified by an audience that already overlaps
  the other four.
- **Operator burden.** Setting up the Google OAuth client is a
  one-time dance in Google Cloud Console (~15 minutes). The
  redirect-URI maintenance burden when the domain changes is real
  but small (one URI per provider).
- **Account-linking is undefined for v1.** If a user signs in via
  Google in one session and Microsoft in another (post-v1, once
  Microsoft is added), Authelia treats them as separate accounts.
  No account-linking flow exists. Acceptable for an open platform
  where the per-account state is minimal (screen name only).
- **`infra/authelia/prod/` is operator-supplied, not committed.** The
  dev config under `infra/authelia/` stays committed (it has no real
  secrets per ADR 0017); the prod config gets the same `.gitignore`
  treatment as `.env`, and its template lives in the
  `prod_oauth_config` refinement.

## Deferred questions

- **Per-user account management UI.** Authelia has admin endpoints;
  v1 does not surface them in a-conversa's UI. Add when the operator
  needs to ban/delete a user.
- **2FA policy.** v1 ships one-factor everywhere. Revisit if
  abuse / impersonation becomes a concern.
- **Account-linking across upstreams.** Out for v1; design when
  multiple upstreams are active.
- **SMTP provider.** Refinement-time choice (Postmark / Resend / SES
  / etc.); not architectural.

## Verification

This ADR commits to the federation shape. End-to-end verification
(a browser session signing in via Google → Authelia → the app at
`a-conversa.org`) belongs to the `deployment.prod_compose.prod_oauth_config`
refinement, which cites this ADR as its decision input.
