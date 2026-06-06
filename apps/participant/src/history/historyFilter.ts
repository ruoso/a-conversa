// Pure predicate + derivation helpers for the participant change-history
// pane's filter strip.
//
// Refinement: tasks/refinements/participant-ui/part_history_filtering.md
//   A deliberately reduced mirror of the moderator's shipped
//   `apps/moderator/src/graph/historyFilter.ts` (Decision §D3, duplicated
//   not extracted — this is consumer #2; extraction waits for a third).
//   Two dimensions only: the moderator's "target / selected-entity"
//   dimension is dropped (Decision §D4) — the participant `HistoryRow`
//   carries no `affected` set and the pane does not couple to graph
//   selection.
//
// `matchesHistoryFilter(row, filter)` is a pure function — no closure over
// time, no `Date.now()`, no `Math.random()`, no store access, no
// react-i18next dependency. The two filter dimensions are AND-composed
// (Constraint §2):
//
//   - **Kind** (Constraint §1): a non-empty `kinds` set passes iff
//     `row.kind ∈ kinds`. An empty set means "no narrowing on this
//     dimension" — every kind passes.
//   - **Actor** (Constraint §1): a non-empty `actors` set passes iff
//     `row.actor ∈ actors` (the `null`/System actor is a first-class
//     member). An empty set passes every actor.
//
// The empty default (`EMPTY_FILTER`) short-circuits to `true` so the
// predicate is the identity for callers that haven't installed a
// non-default filter (Constraint §3).

import { eventKinds, type EventKind } from '@a-conversa/shared-types';

import type { HistoryRow } from './deriveHistoryRows';

/**
 * The full filter shape — two dimensions, AND-composed. `kinds` / `actors`
 * are sets where empty means "no narrowing".
 */
export interface HistoryFilter {
  readonly kinds: ReadonlySet<EventKind>;
  readonly actors: ReadonlySet<string | null>;
}

/**
 * The `data-filter-actor` value (and the pure `deriveActorOptions` label)
 * for the `null`/System actor. The pane renders the localized
 * `participant.changeHistory.systemActor` text for the chip; this sentinel
 * keeps the pure helper free of any react-i18next dependency (Constraint
 * §10, Decision §D5).
 */
export const SYSTEM_ACTOR_SENTINEL = 'system';

/**
 * One actor chip option — the raw `actor` (the predicate's set member)
 * plus a display `label` (the 8-char id prefix, or the System sentinel for
 * the `null` actor). The participant chip labels exactly as the row's actor
 * column does (Decision §D5) — no screen-name resolution.
 */
export interface ActorOption {
  readonly actor: string | null;
  readonly label: string;
}

/**
 * The default filter — empty kind set, empty actor set. Identity-stable
 * frozen reference so a "Clear filters" reset restores it verbatim.
 */
export const EMPTY_FILTER: HistoryFilter = Object.freeze({
  kinds: new Set<EventKind>(),
  actors: new Set<string | null>(),
});

/**
 * Returns `true` iff the filter has no narrowing effect — empty kind set
 * AND empty actor set. The pane's post-merge `useMemo` consults this so the
 * default case can return the pre-filter `rows` reference directly
 * (identity-stable fast path, Constraint §3).
 */
export function isDefaultFilter(filter: HistoryFilter): boolean {
  return filter.kinds.size === 0 && filter.actors.size === 0;
}

/**
 * The AND-composed filter predicate. Pure — no closure over time, no
 * `Date.now()`, no `Math.random()`, no store access.
 *
 * @param row One merged-log row from `deriveHistoryRows(...)`.
 * @param filter The two filter dimensions.
 * @returns `true` iff the row passes every active dimension.
 */
export function matchesHistoryFilter(row: HistoryRow, filter: HistoryFilter): boolean {
  // Default-fast-path: the predicate is the identity for the default
  // filter (Constraint §3).
  if (isDefaultFilter(filter)) return true;

  // Dimension 1: kind. An empty set narrows nothing.
  if (filter.kinds.size > 0 && !filter.kinds.has(row.kind)) return false;

  // Dimension 2: actor (the `null` System actor is a first-class member).
  // An empty set narrows nothing.
  if (filter.actors.size > 0 && !filter.actors.has(row.actor)) return false;

  return true;
}

/**
 * The distinct `EventKind`s present in the merged log, in the canonical
 * `eventKinds` order (Constraint §1), with no duplicates. The kind chip
 * group renders one chip per returned kind, so a fresh session offers a few
 * chips rather than the full 17-value vocabulary.
 */
export function deriveAvailableKinds(rows: readonly HistoryRow[]): readonly EventKind[] {
  const present = new Set<EventKind>();
  for (const row of rows) present.add(row.kind);
  return eventKinds.filter((kind) => present.has(kind));
}

/**
 * The distinct actors present in the log, each with a display label
 * resolved exactly as the row's actor column resolves it (Decision §D5):
 * the 8-char id prefix, or the `SYSTEM_ACTOR_SENTINEL` for the `null`
 * actor. Order is first-appearance in the (newest-first) row list — stable.
 * Pure.
 */
export function deriveActorOptions(rows: readonly HistoryRow[]): readonly ActorOption[] {
  const seen = new Set<string | null>();
  const options: ActorOption[] = [];
  for (const row of rows) {
    const actor = row.actor;
    if (seen.has(actor)) continue;
    seen.add(actor);
    if (actor === null) {
      options.push({ actor: null, label: SYSTEM_ACTOR_SENTINEL });
    } else {
      options.push({ actor, label: actor.slice(0, 8) });
    }
  }
  return options;
}
