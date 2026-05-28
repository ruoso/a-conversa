// Vitest cases for `<AudienceAnnotationOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//              (Constraints — 10 cases (a–j) mirroring the axiom-mark
//              overlay's case shape, with the per-element data read
//              being `data.annotations` and the per-element child being
//              a flex-row of `<AudienceAnnotationBadge>` chips in array
//              order (commit-arrival).)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering_edges.md
//              (Constraints — case (g) is replaced (parent's
//              "edge-iteration-impossible" assertion is now inverted)
//              and 6 new cases (k–p) pin the edge-iteration commit pass:
//              edge with one annotation renders one row, edge with
//              EMPTY_ANNOTATIONS renders no row, two annotations on the
//              same edge stack in arrival order, two annotated edges
//              produce two distinct rows, symmetric mixed (node + edge)
//              renders one row per element with matching `data-element-id`,
//              and the i18n smoke on the edge branch.)
// ADRs:        0022 (no throwaway verifications). 0004 (Cytoscape
//              vocabulary — `cy.on('render pan zoom resize', cb)` +
//              `cy.on('position', 'node', cb)` + `cy.on('add remove
//              data', cb)`).
//
// Mirrors `AxiomMarkOverlay.test.tsx` shape — install the shared
// Cytoscape test env, mount the overlay against a self-created cy
// instance, seed precisely the cy state the case needs, assert on the
// rendered DOM.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';
import type { AnnotationKind } from '@a-conversa/shared-types';

import { createI18nInstance, I18nProvider, type I18nInstance } from '@a-conversa/shell';

import { AudienceAnnotationOverlay } from './AnnotationOverlay';
import { EMPTY_ANNOTATIONS, type Annotation } from './annotations';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const NODE_A = '00000000-0000-4000-8000-00000000cc01';
const NODE_B = '00000000-0000-4000-8000-00000000cc02';
const NODE_C = '00000000-0000-4000-8000-00000000cc04';
const NODE_D = '00000000-0000-4000-8000-00000000cc05';
const EDGE_AB = '00000000-0000-4000-8000-00000000cc03';
const EDGE_CD = '00000000-0000-4000-8000-00000000cc06';
const ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const ANNO_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
const ANNO_4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

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
      <AudienceAnnotationOverlay cy={cy} containerRef={containerRef} />
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

function makeAnnotation(opts: {
  id: string;
  kind?: AnnotationKind;
  content?: string;
  targetNodeId?: string | null;
  targetEdgeId?: string | null;
}): Annotation {
  return {
    id: opts.id,
    kind: opts.kind ?? 'note',
    content: opts.content ?? 'an annotation body',
    targetNodeId: opts.targetNodeId ?? null,
    targetEdgeId: opts.targetEdgeId ?? null,
    createdBy: ACTOR,
    createdAt: '2026-05-28T00:00:00.000Z',
  };
}

function addNodeWithAnnotations(
  cy: Core,
  id: string,
  annotations: readonly Annotation[],
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'nodes',
    data: { id, annotations },
    position: {
      x: (renderedBox.x1 + renderedBox.x2) / 2,
      y: (renderedBox.y1 + renderedBox.y2) / 2,
    },
  });
  const node = cy.getElementById(id);
  (node as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

function addEdgeWithAnnotations(
  cy: Core,
  id: string,
  sourceId: string,
  targetId: string,
  annotations: readonly Annotation[],
  renderedBox?: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'edges',
    data: { id, source: sourceId, target: targetId, annotations },
  });
  if (renderedBox !== undefined) {
    const edge = cy.getElementById(id);
    (edge as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox =
      () => renderedBox;
  }
}

