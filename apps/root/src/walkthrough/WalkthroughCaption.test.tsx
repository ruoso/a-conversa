// Component suite for the narrated walkthrough composition (ADR 0022 —
// durable, committed test artifact). Pins that the caption tracks the
// stepper's position through the real `onPositionChange` seam: beat 1 on
// load, the active beat updates when the scrubber crosses a later anchor,
// and the caption clears below the first anchor (Decision §D3).
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_narration.md

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '@a-conversa/graph-view/test-utils';

import { WalkthroughDemoNarrated } from './WalkthroughDemoNarrated';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

// Cytoscape needs the same noop canvas / ResizeObserver / rAF stubs the
// stepper suite installs — `WalkthroughDemoNarrated` mounts the real demo.
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
});

describe('WalkthroughDemoNarrated — caption tracks position', () => {
  it('shows beat 1 on load with its en-US eyebrow/title/body', async () => {
    renderWithProviders(<WalkthroughDemoNarrated />);

    const caption = await screen.findByTestId('walkthrough-caption');
    await waitFor(() => {
      expect(caption.getAttribute('data-beat')).toBe('opening');
    });

    // The catalog copy resolves and renders.
    expect(screen.getByText('One shared graph')).toBeTruthy();
    expect(screen.getByText('Every debate starts as a single claim.')).toBeTruthy();
    expect(screen.getByText(/Two debaters and a moderator work on one shared map/)).toBeTruthy();
  });

  it('updates the active beat when the scrubber crosses a later anchor', async () => {
    renderWithProviders(<WalkthroughDemoNarrated />);

    const caption = await screen.findByTestId('walkthrough-caption');
    await waitFor(() => {
      expect(caption.getAttribute('data-beat')).toBe('opening');
    });

    // pos 100 is the `classification` anchor.
    fireEvent.change(screen.getByTestId('walkthrough-scrubber'), {
      target: { value: '100' },
    });
    await waitFor(() => {
      expect(caption.getAttribute('data-beat')).toBe('classification');
    });
    expect(screen.getByText('Category mismatches')).toBeTruthy();
  });

  it('clears the caption below the first anchor (data-beat empty, no body)', async () => {
    renderWithProviders(<WalkthroughDemoNarrated />);

    const caption = await screen.findByTestId('walkthrough-caption');
    await waitFor(() => {
      expect(caption.getAttribute('data-beat')).toBe('opening');
    });

    // Scrub to pos 3 (below the first anchor, 6): no active beat.
    fireEvent.change(screen.getByTestId('walkthrough-scrubber'), {
      target: { value: '3' },
    });
    await waitFor(() => {
      expect(caption.getAttribute('data-beat')).toBe('');
    });
    expect(screen.queryByText('One shared graph')).toBeNull();
  });
});
