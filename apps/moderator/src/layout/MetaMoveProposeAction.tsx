// `<MetaMoveProposeAction>` — the moderator's "Propose meta-move"
// button + inline validation / wire-error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
// Sibling templates:
//   apps/moderator/src/layout/ProposeAction.tsx
//   apps/moderator/src/layout/ProposeCaptureDefeaterAction.tsx
//
// Thin wrapper around `useMetaMoveAction()`. Renders `null` outside
// meta-move mode (defensive self-gate; the route's slot swap is the
// primary gate). Shows the localized "Propose meta-move" label (or the
// in-flight copy during the round-trip), is disabled when any gate
// fails, surfaces the validation reason inline when blocking is
// gate-driven, and surfaces the wire-error inline below the button
// after a failed propose.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCaptureStore } from '../stores/captureStore';
import { useMetaMoveAction, type MetaMoveValidationReason } from './useMetaMoveAction';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 hover:border-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

const ERROR_REGION_CLASSES = 'mt-1 text-xs text-red-700';

/**
 * Reason-key → catalog-key map for the inline validation message. The
 * localized text is interpolated into
 * `moderator.metaMoveAction.validationError` as `{reason}`.
 */
const REASON_KEYS: Readonly<Record<MetaMoveValidationReason, string>> = {
  'session-missing': 'moderator.metaMoveAction.reason.sessionMissing',
  'not-connected': 'moderator.metaMoveAction.reason.notConnected',
  'content-missing': 'moderator.metaMoveAction.reason.contentMissing',
  'target-missing': 'moderator.metaMoveAction.reason.targetMissing',
  'target-kind-invalid': 'moderator.metaMoveAction.reason.targetKindInvalid',
  'kind-missing': 'moderator.metaMoveAction.reason.kindMissing',
};

export function MetaMoveProposeAction(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const { proposeMetaMove, canPropose, validationError, inFlight, lastError } = useMetaMoveAction();

  if (mode !== 'meta-move') {
    return null;
  }

  const label = inFlight
    ? t('moderator.metaMoveAction.inFlightLabel')
    : t('moderator.metaMoveAction.label');
  const ariaLabel = t('moderator.metaMoveAction.ariaLabel');
  const disabled = !canPropose;

  const validationReasonText =
    validationError !== null ? t(REASON_KEYS[validationError]) : undefined;
  const validationMessage =
    validationReasonText !== undefined
      ? t('moderator.metaMoveAction.validationError', { reason: validationReasonText })
      : undefined;

  const wireMessage =
    lastError !== undefined
      ? lastError.code === 'timeout'
        ? lastError.message
        : lastError.code === 'unknown'
          ? t('moderator.metaMoveAction.unknownError', { message: lastError.message })
          : t('moderator.metaMoveAction.wireError', {
              code: lastError.code,
              message: lastError.message,
            })
      : undefined;

  return (
    <div
      data-testid="meta-move-propose-action"
      role="group"
      aria-label={ariaLabel}
      className="flex flex-col items-start"
    >
      <button
        type="button"
        data-testid="meta-move-propose-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          void proposeMetaMove();
        }}
        className={BUTTON_CLASSES}
      >
        {label}
      </button>
      {validationMessage !== undefined ? (
        <p
          data-testid="meta-move-propose-validation-error"
          role="status"
          className={ERROR_REGION_CLASSES}
        >
          {validationMessage}
        </p>
      ) : null}
      {wireMessage !== undefined ? (
        <p data-testid="meta-move-propose-error" role="alert" className={ERROR_REGION_CLASSES}>
          {wireMessage}
        </p>
      ) : null}
    </div>
  );
}
