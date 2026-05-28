// Vitest cases for `<AudienceLiveRoute>`.
//
// Refinement: tasks/refinements/audience/aud_session_url.md
//   (Acceptance criteria — 5 cases enumerated below pin the route's
//   component-tier contract: graph mount, `trackSession` lifecycle,
//   parametrization across bare and locale-prefixed URL shapes.)
// ADRs:        0022 (no throwaway verifications).
//
// Pattern lifted from `apps/participant/src/routes/OperateRoute.test.tsx`
// — the audience consumes the same `<WsClientProvider>` seam via
// `useWsClient()`, so the same fake-client recipe pins
// `trackSession` lifecycle without standing up the real WS path.

import { type ReactElement } from 'react';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import {
  AuthValueProvider,
  I18nProvider,
  WsClientProvider,
  WsRequestError,
  WsRequestTimeoutError,
  createI18nInstance,
  type AuthContextValue,
  type I18nInstance,
  type WsClient,
} from '@a-conversa/shell';

import { AudienceLiveRoute } from './AudienceLiveRoute';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '../graph/cytoscapeTestEnv';
import { audienceWsStore } from '../ws/wsStore';

const SESSION_ID_A = '00000000-0000-4000-8000-0000000000aa';
const SESSION_ID_B = '00000000-0000-4000-8000-0000000000bb';
const CALLER_USER_ID = '00000000-0000-4000-8000-000000000003';

const authenticatedAuth: AuthContextValue = {
  status: 'authenticated',
  user: { userId: CALLER_USER_ID, screenName: 'maria' },
  refresh: () => undefined,
  logout: () => undefined,
};

const anonymousAuth: AuthContextValue = {
  status: 'unauthenticated',
  user: undefined,
  refresh: () => undefined,
  logout: () => undefined,
};

interface FakeClient {
  client: WsClient;
  trackSessionSpy: ReturnType<typeof vi.fn>;
  untrackSessionSpy: ReturnType<typeof vi.fn>;
  onEnvelopeSpy: ReturnType<typeof vi.fn>;
}

function createFakeClient(opts?: {
  trackSessionImpl?: (sessionId: string) => Promise<void>;
}): FakeClient {
  const impl = opts?.trackSessionImpl ?? ((): Promise<void> => Promise.resolve());
  const trackSessionSpy = vi.fn(impl);
  const untrackSessionSpy = vi.fn((): Promise<void> => Promise.resolve());
  // `<AudienceLiveRoute>` subscribes to the envelope fanout to catch the
  // deferred subscribe rejection that the WS client's hello-driven
  // `resumeSubscriptions()` swallows in production timing. The fake
  // never emits envelopes; returning a no-op unsubscribe satisfies the
  // call site without standing up an envelope-fanout simulation.
  const onEnvelopeSpy = vi.fn((): (() => void) => () => undefined);
  const client = {
    connect: () => undefined,
    close: () => undefined,
    send: (() => Promise.resolve({}) as unknown) as WsClient['send'],
    trackSession: trackSessionSpy,
    untrackSession: untrackSessionSpy,
    onEnvelope: onEnvelopeSpy,
  } as unknown as WsClient;
  return { client, trackSessionSpy, untrackSessionSpy, onEnvelopeSpy };
}

let i18nInstance: I18nInstance;
let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
});

function renderRoute(opts: {
  initialPath: string;
  auth?: AuthContextValue;
  fake?: FakeClient;
}): FakeClient {
  const fake = opts.fake ?? createFakeClient();
  const auth = opts.auth ?? authenticatedAuth;
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={auth}>
        <WsClientProvider auth={{ status: auth.status }} client={fake.client}>
          <MemoryRouter initialEntries={[opts.initialPath]}>
            <Routes>
              <Route path="/sessions/:sessionId" element={<AudienceLiveRoute />} />
              <Route path="/:locale/sessions/:sessionId" element={<AudienceLiveRoute />} />
            </Routes>
          </MemoryRouter>
        </WsClientProvider>
      </AuthValueProvider>
    </I18nProvider>,
  );
  return fake;
}

