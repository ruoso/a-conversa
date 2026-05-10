// Barrel for `apps/server/src/events`.
//
// Refinement: tasks/refinements/data-and-methodology/event_validation.md
//
// Today this exposes the server-side `validateEvent` gate and its
// typed error / result. As subsequent backend tasks land
// (`backend.api_skeleton`, the projection, etc.) they re-export
// their public surface here so the server's append path imports
// from one place.

export {
  EventValidationError,
  validateEvent,
  type EventValidationCode,
  type EventValidationIssue,
  type ValidatedEvent,
} from './validate.js';
