// Vitest cases for `<AudienceDiagnosticEdgeFireOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md
//   (Acceptance — ~10 cases pinning the React-side per-render class
//   logic for the edge sibling: lazy-init seed on the first non-empty
//   placement commit, per-(identityKey, edgeId) gate, severity-keyed
//   animation class, clear+re-fire is a no-op, multi-diagnostic-on-
//   overlapping-edge produces TWO independent halos, the three
//   diagnostic kinds with empty `edges` projection render no halos,
//   missing-edge silent-skip, accessibility presence markers.)
// ADRs: 0022 (no throwaway verifications). 0004 (Cytoscape vocabulary).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { AudienceDiagnosticEdgeFireOverlay } from './DiagnosticEdgeFireOverlay';
import { diagnosticIdentityKey } from './diagnosticHighlights';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';
import { audienceWsStore } from '../ws/wsStore';

const SESSION = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000ee01';
const NODE_B = '00000000-0000-4000-8000-00000000ee02';
const NODE_C = '00000000-0000-4000-8000-00000000ee03';
const NODE_D = '00000000-0000-4000-8000-00000000ee04';
const EDGE_1 = '00000000-0000-4000-8000-00000000ef01';
const EDGE_2 = '00000000-0000-4000-8000-00000000ef02';
const EDGE_3 = '00000000-0000-4000-8000-00000000ef03';
const EDGE_GHOST = '00000000-0000-4000-8000-00000000efff';

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
  audienceWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
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
      <AudienceDiagnosticEdgeFireOverlay cy={cy} containerRef={containerRef} sessionId={SESSION} />
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

function addNode(cy: Core, id: string, x: number, y: number): void {
  cy.add({
    group: 'nodes',
    data: { id },
    position: { x, y },
  });
}

function addEdgeWithBox(
  cy: Core,
  id: string,
  source: string,
  target: string,
  renderedBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  cy.add({
    group: 'edges',
    data: { id, source, target },
  });
  const edge = cy.getElementById(id);
  (edge as unknown as { renderedBoundingBox: () => typeof renderedBox }).renderedBoundingBox = () =>
    renderedBox;
}

// ── payload builders ─────────────────────────────────────────────────

function cycle(nodes: readonly string[], sequence = 1): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function contradiction(
  nodeA: string,
  nodeB: string,
  edges: readonly string[],
  sequence = 3,
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges },
  };
}

function clearedContradiction(
  nodeA: string,
  nodeB: string,
  edges: readonly string[],
): DiagnosticPayload {
  return { ...contradiction(nodeA, nodeB, edges), status: 'cleared' };
}

function multiWarrant(
  dataNodeId: string,
  claimNodeId: string,
  warrantNodeIds: readonly string[],
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity: 'advisory',
    status: 'fired',
    sequence: 4,
    diagnostic: { kind: 'multi-warrant', dataNodeId, claimNodeId, warrantNodeIds },
  };
}

function selfContradicts(edgeId: string, nodeId: string, sequence = 6): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'self-contradicts', edgeId, nodeId },
    },
  };
}

function fire(payload: DiagnosticPayload): void {
  act(() => {
    audienceWsStore.getState().applyDiagnostic(payload);
  });
}

function seedNodes(cy: Core): void {
  addNode(cy, NODE_A, 100, 100);
  addNode(cy, NODE_B, 300, 200);
  addNode(cy, NODE_C, 500, 300);
  addNode(cy, NODE_D, 700, 400);
}

