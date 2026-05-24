// Narrow per-edge shape-facet status derivation for the moderator's
// inline edge.shape commit affordance.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_shape_commit_affordance.md
// ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§5, §10)
//
// Per ADR 0030 §5 + `pf_shape_facet_wire_vote`: an edge's `shape` facet
// (the carriage of the edge role) enters life with the inline role from
// `edge-created` as its candidate value. There is NO `propose-edge-shape`
// sub-kind in v1 — the candidate ships structurally on the entity-creation
// event. Votes against `(edge, 'shape')` ride the facet-arm wire shape
// directly.
//
// **Why this helper exists.** The moderator-side `graph/facetStatus.ts`
// mirror keeps `FacetName` 3-valued (`classification | substance | wording`)
// — it skips the shape facet entirely (see the file's `'shape'` skip
// branches under each event-kind arm). Widening `FacetName` would propagate
// through `proposalFacets.ts`, `HoverPopover.tsx`, the breakdown / pending-
// pane tests, and a swath of exhaustive switches; recorded as tech-debt for
// a future "mod_edge_shape_facet_surfacing" task (per
// `pf_mod_edge_card_substance_affordance` Decisions). The inline shape-
// commit affordance gates on `shape === 'agreed'`, so a NARROW per-edge
// helper is sufficient — no need to thread shape into the global mirror.
//
// **Pure / single-pass** (mirrors `facetStatus.ts`'s posture): no closure
// over time, no `Date.now()`. Walks `events` once and returns the bound
// edge's shape status, narrowed to the three values the affordance care
// about:
//   - `'agreed'`     — every current participant voted `'agree'` on
//                       `(edge, 'shape')`, no `'dispute'`, no commit, no
//                       meta-disagreement, no withdraw-agreement.
//                       This is the gate value the commit affordance reads.
//   - `'committed'`  — a `commit { target: 'facet', entity_kind: 'edge',
//                       entity_id, facet: 'shape' }` event has landed.
//                       The affordance unmounts in this case.
//   - `'other'`      — anything else (`awaiting` / `proposed` / `disputed`
//                       / `withdrawn` / `meta-disagreement` /
//                       edge-not-found). The affordance unmounts.
//
// The `'other'` rollup keeps the consumer's switch surface small — the
// commit affordance only ever wants to know "should I render the button?".
// If a future task wants finer-grained shape status (e.g. to surface a
// per-edge `data-facet-status` attribute on the shape pill), this helper
// can be widened to the full `FacetStatus` enum without changing the
// commit-affordance call site.

import type { Event } from '@a-conversa/shared-types';

/**
 * The three values the commit affordance discriminates on. `'agreed'`
 * gates the button visible; the other two unmount it.
 */
export type EdgeShapeStatus = 'agreed' | 'committed' | 'other';

/**
 * Derive the per-edge shape-facet status from a session's event log.
 *
 * @param events The session's event log (`useWsStore.sessionState[id].events`).
 * @param edgeId The edge id whose shape facet we want the status for.
 * @returns The narrowed status; `'other'` when the edge isn't in the log
 *          or the shape facet is in any of the non-gated states.
 *
 * **Rule ordering** (mirrors `facetStatus.ts`'s `derive`):
 *   1. Meta-disagreement on `(edge, 'shape')` short-circuits → `'other'`.
 *   2. Commit on `(edge, 'shape')` → `'committed'`.
 *   3. No `edge-created` for the id (or any dispute / withdraw / vote-
 *      reset) → `'other'`.
 *   4. Every current participant voted `'agree'` → `'agreed'`.
 *   5. Anything else → `'other'`.
 */
export function deriveEdgeShapeStatus(events: readonly Event[], edgeId: string): EdgeShapeStatus {
  // Per `deriveCurrentParticipants` — only non-moderator joined-and-not-
  // left participants count toward unanimity. Inlined here so the helper
  // stays self-contained (mirrors the inlining pattern in
  // `facetStatus.ts`'s state machine).
  const currentParticipants = new Set<string>();
  let edgeExists = false;
  let committed = false;
  let metaDisagreement = false;
  let hasWithdrawal = false;
  // Per-participant latest vote on `(edge, 'shape')`.
  const perParticipantVote = new Map<string, 'agree' | 'dispute' | 'withdraw'>();

  for (const event of events) {
    if (event.kind === 'participant-joined') {
      if (event.payload.role === 'moderator') continue;
      currentParticipants.add(event.payload.user_id);
      continue;
    }
    if (event.kind === 'participant-left') {
      currentParticipants.delete(event.payload.user_id);
      continue;
    }
    if (event.kind === 'edge-created') {
      if (event.payload.edge_id === edgeId) edgeExists = true;
      continue;
    }
    if (event.kind === 'vote') {
      // Only the facet-arm `(edge, edgeId, 'shape')` votes count. The
      // proposal-arm cannot target an inline shape facet (there's no
      // `propose-edge-shape` sub-kind in v1 per ADR 0030 §5).
      if (event.payload.target !== 'facet') continue;
      if (event.payload.entity_kind !== 'edge') continue;
      if (event.payload.entity_id !== edgeId) continue;
      if (event.payload.facet !== 'shape') continue;
      perParticipantVote.set(event.payload.participant, event.payload.choice);
      continue;
    }
    if (event.kind === 'commit') {
      if (event.payload.target !== 'facet') continue;
      if (event.payload.entity_kind !== 'edge') continue;
      if (event.payload.entity_id !== edgeId) continue;
      if (event.payload.facet !== 'shape') continue;
      committed = true;
      continue;
    }
    if (event.kind === 'meta-disagreement-marked') {
      if (event.payload.target !== 'facet') continue;
      if (event.payload.entity_kind !== 'edge') continue;
      if (event.payload.entity_id !== edgeId) continue;
      if (event.payload.facet !== 'shape') continue;
      metaDisagreement = true;
      continue;
    }
    if (event.kind === 'withdraw-agreement') {
      if (event.payload.entity_kind !== 'edge') continue;
      if (event.payload.entity_id !== edgeId) continue;
      if (event.payload.facet !== 'shape') continue;
      hasWithdrawal = true;
      continue;
    }
  }

  // Rule 1: meta-disagreement short-circuits — the affordance unmounts.
  if (metaDisagreement) return 'other';
  // Rule 2: committed — the affordance unmounts.
  if (committed) return 'committed';
  // Rule 3: edge not in log, or any withdraw-agreement → `'other'`.
  if (!edgeExists) return 'other';
  if (hasWithdrawal) return 'other';
  // Rule 4: filter votes to current participants; require every current
  // participant voted `'agree'` (no `'dispute'`, no `'withdraw'`).
  if (currentParticipants.size === 0) return 'other';
  let agreeCount = 0;
  for (const [participantId, vote] of perParticipantVote) {
    if (!currentParticipants.has(participantId)) continue;
    if (vote === 'dispute' || vote === 'withdraw') return 'other';
    if (vote === 'agree') agreeCount += 1;
  }
  if (agreeCount === currentParticipants.size) return 'agreed';
  // Rule 5: anything else (proposed / partial agreement).
  return 'other';
}
