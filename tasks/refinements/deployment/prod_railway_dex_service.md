# Dex service — upstream image, prod config rendering, secret generation

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_compose_file.prod_railway_dex_service`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_railway_project_bootstrap` (settled). Practically also `prod_postgres_config` (the `dex` database + role) and the Google client credentials from `prod_oauth_config` (can be stubbed with placeholders to bring the service up, but sign-in won't work until they're real).
**Executor**: human operator (all of this is secret generation + dashboard work).

> **History (2026-06-12).** This task began life as
> `prod_railway_authelia_service` (Authelia per ADR 0032). First
> execution discovered Authelia has no upstream-federation capability
> — see [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md),
> which supersedes ADR 0032 with Dex in the issuer role. The config
> plumbing proven during that execution (Variables-rendered config
> file via custom start command, `ACONVERSA_*` Variable naming,
> base64 fallback for multiline fidelity) carries over unchanged.
> A teardown step for the half-configured `authelia` service is
> included below.

## What this task is

Stand up the `dex` service in the `aconversa` project from the
upstream `ghcr.io/dexidp/dex:v2.44.0` image, with the production
configuration: Postgres storage, the `aconversa-app-prod` static
client, and the Google connector. The Google Cloud Console side lives
in [`prod_oauth_config.md`](prod_oauth_config.md); this task lands the
service shell and the config plumbing.

This refinement also carries the **prod config template** — the
rendered config is operator-supplied (gitignored, like `.env`), so
the template's home is this document, not the repo tree.

## Why it needs to be done

The app's entire auth story flows through this service: the backend
boot-validates OIDC discovery against `OIDC_ISSUER_URL`, and no user
can sign in until Dex answers at `https://auth.a-conversa.org`.

## Inputs / context

From [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md), the settled prod config shape:

- Upstream `ghcr.io/dexidp/dex` image, exact tag pinned: **v2.44.0**
  (latest release at pin time, 2026-05-28); no custom image.
- Storage: Postgres (`dex` database from
  [`prod_postgres_config.md`](prod_postgres_config.md)). Dex
  generates and rotates its own token-signing keys inside storage —
  **no operator-managed JWKS**, and no SMTP notifier (Dex sends no
  mail).
- Issuer `https://auth.a-conversa.org`; one static client
  `aconversa-app-prod` with redirect URI
  `https://www.a-conversa.org/api/auth/callback`.
- Google as the sole connector at launch; adding providers later is
  a config + Variables edit, no app deploy.
- Log format JSON, level info (ADR 0033 — the log stream is the
  `dex` Railway service tab).
- **Verify-at-execution discipline** (ADR 0048): every config key
  below was checked against the Dex docs for v2.44.0 on 2026-06-12
  (connector keys, `secretEnv`, env-expansion scope, storage keys);
  the items still needing live verification are flagged in Open
  questions.

Key Dex mechanics this template relies on (verified against upstream
docs, 2026-06-12):

- **Env expansion** (`$VAR`, via `os.ExpandEnv`; feature flag
  `DEX_EXPAND_ENV`, default on) works inside the `storage` and
  `connectors` config sections — secrets stay out of the YAML
  Variable, same property the Authelia `{{ env }}` filter provided.
- It does **not** work in `staticClients`; the client secret uses the
  dedicated `secretEnv` key (variable named *without* `$`).

## Execution steps (operator)

### 0. Tear down the superseded `authelia` attempt

- Delete the `authelia` Railway service (it never reached a working
  boot) and with it all its Variables.
- Retire the password-manager entries that no longer correspond to
  anything: session secret, storage-encryption key, OIDC HMAC secret,
  reset-JWT secret, JWKS private key, and the pbkdf2 client-secret
  digest. Keep: the Google client credentials, and the app↔broker
  plaintext secret if already generated (it is reused below as the
  symmetric client secret).
- The `authelia` Postgres role/database teardown is owned by
  [`prod_postgres_config.md`](prod_postgres_config.md) (it creates
  the `dex` equivalents in the same step).
- Confirm no SMTP provider account was created yet (step 3 of the old
  task); if one was, close or repurpose it — Dex needs none.

### 1. Generate / collect the secret material

Run on the operator machine; put each output in the password manager
immediately, named after its Railway Variable.

```sh
# App↔Dex client secret (symmetric — same value on both services):
openssl rand -base64 48
#   → dex service's  ACONVERSA_OAUTH_CLIENT_SECRET
#   → app service's  OIDC_CLIENT_SECRET  (same value)
```

Also have ready: `ACONVERSA_STORAGE_PASSWORD` (the `dex` role
password from `prod_postgres_config`) and `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` (from `prod_oauth_config`).

That's the whole list — Dex self-manages signing keys, has no session
cookie secret, no encryption key, no HMAC secret, and no mail.

### 2. Create the service

