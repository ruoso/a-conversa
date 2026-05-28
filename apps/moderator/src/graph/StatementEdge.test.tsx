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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import ReactFlow, { MarkerType, Position, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { createI18nInstance, type Annotation } from '@a-conversa/shell';
import { edgeTypes } from './edgeTypes';
import type { StatementEdgeData } from './selectors';
import type { DiagnosticHighlight } from './diagnosticHighlights';
import { useSelectionStore } from '../stores';

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
    // `sourceId` / `targetId` are non-optional on `StatementEdgeData`
    // per `mod_edge_popover_full_target_wording`; the popover renders
    // them in the endpoint-references row. `sourceWording` /
    // `targetWording` remain non-optional per `mod_hover_details`
    // (retained for future surfaces — the popover no longer consumes
    // them). In tests that don't inspect the popover, the fixed 'n1' /
    // 'n2' / 'A' / 'B' values are placeholders matching the test `NODES`.
    data: {
      role,
      annotations: [],
      facetStatuses: {},
      sourceId: 'n1',
      targetId: 'n2',
      sourceWording: 'A',
      targetWording: 'B',
    },
  };
}

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'an annotation body',
    targetNodeId: overrides.targetNodeId ?? null,
    targetEdgeId: overrides.targetEdgeId ?? null,
    createdBy: overrides.createdBy ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: overrides.createdAt ?? '2026-05-11T00:00:00.000Z',
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

  await createI18nInstance('en-US');
});

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
  // Reset the selection store between cases — the `mod_selection`
  // tests at the end of the file explicitly opt into selection.
  useSelectionStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useSelectionStore.getState().clear();
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

describe('StatementEdge — annotation badge overlay', () => {
  it('renders one annotation badge inside the edge label overlay', async () => {
    const annotation = makeAnnotation({
      id: 'anno-e-1',
      kind: 'reframe',
      content: 'reframing this edge',
      targetEdgeId: 'edge-with-annotation',
    });
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-with-annotation',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [annotation],
        facetStatuses: {},
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const list = await waitFor(() =>
      screen.getByTestId('annotation-badge-list-edge-edge-with-annotation'),
    );
    expect(list).toBeTruthy();
    const badge = screen.getByTestId('annotation-badge-anno-e-1');
    expect(badge.textContent).toBe('Reframe');
    expect(badge.getAttribute('data-annotation-kind')).toBe('reframe');
    expect(badge.getAttribute('title')).toBe('reframing this edge');
  });

  it('renders multiple annotation badges in arrival order on an edge', async () => {
    const annotations: Annotation[] = [
      makeAnnotation({ id: 'anno-e-a', kind: 'note', targetEdgeId: 'edge-many' }),
      makeAnnotation({ id: 'anno-e-b', kind: 'stance', targetEdgeId: 'edge-many' }),
    ];
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-many',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'qualifies',
        annotations,
        facetStatuses: {},
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    const { container } = render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    await waitFor(() => screen.getByTestId('annotation-badge-list-edge-edge-many'));
    const ids = Array.from(
      container.querySelectorAll('[data-testid^="annotation-badge-anno-e-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['annotation-badge-anno-e-a', 'annotation-badge-anno-e-b']);
  });
});

describe('StatementEdge — proposed-state styling (mod_proposed_state_styling)', () => {
  it('stamps data-facet-status="proposed" on the role-label pill when the substance facet is proposed', async () => {
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-proposed',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'proposed' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-proposed'));
    expect(label.getAttribute('data-facet-status')).toBe('proposed');
  });

  it('omits the data-facet-status attribute when facetStatuses is empty', async () => {
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-baseline',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: {},
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-baseline'));
    expect(label.getAttribute('data-facet-status')).toBeNull();
  });
});

