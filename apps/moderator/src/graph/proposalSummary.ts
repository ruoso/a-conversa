// Pure per-sub-kind summary string for a `ProposalPayload`.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposal_filter_search.md
// (originally introduced for: tasks/refinements/moderator-ui/mod_proposal_list.md)
//
// `summaryText(proposal)` returns the one-line description the
// pending-proposals row renders in its "summary" column. The function
// covers all eleven proposal sub-kinds and is total against the
// discriminated union; an unknown sub-kind falls back to the literal
// `kind` string so the row never renders empty.
//
// **Why this lives in `graph/`, not `layout/`.** Both the row component
// (`<PendingProposalsPane>`) AND the filter predicate
// (`proposalFilter.ts`) need the same string — the filter matches what
// the moderator sees on screen per
// `mod_proposal_filter_search` Decision §3. Hoisting `summaryText` to a
// shared `.ts` module avoids the .tsx → .tsx import cycle a co-located
// extraction would create AND keeps the two surfaces computing the
// same string by construction (a future refactor to one site is
// guaranteed to propagate to both).
//
// **Pure** (Constraints, mirrors `proposalFacets.ts` /
// `pendingProposals.ts`): no closure over time, no `Date.now()`, no
// `Math.random()`. The output is a function of the input payload alone.

import type { ProposalPayload } from '@a-conversa/shared-types';

/**
 * Pick a one-line summary string per sub-kind. The selector emits the
 * full proposal payload; the row component / filter predicate decides
 * what to render or match against.
 *
 * For `classify-node`, the chip already shows the classification — the
 * summary falls back to the 8-char node-id prefix (the moderator UI
 * does not yet have a client-side node-wording resolver in the pane).
 *
 * For sub-kinds carrying a free-text field (`edit-wording`,
 * `amend-node`, `meta-move`, `annotate`, components of `decompose` /
 * `interpretive-split`), the row renders that text. The Tailwind
 * `truncate` class handles overflow at the column level.
 */
export function summaryText(proposal: ProposalPayload): string {
  switch (proposal.kind) {
    case 'capture-node':
      // Per ADR 0030 §1 + `pf_mod_capture_pane_wording_only`: the
      // capture-pane gesture is wording-only; `capture-node` carries
      // the captured wording inline but the kind chip already
      // surfaces the sub-kind label and the pending row's other
      // chips (per-facet breakdown) carry the wording-facet status.
      // The summary line falls back to a node-id prefix to mirror
      // `classify-node` (both sub-kinds key on the same node).
      return `node ${proposal.node_id.slice(0, 8)}`;
    case 'classify-node':
      // The chip already shows the classification; the summary falls
      // back to a node-id prefix.
      return `node ${proposal.node_id.slice(0, 8)}`;
    case 'set-node-substance':
      return `Set substance = ${proposal.value} (node ${proposal.node_id.slice(0, 8)})`;
    case 'set-edge-substance':
      return `Set substance = ${proposal.value} (edge ${proposal.edge_id.slice(0, 8)})`;
    case 'edit-wording':
      return proposal.new_wording;
    case 'amend-node':
      return proposal.new_content;
    case 'meta-move':
      return `${proposal.meta_kind}: ${proposal.content}`;
    case 'annotate':
      return `${proposal.annotation_kind}: ${proposal.content}`;
    case 'decompose':
      return `Decompose into ${String(proposal.components.length)} components`;
    case 'interpretive-split':
      return `Split into ${String(proposal.readings.length)} readings`;
    case 'axiom-mark':
      return `Axiom-mark (participant ${proposal.participant.slice(0, 8)})`;
    case 'break-edge':
      return `Break edge ${proposal.edge_id.slice(0, 8)}`;
    default: {
      // Exhaustively narrowed; this is a runtime safety net for callers
      // that bypass TypeScript (e.g. tests that build malformed events).
      const unknown = proposal as { kind: string };
      return unknown.kind;
    }
  }
}
