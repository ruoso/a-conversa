// In-process per-(connection, session) subscription registry + plugin.
//
// Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
//             tasks/refinements/backend-hardening/subscription_cap_per_connection.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_subscribe_to_session
//              backend_hardening.resource_limits_and_dos.subscription_cap_per_connection
//
// **What this module owns.**
//
// `WsSubscriptionRegistry` — a per-server-instance bookkeeping table
// that records which authenticated connections are subscribed to which
// sessions. Used by:
//
//   1. The `subscribe` / `unsubscribe` message handlers (this task's
//      siblings under `./handlers/`) — they call `subscribe(...)` /
//      `unsubscribe(...)` after the visibility gate clears.
//   2. The connection-close path in `connection.ts` — calls
//      `removeConnection(connectionId)` so a dropped socket doesn't
//      leave dangling subscriptions in the registry.
//   3. The future `ws_event_broadcast` task — will reach for
//      `connectionsForSession(sessionId)` to iterate the connections
//      that should receive a fan-out frame.
//
// **Storage shape — bidirectional maps.** Two `Map<string, Set<string>>`
// tables:
//
//   - `bySession: Map<sessionId, Set<connectionId>>`
//   - `byConnection: Map<connectionId, Set<sessionId>>`
//
// The two tables together turn every public-surface operation into
// O(1) on the relevant index:
//
//   - `subscribe(conn, sess)` — two `Set.add` calls.
//   - `unsubscribe(conn, sess)` — two `Set.delete` calls.
//   - `connectionsForSession(sess)` — one `Map.get`.
//   - `sessionsForConnection(conn)` — one `Map.get`.
//   - `removeConnection(conn)` — iterate `byConnection.get(conn)` once,
//     remove the connection from each session's set, then delete the
//     connection's entry.
//
// Single-map alternatives (e.g. only `bySession` + a scan in
// `removeConnection`) would force O(N_sessions) on close, which is the
// hottest path under churn (every disconnected client triggers it).
// Two-map storage trades a tiny memory overhead (the connection side
// duplicates the membership info) for predictable close-time cost.
//
// **In-process / per-instance.** This registry lives in the server
// process. A horizontally-scaled deployment (multiple `apps/server`
// instances behind a load-balancer) would NOT see broadcasts emitted on
// one instance reach subscribers connected to another — each registry
// is local to its instance. **Clustering / multi-instance fan-out is
// out of scope for this task.** Two future paths recover the property:
//
//   1. `ws_reconnection_handling` lets a client reconnect (to any
//      instance) and replay state from the data-model. The new
//      instance reconstructs the subscription via the same
//      `subscribe` handler — visibility is re-checked, the registry
//      is repopulated locally.
//   2. A future cluster-fanout layer (NOT specified yet — out of
//      scope for the M3 milestone) would publish broadcasts to a
//      message bus that every instance subscribes to. The registry's
//      shape doesn't change; the broadcast surface does.
//
// **Idempotence.** `subscribe(conn, sess)` is idempotent — re-subscribing
// is a no-op. `unsubscribe(conn, sess)` is idempotent — unsubscribing
// from a tuple that isn't in the registry is a no-op. The handlers
// emit the ack envelope in both cases (the client's request-response
// correlation stays consistent regardless of registry state).

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { UnsubscribedReason, WsEnvelope } from '@a-conversa/shared-types';

import { canSeeSession, type VisibilityExecutor } from '../sessions/visibility.js';
import type { WsConnectionSenderRegistry } from './broadcast/connections.js';

/**
 * Default per-connection subscription cap. Closes
 * `docs/security/m3-review/inputs.md` F-001.
 *
 * Rationale for 32: a legitimate moderator UI may reasonably watch
 * a handful of concurrent sessions (e.g. while supervising parallel
 * breakout debates), so the cap has to be generous enough that no
 * legitimate UI flow trips it; but no UX known to the project lists
 * dozens of sessions in a single connection's working set. 32 is
 * roughly an order of magnitude over the largest realistic legitimate
 * fan-out (4-8 concurrent sessions for a senior moderator) — so a
 * legitimate operator never sees the cap, and an attacker's
 * fan-out is bounded at a value that keeps the registry + broadcast
 * cost per connection trivial.
 *
 * The cap is **per-connection, not per-user**. Two open tabs from
 * the same user are two connections; each gets its own 32-slot
 * budget. A per-user aggregate cap is a separate concern (different
 * threat model — collusion / many-tab abuse rather than the
 * single-connection-subscribes-to-thousands attack F-001
 * documents). See the refinement document for the rationale.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/subscription_cap_per_connection.md.
 */
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 32;

