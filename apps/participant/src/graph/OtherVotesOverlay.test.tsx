// Vitest cases for `<OtherVotesOverlay>`.
//
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md
//              (Decision §6 — rAF-batched re-renders subscribed to a
//              small Cytoscape event set; the polyfill in
//              `cytoscapeTestEnv` backs the rAF flow under happy-dom.
//              Decision §3 — node placement is below-center
//              (`renderedBoundingBox().y2 + 4px`); edge placement is
//              `midpoint()` transformed via `pan + zoom`. Decision §4 —
//              per-arm color dot only.)
// ADRs:        0022 (no throwaway verifications — each case below
//              pins a load-bearing observable behaviour). 0004
//              (Cytoscape vocabulary — `cy.on('render pan zoom resize',
//              cb)` + `cy.on('position', 'node', cb)` + `cy.on('add
//              remove data', cb)`).
//
// The tests mount the overlay against a Cytoscape `Core` instance
// created by the test itself (no full `<GraphView>` mount) so each
// case can seed precisely the cy state it needs. The `cy` instance
// is the canonical seam; the overlay reads `ele.data('otherVotes')`
// and per-element `renderedPosition`/`renderedBoundingBox`/`midpoint`
// straight off it. happy-dom plus the `cytoscapeTestEnv` 2D-canvas +
// ResizeObserver + rAF stubs provide the runtime; the rAF polyfill
// runs the scheduled callback via `queueMicrotask`, so flushing is a
// single `await Promise.resolve()` (the microtask queue drains
// before the next macrotask).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';

import { OtherVotesOverlay } from './OtherVotesOverlay';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';
import type { OtherVote } from './otherVotes';

const NODE_A = '00000000-0000-4000-8000-00000000aa01';
const NODE_B = '00000000-0000-4000-8000-00000000aa02';
const EDGE_AB = '00000000-0000-4000-8000-00000000aa03';
const VOTER_X = '00000000-0000-4000-8000-00000000bb01';
const VOTER_Y = '00000000-0000-4000-8000-00000000bb02';
const VOTER_Z = '00000000-0000-4000-8000-00000000bb03';

