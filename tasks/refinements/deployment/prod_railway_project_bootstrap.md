# Railway bootstrap — account, CLI, and the `aconversa` project

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_compose_file.prod_railway_project_bootstrap`
**Effort estimate**: 0.5d
**Inherited dependencies**: `prod_container` rollup (the production Dockerfile exists at the repo root and the CI/release workflows exercise it; the `.tji` completion markers for those leaves are tracked separately).
**Executor**: human operator (account creation, billing, GitHub App install).

## What this task is

The one-time bootstrap that everything else in the Railway chain hangs
off: create the Railway account, put a payment method on it, install
and authenticate the Railway CLI, create the `aconversa` project, and
connect the GitHub repository. After this task, the dashboard and CLI
are both able to act on the project, and the repo is visible to
Railway's build system.

## Why it needs to be done

Every other `prod_railway_*` leaf (`app` service, `dex` service,
networking, IaC export) and `prod_postgres_config` operate **inside**
this project. None of them can start until the project exists and the
GitHub link is in place.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> Production runs as a single Railway project named `aconversa`. Three
> services in one project, on Railway's per-project private network.

> **Cost shape.** Hobby plan ($5/mo base, includes $5 usage) covers the
> app + Authelia + Postgres at projected v1 traffic.

*(Per [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md)
the identity service is now Dex — if anything lighter than the
Authelia the estimate assumed.)*

Hobby tier is single-region (US-East) and always-on — both intended
(ADR 0031 Consequences).

## Execution steps (operator)

1. **Account.** Create a Railway account at railway.com. Sign up with
   the operator's GitHub identity (simplifies the repo link). Choose
   the **Hobby** plan and add a payment method.
2. **CLI.** Install the Railway CLI locally (`npm i -g @railway/cli`
   or the platform package manager), then `railway login` (opens a
   browser auth flow).
3. **Project.** Create a project named **`aconversa`** — dashboard
   "New Project" or `railway init` from the repo checkout. Pick the
   default (US-East) region.
4. **GitHub link.** In the project dashboard, connect the GitHub
   repository: this installs the Railway GitHub App and requires
   granting it access to the a-conversa repo (GitHub admin needed).
   Do **not** create the `app` service yet — that's
   `prod_railway_app_service`; this step only establishes the repo
   connection.
5. **Link the checkout.** In the local repo checkout, `railway link`
   and select the `aconversa` project, so subsequent CLI commands
   (`railway variables`, `railway connect`, `railway up`) target it.

## Constraints / requirements

- Project name is exactly `aconversa` (ADR 0031 names it; the IaC
  manifest and docs reference it).
- The account owning the project is the operator's — there is no team
  to share with in v1, but note the dashboard credentials in the
  password manager so the project isn't keyed to a single browser
  session.
- No services are created in this task. The deliverable is the empty,
  linked project.

## Acceptance criteria

- `railway status` from the repo checkout reports the `aconversa`
  project.
- The Railway dashboard shows the GitHub repo connected to the project.
- Billing page shows the Hobby plan active with a payment method.

## Decisions

- **Hobby plan, default region.** Per ADR 0031 (cost shape; Hobby is
  single-region US-East and always-on, both acceptable for v1).
- **Sign up via GitHub identity.** One fewer credential pair; the repo
  link flow is native. The operator's GitHub account is already the
  privileged identity for the project.

## Open questions

- **Usage alerts.** Railway supports usage limits/alerts on the
  billing page; configuring them is deferred to the `admin_runbook`
  refinement per ADR 0031, but the operator may set a soft limit
  (e.g., $25/mo) while already on the billing page.

## Status

**Done — 2026-06-12.** The `aconversa` Railway project exists with the
GitHub repo linked and the CLI authenticated; the `postgres`, `app`,
and `dex` services were all created inside it (their own refinements
carry the per-service detail).
