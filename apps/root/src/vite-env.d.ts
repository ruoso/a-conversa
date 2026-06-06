// Augments Vite's `ImportMetaEnv` (from `vite/client`, already in this app's
// tsconfig `types`) with the root app's custom flags.
interface ImportMetaEnv {
  // Set (to "1") only by the root dev server's `serve` config
  // (`apps/root/vite.config.ts`). Switches `SurfaceHost` to the dev-source
  // surface loader. Undefined in the production build and under Vitest, so
  // both take the real manifest + built-bundle loading path.
  readonly VITE_SURFACE_SOURCE?: string;
}
