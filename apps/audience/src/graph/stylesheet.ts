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
// History: this module collects the per-state selector decisions
// landed across `aud_proposed_styling`, `aud_agreed_styling`,
// `aud_disputed_styling`, and the typography pins from
// `aud_clean_typography`. See those refinements for the per-decision
// rationale; this file is the data, `GraphView.tsx` is the consumer.
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
 * Cytoscape stylesheet for the audience broadcast surface.
 *
 * Module-scope so the reference is stable across renders — Cytoscape
 * diffs by reference identity, not deep equality. Numeric `width: 200`
 * / `height: 80` is the validated post-deviation pattern: the
 * participant's status block documents that `width: 'label'` /
 * `height: 'label'` was deprecated by Cytoscape 3.33 and surfaces as a
 * `console.warn`, which the Vitest harness treats as a failure per
 * `vitest.setup.ts`. The audience adopts numeric width/height up-front
 * rather than rediscovering the deviation.
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
 * the states that need them). Typography, geometry, label, shape,
 * background, and text-background fields all inherit from the
 * baseline `node` / `edge` selectors via Cytoscape's per-selector
 * composition (an element matching two selectors merges their style
 * objects; later selectors win on the conflicting keys). The
 * `data.rollupStatus` attribute the selectors key on is emitted by
 * `projectGraph` for every projected element, sourced from
 * `cardRollupStatus(facetStatuses)` in `./facetStatus.ts` (the
 * verbatim-from-participant derivation). Entities whose per-facet
 * record is empty stamp the literal sentinel `'none'` so attribute-
 * equality selectors have a stable value to match on (per
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
      'text-max-width': '180px',
      color: '#0f172a',
      'text-valign': 'center',
      'text-halign': 'center',
      width: 200,
      height: 80,
      'font-family': BROADCAST_FONT_STACK,
      'font-size': BROADCAST_NODE_FONT_SIZE_PX,
      'font-weight': BROADCAST_NODE_FONT_WEIGHT,
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
      'border-color': '#334155',
    },
  },
  {
    selector: "edge[rollupStatus = 'agreed']",
    style: {
      'line-color': '#334155',
      'target-arrow-color': '#334155',
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
      'border-color': '#e11d48',
      'border-width': 3,
    },
  },
  {
    selector: "edge[rollupStatus = 'disputed']",
    style: {
      'line-color': '#e11d48',
      'target-arrow-color': '#e11d48',
    },
  },
];
