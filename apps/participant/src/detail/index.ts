// Barrel re-export of the participant detail-panel surface.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (Decision §8 — the panel + its helpers live in
//              `apps/participant/src/detail/`; the barrel mirrors the
//              existing `apps/participant/src/stores/index.ts` pattern.)

export { AxiomMarkBadge, type AxiomMarkBadgeProps } from './AxiomMarkBadge';
export { EntityDetailPanel, type EntityDetailPanelProps } from './EntityDetailPanel';
export {
  EMPTY_PARTICIPANT_ROSTER,
  participantRosterFrom,
  screenNameFor,
} from './participantRoster';
export { lookupEntity } from './lookupEntity';
