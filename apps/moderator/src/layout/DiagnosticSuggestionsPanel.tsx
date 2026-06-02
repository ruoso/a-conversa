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
// The chips are now LIVE (`mod_resolution_path_picker`): each is an
// enabled `<button>` whose `onClick` routes the `(move, diagnostic)`
// pair through `resolutionPlanForMove(...)` and dispatches the shipped
// affordance — enter a capture mode, open a proposal submenu, or (for
// the advisory / deferred-`break-edge` moves) focus the affected region
// only. The chip markup and the `data-suggestion-move` /
// `data-suggestion-diagnostic-kind` seams are preserved (Decision §D2 —
// flip `disabled`/`aria-disabled` + add `onClick`, no markup refactor).

import { useCallback, useMemo, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload, Event, WsDiagnosticSeverity } from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from '@a-conversa/shell';

import { useCaptureStore } from '../stores/captureStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { useWsStore } from '../ws/wsStore.js';
import { suggestionsForDiagnostic, type SuggestionMove } from '../graph/diagnosticSuggestions.js';
import { resolutionPlanForMove } from '../graph/resolutionPlan.js';
import { AxiomMarkSubmenu } from './AxiomMarkSubmenu.js';
import { EditWordingSubmenu } from './EditWordingSubmenu.js';
import { resolveProposalTargetWording } from './ProposalModeExitAffordance.js';
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

// Stable empty-events reference for the no-events baseline (same guard
// `<GraphCanvasPane>` / `<WarrantElicitationCapturePanel>` keep) so the
// selector doesn't return a fresh array per read and trip a re-render
// loop.
const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

const EMPTY_PANEL_CLASSES = 'rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs';

/**
 * What the inline target chooser dispatches once the moderator picks a
 * candidate node: either enter a capture mode on it, or open a proposal
 * submenu seeded with it.
 */
type ChooserFollowUp =
  | { readonly kind: 'mode-entry'; readonly mode: 'decompose' | 'warrant-elicitation' }
  | { readonly kind: 'submenu'; readonly submenu: 'axiom-mark' | 'edit-wording' };

/** Open inline-target-chooser state (Decision §D4). */
interface ChooserState {
  readonly candidateNodeIds: readonly string[];
  readonly followUp: ChooserFollowUp;
}

/** Open axiom-mark submenu state — cursor-anchored like the canvas's. */
interface AxiomSubmenuState {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

/** Open edit-wording submenu state — pre-fills the textarea. */
interface EditSubmenuState {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
  readonly currentWording: string;
}

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
  // Per-session events selector — feeds the axiom-mark submenu's
  // participant derivation and the edit-wording / chooser wording
  // resolution. Same reference-stable scoping as `<GraphCanvasPane>`.
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const requestCanvasFocus = useUiStore((state) => state.requestCanvasFocus);

  // Transient resolution surfaces (Decision §D4): at most one of the
  // inline target chooser / axiom-mark submenu / edit-wording submenu is
  // open at a time. A fresh chip click resets all three before opening
  // the new one.
  const [chooser, setChooser] = useState<ChooserState | null>(null);
  const [axiomSubmenu, setAxiomSubmenu] = useState<AxiomSubmenuState | null>(null);
  const [editSubmenu, setEditSubmenu] = useState<EditSubmenuState | null>(null);

  const closeSurfaces = useCallback(() => {
    setChooser(null);
    setAxiomSubmenu(null);
    setEditSubmenu(null);
  }, []);

  const enterMode = useCallback((mode: 'decompose' | 'warrant-elicitation', nodeId: string) => {
    const store = useCaptureStore.getState();
    if (mode === 'decompose') {
      store.enterDecomposeMode(nodeId);
    } else {
      store.enterWarrantElicitationMode(nodeId);
    }
  }, []);

  const openSubmenu = useCallback(
    (submenu: 'axiom-mark' | 'edit-wording', nodeId: string, x: number, y: number) => {
      if (submenu === 'axiom-mark') {
        setEditSubmenu(null);
        setAxiomSubmenu({ nodeId, x, y });
      } else {
        setAxiomSubmenu(null);
        setEditSubmenu({
          nodeId,
          x,
          y,
          currentWording: resolveProposalTargetWording(events, nodeId) ?? '',
        });
      }
    },
    [events],
  );

