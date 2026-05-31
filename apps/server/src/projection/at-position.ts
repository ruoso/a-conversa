// Replay a session event log to a specific event-sequence position.
//
// Refinement: tasks/refinements/data-and-methodology/project_at_position.md
// TaskJuggler: data_and_methodology.replay_primitive.project_at_position

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection, type Projection } from './projection.js';
import { applyEvent } from './replay.js';

export class ReplayPositionError extends Error {
  override readonly name = 'ReplayPositionError';
  readonly position: number;
  readonly headSequence: number;

  constructor(position: number, headSequence: number) {
    super(
      `invalid replay position ${position}; expected an integer in the inclusive range 0..${headSequence}`,
    );
    this.position = position;
    this.headSequence = headSequence;
  }
}

function headSequenceOf(events: readonly Event[]): number {
  return events.length === 0 ? 0 : events[events.length - 1]!.sequence;
}

function assertValidPosition(position: number, headSequence: number): void {
  if (!Number.isInteger(position) || position < 0 || position > headSequence) {
    throw new ReplayPositionError(position, headSequence);
  }
}

export function projectAtPosition(
  events: readonly Event[],
  sessionId: string,
  position: number,
): Projection {
  const headSequence = headSequenceOf(events);
  assertValidPosition(position, headSequence);

  const projection = createEmptyProjection(sessionId);
  for (const event of events) {
    if (event.sequence > position) break;
    applyEvent(projection, event);
  }
  return projection;
}
