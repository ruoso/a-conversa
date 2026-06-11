# OAuth credentials handling — the two client-secret pairs

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_secrets.oauth_credentials_handling`
**Effort estimate**: 1d
**Inherited dependencies**: `secret_storage_choice` (settled — Railway Variables + the conventions in [`secret_storage_choice.md`](secret_storage_choice.md)).
**Executor**: human operator.

## What this task is

The handling rules for the **two distinct OAuth secret pairs** in the
production auth chain — they're easy to conflate and must never be:

| Pair | Issued by | Held by | Where each half lives |
|---|---|---|---|
| **Google upstream** (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) | Google Cloud Console | Authelia (as Google's client) | secret → `authelia` service Variable + password manager; ID is non-secret config |
| **App↔Authelia** (`aconversa-app-prod`) | operator-generated (`authelia crypto hash generate pbkdf2 --random`) | app (as Authelia's client) | **plaintext** → `app` service `OIDC_CLIENT_SECRET` Variable + password manager; **pbkdf2 digest** → Authelia config template |

Creation steps live in [`prod_oauth_config.md`](prod_oauth_config.md)
(Google) and [`prod_railway_authelia_service.md`](prod_railway_authelia_service.md)
(app↔Authelia); this document owns the invariants and rotation
procedures.

## Why it needs to be done

A leaked Google client secret lets an attacker impersonate the
*Authelia deployment* to Google (phishing-grade consent screens under
the app's identity); a leaked app client secret lets an attacker
impersonate the *application* to Authelia (token-endpoint access).
Both warrant explicit handling + rotation stories before launch, and
ADR 0032's "adding a provider is a config change" promise depends on
this per-provider pattern being repeatable.

## Constraints / requirements

- **Asymmetric storage for the app↔Authelia pair.** Authelia never
  stores the plaintext (digest only); the app never sees the digest.
  When generating, the plaintext is read once off the terminal into
  the two stores and never re-displayed.
- **The Google secret is Authelia-side only.** It must never appear in
  an app-service Variable — the application is provider-agnostic
  (ADR 0002) and has no business holding upstream credentials.
- Both pairs follow the two-store rule; password-manager entries note
  issue date and where the counterpart half lives.
- The server never logs `OIDC_CLIENT_SECRET` (boot-config code treats
  it as opaque; pino redaction config is the backstop) — no action,
  but the invariant is owned here.

## Rotation procedures

**Google upstream secret** (e.g., suspected exposure, or routine):

1. Google Cloud Console → the `aconversa-authelia-prod` client → add a
   **second** client secret (Google supports two concurrent).
2. Update `GOOGLE_CLIENT_SECRET` on the `authelia` service + password
   manager; restart `authelia`.
3. Verify a Google sign-in end-to-end, then delete the old secret in
   the console. Zero-downtime because both secrets are briefly valid.

**App↔Authelia secret:**

1. Generate a fresh pair (`authelia crypto hash generate pbkdf2
   --random …`, as at creation).
2. Update the digest in the `AUTHELIA_CONFIGURATION_YML` Variable and
   the plaintext in the app's `OIDC_CLIENT_SECRET` + password manager.
3. Restart `authelia`, then `app` (order matters: Authelia must accept
   the new secret before the app starts presenting it). The gap is a
   few seconds of failed token exchanges at worst — rotate outside
   show hours.
4. Verify sign-in end-to-end.

## Acceptance criteria

- Both pairs exist per the table (correct service, correct half,
  password-manager entries with dates).
- The Google secret appears in no app-service Variable; the app
  plaintext appears nowhere in the Authelia config.
- Both rotation procedures have been **executed once** as a drill
  before launch (they're cheap, and an unrehearsed rotation under
  incident pressure is how secrets end up pasted in the wrong place).

## Decisions

- **Random-generated app↔Authelia secret via `authelia crypto`'s
  `--random`** — gets a 72-char RFC3986-safe plaintext and the digest
  in one step, with no human-chosen value and no intermediate file.
- **Pre-launch rotation drill for both pairs** (refinement-level) —
  rationale above.

## Open questions

- **Post-v1 providers** (Microsoft/Facebook/GitHub, per ADR 0032):
  each repeats the Google pattern — console-issued pair, secret as an
  `authelia`-service Variable, one redirect URI per provider. This
  document is the template; extend the table when they land.
