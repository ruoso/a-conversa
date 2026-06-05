// Vitest + RTL cases for the test-mode `<SessionLogRoute>` view.
//
// Refinement: tasks/refinements/replay_test/test_mode_load_session.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications); 0024
//   (react-i18next).
//
// Mocks the shell's `useSessionEventLog` hook (the paging-fetch logic is
// pinned separately by `useSessionEventLog.test.tsx`) and asserts the view
// renders each of the four load states + the empty-ready state through
// their stable `data-testid` seams, reading the `testMode.loadSession.*`
// catalog keys: loading, not-found, error (+ working retry), empty-ready,
// and a non-empty ready readout (count header + one ascending-`sequence`
// row per event).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { createI18nInstance } from '@a-conversa/shell';
import type { SessionEventLog } from '@a-conversa/shell';

const useSessionEventLogMock = vi.fn<(sessionId: string) => SessionEventLog>();

vi.mock('@a-conversa/shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@a-conversa/shell')>();
  return {
    ...actual,
    useSessionEventLog: (sessionId: string) => useSessionEventLogMock(sessionId),
  };
});

// Imported after the mock is registered so it binds the mocked hook.
const { SessionLogRoute } = await import('./SessionLogRoute');

const SESSION = '00000000-0000-4000-8000-000000000099';

function makeEvent(sequence: number, kind: string): SessionEventLog['events'][number] {
  return {
    id: `00000000-0000-4000-8000-0000000${String(100 + sequence)}`,
    sessionId: SESSION,
    sequence,
    kind,
    actor: '00000000-0000-4000-8000-000000000001',
    payload: {},
    createdAt: `2026-06-01T10:00:0${String(sequence)}.000Z`,
  } as SessionEventLog['events'][number];
}

async function render(): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(
      <MemoryRouter initialEntries={[`/sessions/${SESSION}`]}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<SessionLogRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    return Promise.resolve();
  });
  return result;
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
  useSessionEventLogMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SessionLogRoute — loading', () => {
  it('renders the loading affordance', async () => {
    useSessionEventLogMock.mockReturnValue({ status: 'loading', events: [], retry: vi.fn() });
    await render();

    const loading = screen.getByTestId('test-mode-session-log-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent).toBe('Loading session log…');
  });
});

describe('SessionLogRoute — not-found', () => {
  it('renders the not-found affordance', async () => {
    useSessionEventLogMock.mockReturnValue({ status: 'not-found', events: [], retry: vi.fn() });
    await render();

    const notFound = screen.getByTestId('test-mode-session-log-not-found');
    expect(notFound.getAttribute('role')).toBe('alert');
    expect(notFound.textContent).toBe('Session not found or not visible.');
  });
});

describe('SessionLogRoute — error', () => {
  it('renders the error affordance with a working retry control', async () => {
    const retry = vi.fn();
    useSessionEventLogMock.mockReturnValue({ status: 'error', events: [], retry });
    await render();

    expect(screen.getByTestId('test-mode-session-log-error').getAttribute('role')).toBe('alert');
    fireEvent.click(screen.getByTestId('test-mode-session-log-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('SessionLogRoute — empty ready', () => {
  it('renders the empty-log affordance, not a blank readout', async () => {
    useSessionEventLogMock.mockReturnValue({ status: 'ready', events: [], retry: vi.fn() });
    await render();

    const empty = screen.getByTestId('test-mode-session-log-empty');
    expect(empty.getAttribute('role')).toBe('status');
    expect(empty.textContent).toBe('This session has no events yet.');
    expect(screen.queryByTestId('test-mode-session-log')).toBeNull();
  });
});

describe('SessionLogRoute — ready readout', () => {
  it('renders the count header and one row per event in ascending sequence order', async () => {
    const events = [
      makeEvent(1, 'session-created'),
      makeEvent(2, 'node-created'),
      makeEvent(3, 'vote'),
    ];
    useSessionEventLogMock.mockReturnValue({ status: 'ready', events, retry: vi.fn() });
    await render();

    expect(screen.getByTestId('test-mode-session-log-count').textContent).toBe('3 events');

    const container = screen.getByTestId('test-mode-session-log');
    const rows = container.querySelectorAll('[data-sequence]');
    expect([...rows].map((r) => r.getAttribute('data-sequence'))).toEqual(['1', '2', '3']);

    const row2 = screen.getByTestId('test-mode-session-log-row-2');
    expect(row2.textContent).toContain('node-created');
    expect(row2.textContent).toContain('2026-06-01T10:00:02.000Z');
  });
});
