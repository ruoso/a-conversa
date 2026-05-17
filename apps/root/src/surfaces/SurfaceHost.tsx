import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, type I18n } from '@a-conversa/shell';

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

export function SurfaceHost(props: SurfaceHostProps): ReactElement {
  const { surfaceId, routerBasePath } = props;
  const auth = useAuth();
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      return;
    }

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
        const manifest = await loadSurfaceManifest();
        const entry = manifest.surfaces[surfaceId];
        if (entry === undefined) {
          throw new Error(`surface ${surfaceId} is not present in the manifest`);
        }

        styleLinks = injectStyles(entry.styleUrls ?? []);
        const surface = await importSurfaceModule(entry.moduleUrl);

        if (cancelled) {
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

  if (auth.status === 'unauthenticated') {
    rememberReturnTo(location.pathname + location.search + location.hash);
    return <Navigate to="/login" replace />;
  }

  if (auth.status === 'needs-screen-name') {
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
