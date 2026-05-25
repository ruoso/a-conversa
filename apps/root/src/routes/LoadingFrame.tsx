import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export function LoadingFrame(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-login" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">
        {t('auth.login.title')}
      </h1>
      <p data-testid="auth-checking">{t('auth.login.checking')}</p>
    </main>
  );
}
