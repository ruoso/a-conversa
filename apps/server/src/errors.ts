// Typed `ApiError` + factory helpers + `rejectedToApiError` adapter.
//
// Refinement: tasks/refinements/backend/error_handling.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.error_handling
//
// Route handlers throw `ApiError` (constructed via the factory
// helpers); the `error-handler.ts` Fastify plugin classifies it and
// serializes the canonical envelope `{ error: { code, message,
// ...details } }`. Status code lives on the HTTP layer, never in the
// body.
//
// `rejectedToApiError` adapts the methodology engine's typed
// `RejectionReason` union to the right factory. The mapping is a
// `switch` over the union with a `never`-assertion default — adding a
// new `RejectionReason` to the engine's vocabulary breaks compilation
// here until the mapping is extended. That is the desired behavior:
// the HTTP-status assignment is a deliberate decision, not a
// silently-handled default.

import type { RejectedValidationResult, RejectionReason } from './methodology/types.js';

/**
 * Plain-data details that ride alongside the canonical error envelope.
 * Spread under the `error` key by the handler so a client can read
 * structured context (e.g. `issues`, `kind`) without reaching for a
 * carrier shape. Values are constrained to JSON-serializable types so
 * the envelope round-trips cleanly.
 *
 * Keep this open-ended on the value side (`unknown`) so callers can
 * pass through whatever the upstream type system already validates —
 * Zod issue arrays, EventValidationError's `issues`, methodology
 * detail strings. The handler does not introspect the values.
 */
export type ApiErrorDetails = Readonly<Record<string, unknown>>;

/**
 * The canonical typed error every route should throw. Carries the
 * HTTP status code (only consumed by the handler at serialization
 * time), the kebab-case `code` (rendered into the body), the human-
 * readable `message` (ditto), and optional structured `details`
 * spread into the body.
 *
 * Construction is via the factory helpers below rather than the
 * constructor directly so the kebab-case codes for each status class
 * stay in one place; the constructor is exposed for the rare case
 * where a sibling task needs a non-canonical (code, status) pairing
 * (e.g. `auth_middleware` may use `code: 'token-expired'` on a 401).
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  /** HTTP status code the handler renders. Always 4xx or 5xx. */
  readonly statusCode: number;

  /**
   * Kebab-case code rendered as `body.error.code`. The body's only
   * typed discriminator — clients branch on this, not on status.
   */
  readonly code: string;

  /** Optional structured context spread under `body.error.<key>`. */
  readonly details: ApiErrorDetails | undefined;

  constructor(statusCode: number, code: string, message: string, details?: ApiErrorDetails) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  /**
   * 400 Bad Request — the request itself is malformed at the
   * transport / shape level (missing required field, wrong content
   * type, etc.). For "the input is well-formed but the system state
   * rejects it" use `unprocessable` (422) instead.
   */
  static badRequest(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(400, 'bad-request', message, details);
  }

  /**
   * 401 Unauthorized — the caller is not authenticated. Owned in
   * practice by `backend.auth.auth_middleware`; included here so the
   * surface is complete and so sibling tasks don't reach for raw
   * `Error` when they need a 401.
   */
  static unauthorized(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(401, 'unauthorized', message, details);
  }

  /**
   * 403 Forbidden — authenticated, but lacks the role / relationship
   * the action requires. The methodology engine's role-gated and
   * participation-gated rejections route here via `rejectedToApiError`.
   */
  static forbidden(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(403, 'forbidden', message, details);
  }

  /**
   * 404 Not Found — the referenced entity does not exist (or is not
   * visible to the caller; we use the same status for both to avoid
   * leaking existence to unauthorized callers).
   */
  static notFound(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(404, 'not-found', message, details);
  }

  /**
   * 409 Conflict — the request conflicts with the current state
   * (sequence mismatch, double-vote, etc.). Canonical optimistic-
   * concurrency status.
   */
  static conflict(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }

  /**
   * 422 Unprocessable Entity — the request is well-formed and
   * semantically understandable, but cannot be processed in the
   * current methodology state. Distinguishes "your input is
   * malformed" (400) from "your input is fine but the state forbids
   * this operation right now."
   */
  static unprocessable(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(422, 'unprocessable-entity', message, details);
  }

  /**
   * 500 Internal Server Error — the catch-all for programmer error
   * or external failure. The handler also reaches a 500 path for any
   * non-`ApiError` throw, but routes that have detected a recoverable
   * server-side problem and want a typed 500 can throw this directly.
   */
  static internal(message: string, details?: ApiErrorDetails): ApiError {
    return new ApiError(500, 'internal-error', message, details);
  }
}

