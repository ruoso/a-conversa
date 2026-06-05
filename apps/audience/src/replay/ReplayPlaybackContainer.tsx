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
//   then tasks/refinements/replay_test/replay_chapter_jumping.md (chapter
//   navigation on top of the seek bar: prev/next chapter buttons, seek-bar
//   `<datalist>` ticks, and a clickable chapter index — all driven by one
//   lifted `useSessionSnapshots` read, all funnelled through `updatePosition`;
//   the chapter arithmetic is ported into `@a-conversa/shell` per ADR 0043.)
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
  nextSnapshotPosition,
  prevPosition,
  prevSnapshotPosition,
  replayHeadSequence,
  resolveSnapshotPosition,
  SnapshotList,
  snapshotPositions,
  useSessionSnapshots,
} from '@a-conversa/shell';
import { GraphView } from '@a-conversa/graph-view';

import { DEFAULT_PLAYBACK_INTERVAL_MS, useReplayPlayback } from './useReplayPlayback.js';

/**
 * The fixed playback-speed ladder (replay_speed_controls Decision §3). One
 * named constant so the `<select>` option list and the Vitest fixture share a
 * single source of truth — 0.5× (slow-study), 1× (default), 2× (skim),
 * 4× (fast-skim). The cadence is derived as
 * `DEFAULT_PLAYBACK_INTERVAL_MS / speed` (Decision §2 — higher speed = shorter
 * interval), so `1×` is exactly today's shipped cadence (Constraint §3).
 */
