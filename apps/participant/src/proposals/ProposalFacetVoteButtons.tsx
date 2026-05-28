// `<ProposalFacetVoteButtons>` — per-facet vote-button block that mounts
// inside each per-facet chip in the participant pending-proposals pane.
//
// Refinement: tasks/refinements/participant-ui/part_vote_button_per_facet.md
//   + tasks/refinements/participant-ui/part_change_vote_pre_commit.md
//     (extends the gate to honor change-vote across the pre-commit
//     window, including `'agreed'` — see `VOTABLE_STATUSES`).
//
// Renders agree + dispute buttons (no withdraw — withdraw is its own
// gesture per ADR 0030 §3 and lives on the detail-panel + future
// `part_withdraw.*` chain) whenever the chip's status admits a vote in
// the pre-commit window. When the current participant has already
// recorded a vote on this facet/proposal the chosen-side button is
// hidden and only the opposite-side button renders — the change-vote
// affordance. The server's latest-vote-wins rule (vote.ts lines
// 209-224) applies the flip; the projector clears the chosen-side ack
// per ADR 0030 §7 on supersession-clear.
//
// Pane-namespaced testids
// (`participant-pending-proposal-row-facet-vote-button-{agree,dispute}`)
// disambiguate from the detail panel's
// `participant-vote-button-{agree,dispute,withdraw}` so Playwright
// scenarios in `methodology-full-flow.spec.ts` (detail panel) and
// `participant-pending-proposals.spec.ts` (pane) target one surface at
// a time.
//
// ADRs: 0003 (React); 0005 (Tailwind); 0021 (envelope); 0022
// (no throwaway verifications); 0024 (react-i18next); 0026
// (participant-workspace-only); 0027 (facet/entity layer separation);
// 0030 (per-facet vote keying).

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { FacetStatus } from '@a-conversa/shell';
import { ownFacetKey, type OwnFacetVoteIndex } from '../graph/ownVotes';
import { useVoteAction, type UseVoteActionArgs, type VoteChoice } from '../detail/useVoteAction';

import type { VoteTarget } from './perProposalFacets';

export interface ProposalFacetVoteButtonsProps {
  readonly voteTarget: VoteTarget;
  readonly status: FacetStatus;
  readonly ownFacetVotes: OwnFacetVoteIndex;
}

// `'agreed'` lands here per `part_change_vote_pre_commit`: a facet at
// status `'agreed'` is unanimous-but-not-yet-committed; a participant
// who changes their mind in that window MUST be able to flip to dispute
// (un-unanimous-ing the facet) before the moderator commits. The server
// accepts the flip from `'agreed'` (vote.ts only rejects `'committed'`).
const VOTABLE_STATUSES: ReadonlySet<FacetStatus> = new Set<FacetStatus>([
  'proposed',
  'disputed',
  'withdrawn',
  'agreed',
]);

const VOTE_CHOICES: readonly VoteChoice[] = ['agree', 'dispute'];

const TESTID: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant-pending-proposal-row-facet-vote-button-agree',
  dispute: 'participant-pending-proposal-row-facet-vote-button-dispute',
};

const LABEL_KEY: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant.voteButton.agreeLabel',
  dispute: 'participant.voteButton.disputeLabel',
};

export function ProposalFacetVoteButtons({
  voteTarget,
  status,
  ownFacetVotes,
}: ProposalFacetVoteButtonsProps): ReactElement | null {
  const { t } = useTranslation();

  const ownVote = useMemo<'agree' | 'dispute' | undefined>(() => {
    if (voteTarget.kind === 'facet') {
      return ownFacetVotes.facets.get(
        ownFacetKey(voteTarget.entity_kind, voteTarget.entity_id, voteTarget.facet),
      );
    }
    if (voteTarget.proposal_id === '') return undefined;
    return ownFacetVotes.proposals.get(voteTarget.proposal_id);
  }, [voteTarget, ownFacetVotes]);

  // Hook MUST be called unconditionally (rules of hooks). The arg shape
  // discriminates on `voteTarget.kind`; the affordance gate fires AFTER
  // the call. The `'unmounted'` fallback is defensive — the gate refuses
  // to render the buttons when `voteTarget.kind === 'proposal' &&
  // voteTarget.proposal_id === ''`, so the hook is bound to a stable but
  // unreachable slot key in that branch.
  const hookArgs: UseVoteActionArgs =
    voteTarget.kind === 'facet'
      ? {
          entity_kind: voteTarget.entity_kind,
          entity_id: voteTarget.entity_id,
          facet: voteTarget.facet,
        }
      : { proposal_id: voteTarget.proposal_id === '' ? 'unmounted' : voteTarget.proposal_id };

  const { castVote, inFlight, lastError } = useVoteAction(hookArgs);

  const shouldRender =
    VOTABLE_STATUSES.has(status) &&
    !(voteTarget.kind === 'proposal' && voteTarget.proposal_id === '');

  if (!shouldRender) return null;

  // When the participant has already voted on this facet/proposal, hide
  // the chosen-side button — the only remaining affordance is the
  // opposite-side change-vote button. When no own-vote is set, both
  // buttons render as the first-vote case.
  const renderedChoices: readonly VoteChoice[] =
    ownVote === undefined ? VOTE_CHOICES : VOTE_CHOICES.filter((choice) => choice !== ownVote);
  const voteMode: 'first' | 'change' = ownVote === undefined ? 'first' : 'change';

  return (
    <span
      data-testid="participant-pending-proposal-row-facet-vote-buttons"
      className="ml-1 inline-flex items-center gap-1"
    >
      {renderedChoices.map((choice) => (
        <button
          key={choice}
          type="button"
          data-testid={TESTID[choice]}
          data-vote-choice={choice}
          data-vote-mode={voteMode}
          data-vote-state={inFlight ? 'in-flight' : 'enabled'}
          aria-label={
            voteMode === 'change'
              ? t('participant.voteButton.changeAriaLabel', { choice })
              : t('participant.voteButton.ariaLabel', { choice })
          }
          disabled={inFlight}
          aria-disabled={inFlight}
          onClick={() => {
            void castVote(choice);
          }}
          className="rounded-sm border border-current px-1 text-[10px] font-medium uppercase leading-none"
        >
          {inFlight ? t('participant.voteButton.inFlightLabel') : t(LABEL_KEY[choice])}
        </button>
      ))}
      {lastError ? (
        <span
          role="alert"
          aria-label={t('participant.voteButton.errorRoleLabel')}
          data-testid="participant-pending-proposal-row-facet-vote-button-error"
          className="text-[10px] text-rose-600"
        >
          {lastError.code === 'timeout'
            ? lastError.message
            : t('participant.voteButton.wireError', {
                code: lastError.code,
                message: lastError.message,
              })}
        </span>
      ) : null}
    </span>
  );
}
