// Audience-side Cytoscape stylesheet + broadcast typography pins.
//
// Refinement: tasks/refinements/audience/aud_stylesheet_module_extraction.md
//   (Decision §1 — module-scope `STYLESHEET` reference-stable across
//   renders, mirrors `aud_cytoscape_init.md` Decision §2. Decision §2 —
//   the parallel constants-set extraction
//   (`aud_stylesheet_state_color_extraction`) stays a separate task; the
//   per-state hex literals remain inline here until that leaf lands.
//   Decision §3 — no re-export shim from `GraphView.tsx`; consumers
//   import directly from this module. Decision §4 — no new ADR; the
//   "extract at the third caller" pattern is documented by the
//   predecessor refinements. Decision §5 — JSDoc blocks travel with the
//   constants, not with the consumer.)
//
// Refinement: tasks/refinements/audience/aud_stylesheet_state_color_extraction.md
//   (Decision §1 — `STATE_COLORS` lives here in `stylesheet.ts`, sited
//   above `STYLESHEET` so the array can reference it; no sibling file,
//   no re-export from `GraphView.tsx`. Decision §2 — two entries today
//   (`agreed`, `disputed`); no `proposed` slot (proposed differentiates
//   on `border-style`/`opacity`, not color); no speculative slots for
//   future states (grow-as-needed, one entry per future per-state
//   refinement). Decision §3 — name is `STATE_COLORS` (matches the
//   predecessor refinements' named-future-task registration; preserves
//   grep-discoverability). Decision §4 — `GraphView.test.tsx` keeps
//   asserting against the literal hex values, not `STATE_COLORS.*`
//   (tests pin observable behaviour, not implementation detail; avoids
//   tautology). Decision §5 — `STATE_COLORS` is a named export from
//   `stylesheet.ts`; no re-export from `GraphView.tsx`. Decision §6 —
//   no new ADR; mechanical refactor, the pattern is documented by the
//   predecessor refinements.)
//
// Refinement: tasks/refinements/audience/aud_decomposition_animation.md
//   (Decision §3 — the `node[?decomposed]` selector entry appended after
//   the per-rollupStatus entries is the post-animation at-rest paint:
//   `opacity: 0.15` reads as "structurally retired" while preserving
//   the parent's position in the layout (spatial-memory anchor). The
//   `[?decomposed]` (data-truthy) selector activates exactly when
//   `projectGraph` stamps `data.decomposed: true` at commit of a
//   `decompose` / `interpretive-split` proposal, and composes with the
//   per-rollupStatus selectors via Cytoscape's per-selector merging.)
//
// History: this module collects the per-state selector decisions
// landed across `aud_proposed_styling`, `aud_agreed_styling`,
// `aud_disputed_styling`, `aud_meta_disagreement_split`, and the
// typography pins from `aud_clean_typography`. See those refinements
// for the per-decision rationale; this file is the data,
// `GraphView.tsx` is the consumer.
//
// ADRs:
//   - 0004 (Cytoscape.js for the audience broadcast surface);
//   - 0005 (Tailwind v4 + shared tokens — per-state hex literals stay
//     inline here until `packages/ui-tokens` materializes);
//   - 0022 (no throwaway verifications — `GraphView.test.tsx` is the
//     regression pin for the structural and mount-time stylesheet
//     behaviour);
//   - 0026 (micro-frontend root app — module-internal to the audience
//     workspace; not surfaced through the audience package's public
//     API);
//   - 0027 (entity / facet layers are strictly separate — the
//     agreement-layer selector entries key on `data.rollupStatus`, an
//     agreement-layer rollup, without entity-layer contamination).

import type { StylesheetJson } from 'cytoscape';

import { BROADCAST_FONT_STACK } from '@a-conversa/i18n-catalogs';

/**
 * Broadcast-typography size and weight pins consumed by `STYLESHEET`
 * below. Named exports so future sibling tasks (`aud_per_facet_visualization`,
 * `aud_axiom_mark_decoration`, `aud_annotation_rendering`) can key off
 * the numeric values — e.g. `BROADCAST_NODE_FONT_SIZE_PX - 2` for an
 * annotation overlay — rather than rediscover them by reading the
 * stylesheet. Per `aud_clean_typography.md` Decision §3: 14 / 11 pixel
 * sizes are large enough to read after streaming compression at the
 * 1080p OBS baseline yet still fit inside the 200×80 node bounding box
 * with 180px text-max-width set by `aud_layout_engine`. SemiBold 600 on
 * nodes pulls them forward as the primary information layer; Medium
 * 500 on edges keeps roles visible without competing with node labels.
 */
