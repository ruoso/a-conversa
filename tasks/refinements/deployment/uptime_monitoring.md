# Uptime monitoring — Railway-side monitors at v1, external probe deferred

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.observability.uptime_monitoring`
**Effort estimate**: 0.5d
**Inherited dependencies**: `health_and_readiness_endpoints` (settled — `/readyz` exists and is the deploy gate), `prod_compose` (settled).
**Executor**: human operator (dashboard configuration).

## What this task is

Production alerting for "something is wrong and nobody is looking at
a dashboard." Two complementary layers exist in principle:

1. **Platform-side** (Railway Pro): threshold monitors on service
   resource metrics (CPU / RAM / disk / network egress) with native
   email + in-app notifications, created from Observability-dashboard
   widgets ("Add monitor" in the widget menu); plus webhooks for
   deployment-state changes (including `Crashed` — relevant because
   `railway.json` caps crash restarts at 10, after which the service
   sits down silently) and volume capacity. Webhooks are HTTP-only —
   no native email destination.
2. **External probe** (ADR 0033's original framing: Sentry uptime or
   BetterStack): synthetic checks on
   `https://www.a-conversa.org/readyz` and
   `https://auth.a-conversa.org/.well-known/openid-configuration`
   from a user's vantage point. This is the only layer that sees
   DNS/TLS/edge failures, a wedged-but-alive app, or the issuer going
   dark — the bring-up's two real incidents (edge-binding
   propagation, apex deep-path 404s) were both invisible from inside
   the platform.

## Decisions

- **v1 ships layer 1 only; the external probe is deferred**
  (operator decision, 2026-06-12, on upgrading to Railway Pro).
  Accepted trade-off: until the probe exists, user-vantage failures
  (DNS, TLS, edge, issuer-down) alert nobody — mitigated at v1 by
  the operating reality that shows are scheduled events with the
  operator present and watching. **Revisit before the first public
  show**; the probe is the first post-M9 observability item.
- **Provider lean for the deferred probe: BetterStack** — besides
  the uptime checks, it ingests inbound webhooks into its incident
  routing with email delivery, which would give Railway's
  deployment-state webhook (HTTP-only) an email path and unify both
  layers' alerting in one place. Decide properly at execution.

## Acceptance criteria

- Threshold monitors exist on the Observability dashboard for the
  production services' resource metrics, with email notification.
  *(Met — see Status.)*
- The deferral of the external probe is recorded here and in
  ADR 0033's Amendments. *(Met.)*

## Open questions

- **Deployment-state webhook receiver.** Railway's webhook needs an
  HTTP endpoint; without Slack/Discord or the deferred probe
  provider, `Crashed` events currently have no notification path
  beyond the dashboard. Lands together with the external-probe
  revisit.

## Status

**Done — 2026-06-12 (reduced scope, per the Decision above).**
Railway Pro monitors configured by the operator from the
Observability dashboard on the production services' resource
metrics, with Railway's native email + in-app notifications. The
external probe and the webhook receiver are the recorded deferral,
to be revisited before the first public show.
