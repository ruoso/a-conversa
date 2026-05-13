// Tests for the WsDispatcher class.
//
// Refinement: tasks/refinements/backend/ws_message_envelope.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_message_envelope
//
// Pure-logic layer — the dispatcher itself does no I/O; it takes a
// parsed envelope + a connection context and dispatches to a
// registered handler. Vitest is the appropriate layer per ADR 0022.
//
// The connection-level integration (the full receive-parse-dispatch
// path through `app.injectWS`) lives in
// `tests/behavior/backend/ws-envelope.feature`.

import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WsEnvelope, WsEnvelopeUnion, WsMessageType } from '@a-conversa/shared-types';

import type { WsConnectionContext } from './connection.js';
import {
  formatUnknownTypeMessage,
  SAFE_UNKNOWN_TYPE_REGEX,
  WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE,
  WsDispatcher,
} from './dispatcher.js';

// Sample v4 UUIDs.
const MSG_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

// Minimal stub for the per-connection context. The dispatcher
// reads `connectionId` off the context for logging AND calls
// `socket.send(wire)` from its default `onUnknownType` /
// `onHandlerError` seams (per `ws_error_message`). The stub captures
// every send-call in a per-test array so the wire-format error
// envelope can be asserted against.
interface StubConnection extends WsConnectionContext {
  sends: string[];
}

function stubConnection(id: string = CONNECTION_ID): StubConnection {
  const sends: string[] = [];
  const socket = {
    send(wire: string): void {
      sends.push(wire);
    },
  };
  return {
    connectionId: id,
    sends,
    // Cast: the stub `socket` exposes only `.send(string)` — enough
    // for the dispatcher's default seams to reach. The cucumber
    // integration drives a real WS socket end-to-end.
    socket: socket as unknown as WsConnectionContext['socket'],
  };
}

// Minimal FastifyBaseLogger stub — pino's interface but with vi.fn()
// spies on the methods we assert against. `as unknown as
// FastifyBaseLogger` is the canonical narrow-cast pattern for
// constructing test-only loggers whose surface is wider than what we
// implement.
interface StubLogger {
  log: FastifyBaseLogger;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
}

function stubLogger(): StubLogger {
  const warn = vi.fn();
  const error = vi.fn();
  const info = vi.fn();
  const debug = vi.fn();
  const trace = vi.fn();
  const fatal = vi.fn();
  const log = {
    warn,
    error,
    info,
    debug,
    trace,
    fatal,
    silent: vi.fn(),
    level: 'info',
    child: vi.fn(),
  } as unknown as FastifyBaseLogger;
  return { log, warn, error, info, debug, trace, fatal };
}

