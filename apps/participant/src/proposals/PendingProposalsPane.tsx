// `<PendingProposalsPane>` — participant pending-proposals tab pane.
//
// Refinement: tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md
//   (prior:    tasks/refinements/participant-ui/part_proposal_list_view.md,
//              tasks/refinements/participant-ui/part_proposals_tab.md.
//    D2 — the pane's `facetStatusIndex` merges the broadcast-derived
//    `pendingProposalFacetStatus` cell-map over the events-derived
//    mirror with broadcast winning per `(entityKind, entityId, facet)`
//    cell. The per-row `serverPerFacetStatus` prop pass is gone — the
//    merged index already carries the data.)
//
// The pane reads `useWsStore.sessionState[sessionId].events`, derives
// the surviving in-flight proposals via `derivePendingProposals`, and
// renders one `<li data-testid="participant-pending-proposal-row">` per
// row newest-first. The empty-state branch activates when the event log
// has zero surviving proposals (mirrors the moderator's pane source-
// of-truth choice per `mod_proposal_list` Decision §2).
//
// **No interactivity in v1** — the row is a plain non-interactive list
// item; tap-to-expand lands in `part_proposal_expand`.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';

import { useWsStore } from '../ws/wsStore';
import { useUiStore } from '../stores/uiStore';
import {
  buildFacetStatusIndexFromBroadcast,
  computeFacetStatuses,
  projectOtherVotesByFacet,
  type FacetStatusIndex,
  type VotesByFacetIndex,
} from '@a-conversa/shell';
import { projectOwnFacetVotes, type OwnFacetVoteIndex } from '../graph/ownVotes';
import {
  derivePendingProposals,
  type PendingProposalRow as PendingProposalRowData,
} from './derivePendingProposals';
import { summaryText } from './proposalSummary';
import { PerProposalFacetBreakdown } from './PerProposalFacetBreakdown';
import {
  projectOtherVotesByProposal,
  type OtherVotesByProposalIndex,
} from './otherVotesByProposal';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export interface PendingProposalsPaneProps {
  sessionId: string;
  /**
   * The currently authenticated participant. Threaded into the
   * other-votes projections so the participant's own votes are filtered
   * out at the projection layer (the chip's dot row surfaces OTHER
   * voters only; the own vote is implicit in the per-facet status the
   * chip's color already encodes — Decision §3 of
   * `part_vote_indicators_in_pane`).
   */
  currentParticipantId: string;
  /**
   * Deterministic-time injection seam for the relative-time formatter.
   * Tests pass a fixed value; production callers omit it and the row
   * captures `Date.now()` at render time.
   */
  nowMsOverride?: number;
}

