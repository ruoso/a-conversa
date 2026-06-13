import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

import {
  SessionList,
  deriveLifecycleStatus,
  type SessionListPage,
  type SessionListQuery,
} from './SessionList';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

type FetcherMock = Mock<(query: SessionListQuery) => Promise<SessionListPage>>;

beforeAll(async () => {
  await getTestI18n();
});

afterEach(async () => {
  cleanup();
  // The localization specs switch the shared instance; reset to the baseline.
  const i18n = await getTestI18n();
  await i18n.changeLanguage('en-US');
});

const LOBBY_ROW = { id: 'a', topic: 'Lobby topic', startedAt: null, endedAt: null };
const LIVE_ROW = {
  id: 'b',
  topic: 'Live topic',
  startedAt: '2026-06-01T10:00:00.000Z',
  endedAt: null,
};
const ENDED_ROW = {
  id: 'c',
  topic: 'Ended topic',
  startedAt: '2026-05-01T10:00:00.000Z',
  endedAt: '2026-05-01T11:00:00.000Z',
};

/** A fetcher that resolves immediately with a fixed page. */
function staticFetcher(page: SessionListPage): FetcherMock {
  return vi.fn<(query: SessionListQuery) => Promise<SessionListPage>>(() => Promise.resolve(page));
}

/** A fetcher that slices `allRows` by the query's offset/limit. */
function pagingFetcher(allRows: SessionListPage['rows']): FetcherMock {
  return vi.fn<(query: SessionListQuery) => Promise<SessionListPage>>((query) =>
    Promise.resolve({
      rows: allRows.slice(query.offset, query.offset + query.limit),
      total: allRows.length,
    }),
  );
}

/** A fetcher whose resolutions are driven manually, one queued promise at a time. */
function deferredFetcher(): {
  readonly fn: FetcherMock;
  resolveNext(page: SessionListPage): void;
} {
  const resolvers: Array<(page: SessionListPage) => void> = [];
  const fn = vi.fn<(query: SessionListQuery) => Promise<SessionListPage>>(
    () =>
      new Promise<SessionListPage>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    fn,
    resolveNext(page) {
      const resolve = resolvers.shift();
      if (resolve === undefined) {
        throw new Error('deferredFetcher: no pending fetch to resolve');
      }
      resolve(page);
    },
  };
}

describe('deriveLifecycleStatus', () => {
  it('maps timestamps to lobby / live / ended', () => {
    expect(deriveLifecycleStatus(LOBBY_ROW)).toBe('lobby');
    expect(deriveLifecycleStatus(LIVE_ROW)).toBe('live');
    expect(deriveLifecycleStatus(ENDED_ROW)).toBe('ended');
  });
});

describe('SessionList — rows + derived status (criterion 2)', () => {
  it('renders each row topic and its derived lifecycle status text', async () => {
    const fetchPage = staticFetcher({ rows: [LOBBY_ROW, LIVE_ROW, ENDED_ROW], total: 3 });
    renderWithProviders(<SessionList fetchPage={fetchPage} />);

    await waitFor(() => {
      expect(screen.getByText('Lobby topic')).toBeTruthy();
    });
    expect(screen.getByText('Live topic')).toBeTruthy();
    expect(screen.getByText('Ended topic')).toBeTruthy();

    const statuses = screen.getAllByTestId('session-list-status').map((node) => node.textContent);
    expect(statuses).toEqual(['Lobby', 'Live', 'Ended']);
  });
});

