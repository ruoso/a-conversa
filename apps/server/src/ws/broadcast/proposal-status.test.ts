// Vitest unit tests for `buildProposalStatusBroadcastListener`.
//
// Refinement: tasks/refinements/backend/ws_proposal_status_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_proposal_status_broadcast
//
// **What this file covers.** The pure-logic filter + derive + fan-out
// behaviour of the `proposal-status` broadcast listener. No Fastify,
// no real sockets, no real DB — the builder takes a real
// `WsSubscriptionRegistry`, a real `WsConnectionSenderRegistry`
// populated with captured-array senders, an injected event-loader
// closure that returns the fabricated event prefix per scenario, and
// a captured logger. The listener kicks off async work; the tests
// await an explicit `flushMicrotasks()` to let the inner Promise
// chain resolve before asserting.
//
// Contract pinned here:
//
//   1. Filter — irrelevant event kinds (`session-created`,
//      `participant-joined`, `entity-included`, ...) do NOT trigger a
//      broadcast.
//   2. Filter — facet-targeting proposal-sub-kind proposals trigger a
//      broadcast with status `'proposed'` for the addressed facet.
//   3. A `vote` event triggers a broadcast carrying the current
//      per-facet status (mid-flight `'proposed'`; unanimous-agree
//      `'agreed'`).
//   4. A `commit` event triggers a broadcast with status
//      `'committed'`.
//   5. A `meta-disagreement-marked` event triggers a broadcast with
//      status `'meta-disagreement'`.
//   6. Multiple subscribed connections all receive the same envelope
//      (same server-minted id; same payload).
//   7. Per-connection error isolation — one bad sender logs at warn
//      and the others still receive.
//   8. Structural proposal sub-kinds (e.g. `axiom-mark`) DO NOT
//      trigger a broadcast (no facet target).

import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelopeUnion } from '@a-conversa/shared-types';

import { buildProposalStatusBroadcastListener } from './proposal-status.js';
import { WsConnectionSenderRegistry } from './connections.js';
import { WsSubscriptionRegistry } from '../subscriptions.js';

const SESSION_A = '00000000-0000-4000-8000-000000000a01';
const HOST_USER = '00000000-0000-4000-8000-000000000a02';
const DEBATER_A = '00000000-0000-4000-8000-000000000a03';
const DEBATER_B = '00000000-0000-4000-8000-000000000a04';
const NODE_1 = '00000000-0000-4000-8000-000000000b01';
const PROPOSAL_1 = '00000000-0000-4000-8000-000000000c01';
const VOTE_1 = '00000000-0000-4000-8000-000000000d01';
const VOTE_2 = '00000000-0000-4000-8000-000000000d02';
const COMMIT_1 = '00000000-0000-4000-8000-000000000d03';
const MD_1 = '00000000-0000-4000-8000-000000000d04';
const NODE_CREATED_ID = '00000000-0000-4000-8000-000000000e01';
const CONN_1 = '00000000-0000-4000-8000-000000000f01';
const CONN_2 = '00000000-0000-4000-8000-000000000f02';
const CONN_3 = '00000000-0000-4000-8000-000000000f03';

// Minimal FastifyBaseLogger stub — captures `warn` calls. The other
// methods are no-ops (the listener uses `warn` only).
interface CapturedLog {
  level: 'warn';
  ctx: Record<string, unknown>;
  msg: string;
}
function captureLogger(): { logger: FastifyBaseLogger; lines: CapturedLog[] } {
  const lines: CapturedLog[] = [];
  const logger = {
    warn: (ctx: Record<string, unknown>, msg: string) => {
      lines.push({ level: 'warn', ctx, msg });
    },
    info: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: 'info',
    silent: () => {},
  } as unknown as FastifyBaseLogger;
  return { logger, lines };
}

