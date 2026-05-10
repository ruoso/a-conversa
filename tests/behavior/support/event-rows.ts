// Shared `session_events` row helpers for projection behavior tests.
//
// Refinement: tasks/refinements/data-and-methodology/project_incrementally.md
//
// Used by:
//   - tests/behavior/steps/projection-from-log.steps.ts (inline copy
//     kept its own to avoid a cross-file edit during that task; the
//     shared helper here is the single source of truth going forward).
//   - tests/behavior/steps/projection-incremental.steps.ts.
//
// The DB-row -> Event-envelope mapping is the same in both: column
// names are snake_case in SQL, camelCase in the envelope; `sequence`
// is BIGINT (returned as `string` from pglite) and is coerced to JS
// `number`; `created_at` is TIMESTAMPTZ (returned as `Date`) and is
// normalized to an ISO-8601 string. See ADR 0021 for the envelope
// contract; the helper here is the bridge between the SQL row shape
// and the envelope shape, plus an `insertEventRow` writer for tests
// that compose richer event logs.

import type { AConversaWorld, QueryResult } from './world.js';
import { validateEvent, type Event } from '../../../packages/shared-types/src/events.js';

export interface SessionEventRow {
  id: string;
  session_id: string;
  // BIGINT — pglite returns as `string`; we coerce.
  sequence: string | number;
  kind: string;
  actor: string | null;
  // JSONB — pglite parses to a JS value.
  payload: unknown;
  // TIMESTAMPTZ — pglite returns as a JS Date.
  created_at: Date | string;
}

export interface EnvelopeShape {
  id: string;
  sessionId: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: unknown;
  createdAt: string;
}

export function rowToEnvelopeShape(row: SessionEventRow): EnvelopeShape {
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    // JS `number` is safe up to 2^53 — the documented per-session
    // sequence ceiling.
    sequence: Number(row.sequence),
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  };
}

export function rowToValidatedEvent(row: SessionEventRow): Event {
  return validateEvent(rowToEnvelopeShape(row));
}

export async function selectEvents(
  world: AConversaWorld,
  sessionId: string,
): Promise<SessionEventRow[]> {
  const res = (await world.db.query(
    `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
    [sessionId],
  )) as QueryResult<SessionEventRow>;
  return res.rows;
}

export async function insertEventRow(
  world: AConversaWorld,
  sessionId: string,
  args: {
    id: string;
    sequence: number;
    kind: string;
    actor: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  },
): Promise<void> {
  await world.db.query(
    `INSERT INTO session_events
       (id, session_id, sequence, kind, actor, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      args.id,
      sessionId,
      args.sequence,
      args.kind,
      args.actor,
      JSON.stringify(args.payload),
      args.createdAt,
    ],
  );
}

export function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}