export const BROADCAST_NODE_FONT_SIZE_PX = 14 as const;
export const BROADCAST_EDGE_FONT_SIZE_PX = 11 as const;
export const BROADCAST_NODE_FONT_WEIGHT = 600 as const;
export const BROADCAST_EDGE_FONT_WEIGHT = 500 as const;

/**
 * Font size (px) for promoted annotation nodes. Smaller than statement
 * nodes (14 px) so annotations read as visually subordinate to the
 * statements they comment on — per `aud_render_annotation_endpoint_edges`
 * Decision §5. Matches the participant's annotation-node selector (12 px)
 * for cross-surface typographic consistency on the Cytoscape canvas.
 */
export const BROADCAST_ANNOTATION_FONT_SIZE_PX = 12 as const;

/**
 * Per-state color pins for the audience's Cytoscape `STYLESHEET`.
 *
 * One entry per agreement-layer state that differentiates on color
 * (proposed differentiates on `border-style: 'dashed'` + `opacity: 0.6`
 * — no color override — and therefore has no `STATE_COLORS.proposed`
 * slot; see `aud_stylesheet_state_color_extraction.md` Decision §2).
 * Meta-disagreement is the fourth agreement-layer state and the third
 * entry in this constant; the cross-surface palette match here is the
 * moderator's `border-violet-600` and the participant's `'#7c3aed'`
 * Cytoscape selector (per `aud_meta_disagreement_split.md` Decision §2).
 *
 * Cross-surface palette match: the moderator surface uses the same
 * hex values on its ReactFlow custom-node Tailwind classes — slate-700
 * (`#334155`) for agreed, rose-600 (`#e11d48`) for disputed, violet-600
 * (`#7c3aed`) for meta-disagreement (see
 * `tasks/refinements/moderator-ui/mod_agreed_state_styling.md` Decision §2,
 * `tasks/refinements/moderator-ui/mod_disputed_state_styling.md`
 * Decision §2, and
 * `tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md`
 * Decision §2). The cross-surface match means broadcast composites
 * (audience canvas + future picture-in-picture moderator view) read as
 * one show.
 *
 * `as const` so the type is the literal-string union (not `string`),
 * which keeps the typing useful at consumer sites — Cytoscape's
 * stylesheet color fields accept any string but the narrowed type
 * surfaces typos at the call site.
 *
 * Migration target: when `packages/ui-tokens` materializes (deferred
 * per ADR 0005), each entry moves to `tokens.color.facet.<state>.*`
 * and this object becomes a thin re-export.
 */
export const STATE_COLORS = {
  agreed: '#334155',
  disputed: '#e11d48',
  metaDisagreement: '#7c3aed',
  // Withdrawn = closed-and-retracted. Matches the shell `FacetPill`'s
  // withdrawn chip language (dashed slate at a heavier fade than
  // `proposed`) rather than introducing a new hue — slate-400.
  withdrawn: '#94a3b8',
} as const;

