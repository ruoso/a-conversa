// `createWsClient` — the shell-supplied typed WebSocket client.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"WsStore extraction shape" — option C, the client is
//   parameterized over a `WsStoreLike<BaseWsStoreState>` handle).
// Canonical wire spec: docs/ws-protocol.md
// Schema source of truth: packages/shared-types/src/ws-envelope.ts
//
// Hoisted from `apps/moderator/src/ws/client.ts`. Two changes from the
// moderator-side version:
//   1. The hard import of `./wsStore.js` is replaced with a `store:
//      WsStoreLike<BaseWsStoreState>` option. The moderator passes its
//      richer `useWsStore`; the shell's default ships in `./defaultStore.ts`.
//   2. The default for `store` is `createDefaultWsStore()` so callers
//      that don't need projection-specific extensions get a working
//      client out of the box.
//
// Responsibilities are otherwise identical to the moderator-side version:
// open one `/ws` connection, serialize via `serializeWsEnvelope`, parse
// via `parseWsEnvelopeJson`, correlate request/response via in-memory
// pending map, dispatch inbound envelopes into the store, reconnect on
// close with exponential backoff, resume tracked subscriptions on hello.
//
// The two test seams the moderator's client carries — `makeSocket`
// factory injection and per-test `scheduleTimeout`/`cancelTimeout`
// overrides — survive verbatim. The shell's test suite uses them; the
// moderator's existing test infrastructure (which migrated here)
// continues to use them too.

import {
  parseWsEnvelopeJson,
  serializeWsEnvelope,
  WsEnvelopeValidationError,
  type ErrorPayload,
  type WsEnvelopeUnion,
  type WsMessagePayloadMap,
  type WsMessageType,
} from '@a-conversa/shared-types';

import { createDefaultWsStore } from './defaultStore.js';
import type { BaseWsStoreState, WsStoreLike } from './store-contract.js';

/**
 * Per-call config for `send`. `timeoutMs` overrides the client-default
 * (10s). `signal` lets callers abort a pending request from React
 * effect-cleanups.
 */
export interface SendOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The minimal interface the client needs from a WebSocket-like object.
 * Matches the platform `WebSocket` API; mock implementations in tests
 * implement this directly.
 */
export interface WsLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((this: WsLike, ev: Event) => unknown) | null;
  onclose: ((this: WsLike, ev: CloseEvent) => unknown) | null;
  onerror: ((this: WsLike, ev: Event) => unknown) | null;
  onmessage: ((this: WsLike, ev: MessageEvent<string>) => unknown) | null;
}

/** Factory injection for tests. Production passes `(url) => new WebSocket(url)`. */
export type WsFactory = (url: string) => WsLike;

/**
 * Client-internal status. Mirrors the value the store publishes via
 * `store.getState().connectionStatus`.
 */
export type WsClientStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Public envelope-dispatch callback shape. */
export type EnvelopeHandler = (envelope: WsEnvelopeUnion) => void;

/**
 * Configuration for the WS client. `url` defaults to `/ws`
 * (same-origin); tests override `makeSocket` + `randomId` + scheduling
 * hooks to drive the reconnect schedule deterministically.
 */
export interface CreateWsClientOptions {
  url?: string;
  makeSocket?: WsFactory;
  randomId?: () => string;
  /** Per-request timeout in ms. Default 10_000. */
  defaultTimeoutMs?: number;
  /** Initial backoff in ms. Default 250. */
  initialBackoffMs?: number;
  /** Backoff ceiling in ms. Default 30_000. */
  maxBackoffMs?: number;
  /** Whether reconnect-on-close is enabled. Default `true`. */
  autoReconnect?: boolean;
  /** Setter for the inbound-envelope dispatch fanout. */
  onEnvelope?: EnvelopeHandler;
  /** Notifier for status transitions. */
  onStatusChange?: (status: WsClientStatus) => void;
  /** Test seam: schedule a delayed callback. Defaults to `setTimeout`. */
  scheduleTimeout?: (cb: () => void, delayMs: number) => unknown;
  /** Test seam: cancel a previously scheduled callback. Defaults to `clearTimeout`. */
  cancelTimeout?: (handle: unknown) => void;
  /**
   * Store handle the client dispatches into. Defaults to a fresh
   * `createDefaultWsStore()` if not supplied. The moderator passes its
   * `useWsStore` (which extends `BaseWsStoreState`); future surfaces
   * supply their own.
   */
  store?: WsStoreLike<BaseWsStoreState>;
}

