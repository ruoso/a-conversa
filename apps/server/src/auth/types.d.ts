// TypeScript module augmentation for the auth middleware's request /
// instance decorators.
//
// Refinement: tasks/refinements/backend/auth_middleware.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.auth_middleware
//
// **Why this file exists.** The `authenticatePlugin` (see `middleware.ts`)
// decorates the Fastify instance with `app.authenticate(request, reply)`
// and the request with `request.authUser`. Fastify's runtime decoration
// is untyped — TypeScript would not know about the new properties
// without an explicit augmentation. Module augmentation is the
// canonical pattern: a `declare module 'fastify'` block adds the
// properties to Fastify's own type surface so every consumer in the
// codebase sees `request.authUser` and `app.authenticate` with the
// correct types, without per-call casts.
//
// **Why a separate `.d.ts` and not inline in `middleware.ts`.** Pure
// type augmentations conventionally live in `.d.ts` files so:
//   1. Grep for the augmentation surface is trivial (`grep -r
//      "declare module 'fastify'"`).
//   2. The runtime file (`middleware.ts`) stays focused on the
//      runtime behavior; types live next door.
//   3. TypeScript's project-wide include picks up the augmentation
//      automatically — no per-consumer import needed.
//
// The augmentation has NO runtime effect. The decoration happens at
// runtime inside `authenticatePlugin`; this file only tells the type
// checker what shape to expect.

import 'fastify';

/**
 * The authenticated user shape attached to `request.authUser` after the
 * `authenticate` middleware runs.
 *
 * `id` is the `users.id` UUID — the same value the JWT carries as `sub`.
 * `screenName` is the most recent value persisted on the users row;
 * the middleware reads it per request so a recent rename (eventually —
 * the rename surface is out of scope today) is reflected without
 * waiting for token expiry.
 *
 * Defined here (not in `middleware.ts`) so both the runtime module and
 * the module augmentation reference the same shape via a single
 * import path. Re-exported from `middleware.ts` as the canonical
 * runtime type; consumers should import `AuthUser` from
 * `../auth/index.js`.
 */
export interface AuthUser {
  /** Users-table row id (UUID string). */
  readonly id: string;
  /** Current screen name on the users row. */
  readonly screenName: string;
}

/**
 * The decorator function signature `app.authenticate` exposes. Returns
 * `Promise<void>` because the function is consumed as a `preHandler`:
 * it either resolves (on success, having mutated `request.authUser`)
 * or throws `ApiError(401, 'auth-required', ...)` (on any failure
 * mode). The centralized error-handler plugin renders the canonical
 * envelope; the middleware does NOT call `reply.send()` inline.
 */
export type AuthDecorator = (
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The authenticated user, populated by the `authenticate` preHandler.
     *
     * Optional at the type level because:
     *   - Public routes never run the middleware and never set this.
     *   - Protected routes set it BEFORE the handler runs.
     *
     * Inside a protected route handler, the value is guaranteed to be
     * defined (the middleware either populated it or threw and the
     * handler never ran). Handlers may safely access `req.authUser.id`
     * without a defensive check; the optional type is for static
     * analysis correctness at the cross-cutting layer.
     */
    authUser?: AuthUser;
  }

  interface FastifyInstance {
    /**
     * The auth-middleware decorator. Routes opt into protection by
     * attaching this as their `preHandler`. On success, `request.authUser`
     * is populated and the handler runs; on failure, the middleware
     * throws `ApiError(401, 'auth-required', ...)` and the error
     * handler renders the canonical envelope.
     */
    authenticate: AuthDecorator;

    /**
     * The OPTIONAL-auth decorator — sibling to `authenticate`. Routes
     * that serve two auth postures on one transport (per ADR 0045/0029)
     * attach this as their `preHandler`. It resolves the session cookie
     * via the same `authenticateRequest` primitive: on a *valid* cookie
     * it sets `request.authUser`; on a missing OR present-but-invalid
     * cookie (expired / forged / revoked / soft-deleted user) it leaves
     * `request.authUser` unset and **never throws 401**. The handler
     * then branches on `request.authUser === undefined` to run the
     * anonymous (data-layer gated) path. This is the HTTP analogue of
     * the WS upgrade gate's optional posture.
     */
    optionalAuthenticate: AuthDecorator;
  }
}
