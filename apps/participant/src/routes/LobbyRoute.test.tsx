// Vitest cases for `<LobbyRoute>`.
//
// Refinement: tasks/refinements/participant-ui/part_lobby_view.md
//              (Test layers per ADR 0022 — ten cases per the
//              refinement's "Tests pin" sketch).
// ADRs:        docs/adr/0022-no-throwaway-verifications.md.
//
// Patterns lifted from:
//   - `apps/participant/src/routes/InviteAcceptanceRoute.test.tsx` for
//     the `vi.mock('react-router-dom', ...)` shape and the `WsClientProvider`
//     fake-client wiring (the route's `useWsClient()` lifecycle is
//     consumed via the surface-wide provider; the test mounts a fake
//     client so `trackSession` / `untrackSession` are spy-pinned).
//   - `apps/moderator/src/routes/InviteParticipants.test.tsx` for the
//     `useWsStore.getState().applyEvent(...)` seed helpers — the slot
//     reducer reads from the per-session events slice through the
//     same shell `applyEvent` reducer, so direct seeding faithfully
//     reproduces what a WS dispatch would do.
//   - `apps/participant/src/layout/useParticipantConnectionStatus.test.ts`
//     for the `useWsStore.getState().reset()` per-test isolation
//     posture.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

import { LobbyRoute } from './LobbyRoute';
import { useWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const HOST_USER_ID = '00000000-0000-4000-8000-000000000001';
const CALLER_USER_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_DEBATER_USER_ID = '00000000-0000-4000-8000-000000000003';

const authenticatedCallerAuth: AuthContextValue = {
  status: 'authenticated',
  user: { userId: CALLER_USER_ID, screenName: 'ben' },
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
beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
});

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

function stubFetch(
  handlers: {
    header?: () => Response;
    participants?: () => Response;
  } = {},
): ReturnType<typeof vi.fn> {
  const headerHandler = handlers.header ?? defaultHeaderOk;
  const participantsHandler = handlers.participants ?? defaultParticipantsOk;
  return vi.fn((input: URL | RequestInfo): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.endsWith('/participants')) {
      return Promise.resolve(participantsHandler());
    }
    if (href === `/api/sessions/${SESSION_ID}`) {
      return Promise.resolve(headerHandler());
    }
    return Promise.resolve(new Response('not stubbed', { status: 500 }));
  });
}

