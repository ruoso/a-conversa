// Vitest cases for `<AudienceDecompositionFadeOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_decomposition_animation.md
//              (Acceptance — ~12 cases pinning: (a) initial-mount
//              decomposed parents do NOT carry the animation class;
//              (b) two initial-mount decomposed parents — neither
//              animates; (c) post-mount transition to `decomposed:
//              true` DOES animate (pre-seeded sibling pattern from
//              `WithdrawalHaloOverlay.test.tsx (b)`); (d) initially-
//              decomposed sibling stays unanimated when a peer flips;
//              (e) rerender with identical statuses (pan/zoom) does
//              not re-add the class; (f) a node without the
//              `decomposed` field emits no halo `<span>`; (g) a node
//              with `decomposed: false` emits no halo `<span>`;
//              (h) the halo `<span>` carries the
//              `data-decomposition-anim` presence marker;
//              (i) the overlay wrapper carries the expected testid +
//              aria-hidden; (j) pan/zoom does not re-fire the
//              animation; (k) a second fresh decomposition on a
//              different node animates on the same commit window;
//              (l) `cy === null` renders an empty overlay wrapper.)
// ADRs:        0022 (no throwaway verifications). 0004 (Cytoscape
//              vocabulary — `cy.on('render pan zoom resize', cb)` +
//              `cy.on('position', 'node', cb)` + `cy.on('add remove
//              data', cb)`).
//
// Mirrors `WithdrawalHaloOverlay.test.tsx` shape — install the shared
// Cytoscape test env, mount the overlay against a self-created cy
// instance, seed precisely the cy state the case needs, assert on the
// rendered DOM. The placement filter (currently-`decomposed: true`
// only) is the structural difference from the sibling withdrawal halo.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { AudienceDecompositionFadeOverlay } from './DecompositionFadeOverlay';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const NODE_A = '00000000-0000-4000-8000-00000000ff01';
const NODE_B = '00000000-0000-4000-8000-00000000ff02';
const NODE_C = '00000000-0000-4000-8000-00000000ff03';

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

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

async function flushRaf(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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
      <AudienceDecompositionFadeOverlay cy={cy} containerRef={containerRef} />
    </div>
  );
}

