// Test-mode session-log route view.
//
// Refinement: tasks/refinements/replay_test/test_mode_load_session.md
// ADRs:        0003 (React); 0024 (react-i18next);
//              0022 (the `data-testid` seams are the pinned regression
//                    surface for the Vitest view tests + the Playwright
//                    load-session e2e).
//
// Reads `:sessionId` from the router, loads the complete persisted event
// log through the shell's `useSessionEventLog` hook, and renders each load
// state observably: a loading affordance, a not-found affordance (the
// operator pasted an unknown-or-invisible id), an error + retry affordance,
// an empty-log affordance, and a ready readout — a total-count header plus
// one row per event (`sequence` · `kind` · `createdAt`).
//
// This readout is **deliberately inert scaffolding** (Decision §4): the
// timeline scrubber, event inspector, and graph supersede it in place in
// the downstream `test_mode_*` leaves. It is app-local — not a reusable
// shell widget — precisely because it is throwaway.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSessionEventLog } from '@a-conversa/shell';

export function SessionLogRoute(): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { status, events, retry } = useSessionEventLog(sessionId ?? '');
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <main
        data-testid="test-mode-session-log-loading"
        role="status"
        aria-live="polite"
        className="mx-auto max-w-3xl p-6 text-sm italic text-slate-500"
      >
        {t('testMode.loadSession.loading')}
      </main>
    );
  }

  if (status === 'not-found') {
    return (
      <main
        data-testid="test-mode-session-log-not-found"
        role="alert"
        className="mx-auto max-w-3xl p-6 text-sm text-slate-900"
      >
        {t('testMode.loadSession.notFound')}
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main
        data-testid="test-mode-session-log-error"
        role="alert"
        className="mx-auto flex max-w-3xl flex-col gap-2 p-6 text-sm text-slate-900"
      >
        <span>{t('testMode.loadSession.error')}</span>
        <button
          type="button"
          data-testid="test-mode-session-log-retry"
          onClick={() => {
            retry();
          }}
          className="self-start rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('testMode.loadSession.retry')}
        </button>
      </main>
    );
  }

  // status === 'ready'
  if (events.length === 0) {
    return (
      <main
        data-testid="test-mode-session-log-empty"
        role="status"
        className="mx-auto max-w-3xl p-6 text-sm italic text-slate-500"
      >
        {t('testMode.loadSession.empty')}
      </main>
    );
  }

  return (
    <main
      data-testid="test-mode-session-log"
      data-allow-scroll=""
      aria-label={t('testMode.loadSession.regionAriaLabel')}
      className="mx-auto h-screen max-w-3xl overflow-y-auto p-6 text-sm text-slate-900"
    >
      <h1 data-testid="test-mode-session-log-count" className="mb-3 text-lg font-semibold">
        {t('testMode.loadSession.eventCount', { count: events.length })}
      </h1>
      <ol className="flex flex-col font-mono text-xs">
        {events.map((event) => (
          <li
            key={event.id}
            data-testid={`test-mode-session-log-row-${String(event.sequence)}`}
            data-sequence={event.sequence}
            className="flex items-baseline gap-3 border-b border-slate-100 py-1"
          >
            <span className="w-12 shrink-0 text-right text-slate-500">{event.sequence}</span>
            <span className="font-medium">{event.kind}</span>
            <time dateTime={event.createdAt} className="ml-auto shrink-0 text-slate-400">
              {event.createdAt}
            </time>
          </li>
        ))}
      </ol>
    </main>
  );
}

export default SessionLogRoute;
