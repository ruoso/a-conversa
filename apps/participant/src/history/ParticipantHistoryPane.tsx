// `<ParticipantHistoryPane>` — the participant (debater) tablet's
// reverse-chronological change-history view.
//
// Refinement: tasks/refinements/participant-ui/part_history_list.md
//   A deliberately reduced subset of the moderator's `<ChangeHistoryPane>`
//   (`apps/moderator/src/layout/ChangeHistoryPane.tsx`): minimal read-only
//   rows (kind + actor + timestamp), no per-kind summary, no click-to-focus.
//
// Full-log source (Decision §D1): the shell's `useSessionEventLog` REST
// prefetch (paged to completion) overlaid with the live WS `events` array,
// merged + reversed by the local pure `deriveHistoryRows` selector. The WS
// log alone is not guaranteed complete after a snapshot-state catch-up, so a
// history/audit view must read the REST endpoint.

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';
import { useSessionEventLog } from '@a-conversa/shell';
import type { Event, EventKind } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { deriveHistoryRows, type HistoryRow } from './deriveHistoryRows';
import {
  deriveActorOptions,
  deriveAvailableKinds,
  EMPTY_FILTER,
  isDefaultFilter,
  matchesHistoryFilter,
  SYSTEM_ACTOR_SENTINEL,
  type HistoryFilter,
} from './historyFilter';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

// The filter strip (`part_history_filtering`) — a reduced mirror of the
// moderator's pinned strip (Decision §D8: gated on a non-empty ready log
// rather than always pinned). The chip vocabulary mirrors the row's kind
// chip (`slate-100` / `slate-700`); the pressed state inverts to the
// `slate-700` tone.
const FILTER_STRIP_CLASSES =
  'flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2';
const FILTER_GROUP_CLASSES = 'flex flex-wrap items-center gap-1';
const FILTER_CHIP_BASE_CLASSES =
  'flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';
const FILTER_CHIP_ACTIVE_CLASSES = 'bg-slate-700 text-white hover:bg-slate-800';
const FILTER_CHIP_INACTIVE_CLASSES = 'bg-slate-100 text-slate-700 hover:bg-slate-200';
const FILTER_CLEAR_CLASSES =
  'flex-shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';

/** Compose the chip className for a toggle chip given its pressed state. */
function chipClasses(pressed: boolean): string {
  return `${FILTER_CHIP_BASE_CLASSES} ${pressed ? FILTER_CHIP_ACTIVE_CLASSES : FILTER_CHIP_INACTIVE_CLASSES}`;
}

/** 8-char id prefix, or the localized "System" label when actor is null. */
function actorText(actor: string | null, systemLabel: string): string {
  if (actor === null) return systemLabel;
  return actor.slice(0, 8);
}

/**
 * Past = negative seconds; NaN-guarded against a malformed ISO string (the
 * formatter would otherwise throw — surface the raw value instead of
 * crashing the pane). Mirrors the moderator pane's `relativeTimeFor`.
 */
function relativeTimeFor(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return createdAt;
  const secondsAgo = Math.round((nowMs - createdMs) / 1000);
  return formatRelativeTime(-secondsAgo, 'second');
}

export interface ParticipantHistoryPaneProps {
  /** The session whose event log drives the pane's contents. */
  readonly sessionId: string;
  /**
   * Optional reference time for relative-time formatting. Lets the
   * component test inject a deterministic "now" so the relative-time string
   * is stable across runs. Defaults to `Date.now()` at render time, mirroring
   * the sibling participant panes.
   */
  readonly nowMs?: number;
}