/**
 * Env var name production reads to override
 * `MAX_SUBSCRIPTIONS_PER_CONNECTION`. Exported so the
 * production wiring + the test surface share one constant.
 */
export const WS_MAX_SUBSCRIPTIONS_PER_CONNECTION_ENV = 'WS_MAX_SUBSCRIPTIONS_PER_CONNECTION';

/**
 * Subset of `process.env` consumed by
 * `resolveMaxSubscriptionsPerConnection`. Typed so callers can pass
 * `process.env` directly (same pattern as `BodyLimitEnv` /
 * `FlowStateMaxEntriesEnv`).
 */
export interface MaxSubscriptionsPerConnectionEnv {
  readonly WS_MAX_SUBSCRIPTIONS_PER_CONNECTION?: string | undefined;
}

/**
 * Resolve the per-connection subscription cap from the environment.
 * Returns `MAX_SUBSCRIPTIONS_PER_CONNECTION` (32) when the env var
 * is absent, empty, unparseable, or non-positive; returns the
 * parsed integer otherwise.
 *
 * Mirrors `resolveBodyLimit` / `resolveCatchUpMaxEvents` /
 * `resolveFlowStateMaxEntries` — the production code path reads the
 * env once at plugin registration time; tests inject the value
 * directly via the registry's constructor option to keep the
 * verification hermetic.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/subscription_cap_per_connection.md.
 */
export function resolveMaxSubscriptionsPerConnection(
  env: MaxSubscriptionsPerConnectionEnv = process.env,
): number {
  const raw = env.WS_MAX_SUBSCRIPTIONS_PER_CONNECTION;
  if (raw === undefined || raw === '') {
    return MAX_SUBSCRIPTIONS_PER_CONNECTION;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_SUBSCRIPTIONS_PER_CONNECTION;
  }
  return parsed;
}

/**
 * Typed error thrown by `WsSubscriptionRegistry.subscribe(...)` when
 * the per-connection cap is reached and the caller is trying to add a
 * NEW session to the connection's set. The subscribe handler catches
 * this and emits the canonical `error` envelope with
 * `code: 'too-many-subscriptions'` so the client sees the cap rather
 * than a silent drop.
 *
 * Carries no internal state details (no `cap` field, no occupancy
 * count) — keeps the symbol out of any wire shape so a future
 * `JSON.stringify(err)` cannot leak the cap value. Mirrors the
 * `FlowStateCapacityError` shape used by the
 * `flow_state_map_bound` sibling task.
 */
export class SubscriptionCapacityError extends Error {
  override readonly name = 'SubscriptionCapacityError';
  constructor(message = 'subscription cap reached for this connection') {
    super(message);
  }
}

/**
 * Options accepted by `WsSubscriptionRegistry`'s constructor. The
 * single-option shape mirrors `createFlowStateStore` — production
 * callers pass nothing (defaults), tests pass the override.
 */
export interface WsSubscriptionRegistryOptions {
  /**
   * Cap on `byConnection.get(connectionId).size`. Defaults to
   * `MAX_SUBSCRIPTIONS_PER_CONNECTION` (32) when absent; the
   * production wiring (`wsSubscriptionsPlugin`) reads the env via
   * `resolveMaxSubscriptionsPerConnection` so an operator can lift
   * the cap without a code change. Tests pass small values (e.g.
   * `{ maxSubscriptionsPerConnection: 3 }`) to exercise the cap
   * boundary deterministically.
   *
   * Must be a positive integer; the constructor does NOT validate
   * (the resolver does that on the env path; explicit-option callers
   * are trusted to pass a sensible value).
   */
  readonly maxSubscriptionsPerConnection?: number;
}

