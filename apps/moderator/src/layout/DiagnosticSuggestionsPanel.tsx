// `<DiagnosticSuggestionsPanel>` — methodology-suggestion panel for the
// `'diagnostic-flags'` slot in `<RightSidebar>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md
// Design doc:  docs/moderator-ui.md § F7 (L114-123)
//
// Surfaces, for the focused active diagnostic, the methodology's
// catalog of next-action moves (per `suggestionsForDiagnostic`) as a
// row of disabled-placeholder action chips. The chip seams
// (`data-suggestion-move`, `data-suggestion-diagnostic-kind`) are the
// stable contract the F7 `mod_resolution_path_picker` will switch on
// when it wires the chips to real propose-action handlers.
//
// **Focus-pick rule** (single-diagnostic in-leaf, per Decision §D2):
// blocking before advisory, then by ascending sequence (oldest blocking
// first). Identity ties broken by `diagnosticIdentityKey(payload)`
// lexicographic order. The full multi-diagnostic flag list is owned by
// `mod_diagnostic_flag_pane`; this leaf focuses on one at a time so
// that future task can wrap or replace the panel without re-arranging
// the layout.
//
// The chips are inert placeholders (disabled `<button>` with
// `aria-disabled="true"`) — same pattern as `<IsOughtPrompt>`'s
// decompose / warrant actions. The picker landing in F7 will flip
// `disabled={false}` and add `onClick` handlers in one diff.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload, WsDiagnosticSeverity } from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore.js';
import { suggestionsForDiagnostic } from '../graph/diagnosticSuggestions.js';
import {
  ADVISORY_PANEL_CLASSES,
  BLOCKING_PANEL_CLASSES,
  orderActiveDiagnostics,
} from './orderActiveDiagnostics.js';

export interface DiagnosticSuggestionsPanelProps {
  readonly sessionId: string;
}

// Stable empty-map reference for the no-active-diagnostic baseline.
// Without this the selector would return a fresh `Map` per call and
// trip an infinite re-render loop (the Zustand strict-equality default
// would consider every read different). Mirrors the
// `EMPTY_ACTIVE_DIAGNOSTICS` constant `<GraphCanvasPane>` keeps.
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

const EMPTY_PANEL_CLASSES = 'rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs';

function panelClassesFor(severity: WsDiagnosticSeverity): string {
  return severity === 'blocking' ? BLOCKING_PANEL_CLASSES : ADVISORY_PANEL_CLASSES;
}

/**
 * Pick the focused diagnostic from the active-diagnostics map per
 * the refinement's order rule: blocking before advisory, then by
 * ascending `sequence` (oldest first), then by `diagnosticIdentityKey`
 * lexicographic order (deterministic tiebreak).
 *
 * Defined as the head of the shared `orderActiveDiagnostics(...)` total
 * order so the focus-pick and the flag-pane list (which lists the same
 * order top-to-bottom) can never disagree about which flag is "first"
 * (`mod_diagnostic_flag_pane` Decision §D2).
 *
 * Returns `null` when the map is empty.
 */
function pickFocusedDiagnostic(
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
): DiagnosticPayload | null {
  return orderActiveDiagnostics(activeDiagnostics)[0] ?? null;
}

export function DiagnosticSuggestionsPanel(props: DiagnosticSuggestionsPanelProps): ReactElement {
  const { sessionId } = props;
  const { t } = useTranslation();
  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS,
  );

  // Memoize the focused pick + the derived moves on the
  // `activeDiagnostics` map reference so a noisy re-render of
  // `<Operate>` doesn't churn the chip row. The `useWsStore` selector
  // already preserves the map reference across reads when no
  // diagnostic envelope landed.
  const { focused, moves } = useMemo(() => {
    const picked = pickFocusedDiagnostic(activeDiagnostics);
    if (picked === null) {
      return { focused: null as DiagnosticPayload | null, moves: [] as readonly string[] };
    }
    return { focused: picked, moves: suggestionsForDiagnostic(picked) };
  }, [activeDiagnostics]);

  if (focused === null) {
    return (
      <section
        data-testid="diagnostic-suggestions-panel"
        data-diagnostic-kind="none"
        role="region"
        aria-label={t('moderator.diagnostic.suggestions.panelHeader')}
        className={EMPTY_PANEL_CLASSES}
      >
        <p data-testid="diagnostic-suggestions-empty" className="text-xs italic text-slate-500">
          {t('moderator.diagnostic.suggestions.empty')}
        </p>
      </section>
    );
  }

  const localizedKindTitle = t(`diagnostics.${focused.kind}.title`);
  return (
    <section
      data-testid="diagnostic-suggestions-panel"
      data-diagnostic-kind={focused.kind}
      data-diagnostic-severity={focused.severity}
      data-diagnostic-key={diagnosticIdentityKey(focused)}
      role="region"
      aria-label={t('moderator.diagnostic.suggestions.panelAriaLabel', {
        kind: localizedKindTitle,
      })}
      className={panelClassesFor(focused.severity)}
    >
      <header data-testid="diagnostic-suggestions-header" className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide">
          {t('moderator.diagnostic.suggestions.panelHeader')}
        </h3>
        <p data-testid="diagnostic-suggestions-kind-title" className="text-sm font-medium">
          {localizedKindTitle}
        </p>
        <p data-testid="diagnostic-suggestions-action-prose" className="text-xs">
          {t(`diagnostics.${focused.kind}.action`)}
        </p>
      </header>
      <ul data-testid="diagnostic-suggestions-moves" className="mt-1.5 flex flex-wrap gap-1.5">
        {moves.map((move) => (
          <li key={move}>
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid={`diagnostic-suggestions-move-${move}`}
              data-suggestion-move={move}
              data-suggestion-diagnostic-kind={focused.kind}
              className="rounded border border-slate-400 bg-white px-2 py-0.5 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {t(`moderator.diagnostic.suggestions.move.${move}`)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
