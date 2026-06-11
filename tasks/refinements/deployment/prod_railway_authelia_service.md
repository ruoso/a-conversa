# Authelia service — upstream image, prod config rendering, secret generation

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_compose_file.prod_railway_authelia_service`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_railway_project_bootstrap` (settled). Practically also `prod_postgres_config` (the `authelia` database + role) and the Google client credentials from `prod_oauth_config` (can be stubbed with placeholders to bring the service up, but sign-in won't work until they're real).
**Executor**: human operator (all of this is secret generation + dashboard work).

## What this task is

Stand up the `authelia` service in the `aconversa` project from the
upstream `authelia/authelia:4.39` image, with the **production**
configuration: Postgres storage, SMTP notifier, freshly generated
signing/secret material, the `aconversa-app-prod` OIDC client, and the
Google upstream client wiring. The Google Cloud Console side lives in
[`prod_oauth_config.md`](prod_oauth_config.md); this task lands the
service shell and the config plumbing.

This refinement also carries the **prod config template** — per
ADR 0032 the rendered config is operator-supplied (gitignored, like
`.env`), so the template's home is this document, not the repo tree.

## Why it needs to be done

The app's entire auth story flows through this service: the backend
boot-validates OIDC discovery against `OIDC_ISSUER_URL`, and no user
can sign in until Authelia answers at
`https://authelia.a-conversa.org`. The dev config
(`infra/authelia/configuration.yml`) is explicitly not
production-safe: sqlite storage, filesystem notifier, committed
placeholder secrets, committed JWKS key, users-file backend.

## Inputs / context

From [ADR 0032](../../../docs/adr/0032-production-oauth-authelia-federation.md), the settled prod config shape:

- Same upstream image as dev (`authelia/authelia:4.39`); no custom image.
- Storage: Postgres (`authelia` database from
  [`prod_postgres_config.md`](prod_postgres_config.md)), not sqlite.
- Notifier: SMTP (provider is an execution-time pick — see Decisions).
- Signing material, session/encryption/HMAC secrets: **all generated
  fresh**; the committed dev values are never used in prod.
- Access control: `default_policy: one_factor`; intentionally open.
- Cookie domain `a-conversa.org`; Authelia at
  `authelia.a-conversa.org`.
- One OIDC client `aconversa-app-prod`, redirect URI
  `https://a-conversa.org/api/auth/callback`.
- Upstream federation: Google only at launch; adding providers later
  is a config + Variables edit, no app deploy.

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md): config is "loaded via Railway's filesystem mount or
Variables-rendered file" — resolved below (Decisions) as a
Variables-rendered file.

From [ADR 0033](../../../docs/adr/0033-production-observability-railway-sentry.md): Authelia's log stream is its Railway service tab —
log format JSON, level info.

Dev reference: [`infra/authelia/configuration.yml`](../../../infra/authelia/configuration.yml)
(structure parity; every dev-only divergence is flagged in the
template below). Note the dev file's TLS block and inflated OIDC
rate-limit buckets are both **dev-only** and intentionally absent
from prod.

## Execution steps (operator)

### 1. Generate the secret material (locally)

Run these on the operator machine; put each output in the password
manager immediately, named after its Railway Variable.

```sh
# Four independent random secrets:
docker run --rm authelia/authelia:4.39 authelia crypto rand --length 64 --charset alphanumeric
#   → run 4×, one each for:
#     AUTHELIA_SESSION_SECRET
#     AUTHELIA_STORAGE_ENCRYPTION_KEY
#     AUTHELIA_OIDC_HMAC_SECRET
#     AUTHELIA_RESET_JWT_SECRET

# OIDC issuer signing key (JWKS), 4096-bit RSA:
docker run --rm -v "$PWD/aconversa-keys:/keys" authelia/authelia:4.39 \
  authelia crypto pair rsa generate --bits 4096 --directory /keys
#   → private key PEM = AUTHELIA_JWKS_PRIVATE_KEY (multiline Variable);
#     shred the local copy once stored:  rm -rf aconversa-keys

# App↔Authelia client secret (random plaintext + pbkdf2 digest pair):
docker run --rm authelia/authelia:4.39 authelia crypto hash generate \
  pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986
#   → "Random Password" = app service's OIDC_CLIENT_SECRET
#     "Digest"          = pasted into the client_secret field of the template
#     (see oauth_credentials_handling.md)
```

Also have ready: `AUTHELIA_STORAGE_PASSWORD` (from
`prod_postgres_config`), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
(from `prod_oauth_config`), and the SMTP credentials (step 3).

### 2. Create the service

In the `aconversa` project: New → Docker Image →
**`authelia/authelia:4.39`** (pin the exact tag; no `latest`). Name
the service **`authelia`**. Target port **9091**, healthcheck path
`/api/health`.

### 3. SMTP provider

Create an account with the chosen transactional-email provider (see
Decisions), register the sender domain `a-conversa.org` (this adds
SPF/DKIM DNS records at the registrar — batch them with the
`prod_tls_and_domain` DNS edits), and obtain SMTP host, port,
username, and password.

