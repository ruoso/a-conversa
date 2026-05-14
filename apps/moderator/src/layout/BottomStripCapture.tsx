// `<BottomStripCapture>` — bottom-strip capture-pane scaffold.
//
// Refinement: tasks/refinements/moderator-ui/mod_bottom_strip_capture.md
// Design doc: docs/moderator-ui.md (Layout (sketch) — bottom strip)
//
// This task lands the empty structural scaffold for the bottom-strip
// capture pane that `mod_layout_shell` left as a render-prop slot.
// The pane is the moderator's primary input surface during a session:
// statement text, classification palette, edge-role selector, and the
// propose-action button. None of that real content is wired here —
// the four downstream `mod_capture_flow.*` tasks fill each sub-slot in
// turn, and `mod_mode_banner` decorates the top edge of the strip
// with the current `CaptureMode` banner.
//
// The scaffold owns:
//   - The outer pane region (`bottom-strip-capture`) with a labelled
//     accessibility role so screen readers announce it as the
//     "Capture pane" region.
//   - Five stable `data-testid` sub-slots that downstream tasks target
//     without reaching back into the shell:
//       - `bottom-strip-mode-banner`        -> mod_mode_banner
//       - `bottom-strip-text-input`         -> mod_capture_text_input
//       - `bottom-strip-classification`     -> mod_classification_palette
//       - `bottom-strip-edge-role`          -> mod_edge_role_selector
//       - `bottom-strip-propose-action`     -> mod_propose_action
//   - A placeholder visible-text marker per sub-slot so the pane reads
//     as "wired but unimplemented" instead of blank — useful for visual
//     QA during the foundation pass and trivially overridden when the
//     real content lands.
//
// The scaffold is structure-only: no store reads, no event emission,
// no i18n catalog keys (the per-sub-slot copy lands with the matching
// downstream task). Tailwind classes match the `mod_layout_shell`
// palette (slate-100 surface, slate-200 borders) so the strip is
// visually consistent with the shell's right-sidebar surface.

import type { ReactElement, ReactNode } from 'react';

export interface BottomStripCaptureProps {
  /** Slot for the mode banner (`mod_mode_banner`). */
  modeBanner?: ReactNode;
  /** Slot for the statement-text input (`mod_capture_text_input`). */
  textInput?: ReactNode;
  /** Slot for the classification palette (`mod_classification_palette`). */
  classificationPalette?: ReactNode;
  /** Slot for the edge-role selector (`mod_edge_role_selector`). */
  edgeRoleSelector?: ReactNode;
  /** Slot for the propose-action button (`mod_propose_action`). */
  proposeAction?: ReactNode;
}

export function BottomStripCapture(props: BottomStripCaptureProps): ReactElement {
  const { modeBanner, textInput, classificationPalette, edgeRoleSelector, proposeAction } = props;
  return (
    <section
      data-testid="bottom-strip-capture"
      aria-label="Capture pane"
      role="region"
      className="flex h-full w-full flex-col bg-slate-100"
    >
      <div
        data-testid="bottom-strip-mode-banner"
        className="border-b border-slate-200 px-3 py-1 text-xs text-slate-600"
      >
        {modeBanner ?? <span aria-hidden="true">[mode banner]</span>}
      </div>
      <div className="flex flex-1 items-stretch gap-2 px-3 py-2">
        <div
          data-testid="bottom-strip-text-input"
          className="flex flex-1 items-center rounded border border-slate-200 bg-white px-2 text-sm text-slate-500"
        >
          {textInput ?? <span aria-hidden="true">[statement text]</span>}
        </div>
        <div
          data-testid="bottom-strip-classification"
          className="flex items-center rounded border border-slate-200 bg-white px-2 text-sm text-slate-500"
        >
          {classificationPalette ?? <span aria-hidden="true">[classification]</span>}
        </div>
        <div
          data-testid="bottom-strip-edge-role"
          className="flex items-center rounded border border-slate-200 bg-white px-2 text-sm text-slate-500"
        >
          {edgeRoleSelector ?? <span aria-hidden="true">[edge role]</span>}
        </div>
        <div
          data-testid="bottom-strip-propose-action"
          className="flex items-center rounded border border-slate-200 bg-white px-2 text-sm text-slate-500"
        >
          {proposeAction ?? <span aria-hidden="true">[propose]</span>}
        </div>
      </div>
    </section>
  );
}
