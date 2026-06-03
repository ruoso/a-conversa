// Pure selector that derives the participant's "My agreements" history
// pane from a session's event log + the per-facet status index.
//
// Refinement: tasks/refinements/participant-ui/part_my_agreements_view.md
//
// `derivePersonalAgreements(events, currentParticipantId, facetStatusIndex)`
// walks the event log once, collects every `(entity, facet)` the current
// participant has voted `agree` on, then filters by the facet's current
// status (read off the supplied `facetStatusIndex`). The result is a
// chronologically-ordered (newest-first by the agree-vote's `sequence`)
// list of `PersonalAgreementRow`s — one per `(entity, facet)` the user
// holds (or held + withdrew + had reverted via meta-disagreement) an
// agreement on.
//
// **Pure / idempotent**: no `Date.now()`, no `Math.random()`, no closure
// over time. Relative-time formatting is a render-time concern in the
// pane component (`<MyAgreementsPane>` / `<MyAgreementsRow>`); the
// selector emits each agreement's ISO-8601 `createdAt` verbatim so the
// formatter sees the canonical wire value.
//
// **Reads only the event log + the facet-status index**: the index is
// supplied by the caller (the route's already-paid-per-frame
// `computeFacetStatuses(events)` memo); the selector does NOT re-derive
// it. Keeps the per-WS-frame projector cost paid once, shared with the
// graph view + detail panel.
//
// **Filter rule** (Decision §2 of the refinement):
//   - Include rows whose `currentStatus` ∈ {'agreed', 'committed',
//     'withdrawn', 'disputed'} — these are the history-bearing
//     post-settlement statuses the audit view exists to surface.
//   - Exclude 'proposed' (the participant's vote on an in-flight
//     proposal is not yet a settled agreement; the proposals pane shows
//     it); exclude 'meta-disagreement' (no participant's vote on the
//     underlying proposal counts as a current agreement); exclude
//     'awaiting-proposal' (no candidate was ever proposed — vacuous).
//
// **Per-key supersession** (refinement "Walk" §): if the participant
// voted agree on an earlier proposal targeting the same `(entity,
// facet)`, then later voted agree on a *new* proposal on that same
// facet, the candidate row's identity fields (`voteEventId`,
// `agreedAtSequence`, `agreedAtCreatedAt`, `candidateValue`) reflect the
// latest agree. The history view tracks the participant's most recent
// agreement on each facet; we deliberately do not surface stale
// re-agreements as separate rows.
//
// **Dispute invalidates agree** on the same facet key: a `vote dispute`
// by the current participant on `(entity, facet)` after a prior agree
// drops the candidate row (the participant changed their mind; they no
// longer hold an agreement on this facet).
//
// **Withdraw-agreement keeps the row**: the participant agreed, then
// withdrew. The history view surfaces "I agreed, then withdrew" as a
// row whose `currentStatus === 'withdrawn'` — that IS retrospective
// audit's core use case.
//
// **Votes by other participants are silently dropped** — the selector
// is narrowed to the current participant.
//
// **Structural-arm votes are dropped**: proposals without a per-facet
// target (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`,
// `break-edge`, `annotate`) cannot contribute to a "my agreements on a
// facet" surface. The `voteTargetOf` shape mirrors `ownVotes.ts:108-126`
// + `facetStatus.ts:132-164` per the same drift-risk note (three
// locations co-shaped until the audience surface triggers shell
// extraction).

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import type { FacetName, FacetStatus, FacetStatusIndex } from '@a-conversa/shell';

/**
 * One row in the "My agreements" pane. Carries enough context for the
 * row to render its identity columns (entity kind + id + facet +
 * candidate value), navigate the user to the underlying entity on tap
 * (selection target = `(entityKind, entityId)`), and surface the per-row
 * status badge that drives the audit signal.
 */
