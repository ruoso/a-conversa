// Placeholder operate route for `/sessions/:id/operate` — the main
// moderator console (three-pane layout, graph canvas, capture pane,
// right sidebar). The real shell lands with
// `moderator_ui.mod_layout.*`; this stub keeps the route reachable.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function OperateRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  return (
    <main data-testid="route-operate">
      <h1 data-testid="route-title">Operate</h1>
      <p data-testid="session-id">{id}</p>
      <p data-testid="i18n-hello">{t('chrome.hello')}</p>
    </main>
  );
}
