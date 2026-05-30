// `usePendingProposalsCount` — selector hook returning the count of
// pending proposals for a session.
//
// Refinement: tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md
//   (D1 — derives from `derivePendingProposals(events)`, the same source
//    the participant pane's row list uses. Badge count and pane row
//    count converge by construction; the predecessor `part_proposals_tab`
//    D3 broadcast-frame source is gone with the legacy `pendingProposals`
//    slot.)

import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { derivePendingProposals } from './derivePendingProposals';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export function usePendingProposalsCount(sessionId: string): number {
  return useWsStore(
    (s) => derivePendingProposals(s.sessionState[sessionId]?.events ?? EMPTY_EVENTS).length,
  );
}
