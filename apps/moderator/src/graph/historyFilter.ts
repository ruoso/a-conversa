// Pure predicate + derivation helpers for the moderator change-history
// pane's filter strip.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_filtering.md
//
// `matchesHistoryFilter(row, filter, selectedEntityId)` is a pure
// function — no closure over time, no `Date.now()`, no `Math.random()`,
// no store access, no react-i18next dependency. The three filter
// dimensions are AND-composed (Constraint §2):
//
//   - **Kind** (Decision §1): a non-empty `kinds` set passes iff
//     `row.kind ∈ kinds`. An empty set means "no narrowing on this
//     dimension" — every kind passes.
//   - **Actor** (Decision §2): a non-empty `actors` set passes iff
//     `row.actor ∈ actors` (the `null`/System actor is a first-class
//     member). An empty set passes every actor.
//   - **Target** (Decision §3): when `targetSelectedOnly` is `true` AND
//     a `selectedEntityId` is supplied, the row passes iff the selected
//     id is in the row's precomputed `affected` set
//     (`nodeIds ∪ edgeIds`). With `targetSelectedOnly: false` (or a
//     `null` `selectedEntityId`) every row passes.
//
// The empty default (`EMPTY_FILTER`) short-circuits to `true` so the
// predicate is the identity for callers that haven't installed a
// non-default filter (Constraint §1).

import type { ChangeHistoryRow } from './changeHistory';
import { eventKinds, type Event, type EventKind } from '@a-conversa/shared-types';

/**
 * The full filter shape — three dimensions, AND-composed. `kinds` /
 * `actors` are sets where empty means "no narrowing"; `targetSelectedOnly`
 * couples to the moderator's graph selection (threaded into the predicate
 * as `selectedEntityId`).
 */
export interface HistoryFilter {
  readonly kinds: ReadonlySet<EventKind>;
  readonly actors: ReadonlySet<string | null>;
  readonly targetSelectedOnly: boolean;
}

/**
 * The `data-filter-actor` value (and the pure `deriveActorOptions` label)
 * for the `null`/System actor. The pane renders the localized
 * `moderator.changeHistory.systemActor` text for the chip; this sentinel
 * keeps the pure helper free of any react-i18next dependency (Decision
 * §2, Constraint §1).
 */
export const SYSTEM_ACTOR_SENTINEL = 'system';

/**
 * One actor chip option — the raw `actor` (the predicate's set member)
 * plus a display `label` (screen name, 8-char id prefix, or the System
 * sentinel for the `null` actor).
 */
export interface ActorOption {
  readonly actor: string | null;
  readonly label: string;
}

/**
 * The default filter — empty kind set, empty actor set,
 * `targetSelectedOnly: false`. Identity-stable frozen reference so a
 * "Clear filters" reset restores it verbatim.
 */
export const EMPTY_FILTER: HistoryFilter = Object.freeze({
  kinds: new Set<EventKind>(),
  actors: new Set<string | null>(),
  targetSelectedOnly: false,
});

/**
 * Returns `true` iff the filter has no narrowing effect — empty kind set
 * AND empty actor set AND `targetSelectedOnly: false`. The pane's
 * post-merge `useMemo` consults this so the default case can return the
 * pre-filter `rows` reference directly (identity-stable fast path,
 * Constraint §9).
 */
export function isDefaultFilter(filter: HistoryFilter): boolean {
  return filter.kinds.size === 0 && filter.actors.size === 0 && !filter.targetSelectedOnly;
}

/**
 * The AND-composed filter predicate. Pure — no closure over time, no
 * `Date.now()`, no `Math.random()`, no store access.
 *
 * @param row One merged-log row from `mergeAndOrderEventLog(...)`.
 * @param filter The three filter dimensions.
 * @param selectedEntityId The moderator's currently-selected graph entity
 *   id (the pane reads `useSelectionStore` and threads it), or `null` when
 *   nothing is selected. The target dimension is inert when this is `null`.
 * @returns `true` iff the row passes every active dimension.
 */
export function matchesHistoryFilter(
  row: ChangeHistoryRow,
  filter: HistoryFilter,
  selectedEntityId: string | null,
): boolean {
  // Default-fast-path: the predicate is the identity for the default
  // filter (Constraint §1).
  if (isDefaultFilter(filter)) return true;

  // Dimension 1: kind. An empty set narrows nothing.
  if (filter.kinds.size > 0 && !filter.kinds.has(row.kind)) return false;

  // Dimension 2: actor (the `null` System actor is a first-class member).
  // An empty set narrows nothing.
  if (filter.actors.size > 0 && !filter.actors.has(row.actor)) return false;

  // Dimension 3: target. Inert unless the toggle is on AND a graph entity
  // is selected — then the row passes iff its precomputed `affected` set
  // includes the selected id (Decision §3). No cross-event walk: the
  // `affected` field was computed at merge time.
  if (filter.targetSelectedOnly && selectedEntityId !== null) {
    const { nodeIds, edgeIds } = row.affected;
    if (!nodeIds.includes(selectedEntityId) && !edgeIds.includes(selectedEntityId)) {
      return false;
    }
  }

  return true;
}

/**
 * The distinct `EventKind`s present in the merged log, in the canonical
 * `eventKinds` order (Constraint §3), with no duplicates. The kind chip
 * group renders one chip per returned kind, so a fresh session offers a
 * few chips rather than the full 17-value vocabulary.
 */
export function deriveAvailableKinds(rows: readonly ChangeHistoryRow[]): readonly EventKind[] {
  const present = new Set<EventKind>();
  for (const row of rows) present.add(row.kind);
  return eventKinds.filter((kind) => present.has(kind));
}

/**
 * The distinct actors present in the log, each with a display label
 * resolved from the log itself (Decision §2). A first pass over the
 * `participant-joined` events builds an `actor → screen_name` map; each
 * distinct actor is then labeled by name, falling back to its 8-char id
 * prefix (the same string the row's actor column renders, so chip and row
 * stay consistent) and to the `SYSTEM_ACTOR_SENTINEL` for the `null`
 * actor. Order is first-appearance in the event stream (stable). Pure.
 */
export function deriveActorOptions(events: readonly Event[]): readonly ActorOption[] {
  // First pass — build the `actor → screen_name` map from join events
  // anywhere in the stream (a join can appear after the actor's other
  // events in a merged REST + WS log).
  const screenNames = new Map<string, string>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      screenNames.set(event.payload.user_id, event.payload.screen_name);
    }
  }

  // Second pass — distinct actors in first-appearance order.
  const seen = new Set<string | null>();
  const options: ActorOption[] = [];
  for (const event of events) {
    const actor = event.actor;
    if (seen.has(actor)) continue;
    seen.add(actor);
    if (actor === null) {
      options.push({ actor: null, label: SYSTEM_ACTOR_SENTINEL });
    } else {
      options.push({ actor, label: screenNames.get(actor) ?? actor.slice(0, 8) });
    }
  }
  return options;
}
