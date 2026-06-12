# OAuth credentials handling — the two client secrets

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_secrets.oauth_credentials_handling`
**Effort estimate**: 1d
**Inherited dependencies**: `secret_storage_choice` (settled — Railway Variables + the conventions in [`secret_storage_choice.md`](secret_storage_choice.md)).
**Executor**: human operator.

> **Reworked 2026-06-12** for [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md)
> (Dex replaces Authelia; ADR 0032 superseded). The biggest delta:
> the app↔broker secret is now **symmetric** — Dex static clients
> hold the secret as a value (via `secretEnv`), so the pbkdf2
> plaintext/digest split from the Authelia design no longer exists.

## What this task is

The handling rules for the **two distinct OAuth client secrets** in
the production auth chain — they're easy to conflate and must never be:

| Secret | Issued by | Authenticates | Where it lives |
|---|---|---|---|
| **Google upstream** (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) | Google Cloud Console | Dex (as Google's client) | secret → `dex` service Variable + password manager; ID is non-secret config |
| **App↔Dex** (`aconversa-app-prod`) | operator-generated (`openssl rand -base64 48`) | app (as Dex's client) | same value in **two** Variables — `app` service `OIDC_CLIENT_SECRET` and `dex` service `ACONVERSA_OAUTH_CLIENT_SECRET` — + password manager |

Creation steps live in [`prod_oauth_config.md`](prod_oauth_config.md)
(Google) and [`prod_railway_dex_service.md`](prod_railway_dex_service.md)
(app↔Dex); this document owns the invariants and rotation
procedures.

## Why it needs to be done

A leaked Google client secret lets an attacker impersonate the
*Dex deployment* to Google (phishing-grade consent screens under
the app's identity); a leaked app client secret lets an attacker
impersonate the *application* to Dex (token-endpoint access).
Both warrant explicit handling + rotation stories before launch, and
ADR 0048's "adding a provider is a config change" promise depends on
this per-provider pattern being repeatable.

## Constraints / requirements

- **The app↔Dex secret is symmetric but stays out of the config
  YAML.** Dex reads it via `secretEnv` from the
  `ACONVERSA_OAUTH_CLIENT_SECRET` Variable — it must never be pasted
  inline into the `ACONVERSA_DEX_CONFIG_YML` template (the YAML stays
  shareable for review). The two Variables hold the identical value;
  the password manager holds the third copy and names both Variables.
- **The Google secret is Dex-side only.** It must never appear in
  an app-service Variable — the application is provider-agnostic
  (ADR 0002) and has no business holding upstream credentials.
- Both secrets follow the two-store rule; password-manager entries
  note issue date and every Variable holding the value.
- The server never logs `OIDC_CLIENT_SECRET` (boot-config code treats
  it as opaque; pino redaction config is the backstop) — no action,
  but the invariant is owned here.

## Rotation procedures

**Google upstream secret** (e.g., suspected exposure, or routine):

1. Google Cloud Console → the Google client → add a
   **second** client secret (Google supports two concurrent).
2. Update `GOOGLE_CLIENT_SECRET` on the `dex` service + password
   manager; restart `dex`.
3. Verify a Google sign-in end-to-end, then delete the old secret in
   the console. Zero-downtime because both secrets are briefly valid.

**App↔Dex secret:**

1. Generate a fresh value (`openssl rand -base64 48`, as at creation).
2. Update `ACONVERSA_OAUTH_CLIENT_SECRET` on the `dex` service, then
   `OIDC_CLIENT_SECRET` on the `app` service, + the password manager.
3. Restart `dex`, then `app` (order matters: Dex must accept
   the new secret before the app starts presenting it). The gap is a
   few seconds of failed token exchanges at worst — rotate outside
   show hours.
4. Verify sign-in end-to-end.

## Acceptance criteria

- Both secrets exist per the table (correct services,
  password-manager entries with dates).
- The Google secret appears in no app-service Variable; the app↔Dex
  secret appears in exactly the two named Variables and **not** in
  the config YAML.
- Both rotation procedures have been **executed once** as a drill
  before launch (they're cheap, and an unrehearsed rotation under
  incident pressure is how secrets end up pasted in the wrong place).

## Decisions

- **Symmetric app↔Dex secret via `openssl rand -base64 48`**
  (2026-06-12). Dex's static clients verify the secret as a value, so
  there is no digest half to store asymmetrically; the mitigation for
  "broker config leaks the secret" is keeping the secret out of the
  YAML via `secretEnv`, which the Dex service refinement mandates.
  *(Historical: the Authelia design used an `authelia crypto`
  pbkdf2 plaintext/digest pair — retired with ADR 0032.)*
- **Pre-launch rotation drill for both secrets** (refinement-level) —
  rationale unchanged.

## Open questions

- **Post-v1 providers** (Microsoft/Facebook/GitHub, per ADR 0048):
  each repeats the Google pattern — console-issued pair, secret as a
  `dex`-service Variable expanded into the connector block, one
  redirect URI per provider. This document is the template; extend
  the table when they land.
