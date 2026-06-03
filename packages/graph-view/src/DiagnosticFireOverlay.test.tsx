// Vitest cases for `<AudienceDiagnosticFireOverlay>`.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Acceptance — ~14 cases pinning the React-side per-render class
//   logic: lazy-init seed on the first non-empty placement commit,
//   per-(identityKey, nodeId) gate, severity-keyed animation class,
//   clear+re-fire is a no-op, multi-diagnostic-on-overlapping-node
//   produces TWO independent halos, parameterized severity across the
//   five diagnostic kinds, accessibility presence markers.)
// ADRs: 0022 (no throwaway verifications). 0004 (Cytoscape vocabulary).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactElement } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import i18next from 'i18next';

import {
  I18nProvider,
  createI18nInstance,
  diagnosticIdentityKey,
  type I18nInstance,
} from '@a-conversa/shell';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { AudienceDiagnosticFireOverlay } from './DiagnosticFireOverlay';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const SESSION = '00000000-0000-4000-8000-000000000001';

// The package overlay takes the active-diagnostics map as a plain prop
// (no WS store). These helpers replicate the audience store's
// `applyDiagnostic` reducer — `fired` sets, `cleared` deletes, keyed by
// the canonical `diagnosticIdentityKey` — so the suite drives the same
// observable behavior through the prop seam the audience adapter feeds.
const EMPTY_ACTIVE: ReadonlyMap<string, DiagnosticPayload> = new Map();

function applyDiagnosticToMap(
  prev: ReadonlyMap<string, DiagnosticPayload>,
  payload: DiagnosticPayload,
): ReadonlyMap<string, DiagnosticPayload> {
  const next = new Map(prev);
  const key = diagnosticIdentityKey(payload);
  if (payload.status === 'fired') next.set(key, payload);
  else next.delete(key);
  return next;
}

function buildActive(
  payloads: readonly DiagnosticPayload[],
): ReadonlyMap<string, DiagnosticPayload> {
  let map: ReadonlyMap<string, DiagnosticPayload> = EMPTY_ACTIVE;
  for (const p of payloads) map = applyDiagnosticToMap(map, p);
  return map;
}

// Set by the mounted `OverlayHarness`; `fire()` drives the overlay's
// `active` prop through it, mirroring a WS-store dispatch.
let applyDiagnostic: ((payload: DiagnosticPayload) => void) | null = null;
const NODE_A = '00000000-0000-4000-8000-00000000ee01';
const NODE_B = '00000000-0000-4000-8000-00000000ee02';
const NODE_C = '00000000-0000-4000-8000-00000000ee03';
const NODE_D = '00000000-0000-4000-8000-00000000ee04';
const EDGE_E = '00000000-0000-4000-8000-00000000ef01';

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
  applyDiagnostic = null;
});

afterEach(() => {
  cleanup();
  applyDiagnostic = null;
});

async function flushRaf(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function OverlayHarness({
  onReady,
  initialActive,
}: {
  onReady: (cy: Core) => void;
  initialActive?: ReadonlyMap<string, DiagnosticPayload>;
}): ReactElement {
  const containerRef = createRef<HTMLDivElement>();
  const [cy, setCy] = useState<Core | null>(null);
  const [active, setActive] = useState<ReadonlyMap<string, DiagnosticPayload>>(
    initialActive ?? EMPTY_ACTIVE,
  );

  useEffect(() => {
    applyDiagnostic = (payload) => {
      setActive((prev) => applyDiagnosticToMap(prev, payload));
    };
    return () => {
      applyDiagnostic = null;
    };
  }, []);

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
      <AudienceDiagnosticFireOverlay
        cy={cy}
        containerRef={containerRef}
        instanceKey={SESSION}
        active={active}
      />
    </div>
  );
}

function renderOverlayWithCy(
  initialActive?: ReadonlyMap<string, DiagnosticPayload>,
): Promise<{ cy: Core; unmount: () => void }> {
  return new Promise((resolve) => {
    let captured: Core | null = null;
    const utils = render(
      <I18nProvider i18n={i18nInstance}>
        <OverlayHarness
          onReady={(cy) => {
            captured = cy;
          }}
          {...(initialActive !== undefined ? { initialActive } : {})}
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

function clearedCycle(nodes: readonly string[], sequence = 2): DiagnosticPayload {
  return { ...cycle(nodes, sequence), status: 'cleared' };
}

function contradiction(nodeA: string, nodeB: string, edges: readonly string[]): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence: 3,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges },
  };
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

function danglingClaim(nodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'dangling-claim',
    severity: 'advisory',
    status: 'fired',
    sequence: 5,
    diagnostic: { kind: 'dangling-claim', nodeId },
  };
}

function coherencyHint(warrantNodeId: string, dataNodeId: string): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'coherency-hint',
    severity: 'advisory',
    status: 'fired',
    sequence: 6,
    diagnostic: {
      kind: 'coherency-hint',
      hint: { kind: 'incomplete-warrant-missing-bridges-to', warrantNodeId, dataNodeId },
    },
  };
}

