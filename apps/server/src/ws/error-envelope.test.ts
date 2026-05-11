// Tests for the WS error-envelope builder + sender helper.
//
// Refinement: tasks/refinements/backend/ws_error_message.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_error_message
//
// Pure-logic layer — the builder/sender themselves do no I/O; they
// receive a sender closure and pass the serialised wire string
// through it. Vitest is the appropriate layer per ADR 0022. The
// wire-path integration (envelope reaches the client via real
// `app.injectWS`) is covered by:
//   - `dispatcher.test.ts` — the two dispatcher seams.
//   - `connection.test.ts` — the malformed-envelope path.
//   - `handlers/subscribe.test.ts` — the not-found visibility path.
//   - `tests/behavior/backend/ws-error.feature` — end-to-end cucumber.

import { describe, expect, it } from 'vitest';

import { parseWsEnvelope } from './envelope.js';
import {
  buildWsErrorEnvelope,
  isApiErrorShape,
  sendWsError,
  WS_INTERNAL_ERROR_CODE,
  WS_INTERNAL_ERROR_MESSAGE,
  WS_MALFORMED_ENVELOPE_CODE,
  WS_UNKNOWN_MESSAGE_TYPE_CODE,
} from './error-envelope.js';

// Sample v4 UUIDs.
const REQ_ID = '11111111-1111-4111-8111-111111111111';

// RFC 4122 v4 matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildWsErrorEnvelope', () => {
  it('produces a `type: "error"` envelope with a fresh v4 UUID id', () => {
    const envelope = buildWsErrorEnvelope({
      code: 'not-found',
      message: 'session not found',
    });
    expect(envelope.type).toBe('error');
    expect(envelope.id).toMatch(UUID_V4_PATTERN);
    expect(envelope.payload.code).toBe('not-found');
    expect(envelope.payload.message).toBe('session not found');
  });

  it('mints a fresh id per call (no reuse)', () => {
    const a = buildWsErrorEnvelope({ code: 'x', message: 'y' });
    const b = buildWsErrorEnvelope({ code: 'x', message: 'y' });
    expect(a.id).not.toBe(b.id);
  });

  it('includes `inResponseTo` when provided', () => {
    const envelope = buildWsErrorEnvelope({
      code: 'not-found',
      message: 'session not found',
      inResponseTo: REQ_ID,
    });
    expect(envelope.inResponseTo).toBe(REQ_ID);
  });

  it('omits `inResponseTo` when not provided', () => {
    const envelope = buildWsErrorEnvelope({
      code: 'malformed-envelope',
      message: 'envelope parse failed',
    });
    // The key MUST be absent on the produced object (not set to
    // undefined) — the closed-union envelope schema treats the field
    // as optional and the wire-format JSON should not carry a
    // `"inResponseTo": undefined` literal.
    expect(envelope.inResponseTo).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(envelope, 'inResponseTo')).toBe(false);
  });

  it('passes through optional `details`', () => {
    const envelope = buildWsErrorEnvelope({
      code: 'bad-request',
      message: 'invalid payload',
      details: { issues: [{ path: ['payload', 'sessionId'], message: 'uuid required' }] },
    });
    expect(envelope.payload.details).toEqual({
      issues: [{ path: ['payload', 'sessionId'], message: 'uuid required' }],
    });
  });

  it('omits `details` from the payload when not provided', () => {
    const envelope = buildWsErrorEnvelope({ code: 'internal-error', message: 'internal error' });
    expect(Object.prototype.hasOwnProperty.call(envelope.payload, 'details')).toBe(false);
  });

  it('produces an envelope that round-trips through parseWsEnvelope', () => {
    const envelope = buildWsErrorEnvelope({
      code: 'not-found',
      message: 'session not found',
      inResponseTo: REQ_ID,
    });
    // The shared schema must accept the produced shape. If a future
    // refactor drifts the builder's output away from the schema,
    // this test fails before any wire surface notices.
    expect(() => parseWsEnvelope(envelope)).not.toThrow();
  });
});

