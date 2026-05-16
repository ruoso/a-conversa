// `<EdgeRoleSelector>` — horizontal button row for the moderator's
// edge-role selection surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 3)
//
// Mounts inside `<CaptureTargetAndRole>` which fills the
// `bottom-strip-edge-role` sub-slot exposed by `<BottomStripCapture>`.
// Reads the in-progress `edgeRole` slice from `useCaptureStore` and
// writes back via `setEdgeRole` on every click — a shared-store-backed
// single-select button group, NOT component-local state. The downstream
// `mod_propose_action` consumer reads the slice alongside `text`,
// `classification`, and `targetEntityId` to assemble the multi-event
// proposal.
//
// Behaviour:
//
//   - Renders seven `<button>` children in the canonical `EDGE_ROLES`
//     order (`supports`, `rebuts`, `qualifies`, `bridges-from`,
//     `bridges-to`, `defines`, `contradicts`). Each button shows the
//     localized `methodology.edgeRole.<role>.label` text plus a `<kbd>`
//     chip displaying the uppercase English-mnemonic shortcut
//     (`S`/`R`/`Q`/`B`/`G`/`E`/`X`) per ADR 0024 +
//     `i18n_keyboard_shortcuts_policy`.
//   - **Visibility gate**: returns `null` when
//     `useCaptureStore.targetEntityId === null`. The semantic match for
//     "edge role" is "role on the edge connecting to a target" — there
//     is no role to pick when there is no target. The early-return runs
//     AFTER hook registration (rules-of-hooks).
//   - Click toggles: a new role selects; a re-click of the
//     currently-selected role toggles off (slice -> null). The re-click
//     "undo" idiom is recorded in the refinement Decision §4 (mirror of
//     `mod_classification_palette` Decision §4).
//   - Keyboard: a document-level listener wired via
//     `attachCaptureKeymap` from `./captureKeymap` fires
//     `setEdgeRole(role)` when the moderator presses the role's
//     mnemonic key with no modifier other than shift, no auto-repeat,
//     and no focus on an editable element. The listener does NOT
//     toggle off on a re-press; the asymmetry matches user intent
//     (re-press is more often an unintended bounce). The visibility
//     gate (`targetEntityId !== null`) is enforced inside the handler
//     closure so the keyboard binding tracks the visual gate.
//   - Visual selection state shows via two channels: `aria-pressed` on
//     each button AND a distinct Tailwind variant (filled blue for
//     selected, outline for unselected). The constants mirror
//     `<ClassificationPalette>`'s so the two single-select surfaces
//     read as a uniform composition in the bottom strip.
//   - Per-button `title` surfaces the localized
//     `methodology.edgeRole.<role>.description` for hover discoverability
//     (Decision §8). The description is the same content the canvas-side
//     hover popover renders for edges; the two surfaces share the
//     glossary entry.
//   - The component is presentation-only beyond the store write: it
//     does NOT emit any WS message, does NOT validate methodology
//     shape, does NOT touch any pane other than its own half of the
//     shared slot. The propose round-trip is `mod_propose_action`'s job.

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { EDGE_ROLE_TO_SHORTCUT, EDGE_ROLES, type EdgeRole } from '@a-conversa/i18n-catalogs';

import { useCaptureStore } from '../stores/captureStore';
import { attachCaptureKeymap, type CaptureKeymapHandlers } from './captureKeymap';

const SELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const UNSELECTED_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80';

export function EdgeRoleSelector(): ReactElement | null {
  const { t } = useTranslation();

  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const selected = useCaptureStore((s) => s.edgeRole);
  const setEdgeRole = useCaptureStore((s) => s.setEdgeRole);

  // Hold the latest target / selected / setter in a ref so the
  // document-level listener (attached once on mount) can read fresh
  // values without re-attaching on every render. The ref pattern
  // survives strict-mode double-mount and avoids the re-attach storm
  // during fast typing.
  const stateRef = useRef({ targetEntityId, selected, setEdgeRole });
  stateRef.current = { targetEntityId, selected, setEdgeRole };

  useEffect(() => {
    const handlers: CaptureKeymapHandlers = {
      onPickEdgeRole: (role) => {
        // Visibility-gate mirror: the keyboard binding tracks the
        // visual gate. If there is no target staged, the role binding
        // is inert (Decision §3 — the keymap module stays a pure
        // dispatch layer; the semantic gate lives with the consumer).
        if (stateRef.current.targetEntityId === null) {
          return;
        }
        // Re-press while the role is already selected is a no-op
        // (Decision §4 — keyboard re-press is more often an unintended
        // bounce than a deliberate undo).
        if (stateRef.current.selected === role) {
          return;
        }
        stateRef.current.setEdgeRole(role);
      },
    };
    const detach = attachCaptureKeymap(handlers);
    return detach;
  }, []);

  function handleClick(role: EdgeRole): void {
    if (selected === role) {
      // Re-click toggles off — Decision §4.
      setEdgeRole(null);
      return;
    }
    setEdgeRole(role);
  }

  // Early-return AFTER hook registration (rules-of-hooks). When no
  // target is staged the selector contributes no DOM; the slot collapses
  // to the chip alone. The keymap listener stays attached but its
  // handler short-circuits on the same gate (see useEffect above).
  if (targetEntityId === null) {
    return null;
  }

  return (
    <div
      data-testid="edge-role-selector"
      role="group"
      aria-label={t('moderator.edgeRolePalette.ariaLabel')}
      className="flex w-full flex-col gap-1"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="sr-only" data-testid="edge-role-selector-legend">
          {t('moderator.edgeRolePalette.legend')}
        </span>
        {EDGE_ROLES.map((role) => {
          const isSelected = selected === role;
          const shortcutKey = EDGE_ROLE_TO_SHORTCUT[role];
          const shortcutKeyUpper = shortcutKey.toUpperCase();
          const label = t(`methodology.edgeRole.${role}.label`);
          const description = t(`methodology.edgeRole.${role}.description`);
          const ariaLabel = t('moderator.edgeRolePalette.roleButtonAriaLabel', {
            label,
            key: shortcutKeyUpper,
          });
          return (
            <button
              key={role}
              type="button"
              data-testid={`edge-role-selector-button-${role}`}
              data-role={role}
              aria-pressed={isSelected}
              aria-label={ariaLabel}
              title={description}
              onClick={() => {
                handleClick(role);
              }}
              className={isSelected ? SELECTED_CLASSES : UNSELECTED_CLASSES}
            >
              <span>{label}</span>
              <kbd
                data-testid={`edge-role-selector-key-chip-${role}`}
                aria-hidden="true"
                className={KEY_CHIP_CLASSES}
              >
                {shortcutKeyUpper}
              </kbd>
            </button>
          );
        })}
      </div>
      <p data-testid="edge-role-selector-shortcut-hint" className="mt-1 text-xs text-slate-500">
        {t('moderator.edgeRolePalette.shortcutHint')}
      </p>
    </div>
  );
}
