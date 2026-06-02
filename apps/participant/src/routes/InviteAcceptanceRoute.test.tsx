// Vitest cases for `<InviteAcceptanceRoute>`.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
//              (Test layers — eight cases covering the hint-line shape,
//              the role gate, the happy-path navigation + trackSession
//              lifecycle, and the four discriminating error branches the
//              component itself maps; the 403 `not-a-moderator` + the
//              5xx fallback live in `inviteAcceptanceError.test.ts`).
// ADR:         0022 (no throwaway verifications — every test asserts a
//              user-visible behavior).
//
// `useNavigate` mocking. Mirrors the moderator's `CreateSession.test.tsx`
// shape: `vi.mock('react-router-dom', ...)` swaps `useNavigate()` so
// the test spy captures the post-claim redirect target without
// wrapping the route in a routes-graph that defines the lobby.
//
// `useWsClient()` mocking. The shell's `useWsClient()` is provided via
// `<WsClientProvider>` and would otherwise need a fake client wired
// at every render. The test passes a `client` prop directly to the
// provider — same shape as `apps/moderator/src/routes/InviteParticipants.test.tsx`
// — so `trackSession` / `untrackSession` calls land on a spy without
// the test owning a `vi.mock` of the shell.

import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { InviteAcceptanceRoute } from './InviteAcceptanceRoute';

// ────────────────────────────────────────────────────────────────────────
// Mock `react-router-dom`'s `useNavigate` so the test captures the
// post-claim redirect target. `useParams` and `useSearchParams` keep
// their real implementations (driven by the `MemoryRouter`'s
// `initialEntries`).
// ────────────────────────────────────────────────────────────────────────
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const SCREEN_NAME = 'ben';
const USER_ID = '00000000-0000-4000-8000-000000000002';

const authenticatedAuth: AuthContextValue = {
  status: 'authenticated',
  user: { userId: USER_ID, screenName: SCREEN_NAME },
  refresh: () => undefined,
  logout: () => undefined,
};

interface FakeClient {
  client: WsClient;
  trackSessionSpy: ReturnType<typeof vi.fn>;
  untrackSessionSpy: ReturnType<typeof vi.fn>;
}

/**
 * A fake WS client sufficient for the provider's `useWsClient()`
 * contract. The route only calls `trackSession` and `untrackSession`;
 * the spies pin the per-session subscription lifecycle (Decision §4 of
 * the refinement).
 */
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

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
  navigateSpy.mockReset();
});

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

function stubFetch(builder: () => Response) {
  return vi.fn((_input?: URL | RequestInfo, _init?: RequestInit) => Promise.resolve(builder()));
}

function renderRoute(opts: { role?: string; auth?: AuthContextValue }): FakeClient {
  const role = opts.role;
  const auth = opts.auth ?? authenticatedAuth;
  const fake = createFakeClient();
  const inviteUrl =
    role === undefined
      ? `/sessions/${SESSION_ID}/invite`
      : `/sessions/${SESSION_ID}/invite?role=${role}`;
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={auth}>
        <WsClientProvider auth={{ status: auth.status }} client={fake.client}>
          <MemoryRouter initialEntries={[inviteUrl]}>
            {/* The Routes graph resolves useParams's `:id` for the
             * inner route; mirrors the moderator's
             * `InviteParticipants.test.tsx` shape. */}
            <Routes>
              <Route path="/sessions/:id/invite" element={<InviteAcceptanceRoute />} />
            </Routes>
          </MemoryRouter>
        </WsClientProvider>
      </AuthValueProvider>
    </I18nProvider>,
  );
  return fake;
}

describe('InviteAcceptanceRoute — pre-claim render', () => {
  beforeEach(() => {
    global.fetch = stubFetch(() => new Response('', { status: 200 }));
  });

  it('(a) renders the hint with the Debater A label and the authenticated screen name for ?role=debater-A', () => {
    renderRoute({ role: 'debater-A' });
    const hint = screen.getByTestId('invite-acceptance-hint');
    expect(hint.textContent).toContain('Debater A');
    expect(hint.textContent).toContain(SCREEN_NAME);
    // The join button is enabled on first paint (status: idle).
    const button = screen.getByTestId<HTMLButtonElement>('invite-acceptance-join-button');
    expect(button.disabled).toBe(false);
  });

  it('(b) renders the hint with the Debater B label for ?role=debater-B', () => {
    renderRoute({ role: 'debater-B' });
    const hint = screen.getByTestId('invite-acceptance-hint');
    expect(hint.textContent).toContain('Debater B');
    expect(hint.textContent).toContain(SCREEN_NAME);
  });

  it('(c) renders the invalid-url panel (no button, no hint) when ?role= is missing or malformed', () => {
    // Missing role → invalid-url branch.
    const { unmount } = render(<MissingRoleHarness />);
    expect(screen.getByTestId('invite-acceptance-error-invalid-url')).toBeTruthy();
    expect(screen.queryByTestId('invite-acceptance-join-button')).toBeNull();
    expect(screen.queryByTestId('invite-acceptance-hint')).toBeNull();
    unmount();

    // Malformed role → invalid-url branch (the only accepted values
    // are `debater-A` and `debater-B`).
    renderRoute({ role: 'observer' });
    expect(screen.getByTestId('invite-acceptance-error-invalid-url')).toBeTruthy();
    expect(screen.queryByTestId('invite-acceptance-join-button')).toBeNull();
  });
});

