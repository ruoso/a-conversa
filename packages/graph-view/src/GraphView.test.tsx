// Vitest cases for the package `<GraphView>`.
//
// Lifted from the audience suite per ADR 0039. The harness now drives
// the renderer through its `events` prop directly (the audience adapter
// owns the `useAudienceSession()` → prop wiring and is covered by the
// audience-side adapter test), so `seedEvent` accumulates an events
// array and re-renders rather than dispatching to the WS store.
//
// Refinement: tasks/refinements/landing_page/extract_readonly_graph_package.md
//   (Props-in inversion: the package renderer's data source is the
//   `events` prop, not a session hook.)
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
// Refinement: tasks/refinements/audience/aud_agreed_styling.md
//   (Acceptance criteria — 2 additional cases (w–x) pin the
//   agreed-state per-rollup selector entries: `STYLESHEET` carries a
//   `node[rollupStatus = 'agreed']` entry whose `border-color` is
//   slate-700 (`#334155`) and an `edge[rollupStatus = 'agreed']`
//   entry whose `line-color` and `target-arrow-color` are both
//   slate-700. The two mount-time cases the refinement also scopes
//   land in `aud_agreed_styling_mount_assertions` (cases cc–dd
//   below) — the projection-time `data.rollupStatus` emission they
//   require is owned by `aud_proposed_styling` and ships there; this
//   leaf only pins the structural selectors.)
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//   (Acceptance criteria — 4 additional cases (y–bb) pin the
//   proposed-state per-rollup selector entries (structural × 2) AND
//   the mount-time computed-style resolution (× 2): `STYLESHEET`
//   carries a `node[rollupStatus = 'proposed']` entry whose
//   `border-style` is `'dashed'` and `opacity` is 0.6, and an
//   `edge[rollupStatus = 'proposed']` entry whose `line-style` is
//   `'dashed'` and `opacity` is 0.6. The two mount-time cases land
//   inline because this leaf owns the projection-time
//   `data.rollupStatus` emission they require.)
//
// Refinement: tasks/refinements/audience/aud_agreed_styling_mount_assertions.md
//   (Acceptance criteria — 2 additional cases (cc–dd) pin the
//   agreed-state mount-time computed-style resolution: after seeding
//   the minimal event sequence that fires Rule 7 of `facetStatus.ts`
//   (a `participant-joined`, the relevant creation event(s), a
//   proposal-keyed `agree` vote for the node case or a facet-keyed
//   `agree` vote on the inline-seeded `shape` facet for the edge
//   case), the live Cytoscape instance reports
//   `data.rollupStatus === 'agreed'` AND the computed
//   `border-color` (node) / `line-color` (edge) resolves to
//   slate-700 — closes the symmetry gap with the proposed-state pair
//   (aa, bb) shipped by `aud_proposed_styling`.)
//
// Refinement: tasks/refinements/audience/aud_disputed_styling.md
//   (Acceptance criteria — 4 additional cases (ee–hh) pin the
//   disputed-state per-rollup selector entries (structural × 2) AND
//   the mount-time computed-style resolution (× 2): `STYLESHEET`
//   carries a `node[rollupStatus = 'disputed']` entry whose
//   `border-color` is rose-600 (`#e11d48`) and `border-width` is 3,
//   and an `edge[rollupStatus = 'disputed']` entry whose `line-color`
//   and `target-arrow-color` are both rose-600. The two mount-time
//   cases land inline (not deferred) because the projection-time
//   `data.rollupStatus` emission they require already shipped via
//   `aud_proposed_styling`; the minimal sequence fires Rule 5 (any
//   current participant's `dispute` vote).)
//
// Refinement: tasks/refinements/audience/aud_per_facet_visualization.md
//   (Acceptance criteria — 3 additional cases (ii–kk) pin the wrapper
//   structure + the overlay-as-sibling mount + the projection-to-pill-
//   row integration path. The 28 baseline cases continue to pass: the
//   `audience-graph-root` testid is unchanged (it now sits inside the
//   wrapper but the query still resolves), and the `cyRef` callback
//   API is unchanged. Decision §5 — `cyInstanceRef` is paired with a
//   new `useState<Core | null>` slot.)
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//   (Acceptance criteria — 3 additional cases (ll–nn) pin the second
//   DOM-overlay sibling mount + the projection-to-badge-row integration
//   path: structural sibling, single-participant integration, multi-
//   participant integration. The overlay's own mount lifecycle,
//   subscription set, and per-element placement are pinned in
//   `AxiomMarkOverlay.test.tsx`.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//   (Acceptance criteria — 3 additional cases (ss–uu) pin the third
//   DOM-overlay sibling mount + the projection-to-annotation-row
//   integration path: structural sibling, single-annotation
//   integration, multi-annotation integration. The overlay's own
//   mount lifecycle, subscription set, and per-element placement are
//   pinned in `AnnotationOverlay.test.tsx`.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering_edges.md
//   (Acceptance criteria — 2 additional cases (vv–ww) pin the edge-
//   branch projection-to-annotation-row integration path: an edge
//   carrying a committed annotation mounts a `[data-annotation-row]`
//   keyed on the edge id, and a symmetric mixed (node + edge) session
//   mounts two distinct rows.)
//
// Refinement: tasks/refinements/audience/aud_meta_disagreement_split.md
//   (Acceptance criteria — 4 additional cases (oo–rr) pin the
//   meta-disagreement-state per-rollup selector entries (structural × 2)
//   AND the mount-time computed-style resolution (× 2): `STYLESHEET`
//   carries a `node[rollupStatus = 'meta-disagreement']` entry whose
//   `border-style` is `'double'` and `border-color` is violet-600
//   (`#7c3aed`), and an `edge[rollupStatus = 'meta-disagreement']`
//   entry whose `line-color` and `target-arrow-color` are both
//   violet-600. The two mount-time cases land inline (not deferred)
//   because the projection-time `data.rollupStatus` emission they
//   require already shipped via `aud_proposed_styling`; the minimal
//   sequence emits a `meta-disagreement-marked` event with
//   `target: 'facet'` so Rule 1 of `facetStatus.ts` short-circuits.)
//
// Refinement: tasks/refinements/audience/aud_stylesheet_module_extraction.md
//   (Import-source rewrite only — `STYLESHEET` and the four
//   `BROADCAST_*` typography constants now resolve from
//   `./stylesheet` (the new sibling module) rather than from
//   `./GraphView`. The `GraphView` import continues to come
//   from `./GraphView`. No test cases added or removed; the existing
//   34 cases (a–hh) re-run unchanged and pass against the same
//   assertions and fixtures.)
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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Core, LayoutOptions } from 'cytoscape';
import type {
  AnnotationKind,
  EdgeRole,
  Event,
  FacetName,
  StatementKind,
} from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { BROADCAST_FONT_STACK } from '@a-conversa/i18n-catalogs';

