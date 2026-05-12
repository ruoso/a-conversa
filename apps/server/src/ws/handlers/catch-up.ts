// Dispatcher handler for `catch-up` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_reconnection_handling.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_reconnection_handling
//
// **What this module owns.**
//
// `buildCatchUpHandler({ pool, registry, log, maxCatchUpEvents? })` —
// returns a `WsDispatcher` handler for the `'catch-up'` envelope. The
// handler is the server-side surface for client reconnection with
// state catch-up: a client that has briefly disconnected re-
// authenticates (via the upgrade-time auth gate), re-sends a
// `subscribe` for each session it was tracking, then sends a
// `catch-up` envelope with the last sequence it observed. The server
// delivers EITHER:
//
//   1. A stream of `event-applied` envelopes (the exact same envelope
//      type the live broadcast surface emits — `ws_event_broadcast`)
//      for events `> sinceSequence` and `<= currentMaxSequence`,
//      followed by a final `caught-up` ack with `fromSnapshot: false`.
//      The **slice-replay** path.
//   2. A single `snapshot-state` envelope (built via the same
//      `serializeProjectionForWire` helper the snapshot handler uses
//      — `ws_snapshot_message`), followed by a `caught-up` ack with
//      `fromSnapshot: true`. The **snapshot-fallback** path; selected
//      when `currentMaxSequence - sinceSequence` exceeds the
//      configurable threshold `maxCatchUpEvents` (default 500 via the
//      `WS_CATCHUP_MAX_EVENTS` env var resolved at registration time).
//
// **Why reuse `event-applied` for replay frames.** Replayed events are
// structurally identical to live events; clients route both through
// one reducer keyed by `event.sequence`. A separate `event-replayed`
// discriminator would force every client to write two handlers that
// do the same thing. See refinement Decisions for the full
// rationale.
//
// **Dedup contract — clients dedupe by `event.sequence`.** The handler
// reads its slice synchronously from the DB, but the bus may dispatch
// a NEW live `event-applied` broadcast between the SELECT and the
// per-frame send. Clients MUST dedupe by `event.sequence` — the
// per-event sequence is the single source of truth for ordering. The
// `caught-up` ack's `throughSequence` is the boundary: any
// `event-applied` with `sequence <= throughSequence` is part of the
// replay; anything `>` is live.
//
// **Per-connection sends, NOT broadcasts.** Replay frames go on the
// requesting client's socket only. Other subscribers are unaffected.
// (Contrast: the live `event-applied` broadcast goes via the bus to
// all subscribers of the session.)
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined.
//   - Event-append, broadcast emit, transaction: none — this is a
//     read-only surface.
//   - Per-connection bookkeeping: the server does NOT track
//     `lastSentSequence` per connection. `sinceSequence` is purely a
//     client-supplied parameter on the catch-up request.
//   - Client retry / backoff / re-auth / re-subscribe orchestration:
//     out of scope — owned by the participant / moderator / audience
//     workspaces in future tasks. This file is the server endpoint.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError } from '../../errors.js';
import { projectFromLog } from '../../projection/replay.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsConnectionContext } from '../connection.js';
import type { WsDispatcher } from '../dispatcher.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

import { serializeProjectionForWire } from './snapshot.js';

/**
 * Per-row shape returned from `SELECT ... FROM session_events`.
 * Mirrors the `SessionEventRow` in the four write handlers + the
 * snapshot handler. Duplicated rather than imported to keep the
 * handler module self-contained.
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
 * Default snapshot-fallback threshold. When the gap between
 * `sinceSequence` and the current `MAX(sequence)` exceeds this number,
 * the handler skips the per-event replay and sends a snapshot
 * instead. Configurable via the `WS_CATCHUP_MAX_EVENTS` env var or
 * directly via the handler options (the latter is the test path).
 *
 * Rationale for 500 (see refinement Decisions): this is the rough
 * break-even point on round-trip-cost vs. snapshot-cost for typical
 * projections. The exact number doesn't matter much; the order of
 * magnitude does. Most reconnects in normal operation will be well
 * below 500 events, so the slice path is the hot path; the snapshot
 * fallback handles the audience-chapter-scrub case and the long-
 * network-partition recovery case.
 */
export const DEFAULT_WS_CATCHUP_MAX_EVENTS = 500;

/**
 * Env var name the production-resolution path reads. Exported so the
 * config / setup code shares the same constant.
 */
export const WS_CATCHUP_MAX_EVENTS_ENV = 'WS_CATCHUP_MAX_EVENTS';

