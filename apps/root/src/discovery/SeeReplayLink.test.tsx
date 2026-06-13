// Component coverage for the see-replay link (acceptance criterion 2): the
// resolved `<Link>` href (`/a/replay/:id`), the localized visible + accessible
// labels, and that nothing renders for a live and a lobby row (helper yields
// `null`).
//
// Refinement: tasks/refinements/session_discovery/sd_see_replay_link.md

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { SeeReplayLink } from './SeeReplayLink';
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

describe('SeeReplayLink', () => {
  it('renders an audience-replay link with the localized accessible name for an ended row', () => {
    renderWithProviders(<SeeReplayLink row={ENDED_ROW} />);

    const link = screen.getByTestId('session-see-replay-link');
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link.getAttribute('href')).toBe('/a/replay/s3');
    expect(link.textContent).toBe('See replay');
    expect(link.getAttribute('aria-label')).toBe('See replay: Old debate');
    // A missing key would surface the dotted path instead of resolved text.
    expect(link.textContent).not.toContain('discovery.');
  });

  it('renders nothing for a live row (helper yields null)', () => {
    renderWithProviders(<SeeReplayLink row={LIVE_ROW} />);
    expect(screen.queryByTestId('session-see-replay-link')).toBeNull();
  });

  it('renders nothing for a lobby row (helper yields null)', () => {
    renderWithProviders(<SeeReplayLink row={LOBBY_ROW} />);
    expect(screen.queryByTestId('session-see-replay-link')).toBeNull();
  });
});
