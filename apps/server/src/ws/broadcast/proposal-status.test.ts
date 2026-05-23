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
      target: 'proposal' as const,
      proposal_id: PROPOSAL_1,
      participant,
      choice: arm as 'agree' | 'dispute',
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

// -- Per-component fan-out for decompose / interpretive-split ------
//
// Refinement: tasks/refinements/backend/facet_status_server_decompose_component_facets.md
//
// Cases A + B pin the per-component multiplicity contract: a pending
// decompose with N components emits exactly N `proposal-status`
// envelopes (one per component's classification facet); a pending
// interpretive-split with M readings emits exactly M envelopes.
// Cases C + D pin the withdraw / commit transitions.
//
// Each fixture builds the propose-time event prefix end-to-end:
// session-created → 3× participant-joined (host + 2 debaters) →
// node-created(parent) → entity-included(parent) →
// proposal(classify-node parent) → vote × 2 → commit(classify-node)
// to commit the parent's classification facet (so the parent is in a
// clean post-classify state), then the decompose propose-time fan-out:
// node-created(c1) → entity-included(c1) → node-created(c2) →
// entity-included(c2) → proposal(decompose [c1, c2]). The trigger is
// the final proposal event.

const PARENT_NODE = '00000000-0000-4000-8000-000000000b10';
const COMPONENT_1 = '00000000-0000-4000-8000-000000000b11';
const COMPONENT_2 = '00000000-0000-4000-8000-000000000b12';
const READING_1 = '00000000-0000-4000-8000-000000000b21';
const READING_2 = '00000000-0000-4000-8000-000000000b22';
const READING_3 = '00000000-0000-4000-8000-000000000b23';
const CLASSIFY_PROPOSAL = '00000000-0000-4000-8000-000000000c10';
const CLASSIFY_VOTE_A = '00000000-0000-4000-8000-000000000d10';
const CLASSIFY_VOTE_B = '00000000-0000-4000-8000-000000000d11';
const CLASSIFY_VOTE_HOST = '00000000-0000-4000-8000-000000000d12';
const CLASSIFY_COMMIT = '00000000-0000-4000-8000-000000000d13';
const DECOMPOSE_PROPOSAL = '00000000-0000-4000-8000-000000000c20';
const DECOMPOSE_VOTE_HOST = '00000000-0000-4000-8000-000000000d20';
const DECOMPOSE_VOTE_A = '00000000-0000-4000-8000-000000000d21';
const DECOMPOSE_VOTE_B = '00000000-0000-4000-8000-000000000d22';
const DECOMPOSE_COMMIT = '00000000-0000-4000-8000-000000000d23';
const INTERPRETIVE_PROPOSAL = '00000000-0000-4000-8000-000000000c30';
const PARENT_CREATED_ID = '00000000-0000-4000-8000-000000000e10';
const C1_CREATED_ID = '00000000-0000-4000-8000-000000000e11';
const C2_CREATED_ID = '00000000-0000-4000-8000-000000000e12';
const R1_CREATED_ID = '00000000-0000-4000-8000-000000000e21';
const R2_CREATED_ID = '00000000-0000-4000-8000-000000000e22';
const R3_CREATED_ID = '00000000-0000-4000-8000-000000000e23';

