// Dev-only surface loader: imports each surface from SOURCE so the root
// Vite dev server transpiles + HMRs it. The bare specifiers below resolve
// to each surface's `src/main.tsx` via the alias in `apps/root/vite.config.ts`
// (`serve` branch); `dev-surfaces.d.ts` supplies the ambient types since the
// surface apps have no published `exports` map.
//
// This deliberately bypasses the production loading path (manifest fetch +
// independently-built bundle; ADR 0026). `SurfaceHost` only reaches it when
// `import.meta.env.VITE_SURFACE_SOURCE` is set, and it imports THIS module
// dynamically inside that gate — so the production build, where the flag is
// undefined, tree-shakes this module and the surface imports below away.

import type { SurfaceModule } from '@a-conversa/shell';

const DEV_SURFACE_LOADERS: Record<string, (() => Promise<unknown>) | undefined> = {
  moderator: () => import('@a-conversa/moderator'),
  participant: () => import('@a-conversa/participant'),
  audience: () => import('@a-conversa/audience'),
  'test-mode': () => import('@a-conversa/test-mode'),
};

/**
 * Import a surface from source and normalise it to a `SurfaceModule`.
 *
 * Mirrors the default-vs-named export handling in `manifest.ts`'s
 * `importSurfaceModule`: surface bundles expose both a named `mount` and a
 * `default` holding the full `{ mount, meta }`, and the host prefers the
 * default so `meta` (e.g. `requiredAuthLevel`) is reachable.
 */
export async function loadDevSurface(surfaceId: string): Promise<SurfaceModule> {
  const loader = DEV_SURFACE_LOADERS[surfaceId];
  if (loader === undefined) {
    throw new Error(`surface ${surfaceId} has no dev-source loader`);
  }
  const imported = (await loader()) as Partial<SurfaceModule> & {
    readonly default?: Partial<SurfaceModule>;
  };
  const surface: Partial<SurfaceModule> =
    imported.default !== undefined && typeof imported.default.mount === 'function'
      ? imported.default
      : imported;
  if (typeof surface.mount !== 'function') {
    throw new Error(`dev surface module ${surfaceId} did not export mount()`);
  }
  return surface as SurfaceModule;
}
