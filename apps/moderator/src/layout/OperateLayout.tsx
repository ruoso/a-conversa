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
// Sidebar width (`20rem`) is a placeholder until `packages/ui-tokens`
// lands (deferred per ADR 0005). The bottom strip row uses `auto` so
// the strip sizes to its natural content height — the strip's children
// (banner + capture row of four boxes + helper paragraph) total well
// over the previous `6rem` fixed reservation, and a fixed reservation
// forced an internal scrollbar on every test run. With `auto`, the
// graph pane (1fr) shrinks to absorb the strip's true height; with no
// scroll on either pane the page presents zero scrollbars by default.
//
// Height: the grid fills its flex parent (`flex-1` + `min-h-0`) rather
// than claiming a hard `h-screen`. `OperateRoute` wraps the shell in a
// viewport-height flex column so the blocking-diagnostic banner can sit
// above the grid in normal flow without pushing the page past 100vh (a
// hard `h-screen` here did exactly that and tripped the e2e
// no-scrollbars harness). `min-h-0` lets the grid shrink below its
// content's intrinsic size so the internal `1fr auto` row split — not
// the page — absorbs the available height.

import type { ReactElement, ReactNode } from 'react';

export interface OperateLayoutProps {
  /** Content for the left/main graph canvas region. */
  graphPane?: ReactNode;
  /** Content for the right sidebar's stacked sub-panes. */
  rightSidebar?: ReactNode;
  /** Content for the bottom-strip capture pane. */
  bottomStrip?: ReactNode;
  /**
   * Reflects the F10 snapshot-flow trigger flag as a stable
   * `data-snapshot-flow-open="true"|"false"` attribute on the layout
   * root. The attribute is ALWAYS present (defaults to `"false"`) so
   * Playwright specs can flip-assert on its value instead of waiting
   * for the attribute to appear; the modal that consumes the flag
   * (`mod_snapshot_label_input`) does not exist yet, so this seam
   * gives `tests/e2e/moderator-snapshot.spec.ts` a stable assertion
   * target until the modal lands and the spec can replace this seam
   * with the modal's own selector.
   *
   * Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
   * (Decision §3 — testability seam rationale).
   */
  dataSnapshotFlowOpen?: boolean;
}

export function OperateLayout(props: OperateLayoutProps): ReactElement {
  const { graphPane, rightSidebar, bottomStrip, dataSnapshotFlowOpen = false } = props;
  return (
    <div
      data-testid="operate-layout-root"
      data-snapshot-flow-open={dataSnapshotFlowOpen ? 'true' : 'false'}
      className="grid min-h-0 w-full flex-1 bg-slate-50"
      style={{
        gridTemplateColumns: '1fr 20rem',
        gridTemplateRows: '1fr auto',
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
        // `data-allow-scroll` opts this region out of the e2e
        // scrollbar harness (`tests/e2e/fixtures/no-scrollbars.ts`).
        // The sidebar is the canonical home for unbounded content —
        // pending proposals (the list can grow to dozens of rows mid-
        // session), diagnostic flags, change history — and is
        // designed to be scrollable. `overflow-auto` paints a bar
        // only when content actually overflows; the opt-out tells the
        // harness this is intentional rather than a layout bug.
        data-allow-scroll=""
        className="overflow-auto border-l border-slate-200 bg-slate-100"
        style={{ gridArea: 'sidebar' }}
      >
        {rightSidebar}
      </aside>
      <footer
        data-testid="operate-bottom-strip"
        className="border-t border-slate-200 bg-slate-100"
        style={{ gridArea: 'strip' }}
      >
        {bottomStrip}
      </footer>
    </div>
  );
}
