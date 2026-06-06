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

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';
import { useSessionEventLog } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { deriveHistoryRows, type HistoryRow } from './deriveHistoryRows';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

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
    body = (
      <p data-testid="participant-history-pane-empty" className="p-6 text-sm text-slate-500">
        {t('participant.changeHistory.emptyState')}
      </p>
    );
  } else {
    body = (
      <ol
        data-testid="participant-history-pane-list"
        role="list"
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {rows.map((row) => (
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
