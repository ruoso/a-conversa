// `<SnapshotActionButton>` — sidebar button that opens the F10
// snapshot-label flow.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
// Design doc: docs/moderator-ui.md (F10 Snapshot a segment, lines 156–162)
//
// Mounts as a sibling above `<RightSidebar />` inside the `rightSidebar`
// slot of `<OperateLayout>` (Decision §2.b). Single click flips
// `useSnapshotFlowStore.isLabelInputOpen` to true; the modal that
// observes that flag is the responsibility of `mod_snapshot_label_input`
// (sibling task — not yet refined).
//
// The button is always live on the operate route. No disabled state in
// v1 (Decision §5): snapshot creation is moderator-authority work and
// the server's reject path is the safety net. The label-input task's
// WS dispatch will propagate any `not-a-moderator` error inline.
//
// Tailwind palette matches the right-sidebar pane headers
// (`bg-slate-100` + `hover:bg-slate-200`) plus a bottom border to
// visually delimit the action from the stacked pane scaffold below.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useSnapshotFlowStore } from './useSnapshotFlowStore';

const BUTTON_CLASSES =
  'flex w-full items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export function SnapshotActionButton(): ReactElement {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="snapshot-action-button"
      aria-label={t('moderator.snapshotAction.ariaLabel')}
      onClick={() => {
        useSnapshotFlowStore.getState().open();
      }}
      className={BUTTON_CLASSES}
    >
      <span>{t('moderator.snapshotAction.label')}</span>
      <span
        aria-hidden="true"
        data-testid="snapshot-action-shortcut-hint"
        className="ml-2 rounded border border-slate-300 bg-white px-1 text-[0.65rem] font-semibold leading-none text-slate-600"
      >
        {t('moderator.snapshotAction.shortcutHint')}
      </span>
    </button>
  );
}