describe('AudienceAnnotationOverlay', () => {
  it('(a) renders an empty overlay wrapper when cy === null', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(
      <I18nProvider i18n={i18nInstance}>
        <div>
          <div ref={containerRef} />
          <AudienceAnnotationOverlay cy={null} containerRef={containerRef} />
        </div>
      </I18nProvider>,
    );
    const overlay = document.querySelector('[data-testid="audience-annotation-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelectorAll('[data-annotation-row]').length).toBe(0);
  });

  it('(b) renders an empty overlay wrapper when the cy instance has zero elements', async () => {
    const { unmount } = await renderOverlayWithCy();
    try {
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-annotation-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.querySelectorAll('[data-annotation-row]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(c) omits the badge row for a node whose annotations list is EMPTY_ANNOTATIONS', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      await flushRaf();
      const rows = document.querySelectorAll(`[data-annotation-row][data-element-id="${NODE_A}"]`);
      expect(rows.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(d) renders exactly one badge for a node carrying one Annotation', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(
        cy,
        NODE_A,
        [makeAnnotation({ id: ANNO_1, kind: 'note', targetNodeId: NODE_A })],
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-annotation-row][data-element-id="${NODE_A}"]`);
      expect(row).not.toBeNull();
      const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
      expect(badges?.length).toBe(1);
      expect(badges?.[0]?.getAttribute('data-annotation-kind')).toBe('note');
      expect(badges?.[0]?.getAttribute('data-testid')).toBe(`audience-annotation-badge-${ANNO_1}`);
    } finally {
      unmount();
    }
  });

  it('(e) renders two badges in commit-arrival order with distinct kinds and ids', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(
        cy,
        NODE_A,
        [
          makeAnnotation({ id: ANNO_1, kind: 'note', targetNodeId: NODE_A }),
          makeAnnotation({ id: ANNO_2, kind: 'reframe', targetNodeId: NODE_A }),
        ],
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-annotation-row][data-element-id="${NODE_A}"]`);
      expect(row).not.toBeNull();
      const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
      expect(badges?.length).toBe(2);
      expect(badges?.[0]?.getAttribute('data-annotation-kind')).toBe('note');
      expect(badges?.[1]?.getAttribute('data-annotation-kind')).toBe('reframe');
      expect(badges?.[0]?.getAttribute('data-testid')).toBe(`audience-annotation-badge-${ANNO_1}`);
      expect(badges?.[1]?.getAttribute('data-testid')).toBe(`audience-annotation-badge-${ANNO_2}`);
    } finally {
      unmount();
    }
  });

  it('(f) renders one row per node when two nodes carry non-empty annotations, with distinct positions', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, [makeAnnotation({ id: ANNO_1, targetNodeId: NODE_A })], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, [makeAnnotation({ id: ANNO_2, targetNodeId: NODE_B })], {
        x1: 300,
        x2: 400,
        y1: 200,
        y2: 280,
      });
      await flushRaf();
      const rows = Array.from(document.querySelectorAll('[data-annotation-row]'));
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

  it('(k) renders exactly one badge row for an edge carrying one Annotation, keyed on the edge id', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      addEdgeWithAnnotations(
        cy,
        EDGE_AB,
        NODE_A,
        NODE_B,
        [makeAnnotation({ id: ANNO_3, kind: 'note', targetEdgeId: EDGE_AB })],
        { x1: 200, x2: 300, y1: 80, y2: 100 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-annotation-row][data-element-id="${EDGE_AB}"]`);
      expect(row).not.toBeNull();
      const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
      expect(badges?.length).toBe(1);
      expect(badges?.[0]?.getAttribute('data-annotation-kind')).toBe('note');
      expect(badges?.[0]?.getAttribute('data-testid')).toBe(`audience-annotation-badge-${ANNO_3}`);
    } finally {
      unmount();
    }
  });

  it('(l) omits the badge row for an edge whose annotations list is EMPTY_ANNOTATIONS', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      addEdgeWithAnnotations(cy, EDGE_AB, NODE_A, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 200,
        x2: 300,
        y1: 80,
        y2: 100,
      });
      await flushRaf();
      const rows = document.querySelectorAll(`[data-annotation-row][data-element-id="${EDGE_AB}"]`);
      expect(rows.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(m) renders two badges in commit-arrival order for an edge with two annotations of different kinds', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      addEdgeWithAnnotations(
        cy,
        EDGE_AB,
        NODE_A,
        NODE_B,
        [
          makeAnnotation({ id: ANNO_1, kind: 'note', targetEdgeId: EDGE_AB }),
          makeAnnotation({ id: ANNO_2, kind: 'reframe', targetEdgeId: EDGE_AB }),
        ],
        { x1: 200, x2: 300, y1: 80, y2: 100 },
      );
      await flushRaf();
      const row = document.querySelector(`[data-annotation-row][data-element-id="${EDGE_AB}"]`);
      expect(row).not.toBeNull();
      const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
      expect(badges?.length).toBe(2);
      expect(badges?.[0]?.getAttribute('data-annotation-kind')).toBe('note');
      expect(badges?.[1]?.getAttribute('data-annotation-kind')).toBe('reframe');
      expect(badges?.[0]?.getAttribute('data-testid')).toBe(`audience-annotation-badge-${ANNO_1}`);
      expect(badges?.[1]?.getAttribute('data-testid')).toBe(`audience-annotation-badge-${ANNO_2}`);
    } finally {
      unmount();
    }
  });

  it('(n) renders two distinct rows with distinct positions for two annotated edges', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_C, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 300,
        y2: 380,
      });
      addNodeWithAnnotations(cy, NODE_D, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 300,
        y2: 380,
      });
      addEdgeWithAnnotations(
        cy,
        EDGE_AB,
        NODE_A,
        NODE_B,
        [makeAnnotation({ id: ANNO_1, targetEdgeId: EDGE_AB })],
        { x1: 200, x2: 300, y1: 80, y2: 100 },
      );
      addEdgeWithAnnotations(
        cy,
        EDGE_CD,
        NODE_C,
        NODE_D,
        [makeAnnotation({ id: ANNO_2, targetEdgeId: EDGE_CD })],
        { x1: 200, x2: 300, y1: 330, y2: 350 },
      );
      await flushRaf();
      const rows = Array.from(document.querySelectorAll('[data-annotation-row]'));
      expect(rows.length).toBe(2);
      const ids = rows.map((r) => r.getAttribute('data-element-id')).sort();
      expect(ids).toEqual([EDGE_AB, EDGE_CD].sort());
      const rowAB = rows.find((r) => r.getAttribute('data-element-id') === EDGE_AB) as
        | HTMLElement
        | undefined;
      const rowCD = rows.find((r) => r.getAttribute('data-element-id') === EDGE_CD) as
        | HTMLElement
        | undefined;
      expect(rowAB?.style.top).not.toBe(rowCD?.style.top);
    } finally {
      unmount();
    }
  });

  it('(o) symmetric mixed case: one annotated node + one annotated edge yields one row per element with matching data-element-id', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, [makeAnnotation({ id: ANNO_1, targetNodeId: NODE_A })], {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      addEdgeWithAnnotations(
        cy,
        EDGE_AB,
        NODE_A,
        NODE_B,
        [makeAnnotation({ id: ANNO_2, targetEdgeId: EDGE_AB })],
        { x1: 200, x2: 300, y1: 80, y2: 100 },
      );
      await flushRaf();
      const rows = Array.from(document.querySelectorAll('[data-annotation-row]'));
      expect(rows.length).toBe(2);
      const rowIds = rows.map((r) => r.getAttribute('data-element-id')).sort();
      expect(rowIds).toEqual([NODE_A, EDGE_AB].sort());
      const nodeRow = rows.find((r) => r.getAttribute('data-element-id') === NODE_A);
      const edgeRow = rows.find((r) => r.getAttribute('data-element-id') === EDGE_AB);
      expect(
        nodeRow?.querySelector(`[data-testid="audience-annotation-badge-${ANNO_1}"]`),
      ).not.toBeNull();
      expect(
        edgeRow?.querySelector(`[data-testid="audience-annotation-badge-${ANNO_2}"]`),
      ).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('(p) the edge-row badge text resolves the localized en-US kind label via methodology.annotationKind.<kind>', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, EMPTY_ANNOTATIONS, {
        x1: 100,
        x2: 200,
        y1: 50,
        y2: 130,
      });
      addNodeWithAnnotations(cy, NODE_B, EMPTY_ANNOTATIONS, {
        x1: 300,
        x2: 400,
        y1: 50,
        y2: 130,
      });
      addEdgeWithAnnotations(
        cy,
        EDGE_AB,
        NODE_A,
        NODE_B,
        [makeAnnotation({ id: ANNO_4, kind: 'scope-change', targetEdgeId: EDGE_AB })],
        { x1: 200, x2: 300, y1: 80, y2: 100 },
      );
      await flushRaf();
      const badge = document.querySelector(
        `[data-annotation-row][data-element-id="${EDGE_AB}"] [data-testid="audience-annotation-badge-${ANNO_4}"]`,
      );
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe('Scope change');
    } finally {
      unmount();
    }
  });

  it('(h) multiple Cytoscape events within one frame produce ONE rAF-scheduled commit', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(cy, NODE_A, [makeAnnotation({ id: ANNO_1, targetNodeId: NODE_A })], {
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

  it('(j) the badge text resolves the localized en-US kind label via methodology.annotationKind.<kind>', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithAnnotations(
        cy,
        NODE_A,
        [makeAnnotation({ id: ANNO_1, kind: 'reframe', targetNodeId: NODE_A })],
        { x1: 100, x2: 200, y1: 50, y2: 130 },
      );
      await flushRaf();
      const badge = document.querySelector(
        `[data-annotation-row][data-element-id="${NODE_A}"] [data-testid="audience-annotation-badge-${ANNO_1}"]`,
      );
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe('Reframe');
    } finally {
      unmount();
    }
  });
});
