# Reverse proxy / ingress — satisfied by Railway's edge (verification only)

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_reverse_proxy`
**Effort estimate**: 1d (scoped down — see below; the residual work is a verification pass, well under the original estimate)
**Inherited dependencies**: `prod_tls_and_domain` (settled — the custom domains are live; this task verifies behavior through them).
**Executor**: human operator (browser/CLI checks against production).

## What this task is

Per ADR 0031 this task is **satisfied by the platform**: Railway's
built-in edge proxy terminates TLS and routes to the services; there
is no separate reverse proxy to configure. What remains is verifying
the proxied behaviors the application depends on actually hold through
Railway's edge.

## Why it needs to be done

The app was developed against a direct port mapping (compose publishes
`3000:3000`; no proxy in dev). Production inserts an edge proxy the
code has never run behind. Three behaviors are proxy-sensitive and
each would fail *quietly* in ways a `/healthz` check doesn't catch.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> `prod_reverse_proxy` → satisfied by Railway's built-in routing; no
> separate reverse proxy.

App behaviors that interact with a proxy:

- **WebSockets** — the entire live-session surface is WS; Railway
  supports WS without idle drops (ADR 0031 Context cites this as a
  selection criterion). Verify upgrade + a long-lived connection.
- **Redirect/URL derivation** — the backend derives its public URLs
  from `APP_BASE_URL`, *not* from `Host`/`X-Forwarded-*` headers, so
  proxy-header handling is low-risk by construction. Verify the OIDC
  redirect lands on `https://a-conversa.org/...` (not an internal
  host).
- **Secure cookies** — `NODE_ENV=production` marks cookies `Secure`;
  the browser↔edge leg is HTTPS so they flow. Verify they're set and
  returned through the proxy.

## Execution steps (operator)

1. **WS upgrade through the edge:** from a browser session on
   `https://a-conversa.org`, open a session view and confirm the
   WebSocket connects (`wss://a-conversa.org/...` in devtools) and
   stays connected through ≥10 minutes of idle (Railway's edge
   shouldn't drop idle WS; this confirms it).
2. **Auth round-trip URLs:** during the `prod_oauth_config`
   verification walk, watch the network tab — every redirect hop is on
   the two public hostnames; nothing leaks `railway.internal`,
   `*.up.railway.app`, or a port number.
3. **Cookie flags:** in devtools, confirm `aconversa-session` is
   `Secure; HttpOnly` and scoped to `a-conversa.org` (Dex's own flow
   cookies are transient and scoped to `auth.a-conversa.org`; no
   shared-domain cookie exists in the Dex design).
4. **Railway-generated domains:** after the custom domains work,
   decide whether the `*.up.railway.app` fallback domains stay enabled
   (useful as an is-it-DNS-or-is-it-the-app debugging probe; harmless
   to leave on — the OIDC flow won't work through them since every
   registered URL is on the custom domains, which is fine).

## Constraints / requirements

- No additional proxy layer is introduced (and Cloudflare, if used for
  DNS, stays DNS-only per `prod_tls_and_domain`).
- Any failure here is a *finding*, not something to patch ad hoc at
  the edge — e.g., if WS idle connections do drop, the fix belongs in
  the app's reconnect/heartbeat story, not in proxy tuning Railway
  doesn't expose anyway.

## Acceptance criteria

- WS connection through `wss://a-conversa.org` survives an idle soak
  (≥10 min) and live events flow in a real session.
- Auth walk shows only public-hostname URLs; both cookies carry
  `Secure; HttpOnly` with the expected domains.
- A note recording the verification (date + observations) is appended
  to this file's Status block on completion.

## Decisions

- **Task reduced to verification** — settled by ADR 0031; this
  refinement exists so the WBS leaf has an owner for the residual
  checks rather than silently vanishing into the platform.

## Open questions

(none — all decided)

## Status

**Done — 2026-06-12.** Verified Railway's edge as the sole proxy
layer: WebSocket connects and holds through the edge, auth redirect
hops stay on the two public hostnames (no `railway.internal` /
`up.railway.app` leakage), and `aconversa-session` carries
`Secure; HttpOnly` scoped to `a-conversa.org`.
