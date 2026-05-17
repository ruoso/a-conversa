// Tests for the `/sessions/:id/invite` invite-participants route.
//
// Refinement: tasks/refinements/moderator-ui/mod_invite_participants.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: moderator_ui.mod_session_setup.mod_invite_participants
//
// Per ADR 0022 these are committed regression probes for every
// observable behavior the refinement specifies. The case set mirrors
// the bullet list under "Test layers per ADR 0022 → Vitest (in
// InviteParticipants.test.tsx)" in the refinement (18 cases minimum).
//
// `useNavigate` is mocked the same way `CreateSession.test.tsx` does it
// — `vi.mock('react-router-dom', ...)` so the test captures the
// post-click navigation target without spinning up a real router-with-
// routes graph. The `MemoryRouter` is still used to satisfy the hook's
// "must be inside a router" invariant, and `useParams` is preserved via
// the `...actual` spread.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';

import { InviteParticipantsRoute } from './InviteParticipants';
import { AuthProvider, createI18nInstance } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import type { WsClient } from '@a-conversa/shell';

// ────────────────────────────────────────────────────────────────────────
// Mock `useNavigate` so the test can capture navigation calls. Other
// router exports pass through (the route reads `useParams`).
// ────────────────────────────────────────────────────────────────────────
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

beforeAll(async () => {
  await createI18nInstance('en-US');
});

// ────────────────────────────────────────────────────────────────────────
// `WebSocket` polyfill — happy-dom does NOT expose `WebSocket` as a
// constructor. The `<InviteParticipantsRoute>` mounts its own inner
// `<WsClientProvider>` driven by `useAuth()`; when `/api/auth/me`
// resolves to authenticated, the inner provider's auto-constructed
// client calls `new WebSocket(url)`. The outer test wrap supplies a
// fake client but the inner provider sees the route's own
// `<WsClientProvider>` mount and constructs a default one. The file-
// wide polyfill makes the inert default safe.
// ────────────────────────────────────────────────────────────────────────
class FakeWebSocketCtor {
  readyState = 0;
  constructor(_url: string) {
    /* no-op */
  }
  close(): void {
    /* no-op */
  }
  send(): void {
    /* no-op */
  }
  addEventListener(): void {
    /* no-op */
  }
  removeEventListener(): void {
    /* no-op */
  }
}
const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocketCtor;
});
afterAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
});

// Reset the WS store between tests so seeded events don't leak across
// cases. Also reset the navigate spy and the in-memory `fetch`.
afterEach(() => {
  cleanup();
  navigateSpy.mockReset();
  useWsStore.getState().reset();
});

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

const SESSION_ID = '00000000-0000-4000-8000-000000000abc';
const HOST_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEBATER_A_ID = '00000000-0000-4000-8000-0000000000a1';
const DEBATER_B_ID = '00000000-0000-4000-8000-0000000000b1';

/**
 * A fake WS client just sufficient to satisfy the provider's
 * `useWsClient()` contract. The route only calls `trackSession` and
 * `untrackSession`; the methods are stubs so the test doesn't try to
 * open a real socket. The store is the source of truth for slot fill;
 * tests seed it directly via `useWsStore.getState().applyEvent(...)`.
 */
function createFakeClient(): WsClient {
  const noop = (): Promise<void> => Promise.resolve();
  return {
    connect: () => undefined,
    close: () => undefined,
    send: (() => Promise.resolve({}) as unknown) as WsClient['send'],
    trackSession: noop,
    untrackSession: noop,
  } as unknown as WsClient;
}

/**
 * Render the route under the providers it requires at runtime — a
 * memory router pinned to the session id (so `useParams` resolves the
 * sessionId), the auth-injecting WS provider with a fake client. The
 * route's outer wrapper still mounts its own `<WsClientProvider>`, but
 * its inner effect no-ops when auth.status !== 'authenticated' (per the
 * provider's contract), so the outer wrapper's wiring is harmless even
 * when we wrap the route in a fresh provider here for explicitness.
 */
