// `<ParticipantLayout>` — landscape-oriented chrome shell for the
// participant tablet surface.
//
// Refinement: tasks/refinements/participant-ui/part_landscape_layout.md
// Design doc: docs/participant-ui.md (Layout (sketch))
//
// Geometry (CSS Grid, three row-stacked regions):
//
//     +-----------------------------------------------+
//     |             participant-header                |  <- h-12
//     +-----------------------------------------------+
//     |                                               |
//     |             participant-main                  |  <- 1fr
//     |                                               |
//     +-----------------------------------------------+
//     |             participant-footer                |  <- h-12
//     +-----------------------------------------------+
//
// The shell is structure-only: it owns the grid template, per-region
// scroll containment, and the stable `data-testid` selectors that
// downstream tasks (`part_status_indicator`,
// `part_session_join.part_invite_acceptance`,
// `part_session_join.part_lobby_view`, `part_graph_view`) target.
// Children pass in via three optional render-prop slots so callers can
// compose without the layout reaching into any store.
//
// Why CSS Grid over Flexbox: parity with the moderator's
// `OperateLayout` pattern (`apps/moderator/src/layout/OperateLayout.tsx`)
// — same recipe, different geometry (row-stack vs. two-row-two-column).
// The named template areas read directly in the source so a downstream
// leaf can map the slot name to the on-screen region without tracing
// flex direction.
//
// Pixel sizing (`h-12` = 48 px header + footer, matching
// `part_status_indicator`'s declared height budget) is a placeholder
// until `packages/ui-tokens` lands (deferred per ADR 0005). Mirrors the
// approach `mod_layout_shell` took.

import type { ReactElement, ReactNode } from 'react';

export interface ParticipantLayoutProps {
  /** Top chrome row — product label + identity affordance. */
  header?: ReactNode;
  /** Main content region — router-outlet-shaped slot. */
  main?: ReactNode;
  /** Bottom chrome row — reserved for `part_status_indicator`. */
  footer?: ReactNode;
}

export function ParticipantLayout(props: ParticipantLayoutProps): ReactElement {
  const { header, main, footer } = props;
  return (
    <div
      data-testid="participant-layout-root"
      className="grid h-screen w-screen bg-slate-50"
      style={{
        gridTemplateRows: 'auto 1fr auto',
        gridTemplateAreas: '"header" "main" "footer"',
      }}
    >
      <header
        data-testid="participant-header"
        className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4"
        style={{ gridArea: 'header' }}
      >
        {header}
      </header>
      <section
        data-testid="participant-main"
        className="overflow-auto bg-white"
        style={{ gridArea: 'main' }}
      >
        {main}
      </section>
      <footer
        data-testid="participant-footer"
        className="flex h-12 items-center justify-between border-t border-slate-200 bg-slate-100 px-4"
        style={{ gridArea: 'footer' }}
      >
        {footer}
      </footer>
    </div>
  );
}
