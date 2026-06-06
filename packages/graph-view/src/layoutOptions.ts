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

/**
 * Horizontal lean for the packer's arrangement choice (0 = pure
 * aspect-match, larger = stronger preference for WIDER arrangements).
 *
 * When two candidate arrangements straddle the target aspect — one a bit
 * too tall, one a bit too wide — a pure closest-aspect score picks the
 * tall one as often as not, which reads as "stacked vertically when there
 * was horizontal room". This subtracts `lean * log(aspect)` from the
 * score so a wider arrangement wins the near-ties, spreading components
 * across the width. It is deliberately gentle: an arrangement that is
 * WILDLY too wide still loses (its aspect distance dominates the bonus).
 * Tunable — purely a visual dial.
 */
export const PACK_HORIZONTAL_LEAN = 0.5;

/**
 * Vertical-compression factor applied to each component AFTER its
 * breadthfirst pass (1 = no change, smaller = tighter levels).
 *
 * breadthfirst spaces depth rows by an ISOTROPIC `minDistance` = the
 * largest node dimension. Our statement cards are wide-but-short
 * (~240×80), so that floor inherits the node WIDTH and reads as far too
 * much air between levels. There's no per-axis spacing knob in the
 * bundled layout, so we scale each node's y toward its component's
 * vertical centre to bring the depth rows closer without touching the
 * horizontal (sibling) spacing. Tunable — purely a visual dial.
 */
export const LEVEL_SPACING_FACTOR: number = 0.5;

/**
 * Near-zero boundingBox handed to each per-component breadthfirst pass so
 * it spaces nodes by its content-based `minDistance` floor instead of
 * spreading them across the (default) full viewport. The packing pass
 * places the resulting compact boxes; absolute coordinates here don't
 * matter, only the relative spacing.
 */
const COMPACT_LAYOUT_BOX = { x1: 0, y1: 0, w: 1, h: 1 } as const;

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
 * Algorithm: a proper 2D bottom-left SKYLINE bin-pack (not a shelf pack).
 * A shelf pack makes every row as tall as its tallest box and leaves the
 * vertical gaps beside short boxes empty — for the wide-but-short
 * component boxes this renderer produces, that wastes space and strings
 * components down the page. The skyline packer instead drops each box into
 * the lowest free spot along the current top profile, tucking short boxes
 * into those gaps. The bin WIDTH sets the arrangement's aspect (wider bin
 * = more side-by-side); we run the pack at each candidate bin width and
 * keep the arrangement whose bounding-box aspect is closest (in log-ratio)
 * to `targetAspect`. Tallest-first placement + a size/index tiebreak keep
 * it a pure, deterministic function of the component sizes.
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
  if (sizes.length === 0) return [];
  if (sizes.length === 1) return [{ x: 0, y: 0 }];

  const order = sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size.h - a.size.h || b.size.w - a.size.w || a.index - b.index);

  // Candidate bin widths span "the widest single box alone" up to "every
  // box side-by-side". Each box reserves its `spacing` gutter, so the
  // thresholds are the cumulative INFLATED (w + spacing) widths, widest
  // first — the points at which one more box can sit on the bottom row.
  const inflatedWidthsDesc = order.map((e) => e.size.w + spacing).sort((a, b) => b - a);
  const candidateWidths = new Set<number>();
  let cumulative = 0;
  for (const inflatedWidth of inflatedWidthsDesc) {
    cumulative += inflatedWidth;
    candidateWidths.add(cumulative);
  }

  let best: { slots: ComponentSlot[]; score: number; binWidth: number } | null = null;
  for (const binWidth of candidateWidths) {
    const packed = skylinePack(order, binWidth, spacing);
    const aspect = packed.height > 0 ? packed.width / packed.height : Number.POSITIVE_INFINITY;
    // Closest aspect to the target, with a gentle lean toward WIDER
    // arrangements (`PACK_HORIZONTAL_LEAN`) so near-ties that straddle the
    // target resolve horizontally rather than stacking.
    const score =
      Math.abs(Math.log(aspect) - Math.log(targetAspect)) - PACK_HORIZONTAL_LEAN * Math.log(aspect);
    // On a score tie prefer the WIDER bin (fills horizontally) so a wide
    // screen spreads components across rather than stacking them.
    if (best === null || score < best.score || (score === best.score && binWidth > best.binWidth)) {
      best = { slots: packed.slots, score, binWidth };
    }
  }
  return best === null ? [] : best.slots;
}

interface SkylineSegment {
  x: number;
  width: number;
  top: number;
}

/**
 * Bottom-left skyline bin-pack at a fixed bin width. Each box reserves a
 * `spacing` gutter on its right and bottom (so packed boxes never touch),
 * is dropped into the position along the skyline that yields the lowest
 * top (ties leftmost), and the skyline is raised under it. Returns the
 * per-box slots (input order) + the packed bounding size (over ACTUAL box
 * extents, gutters excluded).
 */
