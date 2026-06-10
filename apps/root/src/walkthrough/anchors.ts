// Shared anchor resolution for the walkthrough's design-data tables.
//
// Both the narration beats (`narration.ts`) and the dialogue script
// (`dialogue.ts`) anchor to stable EVENT IDS in the walkthrough stream
// and resolve those ids to 1-based positions at module load. The
// resolution lives here once so a typo'd / removed anchor fails loudly
// with the same error shape regardless of which table carries it.
//
// Refinement: tasks/refinements/landing_page/walkthrough_dialogue_chat.md

import { walkthroughEvents } from './index.js';

/**
 * Resolve an anchor event id to its 1-based position in
 * `walkthroughEvents`; throws if the event is missing (a stale anchor
 * fails at module load, which the owning table's suite surfaces).
 * `label` names the anchor in the error (a beat slug, a dialogue slug).
 */
export function resolveAnchorPosition(anchorEventId: string, label: string): number {
  const index = walkthroughEvents.findIndex((event) => event.id === anchorEventId);
  if (index < 0) {
    throw new Error(
      `walkthrough anchor "${label}" points at event ${anchorEventId}, ` +
        `which is not present in walkthroughEvents`,
    );
  }
  return index + 1;
}
