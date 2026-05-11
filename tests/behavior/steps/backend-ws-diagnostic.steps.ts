// Step definitions for tests/behavior/backend/ws-diagnostic.feature.
//
// Refinement: tasks/refinements/backend/ws_diagnostic_broadcast.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_diagnostic_broadcast
//
// **What this file owns.** The cucumber-layer regression net for the
// `diagnostic` broadcast surface — exercises the full WS upgrade →
// subscribe → `wsDiagnosticBroadcast.notifyForSession(...)` →
// `DiagnosticBus.notify` → fan-out → client receive path through the
// real `__buildTestWsApp` instance against pglite.
//
// **Why we lean on the existing `wsAuthApp` + `wsLifecycleClient`
// scratch keys.** Same pattern as `backend-ws-event-broadcast.steps.ts`:
// the auth-gated app is built by `backend-ws-auth.steps.ts`'s Given
// step; the client is opened by `backend-ws-connection.steps.ts`'s
// When step; the subscribe envelope is sent by
// `backend-ws-subscribe.steps.ts`'s When step. This file only adds:
//
//   1. The notify-step ("the server notifies a <kind> diagnostic
//      fired/cleared for session <id> at sequence <n>").
//   2. The receive-side Then steps.
//
// The notify step reaches for `wsAuthApp.wsDiagnosticBroadcast.notifyForSession(...)`
// directly — this simulates what the projection-cache wiring will do
// AFTER `applyEvent` re-computes the diagnostic snapshot. The wiring's
// own end-to-end behavior (cache → bridge) is owned by a future task.
//
// **Frame capture.** The connect step pre-attaches a one-shot listener
// via `onInit` to capture the canonical hello envelope; the subscribe
// step adds another one-shot listener for its ack. The diagnostic
// broadcast is unsolicited — we attach a streaming listener to each
// client's underlying `on('message')` channel that pushes every frame
// into a per-client queue. The Then step drains the queue waiting for
// a `diagnostic` envelope to arrive.

import { After, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { AConversaWorld } from '../support/world.js';
import type {
  DiagnosticEntry,
  CycleDiagnosticEntry,
  ContradictionDiagnosticEntry,
  MultiWarrantDiagnosticEntry,
  DanglingClaimDiagnosticEntry,
  CoherencyHintDiagnosticEntry,
} from '../../../apps/server/src/diagnostics/index.js';

interface WsClient {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
}

// The Fastify-instance subset we touch — `injectWS` for clients and
// `wsDiagnosticBroadcast` for the notify step. Typed structurally to
// avoid dragging the workspace-local `FastifyInstance` and
// `WsDiagnosticBroadcast` types across the cucumber boundary; the
// actual instance reaches us via the shared `wsAuthApp` scratch key
// from `backend-ws-auth.steps.ts`.
interface FastifyLike {
  injectWS(
    path?: string,
    upgradeContext?: { headers?: Record<string, string> },
    options?: { onInit?: (ws: WsClient) => void },
  ): Promise<WsClient>;
  close(): Promise<void>;
  wsDiagnosticBroadcast: {
    notifyForSession(
      sessionId: string,
      sequence: number,
      prev: DiagnosticEntry[],
      next: DiagnosticEntry[],
    ): void;
  };
}

interface DiagnosticScratch {
  // Read from `backend-ws-auth.steps.ts`.
  wsAuthApp?: FastifyLike;
  wsAuthCookie?: string;
  // Read from `backend-ws-connection.steps.ts`.
  wsLifecycleClient?: WsClient;
  // Per-feature carriers.
  wsDiagnosticFrames?: string[];
}

function scratch(world: AConversaWorld): DiagnosticScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as DiagnosticScratch;
}

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

function getApp(world: AConversaWorld): FastifyLike {
  const app = scratch(world).wsAuthApp;
  assert.ok(app, 'WS auth app not initialized — Given step missing');
  return app;
}

function getClient(world: AConversaWorld): WsClient {
  const ws = scratch(world).wsLifecycleClient;
  assert.ok(ws, 'no ws client — the connect When step must precede');
  return ws;
}

function ensureFramesQueue(world: AConversaWorld): string[] {
  const s = scratch(world);
  if (s.wsDiagnosticFrames === undefined) {
    s.wsDiagnosticFrames = [];
    const ws = getClient(world);
    ws.on('message', (data: unknown) => {
      s.wsDiagnosticFrames?.push(toUtf8(data));
    });
  }
  return s.wsDiagnosticFrames;
}

