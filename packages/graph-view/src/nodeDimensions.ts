// Per-node Cytoscape box-sizing for the audience broadcast graph.
//
// Companion to the participant's `apps/participant/src/graph/nodeDimensions.ts`
// (per `tasks/refinements/participant-ui/part_layout_measured_dimensions.md`).
// The audience canvas had been pinning statement nodes to a constant
// `width: 200` / `height: 80` (a deferral inherited from the participant's
// `part_graph_render` Decision §7 — see the status block in `stylesheet.ts`),
// which makes a one-word statement and a three-line statement occupy the
// same box. This module closes that deferral on the broadcast surface the
// same way the participant did: measure the wording, return the box
// width/height plus the matching text-wrap budget, and let the
// `width: 'data(width)'` / `height: 'data(height)'` /
// `'text-max-width': 'data(textMaxWidth)'` mappers in `STYLESHEET` read
// them back.
//
// Two callers now duplicate this algorithm (participant app + this
// package). Per the codebase's "extract at the third caller" convention
// (and the cross-app-import ban under pnpm-workspaces, documented in
// `cytoscapeTestEnv.ts`), the copy stays local until a third Cytoscape
// consumer materializes; the constants below diverge from the
// participant's on purpose — the broadcast node renders at the larger
// `BROADCAST_NODE_FONT_SIZE_PX` (14px SemiBold) rather than the
// participant's 12px, so the measurement font and line-height track the
// broadcast typography.
//
// Measurement source: a module-singleton offscreen-canvas 2d context
// (created lazily on first call). The happy-dom stub in
// `cytoscapeTestEnv.ts` widens `measureText` to return
// `{ width: text.length * 7 }`, so the same algorithm runs honestly
// under Vitest — there is no separate "test path".

const DEFAULT_FONT = '600 14px sans-serif';
const DEFAULT_PADDING = 12;
const DEFAULT_LINE_HEIGHT = 20;

export const MIN_NODE_WIDTH = 100;
export const MAX_NODE_WIDTH = 240;
export const MIN_NODE_HEIGHT = 56;
export const MAX_NODE_HEIGHT = 240;

export interface NodeDimensions {
  readonly width: number;
  readonly height: number;
  readonly textMaxWidth: number;
}

export interface ComputeNodeDimensionsOptions {
  readonly font?: string;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly padding?: number;
  readonly lineHeight?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
}

interface ResolvedOptions {
  readonly font: string;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly padding: number;
  readonly lineHeight: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

function resolveOptions(options: ComputeNodeDimensionsOptions | undefined): ResolvedOptions {
  return {
    font: options?.font ?? DEFAULT_FONT,
    minWidth: options?.minWidth ?? MIN_NODE_WIDTH,
    maxWidth: options?.maxWidth ?? MAX_NODE_WIDTH,
    padding: options?.padding ?? DEFAULT_PADDING,
    lineHeight: options?.lineHeight ?? DEFAULT_LINE_HEIGHT,
    minHeight: options?.minHeight ?? MIN_NODE_HEIGHT,
    maxHeight: options?.maxHeight ?? MAX_NODE_HEIGHT,
  };
}

// Module-singleton canvas context — lazily acquired on first call so the
// module import is cheap. `null` means "we tried and the platform doesn't
// have a 2d context"; in that case every measurement uses the
// character-count fallback below.
let cachedContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (cachedContext !== undefined) return cachedContext;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d');
      cachedContext = (ctx as unknown as CanvasRenderingContext2D | null) ?? null;
      return cachedContext;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      cachedContext = ctx ?? null;
      return cachedContext;
    }
  } catch {
    // Fall through to the fallback path.
  }
  cachedContext = null;
  return null;
}

// `Math.min(max, Math.max(min, value))` — Math.clamp is not yet ubiquitous.
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function measureLine(text: string, font: string): number {
  const ctx = getMeasureContext();
  if (ctx === null) {
    // No canvas context — fall back to the character-count estimate.
    return text.length * 7;
  }
  ctx.font = font;
  const width = ctx.measureText(text).width;
  // happy-dom's stub returns `text.length * 7` directly, so the
  // `width > 0` branch is the one exercised under tests; the fallback
  // covers any platform whose `measureText` reports 0.
  if (width > 0) return width;
  return text.length * 7;
}

function wrapToLines(text: string, budget: number, font: string): string[] {
  if (text.length === 0) return [];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    const candidateWidth = measureLine(candidate, font);
    if (candidateWidth <= budget || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Compute the per-node Cytoscape box dimensions for a given wording
 * string. Pure given its inputs; the only side effect is the lazy
 * acquisition of a module-singleton canvas 2d context.
 *
 * - `width` / `height` are the box dimensions in px, clamped to
 *   `[MIN_NODE_WIDTH, MAX_NODE_WIDTH]` and `[MIN_NODE_HEIGHT,
 *    MAX_NODE_HEIGHT]`. The clamp on both ends matters: short wordings
 *   need the `min` floor; runaway wordings need the `max` ceiling.
 * - `textMaxWidth` is the px budget for Cytoscape's `text-wrap: 'wrap'`
 *   engine, always `width - 2 * padding`. Stamped on `data.*` so the
 *   stylesheet's `'text-max-width': 'data(textMaxWidth)'` mapper reads
 *   the same budget the measurement used.
 */
export function computeNodeDimensions(
  wording: string,
  options?: ComputeNodeDimensionsOptions,
): NodeDimensions {
  const opts = resolveOptions(options);
  const budget = opts.maxWidth - 2 * opts.padding;
  const lines = wrapToLines(wording, budget, opts.font);
  let longestLineWidth = 0;
  for (const line of lines) {
    const w = measureLine(line, opts.font);
    if (w > longestLineWidth) longestLineWidth = w;
  }
  // Width policy: if the wording fits on a single line, shrink the box
  // to that line's width (clamped to `[minWidth, maxWidth]`). If the
  // wording wrapped into multiple lines, snap the box to `maxWidth` so
  // Cytoscape's `text-max-width: 'data(textMaxWidth)'` mapper sees the
  // SAME wrap budget the pre-computation used — otherwise Cytoscape
  // would re-wrap against a narrower budget, producing a different line
  // count than the one we sized for.
  const wrapped = lines.length > 1;
  const widthRaw = wrapped ? opts.maxWidth : longestLineWidth + 2 * opts.padding;
  const width = clamp(widthRaw, opts.minWidth, opts.maxWidth);
  const lineCount = Math.max(1, lines.length);
  const height = clamp(
    lineCount * opts.lineHeight + 2 * opts.padding,
    opts.minHeight,
    opts.maxHeight,
  );
  const textMaxWidth = width - 2 * opts.padding;
  return { width, height, textMaxWidth };
}
