# Secret rotation runbook

Procedures for rotating every production secret. Invariants and
rationale live in the owning refinements
([`oauth_credentials_handling`](../../tasks/refinements/deployment/oauth_credentials_handling.md),
[`postgres_credentials_handling`](../../tasks/refinements/deployment/postgres_credentials_handling.md),
[`session_token_secret_handling`](../../tasks/refinements/deployment/session_token_secret_handling.md));
this runbook is the consolidated how.

Ground rules for every rotation (from
[`secret_storage_choice`](../../tasks/refinements/deployment/secret_storage_choice.md)):

- Generate locally; the value goes to the Railway Variable and the
  password manager (with date), **nowhere else** — no shell history
  (use the dashboard paste box or `--set "X=$(…)"` substitution).
- Rotate **outside show hours** — several procedures below bounce
  sessions or briefly fail token exchanges.
- Verify a production sign-in end-to-end after every rotation
  (sections 2–3 of the [post-deploy smoke checklist](post-deploy-smoke.md)).

## 1. App↔Dex client secret (symmetric)

Brief token-exchange failures during the gap; seconds at worst.

1. `openssl rand -base64 48`
2. Update `ACONVERSA_OAUTH_CLIENT_SECRET` on the `dex` service, then
   `OIDC_CLIENT_SECRET` on the `app` service — same value — and the
   password manager.
3. Restart `dex`, **then** `app` (Dex must accept the new secret
   before the app presents it).
4. Verify sign-in.

## 2. Google upstream client secret

Zero-downtime (Google supports two concurrent secrets).

1. Google Cloud Console → the OAuth client → **add a second client
   secret**.
2. Update `GOOGLE_CLIENT_SECRET` on the `dex` service + password
   manager; restart `dex`.
3. Verify a Google sign-in end-to-end, **then** delete the old secret
   in the console.

## 3. Dex Postgres role password

1. `openssl rand -hex 24` (hex — it travels inside a connection
   string).
2. `railway connect postgres` → `ALTER ROLE dex PASSWORD '<new>';`
3. Update `ACONVERSA_STORAGE_PASSWORD` on the `dex` service +
   password manager; restart `dex`.
4. Verify Dex boots (storage connect in its logs) and a sign-in.

## 4. `SESSION_TOKEN_SECRET`

**Logs every user out** (sessions and in-flight pending cookies all
invalidate; users silently re-OIDC — a redirect bounce, not a
credential prompt). Never during a live show. This is also the
all-or-nothing "log everyone out" lever if one is ever needed.

1. `openssl rand -base64 48`
2. Update the `app` Variable + password manager; restart `app`.
3. Verify: an existing browser session bounces through Dex/Google and
   recovers without a credential prompt.

## 5. App database credential (Railway-managed)

The add-on owns this credential; the app consumes it only as the
`${{Postgres.DATABASE_URL}}` reference. **Do not** `ALTER ROLE` the
app user manually without first confirming how the add-on stores what
it serves through the reference — diverging them bricks the next app
boot.

- **Drill finding (2026-06-12):** the dashboard offers **no
  integrated rotation** — the rotation is manual. The procedure:
  1. `railway connect postgres` → `ALTER ROLE <appuser> PASSWORD
     '<new>';`
  2. Manually update the Postgres service's own credential
     Variable(s) to the same value, so what
     `${{Postgres.DATABASE_URL}}` serves matches the role again —
     this is the step that prevents the reference/role divergence
     warned about above.
  3. Restart `app` to pick up the reference's new resolution.
  Between steps 1 and 3 the app's *new* connections fail (existing
  pooled ones keep working) — do this outside show hours.
  Keep this section updated if Railway's UI grows a rotation control.

## After any rotation

One line in the password-manager entry: new date, where the value
lives. If the rotation was incident-driven, note the trigger in the
admin runbook's incident log.