describe('StatementEdge — agreed-state styling (mod_agreed_state_styling)', () => {
  // Edges only carry a `substance` facet in v1; the "agreed" state means
  // every current participant has voted `agree` on the proposed
  // substance value, no commit yet. The visual is a solid stroke + full
  // opacity (== ReactFlow's `<BaseEdge>` default; no style override).
  // The `data-facet-status="agreed"` attribute on the role-label pill is
  // the stable seam for downstream tasks / Playwright selectors.
  it('stamps data-facet-status="agreed" on the role-label pill when the substance facet is agreed', async () => {
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-agreed',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'agreed' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-agreed'));
    expect(label.getAttribute('data-facet-status')).toBe('agreed');
  });

  it('does not apply the dashed-stroke style when the substance facet is agreed', async () => {
    // Pin that the agreed-state visual is the BaseEdge default, not the
    // dashed-stroke proposed-state visual. The path is rendered inside
    // ReactFlow's SVG and isn't directly id-targetable; we assert no
    // `stroke-dasharray` attribute is set on any path inside the
    // .react-flow__edges container (i.e. agreed edges render with the
    // default solid stroke).
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-agreed-style',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'agreed' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    const { container } = render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    // Wait for the edge to render (the role label being present is a
    // sufficient proxy — the BaseEdge path renders in the same frame).
    await waitFor(() => screen.getByTestId('graph-edge-label-edge-agreed-style'));
    const paths = container.querySelectorAll('.react-flow__edges path');
    for (const path of paths) {
      // No dashed stroke — the agreed state is solid.
      expect(path.getAttribute('stroke-dasharray')).toBeNull();
      // No inline opacity override either (the BaseEdge default is full
      // opacity).
      const style = path.getAttribute('style') ?? '';
      expect(style).not.toMatch(/opacity\s*:/i);
    }
  });
});

describe('StatementEdge — disputed-state styling (mod_disputed_state_styling)', () => {
  // Edges only carry a `substance` facet in v1; the "disputed" state
  // means at least one current participant has voted `dispute` (or
  // withdrawn against an uncommitted facet). The visual is a solid red
  // stroke at full opacity (no dasharray, no opacity dim) — the
  // unambiguous "this needs resolution" signal. The
  // `data-facet-status="disputed"` attribute on the role-label pill is
  // the stable seam for downstream tasks / Playwright selectors.
  it('stamps data-facet-status="disputed" on the role-label pill when the substance facet is disputed', async () => {
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-disputed',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'disputed' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-disputed'));
    expect(label.getAttribute('data-facet-status')).toBe('disputed');
  });

  it('applies the red stroke (#e11d48 / rgb(225, 29, 72)) on the BaseEdge path when the substance facet is disputed', async () => {
    // Pin that the disputed-state visual is a solid red stroke, no
    // dasharray, no opacity dim. The path is rendered inside
    // ReactFlow's SVG and isn't directly id-targetable; we assert
    // against any path inside the .react-flow__edges container.
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-disputed-style',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'disputed' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    const { container } = render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    // Wait for the edge to render (the role label being present is a
    // sufficient proxy — the BaseEdge path renders in the same frame).
    await waitFor(() => screen.getByTestId('graph-edge-label-edge-disputed-style'));
    const paths = container.querySelectorAll('.react-flow__edges path');
    // ReactFlow renders multiple paths per edge (one for the
    // interaction stroke, one for the visible edge); the visible edge
    // is the one our `style` prop is applied to. At least one path
    // must carry the red stroke.
    let foundRedStroke = false;
    for (const path of paths) {
      const style = path.getAttribute('style') ?? '';
      // happy-dom may serialize the inline style as either the hex
      // (`stroke: #e11d48`) or the rgb tuple (`stroke: rgb(225, 29, 72)`);
      // accept either form.
      if (/stroke\s*:\s*(#e11d48|rgb\(\s*225\s*,\s*29\s*,\s*72\s*\))/i.test(style)) {
        foundRedStroke = true;
      }
      // No dashed stroke — the disputed state is solid.
      expect(path.getAttribute('stroke-dasharray')).toBeNull();
      // No inline opacity override either — the disputed state is fully
      // attention-grabbing, not faded.
      expect(style).not.toMatch(/opacity\s*:/i);
    }
    expect(foundRedStroke).toBe(true);
  });
});

