// Vitest cases for `<OperateRoute>`.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//              (Test layers per ADR 0022 — four cases per the
//              refinement's "Tests pin" sketch: lifecycle, layout
//              regions, not-authenticated guard, route testid).
// ADRs:        0022 (no throwaway verifications).
//
// Patterns lifted from `apps/participant/src/routes/LobbyRoute.test.tsx`
// (the `WsClientProvider` fake-client wiring and the `useWsStore` reset
// posture) — both routes consume the same surface-wide WS provider via
// `useWsClient()`, so the same fake-client recipe pins the
// `trackSession` / `untrackSession` lifecycle.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  AuthValueProvider,
  I18nProvider,
  WsClientProvider,
  createI18nInstance,
  type AuthContextValue,
  type I18nInstance,
  type WsClient,
} from '@a-conversa/shell';

import { OperateRoute } from './OperateRoute';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '../graph/cytoscapeTestEnv';
import { useWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const CALLER_USER_ID = '00000000-0000-4000-8000-000000000002';

const authenticatedCallerAuth: AuthContextValue = {
  status: 'authenticated',
  user: { userId: CALLER_USER_ID, screenName: 'ben' },
  refresh: () => undefined,
  logout: () => undefined,
};

const notAuthenticatedAuth: AuthContextValue = {
  status: 'unauthenticated',
  user: undefined,
  refresh: () => undefined,
  logout: () => undefined,
};

interface FakeClient {
  client: WsClient;
  trackSessionSpy: ReturnType<typeof vi.fn>;
  untrackSessionSpy: ReturnType<typeof vi.fn>;
}

function createFakeClient(): FakeClient {
  const trackSessionSpy = vi.fn((): Promise<void> => Promise.resolve());
  const untrackSessionSpy = vi.fn((): Promise<void> => Promise.resolve());
  const client = {
    connect: () => undefined,
    close: () => undefined,
    send: (() => Promise.resolve({}) as unknown) as WsClient['send'],
    trackSession: trackSessionSpy,
    untrackSession: untrackSessionSpy,
  } as unknown as WsClient;
  return { client, trackSessionSpy, untrackSessionSpy };
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
  useWsStore.getState().reset();
});

function renderRoute(opts: { auth?: AuthContextValue } = {}): FakeClient {
  const auth = opts.auth ?? authenticatedCallerAuth;
  const fake = createFakeClient();
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={auth}>
        <WsClientProvider auth={{ status: auth.status }} client={fake.client}>
          <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
            <Routes>
              <Route path="/sessions/:id" element={<OperateRoute />} />
            </Routes>
          </MemoryRouter>
        </WsClientProvider>
      </AuthValueProvider>
    </I18nProvider>,
  );
  return fake;
}

describe('OperateRoute — per-session WS lifecycle', () => {
  it('(a) calls trackSession on mount and untrackSession on cleanup', () => {
    const fake = renderRoute();
    expect(fake.trackSessionSpy).toHaveBeenCalledTimes(1);
    expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
    expect(fake.untrackSessionSpy).not.toHaveBeenCalled();
    cleanup();
    expect(fake.untrackSessionSpy).toHaveBeenCalledTimes(1);
    expect(fake.untrackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('OperateRoute — layout composition', () => {
  it('(b) renders the four named layout regions', () => {
    renderRoute();
    expect(screen.getByTestId('participant-layout-root')).toBeTruthy();
    expect(screen.getByTestId('participant-header')).toBeTruthy();
    expect(screen.getByTestId('participant-main')).toBeTruthy();
    expect(screen.getByTestId('participant-footer')).toBeTruthy();
  });
});

describe('OperateRoute — not-authenticated guard', () => {
  it('(c) renders the participant-not-authenticated body when auth status is not authenticated', () => {
    renderRoute({ auth: notAuthenticatedAuth });
    // The body's dedicated testid is present without crashing on
    // `auth.user.screenName` (the guard branch bypasses the GraphView
    // mount entirely, so no Cytoscape root either).
    expect(screen.getByTestId('participant-not-authenticated')).toBeTruthy();
    expect(screen.queryByTestId('participant-graph-root')).toBeNull();
    // The route-operate testid is still present on the wrapper.
    const route = screen.getByTestId('route-operate');
    expect(route.getAttribute('data-state')).toBe('not-authenticated');
  });
});

describe('OperateRoute — route testid', () => {
  it('(d) renders the route-operate testid on the outer wrapper', () => {
    renderRoute();
    expect(screen.getByTestId('route-operate')).toBeTruthy();
  });
});
