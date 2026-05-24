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
// `'awaiting-proposal'` (per ADR 0030 §10) is now emitted from the
// server's `deriveFacetStatus` for facets with no candidate value
// yet. The shell's `<FacetPill>` renders it with the same visual as
// `'proposed'` (faded / dashed-slate) — see `PILL_STATUS_CLASSNAME`
// in `FacetPill.tsx`. The per-facet propose affordance (the real
// empty-state surface) is rendered by the moderator's node card and
// the participant's detail-panel row (downstream UI tasks
// `pf_mod_node_card_classification_affordance`,
// `pf_mod_node_card_substance_affordance`,
// `pf_part_detail_panel_three_facet_rows`), not by the pill itself.

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
