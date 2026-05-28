// Vitest cases for `<AudienceAxiomMarkOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//              (Constraints — 10 cases (a–j) mirroring the per-facet
//              pill overlay's case shape, with the per-element data
//              read being `data.axiomMarks` and the per-element child
//              being a flex-row of `<AudienceAxiomMarkBadge>` chips in
//              array order (commit-arrival).)
// ADRs:        0022 (no throwaway verifications). 0004 (Cytoscape
//              vocabulary — `cy.on('render pan zoom resize', cb)` +
//              `cy.on('position', 'node', cb)` + `cy.on('add remove
//              data', cb)`).
//
// Mirrors `PerFacetPillOverlay.test.tsx` shape — install the shared
// Cytoscape test env, mount the overlay against a self-created cy
// instance, seed precisely the cy state the case needs, assert on the
// rendered DOM.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';

import {
  I18nProvider,
  axiomMarkColorFor,
  createI18nInstance,
  type I18nInstance,
} from '@a-conversa/shell';

import { AudienceAxiomMarkOverlay } from './AxiomMarkOverlay';
import type { AxiomMark } from './axiomMarks';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const NODE_A = '00000000-0000-4000-8000-00000000cc01';
const NODE_B = '00000000-0000-4000-8000-00000000cc02';
const EDGE_AB = '00000000-0000-4000-8000-00000000cc03';
// PARTICIPANT_A and PARTICIPANT_B hash to two distinct palette buckets
// (sum-of-hex-digits mod 6 = 1 / 2) so the chromatic-distinctness
// assertion holds without depending on the 1-in-6 collision case.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

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
      <AudienceAxiomMarkOverlay cy={cy} containerRef={containerRef} />
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

function makeMark(nodeId: string, participantId: string): AxiomMark {
  return {
    nodeId,
    participantId,
    committedAt: '2026-05-28T00:00:00.000Z',
  };
}

function addNodeWithAxiomMarks(
  cy: Core,
  id: string,
  marks: readonly AxiomMark[],
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id, axiomMarks: marks },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

function addEdgeWithAxiomMarks(
  cy: Core,
  id: string,
  sourceId: string,
  targetId: string,
  marks: readonly AxiomMark[],
): void {
  cy.add({
    group: 'edges',
    data: { id, source: sourceId, target: targetId, axiomMarks: marks },
  });
}

describe('AudienceAxiomMarkOverlay', () => {
  it('(a) renders an empty overlay wrapper when cy === null', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(
      <I18nProvider i18n={i18nInstance}>
        <div>
          <div ref={containerRef} />
          <AudienceAxiomMarkOverlay cy={null} containerRef={containerRef} />
        </div>
      </I18nProvider>,
    );
    const overlay = document.querySelector('[data-testid="audience-axiom-mark-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelectorAll('[data-axiom-mark-row]').length).toBe(0);
  });

  it('(b) renders an empty overlay wrapper when the cy instance has zero elements', async () => {
    const { unmount } = await renderOverlayWithCy();
    try {
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-axiom-mark-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.querySelectorAll('[data-axiom-mark-row]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(c) omits the badge row for a node whose axiomMarks list is empty', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(cy, NODE_A, [], { x1: 100, x2: 200, y1: 50, y2: 130 });
      await flushRaf();
      const rows = document.querySelectorAll(`[data-axiom-mark-row][data-element-id="${NODE_A}"]`);
      expect(rows.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(d) renders exactly one badge for a node carrying one AxiomMark', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(cy, NODE_A, [makeMark(NODE_A, PARTICIPANT_A)], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      await flushRaf();
      const row = document.querySelector(`[data-axiom-mark-row][data-element-id="${NODE_A}"]`);
      expect(row).not.toBeNull();
      const badges = row?.querySelectorAll('[data-testid^="audience-axiom-mark-badge-"]');
      expect(badges?.length).toBe(1);
      expect(badges?.[0]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    } finally {
      unmount();
    }
  });

  it('(e) renders two badges in commit-arrival order with distinct per-participant chromatic classes', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(
        cy,
        NODE_A,
        [makeMark(NODE_A, PARTICIPANT_A), makeMark(NODE_A, PARTICIPANT_B)],
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-axiom-mark-row][data-element-id="${NODE_A}"]`);
      expect(row).not.toBeNull();
      const badges = row?.querySelectorAll('[data-testid^="audience-axiom-mark-badge-"]');
      expect(badges?.length).toBe(2);
      expect(badges?.[0]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
      expect(badges?.[1]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_B);
      const aColor = axiomMarkColorFor(PARTICIPANT_A);
      const bColor = axiomMarkColorFor(PARTICIPANT_B);
      expect(aColor.bg).not.toBe(bColor.bg);
      expect(badges?.[0]?.className).toContain(aColor.bg);
      expect(badges?.[1]?.className).toContain(bColor.bg);
    } finally {
      unmount();
    }
  });

  it('(f) renders one row per node when two nodes carry non-empty axiomMarks, with distinct positions', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(cy, NODE_A, [makeMark(NODE_A, PARTICIPANT_A)], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAxiomMarks(cy, NODE_B, [makeMark(NODE_B, PARTICIPANT_B)], {
        x1: 300,
        x2: 400,
        y1: 200,
        y2: 280,
      });
      await flushRaf();
      const rows = Array.from(document.querySelectorAll('[data-axiom-mark-row]'));
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

  it('(g) does NOT render a badge row for an edge whose axiomMarks list is non-empty (nodes-only iteration)', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(cy, NODE_A, [], { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithAxiomMarks(cy, NODE_B, [], { x1: 300, x2: 400, y1: 50, y2: 130 });
      addEdgeWithAxiomMarks(cy, EDGE_AB, NODE_A, NODE_B, [makeMark(EDGE_AB, PARTICIPANT_A)]);
      await flushRaf();
      const rows = document.querySelectorAll(`[data-axiom-mark-row][data-element-id="${EDGE_AB}"]`);
      expect(rows.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(h) multiple Cytoscape events within one frame produce ONE rAF-scheduled commit', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(cy, NODE_A, [makeMark(NODE_A, PARTICIPANT_A)], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
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

  it('(j) the badge renders the localized en-US aria-label including the participant UUID', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAxiomMarks(cy, NODE_A, [makeMark(NODE_A, PARTICIPANT_A)], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      await flushRaf();
      const badge = document.querySelector(
        `[data-axiom-mark-row][data-element-id="${NODE_A}"] [data-testid="audience-axiom-mark-badge-${NODE_A}-${PARTICIPANT_A}"]`,
      );
      expect(badge).not.toBeNull();
      const ariaLabel = badge?.getAttribute('aria-label') ?? '';
      expect(ariaLabel).toContain(PARTICIPANT_A);
      expect(ariaLabel.toLowerCase()).toContain('axiom mark');
    } finally {
      unmount();
    }
  });
});
