// `<ParticipantDiagnosticsList>` — the debater-facing, session-wide
// inventory of currently-active structural diagnostics, reachable from a
// toggle affordance co-located with the footer status indicator.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
// Design doc: docs/participant-ui.md (P6 — View structural diagnostics)
//
// The participant analogue of the moderator's `<DiagnosticFlagPane>`:
// the SAME data source (`activeDiagnostics` on the WS store), the SAME
// total order (the shared `orderActiveDiagnostics` comparator lifted to
// the shell per Decision §3), and the same row anatomy — severity badge
// + localized `diagnostics.<kind>.title`. Adapted to the participant's
// footer-anchored surface and debater-facing copy: each row pairs the
// kind title with the parameter-free `diagnostics.<kind>.detail`
// "what-this-means" explanation (Decision §5), NOT the moderator's
// `.action` next-step prose.
//
// Read-only (Constraint §1): the only stateful interaction is the
// open/close toggle, held in local UI state. Tapping a row to focus the
// affected region is the sibling leaf `part_diagnostic_focus`'s job
// (Decision §6) — these rows carry no click handler.

import { useId, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { diagnosticIdentityKey, orderActiveDiagnostics } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore';

export interface ParticipantDiagnosticsListProps {
  readonly sessionId: string;
}

// Stable empty-map reference for the no-active-diagnostic baseline.
// Mirrors the moderator's `EMPTY_ACTIVE_DIAGNOSTICS` sentinel (and the
// route's `EMPTY_DIAGNOSTICS_MAP`): without it the selector mints a
// fresh `Map` per read and trips Zustand's strict-equality re-render
// loop (Constraint §4).
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

function badgeClassesFor(severity: DiagnosticPayload['severity']): string {
  return severity === 'blocking'
    ? 'rounded bg-rose-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-900'
    : 'rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900';
}

function rowClassesFor(severity: DiagnosticPayload['severity']): string {
  return severity === 'blocking'
    ? 'rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-900'
    : 'rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900';
}

export function ParticipantDiagnosticsList(props: ParticipantDiagnosticsListProps): ReactElement {
  const { sessionId } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS,
  );

  // Memoize the ordered list on the `activeDiagnostics` map reference so
  // a noisy operate-route re-render doesn't churn the rows. The selector
  // preserves the map reference across reads when no diagnostic landed
  // (Constraint §4).
  const ordered = useMemo(() => orderActiveDiagnostics(activeDiagnostics), [activeDiagnostics]);
  const count = ordered.length;

  // Quiet when zero, else tone the toggle by the highest severity
  // present (blocking wins). The count `0` / quiet state keeps the
  // affordance route-assertable even when nothing is active (Constraint
  // §5).
  const tone =
    count === 0
      ? 'quiet'
      : ordered.some((d) => d.severity === 'blocking')
        ? 'blocking'
        : 'advisory';

  const header = t('participant.diagnostics.header');

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        data-testid="participant-diagnostics-toggle"
        data-count={count}
        data-tone={tone}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={t('participant.diagnostics.toggleAria', { count })}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
      >
        <span>{t('participant.diagnostics.toggleLabel')}</span>
        <span
          data-testid="participant-diagnostics-toggle-count"
          aria-hidden="true"
          className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-semibold ${
            tone === 'blocking'
              ? 'bg-rose-200 text-rose-900'
              : tone === 'advisory'
                ? 'bg-amber-200 text-amber-900'
                : 'bg-slate-200 text-slate-600'
          }`}
        >
          {count}
        </span>
      </button>

      {isOpen ? (
        <section
          id={panelId}
          role="region"
          aria-label={header}
          className="absolute bottom-full right-0 mb-2 w-80 space-y-2 rounded border border-slate-200 bg-white p-3 shadow-lg"
        >
          <header className="space-y-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {header}
            </h2>
          </header>
          {count === 0 ? (
            <p
              data-testid="participant-diagnostic-empty"
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs italic text-slate-500"
            >
              {t('participant.diagnostics.empty')}
            </p>
          ) : (
            <ul
              data-testid="participant-diagnostic-list"
              aria-label={t('participant.diagnostics.countAria', { count })}
              className="space-y-1.5"
            >
              {ordered.map((payload) => {
                const key = diagnosticIdentityKey(payload);
                return (
                  <li
                    key={key}
                    data-testid="participant-diagnostic-row"
                    data-diagnostic-key={key}
                    data-diagnostic-kind={payload.kind}
                    data-diagnostic-severity={payload.severity}
                    className={rowClassesFor(payload.severity)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        data-testid="participant-diagnostic-severity"
                        className={badgeClassesFor(payload.severity)}
                      >
                        {t(`participant.diagnostics.severity.${payload.severity}`)}
                      </span>
                      <span
                        data-testid="participant-diagnostic-kind-title"
                        className="text-sm font-medium"
                      >
                        {t(`diagnostics.${payload.kind}.title`)}
                      </span>
                    </div>
                    <p data-testid="participant-diagnostic-detail" className="mt-0.5 text-xs">
                      {t(`diagnostics.${payload.kind}.detail`)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
