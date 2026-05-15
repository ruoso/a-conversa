// Step definitions for tests/behavior/backend/ws-catch-up.feature.
//
// Refinement: tasks/refinements/backend/ws_reconnection_handling.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_reconnection_handling
//
// **What this file owns.** The cucumber-layer regression net for the
// `catch-up` WS handler — exercises the full subscribe → catch-up →
// (slice replay | snapshot fallback) → caught-up path through the
// real `__buildTestWsApp` instance against pglite. The handler is
// **read-only** (no event append, no broadcast emit, no transaction)
// and implements Shape B (server-mediated catch-up with snapshot
// fallback); see the refinement Decisions for the choice rationale.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts` (this file adds a parametrized variant
// that injects the catch-up threshold). The WS client is owned by
// `backend-ws-connection.steps.ts`; the subscribe envelope is owned
// by `backend-ws-subscribe.steps.ts`; the `snapshot-ready` session
// seeder is owned by `backend-ws-snapshot.steps.ts` (we share the
// same fixture shape — 5 events with MAX(sequence)=5).
//
// This file adds only the catch-up-specific verbs:
//
//   1. `Given a ws-auth-gated server with catch-up threshold <n>` —
//      builds the same auth-gated test app `backend-ws-auth.steps.ts`
//      builds, but with the catch-up threshold injected so the
//      snapshot-fallback scenario can deterministically cross it.
//   2. `When the client sends a catch-up envelope for session
//      <id> with sinceSequence <n>` — sends a catch-up envelope on
//      the open client + captures inbound frames into a per-feature
//      queue.
//   3. `Then the client receives event-applied catch-up frames with
//      sequences <list>` — asserts the slice-replay path emits the
//      expected `event-applied` frames in order.
//   4. `Then the client receives a snapshot-state catch-up envelope
//      at sequence <n>` — asserts the snapshot-fallback path emits a
//      `snapshot-state` envelope with the expected sequence.
//   5. `Then the client receives a caught-up ack referencing the
//      catch-up envelope with throughSequence <n> eventCount <n>
//      fromSnapshot <bool>` — asserts the final ack shape +
//      `inResponseTo` correlation.
//   6. `Then the client receives an error envelope with code <code>
//      referencing the catch-up envelope` — asserts rejection paths
//      surface as canonical `error` envelopes.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import { __buildTestWsApp } from '../../../apps/server/src/ws/index.js';

import type { AConversaWorld } from '../support/world.js';

const TEST_SESSION_SECRET = 'test-session-secret';

interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface FastifyLike {
  injectWS(
    path?: string,
    upgradeContext?: { headers?: Record<string, string> },
    options?: { onInit?: (ws: WsClient) => void },
  ): Promise<WsClient>;
  close(): Promise<void>;
}

interface CatchUpScratch {
  // Carriers shared with `backend-ws-auth.steps.ts` /
  // `backend-ws-connection.steps.ts`.
  wsAuthApp?: FastifyLike;
  wsAuthCookie?: string;
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsCatchUpMessageId?: string;
  wsCatchUpFrames?: string[];
}

function scratch(world: AConversaWorld): CatchUpScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as CatchUpScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function getClient(world: AConversaWorld): WsClient {
  const ws = scratch(world).wsLifecycleClient;
  assert.ok(
    ws,
    'no ws client — the `an authenticated WebSocket client connects to "/api/ws"` When step must precede',
  );
  return ws;
}

function ensureCatchUpFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsCatchUpFrames === undefined) {
    s.wsCatchUpFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsCatchUpFrames?.push(toUtf8(data));
    });
  }
  return s.wsCatchUpFrames;
}

