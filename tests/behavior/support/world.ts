// Cucumber World — per-scenario pglite handle and query helper.
//
// Each scenario gets a fresh in-memory `PGlite` instance via the
// `Before` hook below. The handle and a thin `query` helper are
// exposed on the World so step definitions can reach the database
// without juggling globals.
//
// **Pre-empts foundation.test_infra.test_db_provisioning.** When that
// task formalizes the per-scenario DB story, the pattern here — fresh
// pglite per scenario, migrations applied via `applyMigrations` —
// becomes the canonical implementation. See ./README.md for the full
// rationale (pglite vs. compose Postgres, why this exists before the
// owning task formalizes it).
//
// **No probes in this file.** Any empirical question about pglite
// behavior — does `gen_random_uuid()` work? does JSONB round-trip? do
// partial-unique indexes fire on the predicate-matching subset? — is
// answered by a committed scenario under
// `tests/behavior/pglite/feature-support.feature`. See ADR 0022
// (docs/adr/0022-no-throwaway-verifications.md).

import { After, Before, setWorldConstructor, World } from '@cucumber/cucumber';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from './migrate.js';

// Structural shape compatible with `loadFixture`'s `LoadFixtureClient`
// — a single `query(text, params?)` method. The pglite handle's own
// `.query` already matches this contract; we re-expose it on the
// World as `client` so step defs that use the fixture loader can pass
// `this.client` without reaching into `this.db`.
export interface PgliteQueryClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<unknown>;
}

// Minimal row shape for query results. `db.query<T>` returns an
// object with `.rows: T[]`; we narrow result types at call sites.
export interface QueryResult<T> {
  readonly rows: T[];
}

export class AConversaWorld extends World {
  // Initialized in the Before hook below; non-null asserted at use
  // sites because Cucumber guarantees Before runs before any step.
  public db!: PGlite;

  // Convenience alias matching the `LoadFixtureClient` shape so tests
  // can pass `this.client` to `loadFixture` without a cast.
  public client!: PgliteQueryClient;

  // Per-scenario scratch state. Step defs stash row sets, last-error
  // values, and similar between Given/When/Then here.
  public scratch: Record<string, unknown> = {};
}

setWorldConstructor(AConversaWorld);

Before(async function (this: AConversaWorld) {
  this.db = new PGlite();
  this.client = {
    // Wrap so we expose only the structural `query(text, params?)`
    // surface — matches the fixture loader's `LoadFixtureClient`.
    query: (text, params) => this.db.query(text, params as unknown[] | undefined),
  };
  await applyMigrations(this.db);
  this.scratch = {};
});

After(async function (this: AConversaWorld) {
  if (this.db) {
    await this.db.close();
  }
});
