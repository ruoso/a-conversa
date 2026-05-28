// Audience surface route tree.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
// ADRs:        0026 (host owns auth chrome; the surface reads the
//                    host-supplied `useAuth()` inside its
//                    `<PlaceholderRoute>` and renders a `<LoginButton>`
//                    chrome for anonymous visitors so a viewer of a
//                    private session can sign in and retry — landed by
//                    `aud_auth_for_private`. Per-session
//                    subscribe-rejection-aware messaging is downstream
//                    in `aud_url_routing.aud_session_url`.),
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
// **OBS no-input invariant** (`aud_obs_no_input_required`). The audience
// surface mounts and renders without any required user gesture. The
// optional `<LoginButton>` chrome rendered under `audience-sign-in` is
// an affordance, not a requirement — the OBS-typical anonymous-on-
// public visit ignores it. Patterns that would gate rendering on a
// gesture (`<dialog>`, `[aria-modal]`, `<audio>` / `<video>` autoplay,
// `[data-requires-input="true"]`) are forbidden — pinned by a Vitest
// mount audit in `mount.test.tsx` and a Playwright audit in
// `tests/e2e/audience-skeleton-smoke.spec.ts`. When
// `aud_url_routing.aud_session_url` makes the graph route reachable,
// that leaf extends the audit; the `aud_tests.aud_obs_render_smoke`
// leaf extends it across OBS-typical dimensions (1920×1080, etc.).
//
// **OBS sizing invariant** (`aud_obs_sizing_defaults`). The audience
// surface's root chain is full-bleed: `html`, `body`, `#root` are
// 100% × 100% with `body { overflow: hidden }` so an OBS browser
// source at any configured resolution renders edge-to-edge without a
// scrollbar-reserved whitespace strip (see `apps/audience/src/index.css`).
// The canonical OBS-source dimensions are the `BROADCAST_DIMENSIONS`
// named export in `graph/layoutOptions.ts` ({720p, 1080p, 1440p} per
// `i18n_audience_typography.md` line 24); `DEFAULT_BROADCAST_DIMENSIONS`
// aliases 1080p (OBS Studio's out-of-the-box browser-source size).
// Pixel-level rendering at each dimension is deferred to
// `aud_tests.aud_obs_render_smoke` (graph route not yet reachable, so
// the placeholder route is dimension-insensitive at this tier).
//
// **OBS transparency invariant** (`aud_obs_transparency`). The audience
// surface's `<body>` is transparent (`background-color: transparent`,
// serialised by Chromium as `rgba(0, 0, 0, 0)`) so an OBS browser
// source composites the rendered graph over the producer's scene via
// the page's alpha channel — zero per-producer setup, perfect-edge
// compositing on anti-aliased Cytoscape glyphs. Cytoscape's canvas is
// transparent by construction (no background fill in the stylesheet);
// the body transparency lets that natural transparency reach OBS.
// Node fills remain `#ffffff` (see `graph/stylesheet.ts`) — that's a
// legibility decision for slate-900 label text on arbitrary producer
// scenes, NOT a page-level paint. Pinned by a Vitest mount audit in
// `mount.test.tsx` and a Playwright assertion appended to scenario 6
// of `tests/e2e/audience-live-session.spec.ts`; the dimension-matrix
// pin across 720p / 1440p lives in `aud_tests.aud_obs_render_smoke`.
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
import { LoginButton, useAuth } from '@a-conversa/shell';

import { AudienceLiveRoute } from './routes/AudienceLiveRoute.js';

function AnonymousChrome(): ReactElement {
  // The per-session "this session is private; sign in to view" wording
  // lives in `aud_url_routing.aud_session_url` (downstream); this static
  // chrome is the transport for that future contextual flow.
  return (
    <div data-testid="audience-sign-in" className="mt-6 text-sm text-slate-500">
      <LoginButton className="underline underline-offset-2" />
    </div>
  );
}

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  const { status, user } = useAuth();

  let chrome: ReactElement | null;
  switch (status) {
    case 'authenticated':
      // Defensive narrow: between a host-level `auth.refresh()` flipping
      // the value out of `'authenticated'` and React re-rendering the
      // surface, `user` can be `undefined` while `status` is still
      // `'authenticated'`. Mirrors the participant's `part_auth_flow`
      // Decision §A guard; the audience degrades to the LoginButton.
      chrome = user === undefined ? <AnonymousChrome /> : null;
      break;
    case 'unauthenticated':
    case 'needs-screen-name':
      chrome = <AnonymousChrome />;
      break;
    case 'loading':
      chrome = null;
      break;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }

  return (
    <main data-testid="route-audience-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('audience.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('audience.placeholder.body')}</p>
      {chrome}
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
      {/*
       * `aud_session_url` — the first reachable session URL. Both
       * shapes mount `<AudienceLiveRoute>` (which calls
       * `useWsClient().trackSession(sessionId)` and renders
       * `<AudienceGraphView>`). The locale-prefixed sibling shares the
       * same component because the `<App>` `useEffect` above already
       * negotiates the locale from `window.location.pathname` — the
       * route component is locale-agnostic. Inserted above the wildcard
       * so non-session URLs (`/a`, `/a/foo`, future `/a/replay/...`)
       * continue to fall through to the placeholder.
       */}
      <Route path="/sessions/:sessionId" element={<AudienceLiveRoute />} />
      <Route path="/:locale/sessions/:sessionId" element={<AudienceLiveRoute />} />
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
