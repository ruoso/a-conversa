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
//      `{ error: { code: 'internal-error', message: 'internal error'
//      } }`. The stack is never serialized into the body.
//
// M3-review `inputs.md` F-008 — wire-message no-leak on 5xx:
//
//   Every response that emits at HTTP status >= 500 has its wire
//   `body.error.message` replaced with the generic literal
//   `HTTP_INTERNAL_ERROR_MESSAGE = 'internal error'` and any structured
//   `details` dropped from the body. The typed `body.error.code` is
//   PRESERVED — it is the only typed discriminator clients branch on
//   (e.g. `temporarily-unavailable` from the flow-state capacity guard
//   in `apps/server/src/auth/routes.ts`). The full `code`, original
//   `message`, and `details` still reach the server log via
//   `request.log.error({ err }, ...)`, so operators retain full
//   visibility. 4xx responses are unaffected: typed 4xx messages
//   (`'topic is required'`, `'missing field'`) are client-actionable
//   and stay on the wire.
//
//   Refinement:
//   tasks/refinements/backend-hardening/defensive_500_message_sanitize.md.
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
 * Generic wire-`message` literal emitted on every 5xx response.
 *
 * Exported so tests and any future caller share a single source — a
 * future contributor relaxing the literal cannot drift it independent
 * of the assertions in `error-handler.test.ts`. Closes the
 * `inputs.md` F-008 wire-leak surface.
 *
 * Lowercase / unpunctuated by design — mirrors
 * `WS_INTERNAL_ERROR_MESSAGE` in `ws/error-envelope.ts` so the HTTP
 * and WS surfaces emit the same generic literal on the no-leak path.
 */
export const HTTP_INTERNAL_ERROR_MESSAGE = 'internal error';

/**
 * Canonical 5xx envelope code emitted when no typed `ApiError` code is
 * available (raw `Error` thrown, non-Error throw, etc.). Typed
 * `ApiError.code` values (`'internal-error'`,
 * `'temporarily-unavailable'`, etc.) are preserved on the wire on 5xx
 * — only the `message` and `details` are scrubbed. See `inputs.md`
 * F-008 and the refinement at
 * `tasks/refinements/backend-hardening/defensive_500_message_sanitize.md`.
 */
export const HTTP_INTERNAL_ERROR_CODE = 'internal-error';

/**
 * Strip leaky fields from a 5xx envelope shortly before serialization
 * — replace `message` with the generic literal; drop every `details`
 * key that may have been spread under `error` by `buildEnvelope(...)`.
 *
 * The typed `code` is preserved verbatim: it is the only typed
 * discriminator clients branch on for 5xx responses (e.g.
 * `'temporarily-unavailable'` from the flow-state capacity guard).
 * Scrubbing the code would break those branches without reducing the
 * leak surface — the leak vector is `message` / `details`, not `code`.
 *
 * Called from `sendEnvelope(...)` so every code path that reaches the
 * Fastify reply goes through one chokepoint; the handler cannot
 * accidentally bypass the scrub in any branch.
 */
function scrubFiveHundredEnvelope(statusCode: number, envelope: ErrorEnvelope): ErrorEnvelope {
  if (statusCode < 500) return envelope;
  return {
    error: {
      code: envelope.error.code,
      message: HTTP_INTERNAL_ERROR_MESSAGE,
    },
  };
}

/**
 * Send the canonical envelope at the given HTTP status. Centralized
 * so the handler can't accidentally drift into Fastify's default
 * serialization in any branch.
 *
 * 5xx responses are passed through `scrubFiveHundredEnvelope(...)`
 * before serialization — the wire `message` and `details` are
 * replaced with the generic literal; the typed `code` is preserved.
 */
function sendEnvelope(reply: FastifyReply, statusCode: number, envelope: ErrorEnvelope): void {
  const safeEnvelope = scrubFiveHundredEnvelope(statusCode, envelope);
  reply.status(statusCode).type('application/json').send(safeEnvelope);
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
    // M3-review inputs.md F-008 — when an `ApiError` carries a 5xx
    // status, its original `message` and `details` may carry
    // operationally-sensitive text (DB driver fragments, the literal
    // sentinel a defensive `throw new ApiError(500, 'internal-error',
    // 'session insert returned no row')` site emits). The wire is
    // scrubbed by `sendEnvelope(...)`; we log the full error here so
    // operators retain visibility on the server-side path.
    if (err.statusCode >= 500) {
      request.log.error({ err }, 'unhandled 5xx ApiError in route handler');
    }
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
  //    5xx status-carrying errors land on the no-leak path the same
  //    way ApiError 5xx do — `sendEnvelope(...)` scrubs the wire
  //    message; we log here so operators see the original.
  if (isStatusCarryingError(err)) {
    if (err.statusCode >= 500) {
      request.log.error({ err }, 'unhandled 5xx status-carrying error in route handler');
    }
    sendEnvelope(reply, err.statusCode, buildEnvelope(deriveCode(err), err.message));
    return;
  }

  // 5. Anything else — a raw Error, a non-Error throw, etc. Log with
  //    the full Error (so the stack lands in the server log) and
  //    respond with the generic 500 envelope. NEVER include the
  //    stack, message, or cause in the body — we do not know what's
  //    safe to render and conservative redaction is the right
  //    default. (The pre-scrubbed envelope passed here uses the
  //    canonical `HTTP_INTERNAL_ERROR_*` constants; `sendEnvelope(...)`
  //    then routes through `scrubFiveHundredEnvelope(...)` for
  //    uniformity — the inputs already match, so the result is the
  //    same envelope.)
  request.log.error({ err }, 'unhandled error in route handler');
  sendEnvelope(reply, 500, buildEnvelope(HTTP_INTERNAL_ERROR_CODE, HTTP_INTERNAL_ERROR_MESSAGE));
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
