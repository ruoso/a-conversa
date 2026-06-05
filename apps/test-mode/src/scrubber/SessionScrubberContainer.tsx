// Route-level container that owns the lifted replay `position` (Decision §4).
//
// Refinement: tasks/refinements/replay_test/test_mode_timeline_scrubber.md
// TaskJuggler: replay_test.test_mode.test_mode_timeline_scrubber
// ADRs:        0043 (client position-navigation seam), 0003 (React).
//
// This is the single owner of the current scrubber position in
// event-sequence space. The scrubber controls + graph (`TimelineScrubber`)
// read it today; the downstream `test_mode_*` inspector leaves (event
// inspector, changed-highlights, diagnostic inspector, export) attach here
// as siblings reading the same `position` / `setPosition` rather than
// re-owning navigation. Plain lifted state for the one-to-three call sites
// today (Decision §4); a dedicated context is a later refactor only if the
// panel tree deepens.
//
// Mounted only for the non-empty `ready` state (Acceptance §4), so the
// initial position seeds to the log head — the surface opens showing the
// fully-projected graph, and the operator scrubs backward from there.

import { useState, type ReactElement } from 'react';

import type { Event } from '@a-conversa/shared-types';
import { clampPosition, replayHeadSequence } from '@a-conversa/shell';

import { TimelineScrubber } from './TimelineScrubber';

export interface SessionScrubberContainerProps {
  readonly sessionId: string;
  readonly events: readonly Event[];
}

export function SessionScrubberContainer({
  sessionId,
  events,
}: SessionScrubberContainerProps): ReactElement {
  // Seed at the head: open on the fully-projected graph (Acceptance §3 —
  // the position-status reads the initial position of `H`).
  const [position, setPosition] = useState<number>(() => replayHeadSequence(events));

  // Guard the lifted setter so every writer — the controls, the range drag,
  // and the snapshot-jump shortcut — lands a clamped, navigable position.
  const updatePosition = (next: number): void => {
    setPosition(clampPosition(next, events));
  };

  return (
    <TimelineScrubber
      sessionId={sessionId}
      events={events}
      position={position}
      setPosition={updatePosition}
    />
  );
}

export default SessionScrubberContainer;