describe('StatementEdge — meta-disagreement-state styling (mod_meta_disagreement_split_render)', () => {
  // Edges only carry a `substance` facet in v1; the "meta-disagreement"
  // state means the methodology-flow has marked the facet as
  // irreducibly disputed and the moderator has recorded the
  // disagreement as the disposition. The visual is a violet stroke
  // (`#7c3aed` — Tailwind's `violet-600`, matching the node's
  // `border-violet-600` marker) at full opacity with a tight `2 2`
  // dotted dasharray conveying "fragmented / split". No opacity dim —
  // the meta-disagreement visual is fully attention-grabbing (mirrors
  // the disputed pattern). The `data-facet-status="meta-disagreement"`
  // attribute on the role-label pill is the stable seam for downstream
  // tasks / Playwright selectors.
  it('stamps data-facet-status="meta-disagreement" on the role-label pill when the substance facet is meta-disagreement', async () => {
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-meta',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'meta-disagreement' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-meta'));
    expect(label.getAttribute('data-facet-status')).toBe('meta-disagreement');
  });

  it('applies the violet stroke (#7c3aed / rgb(124, 58, 237)) + "2 2" dasharray on the BaseEdge path when the substance facet is meta-disagreement', async () => {
    // Pin that the meta-disagreement visual is a violet dotted stroke
    // with no opacity dim. The path is rendered inside ReactFlow's SVG
    // and isn't directly id-targetable; we assert against any path
    // inside the .react-flow__edges container.
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-meta-style',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'meta-disagreement' },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    const { container } = render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    await waitFor(() => screen.getByTestId('graph-edge-label-edge-meta-style'));
    const paths = container.querySelectorAll('.react-flow__edges path');
    // ReactFlow renders multiple paths per edge (one for the
    // interaction stroke, one for the visible edge); the visible edge
    // is the one our `style` prop is applied to. At least one path
    // must carry both the violet stroke and the dotted dasharray.
    let foundVioletDotted = false;
    for (const path of paths) {
      const style = path.getAttribute('style') ?? '';
      // happy-dom may serialize the inline style as either the hex
      // (`stroke: #7c3aed`) or the rgb tuple (`stroke: rgb(124, 58, 237)`);
      // accept either form. The dasharray may live in the `style`
      // string or be hoisted to a `stroke-dasharray` attribute (the
      // BaseEdge from ReactFlow forwards style as CSS — happy-dom
      // keeps the property in the `style` string).
      const hasVioletStroke = /stroke\s*:\s*(#7c3aed|rgb\(\s*124\s*,\s*58\s*,\s*237\s*\))/i.test(
        style,
      );
      const hasDottedDash =
        /stroke-dasharray\s*:\s*['"]?\s*2\s+2/i.test(style) ||
        path.getAttribute('stroke-dasharray') === '2 2';
      if (hasVioletStroke && hasDottedDash) {
        foundVioletDotted = true;
      }
      // No inline opacity override — the meta-disagreement state is
      // fully attention-grabbing, not faded.
      expect(style).not.toMatch(/opacity\s*:/i);
    }
    expect(foundVioletDotted).toBe(true);
  });
});

// -- Directional arrow marker ----------------------------------------
//
// `<StatementEdge>` threads the resolved `markerEnd` URL from
// `EdgeProps` into `<BaseEdge>` so ReactFlow paints the directional
// arrowhead on the visible edge path. The selector populates the
// per-edge `markerEnd` object (color per substance status); these
// cases pin the DOM contract that the threaded URL lands as the
// `marker-end` attribute on at least one path inside the
// `.react-flow__edges` container.

