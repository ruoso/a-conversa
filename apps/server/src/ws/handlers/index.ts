// Fastify plugin that registers every WS message handler this server
// owns against `app.wsDispatcher`.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//
// **Why a single plugin (not one per handler).** Today the handler
// surface is two functions (subscribe, unsubscribe). Each downstream
// `websocket_protocol` message-type task (`ws_propose_message`,
// `ws_vote_message`, ...) will add its own register call here. Keeping
// one plugin keeps the registration order explicit + the dispatcher
// dependency centralized.
//
// **Why this plugin must register after `wsDispatcherPlugin` and
// `wsSubscriptionsPlugin`.** It reaches for `app.wsDispatcher` and
// `app.wsSubscriptions` at registration time. The `createServer`
// factory in `server.ts` registers the dispatcher + subscriptions
// plugins via `wsConnectionHandlingPlugin` (which composes them); the
// handlers plugin registers AFTER `wsConnectionHandlingPlugin` so the
// decorations are already in place.
//
// **Pool resolution mirrors `wsConnectionHandlingPlugin`.** Lazy by
// default (reach for `getDefaultPool()` on first dispatch) — explicit
// when an option-passing test injects a pool up front.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { getDefaultPool, type DbPool } from '../../db.js';

import {
  registerCatchUpHandlers,
  resolveCatchUpMaxEvents,
  resolveCatchUpRateLimit,
} from './catch-up.js';
import { registerCommitHandlers } from './commit.js';
import { registerMarkMetaDisagreementHandlers } from './meta-disagreement.js';
import { registerProposeHandlers } from './propose.js';
import { registerSnapshotHandlers } from './snapshot.js';
import { registerSubscribeHandlers } from './subscribe.js';
import { registerVoteHandlers } from './vote.js';
import { registerWithdrawProposalHandlers } from './withdraw.js';

export {
  buildSubscribeHandler,
  buildUnsubscribeHandler,
  registerSubscribeHandlers,
} from './subscribe.js';
export type { SubscribeHandlerOptions } from './subscribe.js';

export { buildProposeHandler, registerProposeHandlers } from './propose.js';
export type { ProposeHandlerOptions } from './propose.js';

export { buildVoteHandler, registerVoteHandlers } from './vote.js';
export type { VoteHandlerOptions } from './vote.js';

export { buildCommitHandler, registerCommitHandlers } from './commit.js';
export type { CommitHandlerOptions } from './commit.js';

export {
  buildMarkMetaDisagreementHandler,
  registerMarkMetaDisagreementHandlers,
} from './meta-disagreement.js';
export type { MarkMetaDisagreementHandlerOptions } from './meta-disagreement.js';

export {
  buildSnapshotHandler,
  registerSnapshotHandlers,
  serializeProjectionForWire,
} from './snapshot.js';
export type { SnapshotHandlerOptions } from './snapshot.js';

export {
  buildCatchUpHandler,
  registerCatchUpHandlers,
  resolveCatchUpMaxEvents,
  resolveCatchUpRateLimit,
  clearCatchUpRateStateForConnection,
  DEFAULT_WS_CATCHUP_MAX_EVENTS,
  MAX_CATCH_UP_EVENTS_CEILING,
  WS_CATCHUP_MAX_EVENTS_ENV,
  DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE,
  CATCH_UP_RATE_LIMIT_WINDOW_MS,
  WS_CATCH_UP_RATE_LIMIT_ENV,
  WS_TOO_MANY_CATCH_UP_REQUESTS_CODE,
} from './catch-up.js';
export type { CatchUpHandlerOptions } from './catch-up.js';

export { buildWithdrawProposalHandler, registerWithdrawProposalHandlers } from './withdraw.js';
export type { WithdrawProposalHandlerOptions } from './withdraw.js';

/**
 * Options accepted by `wsHandlersPlugin`. Production callers pass `{}`
 * (or nothing) and the plugin reaches for `getDefaultPool()` on first
 * dispatch. Tests pass a memory-backed or pglite-backed pool so the
 * visibility predicate hits the test DB.
 */
export interface WsHandlersOptions {
  /**
   * Database pool used by the `subscribe` handler's
   * `canSeeSession(pool, sessionId, userId)` check. When absent the
   * plugin lazily calls `getDefaultPool()` on first invocation.
   */
  readonly pool?: DbPool;
  /**
   * Snapshot-fallback threshold for the `catch-up` handler. When the
   * gap between the client's `sinceSequence` and the server's
   * `MAX(sequence)` exceeds this number, the handler skips per-event
   * replay and sends a snapshot instead. Defaults to the env-resolved
   * value (`WS_CATCHUP_MAX_EVENTS` or 500 when absent). Tests inject
   * small values to exercise both branches deterministically. See
   * `tasks/refinements/backend/ws_reconnection_handling.md`.
   */
  readonly catchUpMaxEvents?: number;
  /**
   * Per-connection rate-limit cap on `catch-up` envelopes per
   * 60-second window. Defaults to the env-resolved value
   * (`WS_CATCH_UP_MAX_PER_MINUTE` or 10 when absent). Tests inject
   * small values (e.g. 2) so the rate-limit assertion can fire in a
   * small handful of envelopes. Closes
   * `docs/security/m3-review/inputs.md` F-004. See
   * `tasks/refinements/backend-hardening/catch_up_event_limit.md`.
   */
  readonly catchUpRateLimitPerWindow?: number;
  /**
   * Clock override for hermetic rate-limit tests. Production callers
   * pass nothing — the handler reads `Date.now`. Tests pass a fixed
   * value so window-reset assertions are deterministic.
   */
  readonly now?: () => number;
}

