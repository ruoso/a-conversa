// Barrel for the shell's facet-pill subsystem.
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md

export {
  FacetPill,
  PILL_BASE_CLASSNAME,
  PILL_STATUS_CLASSNAME,
  type FacetPillProps,
} from './FacetPill.js';
export {
  VoteIndicator,
  type VoteIndicatorProps,
  type Vote,
  EMPTY_VOTES,
} from './vote-indicator.js';
export {
  axiomMarkColorFor,
  AXIOM_MARK_PALETTE_SIZE,
  type AxiomMarkColor,
} from './participant-color.js';
export type { FacetName, FacetStatus } from './types.js';
