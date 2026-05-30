// `<GraphView>` — Cytoscape-powered read-mostly graph for the
// participant's operate route.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
// Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//              (Stylesheet grows 14 per-status selectors per Decision §1;
//              the elements memo runs `computeFacetStatuses(events)` and
//              threads the index into `projectGraph`; the render returns
//              the existing graph-root div AND a sibling `<ul>` test
//              mirror so DOM-end tests can assert against the per-entity
//              status the Cytoscape canvas paints — Decision §4 covers
//              the testability rationale.)
// Refinement: tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//              (Stylesheet grows ONE `node[?isAxiom]` overlay selector
//              per Decision §3 — paints `border-style: 'double'` +
//              `border-width: 3` on top of the per-status border-color /
//              fill / opacity. A third `useMemo` derives
//              `axiomMarkIndex = groupAxiomMarksByNode(projectAxiomMarks(events))`
//              and threads it into `projectGraph` as the third argument.
//              The mirror `<li participant-node-status>` grows a
//              `data-is-axiom="true|false"` attribute per Decision §5.)
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//              (Stylesheet grows TWO selectors per Decision §3:
//              `node[?hasAnnotation]` paints an amber `overlay-*` wash
//              over the node body; `edge[?hasAnnotation]` paints an
//              amber `underlay-*` halo + width bump on the edge stroke.
//              Two new `useMemo`s split a single
//              `projectAnnotations(events)` walk into
//              `nodeAnnotationIndex` + `edgeAnnotationIndex` and thread
//              them into `projectGraph` as the fourth and fifth
//              arguments. The mirror `<li participant-node-status>` AND
//              the mirror `<li participant-edge-status>` BOTH grow
//              `data-has-annotation="true|false"` +
//              `data-annotation-count="<n>"` attributes per Decision §5.
//              Symmetric across node + edge target kinds per Decision §1
//              — annotations target both per the wire schema XOR.)
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//              (Stylesheet grows FOUR selectors per Decision §3 — one per
//              `(target-kind × severity)` cell:
//              `node[diagnosticSeverity = "blocking"]` + advisory paint
//              amber border overrides; `edge[diagnosticSeverity = ...]`
//              paints an amber `underlay-*` halo + width bump on the
//              edge stroke. A sixth `useMemo` derives
//              `diagnosticHighlightIndex = projectDiagnosticHighlights(activeDiagnostics)`
//              from the participant-widened `activeDiagnostics` slot
//              and threads it into `projectGraph` as the sixth argument.
//              The mirror `<li participant-node-status>` AND
//              `<li participant-edge-status>` BOTH grow
//              `data-diagnostic-severity="blocking|advisory|none"` +
//              `data-diagnostic-kinds="<csv>"` attributes per Decision §5.
//              Symmetric across node + edge target kinds per Decision §1
//              — two of five surfaced kinds touch edges.)
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//              (Stylesheet grows FOUR selectors per Decision §3 — one per
//              `(target-kind × choice)` cell: `node[ownVote = "agree"]`
//              + `dispute` paint emerald / rose label-outline strokes;
//              `edge[ownVote = ...]` paints the same per-choice outline
//              on the edge midpoint label. A seventh `useMemo` derives
//              `ownVoteIndex = projectOwnVotes(events, currentParticipantId)`
//              and threads it into `projectGraph` as the seventh
//              argument. The component grows a new required
//              `currentParticipantId: string` prop (Decision §4 — the
//              auth-aware code stays in `<OperateRouteBody>`; the canvas
//              receives the resolved UUID). The mirror `<li
//              participant-node-status>` AND `<li participant-edge-status>`
//              BOTH grow a `data-own-vote="agree|dispute|none"`
//              attribute per Decision §5. Symmetric across node + edge
//              target kinds per Decision §1 — the wire `proposal`
//              family targets both via the `set-edge-substance`
//              sub-kind.)
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md
//              (Stylesheet UNCHANGED — the canvas-side dot row paints
//              OUTSIDE the Cytoscape canvas entirely, as a sibling DOM
//              `<OtherVotesOverlay>` component absolutely-positioned
//              inside the `participant-graph-root` containing block.
//              `participant-graph-root` grows `relative` to its
//              className so it becomes the overlay's positioning
//              ancestor; the overlay receives the live Cytoscape
//              `Core` handle via the `cyInstance` `useState` slot
//              (lifted from the existing `cyInstanceRef` per Decision §2).
//              The overlay reads `data.otherVotes` from each Cytoscape
//              element and paints one DOM row per element with
//              non-empty votes; per-arm color encoding only (emerald-500
//              agree, rose-500 dispute) per Decision §4. The DOM mirror
//              `<ul data-other-votes>` from the predecessor is
//              unchanged — the two surfaces are independent renderings
//              of the same per-voter data, deliberately not consolidated
//              per Decision §8.)
// Refinement: tasks/refinements/participant-ui/part_pan_zoom_tap.md
//              (Mount config grows 7 explicit flags per Decisions §1
//              + §2 + §3: `userPanningEnabled: true`, `userZoomingEnabled:
//              true`, `minZoom: MIN_ZOOM`, `maxZoom: MAX_ZOOM`,
//              `boxSelectionEnabled: false`, `selectionType: 'single'`,
//              `autoungrabify: true`. The one-shot mount effect also
//              calls `cy.on('tap', handleTap)` after mount and
//              `cy.removeListener('tap', handleTap)` in the cleanup;
//              `handleTap` is a module-scope exported function that
//              discriminates on `event.target` (core / node / edge)
//              and writes the selection through to `useSelectionStore`
//              while also syncing Cytoscape's internal `:selected`
//              set. `STYLESHEET` grows two new selectors —
//              `node:selected` (z-index bump + slight
//              `background-blacken` lightening) and `edge:selected`
//              (sky-500 line/arrow color override + width bump) —
//              claiming previously-unclaimed primitives so composition
//              with every prior layer stays clean. The localized
//              `elements` memo stamps a flat `selected: boolean` slot
//              on each Cytoscape data record. The DOM mirror grows a
//              `data-selected="true|false"` attribute on both `<li>`
//              row kinds, derived via the `selectedFlag` helper —
//              symmetric with the existing `axiomAttr` family per
//              Decision §7. A `window.__aConversaCyInstance` test
//              seam (gated on `import.meta.env.MODE === 'test'` OR a
//              `?aconversaTestMode=1` URL query parameter per
//              Decisions §8 + §9) exposes the live cy instance so the
//              Playwright spec can dispatch synthetic `cy.emit('tap',
//              ...)` events without coordinate arithmetic. The seam
//              never lights up in production browser sessions.)
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//              (Stylesheet UNCHANGED — Decision §3 ships DOM-mirror-only
//              for v0; canvas-side rendering is deferred to a future
//              polish leaf `part_other_vote_indicators_canvas_dots`.
//              An EIGHTH `useMemo` derives `othersVoteIndex =
//              projectOtherVotes(events, currentParticipantId)` and
//              threads it into `projectGraph` as the eighth argument.
//              The `currentParticipantId` prop is REUSED verbatim from
//              `part_own_vote_indicators` Decision §4 — no new prop,
//              no new threading. The mirror `<li participant-node-status>`
//              AND `<li participant-edge-status>` BOTH grow a nested
//              `<ul data-other-votes>` child carrying one
//              `<li data-other-vote data-voter-id="..." data-vote="...">`
//              per other voter (Decision §6 — explicit nested-list
//              rather than comma-separated attribute string, to keep
//              per-voter assertions composable in Playwright; empty
//              list still renders the `<ul>` with no children so the
//              absent-children probe matches `… ul[data-other-votes]
//              li` count of 0). Symmetric across node + edge target
//              kinds per Decision §1.)
// ADRs:
//   - 0004 (Cytoscape.js for the read-mostly participant tablet);
//   - 0024 (react-i18next + ICU — `methodology.kind.*` and
//           `methodology.edgeRole.<role>.label` are the only string
//           sources the view consumes);
//   - 0026 (host owns the WS provider; the surface consumes
//           `useWsStore` from its local singleton, which delegates to
//           the shell's `createDefaultWsStore`);
//   - 0027 (entity / facet layers are strictly separate; the projection
//           paints `node-created` events immediately, not at commit).
//
// Component shape (per the refinement's Component-shape section):
//
//   1. `useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS)`
//      yields the per-session event log. The module-scope frozen empty
//      array keeps the selector reference-stable in the no-events case
//      (Zustand's reference-equality bailout).
//   2. A first `useMemo` runs `computeFacetStatuses(events)` ONCE per
//      events change to produce the per-entity per-facet status index
//      `projectGraph` consumes.
//   3. A second `useMemo` projects the events into Cytoscape element
//      descriptors via the pure `projectGraph` function (threaded with
//      the facet-status index), then enriches each node with a
//      `kindLabel` (em-dash for unclassified, localized
//      `methodology.kind.<kind>` otherwise) and each edge with a
//      `roleLabel` (localized `methodology.edgeRole.<role>.label`).
//      Localization runs at projection time so the Cytoscape
//      stylesheet's `label: 'data(...)'` selector binding stays a pure
//      data read. The localized mapper carries through `rollupStatus`
//      and `facetStatuses` from each `projectGraph` element onto the
//      Cytoscape data record so the stylesheet's
//      `node[rollupStatus = '<status>']` selectors fire.
//   4. A one-shot `useEffect` mounts the Cytoscape instance into the
//      ref'd container; the cleanup destroys it on unmount.
//   5. A second `useEffect` synchronises the elements on every memo
//      tick — `cy.json({ elements })` is Cytoscape's bulk-replace path
//      followed by a `breadthfirst` layout pass when a truly-new
//      `node-created` id appears in the element set
//      (see `BREADTHFIRST_LAYOUT_OPTIONS` for why not `cose`).
//
// The component returns a React fragment containing the Cytoscape mount
// `<div>` AND a sibling `aria-hidden` `<ul>` test mirror — one `<li>`
// per emitted node and one per emitted edge, each carrying the
// per-entity rollup + per-facet status as `data-*` attributes the
// Vitest / Playwright suites assert against (Cytoscape paints to
// `<canvas>` by default; the canvas pixels are not DOM-queryable so
// the mirror is the testability seam). The mirror is invisible to
// users + screen readers (`aria-hidden="true"` + `sr-only`).

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
  type StylesheetJson,
} from 'cytoscape';
import { useTranslation } from 'react-i18next';

