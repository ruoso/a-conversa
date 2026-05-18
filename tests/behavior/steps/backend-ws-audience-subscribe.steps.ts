// Step definitions for tests/behavior/backend/ws-audience-subscribe.feature.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: audience.aud_shell.aud_ws_client
//
// **What this file owns.** The cucumber-layer regression net for the
// audience-role subscribe-only WS wire contract. The audience is
// functionally an authenticated WebSocket client that subscribes to a
// session and consumes broadcasts but does not send writes (the
// audience workspace's `apps/audience/src/ws/index.ts` barrel narrows
// the surface so audience UI code cannot reach the `send`-side
// hooks). The contract pinned end-to-end here is:
//
//   1. subscribe → ack — the audience-typed client can subscribe and
//      receives a `subscribed` ack (reuses existing steps).
//   2. subscribe → live broadcast — the audience-typed client receives
//      `event-applied` envelopes the server broadcasts (reuses
//      existing steps).
//   3. raw-send-propose → rejection — even if an audience-typed client
//      bypasses the TypeScript narrowing and raw-sends a `propose`
//      envelope, the server's participant gate fires (the
//      cucumber-world user is NOT a participant in the seeded
//      session) and the rejection envelope arrives with
//      `code: 'not-a-participant'` per `apps/server/src/errors.ts`'s
//      `rejectedToApiError` mapping.
//
// **Reuse.** The auth-gated WS app + cookie are owned by
// `backend-ws-auth.steps.ts`. The session-row Given is owned by
// `backend-ws-subscribe.steps.ts` (`a public session owned by {string}
// exists with id {string}`). The WS connect step is owned by
// `backend-ws-connection.steps.ts`. The subscribe envelope + ack steps
// are owned by `backend-ws-subscribe.steps.ts`. The broadcast emitter
// + the event-applied frame assertion are owned by
// `backend-ws-event-broadcast.steps.ts`. This file adds only the
// audience-specific verbs:
//
//   - The `Given a propose-ready session hosted by another user ...`
//     step — seeds a session row + a participant row for a NAMED OTHER
//     user (not the cucumber-world cookie user) + the
//     session-created / participant-joined / node-created seed events
//     so the propose at sequence 4 has a valid baseline AND the
//     cucumber-world user fails the engine's participant gate.
//   - The `When the audience-typed client raw-sends a propose envelope
//     ...` step — bypasses the audience workspace's TypeScript surface
//     narrowing by writing the literal `propose` envelope JSON to the
//     open WS connection. The audience workspace's barrel does not
//     re-export `send`, but the wire is still reachable; the server's
//     participant gate is what protects against rogue audience publish.
//   - The `Then the audience-typed client receives an audience-publish
//     rejection envelope` step — asserts the server emitted an
//     `error` envelope with `code: 'not-a-participant'`, referencing
//     the propose envelope's id. Per refinement Decision §8, the
//     scenario pins WHATEVER code the server actually returns; the
//     code lands here deterministically based on the rejection-reason
//     → wire-code mapping in `rejectedToApiError`.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { AConversaWorld, QueryResult } from '../support/world.js';

// Minimal structural typing for the WS client surface we touch (same
// idiom as `backend-ws-propose.steps.ts` etc.).
interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface AudienceScratch {
  wsLifecycleClient?: WsClient;
  wsAudienceProposeMessageId?: string;
  wsAudienceProposeFrames?: string[];
}

function scratch(world: AConversaWorld): AudienceScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as AudienceScratch;
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

function ensureAudienceProposeFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsAudienceProposeFrames === undefined) {
    s.wsAudienceProposeFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsAudienceProposeFrames?.push(toUtf8(data));
    });
  }
  return s.wsAudienceProposeFrames;
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
// Givens — seed a propose-ready session whose HOST is a different
// user than the cucumber-world cookie user. This is the load-bearing
// shape for the audience-publish-rejected scenario: the cucumber-
// world user IS authenticated + DOES subscribe (so the subscribe-
// before-act and visibility gates pass), but is NOT a participant
// (so the methodology engine's universal `not-a-participant` gate
// fires and produces the rejection wire envelope).
//
// Distinct from the existing `a propose-ready session for {string}
// exists with id {string} and node id {string}` step in
// `backend-ws-propose.steps.ts` (which adds the host as moderator
// participant — pinning that the host CAN propose). The audience
// scenario needs the opposite shape: a session whose host is some
// OTHER user, so the cucumber-world user is not a participant.
// ============================================================

