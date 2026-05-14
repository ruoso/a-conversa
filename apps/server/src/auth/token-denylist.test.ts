// @vitest-environment node
//
// Vitest unit tests for the auth-token denylist surface.
//
// Refinement: tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md
// ADRs:        docs/adr/0020-postgres-migration-strategy.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.auth_hardening.jwt_revocation_jti_denylist
//
// **Coverage.**
//
//   `addToDenylist` / `isJtiRevoked`:
//     1. `addToDenylist` writes a row; `isJtiRevoked` reads it back.
//     2. `addToDenylist` is idempotent (ON CONFLICT DO NOTHING) on a
//        double-write of the same jti.
//     3. `isJtiRevoked` returns false for an unknown jti.
//
//   `sweepExpiredDenylistRows`:
//     4. Sweeper deletes rows whose `expires_at <= NOW()`; rows with
//        future `expires_at` are retained.
//     5. Sweeper returns the deletion count.
//
//   Periodic sweeper handle:
//     6. `startDenylistSweeper(pool, intervalMs)` returns a handle
//        whose `sweepNow()` runs the sweep step on demand.
//     7. `stop()` is idempotent — double-stop does not throw.
//
//   `resolveDenylistSweepIntervalMs`:
//     8. Reads the env var; falls back on missing / malformed / zero.
//
// These tests use a tiny in-memory pool that recognises the three SQL
// shapes the module emits. No real Postgres needed — the surface is
// pinned at the call-site SQL level (per ADR 0022's discipline of
// committing the verification with the code).

import { afterEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../db.js';
import {
  AUTH_DENYLIST_SWEEP_INTERVAL_ENV,
  DEFAULT_DENYLIST_SWEEP_INTERVAL_MS,
  addToDenylist,
  isJtiRevoked,
  resolveDenylistSweepIntervalMs,
  startDenylistSweeper,
  sweepExpiredDenylistRows,
} from './token-denylist.js';

/**
 * In-memory row shape mirroring the production table. The pool below
 * stores these so the test can inspect what landed.
 */
interface MemoryRow {
  jti: string;
  userId: string;
  /** Stored as ms-since-epoch for cheap comparison. */
  expiresAtMs: number;
  revokedAtMs: number;
}

/**
 * Build a minimal pool that answers the three SQL shapes the
 * denylist module emits — INSERT, SELECT, DELETE. Stores rows in a
 * `Map<jti, MemoryRow>`; the test reads / mutates the map directly
 * for assertions.
 */
function makeDenylistMemoryPool(initial: ReadonlyArray<MemoryRow> = []): {
  pool: DbPool;
  rows: Map<string, MemoryRow>;
} {
  const rows = new Map<string, MemoryRow>();
  for (const row of initial) {
    rows.set(row.jti, row);
  }
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('INSERT INTO auth_token_denylist')) {
        const jti = p[0] as string;
        const userId = p[1] as string;
        const expiresAtIso = p[2] as string;
        const expiresAtMs = new Date(expiresAtIso).getTime();
        if (rows.has(jti)) {
          // ON CONFLICT DO NOTHING — RETURNING is empty.
          return Promise.resolve({ rows: [] as TRow[] });
        }
        rows.set(jti, {
          jti,
          userId,
          expiresAtMs,
          revokedAtMs: Date.now(),
        });
        return Promise.resolve({ rows: [{ jti }] as unknown as TRow[] });
      }
      if (text.includes('SELECT 1 AS exists FROM auth_token_denylist')) {
        const jti = p[0] as string;
        return Promise.resolve({
          rows: rows.has(jti) ? ([{ exists: 1 }] as unknown as TRow[]) : ([] as TRow[]),
        });
      }
      if (text.includes('DELETE FROM auth_token_denylist')) {
        // Implements `WHERE expires_at <= NOW()` semantics.
        const now = Date.now();
        const removed: string[] = [];
        for (const [jti, row] of rows) {
          if (row.expiresAtMs <= now) {
            removed.push(jti);
          }
        }
        for (const jti of removed) {
          rows.delete(jti);
        }
        return Promise.resolve({
          rows: removed.map((jti) => ({ jti })) as unknown as TRow[],
        });
      }
      return Promise.reject(new Error(`unexpected SQL in denylist memory pool: ${text}`));
    },
  };
  return { pool, rows };
}

const ALICE_JTI = '11111111-1111-4111-8111-111111111111';
const ALICE_USER_ID = '00000000-0000-4000-8000-000000000aa1';
const BOB_JTI = '22222222-2222-4222-8222-222222222222';
const BOB_USER_ID = '00000000-0000-4000-8000-000000000bb2';

describe('addToDenylist / isJtiRevoked', () => {
  it('writes a row and reads it back', async () => {
    const { pool, rows } = makeDenylistMemoryPool();
    const future = Date.now() + 60_000;
    const inserted = await addToDenylist(
      { jti: ALICE_JTI, userId: ALICE_USER_ID, expiresAtMs: future },
      pool,
    );
    expect(inserted).toBe(1);
    expect(rows.size).toBe(1);
    expect(rows.get(ALICE_JTI)?.userId).toBe(ALICE_USER_ID);

    const revoked = await isJtiRevoked(ALICE_JTI, pool);
    expect(revoked).toBe(true);
  });

  it('is idempotent on a double-write of the same jti (ON CONFLICT DO NOTHING)', async () => {
    const { pool, rows } = makeDenylistMemoryPool();
    const future = Date.now() + 60_000;
    const first = await addToDenylist(
      { jti: ALICE_JTI, userId: ALICE_USER_ID, expiresAtMs: future },
      pool,
    );
    const second = await addToDenylist(
      { jti: ALICE_JTI, userId: ALICE_USER_ID, expiresAtMs: future },
      pool,
    );
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(rows.size).toBe(1);
  });

  it('isJtiRevoked returns false for an unknown jti', async () => {
    const { pool } = makeDenylistMemoryPool();
    const revoked = await isJtiRevoked(ALICE_JTI, pool);
    expect(revoked).toBe(false);
  });

  it('two different jtis live independently', async () => {
    const { pool } = makeDenylistMemoryPool();
    const future = Date.now() + 60_000;
    await addToDenylist({ jti: ALICE_JTI, userId: ALICE_USER_ID, expiresAtMs: future }, pool);
    await addToDenylist({ jti: BOB_JTI, userId: BOB_USER_ID, expiresAtMs: future }, pool);
    expect(await isJtiRevoked(ALICE_JTI, pool)).toBe(true);
    expect(await isJtiRevoked(BOB_JTI, pool)).toBe(true);
    expect(await isJtiRevoked('33333333-3333-4333-8333-333333333333', pool)).toBe(false);
  });
});