function fire(payload: DiagnosticPayload): void {
  act(() => {
    if (applyDiagnostic === null) {
      throw new Error('overlay harness not mounted');
    }
    applyDiagnostic(payload);
  });
}

describe('AudienceDiagnosticFireOverlay', () => {
  it('(a) initial-mount with no active diagnostics renders no halos', async () => {
    const { unmount } = await renderOverlayWithCy();
    try {
      await flushRaf();
      expect(document.querySelectorAll('[data-diagnostic-fire-anim]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(b) initial-mount with an already-active cycle on 3 nodes renders 3 halos with NO animation class', async () => {
    // Lazy-init seed: the first non-empty placement commit seeds the
    // gate with all currently-active (identityKey, nodeId) pairs, so
    // mid-session joiners do NOT see retrospective animation.
    const payload = cycle([NODE_A, NODE_B, NODE_C]);
    const { cy, unmount } = await renderOverlayWithCy(buildActive([payload]));
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_C, { x1: 500, x2: 600, y1: 350, y2: 430 });
      await flushRaf();
      const wrappers = document.querySelectorAll('[data-diagnostic-fire-anim]');
      expect(wrappers.length).toBe(3);
      wrappers.forEach((w) => {
        expect(w.classList.contains('aud-diagnostic-fire-blocking')).toBe(false);
        expect(w.classList.contains('aud-diagnostic-fire-advisory')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(c) post-mount fire of a new cycle animates each affected node with the blocking class', async () => {
    // Refinement: aud_diagnostic_fire_animation_seeding_alignment.md —
    // the overlay seeds its seen-Set on the FIRST render from the
    // store-derived tuples (empty at mount in this scenario), so a
    // post-mount fire from previously-empty state animates without
    // requiring an unrelated pre-seed workaround. Mirrors the edge
    // sibling's test (c) shape.
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_C, { x1: 500, x2: 600, y1: 350, y2: 430 });

      fire(cycle([NODE_A, NODE_B, NODE_C]));
      await flushRaf();

      const blockingWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim][data-severity="blocking"]',
      );
      expect(blockingWrappers.length).toBe(3);
      blockingWrappers.forEach((w) => {
        expect(w.classList.contains('aud-diagnostic-fire-blocking')).toBe(true);
        expect(w.classList.contains('aud-diagnostic-fire-advisory')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(d) post-mount fire of an advisory diagnostic animates with the advisory class', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      fire(danglingClaim(NODE_A));
      await flushRaf();
      const wrapper = document.querySelector(
        `[data-diagnostic-fire-anim][data-node-id="${NODE_A}"][data-severity="advisory"]`,
      );
      expect(wrapper).not.toBeNull();
      expect(wrapper?.classList.contains('aud-diagnostic-fire-advisory')).toBe(true);
      expect(wrapper?.classList.contains('aud-diagnostic-fire-blocking')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('(e) post-mount fire of a multi-warrant diagnostic on 3 nodes animates 3 advisory halos', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_C, { x1: 500, x2: 600, y1: 350, y2: 430 });
      addNodeWithBox(cy, NODE_D, { x1: 700, x2: 750, y1: 50, y2: 130 });
      // Seed the gate so the multi-warrant fire is identifiable as "new".
      fire(danglingClaim(NODE_D));
      await flushRaf();
      fire(multiWarrant(NODE_A, NODE_B, [NODE_C]));
      await flushRaf();
      const advisoryWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim].aud-diagnostic-fire-advisory',
      );
      // 3 from multi-warrant (A,B,C). D's halo is already seeded (no class).
      expect(advisoryWrappers.length).toBe(3);
    } finally {
      unmount();
    }
  });

  it('(f) a cleared diagnostic removes the halos from the DOM', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      fire(cycle([NODE_A, NODE_B]));
      await flushRaf();
      expect(document.querySelectorAll('[data-diagnostic-fire-anim]').length).toBe(2);
      fire(clearedCycle([NODE_A, NODE_B]));
      await flushRaf();
      expect(document.querySelectorAll('[data-diagnostic-fire-anim]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('(g) re-firing an identity after a clear does NOT re-animate', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_D, { x1: 700, x2: 750, y1: 50, y2: 130 });
      // Seed the gate first.
      fire(danglingClaim(NODE_D));
      await flushRaf();
      // First fire: animates.
      fire(cycle([NODE_A, NODE_B]));
      await flushRaf();
      const firstFireWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim].aud-diagnostic-fire-blocking',
      );
      expect(firstFireWrappers.length).toBe(2);
      // Clear.
      fire(clearedCycle([NODE_A, NODE_B]));
      await flushRaf();
      // Re-fire the SAME identity: the seen-Set retains the composite
      // keys, so the freshly-mounted halos carry no animation class.
      fire(cycle([NODE_A, NODE_B], 100));
      await flushRaf();
      const reFiredWrappers = document.querySelectorAll(
        '[data-diagnostic-fire-anim][data-severity="blocking"]',
      );
      expect(reFiredWrappers.length).toBe(2);
      reFiredWrappers.forEach((w) => {
        expect(w.classList.contains('aud-diagnostic-fire-blocking')).toBe(false);
      });
    } finally {
      unmount();
    }
  });

  it('(h) re-firing an identical identity (server re-emit) is a class-no-op', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_D, { x1: 700, x2: 750, y1: 50, y2: 130 });
      fire(danglingClaim(NODE_D));
      await flushRaf();
      fire(cycle([NODE_A, NODE_B]));
      await flushRaf();
      // Identical re-emit (no clear in between): the activeDiagnostics
      // entry is replaced under the same identity key; the composite
      // keys are unchanged, so nothing re-animates.
      fire(cycle([NODE_A, NODE_B], 50));
      await flushRaf();
      // The wrappers continue to exist (re-render of identical map);
      // count remains 3 (cycle 2 + dangling 1).
      expect(document.querySelectorAll('[data-diagnostic-fire-anim]').length).toBe(3);
    } finally {
      unmount();
    }
  });

  it('(i) a re-render with identical activeDiagnostics does not re-add the animation class', async () => {
    // Pan / zoom rerender (a Cytoscape event the hook re-commits on
    // without any state change) MUST NOT re-add the animation class.
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_D, { x1: 700, x2: 750, y1: 50, y2: 130 });
      fire(danglingClaim(NODE_D));
      await flushRaf();
      fire(cycle([NODE_A, NODE_B]));
      await flushRaf();
      // First fire animated. Now emit a pan/zoom to force a re-commit
      // with no state change; the gate's seen-Set retains the keys.
      cy.emit('pan');
      cy.emit('zoom');
      await flushRaf();
      // The placements re-emit but the predicate `isNew(key)` returns
      // false for all (composite key is seen). React-keyed
      // reconciliation reuses the wrappers; the animation class
      // condition resolves to '' on every re-render. We assert the
      // composite keys remain in the seen-Set by querying placements
      // that were initially un-classed (the seeded D) — they stay
      // un-classed.
      const d = document.querySelector(`[data-diagnostic-fire-anim][data-node-id="${NODE_D}"]`);
      expect(d?.classList.contains('aud-diagnostic-fire-advisory')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('(j) a node affected by two distinct diagnostics gets two halos with different composite keys', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      addNodeWithBox(cy, NODE_C, { x1: 500, x2: 600, y1: 350, y2: 430 });
      addNodeWithBox(cy, NODE_D, { x1: 700, x2: 750, y1: 50, y2: 130 });
      // Seed with an unrelated diagnostic.
      fire(danglingClaim(NODE_D));
      await flushRaf();
      // Cycle (blocking) AND dangling-claim (advisory) both touching NODE_A.
      fire(cycle([NODE_A, NODE_B, NODE_C]));
      fire(danglingClaim(NODE_A));
      await flushRaf();
      const aHalos = document.querySelectorAll(
        `[data-diagnostic-fire-anim][data-node-id="${NODE_A}"]`,
      );
      expect(aHalos.length).toBe(2);
      const severities = Array.from(aHalos).map((h) => h.getAttribute('data-severity'));
      expect(severities.sort()).toEqual(['advisory', 'blocking']);
      // Each carries its severity-specific animation class.
      const blockingA = Array.from(aHalos).find(
        (h) => h.getAttribute('data-severity') === 'blocking',
      );
      const advisoryA = Array.from(aHalos).find(
        (h) => h.getAttribute('data-severity') === 'advisory',
      );
      expect(blockingA?.classList.contains('aud-diagnostic-fire-blocking')).toBe(true);
      expect(advisoryA?.classList.contains('aud-diagnostic-fire-advisory')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('(k) halo `<span>` carries data-diagnostic-fire-anim, data-severity, data-identity-key, data-node-id', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
      const payload = danglingClaim(NODE_A);
      fire(payload);
      await flushRaf();
      const wrapper = document.querySelector('[data-diagnostic-fire-anim]');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute('data-severity')).toBe('advisory');
      expect(wrapper?.getAttribute('data-identity-key')).toBe(diagnosticIdentityKey(payload));
      expect(wrapper?.getAttribute('data-node-id')).toBe(NODE_A);
    } finally {
      unmount();
    }
  });

  it('(l) overlay wrapper carries aria-hidden="true"', async () => {
    const { unmount } = await renderOverlayWithCy();
    try {
      await flushRaf();
      const overlay = document.querySelector('[data-testid="audience-diagnostic-fire-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('(m) a node referenced by a diagnostic but absent from cy is silently skipped (no halo, no crash)', async () => {
    const { cy, unmount } = await renderOverlayWithCy();
    try {
      // NODE_A is NOT added to cy. The diagnostic references it; the
      // overlay must not crash and must emit no halo for the missing
      // node.
      addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
      fire(cycle([NODE_A, NODE_B]));
      await flushRaf();
      const halos = document.querySelectorAll('[data-diagnostic-fire-anim]');
      // Only NODE_B's halo emits.
      expect(halos.length).toBe(1);
      expect(halos[0]?.getAttribute('data-node-id')).toBe(NODE_B);
    } finally {
      unmount();
    }
  });

  // Parameterized severity case across all five diagnostic kinds.
  const KIND_CASES: ReadonlyArray<{
    label: string;
    payload: DiagnosticPayload;
    expectedSeverityClass: 'aud-diagnostic-fire-blocking' | 'aud-diagnostic-fire-advisory';
    targetNode: string;
  }> = [
    {
      label: 'cycle (blocking)',
      payload: cycle([NODE_A, NODE_B]),
      expectedSeverityClass: 'aud-diagnostic-fire-blocking',
      targetNode: NODE_A,
    },
    {
      label: 'contradiction (blocking)',
      payload: contradiction(NODE_A, NODE_B, [EDGE_E]),
      expectedSeverityClass: 'aud-diagnostic-fire-blocking',
      targetNode: NODE_A,
    },
    {
      label: 'multi-warrant (advisory)',
      payload: multiWarrant(NODE_A, NODE_B, [NODE_C]),
      expectedSeverityClass: 'aud-diagnostic-fire-advisory',
      targetNode: NODE_A,
    },
    {
      label: 'dangling-claim (advisory)',
      payload: danglingClaim(NODE_A),
      expectedSeverityClass: 'aud-diagnostic-fire-advisory',
      targetNode: NODE_A,
    },
    {
      label: 'coherency-hint (advisory)',
      payload: coherencyHint(NODE_A, NODE_B),
      expectedSeverityClass: 'aud-diagnostic-fire-advisory',
      targetNode: NODE_A,
    },
  ];

  for (const { label, payload, expectedSeverityClass, targetNode } of KIND_CASES) {
    it(`(n.${label}) post-mount fire of ${label} animates the target node with ${expectedSeverityClass}`, async () => {
      const { cy, unmount } = await renderOverlayWithCy();
      try {
        addNodeWithBox(cy, NODE_A, { x1: 100, x2: 200, y1: 50, y2: 130 });
        addNodeWithBox(cy, NODE_B, { x1: 300, x2: 400, y1: 200, y2: 280 });
        addNodeWithBox(cy, NODE_C, { x1: 500, x2: 600, y1: 350, y2: 430 });
        addNodeWithBox(cy, NODE_D, { x1: 700, x2: 750, y1: 50, y2: 130 });
        // Seed the gate with an unrelated advisory so post-mount fires
        // can be observed as "new" against an already-non-empty state.
        fire(danglingClaim(NODE_D));
        await flushRaf();
        fire(payload);
        await flushRaf();
        const wrapper = document.querySelector(
          `[data-diagnostic-fire-anim][data-node-id="${targetNode}"][data-severity="${payload.severity}"]`,
        );
        expect(wrapper).not.toBeNull();
        expect(wrapper?.classList.contains(expectedSeverityClass)).toBe(true);
      } finally {
        unmount();
      }
    });
  }
});
