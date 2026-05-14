// Test-only `DbPool` harness with Postgres-shaped concurrent-write
// semantics: per-connection client isolation, FOR UPDATE row locking
// that blocks other connections on the same row until COMMIT/ROLLBACK,
// UNIQUE(session_id, sequence) enforced at INSERT time, and a one-shot
// gate API for deterministic interleaving in scenario tests.
//
// Refinement: tasks/refinements/backend-hardening/concurrent_write_test_harness.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.concurrency_safety.concurrent_write_test_harness
//
// **Why this exists.** The application invariant "under contention on a
// single session, one writer wins and the other surfaces a typed error"
// rests on three layers — `MAX(sequence)+1` inside a transaction, the
// `FOR UPDATE` row lock on `sessions`, and the
// `UNIQUE(session_id, sequence)` constraint on `session_events`. The
// existing memory-pool shims in `sessions/routes.test.ts` and the WS
// handler tests are sequential by construction (single `await` chain,
// no per-connection state, FOR UPDATE is a recognised-then-ignored
// noun); they cannot exercise the race surface. PGlite has full SQL
// semantics but serialises every transaction through a single internal
// mutex, so it likewise cannot produce two interleaved transactions
// against shared state.
//
// This harness fills the gap. It is a memory pool with:
//
//   - Per-connection client isolation. `pool.connect()` returns a
//     dedicated client; the client carries its own transaction state
//     (in-tx flag + the set of rows it has FOR UPDATE'd). Other
//     connections see the post-COMMIT view of the store.
//   - Per-row locks. A connection's `SELECT ... FOR UPDATE` on a
//     `sessions` row acquires an exclusive lock on that row until the
//     connection COMMITs or ROLLBACKs. A second connection's
//     `SELECT ... FOR UPDATE` on the same row awaits a deferred
//     Promise (the lock's "wait queue") and resolves when the first
//     connection releases.
//   - Real `UNIQUE(session_id, sequence)` enforcement. The
//     `INSERT INTO session_events` recogniser checks for a pre-existing
//     `(session_id, sequence)` row before appending; on collision it
//     throws a `UniqueViolationError` matching the shape `pg` surfaces
//     (an `Error` with `code === '23505'`).
//   - A one-shot gate API. `harness.gateOnInsert(sessionId)` installs a
//     gate that pauses the next `INSERT INTO session_events` for that
//     session on the next query attempt. The test calls
//     `harness.releaseGate()` to unblock; an `untilWaitingForLock()`
//     helper lets the test await the moment a connection is queued
//     behind a FOR UPDATE lock.
//
// **What this harness does NOT model.** Visibility predicates,
// participants, inclusion join-tables, full SQL syntax. It recognises
// exactly the queries the handlers-under-test issue. Adding a
// recogniser is a one-line `if (text.includes(...))` block at the
// matching location below — same shape as the existing memory pools.
//
// **No production code depends on this module.** The file lives under
// `test-support/` so the production tsconfig include path (`src/`) does
// catch it for typechecking, but no production export references it.
//
// **Determinism rule.** No `setTimeout`-based delays. Every "wait" is
// an `await` on a Promise the test owns the resolver for. The gate
// API's `gateOnInsert(...)` returns the resolver; `untilWaitingForLock`
// hands back a Promise that resolves when a connection has been
// enqueued on a lock's wait list. Tests interleave operations by
// calling these in a fixed sequence relative to their `Promise.all`
// awaits; the same source produces the same outcome every run.

import type { DbPool } from '../db.js';

// ---- Row shapes ------------------------------------------------------
//
// The harness models the subset of rows the production handlers
// concurrent-write tests exercise: sessions, session_participants,
// session_events, users. Each row type is the minimal column set the
// recognisers need.

export interface UserRow {
  readonly id: string;
  readonly screen_name: string;
  readonly deleted_at: Date | null;
}

export interface SessionRow {
  readonly id: string;
  readonly host_user_id: string;
  readonly privacy: 'public' | 'private';
  readonly topic: string;
  readonly created_at: Date;
  ended_at: Date | null;
}