describe('SessionList — actions slot (criterion 3)', () => {
  it('invokes renderRowActions with the row and renders its output in the row', async () => {
    const fetchPage = staticFetcher({ rows: [LIVE_ROW, ENDED_ROW], total: 2 });
    const renderRowActions = vi.fn((row: { id: string; topic: string }) => (
      <a data-testid={`action-${row.id}`} href={`/go/${row.id}`}>
        go {row.topic}
      </a>
    ));
    renderWithProviders(<SessionList fetchPage={fetchPage} renderRowActions={renderRowActions} />);

    await waitFor(() => {
      expect(screen.getByTestId('action-b')).toBeTruthy();
    });
    expect(screen.getByTestId('action-c').textContent).toContain('Ended topic');
    expect(renderRowActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });
});

describe('SessionList — topic search (criterion 4)', () => {
  it('debounces ≥3 chars, ignores 1–2 chars with a hint, and clears the filter', async () => {
    const fetchPage = staticFetcher({ rows: [LIVE_ROW], total: 1 });
    renderWithProviders(<SessionList fetchPage={fetchPage} debounceMs={0} />);

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });
    expect(fetchPage.mock.calls[0]?.[0]).not.toHaveProperty('topic');

    const search = screen.getByTestId('session-list-search');

    // 2 chars: no fetch, hint shown.
    fireEvent.change(search, { target: { value: 'cl' } });
    expect(screen.getByTestId('session-list-search-hint')).toBeTruthy();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    // ≥3 chars: fetches with the topic, offset reset to 0.
    fireEvent.change(search, { target: { value: 'climate' } });
    await waitFor(() => {
      expect(fetchPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ topic: 'climate', offset: 0 }),
      );
    });

    // Clearing refetches without a topic.
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => {
      const last = fetchPage.mock.calls[fetchPage.mock.calls.length - 1]?.[0];
      expect(last).not.toHaveProperty('topic');
    });
  });
});

describe('SessionList — date filter (criterion 5)', () => {
  it('maps from/to to ISO date-time bounds, resets offset, and shows the lobby note', async () => {
    const fetchPage = pagingFetcher([LIVE_ROW, ENDED_ROW, LOBBY_ROW, LIVE_ROW]);
    renderWithProviders(<SessionList fetchPage={fetchPage} limit={2} />);

    await waitFor(() => {
      expect(screen.getByText('Live topic')).toBeTruthy();
    });

    // Page forward first so the offset reset on filter change is observable.
    fireEvent.click(screen.getByTestId('session-list-next'));
    await waitFor(() => {
      expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }));
    });

    fireEvent.change(screen.getByTestId('session-list-from'), {
      target: { value: '2026-06-01' },
    });
    await waitFor(() => {
      expect(fetchPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ startedAfter: '2026-06-01T00:00:00.000Z', offset: 0 }),
      );
    });
    expect(screen.getByTestId('session-list-lobby-note')).toBeTruthy();

    fireEvent.change(screen.getByTestId('session-list-to'), {
      target: { value: '2026-06-30' },
    });
    await waitFor(() => {
      expect(fetchPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ startedBefore: '2026-06-30T23:59:59.999Z' }),
      );
    });
  });

  it('suppresses the lobby note when lobby rows are impossible (public list)', async () => {
    const fetchPage = staticFetcher({ rows: [LIVE_ROW], total: 1 });
    renderWithProviders(<SessionList fetchPage={fetchPage} lobbyRowsPossible={false} />);

    await waitFor(() => {
      expect(screen.getByText('Live topic')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('session-list-from'), {
      target: { value: '2026-06-01' },
    });
    await waitFor(() => {
      expect(fetchPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ startedAfter: '2026-06-01T00:00:00.000Z' }),
      );
    });
    expect(screen.queryByTestId('session-list-lobby-note')).toBeNull();
  });
});

describe('SessionList — pagination (criterion 6)', () => {
  it('moves offset by limit, renders an accurate summary, and disables edges', async () => {
    const allRows = Array.from({ length: 5 }, (_, index) => ({
      id: `row-${index}`,
      topic: `Topic ${index}`,
      startedAt: '2026-06-01T10:00:00.000Z',
      endedAt: null,
    }));
    const fetchPage = pagingFetcher(allRows);
    renderWithProviders(<SessionList fetchPage={fetchPage} limit={2} />);

    await waitFor(() => {
      expect(screen.getByTestId('session-list-summary').textContent).toMatch(/1[–-]2 of 5/);
    });
    expect(screen.getByTestId('session-list-prev')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('session-list-next')).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByTestId('session-list-next'));
    await waitFor(() => {
      expect(screen.getByTestId('session-list-summary').textContent).toMatch(/3[–-]4 of 5/);
    });
    expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }));
    expect(screen.getByTestId('session-list-prev')).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByTestId('session-list-next'));
    await waitFor(() => {
      expect(screen.getByTestId('session-list-summary').textContent).toMatch(/5[–-]5 of 5/);
    });
    // offset 4 + 1 row >= total 5 ⟶ next disabled.
    expect(screen.getByTestId('session-list-next')).toHaveProperty('disabled', true);
  });
});

