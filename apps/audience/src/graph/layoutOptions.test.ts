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
  PADDING,
  SPACING_FACTOR,
  buildAudienceLayoutOptions,
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
    // diff, not a silent drift. The future `aud_obs_sizing_defaults`
    // task overrides them per-source via `MountProps.broadcastDimensions`;
    // this assertion catches accidental changes in the meantime.
    expect(SPACING_FACTOR).toBe(1.45);
    expect(PADDING).toBe(60);
  });
});
