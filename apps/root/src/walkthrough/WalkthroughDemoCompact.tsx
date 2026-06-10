// The compact walkthrough demo — the reduced/fallback variant the
// narrated wrapper mounts on small (phone) viewports. It renders the same
// single `@a-conversa/graph-view` `GraphView` as the full interactive demo
// (one Cytoscape mount, `walkthroughEvents.slice(0, pos)` prefix
// projection), but steps **coarsely between the nine narration beat
// anchors** with plain prev-segment / next-segment buttons and drops the
// two continuous-motion sources of the full demo (the range scrubber and
// the play/pause auto-advance). Those are the repeated animated re-layout
// the `.tji` note ("skip animated re-layout") targets.
//
// Refinement: tasks/refinements/landing_page/landing_demo_mobile_fallback.md
// TaskJuggler: landing_page.landing_demo_mobile_fallback
// ADRs:        0039 (graph-view package boundary — props-in, no store,
//              `cyRef` the sole seam — NO demo-only prop added here),
//              0026 (root-app micro-frontend), 0004 (Cytoscape),
//              0024 (react-i18next + ICU), 0005 (Tailwind).
//
// Scope: the demo's small-screen *behaviour* only. The viewport gate that
// selects this vs. the full demo lives in `WalkthroughDemoNarrated`
// (Decision §D5); the whole-page responsive / a11y polish is the sibling
// `landing_responsive_a11y`.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Core } from 'cytoscape';

import type { Event } from '@a-conversa/shared-types';
import { GraphView, PADDING } from '@a-conversa/graph-view';

import { walkthroughEvents } from './index';
import { WALKTHROUGH_BEATS } from './narration';
import { WALKTHROUGH_STEPS, stepIndexForPosition } from './steps';

/** Total number of VISIBLE steps (`data-total` parity with the full demo). */
const STEP_TOTAL = WALKTHROUGH_STEPS.length;

/** The last steppable beat index (the `finale` anchor, on the last event). */
const LAST_BEAT_INDEX = WALKTHROUGH_BEATS.length - 1;

/**
 * Constant per-instance identity for the single persistent `GraphView`
 * mount. Mirrors the full demo's `INSTANCE_KEY` semantics — opaque, it
 * only scopes the renderer's seen-key gates. A distinct value keeps the
 * two variants' renderer state independent even though only ever one is
 * mounted at a time (Decision §D5 / constraint 1).
 */
const INSTANCE_KEY = 'landing-walkthrough-compact';

function clampBeatIndex(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > LAST_BEAT_INDEX) return LAST_BEAT_INDEX;
  return Math.trunc(value);
}

export interface WalkthroughDemoCompactProps {
  /**
   * Position seam (constraint 5) — fired on every beat change with the
   * current beat-anchor position (one of `WALKTHROUGH_BEATS` positions)
   * and the event at the prefix boundary (`walkthroughEvents[pos - 1]`).
   * The **same** signature the full `WalkthroughDemo` exposes, so the
   * narrated wrapper drives the caption identically regardless of variant.
   */
  readonly onPositionChange?: (position: number, event: Event | undefined) => void;
  /**
   * Optional pass-through to the renderer's `cyRef` seam (constraint 4 /
   * Decision §D4). The variant uses the Cytoscape `Core` internally to
   * re-frame the growing prefix and forwards it here so a test can observe
   * advancement — the package exposes no `window` cy hook (ADR 0039).
   */
  readonly cyRef?: (cy: Core | null) => void;
  /** Optional initial beat index (0..8); defaults to the first beat (`opening`). */
  readonly initialBeatIndex?: number;
}

export function WalkthroughDemoCompact({
  onPositionChange,
  cyRef,
  initialBeatIndex,
}: WalkthroughDemoCompactProps): ReactElement {
  const { t } = useTranslation();
  const [beatIndex, setBeatIndex] = useState<number>(() => clampBeatIndex(initialBeatIndex ?? 0));

  // The beat-anchor position the current index resolves to (constraint 2:
  // `pos` is restricted to the nine `WALKTHROUGH_BEATS` anchors).
  const position = WALKTHROUGH_BEATS[beatIndex]!.position;

  // Same prefix-projection contract as the full demo (constraint 2): one
  // persistent `GraphView` mount fed exactly `walkthroughEvents[0, pos)`.
  // No demo-side reordering / filtering / mutation of the seed.
  const events = useMemo(() => walkthroughEvents.slice(0, position), [position]);

  // Hold the latest external `cyRef` in a ref so `handleCy` stays
  // referentially stable (the renderer captures it once at mount).
  const externalCyRef = useRef(cyRef);
  externalCyRef.current = cyRef;

  const handleCy = useCallback((cy: Core | null): void => {
    if (cy !== null) {
      // Keep the growing prefix framed via the **same** `cyRef` +
      // `layoutstop` re-fit pattern the full demo uses (constraint 4 /
      // Decision §D4): the package fits once on first render then runs
      // every subsequent layout with `fit: false`; re-fit on each
      // completed layout so later beats stay in view. Consumer-side, no
      // change to the shared renderer.
      cy.on('layoutstop', () => {
        cy.fit(undefined, PADDING);
      });
    }
    externalCyRef.current?.(cy);
  }, []);

  // Position seam — fired on every beat change. Default no-op.
  useEffect(() => {
    onPositionChange?.(position, walkthroughEvents[position - 1]);
  }, [position, onPositionChange]);

  const atFirstBeat = beatIndex <= 0;
  const atLastBeat = beatIndex >= LAST_BEAT_INDEX;

  const goPreviousSegment = useCallback(() => {
    setBeatIndex((current) => clampBeatIndex(current - 1));
  }, []);
  const goNextSegment = useCallback(() => {
    setBeatIndex((current) => clampBeatIndex(current + 1));
  }, []);

  return (
    <section
      data-testid="walkthrough-demo-compact"
      aria-label={t('landing.demo.compactRegionLabel')}
      className="flex h-full w-full flex-col gap-4"
    >
      <div className="relative min-h-[20rem] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <GraphView events={events} instanceKey={INSTANCE_KEY} cyRef={handleCy} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="walkthrough-prev"
          onClick={goPreviousSegment}
          disabled={atFirstBeat}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('landing.demo.previousSegment')}
        </button>
        <button
          type="button"
          data-testid="walkthrough-next"
          onClick={goNextSegment}
          disabled={atLastBeat}
          className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('landing.demo.nextSegment')}
        </button>

        <p
          role="status"
          aria-live="polite"
          data-testid="walkthrough-step-status"
          data-position={position}
          data-step={stepIndexForPosition(position)}
          data-total={STEP_TOTAL}
          className="whitespace-nowrap text-sm tabular-nums text-slate-600"
        >
          {t('landing.demo.stepStatus', {
            step: stepIndexForPosition(position),
            total: STEP_TOTAL,
          })}
        </p>
      </div>
    </section>
  );
}

export default WalkthroughDemoCompact;
