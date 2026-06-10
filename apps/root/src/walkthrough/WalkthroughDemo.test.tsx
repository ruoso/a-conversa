// Component suite for the landing walkthrough demo (ADR 0022 — durable,
// committed test artifact). Pins the slice→`events`→render contract, the
// control bounds, the scrubber-jump recompute (forward + backward), and
// the reduced-motion auto-advance gate.
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_stepper.md

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Core } from 'cytoscape';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '@a-conversa/graph-view/test-utils';

import { walkthroughEvents } from './index';
import { DEFAULT_INITIAL_POSITION, WalkthroughDemo } from './WalkthroughDemo';
import { WALKTHROUGH_STEPS, positionForStepIndex, stepIndexForPosition } from './steps';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

const TOTAL_EVENTS = walkthroughEvents.length;
// The controls walk VISIBLE steps (steps.ts); every expectation below
// derives from the step table — no position/step literals.
const STEP_TOTAL = WALKTHROUGH_STEPS.length;

/**
 * Mock `window.matchMedia` for the reduced-motion gate. happy-dom does not
 * implement it; the demo reads it both at mount and via a `change`
 * listener, so the stub returns a static `matches` plus no-op
 * add/removeEventListener.
 */
function mockReducedMotion(reduce: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

// Cytoscape's `CanvasRenderer` calls `canvas.getContext('2d')` (which
// happy-dom does not implement) at mount; the package ships the noop
// canvas / ResizeObserver / rAF stubs the audience suites also use. The
// tests assert on `cy.elements()` (the logical element set), not pixels.
let cyEnv: CytoscapeTestEnvRestoreHandle;

beforeAll(async () => {
  cyEnv = installCytoscapeTestEnv();
  await getTestI18n();
});

afterAll(() => {
  cyEnv.restore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WalkthroughDemo', () => {
  it('mounts the renderer and the control chrome', async () => {
    renderWithProviders(<WalkthroughDemo />);

    // The shared GraphView container is present (its root + wrapper testids).
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
    expect(screen.getByTestId('walkthrough-prev')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-next')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-scrubber')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-play-toggle')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-step-status')).toBeTruthy();
  });

  it('feeds a longer prefix as the position advances — the graph grows', async () => {
    let captured: Core | null = null;
    renderWithProviders(
      <WalkthroughDemo
        // The first beat anchor — guaranteed to have at least one node on
        // the board (no position literal; fixture edits must not redden).
        initialPosition={DEFAULT_INITIAL_POSITION}
        cyRef={(cy) => {
          if (cy !== null) captured = cy;
        }}
      />,
    );

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    const cy = captured as unknown as Core;
    await waitFor(() => {
      expect(cy.nodes().length).toBeGreaterThan(0);
    });
    const earlyCount = cy.nodes().length;

    // Scrub forward to a much larger prefix; the same persistent mount
    // re-projects `slice(0, pos)` and the node count strictly grows.
    fireEvent.change(screen.getByTestId('walkthrough-scrubber'), {
      target: { value: '120' },
    });

    await waitFor(() => {
      expect(cy.nodes().length).toBeGreaterThan(earlyCount);
    });
  });

  it('disables previous at the lower bound and next at the upper bound', async () => {
    renderWithProviders(<WalkthroughDemo initialPosition={0} />);

    const prev = screen.getByTestId('walkthrough-prev');
    const status = screen.getByTestId('walkthrough-step-status');
    await waitFor(() => {
      expect(prev.hasAttribute('disabled')).toBe(true);
    });
    expect(status.getAttribute('data-position')).toBe('0');
    expect(status.getAttribute('data-step')).toBe('0');
    expect(status.getAttribute('data-total')).toBe(String(STEP_TOTAL));

    cleanup();
    renderWithProviders(<WalkthroughDemo initialPosition={TOTAL_EVENTS} />);
    const next = screen.getByTestId('walkthrough-next');
    await waitFor(() => {
      expect(next.hasAttribute('disabled')).toBe(true);
    });
    const finalStatus = screen.getByTestId('walkthrough-step-status');
    expect(finalStatus.getAttribute('data-step')).toBe(String(STEP_TOTAL));
    expect(finalStatus.getAttribute('data-position')).toBe(
      String(positionForStepIndex(STEP_TOTAL)),
    );
  });

  it('recomputes the prefix on a scrubber jump — forward grows, backward shrinks', async () => {
    let captured: Core | null = null;
    renderWithProviders(
      <WalkthroughDemo
        initialPosition={DEFAULT_INITIAL_POSITION}
        cyRef={(cy) => {
          if (cy !== null) captured = cy;
        }}
      />,
    );
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    const cy = captured as unknown as Core;
    const scrubber = screen.getByTestId('walkthrough-scrubber');
    const status = screen.getByTestId('walkthrough-step-status');

    // The scrubber's unit is the STEP INDEX; data-position reports the
    // raw event position that step renders.
    const forwardStep = Math.floor(STEP_TOTAL * 0.6);
    fireEvent.change(scrubber, { target: { value: String(forwardStep) } });
    await waitFor(() => {
      expect(status.getAttribute('data-position')).toBe(String(positionForStepIndex(forwardStep)));
    });
    const forwardCount = cy.nodes().length;

    // Backward jump: the prefix is recomputed (not appended) so the node
    // count shrinks — proving constraint 2's slice semantics.
    const backwardStep = Math.floor(STEP_TOTAL * 0.1);
    fireEvent.change(scrubber, { target: { value: String(backwardStep) } });
    await waitFor(() => {
      expect(status.getAttribute('data-position')).toBe(String(positionForStepIndex(backwardStep)));
    });
    await waitFor(() => {
      expect(cy.nodes().length).toBeLessThan(forwardCount);
    });
  });

  it('does not auto-advance under prefers-reduced-motion, but manual stepping works', async () => {
    mockReducedMotion(true);
    renderWithProviders(<WalkthroughDemo initialPosition={DEFAULT_INITIAL_POSITION} />);

    const initialStep = stepIndexForPosition(DEFAULT_INITIAL_POSITION);
    const status = screen.getByTestId('walkthrough-step-status');
    const playToggle = screen.getByTestId('walkthrough-play-toggle');
    await waitFor(() => {
      expect(status.getAttribute('data-step')).toBe(String(initialStep));
    });

    // Auto-advance is gated off entirely: the play control is disabled and
    // nothing increments on its own.
    expect(playToggle.hasAttribute('disabled')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(status.getAttribute('data-step')).toBe(String(initialStep));

    // Manual stepping still works — one press, one VISIBLE step.
    fireEvent.click(screen.getByTestId('walkthrough-next'));
    await waitFor(() => {
      expect(status.getAttribute('data-step')).toBe(String(initialStep + 1));
    });
    expect(status.getAttribute('data-position')).toBe(
      String(positionForStepIndex(initialStep + 1)),
    );
  });

  it('play advances to the next visible step on its own', { timeout: 12_000 }, async () => {
    // Explicit no-reduced-motion: the sibling test assigns
    // `window.matchMedia` directly (not a spy), so restoreAllMocks
    // does not undo it.
    mockReducedMotion(false);
    renderWithProviders(<WalkthroughDemo initialPosition={DEFAULT_INITIAL_POSITION} />);

    const initialStep = stepIndexForPosition(DEFAULT_INITIAL_POSITION);
    const status = screen.getByTestId('walkthrough-step-status');
    await waitFor(() => {
      expect(status.getAttribute('data-step')).toBe(String(initialStep));
    });

    fireEvent.click(screen.getByTestId('walkthrough-play-toggle'));
    // The next hop lands after the arrived step's dwell (graph 900ms /
    // speech 3200ms) — wait generously, assert only one real advance so
    // the suite never plays the whole stream.
    await waitFor(
      () => {
        expect(Number(status.getAttribute('data-step'))).toBeGreaterThan(initialStep);
      },
      { timeout: 8_000 },
    );
    fireEvent.click(screen.getByTestId('walkthrough-play-toggle'));
  });
});
