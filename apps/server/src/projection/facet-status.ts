// Per-facet overall-status derivation.
//
// Refinement: tasks/refinements/data-and-methodology/per_facet_status_derivation.md
// TaskJuggler: data_and_methodology.projection.per_facet_status_derivation
//
// Pure read function over the projection. Reads the affected facet's
// `perParticipant` map (filtered to currently-joined participants),
// the facet's underlying `status`, and its `committedProposalEventId`
// marker; returns the `FacetStatus` value the methodology engine, the
// moderator UI, the audience broadcaster, and `active_firing_computation`
// all consume.
//
// The dispatcher (`replay.ts`) is responsible for actually populating
// the per-participant per-facet state and the commit marker — the
// `handleVote`, `handleCommit`, and `handleMetaDisagreementMarked`
// handlers were tightened in this same task to do so. This file is
// the read-side complement.
//
// **Boundary with the methodology engine.** This derivation reads
// recorded state and reports the resulting status. It does NOT
// validate (e.g. "moderator can only commit an agreed facet";
// "withdrawal is only valid against an existing agree on a committed
// proposal"). Those validations land in the methodology engine task
// downstream and consume `deriveFacetStatus` to make their decisions.
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
    // Edges have no `wording` / `classification` facets, and the
    // edge `shape` facet (role + endpoints) is fixed at edge-created
    // time and not separately tracked as a `FacetState` in v1 — no
    // proposal sub-kind targets it. If a future feature adds a
    // shape-edit proposal, the projection grows a `shapeFacet` and
    // this branch supports it then.
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

  // Rule 1: meta-disagreement on the underlying state short-circuits.
  if (facetState.status === 'meta-disagreement') {
    return 'meta-disagreement';
  }

  // Rule 2: filter perParticipant by current participants. Left
  // participants' votes are historical — methodology says "current
  // participants" must agree.
  const currentIds = new Set(projection.currentParticipants().map((p) => p.userId));
  const currentVotes: string[] = [];
  for (const [participantId, record] of facetState.perParticipant) {
    if (currentIds.has(participantId)) {
      currentVotes.push(record.vote);
    }
  }

  const wasCommitted = facetState.committedProposalEventId !== null;
  const hasWithdraw = currentVotes.some((v) => v === 'withdraw');
  const hasDispute = currentVotes.some((v) => v === 'dispute');

  // Rule 3: a withdraw vote against a committed facet supersedes
  // the commit and reverts the facet — surfaced as `withdrawn`.
  if (wasCommitted && hasWithdraw) {
    return 'withdrawn';
  }

  // Rule 4: any current dispute → disputed. Also treat a withdraw
  // *without* a prior commit as a dispute (the participant is
  // signalling rejection; the projection has no commit to surface
  // as `withdrawn`).
  if (hasDispute || hasWithdraw) {
    return 'disputed';
  }

  // Rule 5: committed (commit lands, no current dispute / withdraw,
  // current participants either voted agree or simply haven't
  // overturned).
  if (wasCommitted) {
    return 'committed';
  }

  // Rule 6: every current participant has voted agree → agreed.
  // Requires at least one current participant (an empty-session
  // facet stays `proposed`).
  const currentParticipantCount = currentIds.size;
  const agreeCount = currentVotes.filter((v) => v === 'agree').length;
  if (currentParticipantCount > 0 && agreeCount === currentParticipantCount) {
    return 'agreed';
  }

  // Rule 7: anything else (no votes yet, or a subset has voted
  // agree but others haven't) → proposed.
  return 'proposed';
}
