// Self-tests for `concurrent-write-pool.ts` — pin the harness's
// FOR UPDATE / UNIQUE-violation / gate semantics so a regression in
// the harness fails LOUDLY rather than silently letting a scenario
// pass for the wrong reason.
//
// Refinement: tasks/refinements/backend-hardening/concurrent_write_test_harness.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.concurrency_safety.concurrent_write_test_harness

import { describe, expect, it } from 'vitest';

import { makeConcurrentWritePool, UniqueViolationError } from './concurrent-write-pool.js';

const SESSION_ID = '00000000-0000-4000-8000-0000000000a1';
const ALICE_ID = '00000000-0000-4000-8000-0000000000b1';

function seededHarness() {
  return makeConcurrentWritePool({
    initial: {
      users: [{ id: ALICE_ID, screen_name: 'alice', deleted_at: null }],
      sessions: [
        {
          id: SESSION_ID,
          host_user_id: ALICE_ID,
          privacy: 'public',
          topic: 'self-test',
          created_at: new Date('2026-05-11T10:00:00.000Z'),
          ended_at: null,
        },
      ],
    },
  });
}

describe('concurrent-write harness — FOR UPDATE blocks across connections', () => {
  it('connection B awaits connection A on the same sessions row until A commits', async () => {
    const harness = seededHarness();

    // Connection A acquires the lock and stays in-transaction.
    const clientA = await harness.pool.connect();
    await clientA.query('BEGIN');
    await clientA.query('SELECT id, ended_at FROM sessions WHERE id = $1 FOR UPDATE', [SESSION_ID]);

    // Connection B attempts the same FOR UPDATE — it should block.
    const clientB = await harness.pool.connect();
    await clientB.query('BEGIN');
    let bResolved = false;
    const bPromise = clientB
      .query('SELECT id, ended_at FROM sessions WHERE id = $1 FOR UPDATE', [SESSION_ID])
      .then((res) => {
        bResolved = true;
        return res;
      });

    // Synchronisation point — wait until the harness reports B is
    // queued, then assert B is genuinely still waiting.
    await harness.untilWaitingForLock();
    expect(bResolved).toBe(false);

    // A commits — B should unblock and resolve.
    await clientA.query('COMMIT');
    clientA.release();

    const bResult = await bPromise;
    expect(bResolved).toBe(true);
    expect(bResult.rows).toHaveLength(1);

    await clientB.query('COMMIT');
    clientB.release();
  });
});

describe('concurrent-write harness — UNIQUE(session_id, sequence) fires on duplicate INSERT', () => {
  it('a second INSERT at the same (session_id, sequence) raises UniqueViolationError', async () => {
    const harness = seededHarness();
    const client = await harness.pool.connect();
    await client.query('BEGIN');

    const insertSql =
      'INSERT INTO session_events (id, session_id, sequence, kind, actor, payload) ' +
      'VALUES ($1, $2, $3, $4, $5, $6::jsonb)';
    await client.query(insertSql, [
      '00000000-0000-4000-8000-0000000000e1',
      SESSION_ID,
      1,
      'session-created',
      ALICE_ID,
      JSON.stringify({}),
    ]);

    // Second INSERT at the same (session_id, sequence) — must throw.
    await expect(
      client.query(insertSql, [
        '00000000-0000-4000-8000-0000000000e2',
        SESSION_ID,
        1,
        'session-ended',
        ALICE_ID,
        JSON.stringify({}),
      ]),
    ).rejects.toBeInstanceOf(UniqueViolationError);

    await client.query('ROLLBACK');
    client.release();
  });
});

describe('concurrent-write harness — gateOnInsert pauses + releases deterministically', () => {
  it('a gated INSERT does not land in the store until release() is called; the awaiting query resolves after', async () => {
    const harness = seededHarness();
    const gate = harness.gateOnInsert(SESSION_ID);

    const client = await harness.pool.connect();
    await client.query('BEGIN');

    const insertSql =
      'INSERT INTO session_events (id, session_id, sequence, kind, actor, payload) ' +
      'VALUES ($1, $2, $3, $4, $5, $6::jsonb)';
    const insertPromise = client.query(insertSql, [
      '00000000-0000-4000-8000-0000000000f1',
      SESSION_ID,
      1,
      'session-created',
      ALICE_ID,
      JSON.stringify({}),
    ]);

    // Wait for the gate to fire — the INSERT is paused.
    await gate.whenHit;
    expect(harness.store.events).toHaveLength(0);

    // Release and assert the INSERT landed.
    gate.release();
    await insertPromise;
    expect(harness.store.events).toHaveLength(1);
    expect(harness.store.events[0]?.sequence).toBe(1);

    await client.query('COMMIT');
    client.release();
  });
});

describe('concurrent-write harness — connection.release releases held locks (FIFO-fair)', () => {
  it('two waiters queued behind a holder unblock in FIFO order as locks release', async () => {
    const harness = seededHarness();

    const a = await harness.pool.connect();
    await a.query('BEGIN');
    await a.query('SELECT id, ended_at FROM sessions WHERE id = $1 FOR UPDATE', [SESSION_ID]);

    // Queue B first.
    const b = await harness.pool.connect();
    await b.query('BEGIN');
    const order: string[] = [];
    const bPromise = b
      .query('SELECT id, ended_at FROM sessions WHERE id = $1 FOR UPDATE', [SESSION_ID])
      .then(() => order.push('B'));
    await harness.untilWaitingForLock();

    // Queue C second.
    const c = await harness.pool.connect();
    await c.query('BEGIN');
    const cPromise = c
      .query('SELECT id, ended_at FROM sessions WHERE id = $1 FOR UPDATE', [SESSION_ID])
      .then(() => order.push('C'));
    await harness.untilWaitingForLock();

    // A releases — B should unblock, then C.
    await a.query('COMMIT');
    a.release();
    await bPromise;
    expect(order).toEqual(['B']);
    await b.query('COMMIT');
    b.release();
    await cPromise;
    expect(order).toEqual(['B', 'C']);

    await c.query('COMMIT');
    c.release();
  });
});
