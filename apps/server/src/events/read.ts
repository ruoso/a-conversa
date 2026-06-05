// Read-side counterpart to `append.ts`. Where `appendSessionEvent`
// writes a single event inside a transaction, `readSessionEventsPage`
// reads a forward, sequence-ordered, cursor-paginated slice of a
// session's event log.
//
// Refinement: tasks/refinements/backend/get_session_log.md
// TaskJuggler: backend.replay_endpoints.get_session_log
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//
// The SQL mirrors the slice query already proven in the WS catch-up
// handler (`apps/server/src/ws/handlers/catch-up.ts`):
// `WHERE session_id = $1 AND sequence > $2 ORDER BY sequence ASC
// LIMIT $3`, with a `limit + 1` look-ahead so `nextCursor` is exact
// (no spurious trailing empty page when the total is an exact multiple
// of `limit`). Rows map to the wire-ready `Event` envelope via the same
// row→Event shape catch-up uses; per ADR 0021 the rows are trusted on
// read (validated on write) and are NOT re-parsed in the hot path.

import type { Event } from '@a-conversa/shared-types';

import type { SnapshotRecord } from '../projection/types.js';

/**
 * Minimal executor surface the read helper needs — the same structural
 * `query<TRow>(text, params?)` shape `DbPool` exposes. Production passes
 * a real `pg.Pool`; tests pass a pglite adapter or a memory shim.
 * Mirrors `append.ts`'s `SessionEventAppendClient` so the read and
 * write helpers share an executor-injection style.
 */
export interface SessionEventReadExecutor {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
}

/**
 * Snake-case row shape returned from `session_events`. `sequence` may
 * surface as a string (pglite's BIGINT) or a number (pg's parser);
 * `created_at` as a `Date` or an ISO string depending on the driver —
 * `rowToEvent` normalizes both.
 */
interface SessionEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number | string;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: Record<string, unknown>;
  readonly created_at: Date | string;
}

/**
 * Map a `session_events` row to the wire-ready camelCase `Event`
 * envelope. Lifted from the catch-up handler's `rowToEvent`
 * (`apps/server/src/ws/handlers/catch-up.ts`) so the HTTP log-read
 * surface returns byte-identical shapes to the WS catch-up path. The
 * `as Event` cast trusts the on-write validation (ADR 0021).
 */
function rowToEvent(row: SessionEventRow): Event {
  const seq = typeof row.sequence === 'string' ? Number.parseInt(row.sequence, 10) : row.sequence;
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: seq,
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  } as Event;
}

/** Parameters for a single page read. */
export interface ReadSessionEventsPageParams {
  /** Owning session id. */
  readonly sessionId: string;
  /**
   * Exclusive lower bound on `sequence`. `0` starts at the head of the
   * log (the first real event is `sequence = 1`).
   */
  readonly afterSequence: number;
  /** Page size. The look-ahead fetches `limit + 1` rows internally. */
  readonly limit: number;
}

/** One page of the event log plus the cursor for the next fetch. */
export interface SessionEventsPage {
  /** Events in ascending `sequence` order (replay order). */
  readonly events: Event[];
  /**
   * The `sequence` to pass as `?after=` to fetch the next page, or
   * `null` when this page reaches the head of the log. A client pages
   * until `nextCursor === null`.
   */
  readonly nextCursor: number | null;
}

/**
 * Read a forward, sequence-ordered, cursor-paginated slice of a
 * session's event log.
 *
 * Fetches `limit + 1` rows: if the extra (look-ahead) row is present,
 * it is dropped and `nextCursor` is set to the last *returned* event's
 * `sequence`; otherwise `nextCursor` is `null`. An empty slice (a
 * brand-new session, or a cursor past the head) returns
 * `{ events: [], nextCursor: null }`.
 *
 * The caller is responsible for the visibility gate — this helper does
 * not check who may see the session.
 */
