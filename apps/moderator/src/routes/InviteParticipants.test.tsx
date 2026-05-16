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
import { initI18n } from '../i18n';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '../ws/WsClientProvider';
import type { WsClient } from '../ws/client';

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
  await initI18n('en-US');
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
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/invite`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <Routes>
          <Route path="/sessions/:id/invite" element={<InviteParticipantsRoute />} />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>,
  );
  return { client };
}

/**
 * Build a `fetch` stub that returns a freshly-constructed `Response`
 * each call. Mirrors the pattern in `CreateSession.test.tsx`.
 */
function stubSessionFetch(builder: () => Response): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(builder()));
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
    let calls = 0;
    global.fetch = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new TypeError('NetworkError'));
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
    expect(calls).toBeGreaterThanOrEqual(2);
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

  it('invite link shape is <origin>/sessions/<id>/invite?role=<role>', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-session-topic')).toBeTruthy();
    });
    const inputA = screen
      .getAllByTestId<HTMLInputElement>('invite-link-input')
      .find((el) => el.getAttribute('data-role') === 'debater-A');
    expect(inputA?.value).toBe(
      `${window.location.origin}/sessions/${SESSION_ID}/invite?role=debater-A`,
    );
    const inputB = screen
      .getAllByTestId<HTMLInputElement>('invite-link-input')
      .find((el) => el.getAttribute('data-role') === 'debater-B');
    expect(inputB?.value).toBe(
      `${window.location.origin}/sessions/${SESSION_ID}/invite?role=debater-B`,
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
      `${window.location.origin}/sessions/${SESSION_ID}/invite?role=debater-A`,
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

  it('navigates to /sessions/<id>/operate on click', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('invite-enter-session'));
    expect(navigateSpy).toHaveBeenCalledWith(`/sessions/${SESSION_ID}/operate`, { replace: false });
  });

  it('is always enabled — both with no participants and with both debater slots filled', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('invite-enter-session')).toBeTruthy();
    });
    const buttonEmpty = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
    expect(buttonEmpty.disabled).toBe(false);
    // Seed both debater slots, still enabled.
    act(() => {
      seedParticipantJoined(1, 'debater-A', DEBATER_A_ID, 'ben');
      seedParticipantJoined(2, 'debater-B', DEBATER_B_ID, 'maria');
    });
    await waitFor(() => {
      const occupants = screen.getAllByTestId('invite-slot-occupant');
      expect(occupants.length).toBeGreaterThanOrEqual(2);
    });
    const buttonFilled = screen.getByTestId<HTMLButtonElement>('invite-enter-session');
    expect(buttonFilled.disabled).toBe(false);
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
