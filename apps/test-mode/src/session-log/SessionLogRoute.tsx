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
// an empty-log affordance, and — for a non-empty `ready` log — the
// per-event timeline scrubber.
//
// `test_mode_timeline_scrubber` (Decision §3) superseded the former inert
// readout in place: the non-empty ready state now mounts
// `SessionScrubberContainer`, which owns the lifted replay position and
// renders the scrubber controls + projected graph + snapshot-jump shortcut.
// The four non-ready states (loading / not-found / error / empty) stay — the
// scrubber still needs the loaded log to render.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSessionEventLog } from '@a-conversa/shell';

import { SessionScrubberContainer } from '../scrubber/SessionScrubberContainer';

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

  // status === 'ready' with a non-empty log: the timeline scrubber surface
  // supersedes the former inert readout (Decision §3).
  return <SessionScrubberContainer sessionId={sessionId ?? ''} events={events} />;
}

export default SessionLogRoute;
