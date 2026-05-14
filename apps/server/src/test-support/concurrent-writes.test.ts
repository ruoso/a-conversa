// @vitest-environment node
//
// Concurrent-write scenario tests against the production WS + HTTP
// write handlers, driven through the `makeConcurrentWritePool` harness.
//
// Refinement: tasks/refinements/backend-hardening/concurrent_write_test_harness.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.concurrency_safety.concurrent_write_test_harness
//
// **What this file covers.** Three scenarios drawn from the G-004 +
// G-018 inventory:
//
//   1. Two concurrent `propose` envelopes for the same session →
//      exactly one `proposed` ack lands; the other surfaces
//      `sequence-mismatch`.
//   2. Two concurrent `POST /sessions/:id/participants` requests for
//      the same role slot → exactly one 200 with the participant row;
//      the other 409 `role-already-filled`.
//   3. Two concurrent `POST /sessions/:id/end` for the same session →
//      exactly one 200 with the ended session; the other 409
//      `session-already-ended`.
//
// **Determinism mechanism.** Every scenario interleaves via the
// harness's gate API: the first writer's `INSERT INTO session_events`
// is paused mid-transaction (lock still held); the second writer
// attempts the FOR UPDATE and blocks behind the first; the test then
// releases the gate, letting the first commit; the second unblocks,
// re-reads MAX(sequence), and the optimistic-concurrency check (or
// the partial-unique pre-check, or the `ended_at IS NOT NULL` short-
// circuit) trips. No `setTimeout`, no timing assumptions.

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../auth/session-token.js';
import { __buildTestSessionsApp } from '../sessions/routes.js';
import { __buildTestWsApp } from '../ws/connection.js';

import {
  makeConcurrentWritePool,
  type ConcurrentWriteHarness,
  type HarnessStore,
} from './concurrent-write-pool.js';

const TEST_SECRET = 'concurrent-writes-test-secret';

const ALICE_ID = '00000000-0000-4000-8000-00000000a001';
const BEN_ID = '00000000-0000-4000-8000-00000000a002';
const SESSION_ID = '00000000-0000-4000-8000-00000000a003';
const NODE_ID = '00000000-0000-4000-8000-00000000a004';

function seededHarness(): ConcurrentWriteHarness {
  // Seed: a public session hosted by Alice, with Alice already joined
  // as moderator; Ben is a known user who can be assigned as debater-A.
  // A node-created event at sequence 3 gives the propose handler a
  // target to annotate. After seeding the events table has 3 rows;
  // MAX(sequence) = 3.
  return makeConcurrentWritePool({
    initial: {
      users: [
        { id: ALICE_ID, screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, screen_name: 'ben', deleted_at: null },
      ],
      sessions: [
        {
          id: SESSION_ID,
          host_user_id: ALICE_ID,
          privacy: 'public',
          topic: 'concurrent-writes scenario',
          created_at: new Date('2026-05-11T10:00:00.000Z'),
          ended_at: null,
        },
      ],
      participants: [
        {
          id: '00000000-0000-4000-9000-000000000001',
          session_id: SESSION_ID,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-11T10:00:00.500Z'),
          left_at: null,
        },
      ],
      events: [
        {
          id: '00000000-0000-4000-8000-0000000000e1',
          session_id: SESSION_ID,
          sequence: 1,
          kind: 'session-created',
          actor: ALICE_ID,
          payload: {
            host_user_id: ALICE_ID,
            privacy: 'public',
            topic: 'concurrent-writes scenario',
            created_at: '2026-05-11T10:00:00.000Z',
          },
          created_at: new Date('2026-05-11T10:00:00.000Z'),
        },
        {
          id: '00000000-0000-4000-8000-0000000000e2',
          session_id: SESSION_ID,
          sequence: 2,
          kind: 'participant-joined',
          actor: ALICE_ID,
          payload: {
            user_id: ALICE_ID,
            role: 'moderator',
            screen_name: 'alice',
            joined_at: '2026-05-11T10:00:00.500Z',
          },
          created_at: new Date('2026-05-11T10:00:00.500Z'),
        },
        {
          id: '00000000-0000-4000-8000-0000000000e3',
          session_id: SESSION_ID,
          sequence: 3,
          kind: 'node-created',
          actor: ALICE_ID,
          payload: {
            node_id: NODE_ID,
            wording: 'A target node for the propose race.',
            created_by: ALICE_ID,
            created_at: '2026-05-11T10:00:01.000Z',
          },
          created_at: new Date('2026-05-11T10:00:01.000Z'),
        },
      ],
    },
  });
}