describe('StatementEdge — directional arrow', () => {
  it('renders a marker-end="url(#…)" attribute on the BaseEdge path when the edge declares markerEnd', async () => {
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-with-arrow',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: {},
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    const { container } = render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    await waitFor(() => screen.getByTestId('graph-edge-label-edge-with-arrow'));
    // ReactFlow renders multiple paths per edge (interaction stroke +
    // visible edge); at least one carries the `marker-end` URL. The
    // marker itself paints as a `<polyline>` inside a `<marker>` def,
    // so iterating paths reaches the visible edge without picking up
    // the marker glyph.
    const paths = container.querySelectorAll('.react-flow__edges path');
    const markerEnds = Array.from(paths)
      .map((p) => p.getAttribute('marker-end'))
      .filter((v): v is string => v !== null && v !== '');
    expect(markerEnds.length).toBeGreaterThan(0);
    // ReactFlow's EdgeWrapper resolves `markerEnd` to a single-
    // quoted CSS URL (`url('#<id>')`), so the regex allows the
    // single-quote wrapping.
    expect(markerEnds.every((v) => /^url\('#.+'\)$/.test(v))).toBe(true);
  });
});

// -- Click-to-select visual state (mod_selection) ---------------------
//
// `<StatementEdge>` subscribes to `useSelectionStore` and stamps a
// `data-selected` attribute + a Tailwind `ring-4 ring-sky-500` outline
// on the role-label div when the store's `selected` matches this edge.
// The store-write side is exercised in `GraphCanvasPane.test.tsx`;
// these cases pin the per-edge READ path — the visual layer the
// moderator sees when an edge is selected.

describe('StatementEdge — click-to-select visual state (mod_selection)', () => {
  it('stamps data-selected="false" on the edge label when nothing is selected', async () => {
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    expect(label.getAttribute('data-selected')).toBe('false');
    expect(label.className).not.toContain('ring-sky-500');
  });

  it('stamps data-selected="true" + the sky-500 ring on the label when the edge is selected', async () => {
    useSelectionStore.getState().select({ kind: 'edge', id: 'edge-supports' });
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    expect(label.getAttribute('data-selected')).toBe('true');
    expect(label.className).toContain('ring-4');
    expect(label.className).toContain('ring-sky-500');
  });

  it('does not select an edge when a NODE with the same id is the current selection', async () => {
    // The `kind` discriminator on `Selection` must keep node-kind and
    // edge-kind selection disjoint even when ids happen to collide.
    useSelectionStore.getState().select({ kind: 'node', id: 'edge-supports' });
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    expect(label.getAttribute('data-selected')).toBe('false');
    expect(label.className).not.toContain('ring-sky-500');
  });
});

// -- Diagnostic highlight (mod_diagnostic_highlighting) --------------
//
// The amber halo composes on the role-label pill (NOT the BaseEdge
// path) when `data.diagnosticHighlight !== undefined`. The
// `data-diagnostic-severity` attribute stamps the severity as the
// stable DOM seam. The methodology-state path styling (disputed red /
// meta-disagreement violet) stays on the `<path>` independently — the
// two visual layers do not interfere.

function edgeWithDiagnostic(
  role: 'supports' | 'rebuts',
  diagnosticHighlight: DiagnosticHighlight,
  facetStatuses: StatementEdgeData['facetStatuses'] = {},
): Edge<StatementEdgeData> {
  return {
    id: `edge-${role}-${diagnosticHighlight.severity}`,
    source: 'n1',
    target: 'n2',
    type: 'statement',
    data: {
      role,
      annotations: [],
      facetStatuses,
      diagnosticHighlight,
      sourceId: 'n1',
      targetId: 'n2',
      sourceWording: 'A',
      targetWording: 'B',
    },
  };
}

