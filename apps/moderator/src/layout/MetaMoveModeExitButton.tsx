// `<MetaMoveModeExitButton>` — meta-move-mode exit affordance.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
// Sibling: apps/moderator/src/layout/CaptureDefeaterModeExitButton.tsx
//          apps/moderator/src/layout/DecomposeModeExitButton.tsx
//
// Unlike the structural / diagnostic-test modes, meta-move has no
// per-mode `targetEntityId` slice — it reuses the F1 `targetEntityId`
// (Decision §4 — the existing `<CaptureTargetChip>` carries the staged
// target, narrowed to `target_kind: 'node'` for v1). The exit button
// therefore does NOT surface a per-mode "target wording" overlay (the
// chip already shows the moderator the staged target); it surfaces just
// the × button + the Esc-key wiring.
//
// Self-gates on `mode === 'meta-move'` (renders `null` otherwise) so
// the route can mount it unconditionally alongside the other mode-exit
// affordances. The Esc-key wiring uses `attachCaptureKeymap` with the
// `onExitMode` handler — the keymap's mode-aware Escape branch routes
// the keystroke to this handler while `mode === 'meta-move'`.

import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCaptureStore } from '../stores/captureStore';
import { attachCaptureKeymap } from './captureKeymap';

export function MetaMoveModeExitButton(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const exitMetaMoveMode = useCaptureStore((s) => s.exitMetaMoveMode);

  // Attach the keymap's `onExitMode` handler only while in meta-move
  // mode. The keymap routes Escape to `onExitMode` when
  // `useCaptureStore.getState().mode === 'meta-move'` (mode-aware
  // priority — captureKeymap.ts mode-list amendment).
  useEffect(() => {
    if (mode !== 'meta-move') return undefined;
    return attachCaptureKeymap({ onExitMode: exitMetaMoveMode });
  }, [mode, exitMetaMoveMode]);

  if (mode !== 'meta-move') return null;

  return (
    <span
      data-testid="meta-move-mode-exit-container"
      className="ml-2 inline-flex items-center gap-2"
    >
      <button
        type="button"
        data-testid="meta-move-mode-exit"
        aria-label={t('moderator.metaMove.exit.ariaLabel')}
        title={t('moderator.metaMove.exit.tooltip')}
        onClick={exitMetaMoveMode}
        className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        ×
      </button>
    </span>
  );
}
