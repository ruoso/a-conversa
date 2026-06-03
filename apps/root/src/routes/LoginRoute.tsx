import { useEffect, type ReactElement } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '@a-conversa/shell';

import { takeRememberedReturnTo } from '../surfaces/SurfaceHost';
import { LoadingFrame } from './LoadingFrame';

const SSO_LOGIN_URL = '/api/auth/login';

function resolvePostAuthTarget(): string {
  return takeRememberedReturnTo() ?? '/home';
}

export function LoginRoute(): ReactElement {
  const auth = useAuth();
  const shouldRedirectToSso = auth.status === 'unauthenticated';

  // Unauthenticated visitors have nothing to do on this route except
  // hand control to the OIDC provider, so skip the intermediate "Sign
  // in" button and full-page navigate straight to the server's
  // `/api/auth/login` endpoint (which 302s onto Authelia). A useEffect
  // is the right hook: the redirect is a side effect and React forbids
  // mutating `window.location` during render. The OIDC dance is cross-
  // origin so `window.location.replace` (not React Router) is required.
  useEffect(() => {
    if (shouldRedirectToSso && typeof window !== 'undefined') {
      window.location.replace(SSO_LOGIN_URL);
    }
  }, [shouldRedirectToSso]);

  if (auth.status === 'loading') {
    return <LoadingFrame />;
  }

  if (auth.status === 'needs-screen-name') {
    return <Navigate to="/screen-name" replace />;
  }

  if (auth.status === 'authenticated') {
    return <Navigate to={resolvePostAuthTarget()} replace />;
  }

  return <LoadingFrame />;
}
