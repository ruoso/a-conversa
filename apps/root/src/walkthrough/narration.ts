// The walkthrough narration beat table + activation rule — the typed,
// machine-checkable half of `walkthrough_demo_narration`. The shipped,
// localized caption *copy* lives only in the i18n catalogs under
// `landing.demo.caption.<slug>.{eyebrow,title,body}` (Decision §D2 / the
// script's Decision D1: one source of truth for copy). This module holds
// only the design: each beat's slug and the stable EVENT IT ANCHORS TO.
//
// Anchoring is by event id, NOT by a hardcoded 1-based position. Each
// beat names the specific event (a commit / edge-created / snapshot /
// entity-included) that IS that narrative moment; `WALKTHROUGH_BEATS`
// resolves those ids to positions against the live `walkthroughEvents`
// stream at module load. This keeps the narration robust to fixture
// edits: inserting or removing events re-resolves every anchor with zero
// bookkeeping (the predecessor table hardcoded positions and had to be
// hand-re-synced — across this module, its test, and the landing e2e —
// on every fixture change).
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_narration.md
// Script:     tasks/refinements/landing_page/walkthrough_narration_script.md
// TaskJuggler: landing_page.walkthrough_demo_narration
// ADR:        0024 (react-i18next + ICU — caption copy is catalog-resolved).

import { walkthroughEvents } from './index.js';

/** Design data: a beat's slug + the stable id of the event it anchors to. */
interface BeatAnchor {
  /** Stable slug; the caption resolves copy via `landing.demo.caption.<slug>.*`. */
  readonly slug: string;
  /** The event whose arrival IS this narrative beat (commit / edge / snapshot). */
  readonly anchorEventId: string;
}

/**
 * The nine ordered beats, each anchored to the event the script's
 * `§ The script` table calls out as that moment. Order is the reading
 * order; the resolved positions are strictly increasing (asserted in the
 * suite). To re-anchor a beat, point it at a different event id — no
 * position arithmetic anywhere.
 */
const BEAT_ANCHORS: readonly BeatAnchor[] = [
  // The first claim landing on the board (the `node-created` for Anna's
  // raw opener — a VISIBLE event, so the beat lands on a renderable step).
  { slug: 'opening', anchorEventId: 'ee000000-0000-4000-8000-000000000005' },
  { slug: 'decompose', anchorEventId: 'ee000000-0000-4000-8000-00000000001b' },
  { slug: 'consensus', anchorEventId: 'ee000000-0000-4000-8000-00000000002a' },
  { slug: 'counter', anchorEventId: 'ee000000-0000-4000-8000-000000000038' },
  { slug: 'contradiction', anchorEventId: 'ee000000-0000-4000-8000-000000000056' },
  { slug: 'classification', anchorEventId: 'ee000000-0000-4000-8000-000000000064' },
  { slug: 'axiom', anchorEventId: 'ee000000-0000-4000-8000-000000000093' },
  { slug: 'interpretive_split', anchorEventId: 'ee000000-0000-4000-8000-0000000000c4' },
  // The session close — the very last event, so the finale beat holds
  // through the end of the scrubber range.
  { slug: 'finale', anchorEventId: 'ee000000-0000-4000-8000-000000110001' },
];

/** One narration beat: a slug (→ catalog key) and its resolved 1-based position. */
export interface WalkthroughBeat {
  /** Stable slug; the caption resolves copy via `landing.demo.caption.<slug>.*`. */
  readonly slug: string;
  /**
   * 1-based prefix length into `walkthroughEvents` at which this beat
   * becomes active — RESOLVED from the beat's anchor event id against the
   * live stream. Strictly increasing across the table (asserted).
   */
  readonly position: number;
}

/** Resolve one anchor to its 1-based position; throws if the anchor event
 *  is missing (a typo'd / removed anchor fails loudly at module load,
 *  which the narration suite surfaces). */
function resolveAnchor(anchor: BeatAnchor): WalkthroughBeat {
  const index = walkthroughEvents.findIndex((event) => event.id === anchor.anchorEventId);
  if (index < 0) {
    throw new Error(
      `walkthrough beat "${anchor.slug}" anchors to event ${anchor.anchorEventId}, ` +
        `which is not present in walkthroughEvents`,
    );
  }
  return { slug: anchor.slug, position: index + 1 };
}

/**
 * The nine ordered beats with positions resolved from their anchor event
 * ids against `walkthroughEvents`. Consumers read `{ slug, position }`
 * exactly as before — the position is now derived, not literal.
 */
export const WALKTHROUGH_BEATS: readonly WalkthroughBeat[] = BEAT_ANCHORS.map(resolveAnchor);

/**
 * The script's activation rule (constraint 2 / Decision §D3): the active
 * beat is the **last** beat whose anchor ≤ `position`. Below the first
 * anchor (`position < 6`) there is no active beat (`undefined`) and the
 * caption is cleared. Pure function of `position` over the beat table —
 * the unit-tested contract.
 */
export function activeBeatFor(position: number): WalkthroughBeat | undefined {
  let active: WalkthroughBeat | undefined;
  for (const beat of WALKTHROUGH_BEATS) {
    if (beat.position <= position) {
      active = beat;
    } else {
      break;
    }
  }
  return active;
}
