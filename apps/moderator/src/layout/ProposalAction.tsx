// `<ProposalAction mode>` — shared "Propose decomposition" /
// "Propose interpretive split" button + inline error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// (extracted from `ProposeDecompositionAction.tsx` per Decision §2 of
//  the refinement).
// Sibling refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
//
// The body resolves per-mode i18n key namespaces + per-mode
// `data-testid` prefixes from `props.mode`. Per-mode thin wrappers
// (`<ProposeDecompositionAction>`, `<ProposeInterpretiveSplitAction>`)
// instantiate this shape.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useProposeProposalAction } from './useProposeProposalAction';
import type { ProposalValidationErrorReason } from './useProposeProposalAction';
import type { ProposalMode } from './ProposalModeExitAffordance';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 hover:border-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-white/20 px-1 text-[0.65rem] font-semibold leading-none opacity-90';

const ERROR_REGION_CLASSES = 'mt-1 text-xs text-red-700';

interface ModeConfig {
  readonly testidPrefix: string;
  readonly labelKey: string;
  readonly inFlightLabelKey: string;
  readonly ariaLabelKey: string;
  readonly validationErrorKey: string;
  readonly wireErrorKey: string;
  readonly reasonKeys: Readonly<Record<ProposalValidationErrorReason, string>>;
}

const MODE_CONFIG: Readonly<Record<ProposalMode, ModeConfig>> = {
  decompose: {
    testidPrefix: 'propose-decomposition-action',
    labelKey: 'moderator.decompose.propose.label',
    inFlightLabelKey: 'moderator.decompose.propose.inFlightLabel',
    ariaLabelKey: 'moderator.decompose.propose.ariaLabel',
    validationErrorKey: 'moderator.decompose.propose.validationError',
    wireErrorKey: 'moderator.decompose.propose.wireError',
    reasonKeys: {
      'session-missing': 'moderator.decompose.propose.reason.sessionMissing',
      'not-connected': 'moderator.decompose.propose.reason.notConnected',
      'target-missing': 'moderator.decompose.propose.reason.targetMissing',
      'rows-invalid': 'moderator.decompose.propose.reason.componentsInvalid',
    },
  },
  'interpretive-split': {
    testidPrefix: 'propose-interpretive-split-action',
    labelKey: 'moderator.interpretiveSplit.propose.label',
    inFlightLabelKey: 'moderator.interpretiveSplit.propose.inFlightLabel',
    ariaLabelKey: 'moderator.interpretiveSplit.propose.ariaLabel',
    validationErrorKey: 'moderator.interpretiveSplit.propose.validationError',
    wireErrorKey: 'moderator.interpretiveSplit.propose.wireError',
    reasonKeys: {
      'session-missing': 'moderator.interpretiveSplit.propose.reason.sessionMissing',
      'not-connected': 'moderator.interpretiveSplit.propose.reason.notConnected',
      'target-missing': 'moderator.interpretiveSplit.propose.reason.targetMissing',
      'rows-invalid': 'moderator.interpretiveSplit.propose.reason.readingsInvalid',
    },
  },
};

/**
 * Detect whether the moderator is on macOS so the key-chip glyph
 * matches platform muscle memory (⌘+Enter on macOS, Ctrl+Enter
 * elsewhere). SSR / Node defaults to non-mac.
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

export interface ProposalActionProps {
  mode: ProposalMode;
}

export function ProposalAction(props: ProposalActionProps): ReactElement {
  const { mode } = props;
  const { t } = useTranslation();
  const { propose, canPropose, validationError, inFlight, lastError } = useProposeProposalAction({
    mode,
  });

  const config = MODE_CONFIG[mode];
  const shortcutGlyph = useMemo(() => (isMacPlatform() ? '⌘+Enter' : 'Ctrl+Enter'), []);

  const label = inFlight ? t(config.inFlightLabelKey) : t(config.labelKey);
  const ariaLabel = t(config.ariaLabelKey);
  const disabled = !canPropose;

  const validationReasonText =
    validationError !== null ? t(config.reasonKeys[validationError]) : undefined;
  const validationMessage =
    validationReasonText !== undefined
      ? t(config.validationErrorKey, { reason: validationReasonText })
      : undefined;

  const wireMessage =
    lastError !== undefined
      ? lastError.code === 'timeout'
        ? lastError.message
        : t(config.wireErrorKey, { code: lastError.code, message: lastError.message })
      : undefined;

  return (
    <div
      data-testid={config.testidPrefix}
      role="group"
      aria-label={ariaLabel}
      className="flex flex-col items-start"
    >
      <button
        type="button"
        data-testid={`${config.testidPrefix}-button`}
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
          data-testid={`${config.testidPrefix}-key-chip`}
          aria-hidden="true"
          className={KEY_CHIP_CLASSES}
        >
          {shortcutGlyph}
        </kbd>
      </button>
      {validationMessage !== undefined ? (
        <p
          data-testid={`${config.testidPrefix}-validation-error`}
          role="status"
          className={ERROR_REGION_CLASSES}
        >
          {validationMessage}
        </p>
      ) : null}
      {wireMessage !== undefined ? (
        <p
          data-testid={`${config.testidPrefix}-wire-error`}
          role="alert"
          className={ERROR_REGION_CLASSES}
        >
          {wireMessage}
        </p>
      ) : null}
    </div>
  );
}