describe('sendWsError', () => {
  it('builds + serialises + passes the wire string to the sender closure', () => {
    const sends: string[] = [];
    sendWsError((wire) => sends.push(wire), {
      code: 'unknown-message-type',
      message: "no handler registered for message type 'banana'",
      inResponseTo: REQ_ID,
    });
    expect(sends).toHaveLength(1);
    const parsed = JSON.parse(sends[0] as string) as {
      type?: unknown;
      id?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    expect(parsed.type).toBe('error');
    expect(typeof parsed.id).toBe('string');
    expect(parsed.id).toMatch(UUID_V4_PATTERN);
    expect(parsed.inResponseTo).toBe(REQ_ID);
    expect(parsed.payload?.code).toBe('unknown-message-type');
    expect(parsed.payload?.message).toBe("no handler registered for message type 'banana'");
  });

  it('omits `inResponseTo` from the wire when not provided (malformed-envelope case)', () => {
    const sends: string[] = [];
    sendWsError((wire) => sends.push(wire), {
      code: 'malformed-envelope',
      message: 'envelope parse failed',
    });
    const parsed = JSON.parse(sends[0] as string) as Record<string, unknown>;
    expect(parsed['inResponseTo']).toBeUndefined();
    // Explicitly check the key is absent from the wire string — a
    // `"inResponseTo": null` would break the client's schema check.
    expect(sends[0]).not.toMatch(/"inResponseTo"/);
  });

  it('passes through optional `details` on the wire', () => {
    const sends: string[] = [];
    sendWsError((wire) => sends.push(wire), {
      code: 'bad-request',
      message: 'invalid payload',
      details: { field: 'sessionId' },
    });
    const parsed = JSON.parse(sends[0] as string) as {
      payload?: { details?: { field?: unknown } };
    };
    expect(parsed.payload?.details?.field).toBe('sessionId');
  });
});

describe('isApiErrorShape (duck-typed `ApiError` discriminator)', () => {
  it('returns true for an object with string `code` and `message` fields', () => {
    expect(isApiErrorShape({ code: 'forbidden', message: 'no access' })).toBe(true);
  });

  it('returns true for an actual ApiError-class instance shape', () => {
    // The dispatcher-seam path may receive `new ApiError(...)` from a
    // handler that calls `ApiError.notFound(...)`. The duck-typed
    // check has to accept it.
    class FakeApiError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    }
    const err = new FakeApiError('not-found', 'session not found');
    expect(isApiErrorShape(err)).toBe(true);
  });

  it('returns false for a plain `Error` (no `code` field)', () => {
    expect(isApiErrorShape(new Error('boom'))).toBe(false);
  });

  it('returns false for `null` / `undefined` / primitives', () => {
    expect(isApiErrorShape(null)).toBe(false);
    expect(isApiErrorShape(undefined)).toBe(false);
    expect(isApiErrorShape('boom')).toBe(false);
    expect(isApiErrorShape(42)).toBe(false);
  });

  it('returns false when `code` is present but non-string', () => {
    expect(isApiErrorShape({ code: 500, message: 'internal' })).toBe(false);
  });

  it('returns false when `message` is present but non-string', () => {
    expect(isApiErrorShape({ code: 'forbidden', message: null })).toBe(false);
  });
});

describe('exported `code` constants', () => {
  it('keeps the wire vocabulary stable across the dispatcher / connection / subscribe surfaces', () => {
    // Pin the exact strings. The HTTP envelope's `ApiError.code`
    // taxonomy uses the same kebab-case shape; an accidental drift
    // here (a typo, a casing change) would break the unified
    // vocabulary the client side branches on.
    expect(WS_UNKNOWN_MESSAGE_TYPE_CODE).toBe('unknown-message-type');
    expect(WS_MALFORMED_ENVELOPE_CODE).toBe('malformed-envelope');
    expect(WS_INTERNAL_ERROR_CODE).toBe('internal-error');
    expect(WS_INTERNAL_ERROR_MESSAGE).toBe('internal error');
  });

  it('produces a `code` shape every produced envelope satisfies the shared schema for', () => {
    // Spot-check: each constant flows through the builder + the
    // shared schema. A failure here would mean the constant drifted
    // from the schema's accepted shape — caught at the unit level.
    const e = buildWsErrorEnvelope({
      code: WS_UNKNOWN_MESSAGE_TYPE_CODE,
      message: 'any',
    });
    expect(() => parseWsEnvelope(e)).not.toThrow();
  });
});
