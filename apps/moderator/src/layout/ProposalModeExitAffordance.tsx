// `<ProposalModeExitAffordance mode>` — shared exit affordance + target
// wording overlay for the decompose / interpretive-split modes.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// (extract-and-share — Decision §2)
// Sibling refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Renders as a sibling to `<ModeBanner>` inside the
// `bottom-strip-mode-banner` slot of `<BottomStripCapture>`. The body
// is parameterised by `props.mode`: the visibility gate, the
// target-node-id slice, the exit helper, the i18n key namespaces, and
// the per-mode `data-testid`s all switch on the prop. Two per-mode
// thin wrappers (`<DecomposeModeExitButton>`,
// `<InterpretiveSplitModeExitButton>`) instantiate this shape so the
// route can mount both unconditionally — each renders `null` outside
// its matching mode.

import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { Event } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { attachCaptureKeymap } from './captureKeymap';

export type ProposalMode =
  | 'decompose'
  | 'interpretive-split'
  | 'operationalization'
  | 'warrant-elicitation';

/**
 * Narrower type for the structural-restructure proposal modes — decompose
 * + interpretive-split share the multi-row-grid + propose-action shape;
 * operationalization + warrant-elicitation are diagnostic-test modes with
 * a different body and no propose-action wiring (the F2 / F4 / F5 / F6 /
 * F7 owners replace the placeholder route chips). Components that work
 * over the multi-row grid (`<DecomposeComponentsGrid>`,
 * `<DecomposeComponentRow>`, the per-mode classification picker + text
 * input, `<ProposeAction>`, the `useProposeProposalAction` hook) accept
 * this narrower type so they don't have to handle the diagnostic-mode
 * branches.
 *
 * Introduced by `tasks/refinements/moderator-ui/mod_operationalization_mode.md`
 * Decision §D2 when the `ProposalMode` union widened from 2 to 3 modes;
 * the exclusion list widened to also drop `'warrant-elicitation'` per
 * `tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md`
 * Decision §D2 so the alias's *meaning* ("structural-restructure modes
 * only") is preserved across the 4-mode union.
 */
export type StructuralProposalMode = Exclude<
  ProposalMode,
  'operationalization' | 'warrant-elicitation'
>;

/**
 * Resolve the operator-facing wording for the proposal-target node by
 * walking the supplied events array for the matching `node-created`
 * event. Returns the payload's `wording`, or `null` when no matching
 * event has reached the projection yet (a transient inconsistency that
 * the render-path tolerates by rendering an empty overlay).
 *
 * Mode-neutral name. Re-exported as `resolveDecomposeTargetWording`
 * from `DecomposeModeExitButton.tsx` for source-stable consumers.
 *
 * Exported for direct unit testing.
 */
export function resolveProposalTargetWording(
  events: readonly Event[],
  nodeId: string | null,
): string | null {
  if (nodeId === null) return null;
  for (const event of events) {
    if (event.kind === 'node-created' && event.payload.node_id === nodeId) {
      return event.payload.wording;
    }
  }
  return null;
}

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

/**
 * Per-mode catalog-key bundle. Resolved once per render; each lookup
 * picks the right key for the active mode and forwards through
 * `useTranslation()`. Keys live under the
 * `moderator.{decompose,interpretiveSplit}.{exit,banner}.*`
 * sub-namespaces.
 */
const MODE_KEYS = {
  decompose: {
    ariaLabel: 'moderator.decompose.exit.ariaLabel',
    tooltip: 'moderator.decompose.exit.tooltip',
    targetWording: 'moderator.decompose.banner.targetWording',
  },
  'interpretive-split': {
    ariaLabel: 'moderator.interpretiveSplit.exit.ariaLabel',
    tooltip: 'moderator.interpretiveSplit.exit.tooltip',
    targetWording: 'moderator.interpretiveSplit.banner.targetWording',
  },
  operationalization: {
    ariaLabel: 'moderator.operationalization.exit.ariaLabel',
    tooltip: 'moderator.operationalization.exit.tooltip',
    targetWording: 'moderator.operationalization.banner.targetWording',
  },
  'warrant-elicitation': {
    ariaLabel: 'moderator.warrantElicitation.exit.ariaLabel',
    tooltip: 'moderator.warrantElicitation.exit.tooltip',
    targetWording: 'moderator.warrantElicitation.banner.targetWording',
  },
} as const;

export interface ProposalModeExitAffordanceProps {
  mode: ProposalMode;
}

export function ProposalModeExitAffordance(
  props: ProposalModeExitAffordanceProps,
): ReactElement | null {
  const { mode: targetMode } = props;
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  // 4-arm switch per mod_warrant_elicitation_mode.md Decision §D2 —
  // a switch is more readable than a 4-arm nested ternary and pays off
  // if a fifth mode ever lands.
  const targetNodeId = useCaptureStore((s) => {
    switch (targetMode) {
      case 'decompose':
        return s.decomposeTargetNodeId;
      case 'interpretive-split':
        return s.interpretiveSplitTargetNodeId;
      case 'operationalization':
        return s.operationalizationTargetNodeId;
      case 'warrant-elicitation':
        return s.warrantElicitationTargetNodeId;
    }
  });
  const exitMode = useCaptureStore((s) => {
    switch (targetMode) {
      case 'decompose':
        return s.exitDecomposeMode;
      case 'interpretive-split':
        return s.exitInterpretiveSplitMode;
      case 'operationalization':
        return s.exitOperationalizationMode;
      case 'warrant-elicitation':
        return s.exitWarrantElicitationMode;
    }
  });
  const { id: sessionId = '' } = useParams<{ id: string }>();
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);

  // Attach the keymap's `onExitMode` handler only while in the
  // matching mode. The keymap routes Escape to `onExitMode` when
  // `useCaptureStore.getState().mode === 'decompose'` OR
  // `=== 'interpretive-split'` (mode-aware priority — Decision §5 of
  // mod_decompose_mode.md, generalised by mod_interpretive_split_mode
  // Decision §8).
  useEffect(() => {
    if (mode !== targetMode) return undefined;
    return attachCaptureKeymap({ onExitMode: exitMode });
  }, [mode, targetMode, exitMode]);

  if (mode !== targetMode) return null;

  const keys = MODE_KEYS[targetMode];
  const wording = resolveProposalTargetWording(events, targetNodeId);
  const testidPrefix = targetMode;

  return (
    <span
      data-testid={`${testidPrefix}-mode-exit-container`}
      className="ml-2 inline-flex items-center gap-2"
    >
      <span data-testid={`${testidPrefix}-mode-target-wording`} className="text-xs text-slate-600">
        {wording === null ? '' : t(keys.targetWording, { nodeWording: wording })}
      </span>
      <button
        type="button"
        data-testid={`${testidPrefix}-mode-exit`}
        aria-label={t(keys.ariaLabel)}
        title={t(keys.tooltip)}
        onClick={exitMode}
        className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        ×
      </button>
    </span>
  );
}
