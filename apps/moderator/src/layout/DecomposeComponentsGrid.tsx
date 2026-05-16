// `<DecomposeComponentsGrid mode>` — the N-row capture grid for the F2
// decompose and interpretive-split flows.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Parameterised by:
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//             (Decision §2 — parameterise by `mode` rather than duplicate).
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Mounts inside the `bottom-strip-text-input` slot of
// `<BottomStripCapture>` when `mode === 'decompose'` OR
// `mode === 'interpretive-split'` via the route's conditional swap.
// Returns `null` when not in the matching mode.
//
// The component is mode-parameterised by a `mode` prop. The store
// reads (`decomposeComponents` vs `interpretiveSplitReadings`), the
// per-mode add / remove helpers, the per-mode `data-testid`s, and the
// per-mode label keys all switch on `props.mode`. The per-mode files
// keep their `Decompose*` names per Decision §1 of
// mod_interpretive_split_mode (the filename rename lands with a future
// third caller).
//
// The grid renders N `<DecomposeComponentRow>` children threaded with
// the same `mode` prop.

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAXIMUM_DECOMPOSE_COMPONENTS,
  MINIMUM_DECOMPOSE_COMPONENTS,
  useCaptureStore,
} from '../stores/captureStore';
import { DecomposeComponentRow } from './DecomposeComponentRow';
import type { ProposalMode } from './ProposalModeExitAffordance';

export interface DecomposeComponentsGridProps {
  /**
   * Which proposal mode this grid serves. The store reads, the per-mode
   * helpers, the per-mode `data-testid`s, and the per-mode label keys
   * all switch on this prop.
   */
  mode: ProposalMode;
}

const MODE_CONFIG = {
  decompose: {
    rootTestid: 'decompose-components-grid',
    addRowTestid: 'decompose-components-add-row',
    classificationLegendKey: 'moderator.decompose.components.classificationLegend',
    addRowKey: 'moderator.decompose.components.addRow',
  },
  'interpretive-split': {
    rootTestid: 'interpretive-split-readings-grid',
    addRowTestid: 'interpretive-split-readings-add-row',
    classificationLegendKey: 'moderator.interpretiveSplit.readings.classificationLegend',
    addRowKey: 'moderator.interpretiveSplit.readings.addRow',
  },
} as const;

export function DecomposeComponentsGrid(props: DecomposeComponentsGridProps): ReactElement | null {
  const { mode: targetMode } = props;
  const { t } = useTranslation();

  const mode = useCaptureStore((s) => s.mode);
  const componentsLength = useCaptureStore((s) =>
    targetMode === 'decompose' ? s.decomposeComponents.length : s.interpretiveSplitReadings.length,
  );
  const addRow = useCaptureStore((s) =>
    targetMode === 'decompose' ? s.addDecomposeComponent : s.addInterpretiveSplitReading,
  );
  const removeRow = useCaptureStore((s) =>
    targetMode === 'decompose' ? s.removeDecomposeComponent : s.removeInterpretiveSplitReading,
  );

  if (mode !== targetMode) return null;

  const config = MODE_CONFIG[targetMode];
  const canRemoveAny = componentsLength > MINIMUM_DECOMPOSE_COMPONENTS;
  const atMaximum = componentsLength >= MAXIMUM_DECOMPOSE_COMPONENTS;

  return (
    <div
      data-testid={config.rootTestid}
      role="group"
      aria-label={t(config.classificationLegendKey)}
      className="flex w-full flex-col gap-2"
    >
      {Array.from({ length: componentsLength }, (_, index) => (
        <DecomposeComponentRow
          key={index}
          mode={targetMode}
          index={index}
          canRemove={canRemoveAny}
          onRemove={() => {
            removeRow(index);
          }}
        />
      ))}
      <button
        type="button"
        data-testid={config.addRowTestid}
        onClick={addRow}
        disabled={atMaximum}
        className="self-start inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        + {t(config.addRowKey)}
      </button>
    </div>
  );
}