/**
 * Per-server-instance subscription registry. Maintains two indices
 * (session → connections, connection → sessions) so every public-API
 * operation is O(1) on the relevant side.
 *
 * Created by `wsSubscriptionsPlugin` and decorated onto
 * `app.wsSubscriptions`; sibling plugins (handlers, the broadcast
 * surface) reach for it via `app.wsSubscriptions.<method>(...)`.
 */
export class WsSubscriptionRegistry {
  /** sessionId -> set of connectionIds subscribed to that session. */
  private readonly bySession = new Map<string, Set<string>>();
  /** connectionId -> set of sessionIds the connection is subscribed to. */
  private readonly byConnection = new Map<string, Set<string>>();
  /**
   * connectionId -> authenticated userId. Parallel index populated by
   * `subscribe(connectionId, sessionId, userId)` when the third
   * argument is supplied. The privacy-flip pruner
   * (`pruneSubscribersForPrivateSession` below) reads from this map to
   * evaluate `canSeeSession(pool, sessionId, userId)` for each
   * subscriber.
   *
   * **Per-connection, not per-(connection, session).** A connection is
   * authenticated once at upgrade time; every subscription it holds
   * belongs to the same user. Storing the binding once per connection
   * (rather than per tuple) keeps the index small and matches the
   * lifecycle: the binding is allocated when the connection first
   * subscribes and cleared on `removeConnection`.
   *
   * **Optional binding.** Anonymous-subscribe callers (per ADR 0029)
   * and legacy two-argument call sites pass
   * `subscribe(connectionId, sessionId)` without a userId;
   * `userForConnection` returns `undefined` for those. The pruner's
   * anonymous branch evicts such entries unconditionally on a
   * privacy flip (an anonymous viewer can never see a private
   * session by construction). Refinement:
   *   tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md
   *   tasks/refinements/audience/aud_anonymous_ws_subscribe.md.
   */
  private readonly userByConnection = new Map<string, string>();
  /**
   * Hard ceiling on `byConnection.get(connectionId).size`. Resolved
   * at construction time so the cap is fixed for the registry's
   * lifetime — runtime mutation would invalidate the
   * already-accepted-subscriptions contract.
   */
  private readonly maxSubscriptionsPerConnection: number;

  constructor(options: WsSubscriptionRegistryOptions = {}) {
    this.maxSubscriptionsPerConnection =
      options.maxSubscriptionsPerConnection ?? MAX_SUBSCRIPTIONS_PER_CONNECTION;
  }

  /**
   * Add a (connection, session) subscription. Idempotent — calling
   * twice with the same tuple is a no-op (the underlying `Set.add`
   * is itself idempotent; both indices remain consistent).
   *
   * **Cap enforcement.** Before recording a NEW (connectionId,
   * sessionId) pair, the method checks
   * `byConnection.get(connectionId).size >= maxSubscriptionsPerConnection`:
   *
   *   - At cap AND `sessionId` already in the set: idempotent
   *     no-op (the existing subscription stays). Re-subscribing to
   *     something already subscribed must not be artificially
   *     blocked by the cap.
   *   - At cap AND `sessionId` is new: throws
   *     `SubscriptionCapacityError`. The subscribe handler catches
   *     this and emits an `error` envelope with
   *     `code: 'too-many-subscriptions'`.
   *   - Below cap: proceeds as before.
   *
   * Closes `docs/security/m3-review/inputs.md` F-001.
   *
   * **`userId` binding (optional).** Production callers (the WS
   * subscribe handler) pass the authenticated user's id as the third
   * argument; the registry stores it in `userByConnection` so the
   * privacy-flip pruner can later evaluate
   * `canSeeSession(pool, sessionId, userId)` for each subscriber.
   * Legacy two-argument calls (existing tests that fabricate registry
   * entries) still work — the connection just doesn't carry a user
   * binding, and the pruner skips it with a warn log. Re-subscribing
   * with a different `userId` replaces the prior binding (this is the
   * defensive shape; real connections never re-bind because the
   * connection-level auth is fixed at upgrade time).
   *
   * @param connectionId the WS connection's stable id (the
   *                     `WsConnectionContext.connectionId`).
   * @param sessionId the session id the client wants events for.
   * @param userId the authenticated user id (`connection.user.id`).
   *               Optional for back-compat with existing tests that
   *               fabricate registry entries without an auth surface.
   * @throws {SubscriptionCapacityError} when the connection is at the
   *         cap and `sessionId` is not already in its set.
   */
  subscribe(connectionId: string, sessionId: string, userId?: string): void {
    const existing = this.byConnection.get(connectionId);
    if (
      existing !== undefined &&
      existing.size >= this.maxSubscriptionsPerConnection &&
      !existing.has(sessionId)
    ) {
      throw new SubscriptionCapacityError();
    }

    let conns = this.bySession.get(sessionId);
    if (conns === undefined) {
      conns = new Set();
      this.bySession.set(sessionId, conns);
    }
    conns.add(connectionId);

    let sessions = existing;
    if (sessions === undefined) {
      sessions = new Set();
      this.byConnection.set(connectionId, sessions);
    }
    sessions.add(sessionId);

    if (userId !== undefined) {
      this.userByConnection.set(connectionId, userId);
    }
  }