function hostJoined(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-0000000040${sequence.toString().padStart(2, '0')}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'participant-joined',
    actor: HOST_USER,
    payload: {
      user_id: HOST_USER,
      role: 'moderator',
      screen_name: 'host',
      joined_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function namedNodeCreated(
  eventId: string,
  nodeId: string,
  wording: string,
  sequence: number,
): Event {
  return {
    id: eventId,
    sessionId: SESSION_A,
    sequence,
    kind: 'node-created',
    actor: HOST_USER,
    payload: {
      node_id: nodeId,
      wording,
      created_by: HOST_USER,
      created_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function namedEntityIncluded(nodeId: string, sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-0000000050${sequence.toString().padStart(2, '0')}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'entity-included',
    actor: HOST_USER,
    payload: {
      entity_kind: 'node',
      entity_id: nodeId,
      included_by: HOST_USER,
      included_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function classifyNodeProposal(eventId: string, nodeId: string, sequence: number): Event {
  return {
    id: eventId,
    sessionId: SESSION_A,
    sequence,
    kind: 'proposal',
    actor: HOST_USER,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: nodeId,
        classification: 'fact',
      },
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function namedVote(
  eventId: string,
  proposalId: string,
  participant: string,
  sequence: number,
  arm: 'agree' | 'dispute' | 'withdraw' = 'agree',
): Event {
  return {
    id: eventId,
    sessionId: SESSION_A,
    sequence,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: arm as 'agree' | 'dispute',
      voted_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function namedCommit(eventId: string, proposalId: string, sequence: number): Event {
  return {
    id: eventId,
    sessionId: SESSION_A,
    sequence,
    kind: 'commit',
    actor: HOST_USER,
    payload: {
      proposal_id: proposalId,
      moderator: HOST_USER,
      committed_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function decomposeProposalEvent(sequence: number): Event {
  return {
    id: DECOMPOSE_PROPOSAL,
    sessionId: SESSION_A,
    sequence,
    kind: 'proposal',
    actor: DEBATER_A,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: PARENT_NODE,
        components: [
          { wording: 'component 1 wording', classification: 'fact', node_id: COMPONENT_1 },
          { wording: 'component 2 wording', classification: 'fact', node_id: COMPONENT_2 },
        ],
      },
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function interpretiveSplitProposalEvent(sequence: number): Event {
  return {
    id: INTERPRETIVE_PROPOSAL,
    sessionId: SESSION_A,
    sequence,
    kind: 'proposal',
    actor: DEBATER_A,
    payload: {
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: PARENT_NODE,
        readings: [
          { wording: 'reading 1 wording', classification: 'fact', node_id: READING_1 },
          { wording: 'reading 2 wording', classification: 'fact', node_id: READING_2 },
          { wording: 'reading 3 wording', classification: 'fact', node_id: READING_3 },
        ],
      },
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

function entityRemoved(eventId: string, nodeId: string, sequence: number): Event {
  return {
    id: eventId,
    sessionId: SESSION_A,
    sequence,
    kind: 'entity-removed',
    actor: HOST_USER,
    payload: {
      entity_kind: 'node',
      entity_id: nodeId,
      removed_by: HOST_USER,
      removed_at: '2026-05-11T12:00:00.000Z',
    },
    createdAt: '2026-05-11T12:00:00.001Z',
  };
}

// Pre-decompose prefix: session, 3 participants, parent node, classify
// parent, unanimous-agree, commit. Sequences 1..11. The parent's
// classification facet ends `'committed'`, the parent is visible.
function preDecomposePrefix(): Event[] {
  return [
    sessionCreated(1),
    hostJoined(2),
    participantJoined(DEBATER_A, 3, 'debater-A'),
    participantJoined(DEBATER_B, 4, 'debater-B'),
    namedNodeCreated(PARENT_CREATED_ID, PARENT_NODE, 'parent wording', 5),
    namedEntityIncluded(PARENT_NODE, 6),
    classifyNodeProposal(CLASSIFY_PROPOSAL, PARENT_NODE, 7),
    namedVote(CLASSIFY_VOTE_HOST, CLASSIFY_PROPOSAL, HOST_USER, 8, 'agree'),
    namedVote(CLASSIFY_VOTE_A, CLASSIFY_PROPOSAL, DEBATER_A, 9, 'agree'),
    namedVote(CLASSIFY_VOTE_B, CLASSIFY_PROPOSAL, DEBATER_B, 10, 'agree'),
    namedCommit(CLASSIFY_COMMIT, CLASSIFY_PROPOSAL, 11),
  ];
}

describe('buildProposalStatusBroadcastListener — per-component fan-out for decompose / interpretive-split', () => {
  it('Case A — pending decompose emits N envelopes for N component classification facets', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    // Propose-time structural fan-out per the propose handler:
    // node-created(c1), entity-included(c1), node-created(c2),
    // entity-included(c2), proposal(decompose). Sequences 12..16.
    const events: Event[] = [
      ...preDecomposePrefix(),
      namedNodeCreated(C1_CREATED_ID, COMPONENT_1, 'component 1 wording', 12),
      namedEntityIncluded(COMPONENT_1, 13),
      namedNodeCreated(C2_CREATED_ID, COMPONENT_2, 'component 2 wording', 14),
      namedEntityIncluded(COMPONENT_2, 15),
      decomposeProposalEvent(16),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: decomposeProposalEvent(16) });
    await flushMicrotasks();

    // Exactly 2 envelopes — one per component.
    expect(captured).toHaveLength(2);

    // Each envelope is a `proposal-status` envelope addressing the
    // decompose proposal, the triggering event's sequence, with
    // `perFacetStatus: { classification: 'proposed' }`.
    for (const env of captured) {
      expect(env.type).toBe('proposal-status');
      if (env.type !== 'proposal-status') throw new Error('narrowing');
      expect(env.payload.sessionId).toBe(SESSION_A);
      expect(env.payload.proposalId).toBe(DECOMPOSE_PROPOSAL);
      expect(env.payload.sequence).toBe(16);
      expect(env.payload.perFacetStatus).toEqual({ classification: 'proposed' });
    }

    // The two envelopes carry distinct server-minted UUIDs — one per
    // envelope per the existing fan-out contract.
    const ids = captured.map((env) => env.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('Case B — pending interpretive-split emits M envelopes for M reading classification facets', async () => {
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    const events: Event[] = [
      ...preDecomposePrefix(),
      namedNodeCreated(R1_CREATED_ID, READING_1, 'reading 1 wording', 12),
      namedEntityIncluded(READING_1, 13),
      namedNodeCreated(R2_CREATED_ID, READING_2, 'reading 2 wording', 14),
      namedEntityIncluded(READING_2, 15),
      namedNodeCreated(R3_CREATED_ID, READING_3, 'reading 3 wording', 16),
      namedEntityIncluded(READING_3, 17),
      interpretiveSplitProposalEvent(18),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: interpretiveSplitProposalEvent(18) });
    await flushMicrotasks();

    // Exactly 3 envelopes — one per reading. Pins that the listener
    // walks the `readings` array (not just `components`).
    expect(captured).toHaveLength(3);

    for (const env of captured) {
      expect(env.type).toBe('proposal-status');
      if (env.type !== 'proposal-status') throw new Error('narrowing');
      expect(env.payload.sessionId).toBe(SESSION_A);
      expect(env.payload.proposalId).toBe(INTERPRETIVE_PROPOSAL);
      expect(env.payload.sequence).toBe(18);
      expect(env.payload.perFacetStatus).toEqual({ classification: 'proposed' });
    }

    const ids = captured.map((env) => env.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('Case C — withdrawn decompose: no `proposal-status` envelope when proposal is gone from projection', async () => {
    // Per D3: the withdraw arm emits N × `entity-removed` events, which
    // are NOT in `STATUS_AFFECTING_KINDS` so the listener returns
    // early on them. If a synthetic case re-triggers the listener with
    // the original `proposal` event against a post-withdraw projection
    // (where the proposal is no longer in `pendingProposals`),
    // `lookupProposalPayload` returns `null` and no envelope is
    // emitted (the existing "proposal not found" warn-log fires).
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger, lines } = captureLogger();

    // Sub-case 1 — the `entity-removed` events themselves do NOT
    // trigger any broadcast (they are filtered out at the top of the
    // listener by `STATUS_AFFECTING_KINDS`).
    const loaderShouldNotBeCalled = (): Promise<Event[]> =>
      Promise.reject(new Error('loader must not be called for entity-removed events'));
    const filterListener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: loaderShouldNotBeCalled,
      log: logger,
    });
    filterListener({ event: entityRemoved(C1_CREATED_ID, COMPONENT_1, 17) });
    filterListener({ event: entityRemoved(C2_CREATED_ID, COMPONENT_2, 18) });
    await flushMicrotasks();
    expect(captured).toHaveLength(0);

    // Sub-case 2 — a synthetic re-trigger of the original `proposal`
    // event against a post-withdraw projection (where the proposal is
    // no longer in `pendingProposals` because the actual withdraw
    // handler does not append a follow-up `proposal` event; this
    // simulates the "proposal not found" path). The loader returns
    // the prefix up to and including the propose, but with the
    // pending proposal lifted out via not appending the
    // entity-removed events — instead, we present a projection where
    // the proposal NEVER existed. We achieve this by loading a
    // truncated prefix (sessionCreated + participants + parent) so
    // `lookupProposalPayload` returns null for the proposal id.
    const lookupListener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () =>
        Promise.resolve([
          sessionCreated(1),
          hostJoined(2),
          participantJoined(DEBATER_A, 3, 'debater-A'),
          participantJoined(DEBATER_B, 4, 'debater-B'),
        ]),
      log: logger,
    });
    lookupListener({ event: decomposeProposalEvent(16) });
    await flushMicrotasks();

    expect(captured).toHaveLength(0);
    // The "proposal not found in projection" warn line fires for the
    // synthetic re-trigger — per D3.b this is the existing branch and
    // is not modified by this task.
    const notFoundLine = lines.find((l) =>
      String(l.msg).startsWith('ws-proposal-status: proposal not found in projection'),
    );
    expect(notFoundLine).toBeDefined();
    expect(notFoundLine?.ctx['proposalId']).toBe(DECOMPOSE_PROPOSAL);
  });

  it('Case D — committed decompose emits N envelopes per the standard derivation rules', async () => {
    // Per the projection's `handleCommit` per-facet stamping loop
    // (`apps/server/src/projection/replay.ts`, the plural
    // `facetTargetsForProposal` helper landed in
    // `replay_decompose_commit_marks_component_classification_committed`):
    // commit of a decompose sets `parent.visible = false` AND stamps
    // each component's `classificationFacet.committedProposalEventId`
    // + `committedAt` with the parent proposal event's id and the
    // commit event's `committed_at`. `deriveFacetStatus` rule 5 then
    // returns `'committed'` for each component's classification facet.
    // The wire-shape contract being pinned by this case is:
    //
    //   1. The listener fires N envelopes per component on a commit
    //      trigger for a decompose proposal (per-component
    //      multiplicity stays consistent across the propose / commit
    //      lifecycle transitions).
    //   2. Each envelope carries `payload.sequence` == the commit
    //      event's sequence (NOT the propose event's sequence).
    //   3. Each envelope's `perFacetStatus` is exactly
    //      `{ classification: 'committed' }` — the value, not just the
    //      shape, is pinned, because the projector's per-component
    //      stamping is the cross-layer contract this listener depends
    //      on.
    const subscriptions = new WsSubscriptionRegistry();
    const connectionSenders = new WsConnectionSenderRegistry();
    const captured = setupConnection(subscriptions, connectionSenders, CONN_1, SESSION_A);
    const { logger } = captureLogger();

    const events: Event[] = [
      ...preDecomposePrefix(),
      namedNodeCreated(C1_CREATED_ID, COMPONENT_1, 'component 1 wording', 12),
      namedEntityIncluded(COMPONENT_1, 13),
      namedNodeCreated(C2_CREATED_ID, COMPONENT_2, 'component 2 wording', 14),
      namedEntityIncluded(COMPONENT_2, 15),
      decomposeProposalEvent(16),
      // Unanimous-agree across the 3 current participants for the
      // decompose proposal — sets up `commit` to be valid per the
      // dispatcher's commit-rule (the methodology engine validates
      // commit-only-when-agreed; the projection trusts the prefix).
      namedVote(DECOMPOSE_VOTE_HOST, DECOMPOSE_PROPOSAL, HOST_USER, 17, 'agree'),
      namedVote(DECOMPOSE_VOTE_A, DECOMPOSE_PROPOSAL, DEBATER_A, 18, 'agree'),
      namedVote(DECOMPOSE_VOTE_B, DECOMPOSE_PROPOSAL, DEBATER_B, 19, 'agree'),
      namedCommit(DECOMPOSE_COMMIT, DECOMPOSE_PROPOSAL, 20),
    ];
    const listener = buildProposalStatusBroadcastListener({
      subscriptions,
      connectionSenders,
      loadEvents: () => Promise.resolve(events),
      log: logger,
    });

    listener({ event: namedCommit(DECOMPOSE_COMMIT, DECOMPOSE_PROPOSAL, 20) });
    await flushMicrotasks();

    // Exactly 2 envelopes — one per component. The per-component
    // multiplicity is the load-bearing assertion: receivers observe N
    // status frames on commit, matching the N propose-time frames.
    expect(captured).toHaveLength(2);

    for (const env of captured) {
      expect(env.type).toBe('proposal-status');
      if (env.type !== 'proposal-status') throw new Error('narrowing');
      expect(env.payload.sessionId).toBe(SESSION_A);
      expect(env.payload.proposalId).toBe(DECOMPOSE_PROPOSAL);
      // The commit event's sequence is on the envelope, not the
      // proposal event's.
      expect(env.payload.sequence).toBe(20);
      // The `perFacetStatus` key is `classification` (the only facet
      // emitted per D6) and the value is `'committed'` — pinned by
      // the projector's per-component stamping in
      // `replay_decompose_commit_marks_component_classification_committed`.
      expect(env.payload.perFacetStatus).toEqual({ classification: 'committed' });
    }

    // Distinct UUIDs per envelope.
    const ids = captured.map((env) => env.id);
    expect(new Set(ids).size).toBe(2);
  });
});
