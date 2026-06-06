// `<KeymapHelpButton>` — sidebar button that opens the `?`-toggled
// keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Mounts beside `<SnapshotActionButton>` inside the `rightSidebar` slot
// of `<OperateLayout>` so the cheat-sheet is reachable by pointer as
// well as by the `?` chord. Single click flips
// `useKeymapHelpStore.isOpen` to true; the overlay that observes the
// flag is `<KeymapHelpMount>`.
//
// Styling matches `<SnapshotActionButton>` (the sibling sidebar action)
// for visual consistency; the `?` glyph hint mirrors that button's
// shortcut-hint chip.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useKeymapHelpStore } from './useKeymapHelpStore';

const BUTTON_CLASSES =
  'flex w-full items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export function KeymapHelpButton(): ReactElement {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="keymap-help-button"
      aria-label={t('moderator.globalKeymap.helpLabel')}
      onClick={() => {
        useKeymapHelpStore.getState().open();
      }}
      className={BUTTON_CLASSES}
    >
      <span>{t('moderator.globalKeymap.helpLabel')}</span>
      <span
        aria-hidden="true"
        data-testid="keymap-help-button-shortcut-hint"
        className="ml-2 rounded border border-slate-300 bg-white px-1 text-[0.65rem] font-semibold leading-none text-slate-600"
      >
        ?
      </span>
    </button>
  );
}
