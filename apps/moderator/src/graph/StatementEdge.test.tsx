// Tests for `<StatementEdge>` — the custom ReactFlow edge that renders
// the methodology role label on the edge body.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_rendering.md
//
// Per ADR 0022 these are committed Vitest cases. They verify that:
//
//   1. Every role × locale combination resolves the localized label
//      from the methodology glossary (`methodology.edgeRole.<role>`).
//      Seven roles × three v1 locales = 21 cases.
//
//   2. A defensive no-`data` render emits an empty label (rather than
//      throwing or rendering the literal key string).
//
// `<EdgeLabelRenderer>` portals its children into the
// `.react-flow__edgelabel-renderer` element that only exists once a real
// `<ReactFlow>` instance has mounted — without that node in the DOM the
// portal target is undefined and the label is omitted. So each test
// mounts `<ReactFlow>` with one node-pair plus the edge under test, and
// queries the resulting label by `data-testid`.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import ReactFlow, { Position, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { initI18n } from '../i18n';
import { edgeTypes } from './edgeTypes';
import type { StatementEdgeData } from './selectors';

const ALL_ROLES = [
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
] as const;

const EN_LABELS: Record<(typeof ALL_ROLES)[number], string> = {
  supports: 'Supports',
  rebuts: 'Rebuts',
  qualifies: 'Qualifies',
  'bridges-from': 'Bridges from',
  'bridges-to': 'Bridges to',
  defines: 'Defines',
  contradicts: 'Contradicts',
};
const PT_LABELS: Record<(typeof ALL_ROLES)[number], string> = {
  supports: 'Apoia',
  rebuts: 'Refuta',
  qualifies: 'Qualifica',
  'bridges-from': 'Ponte de',
  'bridges-to': 'Ponte para',
  defines: 'Define',
  contradicts: 'Contradiz',
};
const ES_LABELS: Record<(typeof ALL_ROLES)[number], string> = {
  supports: 'Apoya',
  rebuts: 'Refuta',
  qualifies: 'Califica',
  'bridges-from': 'Puente desde',
  'bridges-to': 'Puente hacia',
  defines: 'Define',
  contradicts: 'Contradice',
};
const LABELS_BY_LOCALE = {
  'en-US': EN_LABELS,
  'pt-BR': PT_LABELS,
  'es-419': ES_LABELS,
} as const;

// ReactFlow only renders edges once both endpoint nodes have measured
// `width` / `height` plus the internal `handleBounds`. In a real browser
// those come from `ResizeObserver` + `getBoundingClientRect`; in
// happy-dom both report zero. We hand ReactFlow pre-measured nodes
// (explicit `width` / `height`) and pin endpoint positions via
// `sourcePosition` / `targetPosition` so the edge path can be computed
// without DOM measurement. The `width` / `height` properties are part
// of the public `Node` type.
const NODES: Node[] = [
  {
    id: 'n1',
    position: { x: 0, y: 0 },
    data: { label: 'A' },
    width: 100,
    height: 40,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: 'n2',
    position: { x: 200, y: 200 },
    data: { label: 'B' },
    width: 100,
    height: 40,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
];

function edgeFor(role: (typeof ALL_ROLES)[number]): Edge<StatementEdgeData> {
  return {
    id: `edge-${role}`,
    source: 'n1',
    target: 'n2',
    type: 'statement',
    data: { role },
  };
}

beforeAll(async () => {
  // ReactFlow's core observes each node container with `ResizeObserver`
  // and only calls `updateNodeDimensions` (which populates the internal
  // `handleBounds` an edge needs to render) from inside the observer's
  // callback. happy-dom doesn't ship `ResizeObserver`. A bare noop stub
  // (`observe(){}`) lets the mount complete but never invokes the
  // callback, so the edge stays unrendered. Install an active stub:
  // when `.observe(element)` is called, synchronously fire the callback
  // with one entry for that element. The library reads `offsetWidth`
  // off the entry's target (the node element) rather than the
  // `contentRect` field, so the per-element rect we hand it doesn't
  // need to be exact — what matters is that the callback runs.
  class ImmediateResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ImmediateResizeObserver }).ResizeObserver =
    ImmediateResizeObserver;

  // ReactFlow's dimension probe reads `offsetWidth` / `offsetHeight` on
  // each node element (via the internal `getDimensions(node)` helper).
  // happy-dom returns 0 for both, which makes ReactFlow's `doUpdate`
  // check fail (`dimensions.width && dimensions.height` is falsy) and
  // the node never gets `handleBounds` populated, so the edge renderer
  // skips the edge. Override the two properties to return a non-zero
  // pair on every HTMLElement so the measurement pass succeeds.
  // Similarly, `getHandleBounds` reads `getBoundingClientRect` on the
  // node + handle elements; happy-dom returns zero rects by default.
  // The actual numbers don't matter for label-content tests — only that
  // they're non-zero so ReactFlow proceeds to call the custom edge
  // component, at which point the bezier path + label render.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(): number {
      return 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(): number {
      return 40;
    },
  });
  Element.prototype.getBoundingClientRect = function getBoundingClientRectStub(): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      toJSON() {
        return this;
      },
    };
  };

  await initI18n('en-US');
});

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('StatementEdge — methodology role label × locale', () => {
  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    for (const role of ALL_ROLES) {
      it(`renders the ${role} label in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        render(
          <div style={{ width: 400, height: 400 }}>
            <ReactFlow nodes={NODES} edges={[edgeFor(role)]} edgeTypes={edgeTypes} />
          </div>,
        );
        // The label is portaled into ReactFlow's `.react-flow__edgelabel-renderer`
        // node; happy-dom may need a tick after mount for the portal
        // target to be populated, hence `waitFor`.
        const label = await waitFor(() => screen.getByTestId(`graph-edge-label-edge-${role}`));
        expect(label.textContent).toBe(LABELS_BY_LOCALE[locale][role]);
        expect(label.getAttribute('data-edge-role')).toBe(role);
      });
    }
  }
});

describe('StatementEdge — defensive paths', () => {
  it('renders an empty label when data is missing (no thrown key string)', async () => {
    // Edge with no `data` payload. ReactFlow accepts this; our component
    // is the one that has to be defensive.
    const noDataEdge: Edge = {
      id: 'edge-no-data',
      source: 'n1',
      target: 'n2',
      type: 'statement',
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[noDataEdge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-no-data'));
    expect(label.textContent).toBe('');
    expect(label.getAttribute('data-edge-role')).toBe('');
  });
});
