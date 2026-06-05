// Vitest cases for `<AudienceReplayRoute>` — the replay-mode variant of
// the audience surface.
//
// Refinement: tasks/refinements/replay_test/replay_mode_audience_surface.md
//   (Acceptance criterion 2 — the load-state matrix below pins the route's
//   component-tier contract: `ready` mounts the package `GraphView` at the
//   log head, `loading` shows the loading affordance, `not-found` +
//   unauthenticated shows `PrivateSessionCta`, `error` + authenticated
//   shows the unavailable message + a working `retry`.)
// ADRs:        0022 (no throwaway verifications), 0045 (auth posture).
//
// The shell's `useSessionEventLog` is mocked so each case drives a single
// load-machine phase deterministically (no real REST paging). The package
// `@a-conversa/graph-view` `GraphView` is mocked to a prop-capturing
// sentinel: it lets the `ready` case assert the *full* log is passed (the
// head-render contract) without standing up Cytoscape, and renders the
// real `audience-graph-root` testid so the mount assertion stays honest.

import { type ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  AuthValueProvider,
  I18nProvider,
  createI18nInstance,
  type AuthContextValue,
  type I18nInstance,
  type SessionEventLog,
} from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

// ── Mock the replay data source. `importActual` keeps every other shell
// export (AuthValueProvider, I18nProvider, LoginButton, useAuth, …) real,
// so `<PrivateSessionCta>` and the test harness wire normally; only the
// log loader is swapped for a per-case fake.
let mockLog: SessionEventLog;
vi.mock('@a-conversa/shell', async (importActual) => {
  const actual = await importActual<typeof import('@a-conversa/shell')>();
  return {
    ...actual,
    useSessionEventLog: (): SessionEventLog => mockLog,
  };
});

// ── Mock the package renderer to a prop-capturing sentinel.
let capturedGraphProps: { events: readonly Event[]; instanceKey: string } | null = null;
vi.mock('@a-conversa/graph-view', () => ({
  GraphView: (props: { events: readonly Event[]; instanceKey: string }): ReactElement => {
    capturedGraphProps = { events: props.events, instanceKey: props.instanceKey };
    return (
      <div data-testid="audience-graph-root" data-event-count={props.events.length}>
        {`replay graph (${String(props.events.length)} events)`}
      </div>
    );
  },
}));

// Imported AFTER the mocks so the route resolves the mocked modules.
const { AudienceReplayRoute } = await import('./AudienceReplayRoute');

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
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

/** A minimal well-formed head log — three ascending events. The content
 * is irrelevant here (the renderer is mocked); only the array identity /
 * length matters for the head-render assertion. */
function makeLog(): readonly Event[] {
  return [1, 2, 3].map(
    (sequence): Event =>
      ({
        id: `00000000-0000-4000-8000-00000000000${sequence}`,
        sequence,
        kind: 'node-created',
        actor: CALLER_USER_ID,
        createdAt: '2026-06-05T00:00:00.000Z',
        payload: {},
      }) as unknown as Event,
  );
}

let i18nInstance: I18nInstance;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
  capturedGraphProps = null;
});

function renderRoute(auth: AuthContextValue = authenticatedAuth): void {
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={auth}>
        <MemoryRouter initialEntries={[`/replay/${SESSION_ID}`]}>
          <Routes>
            <Route path="/replay/:sessionId" element={<AudienceReplayRoute />} />
          </Routes>
        </MemoryRouter>
      </AuthValueProvider>
    </I18nProvider>,
  );
}

describe('AudienceReplayRoute', () => {
  it('(a) ready: mounts the package GraphView with the graph root and the full log at head', async () => {
    const log = makeLog();
    mockLog = { status: 'ready', events: log, retry: vi.fn() };
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('audience-graph-root')).toBeTruthy();
    });
    // Head render (Decision §3): the *entire* assembled log is handed to
    // the renderer — no position filtering in this leaf.
    expect(capturedGraphProps).not.toBeNull();
    expect(capturedGraphProps?.events).toHaveLength(log.length);
    expect(capturedGraphProps?.events).toBe(log);
    expect(capturedGraphProps?.instanceKey).toBe(SESSION_ID);
  });

  it('(b) loading: renders the loading affordance', () => {
    mockLog = { status: 'loading', events: [], retry: vi.fn() };
    renderRoute();
    expect(screen.getByTestId('audience-replay-loading')).toBeTruthy();
    expect(screen.queryByTestId('audience-graph-root')).toBeNull();
  });

  it('(c) not-found + unauthenticated: renders the PrivateSessionCta sign-in wall', async () => {
    mockLog = { status: 'not-found', events: [], retry: vi.fn() };
    renderRoute(anonymousAuth);
    const cta = await screen.findByTestId('audience-private-session-cta');
    expect(cta).toBeTruthy();
    const loginLink = cta.querySelector('a');
    expect(loginLink?.getAttribute('href')).toBe('/api/auth/login');
    // No graph for a viewer who cannot load the log.
    expect(screen.queryByTestId('audience-graph-root')).toBeNull();
  });

  it('(d) error + authenticated: renders the unavailable message + a working retry (no CTA)', async () => {
    const retry = vi.fn();
    mockLog = { status: 'error', events: [], retry };
    renderRoute(authenticatedAuth);

    expect(screen.getByTestId('audience-replay-unavailable')).toBeTruthy();
    // The CTA renders null for an authenticated viewer (Decision §5).
    expect(screen.queryByTestId('audience-private-session-cta')).toBeNull();

    const retryButton = screen.getByTestId('audience-replay-retry');
    retryButton.click();
    await waitFor(() => {
      expect(retry).toHaveBeenCalledTimes(1);
    });
  });

  it('(e) error + unauthenticated: still surfaces the sign-in wall (not-visible viewer)', async () => {
    mockLog = { status: 'error', events: [], retry: vi.fn() };
    renderRoute(anonymousAuth);
    // The 401 for an anonymous request maps to `error`; the existence-non-
    // leak posture funnels that viewer to the sign-in CTA, same as the
    // live route.
    expect(await screen.findByTestId('audience-private-session-cta')).toBeTruthy();
  });
});
