import type { SurfaceModule } from '@a-conversa/shell';

export interface SurfaceManifestEntry {
  readonly moduleUrl: string;
  readonly styleUrls?: readonly string[];
}

export interface SurfaceManifest {
  readonly surfaces: Readonly<Record<string, SurfaceManifestEntry>>;
}

export async function loadSurfaceManifest(): Promise<SurfaceManifest> {
  const response = await fetch('/_surfaces/manifest.json', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`surface manifest request failed with ${String(response.status)}`);
  }

  const manifest = (await response.json()) as SurfaceManifest;
  if (manifest === null || typeof manifest !== 'object' || manifest.surfaces === undefined) {
    throw new Error('surface manifest response had an unexpected shape');
  }

  return manifest;
}

export function injectStyles(styleUrls: readonly string[]): HTMLLinkElement[] {
  const links: HTMLLinkElement[] = [];
  for (const styleUrl of styleUrls) {
    const existing = document.head.querySelector<HTMLLinkElement>(
      `link[data-surface-style="${styleUrl}"]`,
    );
    if (existing) {
      links.push(existing);
      continue;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;
    link.dataset.surfaceStyle = styleUrl;
    document.head.appendChild(link);
    links.push(link);
  }
  return links;
}

export async function importSurfaceModule(moduleUrl: string): Promise<SurfaceModule> {
  // Vite library mode emits surface bundles with BOTH a named `mount`
  // export AND a `default` export holding the full `SurfaceModule`
  // object `{ mount, meta }`. The named-only `imported` namespace has
  // `mount` reachable but `meta` only via `imported.default.meta` —
  // so the host must prefer the default export when present so
  // surface-level meta (e.g. `requiredAuthLevel: 'public'` read by
  // `SurfaceHost` per `aud_no_auth_for_public`) is reachable.
  const imported = (await import(/* @vite-ignore */ moduleUrl)) as Partial<SurfaceModule> & {
    readonly default?: Partial<SurfaceModule>;
  };
  const surface: Partial<SurfaceModule> =
    imported.default !== undefined && typeof imported.default.mount === 'function'
      ? imported.default
      : imported;
  if (typeof surface.mount !== 'function') {
    throw new Error(`surface module ${moduleUrl} did not export mount()`);
  }
  return surface as SurfaceModule;
}
