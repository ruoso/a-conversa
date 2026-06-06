import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, type I18n, type SurfaceModule } from '@a-conversa/shell';

import { importSurfaceModule, injectStyles, loadSurfaceManifest } from './manifest';

const RETURN_TO_KEY = 'a-conversa:return-to';

function sanitizeReturnTo(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  if (value === '/login' || value === '/screen-name' || value === '/logout') {
    return '/';
  }
  return value;
}

export function rememberReturnTo(value: string): void {
  const target = sanitizeReturnTo(value);
  if (target === undefined || typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(RETURN_TO_KEY, target);
}

export function takeRememberedReturnTo(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const remembered = sanitizeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY));
  window.sessionStorage.removeItem(RETURN_TO_KEY);
  return remembered;
}

export interface SurfaceHostProps {
  readonly surfaceId: string;
  readonly routerBasePath: string;
}

type ResolvedAuthLevel = 'public' | 'authenticated';

export function SurfaceHost(props: SurfaceHostProps): ReactElement {
  const { surfaceId, routerBasePath } = props;
  const auth = useAuth();
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadNonce, setReloadNonce] = useState(0);
  // The host resolves the surface's required-auth level only after
  // dynamically importing the module — so until the first import
  // resolves, this is `undefined` and the render falls through the
  // gate checks (which both require `requiredAuth === 'authenticated'`).
  // The renderer shows an empty container `<div>` during that window;
  // see Decision §1 of `aud_no_auth_for_public.md`.
  const [requiredAuth, setRequiredAuth] = useState<ResolvedAuthLevel | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let styleLinks: HTMLLinkElement[] = [];

    void (async () => {
      try {
        setError(undefined);

        // Dev-only path (`make dev`): import the surface from source so the
        // root Vite dev server transpiles + HMRs it, bypassing the manifest
        // + built-bundle fetch. Gated on a flag the dev server's `serve`
        // config defines; undefined in production builds + under Vitest, so
        // both fall through to the real loading path below. See
        // `devSurfaces.ts` and `apps/root/vite.config.ts`.
        let surface: SurfaceModule;
        if (import.meta.env.VITE_SURFACE_SOURCE) {
          const { loadDevSurface } = await import('./devSurfaces');
          surface = await loadDevSurface(surfaceId);
        } else {
          const manifest = await loadSurfaceManifest();
          const entry = manifest.surfaces[surfaceId];
          if (entry === undefined) {
            throw new Error(`surface ${surfaceId} is not present in the manifest`);
          }

          styleLinks = injectStyles(entry.styleUrls ?? []);
          surface = await importSurfaceModule(entry.moduleUrl);
        }

        if (cancelled) {
          return;
        }

        // Resolve the auth gate AFTER reading meta. A surface that
        // declares `requiredAuthLevel: 'public'` is mounted regardless
        // of auth status; the host hands whatever `auth` value it has
        // (including `'unauthenticated'` + `user: undefined`) through
        // to `mount()`. See Decisions §1 + §5 of
        // `aud_no_auth_for_public.md`.
        const resolved: ResolvedAuthLevel = surface.meta?.requiredAuthLevel ?? 'authenticated';
        setRequiredAuth(resolved);
        if (resolved === 'authenticated' && auth.status !== 'authenticated') {
          // Let the render branches below deflect to /login or
          // /screen-name as appropriate; do NOT mount the surface.
          return;
        }

        cleanup = surface.mount({
          container,
          auth,
          i18n: i18n as unknown as I18n,
          routerBasePath,
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      for (const link of styleLinks) {
        if (link.dataset.surfaceStyle !== undefined) {
          link.remove();
        }
      }
      container.innerHTML = '';
    };
  }, [auth, i18n, reloadNonce, routerBasePath, surfaceId]);

  if (auth.status === 'loading') {
    return (
      <main data-testid="surface-loading" className="mx-auto max-w-2xl p-6">
        <h1 data-testid="route-title" className="text-2xl font-semibold">
          {t('auth.login.title')}
        </h1>
        <p data-testid="auth-checking">{t('auth.login.checking')}</p>
      </main>
    );
  }

  // Only deflect to /login or /screen-name once the surface module has
  // resolved AND declared it requires authentication. A surface whose
  // `meta.requiredAuthLevel` is `'public'` mounts regardless of auth
  // status; while `requiredAuth` is still `undefined` (manifest fetch
  // / dynamic-import in flight), fall through to the container `<div>`
  // — that's the same DOM the user would see while the manifest
  // resolves today. See Decisions §1 + §6 of `aud_no_auth_for_public.md`
  // (the `rememberReturnTo` write MUST NOT fire for public surfaces).
  if (requiredAuth === 'authenticated' && auth.status === 'unauthenticated') {
    rememberReturnTo(location.pathname + location.search + location.hash);
    return <Navigate to="/login" replace />;
  }

  if (requiredAuth === 'authenticated' && auth.status === 'needs-screen-name') {
    rememberReturnTo(location.pathname + location.search + location.hash);
    return <Navigate to="/screen-name" replace />;
  }

  if (error !== undefined) {
    return (
      <main data-testid="surface-load-error" className="mx-auto max-w-2xl p-6">
        <h1 data-testid="route-title" className="text-2xl font-semibold">
          Surface load failed
        </h1>
        <p data-testid="surface-load-error-message">{error}</p>
        <button
          type="button"
          data-testid="surface-load-error-retry"
          onClick={() => {
            setReloadNonce((value) => value + 1);
          }}
        >
          Retry
        </button>
      </main>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid={`surface-container-${surfaceId}`}
      className="min-h-screen"
    />
  );
}
