// `<DecomposeComponentRow>` — one row of the decompose-mode
// multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Composes the per-row label + the per-row text input + the per-row
// classification picker + the per-row remove button as a single row.
// The text input and the picker each read / write their slice through
// per-index store selectors; the remove button calls the supplied
// `onRemove` callback. This component is presentation-only: no store
// reads beyond what its children make on their own.
//
// The row is keyed by index in the parent grid; the per-index store
// selectors carry the load-bearing state binding (one slice index per
// child component).

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { DecomposeComponentClassificationPicker } from './DecomposeComponentClassificationPicker';
import { DecomposeComponentTextInput } from './DecomposeComponentTextInput';

export interface DecomposeComponentRowProps {
  /** Zero-indexed row position in `useCaptureStore.decomposeComponents`. */
  index: number;
  /**
   * Whether this row's remove button is enabled. The grid passes
   * `componentsLength > MINIMUM_DECOMPOSE_COMPONENTS`; rows in a
   * 2-row grid have disabled remove buttons (the store's
   * `removeDecomposeComponent` no-ops at the minimum, but the UI
   * disables the button proactively for early feedback).
   */
  canRemove: boolean;
  /** Fired when the moderator clicks the per-row remove button. */
  onRemove: () => void;
}

export function DecomposeComponentRow(props: DecomposeComponentRowProps): ReactElement {
  const { index, canRemove, onRemove } = props;
  const { t } = useTranslation();

  const indexLabel = t('moderator.decompose.components.rowLabel', {
    index: index + 1,
  });
  const removeAria = t('moderator.decompose.components.removeRowAria', {
    index: index + 1,
  });

  return (
    <div
      data-testid={`decompose-component-row-${String(index)}`}
      className="flex w-full items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1"
    >
      <span
        data-testid={`decompose-component-row-label-${String(index)}`}
        className="mt-1 inline-flex h-5 min-w-[5rem] items-center text-xs font-medium text-slate-700"
      >
        {indexLabel}
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <DecomposeComponentTextInput index={index} />
        <DecomposeComponentClassificationPicker index={index} />
      </div>
      <button
        type="button"
        data-testid={`decompose-component-row-remove-${String(index)}`}
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
