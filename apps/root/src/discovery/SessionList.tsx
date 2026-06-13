// The shared presentation + interaction shell behind both discovery lists
// ("My Sessions" and "Public Sessions"). It owns the genuinely shared,
// error-prone machinery — the search / date / page query-state machine, input
// debouncing, the 3-char search minimum, the pagination arithmetic, and the
// loading / empty / error rendering — and stays deliberately ignorant of which
// endpoint backs it, whether the caller is authenticated, or what a row's
// "join live" / "see replay" affordance is. Those differences are injected by
// the mounting page through two seams: an async `fetchPage` fetcher (D2) and a
// per-row `renderRowActions` slot (D3).
//
// Refinement: tasks/refinements/session_discovery/sd_session_list_component.md
// TaskJuggler: session_discovery.sd_frontend.sd_session_list_component
// ADR:        0003 (React), 0005 (Tailwind), 0006 (Vitest), 0024 (i18n),
//             0026 (micro-frontend root app), 0039 (root-app-local component).
//
// Scope: a root-app-local component (D1) — no new shared package, no new
// dependency. Localized in en-US / pt-BR / es-419 via the `discovery.*` catalog
// block (D6); WCAG A/AA at the unit level (labelled controls, named table,
// status conveyed as text). Full axe + Playwright coverage is deferred to the
// page tasks that make it route-reachable (D8).

import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@a-conversa/i18n-catalogs';
import {
  MAX_SESSION_LIST_OFFSET,
  MAX_TOPIC_SEARCH_LENGTH,
  MIN_TOPIC_SEARCH_LENGTH,
} from '@a-conversa/shared-types';

/** UI page size default (D4); passed to the fetcher as `limit`. */
export const DEFAULT_PAGE_SIZE = 20;

/** Debounce window for the topic search input, in milliseconds. */
const DEFAULT_DEBOUNCE_MS = 250;

/**
 * The derived lifecycle of a session, computed from `(startedAt, endedAt)` and
 * displayed as localized status text. The actions slot uses the same
 * derivation (via {@link deriveLifecycleStatus}) to pick join-live vs
 * see-replay — but that is the page's concern (D3), not this component's.
 */
export type SessionLifecycleStatus = 'lobby' | 'live' | 'ended';

/**
 * The minimal display shape both pages map their endpoint row into. Per-row
 * role badges and links are NOT fields here — they arrive through
 * {@link SessionListProps.renderRowActions} (D2, D3).
 */
export interface SessionListRow {
  readonly id: string;
  readonly topic: string;
  /** ISO-8601 `date-time`; `null` while the session is in lobby (unstarted). */
  readonly startedAt: string | null;
  /** ISO-8601 `date-time`; `null` while the session has not ended. */
  readonly endedAt: string | null;
}

/**
 * The query the component hands its injected fetcher. Mirrors the endpoints'
 * shared param surface; `topic` / `startedAfter` / `startedBefore` are omitted
 * when not active rather than sent empty.
 */
export interface SessionListQuery {
  readonly topic?: string;
  readonly startedAfter?: string;
  readonly startedBefore?: string;
  readonly limit: number;
  readonly offset: number;
}

/** What the injected fetcher resolves to: a page of rows plus the full count. */
export interface SessionListPage {
  readonly rows: readonly SessionListRow[];
  /** Full pre-limit/offset match count — the pagination denominator. */
  readonly total: number;
}

/**
 * The data-access seam (D2). Each page wires this to its endpoint, owning the
 * `fetch` call (URL + auth posture) and the row → view-model mapping. MUST be
 * referentially stable across renders (wrap in `useCallback`) — the component
 * re-fetches whenever this prop's identity changes.
 */
export type SessionListFetcher = (query: SessionListQuery) => Promise<SessionListPage>;

export interface SessionListProps {
  /** Data-access seam — see {@link SessionListFetcher}. */
  readonly fetchPage: SessionListFetcher;
  /** Page size; defaults to {@link DEFAULT_PAGE_SIZE} (D4). */
  readonly limit?: number;
  /**
   * Per-row render slot (D3) for role badges + join-live / see-replay links.
   * Invoked with each row; its output renders in that row's actions cell.
   */
  readonly renderRowActions?: (row: SessionListRow) => ReactNode;
  /**
   * Whether lobby (unstarted) rows can appear in this list. My Sessions sets
   * this `true` (default); the public list — which is started-only — sets it
   * `false` so the date-filter ⟶ lobby-exclusion note (D7) is suppressed.
   */
  readonly lobbyRowsPossible?: boolean;
  /** Debounce window for the topic search, in ms. Defaults to 250. */
  readonly debounceMs?: number;
}

