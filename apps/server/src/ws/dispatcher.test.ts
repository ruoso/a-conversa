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

import type { WsEnvelope } from '@a-conversa/shared-types';

import type { WsConnectionContext } from './connection.js';
import { WsDispatcher } from './dispatcher.js';

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
