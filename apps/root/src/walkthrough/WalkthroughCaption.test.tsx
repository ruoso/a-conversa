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
import { WALKTHROUGH_BEATS } from './narration';
import { stepIndexForPosition } from './steps';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

// Resolve anchor positions from the live beat table — no position
// literals, so fixture edits never redden this suite. The scrubber's
// unit is the STEP INDEX (steps.ts), so anchor positions are mapped
// through `stepIndexForPosition` before filling the control.
const beatStepIndex = (slug: string): number => {
  const beat = WALKTHROUGH_BEATS.find((b) => b.slug === slug);
  if (beat === undefined) throw new Error(`no walkthrough beat with slug "${slug}"`);
  return stepIndexForPosition(beat.position);
};

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

    // Scrub to the `classification` anchor's step.
    fireEvent.change(screen.getByTestId('walkthrough-scrubber'), {
      target: { value: String(beatStepIndex('classification')) },
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

    // Scrub one step below the first anchor's step: no active beat.
    fireEvent.change(screen.getByTestId('walkthrough-scrubber'), {
      target: { value: String(beatStepIndex('opening') - 1) },
    });
    await waitFor(() => {
      expect(caption.getAttribute('data-beat')).toBe('');
    });
    expect(screen.queryByText('One shared graph')).toBeNull();
  });
});
