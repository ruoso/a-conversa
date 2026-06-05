// `useReplayPlayback` — the app-local auto-advance loop for the audience
// replay viewer.
//
// Refinement: tasks/refinements/replay_test/replay_playback_controls.md
//   (Decision §2 — the play loop is an app-local hook, NOT a shell helper:
//    there is exactly one consumer today and the test-mode scrubber has no
//    auto-advance; only the timing loop is new, the step/boundary atoms
//    (`nextPosition`, `isAtEnd`) already live in `@a-conversa/shell`.
//    Decision §3 — a single fixed cadence (`DEFAULT_PLAYBACK_INTERVAL_MS`);
//    speed selection is the downstream `replay_speed_controls` leaf.
//    Decision §5 — pressing play on the head frame restarts from `0`.)
// ADR:        0043 (the client position-navigation contract this consumes).
//
// The loop steps the lifted `position` one event per interval tick via
// `nextPosition`, self-terminates at the head (`isAtEnd` — Constraint §4: no
// spin past the end), and clears its timer on pause, at the head, and on
// unmount (Constraint §6: no leaked timers). It never re-derives sequence
// arithmetic (Constraint §1).

import { useEffect, useRef, useState } from 'react';

import type { Event } from '@a-conversa/shared-types';
import { isAtEnd, nextPosition } from '@a-conversa/shell';

/**
 * One fixed wall-clock interval per event-step. "1×" is a constant per-step
 * cadence, NOT original-timestamp real-time (Decision §4 — a debate log's
 * human think-time gaps would make real-time playback dead air). The
 * `replay_speed_controls` leaf extends this by multiplying the interval.
 */
export const DEFAULT_PLAYBACK_INTERVAL_MS = 1000;

export interface ReplayPlayback {
  /** Whether the auto-advance loop is currently running. */
  readonly isPlaying: boolean;
  /** Start auto-advancing; restarts from `0` if already at the head. */
  readonly play: () => void;
  /** Stop auto-advancing (clears the timer). */
  readonly pause: () => void;
}

export interface UseReplayPlaybackArgs {
  /** The full ascending event log (from `useSessionEventLog`). */
  readonly events: readonly Event[];
  /** The current lifted position in event-sequence space (`0..head`). */
  readonly position: number;
  /** The clamped position setter the container owns. */
  readonly setPosition: (position: number) => void;
  /** Override the cadence (tests inject a fast/fixed value). */
  readonly intervalMs?: number;
}

export function useReplayPlayback({
  events,
  position,
  setPosition,
  intervalMs = DEFAULT_PLAYBACK_INTERVAL_MS,
}: UseReplayPlaybackArgs): ReplayPlayback {
  const [isPlaying, setIsPlaying] = useState(false);

  // Keep the latest position/events/setter reachable from the interval tick
  // without re-subscribing the timer on every step — the effect depends only
  // on the play flag + cadence, so a single interval spans the whole run.
  const positionRef = useRef(position);
  positionRef.current = position;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const setPositionRef = useRef(setPosition);
  setPositionRef.current = setPosition;

  const play = (): void => {
    // Restart-from-end affordance (Decision §5 / Constraint §4): pressing play
    // on the head frame rewinds to the baseline so the debate replays from the
    // start — the only path back without the not-yet-built seek bar.
    if (isAtEnd(eventsRef.current, positionRef.current)) {
      setPositionRef.current(0);
    }
    setIsPlaying(true);
  };

  const pause = (): void => {
    setIsPlaying(false);
  };

  useEffect(() => {
    if (!isPlaying) return undefined;
    const id = setInterval(() => {
      const next = nextPosition(eventsRef.current, positionRef.current);
      // Advance the ref synchronously so back-to-back ticks (a tight cadence,
      // or batched timers under test) each step off the *latest* position
      // rather than a render-stale snapshot; the next render reconciles it to
      // the same value.
      positionRef.current = next;
      setPositionRef.current(next);
      // Self-terminate at the head: flip the play flag off so this effect's
      // cleanup clears the interval — no spin past the end, no busy-loop.
      if (isAtEnd(eventsRef.current, next)) {
        setIsPlaying(false);
      }
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [isPlaying, intervalMs]);

  return { isPlaying, play, pause };
}

export default useReplayPlayback;
