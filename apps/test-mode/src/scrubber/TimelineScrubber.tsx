// Per-event timeline scrubber surface — the test-mode replay viewer.
//
// Refinement: tasks/refinements/replay_test/test_mode_timeline_scrubber.md
// TaskJuggler: replay_test.test_mode.test_mode_timeline_scrubber
// ADRs:        0043 (the client position-navigation seam this consumes),
//              0039 (graph-view package — props-in, no store),
//              0004 (Cytoscape), 0024 (react-i18next), 0022 (the
//                    `data-testid` seams are the pinned regression surface
//                    for the Vitest component test + the Playwright e2e).
//
// Supersedes `SessionLogRoute`'s inert readout (Decision §3): the operator
// scrubs through every event in the loaded log — one event per stop in
// event-sequence space `0..head` — and watches the projected graph rebuild
// at each position. Three pieces, all reading the one lifted `position`
// (Decision §4): the per-event control set, the `@a-conversa/graph-view`
// `GraphView` fed the position prefix (Decision §2 — client-side projection,
// no per-step server call), and the shipped `SnapshotJumpList` as a
// positional shortcut (Decision §5).
//
// The step/boundary/clamp arithmetic comes entirely from the shared
// `@a-conversa/shell` `replay-position` helper (Constraint §2); this surface
// never re-derives it.

import { useMemo, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Event } from '@a-conversa/shared-types';
import {
  clampPosition,
  isAtEnd,
  isAtStart,
  nextPosition,
  prevPosition,
  replayHeadSequence,
  SnapshotJumpList,
} from '@a-conversa/shell';
import { GraphView } from '@a-conversa/graph-view';

import { ChangeHighlights } from '../changes/ChangeHighlights';
import { DiagnosticInspector } from '../diagnostics/DiagnosticInspector';
import { ExportPanel } from '../export/ExportPanel';
import { EventInspector } from '../inspector/EventInspector';

export interface TimelineScrubberProps {
  /** The session whose log is loaded — the `GraphView` instance key and the
   * `SnapshotJumpList` fetch key. */
  readonly sessionId: string;
  /** The full ascending event log (from `useSessionEventLog`). */
  readonly events: readonly Event[];
  /** The current scrubber position in event-sequence space (`0..head`). */
  readonly position: number;
  /** Set the current position; the snapshot-jump shortcut and the controls
   * funnel through it. Values are always pre-clamped to `[0, head]`. */
  readonly setPosition: (position: number) => void;
}

export function TimelineScrubber({
  sessionId,
  events,
  position,
  setPosition,
}: TimelineScrubberProps): ReactElement {
  const { t } = useTranslation();

  const head = replayHeadSequence(events);
  const atStart = isAtStart(position);
  const atEnd = isAtEnd(events, position);

  // Constraint §1: the prefix rendered at position `p` is every event whose
  // sequence is `<= p`. Client-side projection (Decision §2) — `GraphView`
  // re-projects this prefix on each change; no server round-trip per step.
  const prefix = useMemo(
    () => events.filter((event) => event.sequence <= position),
    [events, position],
  );

  const goPrevious = (): void => {
    setPosition(prevPosition(events, position));
  };
  const goNext = (): void => {
    setPosition(nextPosition(events, position));
  };
  const onScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    setPosition(clampPosition(Number(event.target.value), events));
  };

  return (
    <main
      data-testid="test-mode-scrubber"
      data-allow-scroll=""
      aria-label={t('testMode.scrubber.regionAriaLabel')}
      className="mx-auto flex h-screen max-w-5xl flex-col gap-4 overflow-y-auto p-6 text-sm text-slate-900"
    >
      <div
        data-testid="test-mode-scrubber-graph"
        aria-label={t('testMode.scrubber.graphAriaLabel')}
        className="relative min-h-[24rem] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white"
      >
        <GraphView events={prefix} instanceKey={sessionId} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="test-mode-scrubber-prev"
          onClick={goPrevious}
          disabled={atStart}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('testMode.scrubber.previous')}
        </button>
        <button
          type="button"
          data-testid="test-mode-scrubber-next"
          onClick={goNext}
          disabled={atEnd}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('testMode.scrubber.next')}
        </button>

        <input
          type="range"
          data-testid="test-mode-scrubber-range"
          min={0}
          max={head}
          step={1}
          value={position}
          onChange={onScrub}
          aria-label={t('testMode.scrubber.rangeAriaLabel')}
          className="h-2 min-w-[12rem] flex-1 cursor-pointer"
        />

        <p
          role="status"
          aria-live="polite"
          data-testid="test-mode-scrubber-status"
          data-position={position}
          data-head={head}
          className="whitespace-nowrap text-sm tabular-nums text-slate-600"
        >
          {t('testMode.scrubber.positionStatus', { position, head })}
        </p>
      </div>

      <section
        data-testid="test-mode-scrubber-snapshots"
        aria-label={t('testMode.scrubber.snapshotsAriaLabel')}
        className="rounded-2xl border border-slate-200 bg-white"
      >
        <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('testMode.scrubber.snapshotsHeading')}
        </h2>
        <SnapshotJumpList sessionId={sessionId} onJump={setPosition} />
      </section>

      <EventInspector events={events} position={position} />

      <ChangeHighlights events={events} position={position} />

      <DiagnosticInspector sessionId={sessionId} position={position} />

      <ExportPanel sessionId={sessionId} position={position} />
    </main>
  );
}

export default TimelineScrubber;
