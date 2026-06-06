// Vitest cases for `<AudienceNodeAppearOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_node_appear_animation.md
//              (Acceptance — 7 cases pinning: (a) test seam present;
//              (b) one halo per cy.nodes() entry; (c) initial-mount
//              halos carry no class; (d) post-mount arrival gains the
//              class; (e) prior siblings stay unanimated;
//              (f) rerender with identical set does not re-add the
//              class; (g) wrapper position centers on
//              renderedBoundingBox midpoint.)
// ADRs:        0022 (no throwaway verifications). 0004 (Cytoscape
//              vocabulary — `cy.on('render pan zoom resize', cb)` +
//              `cy.on('position', 'node', cb)` + `cy.on('add remove
//              data', cb)`).
//
// Mirrors `AxiomMarkOverlay.test.tsx` shape — install the shared
// Cytoscape test env, mount the overlay against a self-created cy
// instance, seed precisely the cy state the case needs, assert on the
// rendered DOM. No i18n is strictly needed (the halo renders no text),
// but the harness keeps `I18nProvider` mounting for shape parity with
// the sibling overlay tests.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { AudienceNodeAppearOverlay } from './NodeAppearOverlay';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const NODE_A = '00000000-0000-4000-8000-00000000dd01';
const NODE_B = '00000000-0000-4000-8000-00000000dd02';

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
      <AudienceNodeAppearOverlay cy={cy} containerRef={containerRef} />
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
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

describe('AudienceNodeAppearOverlay', () => {
  it('(a) renders the overlay test seam with aria-hidden="true"', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-node-appear-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('(b) renders one [data-node-appear-anim] wrapper per cy.nodes() entry', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const wrappers = Array.from(document.querySelectorAll('[data-node-appear-anim]'));
      expect(wrappers.length).toBe(2);
      const ids = wrappers.map((w) => w.getAttribute('data-element-id')).sort();
      expect(ids).toEqual([NODE_A, NODE_B].sort());
    } finally {
      unmount();
    }
  });

  it('(c) initial-mount halos do NOT carry the aud-node-appear class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-node-appear-anim]');
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-node-appear')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(d) a post-mount arriving node gains the aud-node-appear class on its halo', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      // A second node arrives mid-session — cy.add fires the overlay's
      // `add remove data` listener which schedules the next commit.
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const newWrapper = document.querySelector(
        `[data-node-appear-anim][data-element-id="${NODE_B}"]`,
      );
      expect(newWrapper).not.toBeNull();
      expect(newWrapper?.classList.contains('aud-node-appear')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(e) prior-rendered halos remain unanimated when a new node arrives', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const existingWrapper = document.querySelector(
        `[data-node-appear-anim][data-element-id="${NODE_A}"]`,
      );
      expect(existingWrapper).not.toBeNull();
      expect(existingWrapper?.classList.contains('aud-node-appear')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('(f) rerender with identical node set (pan/zoom) does not re-add the class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      cy.emit('pan');
      cy.emit('zoom');
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-node-appear-anim]');
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-node-appear')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(g) wrapper position centers on the node renderedBoundingBox midpoint', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      const box = { x1: 100, x2: 200, y1: 50, y2: 130 };
      addNodeWithBox(cy, NODE_A, box);
      await flushRaf();
      const wrapper = document.querySelector<HTMLElement>(
        `[data-node-appear-anim][data-element-id="${NODE_A}"]`,
      );
      expect(wrapper).not.toBeNull();
      const expectedX = (box.x1 + box.x2) / 2;
      const expectedY = (box.y1 + box.y2) / 2;
      expect(wrapper?.style.left).toBe(`${String(expectedX)}px`);
      expect(wrapper?.style.top).toBe(`${String(expectedY)}px`);
    } finally {
      unmount();
    }
  });

  it('(h) exposes the viewport zoom as the --halo-zoom custom property so the halo box scales with the node', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      act(() => {
        cy.zoom(0.5);
      });
      await flushRaf();
      const wrapper = document.querySelector<HTMLElement>(
        `[data-node-appear-anim][data-element-id="${NODE_A}"]`,
      );
      expect(wrapper).not.toBeNull();
      // The audience stylesheet reads this as `calc(96px * var(--halo-zoom))`
      // so the 96px square tracks the (also-zoom-scaled) node instead of
      // ballooning when zoomed out.
      expect(wrapper?.style.getPropertyValue('--halo-zoom')).toBe('0.5');
    } finally {
      unmount();
    }
  });
});
