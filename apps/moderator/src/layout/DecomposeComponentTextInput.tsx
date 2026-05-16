// `<DecomposeComponentTextInput mode>` — per-row textarea for the
// decompose- and interpretive-split-mode multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// Parameterised by:
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Sibling pattern: apps/moderator/src/layout/CaptureTextInput.tsx
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 3)
//
// Mounts inside `<DecomposeComponentRow>`; bound to the per-index
// slice in either `useCaptureStore.decomposeComponents[index].text` or
// `useCaptureStore.interpretiveSplitReadings[index].text` per the
// `mode` prop. Per-mode `data-testid`s, label keys, and placeholder
// keys switch on `props.mode`. Layout / behaviour is mode-neutral.

import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import type { ProposalMode } from './ProposalModeExitAffordance';

const MAX_HEIGHT_PX = 72;

const MODE_CONFIG = {
  decompose: {
    testidPrefix: 'decompose-component-text',
    rowLabelKey: 'moderator.decompose.components.rowLabel',
    placeholderKey: 'moderator.decompose.components.textPlaceholder',
  },
  'interpretive-split': {
    testidPrefix: 'interpretive-split-reading-text',
    rowLabelKey: 'moderator.interpretiveSplit.readings.rowLabel',
    placeholderKey: 'moderator.interpretiveSplit.readings.textPlaceholder',
  },
} as const;

export interface DecomposeComponentTextInputProps {
  /** Which proposal mode this input serves. */
  mode: ProposalMode;
  /** Zero-indexed row position in the active mode's slice. */
  index: number;
}

export function DecomposeComponentTextInput(props: DecomposeComponentTextInputProps): ReactElement {
  const { mode, index } = props;
  const { t } = useTranslation();

  const text = useCaptureStore((s) =>
    mode === 'decompose'
      ? (s.decomposeComponents[index]?.text ?? '')
      : (s.interpretiveSplitReadings[index]?.text ?? ''),
  );
  const setText = useCaptureStore((s) =>
    mode === 'decompose' ? s.setDecomposeComponentText : s.setInterpretiveSplitReadingText,
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const desired = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${String(desired)}px`;
  }, [text]);

  const config = MODE_CONFIG[mode];
  const ariaLabel = t(config.rowLabelKey, { index: index + 1 });
  const testid = `${config.testidPrefix}-${String(index)}`;

  return (
    <textarea
      ref={textareaRef}
      id={testid}
      data-testid={testid}
      value={text}
      onChange={(event) => {
        setText(index, event.target.value);
      }}
      maxLength={MAX_METHODOLOGY_TEXT_LENGTH}
      aria-label={ariaLabel}
      placeholder={t(config.placeholderKey)}
      rows={1}
      inputMode="text"
      spellCheck
      autoComplete="off"
      className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    />
  );
}
