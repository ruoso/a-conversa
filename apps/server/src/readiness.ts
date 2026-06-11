// Boot-time readiness facts for the `/readyz` probe.
//
// Refinement: tasks/refinements/deployment/health_and_readiness_endpoints.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0020-migrations-node-pg-migrate-forward-only.md
// TaskJuggler: deployment.observability.health_and_readiness_endpoints
//
// The startup migration gate (ADR 0020 C6, wired in `index.ts`) is a
// boot-time fact: by the time the port is bound, the gate either ran
// to completion, was deliberately skipped, or — on failure — the
// process aborted before listening. `/readyz` must report that fact
// on every probe, so the gate's outcome is recorded here once, at
// boot, rather than re-derived per probe by querying `pgmigrations`
// against the migrations directory (which would re-implement the
// runner's pending-set logic on a 60s cadence for no new
// information).
//
// The default `not-run` state is what test-constructed
// `createServer()` instances see (their bootstrap never runs the
// gate) — `/readyz` reports 503 for them, which is honest: that
// instance never proved its schema is current.

/**
 * Outcome of the startup migration gate, as `/readyz` consumes it.
 *
 * - `not-run` — the gate has not executed in this process (the
 *   default until `index.ts`'s `main()` reaches the gate; permanent
 *   for test-constructed instances).
 * - `completed` — the gate ran to completion; the schema is current.
 * - `skipped` — the gate was bypassed, with the reason:
 *   - `explicit-skip`: `SKIP_STARTUP_MIGRATIONS=true` — the
 *     operator's out-of-band assertion that the schema is current.
 *     Counts as migrations-ready (see the refinement's Decisions:
 *     a permanently failing probe would make the escape hatch
 *     self-defeating in any orchestrated environment).
 *   - `no-database-url`: `DATABASE_URL` unset — the server cannot
 *     serve DB-touching requests at all. Counts as NOT ready.
 */
export type MigrationGateState =
  | { readonly kind: 'not-run' }
  | { readonly kind: 'completed'; readonly appliedCount: number }
  | { readonly kind: 'skipped'; readonly reason: 'explicit-skip' | 'no-database-url' };

let migrationGateState: MigrationGateState = { kind: 'not-run' };

/**
 * Record that the startup migration gate ran to completion.
 * Called by `index.ts` after `applyMigrationsOnStartup()` resolves.
 */
export function markMigrationGateCompleted(appliedCount: number): void {
  migrationGateState = { kind: 'completed', appliedCount };
}

/**
 * Record that the startup migration gate was bypassed, and why.
 * Called by `index.ts` on its two skip paths.
 */
export function markMigrationGateSkipped(reason: 'explicit-skip' | 'no-database-url'): void {
  migrationGateState = { kind: 'skipped', reason };
}

/** Current gate state — consumed by the `/readyz` route handler. */
export function getMigrationGateState(): MigrationGateState {
  return migrationGateState;
}

/**
 * Does the recorded gate state satisfy the readiness contract?
 * `completed` and the explicit operator skip are ready; `not-run`
 * and the missing-`DATABASE_URL` skip are not.
 */
export function isMigrationGateReady(): boolean {
  const state = migrationGateState;
  if (state.kind === 'completed') return true;
  return state.kind === 'skipped' && state.reason === 'explicit-skip';
}

/**
 * Test-only helper — restore the default `not-run` state so suites
 * that exercise the setters don't leak state across tests. The `__`
 * prefix signals "test-only" (same convention as `__resetDefaultPool`).
 */
export function __resetMigrationGateState(): void {
  migrationGateState = { kind: 'not-run' };
}
