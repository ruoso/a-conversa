// `<PendingProposalsPane>` — the right-sidebar pane that lists every
// in-flight proposal for the current session.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
// (prior:     tasks/refinements/moderator-ui/mod_proposal_list.md)
// Design doc: docs/moderator-ui.md (right-sidebar panes, F1 step 4)
//
// Mounts into `<RightSidebar>`'s `pendingProposalsSlot` (per
// `mod_right_sidebar`). The pane closes the visible feedback loop after
// a successful propose — the freshly-proposed item appears at the top
// of the list within the same `event-applied` broadcast the capture
// pane optimistically-clears on.
//
// Surface:
//
//   - Container: `<div data-testid="pending-proposals-pane">` with a
//     localized `aria-label`. Scrollable inside the slot via
//     `overflow-y: auto; max-h-full` so a long list scrolls inside the
//     right-sidebar's height-bounded body.
//   - Empty state: `<p data-testid="pending-proposals-pane-empty">`
//     with the `moderator.proposalList.emptyState` catalog string.
//     Visible from first render — no loading state.
//   - List: `<ol role="list">` with one
//     `<li data-testid="pending-proposal-row" data-proposal-id="...">`
//     per surviving proposal (newest-first). Each row shows: a kind
//     chip, the wording-or-summary string (truncated), the 8-char
//     author prefix, and a relative-time timestamp.
//
// The selector (`derivePendingProposals`) is wrapped in a `useMemo`
// keyed on the `events` array reference so the derived list reference
// stays stable across renders when the log hasn't grown — siblings'
// future `React.memo`-wrapped row components and any virtualization
// stay cheap (Constraints).
//
// **No business logic** (Constraints): the pane reads `useWsStore`
// only; it does not touch `wsClient.send`, the capture store, or the
// methodology engine. It is a pure derived view of the event log.
//
// **No selection / click handler** (Constraints): the `<li>` is a
// plain non-interactive list item in v1. Siblings
// (`mod_per_facet_breakdown`, `mod_commit_button`,
// `mod_vote_indicators_in_sidebar`, `mod_proposal_filter_search`)
// will add interactivity / per-facet rendering / commit button on top
// of the row contract this task establishes.
//
// **Real-time updates via Zustand subscription** (Decision §8): the
// component subscribes to `useWsStore` with a selector that reads
// `sessionState[sessionId].events`. Zustand's reference-equality check
// re-renders only when the events array reference changes, which
// happens on each `applyEvent` write (the WS writer creates a new
// array via `[...session.events, event]`).

import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProposalPayload } from '@a-conversa/shared-types';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';

import { useWsStore } from '../ws/wsStore';
import {
  derivePendingProposals,
  type PendingProposalRow as PendingProposalRowData,
} from '../graph/pendingProposals';
import { computeFacetStatuses, type FacetStatusIndex } from '../graph/facetStatus';
import { projectVotesByFacet, projectVotesByProposal } from '../graph/selectors';
import {
  deriveAllAgree,
  deriveCurrentParticipants,
  derivePerProposalFacets,
  type CommitGateReason,
  type VotesByFacetIndex,
  type VotesByProposalIndex,
} from '../graph/proposalFacets';
import {
  isDefaultFilter,
  matchesProposalFilter,
  type ProposalFilter,
  type ProposalFilterState,
} from '../graph/proposalFilter';
import { summaryText } from '../graph/proposalSummary';
import { ProposalFacetBreakdown } from './ProposalFacetBreakdown';
import { useCommitAction } from './useCommitAction';
import { useMarkMetaDisagreementAction } from './useMarkMetaDisagreementAction';
import { useWithdrawProposalAction } from './useWithdrawProposalAction';
import { useAuth } from '@a-conversa/shell';

/**
 * Props for the pane. The `sessionId` is threaded through from the
 * mounting site (`<OperateRoute>`) so the pane subscribes to the right
 * per-session slice of `useWsStore`.
 */
