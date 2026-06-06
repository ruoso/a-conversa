// Vitest cases for the audience-side Cytoscape layout-options builder.
//
// Refinement: tasks/refinements/audience/aud_layout_engine.md
//   (8 cases pin: empty input → `[]`; single-node input → that id;
//   multi-component → one root per component, sort-stable lowest-id
//   wins ties; linear chain → only the chain head; all-cyclic → `[]`;
//   `buildAudienceLayoutOptions([])` carries the broadcast-tuned
//   constants; the full builder threads `selectDeterministicRoots`
//   into the returned `roots`; the named-export constants are
//   regression-pinned so a silent drift surfaces as a diff.)
//
// ADRs:
//   - 0022 (no throwaway verifications — this Vitest layer is the
//     regression pin for the pure layout-options computation; the
//     visible-output pin defers to `aud_visual_regression`).

import { describe, expect, it } from 'vitest';
import type { ElementDefinition } from 'cytoscape';

import {
  BROADCAST_DIMENSIONS,
  COMPONENT_SPACING,
  DEFAULT_BROADCAST_DIMENSIONS,
  LEVEL_SPACING_FACTOR,
  PACK_HORIZONTAL_LEAN,
  PADDING,
  SPACING_FACTOR,
  type ComponentSize,
  type ComponentSlot,
  buildAudienceLayoutOptions,
  packComponentBoxes,
  selectDeterministicRoots,
} from './layoutOptions';

const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const NODE_C = '00000000-0000-4000-8000-00000000000c';
const NODE_D = '00000000-0000-4000-8000-00000000000d';
const EDGE_AB = '00000000-0000-4000-8000-0000000000e1';
const EDGE_BC = '00000000-0000-4000-8000-0000000000e2';
const EDGE_CD = '00000000-0000-4000-8000-0000000000e3';
const EDGE_CA = '00000000-0000-4000-8000-0000000000e4';

function nodeElement(id: string): ElementDefinition {
  return { group: 'nodes', data: { id, wording: id, kind: null } };
}

function edgeElement(id: string, source: string, target: string): ElementDefinition {
  return { group: 'edges', data: { id, source, target, role: 'supports' } };
}

describe('selectDeterministicRoots', () => {
  it('(1) returns `[]` for empty input', () => {
    expect(selectDeterministicRoots([])).toEqual([]);
  });

  it('(2) returns the single node id when given a single-node input', () => {
    expect(selectDeterministicRoots([nodeElement(NODE_A)])).toEqual([NODE_A]);
  });

  it('(3) returns one root per component, sort-stable lowest-id wins ties', () => {
    // Two disjoint components: A→B and D→C. Roots are A and D; sorted
    // ascending the output is [A, D]. The "lowest-id wins ties" tiebreak
    // is enforced by the sort, regardless of insertion order — the
    // edges deliberately list the second component's root (D) before
    // the first component's leaf (B) to demonstrate that input order
    // does not influence the result.
    const elements: ElementDefinition[] = [
      nodeElement(NODE_B),
      nodeElement(NODE_A),
      nodeElement(NODE_D),
      nodeElement(NODE_C),
      edgeElement(EDGE_AB, NODE_A, NODE_B),
      edgeElement(EDGE_CD, NODE_D, NODE_C),
    ];
    expect(selectDeterministicRoots(elements)).toEqual([NODE_A, NODE_D]);
  });

  it('(4) returns only the chain head for a linear chain A→B→C', () => {
    const elements: ElementDefinition[] = [
      nodeElement(NODE_A),
      nodeElement(NODE_B),
      nodeElement(NODE_C),
      edgeElement(EDGE_AB, NODE_A, NODE_B),
      edgeElement(EDGE_BC, NODE_B, NODE_C),
    ];
    expect(selectDeterministicRoots(elements)).toEqual([NODE_A]);
  });

  it('(5) returns `[]` for an all-cyclic component (no node without an incoming edge)', () => {
    // Three-cycle A→B→C→A; every node carries at least one incoming
    // edge, so no root candidate exists. Returning `[]` lets Cytoscape's
    // heuristic handle the degenerate case rather than mis-rooting the
    // cycle on the lowest id.
    const elements: ElementDefinition[] = [
      nodeElement(NODE_A),
      nodeElement(NODE_B),
      nodeElement(NODE_C),
      edgeElement(EDGE_AB, NODE_A, NODE_B),
      edgeElement(EDGE_BC, NODE_B, NODE_C),
      edgeElement(EDGE_CA, NODE_C, NODE_A),
    ];
    expect(selectDeterministicRoots(elements)).toEqual([]);
  });
});

