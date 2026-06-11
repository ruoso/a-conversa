# Internal networking — private service discovery + cross-service Variables

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_compose_file.prod_railway_internal_networking`
**Effort estimate**: 0.5d
**Inherited dependencies**: `prod_railway_app_service` and `prod_railway_authelia_service` (both settled before this runs — this task audits and finishes their wiring).
**Executor**: human operator (dashboard audit).

## What this task is

The closing audit on the project's network shape: confirm every
service-to-service hop that *can* stay on Railway's per-project
private network (IPv6, `<service>.railway.internal`) does, confirm the
one deliberate exception (app → Authelia, see Decisions), and confirm
the cross-service Variable references resolve so each service sees the
env it needs.

## Why it needs to be done

ADR 0031 commits to "the Postgres connection never crosses the public
internet." The app and authelia services were each configured in their
own task; nothing yet has checked the *combined* wiring — a pasted
public connection string or a stale variable reference would work
functionally while silently violating the network shape.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> **Private networking.** `app` reaches `authelia` and `postgres` via
> Railway's per-project internal DNS (`<service>.railway.internal`)
> over IPv6. The Postgres connection never crosses the public
> internet.

> **TLS + domain.** ... Authelia is reachable at
> `authelia.a-conversa.org` ... so the OIDC issuer URL is HTTPS-clean
> for both the browser and the in-network app→Authelia call.

These two ADR bullets are in tension for the app→Authelia hop — an
OIDC issuer must present one consistent HTTPS URL to both the browser
and the backchannel, and Authelia in prod has no TLS listener (Railway's
edge terminates TLS). Resolution recorded under Decisions.

## Execution steps (operator)

1. **Private networking enabled.** Project settings → confirm private
   networking is on (default for new projects).
2. **Postgres — app side.** The `app` service's `DATABASE_URL` is the
   `${{Postgres.DATABASE_URL}}` reference and the resolved value's
   host is `postgres.railway.internal` (open the resolved view in the
   dashboard). If Railway's reference resolves to the public proxy
   URL, switch the reference to the add-on's private/internal URL
   variable.
3. **Postgres — Authelia side.** The rendered Authelia config's
   `storage.postgres.address` points at `postgres.railway.internal`
   (it was templated that way; confirm the actual service's private
   domain matches — it derives from the service name).
4. **App → Authelia.** `OIDC_ISSUER_URL` on the app service is
   `https://authelia.a-conversa.org` — the public edge hostname, *not*
   `authelia.railway.internal` (see Decisions). Nothing to change;
   just confirm.
5. **No public Postgres exposure.** On the Postgres service, confirm
   no public TCP proxy is enabled beyond what the add-on ships with;
   `DATABASE_PUBLIC_URL` is referenced by **zero** services (search
   each service's Variables for it).
6. **Reference integrity.** `railway variables --service app` and
   `--service authelia`: every reference resolves (no `${{...}}`
   literals leaking through), no Variable is an out-of-date hand copy
   of another service's value.

## Constraints / requirements

- Postgres traffic (both consumers) stays on `railway.internal` —
  the load-bearing privacy property from ADR 0031.
- Cross-service values use Railway references, not copies, wherever
  Railway supports the reference (copies rot on rotation).
- The app→Authelia hop uses the public HTTPS hostname; do **not**
  "optimize" it onto the private network without solving issuer-URL
  consistency end-to-end (it would break OIDC discovery validation —
  the backend boot-validates the issuer).

## Acceptance criteria

- Dashboard/`railway variables` audit shows: `DATABASE_URL` (app) and
  `storage.postgres.address` (authelia) on `railway.internal` hosts;
  `DATABASE_PUBLIC_URL` referenced nowhere.
- `app` deploy logs show the migration gate connecting successfully
  (over the private host) and OIDC discovery succeeding against
  `https://authelia.a-conversa.org`.
- Authelia boot logs show its storage connected (private host).

## Decisions

- **App → Authelia goes over the public edge
  (`https://authelia.a-conversa.org`), only Postgres is private.**
  This resolves the ADR 0031 tension noted above in favor of OIDC
  correctness: the issuer URL the browser sees and the one the
  backend validates must be identical, and TLS for it exists only at
  Railway's edge. The cost — auth backchannel traffic loops through
  the edge — is negligible at v1 scale (a handful of token exchanges
  per login). Revisit only if Authelia ever gets an internal TLS
  listener with a SAN covering an internal name *and* OIDC discovery
  can be split cleanly (unlikely to ever be worth it).

## Open questions

- **IPv6 binding.** Railway's private network is IPv6; both consumers
  of it here (app→Postgres via `pg`, Authelia→Postgres) resolve
  `railway.internal` AAAA records — confirm at execution time that
  both connect on the first try, and if `pg` misbehaves, the
  documented fix is adding `?host=` family hints rather than falling
  back to the public URL.
