// Vitest cases for `<AudiencePerFacetPillOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_per_facet_visualization.md
//              (Decision §4 — rAF-batched re-renders subscribed to a
//              small Cytoscape event set; the polyfill in
//              `cytoscapeTestEnv` backs the rAF flow under happy-dom.
//              Decision §2 — node anchor is above-center
//              (`renderedBoundingBox().y1 - PILL_ROW_OFFSET_Y`).
//              Decision §3 — canonical reading order
//              `wording → classification → substance`; pills emit only
//              for facets present in `data.facetStatuses`.)
// ADRs:        0022 (no throwaway verifications — each case below
//              pins a load-bearing observable behaviour). 0004
//              (Cytoscape vocabulary — `cy.on('render pan zoom resize',
//              cb)` + `cy.on('position', 'node', cb)` + `cy.on('add
//              remove data', cb)`).
//
// Mirrors the participant's `OtherVotesOverlay.test.tsx` shape: mount
// the overlay against a Cytoscape `Core` instance created by the test
// itself (no full `<AudienceGraphView>` mount), seed precisely the cy
// state the case needs, and assert on the rendered DOM.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';

import {
  I18nProvider,
  createI18nInstance,
  type FacetName,
  type FacetStatus,
  type I18nInstance,
} from '@a-conversa/shell';

import { AudiencePerFacetPillOverlay } from './PerFacetPillOverlay';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const NODE_A = '00000000-0000-4000-8000-00000000cc01';
const NODE_B = '00000000-0000-4000-8000-00000000cc02';
const EDGE_AB = '00000000-0000-4000-8000-00000000cc03';

let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;
let i18nInstance: I18nInstance;