/**
 * Resolve the catch-up snapshot-fallback threshold from the
 * environment. Used by `wsHandlersPlugin`'s registration path so the
 * production threshold reads the env once at registration time. Tests
 * inject the value directly via the handler options to keep the
 * verification deterministic.
 *
 * - Reads `WS_CATCHUP_MAX_EVENTS` from the supplied env object
 *   (defaults to `process.env`).
 * - Returns the default `500` when absent, empty, or unparseable.
 * - Rejects non-positive values (zero or negative) — those would
 *   force every catch-up into the snapshot path, defeating the
 *   slice-replay primitive. Falls back to the default with a warning
 *   left for the operator (the warning surface is the caller's; this
 *   helper just returns the resolved number).
 */
export function resolveCatchUpMaxEvents(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[WS_CATCHUP_MAX_EVENTS_ENV];
  if (raw === undefined || raw === '') {
    return DEFAULT_WS_CATCHUP_MAX_EVENTS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WS_CATCHUP_MAX_EVENTS;
  }
  return parsed;
}

/**
 * Builder inputs — captured once at handler-registration time. Minimal
 * shape: no `broadcast` (read-only, no emit) and no `now` (no event
 * constructed). Mirrors `SnapshotHandlerOptions` plus the configurable
 * threshold.
 */
export interface CatchUpHandlerOptions {
  /** DB pool the visibility predicate + the event-log SELECT run against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry — the subscribe-before-act gate. */
  readonly registry: WsSubscriptionRegistry;
  /** Logger for diagnostics — used by the client-ahead defensive warn path. */
  readonly log: FastifyBaseLogger;
  /**
   * Snapshot-fallback threshold. When the gap between
   * `sinceSequence` and `MAX(sequence)` exceeds this number, the
   * handler emits a `snapshot-state` envelope instead of streaming
   * per-event replay frames. Defaults to `DEFAULT_WS_CATCHUP_MAX_EVENTS`
   * (500) when absent; the production registration path resolves the
   * value via `resolveCatchUpMaxEvents(process.env)`. Tests pass small
   * values (e.g. 3) to exercise both branches deterministically.
   */
  readonly maxCatchUpEvents?: number;
}

/**
 * Build the `catch-up` dispatcher handler. The returned closure
 * captures the pool / registry / log / threshold once; the dispatcher
 * invokes it per inbound `catch-up` envelope.
 */