  const handleChipClick = useCallback(
    (move: SuggestionMove, focusedPayload: DiagnosticPayload, e: MouseEvent<HTMLButtonElement>) => {
      const plan = resolutionPlanForMove(move, focusedPayload);
      // Frame the affected region on every chip click (Constraint §5).
      requestCanvasFocus({ nodeIds: plan.focus.nodeIds, edgeIds: plan.focus.edgeIds });
      // Reset any surface left open by a prior chip before dispatching.
      closeSurfaces();
      if (plan.disposition === 'focus-only') {
        return;
      }
      const x = e.clientX;
      const y = e.clientY;
      if (plan.disposition === 'mode-entry') {
        if (plan.target.kind === 'direct') {
          enterMode(plan.mode, plan.target.nodeId);
        } else {
          setChooser({
            candidateNodeIds: plan.target.candidateNodeIds,
            followUp: { kind: 'mode-entry', mode: plan.mode },
          });
        }
        return;
      }
      // proposal-submenu
      if (plan.target.kind === 'direct') {
        openSubmenu(plan.submenu, plan.target.nodeId, x, y);
      } else {
        setChooser({
          candidateNodeIds: plan.target.candidateNodeIds,
          followUp: { kind: 'submenu', submenu: plan.submenu },
        });
      }
    },
    [requestCanvasFocus, closeSurfaces, enterMode, openSubmenu],
  );

  const handleCandidatePick = useCallback(
    (followUp: ChooserFollowUp, nodeId: string, e: MouseEvent<HTMLButtonElement>) => {
      setChooser(null);
      if (followUp.kind === 'mode-entry') {
        enterMode(followUp.mode, nodeId);
      } else {
        openSubmenu(followUp.submenu, nodeId, e.clientX, e.clientY);
      }
    },
    [enterMode, openSubmenu],
  );

  // Memoize the focused pick + the derived moves on the
  // `activeDiagnostics` map reference so a noisy re-render of
  // `<Operate>` doesn't churn the chip row. The `useWsStore` selector
  // already preserves the map reference across reads when no
  // diagnostic envelope landed.
  const { focused, moves } = useMemo(() => {
    const picked = pickFocusedDiagnostic(activeDiagnostics);
    if (picked === null) {
      return { focused: null as DiagnosticPayload | null, moves: [] as readonly SuggestionMove[] };
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
              data-testid={`diagnostic-suggestions-move-${move}`}
              data-suggestion-move={move}
              data-suggestion-diagnostic-kind={focused.kind}
              onClick={(e) => handleChipClick(move, focused, e)}
              className="rounded border border-slate-400 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              {t(`moderator.diagnostic.suggestions.move.${move}`)}
            </button>
          </li>
        ))}
      </ul>
      {chooser !== null ? (
        <div
          data-testid="diagnostic-resolution-chooser"
          role="group"
          aria-label={t('moderator.diagnostic.suggestions.chooser.header')}
          className="mt-2 rounded border border-slate-300 bg-white p-1.5"
        >
          <p
            data-testid="diagnostic-resolution-chooser-header"
            className="mb-1 text-xs font-medium text-slate-700"
          >
            {t('moderator.diagnostic.suggestions.chooser.header')}
          </p>
          <ul className="space-y-1">
            {chooser.candidateNodeIds.map((nodeId) => {
              const wording = resolveProposalTargetWording(events, nodeId);
              return (
                <li key={nodeId}>
                  <button
                    type="button"
                    data-testid={`diagnostic-resolution-chooser-candidate-${nodeId}`}
                    data-candidate-node-id={nodeId}
                    onClick={(e) => handleCandidatePick(chooser.followUp, nodeId, e)}
                    className="block w-full rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-900 hover:bg-slate-100"
                  >
                    {wording ?? nodeId}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            data-testid="diagnostic-resolution-chooser-cancel"
            onClick={() => setChooser(null)}
            className="mt-1 rounded px-2 py-0.5 text-xs text-slate-500 hover:text-slate-700"
          >
            {t('moderator.diagnostic.suggestions.chooser.cancel')}
          </button>
        </div>
      ) : null}
      {axiomSubmenu !== null ? (
        <AxiomMarkSubmenu
          nodeId={axiomSubmenu.nodeId}
          x={axiomSubmenu.x}
          y={axiomSubmenu.y}
          events={events}
          onClose={() => setAxiomSubmenu(null)}
        />
      ) : null}
      {editSubmenu !== null ? (
        <EditWordingSubmenu
          nodeId={editSubmenu.nodeId}
          x={editSubmenu.x}
          y={editSubmenu.y}
          currentWording={editSubmenu.currentWording}
          onClose={() => setEditSubmenu(null)}
        />
      ) : null}
    </section>
  );
}
