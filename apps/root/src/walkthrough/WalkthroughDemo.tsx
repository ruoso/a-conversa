// The interactive walkthrough demo — the centrepiece of the public
// landing page. It loads the curated seed event log and lets a visitor
// step / scrub through it: at scrubber position `pos` it feeds
// `walkthroughEvents.slice(0, pos)` to the shared `@a-conversa/graph-view`
// `GraphView`, which projects and re-renders the graph for that prefix.
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_stepper.md
// TaskJuggler: landing_page.walkthrough_demo_stepper
// ADRs:        0039 (graph-view package boundary — props-in, no store),
//              0026 (root-app micro-frontend), 0004 (Cytoscape),
//              0024 (react-i18next + ICU), 0027 (propose-time rendering).
//
// Scope: this component renders the graph + the control chrome only.
// Per-step captions / narration copy are `walkthrough_demo_narration`,
// which hangs captions off the position seam (the `onPositionChange`
// callback + the `walkthrough-step-status` element). Small-screen mode
// (`landing_demo_mobile_fallback`) and whole-page responsive / a11y polish
// (`landing_responsive_a11y`) are downstream; this is the full
// interactive desktop-first demo with keyboard-operable controls.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Core } from 'cytoscape';

import type { Event } from '@a-conversa/shared-types';
import { GraphView, PADDING } from '@a-conversa/graph-view';

import { walkthroughEvents } from './index';
import { useWalkthroughEvents } from './localized';
import { WALKTHROUGH_BEATS } from './narration';
import { WALKTHROUGH_STEPS, positionForStepIndex, stepAt, stepIndexForPosition } from './steps';

/** Total number of VISIBLE steps (the upper scrubber bound — see steps.ts). */
const STEP_TOTAL = WALKTHROUGH_STEPS.length;

/**
 * Constant per-instance identity for the single persistent `GraphView`
 * mount (Decision §2). The demo has no live diagnostic stream, so the
 * value is opaque — it only scopes the renderer's seen-key gates.
 */
const INSTANCE_KEY = 'landing-walkthrough';

/**
 * Default initial position (Decision §5): mount at the first narration
 * beat's anchor — a small non-zero prefix so the first paint already
 * shows the opening claim rather than a blank canvas. Derived from the
 * beat table (which resolves anchor EVENT IDS against the live stream),
 * so fixture edits never strand this on a stale literal.
 */
export const DEFAULT_INITIAL_POSITION = WALKTHROUGH_BEATS[0]!.position;

/**
 * Auto-advance dwell per arrived step kind (Decision §4, retuned for the
 * visible-step model): graph changes read fast; a dialogue turn needs
 * reading time. Default-paused. Playback stays AVAILABLE under
 * `prefers-reduced-motion` — it is an explicit user gesture with a pause
 * control right next to it (WCAG 2.2.2), not auto-triggered motion; the
 * earlier blanket disable made the demo's headline affordance dead for
 * anyone with the OS preference set.
 */
const GRAPH_STEP_DWELL_MS = 900;
const SPEECH_STEP_DWELL_MS = 3200;

function dwellForStepIndex(stepIndex: number): number {
  const kind = stepAt(stepIndex)?.kind ?? 'graph';
  return kind === 'graph' ? GRAPH_STEP_DWELL_MS : SPEECH_STEP_DWELL_MS;
}

function clampStepIndex(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > STEP_TOTAL) return STEP_TOTAL;
  return Math.trunc(value);
}

export interface WalkthroughDemoProps {
  /**
   * Narration seam (constraint 7) — fired on every position change with
   * the current 1-based position and the event at the prefix boundary
   * (`walkthroughEvents[pos - 1]`, `undefined` at `pos = 0`). Shaped now,
   * consumed later by `walkthrough_demo_narration`; default no-op.
   */
  readonly onPositionChange?: (position: number, event: Event | undefined) => void;
  /**
   * Optional pass-through to the renderer's `cyRef` seam. The demo uses
   * the Cytoscape `Core` internally to re-frame the growing prefix
   * (Decision §3) and forwards it here so a test (or a future consumer)
   * can observe the instance — the package exposes no `window` cy hook.
   */
  readonly cyRef?: (cy: Core | null) => void;
  /** Optional initial position override (defaults to {@link DEFAULT_INITIAL_POSITION}). */
  readonly initialPosition?: number;
}