export async function readSessionEventsPage(
  executor: SessionEventReadExecutor,
  params: ReadSessionEventsPageParams,
): Promise<SessionEventsPage> {
  const { sessionId, afterSequence, limit } = params;

  // `limit + 1` look-ahead: the extra row, if present, is the exact
  // has-more signal. It is trimmed before mapping, costing one event of
  // overhead in exchange for a precise `nextCursor` at the
  // exact-multiple-of-limit boundary.
  const lookAhead = limit + 1;
  const result = await executor.query<SessionEventRow>(
    `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1 AND sequence > $2
     ORDER BY sequence ASC
     LIMIT $3`,
    [sessionId, afterSequence, lookAhead],
  );

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const events = pageRows.map(rowToEvent);
  const nextCursor = hasMore && events.length > 0 ? events[events.length - 1]!.sequence : null;
  return { events, nextCursor };
}

/** Parameters for a full-log read. */
export interface ReadSessionEventLogParams {
  /** Owning session id. */
  readonly sessionId: string;
}

/**
 * Read a session's entire event log in ascending `sequence` order
 * (replay order), unpaginated.
 *
 * Where `readSessionEventsPage` serves the cursor-paginated HTTP log
 * surface, this helper backs the replay endpoints that must hand the
 * *whole* log to the replay primitive in one pass: `projectAtPosition`
 * validates the requested position against the true head sequence
 * (`replayHeadSequence(events)`), which needs every event, not just the
 * prefix up to the position — reading a truncated slice would make an
 * out-of-range position indistinguishable from the head. A single
 * ascending `SELECT` (no `limit + 1` look-ahead, no cursor) is simpler
 * than looping the paginated helper and is independently unit-testable.
 *
 * Rows map to the wire-ready camelCase `Event` envelope via the same
 * `rowToEvent` mapping the paginated helper uses; an empty log returns
 * `[]`. Per ADR 0021 the rows are trusted on read (validated on write).
 *
 * The caller is responsible for the visibility gate — this helper does
 * not check who may see the session.
 */
export async function readSessionEventLog(
  executor: SessionEventReadExecutor,
  params: ReadSessionEventLogParams,
): Promise<Event[]> {
  const { sessionId } = params;
  const result = await executor.query<SessionEventRow>(
    `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
    [sessionId],
  );
  return result.rows.map(rowToEvent);
}

/**
 * Snake-case row shape for a snapshot-marker read. A snapshot is a
 * regular `session_events` row with `kind = 'snapshot-created'`; its
 * `payload` self-describes the marker (`snapshot_id`, `label`,
 * `log_position`). `created_at` surfaces as a `Date` (pg) or an ISO
 * string (pglite) — normalized to ISO-8601 below, mirroring `rowToEvent`.
 */
interface SnapshotEventRow extends Record<string, unknown> {
  readonly payload: {
    readonly snapshot_id: string;
    readonly label: string;
    readonly log_position: number;
  };
  readonly created_at: Date | string;
}

/** Parameters for a snapshot-marker list read. */
export interface ReadSessionSnapshotsParams {
  /** Owning session id. */
  readonly sessionId: string;
}

/**
 * List a session's snapshot markers — the moderator-created labeled
 * checkpoints — as `SnapshotRecord[]`, ordered by `sequence` ASC (chapter
 * order; `log_position === sequence` by construction in `createSnapshot`,
 * so this is identical to `logPosition` order).
 *
 * A snapshot is a regular `session_events` row with
 * `kind = 'snapshot-created'` (no separate table), so this is a filtered
 * read of those events mapped to the camelCase record. The `payload` JSON
 * was validated against `snapshotCreatedPayloadSchema` on write (ADR
 * 0021) and is trusted on read — no per-row Zod re-parse. The
 * `(session_id, kind)` index keeps the read bounded by snapshot count,
 * not log length.
 *
 * The caller is responsible for the visibility gate — this helper does
 * not check who may see the session.
 */
export async function readSessionSnapshots(
  executor: SessionEventReadExecutor,
  params: ReadSessionSnapshotsParams,
): Promise<SnapshotRecord[]> {
  const { sessionId } = params;
  const result = await executor.query<SnapshotEventRow>(
    `SELECT payload, created_at
     FROM session_events
     WHERE session_id = $1 AND kind = 'snapshot-created'
     ORDER BY sequence ASC`,
    [sessionId],
  );
  return result.rows.map((row) => {
    const createdAt =
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    return {
      snapshotId: row.payload.snapshot_id,
      label: row.payload.label,
      logPosition: row.payload.log_position,
      createdAt,
    };
  });
}
