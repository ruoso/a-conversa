// `sessionRoster.ts` — audience-side per-event-log projector returning a
// `userId → screenName` resolver for the session's currently-present
// participants.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §4 — duplicate-for-v0 over extract-to-shell; the audience
//   is the second general-roster caller after the participant. The
//   convention recorded at apps/participant/src/detail/participantRoster.ts:22-24
//   reserves the third caller as the extraction trigger; this leaf is
//   the second.)
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//   (Decision §5 — canonical source for the set-on-joined /
//   delete-on-left semantics this projector mirrors.)
//
// Algorithm + behaviour: identical to participantRosterFrom in the
// participant workspace. Diverges from the moderator's deriveSlotOccupants
// (which keys by role, not userId, because the moderator's invite panel
// renders slot rows, not voter attribution).
//
// ADRs:
//   - 0021 (event-envelope discriminated union — payload-shape narrowing
//           follows `event.kind === '...'`).
//   - 0022 (no throwaway verifications — every behaviour below is
//           pinned by `sessionRoster.test.ts`).

import type { Event } from '@a-conversa/shared-types';

/**
 * Stable empty-roster reference. Returned by `sessionRosterFrom` when
 * the events log carries no `participant-joined` envelopes — keeps
 * React / memoization stable for the no-roster baseline so consumers
 * downstream of `useMemo(() => sessionRosterFrom(events), [events])`
 * don't see a fresh `Map` on every projection pass. Mirrors the
 * `EMPTY_PARTICIPANT_ROSTER` discipline in the participant workspace
 * and the `EMPTY_EVENTS` discipline in the audience's WS selector.
 */
export const EMPTY_AUDIENCE_ROSTER: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>(),
);

/**
 * Walk the per-session event log once, collapsing `participant-joined`
 * / `participant-left` envelopes into a per-user `userId → screenName`
 * resolver. Returns the `EMPTY_AUDIENCE_ROSTER` reference when the
 * walk surfaces zero entries.
 *
 * Semantics (mirrored from the participant's `participantRosterFrom`
 * per `part_entity_detail_panel.md` Decision §5):
 *
 * - `participant-joined` SETS the entry. A re-joined participant
 *   overwrites the prior screen name (the methodology allows the same
 *   user_id to leave + rejoin; the latest join is the authoritative
 *   screen name).
 * - `participant-left` REMOVES the entry. Once a participant has left,
 *   the resolver no longer surfaces their screen name.
 * - Out-of-order arrival (a `participant-left` arriving before its
 *   corresponding `participant-joined`) is benign — the `left` arm
 *   tries to remove an entry that doesn't exist, which is a no-op.
 *   The eventual `participant-joined` then sets the entry.
 *
 * All other event kinds are ignored — the roster is exclusively a
 * per-user identity projection.
 */
export function sessionRosterFrom(events: readonly Event[]): ReadonlyMap<string, string> {
  const roster = new Map<string, string>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      roster.set(event.payload.user_id, event.payload.screen_name);
      continue;
    }
    if (event.kind === 'participant-left') {
      roster.delete(event.payload.user_id);
      continue;
    }
  }
  if (roster.size === 0) {
    return EMPTY_AUDIENCE_ROSTER;
  }
  return roster;
}
