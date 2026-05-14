// `<ModeBanner>` — capture-pane mode banner.
//
// Refinement: tasks/refinements/moderator-ui/mod_mode_banner.md
// Design doc: docs/moderator-ui.md (Layout (sketch) — bottom strip)
//
// Reads `mode` from `useCaptureStore` and renders a short localized
// label + a one-sentence description so the moderator sees, at a
// glance, which capture flow the bottom strip is currently in.
// Mounts into the `bottom-strip-mode-banner` slot exposed by
// `<BottomStripCapture>` (the scaffold from `mod_bottom_strip_capture`).
//
// The banner is presentation-only: it does not call any setter, does
// not emit events, does not validate transitions. Mode transitions are
// owned by the downstream mode-entry tasks (F2 enters `decompose`, F6
// enters `capture-defeater`, etc.); the banner just reflects whatever
// `captureStore.mode` currently holds.
//
// Catalog keys (sixteen leaves per locale across the eight modes):
//   moderator.modeBanner.<mode>.label
//   moderator.modeBanner.<mode>.description
// where <mode> is one of the `CaptureMode` values in `captureStore`.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCaptureStore } from '../stores/captureStore';

export function ModeBanner(): ReactElement {
  const { t } = useTranslation();
  const mode = useCaptureStore((state) => state.mode);

  const labelKey = `moderator.modeBanner.${mode}.label`;
  const descriptionKey = `moderator.modeBanner.${mode}.description`;

  return (
    <div
      data-testid="mode-banner"
      data-mode={mode}
      role="status"
      aria-live="polite"
      className="flex items-baseline gap-2"
    >
      <span data-testid="mode-banner-label" className="font-medium text-slate-700">
        {t(labelKey)}
      </span>
      <span data-testid="mode-banner-description" className="text-slate-500">
        {t(descriptionKey)}
      </span>
    </div>
  );
}
