// Tests for the `/sessions/new` create-session form route.
//
// Refinement: tasks/refinements/moderator-ui/mod_create_session_form.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: moderator_ui.mod_session_setup.mod_create_session_form
//
// Per ADR 0022 these are committed regression probes for every
// observable behaviour the refinement specifies. The case set mirrors
// the bullet list under "Test layers per ADR 0022 → Vitest (in
// CreateSession.test.tsx)" in the refinement (17 cases minimum).
//
// `useNavigate` mocking. The component calls `useNavigate()` from
// `react-router-dom` once at render time and invokes the returned
// function on a successful 201. We `vi.mock` the module so the test
// spy captures the call without the test needing to wrap the route in
// a real router-with-routes graph. The `MemoryRouter` is still used to
// satisfy the hook's "must be inside a router" invariant.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';

import { CreateSessionRoute } from './CreateSession';
import { createI18nInstance } from '@a-conversa/shell';

// ────────────────────────────────────────────────────────────────────────
// Mock `react-router-dom`'s `useNavigate` so the test can capture the
// post-submit redirect target. The other exports (`MemoryRouter`,
// hooks the route doesn't use) pass through.
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

afterEach(() => {
  cleanup();
  navigateSpy.mockReset();
});

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

/**
 * Build a `fetch` stub that returns a freshly-constructed `Response`
 * each time it's called. The route only calls `fetch` once per submit,
 * but the per-call factory keeps the test isolated from response-body
 * consumption details if a future refactor calls `fetch` twice.
 */
function stubFetch(builder: () => Response) {
  return vi.fn((_input?: URL | RequestInfo, _init?: RequestInit) => Promise.resolve(builder()));
}

function renderRoute(): void {
  render(
    <MemoryRouter initialEntries={['/sessions/new']}>
      <CreateSessionRoute />
    </MemoryRouter>,
  );
}

describe('CreateSession route — initial render + structure', () => {
  beforeEach(() => {
    global.fetch = stubFetch(() => new Response('', { status: 200 }));
  });

  it('renders title, topic input, privacy fieldset, helper, and disabled submit on mount', () => {
    renderRoute();

    expect(screen.getByTestId('route-create-session')).toBeTruthy();
    expect(screen.getByTestId('route-title').textContent).toBe('Create a session');

    // Topic field
    const topicLabel = screen.getByTestId('create-session-topic-label');
    expect(topicLabel.textContent).toBe('Debate topic');
    const topicInput = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    expect(topicInput.maxLength).toBe(256);

    // Privacy field — public is initially checked, private is not
    const fieldset = screen.getByTestId('create-session-privacy-fieldset');
    expect(within(fieldset).getByTestId('create-session-privacy-legend').textContent).toBe(
      'Privacy',
    );
    const publicRadio = screen.getByTestId<HTMLInputElement>('create-session-privacy-public');
    const privateRadio = screen.getByTestId<HTMLInputElement>('create-session-privacy-private');
    expect(publicRadio.checked).toBe(true);
    expect(privateRadio.checked).toBe(false);

    // Helper reads 0/256 on mount.
    expect(screen.getByTestId('create-session-helper').textContent).toBe('0/256 characters');

    // Submit is initially disabled (empty topic).
    const submit = screen.getByTestId<HTMLButtonElement>('create-session-submit');
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Create session');
  });

  it('enables submit on non-empty trimmed topic and disables again when cleared', () => {
    renderRoute();
    const submit = screen.getByTestId<HTMLButtonElement>('create-session-submit');
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');

    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: ' should UBI replace welfare? ' } });
    expect(submit.disabled).toBe(false);

    fireEvent.change(input, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '' } });
    expect(submit.disabled).toBe(true);
  });

  it('updates the helper text with the trimmed character count', () => {
    renderRoute();
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    fireEvent.change(input, { target: { value: '  hello  ' } });
    expect(screen.getByTestId('create-session-helper').textContent).toBe('5/256 characters');
  });
});

describe('CreateSession route — submit behaviour', () => {
  it('disables the submit while the in-flight POST is pending', async () => {
    // `fetch` returns a never-resolving promise; the test asserts the
    // submit is disabled while the request hangs.
    global.fetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );
    renderRoute();
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    const submit = screen.getByTestId<HTMLButtonElement>('create-session-submit');
    fireEvent.change(input, { target: { value: 'topic' } });
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    expect(submit.disabled).toBe(true);
  });

  it('POSTs to /api/sessions with the trimmed topic and public privacy by default', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000100' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    global.fetch = fetchMock;

    renderRoute();
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    fireEvent.change(input, { target: { value: '  should UBI replace welfare?  ' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      topic: 'should UBI replace welfare?',
      privacy: 'public',
    });
  });

  it('navigates to /sessions/<id>/invite with replace: false on 201', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(JSON.stringify({ id: 'session-uuid-xyz' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });
    // mod_invite_participants amends the post-201 navigation target
    // from /operate to /invite — the moderator lands on the invite
    // surface before entering the operate canvas.
    expect(navigateSpy).toHaveBeenCalledWith('/sessions/session-uuid-xyz/invite', {
      replace: false,
    });
  });

  it('captures privacy=private when the user clicks the private radio before submit', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({ id: 'session-priv-1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    global.fetch = fetchMock;

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'private topic' },
    });
    const privateRadio = screen.getByTestId<HTMLInputElement>('create-session-privacy-private');
    fireEvent.click(privateRadio);
    expect(privateRadio.checked).toBe(true);
    expect(screen.getByTestId<HTMLInputElement>('create-session-privacy-public').checked).toBe(
      false,
    );

    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      topic: 'private topic',
      privacy: 'private',
    });
  });
});