function skylinePack(
  order: ReadonlyArray<{ readonly size: ComponentSize; readonly index: number }>,
  binWidth: number,
  spacing: number,
): { slots: ComponentSlot[]; width: number; height: number } {
  let skyline: SkylineSegment[] = [{ x: 0, width: Math.max(binWidth, 1), top: 0 }];
  const slots: ComponentSlot[] = new Array<ComponentSlot>(order.length);
  let boundWidth = 0;
  let boundHeight = 0;
  for (const { size, index } of order) {
    const w = size.w + spacing;
    const h = size.h + spacing;
    let placeX = 0;
    let placeY = Number.POSITIVE_INFINITY;
    let placedTop = Number.POSITIVE_INFINITY;
    for (const segment of skyline) {
      const x = segment.x;
      // Skip anchors that would overflow the bin — except x = 0, which
      // always accepts a box wider than the bin (it then spans the row).
      if (x > 0 && x + w > binWidth) continue;
      const y = skylineTop(skyline, x, w);
      const top = y + h;
      if (top < placedTop || (top === placedTop && x < placeX)) {
        placeX = x;
        placeY = y;
        placedTop = top;
      }
    }
    if (!Number.isFinite(placeY)) {
      // Defensive: no anchor fit (shouldn't happen — x = 0 always does).
      placeX = 0;
      placeY = skylineTop(skyline, 0, w);
      placedTop = placeY + h;
    }
    slots[index] = { x: placeX, y: placeY };
    skyline = raiseSkyline(skyline, placeX, w, placedTop);
    if (placeX + size.w > boundWidth) boundWidth = placeX + size.w;
    if (placeY + size.h > boundHeight) boundHeight = placeY + size.h;
  }
  return { slots, width: boundWidth, height: boundHeight };
}

/** Highest skyline top over the span `[x, x + w)`. */
function skylineTop(skyline: readonly SkylineSegment[], x: number, w: number): number {
  const xEnd = x + w;
  let top = 0;
  for (const segment of skyline) {
    if (segment.x + segment.width <= x) continue;
    if (segment.x >= xEnd) break; // skyline is kept sorted by x
    if (segment.top > top) top = segment.top;
  }
  return top;
}

/** Raise the skyline over `[x, x + w)` to `top`, preserving the rest. */
function raiseSkyline(
  skyline: readonly SkylineSegment[],
  x: number,
  w: number,
  top: number,
): SkylineSegment[] {
  const xEnd = x + w;
  const next: SkylineSegment[] = [];
  for (const segment of skyline) {
    const segEnd = segment.x + segment.width;
    if (segEnd <= x || segment.x >= xEnd) {
      next.push({ ...segment });
      continue;
    }
    if (segment.x < x) next.push({ x: segment.x, width: x - segment.x, top: segment.top });
    if (segEnd > xEnd) next.push({ x: xEnd, width: segEnd - xEnd, top: segment.top });
  }
  next.push({ x, width: w, top });
  next.sort((a, b) => a.x - b.x);
  const merged: SkylineSegment[] = [];
  for (const segment of next) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.top === segment.top && last.x + last.width === segment.x) {
      last.width += segment.width;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/**
 * Aspect ratio (width / height) of the on-screen graph area the packing
 * should fill — the rendered viewport (`cy.width()`/`cy.height()`, the
 * container's measured pixels) minus the `PADDING` that `cy.fit` insets
 * on every side. Returns `undefined` when there is no real viewport
 * (headless measurement), so the packer falls back to
 * `DEFAULT_PACK_ASPECT`.
 */
function measuredViewportAspect(cy: Core): number | undefined {
  const usableWidth = cy.width() - 2 * PADDING;
  const usableHeight = cy.height() - 2 * PADDING;
  if (
    !Number.isFinite(usableWidth) ||
    !Number.isFinite(usableHeight) ||
    usableWidth <= 0 ||
    usableHeight <= 0
  ) {
    return undefined;
  }
  return usableWidth / usableHeight;
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
    // A tiny boundingBox keeps breadthfirst from spreading this (usually
    // small) component across the full viewport — without it, a 2-level
    // component drops ~1080px of height between its two rows. With a
    // ~zero box the layout falls back to its content-based `minDistance`
    // spacing, which the packing pass below then arranges in 2D.
    component.layout({ ...BREADTHFIRST_BASE, roots, boundingBox: COMPACT_LAYOUT_BOX }).run();
    // Tighten the inter-level (vertical) spacing: scale each node's y
    // toward the component's vertical centre. Sibling (horizontal)
    // spacing is untouched. See `LEVEL_SPACING_FACTOR`.
    if (LEVEL_SPACING_FACTOR !== 1) {
      const preBox = component.boundingBox();
      const centerY = (preBox.y1 + preBox.y2) / 2;
      component.nodes().forEach((node) => {
        const position = node.position();
        node.position({
          x: position.x,
          y: centerY + (position.y - centerY) * LEVEL_SPACING_FACTOR,
        });
      });
    }
    return component.boundingBox();
  });

  if (components.length === 1) return;

  // Target the packed box at the MEASURED on-screen graph area's aspect
  // so `cy.fit` fills it rather than letterboxing. The area the graph
  // actually occupies is the rendered viewport (`cy.width()`/`cy.height()`
  // — the container's measured pixels) minus the `PADDING` that `cy.fit`
  // insets on every side, so the ratio is taken over the USABLE box.
  // `DEFAULT_PACK_ASPECT` is only a headless fallback (no real viewport).
  const targetAspect = measuredViewportAspect(cy);
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
