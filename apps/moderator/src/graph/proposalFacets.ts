// Pure selector that decodes a pending-proposal payload into the
// per-facet entries the right-sidebar's breakdown row renders.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
//
// Companion to `facetStatus.ts` and `pendingProposals.ts` — same idiom
// (pure derivation, no closure over time, no `Date.now()`,
// no `Math.random()`). The selector decodes the proposal's facet shape
// via a per-sub-kind switch (Decision §1), then resolves each facet's
// status by reading — in priority order — (a) the server-broadcast
// `serverPerFacetStatus` for that facet name (the source of truth when
// present), (b) the client-side
// `facetStatusIndex.{nodes,edges}.get(entityId)?.[facet]` for facet-
// targeting sub-kinds when no server frame has arrived yet, (c)
// `'proposed'` as the default for facet entries the proposal introduces
// but neither surface has computed yet (Decision §5).
//
// For structural sub-kinds (decompose, interpretive-split, axiom-mark,
// meta-move, break-edge, amend-node — note `amend-node` actually targets
// `wording`; see Decision §1 for the partition; the seven structural
// kinds here mirror `targetOf`'s `null` return — and annotate) the
// function emits one "lifecycle" entry per proposal whose facet name is
// the synthetic `'proposal'` (Decision §4) and whose status is the same
// six-value enum.
//
// The shape map between sub-kind and per-facet target is settled in
// `data_and_methodology.event_types.proposal_events` and mirrored
// client-side in `facetStatus.ts`'s `targetOf` helper. This selector
// shares the same partition: the four facet-targeting sub-kinds map to
// real facet entries, the seven structural sub-kinds map to the
// synthetic `'proposal'` entry.
//
// **Pure** (Decision §9 / Constraints): no closure over time, no
// `Date.now()`, no `Math.random()`. Output is a `readonly` array of
// `{ facet, status, labelKey }` triples. The `labelKey` is an i18n
// catalog key (not pre-translated prose); the component calls
// `t(labelKey)` at render time.

import type { ProposalPayload } from '@a-conversa/shared-types';

import type { FacetName, FacetStatus, FacetStatusIndex } from './facetStatus.js';

/**
 * The set of facet names the breakdown can surface. Extends
 * `FacetName` (`'wording' | 'classification' | 'substance'`) with the
 * synthetic `'proposal'` lifecycle facet that structural sub-kinds
 * (decompose, axiom-mark, etc.) map to per Decision §4.
 */
export type LifecycleFacetName = FacetName | 'proposal';

/**
 * One entry in the breakdown's facet list. The component iterates the
 * selector's output array and renders one chip per entry; the chip's
 * `data-facet-name`, `data-facet-status`, and rendered label all flow
 * from this triple.
 *
 * Decision §9 — minimal shape: enough for the component to render the
 * chip, enough for the sibling vote-indicator task to locate the
 * matching `(proposalId, facet)` pair when it later threads in per-
 * participant votes inside each chip.
 */
export interface ProposalFacetEntry {
  /**
   * The facet this entry targets. `'proposal'` is the synthetic
   * lifecycle facet for structural sub-kinds (Decision §4).
   */
  readonly facet: LifecycleFacetName;
  /**
   * The resolved status (server frame → client mirror → default).
   */
  readonly status: FacetStatus;
  /**
   * The i18n catalog key for the facet-name label
   * (`methodology.facet.<facet>`). The component calls
   * `t(labelKey)` at render time; the selector does not pre-translate.
   */
  readonly labelKey: string;
}

/**
 * Decode a `ProposalPayload` to the (entityKind, entityId, facet)
 * triple the proposal targets, OR `null` for structural sub-kinds
 * (which get a synthetic `'proposal'` entry instead).
 *
 * Mirrors the partition in `apps/moderator/src/graph/facetStatus.ts`'s
 * `targetOf` helper: same four facet-targeting sub-kinds (classify-
 * node, set-node-substance, set-edge-substance, edit-wording), same
 * seven structural sub-kinds (decompose, interpretive-split,
 * axiom-mark, meta-move, break-edge, amend-node, annotate) returning
 * `null`. Note `amend-node` is treated as structural here per
 * Decision §1 of this refinement (the table lists it under
 * "structural" — it is the methodology-engine repair op whose
 * commit-readiness surface differs from a pure `edit-wording`).
 */
type FacetTarget = {
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
};

