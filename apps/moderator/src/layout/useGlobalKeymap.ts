// `useGlobalKeymap` — the moderator's single document-level dispatcher
// for the action-chord class of keyboard shortcuts.
//
// Refinement: tasks/refinements/moderator-ui/mod_global_keymap.md
//
// Mounted once at `<OperateRoute>` scope so the action chords are alive
// whenever the moderator is operating a session and detach when the
// route unmounts (returning `Cmd/Ctrl+S` to the browser default
// elsewhere in the shell). This consolidates the `Cmd/Ctrl+S` snapshot
// binding that previously lived in the standalone `useSnapshotShortcut`
// (now retired) — the binding behaviour is preserved byte-for-byte; the
// only change is its code location.
//
// Scope (Decision §4, §5, §6): this dispatcher owns ONLY the
// cross-cutting, document-scoped action chords.
//   - Snapshot (`Cmd/Ctrl+S`) — bound here.
//   - Propose (`Cmd/Ctrl+Enter`) — NOT bound here; stays textarea-owned
//     in `CaptureTextInput` (you must be composing to propose).
//   - Commit (`Cmd/Ctrl+Shift+Enter`) — registered in `GLOBAL_KEYMAP`
//     but NOT handled here; deferred to
//     `mod_proposal_selection_commit_chord`, which adds the
//     proposal-selection model and plugs its handler into this seam.
//   - Single-letter kind/role/meta-move chords and the mode-aware `Esc`
//     stay component-owned via `attachCaptureKeymap`.
//
// Snapshot bail rules (preserved from `useSnapshotShortcut`, in order):
//   1. Bail on `event.repeat` (a held key fires once per physical
//      press).
//   2. Require the platform modifier — `metaKey` on macOS, `ctrlKey`
//      elsewhere; reject the wrong-platform modifier and `altKey`;
//      `shift` is allowed.
//   3. Match `event.key.toLowerCase() === 's'`.
//   4. NO editable-target bail — `Cmd+S` semantics fire even while
//      typing into a textarea (universal save-chord behaviour).
// On match: `event.preventDefault()` swallows the browser save dialog,
// then `useSnapshotFlowStore.getState().open()` opens the snapshot flow.

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

export function useGlobalKeymap(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // --- Snapshot (Cmd/Ctrl+S) -------------------------------------

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

      // NOTE: the commit chord (`Cmd/Ctrl+Shift+Enter`) plugs in here
      // once `mod_proposal_selection_commit_chord` ships the
      // proposal-selection model. It is intentionally absent today
      // (Decision §5) — no global commit handler with no defensible
      // target.
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
