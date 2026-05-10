// Test-only migration runner for pglite.
//
// Mirrors apps/server/scripts/migrate.ts in spirit — applies every SQL
// file under apps/server/migrations/ in lexicographic order — but runs
// against an in-process pglite handle instead of a `pg.Client`. The
// `node-pg-migrate` runner expects a `pg.ClientBase`, which pglite
// does not produce; rather than wrap pglite in a synthetic pg-protocol
// adapter, this helper reads the SQL files directly and tracks them in
// a `pgmigrations` table whose schema matches what `node-pg-migrate`
// produces (id SERIAL, name TEXT UNIQUE, run_on TIMESTAMP). The
// intent is twofold: (a) the application schema is identical to what
// production runs because the SQL files are the same; (b) the
// `pgmigrations` shape lets a future test-DB-provisioning step swap
// this helper out for the real `node-pg-migrate` runner without
// changing any feature scenarios.
//
// **Pre-empts foundation.test_infra.test_db_provisioning.** When that
// task formalizes, it inherits this pattern: pglite per scenario,
// migrations applied via SQL-file replay (or, if a pg-protocol adapter
// for pglite lands, via `node-pg-migrate` proper). This module is the
// integration-layer source of truth until then.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
// tests/behavior/support/ -> ../../.. -> repo root -> apps/server/migrations
const MIGRATIONS_DIR = resolve(here, '..', '..', '..', 'apps', 'server', 'migrations');

// Match node-pg-migrate's tracking table shape. Tests that exercise
// the migration runner assert on rows here.
const PGMIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS pgmigrations (
    id     SERIAL       PRIMARY KEY,
    name   VARCHAR(255) NOT NULL UNIQUE,
    run_on TIMESTAMP    NOT NULL
  )
`;

export interface AppliedMigration {
  readonly name: string;
}

// Apply every migration under apps/server/migrations/ that has not yet
// been recorded in `pgmigrations`. Returns the names that were applied
// on this call (empty if all were already applied — the no-op rerun
// case).
export async function applyMigrations(db: PGlite): Promise<AppliedMigration[]> {
  await db.exec(PGMIGRATIONS_DDL);

  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();

  const alreadyAppliedRes = await db.query<{ name: string }>('SELECT name FROM pgmigrations');
  const alreadyApplied = new Set(alreadyAppliedRes.rows.map((r) => r.name));

  const applied: AppliedMigration[] = [];
  for (const filename of sqlFiles) {
    // node-pg-migrate stores the basename without extension. Match that
    // so a future swap to `node-pg-migrate` proper sees consistent rows.
    const name = filename.replace(/\.sql$/, '');
    if (alreadyApplied.has(name)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())', [name]);
    applied.push({ name });
  }

  return applied;
}

// Exposed for assertions that need the canonical migration count.
export async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name.replace(/\.sql$/, ''))
    .sort();
}
