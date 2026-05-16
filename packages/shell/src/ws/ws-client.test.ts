// Smoke tests for the shell's WebSocket client.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Ported from `apps/moderator/src/ws/client.test.ts`. The behaviors
// covered are identical; the only difference is that the shell's client
// takes the store as an injected parameter rather than importing one
// statically. Tests construct a fresh `createDefaultWsStore()` per case
// and pass it to `createWsClient({ store })`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeWsEnvelope, type WsEnvelopeUnion } from '@a-conversa/shared-types';
import type { UseBoundStore, StoreApi } from 'zustand';

import { createWsClient, WsRequestError, WsRequestTimeoutError, type WsLike } from './client.js';
import { createDefaultWsStore } from './defaultStore.js';
import type { BaseWsStoreState } from './store-contract.js';

// ───────────────────────────────────────────────────────────────────────
// Mock WebSocket implementation.
// ───────────────────────────────────────────────────────────────────────

class FakeSocket implements WsLike {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = 0;
  onopen: ((this: WsLike, ev: Event) => unknown) | null = null;
  onclose: ((this: WsLike, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WsLike, ev: Event) => unknown) | null = null;
  onmessage: ((this: WsLike, ev: MessageEvent<string>) => unknown) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.call(this, { code, reason } as unknown as CloseEvent);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.call(this, {} as Event);
  }

  remoteClose(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.call(this, {} as CloseEvent);
  }

  receive(envelope: WsEnvelopeUnion): void {
    const text = serializeWsEnvelope(envelope);
    this.receiveRaw(text);
  }

  receiveRaw(text: string): void {
    this.onmessage?.call(this, { data: text } as MessageEvent<string>);
  }
}

interface Harness {
  sockets: FakeSocket[];
  ids: string[];
  scheduled: Array<{ cb: () => void; delay: number; cancelled: boolean }>;
  nextId: () => string;
  factory: (url: string) => WsLike;
  schedule: (cb: () => void, delay: number) => unknown;
  cancel: (handle: unknown) => void;
  runDueAt: (cap: number) => void;
  store: UseBoundStore<StoreApi<BaseWsStoreState>>;
}

function makeHarness(ids: string[]): Harness {
  const sockets: FakeSocket[] = [];
  const scheduled: Array<{ cb: () => void; delay: number; cancelled: boolean }> = [];
  let idCursor = 0;
  return {
    sockets,
    ids,
    scheduled,
    nextId: () => {
      const id = ids[idCursor] ?? `id-fallback-${idCursor.toString()}`;
      idCursor += 1;
      return id;
    },
    factory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    schedule: (cb, delay) => {
      const entry = { cb, delay, cancelled: false };
      scheduled.push(entry);
      return entry;
    },
    cancel: (handle) => {
      const entry = handle as { cancelled: boolean };
      entry.cancelled = true;
    },
    runDueAt: (cap) => {
      for (const entry of scheduled) {
        if (!entry.cancelled && entry.delay <= cap) {
          entry.cancelled = true;
          entry.cb();
        }
      }
    },
    store: createDefaultWsStore(),
  };
}

const HELLO: WsEnvelopeUnion = {
  type: 'hello',
  id: '00000000-0000-4000-8000-00000000aaaa',
  payload: { connectionId: '00000000-0000-4000-8000-000000000c01' },
};

const SESSION_A = '00000000-0000-4000-8000-000000000001';
const SESSION_B = '00000000-0000-4000-8000-000000000002';

// Note: each harness owns its own store, so no global reset is needed
// between cases — but a belt-and-suspenders cleanup keeps a misbehaving
// case from leaking into the next.
let activeHarness: Harness | undefined;

beforeEach(() => {
  activeHarness = undefined;
});

afterEach(() => {
  activeHarness?.store.getState().reset();
  activeHarness = undefined;
});

function newClient(
  harness: Harness,
  extra: Record<string, unknown> = {},
): ReturnType<typeof createWsClient> {
  activeHarness = harness;
  return createWsClient({
    makeSocket: harness.factory,
    randomId: harness.nextId,
    scheduleTimeout: harness.schedule,
    cancelTimeout: harness.cancel,
    store: harness.store,
    ...extra,
  });
}

describe('createWsClient — connect + hello', () => {
  it('opens a socket on connect() and flips status to "connecting" then "open"', () => {
    const harness = makeHarness(['00000000-0000-4000-8000-000000001001']);
    const client = newClient(harness, { url: '/api/ws' });
    expect(client.status()).toBe('idle');
    client.connect();
    expect(client.status()).toBe('connecting');
    expect(harness.sockets).toHaveLength(1);
    harness.sockets[0]!.open();
    expect(client.status()).toBe('open');
    expect(harness.store.getState().connectionStatus).toBe('open');
  });

  it('records the connectionId from the hello envelope into the store', () => {
    const harness = makeHarness(['00000000-0000-4000-8000-000000001002']);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);
    expect(harness.store.getState().connectionId).toBe('00000000-0000-4000-8000-000000000c01');
  });

  it('connect() is idempotent — re-calling while open does not open a second socket', () => {
    const harness = makeHarness([]);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    client.connect();
    expect(harness.sockets).toHaveLength(1);
  });
});

