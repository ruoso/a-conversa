// Apply all pending database migrations.
//
// Entry point for the local-dev `make migrate` target and the
// eventual application-startup migration check (the latter wired in
// `backend.api_skeleton`). Reads the database URL from `DATABASE_URL`,
// invokes node-pg-migrate's programmatic runner against the SQL files
// under `apps/server/migrations/`, logs what was applied, and exits
// non-zero on any error.
//
// Forward-only policy per ADR 0020 — direction is hard-coded to `up`.
// There is no migration-down path; reverting is done by writing a new
// forward migration that undoes the prior change.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { runner } from 'node-pg-migrate';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error(
      '[migrate] DATABASE_URL is not set. Copy .env.example to .env (or export DATABASE_URL) before running migrations.',
    );
    process.exit(1);
  }

  console.log(`[migrate] applying migrations from ${migrationsDir}`);

  const applied = await runner({
    databaseUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    // Wrap the whole batch in a single transaction so a failure
    // mid-way leaves the database in the previous consistent state.
    singleTransaction: true,
    // Verify migration file order matches what's been applied so far.
    checkOrder: true,
    log: (msg: string): void => {
      console.log(`[migrate] ${msg}`);
    },
  });

  if (applied.length === 0) {
    console.log('[migrate] no pending migrations');
  } else {
    console.log(`[migrate] applied ${applied.length} migration(s):`);
    for (const m of applied) {
      console.log(`[migrate]   - ${m.name}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
