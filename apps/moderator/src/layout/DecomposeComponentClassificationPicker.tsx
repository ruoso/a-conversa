// `<DecomposeComponentClassificationPicker mode>` — per-row
// classification picker for the decompose- and interpretive-split-mode
// multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Parameterised by:
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Sibling pattern: apps/moderator/src/layout/ClassificationPalette.tsx
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Bound to the per-index slice
// `useCaptureStore.decomposeComponents[index].classification` or
// `useCaptureStore.interpretiveSplitReadings[index].classification`
// per the `mode` prop. The five-button visual vocabulary is shared
// with `<ClassificationPalette>`; the binding axis (per-index +
// per-mode) is the load-bearing differentiator.

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type MethodologyKind,
} from '@a-conversa/i18n-catalogs';

import { useCaptureStore } from '../stores/captureStore';
import type { StructuralProposalMode } from './ProposalModeExitAffordance';

const SELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const UNSELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80';

const MODE_CONFIG = {
  decompose: {
    testidPrefix: 'decompose-component-classification',
    classificationLegendKey: 'moderator.decompose.components.classificationLegend',
  },
  'interpretive-split': {
    testidPrefix: 'interpretive-split-reading-classification',
    classificationLegendKey: 'moderator.interpretiveSplit.readings.classificationLegend',
  },
} as const;

export interface DecomposeComponentClassificationPickerProps {
  /** Which proposal mode this picker serves. */
  mode: StructuralProposalMode;
  /** Zero-indexed row position in the active mode's slice. */
  index: number;
}

export function DecomposeComponentClassificationPicker(
  props: DecomposeComponentClassificationPickerProps,
): ReactElement {
  const { mode, index } = props;
  const { t } = useTranslation();

  const classification = useCaptureStore((s) =>
    mode === 'decompose'
      ? (s.decomposeComponents[index]?.classification ?? null)
      : (s.interpretiveSplitReadings[index]?.classification ?? null),
  );
  const setClassification = useCaptureStore((s) =>
    mode === 'decompose'
      ? s.setDecomposeComponentClassification
      : s.setInterpretiveSplitReadingClassification,
  );

  const config = MODE_CONFIG[mode];

  function handleClick(kind: MethodologyKind): void {
    if (classification === kind) {
      setClassification(index, null);
      return;
    }
    setClassification(index, kind);
  }

  return (
    <div
      role="group"
      aria-label={t(config.classificationLegendKey)}
      data-testid={`${config.testidPrefix}-${String(index)}`}
      className="flex flex-wrap items-center gap-1"
    >
      {METHODOLOGY_KINDS.map((kind) => {
        const isSelected = classification === kind;
        const shortcutKeyUpper = KIND_TO_SHORTCUT[kind].toUpperCase();
        const label = t(`methodology.kind.${kind}`);
        return (
          <button
            key={kind}
            type="button"
            data-testid={`${config.testidPrefix}-${String(index)}-button-${kind}`}
            data-kind={kind}
            aria-pressed={isSelected}
            onClick={() => {
              handleClick(kind);
            }}
            className={isSelected ? SELECTED_CLASSES : UNSELECTED_CLASSES}
          >
            <span>{label}</span>
            <kbd aria-hidden="true" className={KEY_CHIP_CLASSES}>
              {shortcutKeyUpper}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