function renderRoute(): { client: WsClient } {
  const client = createFakeClient();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/invite`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/invite" element={<InviteParticipantsRoute />} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>
    </AuthProvider>,
  );
  return { client };
}

/**
 * Build a `fetch` stub that routes `/api/auth/me` to an authenticated
 * response, `/api/sessions/:id/participants` to the participants
 * builder (default: empty list), and `/api/sessions/:id` to the
 * session builder. After the shell-substrate extraction the route
 * mounts inside `<AuthProvider>` (or in the InviteParticipants test,
 * we render it inside an `<AuthProvider>` so `useAuth()` resolves);
 * the provider fires `/api/auth/me` on mount and the bare session
 * stub would 404 that.
 *
 * The participants-list branch was added for
 * `mod_invite_participants_rest_prefetch`: the route now issues a
 * second GET to `/api/sessions/:id/participants` on mount alongside
 * the existing session-header GET, and the slot map is fed by
 * `mergeSlots(httpRows, wsOccupants, events)`. The default empty
 * list keeps the pre-existing WS-only seed cases valid (the merge's
 * WS overlay continues to be the sole source of slot fill).
 */
function stubSessionFetch(
  builder: () => Response,
  participantsBuilder: () => Response = () => okParticipantsResponse([]),
): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === '/api/auth/me') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: HOST_USER_ID,
            screenName: 'alice',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    if (url === `/api/sessions/${SESSION_ID}/participants`) {
      return Promise.resolve(participantsBuilder());
    }
    return Promise.resolve(builder());
  });
}

function okSessionResponse(): Response {
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

/**
 * Build a `200 OK` `/api/sessions/:id/participants` response from a
 * list of row partials. Each partial provides at minimum `userId` +
 * `role`; `leftAt` defaults to `null` (active row) and `screenName`
 * is omitted by default (mirrors the current endpoint contract — the
 * endpoint does not denormalize screen names yet, so the WS overlay
 * is the canonical display-name source).
 */
function okParticipantsResponse(
  rows: ReadonlyArray<{
    userId: string;
    role: 'moderator' | 'debater-A' | 'debater-B';
    leftAt?: string | null;
    screenName?: string;
  }>,
): Response {
  return new Response(
    JSON.stringify({
      participants: rows.map((row, index) => {
        const body: Record<string, unknown> = {
          id: `00000000-0000-4000-8000-${(index + 1000).toString().padStart(12, '0')}`,
          sessionId: SESSION_ID,
          userId: row.userId,
          role: row.role,
          joinedAt: '2026-05-16T00:00:00.000Z',
          leftAt: row.leftAt === undefined ? null : row.leftAt,
        };
        if (row.screenName !== undefined) body.screenName = row.screenName;
        return body;
      }),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * Seed a participant-joined event into the WS store for a given role.
 * Mirrors the pattern in `PendingProposalsPane.test.tsx`.
 */
function seedParticipantJoined(
  sequence: number,
  role: 'moderator' | 'debater-A' | 'debater-B',
  userId: string,
  screenName: string,
): void {
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
}

function seedParticipantLeft(sequence: number, userId: string): void {
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
}

describe('InviteParticipants route — fetch lifecycle', () => {
  it('renders the loading state while GET /api/sessions/:id is in flight', () => {
    // A never-resolving fetch keeps the route in the loading state.
    global.fetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );
    renderRoute();
    expect(screen.getByTestId('invite-loading')).toBeTruthy();
    // No slot sections rendered while loading.
    expect(screen.queryAllByTestId('invite-slot').length).toBe(0);
  });

  it('renders the loaded state — topic, privacy, and three slot sections', async () => {
    global.fetch = stubSessionFetch(okSessionResponse);
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic').textContent).toBe(
        'Should UBI replace welfare?',
      );
    });
    expect(screen.getByTestId('invite-session-privacy').textContent).toBe('Public');
    // Three slot sections in fixed order.
    const slots = screen.getAllByTestId('invite-slot');
    expect(slots.length).toBe(3);
    expect(slots[0]?.getAttribute('data-role')).toBe('moderator');
    expect(slots[1]?.getAttribute('data-role')).toBe('debater-A');
    expect(slots[2]?.getAttribute('data-role')).toBe('debater-B');
  });

  it('renders the error state when the fetch rejects', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('NetworkError')));
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeTruthy();
    });
    const region = screen.getByTestId('invite-error');
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('invite-retry')).toBeTruthy();
  });

  it('retry button re-triggers the fetch', async () => {
    let sessionCalls = 0;
    global.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ userId: HOST_USER_ID, screenName: 'alice' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url === `/api/sessions/${SESSION_ID}/participants`) {
        return Promise.resolve(okParticipantsResponse([]));
      }
      sessionCalls += 1;
      if (sessionCalls === 1) return Promise.reject(new TypeError('NetworkError'));
      return Promise.resolve(okSessionResponse());
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-retry')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('invite-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    expect(sessionCalls).toBeGreaterThanOrEqual(2);
  });
});

describe('InviteParticipants route — slot rendering', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('moderator slot renders the host screen name when a participant-joined event is in the store', async () => {
    seedParticipantJoined(1, 'moderator', HOST_USER_ID, 'alice');
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const moderatorOccupant = screen
      .getAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'moderator');
    expect(moderatorOccupant?.textContent).toBe('alice');
  });

  it('debater-A slot renders the empty-state caption by default', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const emptyA = screen
      .getAllByTestId('invite-slot-empty')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(emptyA?.textContent).toBe('Awaiting Debater A');
  });

  it('debater-A slot flips to filled when a participant-joined event arrives', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
    // The empty-state caption for debater-A is gone.
    const empties = screen
      .queryAllByTestId('invite-slot-empty')
      .filter((el) => el.getAttribute('data-role') === 'debater-A');
    expect(empties.length).toBe(0);
  });

  it('debater-B slot follows the same fill rule', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-B');
      expect(occupant?.textContent).toBe('maria');
    });
  });

  it('participant-left event clears the slot back to empty', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(3, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
    act(() => {
      seedParticipantLeft(4, DEBATER_A_ID);
    });
    await waitFor(() => {
      const empty = screen
        .getAllByTestId('invite-slot-empty')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(empty?.textContent).toBe('Awaiting Debater A');
    });
  });
});

describe('InviteParticipants route — invite link', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('invite link shape is <origin>/p/sessions/<id>/invite?role=<role>', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const inputA = screen
      .getAllByTestId<HTMLInputElement>('invite-link-input')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(inputA?.value).toBe(
      `${window.location.origin}/p/sessions/${SESSION_ID}/invite?role=debater-A`,
    );
    const inputB = screen
      .getAllByTestId<HTMLInputElement>('invite-link-input')
      .find((el) => el.getAttribute('data-role') === 'debater-B');
    expect(inputB?.value).toBe(
      `${window.location.origin}/p/sessions/${SESSION_ID}/invite?role=debater-B`,
    );
  });

  it('copy-link button calls navigator.clipboard.writeText with the slot URL', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const copyA = screen
      .getAllByTestId('invite-link-copy')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    await act(async () => {
      fireEvent.click(copyA as HTMLElement);
      await Promise.resolve();
    });
    expect(writeTextSpy).toHaveBeenCalledWith(
      `${window.location.origin}/p/sessions/${SESSION_ID}/invite?role=debater-A`,
    );
  });

  it('copy-link surfaces the "Copied!" confirmation on success', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const copyA = screen
      .getAllByTestId('invite-link-copy')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    await act(async () => {
      fireEvent.click(copyA as HTMLElement);
      await Promise.resolve();
    });
    await waitFor(() => {
      const confirmation = screen
        .getAllByTestId('invite-link-copied')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(confirmation?.textContent).toBe('Copied!');
      expect(confirmation?.getAttribute('role')).toBe('status');
      expect(confirmation?.getAttribute('aria-live')).toBe('polite');
    });
  });

  it('copy-link surfaces the fallback hint on clipboard failure', async () => {
    const writeTextSpy = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const copyA = screen
      .getAllByTestId('invite-link-copy')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    await act(async () => {
      fireEvent.click(copyA as HTMLElement);
      await Promise.resolve();
    });
    await waitFor(() => {
      const fallback = screen
        .getAllByTestId('invite-link-fallback')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(fallback?.textContent).toBe(
        'Could not copy automatically. Select the link above and copy it manually.',
      );
    });
  });
});

describe('InviteParticipants route — enter-session button', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('navigates to /sessions/<id>/operate on click when both debaters are present', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    // Seed both debaters first (the strict gate from `mod_session_lobby`
    // disables the click otherwise).
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const button = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('invite-enter-session'));
    expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}/operate`, { replace: false });
  });

  // Amended case 15 (per `mod_session_lobby` Decision §2) — inverted
  // from the predecessor's "always enabled" assertion to the new strict
  // gate: disabled until BOTH debaters joined. Render with zero / one
  // debater present and the button stays disabled; seed both and the
  // gate opens.
  it('is disabled until both debaters joined — strict gate per mod_session_lobby', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    const buttonInitial = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
    expect(buttonInitial.disabled).toBe(true);
    // Seed only debater-A — still disabled.
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
    expect(screen.getByTestId<HTMLButtonElement>('invite-enter-session').disabled).toBe(true);
    // Seed debater-B — gate opens.
    act(() => {
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const button = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
      expect(button.disabled).toBe(false);
    });
  });

  it('is disabled when only debater-B is present', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-B');
      expect(occupant?.textContent).toBe('maria');
    });
    expect(screen.getByTestId<HTMLButtonElement>('invite-enter-session').disabled).toBe(true);
  });

  it('disabled click is a no-op — navigateSpy is not called when zero debaters present', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    const button = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
    expect(button.disabled).toBe(true);
    // fireEvent.click on a native-disabled button does not dispatch
    // the React click handler — assert the navigate spy stays clean.
    fireEvent.click(button);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('gate re-disables when a debater leaves after both joined', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const button = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
      expect(button.disabled).toBe(false);
    });
    // Banner is visible at this point.
    expect(screen.queryByTestId('invite-both-ready-banner')).toBeTruthy();
    // Debater A leaves — gate closes, banner unmounts, awaiting-A
    // tooltip surfaces on the button.
    act(() => {
      seedParticipantLeft(3, DEBATER_A_ID);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('invite-both-ready-banner')).toBeNull();
    });
    const buttonAfter = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
    expect(buttonAfter.disabled).toBe(true);
    expect(buttonAfter.getAttribute('title')).toBe('Awaiting Debater A');
  });
});