  /**
   * Remove a (connection, session) subscription. Idempotent —
   * unsubscribing a tuple that isn't in the registry is a no-op.
   * Empty sets are pruned (the map entry is deleted) so the registry
   * doesn't leak per-session or per-connection allocations after
   * churn.
   *
   * @param connectionId the WS connection's stable id.
   * @param sessionId the session id to stop streaming.
   */
  unsubscribe(connectionId: string, sessionId: string): void {
    const conns = this.bySession.get(sessionId);
    if (conns !== undefined) {
      conns.delete(connectionId);
      if (conns.size === 0) {
        this.bySession.delete(sessionId);
      }
    }
    const sessions = this.byConnection.get(connectionId);
    if (sessions !== undefined) {
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        this.byConnection.delete(connectionId);
      }
    }
  }

  /**
   * Snapshot of the connections subscribed to `sessionId`. Returned as
   * a fresh array (NOT a live view into the internal Set) so callers
   * iterating the snapshot can't mutate the registry mid-iteration —
   * important for the future broadcast surface, which may emit frames
   * that trigger re-entrant `unsubscribe` calls from misbehaving
   * clients.
   *
   * Empty array when nothing is registered for the session — does NOT
   * distinguish "no one subscribed" from "session doesn't exist". The
   * registry is a routing table, not a session-existence oracle; the
   * `canSeeSession` predicate (called by the handler before
   * `subscribe`) is the one that answers existence + visibility.
   *
   * @returns a readonly snapshot of subscribed connection ids.
   */
  connectionsForSession(sessionId: string): readonly string[] {
    const conns = this.bySession.get(sessionId);
    return conns === undefined ? [] : [...conns];
  }

  /**
   * Snapshot of the sessions `connectionId` is subscribed to. Same
   * snapshot semantics as `connectionsForSession`. Used by the
   * connection-close path to log what was dropped + by tests to assert
   * the post-conditions of the lifecycle.
   *
   * @returns a readonly snapshot of subscribed session ids.
   */
  sessionsForConnection(connectionId: string): readonly string[] {
    const sessions = this.byConnection.get(connectionId);
    return sessions === undefined ? [] : [...sessions];
  }

  /**
   * Look up the authenticated user id bound to `connectionId` at
   * subscribe time. Returns `undefined` when:
   *
   *   - The connection has no subscriptions in the registry.
   *   - The connection subscribed via the legacy two-argument
   *     `subscribe(connId, sessId)` shape (existing tests).
   *
   * Used by `pruneSubscribersForPrivateSession` (this module) to
   * evaluate `canSeeSession(pool, sessionId, userId)` for each
   * subscriber when a session's privacy flips to private.
   *
   * @param connectionId the WS connection's stable id.
   * @returns the bound userId or `undefined`.
   */
  userForConnection(connectionId: string): string | undefined {
    return this.userByConnection.get(connectionId);
  }

  /**
   * Drop every subscription held by `connectionId`. Called by the
   * connection-close hook in `connection.ts` so a dropped socket
   * doesn't leak entries in either index.
   *
   * Iterates the snapshot once (O(N_sessions) where N is the number
   * of sessions THIS connection subscribed to — typically 1, since a
   * client usually subscribes to the one session it's participating
   * in). Each iteration is O(1) — a `Set.delete` on the
   * by-session index and possibly a `Map.delete` to prune.
   *
   * Wipes the user binding (`userByConnection`) in lock-step with the
   * two index entries — the binding's lifecycle is the connection's
   * lifecycle.
   *
   * Idempotent — calling with an unknown connection id is a no-op.
   */
  removeConnection(connectionId: string): void {
    const sessions = this.byConnection.get(connectionId);
    if (sessions === undefined) {
      // Even on the "unknown connection" path, defensively wipe the
      // user binding in case `subscribe(...)` was called without a
      // matching session add (impossible today, but the call is O(1)
      // and keeps the lifecycle airtight).
      this.userByConnection.delete(connectionId);
      return;
    }
    for (const sessionId of sessions) {
      const conns = this.bySession.get(sessionId);
      if (conns !== undefined) {
        conns.delete(connectionId);
        if (conns.size === 0) {
          this.bySession.delete(sessionId);
        }
      }
    }
    this.byConnection.delete(connectionId);
    this.userByConnection.delete(connectionId);
  }
}

