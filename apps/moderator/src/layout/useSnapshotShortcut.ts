// `useSnapshotShortcut` — document-level Cmd/Ctrl+S keydown listener
// that opens the F10 snapshot-label flow.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
//
// Mounted once at `<OperateRoute>` scope so the binding is alive
// whenever the moderator is operating a session and detaches when the
// route unmounts (returning `Cmd/Ctrl+S` to its default browser
// behaviour elsewhere in the shell). The listener calls
// `useSnapshotFlowStore.getState().open()` on match and
// `event.preventDefault()` to swallow the browser's "Save Page As…"
// dialog — the entire reason the user-agent chord is being repurposed.
//
// Bail rules (in order):
//
//   1. **Bail on `event.repeat`** — auto-repeat fires from a held key
//      MUST NOT bounce the modal open repeatedly. `open()` is
//      idempotent, but holding the count to one-per-physical-press
//      keeps the modal-open transition predictable for the downstream
//      label-input task.
//   2. **Require a platform-appropriate modifier**: macOS — `metaKey`
//      (Cmd); other platforms — `ctrlKey`. Shift is allowed
//      (`Cmd+Shift+S` still fires); `altKey` is not — it would
//      typically signal a different system gesture.
//   3. **Match `event.key.toLowerCase() === 's'`** so caps-lock /
//      shift don't break the binding.
//
// **No editable-target bail** — standard `Cmd+S` semantics fire even
// while typing into a textarea (Slack, GitHub, Gmail compose all
// preserve this). Differs from `captureKeymap.ts`'s single-letter
// shortcuts (`f`/`p`/`v`/`n`/`d`) which bail on editable-target
// because they would otherwise corrupt input. Decision §4.c records
// the rationale.
//
// Forward-compatibility: `mod_keyboard_shortcuts.mod_global_keymap`
// will lift this binding into a unified dispatcher. The hook is
// intentionally a thin attach/detach + dispatch shim so the unified
// keymap can rewrite the listener wiring without touching the store
// or the button — the `useSnapshotFlowStore.getState().open()` call
// site is the stable API the consolidation pass will preserve.

import { useEffect } from 'react';

import { useSnapshotFlowStore } from './useSnapshotFlowStore';

/**
 * Detect whether the current runtime is macOS. Reads
 * `navigator.platform` (and `navigator.userAgentData.platform` when
 * available) so the Cmd-vs-Ctrl branch chooses the right modifier per
 * platform. Lives outside the hook so test suites can compute the
 * expected modifier without re-rendering. Exported for visibility,
 * NOT part of the runtime API surface.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? '';
  return platform.toLowerCase().includes('mac');
}

export function useSnapshotShortcut(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // 1. Repeat-skip: auto-repeat from a held key is not a deliberate
      // gesture; the modal opens once per physical press.
      if (event.repeat) return;

      // 2. Modifier-required: macOS uses Cmd (`metaKey`); other
      // platforms use Ctrl (`ctrlKey`). Shift is permitted (caps-lock
      // equivalent); `altKey` is rejected so it does not eat
      // accelerator chords the host browser may bind.
      if (event.altKey) return;
      const isMac = isMacPlatform();
      const hasRequiredModifier = isMac ? event.metaKey : event.ctrlKey;
      if (!hasRequiredModifier) return;
      // On non-macOS reject `metaKey` (Windows key) so a stray Win+S
      // does not steer through this listener; on macOS reject `ctrlKey`
      // so Ctrl+S (a different chord) does not fire the macOS branch.
      if (isMac) {
        if (event.ctrlKey) return;
      } else {
        if (event.metaKey) return;
      }

      // 3. Case-insensitive key match — under shift `event.key` is
      // `'S'`; the lowercase form resolves identically.
      if (event.key.toLowerCase() !== 's') return;

      // Match — swallow the browser save dialog and open the flow.
      event.preventDefault();
      useSnapshotFlowStore.getState().open();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
