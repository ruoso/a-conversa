import { useEffect, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { SurfaceHost } from './surfaces/SurfaceHost';
import { LandingRoute } from './routes/LandingRoute';
import { LoginRoute } from './routes/LoginRoute';
import { ScreenNameRoute } from './routes/ScreenNameRoute';
import { AuthCallbackRoute } from './routes/AuthCallbackRoute';

function LogoutRoute(): ReactElement {
  const { t } = useTranslation();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('a-conversa:return-to');
    }

    void (async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } finally {
        window.location.replace('/login');
      }
    })();
  }, []);

  return (
    <main data-testid="route-logout" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">
        {t('auth.login.logout')}
      </h1>
    </main>
  );
}

export default function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/screen-name" element={<ScreenNameRoute />} />
      <Route path="/logout" element={<LogoutRoute />} />
      <Route path="/auth/callback" element={<AuthCallbackRoute />} />
      <Route path="/m/*" element={<SurfaceHost surfaceId="moderator" routerBasePath="/m" />} />
      <Route path="/p/*" element={<SurfaceHost surfaceId="participant" routerBasePath="/p" />} />
      <Route path="/a/*" element={<SurfaceHost surfaceId="audience" routerBasePath="/a" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
