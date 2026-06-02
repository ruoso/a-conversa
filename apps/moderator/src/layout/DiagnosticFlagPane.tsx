// `<DiagnosticFlagPane>` — the flag-list view for the `'diagnostic-flags'`
// slot in `<RightSidebar>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
// Design doc:  docs/moderator-ui.md § F7
//
// Renders **every** active diagnostic as a flag row — severity badge +
// localized kind title + one-line action prose — in the shared
// `orderActiveDiagnostics(...)` total order (blocking-first, then
// oldest-first, identity-key tiebreak). The auto-focused row (the
// order's head) is marked `data-focused="true"` / `aria-current` for
// visual continuity with the embedded `<DiagnosticSuggestionsPanel>`,
// which this pane WRAPS (Decision §D1) — the list sits above the
// suggestions panel; the panel keeps showing its focused diagnostic and
// its methodology-suggestion chips.
//
// **Presentational only (Decision §D3).** Rows carry the full
// `data-diagnostic-*` seam set + a `data-focused` marker but no
// `onClick`. Turning a flag click into a canvas-focus gesture (and
// stamping `data-suggestion-affected-*` via `affectedEntities`) is the
// next leaf `mod_diagnostic_focus_action`; shipping inert rows with
// stable seams lets that leaf be a handler-addition diff, not a markup
// rewrite. No selection store field is introduced — "focused" is purely
// derived from the order's head (Decision §D4).

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore.js';
import { DiagnosticSuggestionsPanel } from './DiagnosticSuggestionsPanel.js';
import {
  ADVISORY_PANEL_CLASSES,
  BLOCKING_PANEL_CLASSES,
  orderActiveDiagnostics,
} from './orderActiveDiagnostics.js';

export interface DiagnosticFlagPaneProps {
  readonly sessionId: string;
}

// Stable empty-map reference for the no-active-diagnostic baseline.
// Same guard the suggestions panel keeps — without it the selector
// returns a fresh `Map` per read and trips an infinite re-render loop
// (Zustand strict-equality default).
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

function rowClassesFor(severity: DiagnosticPayload['severity']): string {
  return severity === 'blocking' ? BLOCKING_PANEL_CLASSES : ADVISORY_PANEL_CLASSES;
}

function badgeClassesFor(severity: DiagnosticPayload['severity']): string {
  return severity === 'blocking'
    ? 'rounded bg-rose-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-900'
    : 'rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900';
}

export function DiagnosticFlagPane(props: DiagnosticFlagPaneProps): ReactElement {
  const { sessionId } = props;
  const { t } = useTranslation();
  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS,
  );

  // Memoize the ordered list on the `activeDiagnostics` map reference so
  // a noisy `<Operate>` re-render doesn't churn the rows. The selector
  // preserves the map reference across reads when no diagnostic landed.
  const ordered = useMemo(() => orderActiveDiagnostics(activeDiagnostics), [activeDiagnostics]);
  const focusedKey = ordered[0] === undefined ? null : diagnosticIdentityKey(ordered[0]);

  const header = t('moderator.diagnostic.flags.header');

  // Empty state (Constraint §6): when no diagnostic is active, the pane
  // shows ONE empty message — not two. The suggestions panel renders its
  // own empty state, so we do NOT mount it here; the flag pane's single
  // `diagnostic-flag-empty` message stands in for the whole slot.
  if (ordered.length === 0) {
    return (
      <section
        data-testid="diagnostic-flag-pane"
        role="region"
        aria-label={header}
        className="space-y-2"
      >
        <header className="space-y-0.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide">{header}</h3>
        </header>
        <p
          data-testid="diagnostic-flag-empty"
          className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs italic text-slate-500"
        >
          {t('moderator.diagnostic.suggestions.empty')}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="diagnostic-flag-pane"
      role="region"
      aria-label={header}
      className="space-y-2"
    >
      <header className="space-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide">{header}</h3>
      </header>
      <ul
        data-testid="diagnostic-flag-list"
        aria-label={t('moderator.diagnostic.flags.countAria', { count: ordered.length })}
        className="space-y-1.5"
      >
        {ordered.map((payload) => {
          const key = diagnosticIdentityKey(payload);
          const isFocused = key === focusedKey;
          const localizedKindTitle = t(`diagnostics.${payload.kind}.title`);
          return (
            <li
              key={key}
              data-testid="diagnostic-flag-row"
              data-diagnostic-key={key}
              data-diagnostic-kind={payload.kind}
              data-diagnostic-severity={payload.severity}
              data-focused={isFocused ? 'true' : 'false'}
              aria-current={isFocused ? 'true' : undefined}
              className={rowClassesFor(payload.severity)}
            >
              <div className="flex items-center gap-1.5">
                <span
                  data-testid="diagnostic-flag-severity"
                  className={badgeClassesFor(payload.severity)}
                >
                  {t(`moderator.diagnostic.flags.severity.${payload.severity}`)}
                </span>
                <span data-testid="diagnostic-flag-kind-title" className="text-sm font-medium">
                  {localizedKindTitle}
                </span>
              </div>
              <p data-testid="diagnostic-flag-action-prose" className="mt-0.5 text-xs">
                {t(`diagnostics.${payload.kind}.action`)}
              </p>
            </li>
          );
        })}
      </ul>
      {/*
       * The flag pane WRAPS the shipped suggestions panel (Decision §D1):
       * the panel keeps showing the focused diagnostic and its
       * methodology-suggestion chips below the inventory list. The focused
       * flag (the row marked `data-focused="true"`) is the same diagnostic
       * the panel focuses — both derive from `orderActiveDiagnostics(...)[0]`.
       */}
      <DiagnosticSuggestionsPanel sessionId={sessionId} />
    </section>
  );
}