export interface SessionParticipantRow {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly role: string;
  readonly joined_at: Date;
  left_at: Date | null;
}

export interface SessionEventRow {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: Record<string, unknown>;
  readonly created_at: Date;
}

/**
 * Inclusion-join row shape. The production schema splits inclusion
 * rows across three tables (`session_nodes`, `session_edges`,
 * `session_annotations`) with a per-kind entity-id column name
 * (`node_id` / `edge_id` / `annotation_id`); the harness store
 * normalises the entity-id field to `entity_id` for ergonomics and
 * keys the three kinds via separate arrays on the store. The shim's
 * RETURNING projection rebuilds the per-kind column name from the SQL
 * text when the inclusion INSERT is recognised.
 *
 * Used by the `canReference<Kind>` source-side reachability predicate
 * (`SELECT 1 AS reachable FROM session_<kind>s sj JOIN sessions ...`)
 * and by the entity-inclusion endpoint's join-table INSERT (`INSERT
 * INTO session_<kind>s (session_id, <entity>_id, included_by) VALUES
 * ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING ...`).
 */
export interface InclusionRow {
  readonly session_id: string;
  readonly entity_id: string;
  readonly included_by: string;
  readonly included_at: Date;
}

export interface HarnessStore {
  users: UserRow[];
  sessions: SessionRow[];
  participants: SessionParticipantRow[];
  events: SessionEventRow[];
  sessionNodes: InclusionRow[];
  sessionEdges: InclusionRow[];
  sessionAnnotations: InclusionRow[];
}

// ---- Errors ----------------------------------------------------------

/**
 * Mirrors the surface `pg` exposes for a unique-constraint violation:
 * the error carries `code = '23505'` so production catch blocks that
 * inspect `err.code` see the same shape they would against real
 * Postgres. The application code today does NOT inspect `code` — every
 * thrown pg error is mapped to a generic `internal-error` 500 by the
 * handler's outer catch — but the harness preserves the shape so a
 * future task that adds a typed `concurrent-write` envelope code can
 * test against the same harness.
 */
export class UniqueViolationError extends Error {
  public readonly code = '23505';
  public readonly constraintName: string;

  public constructor(message: string, constraintName: string) {
    super(message);
    this.name = 'UniqueViolationError';
    this.constraintName = constraintName;
  }
}

// ---- Deferred-promise helper ----------------------------------------
//
// Used by the lock manager and the gate API. Matches the standard
// "promise + external resolver" pattern used elsewhere in the codebase
// (see `apps/server/src/projection/cache.test.ts` for the same shape
// in a different test).

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  if (resolveFn === undefined || rejectFn === undefined) {
    throw new Error('defer: Promise constructor failed to capture resolvers');
  }
  return { promise, resolve: resolveFn, reject: rejectFn };
}

// ---- Lock manager ---------------------------------------------------
//
// A row lock is keyed by (table, rowId). The manager tracks the
// connection that currently holds the lock and a FIFO queue of
// waiters. Acquire is reentrant within the same connection (matching
// Postgres's exclusive-lock semantics — the same transaction can
// re-FOR-UPDATE the same row without blocking).

interface LockState {
  holder: string | undefined; // connection id that currently holds the lock
  waiters: Array<{ connectionId: string; deferred: Deferred<void> }>;
}

class RowLockManager {
  private readonly locks = new Map<string, LockState>();
  // Resolvers waiting for a connection to be enqueued on ANY lock —
  // the `untilWaitingForLock` API hands these out so tests can await
  // "the second connection is now blocked behind the first."
  private readonly waitingListeners: Array<Deferred<void>> = [];

  public async acquire(connectionId: string, key: string): Promise<void> {
    const state = this.locks.get(key);
    if (state === undefined) {
      this.locks.set(key, { holder: connectionId, waiters: [] });
      return;
    }
    if (state.holder === connectionId) {
      // Reentrant — already held by this connection. No-op.
      return;
    }
    if (state.holder === undefined) {
      state.holder = connectionId;
      return;
    }
    // Contention — queue and await.
    const d = defer<void>();
    state.waiters.push({ connectionId, deferred: d });
    // Notify any `untilWaitingForLock` waiters that someone is now
    // queued. Drain the listener list — each listener gets exactly
    // one notification per call.
    const listeners = this.waitingListeners.splice(0);
    for (const listener of listeners) {
      listener.resolve();
    }
    await d.promise;
  }

