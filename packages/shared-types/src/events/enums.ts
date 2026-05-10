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