export interface PendingProposalsPaneProps {
  /** The session whose events drive the pane's contents. */
  readonly sessionId: string;
  /**
   * Optional reference time for relative-time formatting. Lets callers
   * (notably the component test) inject a deterministic "now" so the
   * relative-time string is stable across test runs. Defaults to
   * `Date.now()` at render time.
   */
  readonly nowMs?: number;
}

const PANE_CONTAINER_CLASSES = 'flex max-h-full flex-col gap-1 overflow-y-auto text-slate-700';
const LIST_CLASSES = 'm-0 flex list-none flex-col gap-1 p-0';
// Per `mod_proposal_filter_search` Decision §7 — pinned strip above the
// list with a free-text input (flex-1, consumes available width) and a
// state-filter chip group (auto-width on the right, wraps below on
// narrow widths). The strip itself stays visible above the conditional
// empty-state-vs-list branch (Decision §2).
const FILTER_STRIP_CLASSES = 'flex flex-wrap items-center gap-2 py-1';
const FILTER_TEXT_CONTAINER_CLASSES = 'relative flex flex-1 min-w-[8rem] items-center';
const FILTER_TEXT_INPUT_CLASSES =
  'w-full rounded border border-slate-200 bg-white px-2 py-1 pr-6 text-sm text-slate-700 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400';
const FILTER_TEXT_CLEAR_CLASSES =
  'absolute right-1 inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400';
const FILTER_CHIP_GROUP_CLASSES = 'flex flex-wrap items-center gap-1';
const FILTER_CHIP_BASE_CLASSES =
  'rounded border px-2 py-0.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400';
const FILTER_CHIP_INACTIVE_CLASSES = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
// Per Decision §7 — pressed-chip uses the same `slate-700` tone as the
// row kind chip for visual continuity.
const FILTER_CHIP_ACTIVE_CLASSES = 'border-slate-700 bg-slate-700 text-white';
// Per `mod_per_facet_breakdown` Decision §2 / Constraints, the row
// grew from a single-line flex container to a two-line stack: the
// header keeps its one-line shape; the breakdown sits below it.
const ROW_CLASSES = 'flex flex-col gap-1 rounded border border-slate-200 bg-white px-2 py-1';
const ROW_HEADER_CLASSES = 'flex items-center gap-2';
const KIND_CHIP_CLASSES =
  'flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700';
const SUMMARY_CLASSES = 'flex-1 truncate text-sm';
const AUTHOR_CLASSES = 'flex-shrink-0 text-xs text-slate-500';
const TIMESTAMP_CLASSES = 'flex-shrink-0 text-xs text-slate-500';
const EMPTY_STATE_CLASSES = 'italic text-slate-500';
// Per `mod_commit_button` Decision §2 + §3 — secondary-density button,
// emerald-700 palette ("commit / land" semantically — green for "go").
// WCAG AA: white-on-emerald-700 ≈ 5.96:1 (pass); slate-500-on-slate-100
// (disabled) ≈ 5.36:1 (pass).
const COMMIT_BUTTON_CLASSES =
  'flex-shrink-0 inline-flex items-center gap-1 rounded border border-emerald-700 bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-800 hover:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500';
const COMMIT_WIRE_ERROR_CLASSES = 'text-xs text-red-700';
// Mark-meta-disagreement button — secondary-density, amber-700
// palette ("escape hatch" — the moderator declares the disagreement
// irreducible after methodology has been exhausted). WCAG AA:
// white-on-amber-700 ≈ 5.18:1 (pass). Visually distinct from the
// emerald commit chip so the two row-level actions read as distinct
// affordances at a glance.
const MARK_META_BUTTON_CLASSES =
  'flex-shrink-0 inline-flex items-center gap-1 rounded border border-amber-700 bg-amber-700 px-2 py-0.5 text-xs font-medium text-white shadow-sm hover:bg-amber-800 hover:border-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500';
