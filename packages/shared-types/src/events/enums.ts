// Shared event-payload enums.
//
// Lives in its own module to break a circular import: `events.ts`
// imports the proposal payload schema from `./events/proposals.ts`,
// which in turn needs the annotation-kind enum. Hosting the enum in
// `events.ts` would create a cycle (proposals.ts ← events.ts ←
// proposals.ts) where one of the imports resolves to an uninitialized
// binding. Putting the enums in a leaf module both files import from
// breaks the cycle.
//
// Each enum mirrors the SQL CHECK constraint on the corresponding
// column exactly. Drift here would let payloads validate but inserts
// fail.

import { z } from 'zod';

/**
 * Edge role enum. Mirrors the CHECK constraint on `edges.role` in
 * `apps/server/migrations/0005_edges.sql` exactly.
 */
export const edgeRoleSchema = z.enum([
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
]);

export type EdgeRole = z.infer<typeof edgeRoleSchema>;

/**
 * Annotation kind enum. Mirrors the CHECK constraint on
 * `annotations.kind` in `apps/server/migrations/0006_annotations.sql`
 * exactly.
 */
export const annotationKindSchema = z.enum(['note', 'reframe', 'scope-change', 'stance']);

export type AnnotationKind = z.infer<typeof annotationKindSchema>;

/**
 * Entity-kind enum for `entity-included` payloads. Discriminates the
 * target join table: `node` → `session_nodes`, `edge` → `session_edges`,
 * `annotation` → `session_annotations` (R26).
 */
export const entityKindSchema = z.enum(['node', 'edge', 'annotation']);

export type EntityKind = z.infer<typeof entityKindSchema>;

/**
 * Facet-name enum. Mirrors the projection-layer `FacetName` union at
 * `apps/server/src/projection/types.ts` (the canonical TS type) — the
 * two must stay in lockstep.
 *
 * Introduced for `withdraw-agreement` (per ADR 0030 §3) and reused by
 * the downstream per-facet-keying tasks
 * (`pf_facet_keyed_vote_payload`, `pf_facet_keyed_commit_payload`,
 * `pf_facet_keyed_meta_disagreement_payload`).
 *
 * The shape-facet expansion implied by ADR 0030 §5 is owned by the
 * downstream projection-refactor tasks; this enum is 3-valued at
 * landing and widens later in lockstep with the projection-layer
 * `FacetName`.
 */
export const facetNameSchema = z.enum(['classification', 'substance', 'wording']);

export type FacetName = z.infer<typeof facetNameSchema>;
