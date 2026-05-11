// `appendSessionEvent` — the single helper every event-append site
// routes through.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// **Why a helper.** Before this task, six call sites in
// `apps/server/src/sessions/routes.ts` each ran their own
// `INSERT INTO session_events (...) VALUES (...)` and there was no
// single point at which the broadcast surface could subscribe to
// "an event was appended." With this helper:
//
//   1. The SQL lives in one place; future migrations or schema-on-
//      write extensions land once.
//   2. Every appender threads through the bus publish AFTER the
//      INSERT completes inside the same transaction, then the route
//      emits the broadcast AFTER COMMIT (the post-commit-emit
//      invariant — see refinement).
//
// **What this helper owns AND what it does NOT own.**
//
//   - This helper runs the INSERT inside the supplied client (so it
//     participates in the caller's transaction). It does NOT call
//     `validateEvent` — that's the caller's responsibility (and is
//     already done in every site that builds an envelope; we don't
//     duplicate the validation).
//   - This helper does NOT emit to the broadcast bus. The bus emit
//     must happen AFTER COMMIT, which is outside this helper's
//     transaction scope. The route returns the appended event from
//     its `withTransaction` callback and emits the broadcast on the
//     return value once the transaction's COMMIT has landed.
//
// **Why split the INSERT from the broadcast emit.** Emitting inside
// the transaction would either:
//
//   1. Risk a subscriber observing a frame for an event the DB later
//      rolls back (the broadcast subscriber would have to track the
//      transaction state — yuck).
//   2. Require coupling the broadcast bus to the transaction lifecycle.
//
// Splitting keeps the invariants clean: the transaction owns the DB
// write; the route owns the post-commit broadcast emit. The helper
// is the single SQL surface; the route is the single emit surface.

import type { Event } from '@a-conversa/shared-types';

/**
 * Minimal client surface the helper needs — same shape
 * `apps/server/src/sessions/routes.ts`'s `DbTxClient` exposes. The
 * helper accepts the structural type so the routes' existing
 * `withTransaction(...)` callback can hand it the client without
 * casting.
 */
export interface SessionEventAppendClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
}

/**
 * Append an event row inside the caller's transaction. Returns the
 * input event unchanged for caller convenience (the route's
 * `withTransaction` callback typically returns the appended event so
 * the post-COMMIT broadcast emit can pass it to `app.wsBroadcast`).
 *
 * **Contract.**
 *
 *   - The event MUST have already passed `validateEvent(...)` at the
 *     call site (the schema-on-write invariant from ADR 0021).
 *   - The caller is responsible for the per-session sequence
 *     allocation (`MAX(sequence)+1` inside the same transaction,
 *     guarded by the FOR UPDATE row lock per ADR 0020).
 *   - This helper does NOT call `app.wsBroadcast.emit(...)`. The
 *     route emits AFTER the transaction's COMMIT — see the post-
 *     commit-emit decision in the refinement.
 *
 * @param client a transaction-bound client (the `DbTxClient` the
 *               route's `withTransaction` callback receives).
 * @param event  a fully-built, already-validated event envelope.
 * @returns the input event, unchanged. The route's callback returns
 *          the same value so the post-COMMIT code path has the event
 *          to publish to the broadcast bus.
 */
export async function appendSessionEvent(
  client: SessionEventAppendClient,
  event: Event,
): Promise<Event> {
  await client.query(
    `INSERT INTO session_events
       (id, session_id, sequence, kind, actor, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.id,
      event.sessionId,
      event.sequence,
      event.kind,
      event.actor,
      JSON.stringify(event.payload),
    ],
  );
  return event;
}
