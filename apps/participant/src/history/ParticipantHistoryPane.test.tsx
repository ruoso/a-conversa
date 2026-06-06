// Tests for `<ParticipantHistoryPane>` — the participant tablet's
// reverse-chronological change-history view.
//
// Refinement: tasks/refinements/participant-ui/part_history_list.md
// ADRs:        docs/adr/0006-unit-test-framework-vitest.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Per ADR 0022 these are committed Vitest cases pinning Acceptance §4:
//   - all four display states render with the expected test-ids;
//   - rows render newest-first with the correct kind label, actor text,
//     and a relative timestamp;
//   - the error state's retry button re-runs the fetch.
//
// The pane reads `useWsStore` directly and prefetches via the global
// `fetch` (mocked here). i18n resolves through an `I18nProvider` wrapping
// the instance the shell `createI18nInstance` builds — the participant
// surface's convention (`ParticipantTopTabBar.test.tsx`).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Event, EventKind } from '@a-conversa/shared-types';
import { createI18nInstance, I18nProvider, type I18nInstance } from '@a-conversa/shell';

import { ParticipantHistoryPane } from './ParticipantHistoryPane';
import { useWsStore } from '../ws/wsStore';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
// Two distinct actors whose 8-char prefixes differ, so the actor chips are
// visually distinguishable in the filter-strip cases below.
const ACTOR_A = '0000000a-0000-4000-8000-0000000000a1';
const ACTOR_B = '0000000b-0000-4000-8000-0000000000b1';
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A `fetch` mock serving the two ascending pages keyed off the `?after=`
 * cursor: page 1 (`after=0`) → seqs 1,2 with `nextCursor: 2`; page 2
 * (`after=2`) → seq 3 with `nextCursor: null`.
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
let i18n: I18nInstance;

function renderPane(): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <ParticipantHistoryPane sessionId={SESSION} nowMs={NOW_MS} />
    </I18nProvider>,
  );
}

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

beforeEach(() => {
  useWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('ParticipantHistoryPane — REST prefetch + WS overlay', () => {
  it('renders all rows newest-first with the live event at the top', async () => {
    global.fetch = twoPageFetch();
    renderPane();

    // A higher-sequence live event lands while the prefetch is in flight.
    act(() => {
      useWsStore.getState().applyEvent(nodeEvent(10));
    });

    const list = await screen.findByTestId('participant-history-pane-list');
    const rows = within(list).getAllByTestId('participant-history-row');
    // Prefetched 1,2,3 unioned with live 10 → newest-first 10,3,2,1.
    expect(rows.map((r) => r.getAttribute('data-sequence'))).toEqual(['10', '3', '2', '1']);
    expect(rows[0]?.getAttribute('data-sequence')).toBe('10');
  });

  it('overlays the live event onto the prefetched log without duplication', async () => {
    global.fetch = twoPageFetch();
    renderPane();
    await screen.findByTestId('participant-history-pane-list');
    act(() => {
      useWsStore.getState().applyEvent(nodeEvent(10));
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('participant-history-row')).toHaveLength(4);
    });
  });
});

describe('ParticipantHistoryPane — row contract', () => {
  it('exposes the stable data-attributes and the three column test ids per row', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null })),
    );
    renderPane();

    const row = await screen.findByTestId('participant-history-row');
    expect(row.getAttribute('data-event-id')).toBe(nodeEvent(1).id);
    expect(row.getAttribute('data-event-kind')).toBe('node-created');
    expect(row.getAttribute('data-sequence')).toBe('1');
    expect(within(row).getByTestId('participant-history-row-kind').textContent).toBe(
      'Statement created',
    );
    expect(within(row).getByTestId('participant-history-row-actor').textContent).toBe(
      ACTOR.slice(0, 8),
    );
    expect(within(row).getByTestId('participant-history-row-timestamp').textContent).toBeTruthy();
  });

  it('renders the localized "System" label for a null actor', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1, null)], nextCursor: null })),
    );
    renderPane();

    const row = await screen.findByTestId('participant-history-row');
    expect(within(row).getByTestId('participant-history-row-actor').textContent).toBe('System');
  });
});

describe('ParticipantHistoryPane — loading / error / empty states', () => {
  it('shows the loading surface before the fetch resolves', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderPane();

    expect(screen.getByTestId('participant-history-pane-loading')).toBeTruthy();

    await act(async () => {
      resolveFetch(jsonResponse({ events: [], nextCursor: null }));
      await Promise.resolve();
    });
    await screen.findByTestId('participant-history-pane-empty');
  });

  it('shows the empty surface when the prefetch resolves with zero events', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ events: [], nextCursor: null })));
    renderPane();

    const empty = await screen.findByTestId('participant-history-pane-empty');
    expect(empty.textContent).toBe('No events yet');
    expect(screen.queryByTestId('participant-history-pane-list')).toBeNull();
  });

  it('shows the error surface + a working retry button on a rejected fetch', async () => {
    // First attempt rejects; the retry attempt succeeds with one event.
    let attempt = 0;
    global.fetch = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('network down'));
      return Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null }));
    });
    renderPane();

    const error = await screen.findByTestId('participant-history-pane-error');
    expect(error).toBeTruthy();
    const retry = screen.getByTestId('participant-history-pane-retry');

    fireEvent.click(retry);

    // The retried prefetch succeeds → the row renders, error clears.
    await screen.findByTestId('participant-history-row');
    expect(screen.queryByTestId('participant-history-pane-error')).toBeNull();
  });

  it('folds a 404 (not-found) into the retry-able error surface', async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response('nope', { status: 404 })));
    renderPane();
    await screen.findByTestId('participant-history-pane-error');
    expect(screen.getByTestId('participant-history-pane-retry')).toBeTruthy();
  });

  it('hides the filter strip while loading and when the log is empty', async () => {
    // Loading: the fetch is in flight, no strip.
    let resolveFetch: (value: Response) => void = () => undefined;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderPane();
    expect(screen.getByTestId('participant-history-pane-loading')).toBeTruthy();
    expect(screen.queryByTestId('participant-history-filter-strip')).toBeNull();

    // Empty: the prefetch resolves with zero events — still no strip.
    await act(async () => {
      resolveFetch(jsonResponse({ events: [], nextCursor: null }));
      await Promise.resolve();
    });
    await screen.findByTestId('participant-history-pane-empty');
    expect(screen.queryByTestId('participant-history-filter-strip')).toBeNull();
  });
});

