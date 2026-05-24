// `<ProposeAction>` — the moderator's "Propose" button + inline error
// region.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 4)
//
// Mounts into the `bottom-strip-propose-action` slot exposed by
// `<BottomStripCapture>`. The button is the pointer affordance for the
// propose gesture; the keyboard path (Cmd/Ctrl+Enter on the textarea)
// remains the existing gesture from `mod_capture_text_input`. Both
// paths funnel through `useProposeAction()`'s `propose()` function.
//
// Surface:
//
//   - `propose-action` — outer wrapper (`role="group"`).
//   - `propose-action-button` — the click-to-submit button. Carries a
//     visible localized label, an `aria-label`, an in-flight label
//     swap, the `disabled` / `aria-disabled` attributes when the
//     hook's `canPropose` is false, and a click handler that fires
//     `propose()` (the click is also keyboard-reachable via Tab +
//     Space/Enter; the gesture is the same `propose()` call as the
//     textarea-local Cmd/Ctrl+Enter shortcut).
//   - `propose-action-key-chip` — the `<kbd>` chip next to the label
//     showing `⌘+Enter` on macOS or `Ctrl+Enter` elsewhere. The glyph
//     is a one-time component-render-time read via
//     `navigator.userAgentData?.platform` / `navigator.platform`.
//     `aria-hidden="true"` — screen readers don't read the literal
//     glyph; the shortcut is also surfaced via the help-overlay (future
//     task).
//   - `propose-action-validation-error` — inline region with
//     `role="status"` (informational about what's blocking submit).
//     Rendered only when `validationError !== null`.
//   - `propose-action-wire-error` — inline region with `role="alert"`
//     (failure-after-action; screen readers announce on first
//     appearance). Rendered only when `lastError !== undefined`.
//
// The component holds NO local state. It reads everything from the
// `useProposeAction()` hook. The hook owns:
//
//   - The six-gate validation + `canPropose` derivation.
//   - The optimistic clear + snapshot-restore-on-error contract.
//   - The sequential-envelope protocol for connecting vs.
//     free-floating proposes.
//   - The `inFlight` slice + `lastError` surface.
//
// Tailwind palette: a primary action (blue-700 fill) — slightly more
// prominent than the secondary surfaces the classification palette
// and edge-role selector use. WCAG AA: white-on-blue-700 ≈ 9.85:1;
// red-700-on-white ≈ 8.24:1.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useProposeAction, type ValidationErrorReason } from './useProposeAction';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 hover:border-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-white/20 px-1 text-[0.65rem] font-semibold leading-none opacity-90';

const ERROR_REGION_CLASSES = 'mt-1 text-xs text-red-700';

/**
 * Reason-key → catalog-key. The localized message text is interpolated
 * into `moderator.proposeAction.validationError` as `{reason}`. Per
 * `pf_mod_capture_pane_wording_only` the `classification-missing`
 * reason is gone (the capture-pane gesture is wording-only). The
 * `moderator.proposeAction.reason.classificationMissing` catalog key
 * stays in the i18n catalogs in case downstream node-card affordances
 * surface a missing-classification message; this map no longer
 * references it.
 */
const REASON_KEYS: Readonly<Record<ValidationErrorReason, string>> = {
  'text-empty': 'moderator.proposeAction.reason.textEmpty',
  'target-without-role': 'moderator.proposeAction.reason.targetWithoutRole',
  'role-without-target': 'moderator.proposeAction.reason.roleWithoutTarget',
  'not-connected': 'moderator.proposeAction.reason.notConnected',
  'session-missing': 'moderator.proposeAction.reason.sessionMissing',
};

/**
 * Detect whether the moderator is on macOS so the key-chip glyph
 * matches platform muscle memory (⌘+Enter on macOS, Ctrl+Enter
 * elsewhere). The detection is a one-time component-render read —
 * Decision §8.
 *
 * The modern `navigator.userAgentData.platform` is preferred when
 * available; the deprecated `navigator.platform` is the fallback for
 * Safari + Firefox. SSR / Node environments default to non-mac.
 */
function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `userAgentData` is only on Chromium-based browsers as of 2026; the
  // `?? '' ` keeps the lookup quiet on other UAs.
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

export function ProposeAction(): ReactElement {
  const { t } = useTranslation();
  const { propose, canPropose, validationError, inFlight, lastError } = useProposeAction();

  // One-time platform read — the glyph never changes after mount.
  const shortcutGlyph = useMemo(() => (isMacPlatform() ? '⌘+Enter' : 'Ctrl+Enter'), []);

  const label = inFlight
    ? t('moderator.proposeAction.inFlightLabel')
    : t('moderator.proposeAction.label');
  const ariaLabel = t('moderator.proposeAction.ariaLabel');
  const disabled = !canPropose;

  const validationReasonText =
    validationError !== null ? t(REASON_KEYS[validationError]) : undefined;
  const validationMessage =
    validationReasonText !== undefined
      ? t('moderator.proposeAction.validationError', { reason: validationReasonText })
      : undefined;

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
      data-testid="propose-action"
      role="group"
      aria-label={ariaLabel}
      className="flex flex-col items-start"
    >
      <button
        type="button"
        data-testid="propose-action-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          void propose();
        }}
        className={BUTTON_CLASSES}
      >
        <span>{label}</span>
        <kbd data-testid="propose-action-key-chip" aria-hidden="true" className={KEY_CHIP_CLASSES}>
          {shortcutGlyph}
        </kbd>
      </button>
      {validationMessage !== undefined ? (
        <p
          data-testid="propose-action-validation-error"
          role="status"
          className={ERROR_REGION_CLASSES}
        >
          {validationMessage}
        </p>
      ) : null}
      {wireMessage !== undefined ? (
        <p data-testid="propose-action-wire-error" role="alert" className={ERROR_REGION_CLASSES}>
          {wireMessage}
        </p>
      ) : null}
    </div>
  );
}
