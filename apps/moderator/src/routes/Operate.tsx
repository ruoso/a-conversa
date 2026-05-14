// Operate route for `/sessions/:id/operate` — the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_graph_canvas_pane.md
// (prior refinement: tasks/refinements/moderator-ui/mod_layout_shell.md)
//
// Composes the three-pane `<OperateLayout>` (`mod_layout_shell`) with
// `<GraphCanvasPane>` (`mod_graph_canvas_pane`) wired into the graph
// slot. The temporary store-subscription placeholder from the layout-
// shell task is gone; the ReactFlow canvas now occupies the graph
// pane. `route-operate` and `session-id` test ids are preserved so the
// router-level `App.test.tsx` cases continue to pass — `session-id`
// is now an `sr-only` span pinned out of the layout flow rather than
// a visible paragraph inside the (former) graph-pane placeholder.
//
// Downstream siblings still replace the remaining two slots:
//   - rightSidebar  -> mod_layout.mod_right_sidebar
//   - bottomStrip   -> mod_layout.mod_bottom_strip_capture (landed —
//                      `<BottomStripCapture>` scaffold mounts here;
//                      `mod_capture_flow.*` and `mod_mode_banner` fill
//                      its sub-slots)

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { OperateLayout } from '../layout/OperateLayout';
import { BottomStripCapture } from '../layout/BottomStripCapture';
import { GraphCanvasPane } from '../graph/GraphCanvasPane';
import { RightSidebar } from '../layout/RightSidebar';

export function OperateRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  return (
    <main data-testid="route-operate">
      {/*
       * `session-id` survives the placeholder removal — `App.test.tsx`
       * asserts the router captured the path param. Tailwind's
       * `sr-only` utility hides it visually (1px clipped box,
       * `position: absolute`) so it never pushes the
       * `<OperateLayout>` grid off the viewport; still readable to
       * assistive tech and queryable by test id.
       */}
      <span data-testid="session-id" className="sr-only">
        {id}
      </span>
      <OperateLayout
        graphPane={<GraphCanvasPane />}
        bottomStrip={<BottomStripCapture />}
        rightSidebar={<RightSidebar />}
      />
    </main>
  );
}
