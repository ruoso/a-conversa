// `<ChangeHistoryPane>` — the right-sidebar pane that renders the
// session's full event log newest-first, the moderator's audit /
// orientation surface ("what just happened, and in what order").
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
// Design doc: docs/moderator-ui.md (right-sidebar panes)
//
// Mounts into `<RightSidebar>`'s `changeHistorySlot` (per
// `mod_right_sidebar`). This is the *foundation* leaf of the change-
// history pane subtree — it renders a deliberately minimal row
// (kind label + 8-char actor + relative timestamp), and owns the data-
// fetch, merge/order, scroll, and empty/loading/error states. The three
// sibling tasks extend the row contract this task establishes:
//
//   - `mod_history_event_summary` enriches each row with a per-kind
//     payload summary.
//   - `mod_history_click_to_flash` makes a row click flash the affected
//     graph entities.
//   - `mod_history_filtering` adds kind / actor / target filters.
//
// **Full-log source: REST prefetch + WS overlay** (Decision §D1). The
// pane prefetches the complete log via `useSessionEventLogPrefetch`
// (paginating `GET /api/sessions/:id/events`) and overlays the live WS
// `events` array on top via `mergeAndOrderEventLog` — the WS log alone
// is not guaranteed complete because catch-up may take the
// `snapshot-state` fallback path.
//
// Surface:
//
//   - Container: `<div data-testid="change-history-pane">` with a
//     localized `aria-label`. Scrollable inside the slot via
//     `overflow-y-auto` + `max-h-full` so a long log scrolls inside the
//     right-sidebar's height-bounded body; the outer layout never
//     scrolls (Constraints §6). No virtualization in v1 (Decision §D5).
//   - Loading: `<p data-testid="change-history-pane-loading">` while the
//     REST prefetch is in flight.
//   - Error: `<div data-testid="change-history-pane-error">` plus a
//     `change-history-pane-retry` button that re-runs the prefetch, on a
//     REST failure.
//   - Empty: `<p data-testid="change-history-pane-empty">` once the
//     prefetch is ready and the merged log is empty.
//   - List: `<ol role="list">` with one
//     `<li data-testid="change-history-row" data-event-id data-event-kind
//     data-sequence>` per event (newest-first). Each row's three columns
//     carry `change-history-row-kind` / `-actor` / `-timestamp`.

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';
import type { EventKind } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { useFlashStore, useSelectionStore, useUiStore } from '../stores';
import { mergeAndOrderEventLog, type ChangeHistoryRow } from '../graph/changeHistory';
import type { EventSummary } from '../graph/eventSummary';
import {
  deriveActorOptions,
  deriveAvailableKinds,
  EMPTY_FILTER,
  isDefaultFilter,
  matchesHistoryFilter,
  SYSTEM_ACTOR_SENTINEL,
  type HistoryFilter,
} from '../graph/historyFilter';
import { useSessionEventLogPrefetch } from './useSessionEventLogPrefetch';

/**
 * Props for the pane. The `sessionId` is threaded through from the
 * mounting site (`<Operate>`) so the pane prefetches the right log and
 * subscribes to the matching per-session slice of `useWsStore`.
 */
export interface ChangeHistoryPaneProps {
  /** The session whose event log drives the pane's contents. */
  readonly sessionId: string;
  /**
   * Optional reference time for relative-time formatting. Lets callers
   * (notably the component test) inject a deterministic "now" so the
   * relative-time string is stable across test runs. Defaults to
   * `Date.now()` at render time. Mirrors `PendingProposalsPane`.
   */
  readonly nowMs?: number;
}

