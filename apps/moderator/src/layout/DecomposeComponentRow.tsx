// `<DecomposeComponentRow mode>` — one row of the decompose- or
// interpretive-split-mode multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Parameterised by:
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Composes the per-row label + the per-row text input + the per-row
// classification picker + the per-row remove button as a single row.
// All four threads receive the same `mode` prop; the per-row label key
// and the remove-row aria key are resolved per-mode here (the row
// owns the visible label / aria text). Per-mode `data-testid`s on the
// row + label switch on `props.mode`.

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { DecomposeComponentClassificationPicker } from './DecomposeComponentClassificationPicker';
import { DecomposeComponentTextInput } from './DecomposeComponentTextInput';
import type { ProposalMode } from './ProposalModeExitAffordance';

const MODE_KEYS = {
  decompose: {
    rowLabel: 'moderator.decompose.components.rowLabel',
    removeRowAria: 'moderator.decompose.components.removeRowAria',
    rowTestidPrefix: 'decompose-component-row',
    rowLabelTestidPrefix: 'decompose-component-row-label',
    rowRemoveTestidPrefix: 'decompose-component-row-remove',
  },
  'interpretive-split': {
    rowLabel: 'moderator.interpretiveSplit.readings.rowLabel',
    removeRowAria: 'moderator.interpretiveSplit.readings.removeRowAria',
    rowTestidPrefix: 'interpretive-split-reading-row',
    rowLabelTestidPrefix: 'interpretive-split-reading-row-label',
    rowRemoveTestidPrefix: 'interpretive-split-reading-row-remove',
  },
} as const;

export interface DecomposeComponentRowProps {
  /** Which proposal mode this row serves. */
  mode: ProposalMode;
  /** Zero-indexed row position in the active mode's slice. */
  index: number;
  /**
   * Whether this row's remove button is enabled. The grid passes
   * `componentsLength > MINIMUM_DECOMPOSE_COMPONENTS`; rows in a
   * 2-row grid have disabled remove buttons (the store's per-mode
   * remove helper no-ops at the minimum, but the UI disables the
   * button proactively for early feedback).
   */
  canRemove: boolean;
  /** Fired when the moderator clicks the per-row remove button. */
  onRemove: () => void;
}

export function DecomposeComponentRow(props: DecomposeComponentRowProps): ReactElement {
  const { mode, index, canRemove, onRemove } = props;
  const { t } = useTranslation();

  const keys = MODE_KEYS[mode];
  const indexLabel = t(keys.rowLabel, { index: index + 1 });
  const removeAria = t(keys.removeRowAria, { index: index + 1 });

  return (
    <div
      data-testid={`${keys.rowTestidPrefix}-${String(index)}`}
      className="flex w-full items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1"
    >
      <span
        data-testid={`${keys.rowLabelTestidPrefix}-${String(index)}`}
        className="mt-1 inline-flex h-5 min-w-[5rem] items-center text-xs font-medium text-slate-700"
      >
        {indexLabel}
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <DecomposeComponentTextInput mode={mode} index={index} />
        <DecomposeComponentClassificationPicker mode={mode} index={index} />
      </div>
      <button
        type="button"
        data-testid={`${keys.rowRemoveTestidPrefix}-${String(index)}`}
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={removeAria}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        ×
      </button>
    </div>
  );
}
