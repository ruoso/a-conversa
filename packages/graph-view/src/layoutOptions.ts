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
//   starting points tuned for `DEFAULT_BROADCAST_DIMENSIONS` (1080p);
//   the `aud_obs_sizing_defaults` leaf pins the canonical OBS-source
//   dimensions as the audience-internal `BROADCAST_DIMENSIONS` table
//   (locus correction from the layout-engine refinement's original
//   `MountProps.broadcastDimensions` wording — see that leaf's
//   Decision §1 for the cross-surface contract rationale).
//   Decision §6 — `selectDeterministicRoots` is a separate named
//   export so the Vitest layer can pin root-selection logic in
//   isolation.)
//
// ADRs:
//   - 0004 (Cytoscape's bundled layouts remain reserved for the
//     read-only surfaces; no new layout-plugin dependency);
//   - 0022 (no throwaway verifications — `layoutOptions.test.ts` is
//     the regression pin for the pure layout-options computation).

import type { BreadthFirstLayoutOptions, Core, ElementDefinition } from 'cytoscape';

/**
 * Multiplicative factor applied to the layout's overall area.
 *
 * Looser than the participant's `1.25` (tuned for a tablet viewport)
 * because the broadcast video frame has 2-4x the horizontal pixels per
 * node. Tuned for `DEFAULT_BROADCAST_DIMENSIONS` (1920×1080); empirical
 * re-tuning at 720p / 1440p is `aud_visual_regression`'s scope.
 */
export const SPACING_FACTOR = 1.45;

/**
 * Padding (in px) the layout applies around the bounding box, and the
 * one-shot `cy.fit(PADDING)` call uses on the first non-empty render.
 *
 * Larger than the participant's `30` so OBS scene composers can crop
 * the source with margin. Tuned for `DEFAULT_BROADCAST_DIMENSIONS`
 * (1920×1080); empirical re-tuning at 720p / 1440p is
 * `aud_visual_regression`'s scope.
 */
export const PADDING = 60;

/**
 * Canonical OBS browser-source dimensions referenced by the audience-
 * surface tests and the producer-facing setup docs.
 *
 * Source of truth for the {720p, 1080p, 1440p} triple established
 * prose-side in tasks/refinements/frontend-i18n/i18n_audience_typography.md
 * (line 24). Downstream consumers — `aud_obs_render_smoke` (pixel
 * smoke matrix), `aud_obs_setup_docs` (producer recommendation
 * matrix), `aud_visual_regression` (cross-resolution typography pins)
 * — import these constants rather than copy the numbers.
 */
export interface BroadcastDimensions {
  readonly width: number;
  readonly height: number;
}

export const BROADCAST_DIMENSIONS = {
  HD_720: { width: 1280, height: 720 },
  HD_1080: { width: 1920, height: 1080 },
  HD_1440: { width: 2560, height: 1440 },
} as const satisfies Readonly<Record<string, BroadcastDimensions>>;

/**
 * The canonical default OBS browser-source resolution — OBS Studio's
 * out-of-the-box size and the most common producer configuration.
 * `SPACING_FACTOR` and `PADDING` above are tuned for this resolution
 * per `aud_layout_engine.md` Decision §4.
 */
export const DEFAULT_BROADCAST_DIMENSIONS: BroadcastDimensions = BROADCAST_DIMENSIONS.HD_1080;

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
/**
 * The `breadthfirst` options shared by the whole-graph builder below and
 * the per-component passes in `layoutAndPackComponents`. Everything
 * except `roots` (which is graph- / component-specific) lives here so the
 * two call sites stay in lockstep.
 */
const BREADTHFIRST_BASE = {
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
} as const satisfies Omit<BreadthFirstLayoutOptions, 'roots'>;

export function buildAudienceLayoutOptions(
  elements: readonly ElementDefinition[],
): BreadthFirstLayoutOptions {
  return { ...BREADTHFIRST_BASE, roots: selectDeterministicRoots(elements) };
}

/**
 * Gap (px) left between packed connected-component bounding boxes. A bit
 * larger than the inter-node spacing so distinct argument threads read as
 * separate clusters on the broadcast canvas. Tuned for
 * `DEFAULT_BROADCAST_DIMENSIONS` alongside `SPACING_FACTOR` / `PADDING`.
 */
export const COMPONENT_SPACING = 80;

/**
 * Fallback target aspect ratio (width / height) for the packed bounding
 * box when the live viewport aspect is unavailable (e.g. a headless
 * measurement). 16:9 matches the broadcast frame and the typical landing
 * viewport, so `cy.fit` fills it rather than letterboxing.
 */
