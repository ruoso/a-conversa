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
import type { EventKind } from '@a-conversa/shared-types';

import { LobbyRoute } from './LobbyRoute';
import { useWsStore } from '../ws/wsStore';

// ────────────────────────────────────────────────────────────────────────
// Mock `react-router-dom`'s `useNavigate` so the auto-navigation handoff
// cases (`part_session_start_handoff`) can pin the navigate target
// without wrapping the route in a routes-graph that defines the operate
// destination. `useParams` + `MemoryRouter` keep their real
// implementations. Mirrors the pattern at
// `apps/participant/src/routes/InviteAcceptanceRoute.test.tsx:42-55`.
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
  navigateSpy.mockReset();
});

function stubFetch(
  handlers: {
    header?: () => Response;
    participants?: () => Response;
  } = {},
) {
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

// ────────────────────────────────────────────────────────────────────────
// Auto-navigation handoff to the operate route.
//
// Refinement: tasks/refinements/participant-ui/part_session_start_handoff.md
//   The `<LobbyRouteAuthenticatedBody>`'s new `useEffect` watches the
//   per-session events slice and `replace`-navigates the debater to
//   `/sessions/${id}` when the first content event lands. Cases pin
//   the five trigger kinds (Decision §2), the no-fire on lobby-
//   lifecycle / session-lifecycle events, the exactly-once guarantee
//   (Decision §3 ref guard), the catch-up replay path, and the not-
//   authenticated guard branch.
// ────────────────────────────────────────────────────────────────────────

// Sequence counter offset above the lifecycle seeds (1-9) used by the
// existing cases — keeps sequence numbers monotonic across helpers when
// a case seeds both lifecycle + content events.
const CONTENT_EVENT_KINDS_LIST: readonly EventKind[] = [
  'node-created',
  'edge-created',
  'entity-included',
  'proposal',
  'commit',
];

// Build a content event of the given kind with a minimal-but-valid
// payload. Each branch mirrors the canonical payload shape from
// `packages/shared-types/src/events.ts`; the handler only reads
// `event.kind` so the payload contents do not affect the test outcome,
// but the shapes match what the WS reducer would land in production.
function buildContentEvent(
  kind: EventKind,
  sequence: number,
): Parameters<ReturnType<typeof useWsStore.getState>['applyEvent']>[0] {
  const id = `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
  const actor = '00000000-0000-4000-8000-00000000aaaa';
  const nodeId = '11111111-1111-4111-8111-111111111111';
  const edgeId = '22222222-2222-4222-8222-222222222222';
  const targetId = '33333333-3333-4333-8333-333333333333';
  const createdAt = '2026-05-17T00:00:00.000Z';
  const common = { id, sessionId: SESSION_ID, sequence, actor, createdAt };
  if (kind === 'node-created') {
    return {
      ...common,
      kind: 'node-created',
      payload: {
        node_id: nodeId,
        wording: 'seeded wording',
        created_by: actor,
        created_at: createdAt,
      },
    };
  }
  if (kind === 'edge-created') {
    return {
      ...common,
      kind: 'edge-created',
      payload: {
        edge_id: edgeId,
        role: 'supports',
        source_node_id: nodeId,
        target_node_id: targetId,
        created_by: actor,
        created_at: createdAt,
      },
    };
  }
  if (kind === 'entity-included') {
    return {
      ...common,
      kind: 'entity-included',
      payload: {
        entity_kind: 'node',
        entity_id: nodeId,
        included_by: actor,
        included_at: createdAt,
      },
    };
  }
  if (kind === 'proposal') {
    return {
      ...common,
      kind: 'proposal',
      payload: {
        proposal: {
          kind: 'classify-node',
          node_id: nodeId,
          classification: 'fact',
        },
      },
    };
  }
  if (kind === 'commit') {
    return {
      ...common,
      kind: 'commit',
      payload: {
        target: 'proposal',
        proposal_id: id,
        committed_by: actor,
        committed_at: createdAt,
      },
    };
  }
  throw new Error(`buildContentEvent: unsupported kind ${kind}`);
}

function seedContentEvent(kind: EventKind, sequence: number): void {
  act(() => {
    useWsStore.getState().applyEvent(buildContentEvent(kind, sequence));
  });
}

describe('LobbyRoute — auto-navigation handoff to operate route', () => {
  it('(l) does not navigate when only lobby-lifecycle events have arrived', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    seedJoined(3, 'debater-B', OTHER_DEBATER_USER_ID, 'carol');
    seedLeft(4, OTHER_DEBATER_USER_ID);
    // Wait for the loaded render so any pending effects have run.
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  describe.each(CONTENT_EVENT_KINDS_LIST)(
    '(m) navigates on first content event of kind %s',
    (kind) => {
      it(`navigates to /sessions/:id with { replace: true } on first ${kind}`, async () => {
        global.fetch = stubFetch();
        renderRoute();
        seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
        seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
        await waitFor(() => {
          expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
        });
        expect(navigateSpy).not.toHaveBeenCalled();
        seedContentEvent(kind, 100);
        await waitFor(() => {
          expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
        });
        expect(navigateSpy).toHaveBeenCalledTimes(1);
      });
    },
  );

  it('(n) navigation fires exactly once when multiple content events arrive', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    seedContentEvent('node-created', 100);
    seedContentEvent('edge-created', 101);
    seedContentEvent('proposal', 102);
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    // The ref guard short-circuits subsequent effect runs after the
    // first navigate fires — exactly one call across all three events.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(o) navigation fires on a content event interleaved with lobby events', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    seedContentEvent('node-created', 100);
    seedLeft(101, OTHER_DEBATER_USER_ID);
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(p) navigation fires when content events are present in the catch-up replay (seeded before mount)', async () => {
    global.fetch = stubFetch();
    // Simulate a debater whose WS reconnect picks up a replay
    // including events from after the moderator already captured —
    // the content event is already in the events slice on mount, the
    // effect's first tick must catch it.
    act(() => {
      useWsStore.getState().applyEvent(buildContentEvent('node-created', 100));
    });
    renderRoute();
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(q) navigation does NOT fire from the not-authenticated guard branch', async () => {
    global.fetch = stubFetch();
    const notAuthAuth: AuthContextValue = {
      status: 'unauthenticated',
      refresh: () => undefined,
      logout: () => undefined,
    };
    renderRoute({ auth: notAuthAuth });
    // The guard renders the `not-authenticated` body branch, NOT the
    // authenticated body that owns the auto-navigation effect.
    await waitFor(() => {
      const root = screen.getByTestId('route-lobby');
      expect(root.getAttribute('data-state')).toBe('not-authenticated');
    });
    seedContentEvent('node-created', 100);
    // Give any spurious effect a tick to misfire (it shouldn't).
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('(r) navigation does NOT fire on session-ended', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    act(() => {
      useWsStore.getState().applyEvent({
        id: '00000000-0000-4000-8000-000000000100',
        sessionId: SESSION_ID,
        sequence: 100,
        kind: 'session-ended',
        actor: HOST_USER_ID,
        payload: {
          ended_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      });
    });
    // Give the effect a tick to misfire (it shouldn't).
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Negative-trigger pins: each of the 8 non-trigger event kinds is
  // seeded individually; the navigate spy must remain silent. This
  // pins the `CONTENT_EVENT_KINDS` constant against accidental
  // expansion (e.g. a future ambivalent maintainer adding
  // `participant-joined` to the trigger set would break case (l) and
  // each of these probes).
  // ──────────────────────────────────────────────────────────────────
  const NON_TRIGGER_KINDS: readonly {
    kind: EventKind;
    payload: unknown;
  }[] = [
    {
      kind: 'session-created',
      payload: {
        host_user_id: HOST_USER_ID,
        topic: 'topic',
        privacy: 'public',
      },
    },
    {
      kind: 'participant-joined',
      payload: {
        user_id: OTHER_DEBATER_USER_ID,
        role: 'debater-B' as const,
        screen_name: 'carol',
        joined_at: '2026-05-17T00:00:00.000Z',
      },
    },
    {
      kind: 'participant-left',
      payload: {
        user_id: OTHER_DEBATER_USER_ID,
        left_at: '2026-05-17T00:00:00.000Z',
      },
    },
    {
      kind: 'annotation-created',
      payload: {
        annotation_id: '11111111-1111-4111-8111-111111111111',
        target_kind: 'node' as const,
        target_id: '22222222-2222-4222-8222-222222222222',
        kind: 'note' as const,
        body: 'note',
        created_by: HOST_USER_ID,
        created_at: '2026-05-17T00:00:00.000Z',
      },
    },
    {
      kind: 'vote',
      payload: {
        proposal_id: '11111111-1111-4111-8111-111111111111',
        voter: HOST_USER_ID,
        vote: 'agree' as const,
      },
    },
    {
      kind: 'meta-disagreement-marked',
      payload: {
        target: 'proposal',
        proposal_id: '11111111-1111-4111-8111-111111111111',
        marked_by: HOST_USER_ID,
        marked_at: '2026-05-17T00:00:00.000Z',
      },
    },
    {
      kind: 'snapshot-created',
      payload: {
        snapshot_id: '11111111-1111-4111-8111-111111111111',
        sequence: 100,
        created_at: '2026-05-17T00:00:00.000Z',
      },
    },
    {
      kind: 'entity-removed',
      payload: {
        entity_kind: 'node' as const,
        entity_id: '11111111-1111-4111-8111-111111111111',
        removed_by: HOST_USER_ID,
        removed_at: '2026-05-17T00:00:00.000Z',
      },
    },
  ];

  describe.each(NON_TRIGGER_KINDS)(
    '(s) does NOT navigate on non-trigger event kind %s',
    ({ kind, payload }) => {
      it(`stays silent when only ${kind} arrives`, async () => {
        global.fetch = stubFetch();
        renderRoute();
        seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
        seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
        await waitFor(() => {
          expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
        });
        act(() => {
          // The `payload` is shape-correct for its `kind` per the
          // canonical Zod schemas, but the parameterized `NON_TRIGGER_KINDS`
          // table mixes 8 different `EventKind` values whose payloads
          // do not all unify under a single type; the cast lets the
          // parameterized loop share one `applyEvent` call site.
          const envelope = {
            id: '00000000-0000-4000-8000-000000000100',
            sessionId: SESSION_ID,
            sequence: 100,
            kind,
            actor: HOST_USER_ID,
            payload,
            createdAt: '2026-05-17T00:00:00.000Z',
          } as unknown as Parameters<ReturnType<typeof useWsStore.getState>['applyEvent']>[0];
          useWsStore.getState().applyEvent(envelope);
        });
        // Give the effect a tick to misfire (it shouldn't).
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(navigateSpy).not.toHaveBeenCalled();
      });
    },
  );
});

// ────────────────────────────────────────────────────────────────────────
// Auto-navigation handoff — primary trigger via `session-mode-changed`.
//
// Per ADR 0028 / part_session_start_handoff_dedicated_event:
//   - Primary trigger: `kind === 'session-mode-changed'` AND
//     `payload.new_mode === 'operate'` → navigate.
//   - Primary takes precedence: a `session-mode-changed` event AND a
//     subsequent content event together must fire navigate EXACTLY ONCE
//     (the useRef<boolean> guard + the short-circuited fallback both
//     enforce this).
//   - Negative: `session-mode-changed` with `new_mode: 'lobby'` does NOT
//     trigger (only `new_mode: 'operate'` is the canonical signal).
//   - Negative: a malformed payload (missing `new_mode`) does NOT trigger.
// ────────────────────────────────────────────────────────────────────────

function seedSessionModeChanged(
  sequence: number,
  newMode: 'lobby' | 'operate',
  changedBy: string = HOST_USER_ID,
): void {
  act(() => {
    useWsStore.getState().applyEvent({
      id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence,
      kind: 'session-mode-changed',
      actor: changedBy,
      payload: {
        previous_mode: 'lobby',
        new_mode: newMode,
        changed_by: changedBy,
        changed_at: '2026-05-17T00:00:00.000Z',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
    });
  });
}

describe('LobbyRoute — primary trigger via session-mode-changed (ADR 0028)', () => {
  it('(t) navigates to /sessions/:id with { replace: true } on session-mode-changed with new_mode: operate', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    seedSessionModeChanged(100, 'operate');
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(u) does NOT navigate on session-mode-changed with new_mode: lobby', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    seedSessionModeChanged(100, 'lobby');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('(v) primary short-circuits the fallback: a content event arriving AFTER session-mode-changed does NOT cause a second navigate', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    // Primary fires first.
    seedSessionModeChanged(100, 'operate');
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    // A content event later in the same lobby lifetime — the
    // useRef<boolean> guard prevents a second navigate.
    seedContentEvent('node-created', 101);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(w) primary takes precedence over fallback when both predicates would match: navigate fires exactly once via the primary path', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    // Seed BOTH a session-mode-changed AND a content event in the same
    // batch. The effect runs once after the batch lands; both
    // predicates would match independently, but the useRef guard
    // ensures exactly one navigate fires.
    seedSessionModeChanged(100, 'operate');
    seedContentEvent('node-created', 101);
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(x) primary trigger fires when the session-mode-changed event is present in the catch-up replay (seeded before mount)', async () => {
    global.fetch = stubFetch();
    act(() => {
      useWsStore.getState().applyEvent({
        id: '00000000-0000-4000-8000-000000000100',
        sessionId: SESSION_ID,
        sequence: 100,
        kind: 'session-mode-changed',
        actor: HOST_USER_ID,
        payload: {
          previous_mode: 'lobby',
          new_mode: 'operate',
          changed_by: HOST_USER_ID,
          changed_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      });
    });
    renderRoute();
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}`, { replace: true });
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('(y) malformed session-mode-changed payload (missing new_mode) does NOT trigger navigation', async () => {
    global.fetch = stubFetch();
    renderRoute();
    seedJoined(1, 'moderator', HOST_USER_ID, 'alice');
    seedJoined(2, 'debater-A', CALLER_USER_ID, 'ben');
    await waitFor(() => {
      expect(screen.getByTestId('lobby-participant-debater-A')).toBeTruthy();
    });
    act(() => {
      // A payload missing `new_mode` would never get past `validateEvent`
      // in production, but we model "the malformed envelope somehow
      // arrived in the slice" defensively here — the predicate's
      // `event.payload.new_mode === 'operate'` check stays safe under
      // an undefined payload field.
      const envelope = {
        id: '00000000-0000-4000-8000-000000000100',
        sessionId: SESSION_ID,
        sequence: 100,
        kind: 'session-mode-changed',
        actor: HOST_USER_ID,
        payload: {
          previous_mode: 'lobby',
          // new_mode intentionally omitted
          changed_by: HOST_USER_ID,
          changed_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      } as unknown as Parameters<ReturnType<typeof useWsStore.getState>['applyEvent']>[0];
      useWsStore.getState().applyEvent(envelope);
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
