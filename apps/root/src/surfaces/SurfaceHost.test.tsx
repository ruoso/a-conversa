import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { type AuthContextValue } from '@a-conversa/shell';

import { SurfaceHost } from './SurfaceHost';
import * as manifestModule from './manifest';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('link[data-surface-style]').forEach((node) => node.remove());
});

describe('SurfaceHost', () => {
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: {
      userId: '00000000-0000-4000-8000-000000000004',
      screenName: 'alice',
    },
    refresh: () => undefined,
    logout: () => undefined,
  };

  it('loads the moderator manifest entry and mounts it with the provided basename', async () => {
    const mount = vi.fn(() => () => undefined);

    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {
        moderator: {
          moduleUrl: '/_surfaces/moderator/moderator.js',
          styleUrls: ['/_surfaces/moderator/moderator.css'],
        },
      },
    });
    vi.spyOn(manifestModule, 'importSurfaceModule').mockResolvedValue({ mount });

    renderWithProviders(<SurfaceHost surfaceId="moderator" routerBasePath="/m" />, {
      auth,
      initialEntries: ['/m/sessions/new'],
    });

    await waitFor(() => {
      expect(mount).toHaveBeenCalledTimes(1);
    });
    const firstCall = mount.mock.calls.at(0) as [{ routerBasePath: string }] | undefined;
    expect(firstCall?.[0].routerBasePath).toBe('/m');
    expect(
      document.head.querySelector('link[data-surface-style="/_surfaces/moderator/moderator.css"]'),
    ).not.toBeNull();
  });

  it('renders an error state when the manifest omits the requested surface', async () => {
    vi.spyOn(manifestModule, 'loadSurfaceManifest').mockResolvedValue({
      surfaces: {},
    });

    renderWithProviders(<SurfaceHost surfaceId="moderator" routerBasePath="/m" />, {
      auth,
      initialEntries: ['/m/sessions/new'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('surface-load-error')).toBeTruthy();
    });
  });
});