import { useSelectionStore, type Selection } from '../stores/selectionStore';
import { type Annotation } from './annotations';
import { type AxiomMark } from './axiomMarks';
import {
  type DiagnosticHighlight,
  type DiagnosticHighlightIndex,
  type FacetStatus,
  type FacetStatusIndex,
} from '@a-conversa/shell';
import { OtherVotesOverlay } from './OtherVotesOverlay';
import { type OwnVote, type OwnVoteIndex } from './ownVotes';
import { type OthersVoteIndex } from './otherVotes';
import { type ParticipantEdgeElement, type ParticipantNodeElement } from './projectGraph';

/**
 * Zoom-range bounds for the Cytoscape mount config, pinned per Decision §2
 * of `tasks/refinements/participant-ui/part_pan_zoom_tap.md`.
 *
 * Cytoscape's library defaults are `[1e-50, 1e50]` — unbounded, which
 * allows degenerate zoom levels (sub-pixel nodes at one extreme,
 * single-node-fills-viewport at the other). The empirical
 * `[0.1, 2.5]` range mirrors the moderator's `mod_pan_zoom`
 * calibration verbatim — same dagre-vs-cose layout span × viewport-size
 * ratio applies because the participant uses Cytoscape `width: 200,
 * height: 80` per `part_graph_render`'s STYLESHEET, and the close-read
 * 2.5x cap on a 200px-wide card matches the moderator's 2.5x cap on a
 * `max-w-[18rem]` (288px) card. Exported so `GraphView.test.tsx`
 * imports the same source-of-truth value the cy mount config consumes.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;

/**
 * Layout options for the new-node placement pass.
 *
 * Why `breadthfirst` and not the bundled `cose`: cytoscape.js's `cose`
 * extension has a known upstream defect — `cose.mjs` lines 329-330
 * assign each node's box width to its internal `height` field and
 * vice-versa, so cose's overlap detection, clipping-point geometry,
 * and repulsion forces all treat a `W × H` node as if it were
 * `H × W`. For the participant's `data(width) × data(height)` nodes
 * (per `part_layout_measured_dimensions` — wide-and-short in practice,
 * e.g. 240 × 56 for a single-line wording), the swap causes connected
 * nodes to settle at center-to-center distances sized for the wrong
 * axis, so the rendered bodies and edge midpoint labels overlap.
 *
 * `breadthfirst` is bundled (no new dependency) and natively respects
 * each node's `outerWidth()` / `outerHeight()` via `avoidOverlap` +
 * `spacingFactor`. It produces a layered top-to-bottom layout — the
 * direct analog of the moderator's `@dagrejs/dagre` choice (ADR 0025)
 * — so the two surfaces agree on the visual model: edges flow with
 * direction, layers separate parents from children.
 *
 * Layout-stability trade-off: unlike cose, `breadthfirst` recomputes
 * every node's position when it runs (it can't "settle around"
 * cached positions like force-directed layouts can). The existing
 * position cache in `GraphView.tsx` still pays its dust on the
 * common case (selection / vote / annotation / diagnostic flips
 * don't introduce new node ids → no layout pass → cached positions
 * preserved verbatim). On the rarer case of a new `node-created`
 * event, breadthfirst re-flows the whole graph deterministically.
 * The moderator's dagre `relayoutAll` has the same shape; the two
 * surfaces are again in step.
 */
export const BREADTHFIRST_LAYOUT_OPTIONS = {
  name: 'breadthfirst' as const,
  // Edges carry direction (statement roles supports / contradicts /
  // …); the canvas already paints `target-arrow-shape: 'triangle'`,
  // so the layout should honour that direction when picking layers.
  directed: true,
  // Layered top-to-bottom (vs concentric circles).
  circle: false,
  // Don't snap to a uniform grid — let `avoidOverlap` use the real
  // per-node footprint instead.
  grid: false,
  // `true` (default) — the layout reads `outerWidth()` /
  // `outerHeight()` for each node and refuses to place two nodes
  // close enough to overlap. This is the property `cose` lacks.
  avoidOverlap: true,
  // Slightly tighter than the library default `1.75`. Tablet
  // viewport real-estate is limited; 1.25 gives a visible gap between
  // layers + siblings without wasting space.
  spacingFactor: 1.25,
  // Labels are inside the node body (text-valign: center) so the
  // outer box already covers the visible footprint; including labels
  // again would double-count.
  nodeDimensionsIncludeLabels: false,
  // Default 30; explicit so future readers don't wonder.
  padding: 30,
  animate: false as const,
  // Don't auto-fit the viewport on layout — that would discard the
  // user's pan/zoom (`part_pan_zoom_tap` Decision §1) every time a
  // new node lands.
  fit: false,
};

/**
 * Cytoscape stylesheet — declared at module scope so the reference
 * stays stable across renders (mirroring the moderator's module-scope
 * `NODE_TYPES` idiom).
 *
 * The baseline `node` / `edge` selectors carry the `'none'` rollup
 * branch (Cytoscape selectors are cumulative — every node matches the
 * baseline AND its per-status branch, with later rules overriding
 * earlier ones). Per-status selectors then layer the
 * `border-style` / `border-color` / `background-color` / `opacity` /
 * `outline-*` overrides on top.
 *
 * The fixed `width: 200, height: 80` baseline addresses the
 * `width: 'label'` deprecation deferred by `part_graph_render` per
 * Decision §7 of the per-facet-state-styling refinement: keep the
 * numeric pair, lean on `text-wrap: 'wrap'` + `text-max-width: '180px'`
 * to make the wording fit within the 3-line budget the methodology's
 * "two short sentences" wording cap implies. Future visual-regression
 * work (`part_vr_state_styling`) can revisit if real-world wording
 * lengths break the 3-line budget.
 *
 * The per-status colour vocabulary maps verbatim from the moderator's
 * `PILL_STATUS_CLASSNAME` + `StatementNode` card-frame branches —
 * Decision §1 of this leaf's refinement walks through the mapping
 * table and the surface-specific adaptations (Cytoscape's
 * `outline-*` standing in for Tailwind's `ring-*`; the tinted fill
 * compensating for the lack of a true box-shadow ring).
 */
