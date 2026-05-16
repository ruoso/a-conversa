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

export async function importSurfaceModule(moduleUrl: string): Promise<SurfaceModule> {
  const imported = (await import(/* @vite-ignore */ moduleUrl)) as Partial<SurfaceModule>;
  if (typeof imported.mount !== 'function') {
    throw new Error(`surface module ${moduleUrl} did not export mount()`);
  }
  return imported as SurfaceModule;
}