export function ParticipantHistoryPane({
  sessionId,
  nowMs,
}: ParticipantHistoryPaneProps): ReactElement {
  const { t } = useTranslation();
  const { status, events: prefetched, retry } = useSessionEventLog(sessionId);
  const liveEvents = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  // `useMemo` keyed on both sources so the merged row list stays
  // referentially stable across renders when neither has changed.
  const rows = useMemo(() => deriveHistoryRows(prefetched, liveEvents), [prefetched, liveEvents]);
  const resolvedNowMs = nowMs ?? Date.now();
  const systemActorLabel = t('participant.changeHistory.systemActor');

  // Filter state — local component state (Constraint §7): one `HistoryFilter`
  // cell, no Zustand slice, resets on pane mount by design.
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_FILTER);

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
  const clearFilter = useCallback(() => {
    setFilter(EMPTY_FILTER);
  }, []);

  // Chip-set derivations — both come from the merged rows (the participant
  // labels actors exactly as the row does, Decision §D5; no raw-event walk).
  const availableKinds = useMemo(() => deriveAvailableKinds(rows), [rows]);
  const actorOptions = useMemo(() => deriveActorOptions(rows), [rows]);

  // Post-merge filter. Identity-stable fast path (Constraint §3) — the
  // default filter returns the pre-filter `rows` reference directly.
  const filteredRows = useMemo(() => {
    if (isDefaultFilter(filter)) return rows;
    return rows.filter((row) => matchesHistoryFilter(row, filter));
  }, [rows, filter]);
  const filterActive = !isDefaultFilter(filter);

  // The strip renders only when the prefetch is ready and the unfiltered log
  // is non-empty — there are no chips to derive otherwise (Constraint §6,
  // Decision §D8).
  const showFilterStrip = status === 'ready' && rows.length > 0;

  const filterStrip = (
    <div
      data-testid="participant-history-filter-strip"
      role="group"
      aria-label={t('participant.historyFilter.regionAriaLabel')}
      className={FILTER_STRIP_CLASSES}
    >
      <div
        role="group"
        aria-label={t('participant.historyFilter.kindGroupAriaLabel')}
        className={FILTER_GROUP_CLASSES}
      >
        {availableKinds.map((kind) => {
          const pressed = filter.kinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              data-testid="participant-history-filter-kind"
              data-filter-kind={kind}
              aria-pressed={pressed}
              className={chipClasses(pressed)}
              onClick={() => {
                toggleKind(kind);
              }}
            >
              {t(`participant.changeHistory.kind.${kind}`)}
            </button>
          );
        })}
      </div>
      <div
        role="group"
        aria-label={t('participant.historyFilter.actorGroupAriaLabel')}
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
              data-testid="participant-history-filter-actor"
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
      {filterActive ? (
        <button
          type="button"
          data-testid="participant-history-filter-clear"
          className={FILTER_CLEAR_CLASSES}
          onClick={clearFilter}
        >
          {t('participant.historyFilter.clearLabel')}
        </button>
      ) : null}
    </div>
  );

  let body: ReactElement;
  if (status === 'loading') {
    body = (
      <p data-testid="participant-history-pane-loading" className="p-6 text-sm text-slate-500">
        {t('participant.changeHistory.loading')}
      </p>
    );
  } else if (status === 'error' || status === 'not-found') {
    // Decision §D4 — fold `'not-found'` into the retry-able error surface;
    // in the operate route the session is always visible to its own
    // participants, so a 404 is effectively unreachable dead UI.
    body = (
      <div data-testid="participant-history-pane-error" className="flex flex-col gap-2 p-6">
        <p role="alert" className="text-sm text-slate-600">
          {t('participant.changeHistory.error')}
        </p>
        <button
          type="button"
          data-testid="participant-history-pane-retry"
          onClick={() => {
            retry();
          }}
          className="self-start rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
        >
          {t('participant.changeHistory.retry')}
        </button>
      </div>
    );
  } else if (rows.length === 0) {
    // The merged log is genuinely empty (the strip is hidden, so the filter
    // is necessarily default here). Distinct from the filtered-empty state.
    body = (
      <p data-testid="participant-history-pane-empty" className="p-6 text-sm text-slate-500">
        {t('participant.changeHistory.emptyState')}
      </p>
    );
  } else if (filteredRows.length === 0) {
    // A non-default filter narrowed the list to zero (Constraint §5).
    // `filterActive` is necessarily true here — when the filter is default,
    // `filteredRows === rows` and a zero count is handled by the branch above.
    body = (
      <p
        data-testid="participant-history-pane-filtered-empty"
        className="p-6 text-sm text-slate-500"
      >
        {t('participant.historyFilter.filteredEmpty')}
      </p>
    );
  } else {
    body = (
      <ol
        data-testid="participant-history-pane-list"
        role="list"
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {filteredRows.map((row) => (
          <HistoryRowItem
            key={row.id}
            row={row}
            nowMs={resolvedNowMs}
            systemActorLabel={systemActorLabel}
          />
        ))}
      </ol>
    );
  }

  return (
    <section
      data-testid="participant-history-pane"
      role="tabpanel"
      aria-live="polite"
      aria-label={t('participant.changeHistory.paneAriaLabel')}
      className="flex h-full w-full flex-col overflow-auto bg-white"
    >
      {showFilterStrip ? filterStrip : null}
      {body}
    </section>
  );
}

function HistoryRowItem({
  row,
  nowMs,
  systemActorLabel,
}: {
  readonly row: HistoryRow;
  readonly nowMs: number;
  readonly systemActorLabel: string;
}): ReactElement {
  const { t } = useTranslation();
  const kindLabel = t(`participant.changeHistory.kind.${row.kind}`);
  const actor = actorText(row.actor, systemActorLabel);
  const ago = relativeTimeFor(row.createdAt, nowMs);
  return (
    <li
      data-testid="participant-history-row"
      data-event-id={row.id}
      data-event-kind={row.kind}
      data-sequence={row.sequence}
      className="flex flex-row items-center gap-2 rounded-md border border-slate-100 bg-white px-3 py-2"
    >
      <span
        data-testid="participant-history-row-kind"
        className="inline-flex h-5 items-center rounded-sm bg-slate-100 px-2 text-xs font-medium text-slate-700"
      >
        {kindLabel}
      </span>
      <span
        data-testid="participant-history-row-actor"
        className="flex-1 font-mono text-xs text-slate-500"
      >
        {actor}
      </span>
      <span data-testid="participant-history-row-timestamp" className="text-xs text-slate-500">
        {ago}
      </span>
    </li>
  );
}