export const STYLESHEET: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      'background-color': '#ffffff',
      'border-width': 1,
      'border-color': '#cbd5e1',
      label: 'data(wording)',
      'text-wrap': 'wrap',
      // Per-node `text-max-width`: stamped onto `data.textMaxWidth` by
      // the projector via `computeNodeDimensions` so the wrap budget
      // tracks the per-node box width. Cytoscape coerces the numeric
      // data value to a `<n>px` string for its text-wrap engine.
      // Refinement: tasks/refinements/participant-ui/part_layout_measured_dimensions.md.
      'text-max-width': 'data(textMaxWidth)',
      color: '#0f172a',
      'text-valign': 'center',
      'text-halign': 'center',
      // Per-node box dimensions sourced from the projection layer's
      // `computeNodeDimensions(wording)` call. Closes the deferral from
      // `part_per_facet_state_styling` Decision §7 (which kept the
      // constant 200x80 baseline until per-node sizing landed) by
      // routing every node through Cytoscape's `data(...)` mapper. Both
      // the box dimensions and the text-max-width budget come from the
      // same projector output so the wrap engine and the layout engine
      // agree on the per-node footprint.
      // Refinement: tasks/refinements/participant-ui/part_layout_measured_dimensions.md.
      width: 'data(width)',
      height: 'data(height)',
      padding: '12px',
      'font-size': '12px',
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      'target-arrow-shape': 'triangle',
      label: 'data(roleLabel)',
      'font-size': '10px',
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      color: '#475569',
    },
  },
  // Per-status node branches — Decision §1 mapping table. Each branch
  // overrides border / fill / opacity on top of the baseline above;
  // the `'none'` rollup hits no override and stays at the baseline.
  {
    selector: 'node[rollupStatus = "proposed"]',
    style: {
      'border-style': 'dashed',
      'border-color': '#94a3b8', // slate-400
      'background-color': '#f8fafc', // slate-50 — slight tint
      opacity: 0.6,
    },
  },
  {
    selector: 'node[rollupStatus = "agreed"]',
    style: {
      'border-style': 'solid',
      'border-color': '#334155', // slate-700
      'background-color': '#ffffff',
      opacity: 1,
    },
  },
  {
    selector: 'node[rollupStatus = "disputed"]',
    style: {
      'border-style': 'solid',
      'border-color': '#e11d48', // rose-600
      'background-color': '#fff1f2', // rose-50 — slight tint
      'outline-color': '#f43f5e', // rose-500 — the "ring" analog
      'outline-width': 2,
      opacity: 1,
    },
  },
  {
    selector: 'node[rollupStatus = "meta-disagreement"]',
    style: {
      'border-style': 'double',
      'border-color': '#7c3aed', // violet-600
      'background-color': '#f5f3ff', // violet-50
      'outline-color': '#a78bfa', // violet-400
      'outline-width': 2,
      opacity: 1,
    },
  },
  {
    selector: 'node[rollupStatus = "committed"]',
    style: {
      'border-style': 'solid',
      'border-color': '#94a3b8', // slate-400 — closed-tone
      'background-color': '#ffffff',
      opacity: 0.9,
    },
  },
  {
    selector: 'node[rollupStatus = "withdrawn"]',
    style: {
      'border-style': 'dashed',
      'border-color': '#94a3b8', // slate-400 — retracted
      'background-color': '#f8fafc',
      opacity: 0.5,
    },
  },
  // Per-status edge branches — same vocabulary on the edge stroke; no
  // fill on edges. Cytoscape has no `double` line-style for edges, so
  // meta-disagreement uses solid violet (the colour carries the
  // signal; the violet hue is reserved on the surface for the
  // meta-disagreement layer).
  {
    selector: 'edge[rollupStatus = "proposed"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      opacity: 0.6,
    },
  },
  {
    selector: 'edge[rollupStatus = "agreed"]',
    style: {
      'line-style': 'solid',
      'line-color': '#334155',
      'target-arrow-color': '#334155',
      opacity: 1,
    },
  },
  {
    selector: 'edge[rollupStatus = "disputed"]',
    style: {
      'line-style': 'solid',
      'line-color': '#e11d48',
      'target-arrow-color': '#e11d48',
      opacity: 1,
    },
  },
  {
    selector: 'edge[rollupStatus = "meta-disagreement"]',
    style: {
      'line-style': 'solid',
      'line-color': '#7c3aed',
      'target-arrow-color': '#7c3aed',
      opacity: 1,
    },
  },
  {
    selector: 'edge[rollupStatus = "committed"]',
    style: {
      'line-style': 'solid',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      opacity: 0.9,
    },
  },
  {
    selector: 'edge[rollupStatus = "withdrawn"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      opacity: 0.5,
    },
  },
  // Axiom-mark overlay — Cytoscape's `[?<flag>]` selector matches when
  // `data.<flag>` is truthy. Composes WITH the per-status branches
  // above per Decision §3 of
  // `tasks/refinements/participant-ui/part_axiom_mark_decoration.md`:
  // the axiom overlay overrides `border-style` + `border-width`
  // WITHOUT touching `border-color` / `background-color` / `opacity` /
  // `outline-*` — those stay owned by the per-status branch beneath,
  // so the composition is "rollup paints colour + opacity; axiom
  // paints the double border on top". An axiom-marked `agreed` node
  // reads as "slate-700 double border 3px" (slate-700 from the
  // agreed branch; double-3 from this overlay). The one cross-layer
  // interaction worth noting: the `meta-disagreement` branch ALSO
  // uses `border-style: 'double'`; a node that is both
  // meta-disagreement AND axiom-marked composes to "violet double
  // border, width 3" — still unambiguous (violet = meta-disagreement;
  // bumped width = axiom emphasis), and the case is empirically rare.
  {
    selector: 'node[?isAxiom]',
    style: {
      'border-style': 'double',
      'border-width': 3,
    },
  },
  // Annotation overlay — Cytoscape's `[?<flag>]` selector matches when
  // `data.<flag>` is truthy. Composes WITH the per-status branches +
  // the axiom-mark overlay above per Decision §3 of
  // `tasks/refinements/participant-ui/part_annotation_render.md`:
  // the node side uses Cytoscape's `overlay-*` properties, which paint
  // a translucent layer OVER the node body without disturbing the
  // border / fill / opacity owned by the per-status branch beneath. An
  // amber-500 wash at 15% opacity reads as "this node carries
  // meta-commentary" while preserving the rollup signal. The hue
  // matches the moderator's `AnnotationBadge` palette
  // (`bg-amber-100 text-amber-900`) so the colour identity stays
  // consistent across surfaces for the eventual entity-detail-panel
  // hand-off.
  {
    selector: 'node[?hasAnnotation]',
    style: {
      'overlay-color': '#f59e0b', // amber-500
      'overlay-opacity': 0.15,
      'overlay-padding': 4,
    },
  },
  // Annotation overlay (edges). Cytoscape edges don't accept
  // `overlay-*` properties, so the signal layers via `underlay-*`
  // (an amber halo painted BEHIND the stroke) + a width bump (1 → 4).
  // The bumped width composes cleanly with the per-status `line-color`
  // beneath (a disputed annotated edge stays rose-600 but reads
  // thicker; an agreed annotated edge stays slate-700 but reads
  // thicker). Alternatives (linear-gradient stroke; dashed flip) were
  // rejected per Decision §3 because they would clobber the per-status
  // `line-color` / `line-style` the rollup branch owns.
  {
    selector: 'edge[?hasAnnotation]',
    style: {
      width: 4,
      'underlay-color': '#f59e0b', // amber-500
      'underlay-opacity': 0.25,
      'underlay-padding': 3,
    },
  },
  // Diagnostic-highlight overlay — per Decision §3 of
  // `tasks/refinements/participant-ui/part_diagnostic_highlights.md`.
  // Four selectors, one per `(target-kind × severity)` cell. Cytoscape's
  // `[<key> = "<value>"]` data-equality selector matches on the flat
  // `data.diagnosticSeverity` sibling slot (the selector grammar cannot
  // reach into nested `data.diagnosticHighlight.severity`; the localized
  // `elements` memo derives the flat slot from the nested object).
  //
  // Composition with the prior layers (per Decision §3): the diagnostic
  // ring REPLACES `border-color`/`border-width`/`border-opacity` on the
  // node body (overriding the per-status rollup colour because the
  // engine's structural signal outranks the agreement-state signal); it
  // does NOT touch `border-style`, so an axiom-marked AND diagnosed
  // node still reads as "double" (axiom-mark) at width 4 amber-700
  // (blocking). On edges the diagnostic uses `underlay-*` like the
  // annotation overlay; because diagnostic appears later in the
  // stylesheet, the diagnostic underlay wins when both fire on the
  // same edge.
  {
    selector: 'node[diagnosticSeverity = "blocking"]',
    style: {
      'border-color': '#b45309', // amber-700
      'border-width': 4,
      'border-opacity': 0.9,
    },
  },
  {
    selector: 'node[diagnosticSeverity = "advisory"]',
    style: {
      'border-color': '#fbbf24', // amber-400
      'border-width': 2,
      'border-opacity': 0.7,
    },
  },
  {
    selector: 'edge[diagnosticSeverity = "blocking"]',
    style: {
      width: 5,
      'underlay-color': '#b45309', // amber-700
      'underlay-opacity': 0.45,
      'underlay-padding': 4,
    },
  },
  {
    selector: 'edge[diagnosticSeverity = "advisory"]',
    style: {
      width: 3,
      'underlay-color': '#fbbf24', // amber-400
      'underlay-opacity': 0.3,
      'underlay-padding': 2,
    },
  },
  // Own-vote overlay — per Decision §3 of
  // `tasks/refinements/participant-ui/part_own_vote_indicators.md`.
  // Four selectors, one per `(target-kind × choice)` cell. Cytoscape's
  // `[<key> = "<value>"]` data-equality selector matches on the flat
  // `data.ownVote` field stamped by `projectGraph`'s `node-created` /
  // `edge-created` branches. `'none'` hits no override and stays at the
  // baseline (the label-outline stays unstyled).
  //
  // Composition with the prior layers (per Decision §3): the
  // own-vote signal paints `text-outline-*` — a colored stroke around
  // the label text — which none of the five prior overlays touch.
  // Border / background / outline / overlay / underlay are owned by
  // the rollup / axiom / annotation / diagnostic layers; `text-outline-*`
  // is the unclaimed family. Composition on a worst-case node
  // (axiom-marked + annotated + per-status disputed + blocking
  // diagnostic + local-participant disputed) reads as: rose-tinted
  // background (per-status) + amber overlay (annotation) + amber-700
  // double border at width 4 opacity 0.9 (diagnostic + axiom-mark
  // composed) + rose-600 label stroke at width 3 (own-vote).
  //
  // Per-choice color: emerald-500 (`#10b981`) for agree, matching the
  // moderator's `bg-emerald-500` per-arm convention; rose-600
  // (`#e11d48`) for dispute, matching the per-status `disputed`
  // border color AND the moderator's `bg-rose-500` per-arm fill.
  // Edge widths are smaller (2 vs 3) than node widths because the
  // edge midpoint label is smaller (10px vs 12px); the relative
  // scale stays the same.
  {
    selector: 'node[ownVote = "agree"]',
    style: {
      'text-outline-color': '#10b981', // emerald-500
      'text-outline-width': 3,
      'text-outline-opacity': 1,
    },
  },
  {
    selector: 'node[ownVote = "dispute"]',
    style: {
      'text-outline-color': '#e11d48', // rose-600
      'text-outline-width': 3,
      'text-outline-opacity': 1,
    },
  },
  {
    selector: 'edge[ownVote = "agree"]',
    style: {
      'text-outline-color': '#10b981', // emerald-500
      'text-outline-width': 2,
      'text-outline-opacity': 1,
    },
  },
  {
    selector: 'edge[ownVote = "dispute"]',
    style: {
      'text-outline-color': '#e11d48', // rose-600
      'text-outline-width': 2,
      'text-outline-opacity': 1,
    },
  },
  // New-proposal-arrival flash overlay — per Decision §6 of
  // `tasks/refinements/participant-ui/part_proposal_notification.md`.
  // Cytoscape's `[?<flag>]` selector matches when `data.<flag>` is
  // truthy. The flash uses `overlay-*` on nodes (same primitive the
  // annotation overlay uses, which lets the flash compose on top of
  // every prior border / fill / outline layer without clobbering them)
  // and `underlay-*` on edges (same primitive the annotation underlay
  // uses for the same composition reason). Amber-500 — same hue as the
  // moderator's coherency-hint pulse + the annotation overlay — so the
  // attention-attracting palette stays consistent across surfaces. The
  // brief opacity is intentional: peripheral-vision cue, not a
  // dominant decoration.
  //
  // The CSS-level pulse animation lives on the DOM mirror's
  // `data-flashing="true"` attribute (Tailwind `motion-safe:
  // animate-pulse` class applied conditionally); the Cytoscape canvas
  // shows the static amber overlay/underlay for the same window. The
  // mirror's animation honours `prefers-reduced-motion` via the
  // `motion-safe:` Tailwind variant.
  {
    selector: 'node[?isFlashing]',
    style: {
      'overlay-color': '#f59e0b', // amber-500 — matches annotation overlay hue
      'overlay-opacity': 0.35,
      'overlay-padding': 6,
    },
  },
  {
    selector: 'edge[?isFlashing]',
    style: {
      width: 5,
      'underlay-color': '#f59e0b', // amber-500
      'underlay-opacity': 0.5,
      'underlay-padding': 5,
    },
  },
  // Selected-state overlay — per Decision §4 of
  // `tasks/refinements/participant-ui/part_pan_zoom_tap.md`. Cytoscape's
  // built-in `:selected` pseudo-class fires when an element is in the
  // cy instance's selection set. The tap handler (`handleTap` below)
  // synchronises the cy selection set with the participant
  // `useSelectionStore` so the stylesheet's `:selected` pseudo and the
  // DOM mirror's `data-selected` attribute stay in lockstep.
  //
  // Composes with every prior layer because it claims previously-
  // unclaimed primitives for nodes (`z-index` and `background-blacken`,
  // neither touched by rollup / axiom / annotation / diagnostic / own-vote)
  // and uses recoverable overrides for edges (`line-color` /
  // `target-arrow-color` / `width` snap back to the per-status branch's
  // values when the element is unselected; Cytoscape's selector cascade
  // restores the prior values automatically because no `:selected`
  // selector matches anymore). The sky-500 hue matches the moderator's
  // `mod_selection` ring color for cross-surface visual consistency.
  {
    selector: 'node:selected',
    style: {
      'z-index': 10,
      'background-blacken': -0.15, // negative value lightens; subtle
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'z-index': 10,
      'line-color': '#0ea5e9', // sky-500
      'target-arrow-color': '#0ea5e9',
      width: 4,
    },
  },
  // Annotation graph-node branch — per Decision §4 of
  // `tasks/refinements/participant-ui/part_render_annotation_endpoint_edges.md`.
  // The skip-guard at `projectGraph.ts:503-516` previously dropped
  // annotation-endpoint edges because annotations had no graph-node id
  // to bind to; the projection-layer + Cytoscape now materialize an
  // annotation graph-node per referenced-annotation-id, and this
  // selector group paints those nodes distinctly from statement nodes.
  //
  // Round-tag shape (Cytoscape's `'round-tag'`) reads as "commentary"
  // rather than "statement"; amber-50 fill + amber-600 border match the
  // existing annotation overlay vocabulary; smaller font (12 vs 14)
  // signals visual subordinance to statement nodes. The per-status /
  // axiom-mark / vote / diagnostic selectors above continue to fire on
  // annotation nodes because the projector stamps sentinel defaults
  // (`rollupStatus: 'none'`, `isAxiom: false`, `ownVote: 'none'`,
  // `diagnosticHighlight: null`) per Decision §3 — and each of those
  // selectors only paints on non-sentinel values, so the composition
  // produces no cross-layer interference.
  {
    selector: 'node[nodeKind = "annotation"]',
    style: {
      shape: 'round-tag',
      'background-color': '#fef3c7', // amber-50
      'border-color': '#d97706', // amber-600
      'border-width': 1.5,
      'font-size': '12px',
    },
  },
  // Per-`annotationKind` palette overrides — matches the moderator's
  // `AnnotationBadge` four-color vocabulary so cross-surface identity
  // stays consistent. Each override claims `border-color` only; shape
  // + fill + font stay owned by the `node[nodeKind = "annotation"]`
  // baseline above.
  {
    selector: 'node[nodeKind = "annotation"][annotationKind = "note"]',
    style: {
      'border-color': '#d97706', // amber-600
    },
  },
  {
    selector: 'node[nodeKind = "annotation"][annotationKind = "reframe"]',
    style: {
      'border-color': '#7c3aed', // violet-600
    },
  },
  {
    selector: 'node[nodeKind = "annotation"][annotationKind = "scope-change"]',
    style: {
      'border-color': '#0d9488', // teal-600
    },
  },
  {
    selector: 'node[nodeKind = "annotation"][annotationKind = "stance"]',
    style: {
      'border-color': '#0284c7', // sky-600
    },
  },
];

