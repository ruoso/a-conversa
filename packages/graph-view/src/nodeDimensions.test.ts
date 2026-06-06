// Vitest cases for `computeNodeDimensions` — the pure per-node sizing
// function the audience projector calls once per `node-created` event.
//
// Companion to `apps/participant/src/graph/nodeDimensions.test.ts`; the
// constants differ because the broadcast node renders at 14px SemiBold
// (vs the participant's 12px) so this module's min/max box bounds and
// line-height diverge.
//
// ADRs: 0022 (no throwaway verifications).
//
// Measurement backend: the happy-dom test env (via
// `installCytoscapeTestEnv`) shims `HTMLCanvasElement.prototype.getContext`
// so `measureText(text)` returns `{ width: text.length * 7 }` —
// content-sensitive enough to exercise the clamp + wrap branches without
// a real font-rendering pass. Production browsers use the platform's real
// `measureText`; the algorithm path is identical.

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
    // 'Yes' → 3 * 7 = 21 px + 24 padding = 45 px, below the 100 px floor.
    const dims = computeNodeDimensions('Yes');
    expect(dims.width).toBe(MIN_NODE_WIDTH);
    expect(dims.height).toBe(MIN_NODE_HEIGHT);
  });

  it('(c) medium wording sits between the bounds and at minimum height when it fits on one line', () => {
    // 'A statement of moderate width' → 29 chars * 7 = 203 px, under the
    // 216 px (= max-width - 2*padding) budget, so it stays on one line:
    // a wider-than-min box at the single-line minimum height.
    const dims = computeNodeDimensions('A statement of moderate width');
    expect(dims.width).toBeGreaterThan(MIN_NODE_WIDTH);
    expect(dims.width).toBeLessThanOrEqual(MAX_NODE_WIDTH);
    expect(dims.height).toBe(MIN_NODE_HEIGHT);
  });

  it('(d) long wording (multi-word, ~200 chars) caps width at max and grows height', () => {
    const long =
      'the audience should see this wording wrap across several lines as the broadcast card grows to fit its content without clipping or overflowing the rounded rectangle box that cytoscape draws on the canvas';
    const dims = computeNodeDimensions(long);
    expect(dims.width).toBe(MAX_NODE_WIDTH);
    expect(dims.height).toBeGreaterThan(MIN_NODE_HEIGHT);
    expect(dims.height).toBeLessThanOrEqual(MAX_NODE_HEIGHT);
  });

  it('(e) runaway wording (~2400 chars) hits both the max-width AND max-height clamps', () => {
    const runaway = 'lorem '.repeat(400);
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

  it('(h) distinct wordings produce distinct widths (sizing tracks content, not a constant)', () => {
    const short = computeNodeDimensions('Short');
    const medium = computeNodeDimensions('A statement of moderate width');
    expect(medium.width).toBeGreaterThan(short.width);
  });
});
