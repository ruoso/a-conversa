// Test-mode synthetic-session gallery — the surface root `/`.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        0003 (React); 0024 (react-i18next);
//              0041 (synthetic generation is a non-production-gated seam —
//                    this gallery is its operator-facing front door);
//              0022 (the `data-testid` seams are the pinned regression
//                    surface for the Vitest view tests + the Playwright
//                    generate→load e2e).
//
// Fetches the data-driven scenario list (`GET /api/test-mode/
// synthetic-scenarios`), renders one "generate" affordance per scenario,
// and on click POSTs to `POST /api/test-mode/synthetic-sessions` then
// navigates to the existing `/sessions/:newId` load route (Decision §2 /
// §5). It owns no render path of its own — generation hands off to the
// load readout the dependency already ships.
//
// **Fetch convention (Constraint §7).** Plain `fetch` + `useState`,
// `credentials: 'include'`, `Accept: application/json`, with observable
// loading / error+retry for both the list fetch and the generate POST.
// App-local (one consumer), not a shell hook — the generator is a
// test-mode-only concern with no second call site (Decision §7).

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { SyntheticScenarioDescriptor } from '@a-conversa/shared-types';

type ListStatus = 'loading' | 'ready' | 'error';

/** Defensive narrowing of one descriptor off the wire. */
function isDescriptor(raw: unknown): raw is SyntheticScenarioDescriptor {
  if (raw === null || typeof raw !== 'object') return false;
  const candidate = raw as { key?: unknown; title?: unknown; description?: unknown };
  return (
    typeof candidate.key === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string'
  );
}

export function SyntheticGallery(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [scenarios, setScenarios] = useState<readonly SyntheticScenarioDescriptor[]>([]);
  const [listNonce, setListNonce] = useState(0);

  // The scenario key whose generate POST is in flight (or null).
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  // The scenario key whose last generate attempt failed (or null).
  const [generateErrorKey, setGenerateErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setListStatus('loading');
    void (async () => {
      try {
        const response = await fetch('/api/test-mode/synthetic-scenarios', {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (response.status !== 200) {
          setListStatus('error');
          return;
        }
        const body = (await response.json()) as unknown;
        if (cancelled) return;
        const rawList = (body as { scenarios?: unknown }).scenarios;
        if (!Array.isArray(rawList)) {
          setListStatus('error');
          return;
        }
        const narrowed: SyntheticScenarioDescriptor[] = [];
        for (const item of rawList) {
          if (!isDescriptor(item)) {
            setListStatus('error');
            return;
          }
          narrowed.push(item);
        }
        setScenarios(narrowed);
        setListStatus('ready');
      } catch {
        if (!cancelled) setListStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listNonce]);

  const retryList = useCallback(() => {
    setListNonce((nonce) => nonce + 1);
  }, []);

  const generate = useCallback(
    (key: string) => {
      setGeneratingKey(key);
      setGenerateErrorKey(null);
      void (async () => {
        try {
          const response = await fetch('/api/test-mode/synthetic-sessions', {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario: key }),
          });
          if (response.status !== 201) {
            setGeneratingKey(null);
            setGenerateErrorKey(key);
            return;
          }
          const body = (await response.json()) as unknown;
          const sessionId = (body as { sessionId?: unknown }).sessionId;
          if (typeof sessionId !== 'string' || sessionId === '') {
            setGeneratingKey(null);
            setGenerateErrorKey(key);
            return;
          }
          // Hand off to the existing load route. The surface's
          // `BrowserRouter basename="/t"` resolves this to `/t/sessions/:id`.
          void navigate(`/sessions/${sessionId}`);
        } catch {
          setGeneratingKey(null);
          setGenerateErrorKey(key);
        }
      })();
    },
    [navigate],
  );

  // Per-scenario localized title/description, falling back to the
  // server-supplied English strings for any scenario the catalog has no
  // entry for — so the surface stays data-driven.
  const scenarioTitle = (s: SyntheticScenarioDescriptor): string =>
    t(`testMode.synthetic.scenario.${s.key}.title`, { defaultValue: s.title });
  const scenarioDescription = (s: SyntheticScenarioDescriptor): string =>
    t(`testMode.synthetic.scenario.${s.key}.description`, { defaultValue: s.description });

  return (
    <main
      data-testid="test-mode-synthetic-gallery"
      aria-label={t('testMode.synthetic.regionAriaLabel')}
      className="mx-auto max-w-2xl p-6"
    >
      <h1 className="text-2xl font-semibold">{t('testMode.synthetic.heading')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('testMode.synthetic.intro')}</p>

      {listStatus === 'loading' && (
        <p
          data-testid="test-mode-synthetic-loading"
          role="status"
          aria-live="polite"
          className="mt-6 text-sm italic text-slate-500"
        >
          {t('testMode.synthetic.loading')}
        </p>
      )}

      {listStatus === 'error' && (
        <div
          data-testid="test-mode-synthetic-list-error"
          role="alert"
          className="mt-6 flex flex-col gap-2 text-sm text-slate-900"
        >
          <span>{t('testMode.synthetic.listError')}</span>
          <button
            type="button"
            data-testid="test-mode-synthetic-list-retry"
            onClick={retryList}
            className="self-start rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('testMode.synthetic.retry')}
          </button>
        </div>
      )}

      {listStatus === 'ready' && scenarios.length === 0 && (
        <p
          data-testid="test-mode-synthetic-empty"
          role="status"
          className="mt-6 text-sm italic text-slate-500"
        >
          {t('testMode.synthetic.empty')}
        </p>
      )}

      {listStatus === 'ready' && scenarios.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {scenarios.map((scenario) => {
            const inFlight = generatingKey === scenario.key;
            const errored = generateErrorKey === scenario.key;
            return (
              <li
                key={scenario.key}
                data-testid={`test-mode-synthetic-scenario-${scenario.key}`}
                className="flex flex-col gap-2 rounded border border-slate-200 p-4"
              >
                <h2 className="text-base font-medium">{scenarioTitle(scenario)}</h2>
                <p className="text-sm text-slate-600">{scenarioDescription(scenario)}</p>
                <button
                  type="button"
                  data-testid={`test-mode-synthetic-generate-${scenario.key}`}
                  onClick={() => {
                    generate(scenario.key);
                  }}
                  disabled={inFlight}
                  className="self-start rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                >
                  {inFlight ? t('testMode.synthetic.generating') : t('testMode.synthetic.generate')}
                </button>
                {errored && (
                  <span
                    data-testid={`test-mode-synthetic-generate-error-${scenario.key}`}
                    role="alert"
                    className="text-xs text-red-700"
                  >
                    {t('testMode.synthetic.generateError')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default SyntheticGallery;