// -- Privacy-flip subscription prune -------------------------------
//
// `pruneSubscribersForPrivateSession` is the single helper that walks
// the per-session subscription set when a session's privacy flips to
// `'private'`, re-runs the visibility predicate for each subscriber,
// and evicts any user who can no longer see the session. The helper
// is called by `PATCH /sessions/:id/privacy` (in
// `apps/server/src/sessions/routes.ts`) when the desired privacy is
// `'private'`. Refinement:
//   tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md.
// Closes `docs/security/m3-review/coverage.md` G-001.

/**
 * Options accepted by `pruneSubscribersForPrivateSession`. The shape
 * mirrors `EventAppliedBroadcastListenerOptions` — the subscription
 * registry + the connection-sender registry + a logger — plus the
 * visibility executor (a `DbPool` or transaction client) and the
 * `sessionId` whose privacy just flipped.
 */
export interface PruneSubscribersForPrivateSessionOptions {
  /** Per-app-instance subscription registry. */
  readonly subscriptions: WsSubscriptionRegistry;
  /** Per-app-instance connection-sender registry. */
  readonly connectionSenders: WsConnectionSenderRegistry;
  /**
   * Visibility executor — anything with a `query(text, params)` method
   * whose result has a `.rows` array. The production caller passes the
   * shared `DbPool`; tests pass an in-memory shim that mimics the SQL
   * surface the predicate consults.
   */
  readonly pool: VisibilityExecutor;
  /** The session id whose privacy just flipped to `'private'`. */
  readonly sessionId: string;
  /** Logger for per-connection warn-level error-isolation paths. */
  readonly log: FastifyBaseLogger;
}

/**
 * Walk every subscriber of `sessionId` and evict any whose
 * authenticated user can no longer see the session. For each evicted
 * connection:
 *
 *   1. Send a server-initiated `unsubscribed` envelope with
 *      `payload.reason = 'privacy-flipped'`. `inResponseTo` is absent
 *      (the frame is unsolicited; not correlated to any client
 *      request).
 *   2. Call `subscriptions.unsubscribe(connectionId, sessionId)` so
 *      future broadcasts skip this connection.
 *
 * **Why this exists.** The broadcast surface (`event-applied.ts`,
 * `diagnostic.ts`, `proposal-status.ts`) routes by the subscription
 * registry; it does NOT re-run `canSeeSession` per fan-out (that
 * would multiply the per-broadcast DB cost). The cheaper structural
 * fix is to keep the registry truthful: an entry exists IFF the user
 * can see the session right now. This helper enforces that invariant
 * on the one HTTP path that can flip a user's visibility from "yes"
 * to "no": `PATCH /sessions/:id/privacy` to `'private'`.
 *
 * **Per-connection error isolation.** Each connection's send +
 * unsubscribe is wrapped in a try/catch. One bad socket logs a warn
 * line and the loop continues; the helper's promise resolves
 * regardless. The caller's HTTP response is NEVER blocked by a slow
 * or broken WS connection — the UPDATE has already committed, the
 * response status is independent of fan-out success.
 *
 * **Participants are never pruned.** `canSeeSession` returns `true`
 * for the host AND for any current-or-past participant, regardless of
 * privacy. The predicate is the authoritative gate; this helper just
 * iterates and calls it.
 *
 * **Connections without a userId binding are evicted unconditionally.**
 * Per ADR 0029 + `aud_anonymous_ws_subscribe`, an anonymous subscriber
 * (`subscribe(connId, sessId)` with no userId argument) can never see
 * a private session by construction — the
 * `canSeeSessionAnonymously` predicate is strictly "public AND
 * not-ended". The pruner's anonymous branch drops the registry entry
 * and emits `unsubscribed { reason: 'privacy-flipped' }` without a
 * per-subscriber DB round trip.
 *
 * **`canSeeSession` failure is per-connection.** If the visibility
 * query itself rejects (pool exhausted, intermittent DB error), the
 * pruner logs a warn line for that connection and continues to the
 * next. The privacy bit DID flip; partial prune failure is a
 * degradation, not a state corruption.
 *
 * Closes `docs/security/m3-review/coverage.md` G-001. Refinement:
 *   tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md.
 */
