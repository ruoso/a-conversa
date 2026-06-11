# Postgres credentials handling — managed app credential + Authelia role

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_secrets.postgres_credentials_handling`
**Effort estimate**: 0.5d
**Inherited dependencies**: `secret_storage_choice` (settled — Railway Variables + the conventions in [`secret_storage_choice.md`](secret_storage_choice.md)).
**Executor**: human operator.

## What this task is

Handling rules for the two database credentials:

1. **App credential** — generated and held by the Railway Postgres
   add-on; consumed by the `app` service **only** as the
   `${{Postgres.DATABASE_URL}}` reference.
2. **Authelia role credential** — operator-generated (`openssl rand
   -hex 24`, created in [`prod_postgres_config.md`](prod_postgres_config.md));
   lives as the `authelia` service's `AUTHELIA_STORAGE_PASSWORD`
   Variable + password manager.

## Why it needs to be done

`DATABASE_URL` is the highest-value secret in the system — it is the
event log. The handling rules exist to keep it (a) off the public
internet ([`prod_railway_internal_networking.md`](prod_railway_internal_networking.md)),
(b) out of every store except the two sanctioned ones, and (c)
rotatable without archaeology.

## Constraints / requirements

- **Reference, never copy.** The app's `DATABASE_URL` is a Railway
  reference; pasting the resolved string anywhere (another Variable, a
  local file, a ticket) creates an unrotatable copy. The only
  sanctioned hand-copy is a password-manager entry **pointing at** the
  add-on ("credential lives in Railway; access via `railway connect`"),
  not duplicating the string.
- **Operator ad-hoc access** goes through `railway connect postgres`
  (tunneled, no pasted URL). `DATABASE_PUBLIC_URL` stays unused; if an
  external tool ever genuinely needs it, that's a deliberate decision
  to record, not a convenience.
- **Authelia's role** follows the two-store rule like any
  operator-generated secret, and stays least-privilege (its database
  only — verified in `prod_postgres_config` acceptance).
- Pino redaction (backend-hardening) is the backstop against
  connection strings in logs; node-pg-migrate output doesn't echo the
  URL. No new code.

## Rotation procedures

**Authelia role password:**

1. Generate new value; `railway connect postgres` →
   `ALTER ROLE authelia PASSWORD '<new>';`
2. Update `AUTHELIA_STORAGE_PASSWORD` + password manager; restart
   `authelia`; verify boot (storage connect) and a sign-in.

**App credential** (Railway-managed): use Railway's credential
rotation if the dashboard offers it (the `DATABASE_URL` reference
updates automatically; restart `app` to pick it up). If it doesn't at
execution time: `railway connect postgres` → `ALTER ROLE <appuser>
PASSWORD '<new>'` — but first confirm in the dashboard how the add-on
stores the credential it serves through the reference, since manually
diverging the role password from what the reference serves bricks the
app's next boot. This is the one rotation that **must be rehearsed
against the live add-on's actual behavior** before it's needed.

## Acceptance criteria

- App-service Variables show `DATABASE_URL` as a reference; the
  resolved string exists nowhere else (dashboard search +
  password-manager review).
- `AUTHELIA_STORAGE_PASSWORD` in both stores; role is least-privilege.
- The Authelia-role rotation has been drilled once; the app-credential
  rotation path has been *investigated and written down* (which
  mechanism Railway offers, and the exact steps) in the password
  manager note / admin runbook.

## Decisions

- **No connection-string copies, tunnel for human access** — rationale
  above; this is the entire substance of the task, made explicit so
  future convenience-pastes are recognizable as violations.

## Open questions

- **Railway's app-credential rotation mechanism** at execution time —
  resolved during the rehearsal required by the acceptance criteria.
