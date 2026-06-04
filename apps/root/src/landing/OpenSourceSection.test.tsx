import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { OpenSourceSection } from './OpenSourceSection';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
});

describe('OpenSourceSection', () => {
  it('renders a labelled section with its heading and open-source pitch', () => {
    renderWithProviders(<OpenSourceSection />);

    const section = screen.getByTestId('landing-opensource');
    expect(section.getAttribute('aria-labelledby')).toBe('landing-open-source-title');
    // i18n-resolved en-US copy — a missing key would render the dotted path.
    expect(section.textContent).toContain('Built in the open');
    expect(section.textContent).toContain('open source');
  });

  it('links to the real GitHub repository in a new tab with a safe rel', () => {
    renderWithProviders(<OpenSourceSection />);

    const repoLink = screen.getByTestId('landing-opensource-repo-link');
    expect(repoLink.getAttribute('href')).toBe('https://github.com/ruoso/a-conversa');
    expect(repoLink.getAttribute('target')).toBe('_blank');
    expect(repoLink.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('states the AGPL-3.0-or-later license and links to the repo LICENSE', () => {
    renderWithProviders(<OpenSourceSection />);

    const section = screen.getByTestId('landing-opensource');
    expect(section.textContent).toContain('AGPL-3.0-or-later');

    const licenseLink = screen.getByTestId('landing-opensource-license-link');
    expect(licenseLink.getAttribute('href')).toBe(
      'https://github.com/ruoso/a-conversa/blob/main/LICENSE',
    );
    expect(licenseLink.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
