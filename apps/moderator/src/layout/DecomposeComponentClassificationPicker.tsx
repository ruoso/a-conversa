// `<DecomposeComponentClassificationPicker>` — per-row classification
// picker for the decompose-mode multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Sibling pattern: apps/moderator/src/layout/ClassificationPalette.tsx
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Mounts inside `<DecomposeComponentRow>`; bound to the per-index
// slice `useCaptureStore.decomposeComponents[index].classification`.
// The variant mirrors `<ClassificationPalette>`'s visual vocabulary —
// five buttons over `METHODOLOGY_KINDS` with localized
// `methodology.kind.<kind>` labels + uppercase mnemonic chips, the
// `aria-pressed` selection signaling, the Tailwind selected /
// unselected variants — and differs along the binding axis (per-row
// rather than the global F1 slice).
//
// Decision §4 of the refinement records why this is a sibling
// component rather than a parameterized version of
// `<ClassificationPalette>`: the binding to the store seam (one slice
// vs. per-row index) is the load-bearing axis; parameterizing the F1
// palette to serve both would push complexity into the F1 component
// for a sibling use-case.
//
// Per Decision §6, the per-row picker installs NO document-level
// keyboard listener (no `attachCaptureKeymap`). The F1 palette's
// listener is unmounted when the route swaps the slot's content for
// the decompose grid; the per-row pickers are click-only / tab-only
// in v1.
//
// The Tailwind class constants are duplicated module-locally from
// `ClassificationPalette.tsx` per Decision §4 — the strings are
// tightly coupled to each component's layout; extracting them into a
// shared module is a YAGNI extraction until a third caller appears
// (likely the interpretive-split picker).

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type MethodologyKind,
} from '@a-conversa/i18n-catalogs';

import { useCaptureStore } from '../stores/captureStore';

const SELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const UNSELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80';

export interface DecomposeComponentClassificationPickerProps {
  /** Zero-indexed row position in `useCaptureStore.decomposeComponents`. */
  index: number;
}

export function DecomposeComponentClassificationPicker(
  props: DecomposeComponentClassificationPickerProps,
): ReactElement {
  const { index } = props;
  const { t } = useTranslation();

  const classification = useCaptureStore(
    (s) => s.decomposeComponents[index]?.classification ?? null,
  );
  const setDecomposeComponentClassification = useCaptureStore(
    (s) => s.setDecomposeComponentClassification,
  );

  function handleClick(kind: MethodologyKind): void {
    if (classification === kind) {
      // Re-click toggles off — same idiom as `<ClassificationPalette>`
      // Decision §4 (mod_classification_palette).
      setDecomposeComponentClassification(index, null);
      return;
    }
    setDecomposeComponentClassification(index, kind);
  }

  return (
    <div
      role="group"
      aria-label={t('moderator.decompose.components.classificationLegend')}
      data-testid={`decompose-component-classification-${String(index)}`}
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
            data-testid={`decompose-component-classification-${String(index)}-button-${kind}`}
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