export const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;

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

  // The playback-speed multiplier, lifted alongside `position` as sibling UI
  // state (replay_speed_controls Decision §1). Default `1×` is the shipped
  // behavior; the derived `intervalMs` feeds the one timer the hook owns. Speed
  // is orthogonal to position — it changes the auto-advance *cadence*, never the
  // position arithmetic (Constraint §2), and survives the restart-from-end
  // affordance untouched (Decision §6).
  const [speed, setSpeed] = useState<number>(1);
  const intervalMs = DEFAULT_PLAYBACK_INTERVAL_MS / speed;

  // Guard the lifted setter so every writer — the step buttons and the
  // auto-advance loop — lands a clamped, navigable position (Constraint §1).
  const updatePosition = (next: number): void => {
    setPosition(clampPosition(next, events));
  };

  const { isPlaying, play, pause } = useReplayPlayback({
    events,
    position,
    setPosition: updatePosition,
    intervalMs,
  });

  // One lifted snapshot source feeds all three chapter affordances — prev/next
  // buttons, the seek-bar ticks, and the clickable chapter index
  // (replay_chapter_jumping Constraint §1). `SnapshotList` renders the hook's
  // loading/error/empty states directly; the buttons and ticks derive from the
  // (empty-while-loading) `snapshots` array, so they are naturally inert until
  // the chapters arrive (Constraint §6).
  const {
    status: snapshotStatus,
    snapshots,
    retry: retrySnapshots,
  } = useSessionSnapshots(sessionId);

  const head = replayHeadSequence(events);
  const atStart = isAtStart(position);
  const atEnd = isAtEnd(events, position);

  // The chapter (snapshot) markers in event-sequence space, deduped + ascending
  // (Constraint §2 — ported helper, never re-derived here). The prev/next
  // targets are `null` at the ends, which *disables* the affordance rather than
  // saturating like the event-step buttons (Decision §4).
  const chapterTicks = useMemo(() => snapshotPositions(snapshots), [snapshots]);
  const prevChapter = prevSnapshotPosition(snapshots, position);
  const nextChapter = nextSnapshotPosition(snapshots, position);

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
  // Chapter jumps are just another writer of the lifted `position`, funnelled
  // through the same `updatePosition`/`clampPosition` guard as a step, a seek,
  // or a play-loop tick (Constraint §3). A `null` target means no further
  // chapter in that direction — the button is `disabled`, so this guard is a
  // belt-and-braces no-op (Constraint §5).
  const goPrevChapter = (): void => {
    if (prevChapter !== null) {
      updatePosition(prevChapter);
    }
  };
  const goNextChapter = (): void => {
    if (nextChapter !== null) {
      updatePosition(nextChapter);
    }
  };
  // A chapter-row click resolves `snapshotId → logPosition` at the click
  // boundary via the shipped resolver (Constraint §4 — `snapshotId` never
  // leaks into `position` state); the resolved position funnels through the
  // same guard. `null` (an unreachable miss) fires no jump.
  const jumpToChapter = (snapshotId: string): void => {
    const target = resolveSnapshotPosition(snapshots, snapshotId);
    if (target !== null) {
      updatePosition(target);
    }
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
  // The speed selector is a single-choice setting (Decision §4 — a native
  // `<select>`, not an action button row): selecting a multiplier sets `speed`,
  // which re-derives `intervalMs`. The hook's `[isPlaying, intervalMs]` effect
  // swaps the live interval cleanly, so a mid-play change takes effect at once
  // without leaking the old timer or losing position (Constraint §4).
  const onSpeedChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setSpeed(Number(event.target.value));
  };

  const playLabel = isPlaying
    ? t('audience.replay.playback.pause')
    : t('audience.replay.playback.play');

  return (
    <div data-testid="audience-replay-playback" className="relative h-screen w-screen">
      <GraphView events={prefix} instanceKey={sessionId} />

      {/* The clickable chapter index — the snapshot list rendered as chapters
          (Decision §3). Reuses the shipped presentational `SnapshotList` +
          `resolveSnapshotPosition`; clicking a chapter jumps `position` to that
          snapshot's `logPosition`. Loading / error / empty states pass straight
          through (Constraint §6). */}
      <div
        data-testid="audience-replay-chapter-index"
        className="absolute right-4 top-4 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white/90 backdrop-blur"
      >
        <SnapshotList
          status={snapshotStatus}
          snapshots={snapshots}
          onSelect={jumpToChapter}
          onRetry={retrySnapshots}
        />
      </div>

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
        <button
          type="button"
          data-testid="audience-replay-prev-chapter"
          onClick={goPrevChapter}
          disabled={prevChapter === null}
          aria-label={t('audience.replay.playback.prevChapter')}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('audience.replay.playback.prevChapter')}
        </button>
        <button
          type="button"
          data-testid="audience-replay-next-chapter"
          onClick={goNextChapter}
          disabled={nextChapter === null}
          aria-label={t('audience.replay.playback.nextChapter')}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('audience.replay.playback.nextChapter')}
        </button>

        <input
          type="range"
          data-testid="audience-replay-seek"
          min={0}
          max={head}
          step={1}
          value={position}
          onChange={onScrub}
          list="audience-replay-chapter-ticks"
          aria-label={t('audience.replay.playback.seekAriaLabel')}
          className="h-2 min-w-[12rem] flex-1 cursor-pointer"
        />
        {/* Decorative chapter tick marks on the existing labelled range input —
            a native `<datalist>` (Decision §5), no new focus trap. */}
        <datalist id="audience-replay-chapter-ticks" data-testid="audience-replay-chapter-ticks">
          {chapterTicks.map((mark) => (
            <option key={mark} value={mark} />
          ))}
        </datalist>

        <select
          data-testid="audience-replay-speed"
          value={String(speed)}
          onChange={onSpeedChange}
          aria-label={t('audience.replay.playback.speedAriaLabel')}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {SPEED_OPTIONS.map((multiplier) => (
            <option key={multiplier} value={multiplier}>
              {t('audience.replay.playback.speedOption', { speed: multiplier })}
            </option>
          ))}
        </select>

        <p
          role="status"
          aria-live="polite"
          data-testid="audience-replay-position"
          data-position={position}
          data-head={head}
          data-speed={speed}
          className="whitespace-nowrap text-sm tabular-nums text-slate-600"
        >
          {t('audience.replay.playback.positionStatus', { position, head })}
        </p>
      </div>
    </div>
  );
}

export default ReplayPlaybackContainer;