  /**
   * Release every lock held by this connection (called on
   * COMMIT/ROLLBACK). The next waiter on each released lock unblocks;
   * any subsequent waiters stay queued until the new holder releases.
   */
  public releaseAll(connectionId: string): void {
    for (const [key, state] of this.locks) {
      if (state.holder === connectionId) {
        const next = state.waiters.shift();
        if (next === undefined) {
          // No waiters — drop the lock entry entirely.
          this.locks.delete(key);
        } else {
          state.holder = next.connectionId;
          next.deferred.resolve();
        }
      }
    }
  }

  /**
   * Returns a promise that resolves the next time a connection is
   * enqueued on a lock's wait list. Test-only — lets scenarios await
   * "the second writer is now blocked" before releasing the gate that
   * holds the first writer.
   */
  public untilWaitingForLock(): Promise<void> {
    const d = defer<void>();
    this.waitingListeners.push(d);
    return d.promise;
  }
}

// ---- Gate manager ---------------------------------------------------
//
// A one-shot gate pauses the next query that matches a predicate. The
// gate's `released` Promise resolves when the test calls
// `releaseGate(gateId)`; the query's execution awaits that Promise
// before resuming.

interface ActiveGate {
  readonly id: number;
  readonly match: (text: string, params: ReadonlyArray<unknown>) => boolean;
  readonly hit: Deferred<void>; // resolves when the gate first matches a query
  readonly released: Deferred<void>; // resolves when the test releases the gate
  used: boolean; // one-shot — only the first match is gated
}

// ---- The pool -------------------------------------------------------

export interface ConcurrentWriteHarness {
  /** The pool — production-shape `DbPool` + `connect()`. */
  readonly pool: DbPool & {
    connect: () => Promise<{
      query: DbPool['query'];
      release: () => void;
    }>;
  };
  /** The underlying store; tests inspect this after the scenario runs. */
  readonly store: HarnessStore;
  /**
   * Install a one-shot gate that pauses the next
   * `INSERT INTO session_events` matching `sessionId` (or any session
   * when `sessionId === undefined`). The returned object exposes:
   *
   *   - `whenHit`: a promise that resolves when the next matching
   *     INSERT arrives at the pool. The gated query is awaiting
   *     `release()` at that point.
   *   - `release`: call to let the gated query proceed.
   *
   * Subsequent matching INSERTs after this gate are NOT gated — the
   * gate is one-shot. To gate every INSERT, install a fresh gate
   * after each release.
   */
  gateOnInsert(sessionId?: string): {
    whenHit: Promise<void>;
    release: () => void;
  };
  /**
   * Returns a promise that resolves when any connection is enqueued
   * on a row lock's wait list. Test-only — lets scenarios await
   * "the second writer is now blocked behind the first's FOR UPDATE."
   */
  untilWaitingForLock: () => Promise<void>;
}

export interface MakeConcurrentWritePoolOptions {
  readonly initial?: Partial<HarnessStore>;
  /**
   * Optional fixed sequence-id factory for INSERTed events. When the
   * production code calls INSERT with an event id (via `randomUUID()`
   * upstream), the harness honors the supplied id. This option lets
   * tests inject a deterministic factory if they care about the
   * event-row's `created_at` being deterministic. Default: a stable
   * 2026-05-11T10:00:00Z timestamp incremented by one millisecond per
   * INSERT.
   */
  readonly nowForCreatedAt?: () => Date;
}