function buildEntryForKind(kind: string): DiagnosticEntry {
  switch (kind) {
    case 'cycle': {
      const entry: CycleDiagnosticEntry = {
        kind: 'cycle',
        nodes: ['n1', 'n2', 'n3'],
      };
      return entry;
    }
    case 'contradiction': {
      const entry: ContradictionDiagnosticEntry = {
        kind: 'contradiction',
        nodeA: 'n-a',
        nodeB: 'n-b',
        edges: ['e1'],
      };
      return entry;
    }
    case 'multi-warrant': {
      const entry: MultiWarrantDiagnosticEntry = {
        kind: 'multi-warrant',
        dataNodeId: 'd1',
        claimNodeId: 'c1',
        warrantNodeIds: ['w1', 'w2'],
      };
      return entry;
    }
    case 'dangling-claim': {
      const entry: DanglingClaimDiagnosticEntry = {
        kind: 'dangling-claim',
        nodeId: 'c-dangling',
      };
      return entry;
    }
    case 'coherency-hint': {
      const entry: CoherencyHintDiagnosticEntry = {
        kind: 'coherency-hint',
        hint: { kind: 'self-contradicts', edgeId: 'e-self', nodeId: 'n-self' },
      };
      return entry;
    }
    default:
      throw new Error(`unknown diagnostic kind for cucumber fixture: ${kind}`);
  }
}

async function waitForDiagnostic(
  queue: string[],
  expected: { kind: string; severity: string; status: string },
  timeoutMs = 1000,
): Promise<{
  type?: unknown;
  payload?: { kind?: unknown; severity?: unknown; status?: unknown };
} | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = 0; i < queue.length; i++) {
      const frame = queue[i]!;
      let parsed: {
        type?: unknown;
        payload?: { kind?: unknown; severity?: unknown; status?: unknown };
      };
      try {
        parsed = JSON.parse(frame) as {
          type?: unknown;
          payload?: { kind?: unknown; severity?: unknown; status?: unknown };
        };
      } catch {
        continue;
      }
      if (
        parsed.type === 'diagnostic' &&
        parsed.payload?.kind === expected.kind &&
        parsed.payload?.severity === expected.severity &&
        parsed.payload?.status === expected.status
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
// Whens
// ============================================================

When(
  'the server notifies a {word} diagnostic fired for session {string} at sequence {int}',
  function (this: AConversaWorld, kind: string, sessionId: string, sequence: number) {
    ensureFramesQueue(this);
    const app = getApp(this);
    const entry = buildEntryForKind(kind);
    // prev empty, next has the entry — fired.
    app.wsDiagnosticBroadcast.notifyForSession(sessionId, sequence, [], [entry]);
  },
);

When(
  'the server notifies a {word} diagnostic cleared for session {string} at sequence {int}',
  function (this: AConversaWorld, kind: string, sessionId: string, sequence: number) {
    ensureFramesQueue(this);
    const app = getApp(this);
    const entry = buildEntryForKind(kind);
    // prev has the entry, next empty — cleared.
    app.wsDiagnosticBroadcast.notifyForSession(sessionId, sequence, [entry], []);
  },
);

// ============================================================
// Thens
// ============================================================

Then(
  'the client receives a diagnostic envelope with kind {string} and severity {string} and status {string}',
  async function (this: AConversaWorld, kind: string, severity: string, status: string) {
    const queue = ensureFramesQueue(this);
    const parsed = await waitForDiagnostic(queue, { kind, severity, status });
    assert.ok(
      parsed,
      `did not receive diagnostic envelope kind=${kind} severity=${severity} status=${status} within timeout`,
    );
    assert.equal(parsed.type, 'diagnostic');
    assert.equal(parsed.payload?.kind, kind);
    assert.equal(parsed.payload?.severity, severity);
    assert.equal(parsed.payload?.status, status);
  },
);

Then(
  'the client receives no diagnostic envelope within {int}ms',
  async function (this: AConversaWorld, timeoutMs: number) {
    const queue = ensureFramesQueue(this);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of queue) {
        let parsed: { type?: unknown };
        try {
          parsed = JSON.parse(frame) as { type?: unknown };
        } catch {
          continue;
        }
        assert.notEqual(
          parsed.type,
          'diagnostic',
          `did not expect a diagnostic envelope; got ${frame}`,
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
  delete s.wsDiagnosticFrames;
});