// The pane body owns its own bounded scroll region (Constraints §6):
// `overflow-y-auto` + `max-h-full` so a long log scrolls inside the
// right-sidebar's height-bounded body rather than growing the outer
// layout. `overflow-x` stays the default `visible` (the minimal row has
// no wide button cluster, unlike `PendingProposalsPane`).
const PANE_CONTAINER_CLASSES = 'flex max-h-full flex-col gap-1 overflow-y-auto text-slate-700';
const LIST_CLASSES = 'm-0 flex list-none flex-col gap-1 p-0';
// The row's interactive surface is a real `<button>` (Decision §D5) filling
// the `<li>`: keyboard Enter/Space + screen-reader semantics + the
// `focus-visible:` ring come free, and the `<li>` keeps its stable
// `data-event-id` / `-kind` / `-sequence` contract untouched. The flex /
// border / background that used to live on the `<li>` move here; `w-full`
// + `text-left` make the button span the row and align like the old `<li>`,
// `cursor-pointer` + the hover tint signal it's actionable.
const ROW_BUTTON_CLASSES =
  'flex w-full cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';
const KIND_CHIP_CLASSES =
  'flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700';
// The summary is the row's primary, growing column (`mod_history_event_summary`):
// it `flex-1`-grows and `truncate`s on one line (Constraints §6), so the actor
// drops to `flex-shrink-0` and the timestamp pins right via `ml-auto` (keeping
// the timestamp right-aligned even on `{ type: 'none' }` rows that emit no
// summary element).
const SUMMARY_CLASSES = 'min-w-0 flex-1 truncate text-xs text-slate-700';
const ACTOR_CLASSES = 'flex-shrink-0 truncate text-xs text-slate-500';
const TIMESTAMP_CLASSES = 'ml-auto flex-shrink-0 text-xs text-slate-500';
const EMPTY_STATE_CLASSES = 'italic text-slate-500';
const LOADING_STATE_CLASSES = 'italic text-slate-500';
const ERROR_CONTAINER_CLASSES = 'flex flex-col gap-1';
const ERROR_TEXT_CLASSES = 'text-sm text-red-700';
const RETRY_BUTTON_CLASSES =
  'self-start rounded border border-slate-400 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400';

// The filter strip (`mod_history_filtering`). Pinned at the top of the
// scrollable body via `sticky top-0` + an opaque background so it stays
// reachable even when the post-filter list scrolls or empties out
// (Constraint §7). `flex-wrap` lets the kind / actor chip groups + the
// target toggle + the clear button reflow inside the narrow sidebar.
const FILTER_STRIP_CLASSES =
  'sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white pb-1';
const FILTER_GROUP_CLASSES = 'flex flex-wrap items-center gap-1';
// Chip vocabulary mirrors the row's kind chip (`slate-100` / `slate-700`):
// the pressed state inverts to the `slate-700` tone (Constraint §12).
const FILTER_CHIP_BASE_CLASSES =
  'flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';
const FILTER_CHIP_ACTIVE_CLASSES = 'bg-slate-700 text-white hover:bg-slate-800';
const FILTER_CHIP_INACTIVE_CLASSES = 'bg-slate-100 text-slate-700 hover:bg-slate-200';
const FILTER_CHIP_DISABLED_CLASSES = 'cursor-not-allowed bg-slate-100 text-slate-400';
const FILTER_CLEAR_CLASSES =
  'flex-shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';

/** Compose the chip className for a toggle chip given its pressed state. */
function chipClasses(pressed: boolean): string {
  return `${FILTER_CHIP_BASE_CLASSES} ${pressed ? FILTER_CHIP_ACTIVE_CLASSES : FILTER_CHIP_INACTIVE_CLASSES}`;
}

/**
 * Format the actor column — 8-char UUID prefix in v1, or the localized
 * "System" label when `actor === null` (a system-emitted event; the
 * envelope shape allows it — Constraints §4). Mirrors
 * `PendingProposalsPane`'s `authorText`.
 */
function actorText(actor: string | null, systemLabel: string): string {
  if (actor === null) return systemLabel;
  return actor.slice(0, 8);
}

/**
 * Compute the relative-time string for the row's timestamp column via
 * the shared `formatRelativeTime` formatter (Decision §D7).
 * `formatRelativeTime`'s sign convention is past = negative, so we pass
 * `secondsAgo` as a negative number and let the formatter pick the unit
 * / wording via `numeric: 'auto'`. Mirrors `PendingProposalsPane`'s
 * `relativeTimeFor`.
 */