describe('sweepExpiredDenylistRows', () => {
  it('removes rows whose expires_at is in the past', async () => {
    const past = Date.now() - 60_000;
    const future = Date.now() + 60_000;
    const { pool, rows } = makeDenylistMemoryPool([
      {
        jti: ALICE_JTI,
        userId: ALICE_USER_ID,
        expiresAtMs: past,
        revokedAtMs: past - 1000,
      },
      {
        jti: BOB_JTI,
        userId: BOB_USER_ID,
        expiresAtMs: future,
        revokedAtMs: Date.now() - 100,
      },
    ]);
    const removed = await sweepExpiredDenylistRows(pool);
    expect(removed).toBe(1);
    // Bob's row (future expiry) survives.
    expect(rows.has(ALICE_JTI)).toBe(false);
    expect(rows.has(BOB_JTI)).toBe(true);
  });

  it('returns 0 when no rows are expired', async () => {
    const future = Date.now() + 60_000;
    const { pool, rows } = makeDenylistMemoryPool([
      {
        jti: ALICE_JTI,
        userId: ALICE_USER_ID,
        expiresAtMs: future,
        revokedAtMs: Date.now() - 100,
      },
    ]);
    const removed = await sweepExpiredDenylistRows(pool);
    expect(removed).toBe(0);
    expect(rows.has(ALICE_JTI)).toBe(true);
  });
});

describe('startDenylistSweeper', () => {
  it('returns a handle whose sweepNow() runs the sweep step on demand', async () => {
    const past = Date.now() - 60_000;
    const { pool, rows } = makeDenylistMemoryPool([
      {
        jti: ALICE_JTI,
        userId: ALICE_USER_ID,
        expiresAtMs: past,
        revokedAtMs: past - 1000,
      },
    ]);
    // Use a very large interval so the periodic timer never fires
    // during the test; we drive the sweep explicitly via sweepNow().
    const handle = startDenylistSweeper(pool, 60 * 60 * 1000);
    try {
      const removed = await handle.sweepNow();
      expect(removed).toBe(1);
      expect(rows.size).toBe(0);
    } finally {
      handle.stop();
    }
  });

  it('stop() is idempotent — double-stop does not throw', () => {
    const { pool } = makeDenylistMemoryPool();
    const handle = startDenylistSweeper(pool, 60 * 60 * 1000);
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });

  it('sweepNow swallows pool errors and returns 0 (non-fatal)', async () => {
    const failingPool: DbPool = {
      query(): Promise<{ rows: never[] }> {
        return Promise.reject(new Error('boom'));
      },
    };
    const handle = startDenylistSweeper(failingPool, 60 * 60 * 1000);
    try {
      const removed = await handle.sweepNow();
      // Caught + logged; returns 0 so the periodic loop continues.
      expect(removed).toBe(0);
    } finally {
      handle.stop();
    }
  });
});

describe('resolveDenylistSweepIntervalMs', () => {
  afterEach(() => {
    delete process.env[AUTH_DENYLIST_SWEEP_INTERVAL_ENV];
  });

  it('returns the default when the env var is absent', () => {
    expect(resolveDenylistSweepIntervalMs({})).toBe(DEFAULT_DENYLIST_SWEEP_INTERVAL_MS);
  });

  it('returns the parsed env value when valid', () => {
    expect(resolveDenylistSweepIntervalMs({ [AUTH_DENYLIST_SWEEP_INTERVAL_ENV]: '12345' })).toBe(
      12345,
    );
  });

  it('falls back on a malformed env value', () => {
    expect(
      resolveDenylistSweepIntervalMs({ [AUTH_DENYLIST_SWEEP_INTERVAL_ENV]: 'not-a-number' }),
    ).toBe(DEFAULT_DENYLIST_SWEEP_INTERVAL_MS);
  });

  it('falls back on zero / negative env values', () => {
    expect(resolveDenylistSweepIntervalMs({ [AUTH_DENYLIST_SWEEP_INTERVAL_ENV]: '0' })).toBe(
      DEFAULT_DENYLIST_SWEEP_INTERVAL_MS,
    );
    expect(resolveDenylistSweepIntervalMs({ [AUTH_DENYLIST_SWEEP_INTERVAL_ENV]: '-100' })).toBe(
      DEFAULT_DENYLIST_SWEEP_INTERVAL_MS,
    );
  });

  it('falls back on empty string', () => {
    expect(resolveDenylistSweepIntervalMs({ [AUTH_DENYLIST_SWEEP_INTERVAL_ENV]: '' })).toBe(
      DEFAULT_DENYLIST_SWEEP_INTERVAL_MS,
    );
  });
});
