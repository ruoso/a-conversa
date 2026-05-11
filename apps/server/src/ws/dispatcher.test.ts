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

// Minimal stub for the per-connection context. The dispatcher only
// reads `connectionId` off the context for logging; the socket field
// is never touched by the dispatcher itself (handlers use it).
function stubConnection(id: string = CONNECTION_ID): WsConnectionContext {
  return {
    connectionId: id,
    // Cast: the dispatcher never touches this field. A null shim is
    // fine for unit tests; the cucumber integration drives a real
    // WS socket end-to-end.
    socket: null as unknown as WsConnectionContext['socket'],
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

  it('logs at warn level and returns when no handler is registered for the message type', async () => {
    // `hello` is in the closed type enum but no handler has been
    // registered — exercises the unknown-handler path. The cast
    // through `unknown` is the shape parseWsEnvelope would produce
    // when a downstream task adds a new `type` to the enum but no
    // handler has been wired yet.
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
    expect(message).toMatch(/no handler registered/);
    // No throw — the dispatcher swallows.
    expect(logger.error).not.toHaveBeenCalled();
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

  it('catches handler-thrown errors and logs them via the default onHandlerError', async () => {
    const handler = vi.fn(() => {
      // Synchronous throw inside an async-returning handler — exercises
      // the dispatcher's try/catch around the handler invocation. The
      // handler is typed as `() => Promise<void>`; `Promise.reject`
      // satisfies the return type without an unnecessary `async`
      // (`@typescript-eslint/require-await` would otherwise flag the
      // bare `async () => { throw ... }` form).
      throw new Error('handler-test-failure');
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
    expect((meta.err as Error).message).toBe('handler-test-failure');
  });

  it('catches handler-rejected promises and logs them via the default onHandlerError', async () => {
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
