// Vitest unit tests for `apps/server/src/sessions/visibility.ts` — the
// canonical "can this user see this session?" rule.
//
// Refinement: tasks/refinements/backend/privacy_field_enforcement.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.privacy_field_enforcement
//
// **What this layer covers** (pure, in-memory executor; the integration
// layer's Cucumber+pglite scenarios exercise the same predicates
// against the real migrated schema):
//
//   1. `visibilityWhereFragment(N)` — the returned SQL fragment carries
//      the expected `$N` placeholders at the host-match AND the
//      EXISTS-participant slot. Both references resolve to the SAME
//      slot (the caller binds one param at that slot; the rule reads
//      it twice).
//   2. `visibilityWhereFragment` rejects non-positive / non-integer
//      slot indexes — this is a contract bug surface; failing loud is
//      the right diagnostic.
//   3. `canSeeSession`:
//      - public session, non-participant caller → true.
//      - private session, non-participant caller → false.
//      - private session, host caller → true.
//      - private session, current participant (`left_at IS NULL`) → true.
//      - private session, historical participant (`left_at IS NOT NULL`)
//        → true. (Once you've seen a session you've seen it; the
//        cross-session-reference and audit/replay framing depends on
//        this property; see refinement for the decision.)
//      - unknown session id → false.
//
// **Why a memory executor.** The function under test is a thin SQL
// builder + a `SELECT 1` predicate. The semantic claim is "the
// predicate's TRUE-set matches the architecture's visibility rule." A
// memory-backed executor that mirrors the SQL the function emits is
// the cheapest possible regression-net at the unit layer; the
// pglite-backed Cucumber scenarios in `tests/behavior/backend/
// session-visibility.feature` exercise the same predicates against the
// real Postgres dialect to pin the SQL portability claim.

import { describe, expect, it } from 'vitest';

import {
  canReplaySessionAnonymously,
  canSeeSession,
  canSeeSessionAnonymously,
  visibilityWhereFragment,
} from './visibility.js';
import type { VisibilityExecutor } from './visibility.js';

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: 'public' | 'private';
}

interface ParticipantRow {
  session_id: string;
  user_id: string;
  left_at: string | null;
}

interface MemoryDb {
  sessions: SessionRow[];
  participants: ParticipantRow[];
}

/**
 * In-memory executor that mirrors the SELECT the `canSeeSession`
 * helper issues. Recognises the exact SQL shape the helper emits
 * (`SELECT 1 AS visible FROM sessions WHERE id = $1 AND <fragment>
 * LIMIT 1`); rejects anything else so a refactor that changes the SQL
 * surface surfaces here as a clear error rather than silent mismatch.
 */