export async function pruneSubscribersForPrivateSession(
  opts: PruneSubscribersForPrivateSessionOptions,
): Promise<void> {
  const { subscriptions, connectionSenders, pool, sessionId, log } = opts;
  const connectionIds = subscriptions.connectionsForSession(sessionId);
  if (connectionIds.length === 0) {
    return;
  }

  const reason: UnsubscribedReason = 'privacy-flipped';

  for (const connectionId of connectionIds) {
    const userId = subscriptions.userForConnection(connectionId);
    if (userId === undefined) {
      // **Anonymous subscriber** (per ADR 0029 +
      // `aud_anonymous_ws_subscribe`). An anonymous viewer can never
      // see a private session by construction — the
      // `canSeeSessionAnonymously` predicate is `privacy = 'public'
      // AND ended_at IS NULL`, which is trivially false on a session
      // that just flipped to private. The eviction is unconditional;
      // we skip the per-subscriber DB round trip the authenticated
      // path runs because the answer is constant.
      //
      // Emit the same `unsubscribed { reason: 'privacy-flipped' }`
      // envelope the authenticated eviction emits + drop the
      // registry entry. Per-connection error isolation: a send /
      // sender-missing failure logs at warn level and the loop
      // continues; the registry is dropped regardless to prevent a
      // post-flip broadcast leak.
      const envelope: WsEnvelope<'unsubscribed'> = {
        type: 'unsubscribed',
        id: randomUUID(),
        payload: { sessionId, reason },
      };
      const sender = connectionSenders.get(connectionId);
      if (sender === undefined) {
        // Defensive: the connection's sender has already been
        // unregistered (close hook ran between snapshot and this
        // iteration). Drop the registry entry to match.
        subscriptions.unsubscribe(connectionId, sessionId);
        continue;
      }
      try {
        sender(envelope);
      } catch (err) {
        log.warn(
          { err, sessionId, connectionId, anonymous: true },
          'ws-prune-privacy-flip: anonymous send failed — removing subscription anyway to prevent post-flip broadcast leak',
        );
      }
      subscriptions.unsubscribe(connectionId, sessionId);
      log.info(
        { sessionId, connectionId, anonymous: true, reason },
        'ws-prune-privacy-flip: anonymous subscriber evicted',
      );
      continue;
    }

    let visible: boolean;
    try {
      visible = await canSeeSession(pool, sessionId, userId);
    } catch (err) {
      // Per-connection isolation: a DB error on ONE visibility check
      // does not break the rest of the loop. Log + skip.
      log.warn(
        { err, sessionId, connectionId, userId },
        'ws-prune-privacy-flip: canSeeSession query failed — leaving subscription in place (next event-applied fan-out will skip this connection if the registry is cleaned later)',
      );
      continue;
    }

    if (visible) {
      // The user is the host or a participant — they keep the
      // subscription regardless of the privacy flip.
      continue;
    }

    const envelope: WsEnvelope<'unsubscribed'> = {
      type: 'unsubscribed',
      id: randomUUID(),
      payload: { sessionId, reason },
    };

    const sender = connectionSenders.get(connectionId);
    if (sender === undefined) {
      // The connection's sender has already been unregistered (the
      // close hook ran between the snapshot and this iteration).
      // Defensive: remove the subscription entry too — the close hook
      // would have done that via `removeConnection`, but if we're
      // racing it, double-removal is idempotent.
      subscriptions.unsubscribe(connectionId, sessionId);
      continue;
    }

    try {
      sender(envelope);
    } catch (err) {
      // Per-connection isolation: a send-failure on ONE socket does
      // not break the loop. We still remove the registry entry — the
      // user cannot see the session anymore, so leaving them
      // subscribed (and silent) would leak future broadcasts.
      log.warn(
        { err, sessionId, connectionId, userId },
        'ws-prune-privacy-flip: send failed — removing subscription anyway to prevent post-flip broadcast leak',
      );
    }

    subscriptions.unsubscribe(connectionId, sessionId);
    log.info(
      { sessionId, connectionId, userId, reason },
      'ws-prune-privacy-flip: subscriber evicted',
    );
  }
}

