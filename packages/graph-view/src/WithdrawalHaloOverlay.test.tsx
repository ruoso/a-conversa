// Vitest cases for `<AudienceWithdrawalHaloOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_withdrawal_animation.md
//              (Acceptance — ~10 cases pinning: (a) initial-mount
//              disputed nodes do NOT carry the animation class;
//              (b) post-mount transition to `'disputed'` DOES animate;
//              (c) initially-disputed sibling stays unanimated;
//              (d) rerender with identical statuses does not re-add
//              the class; (e–j) one assertion per non-disputed
//              `rollupStatus` value confirming no halo is emitted;
//              (k) halo `<span>` always carries `data-withdrawal-anim`
//              presence marker for testid stability.)
// ADRs:        0022 (no throwaway verifications). 0004 (Cytoscape
//              vocabulary — `cy.on('render pan zoom resize', cb)` +
//              `cy.on('position', 'node', cb)` + `cy.on('add remove
//              data', cb)`).
//
// Mirrors `NodeAppearOverlay.test.tsx` shape — install the shared
// Cytoscape test env, mount the overlay against a self-created cy
// instance, seed precisely the cy state the case needs, assert on the
// rendered DOM. The placement filter (currently-`'disputed'`-rollup
// only) is the structural difference from the sibling halo overlay.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { AudienceWithdrawalHaloOverlay } from './WithdrawalHaloOverlay';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const NODE_A = '00000000-0000-4000-8000-00000000ee01';
const NODE_B = '00000000-0000-4000-8000-00000000ee02';

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
      <AudienceWithdrawalHaloOverlay cy={cy} containerRef={containerRef} />
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
  rollupStatus: string,
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id, rollupStatus },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

const NON_DISPUTED_STATUSES = [
  'agreed',
  'proposed',
  'meta-disagreement',
  'committed',
  'withdrawn',
  'awaiting-proposal',
] as const;

describe('AudienceWithdrawalHaloOverlay', () => {
  it('(a) initial-mount disputed nodes do NOT carry the aud-withdrawal class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, 'disputed', { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, 'disputed', { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-withdrawal-anim]');
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-withdrawal')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(b) a post-mount transition to "disputed" DOES animate the freshly-disputed node', async () => {
    // Mirrors the `aud_proposed_to_agreed_animation` test (l) pattern.
    // The gate's lazy-init seeds on the first non-empty placement
    // commit, so the test pre-seeds NODE_B as already-disputed at
    // audience-join (absorbed into the seed set), then transitions
    // NODE_A from `'agreed'` → `'disputed'`. NODE_A's key is not in
    // the seed set, so the predicate returns true and the halo class
    // lands on the freshly-disputed node. This is the central
    // behavioural seam of `useSeenKeysGate` consumed at target-status-
    // keyed shape per Decision §4.
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, 'agreed', { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, 'disputed', { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      // First non-empty commit: only NODE_B is disputed. The gate
      // seeds with {NODE_B}.
      expect(document.querySelectorAll('[data-withdrawal-anim]').length).toBe(1);
      act(() => {
        cy.getElementById(NODE_A).data('rollupStatus', 'disputed');
      });
      await flushRaf();
      const wrapper = document.querySelector(`[data-withdrawal-anim][data-element-id="${NODE_A}"]`);
      expect(wrapper).not.toBeNull();
      expect(wrapper?.classList.contains('aud-withdrawal')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(c) an initially-disputed sibling stays unanimated when a peer flips to disputed', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, 'disputed', { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, 'agreed', { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      // NODE_A is the seed-entry: present in the first non-empty
      // placement commit. NODE_B is not disputed yet so it contributes
      // no placement.
      expect(document.querySelectorAll('[data-withdrawal-anim]').length).toBe(1);
      act(() => {
        cy.getElementById(NODE_B).data('rollupStatus', 'disputed');
      });
      await flushRaf();
      const aWrapper = document.querySelector(
        `[data-withdrawal-anim][data-element-id="${NODE_A}"]`,
      );
      const bWrapper = document.querySelector(
        `[data-withdrawal-anim][data-element-id="${NODE_B}"]`,
      );
      expect(aWrapper?.classList.contains('aud-withdrawal')).toBe(false);
      expect(bWrapper?.classList.contains('aud-withdrawal')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(d) rerender with identical statuses (pan/zoom) does not re-add the class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, 'disputed', { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, 'disputed', { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      cy.emit('pan');
      cy.emit('zoom');
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-withdrawal-anim]');
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-withdrawal')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  for (const status of NON_DISPUTED_STATUSES) {
    it(`(${status}) a node with rollupStatus "${status}" never emits a halo placement`, async () => {
      const { cy, unmount } = await renderOverlayWithCy();
      try {
        addNodeWithBox(cy, NODE_A, status, { x1: 100, x2: 200, y1: 50, y2: 130 });
        await flushRaf();
        // commitWithdrawalPlacements early-returns for non-disputed
        // nodes, so no halo `<span>` is emitted at all.
        expect(document.querySelectorAll('[data-withdrawal-anim]').length).toBe(0);
        // Flipping to a different non-disputed status also emits nothing.
        const other = status === 'agreed' ? 'proposed' : 'agreed';
        act(() => {
          cy.getElementById(NODE_A).data('rollupStatus', other);
        });
        await flushRaf();
        expect(document.querySelectorAll('[data-withdrawal-anim]').length).toBe(0);
      } finally {
        unmount();
      }
    });
  }

  it('(k) the halo wrapper always carries the data-withdrawal-anim presence marker', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, 'disputed', { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const wrapper = document.querySelector('[data-withdrawal-anim]');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute('data-element-id')).toBe(NODE_A);
    } finally {
      unmount();
    }
  });

  it('(l) the overlay test seam carries aria-hidden="true"', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, 'disputed', { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-withdrawal-halo-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    } finally {
      unmount();
    }
  });
});
