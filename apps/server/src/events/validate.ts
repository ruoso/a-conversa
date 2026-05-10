// Server-side `validateEvent` gate.
//
// Refinement: tasks/refinements/data-and-methodology/event_validation.md
// ADRs: docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md
// TaskJuggler: data_and_methodology.event_types.event_validation
//
// This module is the server-side append-path's schema-on-write gate.
// Every event the server is about to INSERT into `session_events`
// passes through `validateEvent` synchronously first; on failure the
// append is aborted and a typed `EventValidationError` is thrown.
//
// **Wraps the shared-types primitive.** The cross-workspace
// `validateEvent` exported from `@a-conversa/shared-types` already
// performs the two-stage parse (outer envelope, then per-kind
// payload). The server-side wrapper here adds:
//
//   - A consistent, structured error shape the eventual HTTP /
//     WebSocket layers can serialize to JSON for clients (so a
//     400-class response carries machine-readable field-level
//     details).
//   - A discriminated `code` (`'envelope-invalid'` |
//     `'unknown-kind'` | `'payload-invalid'`) so the caller can
//     distinguish "this event doesn't even look like an event" from
//     "the kind is recognised but the payload is malformed".
//   - A flattened `issues` array (`{ path, message }`) lifted from
//     Zod's issue list — the client can render per-field error
//     messages without having to know how to traverse a `ZodError`.
//
// **What this does *not* do.** Cross-field referential checks
// (proposal_id refers to an existing proposal, vote actor matches
// `participant`, etc.) are *not* part of payload validation per the
// refinement and ADR 0021; those layer on later in the methodology
// engine and the API skeleton's pre-INSERT logic. Today this is
// shape-only.
//
// **Wiring to the INSERT.** The `apps/server` HTTP / WebSocket
// surface — the `backend.api_skeleton` task — is not implemented
// yet. When it lands, the append path calls this wrapper and only
// proceeds to `INSERT INTO session_events` on success. The
// validator is delivered ahead of the wiring so the schema-on-write
// invariant is testable in isolation; the wiring itself ships with
// `backend.api_skeleton`.

import {
  type Event,
  EventValidationError as SharedEventValidationError,
  validateEvent as sharedValidateEvent,
  eventKinds,
} from '@a-conversa/shared-types';
import { ZodError } from 'zod';

/**
 * Discriminator on `EventValidationError`. Exposed as a string
 * literal union so HTTP / WS callers can branch on it without
 * importing the class itself (e.g. after JSON deserialization on a
 * client).
 *
 * - `'envelope-invalid'`: the outer envelope (id, sessionId,
 *   sequence, kind type, actor, createdAt) failed shape validation.
 * - `'unknown-kind'`: the envelope parses but `kind` is not in the
 *   registry (only reachable if the envelope schema is widened
 *   without a matching registry entry; today the envelope's `kind`
 *   field is the same enum as the registry, so a bad string value
 *   surfaces as `'envelope-invalid'`).
 * - `'payload-invalid'`: the envelope is valid and the kind is
 *   recognised, but the kind-specific payload is malformed.
 */
export type EventValidationCode = 'envelope-invalid' | 'unknown-kind' | 'payload-invalid';

/**
 * Stable shape for one validation issue. The `path` is a
 * dot-separated trail (e.g. `payload.proposal_id`,
 * `payload.proposal.components.0.node_id`); the `message` is
 * Zod's human-readable string. The shape is deliberately stable
 * (string-only fields, no nested objects) so it can survive a
 * JSON round-trip from server to client unchanged.
 */
export interface EventValidationIssue {
  /** Dot-separated path to the offending field. Empty for the root. */
  path: string;
  /** Human-readable description of the failure. */
  message: string;
  /** Zod's issue code (e.g. `'invalid_type'`, `'invalid_string'`). */
  code: string;
}

/**
 * Thrown by the server-side `validateEvent` on any failure.
 *
 * Designed to be JSON-serialized for client responses: the relevant
 * fields (`code`, `kind`, `issues`, `message`) are plain data, no
 * methods or non-serializable carriers. Clients deserialize a
 * structured response into the same shape; the class instance
 * itself does not cross the wire.
 */
export class EventValidationError extends Error {
  override readonly name = 'EventValidationError';

  /** Discriminator — see `EventValidationCode`. */
  readonly code: EventValidationCode;

  /**
   * The event kind if it was discoverable from the input, otherwise
   * `null`. Set to the input's `kind` value (as a string) for
   * payload-invalid failures and for `'unknown-kind'`; `null` for
   * envelope-level failures where the kind itself was missing,
   * non-string, or otherwise unparseable.
   */
  readonly kind: string | null;

  /** Flattened Zod issues; empty if the failure had no Zod cause. */
  readonly issues: EventValidationIssue[];

  constructor(
    message: string,
    options: {
      code: EventValidationCode;
      kind: string | null;
      issues: EventValidationIssue[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.kind = options.kind;
    this.issues = options.issues;
  }

  /**
   * JSON-serializable shape clients can deserialize. Keeping
   * `name` in the payload lets a client check
   * `body.name === 'EventValidationError'` to distinguish a
   * validator failure from any other error response shape.
   */
  toJSON(): {
    name: string;
    message: string;
    code: EventValidationCode;
    kind: string | null;
    issues: EventValidationIssue[];
  } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      kind: this.kind,
      issues: this.issues,
    };
  }
}

/**
 * Result of a successful `validateEvent` call — the typed
 * discriminated-union `Event` from shared-types. Re-exported here
 * so callers in `apps/server` can import everything they need
 * (`EventValidationError`, the result type) from one place.
 */
