// `<ProposeDecompositionAction>` — the moderator's "Propose
// decomposition" button + inline error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 4)
//
// Sibling to `<ProposeAction>` (F1 capture flow). Mounts into the
// `bottom-strip-propose-action` slot of `<BottomStripCapture>` when
// `mode === 'decompose'` via the route's conditional swap (Decision
// §3 of the refinement). The button is the only submit path in v1
// (Decision §8 — the per-row textareas don't fire a chord; the
// `<kbd>` chip surfaces the chord the future enhancement will land).
//
// Surface:
//
//   - `propose-decomposition-action` — outer wrapper (`role="group"`).
//   - `propose-decomposition-action-button` — the click-to-submit
//     button. Carries a visible localized label, an `aria-label`, an
//     in-flight label swap, the `disabled` / `aria-disabled`
//     attributes when the hook's `canPropose` is false, and a click
//     handler that fires `propose()`.
//   - `propose-decomposition-action-key-chip` — the `<kbd>` chip next
//     to the label showing `⌘+Enter` on macOS or `Ctrl+Enter`
//     elsewhere. Same platform-detection branch as the F1 button.
//     `aria-hidden="true"` — informational only in v1.
//   - `propose-decomposition-action-validation-error` — inline region
//     with `role="status"` (informational about what's blocking
//     submit). Rendered only when `validationError !== null`.
//   - `propose-decomposition-action-wire-error` — inline region with
//     `role="alert"` (failure-after-action). Rendered only when
//     `lastError !== undefined`.
//
// The component holds NO local state. It reads everything from the
// `useProposeDecompositionAction()` hook (which owns the four-gate
// validation + `canPropose` derivation + the optimistic-clear +
// snapshot-restore-on-error contract + the `inFlight` slice +
// `lastError` surface).
//
// Tailwind palette: matches the F1 button (blue-700 primary action).
// WCAG AA: white-on-blue-700 ≈ 9.85:1; red-700-on-white ≈ 8.24:1.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useProposeDecompositionAction,
  type DecomposeValidationErrorReason,
} from './useProposeDecompositionAction';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 hover:border-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-white/20 px-1 text-[0.65rem] font-semibold leading-none opacity-90';

const ERROR_REGION_CLASSES = 'mt-1 text-xs text-red-700';

/**
 * Reason-key → catalog-key. The localized message text is interpolated
 * into `moderator.decompose.propose.validationError` as `{reason}`.
 */
const REASON_KEYS: Readonly<Record<DecomposeValidationErrorReason, string>> = {
  'session-missing': 'moderator.decompose.propose.reason.sessionMissing',
  'not-connected': 'moderator.decompose.propose.reason.notConnected',
  'target-missing': 'moderator.decompose.propose.reason.targetMissing',
  'components-invalid': 'moderator.decompose.propose.reason.componentsInvalid',
};

/**
 * Detect whether the moderator is on macOS so the key-chip glyph
 * matches platform muscle memory (⌘+Enter on macOS, Ctrl+Enter
 * elsewhere). One-time component-render read — same shape as
 * `ProposeAction.tsx`'s `isMacPlatform()`. SSR / Node environments
 * default to non-mac.
 */
function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const modern = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  if (typeof modern === 'string' && modern !== '') {
    return modern.toLowerCase().includes('mac');
  }
  if (typeof navigator.platform === 'string') {
    return navigator.platform.toLowerCase().includes('mac');
  }
  return false;
}

export function ProposeDecompositionAction(): ReactElement {
  const { t } = useTranslation();
  const { propose, canPropose, validationError, inFlight, lastError } =
    useProposeDecompositionAction();

  // One-time platform read — the glyph never changes after mount.
  const shortcutGlyph = useMemo(() => (isMacPlatform() ? '⌘+Enter' : 'Ctrl+Enter'), []);

  const label = inFlight
    ? t('moderator.decompose.propose.inFlightLabel')
    : t('moderator.decompose.propose.label');
  const ariaLabel = t('moderator.decompose.propose.ariaLabel');
  const disabled = !canPropose;

  const validationReasonText =
    validationError !== null ? t(REASON_KEYS[validationError]) : undefined;
  const validationMessage =
    validationReasonText !== undefined
      ? t('moderator.decompose.propose.validationError', { reason: validationReasonText })
      : undefined;

  const wireMessage =
    lastError !== undefined
      ? lastError.code === 'timeout'
        ? lastError.message
        : t('moderator.decompose.propose.wireError', {
            code: lastError.code,
            message: lastError.message,
          })
      : undefined;

  return (
    <div
      data-testid="propose-decomposition-action"
      role="group"
      aria-label={ariaLabel}
      className="flex flex-col items-start"
    >
      <button
        type="button"
        data-testid="propose-decomposition-action-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          void propose();
        }}
        className={BUTTON_CLASSES}
      >
        <span>{label}</span>
        <kbd
          data-testid="propose-decomposition-action-key-chip"
          aria-hidden="true"
          className={KEY_CHIP_CLASSES}
        >
          {shortcutGlyph}
        </kbd>
      </button>
      {validationMessage !== undefined ? (
        <p
          data-testid="propose-decomposition-action-validation-error"
          role="status"
          className={ERROR_REGION_CLASSES}
        >
          {validationMessage}
        </p>
      ) : null}
      {wireMessage !== undefined ? (
        <p
          data-testid="propose-decomposition-action-wire-error"
          role="alert"
          className={ERROR_REGION_CLASSES}
        >
          {wireMessage}
        </p>
      ) : null}
    </div>
  );
}
