// The walkthrough narration beat table + activation rule — the typed,
// machine-checkable half of `walkthrough_demo_narration`. The shipped,
// localized caption *copy* lives only in the i18n catalogs under
// `landing.demo.caption.<slug>.{eyebrow,title,body}` (Decision §D2 / the
// script's Decision D1: one source of truth for copy). This module holds
// only the design: each beat's slug and its 1-based position anchor into
// the frozen seed log (`walkthroughEvents`).
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_narration.md
// Script:     tasks/refinements/landing_page/walkthrough_narration_script.md
// TaskJuggler: landing_page.walkthrough_demo_narration
// ADR:        0024 (react-i18next + ICU — caption copy is catalog-resolved).

/** One narration beat: a slug (→ catalog key) and its 1-based anchor position. */
export interface WalkthroughBeat {
  /** Stable slug; the caption resolves copy via `landing.demo.caption.<slug>.*`. */
  readonly slug: string;
  /**
   * 1-based prefix length into `walkthroughEvents` at which this beat
   * becomes active. Anchors are strictly increasing (asserted in the
   * suite) and match the script's `§ The script` table exactly.
   */
  readonly position: number;
}

/**
 * The nine ordered beats, anchored at the script's verified commit
 * positions (`walkthrough_narration_script` `§ The script`). Anchors must
 * stay strictly increasing and equal to the script values
 * (6, 27, 42, 56, 86, 100, 147, 196, 266).
 */
export const WALKTHROUGH_BEATS: readonly WalkthroughBeat[] = [
  { slug: 'opening', position: 6 },
  { slug: 'decompose', position: 27 },
  { slug: 'consensus', position: 42 },
  { slug: 'counter', position: 56 },
  { slug: 'contradiction', position: 86 },
  { slug: 'classification', position: 100 },
  { slug: 'axiom', position: 147 },
  { slug: 'interpretive_split', position: 196 },
  { slug: 'finale', position: 266 },
];

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
