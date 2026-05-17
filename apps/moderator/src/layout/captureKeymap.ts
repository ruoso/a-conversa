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
// is `<ClassificationPalette>` which wires `onPickKind`; the second is
// `<CaptureTargetChip>` which wires `onClearTarget` (the `Esc` binding
// landed by `mod_target_clear_override`).
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

import {
  EDGE_ROLE_TO_SHORTCUT,
  KIND_TO_SHORTCUT,
  type EdgeRole,
  type MethodologyKind,
} from '@a-conversa/i18n-catalogs';

import { useCaptureStore } from '../stores/captureStore.js';

/**
 * Handlers the capture pane wires into the keymap. Each handler is
 * optional so a future task can add a new handler without forcing
 * existing call sites to supply it.
 */
export interface CaptureKeymapHandlers {
  /** Pick a methodology kind. The palette wires this. */
  onPickKind?: (kind: MethodologyKind) => void;
  /**
   * Clear the staged edge target. The capture-target chip wires this;
   * triggered by the `Esc` key under the same modifier-bail /
   * editable-target / repeat-skip guards as `onPickKind`.
   *
   * Refinement: tasks/refinements/moderator-ui/mod_target_clear_override.md
   */
  onClearTarget?: () => void;
  /**
   * Pick an edge role. The edge-role selector wires this; triggered by
   * the role's english-mnemonic letter (`s`/`r`/`q`/`b`/`g`/`e`/`x`)
   * under the same modifier-bail / editable-target / repeat-skip
   * guards as `onPickKind`. The visibility-gate
   * (`targetEntityId !== null`) lives in the consumer's handler closure
   * — the keymap module stays a pure key-dispatch layer.
   *
   * Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
   */
  onPickEdgeRole?: (role: EdgeRole) => void;
  /**
   * Exit the current capture-pane mode (decompose / interpretive-split
   * / other future modes that own their own Escape semantics).
   * Triggered by `Escape` under the same modifier-bail / editable-
   * target / repeat-skip guards as `onClearTarget`. When
   * `useCaptureStore.getState().mode === 'decompose'` OR
   * `=== 'interpretive-split'` (and future modes), this handler takes
   * priority over `onClearTarget` — the operator's mental model is
   * "I'm in a mode; Escape leaves the mode," and the staged-target
   * chip the F1 clearer surfaces is below the operator's current
   * attention while in a sub-mode.
   *
   * Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
   * (Decision §5 records the priority order).
   * Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
   * (Decision §8 records the generalisation to interpretive-split).
   */
  onExitMode?: () => void;
  // future: onSubmit?: () => void;
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
 * The inverse of `EDGE_ROLE_TO_SHORTCUT`. Materialised once at module
 * load. The edge-role selector + tests use this to resolve a pressed
 * key to its role without an O(7) linear scan per keystroke.
 *
 * The kind and role tables are disjoint by construction
 * (`EDGE_ROLE_TO_SHORTCUT` Decision §7 in `mod_edge_role_selector.md`);
 * the test suite asserts the invariant so a future edit cannot
 * silently introduce a cross-table collision.
 */
export const SHORTCUT_TO_EDGE_ROLE: Readonly<Record<string, EdgeRole>> = (() => {
  const out: Record<string, EdgeRole> = {};
  for (const [role, key] of Object.entries(EDGE_ROLE_TO_SHORTCUT)) {
    out[key] = role as EdgeRole;
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

    // 7. Route to edge-role handler when the key is in the role
    // shortcut table. The kind-match branch runs first because the two
    // tables MUST NOT share any key (Decision §7 in
    // `mod_edge_role_selector.md` records the collision-avoidance
    // proof; `keyboard-shortcuts.test.ts` regression-locks it). The
    // branch is gated on `handlers.onPickEdgeRole !== undefined` so
    // other consumers (the palette, the chip) do not observe role keys
    // they did not register for. The visibility-gate
    // (`targetEntityId !== null`) is the consumer's responsibility —
    // the selector applies it inside its handler closure.
    const role = SHORTCUT_TO_EDGE_ROLE[key];
    if (role !== undefined && handlers.onPickEdgeRole !== undefined) {
      // 6. Consume the keystroke.
      event.preventDefault();
      handlers.onPickEdgeRole(role);
      return;
    }

    // 8. `Esc` routes mode-aware: when `useCaptureStore.getState().mode
    // === 'decompose'` (and future sub-modes that own their own
    // Escape semantics), the registered `onExitMode` handler takes
    // priority over `onClearTarget`. Decision §5 of
    // `mod_decompose_mode.md` records the rationale: the operator's
    // mental model in a sub-mode is "Escape leaves the mode," not
    // "Escape clears my staged target" — and the F1-clear coupling
    // on `enterDecomposeMode` already cleared any staged target, so
    // `onClearTarget` would be a no-op anyway. The branch sits after
    // the kind / role matches because the shortcut tables contain
    // only letter keys; `Escape` never collides.
    if (key === 'escape') {
      const mode = useCaptureStore.getState().mode;
      if (
        (mode === 'decompose' || mode === 'interpretive-split' || mode === 'operationalization') &&
        handlers.onExitMode !== undefined
      ) {
        // 6. Consume the keystroke.
        event.preventDefault();
        handlers.onExitMode();
        return;
      }
      if (handlers.onClearTarget !== undefined) {
        // 6. Consume the keystroke.
        event.preventDefault();
        handlers.onClearTarget();
        return;
      }
    }
  }

  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