describe('AudienceLiveRoute', () => {
  it('(a) renders <AudienceGraphView> when the route matches', async () => {
    renderRoute({ initialPath: `/sessions/${SESSION_ID_A}` });
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
  });

  it('(b) calls trackSession(sessionId) once on mount when the URL is /sessions/<uuid>', async () => {
    const fake = renderRoute({ initialPath: `/sessions/${SESSION_ID_A}` });
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledTimes(1);
    });
    expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_A);
  });

  it('(c) calls trackSession(newId) when the matched session id changes', async () => {
    // The route's `useEffect` depends on `sessionId`; when React Router's
    // matcher hands the route component a new `:sessionId` value (the
    // user navigates to a different session URL), the effect re-runs
    // and `trackSession` fires with the new id. Drive the navigation
    // via the router's hooks rather than re-mounting two MemoryRouters
    // (MemoryRouter's `initialEntries` is mount-only; a real re-mount
    // is a stronger proof but doesn't pin the in-place dep change).
    const fake = createFakeClient();
    function Navigator(): ReactElement {
      const navigate = useNavigate();
      return (
        <button
          data-testid="probe-navigate-to-b"
          type="button"
          onClick={() => {
            void navigate(`/sessions/${SESSION_ID_B}`);
          }}
        >
          go
        </button>
      );
    }
    render(
      <I18nProvider i18n={i18nInstance}>
        <AuthValueProvider value={authenticatedAuth}>
          <WsClientProvider auth={{ status: authenticatedAuth.status }} client={fake.client}>
            <MemoryRouter initialEntries={[`/sessions/${SESSION_ID_A}`]}>
              <Navigator />
              <Routes>
                <Route path="/sessions/:sessionId" element={<AudienceLiveRoute />} />
              </Routes>
            </MemoryRouter>
          </WsClientProvider>
        </AuthValueProvider>
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_A);
    });
    act(() => {
      screen.getByTestId('probe-navigate-to-b').click();
    });
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_B);
    });
    const calls = fake.trackSessionSpy.mock.calls as Array<[string]>;
    const ids = calls.map((args) => args[0]);
    expect(ids).toContain(SESSION_ID_A);
    expect(ids).toContain(SESSION_ID_B);
  });

  it('(d) does not crash when the URL segment is not a UUID; trackSession receives the raw segment', async () => {
    // The route matches any non-slash segment under `:sessionId` — the
    // server-side `trackSession` handler rejects malformed ids with a
    // wire envelope; the client-side route still mounts.
    const fake = renderRoute({ initialPath: `/sessions/not-a-uuid` });
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledWith('not-a-uuid');
    });
    expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
  });

  it.each([
    ['en-US', `/en-US/sessions/${SESSION_ID_A}`],
    ['pt-BR', `/pt-BR/sessions/${SESSION_ID_A}`],
  ])('(e) mounts under the locale-prefixed shape (%s)', async (_locale, initialPath) => {
    const fake = renderRoute({ initialPath });
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
    expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_A);
  });

  // Cases (f)–(i) pin the per-session sign-in CTA per
  // `aud_private_session_sign_in_cta.md` Acceptance criteria.

  it('(f) renders the private-session CTA when trackSession rejects with not-found and the visitor is anonymous', async () => {
    const fake = createFakeClient({
      trackSessionImpl: () =>
        Promise.reject(new WsRequestError({ code: 'not-found', message: 'session not found' })),
    });
    renderRoute({
      initialPath: `/sessions/${SESSION_ID_A}`,
      auth: anonymousAuth,
      fake,
    });
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
    const cta = await screen.findByTestId('audience-private-session-cta');
    expect(cta).toBeTruthy();
    const loginLink = cta.querySelector('a');
    expect(loginLink).not.toBeNull();
    expect(loginLink?.getAttribute('href')).toBe('/api/auth/login');
  });

  it('(g) does NOT render the CTA when trackSession rejects with not-found but the visitor is authenticated', async () => {
    const fake = createFakeClient({
      trackSessionImpl: () =>
        Promise.reject(new WsRequestError({ code: 'not-found', message: 'session not found' })),
    });
    renderRoute({
      initialPath: `/sessions/${SESSION_ID_A}`,
      auth: authenticatedAuth,
      fake,
    });
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_A);
    });
    // Drain the rejected-promise microtask + any state-update batch so
    // a buggy implementation that surfaced the CTA for authenticated
    // visitors would have had time to render it.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('audience-private-session-cta')).toBeNull();
  });

  it('(h) does NOT render the CTA when trackSession resolves successfully (public-session happy path, anonymous visitor)', async () => {
    const fake = createFakeClient({ trackSessionImpl: () => Promise.resolve() });
    renderRoute({
      initialPath: `/sessions/${SESSION_ID_A}`,
      auth: anonymousAuth,
      fake,
    });
    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_A);
    });
    expect(screen.queryByTestId('audience-private-session-cta')).toBeNull();
  });

  it('(i) does NOT render the CTA when trackSession rejects with a non-not-found code (Decision §4)', async () => {
    // Mix of rejection shapes the gate must NOT match: a different
    // WsRequestError code, a transport-level timeout, a plain Error
    // from a socket drop. Each shape is checked sequentially against
    // a fresh render so a buggy gate that matched any of them would
    // fail at least one of the three sub-assertions.
    const rejections: Array<{ name: string; err: Error }> = [
      {
        name: 'WsRequestError code=invalid',
        err: new WsRequestError({ code: 'invalid', message: 'protocol violation' }),
      },
      {
        name: 'WsRequestTimeoutError',
        err: new WsRequestTimeoutError('subscribe', 'ws-req-1'),
      },
      {
        name: 'generic transport-closed Error',
        err: new Error('ws connection closed'),
      },
    ];
    for (const { err } of rejections) {
      const fake = createFakeClient({ trackSessionImpl: () => Promise.reject(err) });
      renderRoute({
        initialPath: `/sessions/${SESSION_ID_A}`,
        auth: anonymousAuth,
        fake,
      });
      await waitFor(() => {
        expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID_A);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.queryByTestId('audience-private-session-cta')).toBeNull();
      cleanup();
      audienceWsStore.getState().reset();
    }
  });
});