/**
 * Map a methodology-engine `RejectedValidationResult` to the
 * corresponding `ApiError`. The envelope's `error.code` is the kebab
 * `reason` string verbatim (so the client can branch on the typed
 * methodology vocabulary directly); `error.message` is the
 * rejection's `detail`.
 *
 * The mapping is a `switch (reason)` over the full `RejectionReason`
 * union with a `never`-assertion default — adding a new reason to the
 * union breaks compilation here until the mapping is extended, which
 * is the desired behavior. HTTP-status assignment is a deliberate
 * decision per reason, not a silently-handled default.
 *
 * @param rejection - the engine's typed rejection.
 * @returns the corresponding `ApiError` with the kebab `reason` as the
 *          envelope `code` and the rejection's `detail` as the message.
 */
export function rejectedToApiError(rejection: RejectedValidationResult): ApiError {
  const { reason, detail } = rejection;
  const statusCode = statusCodeForRejection(reason);
  return new ApiError(statusCode, reason, detail);
}

/**
 * The exhaustive `reason → status` switch. Kept as its own function
 * (rather than inlined in `rejectedToApiError`) so it can be unit-
 * tested in isolation and so the exhaustiveness check is the single
 * obvious responsibility of one function.
 *
 * See `tasks/refinements/backend/error_handling.md` "RejectionReason
 * → HTTP-status mapping" for the rationale behind each assignment.
 */
function statusCodeForRejection(reason: RejectionReason): number {
  switch (reason) {
    // 400 — request payload is malformed at the application semantics
    // level (well-formed JSON, but a field's content fails a
    // validator). `invalid-label` (added by snapshot_create_logic):
    // the moderator-supplied snapshot label is empty after trim or
    // exceeds the length cap; the failure is at the input layer and
    // the client should re-prompt rather than retry. See
    // `tasks/refinements/data-and-methodology/snapshot_create_logic.md`.
    case 'invalid-label':
      return 400;
    // 403 — authenticated but the role / relationship is wrong.
    // `cannot-remove-moderator` (added by participant_assignment): the
    // host/moderator is bound to the session for its lifetime and cannot
    // be removed via the participant-DELETE endpoint.
    // `entity-not-referenceable` (added by entity_inclusion_endpoint): the
    // caller cannot reach the source entity through any visible origin
    // session. Authority failure, parallel to `not-a-participant` —
    // 403 (not 404) so the response is honest about the semantics
    // (the entity may exist; the caller just isn't allowed to
    // reference it). See `tasks/refinements/backend/entity_inclusion_endpoint.md`.
    case 'not-a-moderator':
    case 'moderator-only':
    case 'not-a-participant':
    case 'self-vote-not-allowed':
    case 'axiom-mark-not-self':
    case 'cannot-remove-moderator':
    case 'entity-not-referenceable':
      return 403;
    // 404 — referenced entity not found (or not visible to the caller).
    // `user-not-found` (added by participant_assignment): the body's
    // `userId` doesn't resolve to a non-deleted users row. 404 (not 400)
    // because the UUID itself was well-formed; the failure is at the
    // entity layer.
    case 'target-entity-not-found':
    case 'proposal-not-found':
    case 'user-not-found':
      return 404;
    // 409 — request conflicts with current state (optimistic concurrency).
    // `role-already-filled` / `user-already-joined` (added by
    // participant_assignment): partial-unique-index conflicts on
    // session_participants surfaced as typed 409s for client branching.
    // `entity-already-included` (added by entity_inclusion_endpoint): the
    // entity is already a member of the destination session — caught
    // by the composite-PK `ON CONFLICT DO NOTHING` collapse on the
    // join-table INSERT. 409 (not a silent 200) matches the "no
    // silent no-ops" pattern the other session-management endpoints
    // follow. See `tasks/refinements/backend/entity_inclusion_endpoint.md`.
    case 'sequence-mismatch':
    case 'session-mismatch':
    case 'already-voted':
    case 'no-prior-agree':
    case 'role-already-filled':
    case 'user-already-joined':
    case 'entity-already-included':
      return 409;
    // 422 — well-formed but methodology state forbids this transition.
    // `facet-sequence-out-of-order` (per
    // `pf_sequence_gate_server_enforced` + ADR 0030 §8): the proposal
    // is structurally valid but the predecessor facet isn't in
    // `agreed`/`committed` — the methodology state forbids the
    // facet-valued proposal advancing yet. Same 422 as the other
    // methodology-not-yet rejections — it is NOT a structural malformation
    // (which would be 400) nor a missing entity (404).
    case 'proposal-not-pending':
    case 'proposal-already-committed':
    case 'proposal-already-meta-disagreement':
    case 'unanimous-agree-required':
    case 'inapplicable-to-facet':
    case 'illegal-state-transition':
    case 'methodology-not-exhausted':
    case 'facet-sequence-out-of-order':
      return 422;
    default: {
      // Exhaustiveness check — adding a new RejectionReason breaks
      // compilation here until the mapping above is extended.
      const _exhaustive: never = reason;
      // Defensive runtime fallback (unreachable under type-checking).
      // 500 is the right "this is the server's fault" status if a
      // future runtime drifts past the type system.
      throw new Error(`unmapped RejectionReason: ${String(_exhaustive)}`);
    }
  }
}