let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(() => {
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

afterEach(() => {
  cleanup();
});

/**
 * Flush the rAF microtask + any React state update it triggers. The
 * happy-dom rAF polyfill (in `cytoscapeTestEnv`) schedules via
 * `queueMicrotask`; one `Promise.resolve()` await drains the microtask
 * queue. React's state updates from inside the rAF callback are
 * batched; wrapping the flush in `act()` ensures the resulting
 * re-render is observable.
 */
async function flushRaf(): Promise<void> {
  await act(async () => {
    // Two microtask drains: one to run the rAF callback, one to let
    // React commit the setState scheduled by the callback.
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Wrapper that creates a Cytoscape instance on mount and renders the
 * overlay against it. Exposes the `cy` handle via a ref so the test
 * can drive it from outside.
 */
function OverlayHarness({ onReady }: { onReady: (cy: Core) => void }): ReactElement {
  const containerRef = createRef<HTMLDivElement>();
  const [cy, setCy] = useState<Core | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // Pin viewport size to a known non-zero rectangle so the cy
    // measurements have a stable baseline.
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'offsetHeight', { value: 600, configurable: true });
    const instance = cytoscape({
      container,
      elements: [],
      layout: { name: 'preset' },
      // Disable Cytoscape's own RAF render scheduling so headless
      // emit/render dispatch doesn't double-fire.
      headless: false,
    });
    setCy(instance);
    onReady(instance);
    return () => {
      instance.destroy();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: 800, height: 600 }}>
      <div ref={containerRef} style={{ width: 800, height: 600 }} data-testid="cy-mount" />
      <OtherVotesOverlay cy={cy} containerRef={containerRef} />
    </div>
  );
}

function renderOverlayWithCy(): Promise<{ cy: Core; unmount: () => void }> {
  return new Promise((resolve) => {
    let captured: Core | null = null;
    const utils = render(
      <OverlayHarness
        onReady={(cy) => {
          captured = cy;
        }}
      />,
    );
    // Wait one microtask so the `useEffect` runs + the cy instance
    // lands. React's testing-library `render` is synchronous; the
    // mount effect runs in a microtask after the commit.
    queueMicrotask(() => {
      if (captured === null) {
        throw new Error('cy instance not captured');
      }
      resolve({ cy: captured, unmount: utils.unmount });
    });
  });
}

/**
 * Add a node to the cy instance with a fixed `renderedBoundingBox`
 * stub via `data-otherVotes` and a model `position` so the rendered
 * box centres around the predictable spot. We stub the
 * `renderedBoundingBox` per-element via `Object.defineProperty` since
 * Cytoscape's actual paint loop is suppressed in happy-dom (no real
 * canvas).
 */
function addNodeWithVotes(
  cy: Core,
  id: string,
  votes: readonly OtherVote[],
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id, otherVotes: votes },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  // Stub renderedBoundingBox on the singular collection. The overlay
  // calls `ele.renderedBoundingBox()` with no arg; return the fixed
  // box.
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

function addEdgeWithVotes(
  cy: Core,
  id: string,
  sourceId: string,
  targetId: string,
  votes: readonly OtherVote[],
  modelMid: { x: number; y: number },
): void {
  cy.add({
    group: 'edges',
    data: { id, source: sourceId, target: targetId, otherVotes: votes },
  });
  const edge = cy.getElementById(id);
  (edge as unknown as { midpoint: () => typeof modelMid }).midpoint = () => modelMid;
}

describe('OtherVotesOverlay', () => {
  it('(a) renders an empty overlay wrapper when cy === null', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={containerRef} />
        <OtherVotesOverlay cy={null} containerRef={containerRef} />
      </div>,
    );
    const overlay = document.querySelector('[data-testid="participant-other-votes-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelectorAll('[data-canvas-vote-dots]').length).toBe(0);
  });

  it('(b) renders an empty overlay wrapper when no element has non-empty otherVotes', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithVotes(cy, NODE_A, [], { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const overlay = document.querySelector('[data-testid="participant-other-votes-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.querySelectorAll('[data-canvas-vote-dots]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(c) renders one <div data-canvas-vote-dots> per node with non-empty otherVotes', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithVotes(cy, NODE_A, [{ participantId: VOTER_X, choice: 'agree' }], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithVotes(cy, NODE_B, [], { x1: 300, x2: 400, y1: 50, y2: 130 });
      await flushRaf();
      const containers = document.querySelectorAll('[data-canvas-vote-dots]');
      expect(containers.length).toBe(1);
      expect(containers[0]?.getAttribute('data-element-id')).toBe(NODE_A);
    } finally {
      unmount();
    }
  });

  it('(d) renders one <div data-canvas-vote-dots> per edge with non-empty otherVotes', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithVotes(cy, NODE_A, [], { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithVotes(cy, NODE_B, [], { x1: 300, x2: 400, y1: 50, y2: 130 });
      addEdgeWithVotes(
        cy,
        EDGE_AB,
        NODE_A,
        NODE_B,
        [{ participantId: VOTER_X, choice: 'dispute' }],
        { x: 250, y: 90 },
      );
      await flushRaf();
      const containers = document.querySelectorAll('[data-canvas-vote-dots]');
      expect(containers.length).toBe(1);
      expect(containers[0]?.getAttribute('data-element-id')).toBe(EDGE_AB);
    } finally {
      unmount();
    }
  });

  it('(e) each per-element container holds one <span data-canvas-vote-dot> per voter with the right per-voter attrs in first-vote-arrival order', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithVotes(
        cy,
        NODE_A,
        [
          { participantId: VOTER_X, choice: 'agree' },
          { participantId: VOTER_Y, choice: 'dispute' },
          { participantId: VOTER_Z, choice: 'agree' },
        ],
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const container = document.querySelector(
        `[data-canvas-vote-dots][data-element-id="${NODE_A}"]`,
      );
      expect(container).not.toBeNull();
      const dots = container?.querySelectorAll('[data-canvas-vote-dot]');
      expect(dots?.length).toBe(3);
      expect(dots?.[0]?.getAttribute('data-voter-id')).toBe(VOTER_X);
      expect(dots?.[0]?.getAttribute('data-vote')).toBe('agree');
      expect(dots?.[1]?.getAttribute('data-voter-id')).toBe(VOTER_Y);
      expect(dots?.[1]?.getAttribute('data-vote')).toBe('dispute');
      expect(dots?.[2]?.getAttribute('data-voter-id')).toBe(VOTER_Z);
      expect(dots?.[2]?.getAttribute('data-vote')).toBe('agree');
    } finally {
      unmount();
    }
  });

  it('(f) the overlay root carries pointer-events: none + absolute inset-0', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={containerRef} />
        <OtherVotesOverlay cy={null} containerRef={containerRef} />
      </div>,
    );
    const overlay = document.querySelector('[data-testid="participant-other-votes-overlay"]');
    expect(overlay).not.toBeNull();
    // Class-based assertion: the className carries `pointer-events-none`
    // (Tailwind) and `absolute inset-0` for the positioning posture.
    const className = overlay?.getAttribute('class') ?? '';
    expect(className).toContain('pointer-events-none');
    expect(className).toContain('absolute');
    expect(className).toContain('inset-0');
  });

  it('(g) multiple Cytoscape events within one frame produce ONE rAF-scheduled commit, not one per event', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithVotes(cy, NODE_A, [{ participantId: VOTER_X, choice: 'agree' }], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      // Drain the initial paint so the commit count starts fresh.
      await flushRaf();
      // Spy on `requestAnimationFrame` to count how many frames are
      // scheduled within a burst.
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
      // Emit five Cytoscape events in a single synchronous burst — the
      // overlay's singleton-handle guard MUST drop four of them so only
      // one rAF is scheduled.
      cy.emit('pan');
      cy.emit('zoom');
      cy.emit('render');
      cy.emit('pan');
      cy.emit('zoom');
      expect(rafSpy).toHaveBeenCalledTimes(1);
      rafSpy.mockRestore();
      await flushRaf();
    } finally {
      unmount();
    }
  });

  it('(h) cleanup detaches the cy event listeners on unmount', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    const offSpy = vi.spyOn(cy, 'off');
    unmount();
    // The overlay's cleanup makes three `cy.off(...)` invocations —
    // one per matching `cy.on(...)` from the mount effect:
    //   - `off('render pan zoom resize', scheduleUpdate)`
    //   - `off('position', 'node', scheduleUpdate)`
    //   - `off('add remove data', scheduleUpdate)`
    // Cytoscape itself may make additional internal `off` calls
    // during `cy.destroy()` (which the harness's own unmount triggers);
    // those are not in scope for this assertion. The contract being
    // pinned is "every overlay-registered listener is detached" —
    // checked by matching the three overlay invocations against the
    // call args.
    const overlayOffCalls = offSpy.mock.calls.filter((call) => {
      const events = call[0];
      if (typeof events !== 'string') return false;
      return (
        events === 'render pan zoom resize' || events === 'position' || events === 'add remove data'
      );
    });
    expect(overlayOffCalls.length).toBe(3);
  });

  it('(i) per-element data-element-id matches the Cytoscape id (the join key for the future entity-detail-panel)', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithVotes(cy, NODE_A, [{ participantId: VOTER_X, choice: 'agree' }], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithVotes(cy, NODE_B, [{ participantId: VOTER_Y, choice: 'dispute' }], {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      await flushRaf();
      const containers = Array.from(document.querySelectorAll('[data-canvas-vote-dots]'));
      const ids = containers.map((c) => c.getAttribute('data-element-id')).sort();
      expect(ids).toEqual([NODE_A, NODE_B].sort());
    } finally {
      unmount();
    }
  });
});
