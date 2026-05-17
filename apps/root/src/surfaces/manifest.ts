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
  const imported = (await import(/* @vite-ignore */ moduleUrl)) as Partial<SurfaceModule>;
  if (typeof imported.mount !== 'function') {
    throw new Error(`surface module ${moduleUrl} did not export mount()`);
  }
  return imported as SurfaceModule;
}
