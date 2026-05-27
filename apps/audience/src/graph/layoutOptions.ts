// Audience-side Cytoscape layout-options builder.
//
// Refinement: tasks/refinements/audience/aud_layout_engine.md
//   (Decision §1 — stay on bundled `breadthfirst`; plugin evaluation
//   deferred to a future `aud_alternative_layout_evaluation` task if
//   the visual-regression layer surfaces evidence the parameter space
//   cannot fix. Decision §2 — deterministic roots via sort-stable
//   lowest id so the layout output is a pure function of the projected
//   element set, independent of event-arrival order. Decision §4 —
//   `SPACING_FACTOR` and `PADDING` are named exports as conservative
//   starting points; the future `aud_obs_sizing_defaults` task wires
//   per-source overrides via a `MountProps.broadcastDimensions` prop.
//   Decision §6 — `selectDeterministicRoots` is a separate named
//   export so the Vitest layer can pin root-selection logic in
//   isolation.)
//
// ADRs:
//   - 0004 (Cytoscape's bundled layouts remain reserved for the
//     read-only surfaces; no new layout-plugin dependency);
//   - 0022 (no throwaway verifications — `layoutOptions.test.ts` is
//     the regression pin for the pure layout-options computation).

import type { BreadthFirstLayoutOptions, ElementDefinition } from 'cytoscape';

/**
 * Multiplicative factor applied to the layout's overall area.
 *
 * Looser than the participant's `1.25` (tuned for a tablet viewport)
 * because the broadcast video frame has 2-4x the horizontal pixels per
 * node. The actual value that produces broadcast-quality output depends
 * on the OBS source dimensions — `aud_obs_sizing_defaults` wires per-
 * source overrides on top of this conservative starting point.
 */
export const SPACING_FACTOR = 1.45;

/**
 * Padding (in px) the layout applies around the bounding box, and the
 * one-shot `cy.fit(PADDING)` call uses on the first non-empty render.
 *
 * Larger than the participant's `30` so OBS scene composers can crop
 * the source with margin. Overrideable by `aud_obs_sizing_defaults`.
 */
export const PADDING = 60;

/**
 * Selects deterministic `roots` for the `breadthfirst` layout.
 *
 * `breadthfirst` accepts an optional `roots: string[]` parameter; when
 * omitted, Cytoscape picks roots heuristically — nodes with no incoming
 * edge in the projected set, breaking ties by Cytoscape-internal
 * element-insertion order. The projected element array is built by
 * `projectGraph` which walks the event log in arrival order, so two
 * semantically-identical event sequences arriving in different orders
 * would produce different root choices and therefore different layouts.
 *
 * The fix: filter nodes with no incoming edge in the projected set and
 * sort by id (the entity id is stable across replays). This makes the
 * layout output a pure function of the projected element set.
 *
 * Edge case: an all-cyclic component (every node has at least one
 * incoming edge) yields `[]`. Cytoscape's heuristic handles the
 * degenerate case; forcing a tiebreak would mis-root a cycle.
 */
export function selectDeterministicRoots(elements: readonly ElementDefinition[]): string[] {
  const nodeIds: string[] = [];
  const nodesWithIncoming = new Set<string>();
  for (const element of elements) {
    if (element.group === 'nodes') {
      const id = element.data?.id;
      if (typeof id === 'string') nodeIds.push(id);
      continue;
    }
    if (element.group === 'edges') {
      const target = (element.data as { target?: unknown } | undefined)?.target;
      if (typeof target === 'string') nodesWithIncoming.add(target);
    }
  }
  return nodeIds.filter((id) => !nodesWithIncoming.has(id)).sort();
}

/**
 * Builds the Cytoscape layout-options object for the audience's
 * `cy.layout(...).run()` call.
 *
 * Pure function over `elements` so the Vitest layer can pin its output
 * without mounting Cytoscape. The element-sync `useEffect` in
 * `<AudienceGraphView>` recomputes the options on every layout pass so
 * the `roots` reflect the current projected element set.
 */
export function buildAudienceLayoutOptions(
  elements: readonly ElementDefinition[],
): BreadthFirstLayoutOptions {
  return {
    name: 'breadthfirst',
    directed: true,
    circle: false,
    grid: false,
    avoidOverlap: true,
    spacingFactor: SPACING_FACTOR,
    nodeDimensionsIncludeLabels: false,
    padding: PADDING,
    animate: false,
    fit: false,
    roots: selectDeterministicRoots(elements),
  };
}
