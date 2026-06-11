# Production Postgres — Railway add-on, app database, Authelia database

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_postgres_config`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_railway_project_bootstrap` (the `aconversa` project exists).
**Executor**: human operator (provisioning, role/database creation against the live instance).

## What this task is

Provision Railway's managed Postgres add-on inside the `aconversa`
project and shape it for the two consumers: the application (uses the
add-on's default database via the Railway-managed credentials) and
Authelia (gets its **own database and its own least-privilege role**
on the same instance, per ADR 0032).

## Why it needs to be done

- `prod_railway_app_service` wires `DATABASE_URL` as a reference to
  this add-on — the variable cannot be wired before the add-on exists.
- `prod_railway_authelia_service` configures Authelia's Postgres
  storage backend against the `authelia` database created here.
- The startup migration gate (`apps/server/src/migrate-startup.ts`)
  runs against this database on every deploy; nothing serves until it
  succeeds.

## Inputs / context

From [ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> **Postgres** — Railway's managed Postgres add-on. `DATABASE_URL` is
> injected into the `app` service as a Railway shared variable. Daily
> automatic backups are included.

From [ADR 0032](../../../docs/adr/0032-production-oauth-authelia-federation.md):

> **Storage backend** — Postgres, not sqlite. Authelia gets its own
> database (`authelia`) on the same Railway Postgres add-on the
> application uses.

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
3. **Create the Authelia role and database.** Connect with
   `railway connect postgres` (goes through Railway's tunnel; avoids
   pasting the superuser URL anywhere), then:

   ```sql
   -- Generate the password locally first, e.g.:  openssl rand -hex 24
   -- (hex avoids URL/YAML-escaping issues in connection strings)
   CREATE ROLE authelia LOGIN PASSWORD '<generated>';
   CREATE DATABASE authelia OWNER authelia;
   ```

   Store the password in the password manager as
   `AUTHELIA_STORAGE_PASSWORD` immediately; it's consumed by
   `prod_railway_authelia_service`. See
   [`postgres_credentials_handling.md`](postgres_credentials_handling.md).
4. **Verify backups.** Open the Postgres service → Backups and confirm
   the daily schedule is active. (The restore drill is the separate
   `backup_restore_test` task.)
5. **Verify the private hostname.** Note the service's private domain
   (`postgres.railway.internal` by default — it derives from the
   service name) for use in Authelia's storage config and the
   networking audit.

## Constraints / requirements

- The application keeps using the add-on's **default database** with
  the Railway-managed credentials, consumed only via the
  `${{Postgres.DATABASE_URL}}` variable reference — never hand-copied
  (see [`postgres_credentials_handling.md`](postgres_credentials_handling.md)).
- Authelia's role must be **least-privilege**: owner of the `authelia`
  database only, no access to the app's database. Authelia manages its
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
  and `authelia` (owner `authelia`).
- `psql` as the `authelia` role can connect to the `authelia` database
  and `CREATE TABLE`; the same role **cannot** connect to the app's
  database (`\c <appdb>` fails with permission denied).
- The password manager holds `AUTHELIA_STORAGE_PASSWORD`.

## Decisions

- **One add-on, two databases** — per ADR 0032 (split to a second
  add-on only if Authelia's load profile diverges).
- **Dedicated least-privilege `authelia` role** (refinement-level
  decision; the ADR specifies the database, not the role). Sharing the
  superuser credential with Authelia would let an Authelia compromise
  read the event log; a dedicated role makes the blast radius its own
  database. Cost: one extra credential to rotate.
- **Hex-charset password for the Authelia role.** It travels inside a
  YAML config and (potentially) a connection URL; hex sidesteps both
  escaping classes.

## Open questions

- **Railway's Postgres major at execution time.** If the add-on ships
  a major newer than 16, run the e2e suite against that major in the
  local compose stack before the first show (cheap insurance; the
  schema uses no version-sensitive features).
