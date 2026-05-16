// `<DecomposeComponentTextInput>` — per-row textarea for the
// decompose-mode multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Sibling pattern: apps/moderator/src/layout/CaptureTextInput.tsx
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Mounts inside `<DecomposeComponentRow>`; bound to the per-index
// slice `useCaptureStore.decomposeComponents[index].text`. The variant
// shares its bones with `<CaptureTextInput>` (controlled textarea, the
// `MAX_METHODOLOGY_TEXT_LENGTH` cap mirror, auto-grow via
// `useLayoutEffect`, no auto-focus on mount) and differs in three
// ways recorded in Decision §5 of the refinement:
//
//   1. `rows={1}` initial min-height (the multi-row grid is dense;
//      a 2-line F1 default would push the grid past the strip).
//   2. A smaller `MAX_HEIGHT_PX` (≈ 3 lines) so a long row's wrap
//      tops out at 3 lines before its internal scrollbar engages.
//   3. NO helper line ({used}/{max} characters) — the row context is
//      too dense; the native `maxLength` truncation surfaces the cap.
//
// Per Decision §6, the per-row textarea installs NO keydown
// `onSubmit` gesture in v1; plain Enter and Cmd/Ctrl+Enter both
// insert newlines (native behaviour). The propose-decomposition
// button (sibling task) is the only submit path.

import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';

/**
 * Auto-grow ceiling — ~3 lines of 14px text + line-height 1.5 +
 * padding. Past this height, the textarea engages its internal
 * vertical scroll (browser default `overflow-y: auto`). Smaller than
 * `<CaptureTextInput>`'s 144px ceiling because the multi-row grid is
 * dense — each row carries a label + textarea + classification picker
 * + remove button, and the cumulative vertical budget is bounded by
 * the bottom strip's height.
 */
const MAX_HEIGHT_PX = 72;

export interface DecomposeComponentTextInputProps {
  /** Zero-indexed row position in `useCaptureStore.decomposeComponents`. */
  index: number;
}

export function DecomposeComponentTextInput(props: DecomposeComponentTextInputProps): ReactElement {
  const { index } = props;
  const { t } = useTranslation();

  // The `?? ''` guard defends against the (transient) out-of-bounds
  // read between a row-removal `set()` and the React reconciliation
  // that unmounts this row. Without the guard, the selector would
  // throw on `undefined.text` for the brief moment between the store
  // notifying its subscribers and React's commit phase unmounting
  // the now-orphaned row.
  const text = useCaptureStore((s) => s.decomposeComponents[index]?.text ?? '');
  const setDecomposeComponentText = useCaptureStore((s) => s.setDecomposeComponentText);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: reset to `auto` first so the next read of `scrollHeight`
  // reflects the natural content height (without this dance the
  // textarea only grows; it never shrinks back). Clamp to
  // `MAX_HEIGHT_PX` — past that, the browser's overflow-y:auto kicks
  // in and an internal scrollbar appears. Same pattern as
  // `<CaptureTextInput>` with the row-density-appropriate cap.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const desired = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${String(desired)}px`;
  }, [text]);

  // The visible row-label is rendered by `<DecomposeComponentRow>` next
  // to the textarea; the textarea's `aria-label` carries the same
  // string so screen readers announce the component-by-index identity
  // when focus lands on the textarea.
  const ariaLabel = t('moderator.decompose.components.rowLabel', {
    index: index + 1,
  });

  return (
    <textarea
      ref={textareaRef}
      id={`decompose-component-text-${String(index)}`}
      data-testid={`decompose-component-text-${String(index)}`}
      value={text}
      onChange={(event) => {
        // The store helper enforces the cap defensively; the textarea
        // simply forwards the raw value. `maxLength` truncates on
        // type in every modern browser; the store's `slice(0, MAX)`
        // catches the paste-bypass edge case.
        setDecomposeComponentText(index, event.target.value);
      }}
      maxLength={MAX_METHODOLOGY_TEXT_LENGTH}
      aria-label={ariaLabel}
      placeholder={t('moderator.decompose.components.textPlaceholder')}
      rows={1}
      inputMode="text"
      spellCheck
      autoComplete="off"
      className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    />
  );
}