describe('InviteParticipants route — per-slot ready badge (mod_session_lobby)', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('renders pending badges on both debater slots before any participant-joined event', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const badges = screen.getAllByTestId('invite-slot-ready');
    expect(badges.length).toBe(2);
    const badgeA = badges.find((el) => el.getAttribute('data-role') === 'debater-A');
    const badgeB = badges.find((el) => el.getAttribute('data-role') === 'debater-B');
    expect(badgeA?.getAttribute('data-ready')).toBe('false');
    expect(badgeA?.textContent).toBe('Not yet joined');
    expect(badgeB?.getAttribute('data-ready')).toBe('false');
    expect(badgeB?.textContent).toBe('Not yet joined');
  });

  it('debater-A badge flips to ready when participant-joined arrives; debater-B stays pending', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const badge = screen
        .getAllByTestId('invite-slot-ready')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(badge?.getAttribute('data-ready')).toBe('true');
      expect(badge?.textContent).toBe('Ready');
    });
    const badgeB = screen
      .getAllByTestId('invite-slot-ready')
      .find((el) => el.getAttribute('data-role') === 'debater-B');
    expect(badgeB?.getAttribute('data-ready')).toBe('false');
    expect(badgeB?.textContent).toBe('Not yet joined');
  });

  it('moderator slot does not render a ready badge', async () => {
    seedParticipantJoined(1, 'moderator', HOST_USER_ID, 'alice');
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const moderatorBadge = screen
      .queryAllByTestId('invite-slot-ready')
      .find((el) => el.getAttribute('data-role') === 'moderator');
    expect(moderatorBadge).toBeUndefined();
  });
});

