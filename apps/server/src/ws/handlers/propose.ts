// Dispatcher handler for `propose` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_propose_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_propose_message
//
// **What this module owns.**
//
// `buildProposeHandler({ pool, registry, broadcast, log, now? })` —
// returns a `WsDispatcher` handler for the `'propose'` envelope. The
// handler:
//
//   1. **Subscribe-before-act gate.** Rejects with
//      `ApiError.forbidden(...)` when the client's connection is not in
//      `registry.connectionsForSession(payload.sessionId)`. The
//      dispatcher's `onHandlerError` seam echoes the throw as a wire
//      `error` envelope (per `ws_error_message`). The forbidden code is
//      reused from the existing `ApiError.code` taxonomy rather than a
//      new `RejectionReason` — the gate is a protocol-layer concern,
//      not a methodology concern. See refinement Decisions.
//   2. **Visibility re-check.** `canSeeSession(pool, sessionId, userId)`
//      is called again here even though `subscribe` already checked —
//      a session that became invisible between subscribe and propose
//      surfaces as `ApiError.notFound(...)`. Same existence-non-leak
//      rule the subscribe handler uses.
//   3. **Transactional sequence allocation + projection load + engine
//      validation + INSERT.** Inside one `withTransaction`:
//        a. `SELECT ... FOR UPDATE` on the `sessions` row (serialises
//           concurrent appenders per ADR 0020).
//        b. `SELECT MAX(sequence) FROM session_events WHERE
//           session_id = $1` — the application-managed monotonic
//           sequence allocator.
//        c. Optimistic-concurrency check: `expectedSequence !== maxSeq`
//           → throw `rejectedToApiError({ reason: 'sequence-mismatch',
//           detail: ... })` (mapped to HTTP 409). Same wire code the
//           engine's universal sequence check produces.
//        d. Load every prior event for the session and run
//           `projectFromLog(events, sessionId)` to obtain the
//           projection. (V1 replay-per-request — a cache-backed path
//           is a follow-up; see refinement Decisions.)
//        e. Build the `MethodologyAction.propose` from the payload +
//           `connection.user.id` + the allocated sequence + a fresh
//           `eventId` UUID, and call
//           `validateAction(projection, action)`. Rejections route
//           through `rejectedToApiError(rejection)` → throw.
//        f. The engine returns `events: [proposalEvent]`. We
//           `validateEvent` the envelope (schema-on-write, per ADR
//           0021) and `appendSessionEvent(client, event)` the row.
//   4. **Post-commit broadcast + `proposed` ack.** AFTER the
//      transaction's COMMIT (mirroring every existing append site in
//      `apps/server/src/sessions/routes.ts`):
//        a. `app.wsBroadcast.emit({ event })` fans out the
//           `event-applied` envelope to every connection subscribed to
//           this session — INCLUDING the proposer.
//        b. The handler sends a `proposed` ack envelope directly on
//           the proposer's socket. `inResponseTo` correlates to the
//           originating client envelope's `id`; the payload carries
//           `{ sessionId, sequence, eventId }`.
//      The proposer therefore receives BOTH frames: `proposed` (the
//      request-response correlation) AND `event-applied` (the
//      projection-update signal). Non-proposer subscribed clients
//      receive only the broadcast. See refinement Decisions for the
//      dual-signal contract.
//
// **What this handler does NOT do.**
//
//   - Authentication: already enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined on
//     every message the handler ever sees.
//   - Schema validation of `payload.proposal`: enforced upstream by
//     `parseWsEnvelope` against `proposePayloadSchema` (which embeds
//     `proposalPayloadSchema`). Failures surface as a
//     `WsEnvelopeValidationError` in `parseWsEnvelopeJson` and the
//     connection-loop sends a `malformed-envelope` error envelope.
//   - Methodology-rule re-implementation: every rule lives in the
//     engine's `proposeHandler` (eight tightened sub-kind arms, three
//     universal-pass placeholders). The WS handler delegates.
//
// **Per-sibling reuse.** The four future message-type tasks
// (`ws_vote_message`, `ws_commit_message`,
// `ws_meta_disagreement_message`, `ws_snapshot_message`) follow the
// same skeleton: subscribe-gate → visibility-check →
// transactional-load-validate-append → post-commit-emit + ack. Each
// reuses `appendSessionEvent`, the same `rejectedToApiError` mapper,
// and the same dispatcher-seam error path. Only the action-construction
// (`MethodologyAction.<kind>`) and the ack envelope type differ.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { validateAction } from '../../methodology/engine.js';
import type { ProposeAction } from '../../methodology/types.js';
import { projectFromLog } from '../../projection/replay.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsBroadcastBus } from '../broadcast/bus.js';
import type { WsConnectionContext } from '../connection.js';
import type { WsDispatcher } from '../dispatcher.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Per-row shape returned from `SELECT ... FROM session_events ORDER BY
 * sequence ASC`. The `payload` column is `jsonb`; the `pg` driver
 * returns it as already-parsed JSON.
 */
interface SessionEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number | string;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: Record<string, unknown>;
  readonly created_at: Date | string;
}

/**
 * Builder inputs — captured once at handler-registration time. Mirrors
 * `SubscribeHandlerOptions`'s shape so the registration plugin can hand
 * both handlers the same closure.
 */
export interface ProposeHandlerOptions {
  /** DB pool the visibility predicate + transactional writes run against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry — the subscribe-before-act gate. */
  readonly registry: WsSubscriptionRegistry;
  /** Per-instance broadcast bus — the post-commit `event-applied` emit. */
  readonly broadcast: WsBroadcastBus;
  /** Logger for diagnostics. The handler does NOT log rejections at error level — those are client bugs, not server bugs; rejections are surfaced via the wire error envelope. */
  readonly log: FastifyBaseLogger;
  /**
   * Clock injection for the event envelope's `createdAt` field.
   * Defaulted to `Date.now` in production; tests pin a controllable
   * function so the payload is deterministic across runs. Matches the
   * same shape `sessions/routes.ts`'s `nowFn` uses.
   */
  readonly now?: () => number;
}

/**
 * Build the `propose` dispatcher handler. The returned closure captures
 * the pool / registry / broadcast / log / clock once; the dispatcher
 * invokes it per inbound `propose` envelope.
 */
export function buildProposeHandler(
  opts: ProposeHandlerOptions,
): (envelope: WsEnvelope<'propose'>, connection: WsConnectionContext) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const { sessionId, expectedSequence, proposal } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // Anonymous client (per ADR 0029 + `aud_anonymous_ws_subscribe`).
      // Audience-role connections never write — reject with a wire
      // `forbidden` envelope so the client sees a typed code, not a
      // generic `internal-error`. The dispatcher's `onHandlerError`
      // seam maps `ApiError.forbidden` to the canonical `error`
      // envelope with `code: 'forbidden'` + `inResponseTo:
      // envelope.id`. The connection stays open per
      // `ws_error_message`'s connection-stays-open invariant.
      throw ApiError.forbidden('this action requires an authenticated session', { sessionId });
    }

    // Gate 1 — subscribe-before-act. Reuses `'forbidden'` from the
    // existing `ApiError.code` taxonomy (the WS surface inherits the
    // same kebab-case codes the HTTP error envelope owns). Rationale
    // for not minting a new `RejectionReason`: this is a protocol-
    // layer concern (the WS surface owns the subscription concept),
    // not a methodology concern; see refinement Decisions.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this propose surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`
    // (the predicate collapses "doesn't exist" and "exists but not
    // visible" into a single false result — see
    // `apps/server/src/sessions/visibility.ts`'s docblock).
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Mirrors the same pattern
    // every event-append site in `apps/server/src/sessions/routes.ts`
    // uses: FOR UPDATE on the `sessions` row, MAX(sequence) read,
    // engine validation, schema-on-write `validateEvent`,
    // `appendSessionEvent` for the INSERT. Events appended inside the
    // transaction are collected for the post-COMMIT broadcast emit.
    const appendedEvents: Event[] = [];
    const proposalEventId = await withTransaction(opts.pool, async (client) => {
      // 1. FOR UPDATE on `sessions` — serialises concurrent appenders
      //    on this session per ADR 0020. We re-confirm visibility
      //    inside the lock for completeness (the row's `privacy` /
      //    membership could in principle change between gate 2 and
      //    this read, although the same-userId invariant inside a
      //    single request makes the window vanishingly small).
      const lookup = await client.query<{ id: string; ended_at: Date | string | null }>(
        `SELECT id, ended_at
         FROM sessions
         WHERE id = $1
         FOR UPDATE`,
        [sessionId],
      );
      const existing = lookup.rows[0];
      if (existing === undefined) {
        // The row vanished between gate 2 and the lock. Collapse to
        // 404 to inherit the same existence-non-leak rule.
        throw ApiError.notFound('session not found or not visible', { sessionId });
      }

      // 2. Application-managed monotonic sequence allocator (ADR
      //    0020). Read MAX(sequence) inside the FOR UPDATE'd
      //    transaction so the value can be paired with an `INSERT` at
      //    MAX+1 without race. COALESCE handles the first-event case.
      const maxRes = await client.query<{ max_seq: number | string | null }>(
        `SELECT COALESCE(MAX(sequence), 0) AS max_seq
         FROM session_events
         WHERE session_id = $1`,
        [sessionId],
      );
      const rawMax = maxRes.rows[0]?.max_seq ?? 0;
      const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;
      const nextSeq = maxSeq + 1;

      // 3. Optimistic-concurrency check. If the client's
      //    `expectedSequence` doesn't match the server's MAX, the
      //    client's view of the session is stale (another propose
      //    landed since the client last refreshed). Surface as the
      //    same `sequence-mismatch` code the engine's universal check
      //    emits — uniform client-side branching across both gates.
      //    `rejectedToApiError` maps `sequence-mismatch` to HTTP 409
      //    (per `apps/server/src/errors.ts`).
      if (expectedSequence !== maxSeq) {
        throw rejectedToApiError({
          ok: false,
          reason: 'sequence-mismatch',
          detail: `propose: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
        });
      }

      // 4. Load the session's event log + project. V1 replay-per-
      //    request; a cache-backed path is a documented follow-up.
      //    The SELECT runs inside the same transaction so the read
      //    is consistent with the MAX above (and consistent with the
      //    FOR UPDATE lock — concurrent appenders are blocked).
      const logRes = await client.query<SessionEventRow>(
        `SELECT id, session_id, sequence, kind, actor, payload, created_at
         FROM session_events
         WHERE session_id = $1
         ORDER BY sequence ASC`,
        [sessionId],
      );
      const priorEvents: Event[] = logRes.rows.map(rowToEvent);
      const projection = projectFromLog(priorEvents, sessionId);

      // 5. Build the `MethodologyAction.propose` and run it through
      //    the engine. The engine's universal checks (session match,
      //    sequence match, participant gate) run inside
      //    `validateAction`; `proposeHandler` dispatches on
      //    `proposal.kind` and runs the tightened per-sub-kind
      //    validator. Rejections surface via `rejectedToApiError`.
      const eventId = randomUUID();
      const createdAtIso = new Date(nowFn()).toISOString();
      const action: ProposeAction = {
        kind: 'propose',
        requester: userId,
        sessionId,
        eventId,
        sequence: nextSeq,
        actor: userId,
        createdAt: createdAtIso,
        proposal,
      };
      const result = validateAction(projection, action);
      if (!result.ok) {
        throw rejectedToApiError(result);
      }
      // Per ADR 0027 the engine may emit MORE than one event per
      // propose action: a free-floating `classify-node` produces
      // `node-created` + `entity-included` + `proposal`; a connecting
      // case may add `edge-created` + `entity-included`. The
      // proposal envelope is always the last event in the returned
      // list (its sequence is `action.sequence +
      // structuralEvents.length`); the WS ack carries that last
      // event's sequence / id so the proposer's request-response
      // correlation lands on the proposal envelope, mirroring the
      // pre-ADR-0027 single-event ack shape.
      if (result.events.length === 0) {
        throw new Error('ws-propose: engine produced 0 events (expected at least 1)');
      }
      const proposalEnvelopeEvent = result.events[result.events.length - 1]!;
      if (proposalEnvelopeEvent.kind !== 'proposal') {
        throw new Error(
          `ws-propose: last emitted event is '${proposalEnvelopeEvent.kind}' (expected 'proposal')`,
        );
      }

      // 6. Schema-on-write — every row in `session_events` is
      //    structurally valid by construction (ADR 0021). Validate +
      //    append each engine-emitted event in order so subscribers
      //    see structural events before the `proposal` envelope.
      for (const emitted of result.events) {
        validateEvent(emitted);
        appendedEvents.push(await appendSessionEvent(client, emitted));
      }

      return eventId;
    });

    // Post-commit emit + ack. Order matters slightly: emit FIRST so
    // every subscribed client (including the proposer) receives the
    // `event-applied` envelope, THEN send the request-correlated
    // `proposed` ack. In practice the synchronous bus dispatch +
    // synchronous-per-connection sender means both frames hit the
    // wire in fast succession; the proposer's client may receive
    // them in either order depending on socket-buffer flush timing.
    // The contract is "both arrive"; clients MUST handle them as
    // independent signals.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    // The `proposal` envelope event is always the last in
    // `appendedEvents` (the engine emits structural events first per
    // ADR 0027). The ack carries the proposal envelope's sequence so
    // the client's request-response correlation lands on the proposal
    // (the structural events that precede it are observed via
    // `event-applied` broadcasts).
    const proposalEnvelope = appendedEvents[appendedEvents.length - 1]!;
    const ack: WsEnvelope<'proposed'> = {
      type: 'proposed',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        sequence: proposalEnvelope.sequence,
        eventId: proposalEventId,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the propose handler against the dispatcher. Called by
 * `wsHandlersPlugin` once at registration time. Mirror of
 * `registerSubscribeHandlers`.
 */
export function registerProposeHandlers(
  dispatcher: WsDispatcher,
  opts: ProposeHandlerOptions,
): void {
  dispatcher.register('propose', buildProposeHandler(opts));
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape
 * `@a-conversa/shared-types` owns. `pg` returns `jsonb` already
 * parsed, BIGINT `sequence` as a string (coerced to number), and
 * `timestamptz` as a JS `Date`. The shape mirrors what
 * `validateEvent` accepts.
 */
function rowToEvent(row: SessionEventRow): Event {
  const seq = typeof row.sequence === 'string' ? Number.parseInt(row.sequence, 10) : row.sequence;
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  // `validateEvent` is the canonical gate at write-time. We trust the
  // row shape on read because every row was validated at write-time —
  // re-validation on read is defensive but not required by the
  // schema-on-write invariant. The cast crosses from the row's
  // structural type to the discriminated `Event` union.
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: seq,
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  } as Event;
}

/**
 * Transaction-bound client surface. Mirrors `DbTxClient` in
 * `apps/server/src/sessions/routes.ts` — duplicated here (rather than
 * imported) to keep the WS handler decoupled from the sessions-routes
 * module's internal types.
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
 * `apps/server/src/sessions/routes.ts` — duplicated here to keep the
 * WS handler self-contained. If/when `withTransaction` moves to a
 * shared `db/` module both call sites switch atomically.
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
  // `pool.query` (pglite + memory shims). The pool's `query` shape
  // matches the DbTxClient surface (sans `release`).
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
