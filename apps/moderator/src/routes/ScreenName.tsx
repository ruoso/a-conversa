// Screen-name capture route for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_screen_name_setup.md +
//   tasks/refinements/shell-package/shell_substrate_extraction.md
//   (the form body extracted to `<ScreenNameForm>` in `@a-conversa/shell`;
//   this route stays in the moderator as a thin shim that owns the
//   `<main data-testid="route-screen-name">` wrapper plus the post-
//   success navigation).
// Backend contract: POST /auth/screen-name (apps/server/src/auth/routes.ts).
// TaskJuggler: moderator_ui.mod_shell.mod_screen_name_setup
//
// The form body — client-side validation, accessibility wiring, error
// mapping, all of it — lives in `@a-conversa/shell`'s `<ScreenNameForm>`.
// This wrapper supplies the route-level chrome (the `<main>` testid
// the RequireAuth gate asserts on, the `<h1>` title) and the post-
// success navigation: `onSuccess={() => navigate('/login', { replace: true })}`
// lands the user on the welcome banner the Login route renders for
// authenticated users.

import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ScreenNameForm } from '@a-conversa/shell';

export function ScreenNameRoute(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <main data-testid="route-screen-name">
      <h1 data-testid="route-title">{t('auth.screenName.title')}</h1>
      <ScreenNameForm
        onSuccess={() => {
          // `navigate` may return `void | Promise<void>` in router v7;
          // we don't await here because the navigation tear-down is
          // synchronous from this component's perspective — the route
          // unmounts immediately. Mark the return explicitly.
          void navigate('/login', { replace: true });
        }}
      />
    </main>
  );
}