/**
 * Cytoscape stylesheet for the audience broadcast surface.
 *
 * Module-scope so the reference is stable across renders — Cytoscape
 * diffs by reference identity, not deep equality. Statement-node box
 * dimensions are per-node `data(width)` / `data(height)` mappers fed by
 * the projector's `computeNodeDimensions(wording)` call (see
 * `nodeDimensions.ts`), so a one-word statement and a three-line
 * statement no longer share the same box. This closes the constant
 * `width: 200` / `height: 80` deferral the audience inherited from the
 * participant's `part_graph_render` Decision §7. Note the deferral's
 * cause is still live: `width: 'label'` / `height: 'label'` was
 * deprecated by Cytoscape 3.33 and surfaces as a `console.warn` (a
 * Vitest failure per `vitest.setup.ts`), so the dynamic sizing routes
 * through measured `data(...)` numbers rather than Cytoscape's
 * label-auto-size — the measurement happens in the projector, not in
 * the renderer.
 *
 * Per-facet styling (proposed dashed / agreed solid / disputed marker /
 * meta-disagreement split) and decoration (axiom-mark badges,
 * annotation overlays, per-facet sub-states) plug in via sibling tasks
 * (`aud_proposed_styling`, `aud_axiom_mark_decoration`,
 * `aud_annotation_rendering`, …) that extend this stylesheet in their
 * own commits.
 *
 * Per-state extension pattern: each per-state sibling appends one
 * `node[rollupStatus = '<state>']` and one
 * `edge[rollupStatus = '<state>']` selector entry to the array; each
 * entry overrides only the properties that differentiate the state
 * from the baseline (border / line color, opacity, dash-style, and
 * — first introduced by the disputed-state pair — `border-width` on
 * the states that need them). The meta-disagreement node selector is
 * the first per-state branch to override `border-style: 'double'`
 * (proposed overrides to `'dashed'`; the disputed pair adds
 * `border-width`; meta-disagreement claims the third style axis — per
 * `aud_meta_disagreement_split.md` Decision §2). Per-state color
 * overrides resolve through the `STATE_COLORS` constant declared
 * above (one entry per state that differentiates on color; see its
 * JSDoc for the cross-surface palette match and the proposed-state
 * omission).
 * Typography, geometry, label, shape, background, and text-background
 * fields all inherit from the baseline `node` / `edge` selectors via
 * Cytoscape's per-selector composition (an element matching two
 * selectors merges their style objects; later selectors win on the
 * conflicting keys). The `data.rollupStatus` attribute the selectors
 * key on is emitted by `projectGraph` for every projected element,
 * sourced from `cardRollupStatus(facetStatuses)` in `./facetStatus.ts`
 * (the verbatim-from-participant derivation). Entities whose
 * per-facet record is empty stamp the literal sentinel `'none'` so
 * attribute-equality selectors have a stable value to match on (per
 * `aud_proposed_styling.md` Decision §4).
 *
 * Typography (`font-family`, `font-size`, `font-weight`) is set on both
 * the `node` and `edge` selectors. Cytoscape's text-style resolver
 * keys on per-element selectors — setting `'font-family'` on `core`
 * does not propagate to element text rendering, so the duplication is
 * intentional (`aud_clean_typography.md` Decision §5). The font stack
 * is the policy data shipped by `i18n_audience_typography`; see
 * `packages/i18n-catalogs/src/typography.ts` for the codepoint-coverage
 * guarantees and the rationale for the fallback order.
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
      // Per-node wrap budget: stamped on `data.textMaxWidth` by the
      // projector's `computeNodeDimensions(wording)` call so the wrap
      // engine and the box-sizing agree on the same per-node footprint.
      // Refinement: closes the constant-`200`/`80` deferral noted in the
      // STYLESHEET status block below.
      'text-max-width': 'data(textMaxWidth)',
      color: '#0f172a',
      'text-valign': 'center',
      'text-halign': 'center',
      // Per-node box dimensions, measured from the wording by the
      // projector. Statement nodes carry `data.width` / `data.height`;
      // promoted annotation graph-nodes override both with literals in
      // their `node[nodeKind = 'annotation']` selector below, so these
      // `data(...)` mappers are never evaluated for them.
      width: 'data(width)',
      height: 'data(height)',
      padding: '12px',
      'font-family': BROADCAST_FONT_STACK,
      'font-size': BROADCAST_NODE_FONT_SIZE_PX,
      'font-weight': BROADCAST_NODE_FONT_WEIGHT,
    },
  },
  {
    // Statement nodes render their content (step pill + wording) as a
    // per-node HTML element via `cytoscape-node-html-label`
    // (`per_facet_step_pill`). Hide the Cytoscape canvas label so the box
    // just frames the HTML; the per-status border/background paint below
    // (which keys on `rollupStatus`) still applies. Annotation graph-nodes
    // keep their canvas label (their own selector below).
    selector: "node[nodeKind = 'statement']",
    style: {
      'text-opacity': 0,
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
      'font-family': BROADCAST_FONT_STACK,
      'font-size': BROADCAST_EDGE_FONT_SIZE_PX,
      'font-weight': BROADCAST_EDGE_FONT_WEIGHT,
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      color: '#475569',
    },
  },
  {
    selector: "node[rollupStatus = 'agreed']",
    style: {
      'border-color': STATE_COLORS.agreed,
    },
  },
  {
    selector: "edge[rollupStatus = 'agreed']",
    style: {
      'line-color': STATE_COLORS.agreed,
      'target-arrow-color': STATE_COLORS.agreed,
    },
  },
  {
    selector: "node[rollupStatus = 'proposed']",
    style: {
      'border-style': 'dashed',
      opacity: 0.6,
    },
  },
  {
    selector: "edge[rollupStatus = 'proposed']",
    style: {
      'line-style': 'dashed',
      opacity: 0.6,
    },
  },
  {
    selector: "node[rollupStatus = 'disputed']",
    style: {
      'border-color': STATE_COLORS.disputed,
      'border-width': 3,
    },
  },
  {
    selector: "edge[rollupStatus = 'disputed']",
    style: {
      'line-color': STATE_COLORS.disputed,
      'target-arrow-color': STATE_COLORS.disputed,
    },
  },
  {
    // Withdrawn — a committed facet whose agreement was retracted via
    // `withdraw-agreement` (ADR 0030 §3). Reads as "closed; retracted":
    // the dashed style of `proposed` at a heavier fade, in the closed
    // slate tone (matching the shell FacetPill's withdrawn chip), so it
    // is distinguishable from both the active dashed `proposed` (0.6,
    // baseline border) and the rose `disputed`.
    selector: "node[rollupStatus = 'withdrawn']",
    style: {
      'border-style': 'dashed',
      'border-color': STATE_COLORS.withdrawn,
      opacity: 0.45,
    },
  },
  {
    selector: "edge[rollupStatus = 'withdrawn']",
    style: {
      'line-style': 'dashed',
      'line-color': STATE_COLORS.withdrawn,
      'target-arrow-color': STATE_COLORS.withdrawn,
      opacity: 0.45,
    },
  },
  {
    selector: "node[rollupStatus = 'meta-disagreement']",
    style: {
      'border-style': 'double',
      'border-color': STATE_COLORS.metaDisagreement,
    },
  },
  {
    selector: "edge[rollupStatus = 'meta-disagreement']",
    style: {
      'line-color': STATE_COLORS.metaDisagreement,
      'target-arrow-color': STATE_COLORS.metaDisagreement,
    },
  },
  // `aud_decomposition_animation` Decision §3 — post-animation at-rest
  // paint for parent nodes whose `data.decomposed` was stamped at
  // commit of a `decompose` / `interpretive-split` proposal by
  // `projectGraph`. The 0.15 opacity reads as "structurally retired"
  // while preserving the parent's position in the layout so the
  // broadcast viewer's spatial memory of where the parent was is
  // intact. Composes with the per-rollupStatus selectors via
  // cytoscape's per-selector merging.
  // Refinement: tasks/refinements/audience/aud_decomposition_animation.md
  {
    selector: 'node[?decomposed]',
    style: {
      opacity: 0.15,
    },
  },
  // `aud_render_annotation_endpoint_edges` Decision §5 — annotation
  // graph-node baseline. The `nodeKind` attribute key is fresh (no
  // cross-layer interference with the per-rollupStatus / `[?decomposed]`
  // selectors above — annotation nodes stamp the sentinel
  // `rollupStatus: 'none'` and `decomposed: undefined` so those
  // selectors don't match). Round-tag shape signals "commentary"
  // visually; the 140×48 footprint is proportional to (and smaller
  // than) the statement node 200×80 so promoted annotations read as
  // subordinate. Baseline palette is amber-100 fill + amber-900
  // border/text (Decision §5 note kind); the four per-kind overrides
  // below claim background + border + text on the non-`note` kinds.
  {
    selector: "node[nodeKind = 'annotation']",
    style: {
      shape: 'round-tag',
      width: 140,
      height: 48,
      'background-color': '#fef3c7',
      'border-color': '#92400e',
      'border-width': 1,
      color: '#92400e',
      'font-size': BROADCAST_ANNOTATION_FONT_SIZE_PX,
      'text-max-width': '120px',
    },
  },
  // Per-kind palette overrides per Decision §5: amber-100/-900 (note),
  // violet-100/-900 (reframe), teal-100/-900 (scope-change), sky-100/-900
  // (stance). Matches the participant's `part_render_annotation_endpoint_edges`
  // D4 cross-surface vocabulary; the per-kind colour is the only way to
  // communicate annotation kind on the broadcast canvas (no per-node
  // React subtree, no title-attribute hover affordance).
  {
    selector: "node[nodeKind = 'annotation'][annotationKind = 'note']",
    style: {
      'background-color': '#fef3c7',
      'border-color': '#92400e',
      color: '#92400e',
    },
  },
  {
    selector: "node[nodeKind = 'annotation'][annotationKind = 'reframe']",
    style: {
      'background-color': '#ede9fe',
      'border-color': '#4c1d95',
      color: '#4c1d95',
    },
  },
  {
    selector: "node[nodeKind = 'annotation'][annotationKind = 'scope-change']",
    style: {
      'background-color': '#ccfbf1',
      'border-color': '#134e4a',
      color: '#134e4a',
    },
  },
  {
    selector: "node[nodeKind = 'annotation'][annotationKind = 'stance']",
    style: {
      'background-color': '#e0f2fe',
      'border-color': '#0c4a6e',
      color: '#0c4a6e',
    },
  },
  // `aud_render_annotation_endpoint_edges` Decision §7 — synthetic
  // annotation-host pseudo-edge. Dashed slate-300 line, no arrow, no
  // label. The `label: ''` override is intentional — Cytoscape edge
  // labels are stylesheet-driven; setting `label: ''` overrides the
  // baseline `label: 'data(roleLabel)'` so the host pseudo-edge stays
  // unannotated. The audience's `autoungrabify: true` core posture
  // already disables interaction; no `pointer-events: none` analog is
  // needed.
  {
    selector: "edge[entityRole = 'annotation-host']",
    style: {
      'line-style': 'dashed',
      'line-color': '#cbd5e1',
      'target-arrow-shape': 'none',
      label: '',
    },
  },
];