function relativeTimeFor(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  // Defensive — an invalid ISO string parses to NaN; the formatter would
  // throw. Surface a stable fallback rather than crash the pane.
  if (Number.isNaN(createdMs)) return createdAt;
  const secondsAgo = Math.round((nowMs - createdMs) / 1000);
  return formatRelativeTime(-secondsAgo, 'second');
}

/**
 * Resolve a summary descriptor (`mod_history_event_summary`, Decision
 * §D1) into the row's display text, or `null` when there is none to
 * render (Decision §D5 — empty-payload kinds emit NO summary element).
 * `text` passes through verbatim (user-authored, never translated);
 * `i18n` resolves the structural words via `t(key, values)`.
 */
function summaryDisplayText(
  summary: EventSummary,
  t: (key: string, values?: Record<string, string>) => string,
): string | null {
  switch (summary.type) {
    case 'text':
      return summary.text;
    case 'i18n':
      return t(summary.key, summary.values);
    case 'none':
      return null;
  }
}

/**
 * Activate a row: re-frame the canvas on the row's affected entities AND
 * flash them (`mod_history_click_to_flash`, Constraint §10, Decision §D1).
 * Two channels, one gesture — both read the row's precomputed `affected`
 * (no store read for the data, no click-time log walk; Decision §D2). A
 * row whose `affected` is empty (session/participant/mode/snapshot kinds)
 * dispatches empty sets — a harmless no-op, no special casing.
 */
function activateRow(affected: ChangeHistoryRow['affected']): void {
  const { nodeIds, edgeIds } = affected;
  useUiStore.getState().requestCanvasFocus({ nodeIds, edgeIds });
  useFlashStore.getState().flash([...nodeIds, ...edgeIds]);
}

/**
 * One row in the list. Co-located inside this file (small enough not to
 * warrant its own file in v1). Sibling tasks extend this row contract;
 * the `data-testid` + `data-event-id` / `data-event-kind` /
 * `data-sequence` attributes are the stable seam (Constraints §5) and
 * stay on the `<li>`. The row's columns are wrapped in a `<button>` (the
 * accessible activation affordance — Constraint §9 / Decision §D5).
 */
function ChangeHistoryRowItem(props: {
  readonly row: ChangeHistoryRow;
  readonly nowMs: number;
  readonly systemActorLabel: string;
  readonly t: (key: string, values?: Record<string, string>) => string;
}): ReactElement {
  const { row, nowMs, systemActorLabel, t } = props;
  const kindLabel = t(`moderator.changeHistory.kind.${row.kind}`);
  const summary = summaryDisplayText(row.summary, t);
  const actor = actorText(row.actor, systemActorLabel);
  const ago = relativeTimeFor(row.createdAt, nowMs);
  // Accessible name for the activation button. Composed from the row's
  // existing localized columns (kind label + payload summary) — no new
  // i18n catalog key (the flash affordance is non-textual; the
  // refinement scopes no catalog work). Activation semantics ("this
  // jumps to the entity on the graph") are carried by the `<button>`
  // role itself.
  const buttonLabel = summary !== null ? `${kindLabel}: ${summary}` : kindLabel;
  return (
    <li
      data-testid="change-history-row"
      data-event-id={row.id}
      data-event-kind={row.kind}
      data-sequence={row.sequence}
    >
      <button
        type="button"
        data-testid="change-history-row-activate"
        aria-label={buttonLabel}
        className={ROW_BUTTON_CLASSES}
        onClick={() => {
          activateRow(row.affected);
        }}
      >
        <span data-testid="change-history-row-kind" className={KIND_CHIP_CLASSES}>
          {kindLabel}
        </span>
        {summary !== null && (
          <span data-testid="change-history-row-summary" className={SUMMARY_CLASSES}>
            {summary}
          </span>
        )}
        <span data-testid="change-history-row-actor" className={ACTOR_CLASSES}>
          {actor}
        </span>
        <span data-testid="change-history-row-timestamp" className={TIMESTAMP_CLASSES}>
          {ago}
        </span>
      </button>
    </li>
  );
}