export interface PersonalAgreementRow {
  /**
   * The `vote` event's envelope id whose `choice === 'agree'` produced
   * this row. Stable React key + `data-vote-event-id` attribute.
   * Latest-agree-wins per facet key (see module header).
   */
  readonly voteEventId: string;
  /**
   * Per-session monotonic `event.sequence` of the agree vote. Sort key
   * (newest first = descending) AND the conceptual "when I agreed"
   * ordering the audit view surfaces.
   */
  readonly agreedAtSequence: number;
  /**
   * ISO-8601 `event.createdAt` of the agree vote. Render-side relative-
   * time formatting consumes this against a renderer-supplied `nowMs`.
   */
  readonly agreedAtCreatedAt: string;
  /** Target entity kind. Drives the tap-to-navigate selection target. */
  readonly entityKind: 'node' | 'edge';
  /** Target entity id. Drives the tap-to-navigate selection target. */
  readonly entityId: string;
  /** The facet of the entity the participant agreed on. */
  readonly facet: FacetName;
  /**
   * The candidate value the participant voted agree on, sourced from
   * the underlying proposal's payload. The exact string the participant
   * was endorsing — useful in the audit view ("what did I actually
   * agree to?").
   */
  readonly candidateValue: string;
  /**
   * The facet's current status, read off the supplied
   * `facetStatusIndex` at the end of the walk. Always one of the four
   * history-bearing values per the filter rule.
   */
  readonly currentStatus: FacetStatus;
}

/** Stable empty-result reference (memo bailout). */
export const EMPTY_PERSONAL_AGREEMENTS: readonly PersonalAgreementRow[] = Object.freeze([]);

/**
 * Resolve the `(entityKind, entityId, facet)` triple AND the candidate
 * value of a facet-targeting proposal. Mirrors the `voteTargetOf` in
 * `ownVotes.ts:108-126` + `facetStatus.ts:132-164` AND extends with the
 * `candidateValue` extraction this leaf's row column needs.
 *
 * Structural sub-kinds return `null` (no per-(entity, facet) target).
 */
function proposalTargetAndValue(proposal: ProposalPayload): {
  entityKind: 'node' | 'edge';
  entityId: string;
  facet: FacetName;
  candidateValue: string;
} | null {
  switch (proposal.kind) {
    case 'capture-node':
      return {
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'wording',
        candidateValue: proposal.wording,
      };
    case 'classify-node':
      return {
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'classification',
        candidateValue: proposal.classification,
      };
    case 'set-node-substance':
      return {
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'substance',
        candidateValue: proposal.value,
      };
    case 'set-edge-substance':
      return {
        entityKind: 'edge',
        entityId: proposal.edge_id,
        facet: 'substance',
        candidateValue: proposal.value,
      };
    case 'edit-wording':
      return {
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'wording',
        candidateValue: proposal.new_wording,
      };
    case 'amend-node':
      return {
        entityKind: 'node',
        entityId: proposal.node_id,
        facet: 'wording',
        candidateValue: proposal.new_content,
      };
    default:
      return null;
  }
}

interface CandidateAgreement {
  readonly voteEventId: string;
  readonly agreedAtSequence: number;
  readonly agreedAtCreatedAt: string;
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
  readonly candidateValue: string;
}

function facetIndexKey(entityKind: 'node' | 'edge', entityId: string, facet: FacetName): string {
  return `${entityKind}|${entityId}|${facet}`;
}

/**
 * Derive the current participant's chronological "my agreements" list
 * from a session's event log + the per-facet status index. See module
 * header for the walk + filter rationale.
 */
