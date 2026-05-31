// `<ProposeCaptureDefeaterAction>` — the moderator's "Capture
// defeater" button + inline wire-error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md
// Sibling template: apps/moderator/src/layout/ProposalAction.tsx
//                   apps/moderator/src/layout/ProposeAction.tsx
//
// Thin wrapper around `useProposeCaptureDefeaterAction()`. Renders
// `null` outside capture-defeater mode (defensive self-gate; the
// route's slot swap is the primary gate). Shows the localized
// "Capture defeater" label (or "Capturing defeater…" while in
// flight), is disabled when any of the six `canPropose` gates fail,
// and surfaces the wire-error inline below the button after a failed
// propose (the F1 `moderator.proposeAction.wireError` key is reused
// per Decision §D8 — no new wire-error catalog entry).

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCaptureStore } from '../stores/captureStore';
import { useProposeCaptureDefeaterAction } from './useProposeCaptureDefeaterAction';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 hover:border-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

const ERROR_REGION_CLASSES = 'mt-1 text-xs text-red-700';

export function ProposeCaptureDefeaterAction(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const { propose, canPropose, inFlight, lastError } = useProposeCaptureDefeaterAction();

  if (mode !== 'capture-defeater') {
    return null;
  }

  const label = inFlight
    ? t('moderator.captureDefeater.propose.inFlightLabel')
    : t('moderator.captureDefeater.propose.label');
  // Decision §D8: the aria-label reuses the same `propose.label` key
  // as the visible text to keep the new-key count at 4. The
  // `banner.targetWording` overlay above the button carries the
  // "defeating what?" context.
  const ariaLabel = t('moderator.captureDefeater.propose.label');
  const disabled = !canPropose;

  const wireMessage =
    lastError !== undefined
      ? lastError.code === 'timeout'
        ? lastError.message
        : t('moderator.proposeAction.wireError', {
            code: lastError.code,
            message: lastError.message,
          })
      : undefined;

  return (
    <div
      data-testid="capture-defeater-propose-action"
      role="group"
      aria-label={ariaLabel}
      className="flex flex-col items-start"
    >
      <button
        type="button"
        data-testid="capture-defeater-propose-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          void propose();
        }}
        className={BUTTON_CLASSES}
      >
        {label}
      </button>
      {wireMessage !== undefined ? (
        <p
          data-testid="capture-defeater-propose-wire-error"
          role="alert"
          className={ERROR_REGION_CLASSES}
        >
          {wireMessage}
        </p>
      ) : null}
    </div>
  );
}
