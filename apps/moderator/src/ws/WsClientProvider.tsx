// `WsClientProvider` + `useWsClient` — React seam for the WS client.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md
//
// The provider owns the singleton `WsClient` instance for the React
// subtree. It opens the client when an authenticated user is observed
// (via the `auth` prop, NOT by calling `useAuth` directly — the provider
// stays decoupled from the auth hook so tests can wire it without
// spinning up the full auth flow) and tears it down on logout / unmount.
//
// Components inside the provider read the client via `useWsClient()` and
// the dispatched server-state via `useWsStore` (the store slice in
// `./wsStore.ts`).

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import { createWsClient, type CreateWsClientOptions, type WsClient } from './client.js';
import { useWsStore } from './wsStore.js';

/**
 * The slice of auth state the provider needs to know whether to open the
 * client. We accept the narrower shape (instead of `UseAuthResult`) so
 * tests can pass a literal without constructing the full hook return.
 */
export interface WsClientAuthState {
  readonly status: 'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated';
}

export interface WsClientProviderProps {
  /** Current auth state. The client opens iff `status === 'authenticated'`. */
  readonly auth: WsClientAuthState;
  /** Optional overrides (test seams, custom backoff, etc.). */
  readonly clientOptions?: CreateWsClientOptions;
  /**
   * Optional pre-constructed client. When provided, the provider does
   * NOT call `createWsClient` — used by tests that want full control
   * over the client lifecycle.
   */
  readonly client?: WsClient;
  readonly children: ReactNode;
}

const WsClientContext = createContext<WsClient | undefined>(undefined);

/**
 * Provider component. Creates (or accepts) a `WsClient`, opens it when
 * the user is authenticated, and tears it down on unmount.
 */
export function WsClientProvider(props: WsClientProviderProps): ReactElement {
  const { auth, clientOptions, client: externalClient, children } = props;
  const clientRef = useRef<WsClient | undefined>(externalClient);

  const client = useMemo(() => {
    if (externalClient !== undefined) return externalClient;
    if (clientRef.current === undefined) {
      clientRef.current = createWsClient(clientOptions);
    }
    return clientRef.current;
    // `clientOptions` is intentionally excluded — the client is a
    // mount-time singleton; reconfiguring it mid-flight would require
    // tearing down the socket, which is not a supported pattern. The
    // project's eslint config doesn't load `react-hooks/exhaustive-deps`,
    // so no disable comment is needed.
  }, [externalClient]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    client.connect();
    return () => {
      client.close();
      // Reset the store on teardown so a fresh login starts clean.
      useWsStore.getState().reset();
    };
  }, [auth.status, client]);

  return <WsClientContext.Provider value={client}>{children}</WsClientContext.Provider>;
}

/**
 * Read the `WsClient` instance off the surrounding `WsClientProvider`.
 * Throws if called outside the provider — surface programming errors at
 * the call site rather than silently returning `undefined`.
 */
export function useWsClient(): WsClient {
  const client = useContext(WsClientContext);
  if (client === undefined) {
    throw new Error('useWsClient must be called inside <WsClientProvider>');
  }
  return client;
}
