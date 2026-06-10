// The narrated composition — the small wrapper that owns the demo's
// position and renders the stepper alongside its caption. It hangs the
// caption off the stepper's existing `onPositionChange` seam (stepper
// Decision D4 / `WalkthroughDemo.tsx`): the stepper stays pure (it owns
// no caption content), and this parent computes the active beat and feeds
// it to `<WalkthroughCaption />`. `LandingRoute` lazy-loads this wrapper
// in place of the bare demo.
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_narration.md
// TaskJuggler: landing_page.walkthrough_demo_narration
// ADRs:        0026 (root-app micro-frontend), 0024 (react-i18next + ICU).
//
// Scope: desktop-first layout — the caption sits beside the graph (a
// two-column grid at `lg`, stacked below it otherwise). The caption is a
// fixed narrow band (`minmax(16rem,22rem)`) so the graph column (`1fr`)
// claims all the remaining window width: the page is now full-width, and a
// proportional caption column would otherwise balloon to a third of the
// viewport and starve the graph. This wrapper also
// owns the **small-viewport variant gate** (`landing_demo_mobile_fallback`,
// Decision §D5): below Tailwind `md` (a phone) it mounts the lighter
// `WalkthroughDemoCompact` instead of the full interactive stepper, passing
// the **same** `onPositionChange` to whichever variant renders so the
// caption + position seam behave identically. Selection is a runtime
// `matchMedia` gate (JS, not a CSS toggle) so exactly one variant — hence
// exactly one Cytoscape core — is ever instantiated (constraint 1). The
// whole-page cross-breakpoint / a11y polish is the sibling
// `landing_responsive_a11y`.

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { WalkthroughDemo, DEFAULT_INITIAL_POSITION } from './WalkthroughDemo';
import { WalkthroughDemoCompact } from './WalkthroughDemoCompact';
import { WalkthroughCaption } from './WalkthroughCaption';
import { ChatPanel } from './ChatPanel';
import { activeBeatFor } from './narration';

/**
 * Small-viewport breakpoint (Decision §D6): below Tailwind `md` (768px) a
 * visitor is treated as a phone and gets the compact variant. `767.98px`
 * is the conventional just-below-`md` bound. The exact value is a
 * documented call, not a deep invariant — `landing_responsive_a11y` may
 * retune the page's breakpoints around it, and because the gate is a single
 * mockable hook the threshold is trivially adjustable and testable.
 */
const SMALL_VIEWPORT_QUERY = '(max-width: 767.98px)';

/**
 * Tracks whether the viewport is below the small-screen breakpoint, so the
 * wrapper can mount **exactly one** of the full or compact demo (constraint
 * 1 / Decision §D5). Reads its initial value synchronously at mount
 * (apps/root is a client-rendered SPA — no SSR/hydration mismatch concern)
 * and updates on the media-query `change` event, mirroring the existing
 * `usePrefersReducedMotion()` idiom (`WalkthroughDemo.tsx`).
 */
function useIsSmallViewport(): boolean {
  const [isSmall, setIsSmall] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(SMALL_VIEWPORT_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(SMALL_VIEWPORT_QUERY);
    const onChange = (): void => setIsSmall(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return isSmall;
}

export function WalkthroughDemoNarrated(): ReactElement {
  // Seed with the stepper's default so the caption is correct on the first
  // paint; both variants fire `onPositionChange` synchronously on mount, so
  // the position + caption stay in lock-step thereafter regardless of which
  // one is mounted. The default (6) is the first beat anchor, so the
  // compact variant's coarse stepping starts exactly on its first stop.
  const [position, setPosition] = useState<number>(DEFAULT_INITIAL_POSITION);
  const isSmallViewport = useIsSmallViewport();

  // Stable callback (the variants' narration effect depends on its
  // identity, so a fresh closure each render would re-fire it needlessly).
  const handlePositionChange = useCallback((next: number): void => {
    setPosition(next);
  }, []);

  const beat = activeBeatFor(position);

  return (
    <div
      data-testid="walkthrough-demo-narrated"
      className="grid h-full w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]"
    >
      {isSmallViewport ? (
        <WalkthroughDemoCompact onPositionChange={handlePositionChange} />
      ) : (
        <WalkthroughDemo onPositionChange={handlePositionChange} />
      )}
      {/* The narration column: the compact beat caption on top, the
          dialogue chat occupying the REST of the graph's vertical space.
          The chat wrapper's `lg:h-0 lg:flex-1` keeps the column's
          intrinsic height out of the grid row computation (the graph
          column alone sizes the row) and then grows the chat to fill it —
          so the dialogue sits beside the whole graph instead of being
          pushed below the fold. On a phone the column stacks under the
          compact demo with the chat height-capped. */}
      <div className="flex min-h-0 flex-col gap-4">
        <WalkthroughCaption beat={beat} />
        <div className="max-h-80 min-h-0 lg:h-0 lg:max-h-none lg:flex-1">
          <ChatPanel position={position} />
        </div>
      </div>
    </div>
  );
}

export default WalkthroughDemoNarrated;