describe('InviteParticipants route — both-ready banner (mod_session_lobby)', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('renders the banner when both debaters joined', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const banner = screen.queryByTestId('invite-both-ready-banner');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toBe('Both debaters joined! Ready to start.');
    });
  });

  it('does not render the banner when only one debater is present', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
    expect(screen.queryByTestId('invite-both-ready-banner')).toBeNull();
  });

  it('banner uses role="status" + aria-live="polite"', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const banner = screen.queryByTestId('invite-both-ready-banner');
      expect(banner).toBeTruthy();
      expect(banner?.getAttribute('role')).toBe('status');
      expect(banner?.getAttribute('aria-live')).toBe('polite');
    });
  });
});

describe('InviteParticipants route — disabled tooltip + hint (mod_session_lobby)', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('awaiting-both: title="Awaiting both debaters", hint matches awaiting-both', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    const button = screen.getByTestId('invite-enter-session');
    expect(button.getAttribute('title')).toBe('Awaiting both debaters');
    const hint = screen.getByTestId('invite-enter-session-hint');
    expect(hint.textContent).toBe('Waiting for both debaters to join before you can enter.');
  });

  it('awaiting-A: only debater-B present → title="Awaiting Debater A"', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-B');
      expect(occupant?.textContent).toBe('maria');
    });
    const button = screen.getByTestId('invite-enter-session');
    expect(button.getAttribute('title')).toBe('Awaiting Debater A');
    expect(screen.getByTestId('invite-enter-session-hint').textContent).toBe(
      'Waiting for Debater A to join before you can enter.',
    );
  });

  it('awaiting-B: only debater-A present → title="Awaiting Debater B"', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
    const button = screen.getByTestId('invite-enter-session');
    expect(button.getAttribute('title')).toBe('Awaiting Debater B');
    expect(screen.getByTestId('invite-enter-session-hint').textContent).toBe(
      'Waiting for Debater B to join before you can enter.',
    );
  });

  it('ready: both debaters present → no title, hint="Click to enter the session."', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const button = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
      expect(button.disabled).toBe(false);
    });
    const button = screen.getByTestId('invite-enter-session');
    // When enabled, the title is omitted so hover doesn't surface
    // stale awaiting-tooltip text. Confirm absence.
    expect(button.hasAttribute('title')).toBe(false);
    expect(screen.getByTestId('invite-enter-session-hint').textContent).toBe(
      'Click to enter the session.',
    );
  });

  it('a11y: aria-describedby on the button points at the hint paragraph id', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    const button = screen.getByTestId('invite-enter-session');
    expect(button.getAttribute('aria-describedby')).toBe('invite-enter-session-hint');
    const hint = screen.getByTestId('invite-enter-session-hint');
    expect(hint.getAttribute('id')).toBe('invite-enter-session-hint');
  });

  it('i18n: every new lobby key resolves in en-US (no raw key strings leak)', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    // Pending state — badges + tooltip + hint all resolve.
    const badgesPending = screen.getAllByTestId('invite-slot-ready');
    for (const badge of badgesPending) {
      const text = badge.textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text.startsWith('moderator.invite.')).toBe(false);
    }
    const buttonPending = screen.getByTestId('invite-enter-session');
    const titlePending = buttonPending.getAttribute('title') ?? '';
    expect(titlePending.length).toBeGreaterThan(0);
    expect(titlePending.startsWith('moderator.invite.')).toBe(false);
    const hintPending = screen.getByTestId('invite-enter-session-hint').textContent ?? '';
    expect(hintPending.length).toBeGreaterThan(0);
    expect(hintPending.startsWith('moderator.invite.')).toBe(false);
    // Ready state — banner + hint resolve.
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('invite-both-ready-banner')).toBeTruthy();
    });
    const banner = screen.getByTestId('invite-both-ready-banner').textContent ?? '';
    expect(banner.length).toBeGreaterThan(0);
    expect(banner.startsWith('moderator.invite.')).toBe(false);
    const hintReady = screen.getByTestId('invite-enter-session-hint').textContent ?? '';
    expect(hintReady.length).toBeGreaterThan(0);
    expect(hintReady.startsWith('moderator.invite.')).toBe(false);
  });
});

