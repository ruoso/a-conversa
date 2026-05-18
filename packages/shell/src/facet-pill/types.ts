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
// `FacetName` verbatim. Six status values across the agreement layer
// (`proposed`, `agreed`, `disputed`, `meta-disagreement`) and the
// committed layer (`committed`, `withdrawn`). Three facet names (`wording`,
// `classification`, `substance`); nodes carry all three, edges carry only
// `substance` in v1.

/**
 * Per-facet overall-status enum. Six values across the agreement layer
 * (`proposed`, `agreed`, `disputed`, `meta-disagreement`) and the
 * committed layer (`committed`, `withdrawn`).
 */
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement';

/**
 * The three facets a node may carry (`classification`, `substance`,
 * `wording`); only `substance` is meaningful for edges today.
 */
export type FacetName = 'classification' | 'substance' | 'wording';