function facetTargetOf(proposal: ProposalPayload): FacetTarget | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      // Both reword and restructure target the parent node's wording
      // facet at proposal-time.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'decompose':
    case 'interpretive-split':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'amend-node':
    case 'annotate':
      return null;
    default: {
      // Exhaustively narrowed; this branch is a runtime safety net for
      // callers that bypass TypeScript (e.g. tests that build malformed
      // events). An unknown proposal kind contributes one synthetic
      // entry like a structural sub-kind, so the row body always has
      // at least one chip.
      return null;
    }
  }
}

/**
 * Resolve the per-facet status by precedence: server frame → client
 * mirror → default. Decision §5.
 *
 * @param facet The facet name (real `FacetName` or the synthetic
 *   `'proposal'` lifecycle entry).
 * @param target The `(entityKind, entityId, facet)` triple if the
 *   proposal targets a real facet (`null` for structural sub-kinds).
 * @param facetStatusIndex The client-side derivation off the event log.
 * @param serverPerFacetStatus The server-broadcast status map keyed by
 *   `FacetName` strings (a `Record<string, string>` on the wire; we
 *   defensively narrow to the `FacetStatus` enum below).
 */
function resolveStatus(
  facet: LifecycleFacetName,
  target: FacetTarget | null,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
): FacetStatus {
  // (a) Server frame first — source of truth per
  // ws_proposal_status_broadcast.md. The wire shape is
  // `Record<string, string>`; we trust it is one of the six FacetStatus
  // values (enforced server-side at the broadcast construction site).
  if (serverPerFacetStatus) {
    const fromServer = serverPerFacetStatus[facet];
    if (fromServer && isFacetStatus(fromServer)) {
      return fromServer;
    }
  }
  // (b) Client mirror for facet-targeting sub-kinds only.
  if (target) {
    const perEntity =
      target.entityKind === 'node'
        ? facetStatusIndex.nodes.get(target.entityId)
        : facetStatusIndex.edges.get(target.entityId);
    const fromClient = perEntity?.[target.facet];
    if (fromClient) {
      return fromClient;
    }
  }
  // (c) Default — proposal exists in the pending list, so the
  // derivation's Rule 7 result for an unvoted facet applies.
  return 'proposed';
}

const FACET_STATUS_VALUES: ReadonlySet<string> = new Set<FacetStatus>([
  'proposed',
  'agreed',
  'disputed',
  'committed',
  'withdrawn',
  'meta-disagreement',
]);

function isFacetStatus(value: string): value is FacetStatus {
  return FACET_STATUS_VALUES.has(value);
}

/**
 * Build the i18n catalog key for a facet name. Reuses the existing
 * `methodology.facet.<facet>` keyspace (`wording` / `classification` /
 * `substance` shipped by `i18n_methodology_glossary`); this task adds
 * `methodology.facet.proposal` for the synthetic lifecycle entry.
 */
function labelKeyFor(facet: LifecycleFacetName): string {
  return `methodology.facet.${facet}`;
}

/**
 * Derive the per-facet entries for a single pending proposal.
 *
 * @param proposal The proposal payload (the discriminated-union sub-kind).
 * @param facetStatusIndex Client-side `computeFacetStatuses(events)`
 *   output — the fallback when no server frame has arrived yet (or the
 *   broadcast is rate-limited).
 * @param serverPerFacetStatus Per-proposal server-broadcast status map
 *   (from `useWsStore.sessionState[id].pendingProposals[proposalId].perFacetStatus`).
 *   `undefined` when no server frame has landed for this proposal id.
 * @returns The facet entries the breakdown component renders. Always at
 *   least one entry (Decision §7 — facet-targeting sub-kinds emit one
 *   real facet entry, structural sub-kinds emit one synthetic
 *   `'proposal'` entry).
 */
export function derivePerProposalFacets(
  proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
): readonly ProposalFacetEntry[] {
  const target = facetTargetOf(proposal);
  if (target) {
    const status = resolveStatus(target.facet, target, facetStatusIndex, serverPerFacetStatus);
    return [
      {
        facet: target.facet,
        status,
        labelKey: labelKeyFor(target.facet),
      },
    ];
  }
  // Structural sub-kind (or unknown) — one synthetic lifecycle entry
  // (Decision §4). Status resolution still consults the server frame
  // (a future broadcast tightening may carry a `'proposal'` keyed
  // status); the client-mirror lookup is skipped because the mirror
  // does not track structural proposals.
  const status = resolveStatus('proposal', null, facetStatusIndex, serverPerFacetStatus);
  return [
    {
      facet: 'proposal',
      status,
      labelKey: labelKeyFor('proposal'),
    },
  ];
}