describe('StatementEdge — diagnostic highlight (mod_diagnostic_highlighting)', () => {
  it('has no data-diagnostic-severity attribute and no amber ring when diagnosticHighlight is undefined', async () => {
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    expect(label.getAttribute('data-diagnostic-severity')).toBeNull();
    expect(label.className).not.toContain('ring-amber-500');
    expect(label.className).not.toContain('ring-amber-300');
  });

  it('stamps data-diagnostic-severity="blocking" + the amber blocking ring classes on the role-label pill', async () => {
    const edge = edgeWithDiagnostic('supports', { severity: 'blocking', kinds: ['cycle'] });
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId(`graph-edge-label-${edge.id}`));
    expect(label.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(label.className).toContain('ring-4');
    expect(label.className).toContain('ring-amber-500/80');
    expect(label.className).toContain('ring-offset-2');
    expect(label.className).toContain('motion-safe:animate-pulse');
  });

  it('stamps data-diagnostic-severity="advisory" + the amber advisory ring classes on the role-label pill', async () => {
    const edge = edgeWithDiagnostic('rebuts', { severity: 'advisory', kinds: ['coherency-hint'] });
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId(`graph-edge-label-${edge.id}`));
    expect(label.getAttribute('data-diagnostic-severity')).toBe('advisory');
    expect(label.className).toContain('ring-2');
    expect(label.className).toContain('ring-amber-300/70');
    expect(label.className).toContain('ring-offset-1');
    // No pulse on advisory.
    expect(label.className).not.toContain('animate-pulse');
  });

  it('keeps the disputed red stroke on the BaseEdge path while the role-label pill carries the amber halo (independent visual layers)', async () => {
    // Same edge with substance=disputed (red stroke on path) AND a
    // blocking diagnostic (amber halo on label pill). Both visuals
    // must be present — the methodology-state path styling and the
    // diagnostic halo are independent visual layers.
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-dispute-diag',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'disputed' },
        diagnosticHighlight: { severity: 'blocking', kinds: ['contradiction'] },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    const { container } = render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-dispute-diag'));
    // The label pill carries both seams.
    expect(label.getAttribute('data-facet-status')).toBe('disputed');
    expect(label.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(label.className).toContain('ring-amber-500/80');
    // The BaseEdge path keeps the disputed red stroke — the
    // diagnostic halo did NOT restyle the path.
    const paths = container.querySelectorAll('.react-flow__edges path');
    let foundRedStroke = false;
    for (const path of paths) {
      const style = path.getAttribute('style') ?? '';
      if (/stroke\s*:\s*(#e11d48|rgb\(\s*225\s*,\s*29\s*,\s*72\s*\))/i.test(style)) {
        foundRedStroke = true;
      }
    }
    expect(foundRedStroke).toBe(true);
  });

  it('does NOT stamp a native title attribute on the role-label pill (superseded by hover popover)', async () => {
    // As of `mod_hover_details`, the native `title` attribute has been
    // REMOVED from the role-label pill. The popover (rendered as a
    // sibling inside the edge-label container on hover/focus) surfaces
    // the localized diagnostic title(s) instead.
    const edge = edgeWithDiagnostic('supports', { severity: 'blocking', kinds: ['cycle'] });
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId(`graph-edge-label-${edge.id}`));
    expect(label.getAttribute('title')).toBeNull();
    // Stable seam (data-diagnostic-severity) still stamped.
    expect(label.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });

  it('renders the localized diagnostic title inside the popover on hover (cycle, en-US)', async () => {
    const edge = edgeWithDiagnostic('supports', { severity: 'blocking', kinds: ['cycle'] });
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId(`graph-edge-label-${edge.id}`));
    fireEvent.mouseEnter(label);
    const popover = await waitFor(() => screen.getByTestId(`hover-popover-${edge.id}`));
    expect(popover.textContent).toContain('Cycle in supports');
  });
});

// -- Hover popover wiring (mod_hover_details) -------------------------
//
// The role-label div carries `onMouseEnter` / `onMouseLeave` / `onFocus`
// / `onBlur` handlers that flip a `useState<boolean>` hover flag. The
// `<HoverPopover>` renders as a sibling inside the existing `flex flex-
// col items-center gap-0.5` container under `<EdgeLabelRenderer>`. The
// `aria-describedby` linkage is stamped only while the popover is open.
// Refinement: `mod_hover_details`.

