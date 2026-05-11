# Centralized error handling and JSON serialization

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.error_handling`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — `createServer()` factory + `index.ts` entry point landed 2026-05-10), `backend.api_skeleton.health_endpoint` (settled — liveness route + startup migration gate landed 2026-05-10).

## What this task is

Wire a single, consistent error-handling layer for the Fastify server. Two halves land together because they share the same response envelope:

1. **A typed `ApiError`** under `apps/server/src/errors.ts` with factory helpers (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `internal`) and a `rejectedToApiError(rejection)` adapter that maps each `RejectionReason` from the methodology engine to the right factory. Routes throw `ApiError`; sibling tasks (`auth_middleware`, `create_session_endpoint`, the WS message handlers) compose against this surface.

2. **A Fastify error-handler plugin** under `apps/server/src/error-handler.ts` that calls `app.setErrorHandler(...)` and `app.setNotFoundHandler(...)` on the root scope (via `fastify-plugin` so the handlers are not encapsulated to the registration scope). The handler classifies the thrown value (`ApiError`, `EventValidationError` from `apps/server/src/events/validate.ts`, Fastify validation errors, `@fastify/sensible` `httpErrors.*`, anything else) and serializes a single canonical envelope.

The companion `routes/healthz.ts` plugin pattern from `health_endpoint` is the template — encapsulate the wiring in a plugin file, register it from `server.ts`, keep the route/handler context in one place.

## Why it needs to be done

- **The siblings about to land — `request_logging`, `openapi_or_equivalent`, and the entire `auth` / `session_management` / `websocket_protocol` tree — pre-assume a consistent error surface.** Without this, each endpoint invents its own JSON error shape. The frontend can't write a single client-side error parser; the OpenAPI / equivalent doc can't pin a single error component schema; the WS protocol's `ws_error_message` can't share the envelope shape with HTTP.
- **The methodology engine already emits a typed `RejectionReason`.** The eight `methodology_engine.*` sibling tasks return `{ ok: false, reason, detail }` from `validateAction`; the API layer is the natural place to translate the typed reason into an HTTP status + JSON envelope. Doing the mapping here (once) rather than per endpoint (seventeen times) is the difference between this being maintainable and it not being.
- **The default Fastify behavior leaks internals.** Unhandled errors today serialize as `{ statusCode, error, message }` (Fastify's built-in shape), which mixes status codes into the body and doesn't carry our typed `code`. A plain `throw new Error('oops')` from a route currently serializes the message verbatim; we want a generic `'internal-error'` envelope with the stack confined to the server log.

Downstream consumers:

- `backend.api_skeleton.request_logging` — the logger will see the `ApiError` instances before the error handler serializes them; the two siblings coordinate on which fields the logger should redact.
- `backend.api_skeleton.openapi_or_equivalent` — the OpenAPI spec gets a single shared error component (`{ error: { code, message, ...detail } }`) sourced from this task.
- `backend.auth.auth_middleware` — throws `ApiError.unauthorized(...)` / `ApiError.forbidden(...)`; the handler serializes.
- `backend.session_management.*` — throws `ApiError.notFound(...)` / `ApiError.conflict(...)` from per-endpoint logic; ditto.
- `backend.websocket_protocol.ws_error_message` — reuses the same envelope shape (`{ error: { code, message, ...detail } }`) when surfacing a typed error over WS, so a frontend error-renderer can be agnostic to transport.
- `backend.server_validation.reject_invalid_event_payload` — wraps `validateEvent` (from `apps/server/src/events/validate.ts`); on `EventValidationError` the route lets the handler classify (the handler recognizes the wrapper's `code`/`kind`/`issues`).

## Inputs / context

From [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts):

```ts
export class EventValidationError extends Error {
  override readonly name = 'EventValidationError';
  readonly code: EventValidationCode; // 'envelope-invalid' | 'unknown-kind' | 'payload-invalid'
  readonly kind: string | null;
  readonly issues: EventValidationIssue[]; // { path, message, code }
  toJSON(): { name, message, code, kind, issues };
}
```

The server-side wrapper around `@a-conversa/shared-types`'s validator. Already JSON-friendly; the handler just needs to surface `code`, `kind`, and `issues` under the envelope.

From [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts):

```ts
export type RejectionReason =
  | 'not-a-participant'
  | 'sequence-mismatch'
  | 'session-mismatch'
  | 'not-a-moderator'
  | 'proposal-not-found'
  | 'proposal-not-pending'
  | 'proposal-already-committed'
  | 'proposal-already-meta-disagreement'
  | 'target-entity-not-found'
  | 'already-voted'
  | 'no-prior-agree'
  | 'self-vote-not-allowed'
  | 'unanimous-agree-required'
  | 'axiom-mark-not-self'
  | 'inapplicable-to-facet'
  | 'illegal-state-transition'
  | 'methodology-not-exhausted';

