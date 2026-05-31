// `<RebutEdgePreCommitAffordance>` — methodology-flavored per-edge
// substance affordance mounted on `<StatementEdge>`'s label container
// only when the edge's role is `'rebuts'`.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_substance_precommit.md
// ADRs:       docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §8, §10)
// Sibling:    apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx
//             (the generic per-edge substance affordance this variant
//             parallels — same wire hook, same per-edge keyed in-flight
//             + error state, same two-button picker shape; this variant
//             reframes the UI surface for F6 step 4 by surfacing a
//             methodology-flavored hint paragraph + defeater-specific
//             button labels.)
//
// **Methodology F6 step 4.** The participant pre-commits to the rebut:
// the moderator proposes the rebut edge's substance as `'agreed'`,
// recording that if the source condition holds, it would defeat the
// target (see `docs/methodology.md` L110–121 + `docs/moderator-ui.md`
// L108–119). The wire envelope is unchanged from the generic affordance
// — a substance-only re-vote shape of `set-edge-substance` —
// because the rebut edge already lives in projection from the F6 step-3
// `capture-node`-with-edge propose-time emission (ADR 0027 + Decision §D6
// of the refinement).
//
// **Visibility gate is `<StatementEdge>`'s responsibility.** This
// component does NOT self-gate on role / facet state. By the time it's
// mounted, the caller has already verified `edge.role === 'rebuts'`
// AND the existing `showSubstanceAffordance` predicate
// (`isShapeSettled && substanceStatus === 'awaiting-proposal'`). The
// component renders unconditionally given its `edgeId` prop.
//
// **Disputed button is preserved.** Methodology recommends `agreed` for
// F6 step 4, but a moderator who rejects the participant's pre-commit
// framing must retain the option to surface that disagreement through
// the normal substance-proposal path (Decision §D4). The two-button
// picker keeps both values; the methodology framing lives in the button
// LABELS + the hint paragraph, not in removing options.

import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useProposeSetEdgeSubstanceAction,
  type SubstanceValue,
  type WireError,
} from '../layout/useProposeSetEdgeSubstanceAction.js';

/**
 * Canonical button order — `'agreed'` first (the methodology default for
 * F6 step 4), `'disputed'` second (preserved per Decision §D4). Matches
 * the generic affordance's ordering so a moderator who switches between
 * rebut and non-rebut edges sees a stable left-to-right layout.
 */
const SUBSTANCE_VALUES: readonly SubstanceValue[] = ['agreed', 'disputed'];

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed';

const HINT_CLASSES =
  'text-[0.65rem] leading-snug text-slate-600 italic break-words whitespace-pre-line';

const ERROR_REGION_CLASSES =
  'mt-1 text-[0.65rem] leading-snug text-rose-700 break-words whitespace-pre-line';

export interface RebutEdgePreCommitAffordanceProps {
  /** The rebut edge id this affordance mounts on; the propose envelope's `edge_id`. */
  readonly edgeId: string;
}

export function RebutEdgePreCommitAffordance(
  props: RebutEdgePreCommitAffordanceProps,
): ReactElement {
  const { edgeId } = props;
  const { t } = useTranslation();
  const { propose, inFlight, lastError } = useProposeSetEdgeSubstanceAction(edgeId);

  // Hold the latest propose callback in a ref so the click handler is
  // stable across renders. Identical defensive seam to the generic
  // affordance.
  const proposeRef = useRef(propose);
  useEffect(() => {
    proposeRef.current = propose;
  }, [propose]);

  function handlePick(event: MouseEvent<HTMLButtonElement>, value: SubstanceValue): void {
    // Stop propagation so the click does NOT also fire ReactFlow's
    // edge-selection handler. Same posture as the generic affordance.
    event.stopPropagation();
    void proposeRef.current(value);
  }

  return (
    <div
      data-testid={`rebut-edge-pre-commit-affordance-${edgeId}`}
      data-edge-id={edgeId}
      data-rebut="true"
      className="mt-1 flex w-full flex-col gap-1"
    >
      <p data-testid={`rebut-edge-pre-commit-hint-${edgeId}`} className={HINT_CLASSES}>
        {t('moderator.rebutEdgePreCommit.hint')}
      </p>
      <div
        role="group"
        aria-label={t('moderator.setNodeSubstanceAction.affordanceAriaLabel')}
        className="flex flex-wrap items-center gap-1"
      >
        {SUBSTANCE_VALUES.map((value) => {
          const label = t(`moderator.rebutEdgePreCommit.valueButton.${value}`);
          const ariaLabel = t('moderator.rebutEdgePreCommit.valueButtonAriaLabel', {
            label,
          });
          return (
            <button
              key={value}
              type="button"
              data-testid={`rebut-edge-pre-commit-button-${edgeId}-${value}`}
              data-value={value}
              data-edge-id={edgeId}
              aria-label={ariaLabel}
              disabled={inFlight}
              onClick={(event) => {
                handlePick(event, value);
              }}
              className={BUTTON_CLASSES}
            >
              {label}
            </button>
          );
        })}
      </div>
      {lastError !== undefined ? (
        <RebutEdgePreCommitErrorRegion edgeId={edgeId} error={lastError} />
      ) : null}
    </div>
  );
}

interface RebutEdgePreCommitErrorRegionProps {
  readonly edgeId: string;
  readonly error: WireError;
}

function RebutEdgePreCommitErrorRegion(props: RebutEdgePreCommitErrorRegionProps): ReactElement {
  const { edgeId, error } = props;
  const { t } = useTranslation();
  return (
    <p
      data-testid={`rebut-edge-pre-commit-error-${edgeId}`}
      data-error-code={error.code}
      role="alert"
      aria-label={t('moderator.setNodeSubstanceAction.errorBanner.errorRoleLabel')}
      className={ERROR_REGION_CLASSES}
    >
      {error.message}
    </p>
  );
}
