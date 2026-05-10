// Tests for ProjectionCache — per-session in-memory cache lifecycle.
//
// Refinement: tasks/refinements/data-and-methodology/projection_caching.md
// TaskJuggler: data_and_methodology.projection.projection_caching
//
// Coverage:
//   - First getProjection hydrates; second uses cached entry.
//   - Concurrent first-call getProjection deduplicates loader.
//   - applyEvent after getProjection advances lastAppliedSequence
//     and does not re-hydrate.
//   - applyEvent on an un-cached session hydrates first.
//   - evict drops the entry; next getProjection re-hydrates.
//   - evictIdle drops idle entries and preserves fresh ones.
//   - size reflects entries.
//   - Slow loader: concurrent applyEvent waits for in-flight Promise.
//   - Throwing loader: inFlight clears; next call retries.
//   - Property-style: randomized op sequence keeps the cache
//     invariant ("every entry's projection is hydrated to a known
//     sequence; size equals entries that haven't been evicted").

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { ProjectionCache, type EventLoader } from './cache.js';
import { OutOfOrderEventError } from './replay.js';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

const HOST_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const T0 = '2026-05-10T12:00:00.000Z';
const T1 = '2026-05-10T12:00:01.000Z';
const T2 = '2026-05-10T12:00:02.000Z';

function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function makeEvent<K extends Event['kind']>(
  sessionId: string,
  sequence: number,
  kind: K,
  actor: string | null,
  createdAt: string,
  payload: Extract<Event, { kind: K }>['payload'],
): Extract<Event, { kind: K }> {
  return {
    id: evId(sequence),
    sessionId,
    sequence,
    kind,
    actor,
    payload,
    createdAt,
  } as Extract<Event, { kind: K }>;
}

function baseLog(sessionId: string): Event[] {
  return [
    makeEvent(sessionId, 1, 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 'cache test',
      created_at: T0,
    }),
    makeEvent(sessionId, 2, 'participant-joined', HOST_ID, T1, {
      user_id: HOST_ID,
      role: 'moderator',
      screen_name: 'Mod',
      joined_at: T1,
    }),
  ];
}

interface CountingLoader {
  loader: EventLoader;
  calls: () => number;
  resetCalls: () => void;
}

function makeCountingLoader(eventsFor: Record<string, Event[]>): CountingLoader {
  let calls = 0;
  return {
    loader: (sessionId): Promise<Event[]> => {
      calls += 1;
      const events = eventsFor[sessionId];
      if (events === undefined) {
        return Promise.reject(new Error(`no events configured for session ${sessionId}`));
      }
      return Promise.resolve(events);
    },
    calls: (): number => calls,
    resetCalls: (): void => {
      calls = 0;
    },
  };
}

describe('ProjectionCache — hydration and caching', () => {
  it('first getProjection hydrates via the loader; second returns cached without invoking it', async () => {
    const counting = makeCountingLoader({ [SESSION_A]: baseLog(SESSION_A) });
    const cache = new ProjectionCache({ loader: counting.loader });

    const first = await cache.getProjection(SESSION_A);
    const second = await cache.getProjection(SESSION_A);

    expect(counting.calls()).toBe(1);
    expect(first).toBe(second);
    expect(first.lastAppliedSequence).toBe(2);
  });

  it('size reflects active entries; getProjection on a new session adds one', async () => {
    const counting = makeCountingLoader({
      [SESSION_A]: baseLog(SESSION_A),
      [SESSION_B]: baseLog(SESSION_B),
    });
    const cache = new ProjectionCache({ loader: counting.loader });

    expect(cache.size).toBe(0);
    await cache.getProjection(SESSION_A);
    expect(cache.size).toBe(1);
    await cache.getProjection(SESSION_B);
    expect(cache.size).toBe(2);
  });
});