describe('buildAudienceLayoutOptions', () => {
  it('(6) returns the broadcast-tuned baseline on empty input', () => {
    const options = buildAudienceLayoutOptions([]);
    expect(options.name).toBe('breadthfirst');
    expect(options.directed).toBe(true);
    expect(options.circle).toBe(false);
    expect(options.grid).toBe(false);
    expect(options.avoidOverlap).toBe(true);
    expect(options.spacingFactor).toBe(1.45);
    expect(options.nodeDimensionsIncludeLabels).toBe(false);
    expect(options.padding).toBe(60);
    expect(options.animate).toBe(false);
    expect(options.fit).toBe(false);
    expect(options.roots).toEqual([]);
  });

  it('(7) threads `selectDeterministicRoots` output into the returned `roots`', () => {
    const elements: ElementDefinition[] = [
      nodeElement(NODE_A),
      nodeElement(NODE_B),
      nodeElement(NODE_C),
      edgeElement(EDGE_AB, NODE_A, NODE_B),
      edgeElement(EDGE_BC, NODE_B, NODE_C),
    ];
    const options = buildAudienceLayoutOptions(elements);
    expect(options.roots).toEqual(selectDeterministicRoots(elements));
    expect(options.roots).toEqual([NODE_A]);
  });
});

describe('layout-options named exports', () => {
  it('(8) pins `SPACING_FACTOR` to 1.45 and `PADDING` to 60', () => {
    // Regression pin: changing the constants is an intentional source-
    // diff, not a silent drift. The values are tuned for
    // `DEFAULT_BROADCAST_DIMENSIONS` (1080p) per `aud_obs_sizing_defaults`;
    // this assertion catches accidental changes in the meantime.
    expect(SPACING_FACTOR).toBe(1.45);
    expect(PADDING).toBe(60);
  });

  it('(8b) pins the packing / spacing visual dials', () => {
    // Pinned so a retune is an intentional source diff.
    expect(COMPONENT_SPACING).toBe(80);
    expect(LEVEL_SPACING_FACTOR).toBe(0.5);
    expect(PACK_HORIZONTAL_LEAN).toBe(0.5);
  });

  it('(8c) the horizontal lean breaks a straddling tie toward the wider arrangement', () => {
    // One wide box + several short ones, on a target aspect that sits
    // BETWEEN the compact (taller) and spread (wider) arrangements. The
    // lean must pick the wider one — this is the "stacked vertically when
    // there was horizontal room" case.
    // Modelled on the real "step 117" set: one 4-card-wide thread, one
    // 2-wide thread, and several single nodes. At target 2.0 a pure
    // aspect-match stacks them into bands (~1.5 aspect); the lean instead
    // sets the two threads side-by-side for a markedly wider arrangement.
    const sizes: ComponentSize[] = [
      { w: 1284, h: 304 },
      { w: 588, h: 304 },
      { w: 240, h: 110 },
      { w: 240, h: 110 },
      { w: 240, h: 110 },
      { w: 240, h: 110 },
      { w: 240, h: 110 },
    ];
    const slots = packComponentBoxes(sizes, { spacing: 80, targetAspect: 2.0 });
    let right = 0;
    let bottom = 0;
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      const slot = slots[i];
      if (size === undefined || slot === undefined) throw new Error('missing size/slot');
      right = Math.max(right, slot.x + size.w);
      bottom = Math.max(bottom, slot.y + size.h);
    }
    expect(right / bottom).toBeGreaterThan(2.0);
  });

  it('(9) pins `BROADCAST_DIMENSIONS` to {720p, 1080p, 1440p} and `DEFAULT_BROADCAST_DIMENSIONS` to 1080p', () => {
    // Regression pin: the triple is the canonical OBS-source matrix
    // (i18n_audience_typography.md line 24). Drift surfaces here and in
    // any downstream consumer that imports the symbol.
    expect(BROADCAST_DIMENSIONS.HD_720).toEqual({ width: 1280, height: 720 });
    expect(BROADCAST_DIMENSIONS.HD_1080).toEqual({ width: 1920, height: 1080 });
    expect(BROADCAST_DIMENSIONS.HD_1440).toEqual({ width: 2560, height: 1440 });
    // Referential equality — DEFAULT_BROADCAST_DIMENSIONS aliases HD_1080,
    // doesn't copy it, so a future swap of the default surfaces here.
    expect(DEFAULT_BROADCAST_DIMENSIONS).toBe(BROADCAST_DIMENSIONS.HD_1080);
  });
});

