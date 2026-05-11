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

import { registerCommitHandlers } from './commit.js';
import { registerMarkMetaDisagreementHandlers } from './meta-disagreement.js';
import { registerProposeHandlers } from './propose.js';
import { registerSubscribeHandlers } from './subscribe.js';
import { registerVoteHandlers } from './vote.js';

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
