// Dispatcher handler for `label-snapshot` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_label_snapshot_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_label_snapshot_message
//
// **What this module owns.**
//
// `buildLabelSnapshotHandler({ pool, registry, broadcast, log, now? })`
// — returns a `WsDispatcher` handler for the `'label-snapshot'`
// envelope. Structurally mirrors `buildMarkMetaDisagreementHandler`:
// same gate stack, same transactional load-validate-append, same
// post-commit dual-signal (`event-applied` broadcast +
// `snapshot-labeled` ack), same `rejectedToApiError` mapping to the
// wire `error` envelope via the dispatcher's `onHandlerError` seam.
//
// **Three deltas from the agreement-engine family.**
//
//   1. **No projection load.** `createSnapshot` is a standalone helper
//      (per `snapshot_create_logic.md` Decisions §"Standalone helper,
//      not a registered `ActionKind`") — it does not consume a
//      `Projection`. The handler does NOT call `projectFromLog` and
//      does NOT pass a projection to the engine.
//   2. **Moderator-only authority gate lives in the WS handler.** The
//      engine helper does no role gating; this handler performs the
//      check by comparing `connection.user.id` against the
//      `sessions.host_user_id` read under the FOR UPDATE lock, and
//      synthesizes a `RejectedValidationResult { reason: 'moderator-only' }`
//      on failure. The dispatcher seam echoes it as a wire `error
//      { code: 'moderator-only' }` (HTTP 403). The reason word
//      `'moderator-only'` (vs. the agreement-engine handlers'
//      `'not-a-moderator'`) matches the `mod_snapshot_label_input`
//      modal's wire-error vocabulary.
//   3. **Ack payload `{ snapshotId }`.** The handler sends a
//      `'snapshot-labeled'` ack carrying the `snapshot_id` minted by
//      the engine inside the `snapshot-created` payload — distinct
//      from the event envelope's `id`. The moderator's modal
//      correlates the success with the projection's incoming
//      snapshot record via this id.
//
// **Moderator identity comes from the connection, not the payload.**
// The handler reads `connection.user.id` and uses it as both the
// moderator-only check key AND the `createSnapshot` helper's
// `moderatorId` (which flows into the event envelope's `actor`).
// The request payload has NO `moderatorId` field — the wire schema
// `wsLabelSnapshotPayloadSchema` does not declare one. Symmetric
// with propose / vote / commit / mark-meta-disagreement. Pinned by
// the security-invariant unit test.
//
// **Engine-emitted events.** The engine's `createSnapshot` helper
// emits exactly ONE event (a `snapshot-created` event). The
// read-side projection's `addSnapshot` (run on every subscriber's
// local incremental `applyEvent` against the broadcast `event-applied`
// frame) is what inserts the snapshot into `projection.snapshots` —
// no additional wire frames are required.
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); anonymous connections are explicitly
//     rejected with `forbidden` before any gate runs.
//   - Schema validation of `payload`: enforced upstream by
//     `parseWsEnvelope` against `wsLabelSnapshotPayloadSchema`.
//   - Label trimming / length-checking: enforced by the engine helper
//     `createSnapshot`. The handler forwards the raw payload label
//     and trusts the returned envelope.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { createSnapshot } from '../../methodology/handlers/createSnapshot.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsBroadcastBus } from '../broadcast/bus.js';
import type { WsConnectionContext } from '../connection.js';
import type { WsDispatcher } from '../dispatcher.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Builder inputs — captured once at handler-registration time. Same
 * shape as `MarkMetaDisagreementHandlerOptions` / `CommitHandlerOptions`
 * / `VoteHandlerOptions` / `ProposeHandlerOptions`.
 */
export interface LabelSnapshotHandlerOptions {
  /** DB pool the visibility predicate + transactional writes run against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry — the subscribe-before-act gate. */
  readonly registry: WsSubscriptionRegistry;
  /** Per-instance broadcast bus — the post-commit `event-applied` emit. */
  readonly broadcast: WsBroadcastBus;
  /** Logger for diagnostics. */
  readonly log: FastifyBaseLogger;
  /**
   * Clock injection for the event envelope's `createdAt` field.
   * Defaulted to `Date.now` in production; tests pin a controllable
   * function so the payload is deterministic across runs.
   */
  readonly now?: () => number;
}

