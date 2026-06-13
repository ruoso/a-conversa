// Unit coverage for the role badge (acceptance criterion 3): the role → label
// mapping (host / moderator / both debater slots → debater), the localized
// rendered label, and the accessible label the badge exposes.
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { SessionRoleBadge, roleBadgeKey } from './SessionRoleBadge';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(async () => {
  cleanup();
  const i18n = await getTestI18n();
  await i18n.changeLanguage('en-US');
});

describe('roleBadgeKey', () => {
  it('maps host and moderator to themselves and both debater slots to debater', () => {
    expect(roleBadgeKey('host')).toBe('host');
    expect(roleBadgeKey('moderator')).toBe('moderator');
    expect(roleBadgeKey('debater-A')).toBe('debater');
    expect(roleBadgeKey('debater-B')).toBe('debater');
  });
});

describe('SessionRoleBadge', () => {
  it('renders the localized host label with an accessible label', () => {
    renderWithProviders(<SessionRoleBadge role="host" />);

    const badge = screen.getByTestId('session-role-badge');
    expect(badge.textContent).toBe('Host');
    expect(badge.getAttribute('data-role')).toBe('host');
    const ariaLabel = badge.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain('Host');
    // A missing key would surface the dotted path instead of resolved text.
    expect(badge.textContent).not.toContain('discovery.');
  });

  it('renders the localized moderator label', () => {
    renderWithProviders(<SessionRoleBadge role="moderator" />);
    const badge = screen.getByTestId('session-role-badge');
    expect(badge.textContent).toBe('Moderator');
    expect(badge.getAttribute('data-role')).toBe('moderator');
  });

  it('collapses both debater slots to a single debater label', () => {
    const { unmount } = renderWithProviders(<SessionRoleBadge role="debater-A" />);
    expect(screen.getByTestId('session-role-badge').textContent).toBe('Debater');
    unmount();

    renderWithProviders(<SessionRoleBadge role="debater-B" />);
    const badge = screen.getByTestId('session-role-badge');
    expect(badge.textContent).toBe('Debater');
    expect(badge.getAttribute('data-role')).toBe('debater');
  });

  it('renders nothing when the role is undefined', () => {
    renderWithProviders(<SessionRoleBadge role={undefined} />);
    expect(screen.queryByTestId('session-role-badge')).toBeNull();
  });
});
