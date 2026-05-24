// Per-facet overall-status derivation.
//
// Refinement (current shape): tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md
// Historical: tasks/refinements/data-and-methodology/per_facet_status_derivation.md
//   (the original seven-rule shape, before per-facet keying)
// TaskJuggler: per_facet_refactor.projection.pf_projection_facet_status_refactor
//
// Per [ADR 0030](../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)
// the facet layer's identity is the pair `(entity_kind, entity_id, facet)`,
// not the proposal id that last touched it. This derivation reads the
// per-facet state assembled by the dispatcher in `replay.ts` — the
// per-participant vote map keyed by participant id, the per-participant
// withdrawals set, the current `candidateValue`, the `committedAt` +
// `committedCandidateValue` markers, and the `metaDisagreement` flag —
// and produces the eight-value `FacetStatus` that the methodology
// engine, the moderator UI, the audience broadcaster, and
// `active_firing_computation` all consume.
//
// **Eight derivation rules**, in priority order (per ADR 0030 §10 +
// `pf_projection_facet_status_refactor`):
//
//   1. `metaDisagreement === true` → `'meta-disagreement'`.
//   2. `candidateValue === null` → `'awaiting-proposal'`.
//   3. Filter `perParticipant` and `withdrawals` to current
//      participants (`leftAt === null`).
//   4. A current participant in `withdrawals` AND `committedAt !== null`
//      AND the committed value still matches the current candidate
//      → `'withdrawn'`.
//   5. Any current participant whose most-recent vote is `'dispute'`
//      → `'disputed'`.
//   6. `committedAt !== null` AND the committed value still matches the
//      current candidate AND no current participant has overturned via
//      dispute or withdraw → `'committed'`.
//   7. At least one current participant has voted AND every current
//      participant has voted `'agree'` → `'agreed'`.
//   8. Otherwise → `'proposed'`.
//
// **Boundary with the methodology engine.** This derivation reads
// recorded state and reports the resulting status. It does NOT
// validate (e.g. "moderator can only commit an agreed facet";
// "withdrawal is only valid against an existing agree on a committed
// proposal"). Those validations live in the methodology engine and
// consume `deriveFacetStatus` to make their decisions.
//
// **Lazy / not memoized.** O(participants) per call; a sibling task
// (`projection_caching`) addresses memoization across reads. The
// function is pure — repeat calls are well-defined.

import type { Projection } from './projection.js';
import type { FacetName, FacetState, FacetStatus } from './types.js';

export class FacetStatusDerivationError extends Error {
  override readonly name = 'FacetStatusDerivationError';
}

export type DeriveEntityKind = 'node' | 'edge' | 'annotation';

function resolveFacet(
  projection: Projection,
  entityKind: DeriveEntityKind,
  entityId: string,
  facet: FacetName,
): FacetState<unknown> {
  if (entityKind === 'node') {
    const node = projection.getNode(entityId);
    if (!node) {
      throw new FacetStatusDerivationError(`node ${entityId} not present in projection`);
    }
    if (facet === 'classification') return node.classificationFacet;
    if (facet === 'substance') return node.substanceFacet;
    if (facet === 'wording') return node.wordingFacet;
    // Exhaustively narrowed by the three branches above; runtime
    // safety net for callers that bypass TypeScript.
    throw new FacetStatusDerivationError('unknown facet for node');
  }
  if (entityKind === 'edge') {
    const edge = projection.getEdge(entityId);
    if (!edge) {
      throw new FacetStatusDerivationError(`edge ${entityId} not present in projection`);
    }
    if (facet === 'substance') return edge.substanceFacet;
    // Edges carry no `wording` or `classification` facet in v1; the
    // `shape` facet (role + endpoints) is now a first-class `FacetState`
    // per ADR 0030 §5 + `pf_projection_facet_status_refactor`. The
    // `FacetName` union (`'classification' | 'substance' | 'wording'`)
    // does not currently include `'shape'`; the in-memory edge carries
    // a `shapeFacet` for the derivation to read but the `FacetName`-
    // valued call path does not address it until the `FacetName` union
    // widens (a downstream refactor — out of scope for this task).
    throw new FacetStatusDerivationError(`facet "${facet}" not applicable to edge in v1`);
  }
  if (entityKind === 'annotation') {
    const ann = projection.getAnnotation(entityId);
    if (!ann) {
      throw new FacetStatusDerivationError(`annotation ${entityId} not present in projection`);
    }
    if (facet === 'wording') return ann.wordingFacet;
    if (facet === 'substance') return ann.substanceFacet;
    throw new FacetStatusDerivationError(`facet "${facet}" not applicable to annotation`);
  }
  // `entityKind` is exhaustively narrowed by the branches above; this
  // throw is a runtime safety net for callers that bypass TypeScript.
  throw new FacetStatusDerivationError('unknown entityKind');
}

export function deriveFacetStatus(
  projection: Projection,
  entityKind: DeriveEntityKind,
  entityId: string,
  facet: FacetName,
): FacetStatus {
  const facetState = resolveFacet(projection, entityKind, entityId, facet);
  return deriveFacetStatusFromState(projection, facetState);
}