export interface RejectedValidationResult {
  ok: false;
  reason: RejectionReason;
  detail: string;
}
```

Seventeen typed reasons; the engine pairs each with a human-readable `detail`. `rejectedToApiError` maps `reason → factory` and uses `detail` as the message.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical check is a committed test. The error handler ships with Vitest unit tests (against `ApiError` / `rejectedToApiError`) and Vitest `.inject(...)` tests against a live Fastify instance, plus a Cucumber scenario round-tripping the envelope.

From [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md): the plugin pattern is what this task uses. `@fastify/sensible`'s `httpErrors.*` produce errors with `.statusCode`; we pass those through with our envelope shape rather than letting Fastify's default serialization win.

## Constraints / requirements

- **Module shape**:
  - `apps/server/src/errors.ts` — exports `ApiError`, factory helpers, and `rejectedToApiError`.
  - `apps/server/src/error-handler.ts` — exports `errorHandlerPlugin` (a `fastify-plugin`-wrapped async function so `setErrorHandler` and `setNotFoundHandler` apply to the root scope, not to the registration's encapsulation child).
- **Plugin registration order in `server.ts`**: after `@fastify/sensible` and `@fastify/cors`, BEFORE the route plugins (`healthzPlugin` etc.). The handler has to be in place before any route handler can throw.
- **Canonical envelope**:
  ```ts
  { error: { code: string; message: string; ...detail } }
  ```
  No `statusCode` in the body (Fastify already sets the response status). `code` is a kebab-case string. `message` is a human-readable summary safe to render to a user. `...detail` is whatever additional context the specific error carries (`issues`, `kind`, etc.) — kept under the `error` object so a client can `JSON.parse(body).error.code` regardless of source.
- **RejectionReason → HTTP-status mapping** (driving `rejectedToApiError`):

  | Status | Reasons |
  |--------|---------|
  | 403 | `not-a-moderator`, `not-a-participant`, `self-vote-not-allowed`, `axiom-mark-not-self` |
  | 404 | `target-entity-not-found`, `proposal-not-found` |
  | 409 | `sequence-mismatch`, `session-mismatch`, `already-voted`, `no-prior-agree` |
  | 422 | `proposal-not-pending`, `proposal-already-committed`, `proposal-already-meta-disagreement`, `unanimous-agree-required`, `inapplicable-to-facet`, `illegal-state-transition`, `methodology-not-exhausted` |

  The envelope's `error.code` is always the kebab `reason` string verbatim; `error.message` is the rejection's `detail`. The mapping is exhaustive — `rejectedToApiError` is a `switch (reason)` over the union with the compile-time guarantee that adding a new `RejectionReason` to the union breaks the switch unless extended (the `never`-assertion default).

  401 is deliberately absent — `RejectionReason` is a methodology-engine vocabulary; the engine assumes the caller is already authenticated. Auth-level rejections (`Unauthorized`) are owned by `backend.auth.auth_middleware` and use `ApiError.unauthorized(...)` directly.

- **Handler responsibilities** (single `setErrorHandler` callback, branching on the thrown value's type):
  - **`ApiError`**: serialize `statusCode` + `{ error: { code, message, ...details } }`. No special logging — these are expected control-flow errors.
  - **`EventValidationError`** (the server-side wrapper): 422 + `{ error: { code: err.code, message: err.message, kind: err.kind, issues: err.issues } }`. The `code` here is the wrapper's discriminator (`'envelope-invalid'` | `'unknown-kind'` | `'payload-invalid'`), not a kebab string; that's intentional — the wrapper's discriminator IS the right code.
  - **Fastify validation errors** (Zod / TypeBox via fastify-type-provider): detected by `err.validation` (array) + `err.validationContext`. 400 + `{ error: { code: 'validation-failed', message: 'Request validation failed', issues: err.validation } }`.
  - **`@fastify/sensible` `httpErrors.*`** (and any error carrying `err.statusCode`): pass through the status code with the canonical envelope. `code` derives from the error's `code` property if set, otherwise from a kebab-cased `error` field (sensible sets `err.error = 'Not Found'` etc., we lowercase + hyphenate it).
  - **Anything else** (raw `Error`, unknown throw): log at error level with the stack; respond 500 + `{ error: { code: 'internal-error', message: 'Internal server error' } }`. **Never leak the stack to the client.** Never include `err.cause` in the response body.
- **`setNotFoundHandler`**: 404 + `{ error: { code: 'not-found', message: 'Route not found' } }`. Same envelope shape as the rest; lets the frontend handle unknown-route 404 with the same parser it uses for entity-not-found 404.
- **No stack-trace leakage**, no `cause` leakage, no error name in the body. The server log gets the full Error with stack (via `request.log.error({ err }, '...')`); the client gets the sanitized envelope.
- **Test layers per ADR 0022**:
  - **Vitest** `apps/server/src/errors.test.ts` — factory helpers (each asserts `statusCode` + `code` + `message`); `rejectedToApiError` parameterized over every `RejectionReason`; 4-6 smoke cases.
  - **Vitest** `apps/server/src/error-handler.test.ts` — Fastify `.inject(...)` against test routes: thrown `ApiError`, thrown raw `Error` (asserts no stack leak), thrown `EventValidationError`, thrown sensible `httpErrors.notFound()`, unknown route (notFound handler), 6-8 cases total.
  - **Cucumber** `tests/behavior/backend/error-handling.feature` — 2 scenarios: a bad-request route returns the standard envelope; an unknown route returns the standard 404 envelope. Step defs in `tests/behavior/steps/backend-error-handling.steps.ts`.
- **`fastify-plugin` added as a direct dep** (5.1.0) — the encapsulation-breaking wrapper is required to install `setErrorHandler` on the root instance. Already transitively present via `@fastify/sensible`/`@fastify/cors`; listing it directly so the import is honest.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green — new cases under `apps/server/src/errors.test.ts` and `apps/server/src/error-handler.test.ts` land alongside the existing 582.
- `pnpm run test:behavior:smoke` (Cucumber) green — `tests/behavior/backend/error-handling.feature` adds 2 scenarios atop the existing 111.
- A route that throws a raw `Error` returns 500 with `{"error":{"code":"internal-error","message":"Internal server error"}}` and the stack is in the server log only.
- An unknown route returns 404 with `{"error":{"code":"not-found","message":"Route not found"}}`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Envelope shape**: `{ error: { code, message, ...detail } }`. Two alternatives surveyed:
  - **(A) Wrap under `error` with a top-level type** (chosen). A client parser can write `body.error.code` exactly once and apply it to every error response across HTTP and WS — `ws_error_message` will reuse the same shape under a `{ type: 'error', error: { code, message, ... } }` envelope. The wrapping object also gives `...detail` a home that doesn't collide with future top-level fields.
  - **(B) Flat: `{ code, message, ...detail }`**. Rejected because it crowds the top level — adding a future `requestId` correlation field would conflict with a future `code: 'request-id'` rejection code. The wrapper gives both surfaces their own namespace.
- **`code` is the only typed discriminator on the body**; `statusCode` lives only on the HTTP layer. Two reasons: (a) preserving Fastify's "status code goes in the HTTP response, not the body" convention; (b) `code` carries semantic information (`'sequence-mismatch'`, `'proposal-not-found'`) that the status code can't — a 409 alone doesn't tell the client which 409 happened.
- **RejectionReason → status mapping rationale**:
  - **403** for `not-a-moderator` / `not-a-participant` / `self-vote-not-allowed` / `axiom-mark-not-self`: the requester is authenticated (we have a typed `requester`) but lacks the role / relationship the action requires. RFC 7231 §6.5.3 — "the server understood the request but refuses to authorize it."
  - **404** for `target-entity-not-found` / `proposal-not-found`: the referenced entity does not exist (from the requester's perspective — same status whether absent or unreadable, to avoid leaking existence to unauthorized callers; future cross-session-permissions work will sharpen this).
  - **409** for `sequence-mismatch` / `session-mismatch` / `already-voted` / `no-prior-agree`: a request that conflicts with the current state. The client typically retries after re-fetching state (sequence mismatch is the canonical optimistic-concurrency 409).
  - **422** for the methodology-flow rejections (`proposal-not-pending`, `proposal-already-committed`, `proposal-already-meta-disagreement`, `unanimous-agree-required`, `inapplicable-to-facet`, `illegal-state-transition`, `methodology-not-exhausted`): the request is syntactically valid and semantically understandable but cannot be processed in the current methodology state. RFC 4918 §11.2 — "Unprocessable Entity." Distinguishes "your input is malformed" (400) from "your input is fine but the system state forbids the operation right now."
  - **401 is absent.** The methodology engine assumes an authenticated requester. Auth-level rejection (no token, invalid token, expired token) is `backend.auth.auth_middleware`'s vocabulary — it throws `ApiError.unauthorized(...)` directly rather than going through `rejectedToApiError`.

- **`EventValidationError` → 422, not 400.** The shared-types validator distinguishes envelope shape (`'envelope-invalid'`), unknown kind (`'unknown-kind'`), and payload shape (`'payload-invalid'`). One could argue envelope shape is "bad request" (400) while payload-invalid is "unprocessable" (422). For consistency we pick 422 across all three: schema-on-write is a methodology-level guarantee (the event is unprocessable against our event vocabulary), not a transport-level one (which is what 400 is best at). The discriminator `code` already lets the client distinguish the three sub-cases.

- **Anything carrying `statusCode` passes through** (rather than being re-classified). Sensible's `httpErrors.notFound()` sets `statusCode: 404`; if a sibling task uses `reply.notFound()` we should honor the intent rather than re-routing the error through `ApiError.notFound`. The pass-through serializes with the canonical envelope; the status code wins.

- **`fastify-plugin` (encapsulation-breaking) for the registration.** Without `fp`, `app.register(errorHandlerPlugin)` installs `setErrorHandler` on the plugin's child scope only — siblings registered later (and routes attached to the root) would NOT pick up the handler. `fp` adds the `skip-override` marker so the handler attaches to the parent scope. Already transitively present in `node_modules` via sensible/cors; listed as a direct dep here to be honest about the import.

- **`rejectedToApiError` lives with `ApiError`, not with the methodology engine.** Two homes considered:
  - **`apps/server/src/errors.ts`** (chosen). The methodology engine is transport-agnostic — it returns a typed `RejectedValidationResult`; HTTP statuses are not part of the engine's vocabulary. Locating the mapping with `ApiError` keeps the engine's surface clean and gives the HTTP-layer task a single file to own.
  - **`apps/server/src/methodology/index.ts`**. Rejected — would force the methodology engine to know about HTTP semantics, which it currently doesn't and shouldn't (the same engine drives the WS path, where status codes have no meaning).

- **No `details` field on `ApiError` for the simple factories.** Factories that don't carry extra context (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `internal`) accept just a `message` string. Factories that need extra context (`unprocessable` from `rejectedToApiError`, the validation-failed handling) accept a `details` object that the handler spreads into the envelope. Keeps the common-case ergonomics simple; the rich case is still expressive.

- **Test scenarios use Vitest's `.inject(...)` on the real Fastify instance**, not unit-level handler-function isolation. Three reasons: (a) the handler is small but its dispatch logic (`err instanceof ApiError`, `err instanceof EventValidationError`, `err.validation`, `err.statusCode`) is exactly what we want to exercise end-to-end; (b) running through a real Fastify route catches encapsulation regressions (the `fastify-plugin` wrapping); (c) the `.inject(...)` pattern is already established by `server.test.ts` and `routes/healthz.test.ts`.

## Open questions

- **`requestId` correlation.** Once `request_logging` adds a per-request id, the error envelope should carry it: `{ error: { code, message, requestId, ...detail } }`. Deferred to `request_logging` so we don't pre-empt its choice of id source (UUID? cuid? trace header passthrough?).
- **Locale-aware messages.** `error.message` is currently English-only. When i18n lands, the message becomes either a key (`'errors.proposal-not-found'`) plus translation context, or the server emits a localized string per `Accept-Language`. Deferred — the methodology engine's `detail` strings would need the same treatment.
- **Sentry / error-aggregator integration.** The "log the stack at error level" path is where a `Sentry.captureException(err)` would land. Deferred — no aggregator decision yet.

## Status

**Done** — 2026-05-10. Landed as:

- ApiError + factories + mapping: [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts).
- Handler plugin: [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts).
- Server wiring: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (registers the plugin after sensible+cors, before routes).
- Dependency: `fastify-plugin@5.1.0` added to [`apps/server/package.json`](../../../apps/server/package.json) as a direct dep.
- Vitest: [`apps/server/src/errors.test.ts`](../../../apps/server/src/errors.test.ts) and [`apps/server/src/error-handler.test.ts`](../../../apps/server/src/error-handler.test.ts).
- Cucumber: [`tests/behavior/backend/error-handling.feature`](../../../tests/behavior/backend/error-handling.feature), step defs at [`tests/behavior/steps/backend-error-handling.steps.ts`](../../../tests/behavior/steps/backend-error-handling.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
