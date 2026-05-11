// Fastify error-handler plugin — wires `setErrorHandler` and
// `setNotFoundHandler` on the root scope and serializes every error
// response under the canonical envelope.
//
// Refinement: tasks/refinements/backend/error_handling.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.error_handling
//
// The plugin is wrapped with `fastify-plugin` so the handlers attach
// to the root instance, not to the plugin's encapsulation child. A
// plain `FastifyPluginAsync` registered via `app.register(...)` would
// install the handlers only for the plugin's subtree — routes
// attached to the root (and siblings registered later) would not see
// them. The `skip-override` marker that `fp` injects breaks the
// encapsulation barrier.
//
// Dispatch order inside the single `setErrorHandler` callback:
//
//   1. `ApiError`          → typed status + canonical envelope.
//   2. `EventValidationError` (server-side wrapper) → 422 + envelope
//      with the wrapper's `code` / `kind` / `issues`.
//   3. Fastify validation error (`err.validation` array, populated by
//      `fastify-type-provider-zod` / TypeBox / ajv) → 400 + envelope
//      with `code: 'validation-failed'`.
//   4. `@fastify/sensible` / any error carrying `err.statusCode` →
//      pass-through with the canonical envelope.
//   5. Anything else → log with stack at error level; 500 +
//      `{ error: { code: 'internal-error', message: 'Internal server
//      error' } }`. The stack is never serialized into the body.
//
// `setNotFoundHandler` mirrors the envelope so the frontend's error
// renderer doesn't have to branch on transport-level 404 vs.
// application-level 404 — both look like
// `{ error: { code: 'not-found', message: '...' } }`.

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { ApiError } from './errors.js';
import { EventValidationError } from './events/validate.js';

/**
 * Canonical body envelope. The handler always emits this shape, no
 * matter the error class — clients can write a single parser.
 *
 * `code` is the only typed discriminator; `statusCode` lives on the
 * HTTP layer (the response status), never in the body, so we don't
 * duplicate state across two surfaces.
 */
interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

/**
 * Plain-data shape Fastify decorates onto validation errors when a
 * schema-typed route rejects an input. The presence of
 * `err.validation` (array) is the discriminator — Fastify only sets
 * it on schema failures, so checking for it is a safe positive test.
 */
interface FastifyValidationError extends Error {
  validation: unknown[];
  validationContext?: string;
}

/**
 * Errors that already carry an HTTP-status hint. `@fastify/sensible`'s
 * `httpErrors.*` constructors land here; so do third-party libraries
 * that throw status-aware errors. We honor the status they specify.
 *
 * `code` is optional — if absent we derive a kebab code from the
 * status class.
 */
interface StatusCarryingError extends Error {
  statusCode: number;
  code?: string;
}

/** Type-guard for the Fastify validation-error shape. */
function isFastifyValidationError(err: unknown): err is FastifyValidationError {
  return err instanceof Error && Array.isArray((err as { validation?: unknown }).validation);
}

/** Type-guard for any error carrying a numeric `statusCode`. */
function isStatusCarryingError(err: unknown): err is StatusCarryingError {
  return err instanceof Error && typeof (err as { statusCode?: unknown }).statusCode === 'number';
}

/**
 * Kebab-case a CamelCase identifier like `"NotFoundError"` →
 * `"not-found"`. Used to derive a stable envelope `code` from the
 * `name` property of `@fastify/sensible` / `http-errors` instances
 * (which set `name = '<StatusPhrase>Error'`, e.g. `"NotFoundError"`,
 * `"UnprocessableEntityError"`, `"ConflictError"`).
 *
 * The trailing `"Error"` suffix is stripped so the resulting code is
 * the status phrase only (`"not-found"` not `"not-found-error"`),
 * matching the codes our own `ApiError` factories emit for the same
 * statuses.
 */
function kebabFromErrorName(name: string): string {
  const trimmed = name.replace(/Error$/u, '');
  // Insert a hyphen between consecutive uppercase letters when the
  // next char is lowercase (e.g. `URITooLong` → `URI-Too-Long`), then
  // between a lowercase/digit and an uppercase letter. Finally
  // lowercase the whole thing.
  return trimmed
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1-$2')
    .replace(/([a-z\d])([A-Z])/gu, '$1-$2')
    .toLowerCase();
}

/**
 * Derive a kebab `code` for a status-carrying error that doesn't
 * carry one explicitly. We look at three places, in order:
 *
 *   1. The error's own `code` field (some libraries set this — pg
 *      errors carry SQLSTATE codes there; we trust it as a signal of
 *      explicit intent).
 *   2. The error's `name` property, kebab-cased and de-suffixed.
 *      `@fastify/sensible`'s HTTP errors set this to e.g.
 *      `'NotFoundError'`, which becomes `'not-found'`.
 *   3. A status-class fallback (`'http-error-NNN'`) — only reachable
 *      if both `code` and `name` are useless.
 */