export type ValidatedEvent = Event;

const eventKindSet: ReadonlySet<string> = new Set(eventKinds);

/**
 * Flatten a `ZodError`'s issue list into the wire-friendly
 * `EventValidationIssue` shape. Symbol path components are
 * stringified (e.g. `Symbol(foo)` → `"Symbol(foo)"`) — Zod allows
 * symbols in `path` for object keys but in practice every payload
 * here uses string / number keys.
 */
function flattenIssues(error: ZodError): EventValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Try to recover a string `kind` from raw input even when the
 * envelope failed validation (so we can surface the kind in the
 * error if the input *almost* parsed). Returns `null` if `raw` is
 * not an object or if `kind` is missing / non-string.
 */
function extractKind(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = (raw as { kind?: unknown }).kind;
  return typeof candidate === 'string' ? candidate : null;
}

/**
 * Inspect a `SharedEventValidationError`'s message to decide which
 * stage of the underlying two-stage parse failed. The shared-types
 * primitive's messages have stable prefixes:
 *
 *   - `"event envelope failed validation: ..."` → envelope stage.
 *   - `"payload for kind '<kind>' failed validation: ..."` → payload stage.
 *   - `"no payload schema registered for kind '<kind>'"` → unknown-kind branch.
 *
 * Pattern-matching on the message is more robust than inspecting
 * the Zod issue paths, because the payload-stage Zod issues' paths
 * are relative to the payload object (e.g. `host_user_id`), not to
 * the full envelope (which would prefix `payload.`). The message
 * prefix is the only stage signal the primitive exposes.
 */
function classifyByMessage(message: string): 'envelope' | 'payload' | 'unknown-kind' {
  if (message.startsWith('event envelope failed validation')) return 'envelope';
  if (message.startsWith('no payload schema registered for kind')) return 'unknown-kind';
  // The remaining shared-types-emitted message is the payload stage.
  // A defensive fallback (`'envelope'`) would obscure a real failure;
  // we treat any other message as payload-stage so the wrapper still
  // returns a structured error with a recovered kind.
  return 'payload';
}

/**
 * Re-rooted issue path. Payload-stage issues from Zod have paths
 * relative to the payload object (e.g. `host_user_id`); the
 * wrapper's clients see the full envelope, so we prefix
 * `payload.` to make the path unambiguous on the wire. Envelope-
 * stage issues are already rooted at the envelope.
 */
function reRootIssues(
  issues: EventValidationIssue[],
  stage: 'envelope' | 'payload',
): EventValidationIssue[] {
  if (stage === 'envelope') return issues;
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === '' ? 'payload' : `payload.${issue.path}`,
  }));
}

/**
 * Validate an unknown candidate as a typed `Event`.
 *
 * @param input - the raw value (e.g. JSON-parsed envelope from the
 *                wire, or an in-memory object the server is about
 *                to append). Must include both the envelope fields
 *                and the kind-specific payload nested under
 *                `payload`.
 * @returns the typed discriminated-union `Event` on success.
 * @throws  {EventValidationError} on any envelope shape, unknown
 *          kind, or payload shape failure. The thrown error's
 *          `code`, `kind`, and `issues` describe the failure in a
 *          shape clients can JSON-deserialize directly.
 */
export function validateEvent(input: unknown): ValidatedEvent {
  try {
    return sharedValidateEvent(input);
  } catch (error) {
    // Re-throw any non-validation error untouched (e.g. a TypeError
    // from upstream). The shared-types primitive throws
    // `SharedEventValidationError` for both envelope and payload
    // failures; everything else is a programming error and should
    // surface unchanged.
    if (!(error instanceof SharedEventValidationError)) {
      throw error;
    }

    const cause = error.cause;
    const candidateKind = extractKind(input);
    const stage = classifyByMessage(error.message);
    const rawIssues = cause instanceof ZodError ? flattenIssues(cause) : [];

    if (stage === 'unknown-kind') {
      // The envelope parsed but the kind isn't in the registry.
      // Today the envelope schema's `kind` field is the exhaustive
      // enum, so this branch is only reachable if the schemas
      // drift apart. The candidate kind is a string at this point.
      throw new EventValidationError(error.message, {
        code: 'unknown-kind',
        kind: candidateKind,
        issues: [],
        cause: error,
      });
    }

    if (stage === 'envelope') {
      // If the only envelope problem is a `kind` outside the
      // registry, classify as `'unknown-kind'` so callers can
      // distinguish a typo from a generic envelope-shape error.
      // Detection: `kind` is a string AND not in `eventKindSet`
      // AND there's at least one Zod issue rooted at `kind`.
      if (
        candidateKind !== null &&
        !eventKindSet.has(candidateKind) &&
        rawIssues.some((issue) => issue.path === 'kind')
      ) {
        throw new EventValidationError(error.message, {
          code: 'unknown-kind',
          kind: candidateKind,
          issues: reRootIssues(rawIssues, 'envelope'),
          cause: error,
        });
      }
      throw new EventValidationError(error.message, {
        code: 'envelope-invalid',
        kind: null,
        issues: reRootIssues(rawIssues, 'envelope'),
        cause: error,
      });
    }

    // Payload-level failure. The envelope parsed, so `kind` is a
    // valid registered kind; we surface it on the error so the
    // client can localise per-kind error messages.
    throw new EventValidationError(error.message, {
      code: 'payload-invalid',
      kind: candidateKind,
      issues: reRootIssues(rawIssues, 'payload'),
      cause: error,
    });
  }
}
