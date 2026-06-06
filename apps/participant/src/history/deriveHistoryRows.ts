// Pure selector for the participant change-history view.
//
// Refinement: tasks/refinements/participant-ui/part_history_list.md
//   (Constraint §8 — duplicated into the participant rather than extracted
//    to the shell; the moderator's `mergeAndOrderEventLog` is consumer #1,
//    this is consumer #2. Extraction waits for a third consumer.)
//
// Merges the REST prefetch (`useSessionEventLog`, ascending by `sequence`)
// with the live WS `events` overlay, dedups by event `id` (the live copy
// wins a collision — it is the freshest envelope), and returns the rows
// newest-first (descending `sequence`).
//
// Pure / idempotent (Acceptance §3): no closure over time, no `Date.now()`,
// no `Math.random()`. Each event's ISO-8601 `createdAt` passes through
// verbatim; the relative-time formatting is a render-time concern owned by
// the pane component.

import type { Event, EventKind } from '@a-conversa/shared-types';

/**
 * The minimal participant history row (Constraint §3 / Decision §D3): the
 * event's kind, acting participant, and timestamp source. No per-kind
 * payload summary and no affected-entity set — those are moderator-only
 * enrichments with no participant WBS leaf.
 */
export interface HistoryRow {
  readonly id: string;
  readonly sequence: number;
  readonly kind: EventKind;
  readonly actor: string | null;
  readonly createdAt: string;
}

/** Stable empty reference so an empty derivation never churns the memo. */
export const EMPTY_HISTORY_ROWS: readonly HistoryRow[] = Object.freeze([]);

export function deriveHistoryRows(
  prefetched: readonly Event[],
  live: readonly Event[],
): readonly HistoryRow[] {
  // Map keyed by event `id`; prefetched is unioned first, then live
  // overwrites on collision so the freshest copy of an envelope wins.
  const byId = new Map<string, Event>();
  for (const event of prefetched) byId.set(event.id, event);
  for (const event of live) byId.set(event.id, event);

  if (byId.size === 0) return EMPTY_HISTORY_ROWS;

  const rows: HistoryRow[] = [];
  for (const event of byId.values()) {
    rows.push({
      id: event.id,
      sequence: event.sequence,
      kind: event.kind,
      actor: event.actor,
      createdAt: event.createdAt,
    });
  }

  // Newest-first by sequence descending. Sequence is unique per session,
  // so the sort is a total order; no secondary tie-breaker needed.
  rows.sort((a, b) => b.sequence - a.sequence);
  return rows;
}