/**
 * Typed C→S send: `send('subscribe', { sessionId })` resolves with the
 * correlated `subscribed` ack envelope (or rejects with the wire error
 * payload + a `timeout` if no ack arrives within the configured window).
 */
export type SendFn = <T extends WsMessageType>(
  type: T,
  payload: WsMessagePayloadMap[T],
  options?: SendOptions,
) => Promise<WsEnvelopeUnion>;

export interface WsClient {
  /** Current connection status. */
  readonly status: () => WsClientStatus;
  /** Open the connection. Idempotent — already-open is a no-op. */
  connect: () => void;
  /** Close the connection. Suppresses auto-reconnect. */
  close: (code?: number, reason?: string) => void;
  /** Issue a typed C→S request. */
  send: SendFn;
  /**
   * Track a `sessionId` as one the consumer wants to follow. Sends
   * `subscribe` + `catch-up` immediately (if the socket is open) and on
   * every future reconnect.
   */
  trackSession: (sessionId: string) => Promise<void>;
  /** Drop a tracked session and send `unsubscribe`. */
  untrackSession: (sessionId: string) => Promise<void>;
  /** Register an inbound-envelope callback. Returns an unsubscribe fn. */
  onEnvelope: (handler: EnvelopeHandler) => () => void;
  /** For tests: the URL the client was configured with. */
  readonly url: string;
}

/**
 * Wire error shape thrown when a correlated `error` envelope rejects a
 * pending request.
 */
export class WsRequestError extends Error {
  override readonly name = 'WsRequestError';
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.code = payload.code;
    this.details = payload.details;
  }
}

/** Thrown by `send` when the pending request times out. */
export class WsRequestTimeoutError extends Error {
  override readonly name = 'WsRequestTimeoutError';
  readonly type: WsMessageType;
  readonly id: string;
  constructor(type: WsMessageType, id: string) {
    super(`ws request ${type}:${id} timed out`);
    this.type = type;
    this.id = id;
  }
}

interface PendingRequest {
  readonly type: WsMessageType;
  readonly resolve: (envelope: WsEnvelopeUnion) => void;
  readonly reject: (err: Error) => void;
  readonly timeoutHandle: unknown;
}

const DEFAULT_URL = '/api/ws';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INITIAL_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
/** Browser `WebSocket.OPEN` readyState constant. */
const WS_OPEN = 1;

function nativeRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without `crypto.randomUUID` — should never
  // hit in a modern browser, but happy-dom in older Node versions might.
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

function defaultMakeSocket(url: string): WsLike {
  // The cast is the runtime bridge from the lib.dom `WebSocket` type to our
  // narrowed `WsLike` interface. The shape matches exactly.
  return new WebSocket(url) as unknown as WsLike;
}

/**
 * Construct a WS client. The client is inert until `connect()` is
 * called; the provider component (`WsClientProvider.tsx`) owns when
 * that happens (post-auth).
 */