describe('StatementEdge — hover popover wiring (mod_hover_details)', () => {
  it('does not render the popover by default; renders it on mouseenter', async () => {
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    expect(screen.queryByTestId('hover-popover-edge-supports')).toBeNull();
    expect(label.getAttribute('aria-describedby')).toBeNull();
    fireEvent.mouseEnter(label);
    const popover = screen.getByTestId('hover-popover-edge-supports');
    expect(popover).toBeTruthy();
    expect(label.getAttribute('aria-describedby')).toBe('hover-popover-edge-supports');
  });

  it('removes the popover on mouseleave', async () => {
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    fireEvent.mouseEnter(label);
    expect(screen.getByTestId('hover-popover-edge-supports')).toBeTruthy();
    fireEvent.mouseLeave(label);
    expect(screen.queryByTestId('hover-popover-edge-supports')).toBeNull();
    expect(label.getAttribute('aria-describedby')).toBeNull();
  });

  it('renders the popover on focus / removes on blur (keyboard parity)', async () => {
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edgeFor('supports')]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-supports'));
    fireEvent.focus(label);
    expect(screen.getByTestId('hover-popover-edge-supports')).toBeTruthy();
    fireEvent.blur(label);
    expect(screen.queryByTestId('hover-popover-edge-supports')).toBeNull();
  });

  it('renders the localized role + endpoint references (source/target ids) in the popover and does NOT render endpoint wordings', async () => {
    // Refinement: `mod_edge_popover_full_target_wording` (Option C).
    // The popover surfaces ids (canvas-stable canonical handles), not
    // wordings — the cards already render the wordings inline with
    // measured dimensions, so duplicating wording in the popover would
    // not earn the popover's existence on the edge surface.
    //
    // The edge's `source` / `target` must match the test `NODES`
    // fixture's ids (`'n1'` / `'n2'`) so ReactFlow can resolve the
    // endpoint coordinates and paint the label. `sourceId` /
    // `targetId` on the projected `data` payload carry the same ids
    // (this is the contract: the selector copies them verbatim from
    // the `edge-created` payload's `source_node_id` /
    // `target_node_id`).
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-wordings',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: {},
        sourceId: 'n1',
        targetId: 'n2',
        // Both wording fields stay populated (the selector still
        // projects them for future surfaces) but the popover renderer
        // must NOT surface them — the assertions below pin that.
        sourceWording: 'data wording',
        targetWording: 'claim wording',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-wordings'));
    fireEvent.mouseEnter(label);
    const popover = screen.getByTestId('hover-popover-edge-wordings');
    // Role headline still surfaces.
    expect(popover.textContent).toContain('Supports');
    // Endpoint references row carries the ids (visible text + stable
    // data attributes).
    const endpoints = popover.querySelector('[data-hover-popover-section="endpoints"]');
    expect(endpoints).not.toBeNull();
    expect(endpoints!.textContent).toContain('n1');
    expect(endpoints!.textContent).toContain('n2');
    expect(endpoints!.getAttribute('data-hover-popover-source-id')).toBe('n1');
    expect(endpoints!.getAttribute('data-hover-popover-target-id')).toBe('n2');
    // Negative pin: wordings must NOT be rendered by the popover.
    expect(popover.textContent).not.toContain('data wording');
    expect(popover.textContent).not.toContain('claim wording');
    // Stable seam: data-hover-target-kind="edge".
    expect(popover.getAttribute('data-hover-target-kind')).toBe('edge');
  });

  it('keeps data-facet-status / data-selected / data-diagnostic-severity stamps while the popover is open', async () => {
    useSelectionStore.getState().select({ kind: 'edge', id: 'edge-stamps' });
    const edge: Edge<StatementEdgeData> = {
      id: 'edge-stamps',
      source: 'n1',
      target: 'n2',
      type: 'statement',
      data: {
        role: 'supports',
        annotations: [],
        facetStatuses: { substance: 'disputed' },
        diagnosticHighlight: { severity: 'blocking', kinds: ['contradiction'] },
        sourceId: 'n1',
        targetId: 'n2',
        sourceWording: 'A',
        targetWording: 'B',
      },
    };
    render(
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={NODES} edges={[edge]} edgeTypes={edgeTypes} />
      </div>,
    );
    const label = await waitFor(() => screen.getByTestId('graph-edge-label-edge-stamps'));
    fireEvent.mouseEnter(label);
    expect(screen.getByTestId('hover-popover-edge-stamps')).toBeTruthy();
    expect(label.getAttribute('data-selected')).toBe('true');
    expect(label.getAttribute('data-facet-status')).toBe('disputed');
    expect(label.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });
});
