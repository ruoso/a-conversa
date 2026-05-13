// Placeholder lobby route for `/sessions/:id/lobby`.
//
// The real lobby UX (participant readiness, waiting-for-everyone state)
// lands with `moderator_ui.mod_session_setup.mod_session_lobby`.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function LobbyRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  return (
    <main data-testid="route-lobby">
      <h1 data-testid="route-title">Lobby</h1>
      <p data-testid="session-id">{id}</p>
      <p data-testid="i18n-hello">{t('chrome.hello')}</p>
    </main>
  );
}