/**
 * Options accepted by `wsSubscriptionsPlugin`. Production callers
 * pass `{}` (or nothing) and the plugin resolves the cap from
 * `process.env` via `resolveMaxSubscriptionsPerConnection`. Tests
 * inject `maxSubscriptionsPerConnection` directly so the cap surface
 * can be exercised hermetically without mutating `process.env`.
 */
export interface WsSubscriptionsPluginOptions {
  /**
   * Override for the per-connection subscription cap. When absent,
   * the plugin reads `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION` from the
   * environment (default `MAX_SUBSCRIPTIONS_PER_CONNECTION` = 32).
   */
  readonly maxSubscriptionsPerConnection?: number;
}

/**
 * Fastify plugin: construct a `WsSubscriptionRegistry` per app instance
 * and decorate it onto `app.wsSubscriptions`. Mirror of the
 * `wsDispatcherPlugin` pattern — `fastify-plugin`-wrapped so the
 * decoration reaches the root scope, idempotent against re-registration.
 *
 * Each `createServer()` call gets its own registry; tests build a fresh
 * app per scenario, so there's no cross-test bleed.
 *
 * The registry's per-connection cap defaults to
 * `MAX_SUBSCRIPTIONS_PER_CONNECTION` (32) and can be overridden via
 * `WS_MAX_SUBSCRIPTIONS_PER_CONNECTION` (env) or the plugin option
 * (tests). Closes `docs/security/m3-review/inputs.md` F-001.
 */
const wsSubscriptionsPluginAsync: FastifyPluginAsync<WsSubscriptionsPluginOptions> = (
  app: FastifyInstance,
  opts: WsSubscriptionsPluginOptions,
) => {
  // Guard against re-decoration. Production registers the plugin once;
  // a defensive check keeps the failure mode explicit if a future test
  // pattern lands a second `createServer()` against the same instance.
  if (!app.hasDecorator('wsSubscriptions')) {
    const cap = opts.maxSubscriptionsPerConnection ?? resolveMaxSubscriptionsPerConnection();
    app.decorate(
      'wsSubscriptions',
      new WsSubscriptionRegistry({ maxSubscriptionsPerConnection: cap }),
    );
  }
  return Promise.resolve();
};

export const wsSubscriptionsPlugin = fp(wsSubscriptionsPluginAsync, {
  name: 'a-conversa-ws-subscriptions',
  fastify: '5.x',
});

// -- TypeScript augmentation ---------------------------------------
//
// Adds the `wsSubscriptions` field to `FastifyInstance`. Co-located
// with the runtime module (same trade-off `dispatcher.ts` makes —
// the type is owned here, so the augmentation lives here).

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The per-app-instance WS subscription registry. The `subscribe`
     * and `unsubscribe` message handlers reach for `subscribe(...)` /
     * `unsubscribe(...)`; the connection-close hook calls
     * `removeConnection(...)`; the future `ws_event_broadcast` task
     * will use `connectionsForSession(...)` to iterate broadcast
     * targets.
     */
    wsSubscriptions: WsSubscriptionRegistry;
  }
}