describe('AudienceDiagnosticEdgeFireOverlay', () => {
  it('(a) initial-mount with no active diagnostics renders no halos', async () => {
    const { unmount } = await renderOverlayWithCy();
    try {
      await flushRaf();
      expect(
        document.querySelectorAll('[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]')
          .length,
      ).toBe(0);
      // Wrapper carries aria-hidden="true".
      const overlay = document.querySelector(
        '[data-testid="audience-diagnostic-edge-fire-overlay"]',
      );
      expect(overlay).not.toBeNull();
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('(b) initial-mount with an already-active contradiction over 2 edges renders 2 halos with NO animation class', async () => {
    // Lazy-init seed: the first non-empty placement commit seeds the
    // gate with all currently-active (identityKey, edgeId) pairs, so
    // mid-session joiners do NOT see retrospective animation.
    const payload = contradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
    audienceWsStore.getState().applyDiagnostic(payload);
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addEdgeWithBox(cy, EDGE_2, NODE_B, NODE_A, { x1: 300, x2: 400, y1: 200, y2: 280 });
      await flushRaf();
      const wrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]',
      );
      expect(wrappers.length).toBe(2);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-diagnostic-fire-blocking')).toBe(false);
        expect(w.classList.contains('aud-diagnostic-fire-advisory')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(c) post-mount fire of a contradiction animates both edges with the blocking class + carries data attributes', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addEdgeWithBox(cy, EDGE_2, NODE_B, NODE_A, { x1: 300, x2: 400, y1: 200, y2: 280 });
      // The overlay seeds its seen-Set on the FIRST render from the
      // store-derived tuples (empty at mount in this scenario), so a
      // post-mount fire from previously-empty state animates without
      // requiring an unrelated pre-seed. This matches the refinement's
      // case 3 and the Playwright acceptance.
      const payload = contradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]);
      fire(payload);
      await flushRaf();

      const blockingWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"][data-severity="blocking"]',
      );
      expect(blockingWrappers.length).toBe(2);
      blockingWrappers.forEach((w) => {
        expect(w.classList.contains('aud-diagnostic-fire-blocking')).toBe(true);
        expect(w.classList.contains('aud-diagnostic-fire-advisory')).toBe(false);
        expect(w.getAttribute('data-diagnostic-fire-locus')).toBe('edge');
        expect(w.getAttribute('data-severity')).toBe('blocking');
        expect(w.getAttribute('data-identity-key')).toBe(diagnosticIdentityKey(payload));
        expect(w.getAttribute('data-edge-id')).not.toBeNull();
      });
    } finally {
      unmount();
    }
  });

  it('(d) post-mount fire of a self-contradicts coherency-hint animates the warrant-bridge edge with the advisory class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addEdgeWithBox(cy, EDGE_3, NODE_C, NODE_D, { x1: 500, x2: 600, y1: 350, y2: 430 });
      // Seed the gate with an unrelated contradiction on EDGE_1.
      fire(contradiction(NODE_A, NODE_B, [EDGE_1]));
      await flushRaf();
      fire(selfContradicts(EDGE_3, NODE_C));
      await flushRaf();
      const wrapper = document.querySelector(
        `[data-diagnostic-fire-anim][data-edge-id="${EDGE_3}"][data-severity="advisory"]`,
      );
      expect(wrapper).not.toBeNull();
      expect(wrapper?.classList.contains('aud-diagnostic-fire-advisory')).toBe(true);
      expect(wrapper?.classList.contains('aud-diagnostic-fire-blocking')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('(e) post-mount fire of a cycle payload renders no edge halos (cycle emits edges: [])', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      fire(cycle([NODE_A, NODE_B, NODE_C]));
      await flushRaf();
      expect(
        document.querySelectorAll('[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]')
          .length,
      ).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(f) post-mount fire of a multi-warrant payload renders no edge halos', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      fire(multiWarrant(NODE_A, NODE_B, [NODE_C]));
      await flushRaf();
      expect(
        document.querySelectorAll('[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]')
          .length,
      ).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(g) a cleared contradiction removes the edge halos from the DOM', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addEdgeWithBox(cy, EDGE_2, NODE_B, NODE_A, { x1: 300, x2: 400, y1: 200, y2: 280 });
      fire(contradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]));
      await flushRaf();
      expect(
        document.querySelectorAll('[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]')
          .length,
      ).toBe(2);
      fire(clearedContradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]));
      await flushRaf();
      expect(
        document.querySelectorAll('[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]')
          .length,
      ).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(h) re-firing an identity after a clear does NOT re-animate', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addEdgeWithBox(cy, EDGE_2, NODE_B, NODE_A, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addEdgeWithBox(cy, EDGE_3, NODE_C, NODE_D, { x1: 500, x2: 600, y1: 350, y2: 430 });
      // Seed the gate first with an unrelated advisory hint.
      fire(selfContradicts(EDGE_3, NODE_C));
      await flushRaf();
      // First fire: animates.
      fire(contradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]));
      await flushRaf();
      const firstFireWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim].aud-diagnostic-fire-blocking',
      );
      expect(firstFireWrappers.length).toBe(2);
      // Clear.
      fire(clearedContradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]));
      await flushRaf();
      // Re-fire the SAME identity: the seen-Set retains the composite
      // keys, so the freshly-mounted halos carry no animation class.
      fire(contradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2], 100));
      await flushRaf();
      const reFiredWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"][data-severity="blocking"]',
      );
      expect(reFiredWrappers.length).toBe(2);
      reFiredWrappers.forEach((w) => {
        expect(w.classList.contains('aud-diagnostic-fire-blocking')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(i) an edge affected by two distinct diagnostics gets two halos with different composite keys', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addEdgeWithBox(cy, EDGE_2, NODE_B, NODE_A, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addEdgeWithBox(cy, EDGE_3, NODE_C, NODE_D, { x1: 500, x2: 600, y1: 350, y2: 430 });
      // Seed with an unrelated diagnostic.
      fire(selfContradicts(EDGE_3, NODE_C));
      await flushRaf();
      // Contradiction (blocking) AND self-contradicts (advisory) both touching EDGE_1.
      fire(contradiction(NODE_A, NODE_B, [EDGE_1, EDGE_2]));
      fire(selfContradicts(EDGE_1, NODE_A, 7));
      await flushRaf();
      const e1Halos = document.querySelectorAll(
        `[data-diagnostic-fire-anim][data-edge-id="${EDGE_1}"]`,
      );
      expect(e1Halos.length).toBe(2);
      const severities = Array.from(e1Halos).map((h) => h.getAttribute('data-severity'));
      expect(severities.sort()).toEqual(['advisory', 'blocking']);
      const blockingE1 = Array.from(e1Halos).find(
        (h) => h.getAttribute('data-severity') === 'blocking',
      );
      const advisoryE1 = Array.from(e1Halos).find(
        (h) => h.getAttribute('data-severity') === 'advisory',
      );
      expect(blockingE1?.classList.contains('aud-diagnostic-fire-blocking')).toBe(true);
      expect(advisoryE1?.classList.contains('aud-diagnostic-fire-advisory')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(j) an edge referenced by a diagnostic but absent from cy is silently skipped (no halo, no crash)', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      seedNodes(cy);
      // EDGE_GHOST is NOT added to cy. The diagnostic references it; the
      // overlay must not crash and must emit no halo for the missing
      // edge.
      addEdgeWithBox(cy, EDGE_1, NODE_A, NODE_B, { x1: 100, x2: 200, y1: 50, y2: 130 });
      fire(contradiction(NODE_A, NODE_B, [EDGE_GHOST, EDGE_1]));
      await flushRaf();
      const halos = document.querySelectorAll(
        '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]',
      );
      // Only EDGE_1's halo emits.
      expect(halos.length).toBe(1);
      expect(halos[0]?.getAttribute('data-edge-id')).toBe(EDGE_1);
    } finally {
      unmount();
    }
  });
});
