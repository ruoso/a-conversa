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

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';

import { useWsStore } from '../ws/wsStore';
import { mergeAndOrderEventLog, type ChangeHistoryRow } from '../graph/changeHistory';
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
const ROW_CLASSES = 'flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1';
const KIND_CHIP_CLASSES =
  'flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700';
const ACTOR_CLASSES = 'flex-1 truncate text-xs text-slate-500';
const TIMESTAMP_CLASSES = 'flex-shrink-0 text-xs text-slate-500';
const EMPTY_STATE_CLASSES = 'italic text-slate-500';
const LOADING_STATE_CLASSES = 'italic text-slate-500';
const ERROR_CONTAINER_CLASSES = 'flex flex-col gap-1';
const ERROR_TEXT_CLASSES = 'text-sm text-red-700';
const RETRY_BUTTON_CLASSES =
  'self-start rounded border border-slate-400 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400';

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
 * One row in the list. Co-located inside this file (small enough not to
 * warrant its own file in v1). Sibling tasks extend this row contract;
 * the `data-testid` + `data-event-id` / `data-event-kind` /
 * `data-sequence` attributes are the stable seam (Constraints §5).
 */
function ChangeHistoryRowItem(props: {
  readonly row: ChangeHistoryRow;
  readonly nowMs: number;
  readonly systemActorLabel: string;
  readonly t: (key: string) => string;
}): ReactElement {
  const { row, nowMs, systemActorLabel, t } = props;
  const kindLabel = t(`moderator.changeHistory.kind.${row.kind}`);
  const actor = actorText(row.actor, systemActorLabel);
  const ago = relativeTimeFor(row.createdAt, nowMs);
  return (
    <li
      data-testid="change-history-row"
      data-event-id={row.id}
      data-event-kind={row.kind}
      data-sequence={row.sequence}
      className={ROW_CLASSES}
    >
      <span data-testid="change-history-row-kind" className={KIND_CHIP_CLASSES}>
        {kindLabel}
      </span>
      <span data-testid="change-history-row-actor" className={ACTOR_CLASSES}>
        {actor}
      </span>
      <span data-testid="change-history-row-timestamp" className={TIMESTAMP_CLASSES}>
        {ago}
      </span>
    </li>
  );
}

export function ChangeHistoryPane(props: ChangeHistoryPaneProps): ReactElement {
  const { sessionId, nowMs } = props;
  const { t } = useTranslation();

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

  const resolvedNowMs = nowMs ?? Date.now();
  const systemActorLabel = t('moderator.changeHistory.systemActor');
  const paneAriaLabel = t('moderator.changeHistory.paneAriaLabel');

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
  } else if (rows.length === 0) {
    body = (
      <p data-testid="change-history-pane-empty" className={EMPTY_STATE_CLASSES}>
        {t('moderator.changeHistory.emptyState')}
      </p>
    );
  } else {
    body = (
      <ol data-testid="change-history-pane-list" role="list" className={LIST_CLASSES}>
        {rows.map((row) => (
          <ChangeHistoryRowItem
            key={row.id}
            row={row}
            nowMs={resolvedNowMs}
            systemActorLabel={systemActorLabel}
            t={t}
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
      {body}
    </div>
  );
}
