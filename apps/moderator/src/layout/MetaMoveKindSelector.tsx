// `<MetaMoveKindSelector>` — horizontal button row for the moderator's
// meta-move kind selection surface (reframe / scope-change / stance).
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_kind_selector.md
// Design doc: docs/moderator-ui.md (F8 meta-move flow)
//
// Mounts inside `<MetaMoveCapturePanel>` between the target chip and
// the text input. Reads the in-progress `metaMoveKind` slice from
// `useCaptureStore` and writes back via `setMetaMoveKind` on every
// click — a shared-store-backed single-select button group, NOT
// component-local state. The downstream `useMetaMoveAction()` consumer
// reads the slice alongside `text` + `targetEntityId` to assemble the
// meta-move proposal.
//
// Behaviour:
//
//   - Renders three `<button>` children in the canonical
//     `META_MOVE_KINDS` order (`reframe`, `scope-change`, `stance`).
//     Each button shows the localized
//     `methodology.annotationKind.<kind>` text (Decision §4 — the kind
//     labels are single-sourced with the annotation surface) plus a
//     `<kbd>` chip displaying the uppercase English-mnemonic shortcut
//     (`M`/`C`/`T`) per ADR 0024 + `i18n_keyboard_shortcuts_policy`.
//   - **No visibility gate.** Renders unconditionally inside the
//     `<MetaMoveCapturePanel>` regardless of whether a target node is
//     staged. Decision §2: meta-move always carries a kind (default
//     `'reframe'`); the moderator may want to pick the kind before
//     staging the target. The deliberate divergence from
//     `<EdgeRoleSelector>`, which gates on `targetEntityId`.
//   - Click toggles: a new kind selects; a re-click of the
//     currently-selected kind toggles off (slice → null). The re-click
//     "undo" idiom matches `mod_edge_role_selector` Decision §4 /
//     `mod_classification_palette` Decision §4. Toggle-off to `null`
//     surfaces the `kindMissing` validation reason and disables propose.
//   - Keyboard: a document-level listener wired via
//     `attachCaptureKeymap` from `./captureKeymap` fires
//     `setMetaMoveKind(kind)` when the moderator presses the kind's
//     mnemonic key with no modifier other than shift, no auto-repeat,
//     and no focus on an editable element. The listener does NOT
//     toggle off on a re-press (unintended-bounce protection —
//     Decision §3 — the asymmetry mirrors prior art).
//   - Visual selection state shows via two channels: `aria-pressed` on
//     each button AND a distinct Tailwind variant (filled blue for
//     selected, outline for unselected). The constants mirror
//     `<EdgeRoleSelector>` / `<ClassificationPalette>` so the three
//     single-select surfaces in the bottom strip read as a uniform
//     composition.
//   - The component is presentation-only beyond the store write: it
//     does NOT emit any WS message, does NOT validate the meta-move
//     shape, does NOT touch the propose round-trip — that's
//     `useMetaMoveAction()`'s job.

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  META_MOVE_KIND_TO_SHORTCUT,
  META_MOVE_KINDS,
  type MetaMoveKind,
} from '@a-conversa/i18n-catalogs';

import { useCaptureStore } from '../stores/captureStore';
import { attachCaptureKeymap, type CaptureKeymapHandlers } from './captureKeymap';

const SELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const UNSELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80';

export function MetaMoveKindSelector(): ReactElement {
  const { t } = useTranslation();

  const selected = useCaptureStore((s) => s.metaMoveKind);
  const setMetaMoveKind = useCaptureStore((s) => s.setMetaMoveKind);

  // Hold the latest selected / setter in a ref so the document-level
  // listener (attached once on mount) can read fresh values without
  // re-attaching on every render. The ref pattern survives strict-mode
  // double-mount and avoids the re-attach storm during fast typing.
  const stateRef = useRef({ selected, setMetaMoveKind });
  stateRef.current = { selected, setMetaMoveKind };

  useEffect(() => {
    const handlers: CaptureKeymapHandlers = {
      onPickMetaMoveKind: (kind) => {
        // Re-press while the kind is already selected is a no-op
        // (Decision §3 — keyboard re-press is more often an unintended
        // bounce than a deliberate undo; click-to-toggle remains the
        // explicit undo gesture).
        if (stateRef.current.selected === kind) {
          return;
        }
        stateRef.current.setMetaMoveKind(kind);
      },
    };
    const detach = attachCaptureKeymap(handlers);
    return detach;
  }, []);

  function handleClick(kind: MetaMoveKind): void {
    if (selected === kind) {
      // Re-click toggles off — Decision §3.
      setMetaMoveKind(null);
      return;
    }
    setMetaMoveKind(kind);
  }

  return (
    <div
      data-testid="meta-move-kind-selector"
      role="group"
      aria-label={t('moderator.metaMoveKindSelector.ariaLabel')}
      className="flex w-full flex-col gap-1"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="sr-only" data-testid="meta-move-kind-selector-legend">
          {t('moderator.metaMoveKindSelector.legend')}
        </span>
        {META_MOVE_KINDS.map((kind) => {
          const isSelected = selected === kind;
          const shortcutKey = META_MOVE_KIND_TO_SHORTCUT[kind];
          const shortcutKeyUpper = shortcutKey.toUpperCase();
          const label = t(`methodology.annotationKind.${kind}`);
          const ariaLabel = t('moderator.metaMoveKindSelector.kindButtonAriaLabel', {
            label,
            key: shortcutKeyUpper,
          });
          return (
            <button
              key={kind}
              type="button"
              data-testid={`meta-move-kind-selector-button-${kind}`}
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
                data-testid={`meta-move-kind-selector-key-chip-${kind}`}
                aria-hidden="true"
                className={KEY_CHIP_CLASSES}
              >
                {shortcutKeyUpper}
              </kbd>
            </button>
          );
        })}
      </div>
      <p
        data-testid="meta-move-kind-selector-shortcut-hint"
        className="mt-1 text-xs text-slate-500"
      >
        {t('moderator.metaMoveKindSelector.shortcutHint')}
      </p>
    </div>
  );
}
