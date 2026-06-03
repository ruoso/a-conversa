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
import { useFlashStore, useSelectionStore, useUiStore } from '../stores';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ACTOR_A = '00000000-0000-4000-8000-0000000000a2';
const ACTOR_B = '00000000-0000-4000-8000-0000000000b2';
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

function participantJoinedEvent(seq: number, userId: string, screenName: string): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x3000 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role: 'debater-A',
      screen_name: screenName,
      joined_at: '2026-06-03T00:01:00.000Z',
    },
    createdAt: '2026-06-03T00:01:00.000Z',
  };
}

function voteEventBy(seq: number, actor: string): Event {
  return { ...voteEvent(seq), actor };
}

// The node id `nodeEvent(2)` carries — used by the target-dimension test.
const NODE_2_ID = '00000000-0000-4000-8000-000000000102';

/**
 * A `fetch` mock serving a single page of a mixed log: a
 * `participant-joined` (ACTOR_A → "Alice"), a `node-created` by ACTOR_A,
 * and a `vote` by ACTOR_B. Yields three kinds and two distinct actors —
 * one labeled by screen name, one falling back to its id prefix.
 */
function mixedLogFetch(): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      jsonResponse({
        events: [
          participantJoinedEvent(1, ACTOR_A, 'Alice'),
          nodeEvent(2, ACTOR_A),
          voteEventBy(3, ACTOR_B),
        ],
        nextCursor: null,
      }),
    ),
  );
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
  useUiStore.setState({ focusRequest: null });
  useFlashStore.setState({ flashingIds: new Set<string>(), flashNonce: 0 });
  useSelectionStore.getState().clear();
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

describe('ChangeHistoryPane — click-to-flash activation (mod_history_click_to_flash)', () => {
  it('exposes an accessible activation button per row (role + aria-label)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    const button = within(row).getByTestId('change-history-row-activate');
    // A real <button> — keyboard Enter/Space activation comes free with the
    // element semantics (Decision §D5); the accessible name is non-empty.
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-label')).toBeTruthy();
    // The button is queryable by its button role + accessible name.
    expect(screen.getByRole('button', { name: button.getAttribute('aria-label') ?? '' })).toBe(
      button,
    );
  });

  it('activating a node row dispatches requestCanvasFocus + flash with the row affected ids', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [nodeEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    const button = within(row).getByTestId('change-history-row-activate');
    const nodeId = '00000000-0000-4000-8000-000000000101';

    act(() => {
      fireEvent.click(button);
    });

    // Re-frame channel: the focus request carries the node id, no edges.
    expect(useUiStore.getState().focusRequest?.nodeIds).toEqual([nodeId]);
    expect(useUiStore.getState().focusRequest?.edgeIds).toEqual([]);
    // Flash channel: the flashing set is exactly the node id.
    expect([...useFlashStore.getState().flashingIds]).toEqual([nodeId]);
  });

  it('activating an empty-affected row (session-ended) dispatches empty sets without error', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [sessionEndedEvent(1)], nextCursor: null })),
    );
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);

    const row = await screen.findByTestId('change-history-row');
    const button = within(row).getByTestId('change-history-row-activate');

    act(() => {
      fireEvent.click(button);
    });

    expect(useUiStore.getState().focusRequest?.nodeIds).toEqual([]);
    expect(useUiStore.getState().focusRequest?.edgeIds).toEqual([]);
    expect(useFlashStore.getState().flashingIds.size).toBe(0);
    // The nonce still advanced — a no-op flash is a real dispatch.
    expect(useFlashStore.getState().flashNonce).toBe(1);
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

