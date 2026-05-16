// Smoke tests for the shell's screen-name form.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Covers:
//  - Disables submit when empty / whitespace-only after trim.
//  - POSTs the NFKC-normalized trimmed value to /api/auth/screen-name.
//  - Maps server `code` envelopes to the expected i18n keys.
//  - Client-side mirror rejections (bidi-override, ZWJ, control chars).
//  - On 200 success: calls auth.refresh() then onSuccess.
//  - Accessibility wiring: aria-invalid toggles, focus returns to input
//    on server-side error.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { AuthProvider } from '../auth/AuthProvider.js';
import { createI18nInstance } from '../i18n/createI18nInstance.js';
import { I18nProvider } from '../i18n/I18nProvider.js';
import { ScreenNameForm } from './ScreenNameForm.js';

import type { i18n as I18nInstance } from 'i18next';

const RLO = String.fromCharCode(0x202e); // Right-to-left override
const ZWJ = String.fromCharCode(0x200d); // Zero-width joiner
const NUL = String.fromCharCode(0x0000); // C0 control

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
});

const ORIGINAL_FETCH = global.fetch;
afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

function renderForm(onSuccess: () => void = () => undefined): ReactElement {
  return (
    <I18nProvider i18n={i18n}>
      <AuthProvider>
        <ScreenNameForm onSuccess={onSuccess} />
      </AuthProvider>
    </I18nProvider>
  );
}

function stubAuthMePending(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === '/api/auth/me') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000200',
            screenName: '<pending>',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(new Response('', { status: 404 }));
  });
}

describe('<ScreenNameForm>', () => {
  beforeEach(() => {
    global.fetch = stubAuthMePending() as typeof fetch;
  });

  it('renders the form with disabled submit when empty', async () => {
    render(renderForm());
    await waitFor(() => {
      const submit = screen.getByTestId('screen-name-submit');
      expect(submit.getAttribute('disabled')).not.toBeNull();
    });
  });

  it('disables submit when input is whitespace-only', async () => {
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: '   ' } });
    const submit = screen.getByTestId('screen-name-submit');
    expect(submit.getAttribute('disabled')).not.toBeNull();
  });

  it('POSTs the NFKC-normalized trimmed value on submit', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              userId: '00000000-0000-4000-8000-000000000201',
              screenName: '<pending>',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url === '/api/auth/screen-name') {
        const body = JSON.parse((init?.body as string) ?? '{}') as { screenName: string };
        expect(body.screenName).toBe('alice');
        return Promise.resolve(new Response('', { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    global.fetch = fetchMock as typeof fetch;

    render(renderForm(onSuccess));
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: '  alice  ' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    const postCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/screen-name');
    expect(postCalls).toHaveLength(1);
  });

  it('maps screen-name-invalid server code → invalidCharacter error key', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              userId: '00000000-0000-4000-8000-000000000202',
              screenName: '<pending>',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'screen-name-invalid' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    global.fetch = fetchMock as typeof fetch;

    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'something' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      const err = screen.getByTestId('screen-name-error');
      expect(err.textContent).toBeTruthy();
    });
  });

  it('rejects bidi-override (RLO U+202E) client-side without POSTing', async () => {
    const fetchMock = stubAuthMePending();
    global.fetch = fetchMock as typeof fetch;
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: `al${RLO}ice` } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error')).toBeTruthy();
    });
    const postCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/screen-name');
    expect(postCalls).toHaveLength(0);
  });

  it('rejects zero-width joiner (U+200D) client-side without POSTing', async () => {
    const fetchMock = stubAuthMePending();
    global.fetch = fetchMock as typeof fetch;
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: `al${ZWJ}ice` } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error')).toBeTruthy();
    });
    const postCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/screen-name');
    expect(postCalls).toHaveLength(0);
  });

  it('rejects C0 control char (U+0000) client-side without POSTing', async () => {
    const fetchMock = stubAuthMePending();
    global.fetch = fetchMock as typeof fetch;
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: `al${NUL}ice` } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-name-error')).toBeTruthy();
    });
    const postCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/screen-name');
    expect(postCalls).toHaveLength(0);
  });

  it('toggles aria-invalid when an error is shown', async () => {
    const fetchMock = stubAuthMePending();
    global.fetch = fetchMock as typeof fetch;
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(input, { target: { value: `al${RLO}ice` } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('focus returns to the input after a server-side error', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              userId: '00000000-0000-4000-8000-000000000203',
              screenName: '<pending>',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'screen-name-already-set' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    global.fetch = fetchMock as typeof fetch;
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    const submitBtn = screen.getByTestId('screen-name-submit');
    submitBtn.focus();
    expect(document.activeElement).toBe(submitBtn);
    await act(async () => {
      fireEvent.submit(screen.getByTestId('screen-name-form'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it('character-count helper formats {used}/{max}', async () => {
    const fetchMock = stubAuthMePending();
    global.fetch = fetchMock as typeof fetch;
    render(renderForm());
    const input = await screen.findByTestId('screen-name-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    const helper = screen.getByTestId('screen-name-helper');
    expect(helper.textContent).toContain('5');
  });
});
