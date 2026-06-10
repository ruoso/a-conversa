// The walkthrough dialogue script — the typed, machine-checkable half of
// the demo's chat panel. Each turn anchors to the stable EVENT ID of the
// platform action it precipitates (the same anchoring pattern as the
// narration beats in `narration.ts`); the localized *copy* lives only in
// the i18n catalogs under `landing.demo.dialogue.<slug>.text` (one source
// of truth for copy, mirroring the caption design).
//
// The dialogue is adapted from `docs/example-walkthrough.md` — the spoken
// lines of the 22-turn "Should zoos exist?" debate, condensed to chat-
// bubble length. Speech is NOT an event kind (the product's event log
// records structured methodology moves only; raw utterances are
// deliberately not preserved — see docs/methodology.md "What happens to
// the raw utterance"), so the script is a landing-only sidecar asset.
//
// Refinement: tasks/refinements/landing_page/walkthrough_dialogue_chat.md
// TaskJuggler: landing_page.walkthrough_dialogue_chat
// ADR:         0024 (react-i18next + ICU — dialogue copy is catalog-resolved).

import { resolveAnchorPosition } from './anchors.js';

/** The three on-screen voices. Display names resolve from the catalog
 *  (`landing.demo.dialogue.speaker.<speaker>`). */
export type DialogueSpeaker = 'maria' | 'anna' | 'ben';

/**
 * The demo participants' ids (the fixture's actors) — lets the chat
 * panel reuse the SAME per-participant colors the graph's axiom-mark
 * badges derive via `axiomMarkColorFor`, so a debater's chat bubbles and
 * their marks on the board read as one identity. Maria (the moderator)
 * deliberately has no entry: her bubbles take the neutral moderator
 * styling, matching her no-vote, runs-the-board role.
 */
export const DEBATER_PARTICIPANT_IDS: Readonly<Partial<Record<DialogueSpeaker, string>>> = {
  anna: '10000001-0000-4000-8000-00000000a001',
  ben: '10000001-0000-4000-8000-00000000b001',
};

/** Design data: one turn's slug + speaker + the event id it anchors to. */
interface DialogueAnchor {
  /** Stable slug; the bubble resolves copy via `landing.demo.dialogue.<slug>.text`. */
  readonly slug: string;
  readonly speaker: DialogueSpeaker;
  /** The platform action this line precipitates — the turn becomes
   *  visible when the stream reaches it. */
  readonly anchorEventId: string;
}

/**
 * The script, in reading order. Anchor positions are non-decreasing
 * (asserted in the suite). To re-anchor a turn, point it at a different
 * event id — no position arithmetic anywhere.
 */
const DIALOGUE_ANCHORS: readonly DialogueAnchor[] = [
  { slug: 'intro', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-000000000001' },
  { slug: 'floor', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-000000080001' },
  { slug: 'anna_opens', speaker: 'anna', anchorEventId: 'ee000000-0000-4000-8000-000000000005' },
  {
    slug: 'decompose_ask',
    speaker: 'maria',
    anchorEventId: 'ee000000-0000-4000-8000-000000000007',
  },
  { slug: 'anna_scope', speaker: 'anna', anchorEventId: 'ee000000-0000-4000-8000-000000000017' },
  { slug: 'bridge_flag', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-00000000001c' },
  { slug: 'ben_scope', speaker: 'ben', anchorEventId: 'ee000000-0000-4000-8000-00000000002b' },
  {
    slug: 'log_annotation',
    speaker: 'maria',
    anchorEventId: 'ee000000-0000-4000-8000-00000000002d',
  },
  { slug: 'ben_withdraw', speaker: 'ben', anchorEventId: 'ee000000-0000-4000-8000-0000000a0001' },
  { slug: 'ben_captivity', speaker: 'ben', anchorEventId: 'ee000000-0000-4000-8000-000000000032' },
  {
    slug: 'operationalize',
    speaker: 'maria',
    anchorEventId: 'ee000000-0000-4000-8000-00000000003a',
  },
  {
    slug: 'ben_defeasible',
    speaker: 'ben',
    anchorEventId: 'ee000000-0000-4000-8000-000000000049',
  },
  { slug: 'warrant', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-000000000057' },
  {
    slug: 'ben_capabilities',
    speaker: 'ben',
    anchorEventId: 'ee000000-0000-4000-8000-000000000073',
  },
  {
    slug: 'classify_normative',
    speaker: 'maria',
    anchorEventId: 'ee000000-0000-4000-8000-00000000007c',
  },
  {
    slug: 'ben_value_pushback',
    speaker: 'ben',
    anchorEventId: 'ee000000-0000-4000-8000-00000000007f',
  },
  {
    slug: 'reclassify_value',
    speaker: 'maria',
    anchorEventId: 'ee000000-0000-4000-8000-0000000d0002',
  },
  { slug: 'ben_axiom', speaker: 'ben', anchorEventId: 'ee000000-0000-4000-8000-00000000008f' },
  { slug: 'anna_axiom', speaker: 'anna', anchorEventId: 'ee000000-0000-4000-8000-0000000000b0' },
  {
    slug: 'shared_axiom',
    speaker: 'maria',
    anchorEventId: 'ee000000-0000-4000-8000-0000000b0001',
  },
  { slug: 'reword', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-0000000c0001' },
  { slug: 'split', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-0000000000c0' },
  { slug: 'anna_reframe', speaker: 'anna', anchorEventId: 'ee000000-0000-4000-8000-0000000000da' },
  {
    slug: 'anna_candidates',
    speaker: 'anna',
    anchorEventId: 'ee000000-0000-4000-8000-0000000000df',
  },
  { slug: 'ben_contests', speaker: 'ben', anchorEventId: 'ee000000-0000-4000-8000-000000000100' },
  { slug: 'crux', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-000000000101' },
  { slug: 'deadlock', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-000000100004' },
  { slug: 'wrap', speaker: 'maria', anchorEventId: 'ee000000-0000-4000-8000-000000110001' },
];

/** One dialogue turn: slug (→ catalog key), speaker, resolved position. */
export interface DialogueTurn {
  readonly slug: string;
  readonly speaker: DialogueSpeaker;
  /** 1-based prefix length at which this turn becomes visible — resolved
   *  from the anchor event id against the live stream. */
  readonly position: number;
}

/**
 * The script with positions resolved from anchor event ids against
 * `walkthroughEvents`. Non-decreasing by construction of the script
 * (asserted in the suite — two turns may share an anchor only if they
 * read in order).
 */
export const WALKTHROUGH_DIALOGUE: readonly DialogueTurn[] = DIALOGUE_ANCHORS.map((anchor) => ({
  slug: anchor.slug,
  speaker: anchor.speaker,
  position: resolveAnchorPosition(anchor.anchorEventId, anchor.slug),
}));

/**
 * The turns visible at `position`: every turn whose anchor ≤ position,
 * in script order. Pure function over the resolved table — the chat
 * panel's only data dependency.
 */
export function dialogueVisibleAt(position: number): readonly DialogueTurn[] {
  return WALKTHROUGH_DIALOGUE.filter((turn) => turn.position <= position);
}
