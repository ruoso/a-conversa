// `<DecomposeComponentsGrid>` — the N-row capture grid for the F2
// decompose flow.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Mounts inside the `bottom-strip-text-input` slot of
// `<BottomStripCapture>` when `mode === 'decompose'` via the route's
// conditional swap (Decision §3 of the refinement). Returns `null`
// when not in decompose mode so the bottom-strip slot's behaviour in
// other modes is unaffected.
//
// The grid renders N `<DecomposeComponentRow>` children (one per
// `useCaptureStore.decomposeComponents` slice entry) plus an "Add
// component" button that appends one empty row. Each row carries a
// per-row remove button that is disabled when the grid is at the
// minimum 2 rows; the "Add component" button is disabled when the
// grid is at the maximum 10 rows. The store's
// `addDecomposeComponent` / `removeDecomposeComponent` helpers also
// defend the invariants on direct calls.
//
// The grid reads `componentsLength` rather than the entire slice so
// it re-renders only when rows are added or removed; per-row state
// changes (text edits, classification picks) bypass the grid and
// re-render only the affected child via the child's own per-index
// selector.
//
// Decision §3 records why the grid lives in the `textInput` slot
// rather than a new scaffold slot: the bottom strip's flex-1 text
// input cell is the visually dominant region of the strip, the
// natural home for an N-row grid. The route collapses the
// `classificationPalette` and `edgeRoleSelector` slots to `null` in
// decompose mode so the grid can stretch across the strip's body
// width.

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAXIMUM_DECOMPOSE_COMPONENTS,
  MINIMUM_DECOMPOSE_COMPONENTS,
  useCaptureStore,
} from '../stores/captureStore';
import { DecomposeComponentRow } from './DecomposeComponentRow';

export function DecomposeComponentsGrid(): ReactElement | null {
  const { t } = useTranslation();

  const mode = useCaptureStore((s) => s.mode);
  const componentsLength = useCaptureStore((s) => s.decomposeComponents.length);
  const addDecomposeComponent = useCaptureStore((s) => s.addDecomposeComponent);
  const removeDecomposeComponent = useCaptureStore((s) => s.removeDecomposeComponent);

  // Visibility gate: render `null` when not in decompose mode. The
  // route's conditional swap also avoids mounting the grid outside
  // decompose mode, but this defensive gate keeps the component
  // honest if it's ever consumed from another site.
  if (mode !== 'decompose') return null;

  const canRemoveAny = componentsLength > MINIMUM_DECOMPOSE_COMPONENTS;
  const atMaximum = componentsLength >= MAXIMUM_DECOMPOSE_COMPONENTS;

  return (
    <div
      data-testid="decompose-components-grid"
      role="group"
      aria-label={t('moderator.decompose.components.classificationLegend')}
      className="flex w-full flex-col gap-2"
    >
      {Array.from({ length: componentsLength }, (_, index) => (
        <DecomposeComponentRow
          key={index}
          index={index}
          canRemove={canRemoveAny}
          onRemove={() => {
            removeDecomposeComponent(index);
          }}
        />
      ))}
      <button
        type="button"
        data-testid="decompose-components-add-row"
        onClick={addDecomposeComponent}
        disabled={atMaximum}
        className="self-start inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        + {t('moderator.decompose.components.addRow')}
      </button>
    </div>
  );
}
