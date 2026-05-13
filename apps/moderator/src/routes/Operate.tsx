// Placeholder operate route for `/sessions/:id/operate` — the main
// moderator console (three-pane layout, graph canvas, capture pane,
// right sidebar). The real shell lands with
// `moderator_ui.mod_layout.*`; this stub keeps the route reachable.
//
// The route reads from each of the three Zustand stores
// (`useCaptureStore`, `useSelectionStore`, `useUiStore`) introduced by
// `moderator_ui.mod_shell.mod_state_management`, satisfying that
// refinement's acceptance criterion ("a trivial component reads from
// each store and re-renders on update"). The render is intentionally
// minimal — downstream `mod_layout.*` tasks replace this stub with the
// real three-pane shell that consumes the same stores.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useCaptureStore, useSelectionStore, useUiStore } from '../stores/index.js';

export function OperateRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const captureMode = useCaptureStore((state) => state.mode);
  const selection = useSelectionStore((state) => state.selected);
  const activeSidebarPane = useUiStore((state) => state.activeSidebarPane);
  return (
    <main data-testid="route-operate">
      <h1 data-testid="route-title">Operate</h1>
      <p data-testid="session-id">{id}</p>
      <p data-testid="i18n-hello">{t('chrome.hello')}</p>
      <p data-testid="capture-mode">{captureMode}</p>
      <p data-testid="selected-entity">
        {selection ? `${selection.kind}:${selection.id}` : 'none'}
      </p>
      <p data-testid="active-sidebar-pane">{activeSidebarPane}</p>
    </main>
  );
}
