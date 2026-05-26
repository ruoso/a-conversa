// `<PendingProposalsPane>` — participant pending-proposals tab pane.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//   (prior:    tasks/refinements/participant-ui/part_proposals_tab.md —
//    Decision §5 established the stable container testid + ARIA
//    contract sibling leaves bind to; this leaf renders rows.)
//
// The pane reads `useWsStore.sessionState[sessionId].events`, derives
// the surviving in-flight proposals via `derivePendingProposals`, and
// renders one `<li data-testid="participant-pending-proposal-row">` per
// row newest-first. The empty-state branch activates when the event log
// has zero surviving proposals (mirrors the moderator's pane source-
// of-truth choice per `mod_proposal_list` Decision §2).
//
// **The badge count is unchanged** — `usePendingProposalsCount` still
// reads the `pendingProposals` broadcast-frame map per the predecessor's
// Decision §3. The deliberate skew converges within one WS frame in
// well-formed sessions; the badge-source alignment is deferred to
// `part_vote_indicators_in_pane`.
//
// **No interactivity in v1** — the row is a plain non-interactive list
// item; tap-to-expand lands in `part_proposal_expand`.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProposalPayload } from '@a-conversa/shared-types';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';

import { useWsStore } from '../ws/wsStore';
import { useUiStore } from '../stores/uiStore';
import {
  derivePendingProposals,
  type PendingProposalRow as PendingProposalRowData,
} from './derivePendingProposals';
import { summaryText } from './proposalSummary';

export interface PendingProposalsPaneProps {
  sessionId: string;
  /**
   * Deterministic-time injection seam for the relative-time formatter.
   * Tests pass a fixed value; production callers omit it and the row
   * captures `Date.now()` at render time.
   */
  nowMsOverride?: number;
}

export function PendingProposalsPane({
  sessionId,
  nowMsOverride,
}: PendingProposalsPaneProps): ReactElement {
  const { t } = useTranslation();
  const events = useWsStore((s) => s.sessionState[sessionId]?.events);
  const rows = useMemo(() => derivePendingProposals(events ?? []), [events]);
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
}: {
  readonly row: PendingProposalRowData;
  readonly nowMs: number;
  readonly systemAuthorLabel: string;
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
          <p
            data-testid="participant-pending-proposal-row-body-summary"
            className="whitespace-pre-wrap break-words"
          >
            {summary}
          </p>
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
