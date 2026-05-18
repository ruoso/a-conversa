// `participantRoster.ts` — walk the per-session event log and project a
// `participantId → screenName` resolver the entity detail panel uses to
// render per-voter / per-author / per-axiom-mark attribution rows.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (Decision §5 — `participant-joined` SETS the entry,
//              `participant-left` REMOVES it. Choice of remove-on-left
//              keeps the resolver reflecting the CURRENT session's
//              participants — the lobby's `deriveSlotOccupants` posture
//              applied to the operate route's attribution surface. The
//              resolver falls back to `(unknown user)` via
//              `screenNameFor`'s third arg for any UUID the resolver has
//              no entry for; the fallback is the safety net for out-of-
//              order arrivals or server frames whose `participant-joined`
//              has not yet landed locally.)
//
// Pattern lifted from `apps/participant/src/routes/LobbyRoute.tsx:154-176`
// (`deriveSlotOccupants`) — same per-event walk, simpler output shape
// (the lobby keys by `role` because its rendering surface is the slot
// grid; the operate panel keys by `userId` because every attribution
// row already carries the UUID and needs the screen-name lookup). The
// helper lives in the participant workspace per Decision §8 — the
// third caller (audience) is the natural extraction trigger to
// `@a-conversa/shell`.
//
// ADRs:
//   - 0022 (no throwaway verifications — every behaviour below is
//           pinned by `participantRoster.test.ts`).

import type { Event } from '@a-conversa/shared-types';

/**
 * Stable empty-roster reference. Returned by `participantRosterFrom`
 * when the events log carries no `participant-joined` envelopes — keeps
 * React / memoization stable for the no-roster baseline so consumers
 * downstream of `useMemo(() => participantRosterFrom(events), [events])`
 * don't see a fresh `Map` on every projection pass. Same `EMPTY_*`
 * discipline the prior leaves adopted (`EMPTY_FACET_STATUSES`,
 * `EMPTY_AXIOM_MARKS`, `EMPTY_ANNOTATIONS`, `EMPTY_OTHER_VOTES_LIST`,
 * `EMPTY_OWN_VOTES`, etc.).
 */
export const EMPTY_PARTICIPANT_ROSTER: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>(),
);

/**
 * Walk the per-session event log once, collapsing `participant-joined`
 * / `participant-left` envelopes into a per-user `userId → screenName`
 * resolver. Returns the `EMPTY_PARTICIPANT_ROSTER` reference when the
 * walk surfaces zero entries.
 *
 * Semantics (Decision §5):
 *
 * - `participant-joined` SETS the entry. A re-joined participant
 *   overwrites the prior screen name (the methodology allows the same
 *   user_id to leave + rejoin; the latest join is the authoritative
 *   screen name).
 * - `participant-left` REMOVES the entry. Once a participant has left,
 *   the resolver no longer surfaces their screen name; consumers
 *   defaulting via `screenNameFor` get the localized
 *   "(unknown user)" fallback. This mirrors the per-voter table's
 *   posture: `'withdraw'` REMOVES the voter from the `OtherVote` list
 *   per `part_other_vote_indicators` Decision §1; remove-on-left
 *   stays in lockstep.
 * - Out-of-order arrival (a `participant-left` arriving before its
 *   corresponding `participant-joined`) is benign — the `left` arm
 *   tries to remove an entry that doesn't exist, which is a no-op.
 *   The eventual `participant-joined` then sets the entry. The walk
 *   is order-tolerant.
 *
 * All other event kinds (`node-created`, `proposal`, `vote`,
 * `annotation-created`, etc.) are ignored — the roster is exclusively
 * a per-user identity projection.
 */
export function participantRosterFrom(events: readonly Event[]): ReadonlyMap<string, string> {
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
    return EMPTY_PARTICIPANT_ROSTER;
  }
  return roster;
}

/**
 * Resolve a `userId` to a display name through the roster, with a
 * configurable fallback. Used by the per-voter / per-author / per-axiom-
 * mark attribution rows that need a localized "(unknown user)" string
 * for any UUID the roster has no entry for (the participant has left,
 * the `participant-joined` frame has not yet arrived, the vote
 * envelope predates the join, etc.).
 *
 * Returns, in order of priority:
 *   1. The roster entry for `userId` if present.
 *   2. The caller-supplied `fallback` if non-empty.
 *   3. The raw `userId` (the UUID stays visible so a debugger has
 *      something to grep on; the panel's render never surfaces a bare
 *      empty string for the attribution row).
 */
export function screenNameFor(
  roster: ReadonlyMap<string, string>,
  userId: string,
  fallback?: string,
): string {
  const entry = roster.get(userId);
  if (entry !== undefined) return entry;
  if (fallback !== undefined && fallback !== '') return fallback;
  return userId;
}