describe('CreateSession route — server-error mapping', () => {
  it('renders the localized validation error on 400 validation-failed', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'validation-failed', message: 'topic must be at most 256 characters' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'a topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('create-session-error').textContent).toBe(
        'The session could not be created. Please check your input.',
      );
    });
  });

  it('renders the localized unauthenticated error on 401 auth-required', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'auth-required', message: 'session expired' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    );

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'a topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('create-session-error').textContent).toBe(
        'Your session expired. Please sign in again.',
      );
    });
  });

  it('renders the localized generic error on an unrecognized server error code (500)', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'internal-error', message: 'boom' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'a topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('create-session-error').textContent).toBe(
        'Something went wrong. Please try again.',
      );
    });
  });

  it('renders the localized network error when fetch rejects', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('NetworkError')));

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'a topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('create-session-error').textContent).toBe(
        'Could not reach the server. Please try again.',
      );
    });
  });

  it('renders the localized generic error when 201 response body lacks a string id', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(JSON.stringify({ id: null }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'a topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('create-session-error').textContent).toBe(
        'Something went wrong. Please try again.',
      );
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('CreateSession route — accessibility wiring', () => {
  beforeEach(() => {
    global.fetch = stubFetch(() => new Response('', { status: 200 }));
  });

  it('sets aria-describedby on the topic input pointing to helper + error ids', () => {
    renderRoute();
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    expect(input.getAttribute('aria-describedby')).toBe(
      'create-session-helper create-session-error',
    );
  });

  it('toggles aria-invalid on the topic input when an error is set and cleared', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'validation-failed', message: 'bad' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderRoute();
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(input, { target: { value: 'a topic' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });
    // Typing clears the error → aria-invalid resets.
    fireEvent.change(input, { target: { value: 'another topic' } });
    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('false');
    });
  });

  it('marks the error region with role=alert + aria-live=polite + aria-atomic', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'internal-error', message: 'boom' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderRoute();
    fireEvent.change(screen.getByTestId('create-session-topic-input'), {
      target: { value: 'a topic' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      const errorRegion = screen.getByTestId('create-session-error');
      expect(errorRegion.getAttribute('role')).toBe('alert');
      expect(errorRegion.getAttribute('aria-live')).toBe('polite');
      expect(errorRegion.getAttribute('aria-atomic')).toBe('true');
    });
  });

  it('focuses the topic input on mount', async () => {
    renderRoute();
    await waitFor(() => {
      const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
      expect(document.activeElement).toBe(input);
    });
  });

  it('returns focus to the topic input after a server-side error', async () => {
    global.fetch = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'validation-failed', message: 'bad' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderRoute();
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    fireEvent.change(input, { target: { value: 'a topic' } });
    // Move focus off the input — onto the submit button — to verify
    // the post-error focus return is observable.
    const submitBtn = screen.getByTestId<HTMLButtonElement>('create-session-submit');
    submitBtn.focus();
    expect(document.activeElement).toBe(submitBtn);
    await act(async () => {
      fireEvent.submit(screen.getByTestId('create-session-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });
});

describe('CreateSession route — i18n key resolution', () => {
  beforeEach(() => {
    global.fetch = stubFetch(() => new Response('', { status: 200 }));
  });

  it('resolves every catalog key the rendered DOM references in en-US', () => {
    renderRoute();
    // Walk every data-testid surface that holds a localized string and
    // assert the rendered text is non-empty AND not a raw dotted key
    // (i18next's `returnNull: false` config makes a missing key render
    // as the dotted key itself).
    const surfaces = [
      'route-title',
      'create-session-topic-label',
      'create-session-privacy-legend',
      'create-session-privacy-public-label',
      'create-session-privacy-private-label',
      'create-session-helper',
      'create-session-submit',
    ];
    for (const id of surfaces) {
      const el = screen.getByTestId(id);
      const text = el.textContent ?? '';
      expect(text.length, `testid=${id} must render non-empty text`).toBeGreaterThan(0);
      expect(
        text.startsWith('moderator.createSession.'),
        `testid=${id} must not render a raw key`,
      ).toBe(false);
    }
    // Placeholder is an attribute, not text content.
    const input = screen.getByTestId<HTMLInputElement>('create-session-topic-input');
    expect(input.placeholder.length).toBeGreaterThan(0);
    expect(input.placeholder.startsWith('moderator.createSession.')).toBe(false);
  });

  it('resolves moderator.createSession.title in every supported locale', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('moderator.createSession.title')).toBe('Create a session');
    await i18next.changeLanguage('pt-BR');
    expect(i18next.t('moderator.createSession.title')).toBe('Criar uma sessão');
    await i18next.changeLanguage('es-419');
    expect(i18next.t('moderator.createSession.title')).toBe('Crear una sesión');
    await i18next.changeLanguage('en-US');
  });
});