function defaultHeaderOk(): Response {
  return new Response(
    JSON.stringify({
      id: SESSION_ID,
      hostUserId: HOST_USER_ID,
      privacy: 'public',
      topic: 'Should UBI replace welfare?',
      createdAt: '2026-05-16T00:00:00.000Z',
      endedAt: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function defaultParticipantsOk(): Response {
  // Initial slot map: the implicit-moderator row + the caller (ben)
  // already filling debater-A. Debater-B is empty (the "waiting for
  // Debater B" hint should render in case (b)).
  return new Response(
    JSON.stringify({
      participants: [
        {
          id: 'p-mod',
          sessionId: SESSION_ID,
          userId: HOST_USER_ID,
          role: 'moderator',
          joinedAt: '2026-05-16T00:00:00.000Z',
          leftAt: null,
        },
        {
          id: 'p-debater-a',
          sessionId: SESSION_ID,
          userId: CALLER_USER_ID,
          role: 'debater-A',
          joinedAt: '2026-05-16T00:00:01.000Z',
          leftAt: null,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function renderRoute(opts: { auth?: AuthContextValue } = {}): FakeClient {
  const auth = opts.auth ?? authenticatedCallerAuth;
  const fake = createFakeClient();
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={auth}>
        <WsClientProvider auth={{ status: auth.status }} client={fake.client}>
          <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/lobby`]}>
            <Routes>
              <Route path="/sessions/:id/lobby" element={<LobbyRoute />} />
            </Routes>
          </MemoryRouter>
        </WsClientProvider>
      </AuthValueProvider>
    </I18nProvider>,
  );
  return fake;
}

// ────────────────────────────────────────────────────────────────────────
// WS event seed helpers. Both helpers go through the shell store's
// `applyEvent` reducer so the events land in the same slice the route
// reads via `useWsStore((s) => s.sessionState[id]?.events)`.
// ────────────────────────────────────────────────────────────────────────
function seedJoined(
  sequence: number,
  role: 'moderator' | 'debater-A' | 'debater-B',
  userId: string,
  screenName: string,
): void {
  act(() => {
    useWsStore.getState().applyEvent({
      id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence,
      kind: 'participant-joined',
      actor: userId,
      payload: {
        user_id: userId,
        role,
        screen_name: screenName,
        joined_at: '2026-05-16T00:00:00.000Z',
      },
      createdAt: '2026-05-16T00:00:00.000Z',
    });
  });
}

function seedLeft(sequence: number, userId: string): void {
  act(() => {
    useWsStore.getState().applyEvent({
      id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence,
      kind: 'participant-left',
      actor: userId,
      payload: {
        user_id: userId,
        left_at: '2026-05-16T00:01:00.000Z',
      },
      createdAt: '2026-05-16T00:01:00.000Z',
    });
  });
}

describe('LobbyRoute — loading + loaded happy path', () => {
  it('(a) renders the loading state while both fetches are in flight', () => {
    // Never-resolving fetches keep the route in the loading state.
    global.fetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );
    renderRoute();
    const root = screen.getByTestId('route-lobby');
    expect(root.getAttribute('data-state')).toBe('loading');
    expect(screen.getByTestId('lobby-loading')).toBeTruthy();
  });

  it('(b) renders the loaded state with topic + moderator + caller debater-A row + waiting-for-debater-B hint', async () => {
    global.fetch = stubFetch();
    renderRoute();
    // Seed WS events so the moderator and caller rows have display
    // names (the participants-list endpoint does not denormalize
    // screen_name; the WS overlay is the canonical name source).
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');

    await waitFor(() => {
      const root = screen.getByTestId('route-lobby');
      expect(root.getAttribute('data-state')).toBe('loaded');
    });
    const topic = screen.getByTestId('lobby-topic');
    expect(topic.textContent).toContain('Should UBI replace welfare?');

    const moderatorRow = screen.getByTestId('lobby-participant-moderator');
    expect(moderatorRow.getAttribute('data-user-id')).toBe(HOST_USER_ID);
    expect(screen.getByTestId('lobby-participant-moderator-name').textContent).toBe('alice');
    expect(screen.getByTestId('lobby-participant-moderator-badge').textContent).toBe('Moderator');

    const debaterARow = screen.getByTestId('lobby-participant-debater-A');
    expect(debaterARow.getAttribute('data-user-id')).toBe(CALLER_USER_ID);
    expect(screen.getByTestId('lobby-participant-debater-A-name').textContent).toBe('ben');

    // Debater B is missing — waiting hint visible with the role label.
    const hint = screen.getByTestId('lobby-waiting-for-debater');
    expect(hint.textContent).toContain('Debater B');

    // The both-debaters-present line is absent.
    expect(screen.queryByTestId('lobby-both-debaters-present')).toBeNull();
    // The empty-state line is also visible (the caller is the only
    // debater present and the other slot is empty).
    expect(screen.getByTestId('lobby-empty-state')).toBeTruthy();
  });
});

describe('LobbyRoute — live update via WS event injection', () => {
  it('(c) renders the second debater row when a participant-joined event arrives', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');

    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    // Initially debater-B is missing → waiting hint visible.
    expect(screen.getByTestId('lobby-waiting-for-debater')).toBeTruthy();
    expect(screen.queryByTestId('lobby-participant-debater-B')).toBeNull();

    // The other debater claims their slot → WS event arrives.
    seedJoined(3, 'debater-B', OTHER_DEBATER_USER_ID, 'carol');

    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-B')).toBeTruthy();
    });
    expect(screen.getByTestId('lobby-participant-debater-B-name').textContent).toBe('carol');
    // Waiting hint is gone; both-present line replaces it.
    expect(screen.queryByTestId('lobby-waiting-for-debater')).toBeNull();
    expect(screen.getByTestId('lobby-both-debaters-present')).toBeTruthy();
    // Empty-state line is gone (the other debater is present).
    expect(screen.queryByTestId('lobby-empty-state')).toBeNull();
  });

  it('(d) clears the corresponding slot when a participant-left event arrives', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    seedJoined(3, 'debater-B', OTHER_DEBATER_USER_ID, 'carol');

    await waitFor(() => {
      expect(screen.getByTestId('lobby-both-debaters-present')).toBeTruthy();
    });
    // The other debater leaves.
    seedLeft(4, OTHER_DEBATER_USER_ID);

    await waitFor(() => {
      expect(screen.queryByTestId('lobby-participant-debater-B')).toBeNull();
    });
    expect(screen.queryByTestId('lobby-both-debaters-present')).toBeNull();
    const hint = screen.getByTestId('lobby-waiting-for-debater');
    expect(hint.textContent).toContain('Debater B');
  });
});

describe('LobbyRoute — empty state', () => {
  it('(e) renders the empty-state line when the caller is the only debater present', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-empty-state')).toBeTruthy();
    });
    expect(screen.getByTestId('lobby-empty-state').textContent).toContain(
      "You're the first to arrive.",
    );
  });
});

describe('LobbyRoute — HTTP fetch error paths', () => {
  it('(f) renders the header-error panel + retry button; retry refetches and recovers', async () => {
    let headerCalls = 0;
    global.fetch = vi.fn((input: URL | RequestInfo): Promise<Response> => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('/participants')) {
        return Promise.resolve(defaultParticipantsOk());
      }
      if (href === `/api/sessions/${SESSION_ID}`) {
        headerCalls += 1;
        if (headerCalls === 1) {
          return Promise.resolve(new Response('', { status: 500 }));
        }
        return Promise.resolve(defaultHeaderOk());
      }
      return Promise.resolve(new Response('not stubbed', { status: 500 }));
    });

    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('lobby-error-header')).toBeTruthy();
    });
    const root = screen.getByTestId('route-lobby');
    expect(root.getAttribute('data-state')).toBe('error');
    const retry = screen.getByTestId('lobby-retry-header');
    expect(retry).toBeTruthy();

    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');

    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('lobby-topic')).toBeTruthy();
    });
    expect(headerCalls).toBeGreaterThanOrEqual(2);
  });

  it('(g) renders the participants-error panel + retry button; retry refetches and recovers', async () => {
    let participantsCalls = 0;
    global.fetch = vi.fn((input: URL | RequestInfo): Promise<Response> => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('/participants')) {
        participantsCalls += 1;
        if (participantsCalls === 1) {
          return Promise.resolve(new Response('', { status: 500 }));
        }
        return Promise.resolve(defaultParticipantsOk());
      }
      if (href === `/api/sessions/${SESSION_ID}`) {
        return Promise.resolve(defaultHeaderOk());
      }
      return Promise.resolve(new Response('not stubbed', { status: 500 }));
    });

    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('lobby-error-participants')).toBeTruthy();
    });
    const retry = screen.getByTestId('lobby-retry-participants');

    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');

    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participants-list')).toBeTruthy();
    });
    expect(participantsCalls).toBeGreaterThanOrEqual(2);
  });
});

describe('LobbyRoute — trackSession lifecycle', () => {
  it('(h) calls trackSession(id) once on mount and untrackSession(id) once on cleanup', async () => {
    global.fetch = stubFetch();
    const fake = renderRoute();
    await waitFor(() => {
      expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
    });
    expect(fake.trackSessionSpy).toHaveBeenCalledTimes(1);
    cleanup();
    expect(fake.untrackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
    expect(fake.untrackSessionSpy).toHaveBeenCalledTimes(1);
  });
});

describe('LobbyRoute — slot reducer resilience', () => {
  it('(i) a stale participant-left for a no-longer-occupant user does not erase the current slot', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    // user-1 joins debater-B, user-1 leaves, user-1 rejoins debater-B
    // (a stale leave for a user not currently in any slot must NOT
    // erase the current occupant — mirrors the moderator's reducer
    // contract at `InviteParticipants.tsx:108-137`).
    const userOne = '00000000-0000-4000-8000-0000000000a1';
    const userTwo = '00000000-0000-4000-8000-0000000000a2';
    seedJoined(2, 'debater-B', userOne, 'user-1');
    seedLeft(3, userTwo); // stale leave for a user not currently in any slot
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-B')).toBeTruthy();
    });
    const debaterB = screen.getByTestId('lobby-participant-debater-B');
    expect(debaterB.getAttribute('data-user-id')).toBe(userOne);
    expect(screen.getByTestId('lobby-participant-debater-B-name').textContent).toBe('user-1');
  });
});

describe('LobbyRoute — moderator badge rendering', () => {
  it('(j) renders the moderator row with the Moderator badge alongside the two debater rows', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    seedJoined(3, 'debater-B', OTHER_DEBATER_USER_ID, 'carol');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-moderator')).toBeTruthy();
    });
    expect(screen.getByTestId('lobby-participant-moderator-badge').textContent).toBe('Moderator');
    expect(screen.getByTestId('lobby-participant-debater-A-badge').textContent).toBe('Debater A');
    expect(screen.getByTestId('lobby-participant-debater-B-badge').textContent).toBe('Debater B');
  });
});

describe('LobbyRoute — HTTP-prefetched debater leaves via WS', () => {
  it('(k) participant-left event removes a debater slot that was filled by the HTTP prefetch', async () => {
    // HTTP prefetch returns BOTH debaters as active. WS arrives with
    // participant-left(OTHER_DEBATER_USER_ID). The merge MUST respect
    // WS-derived absences (the moderator's Decision §6 `latest`-map
    // filter, ported here) so the HTTP row doesn't outlive the WS
    // leave. Assert the debater-B slot returns to empty within one
    // render of the leave event.
    //
    // Mirrors `apps/moderator/src/routes/InviteParticipants.test.tsx`
    // case 9 verbatim, adjusted for the participant's `stubFetch` +
    // `seedLeft` helpers and the participant's `lobby-participant-*`
    // testids.
    global.fetch = stubFetch({
      participants: () =>
        new Response(
          JSON.stringify({
            participants: [
              {
                id: 'p-mod',
                sessionId: SESSION_ID,
                userId: HOST_USER_ID,
                role: 'moderator',
                joinedAt: '2026-05-16T00:00:00.000Z',
                leftAt: null,
              },
              {
                id: 'p-debater-a',
                sessionId: SESSION_ID,
                userId: CALLER_USER_ID,
                role: 'debater-A',
                joinedAt: '2026-05-16T00:00:01.000Z',
                leftAt: null,
              },
              {
                id: 'p-debater-b',
                sessionId: SESSION_ID,
                userId: OTHER_DEBATER_USER_ID,
                role: 'debater-B',
                joinedAt: '2026-05-16T00:00:02.000Z',
                leftAt: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    renderRoute();
    // Wait for the prefetch to land both debater rows.
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-B')).toBeTruthy();
    });
    // The other debater leaves via WS.
    seedLeft(1, OTHER_DEBATER_USER_ID);
    // The slot returns to empty within one render of the leave event.
    await waitFor(() => {
      expect(screen.queryByTestId('lobby-participant-debater-B')).toBeNull();
    });
    // The waiting hint reappears with "Debater B" in its text.
    const hint = screen.getByTestId('lobby-waiting-for-debater');
    expect(hint.textContent).toContain('Debater B');
    // The both-debaters-present banner is gone.
    expect(screen.queryByTestId('lobby-both-debaters-present')).toBeNull();
    // debater-A is still present (only B left).
    expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
  });
});
