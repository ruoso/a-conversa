// Navigate forward/backward through a session event log's scrubber stops.
//
// Refinement: tasks/refinements/data-and-methodology/position_navigation.md
// TaskJuggler: data_and_methodology.replay_primitive.position_navigation
//
// Navigation computes *positions only*; rendering at a position remains
// projectAtPosition's job. The navigable stops are the integers
// 0..headSequence inclusive (0 = pre-history baseline; headSequence = the
// highest sequence in the log; 0 for an empty log). A step is one event:
// nextPosition moves +1, prevPosition moves -1, both saturating at the
// boundaries. A non-navigable *current* position is a caller bug and throws
// ReplayPositionError, matching projectAtPosition's loud-contract enforcement.

import type { Event } from '@a-conversa/shared-types';

import { ReplayPositionError, replayHeadSequence } from './at-position.js';

function assertNavigablePosition(position: number, headSequence: number): void {
  if (!Number.isInteger(position) || position < 0 || position > headSequence) {
    throw new ReplayPositionError(position, headSequence);
  }
}

export function nextPosition(events: readonly Event[], position: number): number {
  const headSequence = replayHeadSequence(events);
  assertNavigablePosition(position, headSequence);
  return position < headSequence ? position + 1 : headSequence;
}

export function prevPosition(events: readonly Event[], position: number): number {
  const headSequence = replayHeadSequence(events);
  assertNavigablePosition(position, headSequence);
  return position > 0 ? position - 1 : 0;
}

export function isAtStart(position: number): boolean {
  return position === 0;
}

export function isAtEnd(events: readonly Event[], position: number): boolean {
  return position === replayHeadSequence(events);
}
