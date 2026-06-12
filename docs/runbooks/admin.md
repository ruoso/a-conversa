# Admin runbook — common tasks and troubleshooting

The operator's entry point for running the production a-conversa
instance. This document is deliberately an index plus an incident
playbook: each procedure lives in its own runbook or refinement; the
topology record is [`infra/railway/README.md`](../../infra/railway/README.md).

## Orientation

- **Topology**: Railway project `aconversa` — `app` (this repo,
  Dockerfile, deploy settings from [`railway.json`](../../railway.json)),
  `dex` (OIDC issuer, pinned image), `Postgres` (managed add-on, two
  databases). Full detail: [`infra/railway/README.md`](../../infra/railway/README.md).
- **Hostnames**: `https://www.a-conversa.org` is canonical (the apex
  is registrar forwarding, **root only** — bare-domain deep links
  404; ADR 0031 hostname-scheme amendment). The OIDC issuer is
  `https://auth.a-conversa.org`.
- **Access**: Railway dashboard + `railway` CLI (`railway status`,
  `railway logs`, `railway connect postgres` for tunneled DB access —
  never paste connection strings). Privileged surfaces: Railway
  account, Google Cloud Console (OAuth client), DNS registrar, GitHub
  repo admin, the password manager (canonical secret store).
- **Health**: `https://www.a-conversa.org/healthz` (liveness),
  `/readyz` (DB-backed readiness; also the deploy gate),
  `https://auth.a-conversa.org/.well-known/openid-configuration`
  (issuer up).

## Common tasks

| Task | Procedure |
|---|---|
| Ship a release | [`release.md`](release.md) — tag-gated; the tag is the only path to production |
| Verify a deploy | [`post-deploy-smoke.md`](post-deploy-smoke.md) — run after every deploy |
| Roll back | [`rollback.md`](rollback.md) |
| Rotate any secret | [`secret-rotation.md`](secret-rotation.md) — all five, drilled |
| Restore a backup | [`backup-restore.md`](backup-restore.md) — scratch-target drill + real-recovery notes |
| Add an OAuth provider | Dex connector config + Variables edit, no app deploy — pattern in [`oauth_credentials_handling.md`](../../tasks/refinements/deployment/oauth_credentials_handling.md) (Open questions) and the config template in [`prod_railway_dex_service.md`](../../tasks/refinements/deployment/prod_railway_dex_service.md) |
| Read logs / metrics | Railway service tabs (`app`, `dex`; JSON logs per ADR 0033) and the Observability dashboard (threshold monitors live on its widgets) |
| Ban / remove a user | Application-layer concern (Dex stores no users — ADR 0048); no admin surface at v1 — deferred until needed |

## Troubleshooting playbook

Patterns from real incidents; check the cheap explanation before the
deep one.

### Site not answering / TLS errors

1. **Establish vantage**: `curl -sSf https://www.a-conversa.org/readyz`
   from outside vs the Railway dashboard's view. *Outside fails +
   dashboard healthy* → the problem is in front of the platform
   (DNS, edge, domain binding), not the app.
2. `dig +short www.a-conversa.org` — CNAME to `*.up.railway.app`
   still present?
3. An HTTP **404 from the Railway edge** on a custom domain means the
   domain *binding*, not the app: freshly added/edited domains take
   time to propagate across edge regions (observed at bring-up:
   external probes 200 while in-region requests still 404). Wait;
   if persistent, re-create the custom domain on the service.
4. Bare-domain (`a-conversa.org`) deep links 404 **by design** —
   that's the apex forwarder, not an outage.

### Sign-in broken

Walk the chain in order:

1. Issuer up? `curl -sSf https://auth.a-conversa.org/.well-known/openid-configuration | jq -r .issuer`
   (must be exactly `https://auth.a-conversa.org`).
2. `dex` service logs — config/storage errors appear at boot;
   connector errors at sign-in time.
3. App logs — `OAUTH_RESPONSE_IS_NOT_CONFORM` on discovery means the
   issuer URL answered with a non-200 (see "site not answering",
   it's usually the edge/binding class).
4. Google side — credentials valid in Cloud Console, redirect URI
   exactly `https://auth.a-conversa.org/callback`.
5. Secret mismatch after a rotation — re-run the rotation's verify
   step; check the two app↔Dex Variables hold the identical value.

### Deploy failed or app down after deploy

- The release workflow tells you **which stage**: gate (tag/changelog
  discipline), test, publish, or deploy. A failed **deploy job**
  (e.g., token misconfiguration) leaves production untouched on the
  prior deployment — fix the cause and **re-run the failed job**
  (GitHub UI; verified working). Don't re-cut the tag — the gate
  refuses re-cuts.
- A deployment that fails `/readyz` never goes live; the previous
  deployment keeps serving. Check the new deployment's logs — the
  startup migration gate refusing is the most likely cause.
- A **crashed** service auto-restarts up to 10 times
  (`railway.json` restart policy), then sits in `Crashed`
  **silently** (no email — the deploy-state webhook receiver is a
  recorded deferral, see [`uptime_monitoring.md`](../../tasks/refinements/deployment/uptime_monitoring.md)).
  Manual restart from the service's deployment menu; then diagnose
  from logs.
- Rollback: any prior deployment redeploys from Railway's
  Deployments tab; the procedure with migration caveats is
  [`rollback.md`](rollback.md).

### Database trouble

- Operator access: `railway connect postgres` (tunneled). Check both
  databases (app default + `dex`).
- Disk pressure alerts come from the Railway monitors (the event log
  only grows); the response is investigating growth, not deleting
  events — the event log is the system of record.
- Restore-from-backup: [`backup-restore.md`](backup-restore.md);
  RPO is one day.

### Where alerts come from (and don't)

- Railway Pro threshold monitors → **email + in-app** (resource
  metrics).
- Deployment-state changes (incl. `Crashed`) → **nothing yet**
  (webhook is HTTP-only, receiver deferred with the external uptime
  probe — revisit before the first show).
- User-vantage failures (DNS/TLS/edge/issuer) → **nothing yet**, same
  deferral. Until then: the operator's browser is the probe.

## Incident log

Append one line per real incident: date, symptom, root cause, fix,
runbook updated (y/n).

- **2026-06-12** — App's OIDC discovery failed in-region while
  external probes succeeded; custom-domain edge-binding propagation
  after DNS cutover. Resolved by waiting (a Variable-triggered
  redeploy coincided); recorded in the networking refinement.
- **2026-06-12** — Tag deploy failed: `RAILWAY_TOKEN` misconfigured
  in the GitHub `production` environment. Production unaffected;
  fixed the secret, re-ran the failed job. Recorded in the smoke-test
  refinement.