function deriveCode(err: StatusCarryingError): string {
  const directCode = err.code;
  if (typeof directCode === 'string' && directCode.length > 0) {
    return directCode;
  }
  if (typeof err.name === 'string' && err.name.length > 0 && err.name !== 'Error') {
    const derived = kebabFromErrorName(err.name);
    if (derived.length > 0) return derived;
  }
  return `http-error-${String(err.statusCode)}`;
}

/**
 * Build the canonical envelope, spreading any `details` (or other
 * structured fields) under the `error` key alongside `code` and
 * `message`. The spread happens after `code` / `message` so a
 * malicious `details` object can't override them.
 */
function buildEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  if (details === undefined) {
    return { error: { code, message } };
  }
  return { error: { ...details, code, message } };
}

/**
 * Send the canonical envelope at the given HTTP status. Centralized
 * so the handler can't accidentally drift into Fastify's default
 * serialization in any branch.
 */
function sendEnvelope(reply: FastifyReply, statusCode: number, envelope: ErrorEnvelope): void {
  reply.status(statusCode).type('application/json').send(envelope);
}

/**
 * The single error-handler callback. Classifies the thrown value and
 * serializes the canonical envelope. Never leaks stack traces or
 * `err.cause` to the client — the server log gets the full Error
 * (via the Fastify request logger); the client gets a sanitized body.
 */
function handleError(err: unknown, request: FastifyRequest, reply: FastifyReply): void {
  // 1. ApiError — the typed route-thrown control-flow error.
  if (err instanceof ApiError) {
    sendEnvelope(reply, err.statusCode, buildEnvelope(err.code, err.message, err.details));
    return;
  }

  // 2. EventValidationError — schema-on-write failure from the
  //    server-side validator. The wrapper's `code` discriminates
  //    among envelope-invalid / unknown-kind / payload-invalid; we
  //    surface that plus `kind` and `issues` directly.
  if (err instanceof EventValidationError) {
    sendEnvelope(
      reply,
      422,
      buildEnvelope(err.code, err.message, {
        kind: err.kind,
        issues: err.issues,
      }),
    );
    return;
  }

  // 3. Fastify schema validation error (e.g. fastify-type-provider-zod).
  //    Discriminated by the `validation` array Fastify sets.
  if (isFastifyValidationError(err)) {
    sendEnvelope(
      reply,
      400,
      buildEnvelope('validation-failed', 'Request validation failed', {
        issues: err.validation,
      }),
    );
    return;
  }

  // 4. Status-carrying errors (@fastify/sensible's httpErrors.*, and
  //    anything else that carries a numeric statusCode). Pass the
  //    status through; derive a kebab `code` from the carrier.
  if (isStatusCarryingError(err)) {
    sendEnvelope(reply, err.statusCode, buildEnvelope(deriveCode(err), err.message));
    return;
  }

  // 5. Anything else — a raw Error, a non-Error throw, etc. Log with
  //    the full Error (so the stack lands in the server log) and
  //    respond with the generic 500 envelope. NEVER include the
  //    stack, message, or cause in the body — we do not know what's
  //    safe to render and conservative redaction is the right
  //    default.
  request.log.error({ err }, 'unhandled error in route handler');
  sendEnvelope(reply, 500, buildEnvelope('internal-error', 'Internal server error'));
}

/**
 * The not-found callback. Renders the same envelope shape as the
 * regular error path — the frontend's parser doesn't branch on
 * "transport 404" vs. "application 404".
 *
 * The function is intentionally sync (no `async`) — there's nothing
 * to await; `setNotFoundHandler` accepts a sync function fine.
 */
function handleNotFound(_request: FastifyRequest, reply: FastifyReply): void {
  sendEnvelope(reply, 404, buildEnvelope('not-found', 'Route not found'));
}

/**
 * The plugin body. Wrapped by `fastify-plugin` below so the handlers
 * attach to the root scope.
 */
const errorHandlerPluginAsync: FastifyPluginAsync = (app: FastifyInstance, _opts) => {
  app.setErrorHandler(handleError);
  app.setNotFoundHandler(handleNotFound);
  return Promise.resolve();
};

/**
 * The wrapped plugin. `fastify-plugin` adds the `skip-override`
 * marker that makes `app.register(errorHandlerPlugin)` install the
 * handlers on the parent scope rather than the plugin's
 * encapsulation child — exactly the behavior the server's bootstrap
 * needs.
 *
 * Named via the plugin metadata so `app.printPlugins()` shows it
 * under a stable label.
 */
export const errorHandlerPlugin = fp(errorHandlerPluginAsync, {
  name: 'a-conversa-error-handler',
  fastify: '5.x',
});
