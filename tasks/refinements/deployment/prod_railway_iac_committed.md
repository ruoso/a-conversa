# Railway IaC manifest — committed to the repo

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_compose_file.prod_railway_iac_committed`
**Effort estimate**: 0.5d
**Inherited dependencies**: `prod_railway_internal_networking` (settled — the project's final shape exists; this task captures it).
**Executor**: human operator (reads the live project) + can be paired with an agent for the writing/grepping; **no secret values are involved if done correctly — that property is the point of the task.**

## What this task is

Capture the production orchestration as code in the repo: the
`railway.json`/`railway.toml` config-as-code file(s) for what Railway
supports declaratively, plus a documented manifest of everything
Railway only holds as dashboard state — services, build sources,
domains, healthchecks, and the **names** (never values) of every
Variable. The prod analogue of `compose.yaml`, per ADR 0031.

## Why it needs to be done

If the Railway project is lost (account mishap, vendor exit per
ADR 0031's move-off consequence) the dashboard state is the only
record of how production is shaped. This task makes the shape
reproducible from source control + the password manager: the repo says
*what exists and what it's called*, the password manager holds *the
secret values*, and nothing else is needed.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> Commit `railway.json` (or Railway's current IaC format) capturing
> the project, services, build sources, custom domains, and Variable
> references. ... Variable *values* stay out of git (Railway
> Variables); the manifest references them by name.

**Scope honesty:** Railway's config-as-code historically covers
*per-service build/deploy settings* (builder, healthcheck path,
restart policy, start command), not full project topology (service
list, domains, variable wiring). Whatever the gap is at execution
time, the committed artifact must still capture the full shape — the
gap is filled with a documented manifest next to the native file.

## Execution steps (operator)

1. **Native config-as-code.** Author `railway.json` at the repo root
   for the `app` service per Railway's current schema: Dockerfile
   builder, healthcheck path (`/healthz`, later `/readyz`), restart
   policy. If Railway supports per-service config files for
   image-based services, add the `authelia` service's (image pin,
   start command, target port); otherwise it goes in step 2.
2. **The manifest.** Author `infra/railway/README.md` documenting, for
   each of the three services: source (repo+Dockerfile / image pin /
   add-on), target port, healthcheck, custom domain, start command,
   and the **complete Variable-name inventory** with one line each:
   where the value comes from (generation command, console, or
   reference) and which refinement documents it. The Authelia config
   *template* is already in
   [`prod_railway_authelia_service.md`](prod_railway_authelia_service.md);
   link, don't duplicate.
3. **Cross-check against live.** Walk the dashboard service-by-service
   confirming the manifest misses nothing (Variables view vs
   inventory, domains vs manifest, start commands vs manifest).
4. **Secret-leak gate.** Before committing, grep the new files for
   every secret's first 8 characters (from the password manager) and
   for telltale patterns (`postgres://`, `-----BEGIN`, `$pbkdf2`,
   `GOCSPX-` (Google secret prefix)). The committed artifacts must
   contain names, references, and structure only.
5. **Commit** per the repo ritual (doc/config-only commit).

## Constraints / requirements

- Zero secret values in git — including "harmless" ones like the
  pbkdf2 digest or full connection strings with passwords. Names and
  `${{...}}` reference syntax only.
- The manifest must be sufficient for the move-off scenario: a
  competent operator with this file + the password manager + the
  refinements can rebuild the project on Railway or re-derive a
  compose file for another host.
- Keep the manifest's variable inventory in sync going forward: any
  task that adds a Variable (e.g., `SENTRY_DSN` when error tracking
  lands) updates `infra/railway/README.md` in the same change.

## Acceptance criteria

- `railway.json` (and/or Railway's current format) committed and
  accepted by Railway on the next deploy (the deploy reads it — a
  schema error surfaces there).
- `infra/railway/README.md` lists all three services and an exhaustive
  Variable-name inventory matching the dashboard (spot-check count).
- The step-4 leak grep is clean; `git log -p` for the commit shows no
  secret material.

## Decisions

- **Native config-as-code where Railway supports it, narrative
  manifest for the rest** — maximizes what's machine-applied without
  pretending Railway's IaC covers topology it doesn't.
- **Manifest lives at `infra/railway/README.md`** — sibling to
  `infra/authelia/` and `infra/postgres/`, mirroring the dev-infra
  layout convention.

## Open questions

- **Railway's IaC coverage at execution time** — determines the split
  between step 1 and step 2; the acceptance criteria hold either way.
