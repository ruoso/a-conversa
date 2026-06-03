// `<ParticipantAnnotationDisputeButton>` — the participant's post-commit
// annotation-dispute affordance, mounted into `<EntityDetailPanel>`'s
// `actionSlot` from `OperateRoute.tsx` when the selection is an
// annotation. One button per selected annotation; it casts a facet-keyed
// `dispute` vote on the annotation's `substance` facet.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_dispute_e2e.md
//             (Decision §2/§3 — drive the existing facet-keyed seam built
//             by `annotation_facet_vote_seam` and mount the gesture in the
//             actionSlot, mirroring `<ParticipantAxiomMarkButton>`, rather
//             than threading annotations through `<ParticipantVoteButtons>`'
//             node/edge facet catalog).
//
// **Methodology semantics** (ADR 0038 — annotations disputable post-commit
// via substance-facet votes). A committed annotation is contestable: a
// debater casts a `dispute` vote keyed to the annotation's `substance`
// facet (`entity_kind:'annotation'`, `facet:'substance'`), which folds onto
// the annotation's facet status → `disputed` and lights the moderator's
// rose `<AnnotationBadge>` (`data-facet-status="disputed"`). `substance` is
// the only disputable annotation facet (ADR 0038 §4).
//
// Spec contract — the e2e round-trip spec selects this button via:
//
//   [data-testid="participant-annotation-dispute-button"][data-annotation-id="<id>"]
//
// Wire-action — binds a per-annotation `useVoteAction` facet target. The
// button reflects the hook's `inFlight` / `lastError` state:
//
//   - `inFlight === true` → button is `disabled` + `aria-disabled`;
//     `data-dispute-state` flips to `"in-flight"`.
//   - `lastError !== undefined` → an inline error region renders next to
//     the button with `role="alert"` and the localized message (this is
//     where the seam's per-participant already-voted rejection surfaces —
//     a second identical vote is rejected server-side).
//
// The resolved `substance` facet status (threaded from the shell's
// `FacetStatusIndex.annotations` bucket) is reflected on `data-facet-status`
// so the spec can read the settled `disputed` state directly off the
// affordance, in lockstep with the moderator badge it drives.
//
// i18n — reuses the existing `participant.voteButton.*` catalog keys (the
// dispute label, in-flight label, aria-label, and wire-error template) so
// no new catalog entries are introduced; the gesture IS a `dispute` vote.
//
// ADRs:
//   - 0003 (React);
//   - 0005 (Tailwind utility classes);
//   - 0022 (no throwaway verifications — covered by the unit tests in
//           `ParticipantAnnotationDisputeButton.test.tsx` for the wire side
//           and by `annotation-dispute-roundtrip.spec.ts` for the
//           cross-surface integration side);
//   - 0024 (i18n via react-i18next — all chrome strings go through
//           `useTranslation()`);
//   - 0026 (participant-workspace-only; no shell export until a third
//           caller materialises — same posture as the sibling affordances);
//   - 0030 (the facet-keyed vote arm this drives);
//   - 0038 (annotations disputable post-commit via substance-facet votes).

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { FacetStatus } from '@a-conversa/shell';

import { useVoteAction } from './useVoteAction';

export interface ParticipantAnnotationDisputeButtonProps {
  /** The selected annotation's id — bound to the facet-vote target. */
  readonly annotationId: string;
  /**
   * The annotation's resolved `substance` facet status, threaded from the
   * route's `FacetStatusIndex.annotations` bucket. Reflected on
   * `data-facet-status` so the affordance mirrors the moderator badge's
   * settled state; `undefined` (no projected status yet) renders `'none'`.
   */
  readonly substanceStatus?: FacetStatus | undefined;
}

export function ParticipantAnnotationDisputeButton(
  props: ParticipantAnnotationDisputeButtonProps,
): ReactElement {
  const { annotationId, substanceStatus } = props;
  const { t } = useTranslation();

  const { castVote, inFlight, lastError } = useVoteAction({
    entity_kind: 'annotation',
    entity_id: annotationId,
    facet: 'substance',
  });

  // Wire-error message text. Mirrors `<ParticipantVoteButtons>` /
  // `<ParticipantAxiomMarkButton>` wire-error shaping: the timeout case
  // uses the pre-localized fallback already on `lastError.message`; other
  // codes interpolate `{code}` + `{message}` through the vote wire-error
  // template.
  let wireMessage: string | undefined;
  if (lastError !== undefined) {
    wireMessage =
      lastError.code === 'timeout'
        ? lastError.message
        : t('participant.voteButton.wireError', {
            code: lastError.code,
            message: lastError.message,
          });
  }

  const disputeState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';
  // `data-facet-status` mirrors the moderator badge's settled state; the
  // `'none'` floor is the projector's "no per-facet record" sentinel (not
  // a `FacetStatus` member), so the attribute is a plain string.
  const facetStatus: string = substanceStatus ?? 'none';

  return (
    <section
      data-testid="participant-detail-panel-annotation-dispute-section"
      className="flex flex-col gap-1"
    >
      <button
        type="button"
        data-testid="participant-annotation-dispute-button"
        data-annotation-id={annotationId}
        data-dispute-state={disputeState}
        data-facet-status={facetStatus}
        disabled={inFlight}
        aria-disabled={inFlight}
        aria-label={t('participant.voteButton.ariaLabel', { choice: 'dispute' })}
        onClick={() => {
          void castVote('dispute');
        }}
        className={
          inFlight
            ? 'rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-400'
            : 'rounded border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50'
        }
      >
        {inFlight
          ? t('participant.voteButton.inFlightLabel')
          : t('participant.voteButton.disputeLabel')}
      </button>
      {wireMessage !== undefined ? (
        <p
          data-testid="participant-annotation-dispute-button-wire-error"
          data-annotation-id={annotationId}
          role="alert"
          aria-label={t('participant.voteButton.errorRoleLabel')}
          className="text-[10px] text-red-700"
        >
          {wireMessage}
        </p>
      ) : null}
    </section>
  );
}