const wsHandlersPluginAsync: FastifyPluginAsync<WsHandlersOptions> = (
  app: FastifyInstance,
  opts: WsHandlersOptions,
) => {
  // Lazy pool resolution — same pattern `wsConnectionHandlingPlugin`
  // uses. Tests inject the pool up front; production callers pass `{}`
  // and the singleton pool resolves on the first `subscribe` message.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  // The handler closure captures `ensurePool` indirectly via a getter
  // — `canSeeSession` takes the pool by value, so we have to resolve
  // it eagerly per-call. The lookup is O(1) on the closure variable
  // after the first call.
  registerSubscribeHandlers(app.wsDispatcher, {
    // Wrap the lazy resolver as a property-getter so callers see the
    // resolved pool on each dispatch. `pool` is the value `canSeeSession`
    // expects, so the proxy below presents the lazily-resolved pool
    // through the same SubscribeHandlerOptions shape.
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    log: app.log,
  });

  // Register the propose handler. Same lazy-pool resolution as
  // subscribe (the `propose` path runs `canSeeSession` + a
  // transactional load/append). The handler also captures the
  // per-instance broadcast bus (`app.wsBroadcast`) so the post-
  // commit-emit step fans out the `event-applied` envelope.
  registerProposeHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    broadcast: app.wsBroadcast,
    log: app.log,
  });

  // Register the vote handler. Structurally identical to the propose
  // registration — same gate stack, same dual-signal contract, same
  // dispatcher-seam error path. The handler delegates per-arm
  // (`agree` / `dispute` / `withdraw`) rules to the methodology
  // engine's `voteHandler`.
  registerVoteHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    broadcast: app.wsBroadcast,
    log: app.log,
  });

  // Register the commit handler. Structurally identical to the
  // propose / vote registrations — same gate stack + dual-signal
  // contract + dispatcher-seam error path. The handler delegates
  // moderator-only authority (`not-a-moderator`) and unanimity
  // (`unanimous-agree-required`) to the methodology engine's
  // `commitHandler`.
  registerCommitHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    broadcast: app.wsBroadcast,
    log: app.log,
  });

  // Register the mark-meta-disagreement handler. Structurally
  // identical to the commit registration — same gate stack +
  // dual-signal contract + dispatcher-seam error path. The handler
  // delegates moderator-only authority (`not-a-moderator`),
  // proposal-state checks (`proposal-already-committed` /
  // `proposal-already-meta-disagreement`), the methodology-exhaustion
  // gate (`methodology-not-exhausted`), and the structural-sub-kind
  // boundary (`illegal-state-transition`) to the methodology engine's
  // `markMetaDisagreementHandler`.
  registerMarkMetaDisagreementHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    broadcast: app.wsBroadcast,
    log: app.log,
  });

  // Register the snapshot handler. Unlike the four write handlers
  // above, this is a read-only request — the handler runs the same
  // subscribe-before-act + visibility gate stack, loads the event
  // log, builds the projection via `projectFromLog`, and sends a
  // `snapshot-state` response on the requesting client's socket. No
  // broadcast bus, no transaction. The handler implements
  // Interpretation A (state-query catch-up) of the WBS task; see the
  // refinement Decisions for the choice rationale.
  registerSnapshotHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    log: app.log,
  });

  // Register the catch-up handler — server-side surface for client
  // reconnection with state catch-up. The handler runs the same
  // subscribe-before-act + visibility gates, then either streams
  // missing `event-applied` envelopes for a slice
  // `(sinceSequence, currentMax]` (reusing the live broadcast's
  // envelope type so clients route both through one reducer), or
  // sends a `snapshot-state` (reusing the snapshot handler's
  // `serializeProjectionForWire`) when the gap exceeds the
  // configurable threshold. The threshold defaults to the env-
  // resolved value (`WS_CATCHUP_MAX_EVENTS` or 500) — tests inject
  // small values to exercise both branches deterministically. See
  // `tasks/refinements/backend/ws_reconnection_handling.md` for the
  // shape choice rationale + the dedup contract clients honour.
  const catchUpThreshold = opts.catchUpMaxEvents ?? resolveCatchUpMaxEvents();
  const catchUpRateLimit = opts.catchUpRateLimitPerWindow ?? resolveCatchUpRateLimit();
  registerCatchUpHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    log: app.log,
    maxCatchUpEvents: catchUpThreshold,
    rateLimitPerWindow: catchUpRateLimit,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  // Register the withdraw-proposal handler — proposer-only retraction
  // of a pending proposal. Structurally mirrors the commit /
  // mark-meta-disagreement registration (same gate stack + dual-signal
  // contract + dispatcher-seam error path). The handler enforces the
  // authority + state predicates directly (per D1 of the refinement:
  // no engine routing for v1); it emits one `entity-removed` event
  // per entity the propose-time fan-out minted (per ADR 0027) — the
  // INVERSE of `buildStructuralEventsForPropose`.
  registerWithdrawProposalHandlers(app.wsDispatcher, {
    get pool() {
      return ensurePool();
    },
    registry: app.wsSubscriptions,
    broadcast: app.wsBroadcast,
    log: app.log,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  return Promise.resolve();
};

/**
 * Public entry point — register AFTER `wsConnectionHandlingPlugin`
 * (which decorates the dispatcher + the subscriptions registry).
 */
export const wsHandlersPlugin = fp(wsHandlersPluginAsync, {
  name: 'a-conversa-ws-handlers',
  fastify: '5.x',
});
