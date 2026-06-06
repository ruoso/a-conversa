// `useKeymapHelpShortcut` — the bare-`?` document-level toggle for the
// keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Mounted once at `<OperateRoute>` scope so `?` opens the cheat-sheet
// whenever the moderator is operating a session and detaches when the
// route unmounts.
//
// This is a NAVIGATION chord with the opposite bail contract from the
// `useGlobalKeymap` action-chord family (Decision §2). `Cmd/Ctrl+S`
// fires while typing (no editable-target bail); `?` must NOT — typing
// `?` into the capture wording is text entry, not a request for help.
// Folding two opposite bail contracts into one dispatcher would muddy
// it, so the `?` toggle lives in this tiny dedicated hook.
//
// Bail rules, in order:
//   1. Bail on `event.repeat` — a held key is not a deliberate toggle.
//   2. Bail when a platform / alt modifier is held — `⌘?` / `Ctrl+?` /
//      `Alt+?` are different chords the host may bind; only the bare
//      `?` toggles the overlay.
//   3. Bail when `document.activeElement` matches
//      `EDITABLE_TARGET_SELECTOR` — the keystroke belongs to the
//      editing surface (the canonical multi-focus shortcut guard).
//   4. Match `event.key === '?'` (shift is implicit in producing `?`,
//      so shift is NOT separately enforced) and toggle the store.

import { useEffect } from 'react';

import { EDITABLE_TARGET_SELECTOR } from './captureKeymap';
import { useKeymapHelpStore } from './useKeymapHelpStore';

export function useKeymapHelpShortcut(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // 1. Repeat-skip.
      if (event.repeat) return;

      // 2. Modifier-bail — only the bare `?` toggles; `⌘?` / `Ctrl+?` /
      // `Alt+?` pass through to whatever the host has bound.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // 3. Editable-target guard — typing `?` into an input / textarea /
      // contenteditable is text entry, not a help request.
      const active = document.activeElement;
      if (
        active !== null &&
        active instanceof Element &&
        active.matches(EDITABLE_TARGET_SELECTOR)
      ) {
        return;
      }

      // 4. Match the bare `?` and toggle.
      if (event.key !== '?') return;
      event.preventDefault();
      useKeymapHelpStore.getState().toggle();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
