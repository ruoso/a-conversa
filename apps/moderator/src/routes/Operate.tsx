// Operate route for `/sessions/:id/operate` — the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_layout_shell.md
//
// Composes the three-pane `<OperateLayout>` (`mod_layout_shell`) and
// hands a placeholder block to the graph pane. The placeholder keeps the
// store-subscription stub from `mod_state_management` intact (the
// `capture-mode`, `selected-entity`, `active-sidebar-pane` test ids
// and the trivial `useCaptureStore` / `useSelectionStore` / `useUiStore`
// reads) until `mod_graph_canvas_pane` replaces it with the real canvas.
//
// Downstream siblings replace the three slots:
//   - graphPane     -> mod_layout.mod_graph_canvas_pane
//   - rightSidebar  -> mod_layout.mod_right_sidebar
//   - bottomStrip   -> mod_layout.mod_bottom_strip_capture (landed —
//                      `<BottomStripCapture>` scaffold mounts here;
//                      `mod_capture_flow.*` and `mod_mode_banner` fill
//                      its sub-slots)

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { OperateLayout } from '../layout/OperateLayout';
import { BottomStripCapture } from '../layout/BottomStripCapture';
import { useCaptureStore, useSelectionStore, useUiStore } from '../stores/index.js';

export function OperateRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const captureMode = useCaptureStore((state) => state.mode);
  const selection = useSelectionStore((state) => state.selected);
  const activeSidebarPane = useUiStore((state) => state.activeSidebarPane);
  return (
    <main data-testid="route-operate">
      <OperateLayout
        graphPane={
          <div data-testid="operate-graph-placeholder">
            <h1 data-testid="route-title">Operate</h1>
            <p data-testid="session-id">{id}</p>
            <p data-testid="i18n-hello">{t('chrome.hello')}</p>
            <p data-testid="capture-mode">{captureMode}</p>
            <p data-testid="selected-entity">
              {selection ? `${selection.kind}:${selection.id}` : 'none'}
            </p>
            <p data-testid="active-sidebar-pane">{activeSidebarPane}</p>
          </div>
        }
        bottomStrip={<BottomStripCapture />}
      />
    </main>
  );
}
