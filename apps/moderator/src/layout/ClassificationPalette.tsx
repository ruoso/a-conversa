// `<ClassificationPalette>` — horizontal button row for the
// moderator's statement-kind classification surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_classification_palette.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 2)
//
// Mounts into the `bottom-strip-classification` sub-slot exposed by
// `<BottomStripCapture>` (the scaffold from `mod_bottom_strip_capture`).
// Reads the in-progress `classification` slice from `useCaptureStore`
// and writes back via `setClassification` on every click — a
// shared-store-backed single-select button group, NOT component-local
// state. The downstream `mod_propose_action` consumer reads the slice
// alongside `text` and `targetEntityId` to assemble the multi-event
// proposal.
//
// Behaviour:
//
//   - Renders five `<button>` children in the canonical
//     `METHODOLOGY_KINDS` order (`fact`, `predictive`, `value`,
//     `normative`, `definitional`). Each button shows the localized
//     `methodology.kind.<kind>` label plus a `<kbd>` chip displaying
//     the uppercase English-mnemonic shortcut (`F` / `P` / `V` / `N`
//     / `D`) per ADR 0024 + `i18n_keyboard_shortcuts_policy`.
//   - Click toggles: a new kind selects; a re-click of the
//     currently-selected kind toggles off (slice -> null). The
//     re-click "undo" idiom is recorded in the refinement Decisions §4.
//   - Keyboard: a document-level listener wired via
//     `attachCaptureKeymap` from `./captureKeymap` fires
//     `setClassification(kind)` when the moderator presses the kind's
//     mnemonic key with no modifier other than shift, no auto-repeat,
//     and no focus on an editable element. The listener does NOT
//     toggle off on a re-press — the asymmetry vs. click matches user
//     intent (re-press is more often an unintended bounce; re-click is
//     a deliberate undo).
//   - Visual selection state shows via two channels: `aria-pressed` on
//     each button (canonical WAI-ARIA toggle-button attribute) AND a
//     distinct Tailwind variant (filled blue for selected, outline for
//     unselected). Both reach WCAG AA contrast at the 14 px base font
//     size (selected ≈ 8.59:1, unselected ≈ 11.96:1).
//   - The component is presentation-only beyond the store write: it
//     does NOT emit any WS message, does NOT validate methodology
//     shape, does NOT touch any pane other than its own slot. The
//     propose round-trip is `mod_propose_action`'s job.
//
// The handlers are passed to `attachCaptureKeymap` via a `useRef` so
// the document-level listener attaches once on mount and reads the
// latest `setClassification` from the ref on every keystroke — the
// ref-then-listener pattern that survives React strict-mode
// double-mount.

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type MethodologyKind,
} from '@a-conversa/i18n-catalogs';

import { useCaptureStore } from '../stores/captureStore';
import { attachCaptureKeymap, type CaptureKeymapHandlers } from './captureKeymap';

const SELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const UNSELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80';

export function ClassificationPalette(): ReactElement {
  const { t } = useTranslation();

  const selected = useCaptureStore((state) => state.classification);
  const setClassification = useCaptureStore((state) => state.setClassification);

  // Hold the latest selected + setter in a ref so the document-level
  // listener (attached once on mount) can read fresh values without
  // re-attaching on every render. The ref pattern survives strict-mode
  // double-mount and avoids the re-attach storm during fast typing.
  const stateRef = useRef({ selected, setClassification });
  stateRef.current = { selected, setClassification };

  useEffect(() => {
    const handlers: CaptureKeymapHandlers = {
      onPickKind: (kind) => {
        // Re-press while the kind is already selected is a no-op
        // (Decision §4 — keyboard re-press is more often an
        // unintended bounce than a deliberate undo).
        if (stateRef.current.selected === kind) {
          return;
        }
        stateRef.current.setClassification(kind);
      },
    };
    const detach = attachCaptureKeymap(handlers);
    return detach;
  }, []);

  function handleClick(kind: MethodologyKind): void {
    if (selected === kind) {
      // Re-click toggles off — Decision §4.
      setClassification(null);
      return;
    }
    setClassification(kind);
  }

  return (
    <div data-testid="classification-palette" className="flex w-full flex-col gap-1">
      <div
        role="group"
        aria-label={t('moderator.classificationPalette.ariaLabel')}
        className="flex flex-wrap items-center gap-1"
      >
        <span className="sr-only" data-testid="classification-palette-legend">
          {t('moderator.classificationPalette.legend')}
        </span>
        {METHODOLOGY_KINDS.map((kind) => {
          const isSelected = selected === kind;
          const shortcutKey = KIND_TO_SHORTCUT[kind];
          const shortcutKeyUpper = shortcutKey.toUpperCase();
          const label = t(`methodology.kind.${kind}`);
          const ariaLabel = t('moderator.classificationPalette.kindButtonAriaLabel', {
            label,
            key: shortcutKeyUpper,
          });
          return (
            <button
              key={kind}
              type="button"
              data-testid={`classification-palette-button-${kind}`}
              data-kind={kind}
              aria-pressed={isSelected}
              aria-label={ariaLabel}
              onClick={() => {
                handleClick(kind);
              }}
              className={isSelected ? SELECTED_CLASSES : UNSELECTED_CLASSES}
            >
              <span>{label}</span>
              <kbd
                data-testid={`classification-palette-key-chip-${kind}`}
                aria-hidden="true"
                className={KEY_CHIP_CLASSES}
              >
                {shortcutKeyUpper}
              </kbd>
            </button>
          );
        })}
      </div>
      <p data-testid="classification-palette-shortcut-hint" className="mt-1 text-xs text-slate-500">
        {t('moderator.classificationPalette.shortcutHint')}
      </p>
    </div>
  );
}