// An event whose only fields that matter downstream are id / sequence /
// kind / actor / createdAt (the `isEventLike` prefetch guard + the row
// derivation). The payload is irrelevant to the filter surface, so it is a
// minimal stand-in cast to `Event`.
function event(seq: number, kind: EventKind, actor: string | null): Event {
  return {
    id: `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind,
    actor,
    payload: {},
    createdAt: '2026-06-03T00:01:00.000Z',
  } as unknown as Event;
}

/**
 * A single-page `fetch` serving a fixed mixed log:
 *   seq 1 node-created / ACTOR_A
 *   seq 2 vote         / ACTOR_A
 *   seq 3 node-created / ACTOR_B
 * Newest-first that is 3, 2, 1. Two present kinds (node-created, vote) and
 * two present actors (B then A in first-appearance order). `vote` has no
 * ACTOR_B row, so a `vote` + ACTOR_B filter matches nothing.
 */
function mixedLogFetch(): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      jsonResponse({
        events: [
          event(1, 'node-created', ACTOR_A),
          event(2, 'vote', ACTOR_A),
          event(3, 'node-created', ACTOR_B),
        ],
        nextCursor: null,
      }),
    ),
  );
}

function sequencesOf(): string[] {
  return screen
    .getAllByTestId('participant-history-row')
    .map((r) => r.getAttribute('data-sequence') ?? '');
}

describe('ParticipantHistoryPane — filter strip', () => {
  it('renders one kind chip per present kind and one actor chip per present actor', async () => {
    global.fetch = mixedLogFetch();
    renderPane();
    await screen.findByTestId('participant-history-filter-strip');

    const kindChips = screen.getAllByTestId('participant-history-filter-kind');
    expect(kindChips.map((c) => c.getAttribute('data-filter-kind'))).toEqual([
      'node-created',
      'vote',
    ]);
    const actorChips = screen.getAllByTestId('participant-history-filter-actor');
    expect(actorChips.map((c) => c.getAttribute('data-filter-actor'))).toEqual([ACTOR_B, ACTOR_A]);
  });

  it('narrows by kind, then widens to the union of two kind chips', async () => {
    global.fetch = mixedLogFetch();
    renderPane();
    await screen.findByTestId('participant-history-filter-strip');
    expect(sequencesOf()).toEqual(['3', '2', '1']);

    // Press the node-created chip → only the two node-created rows survive.
    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector('[data-filter-kind="node-created"]') as Element,
    );
    expect(sequencesOf()).toEqual(['3', '1']);

    // Press the vote chip too → the union restores all three.
    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector('[data-filter-kind="vote"]') as Element,
    );
    expect(sequencesOf()).toEqual(['3', '2', '1']);
  });

  it('AND-composes a kind chip and an actor chip down to the intersection', async () => {
    global.fetch = mixedLogFetch();
    renderPane();
    await screen.findByTestId('participant-history-filter-strip');

    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector('[data-filter-kind="node-created"]') as Element,
    );
    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector(`[data-filter-actor="${ACTOR_A}"]`) as Element,
    );
    // node-created AND ACTOR_A → seq 1 only.
    expect(sequencesOf()).toEqual(['1']);
  });

  it('shows Clear only when a filter is active and restores the full list', async () => {
    global.fetch = mixedLogFetch();
    renderPane();
    await screen.findByTestId('participant-history-filter-strip');
    expect(screen.queryByTestId('participant-history-filter-clear')).toBeNull();

    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector('[data-filter-kind="vote"]') as Element,
    );
    expect(sequencesOf()).toEqual(['2']);
    const clear = screen.getByTestId('participant-history-filter-clear');

    fireEvent.click(clear);
    expect(sequencesOf()).toEqual(['3', '2', '1']);
    expect(screen.queryByTestId('participant-history-filter-clear')).toBeNull();
  });

  it('renders the filtered-empty state (strip still visible) when nothing matches', async () => {
    global.fetch = mixedLogFetch();
    renderPane();
    await screen.findByTestId('participant-history-filter-strip');

    // vote + ACTOR_B → no row (votes are all ACTOR_A).
    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector('[data-filter-kind="vote"]') as Element,
    );
    fireEvent.click(
      screen
        .getByTestId('participant-history-filter-strip')
        .querySelector(`[data-filter-actor="${ACTOR_B}"]`) as Element,
    );

    expect(screen.getByTestId('participant-history-pane-filtered-empty')).toBeTruthy();
    expect(screen.queryByTestId('participant-history-pane-list')).toBeNull();
    // The strip stays visible so the debater can clear/adjust.
    expect(screen.getByTestId('participant-history-filter-strip')).toBeTruthy();
    expect(screen.getByTestId('participant-history-filter-clear')).toBeTruthy();
  });
});