export interface GraphViewProps {
  /**
   * The id of the session whose event log feeds the projection. Threaded
   * through purely as a stable identifier for the per-mount Cytoscape
   * lifecycle + the DOM mirror's `data-session-id` attribution; the
   * projection itself is now sourced from props (Decision §2 of
   * `part_entity_detail_panel` — the projection chain hoisted to
   * `<OperateRoute>` so `<GraphView>` and `<EntityDetailPanel>` share
   * the memos. The session id is still threaded for the lifecycle
   * effect's dependency tracking + to keep the prop signature stable
   * for any future seam that needs the session-level identity).
   */
  readonly sessionId: string;
  /**
   * Current participant's UUID. Required (not optional) per Decision §4
   * of `part_own_vote_indicators`: the routing component
   * (`<OperateRouteBody>`) runs the auth guard
   * (`auth.status === 'authenticated' && auth.user !== undefined`)
   * BEFORE mounting the canvas, so the prop is always a non-empty UUID
   * by the time `<GraphView>` renders. Making the prop required keeps
   * the auth-presence invariant at the type-system layer instead of
   * the canvas-rendering-time branch. The own-vote projection (now
   * hoisted to the route) filters `vote` events by
   * `voter.id === currentParticipantId` so the participant's at-a-
   * glance own-vote ring only fires on the local participant's votes.
   */
  readonly currentParticipantId: string;
  /**
   * Projection chain outputs threaded down from `<OperateRoute>` per
   * Decision §2 of `part_entity_detail_panel`. Each output was an
   * internal `useMemo` in this component before the hoist; lifting them
   * up means BOTH `<GraphView>` and `<EntityDetailPanel>` share the
   * SAME memo identities so the per-events-change projector runs ONCE
   * per WS frame, not twice.
   *
   * The projection helpers stay where they live (`apps/participant/src/graph/`);
   * only the call sites move. The Cytoscape mount + sync flow + DOM
   * mirror + tap handler + stylesheet inside this component are
   * unchanged — only the data-source seam moved from internal-memo to
   * prop-read.
   */
  readonly projectedNodes: readonly ParticipantNodeElement[];
  /** Edges from `projectGraph` (pre-dangling-filter); see `projectedNodes`. */
  readonly projectedEdges: readonly ParticipantEdgeElement[];
  /**
   * Per-entity per-facet status index from `computeFacetStatuses(events)`.
   * Currently unused inside `<GraphView>` (the projector handles the
   * stamp); accepted as a prop to keep the prop signature complete for
   * any future seam that needs the per-entity facet record without re-
   * reading the projection's element data.
   */
  readonly facetStatusIndex: FacetStatusIndex;
  /** Per-node axiom-mark bucket from `groupAxiomMarksByNode(projectAxiomMarks(events))`. */
  readonly axiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>;
  /** Per-node annotation bucket from `groupAnnotationsByNode(projectAnnotations(events))`. */
  readonly nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>;
  /** Per-edge annotation bucket from `groupAnnotationsByEdge(projectAnnotations(events))`. */
  readonly edgeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>;
  /** Per-entity diagnostic-highlight rollup from `projectDiagnosticHighlights(activeDiagnostics)`. */
  readonly diagnosticHighlightIndex: DiagnosticHighlightIndex;
  /** Per-entity own-vote rollup from `projectOwnVotes(events, currentParticipantId)`. */
  readonly ownVoteIndex: OwnVoteIndex;
  /** Per-entity other-voters list from `projectOtherVotes(events, currentParticipantId)`. */
  readonly othersVoteIndex: OthersVoteIndex;
  /**
   * Optional callback receiving the Cytoscape `Core` handle. Mounts to
   * `null` on unmount. Reserved for downstream tasks
   * (`part_pan_zoom_tap`, `part_entity_detail_panel`) that need to
   * register interaction handlers without forking the component.
   *
   * Optional in this leaf — the rendering surface is the deliverable;
   * the seam keeps the future tasks' edit surface tight.
   */
  readonly cyRef?: (cy: Core | null) => void;
}