/**
 * Build the `label-snapshot` dispatcher handler. The returned closure
 * captures the pool / registry / broadcast / log / clock once; the
 * dispatcher invokes it per inbound `label-snapshot` envelope.
 */
export function buildLabelSnapshotHandler(
  opts: LabelSnapshotHandlerOptions,
): (envelope: WsEnvelope<'label-snapshot'>, connection: WsConnectionContext) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const { sessionId, expectedSequence, label } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // Anonymous client (per ADR 0029 + `aud_anonymous_ws_subscribe`).
      // Audience-role connections never write — reject with a wire
      // `forbidden` envelope so the client sees a typed code.
      throw ApiError.forbidden('this action requires an authenticated session', { sessionId });
    }

    // Gate 1 — subscribe-before-act. Identical to the agreement-engine
    // handlers' gate; the `'forbidden'` code is reused from the
    // existing `ApiError.code` taxonomy.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this label-snapshot surfaces as
    // not-found, inheriting the existence-non-leak rule from
    // `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Same shape as the
    // mark-meta-disagreement handler: FOR UPDATE on the `sessions`
    // row (which also gives us `host_user_id` for the moderator
    // check), MAX(sequence) read, engine helper call,
    // `validateEvent`, `appendSessionEvent`. The event appended
    // inside the transaction is captured for the post-COMMIT
    // broadcast emit.
    const appendedEvents: Event[] = [];
    let snapshotId: string | undefined;
    await withTransaction(opts.pool, async (client) => {
      // 1. FOR UPDATE on `sessions` — serialises concurrent appenders
      //    AND gives us the row's `host_user_id` so the moderator-only
      //    gate can run without a second query. Per refinement
      //    Decisions §3 the moderator role is read from the just-
      //    locked `sessions` row (the host IS the moderator at v1).
      const lookup = await client.query<{
        id: string;
        host_user_id: string;
        ended_at: Date | string | null;
      }>(
        `SELECT id, host_user_id, ended_at
         FROM sessions
         WHERE id = $1
         FOR UPDATE`,
        [sessionId],
      );
      const existing = lookup.rows[0];
      if (existing === undefined) {
        throw ApiError.notFound('session not found or not visible', { sessionId });
      }

      // 2. Moderator-only authority gate. Per refinement Decisions §2
      //    this lives in the WS handler (the engine helper does no
      //    role gating); the rejection reason `'moderator-only'`
      //    matches the `mod_snapshot_label_input` modal's wire-error
      //    vocabulary (distinct from the agreement-engine family's
      //    `'not-a-moderator'`).
      if (existing.host_user_id !== userId) {
        throw rejectedToApiError({
          ok: false,
          reason: 'moderator-only',
          detail: `label-snapshot: only the session moderator may mint a labeled snapshot (session ${sessionId})`,
        });
      }

      // 3. Application-managed monotonic sequence allocator.
      const maxRes = await client.query<{ max_seq: number | string | null }>(
        `SELECT COALESCE(MAX(sequence), 0) AS max_seq
         FROM session_events
         WHERE session_id = $1`,
        [sessionId],
      );
      const rawMax = maxRes.rows[0]?.max_seq ?? 0;
      const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;

      // 4. Optimistic-concurrency check. Mirrors mark-meta-disagreement
      //    (line 218-225 of meta-disagreement.ts) — `'sequence-mismatch'`
      //    is the engine's reason word; the modal renders it as the
      //    `'sequence-conflict'` localized message.
      if (expectedSequence !== maxSeq) {
        throw rejectedToApiError({
          ok: false,
          reason: 'sequence-mismatch',
          detail: `label-snapshot: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
        });
      }

      // 5. Call the standalone `createSnapshot` helper. Single source
      //    of truth for label validation + envelope minting (per
      //    `snapshot_create_logic.md` Constraints). The helper trims
      //    the label, runs the non-empty + length-cap checks, mints
      //    the envelope id + the payload's `snapshot_id`, and sets
      //    `sequence = currentSequence + 1` and `createdAt = now`.
      //    No projection argument — snapshots are not facets and the
      //    helper enforces no methodology-flow rule.
      const createdAtIso = new Date(nowFn()).toISOString();
      const result = createSnapshot({
        sessionId,
        moderatorId: userId,
        label,
        currentSequence: maxSeq,
        now: createdAtIso,
      });
      if (!result.ok) {
        // The engine helper's `'invalid-label'` rejection (empty
        // after trim, or over the 128-char cap) lands here;
        // `rejectedToApiError` maps it to HTTP 400 and the wire
        // surface emits `error { code: 'invalid-label' }`.
        throw rejectedToApiError(result);
      }
      // Defensive — pins the `createSnapshot` contract of exactly one
      // emitted event per success. A future engine arm that widened
      // the emitted-events count would surface loudly here rather
      // than silently iterating + broadcasting many frames.
      if (result.events.length !== 1) {
        throw new Error(
          `ws-label-snapshot: engine produced ${String(result.events.length)} events (expected 1)`,
        );
      }
      const emitted = result.events[0]!;

      // 6. Schema-on-write — every row in `session_events` is
      //    structurally valid by construction (ADR 0021).
      validateEvent(emitted);

      // 7. INSERT via the centralized append helper.
      appendedEvents.push(await appendSessionEvent(client, emitted));

      // Stash the snapshot id from the engine-minted payload for the
      // post-commit ack. The `snapshot_id` is distinct from the
      // envelope id (per `snapshot_create_logic.md` Decisions §3).
      const payload = emitted.payload as { snapshot_id: string };
      snapshotId = payload.snapshot_id;
    });

    // Post-commit emit + ack. Same ordering as the propose / vote /
    // commit / mark-meta-disagreement handlers: emit FIRST so every
    // subscribed client (including the moderator) receives the
    // `event-applied` envelope, THEN send the request-correlated
    // `snapshot-labeled` ack on the moderator's socket.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    const ack: WsEnvelope<'snapshot-labeled'> = {
      type: 'snapshot-labeled',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        snapshotId: snapshotId!,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the label-snapshot handler against the dispatcher. Called
 * by `wsHandlersPlugin` once at registration time. Mirror of
 * `registerMarkMetaDisagreementHandlers` / `registerCommitHandlers` /
 * `registerVoteHandlers` / `registerProposeHandlers`.
 */
export function registerLabelSnapshotHandlers(
  dispatcher: WsDispatcher,
  opts: LabelSnapshotHandlerOptions,
): void {
  dispatcher.register('label-snapshot', buildLabelSnapshotHandler(opts));
}

/**
 * Transaction-bound client surface. Mirrors `DbTxClient` in
 * `meta-disagreement.ts` / `propose.ts` / `vote.ts` / `commit.ts` —
 * duplicated here to keep the handler module self-contained.
 */
interface DbTxClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
  release?: () => void;
}

interface PoolWithConnect {
  connect(): Promise<DbTxClient>;
}

function hasConnect(pool: DbPool): pool is DbPool & PoolWithConnect {
  return typeof (pool as Partial<PoolWithConnect>).connect === 'function';
}

/**
 * Run `fn` inside a transaction. Mirrors `withTransaction` in
 * `meta-disagreement.ts` — duplicated here for the same
 * self-containment reason.
 */
async function withTransaction<T>(
  pool: DbPool,
  fn: (client: DbTxClient) => Promise<T>,
): Promise<T> {
  if (hasConnect(pool)) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // intentionally suppressed; original `err` is re-thrown.
      }
      throw err;
    } finally {
      if (client.release !== undefined) {
        client.release();
      }
    }
  }
  // Pool without `connect()` — issue BEGIN/COMMIT directly against
  // `pool.query` (pglite + memory shims).
  const txClient: DbTxClient = {
    query: pool.query.bind(pool),
  };
  try {
    await txClient.query('BEGIN');
    const result = await fn(txClient);
    await txClient.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await txClient.query('ROLLBACK');
    } catch {
      // intentionally suppressed; original `err` is re-thrown.
    }
    throw err;
  }
}