### 4. Set the Variables

On the `authelia` service:

| Variable | Value |
|---|---|
| `X_AUTHELIA_CONFIG_FILTERS` | `template` |
| `AUTHELIA_SESSION_SECRET` | generated above |
| `AUTHELIA_STORAGE_ENCRYPTION_KEY` | generated above |
| `AUTHELIA_OIDC_HMAC_SECRET` | generated above |
| `AUTHELIA_RESET_JWT_SECRET` | generated above |
| `AUTHELIA_JWKS_PRIVATE_KEY` | the RSA private key PEM (multiline) |
| `AUTHELIA_STORAGE_PASSWORD` | the `authelia` Postgres role password |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | from the SMTP provider |
| `AUTHELIA_CONFIGURATION_YML` | the rendered template from step 5 |

### 5. Render and install the config

Fill the template below (only non-secret literals get filled by hand:
the client-secret **digest**, the SMTP host/port/sender, the Postgres
internal hostname if it differs from `postgres.railway.internal`).
Paste the result into the `AUTHELIA_CONFIGURATION_YML` Variable, and
set the service's **custom start command** to:

```sh
sh -c 'printf "%s" "$AUTHELIA_CONFIGURATION_YML" > /tmp/configuration.yml && exec authelia --config /tmp/configuration.yml'
```

The file written to `/tmp` contains `{{ env "..." }}` placeholders,
**not** secret values; Authelia resolves them at parse time because
`X_AUTHELIA_CONFIG_FILTERS=template` is set. Keep a copy of the
rendered template in the password manager alongside the secrets.

### Config template

```yaml
---
# Authelia configuration — PRODUCTION (a-conversa.org)
# Rendered into a Railway Variable; secrets resolved at parse time
# via {{ env "..." }} (X_AUTHELIA_CONFIG_FILTERS=template).
# Per ADR 0032. Never commit a rendered copy.

theme: light

server:
  address: 'tcp://0.0.0.0:9091'
  # No TLS block: Railway's edge terminates TLS for
  # https://authelia.a-conversa.org (ADR 0031). The dev config's TLS
  # block and rate-limit overrides are dev-only; prod keeps upstream
  # default rate limits.

log:
  level: info
  format: json   # Railway log dashboard, per ADR 0033

identity_validation:
  reset_password:
    jwt_secret: {{ env "AUTHELIA_RESET_JWT_SECRET" }}

# --- Upstream federation (Google) — per ADR 0032 ---
# Sole upstream at launch. Callback registered with Google:
#   https://authelia.a-conversa.org/api/oidc/callback/google
# Wire GOOGLE_CLIENT_ID / {{ env "GOOGLE_CLIENT_SECRET" }} into the
# federation block per the Authelia 4.39 documentation — confirm the
# exact key names against the upstream docs for 4.39 at execution
# time, then update this template in this refinement with the final
# block so the next render starts exact.

access_control:
  default_policy: one_factor   # intentionally open, per ADR 0032

session:
  secret: {{ env "AUTHELIA_SESSION_SECRET" }}
  cookies:
    - name: authelia_session
      domain: a-conversa.org
      authelia_url: 'https://authelia.a-conversa.org'
      default_redirection_url: 'https://a-conversa.org'
      expiration: '1 hour'
      inactivity: '5 minutes'

storage:
  encryption_key: {{ env "AUTHELIA_STORAGE_ENCRYPTION_KEY" }}
  postgres:
    address: 'tcp://postgres.railway.internal:5432'
    database: authelia
    schema: public
    username: authelia
    password: {{ env "AUTHELIA_STORAGE_PASSWORD" }}

notifier:
  smtp:
    address: 'submission://<SMTP_HOST>:587'   # fill from provider
    username: {{ env "SMTP_USERNAME" }}
    password: {{ env "SMTP_PASSWORD" }}
    sender: 'A Conversa <no-reply@a-conversa.org>'

telemetry:
  metrics:
    enabled: false

identity_providers:
  oidc:
    hmac_secret: {{ env "AUTHELIA_OIDC_HMAC_SECRET" }}
    jwks:
      - key_id: 'prod-issuer-2026'
        algorithm: RS256
        use: sig
        key: |
          {{- env "AUTHELIA_JWKS_PRIVATE_KEY" | nindent 10 }}
    lifespans:
      access_token: '1 hour'
      authorize_code: '1 minute'
      id_token: '1 hour'
      refresh_token: '90 minutes'
    cors:
      endpoints:
        - authorization
        - token
        - revocation
        - introspection
        - userinfo
      allowed_origins_from_client_redirect_uris: true
    clients:
      - client_id: aconversa-app-prod
        client_name: 'A Conversa'
        # pbkdf2-sha512 digest of the generated client secret —
        # paste the "Digest" output from step 1 here. The digest is
        # not reversible, but treat the rendered file as secret
        # anyway (it travels with real {{ env }} wiring).
        client_secret: '<DIGEST>'
        public: false
        authorization_policy: one_factor
        require_pkce: false
        pkce_challenge_method: ''
        redirect_uris:
          - 'https://a-conversa.org/api/auth/callback'
        scopes:
          - openid
          - profile
          - email
          - offline_access
        response_types:
          - code
        grant_types:
          - authorization_code
          - refresh_token
        userinfo_signed_response_alg: none
        token_endpoint_auth_method: client_secret_basic
```