describe('WsDispatcher', () => {
  let dispatcher: WsDispatcher;
  let logger: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logger = stubLogger();
    dispatcher = new WsDispatcher(logger.log);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs a registered handler with the typed envelope and connection', async () => {
    const handler = vi.fn(async () => {});
    dispatcher.register('hello', handler);

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(envelope, conn);
  });

  it('logs at warn level and sends an `unknown-message-type` error envelope when no handler is registered', async () => {
    // `hello` is in the closed type enum but no handler has been
    // registered — exercises the unknown-handler path. Per
    // `ws_error_message`, the default `onUnknownType` now logs AND
    // sends a canonical `error` envelope on the socket with
    // `code: 'unknown-message-type'` and `inResponseTo = envelope.id`.
    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [meta, message] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(meta.connectionId).toBe(CONNECTION_ID);
    expect(meta.messageId).toBe(MSG_ID);
    expect(meta.messageType).toBe('hello');
    expect(message).toMatch(/unknown-message-type/);
    // No throw — the dispatcher swallows.
    expect(logger.error).not.toHaveBeenCalled();

    // The wire-format error envelope was sent on the connection's
    // socket. Per `ws_error_message`'s canonical shape:
    //   - `type: 'error'`
    //   - `id` is a fresh v4 UUID minted by `buildWsErrorEnvelope`
    //   - `inResponseTo` echoes the originating envelope's `id`
    //   - `payload.code: 'unknown-message-type'`
    expect(conn.sends).toHaveLength(1);
    const wire = JSON.parse(conn.sends[0] as string) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    expect(wire.type).toBe('error');
    expect(wire.inResponseTo).toBe(MSG_ID);
    expect(wire.payload?.code).toBe('unknown-message-type');
    expect(typeof wire.payload?.message).toBe('string');
  });

  // --- G-008 / s_to_c_type_rejection_pin -------------------------
  //
  // Pins that every server→client-only `WsMessageType` is rejected
  // with `unknown-message-type` when sent as a C→S frame. The closed
  // `WsMessageType` enum carries both directions in a single
  // discriminator (the three-group layout documented in
  // `packages/shared-types/src/ws-envelope.ts`):
  //
  //   - Group A — server-emitted unsolicited frames: `hello`,
  //     `event-applied`, `error`, `diagnostic`, `proposal-status`.
  //   - Group B — client→server requests: `subscribe`, `unsubscribe`,
  //     `propose`, `vote`, `commit`, `mark-meta-disagreement`,
  //     `snapshot`, `catch-up`. (Excluded from this test — these have
  //     real handlers and are exercised by per-handler tests.)
  //   - Group C — server-emitted ack/result frames correlated via
  //     `inResponseTo`: `subscribed`, `unsubscribed`, `proposed`,
  //     `voted`, `committed`, `meta-disagreement-marked`,
  //     `snapshot-state`, `caught-up`.
  //
  // Today the rejection is implicit (no handler registered → the
  // `onUnknownType` seam fires). This test makes it explicit so a
  // future task that accidentally registers a handler for an S→C type
  // (e.g. typo'ing `'committed'` for `'commit'`, or auto-wiring the
  // dispatcher from the enum) trips the assertion at review time.
  //
  // Static array literal (not a runtime filter over `wsMessageTypes`)
  // is deliberate per the refinement decision: adding a new S→C type
  // to the shared-types enum requires consciously adding it here too —
  // the closed list is the audit trail.
  const S_TO_C_ONLY_TYPES = [
    // Group A — server-emitted unsolicited frames.
    'hello',
    'event-applied',
    'error',
    'diagnostic',
    'proposal-status',
    // Group C — server-emitted ack/result frames.
    'subscribed',
    'unsubscribed',
    'proposed',
    'voted',
    'committed',
    'meta-disagreement-marked',
    'snapshot-state',
    'caught-up',
  ] as const satisfies readonly WsMessageType[];

  it.each(S_TO_C_ONLY_TYPES)(
    'rejects a C→S frame typed as `%s` (S→C-only) with `unknown-message-type`',
    async (type) => {
      // The default dispatcher (built in beforeEach) has NO handlers
      // registered for this `type` — every S→C type is server-emitted
      // only and is intentionally never wired into the inbound
      // registry. The unknown-type seam must fire.
      //
      // The envelope's `payload` is a constant stub: the dispatcher's
      // `onUnknownType` seam does NOT introspect the payload (it
      // reaches for `envelope.type` and `envelope.id` only), so a
      // per-type-shaped payload would be ceremony without value. The
      // cast widens the stub to the per-type discriminated-union
      // shape so the static type system accepts the `dispatch` call.
      const envelope = {
        type,
        id: MSG_ID,
        payload: { stub: true },
      } as unknown as WsEnvelopeUnion;
      const conn = stubConnection();

      await dispatcher.dispatch(envelope, conn);

      // Wire-format error envelope: `type: 'error'`,
      // `inResponseTo = envelope.id`, `payload.code:
      // 'unknown-message-type'`. Same canonical shape the synthetic
      // unknown-type test above pins.
      expect(conn.sends).toHaveLength(1);
      const wire = JSON.parse(conn.sends[0] as string) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown };
      };
      expect(wire.type).toBe('error');
      expect(wire.inResponseTo).toBe(MSG_ID);
      expect(wire.payload?.code).toBe('unknown-message-type');

      // Structured warn log carries the raw `messageType` for operator
      // visibility (the same operator-only-detail pattern the
      // unknown-type test pins).
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [meta] = logger.warn.mock.calls[0] as [Record<string, unknown>];
      expect(meta.connectionId).toBe(CONNECTION_ID);
      expect(meta.messageId).toBe(MSG_ID);
      expect(meta.messageType).toBe(type);

      // Belt-and-suspenders — the handler-error path must NOT have
      // fired; this confirms the rejection came from the
      // `onUnknownType` seam (no handler registered) rather than from
      // a handler throwing.
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  // --- F-009 / wire_error_no_echo --------------------------------
  //
  // The unknown-type wire `message` must NOT echo the client-supplied
  // `type` verbatim. Per `wire_error_no_echo` the echo is gated
  // through `SAFE_UNKNOWN_TYPE_REGEX = /^[a-z][a-z0-9-]{0,32}$/`:
  //
  //   - Well-formed-but-unknown (typo, e.g. `subscriber` for
  //     `subscribe`): the wire message includes the value (debugging
  //     convenience).
  //   - Anything outside the regex (control chars, very long strings,
  //     HTML / quotes / NUL bytes): the wire message falls back to
  //     the generic literal `'unknown message type'`.
  //
  // These tests construct envelopes whose runtime `type` is NOT a
  // member of the closed `WsMessageType` enum. The parse path
  // (`parseWsEnvelope`) would reject these — but the dispatcher must
  // be robust on its own, both for defense-in-depth and because a
  // future widening of `wsMessageTypeSchema` (e.g. to a free-form
  // string for forward-compat) would let them through.
  //
  // The casts widen the typed envelope to a runtime-arbitrary `type`
  // so the test can drive the seam with values the static type
  // system would otherwise reject. Documented narrow-cast pattern —
  // we're exercising the helper's runtime contract, not its
  // type-level contract.
  function envelopeWithRawType(type: unknown): WsEnvelopeUnion {
    return {
      type,
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    } as unknown as WsEnvelopeUnion;
  }

  it('pins the SAFE_UNKNOWN_TYPE_REGEX literal so any drift forces a refinement update', () => {
    // The regex IS the security boundary — the refinement document
    // calls it out by value. A future contributor relaxing the
    // pattern (adding `_` or removing the leading-letter anchor)
    // breaks this test and forces them to update both the test and
    // the refinement at once.
    expect(SAFE_UNKNOWN_TYPE_REGEX.source).toBe('^[a-z][a-z0-9-]{0,32}$');
  });

  it('echoes a well-formed-but-unknown `type` in the wire message (debugging-friendly path)', async () => {
    // Client typo: `subscriber` for `subscribe`. Matches the regex
    // (lowercase kebab, <= 33 chars), so the echo is allowed.
    const envelope = envelopeWithRawType('subscriber');
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(conn.sends).toHaveLength(1);
    const wire = JSON.parse(conn.sends[0] as string) as {
      payload?: { code?: unknown; message?: unknown };
    };
    expect(wire.payload?.code).toBe('unknown-message-type');
    expect(wire.payload?.message).toBe(`${WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE}: subscriber`);
  });

  it('drops control characters from the wire message (NUL / CR / LF / tab not echoed)', async () => {
    // A `type` peppered with control characters fails the regex
    // (none of `\0`, `\r`, `\n`, `\t` match `[a-z0-9-]`). The wire
    // message falls back to the generic literal.
    const evil = 'sub scribe\r\n\tINJECT';
    const envelope = envelopeWithRawType(evil);
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(conn.sends).toHaveLength(1);
    const raw = conn.sends[0] as string;
    const wire = JSON.parse(raw) as { payload?: { code?: unknown; message?: unknown } };
    expect(wire.payload?.code).toBe('unknown-message-type');
    expect(wire.payload?.message).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    // Defense-in-depth assertion — even the JSON-escaped serialised
    // wire string must not carry the raw control sequences or the
    // `INJECT` payload that travelled with them.
    expect(raw).not.toMatch(/INJECT/);
    expect(raw).not.toMatch(/\\u0000/);
    expect(raw).not.toMatch(/\\r\\n/);
  });

  it('drops a 5000-character `type` from the wire message (length guard)', async () => {
    // A 5000-char `type` exceeds the regex's 33-char ceiling. The
    // serialised wire must NOT carry the long string.
    const long = 'a'.repeat(5000);
    const envelope = envelopeWithRawType(long);
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(conn.sends).toHaveLength(1);
    const raw = conn.sends[0] as string;
    const wire = JSON.parse(raw) as { payload?: { message?: unknown } };
    expect(wire.payload?.message).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    // The wire frame must be vastly shorter than the input — pin
    // a cheap upper bound so any future regression (echoing the
    // attacker-controlled string back) trips immediately.
    expect(raw.length).toBeLessThan(500);
    expect(raw).not.toMatch(/a{100,}/);
  });

  it('drops HTML / quotes / NUL bytes from the wire message (no XSS / log-injection vector)', async () => {
    // The canonical reflected-input attack shapes: HTML tags, quote
    // characters, and a NUL byte mid-string. None of `<>"'\0` are
    // in the regex's allowed set, so the wire falls back.
    const evil = '<script>alert("xss")</script> ';
    const envelope = envelopeWithRawType(evil);
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(conn.sends).toHaveLength(1);
    const raw = conn.sends[0] as string;
    const wire = JSON.parse(raw) as { payload?: { message?: unknown } };
    expect(wire.payload?.message).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(raw).not.toMatch(/<script>/);
    expect(raw).not.toMatch(/alert/);
    expect(raw).not.toMatch(/xss/);
    expect(raw).not.toMatch(/\\u0000/);
  });

  it('still emits `unknown-message-type` code + `inResponseTo` correlation on the wire (regression)', async () => {
    // Belt-and-suspenders — even when the `type` is sanitized out
    // of the wire `message`, the envelope's `code` and
    // `inResponseTo` are unchanged. Clients branching on the typed
    // `code` still get the discriminator; the correlation back to
    // the originating envelope's `id` is preserved.
    const envelope = envelopeWithRawType('completely-garbage\r\n\t ');
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(conn.sends).toHaveLength(1);
    const wire = JSON.parse(conn.sends[0] as string) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown };
    };
    expect(wire.type).toBe('error');
    expect(wire.payload?.code).toBe('unknown-message-type');
    expect(wire.inResponseTo).toBe(MSG_ID);
  });

  // --- formatUnknownTypeMessage unit coverage --------------------
  //
  // Pure-helper tests. The regex IS the security boundary; pinning
  // its surface separately (in addition to the integration tests
  // above) keeps the unit-level contract auditable in one spot.

  it('formatUnknownTypeMessage echoes safe kebab-case strings', () => {
    expect(formatUnknownTypeMessage('subscribe')).toBe(
      `${WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE}: subscribe`,
    );
    expect(formatUnknownTypeMessage('a')).toBe(`${WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE}: a`);
    expect(formatUnknownTypeMessage('meta-disagreement-marked')).toBe(
      `${WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE}: meta-disagreement-marked`,
    );
    expect(formatUnknownTypeMessage('a-1-b-2')).toBe(
      `${WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE}: a-1-b-2`,
    );
  });

  it('formatUnknownTypeMessage falls back to the generic literal on unsafe inputs', () => {
    // Leading digit / mixed case / underscore / space / dot —
    // all outside the regex.
    expect(formatUnknownTypeMessage('1leading-digit')).toBe(
      WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE,
    );
    expect(formatUnknownTypeMessage('MixedCase')).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage('snake_case')).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage('with space')).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage('with.dot')).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage('')).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage('a'.repeat(34))).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
  });

  it('formatUnknownTypeMessage rejects non-string inputs (number / null / undefined / object)', () => {
    // `envelope.type` is statically a string union, but the parse
    // path crosses a JSON boundary — defense-in-depth assertion
    // that the helper does not throw on non-string runtime values.
    expect(formatUnknownTypeMessage(123)).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage(null)).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage(undefined)).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
    expect(formatUnknownTypeMessage({ malicious: true })).toBe(
      WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE,
    );
    expect(formatUnknownTypeMessage([])).toBe(WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE);
  });

  it('invokes the onUnknownType seam when set instead of the default warn', async () => {
    const onUnknownType = vi.fn();
    dispatcher = new WsDispatcher(logger.log, { onUnknownType });

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(onUnknownType).toHaveBeenCalledTimes(1);
    expect(onUnknownType).toHaveBeenCalledWith(envelope, conn);
    // The seam replaces the default; the default warn must NOT also fire.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('catches handler-thrown generic errors and emits the no-leak `internal-error` envelope', async () => {
    // No-leak rule (per `ws_error_message`): a non-`ApiError` thrown
    // value never has its `message` echoed to the client. The wire
    // envelope carries the generic literal `code: 'internal-error'`
    // and `message: 'internal error'`; the underlying error is logged
    // server-side at error level only.
    const handler = vi.fn(() => {
      // Synchronous throw with a "secret" detail the client must NOT
      // see — a stand-in for a programmer error / DB column name /
      // hostname / etc.
      throw new Error('SELECT failed near column host_user_id');
    });
    dispatcher.register('hello', handler);

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    // Must not throw — the dispatcher catches.
    await expect(dispatcher.dispatch(envelope, conn)).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [meta] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(meta.connectionId).toBe(CONNECTION_ID);
    expect(meta.messageId).toBe(MSG_ID);
    expect(meta.messageType).toBe('hello');
    // The full error is logged server-side — operator visibility.
    expect((meta.err as Error).message).toBe('SELECT failed near column host_user_id');

    // The wire envelope must NOT leak the underlying message.
    expect(conn.sends).toHaveLength(1);
    const wire = JSON.parse(conn.sends[0] as string) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    expect(wire.type).toBe('error');
    expect(wire.inResponseTo).toBe(MSG_ID);
    expect(wire.payload?.code).toBe('internal-error');
    expect(wire.payload?.message).toBe('internal error');
    // Crucial — the leaky detail must not appear on the wire.
    expect(conn.sends[0]).not.toMatch(/host_user_id/);
    expect(conn.sends[0]).not.toMatch(/SELECT failed/);
  });

  it('echoes `ApiError`-shaped throws via the wire envelope (code + message)', async () => {
    // The duck-typed `ApiError`-shape branch. Methodology rejections
    // (and explicit `ApiError.notFound(...)` throws) carry a safe
    // `code` + `message` the handler chose; the wire envelope echoes
    // them verbatim so the client can branch on the typed code and
    // surface the chosen message.
    // A real `ApiError` instance from `errors.ts` IS an Error subclass
    // with `code` + `message` fields — the canonical shape the
    // duck-typed `isApiErrorShape` check accepts. We construct a stub
    // Error subclass here so eslint's `only-throw-error` is satisfied
    // without importing the full `ApiError` class (the dispatcher's
    // discrimination is structural; the test exercises that contract).
    class StubApiError extends Error {
      readonly code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    }
    const apiErrorShape = new StubApiError(
      'forbidden',
      'you are not a participant of this session',
    );
    const handler = vi.fn(() => {
      throw apiErrorShape;
    });
    dispatcher.register('hello', handler);

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(conn.sends).toHaveLength(1);
    const wire = JSON.parse(conn.sends[0] as string) as {
      type?: unknown;
      inResponseTo?: unknown;
      payload?: { code?: unknown; message?: unknown };
    };
    expect(wire.type).toBe('error');
    expect(wire.inResponseTo).toBe(MSG_ID);
    expect(wire.payload?.code).toBe('forbidden');
    expect(wire.payload?.message).toBe('you are not a participant of this session');
  });

  it('catches handler-rejected promises and emits the wire error envelope', async () => {
    const handler = vi.fn(async () => Promise.reject(new Error('handler-async-failure')));
    dispatcher.register('hello', handler);

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [meta] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect((meta.err as Error).message).toBe('handler-async-failure');
    // The rejected-promise path follows the same no-leak rule —
    // generic literal on the wire, full error in the server log.
    expect(conn.sends).toHaveLength(1);
    const wire = JSON.parse(conn.sends[0] as string) as {
      payload?: { code?: unknown; message?: unknown };
    };
    expect(wire.payload?.code).toBe('internal-error');
    expect(wire.payload?.message).toBe('internal error');
  });

  it('invokes the onHandlerError seam when set instead of the default error log', async () => {
    const onHandlerError = vi.fn();
    dispatcher = new WsDispatcher(logger.log, { onHandlerError });

    const error = new Error('seam-test');
    // Sync throw inside a `() => Promise<void>` is type-compatible
    // (`never` is assignable to `Promise<void>`) and avoids the
    // `async`-without-`await` lint rule. The dispatcher's try/catch
    // routes the thrown value through the `onHandlerError` seam.
    dispatcher.register('hello', () => {
      throw error;
    });

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    const conn = stubConnection();

    await dispatcher.dispatch(envelope, conn);

    expect(onHandlerError).toHaveBeenCalledTimes(1);
    expect(onHandlerError).toHaveBeenCalledWith(error, envelope, conn);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('replaces an already-registered handler when register is called twice', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    dispatcher.register('hello', first);
    dispatcher.register('hello', second);

    const envelope: WsEnvelope<'hello'> = {
      type: 'hello',
      id: MSG_ID,
      payload: { connectionId: CONNECTION_ID },
    };
    await dispatcher.dispatch(envelope, stubConnection());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
