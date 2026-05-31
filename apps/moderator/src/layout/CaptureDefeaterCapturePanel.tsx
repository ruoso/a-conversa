// `<CaptureDefeaterCapturePanel>` — capture-defeater-mode capture
// surface mounted in the bottom-strip's `textInput` slot when
// `mode === 'capture-defeater'`.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md
// Design doc: docs/moderator-ui.md (F6 defeater-capture flow, steps 2–3)
//
// The panel surfaces a single wording textarea bound to the F1
// `text` slice (Decision §D3 of the refinement — no new mutable
// slice; the F1-clear coupling on `enterCaptureDefeaterMode` already
// prevents bleed-through). Cmd/Ctrl+Enter inside the textarea fires
// the propose round-trip via `useProposeCaptureDefeaterAction()`'s
// `propose` callback (same submit convention as `<CaptureTextInput>`
// per Decision §D9 — distinct component, parallel UX).
//
// Self-gates on `mode === 'capture-defeater'` (renders `null`
// otherwise) so direct unit-test invocations are deterministic
// regardless of the harness's mounted route (mirrors
// `<OperationalizationCapturePanel>` /
// `<WarrantElicitationCapturePanel>`).
//
// Per ADR 0030: capture is wording-only. The panel does NOT render a
// classification picker, an edge-role selector, a target-clear
// button, or per-row controls. The new defeater node Y's
// classification facet enters `awaiting-proposal` and is named by a
// later moderator gesture against Y's per-node card. The rebut edge
// Y → X's substance facet is pre-committed by the sibling
// `mod_defeater_substance_precommit` task.

import type { KeyboardEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useProposeCaptureDefeaterAction } from './useProposeCaptureDefeaterAction';

export function CaptureDefeaterCapturePanel(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const text = useCaptureStore((s) => s.text);
  const setText = useCaptureStore((s) => s.setText);
  const { propose } = useProposeCaptureDefeaterAction();

  if (mode !== 'capture-defeater') {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd/Ctrl+Enter submits; plain Enter / Shift+Enter inserts a
    // newline (native textarea behavior). Mirrors the F1
    // `<CaptureTextInput>` convention.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void propose();
    }
  };

  return (
    <section
      data-testid="capture-defeater-capture-pane"
      role="region"
      aria-label={t('moderator.captureDefeater.capturePane.ariaLabel')}
      className="flex w-full flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
    >
      <textarea
        data-testid="capture-defeater-capture-pane-wording"
        aria-label={t('moderator.captureDefeater.capturePane.ariaLabel')}
        placeholder={t('moderator.captureDefeater.capturePane.placeholder')}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          // Defensive paste-bypass clamp mirroring `<CaptureTextInput>`.
          if (next.length > MAX_METHODOLOGY_TEXT_LENGTH) {
            setText(next.slice(0, MAX_METHODOLOGY_TEXT_LENGTH));
            return;
          }
          setText(next);
        }}
        onKeyDown={handleKeyDown}
        maxLength={MAX_METHODOLOGY_TEXT_LENGTH}
        rows={2}
        className="w-full resize-y rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      />
    </section>
  );
}
