// Vitest + RTL cases for the test-mode `<SessionLogRoute>` view.
//
// Refinement: tasks/refinements/replay_test/test_mode_load_session.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications); 0024
//   (react-i18next).
//
// Mocks the shell's `useSessionEventLog` hook (the paging-fetch logic is
// pinned separately by `useSessionEventLog.test.tsx`) and asserts the view
// renders each of the four load states through their stable `data-testid`
// seams, reading the `testMode.loadSession.*` catalog keys: loading,
// not-found, error (+ working retry), empty-ready. The non-empty ready state
// now mounts the timeline scrubber surface (`test-mode_timeline_scrubber`,
// Decision §3), superseding the former inert readout list — asserted here by
// the scrubber's `data-testid`; the scrubber's own behaviour is pinned by
// `scrubber/TimelineScrubber.test.tsx`.

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
import type { Event } from '@a-conversa/shared-types';

const useSessionEventLogMock = vi.fn<(sessionId: string) => SessionEventLog>();

// Stub the heavy Cytoscape renderer the scrubber mounts on the ready path.
vi.mock('@a-conversa/graph-view', () => ({
  GraphView: ({ events }: { events: readonly Event[]; instanceKey: string }) => (
    <div data-testid="graph-view-stub" data-event-count={events.length} />
  ),
  // The scrubber mounts the changes-panel sibling, which projects through
  // `projectGraph`; an empty-projection stub keeps this mock complete (the
  // panel's own readout is pinned by `changes/ChangeHighlights.test.tsx`).
  projectGraph: () => ({ nodes: [], edges: [] }),
}));

vi.mock('@a-conversa/shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@a-conversa/shell')>();
  return {
    ...actual,
    useSessionEventLog: (sessionId: string) => useSessionEventLogMock(sessionId),
    // Stub the connected snapshot list (it fetches on mount); the live
    // jump flow is pinned by the Playwright e2e.
    SnapshotJumpList: ({ sessionId }: { sessionId: string; onJump: (p: number) => void }) => (
      <div data-testid="snapshot-jump-stub" data-session-id={sessionId} />
    ),
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

describe('SessionLogRoute — ready (non-empty) mounts the scrubber', () => {
  it('mounts the timeline scrubber surface, not the superseded readout list', async () => {
    const events = [
      makeEvent(1, 'session-created'),
      makeEvent(2, 'node-created'),
      makeEvent(3, 'vote'),
    ];
    useSessionEventLogMock.mockReturnValue({ status: 'ready', events, retry: vi.fn() });
    await render();

    // The scrubber surface supersedes the former event-list readout in place.
    expect(screen.getByTestId('test-mode-scrubber')).toBeTruthy();
    expect(screen.getByTestId('test-mode-scrubber-range')).toBeTruthy();
    expect(screen.queryByTestId('test-mode-session-log')).toBeNull();

    // It opens at the head, projecting the whole log into the graph.
    expect(screen.getByTestId('test-mode-scrubber-status').getAttribute('data-position')).toBe('3');
    expect(screen.getByTestId('graph-view-stub').getAttribute('data-event-count')).toBe('3');
  });
});