const MARK_META_WIRE_ERROR_CLASSES = 'text-xs text-red-700';
// Withdraw button — secondary-density, slate outline ("retract / cancel",
// semantically the inverse of commit). Outlined rather than filled so
// it's visually subordinate to the commit button. WCAG AA:
// slate-700-on-white ≈ 12.6:1 (pass); slate-500-on-slate-100
// (disabled) ≈ 5.36:1 (pass).
const WITHDRAW_BUTTON_CLASSES =
  'flex-shrink-0 inline-flex items-center gap-1 rounded border border-slate-400 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500';
const WITHDRAW_WIRE_ERROR_CLASSES = 'text-xs text-red-700';

/**
 * Reason-tag → ICU `select` arm-name in `moderator.commitButton.reason`.
 * The catalog stores all six arms in one ICU `{select}` block under a
 * single key — Decision §8 + per-arm names in the en-US `select` block.
 */
const COMMIT_REASON_SELECT_ARM: Readonly<Record<CommitGateReason, string>> = {
  'session-not-connected': 'sessionNotConnected',
  'proposal-meta-disagreement': 'proposalMetaDisagreement',
  'no-current-participants': 'noCurrentParticipants',
  'participants-not-voted': 'participantsNotVoted',
  'participants-disagree': 'participantsDisagree',
  'structural-sub-kind-not-supported': 'structuralSubKindNotSupported',
};

/**
 * Map the proposal sub-kind to a `methodology.kind.<kind>` catalog
 * key when the sub-kind is a `classify-node` (Decision §7 reuses the
 * existing `methodology.kind.*` keys for the five-way classification);
 * otherwise return a short literal label (the structural sub-kinds
 * have not yet reached the wire from a capture flow, so this task
 * deliberately keeps the catalog footprint proportional to what's
 * actually reachable — Decision §7).
 */
function kindChipText(proposal: ProposalPayload, t: (key: string) => string): string {
  if (proposal.kind === 'classify-node') {
    return t(`methodology.kind.${proposal.classification}`);
  }
  // Per Decision §7, the structural sub-kinds (decompose, axiom-mark,
  // meta-move, break-edge, amend-node, annotate, set-substance,
  // edit-wording, interpretive-split, capture-node) keep a hard-coded
  // English placeholder until their own capture-flow tasks register
  // summary catalog keys. The literal sub-kind name is a defensible v1.
  return proposal.kind;
}

// `summaryText(proposal)` is now exported from `../graph/proposalSummary`
// so the row component AND the filter predicate
// (`../graph/proposalFilter`) compute against the same string by
// construction (mod_proposal_filter_search Decision §3).

/**
 * Format the author column — 8-char UUID prefix in v1, or a localized
 * "System" label if `actor === null` (a system-emitted proposal
 * envelope; not expected today but the envelope shape allows it —
 * Decision §6).
 */
function authorText(actor: string | null, systemLabel: string): string {
  if (actor === null) return systemLabel;
  return actor.slice(0, 8);
}

/**
 * Compute the relative-time string for the row's timestamp column.
 * `formatRelativeTime`'s sign convention is past = negative, so we
 * pass `secondsAgo` as a negative number (and let the formatter pick
 * the appropriate unit / wording via `numeric: 'auto'`).
 *
 * The seconds-resolution is chosen because the freshly-proposed item
 * lands at the top of the list within tens of ms of the propose
 * gesture; rounding to minutes would surface "0 minutes ago" for the
 * first ~60s after a propose, which is uninformative.
 */
function relativeTimeFor(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  // Defensive — an invalid ISO string parses to NaN; the formatter
  // would throw. Surface a stable fallback rather than crash the pane.
  if (Number.isNaN(createdMs)) return createdAt;
  const secondsAgo = Math.round((nowMs - createdMs) / 1000);
  return formatRelativeTime(-secondsAgo, 'second');
}

/**
 * One row in the list. Co-located inside this file (Decision §3 —
 * small enough not to warrant its own file in v1). Sibling tasks will
 * wrap / extend / re-shape this row contract; the `data-testid` +
 * `data-proposal-id` attributes are the stable seam.
 */