export function ChangeHistoryPane(props: ChangeHistoryPaneProps): ReactElement {
  const { sessionId, nowMs } = props;
  const { t } = useTranslation();

  // Narrow adapter over react-i18next's `TFunction` — the row component
  // (and `summaryDisplayText`) want a plain `(key, values?) => string`
  // for the summary's `t(key, values)` resolution; `TFunction`'s
  // overload set is not directly assignable to that simpler signature.
  const translate = useCallback(
    (key: string, values?: Record<string, string>) => t(key, values ?? {}),
    [t],
  );

  // Full-log source: prefetch the complete REST log, then overlay the
  // live WS events (Decision §D1). The prefetch owns the loading / error
  // lifecycle; the WS selector keeps the merged list live as new events
  // arrive (the store creates a new `events` array reference on each
  // `applyEvent` write, so the reference-equality check re-renders the
  // pane the moment a new event lands).
  const { status, events: prefetched, retry } = useSessionEventLogPrefetch(sessionId);
  const liveEvents = useWsStore((state) => state.sessionState[sessionId]?.events);

  // `useMemo` keyed on both sources so the merged row list stays
  // referentially stable across renders when neither has changed.
  const rows = useMemo(
    () => mergeAndOrderEventLog(prefetched, liveEvents ?? []),
    [prefetched, liveEvents],
  );

  // Filter state — local component state (Decision §5): one `HistoryFilter`
  // cell, no Zustand slice, resets on pane mount by design. The target
  // dimension's *input* (the graph selection) lives in `useSelectionStore`,
  // which the pane subscribes to read-only.
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_FILTER);
  const selectedEntityId = useSelectionStore((state) => state.selected?.id ?? null);

  const toggleKind = useCallback((kind: EventKind) => {
    setFilter((prev) => {
      const kinds = new Set(prev.kinds);
      if (kinds.has(kind)) kinds.delete(kind);
      else kinds.add(kind);
      return { ...prev, kinds };
    });
  }, []);
  const toggleActor = useCallback((actor: string | null) => {
    setFilter((prev) => {
      const actors = new Set(prev.actors);
      if (actors.has(actor)) actors.delete(actor);
      else actors.add(actor);
      return { ...prev, actors };
    });
  }, []);
  const toggleTarget = useCallback(() => {
    setFilter((prev) => ({ ...prev, targetSelectedOnly: !prev.targetSelectedOnly }));
  }, []);
  const clearFilter = useCallback(() => {
    setFilter(EMPTY_FILTER);
  }, []);

  // Chip-set derivations. Kinds come from the merged rows (canonical order,
  // only kinds present); actors come from the raw event union so a join
  // event anywhere in the log can label its actor by screen name (D2).
  const availableKinds = useMemo(() => deriveAvailableKinds(rows), [rows]);
  const actorOptions = useMemo(
    () => deriveActorOptions([...prefetched, ...(liveEvents ?? [])]),
    [prefetched, liveEvents],
  );

  // Post-merge filter. Identity-stable fast path (Constraint §9) — the
  // default filter returns the pre-filter `rows` reference directly.
  const filteredRows = useMemo(() => {
    if (isDefaultFilter(filter)) return rows;
    return rows.filter((row) => matchesHistoryFilter(row, filter, selectedEntityId));
  }, [rows, filter, selectedEntityId]);
  const filterActive = !isDefaultFilter(filter);

  const resolvedNowMs = nowMs ?? Date.now();
  const systemActorLabel = t('moderator.changeHistory.systemActor');
  const paneAriaLabel = t('moderator.changeHistory.paneAriaLabel');

  const filterStrip = (
    <div
      data-testid="change-history-filter-strip"
      role="group"
      aria-label={t('moderator.historyFilter.regionAriaLabel')}
      className={FILTER_STRIP_CLASSES}
    >
      <div
        role="group"
        aria-label={t('moderator.historyFilter.kindGroupAriaLabel')}
        className={FILTER_GROUP_CLASSES}
      >
        {availableKinds.map((kind) => {
          const pressed = filter.kinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              data-testid="change-history-filter-kind"
              data-filter-kind={kind}
              aria-pressed={pressed}
              className={chipClasses(pressed)}
              onClick={() => {
                toggleKind(kind);
              }}
            >
              {t(`moderator.changeHistory.kind.${kind}`)}
            </button>
          );
        })}
      </div>
      <div
        role="group"
        aria-label={t('moderator.historyFilter.actorGroupAriaLabel')}
        className={FILTER_GROUP_CLASSES}
      >
        {actorOptions.map((option) => {
          const pressed = filter.actors.has(option.actor);
          const actorAttr = option.actor === null ? SYSTEM_ACTOR_SENTINEL : option.actor;
          const label = option.actor === null ? systemActorLabel : option.label;
          return (
            <button
              key={actorAttr}
              type="button"
              data-testid="change-history-filter-actor"
              data-filter-actor={actorAttr}
              aria-pressed={pressed}
              className={chipClasses(pressed)}
              onClick={() => {
                toggleActor(option.actor);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="change-history-filter-target"
        aria-pressed={filter.targetSelectedOnly}
        disabled={selectedEntityId === null}
        title={
          selectedEntityId === null ? t('moderator.historyFilter.targetDisabledHint') : undefined
        }
        className={
          selectedEntityId === null
            ? `${FILTER_CHIP_BASE_CLASSES} ${FILTER_CHIP_DISABLED_CLASSES}`
            : chipClasses(filter.targetSelectedOnly)
        }
        onClick={() => {
          toggleTarget();
        }}
      >
        {t('moderator.historyFilter.targetToggleLabel')}
      </button>
      {filterActive ? (
        <button
          type="button"
          data-testid="change-history-filter-clear"
          className={FILTER_CLEAR_CLASSES}
          onClick={clearFilter}
        >
          {t('moderator.historyFilter.clearLabel')}
        </button>
      ) : null}
    </div>
  );

  // Loading and error are exclusive pre-ready surfaces; once the
  // prefetch is ready the pane shows the merged list (or the empty
  // state). All four surfaces share the scrollable container so the
  // sidebar body height is consistent across states.
  let body: ReactElement;
  if (status === 'loading') {
    body = (
      <p data-testid="change-history-pane-loading" className={LOADING_STATE_CLASSES}>
        {t('moderator.changeHistory.loading')}
      </p>
    );
  } else if (status === 'error') {
    body = (
      <div data-testid="change-history-pane-error" className={ERROR_CONTAINER_CLASSES}>
        <p className={ERROR_TEXT_CLASSES} role="alert">
          {t('moderator.changeHistory.error')}
        </p>
        <button
          type="button"
          data-testid="change-history-pane-retry"
          className={RETRY_BUTTON_CLASSES}
          onClick={() => {
            retry();
          }}
        >
          {t('moderator.changeHistory.retry')}
        </button>
      </div>
    );
  } else if (rows.length === 0 && !filterActive) {
    // Two distinct empty states (Constraint §8). This one: the merged log
    // is empty AND the default filter is in effect.
    body = (
      <p data-testid="change-history-pane-empty" className={EMPTY_STATE_CLASSES}>
        {t('moderator.changeHistory.emptyState')}
      </p>
    );
  } else if (filteredRows.length === 0) {
    // The other empty state: a non-default filter narrowed the list to
    // zero (Constraint §8, Decision §4). `filterActive` is necessarily
    // true here — when the filter is default, `filteredRows === rows` and
    // a zero count is handled by the branch above.
    body = (
      <p data-testid="change-history-pane-filtered-empty" className={EMPTY_STATE_CLASSES}>
        {t('moderator.historyFilter.filteredEmpty')}
      </p>
    );
  } else {
    body = (
      <ol data-testid="change-history-pane-list" role="list" className={LIST_CLASSES}>
        {filteredRows.map((row) => (
          <ChangeHistoryRowItem
            key={row.id}
            row={row}
            nowMs={resolvedNowMs}
            systemActorLabel={systemActorLabel}
            t={translate}
          />
        ))}
      </ol>
    );
  }

  return (
    <div
      data-testid="change-history-pane"
      aria-label={paneAriaLabel}
      className={PANE_CONTAINER_CLASSES}
    >
      {filterStrip}
      {body}
    </div>
  );
}
