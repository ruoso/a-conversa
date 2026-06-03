// Pure merge/order helper for the moderator right-sidebar's change-
// history pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
//
// The change-history pane's full-log source is the REST replay endpoint
// (`GET /api/sessions/:id/events`, ascending by `sequence`) overlaid
// with the live WS `events` array (per Decision §D1 — the WS log alone
// is not guaranteed complete because catch-up may take the
// `snapshot-state` fallback path). `mergeAndOrderEventLog` unions the
// two sources, dedups on `sequence`, and returns the rows newest-first
// (`sequence` descending) so the pane renders the most-recent event at
// the top.
//
// **Pure / idempotent** (Decision §D2/§D3, Constraints §3): no closure
// over time, no `Date.now()`, no `Math.random()`. The relative-time
// formatting is a render-time concern owned by the pane component; the
// helper emits each event's ISO-8601 `createdAt` verbatim so the
// formatter sees the canonical wire value.
//
// **Dedup-by-`sequence`** (Decision §D3): both the REST and WS envelopes
// share the per-session monotonic `sequence`, which is also the sort
// key — one pass does both dedup and order. The live overlay wins on a
// sequence collision (it is the freshest copy of the same envelope), so
// `live` is unioned after `prefetched`.

import type { Event, EventKind } from '@a-conversa/shared-types';

/**
 * One row in the change-history pane. Decision §D4 — the minimal v1 row
 * carries only the fields the three columns render (kind label, actor,
 * relative timestamp) plus the stable identity attributes the sibling
 * tasks (`mod_history_event_summary`, `mod_history_click_to_flash`,
 * `mod_history_filtering`) extend rather than reshape.
 */
export interface ChangeHistoryRow {
  /** The event envelope id — the row's stable React key + `data-event-id`. */
  readonly id: string;
  /**
   * Per-session monotonic `event.sequence`. Sort key (newest first =
   * descending) AND dedup key. Tie-free — the server-side sequence is
   * the canonical replay order key.
   */
  readonly sequence: number;
  /** Outer envelope kind — drives the localized kind-label column. */
  readonly kind: EventKind;
  /**
   * The causing `event.actor` UUID. Nullable per the envelope schema (a
   * system-emitted event carries `null`); the row component falls back
   * to a localized "System" label in that case.
   */
  readonly actor: string | null;
  /**
   * ISO-8601 `event.createdAt`. The pane formats it via
   * `formatRelativeTime` at render time; the helper emits the raw wire
   * value so the formatter sees the canonical timestamp.
   */
  readonly createdAt: string;
}

/**
 * Merge the prefetched REST page set with the live WS event log into a
 * sequence-descending, dedup-by-sequence row list.
 *
 * @param prefetched The full-log REST prefetch (ascending by sequence).
 * @param live       The live WS `events` array (arrival order).
 * @returns The unioned events, deduped on `sequence`, newest-first
 *          (index 0 = highest sequence).
 *
 * Pure: same inputs → same output. No clock / RNG.
 */
export function mergeAndOrderEventLog(
  prefetched: readonly Event[],
  live: readonly Event[],
): readonly ChangeHistoryRow[] {
  // Dedup on `sequence`. `live` is unioned after `prefetched` so a live
  // copy of the same envelope wins the collision (it is the freshest).
  const bySequence = new Map<number, Event>();
  for (const event of prefetched) bySequence.set(event.sequence, event);
  for (const event of live) bySequence.set(event.sequence, event);

  const rows: ChangeHistoryRow[] = [];
  for (const event of bySequence.values()) {
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