function PendingProposalRow(props: {
  readonly row: PendingProposalRowData;
  readonly nowMs: number;
  readonly systemAuthorLabel: string;
  readonly t: (key: string) => string;
  readonly facetStatusIndex: FacetStatusIndex;
  readonly serverPerFacetStatus: Record<string, string> | undefined;
  readonly votesByFacetIndex: VotesByFacetIndex;
  readonly votesByProposalIndex: VotesByProposalIndex;
  readonly currentParticipantIds: ReadonlySet<string>;
  readonly connectionOpen: boolean;
}): ReactElement {
  const {
    row,
    nowMs,
    systemAuthorLabel,
    t,
    facetStatusIndex,
    serverPerFacetStatus,
    votesByFacetIndex,
    votesByProposalIndex,
    currentParticipantIds,
    connectionOpen,
  } = props;
  // The commit-button + tooltip + wire-error region need ICU
  // interpolation; the parent's `t` prop is the narrow
  // `(key: string) => string` shape the kind-chip / summary helpers
  // already consume. Pull the full `t` off `useTranslation()` for the
  // commit-side rendering so we can pass `{ reason }` / `{ code,
  // message }` options.
  const { t: tFull } = useTranslation();
  const chip = kindChipText(row.proposal, t);
  const summary = summaryText(row.proposal);
  const author = authorText(row.actor, systemAuthorLabel);
  const ago = relativeTimeFor(row.createdAt, nowMs);

  // Per `mod_commit_button` — derive the row's facet entries once for
  // the breakdown AND the commit-gate predicate. The breakdown
  // component re-derives internally today; threading the entries down
  // is a future refactor (the duplicate derivation is O(facets-per-row)
  // which is at most 1).
  const entries = derivePerProposalFacets(
    row.proposal,
    facetStatusIndex,
    serverPerFacetStatus,
    votesByFacetIndex,
    row.proposalEventId,
    votesByProposalIndex,
  );
  // Outer connection-status gate (Decision §1.b) — applied BEFORE
  // calling `deriveAllAgree` so the predicate stays pure (no WS-status
  // argument).
  //
  // The third argument (`row.proposal`) lets the predicate apply the
  // axiom-mark exclusion when the proposal is `kind: 'axiom-mark'` —
  // the declared participant doesn't vote on their own bedrock
  // declaration. Mirrors the server's
  // `checkUnanimousAgreeStructural`'s `excludedParticipant` filter
  // (per commit `421353f`).
  const gate = !connectionOpen
    ? ({ ok: false, reason: 'session-not-connected' } as const)
    : deriveAllAgree(entries, currentParticipantIds, row.proposal);

  const { commit, inFlight, lastError } = useCommitAction(row.proposalEventId);
  const {
    mark: markMetaDisagreement,
    inFlight: markInFlight,
    lastError: markLastError,
  } = useMarkMetaDisagreementAction(row.proposalEventId);
  const {
    withdraw,
    inFlight: withdrawInFlight,
    lastError: withdrawLastError,
  } = useWithdrawProposalAction(row.proposalEventId);
  const auth = useAuth();
  // Proposer-only UX guard: show the withdraw button only when the
  // current authenticated user is the original proposer. The server's
  // `forbidden` gate is the authority — this is a UX-affordance hide.
  const isProposer =
    auth.status === 'authenticated' &&
    auth.user?.userId !== undefined &&
    row.actor === auth.user.userId;

  const commitState: 'disabled' | 'enabled' | 'in-flight' = inFlight
    ? 'in-flight'
    : gate.ok
      ? 'enabled'
      : 'disabled';
  const commitDisabled = commitState !== 'enabled';
  const commitLabel = inFlight
    ? tFull('moderator.commitButton.inFlightLabel')
    : tFull('moderator.commitButton.label');
  const commitAriaLabel = tFull('moderator.commitButton.ariaLabel');

  // Tooltip text — only when the gate blocks (the enabled state has no
  // `title` decoration, per Decision §3).
  let commitTitle: string | undefined;
  let commitGateReasonAttr: string | undefined;
  if (!gate.ok) {
    commitGateReasonAttr = gate.reason;
    const reasonText = tFull('moderator.commitButton.reason', {
      reason: COMMIT_REASON_SELECT_ARM[gate.reason],
    });
    commitTitle = tFull('moderator.commitButton.gateTooltip', { reason: reasonText });
  }

  // Wire-error message text. The localized template interpolates
  // `{code}` + `{message}`; the timeout case uses the pre-localized
  // fallback already on `lastError.message`.
  let wireMessage: string | undefined;
  if (lastError !== undefined) {
    wireMessage =
      lastError.code === 'timeout'
        ? lastError.message
        : tFull('moderator.commitButton.wireError', {
            code: lastError.code,
            message: lastError.message,
          });
  }

  // Mark-meta-disagreement button — methodology gates enforced
  // server-side; UI button is unconditionally enabled once the
  // connection is open and no mark is in flight.
  const markState: 'disabled' | 'enabled' | 'in-flight' = markInFlight
    ? 'in-flight'
    : connectionOpen
      ? 'enabled'
      : 'disabled';
  const markDisabled = markState !== 'enabled';
  const markLabel = markInFlight
    ? tFull('moderator.markMetaDisagreementButton.inFlightLabel')
    : tFull('moderator.markMetaDisagreementButton.label');
  const markAriaLabel = tFull('moderator.markMetaDisagreementButton.ariaLabel');

  let markWireMessage: string | undefined;
  if (markLastError !== undefined) {
    markWireMessage =
      markLastError.code === 'timeout'
        ? markLastError.message
        : tFull('moderator.markMetaDisagreementButton.wireError', {
            code: markLastError.code,
            message: markLastError.message,
          });
  }

  // Withdraw button — no client-side gate; only the server's
  // proposer-only `forbidden` check is authoritative.
  const withdrawState: 'enabled' | 'in-flight' = withdrawInFlight ? 'in-flight' : 'enabled';
  const withdrawDisabled = withdrawState !== 'enabled';
  const withdrawLabel = withdrawInFlight
    ? tFull('moderator.withdrawProposalButton.inFlightLabel')
    : tFull('moderator.withdrawProposalButton.label');
  const withdrawAriaLabel = tFull('moderator.withdrawProposalButton.ariaLabel');

  let withdrawWireMessage: string | undefined;
  if (withdrawLastError !== undefined) {
    withdrawWireMessage =
      withdrawLastError.code === 'timeout'
        ? withdrawLastError.message
        : tFull('moderator.withdrawProposalButton.wireError', {
            code: withdrawLastError.code,
            message: withdrawLastError.message,
          });
  }

  return (
    <li
      data-testid="pending-proposal-row"
      data-proposal-id={row.proposalEventId}
      className={ROW_CLASSES}
      title={summary}
    >
      <div className={ROW_HEADER_CLASSES}>
        <span data-testid="pending-proposal-row-kind" className={KIND_CHIP_CLASSES}>
          {chip}
        </span>
        <span data-testid="pending-proposal-row-summary" className={SUMMARY_CLASSES}>
          {summary}
        </span>
        <span data-testid="pending-proposal-row-author" className={AUTHOR_CLASSES}>
          {author}
        </span>
        <span data-testid="pending-proposal-row-timestamp" className={TIMESTAMP_CLASSES}>
          {ago}
        </span>
        <button
          type="button"
          data-testid="commit-button"
          data-proposal-id={row.proposalEventId}
          data-commit-state={commitState}
          data-commit-gate-reason={commitGateReasonAttr}
          disabled={commitDisabled}
          aria-disabled={commitDisabled}
          aria-label={commitAriaLabel}
          title={commitTitle}
          onClick={() => {
            void commit();
          }}
          className={COMMIT_BUTTON_CLASSES}
        >
          {commitLabel}
        </button>
        <button
          type="button"
          data-testid="mark-meta-disagreement-button"
          data-proposal-id={row.proposalEventId}
          data-mark-state={markState}
          disabled={markDisabled}
          aria-disabled={markDisabled}
          aria-label={markAriaLabel}
          onClick={() => {
            void markMetaDisagreement();
          }}
          className={MARK_META_BUTTON_CLASSES}
        >
          {markLabel}
        </button>
        {isProposer ? (
          <button
            type="button"
            data-testid="withdraw-proposal-button"
            data-proposal-id={row.proposalEventId}
            data-withdraw-state={withdrawState}
            disabled={withdrawDisabled}
            aria-disabled={withdrawDisabled}
            aria-label={withdrawAriaLabel}
            onClick={() => {
              void withdraw();
            }}
            className={WITHDRAW_BUTTON_CLASSES}
          >
            {withdrawLabel}
          </button>
        ) : null}
      </div>
      <ProposalFacetBreakdown
        row={row}
        facetStatusIndex={facetStatusIndex}
        serverPerFacetStatus={serverPerFacetStatus}
        votesByFacetIndex={votesByFacetIndex}
        votesByProposalIndex={votesByProposalIndex}
      />
      {wireMessage !== undefined ? (
        <p
          data-testid="commit-button-wire-error"
          data-proposal-id={row.proposalEventId}
          role="alert"
          className={COMMIT_WIRE_ERROR_CLASSES}
        >
          {wireMessage}
        </p>
      ) : null}
      {markWireMessage !== undefined ? (
        <p
          data-testid="mark-meta-disagreement-button-wire-error"
          data-proposal-id={row.proposalEventId}
          role="alert"
          className={MARK_META_WIRE_ERROR_CLASSES}
        >
          {markWireMessage}
        </p>
      ) : null}
      {withdrawWireMessage !== undefined ? (
        <p
          data-testid="withdraw-proposal-button-wire-error"
          data-proposal-id={row.proposalEventId}
          role="alert"
          className={WITHDRAW_WIRE_ERROR_CLASSES}
        >
          {withdrawWireMessage}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The three state-filter chip arms (Decision §1.c). Declared at module
 * scope so the chip-render loop iterates a stable reference.
 */
const FILTER_STATES: readonly ProposalFilterState[] = ['all', 'ready', 'disputed'];

/**
 * Map a `ProposalFilterState` to the ICU-select arm name in
 * `moderator.proposalFilter.stateChipLabel` (Decision §9 — one key with
 * three arms mirrors the `moderator.commitButton.reason` pattern).
 */
const FILTER_STATE_SELECT_ARM: Readonly<Record<ProposalFilterState, string>> = {
  all: 'all',
  ready: 'ready',
  disputed: 'disputed',
};

export function PendingProposalsPane(props: PendingProposalsPaneProps): ReactElement {
  const { sessionId, nowMs } = props;
  const { t } = useTranslation();

  // Zustand selector — read only the per-session events array. The
  // store creates a new array reference on each `applyEvent` write
  // (`[...session.events, event]`), so the reference-equality check
  // re-renders the pane the moment a new event lands.
  const events = useWsStore((state) => state.sessionState[sessionId]?.events);

  // Second Zustand selector — read the per-proposal server-broadcast
  // `proposal-status` map (new read in
  // `tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`). The
  // reference-equality check re-renders the pane when a new
  // `proposal-status` envelope lands (the writer
  // `applyProposalStatus` creates a fresh object each call). Two
  // separate subscriptions keep each cell narrow per the established
  // moderator-pane convention.
  const pendingProposals = useWsStore((state) => state.sessionState[sessionId]?.pendingProposals);

  // `useMemo` keyed on the events reference so the derived row list
  // stays referentially stable across renders when the log hasn't
  // grown (Constraints). `events ?? []` keeps the hook stable when
  // the session has not yet been touched.
  const rows = useMemo(() => derivePendingProposals(events ?? []), [events]);

  // Per `mod_per_facet_breakdown` Decision §8, the facet-status index
  // is computed ONCE per pane render, keyed on the events reference.
  // Each row's breakdown derivation memoizes on top of this shared
  // index, so the total cost is O(events) for the walk plus
  // O(rows × facets-per-row) for the per-row derivations.
  const facetStatusIndex = useMemo(() => computeFacetStatuses(events ?? []), [events]);

  // Per `mod_vote_indicators_in_sidebar` Decision §3 + §10, the
  // per-(entityId, facet) vote bucket is computed ONCE per pane
  // render via the same `events`-keyed memo pattern. Each row's
  // breakdown derivation reads this shared index — adding the
  // sidebar consumer is `O(events)` for the projection walk
  // (matched against the graph canvas's own
  // `projectVotesByFacet(events)` pass) plus per-row lookups.
  const votesByFacetIndex = useMemo(() => projectVotesByFacet(events ?? []), [events]);

  // Per-proposal-id vote bucket for structural sub-kinds (decompose,
  // interpretive-split, axiom-mark, annotate). Same `events`-keyed
  // memo pattern as `votesByFacetIndex` above — one walk shared across
  // every row's commit-gate computation per render. Surfaces the
  // server-side `pendingProposal.perParticipantVotes` map on the
  // client without a separate WS subscription (per commit `421353f`
  // the server populates this map for structural proposals; the
  // moderator UI mirrors the walk from the event log).
  const votesByProposalIndex = useMemo(() => projectVotesByProposal(events ?? []), [events]);

  // Per `mod_commit_button` Decision §1.a, the set of currently-joined
  // NON-moderator participant ids is the cardinality the commit gate
  // requires unanimous `'agree'` over. Same `events`-keyed memo
  // pattern; one O(events) walk shared across every row's gate
  // computation per render.
  const currentParticipantIds = useMemo(() => deriveCurrentParticipants(events ?? []), [events]);

  // The outer connection-status gate (Decision §1.b) is read from the
  // top-level WS store; threaded down so each row's button surfaces a
  // uniform `data-commit-gate-reason="session-not-connected"` when the
  // socket is anything other than `'open'`.
  const connectionOpen = useWsStore((state) => state.connectionStatus === 'open');

  // Per `mod_proposal_filter_search` Decision §5 — two local-component
  // state cells driving the filter strip. No Zustand slice, no URL
  // param: the filter resets on every pane mount (by design — the
  // moderator's filter from minutes ago is rarely the filter they want
  // now). The pair is composed into a `ProposalFilter` for downstream
  // consumers via a single `useMemo`.
  const [filterText, setFilterText] = useState<string>('');
  const [filterState, setFilterState] = useState<ProposalFilterState>('all');

  const filter: ProposalFilter = useMemo(
    () => ({ text: filterText, state: filterState }),
    [filterText, filterState],
  );

  // Identity-stable fast path (Decision §8) — when the filter is the
  // default, return the pre-filter `rows` reference directly so the
  // pane stays identity-stable and downstream `React.memo`-wrapped row
  // components don't re-render spuriously. Otherwise compute the
  // filtered subset, keyed on the meaningful inputs.
  const filteredRows = useMemo(() => {
    if (isDefaultFilter(filter)) return rows;
    return rows.filter((row) =>
      matchesProposalFilter(
        row,
        filter,
        currentParticipantIds,
        votesByFacetIndex,
        facetStatusIndex,
        pendingProposals?.[row.proposalEventId]?.perFacetStatus,
        votesByProposalIndex,
      ),
    );
  }, [
    rows,
    filter,
    currentParticipantIds,
    votesByFacetIndex,
    votesByProposalIndex,
    facetStatusIndex,
    pendingProposals,
  ]);

  const resolvedNowMs = nowMs ?? Date.now();
  const systemAuthorLabel = t('moderator.proposalList.systemAuthor');
  const paneAriaLabel = t('moderator.proposalList.paneAriaLabel');
  const filterTextPlaceholder = t('moderator.proposalFilter.textPlaceholder');
  const filterTextAriaLabel = t('moderator.proposalFilter.textAriaLabel');
  const filterClearAriaLabel = t('moderator.proposalFilter.clearTextAriaLabel');
  const noMatchesText = t('moderator.proposalFilter.noMatches');

  const filterIsActive = !isDefaultFilter(filter);
  // Decision §4 — the two distinct empty-state triggers. The original
  // "no proposals at all" copy surfaces ONLY when the default filter
  // is in effect; the new "no matches" copy surfaces when the filter
  // is non-default and the post-filter count is zero (regardless of
  // the pre-filter count).
  const showDefaultEmpty = !filterIsActive && filteredRows.length === 0;
  const showFilteredEmpty = filterIsActive && filteredRows.length === 0;

  // The strip stays visible above the conditional empty-state-vs-list
  // branch (Decision §2 — the filter is the moderator's escape from
  // the filtered-empty state; hiding it would be a usability dead-end).
  const filterStrip = (
    <div data-testid="pending-proposals-filter-strip" className={FILTER_STRIP_CLASSES}>
      <div className={FILTER_TEXT_CONTAINER_CLASSES}>
        <input
          type="search"
          data-testid="pending-proposals-filter-text"
          className={FILTER_TEXT_INPUT_CLASSES}
          placeholder={filterTextPlaceholder}
          aria-label={filterTextAriaLabel}
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
          }}
        />
        {filterText !== '' ? (
          <button
            type="button"
            data-testid="pending-proposals-filter-text-clear"
            aria-label={filterClearAriaLabel}
            className={FILTER_TEXT_CLEAR_CLASSES}
            onClick={() => {
              setFilterText('');
            }}
          >
            {/* Decision §6 — inline × glyph; the localized aria-label
                carries the accessible name. */}
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
      <div className={FILTER_CHIP_GROUP_CLASSES}>
        {FILTER_STATES.map((state) => {
          const pressed = filterState === state;
          const label = t('moderator.proposalFilter.stateChipLabel', {
            state: FILTER_STATE_SELECT_ARM[state],
          });
          return (
            <button
              key={state}
              type="button"
              data-testid="pending-proposals-filter-state"
              data-filter-state={state}
              aria-pressed={pressed}
              className={`${FILTER_CHIP_BASE_CLASSES} ${pressed ? FILTER_CHIP_ACTIVE_CLASSES : FILTER_CHIP_INACTIVE_CLASSES}`}
              onClick={() => {
                setFilterState(state);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      data-testid="pending-proposals-pane"
      aria-label={paneAriaLabel}
      className={PANE_CONTAINER_CLASSES}
    >
      {filterStrip}
      {showDefaultEmpty ? (
        <p data-testid="pending-proposals-pane-empty" className={EMPTY_STATE_CLASSES}>
          {t('moderator.proposalList.emptyState')}
        </p>
      ) : null}
      {showFilteredEmpty ? (
        <p data-testid="pending-proposals-filtered-empty" className={EMPTY_STATE_CLASSES}>
          {noMatchesText}
        </p>
      ) : null}
      {filteredRows.length > 0 ? (
        <ol data-testid="pending-proposals-pane-list" role="list" className={LIST_CLASSES}>
          {filteredRows.map((row) => (
            <PendingProposalRow
              key={row.proposalEventId}
              row={row}
              nowMs={resolvedNowMs}
              systemAuthorLabel={systemAuthorLabel}
              t={t}
              facetStatusIndex={facetStatusIndex}
              serverPerFacetStatus={pendingProposals?.[row.proposalEventId]?.perFacetStatus}
              votesByFacetIndex={votesByFacetIndex}
              votesByProposalIndex={votesByProposalIndex}
              currentParticipantIds={currentParticipantIds}
              connectionOpen={connectionOpen}
            />
          ))}
        </ol>
      ) : null}
    </div>
  );
}
