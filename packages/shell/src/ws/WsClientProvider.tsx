// `WsClientProvider` + `useWsClient` — React seam for the WS client.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//
// Hoisted from `apps/moderator/src/ws/WsClientProvider.tsx`. The provider
// owns the singleton `WsClient` instance for the React subtree. It opens
// the client when an authenticated user is observed (via the `auth`
// prop, NOT by calling `useAuth` directly — the provider stays
// decoupled from the auth hook so tests can wire it without spinning
// up the full auth flow) and tears it down on logout / unmount.
//
// The provider supports an optional `store` prop. When provided, the
// auto-constructed client (via `clientOptions`) uses that store; the
// store is also used for the on-unmount `reset()` call. When not
// provided, the client uses its default in-package store.
//
// Components inside the provider read the client via `useWsClient()`.

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
import type { BaseWsStoreState, WsStoreLike } from './store-contract.js';

/**
 * The slice of auth state the provider needs to know whether to open
 * the client. The narrower shape (instead of the full
 * `AuthContextValue`) lets tests pass a literal without constructing
 * the full auth provider.
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
  /**
   * Optional store the provider resets on unmount. When `client` is
   * NOT provided and `clientOptions.store` is also missing, the
   * auto-constructed client gets the default in-package store; in that
   * case the unmount `reset()` runs against the default store rather
   * than this prop.
   */
  readonly store?: WsStoreLike<BaseWsStoreState>;
  readonly children: ReactNode;
}

const WsClientContext = createContext<WsClient | undefined>(undefined);

/**
 * Provider component. Creates (or accepts) a `WsClient`, opens it when
 * the user is authenticated, and tears it down on unmount.
 */
export function WsClientProvider(props: WsClientProviderProps): ReactElement {
  const { auth, clientOptions, client: externalClient, store, children } = props;
  const clientRef = useRef<WsClient | undefined>(externalClient);

  const client = useMemo(() => {
    if (externalClient !== undefined) return externalClient;
    if (clientRef.current === undefined) {
      clientRef.current = createWsClient(clientOptions);
    }
    return clientRef.current;
    // `clientOptions` is intentionally excluded — the client is a
    // mount-time singleton; reconfiguring it mid-flight would require
    // tearing down the socket, which is not a supported pattern.
  }, [externalClient]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    client.connect();
    return () => {
      client.close();
      // Reset the store on teardown so a fresh login starts clean.
      // Prefer the explicit `store` prop, then `clientOptions.store`,
      // otherwise no-op (the default store inside the client is
      // unreachable from here — closures eat the reference).
      const explicit = store ?? clientOptions?.store;
      explicit?.getState().reset();
    };
  }, [auth.status, client, store, clientOptions]);

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
