// HTTP-prefetch + WS-overlay slot-merge helpers for every client-side
// surface that renders the moderator + debater-A + debater-B slot
// rows.
//
// Refinement: tasks/refinements/shell-package/shared_shell_extract_merge_slots_and_derive_slot_occupants.md
//   (predecessor source-of-debt pair:
//      tasks/refinements/participant-ui/part_lobby_view_ws_absence_merge_fix.md
//      tasks/refinements/moderator-ui/mod_invite_participants_rest_prefetch.md
//      tasks/refinements/participant-ui/part_lobby_view.md)
// ADR 0021 — the `Event` discriminated union the helpers narrow on.
//
// Two public entry points share one source of truth for the
// session-roster slot vocabulary:
//
//   - `deriveSlotOccupants(events)` — walk the WS event log and collapse
//     `participant-joined` / `participant-left` envelopes into a
//     role-keyed `{userId, screenName}` map. A `participant-left` clears
//     the slot only when the leaver matches the current occupant, so a
//     stale leave arriving after a rejoin cannot erase the fresh slot.
//   - `mergeSlots(httpRows, wsOccupants, events)` — compose the HTTP
//     prefetch's cold-load roster with the WS overlay's live-update
//     stream. HTTP seeds presence; the WS overlay wins on collision
//     (its events carry the canonical `screen_name` and reflect more
//     recent state); a WS-derived `participant-left` overrides the
//     HTTP-prefetch's stale "still here" row via a "latest signal per
//     user id" map.
//
// **Pure**: no `Date.now()`, no `Math.random()`, no closure over time.

import type { Event } from '@a-conversa/shared-types';

/**
 * The roles displayed as slot rows, in render order. The moderator row
 * is always first; the two debater rows below it. The exact order is
 * load-bearing for screen-reader navigation and for the e2e specs'
 * `data-role` filters.
 */
export const SLOT_ROLES = ['moderator', 'debater-A', 'debater-B'] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

/**
 * Per-slot occupant — the `{ userId, screenName }` pair of the user
 * currently assigned to the role. `undefined` means the slot is empty
 * (only meaningful for the two debater roles; the moderator slot is
 * always filled at session creation).
 *
 * The pair shape (carrying `userId`) is load-bearing for the
 * HTTP-prefetch + WS-overlay merge: the participants-list endpoint
 * (`GET /api/sessions/:id/participants`) returns rows with `userId`
 * but does not denormalize `screenName`; the WS event payload IS the
 * canonical display-name source. Carrying both fields lets the merge
 * filter HTTP rows against WS-derived `participant-left` events.
 */
export interface SlotOccupant {
  readonly userId: string;
  readonly screenName: string;
}

export type SlotOccupants = { [K in SlotRole]?: SlotOccupant };

/**
 * The shape of a single row in the HTTP prefetch's projected output
 * — the `{ userId, role, screenName }` triple the merge consumes.
 * `screenName` is the empty string when the endpoint omits it (the
 * current endpoint contract; the WS overlay fills it from the
 * `participant-joined` payload).
 */
export interface ParticipantRow {
  readonly userId: string;
  readonly role: SlotRole;
  readonly screenName: string;
}

/**
 * Walk the session's event log once and collapse `participant-joined`
 * / `participant-left` events into the per-role occupant map.
 *
 * Semantics: `participant-left` cancels a prior `participant-joined`
 * for the same user id; a subsequent rejoin re-adds them. The map is
 * keyed by role rather than user id because the slot-row UI is
 * role-shaped — one row per slot. If the same role is filled twice
 * (a backend regression), the latest event wins, which matches the
 * existing "rejoin re-adds" semantic.
 */
export function deriveSlotOccupants(events: readonly Event[]): SlotOccupants {
  const occupants: SlotOccupants = {};
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      occupants[event.payload.role] = {
        userId: event.payload.user_id,
        screenName: event.payload.screen_name,
      };
      continue;
    }
    if (event.kind === 'participant-left') {
      for (const role of SLOT_ROLES) {
        if (occupants[role]?.userId === event.payload.user_id) {
          delete occupants[role];
        }
      }
    }
  }
  return occupants;
}

/**
 * Merge the HTTP-prefetch row set with the WS-derived slot map. The
 * HTTP prefetch is the cold-load source of truth (it tells us which
 * slots are filled even before the WS catch-up replay arrives); the
 * WS event stream is the live overlay (its events carry the canonical
 * `screen_name` from the joined-payload, and they reflect every
 * subsequent change). Both are merged into a single per-render slot
 * map — WS wins on collisions, since its events are more recent than
 * the HTTP snapshot.
 *
 * The third `events` arg carries the WS event log so the merge can
 * derive a "latest signal per user id" map and filter HTTP rows whose
 * latest WS event is `participant-left` — otherwise a WS-derived
 * absence (which `deriveSlotOccupants` reflects as a deleted key in
 * `wsOccupants`) would not override the HTTP-prefetched "still here"
 * row, leaving the departed user alive forever in the merged view.
 */
export function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
  events: readonly Event[],
): SlotOccupants {
  const latest = new Map<string, 'joined' | 'left'>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      latest.set(event.payload.user_id, 'joined');
    } else if (event.kind === 'participant-left') {
      latest.set(event.payload.user_id, 'left');
    }
  }
  const merged: SlotOccupants = {};
  for (const row of httpRows) {
    if (latest.get(row.userId) === 'left') continue;
    merged[row.role] = { userId: row.userId, screenName: row.screenName };
  }
  for (const role of SLOT_ROLES) {
    const wsSlot = wsOccupants[role];
    if (wsSlot !== undefined) merged[role] = wsSlot;
  }
  return merged;
}
