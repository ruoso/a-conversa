// Tests for the WebSocket message envelope, payload registry, and
// the parse / serialize helpers.
//
// Refinement: tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_message_envelope
//
// Pure-logic layer (no I/O, no DB, no WS) — Vitest unit tests per
// ADR 0022's layer routing. The integration tests
// (`tests/behavior/backend/ws-envelope.feature`) cover the
// envelope-over-the-wire path via `app.injectWS`.

import { describe, expect, it } from 'vitest';

import {
  catchUpPayloadSchema,
  parseWsEnvelope,
  parseWsEnvelopeJson,
  serializeWsEnvelope,
  WsEnvelopeValidationError,
  helloPayloadSchema,
  wsEnvelopeSchema,
  wsMessagePayloadSchemas,
  wsMessageTypes,
  type WsEnvelope,
} from './ws-envelope.js';

// Sample v4 UUIDs (version-nibble = 4, variant-nibble in [89ab]).
const MSG_ID = '11111111-1111-4111-8111-111111111111';
const REQ_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

describe('wsMessageTypes vocabulary', () => {
  it('exposes the closed enum the registry is exhaustive over', () => {
    // `hello` came from `ws_message_envelope`; `subscribe` /
    // `unsubscribe` (client → server) and `subscribed` / `unsubscribed`
    // (server → client acks) came from `ws_subscribe_to_session`;
    // `propose` (client → server) and `proposed` (server → client ack)
    // came from `ws_propose_message`; `vote` (client → server) and
    // `voted` (server → client ack) came from `ws_vote_message`;
    // `commit` (client → server) and `committed` (server → client ack)
    // came from `ws_commit_message`; `mark-meta-disagreement` (client
    // → server) and `meta-disagreement-marked` (server → client ack)
    // came from `ws_meta_disagreement_message`; `snapshot` (client →
    // server) and `snapshot-state` (server → client response) came
    // from `ws_snapshot_message` — Interpretation A (state-query
    // catch-up), not Interpretation B (label-creation); see the
    // refinement Decisions for the choice rationale. `event-applied`
    // (server → client broadcast) came from `ws_event_broadcast`;
    // `error` (server → client canonical error envelope) came from
    // `ws_error_message`; `diagnostic` (server → client structural
    // diagnostic broadcast) came from `ws_diagnostic_broadcast`;
    // `proposal-status` (server → client derived per-facet status
    // broadcast) came from `ws_proposal_status_broadcast`.
    // `catch-up` (client → server) and `caught-up` (server → client
    // ack) came from `ws_reconnection_handling` — the server-side
    // surface for state catch-up on reconnect; the slice-replay path
    // reuses `event-applied` for replay frames and the snapshot-
    // fallback path reuses `snapshot-state`. The vocabulary is laid
    // out per the three-group union-extension convention documented
    // in `ws-envelope.ts` (server-emitted / request / ack-or-result);
    // future sibling message-type tasks append at the corresponding
    // group's tail. The assertion pins the current state so an
    // accidental widening is loud.
    expect([...wsMessageTypes]).toEqual([
      'hello',
      'subscribe',
      'unsubscribe',
      'propose',
      'vote',
      'commit',
      'mark-meta-disagreement',
      'snapshot',
      'catch-up',
      'subscribed',
      'unsubscribed',
      'proposed',
      'voted',
      'committed',
      'meta-disagreement-marked',
      'snapshot-state',
      'caught-up',
      'event-applied',
      'error',
      'diagnostic',
      'proposal-status',
    ]);
  });

  it('keeps the payload registry exhaustive over the type vocabulary', () => {
    for (const t of wsMessageTypes) {
      expect(wsMessagePayloadSchemas[t]).toBeDefined();
    }
  });
});

describe('hello payload schema', () => {
  it('accepts a v4 UUID connectionId', () => {
    expect(() => helloPayloadSchema.parse({ connectionId: CONNECTION_ID })).not.toThrow();
  });

  it('rejects a non-UUID connectionId', () => {
    expect(() => helloPayloadSchema.parse({ connectionId: 'not-a-uuid' })).toThrow();
  });

  it('rejects a missing connectionId', () => {
    expect(() => helloPayloadSchema.parse({})).toThrow();
  });
});

