// Tests for `enrichAnnotationsWithFacetStatuses` — the moderator-side
// selector layer that joins the shell-shaped `Annotation[]` with a
// per-annotation `FacetStatus` index to produce the render carrier
// `AnnotationRenderData[]`.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_disputed_visibility.md
//
// Per ADR 0022 these are committed cases pinning the selector seam, not
// throwaway probes. They cover:
//
//   1. Empty index → every input annotation flows through with no
//      `facetStatuses` field set (the steady-state shape today).
//   2. Index hit on one annotation in a multi-annotation input → only
//      that one carries `facetStatuses`; the others pass through.
//   3. Index entry for an unknown id is ignored (the engine could in
//      principle emit a row for an annotation we haven't seen yet).
//   4. Function is referentially pure — does NOT mutate either input.

import { describe, expect, it } from 'vitest';

import { type Annotation, type FacetName, type FacetStatus } from '@a-conversa/shell';

import {
  EMPTY_ANNOTATION_FACET_STATUS_INDEX,
  enrichAnnotationsWithFacetStatuses,
  type AnnotationFacetStatusIndex,
} from './selectors.js';

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'an annotation body',
    targetNodeId: overrides.targetNodeId ?? 'node-x',
    targetEdgeId: overrides.targetEdgeId ?? null,
    createdBy: overrides.createdBy ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: overrides.createdAt ?? '2026-05-11T00:00:00.000Z',
  };
}

describe('enrichAnnotationsWithFacetStatuses', () => {
  it('empty index leaves every annotation without facetStatuses (steady-state today)', () => {
    const inputs: readonly Annotation[] = [
      makeAnnotation({ id: 'a1' }),
      makeAnnotation({ id: 'a2', kind: 'reframe' }),
    ];
    const out = enrichAnnotationsWithFacetStatuses(inputs, EMPTY_ANNOTATION_FACET_STATUS_INDEX);
    expect(out).toHaveLength(2);
    for (const carrier of out) {
      expect(carrier.facetStatuses).toBeUndefined();
    }
  });

  it('matching index entry attaches facetStatuses to that annotation only', () => {
    const inputs: readonly Annotation[] = [
      makeAnnotation({ id: 'a1' }),
      makeAnnotation({ id: 'a2', kind: 'reframe' }),
      makeAnnotation({ id: 'a3', kind: 'stance' }),
    ];
    const disputed: Readonly<Partial<Record<FacetName, FacetStatus>>> = { wording: 'disputed' };
    const index: AnnotationFacetStatusIndex = new Map([['a2', disputed]]);
    const out = enrichAnnotationsWithFacetStatuses(inputs, index);
    expect(out).toHaveLength(3);
    expect(out[0]?.facetStatuses).toBeUndefined();
    expect(out[1]?.facetStatuses).toEqual({ wording: 'disputed' });
    expect(out[2]?.facetStatuses).toBeUndefined();
  });

  it('index entry for an unknown id is silently ignored', () => {
    const inputs: readonly Annotation[] = [makeAnnotation({ id: 'known' })];
    const disputed: Readonly<Partial<Record<FacetName, FacetStatus>>> = { wording: 'disputed' };
    const index: AnnotationFacetStatusIndex = new Map([
      ['known', disputed],
      ['stale-or-unseen', { wording: 'agreed' }],
    ]);
    const out = enrichAnnotationsWithFacetStatuses(inputs, index);
    expect(out).toHaveLength(1);
    expect(out[0]?.facetStatuses).toEqual({ wording: 'disputed' });
  });

  it('does not mutate the input annotation array or the index', () => {
    const a1 = makeAnnotation({ id: 'a1' });
    const a2 = makeAnnotation({ id: 'a2' });
    const inputs: readonly Annotation[] = [a1, a2];
    const inputsSnapshot = inputs.slice();
    const disputed: Readonly<Partial<Record<FacetName, FacetStatus>>> = { wording: 'disputed' };
    const index = new Map([['a1', disputed]]);
    const indexSnapshot = new Map(index);
    enrichAnnotationsWithFacetStatuses(inputs, index);
    expect(inputs).toEqual(inputsSnapshot);
    expect(index).toEqual(indexSnapshot);
    expect(a1).not.toHaveProperty('facetStatuses');
    expect(a2).not.toHaveProperty('facetStatuses');
  });
});
