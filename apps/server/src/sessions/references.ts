// The canonical "can this caller REFERENCE this entity into ANY session?"
// rule — one predicate per entity kind (node / edge / annotation),
// composed on top of the shared visibility predicate.
//
// Refinement: tasks/refinements/backend/reference_permission_check.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.reference_permission_check
//
// **The rule** (lifted from docs/architecture.md, "Cross-session reference
// permissions"):
//
//   An entity (node, edge, or annotation) is "referenceable from a new
//   session by caller C" iff:
//     - The entity exists.
//     - The entity has at least one row in the corresponding
//       `session_<kind>s` join table (it was included in some "origin"
//       session).
//     - At least ONE of those origin sessions is visible to C per the
//       visibility rule (`visibilityWhereFragment` from ./visibility.ts).
//
// The "ANY visible origin" semantics matter because globally-stored
// entities can live in multiple sessions: if entity E is in session A
// (private, invisible to C) AND in session A' (public), then C is
// allowed to reference E — they could trivially reach it via A'. Locking
// C out because the FIRST session they happen to query is private would
// be a false negative.
//
// **Scope.** This module answers ONLY "is entity E reachable to C at
// all?" — the source-side reachability check. The destination-side
// authority check ("is C a participant of session B, the write target?")
// is the sibling task `entity_inclusion_endpoint`'s responsibility, not
// this module's. The split keeps the predicate reusable by future
// WS-include message handlers whose destination-side authority shape
// differs.
//
// **Per-kind, not polymorphic.** Three small symmetric functions —
// `canReferenceNode`, `canReferenceEdge`, `canReferenceAnnotation` —
// rather than one `canReference(executor, kind, id, userId)`. The
// per-kind type signatures are more honest at each callsite, and the
// inclusion endpoint that will consume this dispatches on entity kind
// anyway; aligning the API with that branching keeps the calling code
// straight-line. See the refinement's "Decisions" section.
//
// **SQL shape (per kind).** One round-trip per call:
//
//   SELECT 1
//     FROM session_<kind>s sj
//     JOIN sessions ON sj.session_id = sessions.id
//    WHERE sj.<entity>_id = $1
//      AND <visibilityWhereFragment(2)>
//    LIMIT 1
//
// The `LIMIT 1` short-circuits — Postgres stops after the first matching
// origin session. The reverse-index on `sj.<entity>_id` (added in each
// join-table migration per R9) makes the row scan cheap.
//
// The join to `sessions` is necessary because `visibilityWhereFragment`
// references `sessions.privacy`, `sessions.host_user_id`, and (via the
// EXISTS subquery) `sessions.id`. The fragment correlates against the
// UNALIASED `sessions` table name — which is fine because we use
// `JOIN sessions ON sj.session_id = sessions.id` (no alias).
//
// **No RLS.** Application-layer enforcement per the project's ADR set.
// Every callsite that asks "may C reference E?" either uses this module
// or is buggy; the Vitest + Cucumber test layers pin the rule's
// semantics so a future drift surfaces as a failing test, not as silent
// over- or under-permissive reference behavior.

import { visibilityWhereFragment } from './visibility.js';
import type { VisibilityExecutor } from './visibility.js';

/**
 * Build the per-kind SELECT for the reference-permission predicate.
 *
 * Encapsulates the (join-table name, entity-id column name) pair so the
 * three exported predicates differ only in those two strings. The
 * resulting SQL passes through `visibilityWhereFragment(2)` for the
 * caller-id slot; `$1` is the entity id.
 *
 * Both `joinTable` and `entityIdColumn` are hard-coded literals at every
 * callsite (the kind-dispatch happens at the function-export level, not
 * at runtime), so no user input ever reaches these positions. The SQL
 * remains fully parameterized.
 */
function buildReferenceSelect(joinTable: string, entityIdColumn: string): string {
  // visibilityWhereFragment(2) emits a fragment that reads $2 twice (the
  // host-id slot and the EXISTS-participant slot). Our two params are
  // [entityId, callerUserId]; $1 binds to the entity id, $2 binds to the
  // caller's user id — exactly what the fragment expects.
  const visibility = visibilityWhereFragment(2);
  return `SELECT 1 AS reachable
            FROM ${joinTable} sj
            JOIN sessions ON sj.session_id = sessions.id
           WHERE sj.${entityIdColumn} = $1
             AND ${visibility}
           LIMIT 1`;
}

/**
 * Generic "does any matching row exist?" executor — runs the parameterized
 * SELECT and returns true iff at least one row comes back. Shared between
 * the three per-kind predicates.
 */
async function anyReachable(
  executor: VisibilityExecutor,
  sql: string,
  entityId: string,
  userId: string,
): Promise<boolean> {
  const result = await executor.query<{ reachable: number }>(sql, [entityId, userId]);
  return result.rows.length > 0;
}

/**
 * Boolean predicate — may this caller reference this NODE into a new
 * session?
 *
 * True iff the node has at least one row in `session_nodes` whose
 * origin session is visible to the caller per the visibility rule
 * (public, or caller is host, or caller is/was a participant).
 *
 * Does NOT distinguish "node doesn't exist" from "node exists but isn't
 * in any visible session" — both return false. Same existence-non-leak
 * property as `canSeeSession`.
 *
 * @param executor - a query-runner (the request's pool, or a transaction
 *   client inside `withTransaction`).
 * @param nodeId - the global node id (UUID).
 * @param userId - the caller's user id (UUID).
 * @returns `true` iff the node is reachable from the caller's
 *   perspective via at least one visible origin session.
 */
export async function canReferenceNode(
  executor: VisibilityExecutor,
  nodeId: string,
  userId: string,
): Promise<boolean> {
  return anyReachable(executor, buildReferenceSelect('session_nodes', 'node_id'), nodeId, userId);
}

/**
 * Boolean predicate — may this caller reference this EDGE into a new
 * session?
 *
 * Parallel to `canReferenceNode` against the `session_edges` join table.
 * Same any-visible-origin semantics; same existence-non-leak collapse.
 *
 * @param executor - a query-runner (pool or transaction client).
 * @param edgeId - the global edge id (UUID).
 * @param userId - the caller's user id (UUID).
 * @returns `true` iff the edge is reachable from the caller via at
 *   least one visible origin session.
 */
export async function canReferenceEdge(
  executor: VisibilityExecutor,
  edgeId: string,
  userId: string,
): Promise<boolean> {
  return anyReachable(executor, buildReferenceSelect('session_edges', 'edge_id'), edgeId, userId);
}

/**
 * Boolean predicate — may this caller reference this ANNOTATION into a
 * new session?
 *
 * Parallel to `canReferenceNode` against the `session_annotations` join
 * table. Same any-visible-origin semantics; same existence-non-leak
 * collapse.
 *
 * **Note on cascade.** This predicate does NOT check whether the caller
 * can also reference the annotation's target (the node or edge it
 * annotates). An entity-level cascade ("you can reference annotation A
 * only if you can also reference its target") is plausible but not
 * specified by the architecture; deferred unless/until the architecture
 * grows that rule. See the refinement's open-questions section.
 *
 * @param executor - a query-runner (pool or transaction client).
 * @param annotationId - the global annotation id (UUID).
 * @param userId - the caller's user id (UUID).
 * @returns `true` iff the annotation is reachable from the caller via
 *   at least one visible origin session.
 */
export async function canReferenceAnnotation(
  executor: VisibilityExecutor,
  annotationId: string,
  userId: string,
): Promise<boolean> {
  return anyReachable(
    executor,
    buildReferenceSelect('session_annotations', 'annotation_id'),
    annotationId,
    userId,
  );
}