function makeMemoryExecutor(db: MemoryDb): VisibilityExecutor {
  return {
    query: <TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> => {
      const trimmed = text.trim();
      if (
        trimmed.startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'") &&
        text.includes('host_user_id = $2') &&
        text.includes('session_participants')
      ) {
        const p = (params ?? []) as unknown[];
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const session = db.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        const isParticipant = db.participants.some(
          (sp) => sp.session_id === sessionId && sp.user_id === userId,
        );
        if (isPublic || isHost || isParticipant) {
          return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in visibility memory executor: ${text}`));
    },
  };
}

// Stable UUID-shaped ids for deterministic assertions. The visibility
// fragment doesn't parse these; they're opaque strings throughout.
const ALICE = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CARL = '33333333-3333-4333-8333-333333333333';
const PUBLIC_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIVATE_SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNKNOWN_SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('visibilityWhereFragment', () => {
  it('returns the expected SQL fragment with $1 at both slots', () => {
    const fragment = visibilityWhereFragment(1);
    // Both the host-match and the EXISTS-participant reference $1 —
    // the caller binds one param at that slot, the rule reads it
    // twice.
    expect(fragment).toContain("privacy = 'public'");
    expect(fragment).toContain('host_user_id = $1');
    expect(fragment).toContain('EXISTS (');
    expect(fragment).toContain('FROM session_participants sp');
    expect(fragment).toContain('sp.session_id = sessions.id');
    expect(fragment).toContain('sp.user_id = $1');
    // Two occurrences of `$1` — once at host, once at participant.
    const matches = fragment.match(/\$1/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(2);
  });

  it('places $2 at both slots when the caller picks slot 2 (per-id endpoints)', () => {
    const fragment = visibilityWhereFragment(2);
    expect(fragment).toContain('host_user_id = $2');
    expect(fragment).toContain('sp.user_id = $2');
    const matches = fragment.match(/\$2/g);
    expect(matches?.length).toBe(2);
    // No `$1` inside the visibility fragment — the per-id endpoints
    // reserve $1 for the session id (which lives in the surrounding
    // `WHERE id = $1 AND <fragment>` clause).
    expect(fragment).not.toContain('$1');
  });

  it('throws on a zero or negative slot index', () => {
    expect(() => visibilityWhereFragment(0)).toThrow();
    expect(() => visibilityWhereFragment(-1)).toThrow();
  });

  it('throws on a non-integer slot index', () => {
    expect(() => visibilityWhereFragment(1.5)).toThrow();
    expect(() => visibilityWhereFragment(Number.NaN)).toThrow();
  });
});

describe('canSeeSession', () => {
  it('returns true for a public session, even when caller is neither host nor participant', async () => {
    const db: MemoryDb = {
      sessions: [{ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' }],
      participants: [],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, PUBLIC_SESSION, BEN);
    expect(visible).toBe(true);
  });

  it('returns false for a private session when caller is neither host nor participant', async () => {
    const db: MemoryDb = {
      sessions: [{ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' }],
      participants: [],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, PRIVATE_SESSION, BEN);
    expect(visible).toBe(false);
  });

  it('returns true for a private session when caller is the host', async () => {
    const db: MemoryDb = {
      sessions: [{ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' }],
      participants: [],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, PRIVATE_SESSION, ALICE);
    expect(visible).toBe(true);
  });

  it('returns true for a private session when caller is an active participant (left_at IS NULL)', async () => {
    const db: MemoryDb = {
      sessions: [{ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' }],
      participants: [{ session_id: PRIVATE_SESSION, user_id: BEN, left_at: null }],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, PRIVATE_SESSION, BEN);
    expect(visible).toBe(true);
  });

  it('returns true for a private session when caller is a historical participant (left_at IS NOT NULL)', async () => {
    // The architecture's framing: "once you have been a participant
    // you've seen the session, and hiding it post-leave would surprise
    // users and complicate replay/audit flows." Encoded by NOT
    // filtering on `left_at IS NULL` inside the visibility fragment;
    // this test pins the property.
    const db: MemoryDb = {
      sessions: [{ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' }],
      participants: [
        { session_id: PRIVATE_SESSION, user_id: BEN, left_at: '2026-05-09T10:00:00.000Z' },
      ],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, PRIVATE_SESSION, BEN);
    expect(visible).toBe(true);
  });

  it('returns false for a private session when caller is a participant in a DIFFERENT session', async () => {
    // Negative-control test — ensures the EXISTS subquery's
    // `sp.session_id = sessions.id` join condition is in place. A
    // participant row keyed to a DIFFERENT session must not unlock
    // the gate for the session under question.
    const db: MemoryDb = {
      sessions: [{ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' }],
      participants: [{ session_id: PUBLIC_SESSION, user_id: BEN, left_at: null }],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, PRIVATE_SESSION, BEN);
    expect(visible).toBe(false);
  });

  it('returns false when the session id is not in the table at all', async () => {
    const db: MemoryDb = {
      sessions: [{ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' }],
      participants: [],
    };
    const executor = makeMemoryExecutor(db);
    const visible = await canSeeSession(executor, UNKNOWN_SESSION, CARL);
    expect(visible).toBe(false);
  });

  it('issues exactly one parameterized SELECT against the executor (canSeeSession)', async () => {
    // The predicate is a single round-trip — no N+1, no fan-out. Pin
    // the contract so a future refactor that adds a second query
    // (e.g. a separate participant scan) surfaces here.
    const calls: Array<{ text: string; params?: ReadonlyArray<unknown> }> = [];
    const tracingExecutor: VisibilityExecutor = {
      query: <TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> => {
        calls.push({ text, ...(params !== undefined ? { params } : {}) });
        return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
      },
    };
    await canSeeSession(tracingExecutor, PRIVATE_SESSION, ALICE);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual([PRIVATE_SESSION, ALICE]);
    expect(calls[0]?.text).toContain('SELECT 1');
    expect(calls[0]?.text).toContain('FROM sessions');
    expect(calls[0]?.text).toContain('WHERE id = $1');
    expect(calls[0]?.text).toContain('LIMIT 1');
  });
});

// ---------------------------------------------------------------------
// Anonymous predicates — the live (`canSeeSessionAnonymously`) and the
// replay (`canReplaySessionAnonymously`) gates. The ONLY semantic
// difference is the `ended_at IS NULL` clause: the live gate excludes
// ended sessions, the replay gate is ended-agnostic (ADR 0029 / 0045).
// ---------------------------------------------------------------------

interface AnonSessionRow {
  id: string;
  privacy: 'public' | 'private';
  ended_at: string | null;
}

/**
 * In-memory executor that mirrors BOTH anonymous predicates' SQL so the
 * contrast on the ended case is testable through one fixture. Both
 * emit `SELECT 1 AS visible FROM sessions WHERE id = $1 AND privacy =
 * 'public' [AND ended_at IS NULL] LIMIT 1`; the live gate carries the
 * `ended_at IS NULL` clause, the replay gate does not. The executor
 * keys off `text.includes('ended_at')` to apply (or skip) that filter.
 */
function makeAnonExecutor(rows: AnonSessionRow[]): VisibilityExecutor {
  const sessions = new Map(rows.map((r) => [r.id, r]));
  return {
    query: <TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> => {
      const trimmed = text.trim();
      if (
        trimmed.startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'")
      ) {
        const p = (params ?? []) as unknown[];
        const sessionId = p[0] as string;
        const session = sessions.get(sessionId);
        if (session === undefined || session.privacy !== 'public') {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const gatesEnded = text.includes('ended_at IS NULL');
        if (gatesEnded && session.ended_at !== null) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
      }
      return Promise.reject(new Error(`unexpected SQL in anon visibility executor: ${text}`));
    },
  };
}

const PUBLIC_ENDED_SESSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('canReplaySessionAnonymously', () => {
  it('returns true for a public, live (not-ended) session', async () => {
    const executor = makeAnonExecutor([{ id: PUBLIC_SESSION, privacy: 'public', ended_at: null }]);
    expect(await canReplaySessionAnonymously(executor, PUBLIC_SESSION)).toBe(true);
  });

  it('returns true for a public, ENDED session (replay is historical — ended-agnostic)', async () => {
    const executor = makeAnonExecutor([
      { id: PUBLIC_ENDED_SESSION, privacy: 'public', ended_at: '2026-05-09T11:00:00.000Z' },
    ]);
    expect(await canReplaySessionAnonymously(executor, PUBLIC_ENDED_SESSION)).toBe(true);
  });

  it('returns false for a private session', async () => {
    const executor = makeAnonExecutor([
      { id: PRIVATE_SESSION, privacy: 'private', ended_at: null },
    ]);
    expect(await canReplaySessionAnonymously(executor, PRIVATE_SESSION)).toBe(false);
  });

  it('returns false for an unknown session id (existence-non-leak)', async () => {
    const executor = makeAnonExecutor([{ id: PUBLIC_SESSION, privacy: 'public', ended_at: null }]);
    expect(await canReplaySessionAnonymously(executor, UNKNOWN_SESSION)).toBe(false);
  });

  it('differs from canSeeSessionAnonymously on the ENDED case (the load-bearing contrast)', async () => {
    // Same public-but-ended session: the live gate hides it
    // (`ended_at IS NULL` excludes it), the replay gate admits it.
    const executor = makeAnonExecutor([
      { id: PUBLIC_ENDED_SESSION, privacy: 'public', ended_at: '2026-05-09T11:00:00.000Z' },
    ]);
    expect(await canSeeSessionAnonymously(executor, PUBLIC_ENDED_SESSION)).toBe(false);
    expect(await canReplaySessionAnonymously(executor, PUBLIC_ENDED_SESSION)).toBe(true);
  });

  it('issues exactly one parameterized SELECT with no ended_at clause', async () => {
    const calls: Array<{ text: string; params?: ReadonlyArray<unknown> }> = [];
    const tracingExecutor: VisibilityExecutor = {
      query: <TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> => {
        calls.push({ text, ...(params !== undefined ? { params } : {}) });
        return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
      },
    };
    await canReplaySessionAnonymously(tracingExecutor, PUBLIC_SESSION);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual([PUBLIC_SESSION]);
    expect(calls[0]?.text).toContain("privacy = 'public'");
    // The ended-agnostic delta — the replay predicate must NOT carry the
    // live gate's `ended_at IS NULL` clause.
    expect(calls[0]?.text).not.toContain('ended_at');
  });
});
