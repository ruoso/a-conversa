// Re-export shim: the canonical `FacetName` / `FacetStatus` declarations
// live in the sibling `facet-status` module. The FacetPill primitive
// imports them from here so its internal import paths stay unchanged;
// every external consumer reaches them via the shell root barrel.
//
// Refinement: tasks/refinements/shell-package/extract_facet_status_rules.md
//   Decision §3 — the canonical home moved to `facet-status/` to honor
//   the data-layer → render-layer dependency direction.

export type { FacetName, FacetStatus } from '../facet-status/facet-status.js';
