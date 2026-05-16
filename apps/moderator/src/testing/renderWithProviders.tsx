// Shared test helper — wraps a React tree in the moderator's bootstrap
// provider stack (`<I18nProvider><AuthProvider><MemoryRouter>...`).
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"Test helper `renderWithProviders` vs inline provider
//   wraps in every test")
//
// After the substrate extraction the moderator's `main.tsx` wraps the
// render tree in `<I18nProvider><AuthProvider><BrowserRouter>`. Tests
// that render `<App />` (or any component depending on `useAuth()` or
// `useTranslation()`) need the same wrap so the hooks resolve. The
// helper centralizes the wrap so the 44+ `it()` cases in `App.test.tsx`
// + 13 in `RequireAuth.test.tsx` don't each grow a 3-deep provider
// stack — future provider additions touch one file.
//
// The i18n instance is bootstrapped once at module load (top-level
// `await` is avoided by lazy-initialising in `getTestI18n`); tests
// share it across cases. The `<AuthProvider>` reads from `global.fetch`
// stubs the test installs in `beforeEach` — the helper does not stub
// fetch itself.

import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import type { i18n as I18nInstance } from 'i18next';
import { AuthProvider, createI18nInstance, I18nProvider } from '@a-conversa/shell';

let cachedI18n: I18nInstance | undefined;

/**
 * Lazily-initialised test-scope i18n instance. The first call awaits
 * `createI18nInstance('en-US')`; subsequent calls return the cached
 * instance (i18next's own `init()` is a no-op fast-path on the second
 * call, but the cache spares the round-trip).
 */
export async function getTestI18n(): Promise<I18nInstance> {
  if (cachedI18n) return cachedI18n;
  cachedI18n = await createI18nInstance('en-US');
  return cachedI18n;
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  readonly initialEntries?: string[];
  /** Pre-bootstrapped i18n instance — defaults to the cached one. */
  readonly i18n?: I18nInstance;
}

/**
 * Render `ui` inside the moderator's provider tree (i18n + auth +
 * MemoryRouter). The caller MUST have called `await getTestI18n()` in
 * `beforeAll` so the cached instance is ready — passing the instance
 * via `options.i18n` is also supported for cases that want a per-test
 * instance.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { initialEntries = ['/'], i18n, ...rest } = options;
  const instance = i18n ?? cachedI18n;
  if (instance === undefined) {
    throw new Error(
      'renderWithProviders: i18n instance not available. Call `await getTestI18n()` in a beforeAll hook, or pass `options.i18n` explicitly.',
    );
  }
  function Wrapper(props: { children: ReactNode }): ReactElement {
    return (
      <I18nProvider i18n={instance!}>
        <AuthProvider>
          <MemoryRouter initialEntries={initialEntries}>{props.children}</MemoryRouter>
        </AuthProvider>
      </I18nProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...rest });
}
