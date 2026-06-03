// Tests for `<ChangeHistoryPane>` — the right-sidebar change-history
// pane and its reverse-chronological event scroller.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Per ADR 0022 these are committed Vitest cases pinning the refinement's
// acceptance criteria:
//   (2) Pane render against the seeded store + mocked fetch — two
//       ascending REST pages (nextCursor chained then null) overlaid with
//       a higher-sequence live event render all rows newest-first; the
//       live event is at the top.
//   (3) Row contract — each row exposes data-event-id / data-event-kind /
//       data-sequence and the three column test ids; a null actor renders
//       the localized "System" label.
//   (4) States — loading test id before the fetch resolves; error test id
//       + working retry button on a rejected fetch; empty test id when the
//       fetch resolves with zero events.
//
// The pane reads `useWsStore` directly (no `WsClientProvider` needed —
// it never calls `useWsClient`), and prefetches via the global `fetch`
// (mocked here). i18n resolves through the default i18next instance the
// shell `createI18nInstance` initializes.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import type { Event } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

import { ChangeHistoryPane } from './ChangeHistoryPane';
import { useWsStore } from '../ws/wsStore';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
// 2026-06-03T00:01:30.000Z — fixed "now" so relative timestamps stay
// stable across runs.
const NOW_MS = Date.parse('2026-06-03T00:01:30.000Z');

function nodeEvent(seq: number, actor: string | null = ACTOR): Event {
  return {
    id: `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'node-created',
    actor,
    payload: {
      node_id: `00000000-0000-4000-8000-00000000010${seq}`,
      wording: `node ${String(seq)}`,
      created_by: ACTOR,
      created_at: '2026-06-03T00:01:00.000Z',
    },
    createdAt: '2026-06-03T00:01:00.000Z',
  };
}

function voteEvent(seq: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x7000 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: 'node',
      entity_id: '00000000-0000-4000-8000-0000000000e1',
      facet: 'substance',
      participant: ACTOR,
      choice: 'dispute',
      voted_at: '2026-06-03T00:01:00.000Z',
    },
    createdAt: '2026-06-03T00:01:00.000Z',
  };
}

function sessionEndedEvent(seq: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x9000 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'session-ended',
    actor: ACTOR,
    payload: { ended_at: '2026-06-03T00:01:00.000Z' },
    createdAt: '2026-06-03T00:01:00.000Z',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A `fetch` mock that serves the two ascending pages keyed off the
 * `?after=` cursor: page 1 (`after=0`) → seqs 1,2 with `nextCursor: 2`;
 * page 2 (`after=2`) → seq 3 with `nextCursor: null`.
 */
function twoPageFetch(): typeof fetch {
  return vi.fn((input: URL | RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('after=0')) {
      return Promise.resolve(jsonResponse({ events: [nodeEvent(1), nodeEvent(2)], nextCursor: 2 }));
    }
    return Promise.resolve(jsonResponse({ events: [nodeEvent(3)], nextCursor: null }));
  });
}

const originalFetch = global.fetch;

beforeEach(async () => {
  useWsStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('ChangeHistoryPane — REST prefetch + WS overlay', () => {
  it('renders all rows newest-first with the live event at the top', async () => {
    global.fetch = twoPageFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    // A higher-sequence live event lands while the prefetch is in flight.
    act(() => {
      useWsStore.getState().applyEvent(nodeEvent(10));
    });

    const list = await screen.findByTestId('change-history-pane-list');
    const rows = within(list).getAllByTestId('change-history-row');
    // Prefetched 1,2,3 unioned with live 10 → newest-first 10,3,2,1.
    expect(rows.map((r) => r.getAttribute('data-sequence'))).toEqual(['10', '3', '2', '1']);
    expect(rows[0]?.getAttribute('data-sequence')).toBe('10');
  });

  it('overlays the live event onto the prefetched log without duplication', async () => {
    global.fetch = twoPageFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');
    act(() => {
      useWsStore.getState().applyEvent(nodeEvent(10));
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('change-history-row')).toHaveLength(4);
    });
  });
});

describe('ChangeHistoryPane — row contract', () => {
  it('exposes the stable data-attributes and column test ids per row', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    expect(row.getAttribute('data-event-id')).toBe(nodeEvent(1).id);
    expect(row.getAttribute('data-event-kind')).toBe('node-created');
    expect(row.getAttribute('data-sequence')).toBe('1');
    expect(within(row).getByTestId('change-history-row-kind').textContent).toBe(
      'Statement created',
    );
    expect(within(row).getByTestId('change-history-row-actor').textContent).toBe(ACTOR.slice(0, 8));
    expect(within(row).getByTestId('change-history-row-timestamp').textContent).toBeTruthy();
  });

  it('renders the localized "System" label for a null actor', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1, null)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    expect(within(row).getByTestId('change-history-row-actor').textContent).toBe('System');
  });
});

describe('ChangeHistoryPane — per-row payload summary (mod_history_event_summary)', () => {
  it('renders a free-text summary (node wording) verbatim', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    expect(within(row).getByTestId('change-history-row-summary').textContent).toBe('node 1');
  });

  it('renders an enum summary (vote choice) as the localized label', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [voteEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    // en-US: `summary.choice.dispute` → "Dispute".
    expect(within(row).getByTestId('change-history-row-summary').textContent).toBe('Dispute');
  });

  it('emits NO summary element for a { type: none } kind (session-ended)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [sessionEndedEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    expect(within(row).queryByTestId('change-history-row-summary')).toBeNull();
  });
});

describe('ChangeHistoryPane — loading / error / empty states', () => {
  it('shows the loading surface before the fetch resolves', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    expect(screen.getByTestId('change-history-pane-loading')).toBeTruthy();

    await act(async () => {
      resolveFetch(jsonResponse({ events: [], nextCursor: null }));
      // Flush the component's resolved-fetch microtasks inside `act`.
      await Promise.resolve();
    });
    await screen.findByTestId('change-history-pane-empty');
  });

  it('shows the empty surface when the prefetch resolves with zero events', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ events: [], nextCursor: null })));
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const empty = await screen.findByTestId('change-history-pane-empty');
    expect(empty.textContent).toBe('No events yet');
    expect(screen.queryByTestId('change-history-pane-list')).toBeNull();
  });

  it('shows the error surface + a working retry button on a rejected fetch', async () => {
    // First attempt rejects; the retry attempt succeeds with one event.
    let attempt = 0;
    global.fetch = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('network down'));
      return Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null }));
    });
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const error = await screen.findByTestId('change-history-pane-error');
    expect(error).toBeTruthy();
    const retry = screen.getByTestId('change-history-pane-retry');

    fireEvent.click(retry);

    // The retried prefetch succeeds → the row renders, error clears.
    await screen.findByTestId('change-history-row');
    expect(screen.queryByTestId('change-history-pane-error')).toBeNull();
  });

  it('treats a non-200 REST status as an error surface', async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response('nope', { status: 404 })));
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-error');
  });
});