describe('packComponentBoxes', () => {
  // Two boxes overlap iff their x-intervals AND y-intervals overlap
  // (strict — touching edges are not an overlap; the packer leaves a
  // `spacing` gap, so true packings never even touch).
  function overlaps(
    a: ComponentSize,
    sa: ComponentSlot,
    b: ComponentSize,
    sb: ComponentSlot,
  ): boolean {
    return sa.x < sb.x + b.w && sb.x < sa.x + a.w && sa.y < sb.y + b.h && sb.y < sa.y + a.h;
  }

  it('(10) returns [] for empty input', () => {
    expect(packComponentBoxes([])).toEqual([]);
  });

  it('(11) places a single box at the origin', () => {
    expect(packComponentBoxes([{ w: 100, h: 50 }])).toEqual([{ x: 0, y: 0 }]);
  });

  it('(12) returns one slot per input box, in input order', () => {
    const sizes: ComponentSize[] = [
      { w: 100, h: 50 },
      { w: 60, h: 80 },
      { w: 40, h: 40 },
    ];
    expect(packComponentBoxes(sizes)).toHaveLength(3);
  });

  it('(13) produces a non-overlapping packing across varied box sizes', () => {
    const sizes: ComponentSize[] = [
      { w: 200, h: 80 },
      { w: 50, h: 50 },
      { w: 240, h: 200 },
      { w: 100, h: 40 },
      { w: 120, h: 160 },
      { w: 80, h: 80 },
      { w: 30, h: 30 },
    ];
    const slots = packComponentBoxes(sizes, { spacing: 20, targetAspect: 1 });
    for (let i = 0; i < sizes.length; i++) {
      for (let j = i + 1; j < sizes.length; j++) {
        const si = sizes[i];
        const sj = sizes[j];
        const pi = slots[i];
        const pj = slots[j];
        if (si === undefined || sj === undefined || pi === undefined || pj === undefined) {
          throw new Error('missing size/slot');
        }
        expect(overlaps(si, pi, sj, pj), `boxes ${String(i)} and ${String(j)} overlap`).toBe(false);
      }
    }
  });

  it('(14) wraps into multiple rows — fills 2D rather than a single flat row', () => {
    const sizes: ComponentSize[] = Array.from({ length: 9 }, () => ({ w: 100, h: 100 }));
    const slots = packComponentBoxes(sizes, { spacing: 10, targetAspect: 1 });
    const distinctRows = new Set(slots.map((s) => s.y));
    expect(distinctRows.size).toBeGreaterThan(1);
  });

  it('(15) is a pure function — identical input yields identical output', () => {
    const sizes: ComponentSize[] = [
      { w: 100, h: 50 },
      { w: 60, h: 120 },
      { w: 200, h: 80 },
      { w: 40, h: 40 },
    ];
    expect(packComponentBoxes(sizes)).toEqual(packComponentBoxes(sizes));
  });

  it('(16) a narrower target aspect packs taller (more rows) than a wider one', () => {
    const sizes: ComponentSize[] = Array.from({ length: 8 }, () => ({ w: 100, h: 100 }));
    const wide = packComponentBoxes(sizes, { targetAspect: 4 });
    const narrow = packComponentBoxes(sizes, { targetAspect: 0.25 });
    const maxY = (slots: ComponentSlot[]): number => Math.max(...slots.map((s) => s.y));
    expect(maxY(narrow)).toBeGreaterThan(maxY(wide));
  });

  it('(17) defaults the spacing to COMPONENT_SPACING when not supplied', () => {
    // A wide target row keeps both boxes on one row; the second box then
    // starts exactly `firstWidth + COMPONENT_SPACING` to the right, which
    // pins the default-spacing value. Equal-size boxes: the tie breaks by
    // index, so input order is preserved.
    const slots = packComponentBoxes(
      [
        { w: 100, h: 100 },
        { w: 100, h: 100 },
      ],
      { targetAspect: 100 },
    );
    expect(slots[0]).toEqual({ x: 0, y: 0 });
    expect(slots[1]).toEqual({ x: 100 + COMPONENT_SPACING, y: 0 });
  });

  it('(18) packs wide-but-short components horizontally on a wide target, not stacked vertically', () => {
    // Regression for the area-based row-width heuristic: wide-but-short
    // boxes have small total area, so `sqrt(area * aspect)` under-sized
    // the row and stacked them one-per-row even with horizontal room.
    const sizes: ComponentSize[] = Array.from({ length: 4 }, () => ({ w: 400, h: 100 }));
    const slots = packComponentBoxes(sizes, { spacing: 80, targetAspect: 1.875 });

    // Not one-per-row: at least one row holds 2+ components (shared y).
    const distinctRows = new Set(slots.map((s) => s.y)).size;
    expect(distinctRows).toBeLessThan(sizes.length);

    // The packed bounding box reads landscape (wider than tall), tracking
    // the landscape target instead of stringing down the page.
    let right = 0;
    let bottom = 0;
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      const slot = slots[i];
      if (size === undefined || slot === undefined) throw new Error('missing size/slot');
      right = Math.max(right, slot.x + size.w);
      bottom = Math.max(bottom, slot.y + size.h);
    }
    expect(right).toBeGreaterThan(bottom);
  });

  it('(19) tucks short boxes into the vertical gap beside a tall one (skyline gap-fill)', () => {
    // One tall box + three short ones. A shelf pack puts the short boxes
    // on a new full-height row (height ≈ 400 + gap + 100 = 520); the
    // skyline stacks them in the empty column beside the tall box, so the
    // packed height stays near the tall box's 400.
    const sizes: ComponentSize[] = [
      { w: 200, h: 400 },
      { w: 200, h: 100 },
      { w: 200, h: 100 },
      { w: 200, h: 100 },
    ];
    const slots = packComponentBoxes(sizes, { spacing: 20, targetAspect: 0.6 });
    let right = 0;
    let bottom = 0;
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      const slot = slots[i];
      if (size === undefined || slot === undefined) throw new Error('missing size/slot');
      right = Math.max(right, slot.x + size.w);
      bottom = Math.max(bottom, slot.y + size.h);
    }
    // Gap-filled: shorter than the shelf-pack's stacked-row height.
    expect(bottom).toBeLessThan(520);
  });
});
