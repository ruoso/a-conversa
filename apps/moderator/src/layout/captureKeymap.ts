// `captureKeymap` — document-level keyboard plumbing for the
// bottom-strip capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_classification_palette.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// The moderator's hands stay on the keyboard during a live session
// (`docs/moderator-ui.md:187`). The capture pane therefore needs a
// thin global `keydown` listener that maps single keystrokes to
// store-writing handlers without each component re-implementing the
// editable-target / modifier-bail / repeat-skip dance.
//
// This module exposes the seam future capture-flow tasks
// (`mod_propose_action`'s `Cmd/Ctrl+Shift+Enter`, `Esc` to exit mode,
// `Cmd+D` for decompose, etc.) will extend by adding new optional
// handler properties to `CaptureKeymapHandlers`. The first consumer
// is `<ClassificationPalette>` which wires `onPickKind`.
//
// Listener behaviour (defaults the palette relies on, in this order):
//
//   1. Register on `document` (not `window`) so the listener survives
//      iframe edge cases and matches React's event-system bubble target.
//   2. **Bail on modifier-other-than-shift**:
//      `event.metaKey || event.ctrlKey || event.altKey` short-circuits.
//      `Cmd+F` / `Ctrl+F` (browser find), `Cmd+Enter` (the textarea
//      submit gesture), `Alt+F` (window-menu accelerator on some
//      platforms) all stay out of the palette's path. Shift is the one
//      allowed modifier (caps-lock-equivalent only).
//   3. **Bail on `event.repeat`** — auto-repeat fires are deliberately
//      ignored. The moderator picking a kind is a one-shot gesture; a
//      held key should never bounce the palette through multiple kinds.
//   4. **Bail on editable-target** — when `document.activeElement`
//      matches `'input, textarea, select, [contenteditable="true"]'`
//      the keystroke belongs to the editing surface and the palette
//      stays out of it. This is the canonical multi-focus shortcut
//      pattern (Slack, GitHub PR comment box, Discord, Gmail compose).
//      Without this guard, typing `f` into the wording textarea would
//      flip the palette's classification on every keystroke.
//   5. Match `event.key.toLowerCase()` so caps-lock + shift don't
//      break the binding. Under shift, `event.key` is `'F'`; the
//      lowercase form resolves the same kind.
//   6. On a match, call `event.preventDefault()` so the keystroke is
//      consumed by the palette and does not bubble further.
//
// The handlers object is passed once at attach-time; the listener
// closes over it. Consumers hold the handler set in a `useRef` so
// the latest values are visible without re-attaching the listener on
// every render — the ref-then-listener pattern that survives
// strict-mode double-mount and avoids the re-attach storm during fast
// typing.

import { KIND_TO_SHORTCUT, type MethodologyKind } from '@a-conversa/i18n-catalogs';

/**
 * Handlers the capture pane wires into the keymap. Each handler is
 * optional so a future task can add a new handler without forcing
 * existing call sites to supply it.
 */
export interface CaptureKeymapHandlers {
  /** Pick a methodology kind. The palette wires this. */
  onPickKind?: (kind: MethodologyKind) => void;
  // future: onSubmit?: () => void;
  // future: onExitMode?: () => void;
  // future: onDecompose?: () => void;
}

/**
 * The inverse of `KIND_TO_SHORTCUT`. Materialised once at module load.
 * The palette + tests use this to resolve a pressed key to its kind
 * without an O(5) linear scan per keystroke.
 */
export const SHORTCUT_TO_KIND: Readonly<Record<string, MethodologyKind>> = (() => {
  const out: Record<string, MethodologyKind> = {};
  for (const [kind, key] of Object.entries(KIND_TO_SHORTCUT)) {
    out[key] = kind as MethodologyKind;
  }
  return out;
})();

/**
 * Selector for elements that own their own keystrokes. When
 * `document.activeElement` matches this selector, every keymap
 * handler bails — the keystroke belongs to the editing surface.
 *
 * Exported for test visibility; not part of the runtime API surface.
 */
export const EDITABLE_TARGET_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/**
 * Attach a document-level `keydown` listener that routes keystrokes
 * to the supplied handlers per the bail-rules described in the module
 * header. Returns a detach function the consumer's `useEffect` cleanup
 * runs on unmount.
 *
 * The handlers object is passed by reference. To respond to changing
 * state (e.g., the currently-selected kind), hold the latest handler
 * implementations in a `useRef` and supply a handlers object whose
 * methods read from the ref — the attach-once-detach-once pattern that
 * survives strict-mode double-mount.
 */
export function attachCaptureKeymap(handlers: CaptureKeymapHandlers): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    // 2. Modifier-bail: shift is allowed (caps-lock-equivalent); cmd,
    // ctrl, alt all short-circuit so browser / textarea shortcuts
    // pass through unchanged.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    // 3. Repeat-skip: auto-repeat fires from a held key are not
    // deliberate picks. Skip them.
    if (event.repeat) {
      return;
    }

    // 4. Editable-target guard: if the user is typing into an input /
    // textarea / contenteditable, the palette stays out of the way.
    const active = document.activeElement;
    if (active !== null && active instanceof Element && active.matches(EDITABLE_TARGET_SELECTOR)) {
      return;
    }

    // 5. Case-insensitive key match.
    const key = event.key.toLowerCase();

    // 1. (continued) Route to kind handler when the key is in the
    // shortcut table.
    const kind = SHORTCUT_TO_KIND[key];
    if (kind !== undefined && handlers.onPickKind !== undefined) {
      // 6. Consume the keystroke.
      event.preventDefault();
      handlers.onPickKind(kind);
      return;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