describe('InviteParticipants route — i18n key resolution', () => {
  beforeEach(() => {
    global.fetch = stubSessionFetch(okSessionResponse);
  });

  it('resolves every catalog key the rendered DOM references in en-US (no raw keys leak)', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    // Walk every data-testid surface that holds a localized string and
    // assert the rendered text is non-empty AND not a raw dotted key
    // (i18next's missing-key fallback renders the dotted key itself
    // when returnNull is false).
    const surfaces = [
      'route-title',
      'invite-session-privacy',
      'invite-slot-role-moderator',
      'invite-slot-role-debater-A',
      'invite-slot-role-debater-B',
      'invite-enter-session',
      'invite-enter-session-hint',
    ];
    for (const id of surfaces) {
      const el = screen.getByTestId(id);
      const text = el.textContent ?? '';
      expect(text.length, `testid=${id} must render non-empty text`).toBeGreaterThan(0);
      expect(text.startsWith('moderator.invite.'), `testid=${id} must not render a raw key`).toBe(
        false,
      );
    }
    // The empty-state captions read the ICU-interpolated key.
    const empties = screen.getAllByTestId('invite-slot-empty');
    expect(empties.length).toBe(2);
    for (const empty of empties) {
      const text = empty.textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text.startsWith('moderator.invite.')).toBe(false);
    }
    // Copy-link copy resolves on the buttons.
    const copyButtons = screen.getAllByTestId('invite-link-copy');
    for (const btn of copyButtons) {
      expect(btn.textContent).toBe('Copy invite link');
    }
    // Per-role invite-link inputs carry a non-raw aria-label.
    const inputs = screen.getAllByTestId('invite-link-input');
    for (const input of inputs) {
      const label = input.getAttribute('aria-label') ?? '';
      expect(label.length).toBeGreaterThan(0);
      expect(label.startsWith('moderator.invite.')).toBe(false);
    }
  });

  it('resolves moderator.invite.title in every supported locale', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('moderator.invite.title')).toBe('Invite participants');
    await i18next.changeLanguage('pt-BR');
    expect(i18next.t('moderator.invite.title')).toBe('Convidar participantes');
    await i18next.changeLanguage('es-419');
    expect(i18next.t('moderator.invite.title')).toBe('Invitar participantes');
    await i18next.changeLanguage('en-US');
  });
});