export function createWsClient(options: CreateWsClientOptions = {}): WsClient {
  const {
    url = DEFAULT_URL,
    makeSocket = defaultMakeSocket,
    randomId = nativeRandomId,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    autoReconnect = true,
    onEnvelope: externalDispatch,
    onStatusChange,
    scheduleTimeout = (cb, delay) => setTimeout(cb, delay),
    cancelTimeout = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    store = createDefaultWsStore(),
  } = options;

  let socket: WsLike | undefined;
  let status: WsClientStatus = 'idle';
  let backoffAttempt = 0;
  let reconnectHandle: unknown;
  let explicitlyClosed = false;
  const pending = new Map<string, PendingRequest>();
  const externalHandlers = new Set<EnvelopeHandler>();
  if (externalDispatch) externalHandlers.add(externalDispatch);

  /**
   * Default-bridge to the injected store. The client always dispatches
   * into the store; the optional `onEnvelope` callback fires AFTER store
   * writes so subscribers see the post-write state.
   */
  function dispatchToStore(envelope: WsEnvelopeUnion): void {
    const s = store.getState();
    switch (envelope.type) {
      case 'hello':
        s.setConnectionId(envelope.payload.connectionId);
        return;
      case 'event-applied':
        s.applyEvent(envelope.payload.event);
        return;
      case 'snapshot-state':
        s.applySnapshot(envelope.payload.sessionId, envelope.payload.sequence);
        return;
      case 'proposal-status':
        s.applyProposalStatus(envelope.payload);
        return;
      case 'diagnostic':
        s.applyDiagnostic(envelope.payload);
        return;
      case 'error':
        if (envelope.inResponseTo === undefined) {
          // Only un-correlated errors land in the slice; correlated
          // errors reject the originating send-promise and the caller
          // decides how to surface them.
          s.recordError(envelope.payload);
        }
        return;
      default:
        // Acks/results (`subscribed`, `proposed`, etc.) are correlated
        // to a pending request and resolved at the call site; no store
        // write required here.
        return;
    }
  }

  function setStatus(next: WsClientStatus): void {
    if (status === next) return;
    status = next;
    store.getState().setConnectionStatus(next);
    onStatusChange?.(next);
  }

  function emitEnvelope(envelope: WsEnvelopeUnion): void {
    if (envelope.type === 'hello') {
      // Receipt of a hello means the server accepted us; clear the
      // backoff counter so a future disconnect starts at the floor again.
      backoffAttempt = 0;
    }
    dispatchToStore(envelope);
    for (const handler of externalHandlers) {
      try {
        handler(envelope);
      } catch (err) {
        // External-handler bugs must not break the receive loop.
        console.warn('ws: onEnvelope handler threw', err);
      }
    }
    if (envelope.type === 'hello') {
      // Resume tracked subscriptions AFTER the hello fanned out so the
      // store has the connectionId populated. The send path checks
      // `socket.readyState === OPEN` so this is safe even if a handler
      // synchronously triggers a close.
      resumeSubscriptions();
    }
  }

  function resolvePending(envelope: WsEnvelopeUnion): boolean {
    const id = envelope.inResponseTo;
    if (id === undefined) return false;
    const entry = pending.get(id);
    if (entry === undefined) return false;
    cancelTimeout(entry.timeoutHandle);
    pending.delete(id);
    if (envelope.type === 'error') {
      entry.reject(new WsRequestError(envelope.payload));
    } else {
      entry.resolve(envelope);
    }
    return true;
  }

  function rejectAllPending(reason: Error): void {
    for (const entry of pending.values()) {
      cancelTimeout(entry.timeoutHandle);
      entry.reject(reason);
    }
    pending.clear();
  }

  function nextBackoffMs(): number {
    // 250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, …
    const raw = initialBackoffMs * 2 ** backoffAttempt;
    return Math.min(raw, maxBackoffMs);
  }

  function scheduleReconnect(): void {
    if (!autoReconnect || explicitlyClosed) return;
    const delay = nextBackoffMs();
    backoffAttempt += 1;
    setStatus('reconnecting');
    reconnectHandle = scheduleTimeout(() => {
      reconnectHandle = undefined;
      openSocket();
    }, delay);
  }

  function clearScheduledReconnect(): void {
    if (reconnectHandle !== undefined) {
      cancelTimeout(reconnectHandle);
      reconnectHandle = undefined;
    }
  }

  function handleMessage(text: string): void {
    let envelope: WsEnvelopeUnion;
    try {
      envelope = parseWsEnvelopeJson(text);
    } catch (err) {
      if (err instanceof WsEnvelopeValidationError) {
        console.warn('ws: dropping malformed inbound frame', err.message);
        return;
      }
      throw err;
    }
    // Resolve any matching pending request first so the consumer's
    // promise sees the result before the broader fan-out.
    resolvePending(envelope);
    emitEnvelope(envelope);
  }

  function resumeSubscriptions(): void {
    const state = store.getState();
    for (const sessionId of state.subscriptions) {
      const session = state.sessionState[sessionId];
      const sinceSequence = session?.lastAppliedSequence ?? 0;
      // Fire-and-forget. The receive loop dispatches the resulting frames
      // into the store; a rejection here is logged but doesn't tear down
      // the connection.
      void send('subscribe', { sessionId }).then(
        () => send('catch-up', { sessionId, sinceSequence }),
        (err: unknown) => {
          console.warn('ws: subscribe-resume failed', sessionId, err);
        },
      );
    }
  }

  function attachSocket(s: WsLike): void {
    socket = s;
    s.onopen = (): void => {
      // The TCP/HTTP upgrade is up; we wait for the server's `hello`
      // envelope to consider the connection fully ready, but the
      // outward-facing status flips to `'open'` now so `send()` can
      // start dispatching.
      setStatus('open');
    };
    s.onclose = (): void => {
      socket = undefined;
      rejectAllPending(new Error('ws connection closed'));
      if (explicitlyClosed) {
        setStatus('closed');
        return;
      }
      scheduleReconnect();
    };
    s.onerror = (): void => {
      // Browser WS errors are intentionally opaque (no error code). The
      // close handler fires immediately after; nothing useful to do here.
    };
    s.onmessage = (ev): void => {
      const data = ev.data;
      if (typeof data === 'string') {
        handleMessage(data);
      }
      // Binary frames are not part of the protocol — drop silently.
    };
  }

  function openSocket(): void {
    if (explicitlyClosed) return;
    setStatus(status === 'reconnecting' ? 'reconnecting' : 'connecting');
    const s = makeSocket(url);
    attachSocket(s);
  }

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
    sendOptions: SendOptions = {},
  ): Promise<WsEnvelopeUnion> => {
    return new Promise<WsEnvelopeUnion>((resolve, reject) => {
      if (sendOptions.signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      if (socket === undefined || socket.readyState !== WS_OPEN) {
        reject(new Error(`cannot send ${type}: socket not open (status=${status})`));
        return;
      }
      const id = randomId();
      const envelope = { type, id, payload } as WsEnvelopeUnion;
      let text: string;
      try {
        text = serializeWsEnvelope(envelope);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const timeoutMs = sendOptions.timeoutMs ?? defaultTimeoutMs;
      const timeoutHandle = scheduleTimeout(() => {
        if (pending.delete(id)) {
          reject(new WsRequestTimeoutError(type, id));
        }
      }, timeoutMs);
      const entry: PendingRequest = { type, resolve, reject, timeoutHandle };
      pending.set(id, entry);
      sendOptions.signal?.addEventListener('abort', () => {
        if (pending.delete(id)) {
          cancelTimeout(timeoutHandle);
          reject(new Error('aborted'));
        }
      });
      try {
        socket.send(text);
      } catch (err) {
        if (pending.delete(id)) {
          cancelTimeout(timeoutHandle);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  };

  async function trackSession(sessionId: string): Promise<void> {
    const newlyTracked = store.getState().trackSubscription(sessionId);
    if (!newlyTracked) return;
    if (socket?.readyState === WS_OPEN && status === 'open') {
      const session = store.getState().sessionState[sessionId];
      const sinceSequence = session?.lastAppliedSequence ?? 0;
      await send('subscribe', { sessionId });
      await send('catch-up', { sessionId, sinceSequence });
    }
    // If the socket isn't open yet, the hello-driven resume path will
    // pick this session up automatically once the upgrade completes.
  }

  async function untrackSession(sessionId: string): Promise<void> {
    store.getState().untrackSubscription(sessionId);
    if (socket?.readyState === WS_OPEN && status === 'open') {
      try {
        await send('unsubscribe', { sessionId });
      } catch (err) {
        // The server is best-effort about unsubscribe acks. We logged
        // intent already; failure here is recoverable.
        console.warn('ws: unsubscribe ack failed', sessionId, err);
      }
    }
  }

  function connect(): void {
    if (status === 'open' || status === 'connecting') return;
    explicitlyClosed = false;
    backoffAttempt = 0;
    openSocket();
  }

  function close(code?: number, reason?: string): void {
    explicitlyClosed = true;
    clearScheduledReconnect();
    rejectAllPending(new Error('ws client closed'));
    if (socket !== undefined) {
      try {
        socket.close(code, reason);
      } catch {
        // ignore — close on already-closed socket is a no-op
      }
      socket = undefined;
    }
    setStatus('closed');
  }

  function onEnvelopeHandler(handler: EnvelopeHandler): () => void {
    externalHandlers.add(handler);
    return (): void => {
      externalHandlers.delete(handler);
    };
  }

  return {
    status: (): WsClientStatus => status,
    connect,
    close,
    send,
    trackSession,
    untrackSession,
    onEnvelope: onEnvelopeHandler,
    url,
  };
}