/**
 * Derive the displayed/branch-on lifecycle status from a row's timestamps:
 * `startedAt == null` ⟶ lobby; started but not ended ⟶ live; ended ⟶ ended.
 */
export function deriveLifecycleStatus(row: {
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}): SessionLifecycleStatus {
  if (row.startedAt === null) {
    return 'lobby';
  }
  if (row.endedAt === null) {
    return 'live';
  }
  return 'ended';
}

/** A picked `yyyy-mm-dd` day → the inclusive start-of-day ISO `date-time`. */
function toStartedAfter(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/** A picked `yyyy-mm-dd` day → the inclusive end-of-day ISO `date-time`. */
function toStartedBefore(day: string): string {
  return `${day}T23:59:59.999Z`;
}

export function SessionList(props: SessionListProps): ReactElement {
  const {
    fetchPage,
    limit = DEFAULT_PAGE_SIZE,
    renderRowActions,
    lobbyRowsPossible = true,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = props;
  const { t } = useTranslation();

  // Raw input value (immediate) vs. the committed, debounced topic that is part
  // of the query. A 1–2 char non-empty value never commits — it shows a hint.
  const [searchValue, setSearchValue] = useState('');
  const [committedTopic, setCommittedTopic] = useState<string | undefined>(undefined);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [offset, setOffset] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);

  // Fetch result is kept separate from the in-flight flag so a new load does
  // not abruptly clear the rows already on screen (no layout thrash).
  const [rows, setRows] = useState<readonly SessionListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const trimmedSearch = searchValue.trim();
  const isBelowMinLength =
    trimmedSearch.length > 0 && trimmedSearch.length < MIN_TOPIC_SEARCH_LENGTH;

  const startedAfter = fromDay === '' ? undefined : toStartedAfter(fromDay);
  const startedBefore = toDay === '' ? undefined : toStartedBefore(toDay);
  const isDateFilterActive = startedAfter !== undefined || startedBefore !== undefined;

  // Debounce the search box into `committedTopic`. Below-min, non-empty input
  // is a no-op (no commit, no fetch) — the hint renders instead. Empty clears
  // the filter. Any commit resets pagination to the first page.
  useEffect(() => {
    if (isBelowMinLength) {
      return undefined;
    }
    const next = trimmedSearch.length === 0 ? undefined : trimmedSearch;
    const handle = setTimeout(() => {
      setCommittedTopic(next);
      setOffset(0);
    }, debounceMs);
    return () => {
      clearTimeout(handle);
    };
  }, [trimmedSearch, isBelowMinLength, debounceMs]);

  // The single fetch effect. Re-runs whenever any query input changes (or a
  // retry is requested). A stale resolution is ignored via the `cancelled`
  // guard so out-of-order responses cannot clobber the latest query.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    const query: SessionListQuery = {
      limit,
      offset,
      ...(committedTopic !== undefined ? { topic: committedTopic } : {}),
      ...(startedAfter !== undefined ? { startedAfter } : {}),
      ...(startedBefore !== undefined ? { startedBefore } : {}),
    };
    fetchPage(query).then(
      (page) => {
        if (cancelled) {
          return;
        }
        setRows(page.rows);
        setTotal(page.total);
        setIsLoading(false);
        setHasLoaded(true);
      },
      () => {
        if (cancelled) {
          return;
        }
        setIsLoading(false);
        setHasError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchPage, committedTopic, startedAfter, startedBefore, limit, offset, retryNonce]);

  const canPrev = offset > 0;
  const canNext = offset + rows.length < total;
  const isEmpty = hasLoaded && !hasError && rows.length === 0;

  // Human 1-based bounds for the "showing X–Y of N" summary.
  const summaryStart = total === 0 ? 0 : offset + 1;
  const summaryEnd = offset + rows.length;

  const searchId = useId();
  const fromId = useId();
  const toId = useId();
  const hintId = useId();

  function onSearchChange(value: string): void {
    setSearchValue(value.slice(0, MAX_TOPIC_SEARCH_LENGTH));
  }

  function onFromChange(value: string): void {
    setFromDay(value);
    setOffset(0);
  }

  function onToChange(value: string): void {
    setToDay(value);
    setOffset(0);
  }

  function onPrev(): void {
    setOffset((current) => Math.max(0, current - limit));
  }

  function onNext(): void {
    setOffset((current) => Math.min(MAX_SESSION_LIST_OFFSET, current + limit));
  }

  function onRetry(): void {
    setRetryNonce((nonce) => nonce + 1);
  }

  return (
    <div data-testid="session-list" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium text-slate-700">
            {t('discovery.search.label')}
          </label>
          <input
            id={searchId}
            type="search"
            data-testid="session-list-search"
            value={searchValue}
            maxLength={MAX_TOPIC_SEARCH_LENGTH}
            placeholder={t('discovery.search.placeholder')}
            aria-describedby={isBelowMinLength ? hintId : undefined}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {isBelowMinLength ? (
            <p
              id={hintId}
              data-testid="session-list-search-hint"
              className="text-xs text-slate-500"
            >
              {t('discovery.search.minLengthHint', { min: MIN_TOPIC_SEARCH_LENGTH })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={fromId} className="text-sm font-medium text-slate-700">
            {t('discovery.dateFilter.fromLabel')}
          </label>
          <input
            id={fromId}
            type="date"
            data-testid="session-list-from"
            value={fromDay}
            onChange={(event) => {
              onFromChange(event.target.value);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={toId} className="text-sm font-medium text-slate-700">
            {t('discovery.dateFilter.toLabel')}
          </label>
          <input
            id={toId}
            type="date"
            data-testid="session-list-to"
            value={toDay}
            onChange={(event) => {
              onToChange(event.target.value);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {isDateFilterActive && lobbyRowsPossible ? (
        <p data-testid="session-list-lobby-note" className="text-xs text-amber-700">
          {t('discovery.dateFilter.lobbyExclusionNote')}
        </p>
      ) : null}

      {isLoading ? (
        <p role="status" data-testid="session-list-loading" className="text-sm text-slate-500">
          {t('discovery.loading')}
        </p>
      ) : null}

      {hasError ? (
        <div role="alert" data-testid="session-list-error" className="flex flex-col gap-2">
          <p className="text-sm text-red-700">{t('discovery.error.message')}</p>
          <button
            type="button"
            data-testid="session-list-retry"
            onClick={onRetry}
            className="self-start rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            {t('discovery.error.retry')}
          </button>
        </div>
      ) : null}

      {isEmpty ? (
        <p data-testid="session-list-empty" className="text-sm text-slate-500">
          {t('discovery.empty')}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <table
          className="w-full border-collapse text-left text-sm"
          aria-label={t('discovery.list.label')}
        >
          <caption className="sr-only">{t('discovery.list.label')}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('discovery.columns.topic')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('discovery.columns.status')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('discovery.columns.startedAt')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('discovery.columns.endedAt')}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t('discovery.columns.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = deriveLifecycleStatus(row);
              return (
                <tr
                  key={row.id}
                  data-testid="session-list-row"
                  className="border-b border-slate-100"
                >
                  <td className="py-2 pr-4 text-slate-900">{row.topic}</td>
                  <td className="py-2 pr-4">
                    <span data-testid="session-list-status" className="text-slate-700">
                      {t(`discovery.status.${status}`)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {row.startedAt === null
                      ? t('discovery.notStarted')
                      : formatDateTime(new Date(row.startedAt))}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {row.endedAt === null
                      ? t('discovery.notStarted')
                      : formatDateTime(new Date(row.endedAt))}
                  </td>
                  <td className="py-2">{renderRowActions?.(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="session-list-summary" className="text-sm text-slate-600">
          {t('discovery.pagination.summary', {
            start: summaryStart,
            end: summaryEnd,
            total,
          })}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="session-list-prev"
            onClick={onPrev}
            disabled={!canPrev}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            {t('discovery.pagination.previous')}
          </button>
          <button
            type="button"
            data-testid="session-list-next"
            onClick={onNext}
            disabled={!canNext}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            {t('discovery.pagination.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SessionList;
