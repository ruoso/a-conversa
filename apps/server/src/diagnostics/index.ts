// Barrel for `apps/server/src/diagnostics`.
//
// Refinements:
//   - tasks/refinements/data-and-methodology/cycle_detection.md
//
// The diagnostics module hosts read-side detectors for the
// structural diagnostics defined in `docs/data-model.md`'s
// "Structural diagnostics" section. Each detector is a pure read
// function over the projection; consumers (the moderator UI, the
// downstream `diagnostic_event_emission` task, etc.) call them on
// demand. The diagnostics module consumes the projection but does
// not extend it.

export { detectSupportsCycles, type SupportsCycle } from './cycle-detection.js';