### 6. First boot

Deploy and watch the logs: Authelia runs its own storage migrations
against the `authelia` database, then listens on 9091. The notifier
startup check exercises the SMTP credentials — a misconfigured
notifier fails the boot loudly (do **not** carry over the dev
`disable_startup_check`). Full sign-in verification waits for DNS
(`prod_tls_and_domain`) and is the acceptance step of
`prod_oauth_config`.

## Constraints / requirements

- Pinned image `authelia/authelia:4.39` — dev/prod parity per
  ADR 0017/0032; upgrades are deliberate, both stacks together.
- Every secret in the table is freshly generated; nothing is shared
  with the committed dev config, and nothing dev-flavored
  (`dev-only-*`, the committed JWKS key, the dev client digest)
  appears in any prod Variable.
- The config reaches the container as a Variables-rendered file with
  `{{ env }}` indirection — the YAML Variable itself contains no
  secret values.
- `infra/authelia/prod/` (if a rendered copy is ever kept locally for
  editing) is gitignored, per ADR 0032. Verify the gitignore entry
  exists before writing any file there.
- Prod keeps Authelia's **default** rate limits (the dev overrides
  exist only for the Playwright workload, and the dev config says so).

## Acceptance criteria

- `authelia` service running from the pinned upstream image;
  `/api/health` green on the Railway healthcheck.
- Boot logs show Postgres storage migrations applied to the
  `authelia` database and a passing SMTP startup check.
- `https://authelia.a-conversa.org/.well-known/openid-configuration`
  (after `prod_tls_and_domain`) returns issuer
  `https://authelia.a-conversa.org` and a JWKS endpoint serving the
  new `prod-issuer-2026` key — confirming the dev key is not in play.
- The app's boot OIDC discovery against the issuer succeeds (visible
  in `app` deploy logs).
- No `dev-only` string and no committed dev secret value appears in
  any Railway Variable (spot-check).

## Decisions

- **Variables-rendered config file via custom start command**
  (resolving ADR 0031's "filesystem mount or Variables-rendered
  file"). Alternatives: a Railway volume (no good seeding story for a
  single config file; adds mutable state to a stateless service) and
  a custom image with the config baked in (violates the no-custom-image
  parity from ADR 0032 and couples config edits to image builds).
  The start-command render keeps the upstream image, makes the config
  visible/editable in the dashboard, and keeps secrets out of the
  YAML via the `template` filter.
- **`{{ env }}` indirection for every secret** rather than secrets
  inline in the YAML Variable — one Variable per secret keeps
  rotation granular ([`oauth_credentials_handling.md`](oauth_credentials_handling.md))
  and the YAML shareable for review.
- **SMTP provider: operator's pick at execution time** (ADR 0032
  defers it; non-architectural). Recommendation: a free-tier
  transactional provider (e.g., Resend ~3k emails/mo free, or
  Postmark) — Authelia's mail volume here is near zero (federated
  sign-in sends no mail; the notifier mostly satisfies startup checks
  and rare identity-validation flows). Any SMTP endpoint works; only
  the `notifier.smtp` literals change.
- **Template carries the placeholder federation block, finalized on
  first execution.** The ADR fixes the federation shape and the
  Google callback URL; the exact Authelia 4.39 YAML key names for the
  upstream-provider block must be lifted from the upstream docs at
  execution time rather than guessed here — a wrong key name in this
  document would fail silently as "documented but never valid."
  Updating the template in place (with a dated note) is part of
  executing this task. *(Note: ADR 0032 originally placed the template
  in the `prod_oauth_config` refinement; with the R-split of the
  Railway work, the config plumbing — and therefore the template —
  lives here, and `prod_oauth_config` owns the Google-side steps and
  end-to-end verification.)*

## Open questions

- **Exact Authelia 4.39 federation block syntax** — see the decision
  above; resolved by consulting upstream docs during execution and
  backfilling the template.
- **Railway multiline-Variable fidelity.** The PEM key and the YAML
  template are multiline values; verify the dashboard preserves
  newlines exactly (paste, save, re-open). If the YAML Variable proves
  fragile, fallback: base64-encode it locally and change the start
  command to `printf "%s" "$AUTHELIA_CONFIGURATION_YML_B64" | base64 -d > /tmp/configuration.yml`.
- **Literal `{{ }}` vs Railway's `${{ }}` templating.** Railway's own
  variable references use `${{ ... }}`; the Authelia placeholders use
  bare `{{ ... }}` and should pass through untouched — verify on the
  first render that the stored value round-trips literally.