describe('parseWsEnvelope (in-memory)', () => {
  it('accepts a well-formed hello envelope and narrows the payload', () => {
    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };

    const parsed = parseWsEnvelope(envelope);
    expect(parsed.type).toBe('hello');
    expect(parsed.id).toBe(MSG_ID);
    expect(parsed.payload).toEqual({ connectionId: CONNECTION_ID });
  });

  it('accepts an envelope with inResponseTo set', () => {
    const envelope = {
      type: 'hello',
      id: MSG_ID,
      inResponseTo: REQ_ID,
      payload: { connectionId: CONNECTION_ID },
    };

    const parsed = parseWsEnvelope(envelope);
    expect(parsed.inResponseTo).toBe(REQ_ID);
  });

  it('rejects an envelope missing the `type` field', () => {
    expect(() => parseWsEnvelope({ id: MSG_ID, payload: { connectionId: CONNECTION_ID } })).toThrow(
      WsEnvelopeValidationError,
    );
  });

  it('rejects an envelope missing the `id` field', () => {
    expect(() =>
      parseWsEnvelope({ type: 'hello', payload: { connectionId: CONNECTION_ID } }),
    ).toThrow(WsEnvelopeValidationError);
  });

  it('rejects an envelope with a non-UUID id', () => {
    expect(() =>
      parseWsEnvelope({
        type: 'hello',
        id: 'not-a-uuid',
        payload: { connectionId: CONNECTION_ID },
      }),
    ).toThrow(WsEnvelopeValidationError);
  });

  it('rejects an envelope with an unknown type', () => {
    expect(() =>
      parseWsEnvelope({ type: 'definitely-not-a-real-type', id: MSG_ID, payload: {} }),
    ).toThrow(WsEnvelopeValidationError);
  });

  it('rejects a malformed payload for a known type', () => {
    // `connectionId` must be a UUID. A plain string fails the payload
    // schema; the error message names the offending `type`.
    let caught: unknown;
    try {
      parseWsEnvelope({ type: 'hello', id: MSG_ID, payload: { connectionId: 'not-a-uuid' } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WsEnvelopeValidationError);
    expect((caught as Error).message).toMatch(/payload for ws message type 'hello'/);
  });
});

describe('parseWsEnvelopeJson (wire format)', () => {
  it('round-trips a serialize → JSON.parse → parse cycle', () => {
    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };

    const wire = serializeWsEnvelope(envelope);
    const parsed = parseWsEnvelopeJson(wire);

    expect(parsed).toEqual(envelope);
  });

  it('preserves inResponseTo across the round-trip', () => {
    const envelope = {
      type: 'hello' as const,
      id: MSG_ID,
      inResponseTo: REQ_ID,
      payload: { connectionId: CONNECTION_ID },
    };

    const wire = serializeWsEnvelope(envelope);
    const parsed = parseWsEnvelopeJson(wire);

    expect(parsed).toEqual(envelope);
  });

  it('rejects non-JSON input with a WsEnvelopeValidationError', () => {
    let caught: unknown;
    try {
      parseWsEnvelopeJson('not json at all{{{');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WsEnvelopeValidationError);
    expect((caught as Error).message).toMatch(/JSON parse failed/);
  });

  it('rejects valid JSON with the wrong shape', () => {
    expect(() => parseWsEnvelopeJson('"a bare string"')).toThrow(WsEnvelopeValidationError);
    expect(() => parseWsEnvelopeJson('[]')).toThrow(WsEnvelopeValidationError);
    expect(() => parseWsEnvelopeJson('{}')).toThrow(WsEnvelopeValidationError);
  });
});

