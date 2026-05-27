// Vitest cases for `<AudienceGraphView>`.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Acceptance criteria — 12 baseline cases enumerated below pin the
//   React mount + Cytoscape element-sync behaviour the component owns.
//   The pure projection algorithm is pinned at
//   `projectGraph.test.ts`; this layer asserts what the component
//   does with those outputs.)
//
// Refinement: tasks/refinements/audience/aud_layout_engine.md
//   (Acceptance criteria — 4 additional cases (m–p) pin the first-
//   mount auto-fit gate and the layout-options threading. Re-mount
//   reset is covered so a StrictMode double-mount, Vite hot reload,
//   or Playwright page reload gets a fresh first-fit.)
//
// Refinement: tasks/refinements/audience/aud_clean_typography.md
//   (Acceptance criteria — 6 additional cases (q–v) pin the
//   broadcast typography surface: `font-family` equals
//   `BROADCAST_FONT_STACK` on both the node and edge selectors;
//   `font-size` and `font-weight` match the named-export constants
//   exposed alongside `STYLESHEET`. Structural assertions only — no
//   Cytoscape mount required.)
//
// ADRs:
//   - 0022 (no throwaway verifications — this Vitest layer is the
//     regression pin until `aud_url_routing.aud_session_url` lands the
//     deferred Playwright spec; the layout-engine's pixel-stability
//     pin defers to `aud_visual_regression`);
//   - 0024 (react-i18next + ICU — the suite wraps each render in an
//     `<I18nProvider>` carrying an en-US instance so the localized
//     `data.roleLabel` reads land deterministically).
//
// Mirrors the participant's `GraphView.test.tsx` shape: install the
// shared Cytoscape test env, seed events into the WS store, capture
// the live Cytoscape instance via the `cyRef` callback, assert on
// `cy.elements()` (canvas pixels are not DOM-queryable so the
// element set IS the testability seam).

