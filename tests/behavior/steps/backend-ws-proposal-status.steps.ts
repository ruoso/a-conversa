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
  // First-client streaming buffers — each trigger step (vote / commit /
  // a server-emitted event-applied) attaches its OWN persistent
  // listener EAGERLY before triggering (because `ws.on('message')`
  // does not buffer late-attached listeners). We read whichever one is
  // populated for the active scenario.
  wsVoteFrames?: string[];
  wsCommitFrames?: string[];
  wsBroadcastFrames?: string[];
  // Second-client streaming buffer — initialised by the broadcast
  // step file's `a second authenticated WebSocket client connects to
  // "/ws"` When step, which attaches the listener at connect time.
  wsBroadcastFramesSecond?: string[];
}

function scratch(world: AConversaWorld): ProposalStatusScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ProposalStatusScratch;
}

function ensureFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  // Each trigger step (vote / commit) eagerly attaches its own
  // first-client streaming listener BEFORE sending its envelope.
  // The proposal-status frame lands on the same socket, so it ends
  // up in whichever queue is populated for the active scenario.
  // We read from whichever one was set up by the trigger step that
  // ran earlier in the scenario. `ws.on('message')` does not buffer
  // late-attached listeners, so attaching here in the `Then` step
  // would race and lose the frame.
  const queue = s.wsCommitFrames ?? s.wsVoteFrames ?? s.wsBroadcastFrames;
  assert.ok(
    queue !== undefined,
    "no first-client streaming frame queue is populated — the trigger step (vote / commit / server-emitted broadcast) must run before the proposal-status assertion so its eager `on('message')` listener catches the post-trigger broadcast",
  );
  return queue;
}

function ensureSecondFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  // The second-client streaming buffer is populated by the broadcast
  // step file's `a second authenticated WebSocket client connects to
  // "/ws"` When step, which attaches the listener at connect time —
  // before the trigger step runs.
  assert.ok(
    s.wsBroadcastFramesSecond !== undefined,
    'wsBroadcastFramesSecond not initialised — the `a second authenticated WebSocket client connects to "/ws"` When step must run first',
  );
  return s.wsBroadcastFramesSecond;
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
  // No per-feature carriers to drop — the streaming buffers we read
  // from are owned + cleaned up by the broadcast step file.
});