import { GraphView } from './GraphView';
import {
  BROADCAST_EDGE_FONT_SIZE_PX,
  BROADCAST_EDGE_FONT_WEIGHT,
  BROADCAST_NODE_FONT_SIZE_PX,
  BROADCAST_NODE_FONT_WEIGHT,
  STYLESHEET,
} from './stylesheet';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';
import { PADDING } from './layoutOptions';
// Namespace import so the layout-engine tests can `vi.spyOn` the
// `layoutAndPackComponents` orchestration the element-sync effect calls —
// the per-component layout it runs needs a real viewport, so under
// happy-dom we stub it and assert it was invoked, not its painted output.
import * as layoutEngine from './layoutOptions';

function findStylesheetEntry(selector: string): Record<string, unknown> {
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
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a2';

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

function participantJoinedEvent(opts: {
  sequence: number;
  userId: string;
  role: 'debater-A' | 'debater-B' | 'moderator';
  screenName?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'participant-joined',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      role: opts.role,
      screen_name: opts.screenName ?? 'Participant',
      joined_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function voteEvent(
  opts:
    | {
        sequence: number;
        proposalId: string;
        participant: string;
        vote: 'agree' | 'dispute';
      }
    | {
        sequence: number;
        entityKind: 'node' | 'edge';
        entityId: string;
        facet: FacetName;
        participant: string;
        vote: 'agree' | 'dispute';
      },
): Event {
  const id = `00000000-0000-4000-8000-${(0x600 + opts.sequence).toString(16).padStart(12, '0')}`;
  if ('proposalId' in opts) {
    return {
      id,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'vote',
      actor: opts.participant,
      payload: {
        target: 'proposal',
        proposal_id: opts.proposalId,
        participant: opts.participant,
        choice: opts.vote,
        voted_at: '2026-05-27T00:00:10.000Z',
      },
      createdAt: '2026-05-27T00:00:10.000Z',
    };
  }
  return {
    id,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'vote',
    actor: opts.participant,
    payload: {
      target: 'facet',
      entity_kind: opts.entityKind,
      entity_id: opts.entityId,
      facet: opts.facet,
      participant: opts.participant,
      choice: opts.vote,
      voted_at: '2026-05-27T00:00:10.000Z',
    },
    createdAt: '2026-05-27T00:00:10.000Z',
  };
}

function metaDisagreementFacetEvent(opts: {
  sequence: number;
  entityKind: 'node' | 'edge';
  entityId: string;
  facet: FacetName;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x700 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'meta-disagreement-marked',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: opts.entityKind,
      entity_id: opts.entityId,
      facet: opts.facet,
      marked_by: ACTOR,
      marked_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
  };
}

// The package renderer reads its event log from the `events` prop. The
// harness accumulates seeded events into a module-level array and
// re-renders the mounted component with the new array — the cy instance
// persists across re-renders (no key change), so `getCy()` keeps
// returning the same instance while the element-sync effect re-runs.
// This is the prop seam the audience adapter feeds from
// `useAudienceSession()`.
let currentEvents: readonly Event[] = [];
let rerenderWithEvents: ((events: readonly Event[]) => void) | null = null;

function seedEvent(event: Event): void {
  currentEvents = [...currentEvents, event];
  act(() => {
    rerenderWithEvents?.(currentEvents);
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
  currentEvents = [];
  rerenderWithEvents = null;
});

afterEach(() => {
  cleanup();
  currentEvents = [];
  rerenderWithEvents = null;
  // Restore any `vi.spyOn` (e.g. the layout-engine spy below) so a
  // mocked `layoutAndPackComponents` does not leak into later tests.
  vi.restoreAllMocks();
});

interface RenderResult {
  getCy: () => Core;
}

function graphTree(events: readonly Event[], cyRef: (cy: Core | null) => void): React.ReactElement {
  return (
    <I18nProvider i18n={i18nInstance}>
      <GraphView events={events} instanceKey={SESSION_ID} cyRef={cyRef} />
    </I18nProvider>
  );
}

function renderView(): RenderResult {
  let captured: Core | null = null;
  const cyRef = (cy: Core | null): void => {
    if (cy !== null) captured = cy;
  };
  const utils = render(graphTree(currentEvents, cyRef));
  rerenderWithEvents = (events: readonly Event[]): void => {
    utils.rerender(graphTree(events, cyRef));
  };
  return {
    getCy: () => {
      if (captured === null) throw new Error('cy instance not captured');
      return captured;
    },
  };
}

describe('<GraphView>', () => {
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

  it('(j) renders exactly the events passed via props — the package does not filter by session', () => {
    // The package is store-agnostic: it renders whatever `events` it is
    // handed, regardless of the per-event `sessionId` field. Cross-
    // session filtering is the audience adapter's concern
    // (`useAudienceSession()` slices the store by URL session) and is
    // covered by the audience-side adapter test — not here. This pins
    // the props-in inversion: no session lookup crosses the boundary.
    const result = renderView();
    seedEvent(
      nodeCreatedEvent({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'rendered regardless of the per-event session field',
        sessionId: OTHER_SESSION_ID,
      }),
    );
    const cy = result.getCy();
    expect(cy.nodes().length).toBe(1);
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
    fit: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
    layout: ReturnType<typeof vi.fn<(opts: LayoutOptions) => void>>;
    layoutRun: ReturnType<typeof vi.fn<() => void>>;
    // The element-sync effect calls `layoutAndPackComponents(cy)` on a
    // structure change. Its per-component breadthfirst needs a real
    // viewport, so we stub the orchestration to a no-op and assert it
    // was invoked (the per-component layout + packing logic is pinned
    // directly in `layoutOptions.test.ts`).
    layoutAndPack: MockInstance<(cy: Core) => void>;
  }
  function installLayoutEngineSpies(cy: Core): LayoutEngineSpies {
    const spies: LayoutEngineSpies = {
      fit: vi.fn(),
      layout: vi.fn(),
      layoutRun: vi.fn(),
      layoutAndPack: vi
        .spyOn(layoutEngine, 'layoutAndPackComponents')
        .mockImplementation(() => undefined),
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

  it('(m2) re-fits the camera on each structural change so all components stay framed', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(spies.fit).toHaveBeenCalledTimes(1);
    // A second (disconnected) node grows the structure and re-packs the
    // canvas, so the camera must re-fit to keep the new component in view
    // — the one-shot fit otherwise stayed zoomed on the first component.
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    expect(spies.fit).toHaveBeenCalledTimes(2);
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
    const firstEvents: readonly Event[] = [
      nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
    ];
    const view = render(graphTree([], cyRef));
    if (captured === null) throw new Error('cy instance not captured (first mount)');
    const firstSpies = installLayoutEngineSpies(captured);
    act(() => {
      view.rerender(graphTree(firstEvents, cyRef));
    });
    expect(firstSpies.fit).toHaveBeenCalledTimes(1);
    // Unmount destroys the cy instance and the mount-effect cleanup
    // resets `hasFitOnceRef.current = false`. A fresh mount produces a
    // fresh cy instance and a fresh fit-once gate.
    act(() => {
      view.unmount();
    });
    captured = null;
    const view2 = render(graphTree([], cyRef));
    if (captured === null) throw new Error('cy instance not captured (remount)');
    const secondSpies = installLayoutEngineSpies(captured);
    act(() => {
      view2.rerender(graphTree(firstEvents, cyRef));
    });
    expect(secondSpies.fit).toHaveBeenCalledTimes(1);
  });

  it('(p) runs the component layout-and-pack pass on the first non-empty render', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    // The element-sync effect delegates layout to `layoutAndPackComponents`
    // (per-component breadthfirst + 2D packing). The breadthfirst option
    // shape + the deterministic roots are pinned directly in
    // `layoutOptions.test.ts`; here we pin that the effect invokes it,
    // once, against the live cy instance.
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(1);
    expect(spies.layoutAndPack).toHaveBeenCalledWith(cy);
  });

  it('(p2) re-runs the layout when a new EDGE connects existing nodes (tidy-up on connect)', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    // Two truly-new nodes → two layout passes so far.
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(2);
    // An edge between the two EXISTING nodes introduces no new node, but
    // it merges two components into one and re-tiers the hierarchy — so it
    // must trigger a third layout pass (the "tidy up on edge add" fix).
    seedEvent(
      edgeCreatedEvent({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    );
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(3);
  });

  it('(p3) does NOT re-run the layout on a pure decoration tick (no new node or edge)', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(1);
    // A classify proposal + commit flips the node's kind label but adds
    // no node or edge id → same structure → no re-layout.
    seedEvent(
      classifyProposalEvent({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }));
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(1);
  });

  it('(p4) re-runs the layout when walking BACKWARDS removes a node or edge', () => {
    const result = renderView();
    const cy = result.getCy();
    const spies = installLayoutEngineSpies(cy);
    // Build up: node A, node B, edge A→B — three structural changes.
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
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(3);
    // Walk back one step (drop the edge-created event): the edge id is
    // removed from the graph → structural change → re-tidy.
    const withoutEdge = currentEvents.slice(0, 2);
    act(() => {
      rerenderWithEvents?.(withoutEdge);
    });
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(4);
    // Walk back again (drop node B): a node removal also re-tidies.
    const onlyNodeA = currentEvents.slice(0, 1);
    act(() => {
      rerenderWithEvents?.(onlyNodeA);
    });
    expect(spies.layoutAndPack).toHaveBeenCalledTimes(5);
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

  // ---------------------------------------------------------------
  // aud_agreed_styling — per-rollup agreed-state selector entries on
  // STYLESHEET. Structural-only assertions. The mount-time
  // `cy.getElementById(id).style('border-color')` assertions the
  // refinement also scopes defer to `aud_proposed_styling` — the
  // projection-time `data.rollupStatus` emission is owned there.
  // ---------------------------------------------------------------

  it("(w) STYLESHEET carries a node[rollupStatus = 'agreed'] entry with slate-700 border-color", () => {
    const style = findStylesheetEntry("node[rollupStatus = 'agreed']");
    expect(style['border-color']).toBe('#334155');
  });

  it("(x) STYLESHEET carries an edge[rollupStatus = 'agreed'] entry with slate-700 line and target-arrow color", () => {
    const style = findStylesheetEntry("edge[rollupStatus = 'agreed']");
    expect(style['line-color']).toBe('#334155');
    expect(style['target-arrow-color']).toBe('#334155');
  });

  // ---------------------------------------------------------------
  // aud_proposed_styling — proposed-state per-rollup selector entries
  // on STYLESHEET. Structural pair + mount-time computed-style pair.
  // ---------------------------------------------------------------

  it("(y) STYLESHEET carries a node[rollupStatus = 'proposed'] entry with dashed border and 0.6 opacity", () => {
    const style = findStylesheetEntry("node[rollupStatus = 'proposed']");
    expect(style['border-style']).toBe('dashed');
    expect(style.opacity).toBe(0.6);
  });

  it("(z) STYLESHEET carries an edge[rollupStatus = 'proposed'] entry with dashed line and 0.6 opacity", () => {
    const style = findStylesheetEntry("edge[rollupStatus = 'proposed']");
    expect(style['line-style']).toBe('dashed');
    expect(style.opacity).toBe(0.6);
  });

  it('(aa) a node whose rollupStatus resolves to "proposed" carries the proposed-state computed style', () => {
    // A lone `node-created` produces facetStatuses with `wording:
    // 'proposed'` (per ADR 0030 §4: wording seeded inline; no votes,
    // 0 current participants → Rule 8). The rollup priority surfaces
    // 'proposed', and Cytoscape's `node[rollupStatus = 'proposed']`
    // selector matches.
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('rollupStatus')).toBe('proposed');
    expect(cy.getElementById(NODE_A).style('border-style')).toBe('dashed');
    expect(Number(cy.getElementById(NODE_A).style('opacity'))).toBe(0.6);
  });

  it('(bb) an edge whose rollupStatus resolves to "proposed" carries the proposed-state computed style', () => {
    // An `edge-created` seeds the shape facet inline (per ADR 0030 §5):
    // shape = 'proposed' (no votes, 0 current participants → Rule 8).
    // The rollup priority surfaces 'proposed'.
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    const cy = result.getCy();
    expect(cy.getElementById(EDGE_A).data('rollupStatus')).toBe('proposed');
    expect(cy.getElementById(EDGE_A).style('line-style')).toBe('dashed');
    expect(Number(cy.getElementById(EDGE_A).style('opacity'))).toBe(0.6);
  });

  // ---------------------------------------------------------------
  // aud_agreed_styling_mount_assertions — agreed-state mount-time
  // computed-style pins. Fires Rule 7 of facetStatus.ts (every current
  // participant voted agree on the current candidate); asserts that
  // the live Cytoscape instance actually resolves the slate-700
  // override through the `[rollupStatus = 'agreed']` selectors.
  // ---------------------------------------------------------------

  it('(cc) a node whose rollupStatus resolves to "agreed" carries the agreed-state computed style', () => {
    // Smallest event sequence that pushes the rollup to 'agreed' on a
    // node: one participant joined, the node is created (which inline-
    // seeds the `wording` facet candidate per ADR 0030 §4), and the
    // joined participant casts a facet-keyed `agree` vote on (node,
    // wording). With one current participant and one agree vote,
    // Rule 7 surfaces `wording = 'agreed'`; no other facet appears in
    // the record (no classification / substance proposal landed), so
    // `cardRollupStatus` returns 'agreed' and `data.rollupStatus` is
    // 'agreed' on the projected element. (Adding a classify-node
    // proposal+vote alone would leave wording at 'proposed', which by
    // ROLLUP_PRIORITY would override classification's 'agreed' and
    // surface 'proposed' — wording is the seeded-inline facet that
    // must reach 'agreed' for the rollup to flip.)
    const result = renderView();
    seedEvent(participantJoinedEvent({ sequence: 1, userId: PARTICIPANT_A, role: 'debater-A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      voteEvent({
        sequence: 3,
        entityKind: 'node',
        entityId: NODE_A,
        facet: 'wording',
        participant: PARTICIPANT_A,
        vote: 'agree',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('rollupStatus')).toBe('agreed');
    expect(cy.getElementById(NODE_A).style('border-color')).toBe('rgb(51,65,85)');
  });

  it('(dd) an edge whose rollupStatus resolves to "agreed" carries the agreed-state computed style', () => {
    // Smallest event sequence that fires Rule 7 for the edge's
    // `shape` facet: one participant joined, the two endpoint nodes
    // are created, the edge is created (which inline-seeds the
    // `shape` facet candidate per ADR 0030 §5), and the participant
    // casts a facet-keyed `agree` vote on the (edge, shape) candidate.
    // With one current participant and one agree vote, Rule 7
    // surfaces `shape = 'agreed'`; the rollup priority then sets
    // `data.rollupStatus === 'agreed'`.
    const result = renderView();
    seedEvent(participantJoinedEvent({ sequence: 1, userId: PARTICIPANT_A, role: 'debater-A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 3, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 4, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    seedEvent(
      voteEvent({
        sequence: 5,
        entityKind: 'edge',
        entityId: EDGE_A,
        facet: 'shape',
        participant: PARTICIPANT_A,
        vote: 'agree',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(EDGE_A).data('rollupStatus')).toBe('agreed');
    expect(cy.getElementById(EDGE_A).style('line-color')).toBe('rgb(51,65,85)');
  });

  // ---------------------------------------------------------------
  // aud_disputed_styling — per-rollup disputed-state selector entries
  // on STYLESHEET. Structural pair + mount-time computed-style pair.
  // Mount-time cases land inline (the projection-time emission they
  // require already shipped via `aud_proposed_styling`). Rule 5 of
  // facetStatus.ts fires on any current participant's `dispute` vote.
  // ---------------------------------------------------------------

  it("(ee) STYLESHEET carries a node[rollupStatus = 'disputed'] entry with rose-600 border-color and border-width 3", () => {
    const style = findStylesheetEntry("node[rollupStatus = 'disputed']");
    expect(style['border-color']).toBe('#e11d48');
    expect(style['border-width']).toBe(3);
  });

  it("(ff) STYLESHEET carries an edge[rollupStatus = 'disputed'] entry with rose-600 line and target-arrow color", () => {
    const style = findStylesheetEntry("edge[rollupStatus = 'disputed']");
    expect(style['line-color']).toBe('#e11d48');
    expect(style['target-arrow-color']).toBe('#e11d48');
  });

  it('(gg) a node whose rollupStatus resolves to "disputed" carries the disputed-state computed style', () => {
    // Smallest event sequence that fires Rule 5 on a node: one
    // participant joined, the node is created (which inline-seeds the
    // `wording` facet candidate per ADR 0030 §4), and the joined
    // participant casts a facet-keyed `dispute` vote on (node,
    // wording). Rule 5 surfaces `wording = 'disputed'`; `wording` is
    // the only facet in the record, so `cardRollupStatus` returns
    // 'disputed' and `data.rollupStatus` is 'disputed' on the
    // projected element.
    const result = renderView();
    seedEvent(participantJoinedEvent({ sequence: 1, userId: PARTICIPANT_A, role: 'debater-A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      voteEvent({
        sequence: 3,
        entityKind: 'node',
        entityId: NODE_A,
        facet: 'wording',
        participant: PARTICIPANT_A,
        vote: 'dispute',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('rollupStatus')).toBe('disputed');
    expect(cy.getElementById(NODE_A).style('border-color')).toBe('rgb(225,29,72)');
    expect(parseFloat(String(cy.getElementById(NODE_A).style('border-width')))).toBe(3);
  });

  it('(hh) an edge whose rollupStatus resolves to "disputed" carries the disputed-state computed style', () => {
    // Smallest event sequence that fires Rule 5 on an edge: one
    // participant joined, the two endpoint nodes are created, the
    // edge is created (which inline-seeds the `shape` facet candidate
    // per ADR 0030 §5), and the participant casts a facet-keyed
    // `dispute` vote on the (edge, shape) candidate. Rule 5 surfaces
    // `shape = 'disputed'`; the rollup priority then sets
    // `data.rollupStatus === 'disputed'`.
    const result = renderView();
    seedEvent(participantJoinedEvent({ sequence: 1, userId: PARTICIPANT_A, role: 'debater-A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 3, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 4, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    seedEvent(
      voteEvent({
        sequence: 5,
        entityKind: 'edge',
        entityId: EDGE_A,
        facet: 'shape',
        participant: PARTICIPANT_A,
        vote: 'dispute',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(EDGE_A).data('rollupStatus')).toBe('disputed');
    expect(cy.getElementById(EDGE_A).style('line-color')).toBe('rgb(225,29,72)');
    expect(cy.getElementById(EDGE_A).style('target-arrow-color')).toBe('rgb(225,29,72)');
  });

  // ---------------------------------------------------------------
  // aud_meta_disagreement_split — per-rollup meta-disagreement-state
  // selector entries on STYLESHEET. Structural pair + mount-time
  // computed-style pair. Mount-time cases land inline (the projection-
  // time emission they require already shipped via
  // `aud_proposed_styling`). Rule 1 of facetStatus.ts short-circuits on
  // any `meta-disagreement-marked` event with `target: 'facet'`.
  // ---------------------------------------------------------------

  it("(oo) STYLESHEET carries a node[rollupStatus = 'meta-disagreement'] entry with double border-style and violet-600 border-color", () => {
    const style = findStylesheetEntry("node[rollupStatus = 'meta-disagreement']");
    expect(style['border-style']).toBe('double');
    expect(style['border-color']).toBe('#7c3aed');
  });

  it("(pp) STYLESHEET carries an edge[rollupStatus = 'meta-disagreement'] entry with violet-600 line and target-arrow color", () => {
    const style = findStylesheetEntry("edge[rollupStatus = 'meta-disagreement']");
    expect(style['line-color']).toBe('#7c3aed');
    expect(style['target-arrow-color']).toBe('#7c3aed');
  });

  it('(qq) a node whose rollupStatus resolves to "meta-disagreement" carries the meta-disagreement-state computed style', () => {
    // Smallest event sequence that fires Rule 1 on a node: the node is
    // created (which inline-seeds the `wording` facet candidate per
    // ADR 0030 §4), then a `meta-disagreement-marked` event with
    // `target: 'facet'` is recorded against (node, wording). Rule 1
    // short-circuits `wording = 'meta-disagreement'`; `wording` is the
    // only facet in the record, so `cardRollupStatus` returns
    // 'meta-disagreement' and `data.rollupStatus` is
    // 'meta-disagreement' on the projected element.
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      metaDisagreementFacetEvent({
        sequence: 2,
        entityKind: 'node',
        entityId: NODE_A,
        facet: 'wording',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(NODE_A).data('rollupStatus')).toBe('meta-disagreement');
    expect(cy.getElementById(NODE_A).style('border-color')).toBe('rgb(124,58,237)');
    expect(cy.getElementById(NODE_A).style('border-style')).toBe('double');
  });

  it('(rr) an edge whose rollupStatus resolves to "meta-disagreement" carries the meta-disagreement-state computed style', () => {
    // Smallest event sequence that fires Rule 1 on an edge: the two
    // endpoint nodes are created, the edge is created (which inline-
    // seeds the `shape` facet candidate per ADR 0030 §5), then a
    // `meta-disagreement-marked` event with `target: 'facet'` is
    // recorded against (edge, shape). Rule 1 short-circuits
    // `shape = 'meta-disagreement'`; the rollup priority then sets
    // `data.rollupStatus === 'meta-disagreement'`.
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    seedEvent(
      metaDisagreementFacetEvent({
        sequence: 4,
        entityKind: 'edge',
        entityId: EDGE_A,
        facet: 'shape',
      }),
    );
    const cy = result.getCy();
    expect(cy.getElementById(EDGE_A).data('rollupStatus')).toBe('meta-disagreement');
    expect(cy.getElementById(EDGE_A).style('line-color')).toBe('rgb(124,58,237)');
    expect(cy.getElementById(EDGE_A).style('target-arrow-color')).toBe('rgb(124,58,237)');
  });

  // ---------------------------------------------------------------
  // aud_decomposition_animation — `node[?decomposed]` selector entry.
  // Structural-only assertions on the STYLESHEET array. The projection-
  // time stamping of `data.decomposed: true` at decompose / interpretive-
  // split commit is pinned in `projectGraph.test.ts`; the per-render
  // class gate is pinned in `DecompositionFadeOverlay.test.tsx`.
  // ---------------------------------------------------------------

  it('(dec-ss-a) STYLESHEET carries a node[?decomposed] entry with opacity 0.15', () => {
    const style = findStylesheetEntry('node[?decomposed]');
    expect(style.opacity).toBe(0.15);
  });

  it('(dec-ss-b) the node[?decomposed] entry sits AFTER the per-rollupStatus entries', () => {
    const selectors = (
      STYLESHEET as unknown as ReadonlyArray<{ selector: string; style: Record<string, unknown> }>
    ).map((e) => e.selector);
    const decomposedIdx = selectors.indexOf('node[?decomposed]');
    const metaDisagreementNodeIdx = selectors.indexOf("node[rollupStatus = 'meta-disagreement']");
    const metaDisagreementEdgeIdx = selectors.indexOf("edge[rollupStatus = 'meta-disagreement']");
    expect(decomposedIdx).toBeGreaterThan(metaDisagreementNodeIdx);
    expect(decomposedIdx).toBeGreaterThan(metaDisagreementEdgeIdx);
  });

  // ---------------------------------------------------------------
  // aud_per_facet_visualization — structural assertions on the new
  // wrapper + overlay-as-sibling mount. The overlay's own mount
  // lifecycle, subscription set, and per-element placement are pinned
  // in `PerFacetPillOverlay.test.tsx`.
  // ---------------------------------------------------------------

  it('(ii) renders the audience-graph-root-wrapper as parent of audience-graph-root', () => {
    renderView();
    const wrapper = screen.getByTestId('audience-graph-root-wrapper');
    const inner = screen.getByTestId('audience-graph-root');
    expect(wrapper.contains(inner)).toBe(true);
  });

  it('(jj) the wrapper carries the relative + h-full + w-full classNames (positioning ancestor)', () => {
    renderView();
    const wrapper = screen.getByTestId('audience-graph-root-wrapper');
    const className = wrapper.getAttribute('class') ?? '';
    expect(className).toContain('relative');
    expect(className).toContain('h-full');
    expect(className).toContain('w-full');
  });

  // ---------------------------------------------------------------
  // aud_axiom_mark_decoration — wrapper hosts both overlays as
  // siblings; integration cases assert the projection-to-badge-row
  // path lights up when a committed axiom-mark lands on a node.
  // ---------------------------------------------------------------

  function axiomMarkProposalEvent(opts: {
    sequence: number;
    envelopeId: string;
    nodeId: string;
    participantId: string;
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: opts.participantId,
      payload: {
        proposal: {
          kind: 'axiom-mark',
          node_id: opts.nodeId,
          participant: opts.participantId,
        },
      },
      createdAt: '2026-05-27T00:00:00.000Z',
    };
  }

  const AX_PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
  const AX_PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
  const AX_PROPOSAL_A = '00000000-0000-4000-8000-0000000000d1';
  const AX_PROPOSAL_B = '00000000-0000-4000-8000-0000000000d2';

  it('(ll) the wrapper hosts the axiom-mark overlay as a sibling of audience-graph-root', () => {
    renderView();
    const wrapper = screen.getByTestId('audience-graph-root-wrapper');
    const inner = screen.getByTestId('audience-graph-root');
    const axiomOverlay = screen.getByTestId('audience-axiom-mark-overlay');
    expect(wrapper.contains(inner)).toBe(true);
    expect(wrapper.contains(axiomOverlay)).toBe(true);
  });

  it('(mm) a node with a committed axiom-mark mounts a [data-axiom-mark-row] child carrying the matching participant id', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 2,
        envelopeId: AX_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: AX_PARTICIPANT_A,
      }),
    );
    seedEvent(commitEvent({ sequence: 3, proposalEnvelopeId: AX_PROPOSAL_A }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = screen.getByTestId('audience-axiom-mark-overlay');
    const rows = overlay.querySelectorAll('[data-axiom-mark-row]');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = Array.from(rows).find((r) => r.getAttribute('data-element-id') === NODE_A);
    expect(row).toBeTruthy();
    const badges = row?.querySelectorAll('[data-testid^="axiom-mark-badge-"]');
    expect(badges?.length).toBe(1);
    expect(badges?.[0]?.getAttribute('data-participant-id')).toBe(AX_PARTICIPANT_A);
  });

  it('(nn) two participants marking the same node produce two distinct badges in commit-arrival order', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 2,
        envelopeId: AX_PROPOSAL_A,
        nodeId: NODE_A,
        participantId: AX_PARTICIPANT_A,
      }),
    );
    seedEvent(
      axiomMarkProposalEvent({
        sequence: 3,
        envelopeId: AX_PROPOSAL_B,
        nodeId: NODE_A,
        participantId: AX_PARTICIPANT_B,
      }),
    );
    seedEvent(commitEvent({ sequence: 4, proposalEnvelopeId: AX_PROPOSAL_A }));
    seedEvent(commitEvent({ sequence: 5, proposalEnvelopeId: AX_PROPOSAL_B }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = screen.getByTestId('audience-axiom-mark-overlay');
    const row = Array.from(overlay.querySelectorAll('[data-axiom-mark-row]')).find(
      (r) => r.getAttribute('data-element-id') === NODE_A,
    );
    expect(row).toBeTruthy();
    const badges = row?.querySelectorAll('[data-testid^="axiom-mark-badge-"]');
    expect(badges?.length).toBe(2);
    const participantIds = Array.from(badges ?? []).map((b) =>
      b.getAttribute('data-participant-id'),
    );
    expect(participantIds).toEqual([AX_PARTICIPANT_A, AX_PARTICIPANT_B]);
  });

  it('(kk) a statement node carries the localized step-pill model on its cy data (memo → html-label wiring)', () => {
    // The per-node HTML (`cytoscape-node-html-label`) renders from
    // `data.stepModel`, which the projection memo stamps. A lone
    // `node-created` → `facetStatuses.wording: 'proposed'` (open), so the
    // current step is `wording` with no candidate value.
    const result = renderView();
    const cy = result.getCy();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const stepModel = cy.getElementById(NODE_A).data('stepModel') as
      | { kind: string; facet?: string }
      | undefined;
    expect(stepModel).toBeDefined();
    expect(stepModel?.kind).toBe('step');
    expect(stepModel?.facet).toBe('wording');
  });

  // ---------------------------------------------------------------
  // aud_annotation_rendering — wrapper hosts the annotation overlay as
  // a third sibling; integration cases assert the projection-to-
  // annotation-row path lights up when a committed annotation lands on
  // a node.
  // ---------------------------------------------------------------

  function annotationCreatedEvent(opts: {
    sequence: number;
    annotationId: string;
    kind: AnnotationKind;
    content?: string;
    targetNodeId: string | null;
    targetEdgeId: string | null;
  }): Event {
    return {
      id: `00000000-0000-4000-8000-${(0x800 + opts.sequence).toString(16).padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'annotation-created',
      actor: ACTOR,
      payload: {
        annotation_id: opts.annotationId,
        kind: opts.kind,
        content: opts.content ?? 'annotation body',
        target_node_id: opts.targetNodeId,
        target_edge_id: opts.targetEdgeId,
        created_by: ACTOR,
        created_at: '2026-05-28T00:00:00.000Z',
      },
      createdAt: '2026-05-28T00:00:00.000Z',
    };
  }

  const ANN_ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa101';
  const ANN_ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa102';

  it('(ss) the wrapper hosts the axiom-mark and annotation overlays as siblings of audience-graph-root', () => {
    renderView();
    const wrapper = screen.getByTestId('audience-graph-root-wrapper');
    const inner = screen.getByTestId('audience-graph-root');
    const axiomOverlay = screen.getByTestId('audience-axiom-mark-overlay');
    const annotationOverlay = screen.getByTestId('audience-annotation-overlay');
    expect(wrapper.contains(inner)).toBe(true);
    expect(wrapper.contains(axiomOverlay)).toBe(true);
    expect(wrapper.contains(annotationOverlay)).toBe(true);
  });

  it('(tt) a node with a committed annotation mounts a [data-annotation-row] child carrying the matching annotation-kind badge', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 2,
        annotationId: ANN_ANNO_1,
        kind: 'note',
        content: 'see also F-003',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = screen.getByTestId('audience-annotation-overlay');
    const rows = overlay.querySelectorAll('[data-annotation-row]');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = Array.from(rows).find((r) => r.getAttribute('data-element-id') === NODE_A);
    expect(row).toBeTruthy();
    const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
    expect(badges?.length).toBe(1);
    expect(badges?.[0]?.getAttribute('data-annotation-kind')).toBe('note');
    expect(badges?.[0]?.getAttribute('data-testid')).toBe(
      `audience-annotation-badge-${ANN_ANNO_1}`,
    );
  });

  it('(uu) two annotations on the same node produce two distinct badges in commit-arrival order', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 2,
        annotationId: ANN_ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    seedEvent(
      annotationCreatedEvent({
        sequence: 3,
        annotationId: ANN_ANNO_2,
        kind: 'reframe',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = screen.getByTestId('audience-annotation-overlay');
    const row = Array.from(overlay.querySelectorAll('[data-annotation-row]')).find(
      (r) => r.getAttribute('data-element-id') === NODE_A,
    );
    expect(row).toBeTruthy();
    const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
    expect(badges?.length).toBe(2);
    const ids = Array.from(badges ?? []).map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual([
      `audience-annotation-badge-${ANN_ANNO_1}`,
      `audience-annotation-badge-${ANN_ANNO_2}`,
    ]);
    const kinds = Array.from(badges ?? []).map((b) => b.getAttribute('data-annotation-kind'));
    expect(kinds).toEqual(['note', 'reframe']);
  });

  // ---------------------------------------------------------------
  // aud_annotation_rendering_edges — edge-branch projection-to-
  // annotation-row integration. Asserts the overlay lights up when a
  // committed annotation lands on an edge, and that the symmetric
  // mixed (node + edge) case mounts one row per element.
  // ---------------------------------------------------------------

  const ANN_EDGE_ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa201';
  const ANN_EDGE_ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa202';

  it('(vv) an edge with a committed annotation mounts a [data-annotation-row] keyed on the edge id', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 4,
        annotationId: ANN_EDGE_ANNO_1,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = screen.getByTestId('audience-annotation-overlay');
    const row = Array.from(overlay.querySelectorAll('[data-annotation-row]')).find(
      (r) => r.getAttribute('data-element-id') === EDGE_A,
    );
    expect(row).toBeTruthy();
    const badges = row?.querySelectorAll('[data-testid^="audience-annotation-badge-"]');
    expect(badges?.length).toBeGreaterThanOrEqual(1);
    expect(badges?.[0]?.getAttribute('data-annotation-kind')).toBe('reframe');
    expect(badges?.[0]?.getAttribute('data-testid')).toBe(
      `audience-annotation-badge-${ANN_EDGE_ANNO_1}`,
    );
  });

  // ---------------------------------------------------------------
  // aud_render_annotation_endpoint_edges — annotation graph-node +
  // host pseudo-edge structural pins on STYLESHEET + mount-time
  // computed-style regression cover. The projection-time emission +
  // mutual-exclusion logic is pinned in `projectGraph.test.ts`; the
  // helpers themselves are pinned in `annotations.test.ts`; this
  // layer asserts what Cytoscape resolves at mount.
  // ---------------------------------------------------------------

  it("(aep-ss-a) STYLESHEET carries a node[nodeKind = 'annotation'] entry with round-tag shape and amber baseline", () => {
    const style = findStylesheetEntry("node[nodeKind = 'annotation']");
    expect(style.shape).toBe('round-tag');
    expect(style.width).toBe(140);
    expect(style.height).toBe(48);
    expect(style['background-color']).toBe('#fef3c7');
    expect(style['border-color']).toBe('#92400e');
  });

  it("(aep-ss-b) STYLESHEET carries an annotationKind = 'reframe' override with the violet palette", () => {
    const style = findStylesheetEntry("node[nodeKind = 'annotation'][annotationKind = 'reframe']");
    expect(style['border-color']).toBe('#4c1d95');
    expect(style['background-color']).toBe('#ede9fe');
  });

  it("(aep-ss-c) STYLESHEET carries an edge[entityRole = 'annotation-host'] entry with dashed slate-300 line and no arrow", () => {
    const style = findStylesheetEntry("edge[entityRole = 'annotation-host']");
    expect(style['line-style']).toBe('dashed');
    expect(style['line-color']).toBe('#cbd5e1');
    expect(style['target-arrow-shape']).toBe('none');
    expect(style.label).toBe('');
  });

  it('(aep-mm-a) a statement node continues to render with the baseline (no annotation-selector bleed)', () => {
    const result = renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    const cy = result.getCy();
    const node = cy.getElementById(NODE_A);
    expect(node.data('nodeKind')).toBe('statement');
    expect(node.style('shape')).toBe('round-rectangle');
  });

  it('(ww) a session with one node-targeted + one edge-targeted annotation mounts two distinct rows', async () => {
    renderView();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B' }));
    seedEvent(edgeCreatedEvent({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }));
    seedEvent(
      annotationCreatedEvent({
        sequence: 4,
        annotationId: ANN_EDGE_ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    );
    seedEvent(
      annotationCreatedEvent({
        sequence: 5,
        annotationId: ANN_EDGE_ANNO_2,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = screen.getByTestId('audience-annotation-overlay');
    const rows = Array.from(overlay.querySelectorAll('[data-annotation-row]'));
    const elementIds = rows.map((r) => r.getAttribute('data-element-id'));
    expect(elementIds).toContain(NODE_A);
    expect(elementIds).toContain(EDGE_A);
    const nodeRow = rows.find((r) => r.getAttribute('data-element-id') === NODE_A);
    const edgeRow = rows.find((r) => r.getAttribute('data-element-id') === EDGE_A);
    expect(
      nodeRow?.querySelector(`[data-testid="audience-annotation-badge-${ANN_EDGE_ANNO_1}"]`),
    ).not.toBeNull();
    expect(
      edgeRow?.querySelector(`[data-testid="audience-annotation-badge-${ANN_EDGE_ANNO_2}"]`),
    ).not.toBeNull();
  });
});