describe('serializeWsEnvelope', () => {
  it('produces a JSON string that re-parses to the original envelope', () => {
    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const wire = serializeWsEnvelope(envelope);

    // The wire format is JSON — must be a string, must round-trip via
    // JSON.parse.
    expect(typeof wire).toBe('string');
    expect(JSON.parse(wire)).toEqual(envelope);
  });

  it('throws WsEnvelopeValidationError if the envelope is malformed (defensive against server bugs)', () => {
    // Cast through `unknown` so the test can construct a deliberately
    // malformed envelope without TS rejecting the literal.
    const bad = { type: 'hello', id: 'not-a-uuid', payload: { connectionId: CONNECTION_ID } };
    expect(() => serializeWsEnvelope(bad as unknown as WsEnvelope<'hello'>)).toThrow(
      WsEnvelopeValidationError,
    );
  });
});

describe('wsEnvelopeSchema (outer shape only)', () => {
  it('accepts unknown payload at the outer stage (payload is parsed separately)', () => {
    // The outer schema treats `payload` as `z.unknown()` — the
    // two-stage parse looks it up in the registry. This test pins that
    // contract so a future refactor can't silently collapse the two
    // stages into a single discriminatedUnion.
    const result = wsEnvelopeSchema.safeParse({
      type: 'hello',
      id: MSG_ID,
      payload: 'this is not a hello payload but the outer schema accepts it',
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// `catch-up` payload boundary values — regression-pin for G-006.
//
// Refinement: tasks/refinements/backend-hardening/catch_up_boundary_values_pin.md
// Source:     docs/security/m3-review/coverage.md G-006
//
// The Zod schema enforces `sinceSequence: z.number().int().nonnegative()`.
// `catch-up.test.ts` already covers the `sinceSequence > MAX(sequence)`
// client-ahead path at the handler level. This block pins the WIRE-
// BOUNDARY rejections at the envelope-parser layer so a future
// regression in the schema (e.g., switching `nonnegative()` to
// `min(-1)`, or dropping `.int()`) is caught by the test suite — not
// by a security review six months from now.
//
// **What `JSON.parse` does to each non-finite value.** `NaN` /
// `Infinity` / `-Infinity` are NOT valid JSON tokens. `JSON.stringify`
// serializes them as `null`. The dispatcher receives a JSON string from
// the wire, so the realistic adversarial input for those cases is a
// literal `null` payload field — pinned below alongside the direct
// numeric forms (for the in-memory parse path).
// ============================================================

// Build a `catch-up` envelope JSON string with an arbitrary
// `sinceSequence` value injected verbatim (so we can exercise wire
// inputs that wouldn't survive a typed object literal — e.g., a string
// where a number is expected). The `sessionId` is always a valid v4
// UUID so failures isolate to the `sinceSequence` field.
function catchUpEnvelopeJson(sinceSequenceLiteral: string): string {
  return `{"type":"catch-up","id":"${MSG_ID}","payload":{"sessionId":"${SESSION_ID}","sinceSequence":${sinceSequenceLiteral}}}`;
}

describe('catch-up `sinceSequence` boundary values (G-006)', () => {
  describe('schema-level rejections (catchUpPayloadSchema directly)', () => {
    const cases: Array<{ name: string; value: unknown }> = [
      { name: 'negative integer (-1)', value: -1 },
      { name: 'fractional (0.5)', value: 0.5 },
      { name: 'string "0"', value: '0' },
      { name: 'string "100"', value: '100' },
      { name: 'null (serialized NaN / Infinity)', value: null },
      { name: 'undefined (missing field)', value: undefined },
      { name: 'NaN literal (in-memory only)', value: Number.NaN },
      { name: 'Infinity literal (in-memory only)', value: Number.POSITIVE_INFINITY },
      { name: '-Infinity literal (in-memory only)', value: Number.NEGATIVE_INFINITY },
      { name: 'boolean true', value: true },
      { name: 'array []', value: [] },
      { name: 'object {}', value: {} },
    ];

    for (const c of cases) {
      it(`rejects sinceSequence: ${c.name}`, () => {
        const result = catchUpPayloadSchema.safeParse({
          sessionId: SESSION_ID,
          sinceSequence: c.value,
        });
        expect(result.success).toBe(false);
      });
    }

    it('rejects sinceSequence above Number.MAX_SAFE_INTEGER (2^53)', () => {
      // `Number.MAX_SAFE_INTEGER + 2` (= 9007199254740993 in math,
      // 9007199254740992 in IEEE 754) is the canonical "above the
      // safe integer ceiling" probe. The literal form is written via
      // the constant rather than the decimal digits so ESLint's
      // `no-loss-of-precision` doesn't fire on what is exactly the
      // condition we're pinning. Zod v4's `.int()` defers to
      // `Number.isSafeInteger` — values past the safe-integer
      // ceiling fail the `.int()` predicate. This test pins that
      // behavior (and would catch a regression that swapped `.int()`
      // for the looser `.finite()` or removed the safety bound
      // entirely). See Decisions in the refinement document.
      const result = catchUpPayloadSchema.safeParse({
        sessionId: SESSION_ID,
        sinceSequence: Number.MAX_SAFE_INTEGER + 2,
      });
      expect(result.success).toBe(false);
    });

    it('accepts sinceSequence: 0 (regression — client says "I have seen nothing")', () => {
      const result = catchUpPayloadSchema.safeParse({
        sessionId: SESSION_ID,
        sinceSequence: 0,
      });
      expect(result.success).toBe(true);
    });

    it('accepts sinceSequence: 100 (regression — typical mid-replay)', () => {
      const result = catchUpPayloadSchema.safeParse({
        sessionId: SESSION_ID,
        sinceSequence: 100,
      });
      expect(result.success).toBe(true);
    });

    it('accepts sinceSequence: Number.MAX_SAFE_INTEGER (regression — boundary value)', () => {
      // The ceiling itself IS a safe integer; only values past it
      // fail. Pin both sides of the boundary to make the contract
      // explicit.
      const result = catchUpPayloadSchema.safeParse({
        sessionId: SESSION_ID,
        sinceSequence: Number.MAX_SAFE_INTEGER,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('wire-boundary rejections (parseWsEnvelopeJson)', () => {
    // These cases mirror the realistic wire-input failure modes: the
    // server only ever sees a JSON string. Anything that JSON cannot
    // represent (NaN / Infinity) reaches the parser as `null`, which
    // also fails the schema.
    const cases: Array<{ name: string; literal: string }> = [
      { name: 'negative integer (-1)', literal: '-1' },
      { name: 'fractional (0.5)', literal: '0.5' },
      { name: 'string "0"', literal: '"0"' },
      { name: 'string "100"', literal: '"100"' },
      { name: 'null (the JSON.stringify image of NaN / Infinity)', literal: 'null' },
      { name: 'boolean true', literal: 'true' },
      { name: 'above Number.MAX_SAFE_INTEGER (9007199254740993)', literal: '9007199254740993' },
    ];

    for (const c of cases) {
      it(`rejects sinceSequence: ${c.name} with WsEnvelopeValidationError`, () => {
        expect(() => parseWsEnvelopeJson(catchUpEnvelopeJson(c.literal))).toThrow(
          WsEnvelopeValidationError,
        );
      });
    }

    it('rejects a catch-up envelope missing `sinceSequence` entirely', () => {
      // The omitted-field case can't go through `catchUpEnvelopeJson`
      // (it always includes the field). Build the JSON inline. Closed
      // `z.object` rejects a missing required key.
      const wire = `{"type":"catch-up","id":"${MSG_ID}","payload":{"sessionId":"${SESSION_ID}"}}`;
      expect(() => parseWsEnvelopeJson(wire)).toThrow(WsEnvelopeValidationError);
    });

    it('accepts a well-formed catch-up envelope with sinceSequence: 0', () => {
      // Regression case — ensure the test isn't accidentally rejecting
      // everything (e.g., because the `sessionId` is malformed).
      expect(() => parseWsEnvelopeJson(catchUpEnvelopeJson('0'))).not.toThrow();
    });

    it('accepts a well-formed catch-up envelope with sinceSequence: 100', () => {
      expect(() => parseWsEnvelopeJson(catchUpEnvelopeJson('100'))).not.toThrow();
    });
  });
});