// ---- WS client plumbing ---------------------------------------------
//
// Mirrors the pre-attach pattern from `ws/handlers/propose.test.ts`:
// install a `message` listener via `onInit` so server-initiated frames
// don't race the test's reader.

type WsLike = {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
};

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

interface OpenedWs {
  ws: WsLike;
  next: () => Promise<string>;
}

async function openWsClient(app: FastifyInstance, cookie: string): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;

  const ws = await app.injectWS(
    '/ws',
    { headers: { cookie } },
    {
      onInit(client: unknown) {
        const wsClient = client as WsLike;
        wsClient.on('message', (data: unknown) => {
          const text = toUtf8(data);
          if (waiter) {
            const w = waiter;
            waiter = null;
            w(text);
          } else {
            queue.push(text);
          }
        });
      },
    },
  );

  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiter = resolve;
    });

  return { ws, next };
}

interface ParsedFrame extends Record<string, unknown> {
  type?: string;
  inResponseTo?: string;
  payload?: Record<string, unknown>;
}

/**
 * Read frames until one matching `id === envelopeId` AND
 * `type IN expectedTypes` arrives. Drains broadcast frames (e.g.
 * `event-applied`, `proposal-status`) and `hello` greetings without
 * counting them; returns the first ack frame that correlates back to
 * the request. Cap at 12 frames to keep a misbehaving test loud.
 */
async function readResponseFor(
  next: () => Promise<string>,
  envelopeId: string,
  expectedTypes: ReadonlyArray<string>,
): Promise<ParsedFrame> {
  for (let i = 0; i < 12; i++) {
    const raw = await next();
    const parsed = JSON.parse(raw) as ParsedFrame;
    if (parsed.inResponseTo === envelopeId && expectedTypes.includes(parsed.type ?? '')) {
      return parsed;
    }
  }
  throw new Error(
    `readResponseFor: no frame of types [${expectedTypes.join(',')}] correlating to ${envelopeId} within 12 reads`,
  );
}

function annotateProposeFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  targetNodeId: string,
): string {
  return JSON.stringify({
    type: 'propose',
    id: messageId,
    payload: {
      sessionId,
      expectedSequence,
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: targetNodeId,
        annotation_kind: 'note',
        content: 'A note attached during the concurrent-write race.',
      },
    },
  });
}

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

// ---- Scenario 1: concurrent propose ---------------------------------

