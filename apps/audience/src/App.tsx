// Audience surface route tree.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
// ADRs:        0026 (host owns auth chrome; surface only reads the
//                    host-supplied `useAuth()` once private-session
//                    audience views land in `aud_auth_for_private`),
//              0024 (URL-prefix locale rule for the audience surface —
//                    `negotiateUrlLocale(pathname)` parses
//                    `/{locale}/sessions/{id}` from the basename-
//                    stripped URL; the audience surface OWNS the locale
//                    for the duration of its mount because the page may
//                    render inside an OBS browser source that does not
//                    represent a human user),
//              0022 (no throwaway verifications — the
//                    `route-audience-placeholder` testid is the pinned
//                    seam exercised by both the Vitest mount probe and
//                    the Playwright placeholder spec).
//
// The single wildcard route absorbs every URL inside `/a/*` (e.g.
// `/a/sessions/:id`, `/a/en-US/sessions/:id`, `/a/foo/bar`). The real
// audience routes — `<AudienceViewRoute>` for live, the replay deep-
// link route — land later under `aud_url_routing.*` and
// `aud_graph_rendering.*`, at which point this wildcard is replaced
// with the real route table and the placeholder testid disappears.
//
// **First production consumer of `negotiateUrlLocale`.** Per
// `frontend_i18n.i18n_locale_negotiation`'s Status block, the helper
// has shipped since 2026-05-11 but no caller existed. The audience
// surface reads its locale from the URL prefix and re-configures the
// shared (host-supplied) i18n via `i18n.changeLanguage(locale)` inside
// a `useEffect` that only fires when the locale segment changes — the
// audience surface OWNS the locale for the duration of its mount.

import { useEffect, type ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { negotiateUrlLocale } from '@a-conversa/i18n-catalogs';

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-audience-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('audience.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('audience.placeholder.body')}</p>
    </main>
  );
}

export function App(): ReactElement {
  const { i18n } = useTranslation();

  // Per ADR 0024 + `i18n_locale_negotiation.md`, the audience surface
  // reads its locale from the URL prefix (`/{locale}/sessions/:id`
  // under the audience basename, i.e. `/a/{locale}/sessions/:id`
  // globally). The basename strip happens at the root's
  // `<Route path="/a/*">`; `window.location.pathname` under React
  // Router 7's `BrowserRouter basename={"/a"}` still returns the full
  // `/a/`-prefixed path, so the surface strips its own basename before
  // parsing.
  const pathnameWithoutBasename = (() => {
    const full = typeof window !== 'undefined' ? window.location.pathname : '/';
    if (full === '/a') {
      return '/';
    }
    if (full.startsWith('/a/')) {
      return full.substring(2);
    }
    return full;
  })();
  const { locale } = negotiateUrlLocale(pathnameWithoutBasename);

  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [i18n, locale]);

  return (
    <Routes>
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
