// Vitest unit tests for `ApiError`, the factory helpers, and
// `rejectedToApiError`.
//
// Refinement: tasks/refinements/backend/error_handling.md
// TaskJuggler: backend.api_skeleton.error_handling
//
// Coverage:
//   - Each factory helper (`badRequest`, `unauthorized`, `forbidden`,
//     `notFound`, `conflict`, `unprocessable`, `internal`) returns an
//     `ApiError` with the right `statusCode`, `code`, and `message`.
//   - The constructor preserves `details` when provided and omits it
//     when not.
//   - `rejectedToApiError` is exercised parameterized over every
//     `RejectionReason` in the methodology engine's union; each
//     reason maps to the expected (statusCode, code, message) triple
//     per the refinement's mapping table.

import { describe, expect, it } from 'vitest';

import { ApiError, rejectedToApiError } from './errors.js';
import type { RejectedValidationResult, RejectionReason } from './methodology/types.js';

describe('ApiError factory helpers', () => {
  // Each row pins (factory, expectedStatus, expectedCode). The
  // factories are constants; iterating keeps the test file short
  // without obscuring intent.
  const cases: ReadonlyArray<{
    name: string;
    factory: (message: string) => ApiError;
    status: number;
    code: string;
  }> = [
    // Each factory is wrapped in an arrow so the lint rule
    // `@typescript-eslint/unbound-method` doesn't flag the bare
    // method reference (the static methods don't use `this`, but the
    // rule applies uniformly to method references off a class).
    {
      name: 'badRequest',
      factory: (m: string) => ApiError.badRequest(m),
      status: 400,
      code: 'bad-request',
    },
    {
      name: 'unauthorized',
      factory: (m: string) => ApiError.unauthorized(m),
      status: 401,
      code: 'unauthorized',
    },
    {
      name: 'forbidden',
      factory: (m: string) => ApiError.forbidden(m),
      status: 403,
      code: 'forbidden',
    },
    {
      name: 'notFound',
      factory: (m: string) => ApiError.notFound(m),
      status: 404,
      code: 'not-found',
    },
    {
      name: 'conflict',
      factory: (m: string) => ApiError.conflict(m),
      status: 409,
      code: 'conflict',
    },
    {
      name: 'unprocessable',
      factory: (m: string) => ApiError.unprocessable(m),
      status: 422,
      code: 'unprocessable-entity',
    },
    {
      name: 'internal',
      factory: (m: string) => ApiError.internal(m),
      status: 500,
      code: 'internal-error',
    },
  ];

  it.each(cases)('$name → status $status + code "$code"', ({ factory, status, code }) => {
    const err = factory('something went wrong');
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toBe('something went wrong');
    expect(err.details).toBeUndefined();
  });

  it('preserves details when provided', () => {
    const details = { issues: [{ path: 'foo', message: 'bar' }], requestId: 'abc-123' };
    const err = ApiError.badRequest('nope', details);
    expect(err.details).toEqual(details);
  });

  it('factory-thrown errors carry a name suitable for log filtering', () => {
    // `name` is what Pino's err serializer surfaces as `err.type`;
    // confirming it gives downstream observability a stable handle.
    const err = ApiError.notFound('x');
    expect(err.name).toBe('ApiError');
  });
});

describe('rejectedToApiError', () => {
  // The full RejectionReason union — every value must map to a
  // specific (statusCode, message-passthrough) pair. The table here
  // is the single source of truth; if it falls out of sync with the
  // engine, this test fails fast.
  const mapping: ReadonlyArray<{ reason: RejectionReason; status: number }> = [
    { reason: 'not-a-moderator', status: 403 },
    { reason: 'not-a-participant', status: 403 },
    { reason: 'self-vote-not-allowed', status: 403 },
    { reason: 'axiom-mark-not-self', status: 403 },
    { reason: 'target-entity-not-found', status: 404 },
    { reason: 'proposal-not-found', status: 404 },
    { reason: 'sequence-mismatch', status: 409 },
    { reason: 'session-mismatch', status: 409 },
    { reason: 'already-voted', status: 409 },
    { reason: 'no-prior-agree', status: 409 },
    { reason: 'proposal-not-pending', status: 422 },
    { reason: 'proposal-already-committed', status: 422 },
    { reason: 'proposal-already-meta-disagreement', status: 422 },
    { reason: 'unanimous-agree-required', status: 422 },
    { reason: 'inapplicable-to-facet', status: 422 },
    { reason: 'illegal-state-transition', status: 422 },
    { reason: 'methodology-not-exhausted', status: 422 },
  ];

  // Sanity: the mapping covers every member of the union. We use a
  // single-element-of-each-key check rather than a runtime length
  // assertion against a "known" count, because the union's size is
  // the source of truth — adding a member to the union without
  // extending the mapping should be caught by `statusCodeForRejection`'s
  // exhaustiveness check at compile time, and by the actual
  // parameterized cases below at runtime.
  it('covers every RejectionReason in the union (compile-time guard sanity)', () => {
    // If the union grows and the test mapping doesn't, this typed
    // helper forces a compile error. The runtime `expect` is a
    // tripwire if someone bypasses the type system.
    const allReasons: Record<RejectionReason, true> = {
      'not-a-moderator': true,
      'not-a-participant': true,
      'sequence-mismatch': true,
      'session-mismatch': true,
      'proposal-not-found': true,
      'proposal-not-pending': true,
      'proposal-already-committed': true,
      'proposal-already-meta-disagreement': true,
      'target-entity-not-found': true,
      'already-voted': true,
      'no-prior-agree': true,
      'self-vote-not-allowed': true,
      'unanimous-agree-required': true,
      'axiom-mark-not-self': true,
      'inapplicable-to-facet': true,
      'illegal-state-transition': true,
      'methodology-not-exhausted': true,
    };
    expect(Object.keys(allReasons).sort()).toEqual(mapping.map((row) => row.reason).sort());
  });

  it.each(mapping)(
    '"$reason" → $status',
    ({ reason, status }: { reason: RejectionReason; status: number }) => {
      const rejection: RejectedValidationResult = {
        ok: false,
        reason,
        detail: `detail for ${reason}`,
      };
      const err = rejectedToApiError(rejection);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(status);
      // The envelope code is the kebab `reason` string verbatim.
      expect(err.code).toBe(reason);
      // The message is the rejection's `detail` string, passed through.
      expect(err.message).toBe(`detail for ${reason}`);
      // No structured details are added; the caller's `detail` is the
      // only payload context.
      expect(err.details).toBeUndefined();
    },
  );
});