describe('concurrent writes — propose (WS)', () => {
  let teardown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (teardown !== undefined) {
      await teardown();
      teardown = undefined;
    }
  });

  it('two concurrent propose envelopes for the same session → exactly one proposed; the other sequence-mismatch', async () => {
    const harness = seededHarness();
    const app = await __buildTestWsApp({
      pool: harness.pool,
      sessionTokenSecret: TEST_SECRET,
    });
    teardown = async (): Promise<void> => {
      await app.close();
    };

    const cookie = `${SESSION_COOKIE_NAME}=${await signSessionToken({ sub: ALICE_ID }, TEST_SECRET)}`;

    // Open two WS clients on independent connections. Both subscribe
    // to the same session.
    const a = await openWsClient(app, cookie);
    const b = await openWsClient(app, cookie);
    try {
      await a.next(); // drain `hello`
      await b.next();

      const SUBSCRIBE_A_ID = '11111111-1111-4111-8111-111111111111';
      const SUBSCRIBE_B_ID = '11111111-1111-4111-8111-111111111112';
      a.ws.send(subscribeFrame(SUBSCRIBE_A_ID, SESSION_ID));
      b.ws.send(subscribeFrame(SUBSCRIBE_B_ID, SESSION_ID));
      const subAckA = await readResponseFor(a.next, SUBSCRIBE_A_ID, ['subscribed']);
      const subAckB = await readResponseFor(b.next, SUBSCRIBE_B_ID, ['subscribed']);
      expect(subAckA.type).toBe('subscribed');
      expect(subAckB.type).toBe('subscribed');

      // Install the gate FIRST so writer A's INSERT will pause when
      // it arrives. expectedSequence is 3 for both (seeded MAX).
      const gate = harness.gateOnInsert(SESSION_ID);

      const PROPOSE_A_ID = '22222222-2222-4222-8222-22222222a001';
      const PROPOSE_B_ID = '22222222-2222-4222-8222-22222222a002';

      // Send A first — its propose handler will start a transaction,
      // acquire FOR UPDATE on the session row, read MAX=3, build the
      // engine action, validate, and reach INSERT. The INSERT pauses
      // at the gate.
      a.ws.send(annotateProposeFrame(PROPOSE_A_ID, SESSION_ID, 3, NODE_ID));
      await gate.whenHit;

      // Now send B. Its propose handler hits the FOR UPDATE and
      // blocks behind A's still-held lock.
      b.ws.send(annotateProposeFrame(PROPOSE_B_ID, SESSION_ID, 3, NODE_ID));
      await harness.untilWaitingForLock();

      // Release A — its INSERT completes, transaction commits, lock
      // releases. B unblocks, re-reads MAX(sequence) (now 4), runs
      // the optimistic-concurrency check against its
      // expectedSequence=3, and surfaces `sequence-mismatch`.
      gate.release();

      const ackA = await readResponseFor(a.next, PROPOSE_A_ID, ['proposed', 'error']);
      const ackB = await readResponseFor(b.next, PROPOSE_B_ID, ['proposed', 'error']);

      // Exactly one `proposed` and one `error`.
      const results = [ackA, ackB];
      const proposed = results.filter((r) => r.type === 'proposed');
      const errored = results.filter((r) => r.type === 'error');
      expect(proposed).toHaveLength(1);
      expect(errored).toHaveLength(1);

      // The errored one carries `sequence-mismatch` (the FOR UPDATE-
      // serialised path; the optimistic-concurrency check trips
      // before the INSERT is even attempted).
      expect(errored[0]?.payload?.['code']).toBe('sequence-mismatch');

      // Exactly one new event appended at sequence 4.
      const newEvents = harness.store.events.filter((e) => e.sequence === 4);
      expect(newEvents).toHaveLength(1);
      expect(newEvents[0]?.kind).toBe('proposal');
    } finally {
      a.ws.terminate();
      b.ws.terminate();
    }
  });
});

// ---- Scenario 2: concurrent participant assignment ------------------

