// Operate route for `/sessions/:id/operate` — the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_rendering.md
// (prior:     tasks/refinements/moderator-ui/mod_node_rendering.md,
//             tasks/refinements/moderator-ui/mod_graph_canvas_pane.md,
//             tasks/refinements/moderator-ui/mod_layout_shell.md,
//             tasks/refinements/moderator-ui/mod_bottom_strip_capture.md,
//             tasks/refinements/moderator-ui/mod_mode_banner.md,
//             tasks/refinements/moderator-ui/mod_right_sidebar.md)
//
// Composes the three-pane `<OperateLayout>` (`mod_layout_shell`) with
// `<GraphCanvasPane sessionId={id} />` (`mod_graph_canvas_pane` +
// `mod_node_rendering` + `mod_edge_rendering`) wired into the graph
// slot, `<RightSidebar>` (`mod_right_sidebar`) into the right slot, and
// `<BottomStripCapture>` (`mod_bottom_strip_capture`) into the bottom
// strip with `<ModeBanner>` (`mod_mode_banner`) filling the strip's
// `modeBanner` sub-slot. The session id from the route param threads
// into the canvas so the node + edge projection layers subscribe to
// the right per-session slice.
//
// `route-operate` and `session-id` test ids are preserved so the
// router-level `App.test.tsx` cases continue to pass — `session-id`
// is an `sr-only` span pinned out of the layout flow rather than
// a visible paragraph inside the (former) graph-pane placeholder.
//
// Downstream consumers still replace the remaining capture-strip
// sub-slots (`textInput`, `classificationPalette`, `edgeRoleSelector`,
// `proposeAction`) when each `mod_capture_flow.*` task lands.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { OperateLayout } from '../layout/OperateLayout';
import { BottomStripCapture } from '../layout/BottomStripCapture';
import { GraphCanvasPane } from '../graph/GraphCanvasPane';
import { ModeBanner } from '../layout/ModeBanner';
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
        graphPane={<GraphCanvasPane sessionId={id} />}
        bottomStrip={<BottomStripCapture modeBanner={<ModeBanner />} />}
        rightSidebar={<RightSidebar />}
      />
    </main>
  );
}