export function makeConcurrentWritePool(
  options: MakeConcurrentWritePoolOptions = {},
): ConcurrentWriteHarness {
  const store: HarnessStore = {
    users: [...(options.initial?.users ?? [])],
    sessions: [...(options.initial?.sessions ?? [])],
    participants: [...(options.initial?.participants ?? [])],
    events: [...(options.initial?.events ?? [])],
    sessionNodes: [...(options.initial?.sessionNodes ?? [])],
    sessionEdges: [...(options.initial?.sessionEdges ?? [])],
    sessionAnnotations: [...(options.initial?.sessionAnnotations ?? [])],
  };

  const lockManager = new RowLockManager();
  const gates: ActiveGate[] = [];
  let nextGateId = 1;
  let nextConnectionId = 1;
  let nextParticipantId = 1;

  // Default `created_at` factory — monotonic to keep ordering stable in
  // assertions.
  let monotonicMs = Date.parse('2026-05-11T10:00:00.000Z');
  const createdAtFactory =
    options.nowForCreatedAt ??
    ((): Date => {
      monotonicMs += 1;
      return new Date(monotonicMs);
    });

  /**
   * Find the first gate that matches and is unused. The recogniser
   * marks the gate as used + resolves its `hit` deferred so the test
   * knows the gate has fired; the query then awaits `released`.
   */
  async function maybeHonorGate(text: string, params: ReadonlyArray<unknown>): Promise<void> {
    for (const gate of gates) {
      if (gate.used) continue;
      if (!gate.match(text, params)) continue;
      gate.used = true;
      gate.hit.resolve();
      await gate.released.promise;
      return;
    }
  }

  /**
   * Per-connection query executor. Each connection carries its own
   * `inTx` flag (set on BEGIN, cleared on COMMIT/ROLLBACK) so the
   * shim can apply row-lock release semantics at the right boundary.
   *
   * NOTE: we do NOT implement snapshot isolation — the store is shared
   * mutable state and a connection without the lock can read rows
   * another connection just wrote. This is intentional and matches the
   * READ COMMITTED default the production code runs under: a writer
   * sees committed values from other writers. For the FOR-UPDATE-
   * serialised handlers under test, this is the relevant model — the
   * lock is what protects the read-then-write pair, not snapshot
   * isolation.
   */
  function makeConnectionClient(connectionId: string): {
    query: DbPool['query'];
    release: () => void;
  } {
    let released = false;
    const ensureLive = (): void => {
      if (released) {
        throw new Error(`concurrent-write harness: query on released connection ${connectionId}`);
      }
    };

    const query: DbPool['query'] = async <TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> => {
      ensureLive();
      const p = (params ?? []) as unknown[];
      const trimmed = text.trim();

      // Honor any pending gate BEFORE actually running the query.
      // The gated query holds its lock (if any) while paused; this is
      // the intentional shape — the test wants to interleave a
      // SECOND transaction's FOR UPDATE attempt against a FIRST that
      // is paused mid-transaction.
      await maybeHonorGate(text, p);

      // ---- Transaction control ----------------------------------
      if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
        if (trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
          lockManager.releaseAll(connectionId);
        }
        return { rows: [] as TRow[] };
      }

      // ---- Auth middleware SELECT -------------------------------
      if (text.includes('SELECT id, screen_name') && text.includes('FROM users')) {
        const id = p[0] as string;
        const row = store.users.find((u) => u.id === id && u.deleted_at === null);
        if (row === undefined) {
          return { rows: [] as TRow[] };
        }
        return {
          rows: [{ id: row.id, screen_name: row.screen_name }] as unknown as TRow[],
        };
      }

      // ---- canSeeSession visibility predicate -------------------
      if (
        trimmed.startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'") &&
        text.includes('host_user_id = $2') &&
        text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return { rows: [] as TRow[] };
        }
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        const isParticipant = store.participants.some(
          (sp) => sp.session_id === sessionId && sp.user_id === userId && sp.left_at === null,
        );
        if (isPublic || isHost || isParticipant) {
          return { rows: [{ visible: 1 }] as unknown as TRow[] };
        }
        return { rows: [] as TRow[] };
      }

      // ---- FOR UPDATE on sessions row ---------------------------
      //
      // Two shapes:
      //   - WS handler shape: `SELECT id, ended_at FROM sessions
      //     WHERE id = $1 FOR UPDATE`
      //   - HTTP route shape: `SELECT id, host_user_id, ended_at
      //     FROM sessions WHERE id = $1 AND <visibility> FOR UPDATE`
      //     where `<visibility>` includes a `FROM session_participants
      //     sp` EXISTS subquery.
      //
      // Both share the discriminator "SELECT ... FROM sessions ...
      // FOR UPDATE" with the session id at `$1`. We anchor on the
      // outer `FROM sessions` clause (followed by whitespace and
      // either a WHERE / EOL — but never directly by `_` letters that
      // would make it `session_*`). The negative-lookahead
      // `(?!_|[A-Za-z])` keeps the subquery's
      // `FROM session_participants sp` from matching this rule.
      //
      // Both acquire the lock keyed on `sessions:<sessionId>`. When
      // another connection holds the lock, we await the lock's wait
      // queue before proceeding.
      if (/FROM\s+sessions(?![A-Za-z_])/.test(text) && text.includes('FOR UPDATE')) {
        const sessionId = p[0] as string;
        await lockManager.acquire(connectionId, `sessions:${sessionId}`);
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return { rows: [] as TRow[] };
        }
        // If the SQL has the visibility fragment, gate visibility too.
        if (text.includes("privacy = 'public'")) {
          const userId = p[1] as string;
          const isPublic = session.privacy === 'public';
          const isHost = session.host_user_id === userId;
          const isParticipant = store.participants.some(
            (sp) => sp.session_id === sessionId && sp.user_id === userId && sp.left_at === null,
          );
          if (!isPublic && !isHost && !isParticipant) {
            return { rows: [] as TRow[] };
          }
        }
        return {
          rows: [
            {
              id: session.id,
              host_user_id: session.host_user_id,
              ended_at: session.ended_at,
            },
          ] as unknown as TRow[],
        };
      }

      // ---- Non-FOR-UPDATE row-shape SELECT on sessions ----------
      //
      // The `PATCH /sessions/:id/privacy` handler issues a
      // visibility-gated row-shape SELECT (NOT FOR UPDATE — privacy
      // PATCH is a single-statement UPDATE, no need to lock the read
      // path). Distinguished from `canSeeSession` (which is
      // `SELECT 1 ...`) by selecting the row columns; distinguished
      // from the FOR UPDATE variant by the missing `FOR UPDATE`.
      if (
        /FROM\s+sessions(?![A-Za-z_])/.test(text) &&
        !text.includes('FOR UPDATE') &&
        text.includes('SELECT id, host_user_id, ended_at') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'")
      ) {
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return { rows: [] as TRow[] };
        }
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        const isParticipant = store.participants.some(
          (sp) => sp.session_id === sessionId && sp.user_id === userId && sp.left_at === null,
        );
        if (!isPublic && !isHost && !isParticipant) {
          return { rows: [] as TRow[] };
        }
        return {
          rows: [
            {
              id: session.id,
              host_user_id: session.host_user_id,
              ended_at: session.ended_at,
            },
          ] as unknown as TRow[],
        };
      }

      // ---- UPDATE sessions SET privacy = $1 ---------------------
      //
      // The `PATCH /sessions/:id/privacy` UPDATE. Single atomic
      // statement; mutate-in-place on the matching session row and
      // RETURNING the full row shape. We DO NOT acquire the
      // `sessions:<id>` lock here — production's UPDATE is a single
      // statement that doesn't bracket a read-then-write window; the
      // race this harness is built to expose (G-017) is precisely
      // the absence of a FOR UPDATE on the source-side reference
      // predicate.
      if (text.includes('UPDATE sessions') && text.includes('SET privacy = $1')) {
        const [desiredPrivacy, sessionId] = p as [string, string];
        const idx = store.sessions.findIndex((s) => s.id === sessionId);
        if (idx < 0) {
          return { rows: [] as TRow[] };
        }
        const original = store.sessions[idx] as SessionRow;
        const updated: SessionRow = {
          ...original,
          privacy: desiredPrivacy as 'public' | 'private',
        };
        store.sessions[idx] = updated;
        return {
          rows: [
            {
              id: updated.id,
              host_user_id: updated.host_user_id,
              privacy: updated.privacy,
              topic: updated.topic,
              created_at: updated.created_at,
              ended_at: updated.ended_at,
            },
          ] as unknown as TRow[],
        };
      }

      // ---- canReference<Kind> source-side reachability predicate
      //
      // The reference predicate (`canReferenceNode/Edge/Annotation`
      // in apps/server/src/sessions/references.ts). Production SQL:
      //   SELECT 1 AS reachable
      //     FROM session_<kind>s sj
      //     JOIN sessions ON sj.session_id = sessions.id
      //    WHERE sj.<entity>_id = $1
      //      AND <visibilityWhereFragment(2)>
      //    LIMIT 1
      // Mirrors the JS predicate from the existing memory-pool shim
      // in apps/server/src/sessions/routes.test.ts: returns one row
      // iff there exists a join row whose origin session is visible
      // to the caller per the public-or-host-or-participant rule.
      //
      // Note: this predicate is the load-bearing surface for the
      // G-017 TOCTOU pinning test. Reading `sessions.privacy` and
      // `session_participants` rows directly from the store — under
      // READ COMMITTED, a privacy-flip COMMIT that lands between the
      // SELECT and the COMMIT of the enclosing transaction is
      // visible here; that's exactly the race the test exercises.
      if (
        (text.includes('FROM session_nodes sj') ||
          text.includes('FROM session_edges sj') ||
          text.includes('FROM session_annotations sj')) &&
        text.includes('JOIN sessions ON sj.session_id = sessions.id')
      ) {
        const sourceArray = text.includes('FROM session_nodes sj')
          ? store.sessionNodes
          : text.includes('FROM session_edges sj')
            ? store.sessionEdges
            : store.sessionAnnotations;
        const targetEntityId = p[0] as string;
        const userId = p[1] as string;
        const reachable = sourceArray.some((r) => {
          if (r.entity_id !== targetEntityId) return false;
          const originSession = store.sessions.find((s) => s.id === r.session_id);
          if (originSession === undefined) return false;
          // visibilityWhereFragment: public OR host OR past-or-
          // current participant. The production fragment does NOT
          // filter `left_at`; once a participant always a participant
          // for visibility purposes (per `visibility.ts`'s
          // "past-or-current" rule). The harness mirrors that
          // exactly — no `left_at` filter here.
          return (
            originSession.privacy === 'public' ||
            originSession.host_user_id === userId ||
            store.participants.some(
              (sp) => sp.session_id === originSession.id && sp.user_id === userId,
            )
          );
        });
        return {
          rows: reachable ? ([{ reachable: 1 }] as unknown as TRow[]) : ([] as TRow[]),
        };
      }

      // ---- INSERT INTO session_<kind>s --------------------------
      //
      // The entity-inclusion endpoint's join-table INSERT. Production
      // SQL: `INSERT INTO session_<kind>s (session_id, <entity>_id,
      // included_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
      // RETURNING session_id, <entity>_id, included_by, included_at`.
      // The composite PK on (session_id, <entity>_id) collapses
      // concurrent-inclusion races to a deterministic "zero rows
      // returned" outcome via ON CONFLICT DO NOTHING; the shim
      // mirrors that.
      //
      // RETURNING reconstructs the per-kind column name (`node_id` /
      // `edge_id` / `annotation_id`) from the SQL text so the
      // handler's destructure works.
      if (
        text.includes('INSERT INTO session_nodes') ||
        text.includes('INSERT INTO session_edges') ||
        text.includes('INSERT INTO session_annotations')
      ) {
        const targetArray = text.includes('INSERT INTO session_nodes')
          ? store.sessionNodes
          : text.includes('INSERT INTO session_edges')
            ? store.sessionEdges
            : store.sessionAnnotations;
        const entityIdColumn = text.includes('INSERT INTO session_nodes')
          ? 'node_id'
          : text.includes('INSERT INTO session_edges')
            ? 'edge_id'
            : 'annotation_id';
        const [sessionId, entityId, includedBy] = p as [string, string, string];
        const existing = targetArray.find(
          (r) => r.session_id === sessionId && r.entity_id === entityId,
        );
        if (existing !== undefined) {
          // ON CONFLICT DO NOTHING — zero rows returned.
          return { rows: [] as TRow[] };
        }
        const row: InclusionRow = {
          session_id: sessionId,
          entity_id: entityId,
          included_by: includedBy,
          included_at: createdAtFactory(),
        };
        targetArray.push(row);
        const returnedRow = {
          session_id: row.session_id,
          [entityIdColumn]: row.entity_id,
          included_by: row.included_by,
          included_at: row.included_at,
        };
        return { rows: [returnedRow] as unknown as TRow[] };
      }

      // ---- MAX(sequence) on session_events ----------------------
      if (
        text.includes('FROM session_events') &&
        text.includes('MAX(sequence)') &&
        text.includes('WHERE session_id = $1')
      ) {
        const sessionId = p[0] as string;
        const seqs = store.events.filter((e) => e.session_id === sessionId).map((e) => e.sequence);
        const maxSeq = seqs.length === 0 ? 0 : Math.max(...seqs);
        return { rows: [{ max_seq: maxSeq }] as unknown as TRow[] };
      }

      // ---- session_events full log SELECT for projection load ---
      if (
        text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1') &&
        text.includes('ORDER BY sequence ASC')
      ) {
        const sessionId = p[0] as string;
        const rows = store.events
          .filter((e) => e.session_id === sessionId)
          .sort((a, b) => a.sequence - b.sequence);
        return { rows: rows as unknown as TRow[] };
      }

      // ---- UPDATE sessions SET ended_at = NOW() -----------------
      if (text.includes('UPDATE sessions') && text.includes('SET ended_at = NOW()')) {
        const sessionId = p[0] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return { rows: [] as TRow[] };
        }
        session.ended_at = new Date(monotonicMs + 1);
        monotonicMs += 1;
        return {
          rows: [
            {
              id: session.id,
              host_user_id: session.host_user_id,
              privacy: session.privacy,
              topic: session.topic,
              created_at: session.created_at,
              ended_at: session.ended_at,
            },
          ] as unknown as TRow[],
        };
      }

      // ---- users SELECT (participant-assign lookup) -------------
      if (
        text.includes('SELECT id, screen_name') &&
        text.includes('FROM users') &&
        text.includes('WHERE id = $1') &&
        text.includes('deleted_at IS NULL')
      ) {
        const id = p[0] as string;
        const row = store.users.find((u) => u.id === id && u.deleted_at === null);
        if (row === undefined) {
          return { rows: [] as TRow[] };
        }
        return {
          rows: [{ id: row.id, screen_name: row.screen_name }] as unknown as TRow[],
        };
      }

      // ---- session_participants role-availability check ---------
      if (
        text.includes('FROM session_participants') &&
        text.includes('WHERE session_id = $1') &&
        text.includes('role = $2') &&
        text.includes('left_at IS NULL')
      ) {
        const sessionId = p[0] as string;
        const role = p[1] as string;
        const matches = store.participants.filter(
          (sp) => sp.session_id === sessionId && sp.role === role && sp.left_at === null,
        );
        return {
          rows: matches.map((sp) => ({ id: sp.id })) as unknown as TRow[],
        };
      }

      // ---- session_participants user-availability check ---------
      if (
        text.includes('FROM session_participants') &&
        text.includes('WHERE session_id = $1') &&
        text.includes('user_id = $2') &&
        text.includes('left_at IS NULL')
      ) {
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const matches = store.participants.filter(
          (sp) => sp.session_id === sessionId && sp.user_id === userId && sp.left_at === null,
        );
        return { rows: matches.map((sp) => ({ id: sp.id })) as unknown as TRow[] };
      }

      // ---- INSERT INTO session_participants ---------------------
      if (text.includes('INSERT INTO session_participants')) {
        const id = synthesizeParticipantId();
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const role = text.includes('$3') ? (p[2] as string) : 'moderator';
        // Enforce the partial-unique-index invariant at INSERT time —
        // a concurrent writer that slipped past the pre-check would
        // hit this. We mirror the index name shape.
        const dupRole = store.participants.find(
          (sp) => sp.session_id === sessionId && sp.role === role && sp.left_at === null,
        );
        if (dupRole !== undefined) {
          throw new UniqueViolationError(
            `duplicate key value violates unique constraint "session_participants_active_role_idx"`,
            'session_participants_active_role_idx',
          );
        }
        const dupUser = store.participants.find(
          (sp) => sp.session_id === sessionId && sp.user_id === userId && sp.left_at === null,
        );
        if (dupUser !== undefined) {
          throw new UniqueViolationError(
            `duplicate key value violates unique constraint "session_participants_active_user_idx"`,
            'session_participants_active_user_idx',
          );
        }
        const row: SessionParticipantRow = {
          id,
          session_id: sessionId,
          user_id: userId,
          role,
          joined_at: createdAtFactory(),
          left_at: null,
        };
        store.participants.push(row);
        return { rows: [row] as unknown as TRow[] };
      }

      // ---- INSERT INTO session_events ---------------------------
      //
      // Enforces UNIQUE(session_id, sequence) at INSERT time — the
      // race-net the migration documents.
      if (text.includes('INSERT INTO session_events')) {
        const [eventId, sessionId, sequence, kind, actor, payloadJson] = p as [
          string,
          string,
          number,
          string,
          string | null,
          string,
        ];
        const dup = store.events.find((e) => e.session_id === sessionId && e.sequence === sequence);
        if (dup !== undefined) {
          throw new UniqueViolationError(
            `duplicate key value violates unique constraint "session_events_session_id_sequence_key"`,
            'session_events_session_id_sequence_key',
          );
        }
        const row: SessionEventRow = {
          id: eventId,
          session_id: sessionId,
          sequence,
          kind,
          actor,
          payload: JSON.parse(payloadJson) as Record<string, unknown>,
          created_at: createdAtFactory(),
        };
        store.events.push(row);
        return { rows: [] as TRow[] };
      }

      throw new Error(`concurrent-write harness: unexpected SQL: ${text}`);
    };

    return {
      query,
      release: (): void => {
        // Defensive — if a test forgets to COMMIT/ROLLBACK before
        // release, drop the connection's locks so other waiters
        // unblock. Production's `pg.Pool` does this on release too.
        lockManager.releaseAll(connectionId);
        released = true;
      },
    };
  }

  function synthesizeParticipantId(): string {
    const n = nextParticipantId++;
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-9000-${hex}`;
  }

  // The pool's `query` (no transaction) — used for callers that
  // bypass `withTransaction`. We still route through a synthetic
  // connection so the SQL recognisers can run.
  const standaloneClient = makeConnectionClient('pool-standalone');

  const pool: ConcurrentWriteHarness['pool'] = {
    query: standaloneClient.query,
    connect: async (): Promise<{ query: DbPool['query']; release: () => void }> => {
      const connectionId = `conn-${String(nextConnectionId++)}`;
      const client = makeConnectionClient(connectionId);
      return Promise.resolve(client);
    },
  };

  return {
    pool,
    store,
    gateOnInsert: (sessionId?: string): { whenHit: Promise<void>; release: () => void } => {
      const gate: ActiveGate = {
        id: nextGateId++,
        match: (text, params): boolean => {
          if (!text.includes('INSERT INTO session_events')) return false;
          if (sessionId === undefined) return true;
          const [, paramSessionId] = (params ?? []) as unknown[];
          return paramSessionId === sessionId;
        },
        hit: defer<void>(),
        released: defer<void>(),
        used: false,
      };
      gates.push(gate);
      return {
        whenHit: gate.hit.promise,
        release: (): void => {
          gate.released.resolve();
        },
      };
    },
    untilWaitingForLock: (): Promise<void> => lockManager.untilWaitingForLock(),
  };
}