describe('send — correlation + acks', () => {
  it('serializes via shared-types and resolves on a matching inResponseTo ack', async () => {
    const ids = ['00000000-0000-4000-8000-000000001003'];
    const harness = makeHarness(ids);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const pending = client.send('subscribe', { sessionId: SESSION_A });
    expect(harness.sockets[0]!.sent).toHaveLength(1);
    const sentEnvelope = JSON.parse(harness.sockets[0]!.sent[0]!) as WsEnvelopeUnion;
    expect(sentEnvelope.type).toBe('subscribe');
    expect(sentEnvelope.id).toBe(ids[0]);
    expect(sentEnvelope.payload).toEqual({ sessionId: SESSION_A });

    harness.sockets[0]!.receive({
      type: 'subscribed',
      id: '00000000-0000-4000-8000-0000000ac001',
      inResponseTo: ids[0]!,
      payload: { sessionId: SESSION_A },
    });
    const ack = await pending;
    expect(ack.type).toBe('subscribed');
    expect(ack.inResponseTo).toBe(ids[0]);
  });

  it('rejects with WsRequestError when the server replies with a correlated error envelope', async () => {
    const ids = ['00000000-0000-4000-8000-000000001004'];
    const harness = makeHarness(ids);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const pending = client.send('subscribe', { sessionId: SESSION_A });
    harness.sockets[0]!.receive({
      type: 'error',
      id: '00000000-0000-4000-8000-00000000eee1',
      inResponseTo: ids[0]!,
      payload: { code: 'not-found', message: 'session not found' },
    });
    await expect(pending).rejects.toBeInstanceOf(WsRequestError);
    await expect(pending).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects with WsRequestTimeoutError when no ack arrives before the timeout fires', async () => {
    const ids = ['00000000-0000-4000-8000-000000001005'];
    const harness = makeHarness(ids);
    const client = newClient(harness, { defaultTimeoutMs: 1000 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const pending = client.send('subscribe', { sessionId: SESSION_A });
    harness.runDueAt(1000);
    await expect(pending).rejects.toBeInstanceOf(WsRequestTimeoutError);
  });

  it('rejects send() when the socket is not open', async () => {
    const harness = makeHarness([]);
    const client = newClient(harness);
    await expect(client.send('subscribe', { sessionId: SESSION_A })).rejects.toThrow(/not open/);
  });
});

describe('inbound dispatch — store writes', () => {
  it('event-applied envelopes write into the store and dedupe by sequence', () => {
    const harness = makeHarness([]);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const eventEnvelope = (sequence: number, id: string): WsEnvelopeUnion => ({
      type: 'event-applied',
      id: '00000000-0000-4000-8000-0000000ee001',
      payload: {
        event: {
          id,
          sessionId: SESSION_A,
          sequence,
          kind: 'participant-left',
          actor: '00000000-0000-4000-8000-0000000000aa',
          payload: {
            user_id: '00000000-0000-4000-8000-0000000000aa',
            left_at: '2026-05-11T00:00:00.000Z',
          },
          createdAt: '2026-05-11T00:00:00.000Z',
        },
      },
    });

    harness.sockets[0]!.receive(eventEnvelope(1, '00000000-0000-4000-8000-0000000ee101'));
    harness.sockets[0]!.receive(eventEnvelope(2, '00000000-0000-4000-8000-0000000ee102'));
    harness.sockets[0]!.receive(eventEnvelope(1, '00000000-0000-4000-8000-0000000ee101'));
    harness.sockets[0]!.receive(eventEnvelope(3, '00000000-0000-4000-8000-0000000ee103'));

    const sessionState = harness.store.getState().sessionState[SESSION_A];
    expect(sessionState).toBeDefined();
    expect(sessionState!.lastAppliedSequence).toBe(3);
    expect(sessionState!.events).toHaveLength(3);
    expect(sessionState!.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('snapshot-state envelopes advance the per-session high-water mark', () => {
    const harness = makeHarness([]);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    harness.sockets[0]!.receive({
      type: 'snapshot-state',
      id: '00000000-0000-4000-8000-00000000baaa',
      payload: { sessionId: SESSION_A, sequence: 42, projection: { whatever: true } },
    });
    expect(harness.store.getState().sessionState[SESSION_A]?.lastAppliedSequence).toBe(42);
  });

  it('proposal-status + diagnostic envelopes are recorded into per-session state', () => {
    const harness = makeHarness([]);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    harness.sockets[0]!.receive({
      type: 'proposal-status',
      id: '00000000-0000-4000-8000-0000000abcde',
      payload: {
        sessionId: SESSION_A,
        proposalId: '00000000-0000-4000-8000-0000000aabbb',
        sequence: 5,
        perFacetStatus: { substance: 'proposed' },
      },
    });
    harness.sockets[0]!.receive({
      type: 'diagnostic',
      id: '00000000-0000-4000-8000-0000000aacde',
      payload: {
        sessionId: SESSION_A,
        kind: 'cycle',
        severity: 'blocking',
        status: 'fired',
        sequence: 5,
        diagnostic: { affectedNodes: ['n1', 'n2'] },
      },
    });

    const sessionState = harness.store.getState().sessionState[SESSION_A];
    expect(sessionState?.pendingProposals['00000000-0000-4000-8000-0000000aabbb']).toBeDefined();
    expect(sessionState?.lastDiagnostic?.kind).toBe('cycle');
  });

  it('records an unsolicited error envelope into store.lastError', () => {
    const harness = makeHarness([]);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    harness.sockets[0]!.receive({
      type: 'error',
      id: '00000000-0000-4000-8000-00000000eee2',
      payload: { code: 'internal-error', message: 'oh no' },
    });
    expect(harness.store.getState().lastError?.code).toBe('internal-error');
  });

  it('drops malformed inbound frames without closing the connection', () => {
    const harness = makeHarness([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    harness.sockets[0]!.receiveRaw('{not-valid-json');
    harness.sockets[0]!.receiveRaw('{"type":"hello"}');
    expect(client.status()).toBe('open');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('invokes external onEnvelope handlers for every inbound envelope', () => {
    const harness = makeHarness([]);
    const seen: string[] = [];
    const client = newClient(harness, {
      onEnvelope: (envelope: WsEnvelopeUnion) => {
        seen.push(envelope.type);
      },
    });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);
    expect(seen).toEqual(['hello']);
  });
});

describe('reconnection + catch-up', () => {
  it('schedules a reconnect with backoff after a non-explicit close', () => {
    const harness = makeHarness([]);
    const client = newClient(harness, { initialBackoffMs: 100, maxBackoffMs: 5000 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    harness.sockets[0]!.remoteClose();
    expect(client.status()).toBe('reconnecting');
    const due = harness.scheduled.filter((s) => !s.cancelled);
    expect(due[due.length - 1]!.delay).toBe(100);
  });

  it('re-opens the socket when the reconnect-timer fires', () => {
    const harness = makeHarness([]);
    const client = newClient(harness, { initialBackoffMs: 100 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);
    harness.sockets[0]!.remoteClose();

    expect(harness.sockets).toHaveLength(1);
    harness.runDueAt(200);
    expect(harness.sockets).toHaveLength(2);
  });

  it('explicit close() suppresses reconnect', () => {
    const harness = makeHarness([]);
    const client = newClient(harness, { initialBackoffMs: 100 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    client.close();
    expect(client.status()).toBe('closed');
    const pending = harness.scheduled.filter((s) => !s.cancelled);
    expect(pending).toHaveLength(0);
  });

  it('on reconnect, re-subscribes + issues catch-up for every tracked session', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000001100',
      '00000000-0000-4000-8000-000000001101',
      '00000000-0000-4000-8000-000000001200',
      '00000000-0000-4000-8000-000000001201',
    ];
    const harness = makeHarness(ids);
    const client = newClient(harness, { initialBackoffMs: 50 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const tracking = client.trackSession(SESSION_A);
    harness.sockets[0]!.receive({
      type: 'subscribed',
      id: '00000000-0000-4000-8000-0000000ac001',
      inResponseTo: ids[0]!,
      payload: { sessionId: SESSION_A },
    });
    await Promise.resolve();
    await Promise.resolve();
    harness.sockets[0]!.receive({
      type: 'caught-up',
      id: '00000000-0000-4000-8000-0000000ac002',
      inResponseTo: ids[1]!,
      payload: { sessionId: SESSION_A, throughSequence: 0, eventCount: 0, fromSnapshot: false },
    });
    await tracking;

    harness.sockets[0]!.remoteClose();
    expect(harness.store.getState().subscriptions.has(SESSION_A)).toBe(true);
    harness.runDueAt(60);
    expect(harness.sockets).toHaveLength(2);
    harness.sockets[1]!.open();
    harness.sockets[1]!.receive(HELLO);
    await Promise.resolve();
    harness.sockets[1]!.receive({
      type: 'subscribed',
      id: '00000000-0000-4000-8000-0000000ac003',
      inResponseTo: ids[2]!,
      payload: { sessionId: SESSION_A },
    });
    await Promise.resolve();
    await Promise.resolve();
    const sent = harness.sockets[1]!.sent.map((s) => JSON.parse(s) as WsEnvelopeUnion);
    expect(sent[0]?.type).toBe('subscribe');
    expect(sent[0]?.payload).toEqual({ sessionId: SESSION_A });
    expect(sent[1]?.type).toBe('catch-up');
    expect(sent[1]?.payload).toMatchObject({ sessionId: SESSION_A, sinceSequence: 0 });
  });

  it('hello receipt resets backoffAttempt — successive disconnects start at the floor', () => {
    const harness = makeHarness([]);
    const client = newClient(harness, { initialBackoffMs: 100, maxBackoffMs: 10_000 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);
    harness.sockets[0]!.remoteClose();
    let lastDue = harness.scheduled.filter((s) => !s.cancelled).at(-1)!;
    expect(lastDue.delay).toBe(100);
    harness.runDueAt(150);
    harness.sockets[1]!.open();
    harness.sockets[1]!.receive(HELLO);
    harness.sockets[1]!.remoteClose();
    lastDue = harness.scheduled.filter((s) => !s.cancelled).at(-1)!;
    expect(lastDue.delay).toBe(100);
  });

  it('successive failed attempts (no hello) escalate the backoff', () => {
    const harness = makeHarness([]);
    const client = newClient(harness, { initialBackoffMs: 100, maxBackoffMs: 1000 });
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.remoteClose();
    let lastDelay = harness.scheduled.filter((s) => !s.cancelled).at(-1)!.delay;
    expect(lastDelay).toBe(100);
    harness.runDueAt(150);
    harness.sockets[1]!.open();
    harness.sockets[1]!.remoteClose();
    lastDelay = harness.scheduled.filter((s) => !s.cancelled).at(-1)!.delay;
    expect(lastDelay).toBe(200);
    harness.runDueAt(250);
    harness.sockets[2]!.open();
    harness.sockets[2]!.remoteClose();
    lastDelay = harness.scheduled.filter((s) => !s.cancelled).at(-1)!.delay;
    expect(lastDelay).toBe(400);
  });
});

describe('trackSession / untrackSession', () => {
  it('trackSession populates the store resume list and (when open) sends subscribe + catch-up', async () => {
    const ids = ['00000000-0000-4000-8000-000000001300', '00000000-0000-4000-8000-000000001301'];
    const harness = makeHarness(ids);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const tracking = client.trackSession(SESSION_B);
    harness.sockets[0]!.receive({
      type: 'subscribed',
      id: '00000000-0000-4000-8000-0000000ac004',
      inResponseTo: ids[0]!,
      payload: { sessionId: SESSION_B },
    });
    await Promise.resolve();
    await Promise.resolve();
    harness.sockets[0]!.receive({
      type: 'caught-up',
      id: '00000000-0000-4000-8000-0000000ac005',
      inResponseTo: ids[1]!,
      payload: { sessionId: SESSION_B, throughSequence: 0, eventCount: 0, fromSnapshot: false },
    });
    await tracking;
    expect(harness.store.getState().subscriptions.has(SESSION_B)).toBe(true);
    const types = harness.sockets[0]!.sent.map((s) => (JSON.parse(s) as WsEnvelopeUnion).type);
    expect(types).toEqual(['subscribe', 'catch-up']);
  });

  it('trackSession is idempotent — re-tracking the same session is a no-op', async () => {
    const ids = ['00000000-0000-4000-8000-000000001400', '00000000-0000-4000-8000-000000001401'];
    const harness = makeHarness(ids);
    const client = newClient(harness);
    client.connect();
    harness.sockets[0]!.open();
    harness.sockets[0]!.receive(HELLO);

    const first = client.trackSession(SESSION_A);
    harness.sockets[0]!.receive({
      type: 'subscribed',
      id: '00000000-0000-4000-8000-0000000ac006',
      inResponseTo: ids[0]!,
      payload: { sessionId: SESSION_A },
    });
    await Promise.resolve();
    await Promise.resolve();
    harness.sockets[0]!.receive({
      type: 'caught-up',
      id: '00000000-0000-4000-8000-0000000ac007',
      inResponseTo: ids[1]!,
      payload: { sessionId: SESSION_A, throughSequence: 0, eventCount: 0, fromSnapshot: false },
    });
    await first;
    const sentBefore = harness.sockets[0]!.sent.length;
    await client.trackSession(SESSION_A);
    expect(harness.sockets[0]!.sent.length).toBe(sentBefore);
  });
});