In the `aconversa` project: New → Docker Image →
**`ghcr.io/dexidp/dex:v2.44.0`** (pin the exact tag; no `latest`).
Name the service **`dex`**. Target port **5556**. Healthcheck path:
see Open questions — start with `/.well-known/openid-configuration`
(guaranteed to exist on the web listener) and switch to a dedicated
health path if live verification finds one on port 5556.

### 3. Set the Variables

On the `dex` service:

| Variable | Value |
|---|---|
| `ACONVERSA_STORAGE_PASSWORD` | the `dex` Postgres role password |
| `ACONVERSA_PGHOST` | reference to the Postgres add-on (`${{Postgres.PGHOST}}`) |
| `ACONVERSA_OAUTH_CLIENT_SECRET` | the symmetric client secret from step 1 |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `ACONVERSA_DEX_CONFIG_YML` | the rendered template from step 4 |

> **Variable-naming convention (carried from the first execution,
> 2026-06-12).** Operator-defined Variables use the `ACONVERSA_`
> prefix. With Dex the original motivation (Authelia's template
> `env` function refuses `AUTHELIA_*` names with secret-like
> suffixes) is gone, but the prefix stays: it keeps operator
> Variables visually distinct in the dashboard and avoids the `DEX_`
> namespace, which Dex uses for its own feature flags
> (`DEX_EXPAND_ENV`, `DEX_CONTINUE_ON_CONNECTOR_FAILURE`, …).

### 4. Render and install the config

Fill the template below (no hand-filled secrets — they all arrive via
`$VAR` expansion or `secretEnv`). Paste the result into the
`ACONVERSA_DEX_CONFIG_YML` Variable, and set the service's **custom
start command** to:

```sh
sh -c 'printf "%s" "$ACONVERSA_DEX_CONFIG_YML" > /tmp/config.yml && exec dex serve /tmp/config.yml'
```

Keep a copy of the rendered template in the password manager
alongside the secrets.

### Config template

```yaml
---
# Dex configuration — PRODUCTION (a-conversa.org)
# Rendered into a Railway Variable; secrets resolved at parse time
# via Dex's env expansion ($VAR in storage/connectors; secretEnv in
# staticClients). Per ADR 0048. Never commit a rendered copy.

issuer: https://auth.a-conversa.org

storage:
  type: postgres
  config:
    host: $ACONVERSA_PGHOST
    port: 5432   # literal by necessity: the field is uint16 and Dex's
                 # env expansion only substitutes into strings
                 # (verified live 2026-06-12; see Decisions)
    database: dex
    user: dex
    password: $ACONVERSA_STORAGE_PASSWORD
    ssl:
      mode: disable   # Railway private network; revisit if the
                      # add-on enforces TLS internally (verify on
                      # first boot)

web:
  http: 0.0.0.0:5556
  # No TLS block: Railway's edge terminates TLS for
  # https://auth.a-conversa.org (ADR 0031).

telemetry:
  http: 0.0.0.0:5558   # /healthz/live, /healthz/ready — internal
                       # only; not exposed through the Railway edge

logger:
  level: info
  format: json   # Railway log dashboard, per ADR 0033

oauth2:
  responseTypes: ['code']
  skipApprovalScreen: true   # single first-party client; the Google
                             # consent screen is the only consent step

expiry:
  idTokens: '1h'
  refreshTokens:
    validIfNotUsedFor: '2160h'   # 90 days; operator-tunable

# No local accounts — sign-in is upstream-only (ADR 0048; the open
# platform has no operator-provisioned users).
enablePasswordDB: false

staticClients:
  - id: aconversa-app-prod
    name: 'A Conversa'
    secretEnv: ACONVERSA_OAUTH_CLIENT_SECRET
    redirectURIs:
      - 'https://www.a-conversa.org/api/auth/callback'

connectors:
  - type: google
    id: google
    name: Google
    config:
      clientID: $GOOGLE_CLIENT_ID
      clientSecret: $GOOGLE_CLIENT_SECRET
      redirectURI: https://auth.a-conversa.org/callback
```

### 5. First boot

Deploy and watch the logs: Dex runs its own storage migrations
against the `dex` database, then listens on 5556. Verify
`/.well-known/openid-configuration` returns issuer
`https://auth.a-conversa.org` (via the Railway-generated domain
until `prod_tls_and_domain` lands the real one). Full sign-in
verification waits for DNS and is the acceptance step of
`prod_oauth_config`.

## Constraints / requirements

- Pinned image `ghcr.io/dexidp/dex:v2.44.0` — upgrades are
  deliberate. (Dev/prod *image* parity died with ADR 0048; dev keeps
  the Authelia mock per ADR 0017. The parity that matters is the
  OIDC protocol surface.)
- Every secret is freshly generated; nothing dev-flavored appears in
  any prod Variable.
