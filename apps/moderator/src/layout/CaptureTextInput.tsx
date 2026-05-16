// `<CaptureTextInput>` — controlled `<textarea>` for the moderator's
// statement-wording capture slot.
//
// Refinement: tasks/refinements/moderator-ui/mod_capture_text_input.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 1)
//
// Mounts into the `bottom-strip-text-input` sub-slot exposed by
// `<BottomStripCapture>` (the scaffold from `mod_bottom_strip_capture`).
// Reads the in-progress `text` slice from `useCaptureStore` and writes
// back via `setText` on every change — a shared-store-backed
// controlled input, NOT component-local state. The downstream
// `mod_propose_action` (and the sibling `mod_classification_palette` /
// `mod_edge_role_selector`) consumers all read the in-progress draft
// from the same slice; centralising it eliminates prop-drilling.
//
// Submit gesture: Cmd/Ctrl+Enter inside the textarea fires the
// consumer-supplied `onSubmit` callback (and `e.preventDefault()` so
// no newline is inserted). Plain Enter inserts a newline (native
// textarea behaviour) — the wording is multi-line free-form per
// `docs/moderator-ui.md` F1. `e.metaKey || e.ctrlKey` covers macOS
// Cmd and every other platform's Ctrl with one rule per ADR 0024 +
// the i18n_keyboard_shortcuts_policy "non-methodology shortcuts stay
// as-is across locales" clause.
//
// Hard cap: `MAX_METHODOLOGY_TEXT_LENGTH = 10_000` (from
// `@a-conversa/shared-types`, the server-side cap from
// `backend_hardening.user_text_length_caps`). The native `maxLength`
// attribute truncates on type; the defensive `slice(0, MAX)` clamp in
// `onChange` defends the slice's invariant against the paste-bypasses-
// maxLength edge case some browsers exhibit.
//
// Auto-grow: the textarea expands as the content grows up to
// `MAX_HEIGHT_PX` (~6 lines), then scrolls internally. The
// `useLayoutEffect` resets `height` to `'auto'` first to read the
// content's natural `scrollHeight` (without this, the textarea only
// grows; it does not shrink as the content shrinks).
//
// No auto-focus on mount: the moderator may have navigated to the
// operate route to look at the graph; auto-focusing would steal focus
// from any pre-existing keyboard activity. The user clicks or tabs to
// the textarea when they want to compose.

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';

/**
 * Auto-grow ceiling — ~6 lines of 14px text + line-height 1.5 + padding.
 * Past this height, the textarea engages its internal vertical scroll
 * (browser default `overflow-y: auto`). Below this, `useLayoutEffect`
 * resizes the element to fit its content. Kept module-local so the
 * tests can probe the clamp by exceeding it.
 */
const MAX_HEIGHT_PX = 144;

export interface CaptureTextInputProps {
  /**
   * Fired when the moderator presses Cmd/Ctrl+Enter inside the textarea.
   * The consumer supplies the submit handler — `mod_propose_action`
   * wires it to the propose round-trip; integration points landing
   * before propose-action pass a no-op (`() => {}`).
   *
   * Plain Enter does NOT fire this; it inserts a newline (native
   * textarea behaviour).
   */
  onSubmit?: () => void;
}

export function CaptureTextInput(props: CaptureTextInputProps): ReactElement {
  const { onSubmit } = props;
  const { t } = useTranslation();

  const text = useCaptureStore((state) => state.text);
  const setText = useCaptureStore((state) => state.setText);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: reset to `auto` first so the next read of `scrollHeight`
  // reflects the natural content height (without this dance the
  // textarea only grows; it never shrinks back). Clamp to
  // `MAX_HEIGHT_PX` — past that, the browser's overflow-y:auto kicks
  // in and an internal scrollbar appears.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const desired = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${String(desired)}px`;
  }, [text]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value;
    // Defensive clamp: `maxLength` is honored on type by every modern
    // browser but is inconsistent on paste — some browsers truncate
    // the pasted value to `maxLength`, others fire `input` with the
    // full pasted value and rely on JS to enforce the cap. The
    // `slice` defends the store invariant regardless.
    if (value.length > MAX_METHODOLOGY_TEXT_LENGTH) {
      setText(value.slice(0, MAX_METHODOLOGY_TEXT_LENGTH));
      return;
    }
    setText(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      // `preventDefault` is required: without it, the browser inserts
      // a newline in addition to firing the submit (the Enter default
      // for a `<textarea>`).
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div data-testid="capture-text-input" className="flex w-full flex-col gap-1">
      <label
        htmlFor="capture-text-input"
        data-testid="capture-text-input-label"
        className="text-xs font-medium text-slate-700"
      >
        {t('moderator.captureTextInput.label')}
      </label>
      <textarea
        ref={textareaRef}
        id="capture-text-input"
        data-testid="capture-text-input-textarea"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={MAX_METHODOLOGY_TEXT_LENGTH}
        aria-label={t('moderator.captureTextInput.ariaLabel')}
        aria-describedby="capture-text-input-helper"
        placeholder={t('moderator.captureTextInput.placeholder')}
        rows={2}
        inputMode="text"
        spellCheck
        autoComplete="off"
        className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      />
      <p
        id="capture-text-input-helper"
        data-testid="capture-text-input-helper"
        className="text-xs text-slate-500"
      >
        {t('moderator.captureTextInput.helper', {
          used: text.length,
          max: MAX_METHODOLOGY_TEXT_LENGTH,
        })}
      </p>
    </div>
  );
}
