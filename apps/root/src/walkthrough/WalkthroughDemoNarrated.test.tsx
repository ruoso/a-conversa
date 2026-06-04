// Component suite for the narrated wrapper's small-viewport variant gate
// (ADR 0022 — durable, committed test artifact). Pins acceptance criterion
// 4 of `landing_demo_mobile_fallback`: the `matchMedia` gate (Decision §D5)
// mounts **exactly one** of the full or compact demo —
//   - at a small viewport: the compact variant (segment buttons present,
//     the scrubber + play-toggle absent), and
//   - at a large viewport: the full interactive demo (scrubber present),
// with exactly one `GraphView`/`audience-graph-root` ever mounted (no
// double Cytoscape instantiation — constraint 1).
//
// Refinement: tasks/refinements/landing_page/landing_demo_mobile_fallback.md

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '@a-conversa/graph-view/test-utils';

import { WalkthroughDemoNarrated } from './WalkthroughDemoNarrated';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

/**
 * Mock `window.matchMedia` so the wrapper's small-viewport gate resolves to
 * `small`, while every other query (e.g. the variants' reduced-motion gate)
 * resolves to `false`. happy-dom does not implement `matchMedia`; the gate
 * reads it both at mount and via a `change` listener, so the stub returns a
 * per-query static `matches` plus no-op add/removeEventListener.
 */
function mockViewport(isSmall: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width') ? isSmall : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

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

describe('WalkthroughDemoNarrated variant gate', () => {
  it('mounts the compact variant at a small viewport (no scrubber, one renderer)', async () => {
    mockViewport(true);
    renderWithProviders(<WalkthroughDemoNarrated />);

    await waitFor(() => {
      expect(screen.getByTestId('walkthrough-demo-compact')).toBeTruthy();
    });

    // The full interactive demo and its continuous-motion controls are absent.
    expect(screen.queryByTestId('walkthrough-demo')).toBeNull();
    expect(screen.queryByTestId('walkthrough-scrubber')).toBeNull();
    expect(screen.queryByTestId('walkthrough-play-toggle')).toBeNull();

    // The coarse controls are present...
    expect(screen.getByTestId('walkthrough-prev')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-next')).toBeTruthy();

    // ...and exactly one Cytoscape core is instantiated (constraint 1).
    expect(screen.getAllByTestId('audience-graph-root')).toHaveLength(1);

    // The caption still renders on small screens (constraint 6).
    expect(screen.getByTestId('walkthrough-caption')).toBeTruthy();
  });

  it('mounts the full interactive demo at a large viewport (scrubber present, one renderer)', async () => {
    mockViewport(false);
    renderWithProviders(<WalkthroughDemoNarrated />);

    await waitFor(() => {
      expect(screen.getByTestId('walkthrough-demo')).toBeTruthy();
    });

    // The full demo's continuous-motion controls are present.
    expect(screen.getByTestId('walkthrough-scrubber')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-play-toggle')).toBeTruthy();

    // The compact variant is absent, and exactly one Cytoscape core is
    // instantiated (constraint 1 — no double instantiation).
    expect(screen.queryByTestId('walkthrough-demo-compact')).toBeNull();
    expect(screen.getAllByTestId('audience-graph-root')).toHaveLength(1);
  });
});
