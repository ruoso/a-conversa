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
// **Each flag row is clickable (Decision §D3).** The row's inner content
// is wrapped in a real `<button>` that focuses the graph canvas on the
// diagnostic's affected region — it dispatches a `requestCanvasFocus`
// command onto `useUiStore`, which a thin effect inside the
// `<ReactFlowProvider>` (`useCanvasFocusEffect`) consumes to call
// `fitView`. The pane is in the right sidebar, OUTSIDE the provider, so
// it cannot call `fitView` directly (Decision §D1). Each row also stamps
// `data-diagnostic-affected-nodes` / `-edges` (the §D5 deferral from
// `mod_diagnostic_methodology_suggestions`, paid here) so the focus
// target is deterministically assertable. Clicking focuses the canvas
// ONLY — no selection, no order change; "focused" stays derived from
// the order's head (Decision §D6). Refinement:
// `mod_diagnostic_focus_action`.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { affectedEntities, diagnosticIdentityKey } from '@a-conversa/shell';

import { useUiStore } from '../stores/uiStore.js';
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

/** Stable, order-preserving de-dup. `affectedEntities` may repeat ids
 * (it documents that it does not deduplicate); the focus target and the
 * DOM seam both want each id once. */
function dedupe(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

export function DiagnosticFlagPane(props: DiagnosticFlagPaneProps): ReactElement {
  const { sessionId } = props;
  const { t } = useTranslation();
  const requestCanvasFocus = useUiStore((state) => state.requestCanvasFocus);
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
          // Affected entities for this row, deduped once and reused for
          // both the focus dispatch and the DOM seams so they can't drift.
          const affected = affectedEntities(payload);
          const affectedNodeIds = dedupe(affected.nodes);
          const affectedEdgeIds = dedupe(affected.edges);
          return (
            <li
              key={key}
              data-testid="diagnostic-flag-row"
              data-diagnostic-key={key}
              data-diagnostic-kind={payload.kind}
              data-diagnostic-severity={payload.severity}
              data-diagnostic-affected-nodes={affectedNodeIds.join(' ')}
              data-diagnostic-affected-edges={affectedEdgeIds.join(' ')}
              data-focused={isFocused ? 'true' : 'false'}
              aria-current={isFocused ? 'true' : undefined}
              className={rowClassesFor(payload.severity)}
            >
              <button
                type="button"
                data-testid="diagnostic-flag-focus-button"
                aria-label={t('moderator.diagnostic.flags.focusAria', {
                  title: localizedKindTitle,
                })}
                onClick={() =>
                  requestCanvasFocus({ nodeIds: affectedNodeIds, edgeIds: affectedEdgeIds })
                }
                className="w-full text-left"
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
              </button>
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