beforeAll(async () => {
  cytoscapeEnvHandle = installCytoscapeTestEnv();
  i18nInstance = await createI18nInstance('en-US');
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
 * `queueMicrotask`; two `Promise.resolve()` awaits drain the rAF
 * callback and the React state commit it schedules.
 */
async function flushRaf(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Wrapper that creates a Cytoscape instance on mount and renders the
 * overlay against it. Mirrors the participant's `OverlayHarness`.
 */
function OverlayHarness({ onReady }: { onReady: (cy: Core) => void }): ReactElement {
  const containerRef = createRef<HTMLDivElement>();
  const [cy, setCy] = useState<Core | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'offsetHeight', { value: 600, configurable: true });
    const instance = cytoscape({
      container,
      elements: [],
      layout: { name: 'preset' },
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
      <AudiencePerFacetPillOverlay cy={cy} containerRef={containerRef} />
    </div>
  );
}

function renderOverlayWithCy(): Promise<{ cy: Core; unmount: () => void }> {
  return new Promise((resolve) => {
    let captured: Core | null = null;
    const utils = render(
      <I18nProvider i18n={i18nInstance}>
        <OverlayHarness
          onReady={(cy) => {
            captured = cy;
          }}
        />
      </I18nProvider>,
    );
    queueMicrotask(() => {
      if (captured === null) {
        throw new Error('cy instance not captured');
      }
      resolve({ cy: captured, unmount: utils.unmount });
    });
  });
}

function addNodeWithFacetStatuses(
  cy: Core,
  id: string,
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id, facetStatuses },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

function addEdgeWithFacetStatuses(
  cy: Core,
  id: string,
  sourceId: string,
  targetId: string,
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): void {
  cy.add({
    group: 'edges',
    data: { id, source: sourceId, target: targetId, facetStatuses },
  });
}

describe('AudiencePerFacetPillOverlay', () => {
  it('(a) renders an empty overlay wrapper when cy === null', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(
      <I18nProvider i18n={i18nInstance}>
        <div>
          <div ref={containerRef} />
          <AudiencePerFacetPillOverlay cy={null} containerRef={containerRef} />
        </div>
      </I18nProvider>,
    );
    const overlay = document.querySelector('[data-testid="audience-per-facet-pill-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelectorAll('[data-facet-pill-row]').length).toBe(0);
  });

  it('(b) renders an empty overlay wrapper when the cy instance has zero elements', async () => {
    const { unmount } = await renderOverlayWithCy();
    try {
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-per-facet-pill-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.querySelectorAll('[data-facet-pill-row]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(c) omits the pill row for a node whose facetStatuses record is empty', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(cy, NODE_A, {}, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const rows = document.querySelectorAll(`[data-facet-pill-row][data-element-id="${NODE_A}"]`);
      expect(rows.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(d) renders exactly one pill (wording=proposed) for a node carrying just { wording: "proposed" }', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-facet-pill-row][data-element-id="${NODE_A}"]`);
      expect(row).not.toBeNull();
      const pills = row?.querySelectorAll('[data-facet-pill]');
      expect(pills?.length).toBe(1);
      expect(pills?.[0]?.getAttribute('data-facet-name')).toBe('wording');
      expect(pills?.[0]?.getAttribute('data-facet-status')).toBe('proposed');
    } finally {
      unmount();
    }
  });

  it('(e) renders three pills in canonical wording→classification→substance order with matching per-facet statuses', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'agreed', classification: 'disputed', substance: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-facet-pill-row][data-element-id="${NODE_A}"]`);
      expect(row).not.toBeNull();
      const pills = row?.querySelectorAll('[data-facet-pill]');
      expect(pills?.length).toBe(3);
      expect(pills?.[0]?.getAttribute('data-facet-name')).toBe('wording');
      expect(pills?.[0]?.getAttribute('data-facet-status')).toBe('agreed');
      expect(pills?.[1]?.getAttribute('data-facet-name')).toBe('classification');
      expect(pills?.[1]?.getAttribute('data-facet-status')).toBe('disputed');
      expect(pills?.[2]?.getAttribute('data-facet-name')).toBe('substance');
      expect(pills?.[2]?.getAttribute('data-facet-status')).toBe('proposed');
    } finally {
      unmount();
    }
  });

  it('(f) renders one row per node when two nodes carry non-empty facetStatuses, with distinct positions', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      addNodeWithFacetStatuses(
        cy,
        NODE_B,
        { wording: 'agreed' },
        { x1: 300, x2: 400, y1: 200, y2: 280 },
      );
      await flushRaf();
      const rows = Array.from(document.querySelectorAll('[data-facet-pill-row]'));
      expect(rows.length).toBe(2);
      const ids = rows.map((r) => r.getAttribute('data-element-id')).sort();
      expect(ids).toEqual([NODE_A, NODE_B].sort());
      const rowA = rows.find((r) => r.getAttribute('data-element-id') === NODE_A) as
        | HTMLElement
        | undefined;
      const rowB = rows.find((r) => r.getAttribute('data-element-id') === NODE_B) as
        | HTMLElement
        | undefined;
      expect(rowA?.style.left).not.toBe(rowB?.style.left);
      expect(rowA?.style.top).not.toBe(rowB?.style.top);
    } finally {
      unmount();
    }
  });

  it('(g) does NOT render a pill row for an edge whose facetStatuses record is non-empty (nodes-only iteration)', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(cy, NODE_A, {}, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithFacetStatuses(cy, NODE_B, {}, { x1: 300, x2: 400, y1: 50, y2: 130 });
      addEdgeWithFacetStatuses(cy, EDGE_AB, NODE_A, NODE_B, { substance: 'proposed' });
      await flushRaf();
      const rows = document.querySelectorAll(`[data-facet-pill-row][data-element-id="${EDGE_AB}"]`);
      expect(rows.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(h) multiple Cytoscape events within one frame produce ONE rAF-scheduled commit', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
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

  it('(i) cleanup detaches the cy event listeners on unmount', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    const offSpy = vi.spyOn(cy, 'off');
    unmount();
    const overlayOffCalls = offSpy.mock.calls.filter((call) => {
      const events = call[0];
      if (typeof events !== 'string') return false;
      return (
        events === 'render pan zoom resize' || events === 'position' || events === 'add remove data'
      );
    });
    expect(overlayOffCalls.length).toBe(3);
  });

  // Per tasks/refinements/audience/aud_proposed_to_agreed_animation.md
  // Decision §6 — Vitest pins the per-render class logic across the
  // eight `FacetStatus` branches. The wrapper is unconditional
  // (`[data-pill-agreed-anim]` carrier per Decision §2); only the
  // `aud-pill-agreed` class is conditional.

  it('(k) initial-mount `agreed` pills do NOT carry the aud-pill-agreed class (lazy-seed via useSeenKeysGate)', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'agreed', classification: 'agreed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      addNodeWithFacetStatuses(
        cy,
        NODE_B,
        { wording: 'agreed' },
        { x1: 300, x2: 400, y1: 200, y2: 280 },
      );
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-pill-agreed-anim]');
      expect(wrappers.length).toBe(3);
      for (const wrapper of Array.from(wrappers)) {
        expect(wrapper.classList.contains('aud-pill-agreed')).toBe(false);
      }
    } finally {
      unmount();
    }
  });

  it('(l) a freshly-transitioned `proposed`→`agreed` pill DOES carry the aud-pill-agreed class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      // Mount with NODE_B already-agreed (so the gate's lazy-seed
      // fires on the first non-empty agreed-keys commit, absorbing
      // NODE_B's pre-existing agreement). Then transition NODE_A's
      // wording from proposed→agreed; the new key is not in the seed
      // set, so the predicate returns true and the wrapper class
      // lands on the freshly-agreed pill.
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      addNodeWithFacetStatuses(
        cy,
        NODE_B,
        { wording: 'agreed' },
        { x1: 300, x2: 400, y1: 200, y2: 280 },
      );
      await flushRaf();
      act(() => {
        cy.getElementById(NODE_A).data('facetStatuses', { wording: 'agreed' });
      });
      await flushRaf();
      const wrapper = document.querySelector(
        `[data-pill-agreed-anim][data-element-id="${NODE_A}"][data-facet-name="wording"]`,
      );
      expect(wrapper).not.toBeNull();
      expect(wrapper?.classList.contains('aud-pill-agreed')).toBe(true);
      // The pre-existing NODE_B agreed pill stays unanimated.
      const preexistingWrapper = document.querySelector(
        `[data-pill-agreed-anim][data-element-id="${NODE_B}"][data-facet-name="wording"]`,
      );
      expect(preexistingWrapper?.classList.contains('aud-pill-agreed')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('(m) prior-agreed sibling stays unanimated when a different facet transitions to agreed', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { classification: 'agreed', wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      act(() => {
        cy.getElementById(NODE_A).data('facetStatuses', {
          classification: 'agreed',
          wording: 'agreed',
        });
      });
      await flushRaf();
      const classificationWrapper = document.querySelector(
        `[data-pill-agreed-anim][data-element-id="${NODE_A}"][data-facet-name="classification"]`,
      );
      const wordingWrapper = document.querySelector(
        `[data-pill-agreed-anim][data-element-id="${NODE_A}"][data-facet-name="wording"]`,
      );
      expect(classificationWrapper?.classList.contains('aud-pill-agreed')).toBe(false);
      expect(wordingWrapper?.classList.contains('aud-pill-agreed')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(n) rerender with identical statuses (pan/zoom) does not re-add the class to any wrapper', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      // Same pre-seed shape as test (l): NODE_B already-agreed at
      // mount so the gate seeds before the NODE_A transition fires.
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      addNodeWithFacetStatuses(
        cy,
        NODE_B,
        { wording: 'agreed' },
        { x1: 300, x2: 400, y1: 200, y2: 280 },
      );
      await flushRaf();
      act(() => {
        cy.getElementById(NODE_A).data('facetStatuses', { wording: 'agreed' });
      });
      await flushRaf();
      const wrapperAfterTransition = document.querySelector(
        `[data-pill-agreed-anim][data-element-id="${NODE_A}"][data-facet-name="wording"]`,
      );
      expect(wrapperAfterTransition?.classList.contains('aud-pill-agreed')).toBe(true);
      // Simulate pan (re-snapshot identical placements) — the gate's
      // seen-set has already absorbed NODE_A:wording, so the predicate
      // now returns false and the class is dropped on the next render.
      act(() => {
        cy.emit('pan');
      });
      await flushRaf();
      const wrapperAfterPan = document.querySelector(
        `[data-pill-agreed-anim][data-element-id="${NODE_A}"][data-facet-name="wording"]`,
      );
      expect(wrapperAfterPan).not.toBeNull();
      expect(wrapperAfterPan?.classList.contains('aud-pill-agreed')).toBe(false);
      // And no other wrapper picks up the class either.
      const allWrappers = document.querySelectorAll('[data-pill-agreed-anim]');
      for (const wrapper of Array.from(allWrappers)) {
        expect(wrapper.classList.contains('aud-pill-agreed')).toBe(false);
      }
    } finally {
      unmount();
    }
  });

  it('(o) non-`agreed` statuses never get the aud-pill-agreed class', async () => {
    const nonAgreedStatuses: FacetStatus[] = [
      'proposed',
      'disputed',
      'committed',
      'withdrawn',
      'meta-disagreement',
      'awaiting-proposal',
    ];
    for (const status of nonAgreedStatuses) {
      const { cy, unmount } = await renderOverlayWithCy();
      try {
        addNodeWithFacetStatuses(
          cy,
          NODE_A,
          { wording: 'proposed' },
          { x1: 100, x2: 200, y1: 50, y2: 130 },
        );
        await flushRaf();
        act(() => {
          cy.getElementById(NODE_A).data('facetStatuses', { wording: status });
        });
        await flushRaf();
        const wrapper = document.querySelector(
          `[data-pill-agreed-anim][data-element-id="${NODE_A}"][data-facet-name="wording"]`,
        );
        expect(wrapper, `status ${status}`).not.toBeNull();
        expect(wrapper?.classList.contains('aud-pill-agreed'), `status ${status}`).toBe(false);
      } finally {
        unmount();
      }
    }
  });

  it('(p) every rendered pill sits inside a [data-pill-agreed-anim] wrapper regardless of status', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed', classification: 'agreed', substance: 'disputed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const pills = document.querySelectorAll(
        `[data-facet-pill-row][data-element-id="${NODE_A}"] [data-facet-pill]`,
      );
      expect(pills.length).toBe(3);
      for (const pill of Array.from(pills)) {
        expect(pill.closest('[data-pill-agreed-anim]')).not.toBeNull();
      }
    } finally {
      unmount();
    }
  });

  it('(j) the wording pill renders the localized en-US label "Wording"', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithFacetStatuses(
        cy,
        NODE_A,
        { wording: 'proposed' },
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const pill = document.querySelector(
        `[data-facet-pill-row][data-element-id="${NODE_A}"] [data-facet-pill][data-facet-name="wording"]`,
      );
      expect(pill).not.toBeNull();
      // The catalog uses title-cased "Wording" — match case-insensitively
      // against the localized label (the catalog string is the source of
      // truth; this assertion confirms the i18n bootstrap is wired
      // through `<FacetPill>`).
      expect(pill?.textContent?.toLowerCase()).toContain('wording');
    } finally {
      unmount();
    }
  });
});