Given(
  'a propose-ready session hosted by another user {string} exists with id {string} and node id {string} — the cucumber-world cookie user is NOT a participant',
  async function (this: AConversaWorld, hostScreenName: string, sessionId: string, nodeId: string) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      hostScreenName,
    ])) as QueryResult<{ id: string }>;
    const hostId = userRes.rows[0]?.id;
    assert.ok(hostId, `no users row found for screen_name ${hostScreenName}`);

    // Session row — public so the cucumber-world cookie user can see
    // it (and subscribe to it) without being a participant.
    await this.db.query(
      `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, 'public', $3)`,
      [sessionId, hostId, `Audience reject test (host=${hostScreenName})`],
    );

    // Participant row — host is moderator. The cucumber-world cookie
    // user is intentionally NOT inserted into session_participants
    // for this session, so the engine's `not-a-participant` gate
    // fires on a propose attempt.
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [sessionId, hostId],
    );

    // Seed events: session-created (seq 1) + participant-joined
    // (seq 2) + node-created (seq 3). Mirrors the seed-shape the
    // existing `a propose-ready session for {string} ...` Given
    // uses so the propose at seq 4 has a valid baseline. The
    // expected propose sequence (3 = MAX after the seed) is the
    // same shape `ws-propose.feature` uses.
    const t0 = '2026-05-18T10:00:00.000Z';
    const t1 = '2026-05-18T10:00:01.000Z';
    const t2 = '2026-05-18T10:00:02.000Z';
    const sessionCreatedId = randomUUID();
    const participantJoinedId = randomUUID();
    const nodeCreatedId = randomUUID();

    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 1, 'session-created', $3, $4::jsonb, $5)`,
      [
        sessionCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          host_user_id: hostId,
          privacy: 'public',
          topic: `Audience reject test (host=${hostScreenName})`,
          created_at: t0,
        }),
        t0,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 2, 'participant-joined', $3, $4::jsonb, $5)`,
      [
        participantJoinedId,
        sessionId,
        hostId,
        JSON.stringify({
          user_id: hostId,
          role: 'moderator',
          screen_name: hostScreenName,
          joined_at: t1,
        }),
        t1,
      ],
    );
    await this.db.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, 3, 'node-created', $3, $4::jsonb, $5)`,
      [
        nodeCreatedId,
        sessionId,
        hostId,
        JSON.stringify({
          node_id: nodeId,
          wording: 'A claim used as the propose target in the audience-reject scenario.',
          created_by: hostId,
          created_at: t2,
        }),
        t2,
      ],
    );
  },
);

// ============================================================
// Whens — raw-send a propose envelope on the open client. This step
// exists to make the test's intent unambiguous: the audience-typed
// client's TypeScript surface narrowing (Decision §6 of the
// refinement) does NOT expose `send`-side hooks; this step bypasses
// the narrowing by writing the literal envelope JSON to the open
// WebSocket. The server's participant gate is what protects against
// rogue audience publish.
// ============================================================

When(
  'the audience-typed client raw-sends a propose envelope for session {string} with expectedSequence {int} targeting node {string}',
  function (
    this: AConversaWorld,
    sessionId: string,
    expectedSequence: number,
    targetNodeId: string,
  ) {
    const s = scratch(this);
    const ws = getClient(this);
    const messageId = randomUUID();
    s.wsAudienceProposeMessageId = messageId;

    // Ensure the streaming frame queue is attached BEFORE the send so
    // the rejection envelope is captured.
    ensureAudienceProposeFramesQueue(this);

    ws.send(
      JSON.stringify({
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
            content: 'Audience-bypass annotation that the participant gate must reject.',
          },
        },
      }),
    );
  },
);

// ============================================================
// Thens — assert the audience-publish rejection envelope arrives.
//
// Per refinement Decision §8, the scenario pins WHATEVER code the
// server actually returns. The cucumber-world user IS subscribed
// (subscribe-before-act gate passes) and CAN see the public session
// (visibility gate passes), so the engine's universal
// `not-a-participant` gate is the one that fires, producing
// `code: 'not-a-participant'` via the `rejectedToApiError` mapping
// at `apps/server/src/errors.ts:159`.
// ============================================================

Then(
  'the audience-typed client receives an audience-publish rejection envelope',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const queue = ensureAudienceProposeFramesQueue(this);
    const err = await waitForFrame(queue, (parsed) => parsed.type === 'error');
    assert.ok(err, 'did not receive an `error` envelope within timeout');
    assert.equal(
      err.inResponseTo,
      s.wsAudienceProposeMessageId,
      `expected inResponseTo to match the propose envelope's id (${s.wsAudienceProposeMessageId})`,
    );
    const payload = err.payload as { code?: unknown; message?: unknown };
    assert.equal(
      payload.code,
      'not-a-participant',
      `expected wire code 'not-a-participant' (the engine's participant gate is the one that fires for a subscribed-but-not-a-participant user), got ${JSON.stringify(payload.code)}`,
    );
    assert.ok(
      typeof payload.message === 'string' && payload.message.length > 0,
      'expected payload.message to be a non-empty string',
    );
  },
);

// ============================================================
// Teardown — only the per-feature carriers; the lifecycle client +
// auth app are torn down by their owning step files (idempotent
// across step files).
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsAudienceProposeMessageId;
  delete s.wsAudienceProposeFrames;
});
