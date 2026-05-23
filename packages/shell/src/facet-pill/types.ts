// Shell-local `FacetName` / `FacetStatus` type pair for the `<FacetPill>`
// primitive.
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md
//   Decision §1 — small co-located types module rather than reaching back
//   into the moderator's `apps/moderator/src/graph/facetStatus.ts` or
//   widening `@a-conversa/shared-types`. The moderator's and participant's
//   `facetStatus.ts` ports keep their own copies of these types (and the
//   derivation rules); structural compatibility flows automatically
//   through TypeScript's string-literal-union widening. A future leaf
//   (Decision §2 — deferred until the audience surface becomes the 4th
//   caller) collapses the derivation-rule ports into shell and the shell
//   becomes the canonical home.
//
// Mirrors `apps/server/src/projection/types.ts`'s `FacetStatus` /
// `FacetName` verbatim. Seven status values across the agreement layer
// (`proposed`, `agreed`, `disputed`, `meta-disagreement`), the committed
// layer (`committed`, `withdrawn`), and the empty-state row
// (`awaiting-proposal`). Three facet names (`wording`, `classification`,
// `substance`); nodes carry all three, edges carry only `substance` in v1.
//
// TODO(pf_projection_facet_status_refactor): `'awaiting-proposal'` was
// added by `pf_awaiting_proposal_facet_status` per ADR 0030 §10. The
// shell's `<FacetPill>` currently renders it with the same visual as
// `'proposed'` (faded / dashed-slate) as a sensible default — see
// `PILL_STATUS_CLASSNAME` in `FacetPill.tsx`. The downstream UI tasks
// (`pf_mod_node_card_classification_affordance`,
// `pf_mod_node_card_substance_affordance`,
// `pf_part_detail_panel_three_facet_rows`) will replace the default with
// the real empty-state visual + per-facet propose affordance.

/**
 * Per-facet overall-status enum. Seven values across the agreement layer
 * (`proposed`, `agreed`, `disputed`, `meta-disagreement`), the committed
 * layer (`committed`, `withdrawn`), and the empty-state row
 * (`awaiting-proposal`).
 */
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement'
  | 'awaiting-proposal';

/**
 * The three facets a node may carry (`classification`, `substance`,
 * `wording`); only `substance` is meaningful for edges today.
 */
export type FacetName = 'classification' | 'substance' | 'wording';