export function derivePersonalAgreements(
  events: readonly Event[],
  currentParticipantId: string,
  facetStatusIndex: FacetStatusIndex,
): readonly PersonalAgreementRow[] {
  // Per-proposal target + candidate-value cache so the proposal-keyed
  // vote arm can resolve back to the (entity, facet, value) triple
  // without re-walking. Structural proposals are not recorded (their
  // `voteTargetOf` returns `null`).
  const proposalCache = new Map<
    string,
    { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName; candidateValue: string }
  >();
  // Candidate rows, keyed by the facet identity string. Each agree by
  // the current participant overwrites; each dispute by the current
  // participant deletes. `withdraw-agreement` does NOT delete — the row
  // is preserved so the post-walk filter on `currentStatus` lets the
  // 'withdrawn'-status row through.
  const candidates = new Map<string, CandidateAgreement>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      const decoded = proposalTargetAndValue(event.payload.proposal);
      if (decoded !== null) {
        proposalCache.set(event.id, decoded);
      }
      continue;
    }
    if (event.kind === 'vote') {
      if (event.payload.participant !== currentParticipantId) continue;
      let target: {
        entityKind: 'node' | 'edge';
        entityId: string;
        facet: FacetName;
        candidateValue: string;
      } | null;
      if (event.payload.target === 'facet') {
        // Per ADR 0038 annotation facet votes ride this arm too; personal-
        // agreement rows are derived for node/edge facet proposals only
        // (an annotation dispute carries no candidate value and surfaces
        // via the moderator badge). Skip it.
        if (event.payload.entity_kind === 'annotation') continue;
        // Facet-keyed arm — the target identity is on the payload, but
        // the candidate value is NOT. Resolve the value through the
        // most-recent proposal cached for the same facet. Map iteration
        // order is insertion order, so this loop ends with the latest
        // matching proposal's candidate value (bounded by per-session
        // proposal count — negligible cost).
        let resolvedValue: string | undefined;
        for (const cached of proposalCache.values()) {
          if (
            cached.entityKind === event.payload.entity_kind &&
            cached.entityId === event.payload.entity_id &&
            cached.facet === event.payload.facet
          ) {
            resolvedValue = cached.candidateValue;
          }
        }
        if (resolvedValue === undefined) {
          // No prior facet-targeting proposal — skip; the vote cannot
          // surface a meaningful row without a candidate value.
          continue;
        }
        target = {
          entityKind: event.payload.entity_kind,
          entityId: event.payload.entity_id,
          facet: event.payload.facet,
          candidateValue: resolvedValue,
        };
      } else {
        const cached = proposalCache.get(event.payload.proposal_id);
        if (cached === undefined) continue;
        target = cached;
      }
      const key = facetIndexKey(target.entityKind, target.entityId, target.facet);
      if (event.payload.choice === 'agree') {
        candidates.set(key, {
          voteEventId: event.id,
          agreedAtSequence: event.sequence,
          agreedAtCreatedAt: event.createdAt,
          entityKind: target.entityKind,
          entityId: target.entityId,
          facet: target.facet,
          candidateValue: target.candidateValue,
        });
      } else {
        // dispute — invalidate any prior agree on the same facet key.
        candidates.delete(key);
      }
      continue;
    }
    // commit / meta-disagreement-marked / withdraw-agreement /
    // node-created / edge-created / annotation-created / entity-included
    // / entity-removed / session-* — none of these mutate the candidate
    // set directly. The facet-status walk (consumed via
    // `facetStatusIndex` below) reflects their downstream effects on
    // the row's `currentStatus`.
  }

  if (candidates.size === 0) return EMPTY_PERSONAL_AGREEMENTS;

  // Filter by current facet status; build rows.
  const rows: PersonalAgreementRow[] = [];
  for (const candidate of candidates.values()) {
    const bucket =
      candidate.entityKind === 'node' ? facetStatusIndex.nodes : facetStatusIndex.edges;
    const perFacet = bucket.get(candidate.entityId);
    const currentStatus = perFacet?.[candidate.facet];
    if (currentStatus === undefined) continue;
    if (
      currentStatus !== 'agreed' &&
      currentStatus !== 'committed' &&
      currentStatus !== 'withdrawn' &&
      currentStatus !== 'disputed'
    ) {
      continue;
    }
    rows.push({
      voteEventId: candidate.voteEventId,
      agreedAtSequence: candidate.agreedAtSequence,
      agreedAtCreatedAt: candidate.agreedAtCreatedAt,
      entityKind: candidate.entityKind,
      entityId: candidate.entityId,
      facet: candidate.facet,
      candidateValue: candidate.candidateValue,
      currentStatus,
    });
  }

  if (rows.length === 0) return EMPTY_PERSONAL_AGREEMENTS;

  rows.sort((a, b) => b.agreedAtSequence - a.agreedAtSequence);
  return rows;
}
