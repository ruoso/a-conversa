import { type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { rememberReturnTo } from '../surfaces/SurfaceHost';

export function AuthCallbackRoute(): ReactElement {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const returnTo = searchParams.get('return_to');
  if (returnTo !== null) {
    rememberReturnTo(returnTo);
  }
  return <Navigate to="/login" replace />;
}