export function buildCatchUpHandler(
  opts: CatchUpHandlerOptions,
): (envelope: WsEnvelope<'catch-up'>, connection: WsConnectionContext) => Promise<void> {
  const threshold = opts.maxCatchUpEvents ?? DEFAULT_WS_CATCHUP_MAX_EVENTS;
  return async (envelope, connection) => {
    const { sessionId, sinceSequence } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // The upgrade-time auth gate populates `connection.user`. Reaching
      // this branch means a wiring bug — surface as a generic 500-
      // equivalent via the dispatcher's `onHandlerError` no-leak fallback.
      throw new Error('ws-catch-up: connection.user is undefined — auth gate bypassed');
    }

    // Gate 1 — subscribe-before-act. Identical to the propose / vote /
    // commit / mark-meta-disagreement / snapshot handlers' first gate.
    // The `'forbidden'` code is reused from the existing
    // `ApiError.code` taxonomy. Rationale (see refinement Decisions):
    // even a read-shaped catch-up is gated by subscription — the
    // request commits the client to receive subsequent live broadcasts;
    // catch-up outside that commitment is a request for a snapshot the
    // client will never keep current.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this catch-up surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Read MAX(sequence) — the catch-up boundary. No FOR UPDATE — this
    // is a pure read; concurrent appenders may push the boundary
    // forward after this read, and the resulting live broadcast
    // arrives on the same socket. The client dedupes by
    // `event.sequence` (documented dedup contract).
    const maxRes = await opts.pool.query<{ max_seq: number | string | null }>(
      `SELECT COALESCE(MAX(sequence), 0) AS max_seq
       FROM session_events
       WHERE session_id = $1`,
      [sessionId],
    );
    const rawMax = maxRes.rows[0]?.max_seq ?? 0;
    const currentMax = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;

    // -- Case 1: client is at or past the head (defensive). -----------
    //
    // `sinceSequence === currentMax` is the no-op-at-head case: nothing
    // to replay; the catch-up is a single `caught-up` ack with
    // `eventCount: 0`.
    //
    // `sinceSequence > currentMax` is the client-ahead defensive case:
    // the client thinks it has seen more events than the server has.
    // Should not happen, but if it does we log a warn and still send
    // a `caught-up` ack so the client doesn't bounce into a retry
    // loop. The ack reports `throughSequence: currentMax` and
    // `eventCount: 0` — the client recovers by treating the ack as
    // "you're synced; live broadcasts will resume from here."
    if (sinceSequence >= currentMax) {
      if (sinceSequence > currentMax) {
        opts.log.warn(
          {
            connectionId: connection.connectionId,
            sessionId,
            sinceSequence,
            currentMax,
            messageId: envelope.id,
          },
          'ws-catch-up: client reports sinceSequence > server MAX(sequence) — defensive no-op ack',
        );
      }
      sendCaughtUpAck(connection, envelope.id, sessionId, currentMax, 0, false);
      return;
    }

    // -- Case 2: snapshot fallback (gap too wide for slice replay). ---
    //
    // When `currentMax - sinceSequence` exceeds the configurable
    // threshold (default 500), build the projection from the full
    // event log and send a single `snapshot-state` envelope, then
    // close with a `caught-up` ack `{ fromSnapshot: true }`. The
    // client uses the snapshot as a fresh anchor; subsequent live
    // broadcasts apply as deltas on top.
    if (currentMax - sinceSequence > threshold) {
      const logRes = await opts.pool.query<SessionEventRow>(
        `SELECT id, session_id, sequence, kind, actor, payload, created_at
         FROM session_events
         WHERE session_id = $1
         ORDER BY sequence ASC`,
        [sessionId],
      );
      const events: Event[] = logRes.rows.map(rowToEvent);
      const projection = projectFromLog(events, sessionId);

      const snapshot: WsEnvelope<'snapshot-state'> = {
        type: 'snapshot-state',
        id: randomUUID(),
        inResponseTo: envelope.id,
        payload: {
          sessionId,
          sequence: projection.lastAppliedSequence,
          projection: serializeProjectionForWire(projection),
        },
      };
      connection.socket.send(serializeWsEnvelope(snapshot));
      sendCaughtUpAck(connection, envelope.id, sessionId, projection.lastAppliedSequence, 0, true);
      return;
    }

    // -- Case 3: slice replay (default path). ------------------------
    //
    // Read the missing events from `session_events` for the half-open
    // interval `(sinceSequence, currentMax]` and stream each as an
    // `event-applied` envelope on the requesting client's socket.
    // Then close with a `caught-up` ack carrying the count.
    const sliceRes = await opts.pool.query<SessionEventRow>(
      `SELECT id, session_id, sequence, kind, actor, payload, created_at
       FROM session_events
       WHERE session_id = $1 AND sequence > $2 AND sequence <= $3
       ORDER BY sequence ASC`,
      [sessionId, sinceSequence, currentMax],
    );

    let count = 0;
    for (const row of sliceRes.rows) {
      const event = rowToEvent(row);
      // Construct the replay frame in the exact same shape the live
      // broadcast surface emits: `{ type: 'event-applied', id:
      // <new uuid>, payload: { event } }`. The outer `id` is a
      // freshly-minted per-frame server uuid; the `event.id` and
      // `event.sequence` are stable. NO `inResponseTo` on the
      // per-frame envelope — these are unsolicited from the client's
      // local frame-of-reference; the `caught-up` ack at the end is
      // the request-correlated frame.
      const replay: WsEnvelope<'event-applied'> = {
        type: 'event-applied',
        id: randomUUID(),
        payload: { event },
      };
      connection.socket.send(serializeWsEnvelope(replay));
      count++;
    }

    sendCaughtUpAck(connection, envelope.id, sessionId, currentMax, count, false);
  };
}

/**
 * Build and send the `caught-up` ack on the requesting client's
 * socket. Centralised here so all three handler branches emit the
 * same shape.
 */
function sendCaughtUpAck(
  connection: WsConnectionContext,
  inResponseTo: string,
  sessionId: string,
  throughSequence: number,
  eventCount: number,
  fromSnapshot: boolean,
): void {
  const ack: WsEnvelope<'caught-up'> = {
    type: 'caught-up',
    id: randomUUID(),
    inResponseTo,
    payload: {
      sessionId,
      throughSequence,
      eventCount,
      fromSnapshot,
    },
  };
  connection.socket.send(serializeWsEnvelope(ack));
}

/**
 * Register the catch-up handler against the dispatcher. Called by
 * `wsHandlersPlugin` once at registration time. Mirror of
 * `registerSnapshotHandlers` / `registerProposeHandlers` / etc.
 */
export function registerCatchUpHandlers(
  dispatcher: WsDispatcher,
  opts: CatchUpHandlerOptions,
): void {
  dispatcher.register('catch-up', buildCatchUpHandler(opts));
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Duplicated from the snapshot / write handlers — same self-
 * containment reason.
 */
function rowToEvent(row: SessionEventRow): Event {
  const seq = typeof row.sequence === 'string' ? Number.parseInt(row.sequence, 10) : row.sequence;
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
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