/**
 * Render a `data-rollup-status` attribute value. The projection emits
 * the literal sentinel string `'none'` when an entity has no facet
 * record; the mirror surfaces that value as-is so Playwright selectors
 * can match `[data-rollup-status="proposed"]` without accidentally
 * picking up `'none'` entities.
 */
function rollupAttr(status: FacetStatus | 'none'): string {
  return status;
}

/**
 * Render a per-facet `data-facet-*` attribute value. The projection
 * stores the facet record as `Partial<Record<FacetName, FacetStatus>>`;
 * the mirror surfaces the present-facet status verbatim and an empty
 * string for absent facets (Decision §4 — `[data-facet-classification]`
 * selectors then match both the "absent" and "present" states
 * explicitly, and tests don't conflate "no status" with "projection
 * forgot to stamp the field").
 */
function facetAttr(value: FacetStatus | undefined): string {
  return value ?? '';
}

/**
 * Render a `data-is-axiom` attribute value. Explicit `"true"` /
 * `"false"` (not omit-when-false) keeps the mirror symmetric with the
 * existing `data-rollup-status` / `data-facet-*` sentinel posture
 * (Decision §5 of `part_axiom_mark_decoration`); Playwright's
 * `[data-is-axiom="false"]` probe gives tests an explicit
 * "we asserted not-axiom" branch.
 */
