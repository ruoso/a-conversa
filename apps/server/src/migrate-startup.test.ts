// Vitest unit tests for `applyMigrationsOnStartup`.
//
// Refinement: tasks/refinements/backend/health_endpoint.md
// ADRs:        docs/adr/0020-migrations-node-pg-migrate-forward-only.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.health_endpoint
//
// The startup gate's behavior under failure modes (DATABASE_URL
// reachable, runner throws, runner returns N applied) is the
// contract this test pins. We mock `node-pg-migrate`'s `runner`
// because the gate is unit-layer logic — what arguments it passes,
// how it surfaces errors, how it reports applied migrations to its
// log callback. The end-to-end migration-applied story is already
// covered by `tests/behavior/runner/migrate.feature` against pglite,
// and the `node-pg-migrate` library has its own test suite.
//
// **Why mocking is appropriate here despite ADR 0022.** ADR 0022's
// rule is about throwaway probes against the system under test, not
// about test doubles. The `runner` mock IS a committed test fixture
// (this file); it pins the contract between our gate and the
// upstream library. The full DB-touching scenario lives in Cucumber
// per the routing rule.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist the mock so the import below resolves to the mocked runner.
// `vi.mock` is hoisted to the top of the file by Vitest's transform.
const runnerMock = vi.hoisted(() => vi.fn());

vi.mock('node-pg-migrate', () => ({
  runner: runnerMock,
}));

// Import AFTER the mock so the module sees the mocked `runner`.
const { applyMigrationsOnStartup } = await import('./migrate-startup.js');

describe('applyMigrationsOnStartup', () => {
  beforeEach(() => {
    runnerMock.mockReset();
  });

  afterEach(() => {
    runnerMock.mockReset();
  });

  it('passes direction up, singleTransaction, checkOrder, migrationsTable to runner', async () => {
    runnerMock.mockResolvedValue([]);

    await applyMigrationsOnStartup({
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      log: () => {
        // silenced
      },
    });

    expect(runnerMock).toHaveBeenCalledTimes(1);
    const opts = runnerMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts['direction']).toBe('up');
    expect(opts['singleTransaction']).toBe(true);
    expect(opts['checkOrder']).toBe(true);
    expect(opts['migrationsTable']).toBe('pgmigrations');
    expect(opts['databaseUrl']).toBe('postgres://test:test@localhost:5432/test');
    expect(typeof opts['dir']).toBe('string');
    expect(opts['dir']).toMatch(/migrations$/);
  });

  it('returns the list of applied migrations on success', async () => {
    runnerMock.mockResolvedValue([
      { name: '0000_meta', path: '/x/0000_meta.sql' },
      { name: '0001_users', path: '/x/0001_users.sql' },
    ]);

    const applied = await applyMigrationsOnStartup({
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      log: () => {
        // silenced
      },
    });

    expect(applied).toEqual([{ name: '0000_meta' }, { name: '0001_users' }]);
  });

  it('returns an empty array when no migrations were pending', async () => {
    runnerMock.mockResolvedValue([]);

    const applied = await applyMigrationsOnStartup({
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      log: () => {
        // silenced
      },
    });

    expect(applied).toEqual([]);
  });

  it('propagates runner errors so the caller can abort startup', async () => {
    runnerMock.mockRejectedValue(new Error('connection refused'));

    await expect(
      applyMigrationsOnStartup({
        databaseUrl: 'postgres://test:test@localhost:5432/test',
        log: () => {
          // silenced
        },
      }),
    ).rejects.toThrow(/connection refused/);
  });

  it('logs the no-pending-migrations summary line', async () => {
    runnerMock.mockResolvedValue([]);
    const logged: string[] = [];

    await applyMigrationsOnStartup({
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      log: (msg) => logged.push(msg),
    });

    expect(logged.some((m) => m.includes('no pending migrations'))).toBe(true);
  });

  it('logs each applied migration name when migrations were applied', async () => {
    runnerMock.mockResolvedValue([
      { name: '0010_session_events', path: '/x/0010_session_events.sql' },
    ]);
    const logged: string[] = [];

    await applyMigrationsOnStartup({
      databaseUrl: 'postgres://test:test@localhost:5432/test',
      log: (msg) => logged.push(msg),
    });

    expect(logged.some((m) => m.includes('applied 1 migration'))).toBe(true);
    expect(logged.some((m) => m.includes('0010_session_events'))).toBe(true);
  });
});