// ────────────────────────────────────────────────────────────────────────
// HTTP-prefetch + merge cases — appended for
// `moderator_ui.mod_session_setup.mod_invite_participants_rest_prefetch`.
//
// The route now issues a second GET on mount —
// `GET /api/sessions/:id/participants` — alongside the existing
// session-header GET, and the slot map is fed by
// `mergeSlots(httpRows, wsOccupants, events)` (HTTP seeds; WS overlays
// on collision; WS-derived `participant-left` absences override HTTP
// rows per Decision §6 of the refinement).
//
// The 10 cases below pin each requirement bullet from the refinement's
// "Test layers per ADR 0022 → Vitest" list (cases 1-10).
// ────────────────────────────────────────────────────────────────────────
describe('InviteParticipants route — HTTP prefetch + merge (mod_invite_participants_rest_prefetch)', () => {
  it('case 1 — renders the loading state while the participants HTTP fetch is in flight', async () => {
    // Session header resolves; participants GET is left pending. The
    // loading composition (per Decision §5) requires BOTH fetches to
    // resolve before the loaded branch fires; assert the loading
    // affordance stays up and no slot sections render.
    global.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ userId: HOST_USER_ID, screenName: 'alice' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url === `/api/sessions/${SESSION_ID}/participants`) {
        return new Promise<Response>(() => {
          /* never resolves */
        });
      }
      return Promise.resolve(okSessionResponse());
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-loading')).toBeTruthy();
    });
    // Slot sections only render in the loaded branch.
    expect(screen.queryAllByTestId('invite-slot').length).toBe(0);
  });

  it('case 2 — renders the loaded state when both fetches resolve; WS overlay fills the screen name', async () => {
    // HTTP prefetch returns the moderator + both debaters (active
    // rows, no screenName per the current endpoint contract). The
    // route renders the loaded branch with the slot map seeded from
    // HTTP (each slot is "filled" via merge presence) but the
    // rendered text is empty until the WS overlay arrives. The case
    // then seeds the WS catch-up replay (one event per role) and
    // asserts the screen names land.
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([
        { userId: HOST_USER_ID, role: 'moderator' },
        { userId: DEBATER_A_ID, role: 'debater-A' },
        { userId: DEBATER_B_ID, role: 'debater-B' },
      ]),
    );
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    // Three slot sections — all filled (via HTTP presence even
    // before the WS overlay).
    const occupants = screen.getAllByTestId('invite-slot-occupant');
    expect(occupants.length).toBe(3);
    // Now seed the WS catch-up replay — screen names land.
    act(() => {
      seedParticipantJoined(1, 'moderator', HOST_USER_ID, 'alice');
      seedParticipantJoined(2, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(3, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const mod = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'moderator');
      expect(mod?.textContent).toBe('alice');
    });
    const a = screen
      .getAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    const b = screen
      .getAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'debater-B');
    expect(a?.textContent).toBe('ben');
    expect(b?.textContent).toBe('maria');
  });

  it('case 3 — renders the error state when the participants HTTP fetch fails', async () => {
    // Session GET 200; participants GET 500 → error branch fires
    // (per Decision §5: error when EITHER fetch fails).
    global.fetch = stubSessionFetch(okSessionResponse, () => new Response('boom', { status: 500 }));
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeTruthy();
    });
    expect(screen.getByTestId('invite-retry')).toBeTruthy();
    // No slots rendered while in the error branch.
    expect(screen.queryAllByTestId('invite-slot').length).toBe(0);
  });

  it('case 4 — retry button re-triggers BOTH fetches (HTTP prefetch + session header)', async () => {
    // First attempt: session GET 200; participants GET 500 → error.
    // Click retry; both effects re-fire because the handler bumps
    // both nonces (per Decision §3). Second attempt: both 200 →
    // loaded with both debaters from HTTP.
    let participantsCalls = 0;
    let sessionCalls = 0;
    global.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ userId: HOST_USER_ID, screenName: 'alice' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url === `/api/sessions/${SESSION_ID}/participants`) {
        participantsCalls += 1;
        if (participantsCalls === 1) {
          return Promise.resolve(new Response('boom', { status: 500 }));
        }
        return Promise.resolve(
          okParticipantsResponse([
            { userId: HOST_USER_ID, role: 'moderator' },
            { userId: DEBATER_A_ID, role: 'debater-A' },
            { userId: DEBATER_B_ID, role: 'debater-B' },
          ]),
        );
      }
      sessionCalls += 1;
      return Promise.resolve(okSessionResponse());
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-retry')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('invite-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    // Both effects re-fired.
    expect(participantsCalls).toBeGreaterThanOrEqual(2);
    expect(sessionCalls).toBeGreaterThanOrEqual(2);
    // Three slot sections rendered (HTTP-only fill — no WS events
    // seeded).
    expect(screen.getAllByTestId('invite-slot-occupant').length).toBe(3);
  });

  it('case 5 — HTTP prefetch seeds the gate before any WS event arrives', async () => {
    // Session GET 200; participants GET returns rows for moderator +
    // both debaters (active, no screenName). The strict gate's
    // `bothDebatersPresent` predicate is a pure presence check on the
    // merged occupants — it evaluates true from HTTP alone, even
    // with empty screenName strings. Assert the Enter button is
    // enabled AND the "both ready" banner is in the DOM, all from
    // the prefetch path with no WS event seeded.
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([
        { userId: HOST_USER_ID, role: 'moderator' },
        { userId: DEBATER_A_ID, role: 'debater-A' },
        { userId: DEBATER_B_ID, role: 'debater-B' },
      ]),
    );
    renderRoute();
    await waitFor(() => {
      const button = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
      expect(button.disabled).toBe(false);
    });
    expect(screen.queryByTestId('invite-both-ready-banner')).toBeTruthy();
  });

  it('case 6 — WS event wins on collision with HTTP-prefetched screen name', async () => {
    // HTTP prefetch returns a debater-A row with screenName='old-name'
    // (the future denormalized endpoint shape, simulated via the
    // optional screenName field). WS event arrives with
    // participant-joined(debater-A, screen_name='new-name'). Assert
    // the slot text is 'new-name' (WS wins).
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([{ userId: DEBATER_A_ID, role: 'debater-A', screenName: 'old-name' }]),
    );
    renderRoute();
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('old-name');
    });
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'new-name');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('new-name');
    });
  });

  it('case 7 — WS overlay fills the empty screenName from the HTTP prefetch', async () => {
    // HTTP returns a debater-A row with no screenName (the actual
    // current endpoint shape). WS event arrives later with
    // participant-joined(debater-A, screen_name='ben'). Assert the
    // slot text flips from empty to 'ben'.
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([{ userId: DEBATER_A_ID, role: 'debater-A' }]),
    );
    renderRoute();
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant).toBeTruthy();
    });
    // Empty screenName before the WS overlay arrives.
    const occupantBefore = screen
      .getAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(occupantBefore?.textContent).toBe('');
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    });
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
  });

  it('case 8 — HTTP-prefetched row with leftAt !== null is NOT rendered (active filter)', async () => {
    // Participants response includes a debater-A row with a non-null
    // leftAt (historical row from a prior leave-and-rejoin pair).
    // Assert the active-row filter drops it and the slot renders the
    // empty caption instead.
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([
        {
          userId: DEBATER_A_ID,
          role: 'debater-A',
          leftAt: '2026-05-16T01:00:00.000Z',
        },
      ]),
    );
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const occupantA = screen
      .queryAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(occupantA).toBeUndefined();
    const emptyA = screen
      .getAllByTestId('invite-slot-empty')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(emptyA?.textContent).toBe('Awaiting Debater A');
  });

  it('case 9 — participant-left event removes a debater slot filled by the HTTP prefetch', async () => {
    // HTTP prefetch returns both debaters as active. WS arrives with
    // participant-left(debater-A). The merge MUST respect WS-derived
    // absences (Decision §6's `latest` map filter) so the HTTP row
    // doesn't outlive the WS leave. Assert the slot returns to
    // empty.
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([
        { userId: DEBATER_A_ID, role: 'debater-A' },
        { userId: DEBATER_B_ID, role: 'debater-B' },
      ]),
    );
    renderRoute();
    await waitFor(() => {
      const occupantA = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupantA).toBeTruthy();
    });
    act(() => {
      seedParticipantLeft(1, DEBATER_A_ID);
    });
    await waitFor(() => {
      const occupantA = screen
        .queryAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupantA).toBeUndefined();
    });
    const emptyA = screen
      .getAllByTestId('invite-slot-empty')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(emptyA?.textContent).toBe('Awaiting Debater A');
    // debater-B is still present (only A left).
    const occupantB = screen
      .getAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'debater-B');
    expect(occupantB).toBeTruthy();
  });

  it('case 10 — concurrent HTTP fetch + WS catch-up — no flicker; WS screen name wins on the merged occupant', async () => {
    // Seed a WS event BEFORE the route mounts so the catch-up state
    // is already present in the store when the HTTP fetch resolves.
    // The merge's `useMemo` over [httpRows, wsOccupants, events]
    // settles to a single occupant pair (WS wins on collision); the
    // rendered text is the WS screen name with no intermediate empty
    // render. Pins the reference-equality stability of the merge
    // across the two-source update.
    seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
    global.fetch = stubSessionFetch(okSessionResponse, () =>
      okParticipantsResponse([{ userId: DEBATER_A_ID, role: 'debater-A' }]),
    );
    renderRoute();
    await waitFor(() => {
      const occupant = screen
        .getAllByTestId('invite-slot-occupant')
        .find((el) => el.getAttribute('data-role') === 'debater-A');
      expect(occupant?.textContent).toBe('ben');
    });
    // Confirm the WS name held; the HTTP row's empty screenName did
    // NOT clobber the WS overlay's 'ben'.
    const occupant = screen
      .getAllByTestId('invite-slot-occupant')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(occupant?.textContent).toBe('ben');
  });
});
