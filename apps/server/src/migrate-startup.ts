// Startup migration gate — applies pending migrations before the
// HTTP server starts listening. Implements the C6 rule from
// `tasks/refinements/data-and-methodology/migrations_tooling.md`
// ("application refuses to start with pending migrations"),
// **deferred** at the time ADR 0020 was written ("the start-up gate
// that consumes [the runner] is deferred to backend.api_skeleton")
// and now settled by `backend.api_skeleton.health_endpoint`.
//
// Refinement: tasks/refinements/backend/health_endpoint.md
// ADRs:        docs/adr/0020-migrations-node-pg-migrate-forward-only.md
//              (settles the deferred startup-gate half of C6)
// TaskJuggler: backend.api_skeleton.health_endpoint
//
// **Apply-on-startup semantics (not check-only).** The Makefile's
// existing note — "Once `health_endpoint` (with migrations-on-startup)
// ships, `up` absorbs `up-app`" — and the refinement's R-decision
// settle this: when the application boots, it APPLIES any pending
// migrations forward. If applying fails (DB unreachable, migration
// error, ordering mismatch via `checkOrder`) the process aborts with
// a non-zero exit before `app.listen(...)`. The end state is either
// "schema is current AND server is up" or "server refused to start
// AND the operator sees the migration error." There is no third
// state where the server is up against a stale schema.
//
// **Why apply, not just check.** Either interpretation of C6 ("apply
// pending migrations" vs. "abort if pending exist, let operator
// apply them") satisfies the literal rule. The Makefile's text
// implies apply (so `up` can absorb `up-app` without a separate
// `make migrate` step). Apply also better matches the
// production-deploy story owned by
// `deployment.prod_migrations.migration_runner_in_prod`: prod also
// runs migrations as part of bringing up the new image.
//
// **Reuse of the standalone `scripts/migrate.ts` logic.** That CLI
// stays in place — it's the entry point `make migrate` calls. This
// module imports `node-pg-migrate`'s `runner` directly with the same
// options (`direction: 'up'`, `singleTransaction: true`,
// `checkOrder: true`, `migrationsTable: 'pgmigrations'`) and the
// same on-disk migrations directory. Both paths produce identical
// `pgmigrations` rows because they invoke the same library against
// the same SQL.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runner, type RunnerOption } from 'node-pg-migrate';
import type { FastifyBaseLogger } from 'fastify';

const here = dirname(fileURLToPath(import.meta.url));
// apps/server/src/ -> ../migrations
const MIGRATIONS_DIR = resolve(here, '..', 'migrations');

/**
 * Shape of a single applied-migration record returned by
 * `node-pg-migrate`'s `runner`. We only care about the name (the
 * filename basename without extension) — that's what gets logged
 * back to the operator.
 */
export interface AppliedMigration {
  readonly name: string;
}

/**
 * Options accepted by `applyMigrationsOnStartup`. Logger is optional
 * so callers can pass `undefined` in tests; production calls pass
 * the Fastify Pino logger.
 */
export interface StartupMigrationOptions {
  /** Postgres connection string. */
  readonly databaseUrl: string;
  /**
   * Logger used for the per-migration progress lines and the
   * summary. When absent, falls through to `console`. Tests pass
   * `undefined` to silence the noise.
   */
  readonly log?: (msg: string) => void;
}

/**
 * Apply any pending migrations under `apps/server/migrations/`
 * against the given `DATABASE_URL`. Resolves with the list of
 * applied migrations on success; rejects on any error (DB
 * unreachable, migration SQL failure, `checkOrder` mismatch, etc.).
 *
 * The caller (typically `index.ts`'s `main()`) is responsible for
 * exit-code handling. This module returns / throws; it does not
 * call `process.exit`.
 */
export async function applyMigrationsOnStartup(
  options: StartupMigrationOptions,
): Promise<AppliedMigration[]> {
  const log = options.log ?? ((msg: string): void => console.log(msg));

  log(`[migrate-startup] applying migrations from ${MIGRATIONS_DIR}`);

  // RunnerOption demands `dir: string | string[]` and refuses
  // `readonly`; the constructed object is mutable by design.
  const runnerOptions: RunnerOption = {
    databaseUrl: options.databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    singleTransaction: true,
    checkOrder: true,
    log: (msg) => {
      log(`[migrate-startup] ${msg}`);
    },
  };

  const applied = await runner(runnerOptions);

  if (applied.length === 0) {
    log('[migrate-startup] no pending migrations');
  } else {
    log(`[migrate-startup] applied ${applied.length.toString()} migration(s):`);
    for (const m of applied) {
      log(`[migrate-startup]   - ${m.name}`);
    }
  }

  return applied.map((m) => ({ name: m.name }));
}

/**
 * Convenience wrapper for callers that already have a Fastify Pino
 * logger and want the migrate-startup output to land in the same
 * structured stream as everything else. Routes each `[migrate-startup]`
 * line through `logger.info`.
 */
export function withFastifyLogger(logger: FastifyBaseLogger): (msg: string) => void {
  return (msg: string): void => {
    logger.info(msg);
  };
}
