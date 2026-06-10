// Component suite for the compact (small-viewport) walkthrough variant
// (ADR 0022 — durable, committed test artifact). Pins, per the
// `landing_demo_mobile_fallback` acceptance criteria:
//   1. it renders the shared renderer + the coarse controls, and the
//      scrubber / play-toggle are ABSENT (the two continuous-motion
//      sources the compact variant drops);
//   2. coarse beat stepping advances the rendered prefix from one beat
//      anchor to the next, the node count strictly grows, and the
//      segment buttons disable at the first / last beat;
//   3. position-seam parity — it fires `onPositionChange` with the beat
//      anchor and exposes the same `walkthrough-step-status` attributes.
//
// Refinement: tasks/refinements/landing_page/landing_demo_mobile_fallback.md

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Core } from 'cytoscape';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '@a-conversa/graph-view/test-utils';

import { walkthroughEvents } from './index';
import { WALKTHROUGH_BEATS } from './narration';
import { WALKTHROUGH_STEPS } from './steps';
import { WalkthroughDemoCompact } from './WalkthroughDemoCompact';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

// `data-total` reports the VISIBLE-step count (parity with the full demo).
const STEP_TOTAL = WALKTHROUGH_STEPS.length;
const FIRST_BEAT = WALKTHROUGH_BEATS[0]!.position;
const SECOND_BEAT = WALKTHROUGH_BEATS[1]!.position;
const LAST_BEAT = WALKTHROUGH_BEATS[WALKTHROUGH_BEATS.length - 1]!.position;

// Cytoscape's `CanvasRenderer` calls `canvas.getContext('2d')` (which
// happy-dom does not implement) at mount; the package ships the noop
// canvas / ResizeObserver / rAF stubs the audience + full-demo suites use.
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

describe('WalkthroughDemoCompact', () => {
  it('renders the renderer + coarse controls, and omits the scrubber and play-toggle', async () => {
    renderWithProviders(<WalkthroughDemoCompact />);

    // The shared GraphView container is present (one Cytoscape mount).
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });

    // Coarse controls present...
    expect(screen.getByTestId('walkthrough-prev')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-next')).toBeTruthy();

    // ...the step-status reports position + total...
    const status = screen.getByTestId('walkthrough-step-status');
    expect(status.getAttribute('data-position')).toBe(String(FIRST_BEAT));
    expect(status.getAttribute('data-total')).toBe(String(STEP_TOTAL));

    // ...and the two continuous-motion controls are ABSENT (constraint 3).
    expect(screen.queryByTestId('walkthrough-scrubber')).toBeNull();
    expect(screen.queryByTestId('walkthrough-play-toggle')).toBeNull();
  });

  it('steps coarsely between beat anchors — next advances a whole beat and the graph grows', async () => {
    let captured: Core | null = null;
    renderWithProviders(
      <WalkthroughDemoCompact
        cyRef={(cy) => {
          if (cy !== null) captured = cy;
        }}
      />,
    );

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    const cy = captured as unknown as Core;
    const status = screen.getByTestId('walkthrough-step-status');

    // First beat anchor.
    await waitFor(() => {
      expect(status.getAttribute('data-position')).toBe(String(FIRST_BEAT));
    });
    await waitFor(() => {
      expect(cy.nodes().length).toBeGreaterThan(0);
    });
    const earlyCount = cy.nodes().length;

    // Next-segment jumps a whole beat, not +1.
    fireEvent.click(screen.getByTestId('walkthrough-next'));
    await waitFor(() => {
      expect(status.getAttribute('data-position')).toBe(String(SECOND_BEAT));
    });

    // The prefix-projection contract holds over the coarse anchors: a later
    // beat renders strictly more nodes than an earlier one.
    await waitFor(() => {
      expect(cy.nodes().length).toBeGreaterThan(earlyCount);
    });
  });

  it('disables previous-segment at the first beat and next-segment at the last', async () => {
    renderWithProviders(<WalkthroughDemoCompact />);

    const prev = screen.getByTestId('walkthrough-prev');
    await waitFor(() => {
      expect(prev.hasAttribute('disabled')).toBe(true);
    });

    cleanup();
    renderWithProviders(<WalkthroughDemoCompact initialBeatIndex={WALKTHROUGH_BEATS.length - 1} />);
    const next = screen.getByTestId('walkthrough-next');
    await waitFor(() => {
      expect(next.hasAttribute('disabled')).toBe(true);
    });
    expect(screen.getByTestId('walkthrough-step-status').getAttribute('data-position')).toBe(
      String(LAST_BEAT),
    );
  });

  it('fires onPositionChange with the beat anchor — position-seam parity', async () => {
    const onPositionChange = vi.fn();
    renderWithProviders(<WalkthroughDemoCompact onPositionChange={onPositionChange} />);

    // Synchronous mount fire at the first beat anchor (the event at the
    // prefix boundary is `walkthroughEvents[pos - 1]`).
    await waitFor(() => {
      expect(onPositionChange).toHaveBeenCalledWith(FIRST_BEAT, walkthroughEvents[FIRST_BEAT - 1]);
    });

    fireEvent.click(screen.getByTestId('walkthrough-next'));
    await waitFor(() => {
      expect(onPositionChange).toHaveBeenCalledWith(
        SECOND_BEAT,
        walkthroughEvents[SECOND_BEAT - 1],
      );
    });
  });
});
