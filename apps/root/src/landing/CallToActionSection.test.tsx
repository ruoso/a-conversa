import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { CallToActionSection } from './CallToActionSection';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
});

describe('CallToActionSection', () => {
  it('renders a labelled secondary-CTA section with its heading and body', () => {
    renderWithProviders(<CallToActionSection />);

    const section = screen.getByTestId('landing-cta');
    expect(section.getAttribute('aria-labelledby')).toBe('landing-cta-title');
    expect(section.textContent).toContain('Start a debate');
  });

  // The migrated `landing_hero_and_method` CTA-affordances assertion
  // (Constraint 6): the relocated affordances keep their exact testids so the
  // auth-flow Playwright scenarios that select them stay green.
  it('hosts the relocated start-session link and the SSO login button', () => {
    renderWithProviders(<CallToActionSection />);

    const startSession = screen.getByTestId('root-start-session');
    expect(startSession.getAttribute('href')).toBe('/m/sessions/new');

    expect(screen.getByTestId('auth-login-button')).toBeTruthy();
  });
});