// -- Event fixtures -------------------------------------------------
//
// The fixtures construct the minimum event prefix the projection needs
// to be a well-formed input to `deriveFacetStatus`. The session is
// created, two debaters join (so the "current participants" set for
// agreement-rule has two members), then a node is created (so the
// `set-node-substance` proposal can address it), then the proposal is
// added, and votes/commits/marks happen.

function sessionCreated(sequence = 1): Event {
  return {
    id: '00000000-0000-4000-8000-000000001001',
    sessionId: SESSION_A,
    sequence,
    kind: 'session-created',
    actor: HOST_USER,
    payload: {
      host_user_id: HOST_USER,
      privacy: 'public',
      topic: 'fixture session',
      created_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function participantJoined(
  userId: string,
  sequence: number,
  role: 'debater-A' | 'debater-B',
): Event {
  return {
    id: `00000000-0000-4000-8000-0000000020${sequence.toString().padStart(2, '0')}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role,
      screen_name: `user-${role}`,
      joined_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function nodeCreated(sequence: number): Event {
  return {
    id: NODE_CREATED_ID,
    sessionId: SESSION_A,
    sequence,
    kind: 'node-created',
    actor: HOST_USER,
    payload: {
      node_id: NODE_1,
      wording: 'fixture node wording',
      created_by: HOST_USER,
      created_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function entityIncluded(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-0000000030${sequence.toString().padStart(2, '0')}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'entity-included',
    actor: HOST_USER,
    payload: {
      entity_kind: 'node',
      entity_id: NODE_1,
      included_by: HOST_USER,
      included_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function setNodeSubstanceProposal(sequence: number): Event {
  return {
    id: PROPOSAL_1,
    sessionId: SESSION_A,
    sequence,
    kind: 'proposal',
    actor: DEBATER_A,
    payload: {
      proposal: {
        kind: 'set-node-substance',
        node_id: NODE_1,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function axiomMarkProposal(sequence: number): Event {
  return {
    id: PROPOSAL_1,
    sessionId: SESSION_A,
    sequence,
    kind: 'proposal',
    actor: DEBATER_A,
    payload: {
      proposal: {
        kind: 'axiom-mark',
        node_id: NODE_1,
        participant: DEBATER_A,
      },
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function voteEvent(
  voteId: string,
  participant: string,
  sequence: number,
  arm: 'agree' | 'dispute' | 'withdraw' = 'agree',
): Event {
  return {
    id: voteId,
    sessionId: SESSION_A,
    sequence,
    kind: 'vote',
    actor: participant,
    payload: {
      proposal_id: PROPOSAL_1,
      participant,
      vote: arm,
      voted_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function commitEvent(sequence: number): Event {
  return {
    id: COMMIT_1,
    sessionId: SESSION_A,
    sequence,
    kind: 'commit',
    actor: HOST_USER,
    payload: {
      proposal_id: PROPOSAL_1,
      moderator: HOST_USER,
      committed_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function metaDisagreementEvent(sequence: number): Event {
  return {
    id: MD_1,
    sessionId: SESSION_A,
    sequence,
    kind: 'meta-disagreement-marked',
    actor: HOST_USER,
    payload: {
      proposal_id: PROPOSAL_1,
      moderator: HOST_USER,
      marked_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

// Tiny async barrier — the listener kicks off an async tail via
// `void deriveAndFanOut(...)`; tests need to let the Promise chain
// settle before asserting on the captured frames. Two macrotask waits
// is enough for the (zero-await loader → projectFromLog →
// deriveFacetStatus → senders) microtask sequence under the captured
// senders' synchronous push.
async function flushMicrotasks(): Promise<void> {
  // Use setImmediate-equivalent (a 0-delay setTimeout) twice to let
  // the listener's async tail and any queued microtasks resolve.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// Helper — wire up a single connection's listener with a captured
// frames queue, the subscription, and the registries. Returns the
// captured array.
function setupConnection(
  subscriptions: WsSubscriptionRegistry,
  connectionSenders: WsConnectionSenderRegistry,
  connectionId: string,
  sessionId: string,
): WsEnvelopeUnion[] {
  const captured: WsEnvelopeUnion[] = [];
  connectionSenders.register(connectionId, (env) => captured.push(env));
  subscriptions.subscribe(connectionId, sessionId);
  return captured;
}

describe('buildProposalStatusBroadcastListener — filter set', () => {
  it('does NOT trigger a broadcast for irrelevant event kinds', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    // Loader returns the full prefix — but the listener should NOT
    // call it for an irrelevant event kind, so we make the loader
    // throw to catch a regression that violates the filter.
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () =>
        Promise.reject(new Error('loader must not be called for a filtered event kind')),
      log: logger,
    });

    listener({ event: sessionCreated(1) });
    listener({ event: participantJoined(DEBATER_A, 2, 'debater-A') });
    listener({ event: entityIncluded(3) });

    await flushMicrotasks();
    expect(captured).toHaveLength(0);
  });

  it('does NOT trigger a broadcast for a structural-proposal sub-kind (axiom-mark)', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    // The prefix the loader returns puts an axiom-mark proposal in
    // the projection — but the broadcast surface should skip it
    // because there's no facet target.
    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      axiomMarkProposal(6),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: axiomMarkProposal(6) });

    await flushMicrotasks();
    expect(captured).toHaveLength(0);
  });
});

describe('buildProposalStatusBroadcastListener — derive + fan-out', () => {
  it('triggers a broadcast for a facet-targeting `proposal` event with status `proposed`', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      setNodeSubstanceProposal(6),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: setNodeSubstanceProposal(6) });
    await flushMicrotasks();

    expect(captured).toHaveLength(1);
    const env = captured[0]!;
    expect(env.type).toBe('proposal-status');
    expect(env.inResponseTo).toBeUndefined();
    if (env.type !== 'proposal-status') throw new Error('narrowing');
    expect(env.payload.sessionId).toBe(SESSION_A);
    expect(env.payload.proposalId).toBe(PROPOSAL_1);
    expect(env.payload.sequence).toBe(6);
    expect(env.payload.perFacetStatus).toEqual({ substance: 'proposed' });
  });

  it('triggers a broadcast for a `vote` event reflecting the current state (one agree → proposed)', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      setNodeSubstanceProposal(6),
      voteEvent(VOTE_1, DEBATER_A, 7, 'agree'),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: voteEvent(VOTE_1, DEBATER_A, 7, 'agree') });
    await flushMicrotasks();

    expect(captured).toHaveLength(1);
    const env = captured[0]!;
    if (env.type !== 'proposal-status') throw new Error('narrowing');
    // Only one of two debaters has voted agree → status stays
    // `proposed` per `deriveFacetStatus`'s rule 7.
    expect(env.payload.perFacetStatus).toEqual({ substance: 'proposed' });
    expect(env.payload.sequence).toBe(7);
  });

  it('triggers a broadcast for a `commit` event with status `committed`', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      setNodeSubstanceProposal(6),
      voteEvent(VOTE_1, DEBATER_A, 7, 'agree'),
      voteEvent(VOTE_2, DEBATER_B, 8, 'agree'),
      commitEvent(9),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: commitEvent(9) });
    await flushMicrotasks();

    expect(captured).toHaveLength(1);
    const env = captured[0]!;
    if (env.type !== 'proposal-status') throw new Error('narrowing');
    expect(env.payload.perFacetStatus).toEqual({ substance: 'committed' });
    expect(env.payload.sequence).toBe(9);
  });

  it('triggers a broadcast for a `meta-disagreement-marked` event with status `meta-disagreement`', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    // For meta-disagreement-marked to land, the proposal must be
    // pending and one prior vote must register a dispute (so the
    // methodology / handler-side gate is satisfied — the dispatcher's
    // `handleMetaDisagreementMarked` transitions the facet's status
    // from whatever it was to `meta-disagreement`).
    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      setNodeSubstanceProposal(6),
      voteEvent(VOTE_1, DEBATER_A, 7, 'dispute'),
      metaDisagreementEvent(8),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: metaDisagreementEvent(8) });
    await flushMicrotasks();

    expect(captured).toHaveLength(1);
    const env = captured[0]!;
    if (env.type !== 'proposal-status') throw new Error('narrowing');
    expect(env.payload.perFacetStatus).toEqual({ substance: 'meta-disagreement' });
    expect(env.payload.sequence).toBe(8);
  });
});

describe('buildProposalStatusBroadcastListener — multi-connection fan-out + error isolation', () => {
  it('every subscribed connection receives the SAME envelope (same id, same payload)', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured1 = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const captured2 = setupConnection(subscriptions, connectionSenders, CONN_2, SESSION_A);
    const { logger } = captureLogger();

    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      setNodeSubstanceProposal(6),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: setNodeSubstanceProposal(6) });
    await flushMicrotasks();

    expect(captured1).toHaveLength(1);
    expect(captured2).toHaveLength(1);
    // Both receivers see the SAME envelope — server-minted id is
    // shared across the fan-out so a server log can correlate the
    // fan-out by id.
    expect(captured1[0]!.id).toBe(captured2[0]!.id);
    expect(captured1[0]).toEqual(captured2[0]);
  });

  it('isolates per-connection send failures — one bad sender does not break the fan-out', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured1: WsEnvelopeUnion[] = [];
    const captured3: WsEnvelopeUnion[] = [];
    connectionSenders.register(CONN_1, (env) => captured1.push(env));
    connectionSenders.register(CONN_2, () => {
      throw new Error('socket already closed');
    });
    connectionSenders.register(CONN_3, (env) => captured3.push(env));
    subscriptions.subscribe(CONN_1, SESSION_A);
    subscriptions.subscribe(CONN_2, SESSION_A);
    subscriptions.subscribe(CONN_3, SESSION_A);

    const { logger, lines } = captureLogger();
    const events: Event[] = [
      sessionCreated(1),
      participantJoined(DEBATER_A, 2, 'debater-A'),
      participantJoined(DEBATER_B, 3, 'debater-B'),
      nodeCreated(4),
      entityIncluded(5),
      setNodeSubstanceProposal(6),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: setNodeSubstanceProposal(6) });
    await flushMicrotasks();

    // The good senders received the broadcast.
    expect(captured1).toHaveLength(1);
    expect(captured3).toHaveLength(1);

    // The bad sender's failure was logged at warn level with the
    // connection id + proposal id + envelope id for correlation.
    const sendFailLine = lines.find((l) =>
      String(l.msg).startsWith('ws-proposal-status-send-failed'),
    );
    expect(sendFailLine).toBeDefined();
    expect(sendFailLine?.ctx['connectionId']).toBe(CONN_2);
    expect(sendFailLine?.ctx['sessionId']).toBe(SESSION_A);
    expect(sendFailLine?.ctx['proposalId']).toBe(PROPOSAL_1);
    expect(sendFailLine?.ctx['err']).toBeInstanceOf(Error);
  });

  it('is a no-op (no loader call, no fan-out) when no connection is subscribed', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured: WsEnvelopeUnion[] = [];
    connectionSenders.register(CONN_1, (env) => captured.push(env));
    // Subscribe to a DIFFERENT session so the registry isn't empty —
    // we want to assert specifically that "no subscribers for THIS
    // session" is fine.
    subscriptions.subscribe(CONN_1, '00000000-0000-4000-8000-0000000000ee');

    const { logger } = captureLogger();
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.reject(new Error('loader must not be called when no subscribers')),
      log: logger,
    });

    listener({ event: setNodeSubstanceProposal(6) });
    await flushMicrotasks();
    expect(captured).toHaveLength(0);
  });
});
