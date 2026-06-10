// The per-step narration caption — the "voice-over" rendered beside the
// walkthrough graph. It is a pure presentation component: given the active
// beat (computed by the narrated wrapper from the stepper's position), it
// resolves the beat's localized copy from the i18n catalog and renders
// eyebrow + title + body in a labelled region.
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_narration.md
// TaskJuggler: landing_page.walkthrough_demo_narration
// ADR:        0024 (react-i18next + ICU).
//
// Scope: desktop-first caption layout beside the graph. Cross-breakpoint
// layout is `landing_demo_mobile_fallback`; the whole-page a11y audit is
// `landing_responsive_a11y`. This ships an accessible baseline (a labelled
// region with a semantic heading), not the page-wide polish pass.

import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';

import type { WalkthroughBeat } from './narration';

export interface WalkthroughCaptionProps {
  /**
   * The active beat, or `undefined` when the position is below the first
   * anchor (Decision §D3) — in which case the container stays mounted with
   * `data-beat=""` and an empty body (no layout jump, a stable test seam).
   */
  readonly beat: WalkthroughBeat | undefined;
}

/** Stable id linking the caption region to its heading for `aria-labelledby`. */
const TITLE_ID = 'walkthrough-caption-title';

export function WalkthroughCaption({ beat }: WalkthroughCaptionProps): ReactElement {
  const { t } = useTranslation();
  const base = beat !== undefined ? `landing.demo.caption.${beat.slug}` : undefined;

  return (
    <aside
      data-testid="walkthrough-caption"
      data-beat={beat?.slug ?? ''}
      aria-labelledby={beat !== undefined ? TITLE_ID : undefined}
      // Content-hugging, deliberately compact: the caption shares its
      // column with the dialogue chat, which claims the remaining graph
      // height — the marketing beat takes as little room as stays
      // readable (no h-full / justify-center fill).
      className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-4"
    >
      {beat !== undefined && base !== undefined ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t(`${base}.eyebrow`)}
          </p>
          <h3 id={TITLE_ID} className="text-base font-semibold text-slate-900">
            {t(`${base}.title`)}
          </h3>
          <p className="text-sm text-slate-600">{t(`${base}.body`)}</p>
        </>
      ) : null}
    </aside>
  );
}

export default WalkthroughCaption;
