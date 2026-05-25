// Vitest cases for `computeNodeDimensions` — the pure per-node sizing
// function the participant projector calls once per `node-created`
// event.
//
// Refinement: tasks/refinements/participant-ui/part_layout_measured_dimensions.md
// ADRs:        0022 (no throwaway verifications).
//
// Measurement backend: the happy-dom test env (via
// `installCytoscapeTestEnv`) shims `HTMLCanvasElement.prototype.getContext`
// so `measureText(text)` returns `{ width: text.length * 7 }` —
// content-sensitive enough to exercise the clamp + wrap branches without
// requiring a real font-rendering pass. Production browsers use the
// platform's real `measureText`; the algorithm path is identical.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  computeNodeDimensions,
  MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
} from './nodeDimensions';
import { installCytoscapeTestEnv, type CytoscapeTestEnvRestoreHandle } from './cytoscapeTestEnv';

const PADDING_BUDGET = 24; // 2 * default padding (12px)

let restore: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(() => {
  restore = installCytoscapeTestEnv();
});

afterAll(() => {
  restore?.restore();
});

describe('computeNodeDimensions', () => {
  it('(a) empty wording falls back to the min-width / min-height pair', () => {
    const dims = computeNodeDimensions('');
    expect(dims.width).toBe(MIN_NODE_WIDTH);
    expect(dims.height).toBe(MIN_NODE_HEIGHT);
    expect(dims.textMaxWidth).toBe(MIN_NODE_WIDTH - PADDING_BUDGET);
  });

  it('(b) short wording stays at min-width and single-line min-height', () => {
    const dims = computeNodeDimensions('Yes');
    expect(dims.width).toBeLessThan(100);
    expect(dims.width).toBeGreaterThanOrEqual(MIN_NODE_WIDTH);
    expect(dims.height).toBe(MIN_NODE_HEIGHT);
  });

  it('(c) medium wording sits between the bounds and at minimum height when it fits on one line', () => {
    // 28 chars * 7px/char = 196 px — under the 216 px max-width budget,
    // so this wraps onto a single line. The result is a wider-than-min
    // box at the single-line minimum height.
    const dims = computeNodeDimensions('A statement of moderate width');
    expect(dims.width).toBeGreaterThan(MIN_NODE_WIDTH);
    expect(dims.width).toBeLessThanOrEqual(MAX_NODE_WIDTH);
    expect(dims.height).toBe(MIN_NODE_HEIGHT);
  });

  it('(d) long wording (multi-word, ~200 chars) caps width at max and grows height', () => {
    // ~200 chars of multi-word text wraps into several lines under the
    // 216 px (= max-width - 2*padding) budget; width caps at MAX_NODE_WIDTH
    // and height climbs above the single-line minimum.
    const long =
      'the participant should see this wording wrap across several lines as the rendered card grows to fit its content without clipping or overflowing the rounded rectangle box that cytoscape draws on the canvas';
    const dims = computeNodeDimensions(long);
    expect(dims.width).toBe(MAX_NODE_WIDTH);
    expect(dims.height).toBeGreaterThan(MIN_NODE_HEIGHT);
    expect(dims.height).toBeLessThanOrEqual(MAX_NODE_HEIGHT);
  });

  it('(e) runaway wording (~2000 chars) hits both the max-width AND max-height clamps', () => {
    const word = 'lorem ';
    const runaway = word.repeat(400); // ~2400 chars
    const dims = computeNodeDimensions(runaway);
    expect(dims.width).toBe(MAX_NODE_WIDTH);
    expect(dims.height).toBe(MAX_NODE_HEIGHT);
  });

  it('(f) textMaxWidth invariant: textMaxWidth === width - 2*padding across the bounds', () => {
    const cases = ['', 'Yes', 'A statement of moderate width', 'lorem '.repeat(50)];
    for (const wording of cases) {
      const dims = computeNodeDimensions(wording);
      expect(dims.textMaxWidth).toBe(dims.width - PADDING_BUDGET);
    }
  });

  it('(g) options.padding overrides feed through to the textMaxWidth invariant', () => {
    const dims = computeNodeDimensions('Yes', { padding: 20 });
    expect(dims.textMaxWidth).toBe(dims.width - 40);
  });
});
