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

/** Total number of events in the frozen seed log (the upper scrubber bound, `N`). */
const TOTAL_EVENTS = walkthroughEvents.length;

/**
 * Constant per-instance identity for the single persistent `GraphView`
 * mount (Decision §2). The demo has no live diagnostic stream, so the
 * value is opaque — it only scopes the renderer's seen-key gates.
 */
const INSTANCE_KEY = 'landing-walkthrough';

/**
 * Default initial position (Decision §5): mount at a small non-zero
 * prefix so the first paint already shows the debate's topic + opening
 * statements rather than a blank canvas (the seed's first `node-created`
 * lands at index 4). Narration may retune this via the position seam.
 */
export const DEFAULT_INITIAL_POSITION = 6;

/** Auto-advance interval (Decision §4); default-paused, reduced-motion-gated. */
const AUTO_ADVANCE_INTERVAL_MS = 1200;

function clampPosition(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > TOTAL_EVENTS) return TOTAL_EVENTS;
  return Math.trunc(value);
}

/**
 * Tracks `prefers-reduced-motion: reduce`. Auto-advance is gated off when
 * this is set (constraint 6) — the demo's own motion baseline; the
 * whole-page audit is `landing_responsive_a11y`.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
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
  const prefersReducedMotion = usePrefersReducedMotion();
  const [position, setPosition] = useState<number>(() =>
    clampPosition(initialPosition ?? DEFAULT_INITIAL_POSITION),
  );
  const [playing, setPlaying] = useState(false);

  // The heart of constraint 2: render exactly the prefix `[0, pos)`. A
  // single persistent `GraphView` mount (Decision §2) re-projects and
  // diff-syncs on each `events` change, so stepping grows the graph
  // monotonically and scrubbing backward shrinks it.
  const events = useMemo(() => walkthroughEvents.slice(0, position), [position]);

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

  // Auto-advance (Decision §4): default-paused; gated off entirely under
  // reduced motion (constraint 6). Increments to the end then halts.
  useEffect(() => {
    if (!playing || prefersReducedMotion) return undefined;
    const handle = setInterval(() => {
      setPosition((current) => (current >= TOTAL_EVENTS ? current : current + 1));
    }, AUTO_ADVANCE_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [playing, prefersReducedMotion]);

  // Stop auto-advance once the end is reached.
  useEffect(() => {
    if (playing && position >= TOTAL_EVENTS) {
      setPlaying(false);
    }
  }, [playing, position]);

  const atStart = position <= 0;
  const atEnd = position >= TOTAL_EVENTS;

  const goPrevious = useCallback(() => {
    setPosition((current) => clampPosition(current - 1));
  }, []);
  const goNext = useCallback(() => {
    setPosition((current) => clampPosition(current + 1));
  }, []);
  const onScrub = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPosition(clampPosition(Number(event.target.value)));
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
          disabled={prefersReducedMotion}
          aria-pressed={playing}
          className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? t('landing.demo.pause') : t('landing.demo.play')}
        </button>

        <input
          type="range"
          data-testid="walkthrough-scrubber"
          min={0}
          max={TOTAL_EVENTS}
          step={1}
          value={position}
          onChange={onScrub}
          aria-label={t('landing.demo.scrubberLabel')}
          className="h-2 min-w-[12rem] flex-1 cursor-pointer"
        />

        <p
          role="status"
          aria-live="polite"
          data-testid="walkthrough-step-status"
          data-position={position}
          data-total={TOTAL_EVENTS}
          className="whitespace-nowrap text-sm tabular-nums text-slate-600"
        >
          {t('landing.demo.stepStatus', { position, total: TOTAL_EVENTS })}
        </p>
      </div>
    </section>
  );
}

export default WalkthroughDemo;