describe('ChangeHistoryPane — filter strip (mod_history_filtering)', () => {
  function kindChip(kind: string): HTMLElement {
    const chip = screen
      .getAllByTestId('change-history-filter-kind')
      .find((c) => c.getAttribute('data-filter-kind') === kind);
    if (chip === undefined) throw new Error(`no kind chip for ${kind}`);
    return chip;
  }
  function actorChip(actor: string): HTMLElement {
    const chip = screen
      .getAllByTestId('change-history-filter-actor')
      .find((c) => c.getAttribute('data-filter-actor') === actor);
    if (chip === undefined) throw new Error(`no actor chip for ${actor}`);
    return chip;
  }
  function visibleRows(): HTMLElement[] {
    return screen.queryAllByTestId('change-history-row');
  }

  it('renders a kind chip per available kind and an actor chip per available actor', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    // Three kinds present (participant-joined, node-created, vote) in
    // canonical order.
    expect(
      screen
        .getAllByTestId('change-history-filter-kind')
        .map((c) => c.getAttribute('data-filter-kind')),
    ).toEqual(['participant-joined', 'node-created', 'vote']);

    // Two actors — ACTOR_A labeled by screen name, ACTOR_B by id prefix.
    const actorChips = screen.getAllByTestId('change-history-filter-actor');
    expect(actorChips.map((c) => c.getAttribute('data-filter-actor'))).toEqual([ACTOR_A, ACTOR_B]);
    expect(actorChip(ACTOR_A).textContent).toBe('Alice');
    expect(actorChip(ACTOR_B).textContent).toBe(ACTOR_B.slice(0, 8));
  });

  it('pressing a kind chip narrows the list to that kind and flips aria-pressed', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    expect(visibleRows()).toHaveLength(3);
    fireEvent.click(kindChip('vote'));
    expect(kindChip('vote').getAttribute('aria-pressed')).toBe('true');
    const rows = visibleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-event-kind')).toBe('vote');
  });

  it('pressing a second kind chip widens the list to the union', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    fireEvent.click(kindChip('vote'));
    fireEvent.click(kindChip('node-created'));
    const kinds = visibleRows().map((r) => r.getAttribute('data-event-kind'));
    expect(kinds).toHaveLength(2);
    expect(new Set(kinds)).toEqual(new Set(['vote', 'node-created']));
  });

  it('pressing an actor chip AND a kind chip narrows to the intersection', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    // node-created ∩ ACTOR_A → the single node row authored by ACTOR_A.
    fireEvent.click(kindChip('node-created'));
    fireEvent.click(actorChip(ACTOR_A));
    const rows = visibleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-event-kind')).toBe('node-created');
  });

  it('the target toggle is disabled with no selection and enabled once one is set; toggling narrows by affected', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    const target = screen.getByTestId('change-history-filter-target');
    expect(target.hasAttribute('disabled')).toBe(true);
    expect(target.getAttribute('title')).toBeTruthy();

    // Seed a graph selection — the pane reads `useSelectionStore`.
    act(() => {
      useSelectionStore.getState().select({ kind: 'node', id: NODE_2_ID });
    });
    expect(screen.getByTestId('change-history-filter-target').hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByTestId('change-history-filter-target'));
    expect(screen.getByTestId('change-history-filter-target').getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Only the node-created row touches NODE_2_ID.
    const rows = visibleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-event-kind')).toBe('node-created');
  });

  it('the clear button appears only when the filter is non-default and resets the full list', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    expect(screen.queryByTestId('change-history-filter-clear')).toBeNull();
    fireEvent.click(kindChip('vote'));
    expect(visibleRows()).toHaveLength(1);
    const clear = screen.getByTestId('change-history-filter-clear');

    fireEvent.click(clear);
    expect(visibleRows()).toHaveLength(3);
    expect(screen.queryByTestId('change-history-filter-clear')).toBeNull();
    expect(kindChip('vote').getAttribute('aria-pressed')).toBe('false');
  });

  it('a filter that excludes every row surfaces the filtered-empty state, not the default empty', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    // vote ∩ ACTOR_A → empty (ACTOR_A never voted).
    fireEvent.click(kindChip('vote'));
    fireEvent.click(actorChip(ACTOR_A));
    expect(visibleRows()).toHaveLength(0);
    expect(screen.getByTestId('change-history-pane-filtered-empty')).toBeTruthy();
    expect(screen.queryByTestId('change-history-pane-empty')).toBeNull();
    // The strip remains the escape hatch from the filtered-empty state.
    expect(screen.getByTestId('change-history-filter-strip')).toBeTruthy();
  });

  it('keeps the strip visible in the default-empty state', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ events: [], nextCursor: null })));
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-empty');

    expect(screen.getByTestId('change-history-filter-strip')).toBeTruthy();
    expect(screen.queryByTestId('change-history-pane-filtered-empty')).toBeNull();
  });

  it('leaves the existing row contract unaffected', async () => {
    global.fetch = mixedLogFetch();
    render(<ChangeHistoryPane sessionId={SESSION} nowMs={NOW_MS} />);
    await screen.findByTestId('change-history-pane-list');

    const nodeRow = screen
      .getAllByTestId('change-history-row')
      .find((r) => r.getAttribute('data-event-kind') === 'node-created');
    expect(nodeRow?.getAttribute('data-event-id')).toBe(nodeEvent(2, ACTOR_A).id);
    expect(nodeRow?.getAttribute('data-sequence')).toBe('2');
    expect(within(nodeRow as HTMLElement).getByTestId('change-history-row-kind')).toBeTruthy();
  });
});