function NullCyHarness(): ReactElement {
  const containerRef = createRef<HTMLDivElement>();
  return (
    <div style={{ position: 'relative', width: 800, height: 600 }}>
      <div ref={containerRef} style={{ width: 800, height: 600 }} />
      <AudienceDecompositionFadeOverlay cy={null} containerRef={containerRef} />
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

function addNodeWithBox(
  cy: Core,
  id: string,
  data: Record<string, unknown>,
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id, ...data },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

describe('AudienceDecompositionFadeOverlay', () => {
  it('(a) initial-mount decomposed: true parent does NOT carry the aud-decomposition class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: true }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-decomposition-anim]');
      expect(wrappers.length).toBe(1);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-decomposition')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(b) two initial-mount decomposed: true parents — neither animates', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: true }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { decomposed: true }, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-decomposition-anim]');
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-decomposition')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(c) a post-mount transition to decomposed: true DOES animate the freshly-decomposed parent', async () => {
    // Mirrors the `WithdrawalHaloOverlay.test.tsx (b)` pattern.
    // The seed runs on the first non-empty placement commit, so the
    // test pre-seeds NODE_B as already-decomposed at audience-join
    // (absorbed into the seed set), then flips NODE_A from non-
    // decomposed to decomposed: true. NODE_A's id is not in the seed
    // set, so the predicate returns true and the halo class lands on
    // the freshly-decomposed node. This is the central behavioural
    // seam of the local-ref synchronous seed per Decision §5.
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, {}, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { decomposed: true }, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      // First non-empty commit: only NODE_B contributes a placement.
      // The seed initializes to {NODE_B}.
      expect(document.querySelectorAll('[data-decomposition-anim]').length).toBe(1);
      act(() => {
        cy.getElementById(NODE_A).data('decomposed', true);
      });
      await flushRaf();
      const wrapper = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_A}"]`,
      );
      expect(wrapper).not.toBeNull();
      expect(wrapper?.classList.contains('aud-decomposition')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(d) an initially-decomposed sibling stays unanimated when a peer flips to decomposed', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: true }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, {}, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      // NODE_A is the seed-entry; NODE_B is not decomposed yet so it
      // contributes no placement.
      expect(document.querySelectorAll('[data-decomposition-anim]').length).toBe(1);
      act(() => {
        cy.getElementById(NODE_B).data('decomposed', true);
      });
      await flushRaf();
      const aWrapper = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_A}"]`,
      );
      const bWrapper = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_B}"]`,
      );
      expect(aWrapper?.classList.contains('aud-decomposition')).toBe(false);
      expect(bWrapper?.classList.contains('aud-decomposition')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(e) rerender with identical statuses (pan/zoom) does not re-add the class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: true }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { decomposed: true }, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      cy.emit('pan');
      cy.emit('zoom');
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-decomposition-anim]');
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-decomposition')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(f) a node without the decomposed field emits no halo placement', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, {}, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      expect(document.querySelectorAll('[data-decomposition-anim]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(g) a node with decomposed: false emits no halo placement', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: false }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      expect(document.querySelectorAll('[data-decomposition-anim]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(h) a freshly-decomposed node carries the data-decomposition-anim presence marker', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: true }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const wrapper = document.querySelector('[data-decomposition-anim]');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute('data-element-id')).toBe(NODE_A);
    } finally {
      unmount();
    }
  });

  it('(i) the overlay wrapper carries the expected testid + aria-hidden="true"', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { decomposed: true }, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-decomposition-fade-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('(j) pan / zoom does not re-fire the animation on a freshly-decomposed node', async () => {
    // Pre-seed NODE_B as decomposed, then flip NODE_A so the gate is
    // established before A's fresh fire — mirrors case (c).
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, {}, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { decomposed: true }, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      act(() => {
        cy.getElementById(NODE_A).data('decomposed', true);
      });
      await flushRaf();
      // Confirm A is currently animating.
      const aWrapper = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_A}"]`,
      );
      expect(aWrapper?.classList.contains('aud-decomposition')).toBe(true);
      // Pan / zoom: the rerender re-evaluates the gate; A is in the
      // seen set now, so isNew returns false and the class drops.
      cy.emit('pan');
      cy.emit('zoom');
      await flushRaf();
      const aWrapperAfter = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_A}"]`,
      );
      expect(aWrapperAfter?.classList.contains('aud-decomposition')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('(k) two separate fresh decompositions each animate on their own commit window', async () => {
    // Pre-seed NODE_C as decomposed so the gate is initialized; then
    // flip NODE_A, then flip NODE_B. Each fresh flip animates.
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, {}, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, {}, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_C, { decomposed: true }, { x1: 500, x2: 600, y1: 400, y2: 480 });
      await flushRaf();
      // Seed = {NODE_C}.
      act(() => {
        cy.getElementById(NODE_A).data('decomposed', true);
      });
      await flushRaf();
      const aWrapper = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_A}"]`,
      );
      expect(aWrapper?.classList.contains('aud-decomposition')).toBe(true);
      act(() => {
        cy.getElementById(NODE_B).data('decomposed', true);
      });
      await flushRaf();
      const bWrapper = document.querySelector(
        `[data-decomposition-anim][data-element-id="${NODE_B}"]`,
      );
      expect(bWrapper?.classList.contains('aud-decomposition')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(l) cy === null renders the overlay wrapper with no halo placements', async () => {
    const { unmount } = render(
      <I18nProvider i18n={i18nInstance}>
        <NullCyHarness />
      </I18nProvider>,
    );
    try {
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-decomposition-fade-overlay"]');
      expect(overlay).not.toBeNull();
      expect(document.querySelectorAll('[data-decomposition-anim]').length).toBe(0);
    } finally {
      unmount();
    }
  });
});
