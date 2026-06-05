// Client port of the replay position-navigation contract.
//
// Refinement: tasks/refinements/replay_test/test_mode_timeline_scrubber.md
// ADR:        docs/adr/0043-client-side-replay-position-navigation-in-shell.md
// TaskJuggler: replay_test.test_mode.test_mode_timeline_scrubber
//
// A pure, React-free integer module that re-implements — contract-identical —
// the server's `apps/server/src/projection/position-navigation.ts`. Apps are
// leaf Vite bundles, not workspace libraries (ADR 0039), so no frontend
// package can import the server primitive; this is the client copy every
// replay/test-mode surface (the timeline scrubber, the replay seek bar,
// chapter jumping) shares so none re-derives boundary arithmetic.
//
// Event-sequence space: the navigable stops are the integers `0..headSequence`
// inclusive (`0` = pre-history baseline; `headSequence` = the highest sequence
// in the log; `0` for an empty log). A step is `±1`, saturating at the
// boundaries. A non-navigable *current* position is a caller bug and throws
// `ReplayPositionError`, matching the server primitive's loud contract.
//
// `clampPosition` is the one addition over the server primitive (ADR 0043
// Decision §3): snapping an arbitrary dragged range value into `[0, head]` is
// a UI concern the server never faces, so it lives only on this client copy.

import type { Event } from '@a-conversa/shared-types';

/**
 * Thrown when `nextPosition`/`prevPosition` receive a non-navigable *current*
 * position (non-integer, negative, or beyond head). Mirrors the server
 * primitive's `ReplayPositionError`. Not re-exported from the shell barrel:
 * the UI funnels every value through {@link clampPosition} first, so callers
 * never trip it — it is a loud guard against an internal contract slip.
 */
export class ReplayPositionError extends Error {
  override readonly name = 'ReplayPositionError';
  readonly position: number;
  readonly headSequence: number;

  constructor(position: number, headSequence: number) {
    super(
      `invalid replay position ${String(position)}; expected an integer in the inclusive range 0..${String(headSequence)}`,
    );
    this.position = position;
    this.headSequence = headSequence;
  }
}

/**
 * The highest sequence in the log — the upper navigable bound. `0` for an
 * empty log. The log is ascending by `sequence`, so this is the last event's
 * sequence (contiguous `1..head` is enforced upstream by `applyEvent`).
 */
export function replayHeadSequence(events: readonly Event[]): number {
  return events.length === 0 ? 0 : events[events.length - 1]!.sequence;
}

function assertNavigablePosition(position: number, headSequence: number): void {
  if (!Number.isInteger(position) || position < 0 || position > headSequence) {
    throw new ReplayPositionError(position, headSequence);
  }
}

/** Step one event forward, saturating at the head. */
export function nextPosition(events: readonly Event[], position: number): number {
  const headSequence = replayHeadSequence(events);
  assertNavigablePosition(position, headSequence);
  return position < headSequence ? position + 1 : headSequence;
}

/** Step one event backward, saturating at the baseline `0`. */
export function prevPosition(events: readonly Event[], position: number): number {
  const headSequence = replayHeadSequence(events);
  assertNavigablePosition(position, headSequence);
  return position > 0 ? position - 1 : 0;
}

/** `true` iff `position` is the pre-history baseline. */
export function isAtStart(position: number): boolean {
  return position === 0;
}

/** `true` iff `position` is the head sequence (the last stop). */
export function isAtEnd(events: readonly Event[], position: number): boolean {
  return position === replayHeadSequence(events);
}

/**
 * Snap an arbitrary value (a dragged range input, a parsed query param) into
 * the navigable `[0, head]` range. `NaN` and negatives floor to `0`; values
 * past the head clamp to the head; fractional values truncate toward zero.
 * The UI-only counterpart the server primitive deliberately omitted.
 */
export function clampPosition(value: number, events: readonly Event[]): number {
  const headSequence = replayHeadSequence(events);
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > headSequence) return headSequence;
  return Math.trunc(value);
}