describe('SessionList — loading / empty / error (criterion 7)', () => {
  it('keeps current rows visible while a refetch is in flight', async () => {
    const deferred = deferredFetcher();
    renderWithProviders(<SessionList fetchPage={deferred.fn} limit={2} />);

    expect(screen.getByTestId('session-list-loading')).toBeTruthy();
    deferred.resolveNext({ rows: [LIVE_ROW, ENDED_ROW], total: 5 });

    await waitFor(() => {
      expect(screen.getByText('Live topic')).toBeTruthy();
    });
    expect(screen.queryByTestId('session-list-loading')).toBeNull();

    fireEvent.click(screen.getByTestId('session-list-next'));
    await waitFor(() => {
      expect(screen.getByTestId('session-list-loading')).toBeTruthy();
    });
    // Rows are NOT dropped while the next page loads.
    expect(screen.getByText('Live topic')).toBeTruthy();

    deferred.resolveNext({ rows: [LOBBY_ROW], total: 5 });
    await waitFor(() => {
      expect(screen.queryByTestId('session-list-loading')).toBeNull();
    });
  });

  it('shows the empty state for a zero-row result', async () => {
    const fetchPage = staticFetcher({ rows: [], total: 0 });
    renderWithProviders(<SessionList fetchPage={fetchPage} />);

    await waitFor(() => {
      expect(screen.getByTestId('session-list-empty')).toBeTruthy();
    });
  });

  it('shows the error state and retries successfully', async () => {
    const fetchPage: FetcherMock = vi
      .fn<(query: SessionListQuery) => Promise<SessionListPage>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ rows: [LIVE_ROW], total: 1 });
    renderWithProviders(<SessionList fetchPage={fetchPage} />);

    await waitFor(() => {
      expect(screen.getByTestId('session-list-error')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-list-retry'));
    await waitFor(() => {
      expect(screen.getByText('Live topic')).toBeTruthy();
    });
    expect(screen.queryByTestId('session-list-error')).toBeNull();
  });
});

describe('SessionList — localization (criterion 8)', () => {
  it.each([
    ['en-US', 'Search by topic', 'Ended'],
    ['pt-BR', 'Buscar por tema', 'Encerrada'],
    ['es-419', 'Buscar por tema', 'Finalizada'],
  ])('renders %s strings with no raw key leak', async (locale, searchLabel, endedStatus) => {
    const i18n = await getTestI18n();
    await i18n.changeLanguage(locale);

    const fetchPage = staticFetcher({ rows: [ENDED_ROW], total: 1 });
    const { container } = renderWithProviders(<SessionList fetchPage={fetchPage} />);

    await waitFor(() => {
      expect(screen.getByText('Ended topic')).toBeTruthy();
    });
    expect(screen.getByText(searchLabel)).toBeTruthy();
    expect(screen.getByTestId('session-list-status').textContent).toBe(endedStatus);
    expect(container.textContent).not.toContain('discovery.');
  });
});

describe('SessionList — accessibility (criterion 9)', () => {
  it('gives controls, the table, and status accessible names / text', async () => {
    const fetchPage = staticFetcher({ rows: [LIVE_ROW], total: 1 });
    renderWithProviders(<SessionList fetchPage={fetchPage} />);

    await waitFor(() => {
      expect(screen.getByText('Live topic')).toBeTruthy();
    });

    expect(screen.getByRole('searchbox', { name: 'Search by topic' })).toBeTruthy();
    expect(screen.getByLabelText('Started after')).toBeTruthy();
    expect(screen.getByLabelText('Started before')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();

    const table = screen.getByRole('table', { name: 'Sessions' });
    expect(within(table).getByTestId('session-list-status').textContent).toBe('Live');
  });
});
