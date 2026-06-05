// `<ReplayPlaybackContainer>` — the lifted-position owner for the audience
// replay viewer's play / pause / step controls and the draggable seek bar.
//
// Refinement: tasks/refinements/replay_test/replay_playback_controls.md
//   then tasks/refinements/replay_test/replay_seek_bar.md (Decision §1 —
//   port the test-mode controlled `<input type="range">` into this controls
//   cluster as a new writer of the lifted `position`, funnelled through the
//   same `updatePosition`/`clampPosition` guard; controlled by `value={
//   position}` so the thumb doubles as a live playback progress indicator.
//   Constraint §5 — plain bar, no chapter ticks. Constraint §6 — the text
//   readout stays as the a11y announce surface.)
//   (Decision §1 — lift `position` into a route-local container mirroring
//    test-mode's `SessionScrubberContainer`; render `GraphView` + the
//    controls as siblings so the downstream `replay_seek_bar` /
//    `replay_speed_controls` leaves mount alongside reading the same state.
//    Constraint §2 — client-side prefix render, no per-step server call.
//    Constraint §3 — seed at `replayHeadSequence(events)` so the
//    no-interaction view still shows the complete session (ADR 0045's
//    head-landing default). Constraint §8 — every control carries a
//    localized `aria-label`; the play/pause toggle announces its state.)
// ADRs:        0043 (the client position-navigation contract — every step,
//                    boundary, and clamp comes from `@a-conversa/shell`, never
//                    re-derived here), 0039 (the `@a-conversa/graph-view`
//                    prefix render), 0045 (the head-landing default frame),
//                    0024 (the `audience.replay.playback.*` i18n keys),
//                    0022 (the `data-testid` seams pinned by the Vitest
//                    component test + the Playwright e2e), 0040 (a11y).
//
// `AudienceReplayRoute`'s `ready` branch mounts this in place of the static
// head frame; the load / auth / CTA branches are unchanged (Constraint §7).

import { useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Event } from '@a-conversa/shared-types';
import {
  clampPosition,
  isAtEnd,
  isAtStart,
  nextPosition,
  prevPosition,
  replayHeadSequence,
} from '@a-conversa/shell';
import { GraphView } from '@a-conversa/graph-view';

import { useReplayPlayback } from './useReplayPlayback.js';

export interface ReplayPlaybackContainerProps {
  /** The session whose log is replayed — the `GraphView` instance key. */
  readonly sessionId: string;
  /** The full ascending event log (from `useSessionEventLog`). */
  readonly events: readonly Event[];
  /**
   * The URL-supplied opening cursor (`?position=<sequence>` via
   * `useAudienceLogPosition`), threaded from `AudienceReplayRoute`
   * (replay_url_position_loading, Decision §1). `null`/`undefined` =
   * absent/invalid → land on the head; `0` = the valid genesis deep-link.
   * Seeds the initial cursor only — once mounted, the controls own
   * `position` (Decision §4). The raw value is clamped against the loaded
   * log (Decision §2 / ADR 0043), so an out-of-range param lands at the head.
   */
  readonly initialPosition?: number | null | undefined;
}

export function ReplayPlaybackContainer({
  sessionId,
  events,
  initialPosition,
}: ReplayPlaybackContainerProps): ReactElement {
  const { t } = useTranslation();

  // Seed the opening cursor once (Constraint §2 — `useState` initializer).
  // A URL-supplied `initialPosition` overrides the head default, clamped into
  // `[0, head]` so an out-of-range param degrades to the head frame
  // (replay_url_position_loading Constraint §3 — `clampPosition` owns the
  // bounds check, ADR 0043). The `!= null` test is deliberate: `0` is a valid
  // genesis deep-link, and `0` is falsy, so a `|| head` fallback would be a
  // bug (Constraint §4). Absent/invalid (`null`/`undefined`) falls back to the
  // head — the fully-projected graph (Constraint §3 — ADR 0045's default).
  const [position, setPosition] = useState<number>(() =>
    initialPosition != null ? clampPosition(initialPosition, events) : replayHeadSequence(events),
  );

  // Guard the lifted setter so every writer — the step buttons and the
  // auto-advance loop — lands a clamped, navigable position (Constraint §1).
  const updatePosition = (next: number): void => {
    setPosition(clampPosition(next, events));
  };

  const { isPlaying, play, pause } = useReplayPlayback({
    events,
    position,
    setPosition: updatePosition,
  });

  const head = replayHeadSequence(events);
  const atStart = isAtStart(position);
  const atEnd = isAtEnd(events, position);

  // Constraint §2: the prefix rendered at position `p` is every event whose
  // sequence is `<= p`. `GraphView` re-projects this prefix on each change;
  // no server round-trip per step (the full log is already loaded).
  const prefix = useMemo(
    () => events.filter((event) => event.sequence <= position),
    [events, position],
  );

  const goPrevious = (): void => {
    updatePosition(prevPosition(events, position));
  };
  const goNext = (): void => {
    updatePosition(nextPosition(events, position));
  };
  const togglePlay = (): void => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };
  // The seek bar is a new writer of `position`, funnelling through the same
  // `updatePosition`/`clampPosition` guard as the buttons and the play loop
  // (Constraint §1/§2). It ports the test-mode scrubber's range handler
  // verbatim (Decision §1).
  const onScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    updatePosition(Number(event.target.value));
  };

  const playLabel = isPlaying
    ? t('audience.replay.playback.pause')
    : t('audience.replay.playback.play');

  return (
    <div data-testid="audience-replay-playback" className="relative h-screen w-screen">
      <GraphView events={prefix} instanceKey={sessionId} />

      <div
        data-testid="audience-replay-controls"
        role="group"
        aria-label={t('audience.replay.playback.regionAriaLabel')}
        className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/90 p-4 backdrop-blur"
      >
        <button
          type="button"
          data-testid="audience-replay-play"
          onClick={togglePlay}
          aria-pressed={isPlaying}
          aria-label={playLabel}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {playLabel}
        </button>
        <button
          type="button"
          data-testid="audience-replay-step-back"
          onClick={goPrevious}
          disabled={atStart}
          aria-label={t('audience.replay.playback.stepBack')}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('audience.replay.playback.stepBack')}
        </button>
        <button
          type="button"
          data-testid="audience-replay-step-forward"
          onClick={goNext}
          disabled={atEnd}
          aria-label={t('audience.replay.playback.stepForward')}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('audience.replay.playback.stepForward')}
        </button>

        <input
          type="range"
          data-testid="audience-replay-seek"
          min={0}
          max={head}
          step={1}
          value={position}
          onChange={onScrub}
          aria-label={t('audience.replay.playback.seekAriaLabel')}
          className="h-2 min-w-[12rem] flex-1 cursor-pointer"
        />

        <p
          role="status"
          aria-live="polite"
          data-testid="audience-replay-position"
          data-position={position}
          data-head={head}
          className="whitespace-nowrap text-sm tabular-nums text-slate-600"
        >
          {t('audience.replay.playback.positionStatus', { position, head })}
        </p>
      </div>
    </div>
  );
}

export default ReplayPlaybackContainer;
