import type { ReactElement, ReactNode } from 'react';

import { AuthContext } from './AuthContext.js';
import type { AuthContextValue } from './types.js';

export interface AuthValueProviderProps {
  readonly value: AuthContextValue;
  readonly children: ReactNode;
}

export function AuthValueProvider(props: AuthValueProviderProps): ReactElement {
  const { value, children } = props;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