import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { BreadthFirstLayoutOptions, Core, LayoutOptions } from 'cytoscape';
import type { EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { BROADCAST_FONT_STACK } from '@a-conversa/i18n-catalogs';

import {
  AudienceGraphView,
  BROADCAST_EDGE_FONT_SIZE_PX,
  BROADCAST_EDGE_FONT_WEIGHT,
  BROADCAST_NODE_FONT_SIZE_PX,
  BROADCAST_NODE_FONT_WEIGHT,
  STYLESHEET,
} from './GraphView';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';
import { PADDING, SPACING_FACTOR } from './layoutOptions';
import { audienceWsStore } from '../ws/wsStore';

function findStylesheetEntry(selector: 'node' | 'edge'): Record<string, unknown> {
  const entry = (
    STYLESHEET as unknown as ReadonlyArray<{ selector: string; style: Record<string, unknown> }>
  ).find((e) => e.selector === selector);
  if (entry === undefined) throw new Error(`stylesheet entry for selector "${selector}" not found`);
  return entry.style;
}

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const EDGE_DANGLING = '00000000-0000-4000-8000-00000000000f';
const NODE_MISSING = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000ac';

function nodeCreatedEvent(opts: {
  sequence: number;
  nodeId: string;
  wording: string;
  sessionId?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId ?? SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function edgeCreatedEvent(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
  role?: EdgeRole;
  sessionId?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId ?? SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role ?? 'supports',
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function classifyProposalEvent(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification: StatementKind;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: opts.nodeId,
        classification: opts.classification,
      },
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function commitEvent(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function seedEvent(event: Event): void {
  act(() => {
    audienceWsStore.getState().applyEvent(event);
  });
}

let i18nInstance: I18nInstance;
let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

beforeEach(() => {
  audienceWsStore.getState().reset();
  window.history.replaceState({}, '', `/a/sessions/${SESSION_ID}`);
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
  window.history.replaceState({}, '', '/');
});

interface RenderResult {
  getCy: () => Core;
}

function renderView(): RenderResult {
  let captured: Core | null = null;
  const cyRef = (cy: Core | null): void => {
    if (cy !== null) captured = cy;
  };
  render(
    <I18nProvider i18n={i18nInstance}>
      <AudienceGraphView cyRef={cyRef} />
    </I18nProvider>,
  );
  return {
    getCy: () => {
      if (captured === null) throw new Error('cy instance not captured');
      return captured;
    },
  };
}

describe('<AudienceGraphView>', () => {
  it('(a) mounts without crashing on an empty session', () => {
    expect(() => renderView()).not.toThrow();
  });

  it('(b) renders one Cytoscape node per node-created event', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A wording' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B wording' }));
    const cy = result.getCy();
    expect(cy.nodes().length).toBe(2);
  });

  it('(c) carries the original wording into data.wording', () => {
    const result = renderView();
    seedEvent(
      nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('wording')).toBe('UBI lifts welfare floor');
  });

  it('(d) keeps data.kind null until a classify-node proposal commit lands', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('kind')).toBeNull();
  });

  it('(e) flips data.kind to the committed classification after commit', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }));
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('kind')).toBe('normative');
  });

  it('(f) renders one Cytoscape edge per edge-created with source / target / role', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    );
    const cy = result.getCy();
    expect(cy.edges().length).toBe(1);
    const edge = cy.getElementById(EDGE_A);
    expect(edge.data('source')).toBe(NODE_A);
    expect(edge.data('target')).toBe(NODE_B);
    expect(edge.data('role')).toBe('rebuts');
    expect(edge.data('roleLabel')).toBe('Rebuts');
  });

  it('(g) keeps node and edge collections disjoint', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    const cy = result.getCy();
    const nodeIds = cy.nodes().map((n) => n.id());
    const edgeIds = cy.edges().map((e) => e.id());
    expect(nodeIds.sort()).toEqual([NODE_A, NODE_B].sort());
    expect(edgeIds).toEqual([EDGE_A]);
    expect(nodeIds).not.toContain(EDGE_A);
  });

  it('(h) renders an empty graph when no events have been applied', () => {
    const result = renderView();
    const cy = result.getCy();
    expect(cy.elements().length).toBe(0);
  });

  it('(i) filters dangling edges whose source or target is absent from the projected node set', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      edgeCreatedEvent({
        sequence: 2,
        edgeId: EDGE_DANGLING,
        source: NODE_A,
        target: NODE_MISSING,
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(EDGE_DANGLING).empty()).toBe(true);
    expect(cy.edges().length).toBe(0);
    expect(cy.nodes().length).toBe(1);
  });

  it('(j) renders an empty graph when the URL carries no session id', () => {
    act(() => {
      window.history.replaceState({}, '', '/');
    });
    seedEvent(
      nodeCreatedEvent({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'should not render',
        sessionId: OTHER_SESSION_ID,
      }),
    );
    const result = renderView();
    // Reset the URL back to the no-session path AFTER the render so
    // `useAudienceSession()` reads the no-session sentinel and the
    // events slice resolves to the empty list. The store carries an
    // event for OTHER_SESSION_ID but the component looks up its own
    // session's events, which is empty under the sentinel id.
    const cy = result.getCy();
    expect(cy.elements().length).toBe(0);
  });

  it('(k) carries the data-testid="audience-graph-root" on the outer container', () => {
    renderView();
    expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
  });

  it('(l) leaves Cytoscape pan/zoom defaults enabled (Decision §7)', () => {
    const result = renderView();
    const cy = result.getCy();
    expect(cy.userPanningEnabled()).toBe(true);
    expect(cy.userZoomingEnabled()).toBe(true);
  });

  // ---------------------------------------------------------------
  // aud_layout_engine — first-mount auto-fit + layout-options threading.
  // ---------------------------------------------------------------

  /**
   * Replaces `cy.fit`, `cy.layout`, `cy.width`, `cy.height` on the
   * captured instance so the assertions can pin the call shape without
   * fighting happy-dom's zero-sized viewport. `cy.width()` /
   * `cy.height()` would otherwise report 0 (the container's
   * `clientWidth` is 0 under happy-dom), gating both the layout and
   * the fit calls behind the in-component viewport-ready check.
   */
  interface LayoutEngineSpies {
    fit: ReturnType<typeof vi.fn>;
    layout: ReturnType<typeof vi.fn>;
    layoutRun: ReturnType<typeof vi.fn>;
  }
  function installLayoutEngineSpies(cy: Core): LayoutEngineSpies {
    const spies: LayoutEngineSpies = {
      fit: vi.fn(),
      layout: vi.fn(),
      layoutRun: vi.fn(),
    };
    (cy as unknown as { width: () => number }).width = () => 1920;
    (cy as unknown as { height: () => number }).height = () => 1080;
    (cy as unknown as { fit: (...args: unknown[]) => void }).fit = spies.fit;
    (cy as unknown as { layout: (opts: LayoutOptions) => { run: () => void } }).layout = (opts) => {
      spies.layout(opts);
      return { run: spies.layoutRun };
    };
    return spies;
  }

  it('(m) calls `cy.fit` exactly once on the first non-empty render', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(spies.fit).toHaveBeenCalledTimes(1);
    // Per the in-component call site, the first argument is `undefined`
    // (no element collection — fit to the whole graph) and the second
    // is the broadcast-tuned padding.
    expect(spies.fit).toHaveBeenCalledWith(undefined, PADDING);
  });

  it('(n) does NOT call `cy.fit` again on subsequent renders with the same node set', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(spies.fit).toHaveBeenCalledTimes(1);
    // A subsequent event that re-runs the element-sync effect without
    // adding a new node id: a `classify-node` proposal flips the
    // existing node's kind label but does not introduce a new node.
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }));
    expect(spies.fit).toHaveBeenCalledTimes(1);
  });

  it('(o) resets the fit-once gate on remount so a fresh mount fits again', () => {
    let captured: Core | null = null;
    const cyRef = (cy: Core | null): void => {
      if (cy !== null) captured = cy;
    };
    const view = render(
      <I18nProvider i18n={i18nInstance}>
        <AudienceGraphView cyRef={cyRef} />
      </I18nProvider>,
    );
    if (captured === null) throw new Error('cy instance not captured (first mount)');
    const firstSpies = installLayoutEngineSpies(captured);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(firstSpies.fit).toHaveBeenCalledTimes(1);
    // Unmount destroys the cy instance and the mount-effect cleanup
    // resets `hasFitOnceRef.current = false`. Re-rendering produces a
    // fresh cy instance and a fresh fit-once gate.
    act(() => {
      view.unmount();
    });
    captured = null;
    audienceWsStore.getState().reset();
    render(
      <I18nProvider i18n={i18nInstance}>
        <AudienceGraphView cyRef={cyRef} />
      </I18nProvider>,
    );
    if (captured === null) throw new Error('cy instance not captured (remount)');
    const secondSpies = installLayoutEngineSpies(captured);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(secondSpies.fit).toHaveBeenCalledTimes(1);
  });

  it('(p) calls `cy.layout` with the options returned by `buildAudienceLayoutOptions(elements)`', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(spies.layout).toHaveBeenCalledTimes(1);
    expect(spies.layoutRun).toHaveBeenCalledTimes(1);
    const captured = spies.layout.mock.calls[0]?.[0] as BreadthFirstLayoutOptions | undefined;
    if (captured === undefined || captured.name !== 'breadthfirst') {
      throw new Error('expected breadthfirst layout options');
    }
    expect(captured.name).toBe('breadthfirst');
    expect(captured.directed).toBe(true);
    expect(captured.circle).toBe(false);
    expect(captured.grid).toBe(false);
    expect(captured.avoidOverlap).toBe(true);
    expect(captured.spacingFactor).toBe(SPACING_FACTOR);
    expect(captured.nodeDimensionsIncludeLabels).toBe(false);
    expect(captured.padding).toBe(PADDING);
    expect(captured.animate).toBe(false);
    expect(captured.fit).toBe(false);
    // The seeded graph has one node, no edges → root candidates = [NODE_A].
    expect(captured.roots).toEqual([NODE_A]);
  });

  // ---------------------------------------------------------------
  // aud_clean_typography — broadcast typography pins on STYLESHEET.
  // ---------------------------------------------------------------

  it('(q) sets `font-family` on the node selector to BROADCAST_FONT_STACK', () => {
    expect(findStylesheetEntry('node')['font-family']).toBe(BROADCAST_FONT_STACK);
  });

  it('(r) sets `font-family` on the edge selector to BROADCAST_FONT_STACK', () => {
    expect(findStylesheetEntry('edge')['font-family']).toBe(BROADCAST_FONT_STACK);
  });

  it('(s) sets `font-size` on the node selector to BROADCAST_NODE_FONT_SIZE_PX (14)', () => {
    expect(BROADCAST_NODE_FONT_SIZE_PX).toBe(14);
    expect(findStylesheetEntry('node')['font-size']).toBe(BROADCAST_NODE_FONT_SIZE_PX);
  });

  it('(t) sets `font-size` on the edge selector to BROADCAST_EDGE_FONT_SIZE_PX (11)', () => {
    expect(BROADCAST_EDGE_FONT_SIZE_PX).toBe(11);
    expect(findStylesheetEntry('edge')['font-size']).toBe(BROADCAST_EDGE_FONT_SIZE_PX);
  });

  it('(u) sets `font-weight` on the node selector to BROADCAST_NODE_FONT_WEIGHT (600)', () => {
    expect(BROADCAST_NODE_FONT_WEIGHT).toBe(600);
    expect(findStylesheetEntry('node')['font-weight']).toBe(BROADCAST_NODE_FONT_WEIGHT);
  });

  it('(v) sets `font-weight` on the edge selector to BROADCAST_EDGE_FONT_WEIGHT (500)', () => {
    expect(BROADCAST_EDGE_FONT_WEIGHT).toBe(500);
    expect(findStylesheetEntry('edge')['font-weight']).toBe(BROADCAST_EDGE_FONT_WEIGHT);
  });
});
