// `<OperateLayout>` — three-pane scaffold for the moderator's
// `/sessions/:id/operate` route.
//
// Refinement: tasks/refinements/moderator-ui/mod_layout_shell.md
// Design doc: docs/moderator-ui.md (Layout (sketch))
//
// Geometry (CSS Grid):
//
//     ┌──────────────────────────────┬──────────────┐
//     │                              │              │
//     │     graphPane                │ rightSidebar │
//     │   (operate-graph-pane)       │ (operate-    │
//     │                              │  right-      │
//     │                              │  sidebar)    │
//     ├──────────────────────────────┴──────────────┤
//     │             bottomStrip                     │
//     │         (operate-bottom-strip)              │
//     └─────────────────────────────────────────────┘
//
// The shell is structure-only: it owns the grid template, the per-region
// scroll containment, and the stable `data-testid` selectors that
// downstream tasks (`mod_graph_canvas_pane`, `mod_right_sidebar`,
// `mod_bottom_strip_capture`) target. Children are passed in via three
// optional render-prop slots so callers can compose without the layout
// reaching into any store.
//
// Why CSS Grid over Flexbox: the three-region layout (two-cell top row,
// full-width bottom row) is exactly what `grid-template-areas` expresses
// directly. Flexbox would need a wrapper to group the top row with the
// bottom row; Grid keeps the shell flat and reads top-to-bottom in JSX.
//
// Pixel sizing (`20rem` sidebar width, `6rem` strip height) is a
// placeholder until `packages/ui-tokens` lands (deferred per ADR 0005).

import type { ReactElement, ReactNode } from 'react';

export interface OperateLayoutProps {
  /** Content for the left/main graph canvas region. */
  graphPane?: ReactNode;
  /** Content for the right sidebar's stacked sub-panes. */
  rightSidebar?: ReactNode;
  /** Content for the bottom-strip capture pane. */
  bottomStrip?: ReactNode;
}

export function OperateLayout(props: OperateLayoutProps): ReactElement {
  const { graphPane, rightSidebar, bottomStrip } = props;
  return (
    <div
      data-testid="operate-layout-root"
      className="grid h-screen w-screen bg-slate-50"
      style={{
        gridTemplateColumns: '1fr 20rem',
        gridTemplateRows: '1fr 6rem',
        gridTemplateAreas: '"graph sidebar" "strip strip"',
      }}
    >
      <section
        data-testid="operate-graph-pane"
        className="overflow-auto bg-white"
        style={{ gridArea: 'graph' }}
      >
        {graphPane}
      </section>
      <aside
        data-testid="operate-right-sidebar"
        className="overflow-auto border-l border-slate-200 bg-slate-100"
        style={{ gridArea: 'sidebar' }}
      >
        {rightSidebar}
      </aside>
      <footer
        data-testid="operate-bottom-strip"
        className="overflow-auto border-t border-slate-200 bg-slate-100"
        style={{ gridArea: 'strip' }}
      >
        {bottomStrip}
      </footer>
    </div>
  );
}
