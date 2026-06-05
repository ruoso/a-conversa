// Pure projection-diff helper — the structural difference between two
// `projectGraph` outputs.
//
// Refinement: tasks/refinements/replay_test/test_mode_changed_highlights.md
// TaskJuggler: replay_test.test_mode.test_mode_changed_highlights
// ADRs:        0039 (graph-view package — the `Audience*Element` shapes this
//                    diffs are the canonical projector's output),
//              0022 (this pure helper is unit-tested independently of React).
//
// `ChangeHighlights` projects the event prefixes `[0..p-1]` and `[0..p]`
// through the canonical `projectGraph` and hands the two element sets here
// (Decision §2 — the diff is derived from projector output, never by
// re-interpreting `event.kind`). This module keys both sides by `data.id`
// (Decision §3) and buckets every element as added / removed / changed:
//
//   - present in `after` but not `before`  → added
//   - present in `before` but not `after`  → removed
//   - present in both, `data` not deep-equal → changed
//
// "Changed" is a structural deep-compare over the whole `data` object, not a
// hand-picked field allow-list (Decision §3) — self-maintaining as
// `AudienceNodeData` / `AudienceEdgeData` grow. For each changed element the
// diff also reports which top-level `data` keys differ, so the panel can show
// the touched field names verbatim (Constraint §7).

import type { AudienceEdgeElement, AudienceNodeElement } from '@a-conversa/graph-view';

/** A single element whose `data` differs between the before- and after-set. */
export interface ChangedElement<E> {
  /** The shared `data.id` (the diff key). */
  readonly id: string;
  /** The element as it was in the before-set. */
  readonly before: E;
  /** The element as it is in the after-set. */
  readonly after: E;
  /** Top-level `data` keys whose values are not deep-equal, in `after`-key
   * order then any before-only keys. Rendered verbatim as data (Constraint §7). */
  readonly changedFields: string[];
}

/** The six symmetric buckets for a node/edge projection diff. */
export interface ProjectionDiff {
  readonly nodesAdded: AudienceNodeElement[];
  readonly nodesRemoved: AudienceNodeElement[];
  readonly nodesChanged: ChangedElement<AudienceNodeElement>[];
  readonly edgesAdded: AudienceEdgeElement[];
  readonly edgesRemoved: AudienceEdgeElement[];
  readonly edgesChanged: ChangedElement<AudienceEdgeElement>[];
}

/** A `projectGraph` output (or either prefix's projection). */
export interface Projection {
  readonly nodes: readonly AudienceNodeElement[];
  readonly edges: readonly AudienceEdgeElement[];
}

/**
 * Structural deep-equality over arbitrary JSON-ish projector data. The
 * projector emits plain objects, arrays, strings, numbers, booleans, and
 * `null` (plus stable frozen-default empties per `projectGraph.ts` — those
 * compare equal by value here, so referentially-stable empties never
 * false-positive as a change, Decision §3).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null || typeof a !== 'object') {
    // Primitives (already failed `===`) or a null/non-null mismatch.
    return false;
  }

  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) {
    return false;
  }
  if (aArray && bArray) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key]),
  );
}

/** Top-level `data` keys whose values are not deep-equal, in `after`-then-
 * before-only order. */
function changedDataFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const fields: string[] = [];
  for (const key of Object.keys(after)) {
    if (!deepEqual(after[key], before[key])) {
      fields.push(key);
    }
  }
  for (const key of Object.keys(before)) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) {
      fields.push(key);
    }
  }
  return fields;
}

interface ElementBuckets<E> {
  readonly added: E[];
  readonly removed: E[];
  readonly changed: ChangedElement<E>[];
}

function diffElements<E extends { readonly data: { readonly id: string } }>(
  before: readonly E[],
  after: readonly E[],
): ElementBuckets<E> {
  const beforeById = new Map(before.map((element) => [element.data.id, element]));
  const afterById = new Map(after.map((element) => [element.data.id, element]));

  const added: E[] = [];
  const changed: ChangedElement<E>[] = [];
  for (const element of after) {
    const prior = beforeById.get(element.data.id);
    if (prior === undefined) {
      added.push(element);
    } else if (!deepEqual(prior.data, element.data)) {
      changed.push({
        id: element.data.id,
        before: prior,
        after: element,
        changedFields: changedDataFields(prior.data, element.data),
      });
    }
  }

  const removed = before.filter((element) => !afterById.has(element.data.id));

  return { added, removed, changed };
}

/**
 * Diff two projections into the six symmetric buckets. Pure: no React, no
 * event interpretation — only set comparison over projector output. An
 * element lands in exactly one of added/removed/changed (or none, when
 * unchanged).
 */
export function diffProjection(before: Projection, after: Projection): ProjectionDiff {
  const nodes = diffElements(before.nodes, after.nodes);
  const edges = diffElements(before.edges, after.edges);
  return {
    nodesAdded: nodes.added,
    nodesRemoved: nodes.removed,
    nodesChanged: nodes.changed,
    edgesAdded: edges.added,
    edgesRemoved: edges.removed,
    edgesChanged: edges.changed,
  };
}

/** `true` when no bucket holds an element — the step touched nothing. */
export function isEmptyDiff(diff: ProjectionDiff): boolean {
  return (
    diff.nodesAdded.length === 0 &&
    diff.nodesRemoved.length === 0 &&
    diff.nodesChanged.length === 0 &&
    diff.edgesAdded.length === 0 &&
    diff.edgesRemoved.length === 0 &&
    diff.edgesChanged.length === 0
  );
}