export const DEFAULT_PACK_ASPECT = 16 / 9;

export interface ComponentSize {
  readonly w: number;
  readonly h: number;
}

export interface ComponentSlot {
  readonly x: number;
  readonly y: number;
}

/**
 * Bin-packs connected-component bounding boxes into a roughly-rectangular
 * 2D arrangement so disconnected subgraphs fill the canvas instead of
 * stringing out in a single flat row. Pure over its inputs — the Vitest
 * layer pins it without a Cytoscape instance.
 *
 * Returns one `{ x, y }` target top-left per input box, IN INPUT ORDER
 * (the caller translates each component so its current bounding-box
 * top-left lands on the returned slot).
 *
 * Algorithm: next-fit-decreasing-height shelf packing. Boxes are placed
 * tallest-first into left-to-right rows; a row wraps when the next box
 * would exceed a target row width chosen so the overall packed box
 * approximates `targetAspect`. The tallest-first order plus a
 * size-then-index tiebreak keeps the packing a pure function of the
 * component sizes — same graph, same layout — preserving the determinism
 * `selectDeterministicRoots` already gives the per-component passes.
 */
export function packComponentBoxes(
  sizes: readonly ComponentSize[],
  options?: { readonly spacing?: number; readonly targetAspect?: number },
): ComponentSlot[] {
  const spacing = options?.spacing ?? COMPONENT_SPACING;
  const targetAspect =
    options?.targetAspect !== undefined && options.targetAspect > 0
      ? options.targetAspect
      : DEFAULT_PACK_ASPECT;
  const slots: ComponentSlot[] = new Array<ComponentSlot>(sizes.length);
  if (sizes.length === 0) return slots;

  let totalArea = 0;
  let maxWidth = 0;
  for (const size of sizes) {
    totalArea += size.w * size.h;
    if (size.w > maxWidth) maxWidth = size.w;
  }
  // Width of a box with the packed area and the target aspect:
  // `w = sqrt(area * aspect)`. Never narrower than the widest component,
  // so a single oversized component never forces an impossible row.
  const targetRowWidth = Math.max(maxWidth, Math.sqrt(totalArea * targetAspect));

  const order = sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size.h - a.size.h || b.size.w - a.size.w || a.index - b.index);

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const { size, index } of order) {
    if (cursorX > 0 && cursorX + size.w > targetRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + spacing;
      rowHeight = 0;
    }
    slots[index] = { x: cursorX, y: cursorY };
    cursorX += size.w + spacing;
    if (size.h > rowHeight) rowHeight = size.h;
  }
  return slots;
}

/**
 * Lays the graph out with `breadthfirst`, but ONE CONNECTED COMPONENT AT
 * A TIME, then bin-packs the component bounding boxes into 2D.
 *
 * Why per-component: Cytoscape's bundled `breadthfirst` builds a single
 * global depth array across the whole graph, so a one-shot pass
 * interleaves nodes from different components into the same horizontal
 * rows — disconnected subgraphs overlap and string out into a flat band.
 * Running each component on its own gives every component a clean,
 * self-contained box; `packComponentBoxes` then arranges those boxes to
 * fill the viewport. Single-component graphs skip the packing entirely
 * (the lone breadthfirst tree already frames itself).
 *
 * Determinism is preserved: per-component roots come from the same
 * "no incoming edge, lowest id first" rule as `selectDeterministicRoots`,
 * and the packing order is a pure function of the component sizes.
 */
export function layoutAndPackComponents(cy: Core): void {
  const components = cy.elements().components();
  if (components.length === 0) return;

  const boxes = components.map((component) => {
    const roots = component
      .nodes()
      .filter((node) => node.indegree(false) === 0)
      .map((node) => node.id())
      .sort();
    component.layout({ ...BREADTHFIRST_BASE, roots }).run();
    return component.boundingBox();
  });

  if (components.length === 1) return;

  const width = cy.width();
  const height = cy.height();
  const targetAspect =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? width / height
      : undefined;
  const slots = packComponentBoxes(
    boxes.map((box) => ({ w: box.w, h: box.h })),
    targetAspect === undefined ? undefined : { targetAspect },
  );

  components.forEach((component, i) => {
    const box = boxes[i];
    const slot = slots[i];
    if (box === undefined || slot === undefined) return;
    const dx = slot.x - box.x1;
    const dy = slot.y - box.y1;
    if (dx === 0 && dy === 0) return;
    component.nodes().forEach((node) => {
      const position = node.position();
      node.position({ x: position.x + dx, y: position.y + dy });
    });
  });
}
