# Production Postgres — Railway add-on, app database, Dex database

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_postgres_config`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_railway_project_bootstrap` (the `aconversa` project exists).
**Executor**: human operator (provisioning, role/database creation against the live instance).

## What this task is

Provision Railway's managed Postgres add-on inside the `aconversa`
project and shape it for the two consumers: the application (uses the
add-on's default database via the Railway-managed credentials) and
Dex (gets its **own database and its own least-privilege role**
on the same instance, per ADR 0048).

> **Reworked 2026-06-12** for [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md)
> (Dex replaces Authelia; ADR 0032 superseded). If the `authelia`
> role/database were already created on a first execution, step 3
> includes their teardown.

## Why it needs to be done

- `prod_railway_app_service` wires `DATABASE_URL` as a reference to
  this add-on — the variable cannot be wired before the add-on exists.
- `prod_railway_dex_service` configures Dex's Postgres
  storage backend against the `dex` database created here.
- The startup migration gate (`apps/server/src/migrate-startup.ts`)
  runs against this database on every deploy; nothing serves until it
  succeeds.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> **Postgres** — Railway's managed Postgres add-on. `DATABASE_URL` is
> injected into the `app` service as a Railway shared variable. Daily
> automatic backups are included.

From [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md):

> **Storage** — Postgres: a `dex` database and least-privilege `dex`
> role on the shared Railway add-on [...]. Dex generates and rotates
> its own token-signing keys inside storage.

The dev stack runs `postgres:16-alpine` (ADR 0016); Railway's add-on
tracks a recent upstream major. The app's schema is plain Postgres
(node-pg-migrate, ADR 0020) with no extension requirements beyond the
defaults.

## Execution steps (operator)

1. **Provision.** In the `aconversa` project dashboard: New → Database
   → PostgreSQL. Railway creates the service with a generated superuser
   credential set and exposes `DATABASE_URL` (private-network form) and
   `DATABASE_PUBLIC_URL` on the service.
2. **Check the major version.** Confirm the add-on's Postgres major is
   ≥ 16 (the dev/CI baseline). If Railway offers a version choice, pick
   the closest to 16 that is current.
3. **Create the Dex role and database.** Connect with
   `railway connect postgres` (goes through Railway's tunnel; avoids
   pasting the superuser URL anywhere), then:

   ```sql
   -- Generate the password locally first, e.g.:  openssl rand -hex 24
   -- (hex avoids URL/YAML-escaping issues in connection strings)
   CREATE ROLE dex LOGIN PASSWORD '<generated>';
   CREATE DATABASE dex OWNER dex;

   -- If the superseded authelia role/database exist from the first
   -- execution (pre-ADR 0048), drop them in the same session:
   DROP DATABASE IF EXISTS authelia;
   DROP ROLE IF EXISTS authelia;
   ```

   Store the password in the password manager as
   `ACONVERSA_STORAGE_PASSWORD` immediately; it's consumed by
   `prod_railway_dex_service`. See
   [`postgres_credentials_handling.md`](postgres_credentials_handling.md).
4. **Verify backups.** Open the Postgres service → Backups and confirm
   the daily schedule is active. (The restore drill is the separate
   `backup_restore_test` task.)
5. **Verify the private hostname.** Note the service's private domain
   (`postgres.railway.internal` by default — it derives from the
   service name) for use in the networking audit (Dex's storage
   config reaches it via the `ACONVERSA_PGHOST` reference Variable).

## Constraints / requirements

- The application keeps using the add-on's **default database** with
  the Railway-managed credentials, consumed only via the
  `${{Postgres.DATABASE_URL}}` variable reference — never hand-copied
  (see [`postgres_credentials_handling.md`](postgres_credentials_handling.md)).
- Dex's role must be **least-privilege**: owner of the `dex`
  database only, no access to the app's database. Dex manages its
  own schema inside its database (it runs its own migrations on boot).
- Only private-network connection strings are used by services.
  `DATABASE_PUBLIC_URL` exists for operator emergencies (and the
  `railway connect` tunnel is preferred even then).
- No schema or data work happens in this task — the app's schema
  arrives via the startup migration gate on first `app` deploy.

## Acceptance criteria

- The Postgres service exists in the `aconversa` project; daily
  backups show as enabled.
- `railway connect postgres` works; `\l` lists the default database
  and `dex` (owner `dex`) — and no `authelia` database.
- `psql` as the `dex` role can connect to the `dex` database
  and `CREATE TABLE`; the same role **cannot** connect to the app's
  database (`\c <appdb>` fails with permission denied).
- The password manager holds `ACONVERSA_STORAGE_PASSWORD`.

## Decisions

- **One add-on, two databases** — per ADR 0032, carried forward by
  ADR 0048 (split to a second add-on only if Dex's load profile
  diverges).
- **Dedicated least-privilege `dex` role** (refinement-level
  decision; the ADR specifies the database, not the role). Sharing the
  superuser credential with Dex would let a Dex compromise
  read the event log; a dedicated role makes the blast radius its own
  database. Cost: one extra credential to rotate.
- **Hex-charset password for the Dex role.** It travels inside a
  YAML config and (potentially) a connection URL; hex sidesteps both
  escaping classes.

## Open questions

- **Railway's Postgres major at execution time.** If the add-on ships
  a major newer than 16, run the e2e suite against that major in the
  local compose stack before the first show (cheap insurance; the
  schema uses no version-sensitive features). **Resolved 2026-06-12:**
  the add-on runs major 18 (`ghcr.io/railwayapp-templates/postgres-ssl:18`),
  and the full Playwright e2e suite passed (258/258) against
  `postgres:18-alpine` on the local compose stack. One gotcha for a
  future dev-stack upgrade to 18: the official `postgres:18` image
  refuses a volume mounted at `/var/lib/postgresql/data` even when
  empty — its convention moved to mounting at `/var/lib/postgresql`
  with the cluster in a versioned subdirectory (enabling
  `pg_upgrade --link`); the insurance run used that mount
  temporarily, and the committed dev compose stays on 16 per
  ADR 0016 until a deliberate upgrade.

## Status

**Done — 2026-06-12.** Postgres add-on provisioned in the `aconversa`
project; `dex` role + database created per the ADR 0048 rework (the
`authelia` role/database from the first-execution attempt dropped);
`ACONVERSA_STORAGE_PASSWORD` in both stores. Live consumers: the app's
migration gate and Dex's storage migrations both ran green against it
(see the service refinements).