// Small harness for the "no role at all" case that doesn't share the
// renderRoute helper's `?role=...` appending logic.
function MissingRoleHarness(): ReactElement {
  const fake = createFakeClient();
  const inviteUrl = `/sessions/${SESSION_ID}/invite`;
  return (
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={authenticatedAuth}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={fake.client}>
          <MemoryRouter initialEntries={[inviteUrl]}>
            <Routes>
              <Route path="/sessions/:id/invite" element={<InviteAcceptanceRoute />} />
            </Routes>
          </MemoryRouter>
        </WsClientProvider>
      </AuthValueProvider>
    </I18nProvider>
  );
}

describe('InviteAcceptanceRoute — claim POST happy path + trackSession lifecycle', () => {
  it('(d) POSTs to /api/sessions/:id/invite/claim, navigates to /sessions/:id/lobby, and tracks/untracks the session id', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            id: 'participant-uuid',
            sessionId: SESSION_ID,
            userId: USER_ID,
            role: 'debater-A',
            joinedAt: '2026-05-16T00:00:00.000Z',
            leftAt: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    global.fetch = fetchMock;

    const { trackSessionSpy, untrackSessionSpy } = renderRoute({ role: 'debater-A' });

    // trackSession fires once on mount with the session id from useParams.
    await waitFor(() => {
      expect(trackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
    });
    expect(trackSessionSpy).toHaveBeenCalledTimes(1);

    // Click the join button.
    const button = screen.getByTestId('invite-acceptance-join-button');
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sessions/${SESSION_ID}/invite/claim`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ role: 'debater-A' });

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}/lobby`, { replace: true });
    });

    // Cleanup pairs untrackSession with the same session id.
    cleanup();
    expect(untrackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
    expect(untrackSessionSpy).toHaveBeenCalledTimes(1);
  });
});

describe('InviteAcceptanceRoute — typed error mapping', () => {
  /** Drive a click against a stubbed error response and wait for the panel. */
  async function clickAndAwait(): Promise<void> {
    const button = screen.getByTestId('invite-acceptance-join-button');
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
  }

  function errorResponse(status: number, code: string): Response {
    return new Response(JSON.stringify({ error: { code, message: `${code} message` } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('(e) 404 not-found → terminal panel (no button, no go-to-lobby)', async () => {
    global.fetch = stubFetch(() => errorResponse(404, 'not-found'));
    renderRoute({ role: 'debater-A' });
    await clickAndAwait();
    await waitFor(() => {
      expect(screen.getByTestId('invite-acceptance-error-not-found')).toBeTruthy();
    });
    expect(screen.queryByTestId('invite-acceptance-join-button')).toBeNull();
    expect(screen.queryByTestId('invite-acceptance-go-to-lobby')).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('(f) 409 session-already-ended → terminal panel', async () => {
    global.fetch = stubFetch(() => errorResponse(409, 'session-already-ended'));
    renderRoute({ role: 'debater-A' });
    await clickAndAwait();
    await waitFor(() => {
      expect(screen.getByTestId('invite-acceptance-error-session-already-ended')).toBeTruthy();
    });
    expect(screen.queryByTestId('invite-acceptance-join-button')).toBeNull();
  });

  it('(g) 409 user-already-joined → terminal panel + go-to-lobby button (the forward affordance)', async () => {
    global.fetch = stubFetch(() => errorResponse(409, 'user-already-joined'));
    renderRoute({ role: 'debater-A' });
    await clickAndAwait();
    await waitFor(() => {
      expect(screen.getByTestId('invite-acceptance-error-user-already-joined')).toBeTruthy();
    });
    // Join button hidden (terminal); go-to-lobby button visible.
    expect(screen.queryByTestId('invite-acceptance-join-button')).toBeNull();
    const goToLobbyButton = screen.getByTestId('invite-acceptance-go-to-lobby');
    expect(goToLobbyButton).toBeTruthy();
    // Clicking it navigates to the lobby URL.
    fireEvent.click(goToLobbyButton);
    expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}/lobby`, { replace: true });
  });

  it('(h) 409 role-already-filled → retryable panel (button stays visible)', async () => {
    global.fetch = stubFetch(() => errorResponse(409, 'role-already-filled'));
    renderRoute({ role: 'debater-A' });
    await clickAndAwait();
    await waitFor(() => {
      expect(screen.getByTestId('invite-acceptance-error-role-already-filled')).toBeTruthy();
    });
    // Button still visible — the retryable mapping keeps it around.
    expect(screen.getByTestId('invite-acceptance-join-button')).toBeTruthy();
  });
});