- The config reaches the container as a Variables-rendered file with
  env indirection — the YAML Variable itself contains no secret
  values.
- `infra/dex/` does not exist and should not: the prod config is
  operator-supplied (gitignored if ever kept locally; verify the
  gitignore entry before writing any file there).
- Per ADR 0048's verify-at-execution discipline: any config key not
  already verified (see Open questions) gets checked against the Dex
  v2.44.0 docs before use, and this template is updated in place with
  a dated note.

## Acceptance criteria

- `dex` service running from the pinned upstream image; healthcheck
  green on the Railway healthcheck.
- Boot logs show Postgres storage migrations applied to the `dex`
  database.
- `https://auth.a-conversa.org/.well-known/openid-configuration`
  (after `prod_tls_and_domain`) returns issuer
  `https://auth.a-conversa.org` and a JWKS endpoint serving
  Dex-generated keys.
- The app's boot OIDC discovery against the issuer succeeds (visible
  in `app` deploy logs).
- The superseded `authelia` service is gone from the Railway project,
  and no orphaned `AUTHELIA_*`/Authelia-era Variable remains
  (spot-check).

## Decisions

- **Variables-rendered config file via custom start command** —
  carried over from the first execution (the alternatives — volume,
  custom image — were rejected then for reasons that still hold; see
  ADR 0048 and this file's git history for the original analysis).
- **Env indirection for every secret** (`$VAR` expansion in
  storage/connectors, `secretEnv` for the static client) rather than
  secrets inline in the YAML Variable — one Variable per secret keeps
  rotation granular ([`oauth_credentials_handling.md`](oauth_credentials_handling.md))
  and the YAML shareable for review.
- **`skipApprovalScreen: true`** — there is exactly one first-party
  client; an extra Dex-rendered consent page between Google and the
  app adds friction and no information.
- **Postgres host as a reference Variable** (`ACONVERSA_PGHOST` →
  `${{Postgres.PGHOST}}`) rather than a hardcoded literal — the value
  tracks the add-on if the service is ever renamed, consistent with
  the reference-not-copy rule in
  [`postgres_credentials_handling.md`](postgres_credentials_handling.md).
  **The port is the literal `5432`** (2026-06-12): the first boot
  proved a `$VAR` cannot feed the port — Dex fails with `cannot
  unmarshal string into Go struct field Postgres.NetworkDB.Port of
  type uint16`, because env expansion substitutes into string values
  only. An `ACONVERSA_PGPORT` Variable would be dead weight; don't
  create one.
- **2026-06-12** — Template authored against Dex v2.44.0 docs
  (connector keys, `secretEnv`, env-expansion scope, storage schema
  verified from upstream documentation the same day).

## Open questions

- **Healthcheck path on the web port.** Dex's liveness/readiness
  endpoints (`/healthz/live`, `/healthz/ready`) live on the
  *telemetry* listener (5558), which Railway's healthcheck (aimed at
  the exposed port) can't reach. Verify on first deploy whether the
  web listener (5556) still serves a `/healthz`; until then the
  healthcheck path is `/.well-known/openid-configuration`.
- **Shell availability in the image.** The start-command render needs
  `sh` and `printf` inside `ghcr.io/dexidp/dex:v2.44.0`. The image is
  Alpine-based and ships a shell per upstream, but confirm on first
  deploy; if absent, fall back to Railway's pre-deploy command or a
  config-seeding approach.
- **Railway multiline-Variable fidelity** (carried from first
  execution). The YAML template is multiline; the dashboard preserved
  newlines during the Authelia attempt, but if the Variable ever
  proves fragile: base64-encode locally and change the start command
  to `printf "%s" "$ACONVERSA_DEX_CONFIG_YML_B64" | base64 -d > /tmp/config.yml`.
- **`ssl.mode` for the internal Postgres hop** — `disable` assumed
  for the private network; flip to `require` if the add-on supports
  TLS internally and verify Dex connects.
- ~~**`port: $ACONVERSA_PGPORT` type coercion.**~~ **Resolved
  2026-06-12, negatively, on first boot:** expansion into a numeric
  field fails (`cannot unmarshal string into ... Port of type
  uint16`) — Dex expands env vars inside string values after parse,
  not in the raw config text. The template now hardcodes `5432`; see
  Decisions.

## Status

**Done — 2026-06-12.** `dex` service up on Railway from
`ghcr.io/dexidp/dex:v2.44.0` with the Variables-rendered config and
the superseded `authelia` service torn down. This task's first
execution (as `prod_railway_authelia_service`) surfaced the findings
that produced [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md)
and the `ACONVERSA_*` naming convention; its second execution
resolved the `port:`-field open question (literal `5432` — see
Decisions). Remaining acceptance items that wait on DNS
(`auth.a-conversa.org` discovery from outside) are owned by
`prod_tls_and_domain` / `prod_oauth_config`.
