// Component coverage for the join-live link (acceptance criterion 2): the
// resolved `<Link>` href, the localized visible + accessible labels, and that
// nothing renders when the routing matrix yields `null`.
//
// Refinement: tasks/refinements/session_discovery/sd_join_live_link.md

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { JoinLiveLink } from './JoinLiveLink';
import type { SessionListRow } from './SessionList';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

const LOBBY_ROW: SessionListRow = {
  id: 's1',
  topic: 'Climate policy',
  startedAt: null,
  endedAt: null,
};
const LIVE_ROW: SessionListRow = {
  id: 's2',
  topic: 'Tax reform',
  startedAt: '2026-06-01T10:00:00.000Z',
  endedAt: null,
};
const ENDED_ROW: SessionListRow = {
  id: 's3',
  topic: 'Old debate',
  startedAt: '2026-05-01T10:00:00.000Z',
  endedAt: '2026-05-01T11:00:00.000Z',
};

beforeAll(async () => {
  await getTestI18n();
});

afterEach(async () => {
  cleanup();
  const i18n = await getTestI18n();
  await i18n.changeLanguage('en-US');
});

describe('JoinLiveLink', () => {
  it('renders a moderator-surface link with the localized accessible name for a host live row', () => {
    renderWithProviders(<JoinLiveLink row={LIVE_ROW} role="host" />);

    const link = screen.getByTestId('session-join-live-link');
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link.getAttribute('href')).toBe('/m/sessions/s2/operate');
    expect(link.textContent).toBe('Join live');
    const ariaLabel = link.getAttribute('aria-label');
    expect(ariaLabel).toBe('Join live: Tax reform');
    // A missing key would surface the dotted path instead of resolved text.
    expect(link.textContent).not.toContain('discovery.');
  });

  it('routes a host lobby row into the moderator lobby', () => {
    renderWithProviders(<JoinLiveLink row={LOBBY_ROW} role="host" />);
    expect(screen.getByTestId('session-join-live-link').getAttribute('href')).toBe(
      '/m/sessions/s1/lobby',
    );
  });

  it('routes a debater live row into the participant surface', () => {
    renderWithProviders(<JoinLiveLink row={LIVE_ROW} role="debater-A" />);
    expect(screen.getByTestId('session-join-live-link').getAttribute('href')).toBe(
      '/p/sessions/s2',
    );
  });

  it('routes an anonymous (no role) live row into the audience surface', () => {
    renderWithProviders(<JoinLiveLink row={LIVE_ROW} />);
    expect(screen.getByTestId('session-join-live-link').getAttribute('href')).toBe(
      '/a/sessions/s2',
    );
  });

  it('renders nothing for an ended row (matrix yields null)', () => {
    renderWithProviders(<JoinLiveLink row={ENDED_ROW} role="host" />);
    expect(screen.queryByTestId('session-join-live-link')).toBeNull();
  });

  it('renders nothing for an anonymous lobby row (defensive null)', () => {
    renderWithProviders(<JoinLiveLink row={LOBBY_ROW} />);
    expect(screen.queryByTestId('session-join-live-link')).toBeNull();
  });
});
