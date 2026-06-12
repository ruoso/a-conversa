# TLS and domain — a-conversa.org + auth.a-conversa.org

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_tls_and_domain`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_compose_file` rollup (the `app` and `dex` services exist and are healthy on their Railway-generated domains).
**Executor**: human operator (Railway dashboard + DNS registrar access).

> **Reworked 2026-06-12** for [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md):
> the identity subdomain is `auth.a-conversa.org` → `dex` service
> (was `authelia.a-conversa.org` → `authelia`), and the SPF/DKIM
> batching is gone — Dex sends no mail, so there is no SMTP sender
> domain to authenticate.

## What this task is

Attach the production hostnames to the two public services and get
valid TLS on both: `a-conversa.org` (apex) → `app`,
`auth.a-conversa.org` → `dex`. Railway auto-provisions
Let's Encrypt certificates once the DNS records resolve; the work is
the dashboard half, the registrar half, and the propagation wait.

## Why it needs to be done

Every URL already wired into the system assumes these names:
`APP_BASE_URL=https://a-conversa.org`,
`OIDC_ISSUER_URL=https://auth.a-conversa.org`, the
`aconversa-app-prod` redirect URI, and the Google client's callback.
Until DNS + TLS are live, the app boots
but no auth flow can complete — this task is the gate to the
end-to-end verification in `prod_oauth_config`.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md)
(as amended 2026-06-12 for ADR 0048): Railway auto-provisions
Let's Encrypt certificates for any custom domain. `a-conversa.org`
points at the `app` service via a CNAME registered at the domain's
DNS provider; the identity service is reachable at
`auth.a-conversa.org` (separate CNAME → the `dex` service) so the
OIDC issuer URL is HTTPS-clean for both the browser and the
in-network app→dex call.

**Apex caveat the ADR glosses over:** a literal CNAME at the zone apex
(`a-conversa.org`) is invalid DNS — apex records must be A/AAAA or a
registrar-provided ALIAS/ANAME/flattened-CNAME. The execution steps
handle this.

## Execution steps (operator)

1. **Railway side.** On the `app` service → Settings → Networking →
   Custom Domain → add `a-conversa.org`. On the `dex` service,
   add `auth.a-conversa.org`. Railway displays the DNS target for
   each (a `*.up.railway.app` name or equivalent) and waits for
   verification.
2. **Registrar side.** At the DNS provider for `a-conversa.org`:
   - `auth.a-conversa.org` → **CNAME** to the target Railway shows.
   - `a-conversa.org` (apex) → **ALIAS/ANAME/flattened CNAME** to its
     target, if the provider supports it. If it doesn't, the
     documented fallback is moving DNS hosting (not registration) to a
     provider that does — e.g., Cloudflare's free tier with the record
     set to **DNS-only mode** (gray cloud; proxy mode would put a
     second proxy in front of Railway's edge and complicate cert
     issuance and WebSockets for no v1 benefit).
3. **Wait and verify issuance.** Railway verifies the records and
   issues certificates (minutes to an hour, DNS-propagation bound).
   Both domains show "issued" in the dashboard.
4. **Smoke-check both hosts:**
   ```sh
   curl -sSf https://a-conversa.org/healthz
   curl -sSf https://auth.a-conversa.org/.well-known/openid-configuration | head -c 200
   ```
   Both serve valid TLS (no `-k` needed) and the OIDC discovery
   document reports issuer `https://auth.a-conversa.org`.
5. **Restart the `app` service** (or just observe its next deploy):
   its boot-time OIDC discovery against the issuer must now succeed —
   before this task it could only fail.

## Constraints / requirements

- Hostnames are exactly the ADR-fixed pair; no `www` at launch (add a
  `www` → apex redirect later only if traffic shows up with it).
- No second proxy layer in front of Railway (Cloudflare stays
  DNS-only if used) — `prod_reverse_proxy` documents Railway's edge as
  the sole proxy.
- Cert issuance/renewal is Railway-managed; nothing to schedule, but
  the eventual uptime monitor (ADR 0033) watches the HTTPS endpoint,
  which implicitly monitors cert validity.

## Acceptance criteria

- Both custom domains verified and issued in the Railway dashboard.
- The two `curl` checks in step 4 pass from outside Railway with
  valid certificates.
- App boot logs show OIDC discovery success against
  `https://auth.a-conversa.org`.
- DNS zone contains the two service records.

## Decisions

- **Apex via ALIAS/flattening, registrar permitting; otherwise move
  DNS hosting to Cloudflare free (DNS-only)** — the minimal resolution
  of the apex-CNAME constraint without adding a proxy layer or
  renumbering the product onto `www`.
- **SMTP SPF/DKIM batching dropped (2026-06-12)** — the original plan
  batched the notifier sender-domain records into this task's
  zone-edit session; ADR 0048 removed the SMTP notifier entirely, so
  the zone carries no email records until some future feature
  actually sends mail.

## Open questions

- **Where `a-conversa.org` is registered / DNS-hosted today** — the
  operator knows; it determines whether the Cloudflare fallback is
  needed. Record the answer (registrar, DNS host, account) in the
  password manager and the eventual admin runbook.