export function WalkthroughDemo({
  onPositionChange,
  cyRef,
  initialPosition,
}: WalkthroughDemoProps): ReactElement {
  const { t } = useTranslation();
  // The demo's unit of advancement is the VISIBLE STEP (steps.ts): the
  // scrubber, prev/next, and play all walk step indices, transparently
  // skipping the events that render nothing. `initialPosition` stays a
  // raw event position (the external seam vocabulary) and is mapped into
  // step space at mount.
  const [stepIndex, setStepIndex] = useState<number>(() =>
    stepIndexForPosition(initialPosition ?? DEFAULT_INITIAL_POSITION),
  );
  const position = positionForStepIndex(stepIndex);
  const [playing, setPlaying] = useState(false);

  // The heart of constraint 2: render exactly the prefix `[0, pos)`. A
  // single persistent `GraphView` mount (Decision §2) re-projects and
  // diff-syncs on each `events` change, so stepping grows the graph
  // monotonically and scrubbing backward shrinks it. The source is the
  // locale-overlaid stream (`localized.ts`) — same ids/order/count as the
  // canonical module, with translated wordings when the UI language is
  // pt-BR / es-419.
  const localizedEvents = useWalkthroughEvents();
  const events = useMemo(() => localizedEvents.slice(0, position), [localizedEvents, position]);

  // Hold the latest external `cyRef` in a ref so the `handleCy` callback
  // passed to `GraphView` stays referentially stable (the renderer
  // captures `cyRef` once at mount and never re-runs the mount effect).
  const externalCyRef = useRef(cyRef);
  externalCyRef.current = cyRef;
  const cyInstanceRef = useRef<Core | null>(null);

  const handleCy = useCallback((cy: Core | null): void => {
    cyInstanceRef.current = cy;
    if (cy !== null) {
      // Keep the growing prefix framed (constraint 5 / Decision §3): the
      // package fits once on first render then runs every subsequent
      // layout with `fit: false`, which would leave the camera zoomed on
      // the tiny first prefix. Re-fit on each completed layout so later
      // nodes stay in view — consumer-side, with zero change to the
      // shared renderer.
      cy.on('layoutstop', () => {
        cy.fit(undefined, PADDING);
      });
    }
    externalCyRef.current?.(cy);
  }, []);

  // Narration seam — fired on every position change. Default no-op.
  useEffect(() => {
    onPositionChange?.(position, walkthroughEvents[position - 1]);
  }, [position, onPositionChange]);

  // Auto-advance (Decision §4): default-paused; starts only on the
  // visitor's explicit play gesture. A self-rescheduling timeout whose
  // dwell depends on the step just ARRIVED at — a dialogue turn holds
  // long enough to read; a pure graph change moves on briskly. Advancing
  // re-runs the effect (stepIndex in deps), scheduling the next hop.
  useEffect(() => {
    if (!playing || stepIndex >= STEP_TOTAL) return undefined;
    const handle = setTimeout(() => {
      setStepIndex((current) => (current >= STEP_TOTAL ? current : current + 1));
    }, dwellForStepIndex(stepIndex));
    return () => clearTimeout(handle);
  }, [playing, stepIndex]);

  // Stop auto-advance once the end is reached.
  useEffect(() => {
    if (playing && stepIndex >= STEP_TOTAL) {
      setPlaying(false);
    }
  }, [playing, stepIndex]);

  const atStart = stepIndex <= 0;
  const atEnd = stepIndex >= STEP_TOTAL;

  const goPrevious = useCallback(() => {
    setStepIndex((current) => clampStepIndex(current - 1));
  }, []);
  const goNext = useCallback(() => {
    setStepIndex((current) => clampStepIndex(current + 1));
  }, []);
  const onScrub = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setStepIndex(clampStepIndex(Number(event.target.value)));
  }, []);
  const togglePlay = useCallback(() => {
    setPlaying((current) => !current);
  }, []);

  return (
    <section
      data-testid="walkthrough-demo"
      aria-label={t('landing.demo.regionLabel')}
      className="flex h-full w-full flex-col gap-4"
    >
      <div className="relative min-h-[28rem] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:min-h-[36rem]">
        <GraphView events={events} instanceKey={INSTANCE_KEY} cyRef={handleCy} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="walkthrough-prev"
          onClick={goPrevious}
          disabled={atStart}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('landing.demo.previous')}
        </button>
        <button
          type="button"
          data-testid="walkthrough-next"
          onClick={goNext}
          disabled={atEnd}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('landing.demo.next')}
        </button>
        <button
          type="button"
          data-testid="walkthrough-play-toggle"
          onClick={togglePlay}
          aria-pressed={playing}
          className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? t('landing.demo.pause') : t('landing.demo.play')}
        </button>

        <input
          type="range"
          data-testid="walkthrough-scrubber"
          min={0}
          max={STEP_TOTAL}
          step={1}
          value={stepIndex}
          onChange={onScrub}
          aria-label={t('landing.demo.scrubberLabel')}
          className="h-2 min-w-[12rem] flex-1 cursor-pointer"
        />

        <p
          role="status"
          aria-live="polite"
          data-testid="walkthrough-step-status"
          data-position={position}
          data-step={stepIndex}
          data-total={STEP_TOTAL}
          className="whitespace-nowrap text-sm tabular-nums text-slate-600"
        >
          {t('landing.demo.stepStatus', { step: stepIndex, total: STEP_TOTAL })}
        </p>
      </div>
    </section>
  );
}

export default WalkthroughDemo;