describe('concurrent writes — participant assign (HTTP)', () => {
  let teardown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (teardown !== undefined) {
      await teardown();
      teardown = undefined;
    }
  });

  it('two concurrent POST /sessions/:id/participants for the same role → exactly one 200; the other 409 role-already-filled', async () => {
    const harness = seededHarness();
    // Seed Ben + a second candidate (Cara) so both racing requests
    // have a valid userId. The race is over the ROLE slot (debater-A),
    // not the user — both requests target the SAME role with
    // DIFFERENT users so the partial-unique-index on (session_id,
    // role) is the contention point. The losing request gets
    // `role-already-filled` (not `user-already-joined`).
    const CARA_ID = '00000000-0000-4000-8000-00000000a005';
    harness.store.users.push({ id: CARA_ID, screen_name: 'cara', deleted_at: null });

    const app = await __buildTestSessionsApp({
      pool: harness.pool,
      sessionTokenSecret: TEST_SECRET,
    });
    teardown = async (): Promise<void> => {
      await app.close();
    };

    const aliceCookie = `${SESSION_COOKIE_NAME}=${await signSessionToken({ sub: ALICE_ID }, TEST_SECRET)}`;

    const gate = harness.gateOnInsert(SESSION_ID);

    // Send request A — assigns Ben to debater-A. Pauses at the INSERT
    // INTO session_events gate (after the participants INSERT
    // completed inside the same transaction).
    const reqA = app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/participants`,
      headers: { cookie: aliceCookie },
      payload: { userId: BEN_ID, role: 'debater-A' },
    });

    await gate.whenHit;

    // Send request B — tries to assign Cara to debater-A.
    // Blocks at the FOR UPDATE on the session row.
    const reqB = app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/participants`,
      headers: { cookie: aliceCookie },
      payload: { userId: CARA_ID, role: 'debater-A' },
    });

    await harness.untilWaitingForLock();

    // Release A — its INSERT lands, transaction commits, lock
    // releases. B unblocks, re-runs the role-availability pre-check,
    // finds the now-active debater-A row, and surfaces
    // `role-already-filled`.
    gate.release();

    const [resA, resB] = await Promise.all([reqA, reqB]);

    const results = [resA, resB];
    const successes = results.filter((r) => r.statusCode === 200);
    const conflicts = results.filter((r) => r.statusCode === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const conflictBody = conflicts[0]?.json<{ error?: { code?: string } }>();
    expect(conflictBody?.error?.code).toBe('role-already-filled');

    // Exactly one new debater-A participant.
    const debaters = harness.store.participants.filter(
      (sp) => sp.role === 'debater-A' && sp.left_at === null,
    );
    expect(debaters).toHaveLength(1);
  });
});

// ---- Scenario 3: concurrent end-session -----------------------------

describe('concurrent writes — end-session (HTTP)', () => {
  let teardown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (teardown !== undefined) {
      await teardown();
      teardown = undefined;
    }
  });

  it('two concurrent POST /sessions/:id/end → exactly one 200 ending the session; the other 409 session-already-ended', async () => {
    const harness = seededHarness();
    const app = await __buildTestSessionsApp({
      pool: harness.pool,
      sessionTokenSecret: TEST_SECRET,
    });
    teardown = async (): Promise<void> => {
      await app.close();
    };

    const aliceCookie = `${SESSION_COOKIE_NAME}=${await signSessionToken({ sub: ALICE_ID }, TEST_SECRET)}`;

    const gate = harness.gateOnInsert(SESSION_ID);

    // Race two end-session requests as the same authority (the host).
    // The FOR UPDATE + ended_at-NOT-NULL gate is the contention point.
    const reqA = app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/end`,
      headers: { cookie: aliceCookie },
    });

    await gate.whenHit;

    const reqB = app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/end`,
      headers: { cookie: aliceCookie },
    });

    await harness.untilWaitingForLock();

    gate.release();

    const [resA, resB] = await Promise.all([reqA, reqB]);
    const results = [resA, resB];
    const successes = results.filter((r) => r.statusCode === 200);
    const conflicts = results.filter((r) => r.statusCode === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const conflictBody = conflicts[0]?.json<{ error?: { code?: string } }>();
    expect(conflictBody?.error?.code).toBe('session-already-ended');

    // Exactly one session-ended event.
    const endedEvents = harness.store.events.filter((e) => e.kind === 'session-ended');
    expect(endedEvents).toHaveLength(1);
  });
});

// `HarnessStore` is intentionally typed-but-unused above to keep the
// import surface honest — every test reads `harness.store` not the
// type directly. Re-exporting prevents an unused-import lint.
export type { HarnessStore };
