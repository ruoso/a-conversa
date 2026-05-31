// `<MetaMoveCapturePanel>` — meta-move-mode capture surface mounted in
// the bottom-strip's `textInput` slot when `mode === 'meta-move'`.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
//             tasks/refinements/moderator-ui/mod_meta_move_kind_selector.md
// Design doc: docs/moderator-ui.md (F8 meta-move flow)
// Sibling: apps/moderator/src/layout/CaptureDefeaterCapturePanel.tsx
//
// Composes the three pieces the meta-move flow needs in the strip's
// textInput slot per Decision §1 + AC §6:
//
//   - `<CaptureTargetChip>` — reused as-is; auto-suggests the most-
//     recently-active node from the selection store; carries the
//     `targetEntityId` / `targetEntityKind` slices.
//   - `<MetaMoveKindSelector>` — landed by
//     `mod_meta_move_kind_selector`; reads / writes the
//     `metaMoveKind` slice via clicks or the `m`/`c`/`t` shortcuts.
//   - `<CaptureTextInput>` — reused as-is; reads / writes the F1 `text`
//     slice (Decision §5 — text slice reuse). The Cmd/Ctrl+Enter submit
//     callback fires the meta-move propose round-trip via
//     `useMetaMoveAction()`.
//
// Self-gates on `mode === 'meta-move'` (renders `null` otherwise) so
// direct unit-test invocations are deterministic.

import { type ReactElement } from 'react';

import { useCaptureStore } from '../stores/captureStore';
import { CaptureTargetChip } from './CaptureTargetChip';
import { CaptureTextInput } from './CaptureTextInput';
import { MetaMoveKindSelector } from './MetaMoveKindSelector';
import { useMetaMoveAction } from './useMetaMoveAction';

export function MetaMoveCapturePanel(): ReactElement | null {
  const mode = useCaptureStore((s) => s.mode);
  const { proposeMetaMove } = useMetaMoveAction();

  if (mode !== 'meta-move') {
    return null;
  }

  return (
    <section data-testid="meta-move-capture-pane" className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <CaptureTargetChip />
        <MetaMoveKindSelector />
      </div>
      <CaptureTextInput
        onSubmit={() => {
          void proposeMetaMove();
        }}
      />
    </section>
  );
}