describe('ProjectionCache — concurrent first-load deduplication', () => {
  it('two concurrent getProjection calls invoke the loader exactly once', async () => {
    let resolveLoader: ((value: Event[]) => void) | undefined;
    let calls = 0;
    const loader: EventLoader = (_sessionId): Promise<Event[]> => {
      calls += 1;
      return new Promise<Event[]>((resolve) => {
        resolveLoader = resolve;
      });
    };
    const cache = new ProjectionCache({ loader });

    const p1 = cache.getProjection(SESSION_A);
    const p2 = cache.getProjection(SESSION_A);

    expect(calls).toBe(1);

    resolveLoader?.(baseLog(SESSION_A));
    const [proj1, proj2] = await Promise.all([p1, p2]);

    expect(proj1).toBe(proj2);
    expect(calls).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('a concurrent applyEvent waits for the in-flight hydration; loader runs once', async () => {
    let resolveLoader: ((value: Event[]) => void) | undefined;
    let calls = 0;
    const loader: EventLoader = (_sessionId): Promise<Event[]> => {
      calls += 1;
      return new Promise<Event[]>((resolve) => {
        resolveLoader = resolve;
      });
    };
    const cache = new ProjectionCache({ loader });

    const getPromise = cache.getProjection(SESSION_A);
    const applyPromise = cache.applyEvent(
      SESSION_A,
      makeEvent(SESSION_A, 3, 'participant-joined', DEBATER_A_ID, T2, {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'A',
        joined_at: T2,
      }),
    );

    expect(calls).toBe(1);

    resolveLoader?.(baseLog(SESSION_A));
    const [projection, changes] = await Promise.all([getPromise, applyPromise]);

    expect(calls).toBe(1);
    expect(projection.lastAppliedSequence).toBe(3);
    expect(changes).toEqual([
      { kind: 'participant-joined', userId: DEBATER_A_ID, role: 'debater-A' },
    ]);
  });
});

describe('ProjectionCache — applyEvent', () => {
  it('applyEvent after getProjection advances lastAppliedSequence and does not re-hydrate', async () => {
    const counting = makeCountingLoader({ [SESSION_A]: baseLog(SESSION_A) });
    const cache = new ProjectionCache({ loader: counting.loader });

    await cache.getProjection(SESSION_A);
    counting.resetCalls();

    const changes = await cache.applyEvent(
      SESSION_A,
      makeEvent(SESSION_A, 3, 'participant-joined', DEBATER_A_ID, T2, {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'A',
        joined_at: T2,
      }),
    );

    expect(counting.calls()).toBe(0);
    expect(changes).toEqual([
      { kind: 'participant-joined', userId: DEBATER_A_ID, role: 'debater-A' },
    ]);
    const proj = await cache.getProjection(SESSION_A);
    expect(proj.lastAppliedSequence).toBe(3);
  });

  it('applyEvent on an un-cached session hydrates first then applies', async () => {
    const counting = makeCountingLoader({ [SESSION_A]: baseLog(SESSION_A) });
    const cache = new ProjectionCache({ loader: counting.loader });

    const changes = await cache.applyEvent(
      SESSION_A,
      makeEvent(SESSION_A, 3, 'participant-joined', DEBATER_B_ID, T2, {
        user_id: DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'B',
        joined_at: T2,
      }),
    );

    expect(counting.calls()).toBe(1);
    expect(changes).toEqual([
      { kind: 'participant-joined', userId: DEBATER_B_ID, role: 'debater-B' },
    ]);
    const proj = await cache.getProjection(SESSION_A);
    expect(proj.lastAppliedSequence).toBe(3);
  });

  it('an out-of-order applyEvent propagates OutOfOrderEventError; cache state survives', async () => {
    const counting = makeCountingLoader({ [SESSION_A]: baseLog(SESSION_A) });
    const cache = new ProjectionCache({ loader: counting.loader });

    await cache.getProjection(SESSION_A);

    await expect(
      cache.applyEvent(
        SESSION_A,
        makeEvent(SESSION_A, 7, 'participant-joined', DEBATER_A_ID, T2, {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: T2,
        }),
      ),
    ).rejects.toBeInstanceOf(OutOfOrderEventError);

    const proj = await cache.getProjection(SESSION_A);
    expect(proj.lastAppliedSequence).toBe(2);
    expect(cache.size).toBe(1);
  });
});

describe('ProjectionCache — eviction', () => {
  it('evict drops the entry; subsequent getProjection re-hydrates', async () => {
    const counting = makeCountingLoader({ [SESSION_A]: baseLog(SESSION_A) });
    const cache = new ProjectionCache({ loader: counting.loader });

    await cache.getProjection(SESSION_A);
    expect(counting.calls()).toBe(1);

    cache.evict(SESSION_A);
    expect(cache.size).toBe(0);

    await cache.getProjection(SESSION_A);
    expect(counting.calls()).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('evict on an absent session is a no-op', () => {
    const cache = new ProjectionCache({
      loader: (): Promise<Event[]> => Promise.resolve([]),
    });
    cache.evict(SESSION_A);
    expect(cache.size).toBe(0);
  });

  it('evictIdle drops entries past the idle window; fresh ones survive', async () => {
    const counting = makeCountingLoader({
      [SESSION_A]: baseLog(SESSION_A),
      [SESSION_B]: baseLog(SESSION_B),
    });
    const cache = new ProjectionCache({ loader: counting.loader, idleTimeoutMs: 1000 });

    // Hydrate A and B. Their `lastAccessedAt` is `now` at hydration
    // time. We then issue `evictIdle` at a `now` far in the future
    // to drop both, and verify the boundary case with a fresh
    // re-hydration + a near-`now` call.
    await cache.getProjection(SESSION_A);
    await cache.getProjection(SESSION_B);

    expect(cache.size).toBe(2);

    cache.evictIdle(new Date(Date.now() + 60_000));
    expect(cache.size).toBe(0);

    // Re-hydrate A, then issue `evictIdle` at a `now` that's less
    // than `idleTimeoutMs` past the access -> survives.
    await cache.getProjection(SESSION_A);
    cache.evictIdle(new Date(Date.now() + 100));
    expect(cache.size).toBe(1);
  });

  it('evictIdle does not drop entries whose lastAccessedAt was just refreshed by getProjection', async () => {
    const counting = makeCountingLoader({ [SESSION_A]: baseLog(SESSION_A) });
    const cache = new ProjectionCache({ loader: counting.loader, idleTimeoutMs: 10 });

    await cache.getProjection(SESSION_A);
    // Wait past the idle window, then re-access -> lastAccessedAt
    // refreshes -> evictIdle at the same instant should not drop.
    await new Promise<void>((r) => setTimeout(r, 30));
    await cache.getProjection(SESSION_A);
    cache.evictIdle(new Date());
    expect(cache.size).toBe(1);
  });
});

describe('ProjectionCache — loader failure', () => {
  it('a throwing loader rejects the in-flight Promise and clears it; the next call retries', async () => {
    let shouldFail = true;
    let calls = 0;
    const loader: EventLoader = (sessionId): Promise<Event[]> => {
      calls += 1;
      if (shouldFail) {
        return Promise.reject(new Error(`loader boom on ${sessionId}`));
      }
      return Promise.resolve(baseLog(sessionId));
    };
    const cache = new ProjectionCache({ loader });

    await expect(cache.getProjection(SESSION_A)).rejects.toThrow(/loader boom/);
    expect(cache.size).toBe(0);

    shouldFail = false;
    const proj = await cache.getProjection(SESSION_A);
    expect(proj.lastAppliedSequence).toBe(2);
    expect(calls).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('two concurrent calls during a throwing hydration both reject; next call retries cleanly', async () => {
    let calls = 0;
    let shouldFail = true;
    const loader: EventLoader = async (sessionId): Promise<Event[]> => {
      calls += 1;
      // Yield once so both concurrent callers attach to the in-flight Promise.
      await Promise.resolve();
      if (shouldFail) throw new Error('loader boom');
      return baseLog(sessionId);
    };
    const cache = new ProjectionCache({ loader });

    const p1 = cache.getProjection(SESSION_A);
    const p2 = cache.getProjection(SESSION_A);
    await expect(p1).rejects.toThrow(/loader boom/);
    await expect(p2).rejects.toThrow(/loader boom/);
    expect(calls).toBe(1);
    expect(cache.size).toBe(0);

    shouldFail = false;
    const proj = await cache.getProjection(SESSION_A);
    expect(proj.lastAppliedSequence).toBe(2);
    expect(calls).toBe(2);
  });
});

describe('ProjectionCache — randomized property invariant', () => {
  it('random sequence of get/apply/evict/evictIdle keeps the cache invariant', async () => {
    // Invariant: every entry in the cache has been hydrated; for
    // each entry, the projection's lastAppliedSequence equals the
    // total events the cache has applied for that session (initial
    // hydration count + applyEvent count). `size` equals the number
    // of session ids currently cached.
    //
    // Determinism: a seeded LCG so the test is reproducible.
    let seed = 0xc0ffee;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const sessions = [SESSION_A, SESSION_B];
    const baseLen: Record<string, number> = {
      [SESSION_A]: baseLog(SESSION_A).length,
      [SESSION_B]: baseLog(SESSION_B).length,
    };

    // Total events applied per session — initialized from baseLog
    // length on first hydration; advances by 1 per applyEvent.
    const totalApplied: Record<string, number> = {};
    // Per-session next sequence to append. Tracks both initial log
    // sequence and any applies — appends pick up where applies left
    // off so we never reuse a sequence.
    const nextSequence: Record<string, number> = {
      [SESSION_A]: baseLog(SESSION_A).length + 1,
      [SESSION_B]: baseLog(SESSION_B).length + 1,
    };
    // After eviction, the loader must replay every event already
    // applied to that session — so we accumulate a per-session
    // "current event log" (base + appended) and reload from it.
    const currentLog: Record<string, Event[]> = {
      [SESSION_A]: baseLog(SESSION_A),
      [SESSION_B]: baseLog(SESSION_B),
    };

    const loader: EventLoader = (sessionId): Promise<Event[]> => {
      const log = currentLog[sessionId];
      if (log === undefined) {
        return Promise.reject(new Error(`no log for ${sessionId}`));
      }
      return Promise.resolve(log.slice());
    };

    const cache = new ProjectionCache({ loader, idleTimeoutMs: 1000 });

    // The invariant checked per step: after every operation, the
    // cache's `size` is at most `sessions.length` (can never carry
    // more entries than there are sessions). After a `getProjection`
    // or `applyEvent`, the projection's `lastAppliedSequence` equals
    // `totalApplied[sessionId]` — i.e. the cache stays consistent
    // with the per-session apply count regardless of intervening
    // evictions (re-hydration replays the same log).

    for (let step = 0; step < 200; step += 1) {
      const sessionId = sessions[Math.floor(rand() * sessions.length)]!;
      const op = rand();

      if (op < 0.4) {
        const proj = await cache.getProjection(sessionId);
        if (totalApplied[sessionId] === undefined) {
          totalApplied[sessionId] = baseLen[sessionId]!;
        }
        expect(proj.lastAppliedSequence).toBe(totalApplied[sessionId]);
      } else if (op < 0.75) {
        // applyEvent — also hydrates if absent. Critically the
        // "DB" log gets the event appended AFTER cache.applyEvent
        // succeeds: if we appended before, an un-cached call would
        // hydrate to include this event AND then re-apply it,
        // surfacing an out-of-order replay. The real methodology
        // engine has the same ordering — it asks the cache for the
        // hydrated projection, INSERTs the event, then calls
        // applyEvent on the cache. (Strictly the DB INSERT lands
        // first per ADR 0020; the cache hydrates from a frozen
        // SELECT at hydration time, so the post-INSERT cache update
        // is the missing-event apply.)
        const seq = nextSequence[sessionId]!;
        nextSequence[sessionId] = seq + 1;
        const ev = makeEvent(sessionId, seq, 'participant-joined', DEBATER_A_ID, T2, {
          user_id: `${sessionId}-${seq}`,
          role: 'debater-A',
          screen_name: `p${seq}`,
          joined_at: T2,
        });
        await cache.applyEvent(sessionId, ev);
        currentLog[sessionId] = [...currentLog[sessionId]!, ev];
        if (totalApplied[sessionId] === undefined) {
          totalApplied[sessionId] = baseLen[sessionId]! + 1;
        } else {
          totalApplied[sessionId] += 1;
        }
        const proj = await cache.getProjection(sessionId);
        expect(proj.lastAppliedSequence).toBe(totalApplied[sessionId]);
      } else if (op < 0.9) {
        cache.evict(sessionId);
        // totalApplied stays — the next getProjection re-hydrates
        // from the DB and reaches the same sequence (because the
        // loader replays every event applied so far).
      } else {
        cache.evictIdle(new Date(Date.now() + 60_000));
      }

      expect(cache.size).toBeLessThanOrEqual(sessions.length);
    }

    // Final sweep: re-fetch every session and assert the projected
    // sequence matches what we tracked. A `getProjection` after a
    // bulk eviction re-hydrates from the loader's replay log.
    for (const sessionId of sessions) {
      if (totalApplied[sessionId] === undefined) continue;
      const proj = await cache.getProjection(sessionId);
      expect(proj.lastAppliedSequence).toBe(totalApplied[sessionId]);
    }
  });
});