async function waitForFrame(
  queue: string[],
  predicate: (parsed: Record<string, unknown>) => boolean,
  timeoutMs = 1500,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = 0; i < queue.length; i++) {
      const raw = queue[i]!;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (predicate(parsed)) {
        queue.splice(i, 1);
        return parsed;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

// ============================================================
// Givens — parametrized variant of the ws-auth-gated server build that
// injects the catch-up threshold so the snapshot-fallback branch can
// be exercised deterministically.
// ============================================================

Given(
  'a ws-auth-gated server with catch-up threshold {int} is built against the pglite-backed pool',
  async function (this: AConversaWorld, threshold: number) {
    const s = scratch(this);
    // Same DbPool adapter the `backend-ws-auth.steps.ts` Given uses —
    // duplicated rather than imported because the pool adapter is a
    // single-method closure and sharing it across files would create
    // a circular dep through `world.scratch`.
    const dbHandle = this.db;
    const pool = {
      async query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
        return { rows: result.rows };
      },
    };
    const app = (await __buildTestWsApp({
      pool,
      sessionTokenSecret: TEST_SESSION_SECRET,
      catchUpMaxEvents: threshold,
    })) as unknown as FastifyLike;
    s.wsAuthApp = app;
  },
);

// ============================================================
// Whens — send a catch-up envelope on the open client.
// ============================================================

When(
  'the client sends a catch-up envelope for session {string} with sinceSequence {int}',
  function (this: AConversaWorld, sessionId: string, sinceSequence: number) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsCatchUpMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send.
    ensureCatchUpFramesQueue(this);

    ws.send(
      JSON.stringify({
        type: 'catch-up',
        id: messageId,
        payload: { sessionId, sinceSequence },
      }),
    );
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives event-applied catch-up frames with sequences {string}',
  async function (this: AConversaWorld, sequenceList: string) {
    const queue = ensureCatchUpFramesQueue(this);
    const expected = sequenceList
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map((s) => Number.parseInt(s, 10));
    const got: number[] = [];
    for (const expectedSeq of expected) {
      const frame = await waitForFrame(
        queue,
        (parsed) =>
          parsed.type === 'event-applied' &&
          (parsed.payload as { event?: { sequence?: unknown } }).event?.sequence === expectedSeq,
      );
      assert.ok(
        frame,
        `did not receive event-applied frame with sequence ${String(expectedSeq)} within timeout`,
      );
      const seq = (frame.payload as { event?: { sequence?: unknown } }).event?.sequence;
      got.push(seq as number);
      // Replay frames are unsolicited from the client's frame of
      // reference — the per-frame envelope MUST NOT carry
      // `inResponseTo`. The `caught-up` ack at the end carries the
      // correlation.
      assert.equal(
        frame.inResponseTo,
        undefined,
        `event-applied replay frame at seq ${String(seq)} unexpectedly carried inResponseTo`,
      );
    }
    assert.deepEqual(
      got,
      expected,
      `expected sequences ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
    );
  },
);

Then(
  'the client receives a snapshot-state catch-up envelope at sequence {int}',
  async function (this: AConversaWorld, expectedSeq: number) {
    const s = scratch(this);
    const queue = ensureCatchUpFramesQueue(this);
    const frame = await waitForFrame(queue, (parsed) => parsed.type === 'snapshot-state');
    assert.ok(frame, 'did not receive a `snapshot-state` envelope within timeout');
    assert.equal(
      frame.inResponseTo,
      s.wsCatchUpMessageId,
      `expected snapshot-state inResponseTo to match the catch-up envelope's id (${s.wsCatchUpMessageId})`,
    );
    const payload = frame.payload as {
      sessionId?: unknown;
      sequence?: unknown;
      projection?: unknown;
    };
    assert.equal(payload.sequence, expectedSeq);
    assert.ok(
      payload.projection !== null && typeof payload.projection === 'object',
      'expected snapshot-state payload.projection to be an object',
    );
  },
);

Then(
  'the client receives a caught-up ack referencing the catch-up envelope with throughSequence {int} eventCount {int} fromSnapshot {word}',
  async function (
    this: AConversaWorld,
    throughSequence: number,
    eventCount: number,
    fromSnapshotStr: string,
  ) {
    const s = scratch(this);
    const queue = ensureCatchUpFramesQueue(this);
    const ack = await waitForFrame(queue, (parsed) => parsed.type === 'caught-up');
    assert.ok(ack, 'did not receive a `caught-up` ack within timeout');
    assert.equal(
      ack.inResponseTo,
      s.wsCatchUpMessageId,
      `expected caught-up inResponseTo to match the catch-up envelope's id (${s.wsCatchUpMessageId})`,
    );
    const payload = ack.payload as {
      sessionId?: unknown;
      throughSequence?: unknown;
      eventCount?: unknown;
      fromSnapshot?: unknown;
    };
    assert.ok(
      typeof payload.sessionId === 'string' && payload.sessionId.length > 0,
      'expected caught-up payload.sessionId to be a non-empty string',
    );
    assert.equal(payload.throughSequence, throughSequence);
    assert.equal(payload.eventCount, eventCount);
    const expectedFromSnapshot = fromSnapshotStr === 'true';
    assert.equal(payload.fromSnapshot, expectedFromSnapshot);
  },
);

Then(
  'the client receives an error envelope with code {string} referencing the catch-up envelope',
  async function (this: AConversaWorld, expectedCode: string) {
    const s = scratch(this);
    const queue = ensureCatchUpFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, 'did not receive an `error` envelope within timeout');
    assert.equal(
      err.inResponseTo,
      s.wsCatchUpMessageId,
      `expected error inResponseTo to match the catch-up envelope's id (${s.wsCatchUpMessageId})`,
    );
    const payload = err.payload as { code?: unknown; message?: unknown };
    assert.equal(payload.code, expectedCode);
    assert.ok(
      typeof payload.message === 'string' && payload.message.length > 0,
      'expected error payload.message to be a non-empty string',
    );
  },
);

// ============================================================
// Teardown — only the per-feature carriers; the lifecycle client +
// auth app are torn down by their owning step files.
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsCatchUpMessageId;
  delete s.wsCatchUpFrames;
});