// `deriveFacetStatusFromState` — same eight-rule derivation, applied to
// a `FacetState` value the caller already resolved. Exposed for the
// edge `shape` facet (per ADR 0030 §5 the shape lives inline on
// `edge-created`; the `FacetName` union does not name it, so the
// `deriveFacetStatus` lookup path can't reach it). Per
// `pf_sequence_gate_server_enforced` the propose handler's sequence
// gate needs the shape facet's derived status to evaluate the
// `set-edge-substance` arm's predecessor check — it reads the facet
// directly off `projection.getEdge(edgeId).shapeFacet` and routes
// through this entry point.
//
// The function is pure over `(facetState, projection.currentParticipants())`;
// it does NOT re-resolve the facet (the caller did) and does NOT walk
// the entity graph.
export function deriveFacetStatusFromState(
  projection: Projection,
  facetState: FacetState<unknown>,
): FacetStatus {
  // Rule 1: meta-disagreement on the underlying state short-circuits.
  // Set by the meta-disagreement handler when a facet-keyed
  // meta-disagreement-marked event lands on this facet.
  if (facetState.status === 'meta-disagreement' || facetState.metaDisagreement === true) {
    return 'meta-disagreement';
  }

  // Rule 2: no candidate value yet — the entity exists but no
  // proposal / inline carriage has named a value for the facet.
  // Per ADR 0030 §10: this is the empty-state row for the participant
  // detail panel; the moderator's node card surfaces the affordance to
  // propose a candidate here.
  if (facetState.candidateValue === null) {
    return 'awaiting-proposal';
  }

  // Rule 3: filter perParticipant + withdrawals by current
  // participants. Left participants' marks are historical — methodology
  // says "current participants" must agree.
  const currentIds = new Set(projection.currentParticipants().map((p) => p.userId));
  const currentVotes: string[] = [];
  for (const [participantId, record] of facetState.perParticipant) {
    if (currentIds.has(participantId)) {
      currentVotes.push(record.vote);
    }
  }
  let hasCurrentWithdrawal = false;
  for (const participantId of facetState.withdrawals) {
    if (currentIds.has(participantId)) {
      hasCurrentWithdrawal = true;
      break;
    }
  }

  // A commit is "current" only if the value at commit time still matches
  // the candidate. A later proposal that names a fresh candidate value
  // supersedes the commit (the perParticipant map is cleared on the new
  // candidate; the commit marker remains so the derivation can read
  // "this candidate value differs from what was committed" — though for
  // the canonical flow the new candidate's commit either lands fresh or
  // not at all).
  const isCurrentCandidateCommitted =
    facetState.committedAt !== null &&
    facetState.committedCandidateValue !== null &&
    facetState.committedCandidateValue === facetState.candidateValue;

  const hasDispute = currentVotes.some((v) => v === 'dispute');
  // Per ADR 0030 §3 + `pf_facet_keyed_vote_payload`: the `vote.choice`
  // enum collapsed to `'agree' | 'dispute'`; `'withdraw'` is no longer
  // a vote choice — it is its own event kind (`withdraw-agreement`).
  // For back-compat with logs / tests that still emit the old
  // `'withdraw'` choice, the derivation treats a `'withdraw'` vote like
  // a dispute on the current candidate (no settled record yet).
  const hasLegacyWithdrawVote = currentVotes.some((v) => v === 'withdraw');

  // Rule 4: a withdraw-agreement event from a current participant
  // against a committed candidate value sends the facet to `'withdrawn'`.
  // Per ADR 0030 §3: the methodology's withdraw gesture at
  // `docs/methodology.md:25` rescinds a previously-committed agreement;
  // it sends the facet back to disputed semantically, surfaced as
  // `'withdrawn'`. Back-compat: a legacy `vote.choice = 'withdraw'`
  // against a committed candidate is also surfaced as `'withdrawn'`
  // — the methodology engine continues to emit this legacy shape until
  // `pf_vote_handler_facet_keyed` + `pf_withdraw_agreement_handler`
  // land the new `withdraw-agreement`-emission path.
  if (isCurrentCandidateCommitted && (hasCurrentWithdrawal || hasLegacyWithdrawVote)) {
    return 'withdrawn';
  }

  // Rule 5: any current participant's vote is a dispute → disputed.
  // A legacy `'withdraw'` vote *without* a prior commit also lands here
  // (the participant is signalling rejection; the projection has no
  // commit to surface as `withdrawn`).
  if (hasDispute || (hasLegacyWithdrawVote && !isCurrentCandidateCommitted)) {
    return 'disputed';
  }

  // Rule 6: committed (commit lands on the *current* candidate, no
  // current dispute / withdraw — current participants either voted
  // agree or simply haven't overturned).
  if (isCurrentCandidateCommitted) {
    return 'committed';
  }

  // Rule 7: every current participant has voted agree → agreed.
  // Requires at least one current participant (an empty-session facet
  // stays `'proposed'`).
  const currentParticipantCount = currentIds.size;
  const agreeCount = currentVotes.filter((v) => v === 'agree').length;
  if (currentParticipantCount > 0 && agreeCount === currentParticipantCount) {
    return 'agreed';
  }

  // Rule 8: anything else (no votes yet, or a subset has voted agree
  // but others haven't, or a stale commit on a superseded candidate)
  // → proposed.
  return 'proposed';
}