function axiomAttr(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

/**
 * Render a `data-has-annotation` attribute value. Same explicit
 * `"true"` / `"false"` posture as `axiomAttr` (Decision §5 of
 * `part_annotation_render`); the explicit `"false"` branch keeps the
 * mirror reader-friendly and gives Playwright an explicit
 * "we asserted not-annotated" selector instead of an absence-of-
 * attribute probe.
 */
function hasAnnotationAttr(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

/**
 * Render a `data-annotation-count` attribute value. Same string-
 * passthrough posture as `rollupAttr`: `String(0)` for the zero case
 * (explicit `"0"`, NOT omit-when-empty per Decision §5); `String(N)`
 * for nonzero counts. Symmetric across node + edge mirror rows.
 */
function annotationCountAttr(value: number): string {
  return String(value);
}

/**
 * Render a `data-diagnostic-severity` attribute value. Explicit
 * `"blocking"` / `"advisory"` / `"none"` (not omit-when-null) keeps the
 * mirror symmetric with the existing sentinel-string posture
 * (Decision §5 of `part_diagnostic_highlights`). The literal `"none"`
 * branch is what the explicit "we asserted not-flagged" Playwright
 * probe matches against.
 */
function diagnosticSeverityAttr(
  highlight: DiagnosticHighlight | null,
): 'blocking' | 'advisory' | 'none' {
  return highlight?.severity ?? 'none';
}

/**
 * Render a `data-diagnostic-kinds` attribute value. Encounter-order
 * comma-joined sentinel list (`""` for no-kinds; `"cycle"` for one,
 * `"cycle,contradiction"` for two, etc.). The encounter order matches
 * the projection's rollup contract — diagnostic envelopes land in a
 * defined order via the map's insertion order, and the rollup preserves
 * that order while deduping. Decision §5 documents the explicit
 * `""` posture (not omit-when-empty).
 */
function diagnosticKindsAttr(highlight: DiagnosticHighlight | null): string {
  return highlight?.kinds.join(',') ?? '';
}

/**
 * Render a `data-own-vote` attribute value. Passthrough — `OwnVote` is
 * already the closed-sentinel set the mirror surfaces. The helper
 * exists for symmetry with `rollupAttr` / `axiomAttr` /
 * `hasAnnotationAttr` / `diagnosticSeverityAttr` so the mirror render
 * reads uniformly. Per Decision §5: the literal `"none"` branch is
 * what the explicit "we asserted not-voted-by-me" Playwright probe
 * matches against (omit-when-empty would lose that branch).
 */
function ownVoteAttr(value: OwnVote): 'agree' | 'dispute' | 'none' {
  return value;
}

/**
 * Render a `data-selected` attribute value for a node / edge mirror row.
 *
 * Refinement: tasks/refinements/participant-ui/part_pan_zoom_tap.md
 *              (Decision §7 — additive `data-selected` on the existing
 *              `<li>` rows; explicit `"true"` / `"false"` posture,
 *              symmetric with the `axiomAttr` / `hasAnnotationAttr`
 *              family so Playwright's `[data-selected="false"]` probe
 *              has an explicit "we asserted not-selected" branch).
 *
 * Returns `"true"` iff the store's `selected` slot matches the row's
 * `(kind, id)` tuple; `"false"` otherwise (including the no-selection
 * case where `selected === null`).
 */
function selectedFlag(
  id: string,
  selected: Selection | null,
  kind: 'node' | 'edge' | 'annotation',
): 'true' | 'false' {
  return selected?.kind === kind && selected.id === id ? 'true' : 'false';
}

/**
 * Render a `data-flashing` attribute value for a node / edge mirror row.
 *
 * Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
 *              (Decisions §3 + §6 — `motion-safe:animate-pulse` class
 *              composition pinned by the explicit `"true"` / `"false"`
 *              attribute posture so Vitest + Playwright probes can
 *              match `[data-flashing="true"]` without absence-of-
 *              attribute ambiguity, symmetric with `selectedFlag` and
 *              the rest of the mirror's data-attr family.)
 */
function flashingAttr(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

/**
 * Cytoscape `tap` event handler — discriminates on the target kind and
 * writes through to the participant `useSelectionStore`.
 *
 * Refinement: tasks/refinements/participant-ui/part_pan_zoom_tap.md
 *              (Decision §5 — single `cy.on('tap', handleTap)`
 *              registration with `event.target` discrimination, vs
 *              three selector-qualified `cy.on('tap', 'node', ...)` /
 *              `'edge'` / `'core'` handlers. One registration, one
 *              cleanup. Decision §6 — module-scope export ensures
 *              referential stability across renders and gives the
 *              Vitest cases a direct entry point.)
 *
 * Three branches:
 *
 *   - `target === cy` (empty-canvas tap): unselect every cy element +
 *     `useSelectionStore.getState().clear()`.
 *   - `target.isNode()` (node tap): defensively unselect any prior
 *     `:selected` (single-selection semantic — `selectionType: 'single'`
 *     covers this internally too, but the explicit call defends against
 *     version skew); `target.select()`; write
 *     `{ kind: 'node', id: target.id() }` to the store.
 *   - `target.isEdge()` (edge tap): symmetric with the node branch.
 *
 * Unknown target kinds — defensive no-op. Cytoscape only emits `tap`
 * on core / node / edge today; the silent branch keeps a forward-
 * compatible posture without a behaviour change.
 */
export function handleTap(event: EventObject): void {
  const target = event.target as unknown;
  const cy = event.cy;
  if (target === cy) {
    cy.elements().unselect();
    useSelectionStore.getState().clear();
    return;
  }
  // Cytoscape's `Singular` API carries `isNode()` / `isEdge()`; guard
  // the runtime calls with `typeof === 'function'` to keep the
  // unknown-target branch unreachable for any future target shape.
  const targetWithIsNode = target as { isNode?: () => boolean; isEdge?: () => boolean };
  if (typeof targetWithIsNode.isNode === 'function' && targetWithIsNode.isNode()) {
    const node = target as {
      id: () => string;
      data: (key: string) => unknown;
      select: () => unknown;
    };
    cy.$(':selected')
      .not(target as never)
      .unselect();
    node.select();
    // Read `data.nodeKind` to discriminate between statement nodes and
    // materialized annotation graph-nodes (per Decision §6 of
    // `part_render_annotation_endpoint_edges`). Annotation taps write
    // the `'annotation'` discriminant so the entity-detail-panel renders
    // the placeholder branch instead of the statement detail body.
    const nodeKind = node.data('nodeKind');
    const selectionKind = nodeKind === 'annotation' ? 'annotation' : 'node';
    useSelectionStore.getState().select({ kind: selectionKind, id: node.id() });
    return;
  }
  if (typeof targetWithIsNode.isEdge === 'function' && targetWithIsNode.isEdge()) {
    const edge = target as { id: () => string; select: () => unknown };
    cy.$(':selected')
      .not(target as never)
      .unselect();
    edge.select();
    useSelectionStore.getState().select({ kind: 'edge', id: edge.id() });
    return;
  }
}

/**
 * URL-query-parameter gate for the `window.__aConversaCyInstance`
 * test seam (per Decision §9 of `part_pan_zoom_tap`). The Playwright
 * spec navigates with `?aconversaTestMode=1`; under that flag the
 * mount effect exposes the live cy instance on `window` so the spec
 * can dispatch synthetic `cy.emit('tap', ...)` events without
 * coordinate arithmetic. Vitest sets `import.meta.env.MODE === 'test'`
 * which also lights up the seam.
 *
 * In production builds the gate is FALSE on every page load — the
 * window property never lands and the cy instance is not leaked into
 * the page's global scope.
 */
function shouldExposeCyTestSeam(): boolean {
  // `import.meta.env.MODE` is the Vitest-supplied mode in the unit
  // test environment. `'test'` covers the Vitest path; the URL-query
  // branch covers the Playwright path. The dev / production browser
  // path hits neither and the seam stays dormant.
  const env = (import.meta as unknown as { env?: { MODE?: string } }).env;
  if (env?.MODE === 'test') return true;
  if (typeof window === 'undefined') return false;
  const search = window.location.search;
  return search.includes('aconversaTestMode');
}

export function GraphView({
  sessionId: _sessionId,
  currentParticipantId: _currentParticipantId,
  projectedNodes,
  projectedEdges,
  facetStatusIndex: _facetStatusIndex,
  axiomMarkIndex: _axiomMarkIndex,
  nodeAnnotationIndex: _nodeAnnotationIndex,
  edgeAnnotationIndex: _edgeAnnotationIndex,
  diagnosticHighlightIndex: _diagnosticHighlightIndex,
  ownVoteIndex: _ownVoteIndex,
  othersVoteIndex: _othersVoteIndex,
  cyRef,
}: GraphViewProps): ReactElement {
  const { t } = useTranslation();
  // Decision §7 of `part_pan_zoom_tap` — the localized `elements` memo
  // and the DOM mirror BOTH read the selection slot. The `selected`
  // value drives the `data-selected` attribute (via `selectedFlag`) and
  // is also stamped onto each Cytoscape data record so a downstream
  // selector cascade (or the dev-tools inspector) can see what the
  // component believes is selected at any moment. The cy
  // `:selected` pseudo-class is driven separately by the `handleTap`
  // call to `target.select()` — the two paths stay in lockstep because
  // `handleTap` writes to the store AND to the cy selection set in the
  // same call.
  const selected = useSelectionStore((state) => state.selected);
  const cyInstanceRef = useRef<Core | null>(null);
  // Decision §2 of `part_other_vote_indicators_canvas_dots` —
  // `cyInstanceRef` (a plain `useRef`) is React-invisible: mutating the
  // ref doesn't trigger re-renders, so a consumer downstream of the
  // mount effect (like `<OtherVotesOverlay>`) cannot KNOW when the cy
  // instance becomes available. The `useState` slot solves the
  // visibility problem: the one-shot mount effect calls
  // `setCyInstance(cy)` alongside the existing imperative ref-mutation,
  // and consumers downstream re-render when the instance lands. The
  // existing `cyRef` callback continues to fire for external consumers
  // (a future `part_pan_zoom_tap` / `part_entity_detail_panel`).
  const [cyInstance, setCyInstance] = useState<Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Position cache for the incremental layout pass. Nodes whose id is
  // in the cache reuse their previous `{x, y}` verbatim; only new ids
  // trigger a fresh `breadthfirst` pass. `useRef` (not `useState`):
  // writes to the cache happen AFTER the layout completes and MUST NOT
  // trigger a re-render — the projection memos already drive the
  // re-render cadence. The cache is per-component-instance, so route
  // navigation that unmounts / remounts `<GraphView>` starts fresh.
  //
  // The bug this fixes: every selection change (tap on a node) re-runs
  // the `elements` memo because the `selected` flag changes per-element.
  // Without the cache, the post-`cy.json` layout pass reshuffles every
  // node on every selection — disorienting. With the cache, layout
  // runs only when the set of node ids materially changes (a new
  // `node-created` event lands). Mirrors the moderator's
  // `positionCacheRef` + `knownNodeIdsRef` pair (refinement
  // `mod_layout_measured_dimensions` + `mod_layout_engine_choice`).
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const knownNodeIdsRef = useRef<Set<string>>(new Set());

  // One-shot mount of the Cytoscape instance. The `useEffect`'s empty
  // dependency array keeps the instance stable across the component's
  // lifetime; element sync happens in a separate effect below.
  //
  // The 7 explicit mount-config flags + the `handleTap` registration
  // are pinned per
  // `tasks/refinements/participant-ui/part_pan_zoom_tap.md` Decisions
  // §1 + §3 + §5. The values match Cytoscape's documented defaults for
  // pan/zoom (pinned explicitly so the contract does not drift across
  // library upgrades) and pin the read-mostly contract for
  // selection/grab (box-select OFF, single-select, ungrabbable). The
  // zoom range pins `[MIN_ZOOM, MAX_ZOOM]` (Decision §2 — see the
  // module-scope constants above).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const cy = cytoscape({
      container,
      style: STYLESHEET,
      elements: [],
      layout: { name: 'preset' },
      // Pan / zoom — pinned ON explicitly (Decision §1).
      userPanningEnabled: true,
      userZoomingEnabled: true,
      // Zoom range — widened from Cytoscape's `[1e-50, 1e50]` defaults
      // to the empirical participant-tablet calibration (Decision §2).
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      // Selection — single-tap, no box-select (Decision §3a + §3b).
      // The detail panel surfaces one entity at a time per the
      // methodology's tap-an-entity-see-its-facets loop.
      boxSelectionEnabled: false,
      selectionType: 'single',
      // Grab — read-mostly surface; the moderator owns positions via
      // re-layouts. Manual node drags would visually desynchronise
      // from every other surface and fight the layout engine
      // (Decision §3c).
      autoungrabify: true,
    });
    cy.on('tap', handleTap);
    cyInstanceRef.current = cy;
    setCyInstance(cy);
    cyRef?.(cy);
    // Test seam — expose the live cy instance on `window` so the
    // Playwright spec (and Vitest, transitively) can dispatch
    // synthetic `cy.emit('tap', ...)` events without coordinate
    // arithmetic. Gated per `shouldExposeCyTestSeam()` so production
    // browser sessions never see the seam (Decision §8 + §9).
    const exposeSeam = shouldExposeCyTestSeam();
    if (exposeSeam && typeof window !== 'undefined') {
      (window as unknown as { __aConversaCyInstance?: Core }).__aConversaCyInstance = cy;
    }
    return () => {
      // Clean up the test seam FIRST so a doubled-mount under React
      // strict-mode does not leave a dangling reference to the
      // about-to-be-destroyed cy instance.
      if (exposeSeam && typeof window !== 'undefined') {
        const w = window as unknown as { __aConversaCyInstance?: Core };
        if (w.__aConversaCyInstance === cy) {
          delete w.__aConversaCyInstance;
        }
      }
      cy.removeListener('tap', handleTap);
      cy.destroy();
      cyInstanceRef.current = null;
      setCyInstance(null);
      cyRef?.(null);
    };
    // The `cyRef` callback is intentionally NOT a dependency — the
    // mount lifecycle owns the instance, not the consumer's callback
    // identity. If the consumer passes a new callback per render the
    // instance must NOT be re-created.
    // The repo does not run `react-hooks/exhaustive-deps` so no
    // suppression directive is required; this comment documents the
    // intent for the human reviewer.
  }, []);

  // The projection chain (per-facet status index, axiom-mark index,
  // node + edge annotation indexes, diagnostic-highlight index, own-
  // vote index, other-voter index, plus the final `projectGraph` call)
  // is hoisted to `<OperateRoute>` per Decision §2 of
  // `part_entity_detail_panel`. Both `<GraphView>` AND
  // `<EntityDetailPanel>` consume the SAME memo outputs via the route's
  // prop-thread; the projection runs ONCE per `events` change, not
  // twice. The route owns the memo lifetime; the component reads.
  const projected = useMemo<{
    nodes: readonly ParticipantNodeElement[];
    edges: readonly ParticipantEdgeElement[];
  }>(() => ({ nodes: projectedNodes, edges: projectedEdges }), [projectedNodes, projectedEdges]);

  // Element sync — runs on every events / translation change. Cytoscape's
  // `cy.json({ elements })` bulk-replaces the element set; a
  // `breadthfirst` layout pass follows to position truly-new nodes
  // (see `BREADTHFIRST_LAYOUT_OPTIONS` for the rationale + the
  // upstream `cose` defect that motivates the choice).
  // The localized mapper carries through `rollupStatus` + `facetStatuses`
  // from each projected element onto the Cytoscape data record so the
  // per-status stylesheet selectors fire.
  const renderedEdges = useMemo<ParticipantEdgeElement[]>(() => {
    const nodeIds = new Set(projected.nodes.map((node) => node.data.id));
    // Drop edges whose source / target id has not been seen as a
    // `node-created` event. Cytoscape throws synchronously on
    // `cy.add({ group: 'edges', data: { source: '<unknown>', ... } })`,
    // so the lenient "render whatever the projection emits" behaviour
    // the moderator gets implicitly from ReactFlow has to be opt-in
    // here. The dropped edge re-materialises as soon as the missing
    // node lands in the per-session slice and the projection runs again.
    return projected.edges.filter(
      (edge) => nodeIds.has(edge.data.source) && nodeIds.has(edge.data.target),
    );
  }, [projected]);

  const elements = useMemo<ElementDefinition[]>(() => {
    // The localized memo also derives a flat `diagnosticSeverity` slot
    // for Cytoscape's per-data-value selector to match on (Decision §4
    // of `part_diagnostic_highlights` — the selector grammar cannot
    // reach into the nested `diagnosticHighlight` object, so severity
    // is exposed as a sibling primitive). `'none'` is the sentinel
    // string for the no-diagnostic baseline — keeps the
    // `node[diagnosticSeverity = "blocking"]` / `"advisory"` selectors
    // from accidentally firing on entities with no active diagnostic.
    //
    // The flat `selected: boolean` slot (per Decision §7 of
    // `part_pan_zoom_tap`) carries the source-of-truth for the
    // mirror's `data-selected` attribute reads. The Cytoscape
    // stylesheet's `:selected` pseudo-class fires off Cytoscape's
    // INTERNAL selection set (synced by `handleTap`), so the
    // `data.selected` flag is the React-rendering source-of-truth
    // (DOM mirror) and the cy selection set is the Cytoscape-rendering
    // source-of-truth (canvas paint); the tap handler keeps them
    // synchronised.
    const localizedNodes: ElementDefinition[] = projected.nodes.map((node) => {
      const cachedPosition = positionCacheRef.current.get(node.data.id);
      const descriptor: ElementDefinition = {
        group: 'nodes',
        data: {
          ...node.data,
          kindLabel: node.data.kind === null ? '—' : t(`methodology.kind.${node.data.kind}`),
          diagnosticSeverity: node.data.diagnosticHighlight?.severity ?? 'none',
          selected: selected?.kind === 'node' && selected.id === node.data.id,
        },
      };
      if (cachedPosition !== undefined) {
        // Attach the cached `{x, y}` so `cy.json({ elements })` restores
        // the prior position on re-sync. Without this, every memo tick
        // (selection change, vote arrival, annotation flip, …) would
        // dump the node back to `{0, 0}`. With the cache, only truly-
        // new ids drive a layout pass; existing ids stay put when the
        // pass doesn't run.
        descriptor.position = { x: cachedPosition.x, y: cachedPosition.y };
      }
      return descriptor;
    });
    const localizedEdges: ElementDefinition[] = renderedEdges.map((edge) => ({
      group: 'edges',
      data: {
        ...edge.data,
        roleLabel: t(`methodology.edgeRole.${edge.data.role}.label`),
        diagnosticSeverity: edge.data.diagnosticHighlight?.severity ?? 'none',
        selected: selected?.kind === 'edge' && selected.id === edge.data.id,
      },
    }));
    return [...localizedNodes, ...localizedEdges];
  }, [projected, renderedEdges, selected, t]);

  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy === null) return;
    // Detect truly-new node ids (in the current element set but not yet
    // recorded as known by this component instance). When at least one
    // is present, run a `breadthfirst` layout pass over the whole set
    // — it'll re-flow every node, but cached ids would have been re-
    // flowed anyway since `breadthfirst` doesn't preserve incoming
    // positions; the cache continues to pay its dust on the common
    // case of no new ids (selection / vote / annotation / diagnostic
    // flips), where the layout pass is skipped entirely.
    const trulyNewNodeIds: string[] = [];
    for (const element of elements) {
      if (element.group !== 'nodes') continue;
      const id = element.data?.id;
      if (typeof id !== 'string') continue;
      if (!knownNodeIdsRef.current.has(id)) trulyNewNodeIds.push(id);
    }
    cy.json({ elements });
    // Skip the layout pass when the canvas has no measurable
    // viewport (e.g. a happy-dom test environment where
    // `cy.width()` reports 0). Cytoscape layouts need a non-zero
    // bounding box to assign coordinates; running against a zero-
    // sized viewport is unreliable.
    // The browser path always has a real viewport (the surface-
    // wide layout's `participant-main` region carries `1fr`).
    // Empty graphs also skip — the layout is a no-op.
    const width = cy.width();
    const height = cy.height();
    const viewportReady =
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    if (cy.elements().length > 0 && viewportReady && trulyNewNodeIds.length > 0) {
      // `breadthfirst` (bundled) lays out new nodes in layered BFS
      // order, respecting each node's `outerWidth()` / `outerHeight()`
      // via `avoidOverlap` — the property `cose` lacks because of its
      // upstream w/h swap. See `BREADTHFIRST_LAYOUT_OPTIONS` for the
      // full rationale + the layout-stability trade-off (full relayout
      // on each new-node arrival, mirroring the moderator's
      // `relayoutAll`).
      cy.layout(BREADTHFIRST_LAYOUT_OPTIONS).run();
    }
    // Mirror every emitted position into the cache so the NEXT element-
    // sync tick reuses these positions for every known node. Add every
    // currently-rendered id to the known set — including the freshly
    // laid-out ones — so the next tick treats them as cached.
    cy.nodes().forEach((node) => {
      const position = node.position();
      positionCacheRef.current.set(node.id(), { x: position.x, y: position.y });
      knownNodeIdsRef.current.add(node.id());
    });
  }, [elements]);

  return (
    <>
      {/*
       * `participant-graph-root` grows `relative` per Decision §3 of
       * `part_other_vote_indicators_canvas_dots`. The sibling
       * `<OtherVotesOverlay>` uses `position: absolute` and `inset-0`
       * to fill the same rectangle the Cytoscape canvas occupies; the
       * `relative` declaration makes this container the overlay's
       * positioning ancestor (without it the overlay would resolve
       * to the viewport's initial containing block).
       */}
      <div
        ref={containerRef}
        data-testid="participant-graph-root"
        className="relative h-full w-full"
      />
      {/*
       * The DOM overlay sibling. Reads `data.otherVotes` from each
       * Cytoscape element and paints one DOM row per element with
       * non-empty votes. `pointer-events: none` so clicks pass through
       * to the canvas. Rendering AFTER the canvas mount means the
       * overlay paints visually ABOVE the canvas in natural DOM
       * stacking; the absolute positioning + pointer-events-none
       * keep clicks intact.
       */}
      <OtherVotesOverlay cy={cyInstance} containerRef={containerRef} />
      <ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">
        {projected.nodes.map((node) => (
          <li
            key={`node-${node.data.id}`}
            data-testid="participant-node-status"
            data-node-id={node.data.id}
            data-node-kind={node.data.nodeKind}
            data-annotation-kind={node.data.annotationKind ?? ''}
            data-rollup-status={rollupAttr(node.data.rollupStatus)}
            data-facet-classification={facetAttr(node.data.facetStatuses.classification)}
            data-facet-substance={facetAttr(node.data.facetStatuses.substance)}
            data-facet-wording={facetAttr(node.data.facetStatuses.wording)}
            data-is-axiom={axiomAttr(node.data.isAxiom)}
            data-has-annotation={hasAnnotationAttr(node.data.hasAnnotation)}
            data-annotation-count={annotationCountAttr(node.data.annotationCount)}
            data-diagnostic-severity={diagnosticSeverityAttr(node.data.diagnosticHighlight)}
            data-diagnostic-kinds={diagnosticKindsAttr(node.data.diagnosticHighlight)}
            data-own-vote={ownVoteAttr(node.data.ownVote)}
            data-selected={selectedFlag(
              node.data.id,
              selected,
              node.data.nodeKind === 'annotation' ? 'annotation' : 'node',
            )}
            data-flashing={flashingAttr(node.data.isFlashing)}
            className={node.data.isFlashing ? 'motion-safe:animate-pulse' : undefined}
          >
            {/*
             * Nested `<ul data-other-votes>` per Decision §6 of
             * `part_other_vote_indicators`. Renders one
             * `<li data-other-vote …>` per other voter in the per-
             * entity list. Empty list still renders the `<ul>` with
             * no children so Playwright's absent-children probe
             * (`… ul[data-other-votes] li` count of 0) matches the
             * intentional empty state distinct from a projector bug
             * that omits the `<ul>` entirely.
             */}
            <ul data-other-votes>
              {node.data.otherVotes.map((vote) => (
                <li
                  key={vote.participantId}
                  data-other-vote
                  data-voter-id={vote.participantId}
                  data-vote={vote.choice}
                />
              ))}
            </ul>
          </li>
        ))}
        {renderedEdges.map((edge) => (
          <li
            key={`edge-${edge.data.id}`}
            data-testid="participant-edge-status"
            data-edge-id={edge.data.id}
            data-rollup-status={rollupAttr(edge.data.rollupStatus)}
            data-facet-substance={facetAttr(edge.data.facetStatuses.substance)}
            data-has-annotation={hasAnnotationAttr(edge.data.hasAnnotation)}
            data-annotation-count={annotationCountAttr(edge.data.annotationCount)}
            data-diagnostic-severity={diagnosticSeverityAttr(edge.data.diagnosticHighlight)}
            data-diagnostic-kinds={diagnosticKindsAttr(edge.data.diagnosticHighlight)}
            data-own-vote={ownVoteAttr(edge.data.ownVote)}
            data-selected={selectedFlag(edge.data.id, selected, 'edge')}
            data-flashing={flashingAttr(edge.data.isFlashing)}
            className={edge.data.isFlashing ? 'motion-safe:animate-pulse' : undefined}
          >
            {/*
             * Nested `<ul data-other-votes>` per Decision §6 —
             * symmetric across node + edge row kinds per Decision §1.
             */}
            <ul data-other-votes>
              {edge.data.otherVotes.map((vote) => (
                <li
                  key={vote.participantId}
                  data-other-vote
                  data-voter-id={vote.participantId}
                  data-vote={vote.choice}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
