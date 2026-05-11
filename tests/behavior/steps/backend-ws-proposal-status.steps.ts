// Step definitions for tests/behavior/backend/ws-proposal-status.feature.
//
// Refinement: tasks/refinements/backend/ws_proposal_status_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_proposal_status_broadcast
//
// **What this file owns.** The cucumber-layer regression net for the
// `proposal-status` derived broadcast surface — exercises the path
// from a vote / commit event-append all the way through the bus
// listener's projection-replay + facet-status derivation +
// per-connection fan-out, against the real DB via pglite.
//
// **Why we lean on the upstream step files.** The vote scenario
// pulls a vote-ready session via the `Given a vote-ready session ...`
// step from `backend-ws-vote.steps.ts`; the commit scenario pulls a
// commit-ready session via the `Given a commit-ready session ...`
// step from `backend-ws-commit.steps.ts`. Both auth, the first-client
// connect, the subscribe pair, and the second-client connect /
// subscribe are also reused from their owning step files. This file
// adds ONLY:
//
//   1. Streaming-listener attachment on both clients to capture the
//      `proposal-status` frames (the upstream files attach their own
//      per-feature carriers; this file's carrier is independent so a
//      proposal-status frame interleaved with an event-applied or
//      ack frame on the same socket is still readable here).
//   2. The receive-side Then steps — assert that a `proposal-status`
//      envelope for the expected `proposalId` + `sequence` arrives
//      with the expected `perFacetStatus[<facet>]` value.
//   3. A negative Then step pinning the filter invariant — for a
//      non-status-affecting event, no `proposal-status` envelope is
//      emitted within a short timeout.

import { After, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { AConversaWorld } from '../support/world.js';

interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

interface ProposalStatusScratch {
  // Shared with backend-ws-auth/backend-ws-connection step files.
  wsLifecycleClient?: WsClient;
  // Shared with the broadcast / propose step files — the second
  // client opens via the existing `a second authenticated WebSocket
  // client connects to "/ws"` When step in
  // backend-ws-event-broadcast.steps.ts.
  wsBroadcastSecondClient?: WsClient;
  // Per-feature carriers — streaming frame buffers for both clients.
  // Kept distinct from `wsBroadcastFrames` / `wsBroadcastFramesSecond`
  // so the upstream broadcast step file's assertions don't drain our
  // proposal-status frames and vice versa. (The two listener sets
  // attach independently — every inbound frame is pushed into BOTH
  // queues.)
  wsProposalStatusFrames?: string[];
  wsProposalStatusFramesSecond?: string[];
}

function scratch(world: AConversaWorld): ProposalStatusScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ProposalStatusScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function ensureFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsProposalStatusFrames === undefined) {
    s.wsProposalStatusFrames = [];
    const ws = s.wsLifecycleClient;
    assert.ok(ws, 'no ws client — first-client connect step must precede');
    ws.on('message', (data: unknown) => {
      s.wsProposalStatusFrames?.push(toUtf8(data));
    });
  }
  return s.wsProposalStatusFrames;
}

function ensureSecondFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsProposalStatusFramesSecond === undefined) {
    s.wsProposalStatusFramesSecond = [];
    const ws = s.wsBroadcastSecondClient;
    assert.ok(ws, 'no second ws client — second-client connect step must precede');
    ws.on('message', (data: unknown) => {
      s.wsProposalStatusFramesSecond?.push(toUtf8(data));
    });
  }
  return s.wsProposalStatusFramesSecond;
}

interface ProposalStatusFrame {
  type?: unknown;
  id?: unknown;
  payload?: {
    sessionId?: unknown;
    proposalId?: unknown;
    sequence?: unknown;
    perFacetStatus?: Record<string, unknown>;
  };
}

async function waitForProposalStatus(
  queue: string[],
  expectedProposalId: string,
  expectedSequence: number,
  timeoutMs = 1500,
): Promise<ProposalStatusFrame | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = 0; i < queue.length; i++) {
      const raw = queue[i]!;
      let parsed: ProposalStatusFrame;
      try {
        parsed = JSON.parse(raw) as ProposalStatusFrame;
      } catch {
        continue;
      }
      if (
        parsed.type === 'proposal-status' &&
        parsed.payload?.proposalId === expectedProposalId &&
        parsed.payload?.sequence === expectedSequence
      ) {
        queue.splice(i, 1);
        return parsed;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

// ============================================================
// Thens — receive-side assertions
// ============================================================

Then(
  'the client receives a proposal-status envelope for proposal {string} at sequence {int} with {word} status {string}',
  async function (
    this: AConversaWorld,
    proposalId: string,
    sequence: number,
    facet: string,
    expectedStatus: string,
  ) {
    const queue = ensureFramesQueue(this);
    const frame = await waitForProposalStatus(queue, proposalId, sequence);
    assert.ok(
      frame,
      `did not receive proposal-status envelope for proposal ${proposalId} at sequence ${String(sequence)} within timeout`,
    );
    const status = frame.payload?.perFacetStatus?.[facet];
    assert.equal(
      status,
      expectedStatus,
      `expected perFacetStatus.${facet} === ${expectedStatus}, got ${String(status)}`,
    );
  },
);

Then(
  'the second client receives a proposal-status envelope for proposal {string} at sequence {int} with {word} status {string}',
  async function (
    this: AConversaWorld,
    proposalId: string,
    sequence: number,
    facet: string,
    expectedStatus: string,
  ) {
    const queue = ensureSecondFramesQueue(this);
    const frame = await waitForProposalStatus(queue, proposalId, sequence);
    assert.ok(
      frame,
      `did not receive proposal-status envelope for proposal ${proposalId} at sequence ${String(sequence)} on second client within timeout`,
    );
    const status = frame.payload?.perFacetStatus?.[facet];
    assert.equal(
      status,
      expectedStatus,
      `expected perFacetStatus.${facet} === ${expectedStatus} on second client, got ${String(status)}`,
    );
  },
);

Then(
  'the client receives no proposal-status envelope within {int}ms',
  async function (this: AConversaWorld, timeoutMs: number) {
    const queue = ensureFramesQueue(this);
    // Drain the queue for `timeoutMs` and assert no proposal-status
    // frame surfaces — the filter invariant.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const raw of queue) {
        let parsed: { type?: unknown };
        try {
          parsed = JSON.parse(raw) as { type?: unknown };
        } catch {
          continue;
        }
        assert.notEqual(
          parsed.type,
          'proposal-status',
          `did not expect a proposal-status envelope; got ${raw}`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  },
);

// ============================================================
// Teardown
// ============================================================

After(function (this: AConversaWorld) {
  const s = scratch(this);
  delete s.wsProposalStatusFrames;
  delete s.wsProposalStatusFramesSecond;
});
