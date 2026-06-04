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
// two-column grid at `lg`, stacked below it otherwise). The full
// cross-breakpoint treatment is `landing_demo_mobile_fallback` /
// `landing_responsive_a11y`; this is the desktop-first scaffold they
// compose around.

import { useCallback, useState, type ReactElement } from 'react';

import { WalkthroughDemo, DEFAULT_INITIAL_POSITION } from './WalkthroughDemo';
import { WalkthroughCaption } from './WalkthroughCaption';
import { activeBeatFor } from './narration';

export function WalkthroughDemoNarrated(): ReactElement {
  // Seed with the stepper's default so the caption is correct on the first
  // paint; the demo also fires `onPositionChange` synchronously on mount
  // (`WalkthroughDemo.tsx`), so the two stay in lock-step thereafter.
  const [position, setPosition] = useState<number>(DEFAULT_INITIAL_POSITION);

  // Stable callback (stepper's narration effect depends on its identity, so
  // a fresh closure each render would re-fire it needlessly).
  const handlePositionChange = useCallback((next: number): void => {
    setPosition(next);
  }, []);

  const beat = activeBeatFor(position);

  return (
    <div
      data-testid="walkthrough-demo-narrated"
      className="grid h-full w-full gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <WalkthroughDemo onPositionChange={handlePositionChange} />
      <WalkthroughCaption beat={beat} />
    </div>
  );
}

export default WalkthroughDemoNarrated;