export function PendingProposalsPane({
  sessionId,
  currentParticipantId,
  nowMsOverride,
}: PendingProposalsPaneProps): ReactElement {
  const { t } = useTranslation();
  const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const pendingProposalFacetStatus = useWsStore(
    (s) => s.sessionState[sessionId]?.pendingProposalFacetStatus,
  );
  const rows = useMemo(() => derivePendingProposals(events), [events]);
  // Per `part_migrate_to_pending_proposal_facet_status` D2 — merge the
  // broadcast-derived per-entity cell map over the events-derived
  // mirror with broadcast winning per `(entityKind, entityId, facet)`
  // cell. Mirrors the moderator's pattern at
  // `apps/moderator/src/layout/PendingProposalsPane.tsx:646–663`.
  const eventsBasedFacetStatusIndex = useMemo(() => computeFacetStatuses(events), [events]);
  const facetStatusIndex = useMemo<FacetStatusIndex>(() => {
    const broadcastIndex =
      pendingProposalFacetStatus === undefined || pendingProposalFacetStatus.size === 0
        ? null
        : buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus);
    if (broadcastIndex === null) return eventsBasedFacetStatusIndex;
    const mergedNodes = new Map(eventsBasedFacetStatusIndex.nodes);
    for (const [id, cells] of broadcastIndex.nodes) {
      const existing = mergedNodes.get(id);
      mergedNodes.set(id, existing ? { ...existing, ...cells } : cells);
    }
    const mergedEdges = new Map(eventsBasedFacetStatusIndex.edges);
    for (const [id, cells] of broadcastIndex.edges) {
      const existing = mergedEdges.get(id);
      mergedEdges.set(id, existing ? { ...existing, ...cells } : cells);
    }
    return { nodes: mergedNodes, edges: mergedEdges };
  }, [pendingProposalFacetStatus, eventsBasedFacetStatusIndex]);
  const votesByFacetIndex = useMemo(
    () => projectOtherVotesByFacet(events, currentParticipantId),
    [events, currentParticipantId],
  );
  const votesByProposalIndex = useMemo(
    () => projectOtherVotesByProposal(events, currentParticipantId),
    [events, currentParticipantId],
  );
  const ownFacetVotes = useMemo(
    () => projectOwnFacetVotes(events, currentParticipantId),
    [events, currentParticipantId],
  );
  const nowMs = nowMsOverride ?? Date.now();
  const systemAuthorLabel = t('participant.pendingProposalsPane.systemAuthor');
  const paneAriaLabel = t('participant.pendingProposalsPane.paneAriaLabel');
  return (
    <section
      data-testid="participant-pending-proposals-pane"
      role="tabpanel"
      aria-live="polite"
      aria-label={paneAriaLabel}
      className="flex h-full w-full flex-col overflow-auto bg-white"
    >
      {rows.length === 0 ? (
        <div
          data-testid="participant-pending-proposals-pane-empty"
          className="flex h-full w-full items-center justify-center p-6 text-sm text-slate-500"
        >
          {t('participant.pendingProposalsPane.emptyState')}
        </div>
      ) : (
        <ul
          data-testid="participant-pending-proposals-pane-list"
          role="list"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {rows.map((row) => (
            <PendingProposalRow
              key={row.proposalEventId}
              row={row}
              nowMs={nowMs}
              systemAuthorLabel={systemAuthorLabel}
              facetStatusIndex={facetStatusIndex}
              votesByFacetIndex={votesByFacetIndex}
              votesByProposalIndex={votesByProposalIndex}
              ownFacetVotes={ownFacetVotes}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingProposalRow({
  row,
  nowMs,
  systemAuthorLabel,
  facetStatusIndex,
  votesByFacetIndex,
  votesByProposalIndex,
  ownFacetVotes,
}: {
  readonly row: PendingProposalRowData;
  readonly nowMs: number;
  readonly systemAuthorLabel: string;
  readonly facetStatusIndex: FacetStatusIndex;
  readonly votesByFacetIndex: VotesByFacetIndex;
  readonly votesByProposalIndex: OtherVotesByProposalIndex;
  readonly ownFacetVotes: OwnFacetVoteIndex;
}): ReactElement {
  const { t } = useTranslation();
  const expandedProposalId = useUiStore((s) => s.expandedProposalId);
  const setExpandedProposalId = useUiStore((s) => s.setExpandedProposalId);
  const chip = kindChipText(row.proposal, t);
  const summary = summaryText(row.proposal);
  const author = row.actor === null ? systemAuthorLabel : row.actor.slice(0, 8);
  const ago = relativeTimeFor(row.createdAt, nowMs);
  const isExpanded = expandedProposalId === row.proposalEventId;
  const bodyId = `participant-pending-proposal-row-body-${row.proposalEventId}`;
  const bodyAriaLabel = t('participant.pendingProposalsPane.rowBodyAriaLabel');
  const toggle = (): void => {
    setExpandedProposalId(isExpanded ? null : row.proposalEventId);
  };
  return (
    <li
      data-testid="participant-pending-proposal-row"
      data-proposal-id={row.proposalEventId}
      data-expanded={isExpanded}
      className="flex flex-col rounded-md border border-slate-100 bg-white"
      title={summary}
    >
      <button
        type="button"
        data-testid="participant-pending-proposal-row-header"
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex w-full flex-row items-center gap-2 px-3 py-2 text-left"
      >
        <span
          data-testid="participant-pending-proposal-row-kind"
          className="inline-flex h-5 items-center rounded-sm bg-slate-100 px-2 text-xs font-medium text-slate-700"
        >
          {chip}
        </span>
        <span
          data-testid="participant-pending-proposal-row-summary"
          className="flex-1 truncate text-sm text-slate-800"
        >
          {summary}
        </span>
        <span
          data-testid="participant-pending-proposal-row-author"
          className="text-xs font-mono text-slate-500"
        >
          {author}
        </span>
        <span
          data-testid="participant-pending-proposal-row-timestamp"
          className="text-xs text-slate-500"
        >
          {ago}
        </span>
      </button>
      {isExpanded ? (
        <div
          id={bodyId}
          data-testid="participant-pending-proposal-row-body"
          role="region"
          aria-label={bodyAriaLabel}
          className="border-t border-slate-100 px-3 py-2 text-sm text-slate-700"
        >
          <PerProposalFacetBreakdown
            proposal={row.proposal}
            facetStatusIndex={facetStatusIndex}
            proposalEventId={row.proposalEventId}
            votesByFacetIndex={votesByFacetIndex}
            votesByProposalIndex={votesByProposalIndex}
            ownFacetVotes={ownFacetVotes}
          />
        </div>
      ) : null}
    </li>
  );
}

function kindChipText(proposal: ProposalPayload, t: (key: string) => string): string {
  if (proposal.kind === 'classify-node') {
    return t(`methodology.kind.${proposal.classification}`);
  }
  return proposal.kind;
}

function relativeTimeFor(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return createdAt;
  const secondsAgo = Math.round((nowMs - createdMs) / 1000);
  return formatRelativeTime(-secondsAgo, 'second');
}
